"""Запуск и ведение мероприятий (ТЗ 4.2.3).

Партия — одна запись Measure. По каждому ЛС — частная MeasureItem со своим статусом.
Asterisk AMI, SMTP и Белпочта на этом этапе не вызываются: результат звонка, ошибка
доставки и статус письма фиксирует пользователь. Задание поставщику кладётся во входящие ПМ.
"""

from __future__ import annotations

import re
from datetime import date, time, timedelta

from django.db.models import Q
from django.utils import timezone

from apps.debts.models import (
    Account,
    AccountService,
    DebtWorkItem,
    Measure,
    MeasureEvent,
    MeasureItem,
    StatusHistory,
)
from apps.debts.services.contacts import choose_phone
from apps.notifications.models import Channel, Notification
from apps.nsi.models import CalculationSettings
from apps.users.models import ServiceOrganization, User
from apps.users.scoping import AccessScope

AUTO_KINDS = {
    Measure.Kind.CALL,
    Measure.Kind.NOTICE,
    Measure.Kind.WARNING,
    Measure.Kind.DISCONNECT,
    Measure.Kind.SCENARIO,
}
# Надпись и приостановление включаются с группы 3 и только по услуге этой группы.
SERVICE_MEASURE_GROUP = 3
ITEM_OPEN = [MeasureItem.Status.ASSIGNED, MeasureItem.Status.RUNNING]
PARTY_OPEN = [Measure.Status.ASSIGNED, Measure.Status.RUNNING, Measure.Status.PAUSED]
NOTICE_CHANNELS = {"email", "sms"}
DISCONNECTABLE = ("вод", "газ", "тепл", "отоп", "электр", "канализац", "гвс", "хвс", "подогрев")
CALL_DONE = {
    MeasureItem.CallResult.ANSWERED: MeasureItem.Status.DONE,
    MeasureItem.CallResult.BAD_NUMBER: MeasureItem.Status.FAILED,
    MeasureItem.CallResult.NO_ANSWER: MeasureItem.Status.RUNNING,
    MeasureItem.CallResult.BUSY: MeasureItem.Status.RUNNING,
}


class MeasureLaunchError(Exception):
    def __init__(self, detail):
        self.detail = detail


def belarus_phone(value: str) -> str:
    """Номер для обзвона. Уже с +375 остаётся как есть, иначе код дописывается в начало."""
    compact = re.sub(r"[\s\-()]", "", (value or "").strip())
    if not compact:
        return ""
    if compact.startswith("+375"):
        return compact
    if compact.startswith("+"):
        return ""
    digits = re.sub(r"\D", "", compact)
    if not digits:
        return ""
    if digits.startswith("375"):
        return f"+{digits}"
    if digits.startswith("80") and len(digits) == 11:
        return f"+375{digits[2:]}"
    return f"+375{digits}"


def is_legal_entity(account: Account) -> bool:
    return bool((account.payer_unp or "").strip()) and not (account.payer_identifier or "").strip()


def is_disconnectable(service: AccountService) -> bool:
    name = (service.service_name or "").casefold()
    return any(key in name for key in DISCONNECTABLE)


def _optional_int(value, field: str) -> int | None:
    if value in (None, ""):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise MeasureLaunchError({field: "Ожидается число"}) from exc
    if number < 1 or number > 6:
        raise MeasureLaunchError({field: "Группа от 1 до 6"})
    return number


def _parse_date(value) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise MeasureLaunchError({"date": "Дата в формате ГГГГ-ММ-ДД"}) from exc


def _parse_time(value, field: str = "time_from") -> time | None:
    if value in (None, ""):
        return None
    if isinstance(value, time):
        return value
    try:
        return time.fromisoformat(str(value))
    except ValueError as exc:
        raise MeasureLaunchError({field: "Время в формате ЧЧ:ММ"}) from exc


def phone_for_call(account: Account, on_date: date | None, at) -> str:
    contact = choose_phone(account, on_date, at)
    raw = contact.value if contact else (account.contact_phone or account.phone or "")
    return belarus_phone(raw)


def email_for(account: Account) -> str:
    contact = account.contacts.filter(kind="email").order_by("-priority", "id").first()
    if contact and "@" in contact.value:
        return contact.value.strip()
    payer = account.registrations.exclude(email="").filter(subj_is_main=True).order_by("id").first()
    if payer is None:
        payer = account.registrations.exclude(email="").order_by("id").first()
    return payer.email.strip() if payer and payer.email else ""


def log_event(measure: Measure, item: MeasureItem | None, user, old: str, new: str, reason: str = "") -> None:
    if old == new and not reason:
        return
    MeasureEvent.objects.create(
        measure=measure, item=item, actor=user, old_status=old, new_status=new, reason=(reason or "")[:500],
    )


