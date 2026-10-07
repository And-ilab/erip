"""Окно календаря реестра: крайний срок действия по лицевому счёту или договору."""

from datetime import date, timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from ..models import Account, ClaimCase, Measure, MeasureItem


def resolve_span(params) -> tuple[date, date]:
    """Первый день включительно и день после последнего — для фильтра ``__lt``."""
    raw_from = (params.get("date_from") or "").strip()
    raw_to = (params.get("date_to") or "").strip()
    if raw_from or raw_to:
        start = _parse(raw_from or raw_to, "date_from")
        finish = _parse(raw_to or raw_from, "date_to")
        if finish < start:
            start, finish = finish, start
        return start, finish + timedelta(days=1)

    raw_month = (params.get("month") or "").strip() or timezone.localdate().strftime("%Y-%m")
    parts = raw_month.split("-")
    if len(parts) < 2:
        raise ValidationError({"month": "Месяц в формате ГГГГ-ММ"})
    try:
        year, month = int(parts[0]), int(parts[1])
        start = date(year, month, 1)
    except ValueError:
        raise ValidationError({"month": "Месяц в формате ГГГГ-ММ"}) from None
    if month == 12:
        return start, date(year + 1, 1, 1)
    return start, date(year, month + 1, 1)


def due_lookup(field: str, start: date, end: date, today: date | None = None):
    """Срок в видимом окне. Если окно включает сегодня, просроченные сроки тоже остаются на доске."""
    today = today or timezone.localdate()
    visible = Q(**{f"{field}__gte": start, f"{field}__lt": end})
    if start <= today < end:
        visible |= Q(**{f"{field}__lt": today})
    return visible


def present_deadline(day: date, *, start: date, end: date, kind: str, title: str, today: date | None = None,
                     pending: bool = True, **extra) -> dict:
    """Невыполненный просроченный срок — красным, ближайшие два дня — жёлтым.

    Выполненное действие на своей дате не красится красным и не переносится на сегодня.
    Срок вне месяца, если действие ещё не сделано, показывается в сегодняшней клетке.
    """
    today = today or timezone.localdate()
    if not pending:
        urgency = "done"
    elif day < today:
        urgency = "overdue"
    elif day <= today + timedelta(days=2):
        urgency = "soon"
    else:
        urgency = "planned"
    shown = day
    label = title
    if pending and urgency == "overdue" and not (start <= day < end) and start <= today < end:
        shown = today
        label = f"{title} (просрочено {day.strftime('%d.%m.%Y')})"
    return {
        "date": shown.isoformat(),
        "due": day.isoformat(),
        "kind": kind,
        "title": label,
        "urgency": urgency,
        **extra,
    }


_FILED = {
    ClaimCase.Stage.LAWSUIT,
    ClaimCase.Stage.COURT,
    ClaimCase.Stage.OPI,
    ClaimCase.Stage.OPI_MEASURES,
    ClaimCase.Stage.RECOVERED,
    ClaimCase.Stage.IMPOSSIBLE,
    ClaimCase.Stage.WRITEOFF,
}
_QUIET = {MeasureItem.Status.DONE, MeasureItem.Status.CANCELLED}


def account_calendar(accounts, start: date, end: date) -> list[dict]:
    """Контрольные даты и открытые мероприятия по каждому лицевому счёту выборки."""
    events = []
    events.extend(_warning_deadlines(accounts, start, end))
    events.extend(_claim_deadlines(accounts, start, end))
    events.extend(_measure_deadlines(accounts, start, end))
    return events


def contract_calendar(services, start: date, end: date) -> list[dict]:
    """Срок погашения услуги и мероприятия, которые относятся к этой выборке."""
    events = []
    owing = services.exclude(repayment_due_on=None).filter(
        due_lookup("repayment_due_on", start, end),
    ).select_related("account")
    for service in owing:
        if not _service_owes(service):
            continue
        events.append(present_deadline(
            service.repayment_due_on, start=start, end=end, pending=True,
            kind="Срок погашения",
            title=_service_caption(service, "срок погашения"),
            account_id=service.account_id, contract_id=service.id,
        ))
    accounts = Account.objects.filter(pk__in=services.values("account_id"))
    events.extend(_measure_deadlines(accounts, start, end, services=services))
    return events


def _warning_deadlines(accounts, start: date, end: date) -> list[dict]:
    warned = list(
        accounts.exclude(warning_due=None).filter(due_lookup("warning_due", start, end))
    )
    if not warned:
        return []
    covered = set(
        MeasureItem.objects.filter(
            account_id__in=[row.id for row in warned],
            measure__kind=Measure.Kind.DISCONNECT,
        ).exclude(status=MeasureItem.Status.CANCELLED).values_list("account_id", flat=True)
    )
    events = []
    for account in warned:
        if account.id in covered or not _account_owes(account):
            continue
        events.append(present_deadline(
            account.warning_due, start=start, end=end, pending=True,
            kind="Истечение срока предупреждения",
            title=_caption(account, "истечение срока предупреждения"),
            account_id=account.id,
        ))
    return events


