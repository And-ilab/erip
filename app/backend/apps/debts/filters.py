import django_filters
from django.db.models import Q
from rest_framework.exceptions import ValidationError
from rest_framework.filters import OrderingFilter

from .models import Account, AccountService, Measure
from .services.registry import parse_month, period_overlap


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
    rating__in = django_filters.BaseInFilter(field_name="rating")
    funnel_stage = django_filters.CharFilter(field_name="funnel_stage")
    assigned_to = django_filters.NumberFilter(field_name="assigned_to")
    assigned_name = django_filters.CharFilter(method="filter_assigned_name")
    ownership = django_filters.CharFilter(field_name="ownership_type_name", lookup_expr="icontains")
    housing = django_filters.CharFilter(field_name="acc_category_full", lookup_expr="icontains")
    months_debt = django_filters.NumberFilter(field_name="months_debt")
    subj_count = django_filters.NumberFilter(field_name="subj_count")
    period_from = django_filters.DateFilter(field_name="debt_started_on", lookup_expr="gte")
    period_to = django_filters.DateFilter(field_name="debt_started_on", lookup_expr="lte")
    debtor_category = django_filters.NumberFilter(field_name="debtor_category")
    account_id = django_filters.NumberFilter(field_name="account_id")
    inheritance_case = django_filters.BooleanFilter(field_name="inheritance_case")
    territory = django_filters.NumberFilter(method="filter_territory")
    scope = django_filters.CharFilter(method="filter_scope")

    class Meta:
        model = Account
        fields = ["provider_id", "organization", "is_private_enterprise", "house_id"]

    def filter_assigned_name(self, queryset, name, value):
        text = str(value).strip()
        if not text:
            return queryset
        return queryset.filter(
            Q(assigned_to__first_name__icontains=text)
            | Q(assigned_to__last_name__icontains=text)
            | Q(assigned_to__middle_name__icontains=text)
            | Q(assigned_to__username__icontains=text)
        )

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

    def filter_territory(self, queryset, name, value):
        return queryset.filter(territory__ancestor_links__ancestor_id=value).distinct()

    def filter_scope(self, queryset, name, value):
        if value == "claims":
            from apps.debts.services.claims import claims_population

            return claims_population(queryset)
        return queryset


class ContractFilter(django_filters.FilterSet):
    debt_group = django_filters.NumberFilter(method="filter_effective_group")
    debt_group__in = django_filters.BaseInFilter(method="filter_effective_groups")
    debtor_category = django_filters.NumberFilter(field_name="account__debtor_category")
    billing_provider = django_filters.CharFilter(method="filter_billing")
    funnel_stage = django_filters.CharFilter(field_name="account__funnel_stage")
    assigned_to = django_filters.NumberFilter(field_name="account__assigned_to")
    assigned_name = django_filters.CharFilter(method="filter_assigned_name")
    ownership = django_filters.CharFilter(field_name="account__ownership_type_name", lookup_expr="icontains")
    housing = django_filters.CharFilter(field_name="account__acc_category_full", lookup_expr="icontains")
    months_debt = django_filters.NumberFilter(field_name="debt_period")
    subj_count = django_filters.NumberFilter(field_name="account__subj_count")
    period_from = django_filters.DateFilter(field_name="debt_started_on", lookup_expr="gte")
    period_to = django_filters.DateFilter(field_name="debt_started_on", lookup_expr="lte")
    inheritance_case = django_filters.BooleanFilter(field_name="account__inheritance_case")

    class Meta:
        model = AccountService
        fields = ["account", "service_id", "provider_id"]

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

    def filter_assigned_name(self, queryset, name, value):
        text = str(value).strip()
        if not text:
            return queryset
        return queryset.filter(
            Q(account__assigned_to__first_name__icontains=text)
            | Q(account__assigned_to__last_name__icontains=text)
            | Q(account__assigned_to__middle_name__icontains=text)
            | Q(account__assigned_to__username__icontains=text)
        )

    def filter_billing(self, queryset, name, value):
        text = str(value).strip()
        if not text:
            return queryset
        condition = Q(account__provider_short_name__icontains=text) | Q(account__schema_name__icontains=text)
        if text.isdigit():
            condition |= Q(account__provider_id=int(text))
        return queryset.filter(condition)


class MeasureFilter(django_filters.FilterSet):
    search = django_filters.CharFilter(method="filter_search")
    period = django_filters.CharFilter(method="filter_period")
    debt_group = django_filters.NumberFilter(method="filter_group")
    debt_group__in = django_filters.BaseInFilter(method="filter_groups")
    rating = django_filters.CharFilter(method="filter_rating")
    rating__in = django_filters.BaseInFilter(method="filter_ratings")
    funnel_stage = django_filters.CharFilter(method="filter_stage")

    class Meta:
        model = Measure
        fields = ["kind", "status"]

    def filter_search(self, queryset, name, value):
        text = (value or "").strip()
        if not text:
            return queryset
        needle = text.casefold()
        kinds = [
            code for code, label in Measure.Kind.choices
            if len(needle) >= 4 and label.casefold().startswith(needle)
        ]
        condition = (
            Q(accounts__client_account__icontains=text)
            | Q(accounts__short_fio__icontains=text)
            | Q(template_name__icontains=text)
            | Q(scenario_name__icontains=text)
            | Q(note__icontains=text)
        )
        if kinds:
            condition |= Q(kind__in=kinds)
        return queryset.filter(condition).distinct()

    @staticmethod
    def _shown_group(value):
        return Q(accounts__debt_group_manual=value) | Q(accounts__debt_group_manual__isnull=True, accounts__debt_group=value)

    def filter_group(self, queryset, name, value):
        return queryset.filter(self._shown_group(value)).distinct()

    def filter_groups(self, queryset, name, value):
        condition = Q()
        for item in value:
            condition |= self._shown_group(item)
        return queryset.filter(condition).distinct()

    def filter_rating(self, queryset, name, value):
        return queryset.filter(accounts__rating=value).distinct()

    def filter_ratings(self, queryset, name, value):
        return queryset.filter(accounts__rating__in=value).distinct()

    def filter_stage(self, queryset, name, value):
        return queryset.filter(accounts__funnel_stage=value).distinct()

    def filter_period(self, queryset, name, value):
        parsed = parse_month(value)
        if parsed is None:
            raise ValidationError({"period": "Ожидается месяц в формате ГГГГ-ММ"})
        start, end = parsed
        return queryset.filter(period_overlap(start, end))