def rollup(measure: Measure, *, respect_pause: bool = True) -> None:
    """Статус партии — по частным. Пауза наследства не снимается пересчётом."""
    if respect_pause and measure.status == Measure.Status.PAUSED:
        return
    statuses = list(measure.items.values_list("status", flat=True))
    if not statuses:
        return
    open_status = set(ITEM_OPEN)
    if any(status == MeasureItem.Status.RUNNING for status in statuses) or (
        any(status in open_status for status in statuses) and any(status not in open_status for status in statuses)
    ):
        new = Measure.Status.RUNNING
    elif all(status == MeasureItem.Status.ASSIGNED for status in statuses):
        new = Measure.Status.ASSIGNED
    elif all(status == MeasureItem.Status.CANCELLED for status in statuses):
        new = Measure.Status.CANCELLED
    elif any(status == MeasureItem.Status.FAILED for status in statuses) and all(
        status not in open_status for status in statuses
    ):
        new = Measure.Status.FAILED
    elif all(status in {MeasureItem.Status.DONE, MeasureItem.Status.CANCELLED} for status in statuses):
        new = Measure.Status.DONE
    else:
        new = Measure.Status.RUNNING
    if measure.status != new:
        old = measure.status
        measure.status = new
        measure.save(update_fields=["status", "updated_at"])
        log_event(measure, None, None, old, new, "Пересчёт по частным мероприятиям")
        if new == Measure.Status.DONE and measure.source_scenario_id:
            from apps.nsi.services.scenario_engine import advance_after_measure

            advance_after_measure(measure)


def _skip(account: Account, reason: str) -> dict:
    return {"account_id": account.id, "client_account": account.client_account, "reason": reason}


def _select(kind: str, accounts: list[Account], data, started: date) -> tuple[list[Account], list[dict], dict]:
    """Возвращает допущенные ЛС, причины пропуска и поля частной записи по id ЛС."""
    skipped: list[dict] = []
    extras: dict[int, dict] = {}
    chosen: list[Account] = []
    group_from = _optional_int(data.get("group_from"), "group_from")
    group_to = _optional_int(data.get("group_to"), "group_to")
    if group_from and group_to and group_from > group_to:
        raise MeasureLaunchError({"group_to": "Верхняя группа меньше нижней"})
    if "call_legal" in data and data.get("call_legal") is not None:
        call_legal = bool(data.get("call_legal"))
    elif accounts:
        call_legal = bool(accounts[0].organization.call_legal)
    else:
        call_legal = False
    channel = (data.get("channel") or "").strip()
    at = _parse_time(data.get("time_from"))
    for account in accounts:
        if kind in AUTO_KINDS and account.inheritance_case:
            skipped.append(_skip(account, "Открыто наследственное дело"))
            continue
        if kind == Measure.Kind.CALL:
            # Звонок один на лицевой счёт: частота идёт по старшей группе счёта.
            group = account.effective_group
            if group_from and group_to and (group is None or not group_from <= group <= group_to):
                skipped.append(_skip(account, "Группа задолженности вне отобранного диапазона"))
                continue
            if is_legal_entity(account) and not call_legal:
                skipped.append(_skip(account, "Юридическое лицо: обзвон выключен"))
                continue
            phone = phone_for_call(account, started, at)
            if not phone:
                skipped.append(_skip(account, "Нет номера +375"))
                continue
            extras[account.id] = {"phone": phone}
        elif kind == Measure.Kind.NOTICE:
            if channel == "email":
                recipient = email_for(account)
                if not recipient:
                    skipped.append(_skip(account, "Нет e-mail"))
                    continue
            elif channel == "sms":
                recipient = phone_for_call(account, started, None)
                if not recipient:
                    skipped.append(_skip(account, "Нет номера +375 для SMS"))
                    continue
            else:
                raise MeasureLaunchError({"channel": "Канал уведомления: email или sms"})
            extras[account.id] = {"recipient": recipient}
        chosen.append(account)
    return chosen, skipped, extras


def _latest_warning(account: Account) -> MeasureItem | None:
    return (
        MeasureItem.objects.filter(
            account=account, measure__kind=Measure.Kind.WARNING, status=MeasureItem.Status.DONE,
            delivered_on__isnull=False,
        )
        .order_by("-delivered_on", "-id")
        .first()
    )


def _unpaid(services: list[AccountService], threshold) -> list[AccountService]:
    fresh = []
    for service in services:
        balance = service.balance_out if service.balance_out is not None else 0
        penalty = service.balance_mulct_out if service.balance_mulct_out is not None else 0
        if balance > threshold or penalty > threshold:
            fresh.append(service)
    return fresh


def disconnect_candidates(accounts) -> list[dict]:
    settings = CalculationSettings.load()
    today = timezone.localdate()
    wait = settings.warning_wait_days or 5
    rows = []
    warnings = (
        MeasureItem.objects.filter(
            account__in=accounts, measure__kind=Measure.Kind.WARNING, status=MeasureItem.Status.DONE,
            delivered_on__isnull=False,
        )
        .select_related("account", "measure")
        .prefetch_related("measure__services")
        .order_by("account_id", "-delivered_on")
    )
    seen = set()
    for item in warnings:
        if item.account_id in seen:
            continue
        due = item.delivered_on + timedelta(days=wait)
        if due > today:
            continue
        linked = [service for service in item.measure.services.all() if service.account_id == item.account_id]
        pool = linked or list(item.account.services.all())
        services = _unpaid([
            service for service in pool
            if is_disconnectable(service) and _service_group(service) >= SERVICE_MEASURE_GROUP
        ], settings.close_threshold)
        if not services:
            continue
        busy = MeasureItem.objects.filter(
            account_id=item.account_id, measure__kind=Measure.Kind.DISCONNECT, status__in=ITEM_OPEN,
        ).exists()
        if busy:
            continue
        seen.add(item.account_id)
        rows.append({
            "account_id": item.account_id,
            "client_account": item.account.client_account,
            "debtor_name": item.account.short_fio,
            "warning_item_id": item.id,
            "delivered_on": item.delivered_on.isoformat(),
            "warning_due": due.isoformat(),
            "refused": item.refused,
            "requires_approval": settings.disconnect_requires_approval,
            "services": [{"id": service.id, "name": service.service_name} for service in services],
        })
    return rows


