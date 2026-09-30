"""Дела взыскания: /api/v1/claims/."""

from django.shortcuts import get_object_or_404
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.services import record_action
from apps.core.permissions import RolePermission
from apps.users.scoping import ScopedQuerysetMixin

from .models import Account, ClaimCase
from .services.claims import (
    add_act,
    apply_ais_receipt,
    case_payload,
    decide_writeoff,
    move_case,
    notary_result,
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
                "acts", "approvals__approver", "events__actor", "account__services",
            )
        ]
        return Response({"results": rows, "stages": [{"id": code, "label": label} for code, label in ClaimCase.Stage.choices]})

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
        case = move_case(self._case(pk), str(request.data.get("stage") or ""), request.user, str(request.data.get("reason") or ""))
        record_action(request, AuditLog.Action.UPDATE, case, after={"stage": case.stage})
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"], url_path="send-notary")
    def send_notary(self, request, pk=None):
        case = send_to_notary(self._case(pk), request.user)
        record_action(request, AuditLog.Action.UPDATE, case, after={"submission_id": case.submission_id, "mode": "stub"})
        return Response(case_payload(case, with_choices=True))

    @action(detail=True, methods=["post"], url_path="notary-result")
    def result(self, request, pk=None):
        case = notary_result(
            self._case(pk), str(request.data.get("result") or ""), request.user, str(request.data.get("note") or ""),
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

    def _case(self, pk) -> ClaimCase:
        return get_object_or_404(
            self.get_queryset().select_related("account__assigned_to").prefetch_related(
                "acts", "approvals__approver", "events__actor", "account__services",
            ),
            pk=pk,
        )

    def _account(self, account_id) -> Account:
        from apps.users.scoping import AccessScope

        account = AccessScope(self.request.user).apply(
            Account.objects.all(), "organization", "provider_id",
        ).filter(pk=account_id).first()
        if account is None:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"account": "Лицевой счёт не найден"})
        return account
