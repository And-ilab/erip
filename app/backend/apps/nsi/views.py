"""Справочники НСИ: /api/v1/nsi/{dict}/. Новый справочник = новая запись в NSI_REGISTRY."""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
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
    PrintForm,
    ScenarioDefinition,
    ScenarioRule,
)
from .serializers import (
    BnpDebtTypeSerializer,
    BnpDocTypeSerializer,
    BnpServiceSerializer,
    CalculationSettingsSerializer,
    DebtGroupScaleSerializer,
    DebtorCategorySerializer,
    PrintFormSerializer,
    ScenarioDefinitionSerializer,
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


class ScenarioDefinitionViewSet(NsiViewSet):
    """Черновик правит администратор схемы. Центральный сценарий — только суперадминистратор."""

    queryset = ScenarioDefinition.objects.all()
    serializer_class = ScenarioDefinitionSerializer
    search_fields = ["name"]
    filterset_fields = ["is_active", "status"]
    write_roles = ("superadmin", "local_admin", "specialist")

    def get_queryset(self):
        from .services.scenarios import ensure_standard_scenario

        ensure_standard_scenario()
        user = self.request.user
        qs = self.queryset.prefetch_related("revisions__author")
        if user.is_superadmin:
            return qs
        return qs.filter(organization__isnull=True) | qs.filter(organization=user.organization)

    def perform_create(self, serializer):
        self._admin_only()
        self._check_steps(serializer.validated_data.get("steps") or [])
        organization = None if self.request.user.is_superadmin else self.request.user.organization
        serializer.save(organization=organization, status=ScenarioDefinition.Status.DRAFT, version=1)
        record_action(self.request, AuditLog.Action.CREATE, serializer.instance)

    def perform_update(self, serializer):
        self._admin_only()
        self._deny_central(serializer.instance)
        if "steps" in serializer.validated_data:
            self._check_steps(serializer.validated_data["steps"])
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        self._admin_only()
        self._deny_central(instance)
        super().perform_destroy(instance)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        from .services.scenarios import publish

        self._admin_only()
        scenario = self.get_object()
        self._deny_central(scenario)
        warnings, moved = publish(
            scenario, request.user, apply_to_running=bool(request.data.get("apply_to_running")),
        )
        record_action(request, AuditLog.Action.UPDATE, scenario, after={"moved": moved})
        return Response({
            "id": scenario.pk, "version": scenario.version, "warnings": warnings, "moved": moved,
        })

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        from .services.scenarios import restore_scenario

        self._admin_only()
        scenario = self.get_object()
        self._deny_central(scenario)
        warnings, moved = restore_scenario(
            scenario, int(request.data.get("version") or 0), request.user,
            apply_to_running=bool(request.data.get("apply_to_running")),
        )
        record_action(request, AuditLog.Action.UPDATE, scenario, after={"restored": request.data.get("version"), "moved": moved})
        scenario = self.get_queryset().get(pk=scenario.pk)
        return Response(self.get_serializer(scenario).data | {
            "warnings": warnings, "moved": moved,
        })

    @action(detail=True, methods=["post"])
    def copy(self, request, pk=None):
        from .services.scenarios import copy_scenario

        self._admin_only()
        source = self.get_object()
        created = copy_scenario(source, request.user)
        record_action(request, AuditLog.Action.CREATE, created)
        return Response(self.get_serializer(created).data, status=201)

    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        from apps.debts.models import Account
        from apps.users.scoping import AccessScope

        from .services.scenarios import assign_run

        scenario = self.get_object()
        account = AccessScope(request.user).apply(
            Account.objects.all(), "organization", "provider_id",
        ).filter(pk=request.data.get("account")).first()
        if account is None:
            raise ValidationError({"account": "Лицевой счёт не найден"})
        run = assign_run(
            account, scenario, request.user,
            upgrade=bool(request.data.get("upgrade")),
            paused=bool(request.data.get("paused")),
            reason=str(request.data.get("pause_reason") or ""),
        )
        record_action(request, AuditLog.Action.UPDATE, run)
        return Response({
            "account": account.pk, "scenario": scenario.pk, "version": run.version,
            "paused": run.paused, "pause_reason": run.pause_reason,
            "current_version": scenario.version,
        })

    def _admin_only(self) -> None:
        if self.request.user.role == "specialist":
            raise PermissionDenied("Сценарий настраивает администратор организации")

    def _deny_central(self, scenario: ScenarioDefinition) -> None:
        if scenario.organization_id is None and not self.request.user.is_superadmin:
            raise PermissionDenied("Центральный сценарий меняет суперадминистратор. Скопируйте его в схему.")

    def _check_steps(self, steps) -> None:
        from .services.scenarios import check_steps

        if steps:
            check_steps(steps)


class PrintFormViewSet(NsiViewSet):
    queryset = PrintForm.objects.all()
    serializer_class = PrintFormSerializer
    search_fields = ["name", "code"]
    filterset_fields = ["is_active", "doc_kind"]
    write_roles = ("superadmin", "local_admin", "specialist")

    def get_queryset(self):
        user = self.request.user
        qs = self.queryset.prefetch_related("revisions")
        if user.is_superadmin:
            return qs
        return qs.filter(organization__isnull=True) | qs.filter(organization=user.organization)

    def perform_create(self, serializer):
        if self.request.user.role == "specialist":
            raise PermissionDenied("Макет настраивает администратор организации")
        from .services.scenarios import remember_print_version

        organization = None if self.request.user.is_superadmin else self.request.user.organization
        serializer.save(organization=organization)
        remember_print_version(serializer.instance, None)
        record_action(self.request, AuditLog.Action.CREATE, serializer.instance)

    def perform_update(self, serializer):
        from .services.scenarios import remember_print_version

        if self.request.user.role == "specialist":
            raise PermissionDenied("Макет настраивает администратор организации")
        if serializer.instance.organization_id is None and not self.request.user.is_superadmin:
            raise PermissionDenied("Центральный макет меняет суперадминистратор")
        previous = serializer.instance.body
        super().perform_update(serializer)
        remember_print_version(serializer.instance, previous)

    @action(detail=True, methods=["post"])
    def render(self, request, pk=None):
        from apps.debts.models import Account
        from apps.users.scoping import AccessScope

        from .services.scenarios import render_print

        form = self.get_object()
        account = AccessScope(request.user).apply(
            Account.objects.select_related("organization"), "organization", "provider_id",
        ).filter(pk=request.data.get("account")).first()
        if account is None:
            raise ValidationError({"account": "Лицевой счёт не найден"})
        text = render_print(form, account, tariff=str(request.data.get("tariff") or ""))
        record_action(request, AuditLog.Action.CREATE, form, after={"account": account.pk, "version": form.version})
        return Response({"text": text, "version": form.version})

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        from .services.scenarios import restore_print

        if request.user.role == "specialist":
            raise PermissionDenied("Макет настраивает администратор организации")
        form = self.get_object()
        if form.organization_id is None and not request.user.is_superadmin:
            raise PermissionDenied("Центральный макет меняет суперадминистратор")
        restore_print(form, int(request.data.get("version") or 0))
        record_action(request, AuditLog.Action.UPDATE, form, after={"restored": request.data.get("version")})
        form = self.get_queryset().get(pk=form.pk)
        return Response(self.get_serializer(form).data)


NSI_REGISTRY = {
    "debt-groups": nsi_viewset(DebtGroupScale, DebtGroupScaleSerializer, ["name"]),
    "debtor-categories": DebtorCategoryViewSet,
    "scenario-rules": nsi_viewset(ScenarioRule, ScenarioRuleSerializer, ["name"]),
    "scenarios": ScenarioDefinitionViewSet,
    "print-forms": PrintFormViewSet,
    "calculation-settings": CalculationSettingsViewSet,
    "bnp-services": nsi_viewset(BnpService, BnpServiceSerializer, ["name"], ["type_id", "is_active"]),
    "bnp-debt-types": nsi_viewset(BnpDebtType, BnpDebtTypeSerializer, ["code", "name"]),
    "bnp-doc-types": nsi_viewset(BnpDocType, BnpDocTypeSerializer, ["code", "name"]),
}
