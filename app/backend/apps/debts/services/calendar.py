"""Окно календаря реестра: один день, диапазон или целый месяц."""

from datetime import date, timedelta

from django.utils import timezone
from rest_framework.exceptions import ValidationError


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


def _parse(raw: str, field: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({field: "Дата в формате ГГГГ-ММ-ДД"}) from None


def due_lookup(field: str, start: date, end: date, today: date | None = None):
    """Срок в видимом окне. Если окно включает сегодня, просроченные сроки тоже остаются на доске."""
    from django.db.models import Q

    today = today or timezone.localdate()
    visible = Q(**{f"{field}__gte": start, f"{field}__lt": end})
    if start <= today < end:
        visible |= Q(**{f"{field}__lt": today})
    return visible


def present_deadline(day: date, *, start: date, end: date, kind: str, title: str, today: date | None = None, **extra) -> dict:
    """Просрочка красным, ближайшие два дня — жёлтым. Срок вне месяца показывается в сегодняшней клетке."""
    today = today or timezone.localdate()
    if day < today:
        urgency = "overdue"
    elif day <= today + timedelta(days=2):
        urgency = "soon"
    else:
        urgency = "planned"
    shown = day
    label = title
    if urgency == "overdue" and not (start <= day < end) and start <= today < end:
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
