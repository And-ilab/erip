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
        if request.data.get("apply_recorded"):
            from apps.debts.services.portfolio import apply_rating_now

            apply_rating_now()
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
        from apps.debts.models import ScenarioPause

        pauses = [
            {"paused": item.paused, "reason": item.reason, "at": item.created_at.isoformat(),
             "actor": item.actor.display_name if item.actor_id else ""}
            for item in ScenarioPause.objects.filter(run=run).select_related("actor")[:20]
        ]
        return Response({
            "account": account.pk, "scenario": scenario.pk, "version": run.version,
            "paused": run.paused, "pause_reason": run.pause_reason,
            "current_version": scenario.version, "last_skip": run.last_skip, "pauses": pauses,
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

    @action(detail=False, methods=["get", "patch"], url_path="calling")
    def calling(self, request):
        """Признак обзвона юридических лиц схемы. Дни номера читаются из общих настроек."""
        self._admin_only()
        organization = request.user.organization
        if organization is None:
            raise ValidationError({"organization": "У пользователя нет схемы"})
        if request.method == "PATCH":
            organization.call_legal = bool(request.data.get("call_legal"))
            organization.save(update_fields=["call_legal", "updated_at"])
        settings = CalculationSettings.load()
        return Response({
            "call_legal": organization.call_legal,
            "dial_mobile_from_day": settings.dial_mobile_from_day,
            "dial_mobile_weekdays": settings.dial_mobile_weekdays,
        })


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
        from .services.scenarios import layout_of

        previous = serializer.instance.body
        previous_layout = layout_of(serializer.instance)
        super().perform_update(serializer)
        remember_print_version(serializer.instance, previous, previous_layout)

    @action(detail=True, methods=["post"])
    def render(self, request, pk=None):
        from apps.debts.models import Account
        from apps.users.scoping import AccessScope

        from .services.scenarios import new_batch, render_print

        form = self.get_object()
        raw_ids = request.data.get("accounts")
        if raw_ids in (None, ""):
            raw_ids = [request.data.get("account")] if request.data.get("account") else []
        if not isinstance(raw_ids, list) or not raw_ids or len(raw_ids) > 100:
            raise ValidationError({"accounts": "Передайте от 1 до 100 лицевых счетов"})
        visible = AccessScope(request.user).apply(
            Account.objects.select_related("organization"), "organization", "provider_id",
        )
        accounts = list(visible.filter(pk__in=raw_ids))
        if len(accounts) != len(set(raw_ids)):
            raise ValidationError({"accounts": "Лицевой счёт не найден"})
        batch = new_batch() if len(accounts) > 1 else ""
        tariff = str(request.data.get("tariff") or "")
        documents = [render_print(form, account, tariff=tariff, batch=batch) for account in accounts]
        record_action(request, AuditLog.Action.CREATE, form, after={"accounts": raw_ids, "version": form.version})
        payload = [_document_payload(item) for item in documents]
        if len(payload) == 1:
            return Response(payload[0] | {"documents": payload, "batch": batch})
        return Response({"batch": batch, "version": form.version, "documents": payload, "text": payload[0]["text"]})

    @action(detail=True, methods=["get"], url_path=r"documents/(?P<doc_id>[0-9]+)")
    def document(self, request, pk=None, doc_id=None):
        from django.http import FileResponse

        from apps.debts.models import Account
        from apps.users.scoping import AccessScope

        from .models import PrintedDocument

        form = self.get_object()
        printed = PrintedDocument.objects.filter(form=form, pk=doc_id).select_related("account").first()
        if printed is None:
            raise ValidationError({"document": "Документ не найден"})
        visible = AccessScope(request.user).apply(Account.objects.all(), "organization", "provider_id")
        if not visible.filter(pk=printed.account_id).exists():
            raise ValidationError({"document": "Документ не найден"})
        return FileResponse(printed.file.open("rb"), as_attachment=True, filename=printed.file.name.rsplit("/", 1)[-1])

    @action(detail=True, methods=["get"], url_path=r"package/(?P<batch>[0-9a-f]+)")
    def package(self, request, pk=None, batch=None):
        from django.http import FileResponse

        from django.core.files.base import ContentFile

        from .services.scenarios import package_pdf

        form = self.get_object()
        if not form.documents.filter(batch=batch).exists():
            raise ValidationError({"batch": "Пакет не найден"})
        payload = package_pdf(form, batch)
        return FileResponse(ContentFile(payload), as_attachment=True, filename=f"{form.code}-{batch[:8]}.pdf")

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


def _document_payload(document) -> dict:
    return {
        "id": document.pk,
        "account": document.account_id,
        "version": document.version,
        "text": document.body,
        "addressee": document.addressee,
        "batch": document.batch,
    }


class DebtGroupScaleViewSet(NsiViewSet):
    queryset = DebtGroupScale.objects.all()
    serializer_class = DebtGroupScaleSerializer
    search_fields = ["name"]

    def perform_destroy(self, instance):
        from .services.scale import scale_problem

        rows = [
            (row.group, row.months_from, row.months_to)
            for row in DebtGroupScale.objects.filter(is_active=True).exclude(pk=instance.pk)
        ]
        problem = scale_problem(rows)
        if problem:
            raise ValidationError(problem)
        super().perform_destroy(instance)

    @action(detail=False, methods=["put"])
    def replace(self, request):
        from .services.scale import scale_problem

        rows = request.data if isinstance(request.data, list) else None
        if not isinstance(rows, list) or not rows:
            raise ValidationError("Передайте список групп")
        bands = []
        for row in rows:
            end = row.get("months_to")
            bands.append((int(row["group"]), int(row["months_from"]), None if end in (None, "") else int(end)))
        problem = scale_problem(bands)
        if problem:
            raise ValidationError(problem)
        for row, band in zip(rows, bands, strict=True):
            DebtGroupScale.objects.update_or_create(
                group=band[0],
                defaults={
                    "name": row.get("name") or f"Группа {band[0]}",
                    "months_from": band[1],
                    "months_to": band[2],
                    "is_active": True,
                    "deactivated_at": None,
                },
            )
        return Response(self.get_serializer(self.get_queryset().filter(is_active=True), many=True).data)


NSI_REGISTRY = {
    "debt-groups": DebtGroupScaleViewSet,
    "debtor-categories": DebtorCategoryViewSet,
    "scenario-rules": nsi_viewset(ScenarioRule, ScenarioRuleSerializer, ["name"]),
    "scenarios": ScenarioDefinitionViewSet,
    "print-forms": PrintFormViewSet,
    "calculation-settings": CalculationSettingsViewSet,
    "bnp-services": nsi_viewset(BnpService, BnpServiceSerializer, ["name"], ["type_id", "is_active"]),
    "bnp-debt-types": nsi_viewset(BnpDebtType, BnpDebtTypeSerializer, ["code", "name"]),
    "bnp-doc-types": nsi_viewset(BnpDocType, BnpDocTypeSerializer, ["code", "name"]),
}
