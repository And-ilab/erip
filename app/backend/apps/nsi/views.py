"""Справочники НСИ: /api/v1/nsi/{dict}/. Новый справочник = новая запись в NSI_REGISTRY."""

from django.db.models import Q
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
    ExtraMeasureCatalog,
    NotaryOffice,
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
    ExtraMeasureCatalogSerializer,
    NotaryOfficeSerializer,
    PrintFormSerializer,
    ScenarioDefinitionSerializer,
    ScenarioRuleSerializer,
)


def _mail_text(raw, field: str, limit: int) -> str:
    text = str(raw or "").strip()
    if len(text) > limit:
        raise ValidationError({field: f"Не длиннее {limit} символов"})
    return text


def _mail_address(raw) -> str:
    from django.core.exceptions import ValidationError as DjangoValidationError
    from django.core.validators import validate_email

    text = _mail_text(raw, "mail_from", 254)
    if not text:
        return ""
    try:
        validate_email(text)
    except DjangoValidationError as exc:
        raise ValidationError({"mail_from": "Укажите адрес e-mail"}) from exc
    return text


def _outgoing_numbers(raw) -> list[str]:
    from apps.debts.services.measures import belarus_phone

    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise ValidationError({"outgoing_numbers": "Список номеров"})
    numbers = []
    for item in raw:
        text = str(item or "").strip()
        if not text:
            continue
        phone = belarus_phone(text)
        if not phone:
            raise ValidationError({"outgoing_numbers": f"Номер не +375: {text}"})
        if phone not in numbers:
            numbers.append(phone)
    return numbers


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
    """Центральные категории правит суперадминистратор, локальные — администратор схемы.

    Список без параметра is_active отдаёт только активные. Прежний посев из четырёх записей выключен.
    """

    queryset = DebtorCategory.objects.all()
    serializer_class = DebtorCategorySerializer
    search_fields = ["name", "code"]
    filterset_fields = ["is_active", "organization"]
    write_roles = ("superadmin", "local_admin", "specialist")

    def get_queryset(self):
        qs = self.queryset
        user = self.request.user
        if not user.is_superadmin:
            qs = qs.filter(Q(organization__isnull=True) | Q(organization=user.organization))
        if getattr(self, "action", None) == "list" and "is_active" not in self.request.query_params:
            qs = qs.filter(is_active=True)
        return qs

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
            if request.data.get("call_recording") or request.data.get("call_transfer"):
                raise ValidationError({
                    "call_recording": "Запись разговора и перевод на оператора выключены, пока Asterisk их не отдаёт",
                })
            organization.call_legal = bool(request.data.get("call_legal"))
            if "outgoing_numbers" in request.data:
                organization.outgoing_numbers = _outgoing_numbers(request.data.get("outgoing_numbers"))
            organization.call_recording = False
            organization.call_transfer = False
            organization.save(update_fields=[
                "call_legal", "outgoing_numbers", "call_recording", "call_transfer", "updated_at",
            ])
        settings = CalculationSettings.load()
        return Response({
            "call_legal": organization.call_legal,
            "outgoing_numbers": organization.outgoing_numbers or [],
            "call_recording": False,
            "call_transfer": False,
            "dial_mobile_from_day": settings.dial_mobile_from_day,
            "dial_mobile_weekdays": settings.dial_mobile_weekdays,
        })

    @action(detail=False, methods=["get", "patch"], url_path="mail")
    def mail(self, request):
        """Отправитель, тема и подпись писем схемы. Прочтение не отмечается."""
        self._admin_only()
        organization = request.user.organization
        if organization is None:
            raise ValidationError({"organization": "У пользователя нет схемы"})
        if request.method == "PATCH":
            if "mail_from" in request.data:
                organization.mail_from = _mail_address(request.data.get("mail_from"))
            if "mail_from_name" in request.data:
                organization.mail_from_name = _mail_text(request.data.get("mail_from_name"), "mail_from_name", 250)
            if "mail_subject" in request.data:
                organization.mail_subject = _mail_text(request.data.get("mail_subject"), "mail_subject", 250)
            if "mail_signature" in request.data:
                organization.mail_signature = _mail_text(request.data.get("mail_signature"), "mail_signature", 500)
            organization.save(update_fields=[
                "mail_from", "mail_from_name", "mail_subject", "mail_signature", "updated_at",
            ])
        return Response({
            "mail_from": organization.mail_from,
            "mail_from_name": organization.mail_from_name,
            "mail_subject": organization.mail_subject,
            "mail_signature": organization.mail_signature,
        })

    @action(detail=False, methods=["get", "patch"], url_path="timeline")
    def timeline(self, request):
        """Сроки схемы. Чтение — всем своей схемы, запись — администратору."""
        from apps.nsi.services.timelines import clean_step_waits, warning_wait_for

        if request.method == "PATCH":
            self._admin_only()
        organization = request.user.organization
        settings = CalculationSettings.load()
        if organization is None:
            return Response({
                "warning_wait_days": settings.warning_wait_days,
                "warning_wait_custom": None,
                "central_warning_wait_days": settings.warning_wait_days,
                "step_waits": {},
            })
        if request.method == "PATCH":
            if "warning_wait_days" in request.data:
                raw = request.data.get("warning_wait_days")
                if raw in (None, ""):
                    organization.warning_wait_days = None
                else:
                    try:
                        days = int(raw)
                    except (TypeError, ValueError) as exc:
                        raise ValidationError({"warning_wait_days": "Укажите число дней"}) from exc
                    if days < 0 or days > 3650:
                        raise ValidationError({"warning_wait_days": "Срок — от 0 до 3650 дней"})
                    organization.warning_wait_days = days
            if "step_waits" in request.data:
                try:
                    organization.step_waits = clean_step_waits(request.data.get("step_waits"))
                except ValueError as exc:
                    raise ValidationError({"step_waits": str(exc)}) from exc
            organization.save(update_fields=["warning_wait_days", "step_waits", "updated_at"])
        return Response({
            "warning_wait_days": warning_wait_for(organization),
            "warning_wait_custom": organization.warning_wait_days,
            "central_warning_wait_days": settings.warning_wait_days,
            "step_waits": organization.step_waits or {},
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
        from django.core.files.base import ContentFile
        from django.http import FileResponse

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

    @action(detail=False, methods=["get"], url_path="blank-data")
    def blank_data(self, request):
        from .services.official_blanks import context_for_blank, known, payload_of

        blank = str(request.query_params.get("blank") or "")
        if not known(blank):
            raise ValidationError({"blank": "Такого бланка образца нет"})
        account = _visible_account(request.user, request.query_params.get("account"))
        return Response(payload_of(context_for_blank(blank, account)))

    @action(detail=False, methods=["post"])
    def preview(self, request):
        from django.core.files.base import ContentFile
        from django.http import FileResponse

        from apps.debts.services.artifacts import render_layout_pdf

        from .services.form_layout import clean_blocks, fill_blocks
        from .services.official_blanks import context_for_blank, known
        from .services.scenarios import placeholder_values

        blank = str(request.data.get("blank") or "")
        if blank and known(blank):
            account = _visible_account(request.user, request.data.get("account"))
            ctx = context_for_blank(
                blank, account, overrides=request.data.get("values") or {},
                sections=request.data.get("sections") or None,
                service_rows=request.data.get("service_rows") or None,
            )
            payload = render_layout_pdf([], blank=blank, context=ctx)
            return FileResponse(ContentFile(payload), as_attachment=False, filename="preview.pdf", content_type="application/pdf")

        raw = request.data.get("blocks")
        try:
            blocks = clean_blocks(raw) if raw else [{
                "key": "body", "title": "Текст", "enabled": True, "align": "left",
                "bold": False, "italic": False, "font_size": 12,
                "text": str(request.data.get("body") or ""), "columns": [], "rows": [],
            }]
        except ValueError as exc:
            raise ValidationError({"blocks": str(exc)}) from exc
        account = _visible_account(request.user, request.data.get("account"))
        if account is not None:
            blocks = fill_blocks(blocks, placeholder_values(account))
        payload = render_layout_pdf(blocks)
        return FileResponse(ContentFile(payload), as_attachment=False, filename="preview.pdf", content_type="application/pdf")

    @action(detail=False, methods=["post"])
    def recognize(self, request):
        from .services.form_layout import recognize_bytes

        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "Приложите PDF или изображение шаблона"})
        if upload.size > 15 * 1024 * 1024:
            raise ValidationError({"file": "Файл больше 15 МБ"})
        draft = recognize_bytes(getattr(upload, "name", "") or "scan", upload.read())
        return Response(draft)


