"""Реестр договоров: правила поставщика и группировка должников.

Представления вызывают только эти функции. Так контур «договоры» можно позже
отделить от реестра лицевых счетов, не перенося HTTP-слой.
"""

from django.db.models import Case, CharField, Count, IntegerField, Max, Min, Sum, Value, When
from django.db.models.functions import Cast, Coalesce, NullIf
from rest_framework.exceptions import ValidationError

from apps.users.scoping import AccessScope

from apps.debts.services.portfolio import debtor_peers

# Поля лицевого счёта, которые поставщик меняет со своей карточки договора.
SUPPLIER_ACCOUNT_FIELDS = frozenset({
    "debtor_category",
    "inheritance_case",
    "inheritance_until",
    "residence_note",
    "legal_status",
    "contact_source_mode",
})

FUNNEL_RANK = {
    "closed": 0,
    "new": 1,
    "prevention": 2,
    "warning": 3,
    "disconnect": 4,
    "enforcement": 5,
    "court": 6,
}


def bounded_int(value, default: int, *, minimum: int = 1, maximum: int | None = None, field: str = "page") -> int:
    if value in (None, ""):
        number = default
    else:
        try:
            number = int(value)
        except (TypeError, ValueError):
            raise ValidationError({field: "Ожидается целое число"}) from None
    if number < minimum:
        number = minimum
    if maximum is not None and number > maximum:
        number = maximum
    return number


def id_list(values, field: str = "service_ids") -> list[int]:
    result = []
    for item in values or []:
        try:
            result.append(int(item))
        except (TypeError, ValueError):
            raise ValidationError({field: "Некорректный идентификатор"}) from None
    return result


def peers_for_user(user, account):
    """Счета должника, которые этот пользователь имеет право менять."""
    qs = debtor_peers(account)
    if user is None or getattr(user, "contour", "") != "supplier":
        return qs
    providers = AccessScope(user).provider_ids()
    if not providers:
        return qs.none()
    return qs.filter(services__provider_id__in=providers).distinct()


def reject_supplier_account_fields(user, fields: set[str]) -> None:
    if user is None or getattr(user, "contour", "") != "supplier":
        return
    blocked = sorted(fields - SUPPLIER_ACCOUNT_FIELDS)
    if blocked:
        raise ValidationError({name: "Поле недоступно поставщику услуг" for name in blocked})


def _person_groups(qs):
    """Одна строка на должника. Пустые ИН и УНП не склеивают разные счета."""
    ranked = qs.order_by().annotate(
        person_key=Coalesce(
            NullIf("account__payer_identifier", Value("")),
            NullIf("account__payer_unp", Value("")),
            Cast("account_id", CharField()),
        ),
        stage_rank=Case(
            When(account__funnel_stage="court", then=Value(6)),
            When(account__funnel_stage="enforcement", then=Value(5)),
            When(account__funnel_stage="disconnect", then=Value(4)),
            When(account__funnel_stage="warning", then=Value(3)),
            When(account__funnel_stage="prevention", then=Value(2)),
            When(account__funnel_stage="closed", then=Value(0)),
            default=Value(1),
            output_field=IntegerField(),
        ),
    )
    return ranked.values("person_key").annotate(
        rank=Max("stage_rank"),
        principal=Sum("balance_out"),
        penalty=Sum("balance_mulct_out"),
        ls_count=Count("account", distinct=True),
        payer=Max("account__short_fio"),
        payer_identifier=Max(NullIf("account__payer_identifier", Value(""))),
        payer_unp=Max(NullIf("account__payer_unp", Value(""))),
        category=Max("account__debtor_category__name"),
        earliest=Min("debt_started_on"),
        sample_id=Max("id"),
    )


def person_page(qs, page: int, page_size: int) -> tuple[int, list[dict]]:
    rows = _person_groups(qs).order_by("payer")
    total = rows.count()
    start = (page - 1) * page_size
    chunk = rows[start:start + page_size]
    return total, [
        {
            "payer_identifier": row["payer_identifier"] or "",
            "payer_unp": row["payer_unp"] or "",
            "payer": row["payer"],
            "category": row["category"] or "",
            "ls_count": row["ls_count"],
            "principal": row["principal"],
            "penalty": row["penalty"],
            "earliest": row["earliest"],
            "sample_id": row["sample_id"],
        }
        for row in chunk
    ]


def kanban_columns(qs, stages: list[tuple[str, str]], page: int, page_size: int) -> list[dict]:
    grouped = _person_groups(qs)
    columns = []
    start = (page - 1) * page_size
    for code, title in stages:
        rank = 1 if code == "new" else FUNNEL_RANK[code]
        column = grouped.filter(rank=rank).order_by("payer")
        total = column.count()
        columns.append({
            "stage": code,
            "title": title,
            "total": total,
            "cards": [
                {
                    "sample_id": row["sample_id"],
                    "payer": row["payer"],
                    "payer_identifier": row["payer_identifier"] or "",
                    "ls_count": row["ls_count"],
                    "principal": row["principal"],
                }
                for row in column[start:start + page_size]
            ],
        })
    return columns