def _service_group(service: AccountService) -> int:
    """Показанная группа услуги. Если пересчёт ещё не записал её — по числу месяцев долга."""
    shown = service.effective_group
    if shown is not None:
        return shown
    from apps.debts.services.grouping import DebtGroupCalculator

    months = service.debt_period if service.debt_period is not None else 0
    return DebtGroupCalculator().group_for_months(months) or 0


def _split_by_service_group(
    services: list[AccountService],
) -> tuple[list[AccountService], list[dict]]:
    kept: list[AccountService] = []
    dropped: list[dict] = []
    for service in services:
        group = _service_group(service)
        if group >= SERVICE_MEASURE_GROUP:
            kept.append(service)
            continue
        dropped.append({
            "id": service.id,
            "account_id": service.account_id,
            "name": service.service_name,
            "group": group,
            "reason": "Группа услуги ниже 3, мера по младшей услуге не запускается",
        })
    return kept, dropped


def _guard_disconnect(accounts: list[Account], services: list[AccountService], override: str) -> tuple[list[Account], list[dict], dict]:
    settings = CalculationSettings.load()
    today = timezone.localdate()
    wait = settings.warning_wait_days or 5
    skipped = []
    extras = {}
    chosen = []
    by_account: dict[int, list[AccountService]] = {}
    for service in services:
        by_account.setdefault(service.account_id, []).append(service)
    for account in accounts:
        own = by_account.get(account.id) or []
        blocked = [service for service in own if not is_disconnectable(service)]
        if blocked:
            names = ", ".join(service.service_name or str(service.id) for service in blocked)
            skipped.append(_skip(account, f"Услугу нельзя отключать за неоплату: {names}"))
            continue
        if not _unpaid(own, settings.close_threshold):
            skipped.append(_skip(account, "По выбранным услугам долг уже погашен"))
            continue
        warning = _latest_warning(account)
        if override:
            extras[account.id] = {"warning_item": warning, "note": override[:500]}
            chosen.append(account)
            continue
        if warning is None:
            skipped.append(_skip(account, "Нет врученного предупреждения или акта"))
            continue
        due = warning.delivered_on + timedelta(days=wait)
        if due > today:
            skipped.append(_skip(account, f"Срок оплаты по предупреждению ещё не истёк ({due:%d.%m.%Y})"))
            continue
        extras[account.id] = {"warning_item": warning}
        chosen.append(account)
    return chosen, skipped, extras


def _notify_users(measure: Measure, users, text: str) -> None:
    now = timezone.now()
    for user in users:
        Notification.objects.create(
            organization=measure.organization,
            channel=Channel.INBOX,
            recipient_user=user,
            body=text[:2000],
            status=Notification.Status.SENT,
            recipient_name=user.display_name,
            sent_at=now,
        )


def supplier_users(measure: Measure):
    provider_ids = [value for value in measure.services.values_list("provider_id", flat=True) if value]
    if not provider_ids:
        return User.objects.none()
    return User.objects.filter(
        organization=measure.organization, contour=User.Contour.SUPPLIER, is_active=True,
        service_organizations__provider_id__in=provider_ids,
    ).distinct()


def _notify_disconnect(measure: Measure) -> None:
    _notify_users(
        measure, supplier_users(measure),
        f"Задание на отключение услуг, мероприятие #{measure.id}. Откройте реестр мероприятий.",
    )


def _work(account: Account, kind: str, title: str, started, ended=None, note: str = "") -> None:
    row, _created = DebtWorkItem.objects.get_or_create(
        account=account, kind=kind, title=title,
        defaults={
            "organization": account.organization, "started_on": started, "ended_on": ended,
            "note": note[:500], "principal": account.balance_out,
        },
    )
    if not _created:
        row.started_on = started or row.started_on
        row.ended_on = ended
        row.note = note[:500]
        row.save(update_fields=["started_on", "ended_on", "note", "updated_at"])


def _measure_owner(user, services: list[AccountService]) -> tuple[int | None, str]:
    """Мероприятие поставщика принадлежит одному поставщику и не затирает такое же у другого."""
    if getattr(user, "contour", "") != "supplier":
        return None, ""
    bound = set(AccessScope(user).provider_ids())
    picked = {service.provider_id for service in services if service.provider_id is not None}
    if not picked:
        picked = bound
    if len(picked) != 1 or not picked <= bound:
        raise MeasureLaunchError({"service_ids": "В одной партии услуги одного своего поставщика"})
    provider_id = next(iter(picked))
    name = ServiceOrganization.objects.filter(
        organization_id=getattr(user, "organization_id", None), provider_id=provider_id,
    ).values_list("short_name", flat=True).first()
    if not name:
        name = next(
            (service.shot_name for service in services if service.provider_id == provider_id and service.shot_name),
            "",
        )
    return provider_id, name or ""


