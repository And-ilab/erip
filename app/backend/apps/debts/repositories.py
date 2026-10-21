"""Запросы к данным реестра ЛС (сложные выборки вынесены из вьюх)."""

from decimal import Decimal

from django.db.models import Count, DecimalField, Exists, IntegerField, OuterRef, Q, QuerySet, Subquery, Sum
from django.db.models.functions import Coalesce

from .models import Account, AccountService, ClaimCase, Measure, MeasureItem, Registration


def _count_by_account(model):
    return Coalesce(
        Subquery(
            model.objects.filter(account_id=OuterRef("pk"))
            .order_by()
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
            registered_count=_count_by_account(Registration),
            is_legal=Exists(legal),
            sort_group=Coalesce("debt_group_manual", "debt_group"),
        ).order_by("client_account", "id")

    @staticmethod
    def search(qs: QuerySet, term: str) -> QuerySet:
        """Поиск по номеру ЛС (с ведущими нулями и без), ФИО и адресу."""
        term = term.strip()
        if not term:
            return qs
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
        return qs.filter(condition).distinct()

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
