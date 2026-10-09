"""Реестр договоров: правила поставщика и группировка должников.

Представления вызывают только эти функции. Так контур «договоры» можно позже
отделить от реестра лицевых счетов, не перенося HTTP-слой.
"""

from django.db.models import Case, CharField, Count, IntegerField, Max, Min, Q, Sum, Value, When
from django.db.models.functions import Cast, Coalesce, NullIf
from rest_framework.exceptions import ValidationError

from apps.debts.services.assignees import specialist_label
from apps.debts.services.portfolio import debtor_peers
from apps.users.scoping import AccessScope

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
RANK_STAGE = {rank: code for code, rank in FUNNEL_RANK.items()}


def _rating_label(rating: str | None, repeat) -> str:
    letter = rating or ""
    if not letter or letter == "E" or not repeat:
        return letter
    return f"{letter}/{repeat}"


def _person_extra(row, supplier: bool = False) -> dict:
    from decimal import Decimal

    principal = row["principal"] or Decimal("0")
    penalty = row["penalty"] or Decimal("0")
    stage_rank = row.get("group_rank") if supplier else row.get("rank")
    return {
        "rating_label": _rating_label(row.get("rating"), row.get("rating_repeat")),
        "funnel_stage": RANK_STAGE.get(stage_rank, "new"),
        "assigned_name": (row.get("assigned_name") or "").strip(),
        "ownership_type_name": row.get("ownership_type_name") or "",
        "housing_object": row.get("housing_object") or "",
        "months_debt": row.get("months_debt"),
        "subj_count": row.get("subj_count"),
        "registered_count": row.get("registered_count"),
        "obligation": principal + penalty,
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


def _with_person(qs):
    """Ключ должника и ранг этапа. Пустые ИН и УНП не склеивают разные счета."""
    return qs.order_by().annotate(
        person_key=Coalesce(
            NullIf("account__payer_identifier", Value("")),
            NullIf("account__payer_unp", Value("")),
            Cast("account_id", CharField()),
        ),
        shown_group=Coalesce("debt_group_manual", "debt_group"),
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


def _person_groups(qs):
    grouped = _with_person(qs).values("person_key").annotate(
        rank=Max("stage_rank"),
        debt_group=Max("shown_group"),
        principal=Sum("balance_out"),
        penalty=Sum("balance_mulct_out"),
        ls_count=Count("account", distinct=True),
        payer=Max("account__short_fio"),
        payer_identifier=Max(NullIf("account__payer_identifier", Value(""))),
        payer_unp=Max(NullIf("account__payer_unp", Value(""))),
        rating=Max(NullIf("account__rating", Value(""))),
        rating_repeat=Max("account__rating_repeat"),
        assigned_name=Max(specialist_label("account__")),
        ownership_type_name=Max("account__ownership_type_name"),
        housing_object=Max("account__acc_category_full"),
        months_debt=Max("account__months_debt"),
        subj_count=Max("account__subj_count"),
        category=Max("account__debtor_category__name"),
        earliest=Min("debt_started_on"),
        due_on=Min("repayment_due_on"),
        service_count=Count("id"),
        service_name=Min("service_name"),
        address=Max("account__account_address"),
        sample_id=Max("id"),
    )
    return grouped.annotate(
        group_rank=Case(
            When(debt_group=1, then=Value(FUNNEL_RANK["prevention"])),
            When(debt_group=2, then=Value(FUNNEL_RANK["warning"])),
            When(debt_group=3, then=Value(FUNNEL_RANK["disconnect"])),
            When(debt_group__in=(4, 5), then=Value(FUNNEL_RANK["enforcement"])),
            When(debt_group__gte=6, then=Value(FUNNEL_RANK["court"])),
            default=Value(FUNNEL_RANK["new"]),
            output_field=IntegerField(),
        ),
    )


def _lines_by_person(qs, keys: list) -> dict:
    from django.db.models import Prefetch

    from apps.debts.models import ServiceDebtPeriod
    from apps.debts.services.board_lines import board_service_lines

    if not keys:
        return {}
    rows = (
        _with_person(qs)
        .filter(person_key__in=keys)
        .prefetch_related(None)
        .prefetch_related(Prefetch("debt_periods", queryset=ServiceDebtPeriod.objects.order_by("period")))
        .order_by("service_name", "id")
    )
    bucket: dict = {}
    for service in rows:
        bucket.setdefault(service.person_key, []).append(service)
    return {key: board_service_lines(items) for key, items in bucket.items()}


def _registered_by_account(account_ids: list[int]) -> dict[int, int]:
    from apps.debts.models import Registration

    if not account_ids:
        return {}
    rows = (
        Registration.objects.filter(account_id__in=account_ids)
        .values("account_id")
        .annotate(total=Count("id"))
    )
    return {row["account_id"]: row["total"] for row in rows}


def _public_person(row, lines_by_key: dict, supplier: bool, registered: int | None = None) -> dict:
    lines, debt_count = lines_by_key.get(row["person_key"], ([], 0))
    extra = _person_extra(row, supplier)
    if registered is not None:
        extra["registered_count"] = registered
    return {
        "payer_identifier": row["payer_identifier"] or "",
        "payer_unp": row["payer_unp"] or "",
        "payer": row["payer"],
        "category": row["category"] or "",
        "ls_count": row["ls_count"],
        "principal": row["principal"],
        "penalty": row["penalty"],
        "earliest": row["earliest"],
        "sample_id": row["sample_id"],
        "service_lines": lines,
        "services_debt_count": debt_count,
        **extra,
    }


def person_page(qs, page: int, page_size: int, supplier: bool = False) -> tuple[int, list[dict]]:
    rows = _person_groups(qs).order_by("payer")
    total = rows.count()
    start = (page - 1) * page_size
    chunk = list(rows[start:start + page_size])
    keys = [row["person_key"] for row in chunk]
    lines = _lines_by_person(qs, keys)
    accounts = _account_ids(qs, keys)
    registered = _registered_by_account([item for values in accounts.values() for item in values])
    return total, [
        _public_person(
            row, lines, supplier,
            sum(registered.get(item, 0) for item in accounts.get(row["person_key"], [])),
        )
        for row in chunk
    ]


def kanban_columns(qs, stages: list[tuple[str, str]], page: int, page_size: int, supplier: bool = False) -> list[dict]:
    grouped = _person_groups(qs)
    columns = []
    start = (page - 1) * page_size
    rank_field = "group_rank" if supplier else "rank"
    for code, title in stages:
        rank = 1 if code == "new" else FUNNEL_RANK[code]
        column = grouped.filter(**{rank_field: rank}).order_by("payer")
        total = column.count()
        chunk = list(column[start:start + page_size])
        keys = [row["person_key"] for row in chunk]
        ids = _account_ids(qs, keys)
        lines = _lines_by_person(qs, keys)
        registered = _registered_by_account([item for values in ids.values() for item in values])
        columns.append({
            "stage": code,
            "title": title,
            "total": total,
            "cards": [
                {
                    **_public_person(
                        row, lines, supplier,
                        sum(registered.get(item, 0) for item in ids.get(row["person_key"], [])),
                    ),
                    "service_count": row["service_count"],
                    "service_name": row["service_name"] or "",
                    "address": row["address"] or "",
                    "debt_group": row["debt_group"],
                    "due_on": row["due_on"],
                    "account_ids": ids.get(row["person_key"], []),
                }
                for row in chunk
            ],
        })
    return columns


def _account_ids(qs, keys: list) -> dict:
    if not keys:
        return {}
    found: dict = {}
    rows = _with_person(qs).filter(person_key__in=keys).values_list("person_key", "account_id").distinct()
    for key, account_id in rows:
        found.setdefault(key, set()).add(account_id)
    return {key: sorted(ids) for key, ids in found.items()}


CLAIM_DOCUMENT_KINDS = ("writ", "claim", "impossibility", "closure", "enforcement_payment")


def _supplier_name(value: str | None) -> str:
    text = (value or "").strip()
    return text or "Поставщик не указан"


def _actions(rows, kind_key: str, choices) -> list[dict]:
    labels = dict(choices)
    result = []
    for row in rows:
        code = row[kind_key] or ""
        if not code:
            continue
        result.append({"kind": code, "label": labels.get(code, code), "total": row["total"]})
    return result


def _count_pairs(rows, provider_key: str, kind_key: str, id_key: str, choices) -> dict:
    """Считает действия по поставщику услуги, не подмешивая чужие услуги того же счёта."""
    labels = dict(choices)
    buckets: dict = {}
    for row in rows:
        kind = row[kind_key] or ""
        if not kind:
            continue
        buckets.setdefault(row[provider_key], {}).setdefault(kind, set()).add(row[id_key])
    return {
        provider_id: [
            {"kind": kind, "label": labels.get(kind, kind), "total": len(ids)}
            for kind, ids in kinds.items()
        ]
        for provider_id, kinds in buckets.items()
    }


def _merge_actions(*buckets: list[dict]) -> list[dict]:
    found: dict[str, dict] = {}
    for bucket in buckets:
        for item in bucket:
            slot = found.setdefault(item["kind"], {"kind": item["kind"], "label": item["label"], "total": 0})
            slot["total"] += item["total"]
    return sorted(found.values(), key=lambda item: item["label"])


def _loose_claim_documents(debt) -> tuple[list[dict], dict]:
    """Документ без услуги относится к лицевому счёту и виден каждому поставщику этого счёта."""
    from apps.debts.models import DebtWorkItem

    labels = dict(DebtWorkItem.Kind.choices)
    account_providers: dict = {}
    for account_id, provider_id in debt.values_list("account_id", "provider_id").distinct():
        account_providers.setdefault(account_id, set()).add(provider_id)
    per_provider: dict = {}
    totals: dict[str, set] = {}
    rows = DebtWorkItem.objects.filter(
        service__isnull=True,
        account_id__in=debt.values("account_id"),
        kind__in=CLAIM_DOCUMENT_KINDS,
    ).values_list("id", "kind", "account_id")
    for item_id, kind, account_id in rows:
        totals.setdefault(kind, set()).add(item_id)
        for provider_id in account_providers.get(account_id, ()):
            per_provider.setdefault(provider_id, {}).setdefault(kind, set()).add(item_id)
    total_actions = [
        {"kind": kind, "label": labels.get(kind, kind), "total": len(ids)}
        for kind, ids in totals.items()
    ]
    by_provider = {
        provider_id: [
            {"kind": kind, "label": labels.get(kind, kind), "total": len(ids)}
            for kind, ids in kinds.items()
        ]
        for provider_id, kinds in per_provider.items()
    }
    return total_actions, by_provider


def supplier_portfolio(qs) -> dict:
    """Срез реестра договоров: одна строка на поставщика, не на лицевой счёт.

    Число счетов, основной долг и пеня считаются по услугам с остатком.
    Мероприятие чужой услуги и документ по чужой услуге в строку не входят.
    Дело взыскания видно поставщику, у которого на этом счёте есть долг.
    """
    from apps.debts.models import ClaimCase, DebtWorkItem, Measure

    debt = qs.filter(Q(balance_out__gt=0) | Q(balance_mulct_out__gt=0) | Q(overdue_debt__gt=0))
    sums = debt.aggregate(
        ls_count=Count("account", distinct=True),
        principal=Sum("balance_out"),
        penalty=Sum("balance_mulct_out"),
    )
    groups = debt.order_by().values("provider_id").annotate(
        name=Max("shot_name"),
        ls_count=Count("account", distinct=True),
        principal=Sum("balance_out"),
        penalty=Sum("balance_mulct_out"),
    )
    measures_by_provider = _count_pairs(
        qs.order_by().filter(measures__isnull=False).values("provider_id", "measures__kind", "measures__id").distinct(),
        "provider_id", "measures__kind", "measures__id", Measure.Kind.choices,
    )
    cases_by_provider = _count_pairs(
        debt.order_by().filter(account__claim_case__isnull=False).values(
            "provider_id", "account__claim_case__stage", "account__claim_case__id",
        ).distinct(),
        "provider_id", "account__claim_case__stage", "account__claim_case__id", ClaimCase.Stage.choices,
    )
    documents_by_provider = _count_pairs(
        qs.order_by().filter(work_items__kind__in=CLAIM_DOCUMENT_KINDS).values(
            "provider_id", "work_items__kind", "work_items__id",
        ).distinct(),
        "provider_id", "work_items__kind", "work_items__id", DebtWorkItem.Kind.choices,
    )
    loose_total, loose_by_provider = _loose_claim_documents(debt)
    measure_total = _actions(
        Measure.objects.filter(services__in=qs).order_by().values("kind").annotate(total=Count("id", distinct=True)),
        "kind",
        Measure.Kind.choices,
    )
    case_total = _actions(
        ClaimCase.objects.filter(account_id__in=debt.values("account_id")).order_by().values("stage").annotate(
            total=Count("id", distinct=True),
        ),
        "stage",
        ClaimCase.Stage.choices,
    )
    document_total = _actions(
        DebtWorkItem.objects.filter(service__in=qs, kind__in=CLAIM_DOCUMENT_KINDS).order_by().values("kind").annotate(
            total=Count("id", distinct=True),
        ),
        "kind",
        DebtWorkItem.Kind.choices,
    )
    suppliers = []
    for row in groups:
        provider_id = row["provider_id"]
        suppliers.append({
            "provider_id": provider_id,
            "name": _supplier_name(row["name"]),
            "ls_count": row["ls_count"],
            "principal": row["principal"] or 0,
            "penalty": row["penalty"] or 0,
            "measures": _merge_actions(measures_by_provider.get(provider_id, [])),
            "claims": _merge_actions(
                cases_by_provider.get(provider_id, []),
                documents_by_provider.get(provider_id, []),
                loose_by_provider.get(provider_id, []),
            ),
        })
    suppliers.sort(key=lambda item: item["name"])
    return {
        "ls_count": sums["ls_count"] or 0,
        "principal": sums["principal"] or 0,
        "penalty": sums["penalty"] or 0,
        "measures": _merge_actions(measure_total),
        "claims": _merge_actions(case_total, document_total, loose_total),
        "suppliers": suppliers,
    }


def move_stage(user, accounts, stage: str, reason: str = "") -> None:
    """Этап карточки должника — этап всех его видимых лицевых счетов. Без основания переход не пишется."""
    from rest_framework.exceptions import PermissionDenied

    from apps.debts.models import StatusHistory
    from apps.users.access import can_skip_stage

    if not can_skip_stage(user):
        raise PermissionDenied("Этап воронки переносит администратор или специалист с согласованием")
    if getattr(user, "contour", "") == "supplier":
        raise ValidationError({"funnel_stage": "Поставщик не меняет этап воронки"})
    if stage not in FUNNEL_RANK:
        raise ValidationError({"funnel_stage": "Неизвестный этап"})
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError({"funnel_reason": "Укажите основание смены этапа воронки взыскания"})
    rows = list(accounts)
    if not rows:
        return
    organizations = {row.organization_id for row in rows}
    if len(organizations) > 1:
        raise ValidationError({"account_ids": "Несколько схем в одной операции"})
    for account in rows:
        if account.funnel_stage == stage:
            continue
        previous = account.funnel_stage
        account.funnel_stage = stage
        account.funnel_locked = True
        account.save(update_fields=["funnel_stage", "funnel_locked", "updated_at"])
        StatusHistory.objects.create(
            organization=account.organization, account=account, kind=StatusHistory.Kind.FUNNEL,
            old_value=previous, new_value=stage, reason=reason[:500], author=user,
        )