def collection_executor(account: Account):
    """Исполнитель взыскания: закреплённый специалист счёта, иначе специалист начисляющей организации.

    Автообзвон исполнителя не требует. Поставщик и наблюдатель взыскание не ведут.
    Ручной запуск по-прежнему требует выбрать человека в форме.
    """
    pinned = account.assigned_to
    if pinned is not None and _leads_collection(pinned, account):
        return pinned
    return (
        User.objects.filter(
            organization_id=account.organization_id, is_active=True,
            contour=User.Contour.BILLING, role=User.Role.SPECIALIST,
        )
        .order_by("id")
        .first()
    )


def _leads_collection(user, account: Account) -> bool:
    return bool(
        user.is_active
        and user.organization_id == account.organization_id
        and user.contour == User.Contour.BILLING
        and user.role == User.Role.SPECIALIST
    )


def launch_measure(user, accounts: list[Account], services: list[AccountService], data) -> dict:
    kind = data.get("kind")
    if kind not in Measure.Kind.values:
        raise MeasureLaunchError({"kind": "Неизвестный вид мероприятия"})
    if not accounts:
        raise MeasureLaunchError({"accounts": "Не выбраны лицевые счета"})
    org_ids = {account.organization_id for account in accounts}
    if len(org_ids) > 1:
        raise MeasureLaunchError({"accounts": "В одной партии только лицевые счета одной схемы"})
    for account in accounts:
        from apps.debts.services.portfolio import release_expired_inheritance

        if release_expired_inheritance(account):
            account.refresh_from_db()
    started = _parse_date(data.get("started_on")) or timezone.localdate()
    days = data.get("days") or None
    due = _parse_date(data.get("due_on"))
    if due is None:
        due = started + timedelta(days=int(days)) if days else started
    template = (data.get("template_name") or "").strip()
    if kind in {Measure.Kind.CALL, Measure.Kind.NOTICE, Measure.Kind.WARNING} and not template:
        raise MeasureLaunchError({"template_name": "Выберите шаблон"})
    if kind == Measure.Kind.CALL and not (data.get("time_from") and data.get("time_to")):
        raise MeasureLaunchError({"time_from": "Укажите время с и по"})
    if kind == Measure.Kind.NOTICE and not data.get("channel"):
        raise MeasureLaunchError({"channel": "Выберите канал"})
    if kind == Measure.Kind.NOTICE and data.get("channel") not in NOTICE_CHANNELS:
        raise MeasureLaunchError({"channel": "Канал уведомления: email или sms. Мессенджеры на этом этапе не подключаются"})
    if kind in Measure.SERVICE_REQUIRED and not services:
        raise MeasureLaunchError({"service_ids": "Выберите услуги для отключения или взыскания"})
    if getattr(user, "contour", "") == "supplier" and kind in {
        Measure.Kind.CALL, Measure.Kind.NOTICE, Measure.Kind.WARNING,
        Measure.Kind.DISCONNECT, Measure.Kind.COLLECTION,
    } and not services:
        raise MeasureLaunchError({"service_ids": "Выберите услуги своего поставщика"})
    if kind == Measure.Kind.SCENARIO:
        name = (data.get("scenario_name") or "").strip()
        if not name:
            raise MeasureLaunchError({"scenario_name": "Укажите сценарий"})
        if not data.get("started_on"):
            raise MeasureLaunchError({"started_on": "Укажите дату начала"})
    if kind == Measure.Kind.COLLECTION and not data.get("assignee") and not data.get("allow_unassigned"):
        raise MeasureLaunchError({"assignee": "Назначьте исполнителя"})
    override = (data.get("override_reason") or "").strip()
    extras: dict[int, dict] = {}
    skipped: list[dict] = []
    dropped: list[dict] = []
    if kind in {Measure.Kind.DISCONNECT, Measure.Kind.COLLECTION}:
        services, dropped = _split_by_service_group(services)
        kept_accounts = {service.account_id for service in services}
        for account in accounts:
            if account.id not in kept_accounts:
                skipped.append(_skip(account, "Группа услуги ниже 3, мера по младшей услуге не запускается"))
        accounts = [account for account in accounts if account.id in kept_accounts]
    if kind == Measure.Kind.DISCONNECT:
        if accounts:
            admitted, guard_skipped, extras = _guard_disconnect(accounts, services, override)
            accounts = admitted
            skipped.extend(guard_skipped)
    elif kind in {Measure.Kind.CALL, Measure.Kind.NOTICE, Measure.Kind.WARNING}:
        accounts, selected_skipped, extras = _select(kind, accounts, data, started)
        skipped.extend(selected_skipped)
    else:
        inheritance = [account for account in accounts if kind in AUTO_KINDS and account.inheritance_case]
        skipped.extend(_skip(account, "Открыто наследственное дело") for account in inheritance)
        accounts = [account for account in accounts if account not in inheritance]
    if not accounts:
        if skipped and all(row["reason"] == "Открыто наследственное дело" for row in skipped):
            raise MeasureLaunchError({"accounts": "По всем выбранным ЛС открыто наследственное дело", "skipped": skipped})
        raise MeasureLaunchError({"accounts": "Ни один лицевой счёт не прошёл отбор", "skipped": skipped})
    owner_id, owner_name = _measure_owner(user, services)
    if owner_id and not services:
        services = list(AccountService.objects.filter(account__in=accounts, provider_id=owner_id))
    assignee = None
    if data.get("assignee"):
        assignee = User.objects.filter(pk=data.get("assignee")).first()
        if assignee is None:
            raise MeasureLaunchError({"assignee": "Исполнитель не найден"})
    settings = CalculationSettings.load()
    needs_approval = kind == Measure.Kind.DISCONNECT and (
        settings.disconnect_requires_approval or bool(data.get("needs_approval"))
    )
    measure = Measure.objects.create(
        organization=accounts[0].organization, kind=kind, channel=data.get("channel") or "",
        template_name=template, scenario_name=data.get("scenario_name") or "",
        note=override or (data.get("note") or ""), assignee=assignee,
        started_on=started, due_on=due, days=int(days) if days else None,
        time_from=_parse_time(data.get("time_from")), time_to=_parse_time(data.get("time_to"), "time_to"),
        created_by=user if getattr(user, "is_authenticated", False) else None,
        call_legal=bool(data.get("call_legal")),
        group_from=_optional_int(data.get("group_from"), "group_from"),
        group_to=_optional_int(data.get("group_to"), "group_to"),
        needs_approval=needs_approval,
        approval=MeasureApproval.PENDING if needs_approval else "",
        owner_provider_id=owner_id,
        owner_name=owner_name,
    )
    measure.accounts.set(accounts)
    if services:
        measure.services.set(services)
    if kind == Measure.Kind.SCENARIO:
        account_ids = [account.id for account in accounts]
        if owner_id:
            AccountService.objects.filter(account_id__in=account_ids, provider_id=owner_id).update(
                scenario_name=measure.scenario_name, scenario_locked=True, updated_at=timezone.now(),
            )
        else:
            Account.objects.filter(pk__in=account_ids).update(
                scenario_name=measure.scenario_name, scenario_locked=True,
            )
    status = MeasureItem.Status.DONE if kind == Measure.Kind.SCENARIO else MeasureItem.Status.ASSIGNED
    MeasureItem.objects.bulk_create([
        MeasureItem(
            organization=measure.organization, measure=measure, account=account, status=status,
            phone=extras.get(account.id, {}).get("phone", ""),
            recipient=extras.get(account.id, {}).get("recipient", ""),
            warning_item=extras.get(account.id, {}).get("warning_item"),
            note=extras.get(account.id, {}).get("note", ""),
        )
        for account in accounts
    ])
    if kind == Measure.Kind.CALL:
        from apps.debts.services.artifacts import attach_call_file

        attach_call_file(measure, accounts)
    if kind == Measure.Kind.WARNING:
        from apps.debts.services.artifacts import attach_warning_pdf

        attach_warning_pdf(measure, accounts)
        for account in accounts:
            _work(account, DebtWorkItem.Kind.WARNING, f"Предупреждение #{measure.id}", started)
    if kind == Measure.Kind.COLLECTION:
        from apps.debts.models import MeasureTask

        MeasureTask.objects.create(
            organization=measure.organization, measure=measure, assignee=assignee,
            title=data.get("note") or "Подготовить взыскание", due_on=due,
        )
    if kind == Measure.Kind.DISCONNECT and needs_approval:
        admins = User.objects.filter(
            organization=measure.organization, role__in=[User.Role.LOCAL_ADMIN, User.Role.SUPERADMIN], is_active=True,
        )
        _notify_users(measure, admins, f"Список на отключение #{measure.id} ждёт согласования.")
    elif kind == Measure.Kind.DISCONNECT:
        _notify_disconnect(measure)
    rollup(measure)
    inheritance_ids = [row["account_id"] for row in skipped if row["reason"] == "Открыто наследственное дело"]
    return {
        "measure": measure,
        "skipped": skipped,
        "skipped_inheritance": inheritance_ids,
        "dropped_services": dropped,
        "service_ids": [service.id for service in services],
    }


