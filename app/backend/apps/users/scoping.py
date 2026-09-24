"""Контур доступа к данным: единственное место, где решается, что видит пользователь."""

from django.db.models import QuerySet


class AccessScope:
    """Правила контура: суперадмин видит всё; остальные — свою схему и назначенные ОО."""

    def __init__(self, user):
        self.user = user

    @property
    def is_unrestricted(self) -> bool:
        return self.user.is_superadmin

    def provider_ids(self) -> list[int]:
        return list(self.user.service_organizations.values_list("provider_id", flat=True))

    def apply(self, qs: QuerySet, organization_field: str | None, provider_field: str | None = None) -> QuerySet:
        if self.is_unrestricted:
            return qs
        if organization_field is None or self.user.organization_id is None:
            return qs.none()
        qs = qs.filter(**{organization_field: self.user.organization_id})
        if provider_field:
            providers = self.provider_ids()
            if providers:
                qs = qs.filter(**{f"{provider_field}__in": providers})
        return qs


class ScopedQuerysetMixin:
    """Миксин ViewSet: фильтрует queryset по контуру пользователя, в т.ч. для retrieve по id.

    scope_organization_field — путь к FK схемы (например, "organization" или "account__organization");
    scope_provider_field — путь к PROVIDER_ID обслуживающей организации (необязательно).
    """

    scope_organization_field: str | None = "organization"
    scope_provider_field: str | None = None

    def get_queryset(self):
        qs = super().get_queryset()
        return AccessScope(self.request.user).apply(qs, self.scope_organization_field, self.scope_provider_field)

    def get_scope_organization(self):
        """Схема для создаваемых объектов: у пользователя своя, суперадмин передаёт явно."""
        return self.request.user.organization
