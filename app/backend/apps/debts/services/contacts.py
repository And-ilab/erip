"""Выбор номера для автообзвона (ТЗ 4.2.1.4, 4.2.2.5)."""

from datetime import date

from apps.nsi.models import CalculationSettings

from apps.debts.models import Account, Contact


def choose_phone(account: Account, on_date: date | None = None) -> Contact | None:
    on_date = on_date or date.today()
    settings = CalculationSettings.load()
    mode = account.contact_source_mode or "combined"
    qs = account.contacts.filter(kind__in=[Contact.Kind.MOBILE, Contact.Kind.CITY])
    if mode == "pm":
        qs = qs.filter(source=Contact.Source.PM)
    elif mode == "ais":
        qs = qs.filter(source=Contact.Source.AIS)
    weekend_or_month_end = on_date.weekday() >= 5 or on_date.day >= settings.dial_mobile_from_day
    if weekend_or_month_end and qs.filter(kind=Contact.Kind.MOBILE).exists():
        qs = qs.filter(kind=Contact.Kind.MOBILE)
    return qs.order_by("-priority", "kind").first()