class MeasureApproval:
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


def _visible_item(measure: Measure, item_id: int, accounts) -> MeasureItem:
    item = measure.items.filter(pk=item_id, account__in=accounts).first()
    if item is None:
        raise MeasureLaunchError({"item_id": "Частное мероприятие не найдено"})
    return item


def record_item(measure: Measure, item: MeasureItem, user, data) -> MeasureItem:
    if item.account.inheritance_case and measure.kind in AUTO_KINDS and data.get("status") != "cancelled":
        raise MeasureLaunchError({"accounts": "По ЛС открыто наследственное дело"})
    old = item.status
    reason = (data.get("reason") or data.get("note") or "").strip()
    if data.get("status") == MeasureItem.Status.CANCELLED:
        if not reason:
            raise MeasureLaunchError({"reason": "Укажите причину прерывания"})
        if measure.kind == Measure.Kind.DISCONNECT and (item.suspended_on or measure.suspension_confirmed_on):
            raise MeasureLaunchError({"status": "Услуга уже приостановлена, задание нельзя отменить"})
        item.status = MeasureItem.Status.CANCELLED
        item.note = reason[:500]
    elif measure.kind == Measure.Kind.CALL and data.get("call_result"):
        result = data.get("call_result")
        if result not in CALL_DONE:
            raise MeasureLaunchError({"call_result": "Результат: answered, no_answer, busy или bad_number"})
        if data.get("listen_percent") not in (None, ""):
            percent = int(data.get("listen_percent"))
            if percent < 0 or percent > 100:
                raise MeasureLaunchError({"listen_percent": "Доля от 0 до 100"})
            item.listen_percent = percent
        if data.get("duration_sec") not in (None, ""):
            item.duration_sec = int(data.get("duration_sec"))
        item.call_result = result
        item.status = CALL_DONE[result]
        item.note = reason[:500]
    elif data.get("status") in {MeasureItem.Status.DONE, MeasureItem.Status.FAILED}:
        item.status = data["status"]
        item.note = reason[:500]
        if item.status == MeasureItem.Status.FAILED:
            item.delivery_error = reason[:500]
    else:
        raise MeasureLaunchError({"status": "Укажите результат"})
    item.acted_by = user
    item.acted_at = timezone.now()
    item.save()
    log_event(measure, item, user, old, item.status, reason or item.get_call_result_display())
    rollup(measure)
    return item


