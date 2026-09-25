import django_filters
from django.db.models import Q
from rest_framework.filters import OrderingFilter

from .models import Account


class AccountOrderingFilter(OrderingFilter):
    """Сортировка «группа» идёт по показанной группе: ручная, иначе расчётная."""

    def get_ordering(self, request, queryset, view):
        raw = request.query_params.get(self.ordering_param)
        if not raw:
            return self.get_default_ordering(view)
        allowed = set(getattr(view, "ordering_fields", []))
        fields = []
        for part in raw.split(","):
            part = part.strip()
            if not part:
                continue
            desc = part.startswith("-")
            name = part[1:] if desc else part
            if name == "debt_group":
                name = "sort_group"
            if name not in allowed and name != "sort_group":
                continue
            fields.append(f"-{name}" if desc else name)
        return fields or self.get_default_ordering(view)


class AccountFilter(django_filters.FilterSet):
    q = django_filters.CharFilter(method="filter_q", label="Поиск (номер ЛС, ФИО, адрес)")
    debt_group = django_filters.NumberFilter(method="filter_effective_group")
    debt_group__in = django_filters.BaseInFilter(method="filter_effective_groups")
    balance_out__gte = django_filters.NumberFilter(field_name="balance_out", lookup_expr="gte")
    balance_out__lte = django_filters.NumberFilter(field_name="balance_out", lookup_expr="lte")
    rating = django_filters.CharFilter(field_name="rating")
    funnel_stage = django_filters.CharFilter(field_name="funnel_stage")
    assigned_to = django_filters.NumberFilter(field_name="assigned_to")
    debtor_category = django_filters.NumberFilter(field_name="debtor_category")
    account_id = django_filters.NumberFilter(field_name="account_id")
    inheritance_case = django_filters.BooleanFilter(field_name="inheritance_case")

    class Meta:
        model = Account
        fields = ["provider_id", "organization", "is_private_enterprise", "house_id"]

    def filter_q(self, queryset, name, value):
        from .repositories import AccountRepository

        return AccountRepository.search(queryset, value)

    @staticmethod
    def _shown_group(value):
        return Q(debt_group_manual=value) | Q(debt_group_manual__isnull=True, debt_group=value)

    def filter_effective_group(self, queryset, name, value):
        return queryset.filter(self._shown_group(value))

    def filter_effective_groups(self, queryset, name, value):
        condition = Q()
        for item in value:
            condition |= self._shown_group(item)
        return queryset.filter(condition)
