"""Дела взыскания: /api/v1/claims/."""

from __future__ import annotations

from django.db.models import Prefetch
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

from .models import Account, AccountService, Attachment, ClaimCase
from .services.bnp_package import (
    delete_document,
    form_package,
    generate_application,
    generate_from_form,
    manifest_bytes,
    open_archive,
    open_document,
    save_package,
    sign_and_send,
    sign_documents,
    store_document,
    update_document_layout,
    update_document_text,
)
from .services.claims import (
    add_act,
    add_opi_measure,
    apply_ais_receipt,
    case_payload,
    claims_population,
    decide_writeoff,
    move_case,
    notary_result,
    align_claim_with_funnel,
    open_case,
    record_opi,
    remove_act,
    remove_opi_measure,
    send_to_notary,
    stage_is_skip,
    start_writeoff,
    update_case,
)
from .services.pris_nsi import load_pris_dictionaries
from .services.pris_submit import (
    autofill_pris_draft,
    pris_channel_status,
    refresh_pris,
    repay_pris,
    save_pris_draft,
    submit_pris,
)

EDITABLE = (
    "warning_delivered_on", "notary_tariff", "notary_office", "application_withdrawn", "notary_note", "lawsuit_number", "lawsuit_kind",
    "lawsuit_filed_on", "state_duty", "defendant_name", "package_filed_on", "lawsuit_note", "court_status",
    "eviction_stage", "skip_reason",
    "opi_department", "opi_sent_on", "opi_started_on", "opi_ended_on", "opi_bailiff", "opi_note",
)