def deliver_warnings(measure: Measure, items, user, data) -> int:
    if measure.kind != Measure.Kind.WARNING:
        raise MeasureLaunchError({"kind": "Вручение относится к предупреждению"})
    method = data.get("delivery_method") or ""
    labels = dict(MeasureItem.DeliveryMethod.choices)
    if method not in labels:
        raise MeasureLaunchError({"delivery_method": "Способ: personal, registered или administration"})
    delivered_on = _parse_date(data.get("delivered_on"))
    if delivered_on is None:
        raise MeasureLaunchError({"delivered_on": "Укажите дату вручения или акта"})
    refused = bool(data.get("refused"))
    recipient_name = (data.get("recipient_name") or "").strip()
    reason = (data.get("reason") or "").strip()
    if method == MeasureItem.DeliveryMethod.PERSONAL and not refused and not recipient_name:
        raise MeasureLaunchError({"recipient_name": "Укажите ФИО получившего"})
    if refused and not reason:
        raise MeasureLaunchError({"reason": "Опишите акт об отказе или невручении"})
    wait = CalculationSettings.load().warning_wait_days or 5
    due = delivered_on + timedelta(days=wait)
    count = 0
    for item in items:
        if item.status not in ITEM_OPEN and item.status != MeasureItem.Status.ASSIGNED:
            continue
        if item.status == MeasureItem.Status.DONE:
            continue
        old = item.status
        item.delivery_method = method
        item.delivered_on = delivered_on
        item.recipient_name = recipient_name
        item.refused = refused
        item.postal_id = (data.get("postal_id") or "")[:50]
        item.postal_status = (data.get("postal_status") or ("возврат" if refused else "вручено"))[:50]
        item.status = MeasureItem.Status.DONE
        item.note = reason[:500]
        item.acted_by = user
        item.acted_at = timezone.now()
        item.save()
        account = item.account
        if account.warning_due is None or account.warning_due != due:
            account.warning_due = due
            account.save(update_fields=["warning_due", "updated_at"])
        note = labels[method]
        if refused:
            note = f"Акт: {reason}"
        elif recipient_name:
            note = f"{note}, получил {recipient_name}"
        _work(account, DebtWorkItem.Kind.WARNING, f"Предупреждение #{measure.id}", delivered_on, delivered_on, note)
        log_event(measure, item, user, old, item.status, note)
        count += 1
    rollup(measure)
    if not count:
        raise MeasureLaunchError({"item_ids": "Нет предупреждений, которым можно проставить вручение"})
    return count


def apply_confirmation(measure: Measure, step: str, source: str, user) -> Measure:
    if measure.kind != Measure.Kind.DISCONNECT:
        raise MeasureLaunchError({"kind": "Подтверждение относится к приостановлению услуги"})
    if measure.status == Measure.Status.CANCELLED:
        raise MeasureLaunchError({"status": "Задание отменено"})
    if measure.needs_approval and measure.approval != MeasureApproval.APPROVED:
        raise MeasureLaunchError({"approval": "Сначала согласуйте отключение"})
    if source not in {"pm", "ais"}:
        raise MeasureLaunchError({"source": "Источник: pm или ais"})
    today = timezone.localdate()
    if step == "suspend":
        measure.suspension_confirmed_on = today
        measure.suspension_source = source
        measure.status = Measure.Status.RUNNING
        measure.items.exclude(status=MeasureItem.Status.CANCELLED).update(
            status=MeasureItem.Status.RUNNING, suspended_on=today, acted_at=timezone.now(), updated_at=timezone.now(),
        )
        for item in measure.items.exclude(status=MeasureItem.Status.CANCELLED):
            _work(
                item.account, DebtWorkItem.Kind.DISCONNECT, f"Отключение #{measure.id}",
                today, None, "Услуга приостановлена",
            )
            _move_funnel(item.account, user)
            log_event(measure, item, user, MeasureItem.Status.ASSIGNED, MeasureItem.Status.RUNNING, "Приостановление")
    elif step == "resume":
        measure.resumed_on = today
        measure.resume_source = source
        measure.status = Measure.Status.DONE
        measure.items.exclude(status=MeasureItem.Status.CANCELLED).update(
            status=MeasureItem.Status.DONE, resumed_on=today, acted_at=timezone.now(), updated_at=timezone.now(),
        )
        for item in measure.items.exclude(status=MeasureItem.Status.CANCELLED):
            _work(
                item.account, DebtWorkItem.Kind.DISCONNECT, f"Отключение #{measure.id}",
                item.suspended_on or today, today, "Услуга возобновлена",
            )
            log_event(measure, item, user, MeasureItem.Status.RUNNING, MeasureItem.Status.DONE, "Возобновление")
    else:
        raise MeasureLaunchError({"action": "suspend или resume"})
    measure.save()
    return measure


