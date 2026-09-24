import django_filters

from .models import Account


class AccountFilter(django_filters.FilterSet):
    q = django_filters.CharFilter(method="filter_q", label="Поиск (номер ЛС, ФИО, адрес)")
    debt_group = django_filters.NumberFilter()
    debt_group__in = django_filters.BaseInFilter(field_name="debt_group")
    balance_out__gte = django_filters.NumberFilter(field_name="balance_out", lookup_expr="gte")
    balance_out__lte = django_filters.NumberFilter(field_name="balance_out", lookup_expr="lte")

    class Meta:
        model = Account
        fields = ["provider_id", "organization", "is_private_enterprise", "house_id"]

    def filter_q(self, queryset, name, value):
        from .repositories import AccountRepository

        return AccountRepository.search(queryset, value)