class ClaimCaseViewSet(ScopedQuerysetMixin, viewsets.GenericViewSet):
    permission_classes = [RolePermission]
    queryset = ClaimCase.objects.select_related("account")
    scope_organization_field = "organization"
    scope_provider_field = "account__provider_id"

    def list(self, request):
        cases = list(
            self.get_queryset()
            .select_related("account__assigned_to")
            .defer("raw", "pris_request", "pris_inquiry", "account__raw")
            .prefetch_related(
                "acts__attachment",
                "approvals__approver",
                "events__actor",
                Prefetch(
                    "account__services",
                    queryset=AccountService.objects.only("id", "account_id", "balance_mulct_out"),
                ),
                Prefetch(
                    "account__attachments",
                    queryset=Attachment.objects.only("id", "account_id", "doc_type", "original_name"),
                ),
            )
        )
        return Response({
            "results": [case_payload(case) for case in cases],
            "stages": [{"id": code, "label": label} for code, label in ClaimCase.Stage.choices],
            "assigned": self._assigned([case.account_id for case in cases]),
        })

    def retrieve(self, request, pk=None):
        case = self._case(pk)
        align_claim_with_funnel(case.account, request.user)
        case.refresh_from_db()
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

    @action(detail=True, methods=["post"], url_path="package/from-template")
    def package_from_template(self, request, pk=None):
        generate_from_form(self._case(pk), request.user, request.data.get("form"))
        record_action(request, AuditLog.Action.UPDATE, self._case(pk), after={"form": request.data.get("form")})
        return Response(case_payload(self._case(pk), with_choices=True))

    @action(detail=True, methods=["post"], url_path=r"package/documents/(?P<doc_id>[0-9]+)/text")
    def package_document_text(self, request, pk=None, doc_id=None):
        update_document_text(self._case(pk), int(doc_id), str(request.data.get("body") or ""))
        record_action(request, AuditLog.Action.UPDATE, self._case(pk), after={"document": doc_id})
        return Response(case_payload(self._case(pk), with_choices=True))

    @action(detail=True, methods=["post"], url_path=r"package/documents/(?P<doc_id>[0-9]+)/layout")
    def package_document_layout(self, request, pk=None, doc_id=None):
        update_document_layout(
            self._case(pk), int(doc_id), str(request.data.get("body") or ""), request.data.get("blocks") or [],
            blank=str(request.data.get("blank") or ""), values=request.data.get("values") or {},
            sections=request.data.get("sections") or None,
            service_rows=request.data.get("service_rows") or None,
        )
        record_action(request, AuditLog.Action.UPDATE, self._case(pk), after={"document": doc_id, "layout": True})
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

    @action(detail=True, methods=["get"], url_path="package/archive")
    def package_archive(self, request, pk=None):
        field, name = open_archive(self._case(pk))
        return FileResponse(field.open("rb"), as_attachment=True, filename=name, content_type="application/zip")

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
        inline = kind == "pdf" and request.query_params.get("inline") == "1"
        return FileResponse(
            field.open("rb"), as_attachment=not inline, filename=name, content_type=content_type,
        )

    @action(detail=True, methods=["post"], url_path="sign-documents")
    def sign_docs(self, request, pk=None):
        sign_documents(self._case(pk), request.user, request.data.get("signatures"))
        case = self._case(pk)
        record_action(request, AuditLog.Action.UPDATE, case, after={"signed": "gosuok", "format": "pkcs7-detached"})
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"], url_path="sign-and-send")
    def sign_send(self, request, pk=None):
        sign_and_send(self._case(pk), request.user, str(request.data.get("skip_reason") or ""))
        case = self._case(pk)
        record_action(
            request, AuditLog.Action.UPDATE, case,
            after={"submission_id": case.submission_id, "mode": "stub"},
        )
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"], url_path="send-notary")
    def send_notary(self, request, pk=None):
        send_to_notary(self._case(pk), request.user, str(request.data.get("skip_reason") or ""))
        case = self._case(pk)
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
        add_act(
            case,
            str(request.data.get("title") or ""),
            request.user,
            act_number=str(request.data.get("act_number") or ""),
            act_date=request.data.get("act_date") or None,
            reason=str(request.data.get("reason") or ""),
            upload=request.FILES.get("file"),
            attachment_id=request.data.get("attachment_id") or None,
        )
        record_action(request, AuditLog.Action.UPDATE, case)
        return Response(case_payload(self._case(pk), with_choices=True))

    @action(detail=True, methods=["delete"], url_path=r"acts/(?P<act_id>[0-9]+)")
    def act_delete(self, request, pk=None, act_id=None):
        case = remove_act(self._case(pk), int(act_id), request.user)
        record_action(request, AuditLog.Action.UPDATE, case, after={"removed_act": act_id})
        return Response(case_payload(self._case(pk), with_choices=True))

    @action(detail=True, methods=["post"])
    def opi(self, request, pk=None):
        case = record_opi(
            self._case(pk),
            request.user,
            str(request.data.get("number") or ""),
            str(request.data.get("status") or ""),
            department=request.data.get("department"),
            sent_on=request.data.get("sent_on"),
            started_on=request.data.get("started_on"),
            ended_on=request.data.get("ended_on"),
            bailiff=request.data.get("bailiff"),
            note=request.data.get("note"),
        )
        record_action(request, AuditLog.Action.UPDATE, case, after={"mode": "manual"})
        return Response(case_payload(self._case(pk), with_choices=True))

    @action(detail=True, methods=["post"], url_path="opi-measures")
    def opi_measures(self, request, pk=None):
        case = add_opi_measure(self._case(pk), request.user, request.data, upload=request.FILES.get("file"))
        record_action(request, AuditLog.Action.UPDATE, case, after={"opi_measure": True})
        return Response(case_payload(self._case(pk), with_choices=True))

    @action(detail=True, methods=["delete"], url_path=r"opi-measures/(?P<measure_id>[0-9]+)")
    def opi_measure_delete(self, request, pk=None, measure_id=None):
        case = remove_opi_measure(self._case(pk), int(measure_id), request.user)
        record_action(request, AuditLog.Action.UPDATE, case, after={"removed_opi_measure": measure_id})
        return Response(case_payload(self._case(pk), with_choices=True))

    @action(detail=False, methods=["get"], url_path="pris-dictionaries")
    def pris_dictionaries(self, request):
        return Response(load_pris_dictionaries())

    @action(detail=False, methods=["get"], url_path="pris-status")
    def pris_status(self, request):
        return Response(pris_channel_status())

    @action(detail=True, methods=["post"], url_path="pris/autofill")
    def pris_autofill(self, request, pk=None):
        case = autofill_pris_draft(self._case(pk))
        record_action(request, AuditLog.Action.UPDATE, case, after={"pris": "autofill"})
        return Response(case_payload(self._case(pk), with_choices=True))

    @action(detail=True, methods=["post"], url_path="pris/draft")
    def pris_draft(self, request, pk=None):
        case = save_pris_draft(self._case(pk), request.data)
        record_action(request, AuditLog.Action.UPDATE, case, after={"pris": "draft"})
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"], url_path="pris/submit")
    def pris_submit(self, request, pk=None):
        case = submit_pris(self._case(pk), request.user, request.data)
        record_action(request, AuditLog.Action.UPDATE, case, after={"mode": case.opi_mode, "pris": case.pris_response_id})
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"], url_path="pris/refresh")
    def pris_refresh(self, request, pk=None):
        case = refresh_pris(self._case(pk), request.user)
        record_action(request, AuditLog.Action.UPDATE, case, after={"mode": case.opi_mode, "opi": case.opi_number})
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"], url_path="pris/repay")
    def pris_repay(self, request, pk=None):
        case = repay_pris(self._case(pk), request.user)
        record_action(request, AuditLog.Action.UPDATE, case, after={"mode": case.opi_mode, "pris": case.pris_process_status})
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
                "acts__attachment", "approvals__approver", "events__actor", "account__services", "account__attachments",
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
