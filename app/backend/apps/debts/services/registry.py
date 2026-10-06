"""Представление реестра мероприятий (ТЗ 4.2.3.6).

В списке — партия. Частные мероприятия по ЛС живут отдельно и режутся тем же контуром, что реестр счетов.
"""

import calendar
from datetime import date

from django.db.models import Count, OuterRef, Prefetch, Q, QuerySet, Subquery
from django.db.models.functions import Coalesce

from apps.debts.models import Account, Measure

MATRIX_KINDS = (
    (Measure.Kind.CALL, "Автообзвон"),
    (Measure.Kind.NOTICE, "E-mail"),
    (Measure.Kind.WARNING, "Предупреждение"),
    (Measure.Kind.DISCONNECT, "Отключение услуг"),
    (Measure.Kind.COLLECTION, "Испол. надпись"),
)
GROUP_LIMIT = 40
MATRIX_LIMIT = 200
REGISTRY_STATUSES = (
    Measure.Status.ASSIGNED,
    Measure.Status.RUNNING,
    Measure.Status.DONE,
    Measure.Status.FAILED,
    Measure.Status.PAUSED,
    Measure.Status.CANCELLED,
)

_NOTICE_CHANNEL = {"email": "e-mail", "sms": "SMS"}


def parse_month(value: str) -> tuple[date, date] | None:
    text = (value or "").strip()
    if len(text) != 7 or text[4] != "-":
        return None
    try:
        year = int(text[:4])
        month = int(text[5:7])
        start = date(year, month, 1)
    except ValueError:
        return None
    last = calendar.monthrange(year, month)[1]
    return start, date(year, month, last)


def period_overlap(start: date, end: date) -> Q:
    """Мероприятие попадает в месяц, если его срок пересекает этот месяц.

    Без даты окончания партия остаётся в месяце начала, а не во всех следующих.
    """
    open_ended = Q(started_on__gte=start, started_on__lte=end, due_on__isnull=True)
    closed = Q(started_on__isnull=False, started_on__lte=end, due_on__gte=start)
    undated = Q(started_on__isnull=True, created_at__date__gte=start, created_at__date__lte=end)
    return open_ended | closed | undated


def _sample(visible_ids, search: str):
    sample = Account.objects.filter(pk__in=visible_ids, measures=OuterRef("pk")).order_by("client_account")
    text = (search or "").strip()
    if not text:
        return sample
    preferred = sample.filter(Q(client_account__icontains=text) | Q(short_fio__icontains=text))
    return preferred


def annotate_registry(qs: QuerySet, visible: QuerySet, search: str = "") -> QuerySet:
    """Имя должника и число ЛС — только по счетам, которые пользователь и так видит.

    Если поиск совпал с конкретным ЛС партии, в строке показывается он, а не первый по номеру.
    """
    visible_ids = visible.values("id")
    any_account = Account.objects.filter(pk__in=visible_ids, measures=OuterRef("pk")).order_by("client_account")
    preferred = _sample(visible_ids, search)
    return qs.select_related("assignee").annotate(
        accounts_count=Count("accounts", filter=Q(accounts__in=visible_ids), distinct=True),
        items_total=Count("items", filter=Q(items__account__in=visible_ids), distinct=True),
        items_done=Count(
            "items",
            filter=Q(items__account__in=visible_ids, items__status=Measure.Status.DONE),
            distinct=True,
        ),
        debtor_name=Coalesce(
            Subquery(preferred.values("short_fio")[:1]),
            Subquery(any_account.values("short_fio")[:1]),
        ),
        debtor_account=Coalesce(
            Subquery(preferred.values("client_account")[:1]),
            Subquery(any_account.values("client_account")[:1]),
        ),
        debtor_id=Coalesce(
            Subquery(preferred.values("id")[:1]),
            Subquery(any_account.values("id")[:1]),
        ),
    )


def debtor_fields(measure: Measure) -> tuple[str, str, int | None]:
    if "debtor_name" in measure.__dict__:
        return measure.debtor_name or "", measure.debtor_account or "", measure.debtor_id
    account = measure.accounts.order_by("client_account").first()
    if account is None:
        return "", "", None
    return account.short_fio, account.client_account, account.id


def accounts_count(measure: Measure) -> int:
    if "accounts_count" in measure.__dict__ and measure.accounts_count is not None:
        return measure.accounts_count
    return measure.accounts.count()


def _with_detail(base: str, detail: str) -> str:
    text = (detail or "").strip()
    if not text or text.casefold() == base.casefold():
        return base
    return f"{base} — {text}"


