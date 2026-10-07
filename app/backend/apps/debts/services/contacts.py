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


def apply_call_priorities(account: Account) -> None:
    """Приоритет задаёт режим обзвона, а не карточка контакта.

    Только ПМ: контакты ПМ получают 1, контакты АИС — 0. Только АИС — наоборот.
    Оба источника участвуют с приоритетом 1.
    """
    mode = account.contact_source_mode or "combined"
    contacts = account.contacts.all()
    if mode == "pm":
        contacts.filter(source=Contact.Source.PM).exclude(priority=1).update(priority=1)
        contacts.filter(source=Contact.Source.AIS).exclude(priority=0).update(priority=0)
    elif mode == "ais":
        contacts.filter(source=Contact.Source.AIS).exclude(priority=1).update(priority=1)
        contacts.filter(source=Contact.Source.PM).exclude(priority=0).update(priority=0)
    else:
        contacts.exclude(priority=1).update(priority=1)


def contacts_for_dial(account: Account, kinds: list[str]):
    """В обзвон и рассылку попадает только источник, выбранный режимом."""
    mode = account.contact_source_mode or "combined"
    qs = account.contacts.filter(kind__in=kinds)
    if mode == "pm":
        return qs.filter(source=Contact.Source.PM)
    if mode == "ais":
        return qs.filter(source=Contact.Source.AIS)
    return qs


def choose_phone(account: Account, on_date: date | None = None, at: time | None = None) -> Contact | None:
    today = date.today()
    on_date = on_date or today
    settings = CalculationSettings.load()
    qs = contacts_for_dial(account, [Contact.Kind.MOBILE, Contact.Kind.CITY])
    hour = at.hour if at is not None else (datetime.now().hour if on_date == today else None)
    day_from, weekdays = _dial_rule(account, settings)
    mobile_only = on_date.weekday() in weekdays or on_date.day >= day_from
    if hour is not None and _mobile_hours(hour, settings.dial_mobile_from_hour, settings.dial_mobile_to_hour):
        mobile_only = True
    ordered = qs.order_by("-priority", "kind", "id")
    if mobile_only:
        return ordered.filter(kind=Contact.Kind.MOBILE).first()
    return ordered.first()


def choose_email(account: Account) -> Contact | None:
    ordered = contacts_for_dial(account, [Contact.Kind.EMAIL]).order_by("-priority", "id")
    for contact in ordered:
        if "@" in contact.value:
            return contact
    return None


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
