"""Дела взыскания: /api/v1/claims/."""

from __future__ import annotations

from django.db.models.functions import Coalesce
from django.http import FileResponse, HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.services import record_action
from apps.core.permissions import RolePermission
from apps.users.scoping import AccessScope, ScopedQuerysetMixin

from .models import Account, ClaimCase
from .services.bnp_package import (
    delete_document,
    form_package,
    generate_application,
    manifest_bytes,
    open_document,
    save_package,
    store_document,
)
from .services.claims import (
    add_act,
    apply_ais_receipt,
    case_payload,
    claims_population,
    decide_writeoff,
    move_case,
    notary_result,
    stage_is_skip,
    open_case,
    record_opi,
    send_to_notary,
    start_writeoff,
    update_case,
)

EDITABLE = (
    "warning_delivered_on", "notary_tariff", "application_withdrawn", "lawsuit_number", "lawsuit_kind",
    "lawsuit_filed_on", "state_duty", "defendant_name", "package_filed_on", "lawsuit_note", "court_status",
    "eviction_stage", "skip_reason",
)


class ClaimCaseViewSet(ScopedQuerysetMixin, viewsets.GenericViewSet):
    permission_classes = [RolePermission]
    queryset = ClaimCase.objects.select_related("account")
    scope_organization_field = "organization"
    scope_provider_field = "account__provider_id"

    def list(self, request):
        rows = [
            case_payload(case)
            for case in self.get_queryset().select_related("account__assigned_to").prefetch_related(
                "acts", "approvals__approver", "events__actor", "account__services", "account__attachments",
                "account__registrations", "package__documents",
            )
        ]
        return Response({
            "results": rows,
            "stages": [{"id": code, "label": label} for code, label in ClaimCase.Stage.choices],
            "assigned": self._assigned([case.account_id for case in self.get_queryset()]),
        })

    def retrieve(self, request, pk=None):
        case = self._case(pk)
        record_action(request, AuditLog.Action.VIEW, case)
        return Response(case_payload(case, with_choices=True))

    def create(self, request):
        account = self._account(request.data.get("account"))
        case = open_case(account, request.user)
        record_action(request, AuditLog.Action.CREATE, case)
        return Response(case_payload(case, with_choices=True), status=201)

    def partial_update(self, request, pk=None):
        case = self._case(pk)
        data = {key: request.data.get(key) for key in EDITABLE if key in request.data}
        update_case(case, data, request.user)
        record_action(request, AuditLog.Action.UPDATE, case)
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        case = self._case(pk)
        stage = str(request.data.get("stage") or "")
        if stage_is_skip(case, stage):
            from apps.users.access import can_skip_stage

            if not can_skip_stage(request.user):
                raise PermissionDenied("Пропуск этапа доступен администратору и специалисту с согласованием")
        case = move_case(case, stage, request.user, str(request.data.get("reason") or ""))
        record_action(request, AuditLog.Action.UPDATE, case, after={"stage": case.stage})
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"], url_path="package")
    def package(self, request, pk=None):
        save_package(self._case(pk), request.data)
        record_action(request, AuditLog.Action.UPDATE, self._case(pk))
        return Response(case_payload(self._case(pk), with_choices=True))

    @action(detail=True, methods=["post"], url_path="package/application")
    def package_application(self, request, pk=None):
        generate_application(self._case(pk))
        record_action(request, AuditLog.Action.UPDATE, self._case(pk))
        return Response(case_payload(self._case(pk), with_choices=True))

    @action(detail=True, methods=["post"], url_path="package/form")
    def package_form(self, request, pk=None):
        case = form_package(self._case(pk), request.user)
        record_action(request, AuditLog.Action.UPDATE, case)
        return Response(case_payload(self._case(pk), with_choices=True))

    @action(detail=True, methods=["post"], url_path="package/documents")
    def package_documents(self, request, pk=None):
        doc_id = request.data.get("doc_id") or None
        store_document(
            self._case(pk),
            doc_type=str(request.data.get("doc_type") or ""),
            pdf=request.FILES.get("pdf"),
            signature=request.FILES.get("signature"),
            signature_kind=str(request.data.get("signature_kind") or "p7s"),
            doc_id=int(doc_id) if doc_id else None,
        )
        record_action(request, AuditLog.Action.UPDATE, self._case(pk))
        return Response(case_payload(self._case(pk), with_choices=True))

    @action(detail=True, methods=["delete"], url_path=r"package/documents/(?P<doc_id>[0-9]+)")
    def package_document(self, request, pk=None, doc_id=None):
        delete_document(self._case(pk), int(doc_id))
        record_action(request, AuditLog.Action.UPDATE, self._case(pk))
        return Response(case_payload(self._case(pk), with_choices=True))

    @action(detail=True, methods=["get"], url_path="package/manifest")
    def package_manifest(self, request, pk=None):
        case = self._case(pk)
        payload = manifest_bytes(case)
        response = HttpResponse(payload, content_type="application/json; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="bnp-claim-{case.pk}.json"'
        return response

    @action(
        detail=True, methods=["get"],
        url_path=r"package/documents/(?P<doc_id>[0-9]+)/(?P<kind>pdf|signature)",
    )
    def package_file(self, request, pk=None, doc_id=None, kind="pdf"):
        field, name = open_document(self._case(pk), int(doc_id), kind)
        content_type = "application/pdf" if kind == "pdf" else "application/octet-stream"
        return FileResponse(field.open("rb"), as_attachment=True, filename=name, content_type=content_type)

    @action(detail=True, methods=["post"], url_path="send-notary")
    def send_notary(self, request, pk=None):
        case = send_to_notary(self._case(pk), request.user)
        record_action(request, AuditLog.Action.UPDATE, case, after={"submission_id": case.submission_id, "mode": "stub"})
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"], url_path="notary-result")
    def result(self, request, pk=None):
        case = notary_result(
            self._case(pk), str(request.data.get("result") or ""), request.user,
            str(request.data.get("note") or ""), request.data.get("attachment_id") or None,
        )
        record_action(request, AuditLog.Action.UPDATE, case, after={"stage": case.stage})
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"])
    def acts(self, request, pk=None):
        case = self._case(pk)
        add_act(case, str(request.data.get("title") or ""), request.user)
        record_action(request, AuditLog.Action.UPDATE, case)
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"])
    def opi(self, request, pk=None):
        case = record_opi(
            self._case(pk), request.user, str(request.data.get("number") or ""), str(request.data.get("status") or ""),
        )
        record_action(request, AuditLog.Action.UPDATE, case, after={"mode": "manual"})
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"], url_path="ais-receipt")
    def ais_receipt(self, request, pk=None):
        case = apply_ais_receipt(self._case(pk), request.user)
        record_action(request, AuditLog.Action.UPDATE, case, after={"mode": "stub"})
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"])
    def writeoff(self, request, pk=None):
        ids = request.data.get("approver_ids") or []
        case = start_writeoff(self._case(pk), [int(item) for item in ids], request.user)
        record_action(request, AuditLog.Action.UPDATE, case)
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        case = decide_writeoff(
            self._case(pk), request.user, str(request.data.get("decision") or ""), str(request.data.get("reason") or ""),
        )
        record_action(request, AuditLog.Action.UPDATE, case, after={"decision": request.data.get("decision")})
        return Response(case_payload(case, with_choices=True))

    def _assigned(self, held: list[int]) -> list[dict]:
        """ЛС, которым назначена претензионная работа, но дело ещё не открыто."""
        visible = AccessScope(self.request.user).apply(
            Account.objects.all(), "organization", "provider_id", "services__provider_id",
        )
        queued = claims_population(visible)
        if held:
            queued = queued.exclude(pk__in=held)
        queued = (
            queued.annotate(shown_group=Coalesce("debt_group_manual", "debt_group"))
            .distinct()
            .order_by("short_fio", "client_account")[:100]
        )
        return [
            {
                "account": account.pk,
                "client_account": account.client_account,
                "short_fio": account.short_fio,
                "debt_group": account.shown_group,
                "account_address": account.account_address,
                "funnel_stage": account.funnel_stage,
            }
            for account in queued
        ]

    def _case(self, pk) -> ClaimCase:
        return get_object_or_404(
            self.get_queryset().select_related("account__assigned_to").prefetch_related(
                "acts", "approvals__approver", "events__actor", "account__services", "account__attachments",
                "account__registrations", "package__documents",
            ),
            pk=pk,
        )

    def _account(self, account_id) -> Account:
        account = AccessScope(self.request.user).apply(
            Account.objects.all(), "organization", "provider_id",
        ).filter(pk=account_id).first()
        if account is None:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"account": "Лицевой счёт не найден"})
        return account
