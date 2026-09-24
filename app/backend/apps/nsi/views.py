"""Справочники НСИ: /api/v1/nsi/{dict}/. Новый справочник = новая запись в NSI_REGISTRY."""

from rest_framework import viewsets

from apps.audit.mixins import AuditedViewSetMixin
from apps.core.permissions import RolePermission

from .models import BnpDebtType, BnpDocType, BnpService, DebtGroupScale
from .serializers import BnpDebtTypeSerializer, BnpDocTypeSerializer, BnpServiceSerializer, DebtGroupScaleSerializer


class NsiViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    """Централизованные справочники: читают все, редактирует суперадминистратор; удаление = деактивация."""

    permission_classes = [RolePermission]
    write_roles = ("superadmin",)


def nsi_viewset(model, serializer, search: list[str], filters: list[str] | None = None):
    return type(
        f"{model.__name__}ViewSet",
        (NsiViewSet,),
        {
            "queryset": model.objects.all(),
            "serializer_class": serializer,
            "search_fields": search,
            "filterset_fields": filters or ["is_active"],
        },
    )


NSI_REGISTRY = {
    "debt-groups": nsi_viewset(DebtGroupScale, DebtGroupScaleSerializer, ["name"]),
    "bnp-services": nsi_viewset(BnpService, BnpServiceSerializer, ["name"], ["type_id", "is_active"]),
    "bnp-debt-types": nsi_viewset(BnpDebtType, BnpDebtTypeSerializer, ["code", "name"]),
    "bnp-doc-types": nsi_viewset(BnpDocType, BnpDocTypeSerializer, ["code", "name"]),
}
