"""Приём и доставка оповещений: journal delivery_log → адаптер канала → callback в backend."""

from __future__ import annotations

import logging

from sqlalchemy import select

from ..adapters.base import OutgoingMessage
from ..adapters.registry import AdapterRegistry
from ..core.config import Settings
from ..core.context import request_id_var
from ..core.errors import AdapterError, NotFoundError, report_error
from ..core.singletons import Database, HttpClient
from ..models import DeliveryLog, utcnow
from ..schemas import NotificationIn
from .rendering import MessageRenderer

logger = logging.getLogger(__name__)


class NotificationService:
    def __init__(self, db: Database, registry: AdapterRegistry, http: HttpClient, settings: Settings,
                 renderer: MessageRenderer | None = None):
        self.db = db
        self.registry = registry
        self.http = http
        self.settings = settings
        self.renderer = renderer or MessageRenderer()

    async def accept(self, payload: NotificationIn, request_id: str) -> DeliveryLog:
        self.registry.get(payload.channel)  # неизвестный канал — ошибка сразу, до постановки в работу
        async with self.db.session() as session:
            log = DeliveryLog(
                notification_id=payload.notification_id, channel=payload.channel, recipient=payload.recipient,
                user_name=payload.user_name, subject=payload.subject, request_id=request_id,
                payload=payload.model_dump(),
            )
            session.add(log)
            await session.commit()
            return log

    async def process(self, log_id: str, payload: NotificationIn, request_id: str) -> None:
        """Фоновая доставка (BackgroundTasks): request_id передаётся явно, т.к. ответ уже отправлен."""
        request_id_var.set(request_id)
        text = await self.renderer.render(payload.template_body, payload.context, user_name=payload.user_name)
        adapter = self.registry.get(payload.channel)
        message = OutgoingMessage(payload.channel, payload.recipient, text, payload.subject, payload.meta)
        status, error, provider_id = "delivered", "", ""
        try:
            result = await adapter.send(message)
            provider_id = result.provider_message_id
            if not result.delivered:
                status, error = "failed", result.error or "Не доставлено"
        except AdapterError as exc:
            status, error = "failed", exc.message
            await report_error(exc, path=f"adapter:{payload.channel}")
        except Exception as exc:  # noqa: BLE001 — любая ошибка канала фиксируется, процесс не падает
            status, error = "failed", f"Внутренняя ошибка: {exc}"
            await report_error(exc, path=f"adapter:{payload.channel}")

        async with self.db.session() as session:
            log = await session.get(DeliveryLog, log_id)
            log.text, log.status, log.error = text, status, error
            log.provider_message_id, log.finished_at = provider_id, utcnow()
            await session.commit()
        logger.info("Оповещение %s: %s", payload.notification_id, status, extra={"delivery_id": log_id})
        await self._callback(payload, status, error, text, request_id)

    async def _callback(self, payload: NotificationIn, status: str, error: str, text: str, request_id: str) -> None:
        if not payload.callback_url:
            return
        try:
            response = await self.http.client.post(
                payload.callback_url,
                json={"status": status, "error": error, "rendered_text": text},
                headers={"X-Internal-Token": self.settings.internal_token, "X-Request-ID": request_id},
            )
            response.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Callback в backend не выполнен: %s", exc)

    async def get(self, log_id: str) -> DeliveryLog:
        async with self.db.session() as session:
            log = await session.get(DeliveryLog, log_id)
            if log is None:
                raise NotFoundError("Запись доставки не найдена")
            return log

    async def list_recent(self, limit: int = 50) -> list[DeliveryLog]:
        async with self.db.session() as session:
            rows = await session.execute(select(DeliveryLog).order_by(DeliveryLog.created_at.desc()).limit(limit))
            return list(rows.scalars())
