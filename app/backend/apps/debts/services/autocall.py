"""Прогон автообзвона: отбор в окне сценария и запись ответа адаптера в частную строку.

Заглушка AMI и будущий клиент Asterisk возвращают один и тот же набор полей.
Сценарий, реестр и карточка от подмены адаптера не зависят.
"""

from __future__ import annotations

from datetime import date, datetime, time

from asgiref.sync import async_to_sync
from django.db import transaction
from django.utils import timezone

from apps.core.exceptions import GatewayUnavailable
from apps.debts.models import Account, Measure, MeasureItem
from apps.debts.services.contacts import choose_phone
from apps.debts.services.measures import (
    belarus_phone,
    is_legal_entity,
    phone_for_call,
    write_call_result,
)
from apps.notifications.services.gateway_client import get_gateway_client
from apps.users.models import Organization

WEEKDAY_FROM = time(18, 0)
WEEKDAY_TO = time(21, 0)
WEEKEND_FROM = time(10, 0)
WEEKEND_TO = time(22, 0)
START_DAY = 27
OPEN_PARTY = [Measure.Status.ASSIGNED, Measure.Status.RUNNING]
OPEN_ITEM = [MeasureItem.Status.ASSIGNED, MeasureItem.Status.RUNNING]


def call_window(scenario, on_date: date) -> tuple[time, time]:
    """Окно сценария на эту дату: вечер будней или дневное окно выходных."""
    weekend = on_date.weekday() >= 5
    if scenario is None:
        return (WEEKEND_FROM, WEEKEND_TO) if weekend else (WEEKDAY_FROM, WEEKDAY_TO)
    if weekend:
        return scenario.weekend_from or WEEKEND_FROM, scenario.weekend_to or WEEKEND_TO
    return scenario.weekday_from or WEEKDAY_FROM, scenario.weekday_to or WEEKDAY_TO


def dial_due_calls(at: datetime | None = None) -> dict:
    """Прозванивает открытые партии, чьё окно содержит этот момент.

    До дня старта сценария и вне окна строки не трогает. Утром в реестре
    остаются результаты вечернего прогона.
    """
    moment = _local(at)
    dialed = 0
    open_parties = 0
    in_window = 0
    parties = (
        Measure.objects.filter(kind=Measure.Kind.CALL, status__in=OPEN_PARTY)
        .select_related("source_scenario", "organization")
        .order_by("id")
    )
    for measure in parties:
        open_parties += 1
        if not _campaign_open(measure, moment):
            continue
        in_window += 1
        start = _sync_window(measure, moment)
        dialed += _dial_measure(measure, moment, start)
    return {"dialed": dialed, "open_parties": open_parties, "in_window": in_window}


def conduct_call_measure(measure: Measure, at: datetime | None = None) -> dict:
    """Провести одну открытую партию. Вне её окна строки не пишутся."""
    from apps.debts.services.measures import MeasureLaunchError

    moment = _local(at)
    if measure.kind != Measure.Kind.CALL:
        raise MeasureLaunchError({"kind": "Проведение доступно для автообзвона"})
    if measure.status not in OPEN_PARTY:
        raise MeasureLaunchError({"status": "Партия уже закрыта"})
    if not _campaign_open(measure, moment):
        raise MeasureLaunchError({"window": _window_reason(measure, moment)})
    start = _sync_window(measure, moment)
    return {"dialed": _dial_measure(measure, moment, start)}


def _local(at: datetime | None) -> datetime:
    if at is None:
        return timezone.localtime()
    if timezone.is_naive(at):
        at = timezone.make_aware(at, timezone.get_current_timezone())
    return timezone.localtime(at)


def _campaign_open(measure: Measure, moment: datetime) -> bool:
    if measure.source_scenario_id:
        start, end = call_window(measure.source_scenario, moment.date())
        day = measure.source_scenario.call_from_day or START_DAY
        if moment.day < day:
            return False
    else:
        start, end = measure.time_from, measure.time_to
    if start is None or end is None:
        return False
    clock = moment.time().replace(microsecond=0)
    return start <= clock <= end


def _sync_window(measure: Measure, moment: datetime) -> time:
    start, end = call_window(measure.source_scenario, moment.date()) if measure.source_scenario_id else (
        measure.time_from, measure.time_to,
    )
    if measure.time_from != start or measure.time_to != end:
        measure.time_from = start
        measure.time_to = end
        measure.save(update_fields=["time_from", "time_to", "updated_at"])
    return start


def _window_reason(measure: Measure, moment: datetime) -> str:
    scenario = measure.source_scenario
    if scenario is not None and moment.day < (scenario.call_from_day or START_DAY):
        day = scenario.call_from_day or START_DAY
        return f"Обзвон этой партии начинается с {day}-го числа"
    start, end = call_window(scenario, moment.date()) if scenario is not None else (
        measure.time_from, measure.time_to,
    )
    if start is None or end is None:
        return "У партии не задано окно обзвона"
    return f"Сейчас вне окна {start:%H:%M}–{end:%H:%M}"


