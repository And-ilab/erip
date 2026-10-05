"""Выбор номера для автообзвона (ТЗ 4.2.1.4, 4.2.2.5)."""

from datetime import date, datetime, time

from apps.debts.models import Account, Contact
from apps.nsi.models import CalculationSettings


def _mobile_hours(hour: int, start: int | None, end: int | None) -> bool:
    if start is None or end is None or start == end:
        return False
    if not 0 <= start <= 23 or not 0 <= end <= 23:
        return False
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def choose_phone(account: Account, on_date: date | None = None, at: time | None = None) -> Contact | None:
    today = date.today()
    on_date = on_date or today
    settings = CalculationSettings.load()
    mode = account.contact_source_mode or "combined"
    qs = account.contacts.filter(kind__in=[Contact.Kind.MOBILE, Contact.Kind.CITY])
    if mode == "pm":
        qs = qs.filter(source=Contact.Source.PM)
    elif mode == "ais":
        qs = qs.filter(source=Contact.Source.AIS)
    hour = at.hour if at is not None else (datetime.now().hour if on_date == today else None)
    day_from, weekdays = _dial_rule(account, settings)
    mobile_only = on_date.weekday() in weekdays or on_date.day >= day_from
    if hour is not None and _mobile_hours(hour, settings.dial_mobile_from_hour, settings.dial_mobile_to_hour):
        mobile_only = True
    ordered = qs.order_by("-priority", "kind")
    if mobile_only:
        return ordered.filter(kind=Contact.Kind.MOBILE).first()
    return ordered.first()


def _dial_rule(account: Account, settings: CalculationSettings) -> tuple[int, list[int]]:
    day_from = settings.dial_mobile_from_day
    weekdays = [int(day) for day in (settings.dial_mobile_weekdays or [])]
    from apps.debts.models import AccountScenarioRun

    run = AccountScenarioRun.objects.filter(account_id=account.pk).select_related("scenario").first()
    if run is not None:
        if run.scenario.dial_mobile_from_day is not None:
            day_from = run.scenario.dial_mobile_from_day
        if run.scenario.dial_mobile_weekdays is not None:
            weekdays = [int(day) for day in run.scenario.dial_mobile_weekdays]
    return day_from, weekdays
