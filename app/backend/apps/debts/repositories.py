"""Запросы к данным реестра ЛС (сложные выборки вынесены из вьюх)."""

from decimal import Decimal

from django.db.models import (
    Count, DateField, DecimalField, Exists, IntegerField, Max, Min, OuterRef, Q, QuerySet, Subquery, Sum,
)
from django.db.models.functions import Coalesce

from .models import Account, AccountService, ClaimCase, Measure, MeasureItem, Registration
from .services.registration_flags import active_q


def _text_token(field: str, part: str) -> Q:
    """Подстрока без учёта регистра ASCII; для кириллицы в SQLite — варианты регистра."""
    variants = {part, part.casefold(), part.lower(), part.upper(), part.capitalize(), part.title()}
    matched = Q()
    for item in variants:
        if item:
            matched |= Q(**{f"{field}__icontains": item})
    return matched


def _count_by_account(model, extra=None):
    rows = model.objects.filter(account_id=OuterRef("pk"))
    if extra is not None:
        rows = rows.filter(extra)
    return Coalesce(
        Subquery(
            rows.order_by()
            .values("account_id")
            .annotate(total=Count("pk"))
            .values("total")[:1],
            output_field=IntegerField(),
        ),
        0,
    )


def _sum_services(field: str):
    return Coalesce(
        Subquery(
            AccountService.objects.filter(account_id=OuterRef("pk"))
            .order_by()
            .values("account_id")
            .annotate(total=Sum(field))
            .values("total")[:1],
            output_field=DecimalField(max_digits=20, decimal_places=2),
        ),
        Decimal("0"),
    )


def supplier_annotations(provider_ids: list[int]) -> dict:
    """Суммы поставщика отдельными подзапросами, без JOIN услуг к каждому ЛС.

    Прежний Sum по services заставлял группировать строку счёта и тормозил поиск.
    Пустая выборка поставщика остаётся NULL у сумм и 0 у числа услуг, как раньше.
    """
    allowed = provider_ids or [-1]
    debt = Q(balance_out__gt=0) | Q(balance_mulct_out__gt=0) | Q(overdue_debt__gt=0)

    def scoped():
        return AccountService.objects.filter(account_id=OuterRef("pk"), provider_id__in=allowed)

    def total(field: str):
        return Subquery(
            scoped().order_by().values("account_id").annotate(total=Sum(field)).values("total")[:1],
            output_field=DecimalField(max_digits=20, decimal_places=2),
        )

    def extreme(agg, field, output):
        return Subquery(
            scoped().filter(debt).order_by().values("account_id").annotate(total=agg(field)).values("total")[:1],
            output_field=output,
        )

    counted = Coalesce(
        Subquery(
            scoped().order_by().values("account_id").annotate(total=Count("pk")).values("total")[:1],
            output_field=IntegerField(),
        ),
        0,
    )
    return {
        "supplier_principal": total("balance_out"),
        "supplier_penalty": total("balance_mulct_out"),
        "supplier_services": counted,
        "supplier_balance_in": total("balance_in"),
        "supplier_calc": total("calc_sum"),
        "supplier_paid": total("share_service_summ"),
        "supplier_subsidy": total("calc_result_sum"),
        "supplier_group": extreme(Max, Coalesce("debt_group_manual", "debt_group"), IntegerField()),
        "supplier_months": extreme(Max, "debt_period", IntegerField()),
        "supplier_started": extreme(Min, "debt_started_on", DateField()),
    }


