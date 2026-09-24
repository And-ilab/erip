"""Отправка оповещений в шлюз и приём статуса доставки."""

from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from django.conf import settings
from django.utils import timezone

from apps.audit.services import record_error
from apps.core.context import get_request_id
from apps.core.exceptions import GatewayUnavailable

from apps.nsi.models import DebtGroupScale

from ..models import Channel, MessageTemplate, Notification
from .gateway_client import GatewayClient, get_gateway_client

logger = logging.getLogger(__name__)


class RecipientResolver:
    """Кому и как обращаться: пользователь ПМ или плательщик по ЛС."""

    def resolve(self, notification: Notification) -> tuple[str, str]:
        name, address = notification.recipient_name, notification.recipient_address
        if notification.recipient_user_id:
            user = notification.recipient_user
            name = name or user.display_name
            address = address or (user.email if notification.channel == Channel.EMAIL else user.phone)
        elif notification.account_id:
            account = notification.account
            payer = account.registrations.filter(subj_is_main=True).first()
            if not name:
                name = " ".join(p for p in (payer.im, payer.ot) if p) if payer and payer.im else account.short_fio
            if not address:
                if notification.channel == Channel.EMAIL:
                    address = payer.email if payer else ""
                elif notification.channel in {Channel.SMS, Channel.VOICE}:
                    address = account.contact_phone or account.phone
        return name or "клиент", address

    @staticmethod
    def account_context(notification: Notification) -> dict:
        account = notification.account
        if account is None:
            return {}
        group = account.effective_group
        scale = DebtGroupScale.objects.filter(group=group, is_active=True).first() if group else None
        return {
            "fio": account.short_fio,
            "account": account.client_account,
            "amount": str(account.balance_out) if account.balance_out is not None else "",
            "address": account.account_address,
            "debt_group": "" if group is None else str(group),
            "group_name": scale.name if scale else "",
        }


def template_for_account(account, channel: str) -> MessageTemplate | None:
    """Каркас под группу долга ЛС: сначала шаблон схемы, иначе центральный."""
    group = account.effective_group if account is not None else None
    if not group:
        return None
    found = MessageTemplate.objects.filter(is_active=True, channel=channel, debt_group=group)
    local = found.filter(organization_id=account.organization_id).first()
    return local or found.filter(organization__isnull=True).first()


class NotificationDispatcher:
    def __init__(self, client: GatewayClient | None = None, resolver: RecipientResolver | None = None):
        self.client = client or get_gateway_client()
        self.resolver = resolver or RecipientResolver()

    def build_payload(self, notification: Notification) -> dict:
        name, address = self.resolver.resolve(notification)
        template = notification.template
        context = {**self.resolver.account_context(notification), **(notification.context or {})}
        # _fail=true в контексте — имитация отказа канала в шлюзе (проверка обработки ошибок)
        simulate_failure = bool(context.pop("_fail", False))
        return {
            "notification_id": notification.pk,
            "channel": notification.channel,
            "user_name": name,
            "recipient": address,
            "subject": template.subject if template else "",
            "template_body": template.body if template else notification.body,
            "context": context,
            "callback_url": f"{settings.BACKEND_PUBLIC_URL}/api/v1/notifications/{notification.pk}/delivery-status/",
            "meta": {"fail": simulate_failure},
        }

    def dispatch(self, notification: Notification) -> Notification:
        payload = self.build_payload(notification)
        notification.recipient_name, notification.recipient_address = payload["user_name"], payload["recipient"]
        notification.request_id = get_request_id()
        try:
            # Асинхронный вызов шлюза (httpx.AsyncClient) из синхронной вьюхи DRF
            accepted = async_to_sync(self.client.send_notification)(payload)
        except GatewayUnavailable as exc:
            notification.status = Notification.Status.FAILED
            notification.error = str(exc.detail)
            record_error(exc, path=f"notification:{notification.pk}")
        else:
            notification.status = Notification.Status.QUEUED
            notification.gateway_id = accepted.id
            notification.error = ""
        notification.save()
        return notification

    def preview(self, template_body: str, user_name: str, context: dict, channel: str) -> str:
        payload = {"channel": channel, "user_name": user_name, "template_body": template_body, "context": context}
        return async_to_sync(self.client.preview)(payload)


def apply_delivery_status(notification: Notification, status: str, *, error: str = "", text: str = "") -> Notification:
    """Callback шлюза: итог доставки."""
    if status == "delivered":
        notification.status = Notification.Status.SENT
        notification.sent_at = timezone.now()
        notification.error = ""
    else:
        notification.status = Notification.Status.FAILED
        notification.error = error or "Ошибка доставки"
    if text:
        notification.rendered_text = text
    notification.save(update_fields=["status", "sent_at", "error", "rendered_text", "updated_at"])
    logger.info("Статус оповещения %s: %s", notification.pk, notification.status)
    return notification
