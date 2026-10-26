"""Дополнительное мероприятие из справочника и приостановка шага с основанием."""

from __future__ import annotations

from datetime import datetime

from django.utils import timezone

from apps.debts.models import Account, AccountService, Measure, MeasureItem, StatusHistory
from apps.debts.services.registration_flags import DEATH_REASON
from apps.users.scoping import AccessScope


class ExtraMeasureError(Exception):
    def __init__(self, detail):
        self.detail = detail


def add_extra(user, payload: dict) -> Measure:
    from apps.nsi.models import ExtraMeasureCatalog

    catalog = ExtraMeasureCatalog.objects.filter(pk=payload.get("catalog_id"), is_active=True).first()
    if catalog is None:
        raise ExtraMeasureError({"catalog_id": "Выберите дополнительное мероприятие"})
    try:
        ids = [int(item) for item in (payload.get("account_ids") or [])]
    except (TypeError, ValueError):
        raise ExtraMeasureError({"account_ids": "Укажите лицевые счета"}) from None
    if not ids:
        raise ExtraMeasureError({"account_ids": "Укажите лицевые счета"})
    scope = AccessScope(user)
    accounts = list(scope.apply(
        Account.objects.filter(pk__in=ids), "organization", "provider_id",
    ).distinct())
    if {row.pk for row in accounts} != set(ids):
        raise ExtraMeasureError({"account_ids": "Лицевой счёт не найден"})
    if len({row.organization_id for row in accounts}) != 1:
        raise ExtraMeasureError({"account_ids": "Счета разных схем в одну партию не собираются"})
    service = _service(scope, payload.get("service_id"), accounts)
    if getattr(user, "contour", "") == "supplier" and service is None:
        raise ExtraMeasureError({"service_id": "Поставщик добавляет мероприятие по своей услуге"})
    supplier = getattr(user, "contour", "") == "supplier" and service is not None
    org = accounts[0].organization
    measure = Measure.objects.create(
        organization=org,
        kind=Measure.Kind.EXTRA,
        status=Measure.Status.ASSIGNED,
        extra=True,
        template_name=catalog.name,
        note=catalog.note,
        created_by=user if getattr(user, "is_authenticated", False) else None,
        owner_provider_id=service.provider_id if supplier else None,
        owner_name=(service.shot_name or service.full_name) if supplier else "",
    )
    measure.accounts.add(*accounts)
    if service is not None:
        measure.services.add(service)
    for account in accounts:
        MeasureItem.objects.create(organization=org, measure=measure, account=account)
        StatusHistory.objects.create(
            organization=org, account=account, service=service,
            kind=StatusHistory.Kind.MEASURE, old_value="", new_value=catalog.name,
            reason="Дополнительное мероприятие", author=user if getattr(user, "is_authenticated", False) else None,
        )
    return measure


def hold_measure(measure: Measure, user, until, reason: str) -> Measure:
    if measure.status in {Measure.Status.DONE, Measure.Status.CANCELLED, Measure.Status.FAILED}:
        raise ExtraMeasureError({"status": "Мероприятие уже закрыто"})
    text = str(reason or "").strip()
    if not text:
        raise ExtraMeasureError({"reason": "Укажите основание"})
    measure.status = Measure.Status.PAUSED
    measure.stopped = True
    measure.pause_until = _day(until)
    measure.pause_reason = text
    measure.save(update_fields=["status", "stopped", "pause_until", "pause_reason", "updated_at"])
    _log(measure, user, "assigned", "paused", text)
    return measure


def release_measure(measure: Measure, user) -> Measure:
    if measure.status != Measure.Status.PAUSED:
        return measure
    measure.status = Measure.Status.ASSIGNED
    measure.stopped = False
    measure.pause_until = None
    measure.pause_reason = ""
    measure.save(update_fields=["status", "stopped", "pause_until", "pause_reason", "updated_at"])
    _log(measure, user, "paused", "assigned", "Возобновлено")
    return measure


def release_expired_holds(account: Account) -> None:
    today = timezone.localdate()
    rows = Measure.objects.filter(
        accounts=account, status=Measure.Status.PAUSED, pause_until__lt=today,
    ).exclude(pause_reason=DEATH_REASON)
    for measure in rows:
        release_measure(measure, None)


def _service(scope: AccessScope, raw, accounts: list[Account]) -> AccountService | None:
    if raw in (None, ""):
        return None
    try:
        service_id = int(raw)
    except (TypeError, ValueError):
        raise ExtraMeasureError({"service_id": "Услуга не найдена"}) from None
    service = scope.apply(
        AccountService.objects.filter(pk=service_id),
        "organization", "account__provider_id", "provider_id",
    ).first()
    if service is None or service.account_id not in {row.pk for row in accounts}:
        raise ExtraMeasureError({"service_id": "Услуга не найдена"})
    return service


def _day(value):
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue
    raise ExtraMeasureError({"until": "Дата периода не читается"})


def _log(measure: Measure, user, old: str, new: str, reason: str) -> None:
    author = user if getattr(user, "is_authenticated", False) else None
    for account in measure.accounts.all():
        StatusHistory.objects.create(
            organization=account.organization, account=account, kind=StatusHistory.Kind.MEASURE,
            old_value=old, new_value=new, reason=reason, author=author,
        )