class AccountRepository:
    def __init__(self, base: QuerySet | None = None):
        self.base = base if base is not None else Account.objects.all()

    def registry(self) -> QuerySet:
        """Реестр ЛС: итоги по услугам — отдельные подзапросы, без GROUP BY всей карточки.

        Соединение услуг и регистраций в одном JOIN раздувало сумму долга и заставляло
        PostgreSQL группировать исходный JSON выгрузки.
        """
        legal = Registration.objects.filter(account_id=OuterRef("pk"), subj_legal_entity=True)
        return self.base.defer("raw").select_related(
            "assigned_to", "debtor_category", "scenario_run__scenario",
        ).annotate(
            services_count=_count_by_account(AccountService),
            debt_total=_sum_services("balance_out"),
            mulct_total=_sum_services("balance_mulct_out"),
            registered_count=_count_by_account(Registration, active_q()),
            is_legal=Exists(legal),
            sort_group=Coalesce("debt_group_manual", "debt_group"),
        ).order_by("client_account", "id")

    @staticmethod
    def search(qs: QuerySet, term: str) -> QuerySet:
        """Поиск по номеру ЛС (с ведущими нулями и без), ФИО и адресу.

        Несколько слов («советская 17») — каждое должно встретиться в той же
        строке адреса или ФИО; иначе «ул. Советская, д. 17» не находится.
        """
        term = term.strip()
        if not term:
            return qs
        tokens = [part for part in term.split() if part]
        if len(tokens) > 1:
            address = Q()
            fio = Q()
            for part in tokens:
                address &= _text_token("account_address", part)
                fio &= _text_token("short_fio", part)
            condition = address | fio
            for part in tokens:
                condition |= (
                    _text_token("client_account", part)
                    | _text_token("payer_identifier", part)
                    | _text_token("payer_unp", part)
                    | _text_token("provider_short_name", part)
                    | _text_token("schema_name", part)
                )
                if part.isdigit():
                    condition |= Q(client_account__endswith=part.lstrip("0") or "0") | Q(
                        unified_account=int(part),
                    ) | Q(account_id=int(part))
            return qs.filter(condition)
        condition = (
            Q(client_account__icontains=term)
            | Q(short_fio__icontains=term)
            | Q(account_address__icontains=term)
            | Q(provider_short_name__icontains=term)
            | Q(ownership_type_name__icontains=term)
            | Q(acc_category_full__icontains=term)
            | Q(scenario_name__icontains=term)
            | Q(schema_name__icontains=term)
            | Q(assigned_to__last_name__icontains=term)
            | Q(assigned_to__first_name__icontains=term)
            | Q(scenario_run__scenario__name__icontains=term)
        )
        if term.isdigit():
            condition |= Q(client_account__endswith=term.lstrip("0") or "0") | Q(unified_account=int(term)) | Q(
                account_id=int(term)
            )
        condition |= Q(payer_identifier__icontains=term) | Q(payer_unp__icontains=term)
        # Все условия — поля счёта или связь «один к одному». distinct() здесь
        # заставлял PostgreSQL сортировать всю выборку перед каждой страницей поиска.
        return qs.filter(condition)

    def group_summary(self) -> list[dict]:
        rows = (
            self.base.annotate(shown=Coalesce("debt_group_manual", "debt_group"))
            .values("shown")
            .annotate(accounts=Count("id"), debt=Sum("balance_out"))
            .order_by("shown")
        )
        return [{"debt_group": row["shown"], "accounts": row["accounts"], "debt": row["debt"]} for row in rows]

    @staticmethod
    def with_board_marks(qs: QuerySet) -> QuerySet:
        """Даты для подписи карточки канбана: вручение, наряд, подача."""
        handed = (
            MeasureItem.objects.filter(
                account_id=OuterRef("pk"), measure__kind=Measure.Kind.WARNING, delivered_on__isnull=False,
            )
            .order_by("-delivered_on")
            .values("delivered_on")[:1]
        )
        order = (
            Measure.objects.filter(accounts=OuterRef("pk"), kind=Measure.Kind.DISCONNECT)
            .order_by("-started_on", "-id")
            .values("started_on")[:1]
        )
        filed = ClaimCase.objects.filter(account_id=OuterRef("pk")).values("lawsuit_filed_on")[:1]
        package = ClaimCase.objects.filter(account_id=OuterRef("pk")).values("package_filed_on")[:1]
        return qs.annotate(
            warning_handed_on=Subquery(handed),
            order_on=Subquery(order),
            filed_on=Subquery(filed),
            package_on=Subquery(package),
        )
