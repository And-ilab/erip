"""Запросы к данным реестра ЛС (сложные выборки вынесены из вьюх)."""

from django.db.models import Count, OuterRef, Q, QuerySet, Subquery, Sum
from django.db.models.functions import Coalesce

from .models import Account, ClaimCase, Measure, MeasureItem


class AccountRepository:
    def __init__(self, base: QuerySet | None = None):
        self.base = base if base is not None else Account.objects.all()

    def registry(self) -> QuerySet:
        """Реестр ЛС: итоги по услугам считаются в одном запросе."""
        # Meta.ordering не применяется к запросам с GROUP BY — порядок задаётся явно
        return self.base.select_related("assigned_to", "debtor_category").annotate(
            services_count=Count("services", distinct=True),
            debt_total=Sum("services__balance_out"),
            mulct_total=Sum("services__balance_mulct_out"),
            sort_group=Coalesce("debt_group_manual", "debt_group"),
        ).order_by("client_account", "id")

    @staticmethod
    def search(qs: QuerySet, term: str) -> QuerySet:
        """Поиск по номеру ЛС (с ведущими нулями и без), ФИО и адресу."""
        term = term.strip()
        if not term:
            return qs
        condition = Q(client_account__icontains=term) | Q(short_fio__icontains=term) | Q(
            account_address__icontains=term
        )
        if term.isdigit():
            condition |= Q(client_account__endswith=term.lstrip("0") or "0") | Q(unified_account=int(term)) | Q(
                account_id=int(term)
            )
        condition |= Q(payer_identifier__icontains=term) | Q(payer_unp__icontains=term)
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
