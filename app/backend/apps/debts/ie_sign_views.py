"""API страницы подписи для Internet Explorer (ticket без JWT)."""

from __future__ import annotations

from django.http import FileResponse
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.audit.services import record_action
from apps.core.permissions import RolePermission
from apps.debts.claims_views import ClaimCaseViewSet
from apps.debts.services.bnp_package import open_document, sign_documents
from apps.debts.services.claims import ClaimBlocked, case_payload
from apps.debts.services.ie_sign import issue_ticket, session_payload, ticket_case, ticket_user


class IeSignTicketView(APIView):
    """POST /api/v1/claims/{id}/ie-sign-ticket/ — ссылка для IE."""

    permission_classes = [IsAuthenticated, RolePermission]

    def post(self, request, pk: int):
        view = ClaimCaseViewSet()
        view.request = request
        view.format_kwarg = None
        view.action = "ie_sign_ticket"
        case = view._case(pk)
        role = str(request.data.get("role") or "all")
        issued = issue_ticket(case=case, user=request.user, role=role)
        record_action(
            request,
            AuditLog.Action.VIEW,
            case,
            after={"ie_sign_ticket": True, "role": issued["role"]},
        )
        return Response(issued)


class IeSignSessionView(APIView):
    """GET /api/v1/ie-sign/<token>/ — состав комплекта для страницы IE."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, token: str):
        return Response(session_payload(token))


class IeSignPdfView(APIView):
    """GET /api/v1/ie-sign/<token>/documents/<doc_id>/pdf/"""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, token: str, doc_id: int):
        case = ticket_case(token)
        session = session_payload(token)
        allowed = {int(row["id"]) for row in session["documents"] if row.get("id") is not None}
        if int(doc_id) not in allowed:
            raise ClaimBlocked("Документ недоступен по этой ссылке подписи")
        field, name = open_document(case, int(doc_id), "pdf")
        return FileResponse(field.open("rb"), as_attachment=False, filename=name, content_type="application/pdf")


class IeSignSubmitView(APIView):
    """POST /api/v1/ie-sign/<token>/sign/ — сохранить PKCS#7 с страницы IE."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token: str):
        user, ticket = ticket_user(token)
        case = ticket_case(token)
        session = session_payload(token)
        allowed = {int(row["id"]) for row in session["documents"] if row.get("id") is not None}
        rows = list(request.data.get("signatures") or [])
        for item in rows:
            if not isinstance(item, dict):
                raise ClaimBlocked("Подпись передаётся вместе с документом комплекта")
            try:
                doc_id = int(item.get("doc_id"))
            except (TypeError, ValueError) as exc:
                raise ClaimBlocked("Укажите документ комплекта") from exc
            if doc_id not in allowed:
                raise ClaimBlocked("Документ недоступен по этой ссылке подписи")
        sign_documents(case, user, rows)
        case = ticket_case(token)
        request.user = user
        record_action(
            request,
            AuditLog.Action.UPDATE,
            case,
            after={"signed": "gosuok", "format": "pkcs7-detached", "via": "ie-sign", "role": ticket.get("role")},
        )
        return Response({
            "ok": True,
            "claim_id": case.pk,
            "session": session_payload(token),
            "case": case_payload(case, with_choices=False),
        })