def measure_title(measure: Measure) -> str:
    if measure.kind == Measure.Kind.CALL:
        title = _with_detail("Автообзвон", measure.template_name)
    elif measure.kind == Measure.Kind.NOTICE:
        channel = _NOTICE_CHANNEL.get(measure.channel, measure.channel)
        base = f"Рассылка {channel}" if channel else "Рассылка уведомления"
        title = _with_detail(base, measure.template_name)
    elif measure.kind == Measure.Kind.WARNING:
        title = _with_detail("Предупреждение", measure.template_name)
    elif measure.kind == Measure.Kind.SCENARIO:
        title = _with_detail("Смена сценария", measure.scenario_name)
    elif measure.kind == Measure.Kind.DISCONNECT:
        title = "Отключение услуг"
    elif measure.kind == Measure.Kind.COLLECTION:
        title = _with_detail("Взыскание", measure.template_name)
    else:
        title = measure.get_kind_display()
    owner = (getattr(measure, "owner_name", "") or "").strip()
    if owner:
        return f"{title} · {owner}"
    return title


def _day(value: date | None) -> str:
    return value.strftime("%d.%m.%Y") if value else ""


def next_action(measure: Measure) -> str:
    if getattr(measure, "approval", "") == "pending":
        return "Ожидает согласования"
    if measure.status == Measure.Status.FAILED:
        return (measure.note or "").strip() or "Проверьте результат"
    if measure.status == Measure.Status.CANCELLED:
        return "Прервано"
    if measure.status == Measure.Status.PAUSED:
        return "Приостановлено"
    if measure.status == Measure.Status.DONE:
        if measure.kind == Measure.Kind.DISCONNECT and measure.resumed_on:
            return f"Возобновлено {_day(measure.resumed_on)}"
        if measure.kind == Measure.Kind.DISCONNECT and measure.suspension_confirmed_on:
            return f"Отключено {_day(measure.suspension_confirmed_on)}"
        if measure.due_on:
            return f"Завершено. Срок {_day(measure.due_on)}"
        return "Завершено"
    if measure.status == Measure.Status.RUNNING:
        if measure.kind == Measure.Kind.CALL:
            return "Дозвон…"
        if measure.kind == Measure.Kind.DISCONNECT:
            return "Ожидается отключение"
        return "Выполняется"
    if measure.due_on is not None:
        from django.utils import timezone

        if measure.due_on == timezone.localdate() and measure.time_from:
            return f"Сегодня, {measure.time_from.strftime('%H:%M')}"
        if measure.due_on == timezone.localdate():
            return "Сегодня"
        return _day(measure.due_on)
    return "—"


def _cell(measure: Measure) -> dict:
    if measure.status == Measure.Status.FAILED:
        label, tone = "ошибка", "error"
    elif measure.status == Measure.Status.PAUSED:
        label, tone = "пауза", "wait"
    elif measure.status == Measure.Status.CANCELLED:
        label, tone = "прервано", "muted"
    elif measure.status == Measure.Status.RUNNING:
        label, tone = "идёт", "run"
    else:
        when = measure.due_on or measure.started_on
        label = when.strftime("%d.%m") if when else "—"
        if measure.status == Measure.Status.ASSIGNED and measure.time_from and when:
            label = f"{label} {measure.time_from.strftime('%H:%M')}"
        tone = "done" if measure.status == Measure.Status.DONE else "pending"
    return {"measure_id": measure.id, "status": measure.status, "label": label, "tone": tone}


def build_matrix(measures: QuerySet, visible: QuerySet, search: str = "", offset: int = 0) -> dict:
    """Строка матрицы — ЛС, ячейка — последнее мероприятие этого вида в текущей выборке."""
    measure_ids = measures.values("id")
    accounts = visible.filter(measures__in=measure_ids)
    text = (search or "").strip()
    if text:
        narrowed = accounts.filter(Q(client_account__icontains=text) | Q(short_fio__icontains=text))
        if narrowed.exists():
            accounts = narrowed
    accounts = accounts.order_by("short_fio", "client_account").distinct()
    total = accounts.count()
    page = list(accounts[offset:offset + MATRIX_LIMIT])
    ids = [account.id for account in page]
    latest: dict[int, dict[str, Measure]] = {account_id: {} for account_id in ids}
    kind_codes = [code for code, _label in MATRIX_KINDS]
    related = (
        Measure.objects.filter(pk__in=measure_ids, accounts__in=ids, kind__in=kind_codes)
        .order_by("created_at", "id")
        .prefetch_related(Prefetch("accounts", queryset=Account.objects.filter(pk__in=ids).only("id")))
    )
    for measure in related:
        for account in measure.accounts.all():
            bucket = latest.get(account.id)
            if bucket is None:
                continue
            current = bucket.get(measure.kind)
            if current is None or (measure.created_at, measure.id) >= (current.created_at, current.id):
                bucket[measure.kind] = measure
    rows = []
    for account in page:
        cells = {code: None for code, _label in MATRIX_KINDS}
        for code, measure in latest.get(account.id, {}).items():
            cells[code] = _cell(measure)
        rows.append({
            "account_id": account.id,
            "debtor_name": account.short_fio,
            "client_account": account.client_account,
            "cells": cells,
        })
    return {
        "kinds": [{"code": code, "label": label} for code, label in MATRIX_KINDS],
        "total": total,
        "offset": offset,
        "truncated": offset + len(rows) < total,
        "results": rows,
    }
