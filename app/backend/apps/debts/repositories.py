"""Запросы к данным реестра ЛС (сложные выборки вынесены из вьюх)."""

from django.db.models import Count, Q, QuerySet, Sum

from .models import Account


class AccountRepository:
    def __init__(self, base: QuerySet | None = None):
        self.base = base if base is not None else Account.objects.all()

    def registry(self) -> QuerySet:
        """Реестр ЛС: итоги по услугам считаются в одном запросе."""
        # Meta.ordering не применяется к запросам с GROUP BY — порядок задаётся явно
        return self.base.annotate(
            services_count=Count("services", distinct=True),
            debt_total=Sum("services__balance_out"),
            mulct_total=Sum("services__balance_mulct_out"),
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
            condition |= Q(client_account__endswith=term.lstrip("0") or "0") | Q(unified_account=int(term))
        return qs.filter(condition)

    def group_summary(self) -> list[dict]:
        return list(
            self.base.values("debt_group").annotate(accounts=Count("id"), debt=Sum("balance_out")).order_by("debt_group")
        )