def _move_funnel(account: Account, user) -> None:
    if account.funnel_locked or account.funnel_stage == "disconnect":
        return
    old = account.funnel_stage
    account.funnel_stage = "disconnect"
    account.save(update_fields=["funnel_stage", "updated_at"])
    StatusHistory.objects.create(
        organization=account.organization, account=account, kind=StatusHistory.Kind.FUNNEL,
        old_value=old, new_value="disconnect", reason="Принято отключение услуги", author=user,
    )


def accept_disconnect(measure: Measure, user) -> Measure:
    if measure.kind != Measure.Kind.DISCONNECT:
        raise MeasureLaunchError({"kind": "Принятие относится к отключению"})
    if getattr(user, "contour", "") != User.Contour.SUPPLIER:
        raise MeasureLaunchError({"contour": "Задание принимает специалист поставщика"})
    if measure.needs_approval and measure.approval != MeasureApproval.APPROVED:
        raise MeasureLaunchError({"approval": "Сначала согласуйте отключение"})
    if measure.suspension_confirmed_on:
        raise MeasureLaunchError({"status": "Отключение уже отмечено"})
    if measure.status == Measure.Status.CANCELLED:
        raise MeasureLaunchError({"status": "Задание отменено"})
    old = measure.status
    measure.status = Measure.Status.RUNNING
    measure.assignee = user
    measure.save(update_fields=["status", "assignee", "updated_at"])
    measure.items.filter(status=MeasureItem.Status.ASSIGNED).update(
        status=MeasureItem.Status.RUNNING, updated_at=timezone.now(),
    )
    for item in measure.items.filter(status=MeasureItem.Status.RUNNING):
        _move_funnel(item.account, user)
    log_event(measure, None, user, old, measure.status, "Поставщик принял задание")
    return measure


def decide_approval(measure: Measure, user, approved: bool, note: str) -> Measure:
    if measure.kind != Measure.Kind.DISCONNECT or not measure.needs_approval:
        raise MeasureLaunchError({"approval": "Это отключение не ждёт согласования"})
    if measure.approval != MeasureApproval.PENDING:
        raise MeasureLaunchError({"approval": "Решение уже принято"})
    if user.role not in {User.Role.LOCAL_ADMIN, User.Role.SUPERADMIN} and not user.is_superadmin:
        raise MeasureLaunchError({"approval": "Согласует локальный администратор"})
    text = (note or "").strip()
    if not approved and not text:
        raise MeasureLaunchError({"note": "Укажите причину отказа"})
    measure.approval = MeasureApproval.APPROVED if approved else MeasureApproval.REJECTED
    measure.approval_note = text[:500]
    if approved:
        measure.save(update_fields=["approval", "approval_note", "updated_at"])
        _notify_disconnect(measure)
        if measure.created_by_id:
            _notify_users(measure, [measure.created_by], f"Отключение #{measure.id} согласовано.")
        log_event(measure, None, user, Measure.Status.ASSIGNED, measure.status, text or "Согласовано")
    else:
        old = measure.status
        measure.status = Measure.Status.CANCELLED
        measure.save(update_fields=["approval", "approval_note", "status", "updated_at"])
        measure.items.exclude(status=MeasureItem.Status.DONE).update(
            status=MeasureItem.Status.CANCELLED, note=text[:500], updated_at=timezone.now(),
        )
        log_event(measure, None, user, old, measure.status, text)
        if measure.created_by_id:
            _notify_users(measure, [measure.created_by], f"Отключение #{measure.id} не согласовано: {text}")
    return measure


def cancel_disconnect(measure: Measure, user, reason: str) -> Measure:
    if measure.kind != Measure.Kind.DISCONNECT:
        raise MeasureLaunchError({"kind": "Отмена относится к отключению"})
    text = (reason or "").strip()
    if not text:
        raise MeasureLaunchError({"reason": "Укажите причину отмены"})
    if measure.suspension_confirmed_on or measure.items.filter(suspended_on__isnull=False).exists():
        raise MeasureLaunchError({"status": "Поставщик уже приостановил услугу, отменить задание нельзя"})
    old = measure.status
    measure.status = Measure.Status.CANCELLED
    measure.note = text[:500]
    measure.save(update_fields=["status", "note", "updated_at"])
    measure.items.exclude(status__in=[MeasureItem.Status.DONE, MeasureItem.Status.CANCELLED]).update(
        status=MeasureItem.Status.CANCELLED, note=text[:500], acted_by=user, acted_at=timezone.now(),
        updated_at=timezone.now(),
    )
    log_event(measure, None, user, old, measure.status, text)
    _notify_users(measure, supplier_users(measure), f"Задание на отключение #{measure.id} отменено: {text}")
    return measure