def _claim_deadlines(accounts, start: date, end: date) -> list[dict]:
    claimed = list(accounts.exclude(claim_due=None).filter(due_lookup("claim_due", start, end)))
    if not claimed:
        return []
    filed = set(
        ClaimCase.objects.filter(account_id__in=[row.id for row in claimed]).filter(
            Q(lawsuit_filed_on__isnull=False) | Q(stage__in=_FILED),
        ).values_list("account_id", flat=True)
    )
    return [
        present_deadline(
            account.claim_due, start=start, end=end, pending=True,
            kind="Дедлайн подачи иска",
            title=_caption(account, "дедлайн подачи иска"),
            account_id=account.id,
        )
        for account in claimed
        if account.id not in filed
    ]


def _measure_deadlines(accounts, start: date, end: date, services=None) -> list[dict]:
    events = []
    seen = set()
    for item in _items(accounts, start, end, services, pending=True):
        key = (item.measure_id, item.account_id)
        if key in seen:
            continue
        seen.add(key)
        action = item.measure.get_kind_display()
        events.append(present_deadline(
            item.measure.due_on, start=start, end=end, pending=True,
            kind=action, title=_caption(item.account, action),
            account_id=item.account_id, measure_id=item.measure_id,
        ))
    for item in _items(accounts, start, end, services, pending=False):
        key = (item.measure_id, item.account_id)
        if key in seen:
            continue
        seen.add(key)
        action = item.measure.get_kind_display()
        events.append(present_deadline(
            item.measure.due_on, start=start, end=end, pending=False,
            kind=action, title=_caption(item.account, action),
            account_id=item.account_id, measure_id=item.measure_id,
        ))
    events.extend(_bare_measures(accounts, start, end, services, seen))
    return events


def _items(accounts, start: date, end: date, services, *, pending: bool):
    scope = Q(account__in=accounts, measure__due_on__isnull=False)
    scope &= ~Q(measure__status=Measure.Status.CANCELLED)
    if services is not None:
        scope &= Q(measure__services__in=services) | Q(measure__services__isnull=True)
    if pending:
        scope &= ~Q(status__in=_QUIET)
        window = due_lookup("measure__due_on", start, end)
    else:
        scope &= Q(status=MeasureItem.Status.DONE)
        window = Q(measure__due_on__gte=start, measure__due_on__lt=end)
    return (
        MeasureItem.objects.filter(scope)
        .filter(window)
        .select_related("account", "measure")
        .distinct()
    )


def _bare_measures(accounts, start: date, end: date, services, seen: set) -> list[dict]:
    events = []
    base = Q(accounts__in=accounts, items__isnull=True, due_on__isnull=False)
    base &= ~Q(status=Measure.Status.CANCELLED)
    if services is not None:
        base &= Q(services__in=services) | Q(services__isnull=True)
    open_rows = Measure.objects.filter(base).exclude(status=Measure.Status.DONE).filter(
        due_lookup("due_on", start, end),
    ).distinct()
    done_rows = Measure.objects.filter(base, status=Measure.Status.DONE).filter(
        due_on__gte=start, due_on__lt=end,
    ).distinct()
    for measure, pending in [(row, True) for row in open_rows] + [(row, False) for row in done_rows]:
        action = measure.get_kind_display()
        linked = measure.accounts.filter(pk__in=accounts.values("pk"))
        for account in linked:
            key = (measure.id, account.id)
            if key in seen:
                continue
            seen.add(key)
            events.append(present_deadline(
                measure.due_on, start=start, end=end, pending=pending,
                kind=action, title=_caption(account, action),
                account_id=account.id, measure_id=measure.id,
            ))
    return events


def _caption(account, action: str) -> str:
    who = f"ЛС {account.client_account}"
    name = (account.short_fio or "").strip()
    if name:
        who = f"{who}, {name}"
    return f"{who}: {action}"


def _service_caption(service, action: str) -> str:
    name = (service.service_name or "").strip()
    who = _caption(service.account, action)
    if not name:
        return who
    return who.replace(": ", f", {name}: ", 1)


def _account_owes(account) -> bool:
    return (account.balance_out or 0) > 0 or (account.balance_mulct_out or 0) > 0


def _service_owes(service) -> bool:
    return (service.balance_out or 0) > 0 or (service.balance_mulct_out or 0) > 0


def _parse(raw: str, field: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({field: "Дата в формате ГГГГ-ММ-ДД"}) from None
