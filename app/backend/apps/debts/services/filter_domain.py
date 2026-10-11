"""Пользовательский домен фильтра реестра.

Форма как у конструктора условий: группа «всем» (И) или «любому» (ИЛИ),
вложенная группа и флаг «кроме» (НЕ). Поля только те, что реестр уже умеет отбирать.
"""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal, InvalidOperation

from django.db.models import Q
from django.db.models.functions import Coalesce
from rest_framework.exceptions import ValidationError

from apps.debts.services.assignees import specialist_label

MAX_NODES = 30
MAX_DEPTH = 4
_OPS = {
    "exact": {"eq", "ne"},
    "text": {"eq", "ne", "contains", "ncontains"},
    "number": {"eq", "ne", "gt", "gte", "lt", "lte"},
    "date": {"eq", "gte", "lte"},
    "bool": {"eq", "ne"},
    "group": {"eq", "ne", "gt", "gte", "lt", "lte"},
    "assignee": {"eq", "ne", "contains"},
    "billing": {"eq", "ne", "contains", "ncontains"},
    "related_group": {"eq", "ne"},
}


def apply_account_domain(queryset, raw):
    return _apply(queryset, raw, _ACCOUNT, distinct=False)


def apply_contract_domain(queryset, raw):
    return _apply(queryset, raw, _CONTRACT, distinct=False)


def apply_measure_domain(queryset, raw):
    return _apply(queryset, raw, _MEASURE, distinct=True)


_ACCOUNT = {
    "group_manual": "debt_group_manual",
    "group_calc": "debt_group",
    "assignee_prefix": "",
    "fields": {
        "debt_group": {"kind": "group"},
        "rating": {"kind": "exact", "lookup": "rating"},
        "funnel_stage": {"kind": "exact", "lookup": "funnel_stage"},
        "assigned_name": {"kind": "assignee"},
        "ownership": {"kind": "text", "lookup": "ownership_type_name"},
        "housing": {"kind": "text", "lookup": "acc_category_full"},
        "months_debt": {"kind": "number", "lookup": "months_debt"},
        "subj_count": {"kind": "number", "lookup": "subj_count"},
        "balance_out": {"kind": "number", "lookup": "balance_out"},
        "debt_started_on": {"kind": "date", "lookup": "debt_started_on"},
        "inheritance_case": {"kind": "bool", "lookup": "inheritance_case"},
    },
}

_CONTRACT = {
    "group_manual": "debt_group_manual",
    "group_calc": "debt_group",
    "assignee_prefix": "account__",
    "fields": {
        "debt_group": {"kind": "group"},
        "funnel_stage": {"kind": "exact", "lookup": "account__funnel_stage"},
        "assigned_name": {"kind": "assignee"},
        "ownership": {"kind": "text", "lookup": "account__ownership_type_name"},
        "housing": {"kind": "text", "lookup": "account__acc_category_full"},
        "months_debt": {"kind": "number", "lookup": "debt_period"},
        "subj_count": {"kind": "number", "lookup": "account__subj_count"},
        "balance_out": {"kind": "number", "lookup": "balance_out"},
        "debt_started_on": {"kind": "date", "lookup": "debt_started_on"},
        "inheritance_case": {"kind": "bool", "lookup": "account__inheritance_case"},
        "billing": {"kind": "billing"},
    },
}

_MEASURE = {
    "fields": {
        "debt_group": {"kind": "related_group"},
        "rating": {"kind": "exact", "lookup": "accounts__rating"},
        "funnel_stage": {"kind": "exact", "lookup": "accounts__funnel_stage"},
        "kind": {"kind": "exact", "lookup": "kind"},
        "status": {"kind": "exact", "lookup": "status"},
    },
}


def _apply(queryset, raw, spec, *, distinct):
    node = _load(raw)
    if node is None:
        return queryset
    _guard(node, 0, [0])
    compiled = _compile(node, spec, 0)
    if compiled is None:
        return queryset
    if _uses(node, "group") and spec.get("group_manual"):
        queryset = queryset.annotate(
            _domain_group=Coalesce(spec["group_manual"], spec["group_calc"]),
        )
    if _uses(node, "assignee"):
        queryset = queryset.annotate(
            _domain_assignee=specialist_label(spec.get("assignee_prefix", "")),
        )
    queryset = queryset.filter(compiled)
    if distinct:
        queryset = queryset.distinct()
    return queryset


def _load(raw):
    if raw in (None, ""):
        return None
    if isinstance(raw, str):
        if len(raw) > 8000:
            raise ValidationError({"domain": "Условие фильтра слишком длинное"})
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValidationError({"domain": "Условие фильтра не разбирается"}) from exc
    if not isinstance(raw, dict):
        raise ValidationError({"domain": "Условие фильтра задаётся объектом"})
    return raw


