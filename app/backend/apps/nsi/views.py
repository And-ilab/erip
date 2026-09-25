"""Справочники НСИ: /api/v1/nsi/{dict}/. Новый справочник = новая запись в NSI_REGISTRY."""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.mixins import AuditedViewSetMixin
from apps.audit.models import AuditLog
from apps.audit.services import record_action
from apps.core.permissions import RolePermission

from .models import (
    BnpDebtType,
    BnpDocType,
    BnpService,
    CalculationSettings,
    DebtGroupScale,
    DebtorCategory,
    ScenarioRule,
)
from .serializers import (
    BnpDebtTypeSerializer,
    BnpDocTypeSerializer,
    BnpServiceSerializer,
    CalculationSettingsSerializer,
    DebtGroupScaleSerializer,
    DebtorCategorySerializer,
    ScenarioRuleSerializer,
)


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


class DebtorCategoryViewSet(NsiViewSet):
    """Центральные категории правит суперадминистратор, локальные — администратор схемы."""

    queryset = DebtorCategory.objects.all()
    serializer_class = DebtorCategorySerializer
    search_fields = ["name", "code"]
    filterset_fields = ["is_active", "organization"]
    write_roles = ("superadmin", "local_admin", "specialist")

    def get_queryset(self):
        qs = self.queryset
        user = self.request.user
        if user.is_superadmin:
            return qs
        return qs.filter(organization__isnull=True) | qs.filter(organization=user.organization)

    def perform_create(self, serializer):
        if not self.request.user.is_superadmin:
            serializer.save(organization=self.request.user.organization)
        else:
            serializer.save()
        record_action(self.request, AuditLog.Action.CREATE, serializer.instance)

    def perform_update(self, serializer):
        from rest_framework.exceptions import PermissionDenied

        if serializer.instance.organization_id is None and not self.request.user.is_superadmin:
            raise PermissionDenied("Центральную категорию меняет суперадминистратор")
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        from rest_framework.exceptions import PermissionDenied

        if instance.organization_id is None and not self.request.user.is_superadmin:
            raise PermissionDenied("Центральную категорию меняет суперадминистратор")
        super().perform_destroy(instance)


class CalculationSettingsViewSet(NsiViewSet):
    queryset = CalculationSettings.objects.all()
    serializer_class = CalculationSettingsSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def list(self, request, *args, **kwargs):
        return Response(self.get_serializer(CalculationSettings.load()).data)

    @action(detail=False, methods=["patch"])
    def current(self, request):
        serializer = self.get_serializer(CalculationSettings.load(), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


NSI_REGISTRY = {
    "debt-groups": nsi_viewset(DebtGroupScale, DebtGroupScaleSerializer, ["name"]),
    "debtor-categories": DebtorCategoryViewSet,
    "scenario-rules": nsi_viewset(ScenarioRule, ScenarioRuleSerializer, ["name"]),
    "calculation-settings": CalculationSettingsViewSet,
    "bnp-services": nsi_viewset(BnpService, BnpServiceSerializer, ["name"], ["type_id", "is_active"]),
    "bnp-debt-types": nsi_viewset(BnpDebtType, BnpDebtTypeSerializer, ["code", "name"]),
    "bnp-doc-types": nsi_viewset(BnpDocType, BnpDocTypeSerializer, ["code", "name"]),
}