def sync_notice_status(notification_id: int, delivered: bool, error: str = "") -> None:
    item = MeasureItem.objects.filter(notification_id=notification_id).select_related("measure").first()
    if item is None or item.measure.kind != Measure.Kind.NOTICE:
        return
    old = item.status
    if delivered:
        item.status = MeasureItem.Status.DONE
        item.delivery_error = ""
    else:
        item.status = MeasureItem.Status.FAILED
        item.delivery_error = (error or "Ошибка доставки")[:500]
    item.acted_at = timezone.now()
    item.save(update_fields=["status", "delivery_error", "acted_at", "updated_at"])
    log_event(item.measure, item, None, old, item.status, item.delivery_error or "Доставлено")
    rollup(item.measure)


def queue_notices(measure: Measure, items, user) -> int:
    """Ставит письма и SMS в оповещения. Шлюз может быть заглушкой: ошибка видна в частном мероприятии."""
    if measure.kind != Measure.Kind.NOTICE:
        raise MeasureLaunchError({"kind": "Отправка относится к уведомлению"})
    from apps.notifications.services.dispatcher import NotificationDispatcher

    dispatcher = NotificationDispatcher()
    count = 0
    channel = Channel.EMAIL if measure.channel == "email" else Channel.SMS
    for item in items:
        if item.status == MeasureItem.Status.DONE:
            continue
        notification = Notification.objects.create(
            organization=measure.organization, channel=channel, account=item.account,
            body=measure.template_name, recipient_address=item.recipient, status=Notification.Status.NEW,
        )
        notification = dispatcher.dispatch(notification)
        item.notification_id = notification.id
        old = item.status
        if notification.status == Notification.Status.FAILED:
            item.status = MeasureItem.Status.FAILED
            item.delivery_error = (notification.error or "Ошибка доставки")[:500]
        else:
            item.status = MeasureItem.Status.RUNNING
            item.delivery_error = ""
        item.acted_by = user
        item.acted_at = timezone.now()
        item.save()
        log_event(measure, item, user, old, item.status, item.delivery_error)
        count += 1
    rollup(measure)
    if not count:
        raise MeasureLaunchError({"item_ids": "Нет уведомлений для отправки"})
    return count


def close_paid_measures(account: Account, service: AccountService | None) -> None:
    """Гасит открытые меры по погашенной услуге. Уже приостановленное отключение не снимает."""
    qs = Measure.objects.filter(accounts=account, status__in=PARTY_OPEN)
    if service is not None:
        qs = qs.filter(services=service)
    now = timezone.now()
    for measure in qs.distinct():
        if measure.kind == Measure.Kind.DISCONNECT and (
            measure.suspension_confirmed_on or measure.items.filter(account=account, suspended_on__isnull=False).exists()
        ):
            continue
        measure.items.filter(account=account, status__in=ITEM_OPEN).update(
            status=MeasureItem.Status.CANCELLED, note="Долг погашен", updated_at=now,
        )
        if measure.items.filter(status__in=ITEM_OPEN).exists():
            rollup(measure, respect_pause=False)
            continue
        if measure.items.exists():
            rollup(measure, respect_pause=False)
        elif measure.status != Measure.Status.CANCELLED:
            old = measure.status
            measure.status = Measure.Status.CANCELLED
            measure.save(update_fields=["status", "updated_at"])
            log_event(measure, None, None, old, measure.status, "Долг погашен")


def note_disconnected_but_paid(account: Account) -> None:
    """Долг погашен, а приостановление уже зафиксировано — отдельное задание проверить возобновление."""
    settings = CalculationSettings.load()
    threshold = settings.close_threshold or 0
    items = MeasureItem.objects.filter(
        account=account, measure__kind=Measure.Kind.DISCONNECT, suspended_on__isnull=False, resumed_on__isnull=True,
    ).exclude(status=MeasureItem.Status.CANCELLED).select_related("measure")
    recipient = account.assigned_to
    for item in items:
        still = item.measure.services.filter(account=account).filter(
            Q(balance_out__gt=threshold) | Q(balance_mulct_out__gt=threshold)
        )
        if still.exists():
            continue
        marker = f"Проверить возобновление #{item.measure_id}"
        if Notification.objects.filter(account=account, body__startswith=marker).exists():
            continue
        user = recipient or item.measure.created_by
        if user is None:
            continue
        Notification.objects.create(
            organization=account.organization, channel=Channel.INBOX, recipient_user=user, account=account,
            body=f"{marker}: долг погашен, услуга ещё числится приостановленной.",
            status=Notification.Status.SENT, recipient_name=user.display_name, sent_at=timezone.now(),
        )