def _guard(node, depth, counter):
    if depth > MAX_DEPTH:
        raise ValidationError({"domain": "Слишком глубокая группа условий"})
    counter[0] += 1
    if counter[0] > MAX_NODES:
        raise ValidationError({"domain": "Слишком много условий"})
    rules = node.get("rules") if isinstance(node, dict) else None
    if isinstance(rules, list):
        for item in rules:
            if not isinstance(item, dict):
                raise ValidationError({"domain": "Условие фильтра задаётся объектом"})
            _guard(item, depth + 1, counter)


def _uses(node, kind_name) -> bool:
    if not isinstance(node, dict):
        return False
    rules = node.get("rules")
    if isinstance(rules, list):
        return any(_uses(item, kind_name) for item in rules)
    field = node.get("field")
    if not field:
        return False
    for spec in (_ACCOUNT, _CONTRACT, _MEASURE):
        meta = spec["fields"].get(field)
        if meta and meta["kind"] == kind_name:
            return True
    return False


def _compile(node, spec, depth):
    if isinstance(node.get("rules"), list):
        parts = [item for item in (_compile(rule, spec, depth + 1) for rule in node["rules"]) if item is not None]
        if not parts:
            return None
        combined = parts[0]
        joiner = node.get("join") if node.get("join") in {"and", "or"} else "and"
        for part in parts[1:]:
            combined = combined | part if joiner == "or" else combined & part
        return ~combined if node.get("not") else combined
    return _condition(node, spec)


def _condition(node, spec):
    field = str(node.get("field") or "").strip()
    if not field:
        return None
    meta = spec["fields"].get(field)
    if meta is None:
        raise ValidationError({"domain": f"Поле «{field}» в этом реестре не фильтруется"})
    op = str(node.get("op") or "eq")
    if op not in _OPS[meta["kind"]]:
        raise ValidationError({"domain": f"Оператор «{op}» для поля «{field}» не поддерживается"})
    built = _lookup(meta, op, node.get("value"), spec)
    if built is None:
        return None
    return ~built if node.get("not") else built


def _lookup(meta, op, raw, spec):
    kind = meta["kind"]
    if kind == "group":
        value = _number(raw, integer=True)
        lookup = {
            "eq": "", "ne": "", "gt": "__gt", "gte": "__gte", "lt": "__lt", "lte": "__lte",
        }[op]
        if op == "ne":
            return ~Q(_domain_group=value)
        return Q(**{f"_domain_group{lookup}": value})
    if kind == "related_group":
        value = _number(raw, integer=True)
        matched = Q(accounts__debt_group_manual=value) | Q(
            accounts__debt_group_manual__isnull=True, accounts__debt_group=value,
        )
        return ~matched if op == "ne" else matched
    if kind == "assignee":
        text = _text(raw)
        if op == "contains":
            return Q(_domain_assignee__icontains=text)
        if op == "ne":
            return ~Q(_domain_assignee__iexact=text)
        return Q(_domain_assignee__iexact=text)
    if kind == "billing":
        return _billing(op, _text(raw))
    value = _coerce(kind, raw)
    lookup = meta["lookup"]
    if op == "eq":
        expr = "iexact" if kind == "text" else "exact"
        return Q(**{f"{lookup}__{expr}": value})
    if op == "ne":
        expr = "iexact" if kind == "text" else "exact"
        return ~Q(**{f"{lookup}__{expr}": value})
    if op == "contains":
        return Q(**{f"{lookup}__icontains": value})
    if op == "ncontains":
        return ~Q(**{f"{lookup}__icontains": value})
    return Q(**{f"{lookup}__{op}": value})


def _billing(op, text):
    matched = Q(account__provider_short_name__icontains=text) | Q(account__schema_name__icontains=text)
    if text.isdigit():
        matched |= Q(account__provider_id=int(text))
    if op in {"ne", "ncontains"}:
        return ~matched
    return matched


def _coerce(kind, raw):
    if kind == "number":
        return _number(raw, integer=False)
    if kind == "date":
        text = _text(raw)
        try:
            return date.fromisoformat(text)
        except ValueError as exc:
            raise ValidationError({"domain": "Дата ожидается в формате ГГГГ-ММ-ДД"}) from exc
    if kind == "bool":
        return _bool(raw)
    return _text(raw)


def _text(raw) -> str:
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        raise ValidationError({"domain": "Заполните значение условия"})
    return str(raw).strip()


def _number(raw, *, integer):
    if isinstance(raw, bool) or raw is None or raw == "":
        raise ValidationError({"domain": "Укажите число"})
    try:
        number = Decimal(str(raw).replace(",", ".").replace(" ", ""))
    except (InvalidOperation, ValueError) as exc:
        raise ValidationError({"domain": "Укажите число"}) from exc
    if integer:
        if number != number.to_integral_value():
            raise ValidationError({"domain": "Ожидается целое число"})
        return int(number)
    return number


def _bool(raw) -> bool:
    if isinstance(raw, bool):
        return raw
    text = str(raw).strip().casefold()
    if text in {"1", "true", "yes", "да"}:
        return True
    if text in {"0", "false", "no", "нет"}:
        return False
    raise ValidationError({"domain": "Для признака укажите да или нет"})