def _dial_measure(measure: Measure, moment: datetime, window_start: time) -> int:
    count = 0
    items = measure.items.select_related("account").filter(status__in=OPEN_ITEM).order_by("id")
    for item in items:
        account = item.account
        if account.inheritance_case:
            continue
        if is_legal_entity(account) and not measure.call_legal:
            continue
        rule = _repeat_rule(measure, account.effective_group)
        if not _attempt_due(item, rule, moment):
            continue
        phone = phone_for_call(account, moment.date(), window_start)
        if not phone:
            continue
        if item.phone != phone:
            item.phone = phone
            item.save(update_fields=["phone", "updated_at"])
        caller = _next_caller(measure.organization_id)
        text = _speech(measure, account)
        try:
            outcome = async_to_sync(get_gateway_client().dial)({
                "phone": phone,
                "text": text,
                "caller_id": caller,
                "record": bool(measure.organization.call_recording),
                "transfer": bool(measure.organization.call_transfer),
            })
        except GatewayUnavailable:
            continue
        write_call_result(
            measure,
            item,
            None,
            {
                "call_result": outcome.get("status"),
                "duration_sec": outcome.get("duration_sec"),
                "listen_percent": outcome.get("listen_percent"),
                "error": outcome.get("error") or "",
            },
            external_call=False if outcome.get("external_call") is False else outcome.get("external_call"),
            provider_message_id=str(outcome.get("provider_message_id") or ""),
            caller_id=str(outcome.get("caller_id") or caller),
            recording_ref=str(outcome.get("recording_ref") or ""),
            acted_at=moment,
        )
        count += 1
    return count


def _repeat_rule(measure: Measure, group: int | None) -> dict:
    from apps.nsi.services.scenarios import CALL_REPEAT

    table = dict(CALL_REPEAT)
    step = _call_step(measure)
    custom = step.get("repeat") if isinstance(step.get("repeat"), dict) else None
    if custom:
        table.update({str(key): value for key, value in custom.items() if isinstance(value, dict)})
    if group is None:
        return {"once": True}
    rule = table.get(str(group))
    return rule if isinstance(rule, dict) else {"once": True}


def _call_step(measure: Measure) -> dict:
    scenario = measure.source_scenario
    if scenario is None or measure.source_step is None:
        return {}
    revision = scenario.revisions.filter(version=measure.source_version).first()
    steps = (revision.steps if revision else scenario.steps) or []
    for step in steps:
        if step.get("order") == measure.source_step and step.get("action") in {"call", "manual_call"}:
            return step
    return {}


def _attempt_due(item: MeasureItem, rule: dict, moment: datetime) -> bool:
    if item.status not in OPEN_ITEM:
        return False
    if item.call_result == MeasureItem.CallResult.ANSWERED:
        return False
    if rule.get("once"):
        return item.acted_at is None and not item.call_result
    try:
        every = int(rule.get("every_days") or 1)
    except (TypeError, ValueError):
        every = 1
    if every < 1:
        every = 1
    if item.acted_at is None:
        return True
    last = timezone.localtime(item.acted_at).date()
    return (moment.date() - last).days >= every


def _next_caller(organization_id: int) -> str:
    with transaction.atomic():
        org = Organization.objects.select_for_update().get(pk=organization_id)
        numbers = []
        for raw in org.outgoing_numbers or []:
            phone = belarus_phone(str(raw))
            if phone and phone not in numbers:
                numbers.append(phone)
        if not numbers:
            return ""
        index = org.outgoing_cursor % len(numbers)
        org.outgoing_cursor = index + 1
        org.save(update_fields=["outgoing_cursor", "updated_at"])
        return numbers[index]


def _speech(measure: Measure, account: Account) -> str:
    from apps.notifications.models import MessageTemplate

    named = (measure.template_name or "").strip()
    local = MessageTemplate.objects.filter(
        is_active=True, name=named, organization_id=account.organization_id,
    ).first() if named else None
    central = MessageTemplate.objects.filter(
        is_active=True, name=named, organization__isnull=True,
    ).first() if named and local is None else None
    found = local or central
    body = (found.body if found and found.body else "") or named or "Напоминание о задолженности"
    values = {
        "fio": account.short_fio or "",
        "account": account.client_account or "",
        "amount": "" if account.balance_out is None else str(account.balance_out),
        "address": account.account_address or "",
        "organization": account.organization.name,
    }
    for key, value in values.items():
        body = body.replace("{" + key + "}", value)
    return body.strip() or "Напоминание о задолженности"


def choose_dial_phone(account: Account, on_date: date, at: time):
    """Тот же выбор номера, что у отбора партии: городской или мобильный по правилу дня."""
    return choose_phone(account, on_date, at)
