"""Отбор строк одной шапки группировки. Поле совпадает со сводкой `grouped`."""

from datetime import date

from django.db.models import F, Q
from django.db.models.functions import Coalesce, TruncMonth
from rest_framework.exceptions import ValidationError

from apps.debts.services.assignees import specialist_label

BLANK_BUCKET = "__blank__"

_ACCOUNT_FIELDS = {
    "rating": (F("rating"), "text"),
    "provider": (F("provider_short_name"), "text"),
    "schema": (F("organization__name"), "text"),
    "category": (F("debtor_category__name"), "text"),
    "ownership": (F("ownership_type_name"), "text"),
    "housing": (F("acc_category_full"), "text"),
    "months": (F("months_debt"), "number"),
    "residents": (F("subj_count"), "number"),
}

_SERVICE_FIELDS = {
    "provider": (F("shot_name"), "text"),
    "schema": (F("account__organization__name"), "text"),
    "category": (F("account__debtor_category__name"), "text"),
    "billing": (F("account__provider_short_name"), "text"),
    "ownership": (F("account__ownership_type_name"), "text"),
    "housing": (F("account__acc_category_full"), "text"),
    "months": (F("debt_period"), "number"),
    "residents": (F("account__subj_count"), "number"),
}


def restrict_account_bucket(qs, key: str, raw: str):
    """Лицевые счета одной шапки группировки реестра ЛС."""
    return _restrict(qs, _account_expr(key), raw)


def restrict_service_bucket(qs, key: str, raw: str):
    """Услуги одной шапки группировки реестра договоров."""
    return _restrict(qs, _service_expr(key), raw)


def _account_expr(key: str):
    if key == "period":
        return TruncMonth("debt_started_on"), "date"
    if key == "specialist":
        return specialist_label(), "text"
    if key == "debt_group":
        return Coalesce("debt_group_manual", "debt_group"), "number"
    found = _ACCOUNT_FIELDS.get(key)
    if found is None:
        raise ValidationError({"group_by": "Неизвестное поле группировки"})
    return found


def _service_expr(key: str):
    if key == "period":
        return TruncMonth("debt_started_on"), "date"
    if key == "specialist":
        return specialist_label("account__"), "text"
    if key == "debt_group":
        return Coalesce("debt_group_manual", "debt_group"), "number"
    found = _SERVICE_FIELDS.get(key)
    if found is None:
        raise ValidationError({"group_by": "Неизвестное поле группировки"})
    return found


def _restrict(qs, expr, raw: str):
    field, kind = expr
    annotated = qs.annotate(_bucket=field)
    if raw == BLANK_BUCKET:
        if kind == "text":
            return annotated.filter(Q(_bucket__isnull=True) | Q(_bucket=""))
        return annotated.filter(_bucket__isnull=True)
    if kind == "number":
        try:
            number = int(raw)
        except (TypeError, ValueError):
            raise ValidationError({"bucket": "Ожидается число"}) from None
        return annotated.filter(_bucket=number)
    if kind == "date":
        try:
            day = date.fromisoformat(str(raw)[:10])
        except ValueError:
            raise ValidationError({"bucket": "Ожидается дата"}) from None
        return annotated.filter(_bucket=day)
    return annotated.filter(_bucket=raw)