def _visible_account(user, account_id):
    if not account_id:
        return None
    from apps.debts.models import Account
    from apps.users.scoping import AccessScope

    visible = AccessScope(user).apply(Account.objects.all(), "organization", "provider_id")
    account = visible.filter(pk=account_id).first()
    if account is None:
        raise ValidationError({"account": "Лицевой счёт не найден"})
    return account


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


class ExtraMeasureCatalogViewSet(NsiViewSet):
    """Справочник дополнительных мероприятий. Пишут суперадминистратор и локальный администратор."""

    queryset = ExtraMeasureCatalog.objects.all()
    serializer_class = ExtraMeasureCatalogSerializer
    search_fields = ["name"]
    filterset_fields = ["is_active"]
    write_roles = ("superadmin", "local_admin")

    def get_queryset(self):
        qs = super().get_queryset()
        if getattr(self, "action", None) == "list" and "is_active" not in self.request.query_params:
            qs = qs.filter(is_active=True)
        return qs


class NotaryOfficeViewSet(NsiViewSet):
    """Действующие конторы с belnotary.by. Снятая с публикации запись в список не попадает."""

    queryset = NotaryOffice.objects.active()
    serializer_class = NotaryOfficeSerializer
    search_fields = ["name", "district", "address"]
    filterset_fields = ["district"]


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
    "notary-offices": NotaryOfficeViewSet,
    "extra-measures": ExtraMeasureCatalogViewSet,
}
