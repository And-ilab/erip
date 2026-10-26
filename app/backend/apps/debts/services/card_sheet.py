"""Поля карточки, которые приходят файлами АИС и должны быть видны специалисту."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from django.conf import settings

from apps.imports.field_maps import REGISTRATION_MAP, norm_header


def left_before_debt(registration) -> bool:
    """На дату начала долга лицо уже снято с учёта — в солидарные его не ставят."""
    started = registration.account.debt_started_on
    checkout = _checkout(registration)
    if started is None or checkout is None:
        return False
    return checkout <= started


def is_solidary(registration) -> bool:
    if registration.subj_is_main or left_before_debt(registration):
        return False
    return True


def debtor_role(registration) -> str:
    if registration.subj_is_main:
        return "Плательщик"
    if left_before_debt(registration):
        return "Выбывший"
    return "Солидарный должник"


def registration_sheet(registration) -> list[dict]:
    raw = registration.raw or {}
    indexed = {norm_header(str(key)): value for key, value in raw.items()}
    used: set[str] = set()
    rows = []
    for column in _spec_columns(REGISTRATION_MAP.spec_file):
        attr = _attr(column.column, column.comment)
        value = _model_value(registration, attr) if attr else None
        label = column.comment or column.column
        if value in (None, "") and norm_header(label) in indexed:
            value = indexed[norm_header(label)]
        if attr or norm_header(label) in indexed:
            used.add(norm_header(label))
        rows.append({"label": label, "value": present(value)})
    for key, value in raw.items():
        folded = norm_header(str(key))
        if folded in used or value in (None, ""):
            continue
        rows.append({"label": str(key), "value": present(value)})
        used.add(folded)
    return rows


def payment_file_fields(payment) -> list[dict]:
    return [
        {"label": str(key), "value": present(value)}
        for key, value in (payment.raw or {}).items()
        if value not in (None, "")
    ]


def unified_from_raw(account) -> str:
    if account.unified_account:
        return str(account.unified_account)
    for key, value in (account.raw or {}).items():
        folded = str(key).casefold()
        if "уен" in folded or "unified_account" in folded:
            text = str(value or "").strip()
            if text:
                return text
    return ""


def present(value) -> str:
    if value is None or value == "":
        return ""
    if value is True:
        return "да"
    if value is False:
        return "нет"
    if isinstance(value, datetime):
        return value.strftime("%d.%m.%Y %H:%M")
    if isinstance(value, date):
        return value.strftime("%d.%m.%Y")
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    return str(value)


def _checkout(registration):
    if registration.check_out_date:
        return registration.check_out_date
    raw = registration.raw or {}
    for key, value in raw.items():
        folded = str(key).casefold()
        if "снятия" not in folded and "убытия" not in folded and "check_out" not in folded:
            continue
        parsed = _parse_day(value)
        if parsed:
            return parsed
    return None


def _parse_day(value):
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value or "").strip()[:10]
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _model_value(registration, attr: str):
    if attr == "_account_id":
        return registration.account.account_id
    if attr == "heritage_transfer":
        return registration.get_heritage_transfer_display() if registration.heritage_transfer else ""
    value = getattr(registration, attr, None)
    if hasattr(value, "pk") and not isinstance(value, (date, datetime, Decimal, str, int)):
        return str(value)
    return value


def _attr(column: str, comment: str) -> str:
    for spec in REGISTRATION_MAP.specs:
        if spec.column != column or not spec.field or spec.field == "account":
            continue
        if spec.comment and comment and spec.comment.casefold() not in comment.casefold():
            continue
        return spec.field
    return ""


_SPEC_CACHE: dict[str, list] = {}


def _spec_columns(name: str):
    if name in _SPEC_CACHE:
        return _SPEC_CACHE[name]
    from apps.imports.samples import read_spec

    path = Path(settings.AIS_SPEC_DIR) / name
    columns = read_spec(path) if path.is_file() else []
    _SPEC_CACHE[name] = columns
    return columns
