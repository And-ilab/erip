"""Какие подписи организации показывать в списках.

Колонка нужна, только если в области пользователя таких организаций больше одной.
Одна схема, один поставщик или одна обслуживающая организация уже видны в шапке.
"""

from apps.users.models import ServiceOrganization, User


def identity_columns(user) -> dict[str, bool]:
    hidden = {"show_schema": False, "show_supplier": False, "show_service_org": False}
    if not getattr(user, "is_authenticated", False):
        return hidden
    if getattr(user, "is_superadmin", False):
        return {"show_schema": True, "show_supplier": True, "show_service_org": True}
    organization_id = getattr(user, "organization_id", None)
    if organization_id is None:
        return hidden

    from apps.debts.models import Account, AccountService

    bound_ids = list(user.service_organizations.filter(is_active=True).values_list("provider_id", flat=True))
    if getattr(user, "contour", "") == User.Contour.SUPPLIER:
        if not bound_ids:
            return hidden
        service_orgs = (
            Account.objects.filter(organization_id=organization_id, services__provider_id__in=bound_ids)
            .values("provider_id")
            .distinct()
            .count()
        )
        return {
            "show_schema": False,
            "show_supplier": len(bound_ids) > 1,
            "show_service_org": service_orgs > 1,
        }

    account_ids = bound_ids or list(
        ServiceOrganization.objects.filter(organization_id=organization_id, is_active=True)
        .values_list("provider_id", flat=True)
    )
    services = AccountService.objects.filter(organization_id=organization_id).exclude(provider_id=None)
    if bound_ids:
        services = services.filter(account__provider_id__in=bound_ids)
    return {
        "show_schema": False,
        "show_supplier": services.values("provider_id").distinct().count() > 1,
        "show_service_org": len(account_ids) > 1,
    }
