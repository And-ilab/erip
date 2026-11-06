"""API страницы подписи для Internet Explorer (ticket без JWT)."""

from __future__ import annotations

from django.http import FileResponse, HttpResponse
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.audit.services import record_action
from apps.core.permissions import RolePermission
from apps.debts.claims_views import ClaimCaseViewSet
from apps.debts.services.bnp_package import open_document, sign_documents
from apps.debts.services.claims import ClaimBlocked, case_payload
from apps.debts.services.ie_sign import (
    form_signed_archive,
    ie_mode_site_list,
    issue_ticket,
    load_ticket,
    session_payload,
    ticket_case,
    ticket_user,
)
from apps.debts.services.pris_submit import received_pdf, save_received_signature


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
        issued = issue_ticket(
            case=case,
            user=request.user,
            role=role,
            attachment_id=request.data.get("attachment_id"),
        )
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
        ticket = load_ticket(token)
        session = session_payload(token)
        allowed = {int(row["id"]) for row in session["documents"] if row.get("id") is not None}
        if int(doc_id) not in allowed:
            raise ClaimBlocked("Документ недоступен по этой ссылке подписи")
        if ticket.get("role") == "pris":
            pdf = received_pdf(case, ticket.get("attachment_id"))
            if pdf is None or pdf.pk != int(doc_id):
                raise ClaimBlocked("Документ недоступен по этой ссылке подписи")
            return FileResponse(pdf.file.open("rb"), as_attachment=False, filename=pdf.original_name, content_type="application/pdf")
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
        if ticket.get("role") == "pris":
            if len(rows) != 1:
                raise ClaimBlocked("Подпись передаётся вместе с документом для АИС ПРИС")
            save_received_signature(case, user, ticket.get("attachment_id"), rows[0].get("pkcs7"))
        else:
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
            "case": case_payload(case, with_choices=False, user=user),
        })


class IeSignFormView(APIView):
    """POST /api/v1/ie-sign/<token>/form/ — zip после подписи всех PDF."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token: str):
        user, ticket = ticket_user(token)
        case = ticket_case(token)
        if ticket.get("role") == "pris":
            request.user = user
            return Response({
                "ok": True,
                "formed": False,
                "purpose": "pris",
                "claim_id": case.pk,
                "session": session_payload(token),
            })
        form_signed_archive(case, user)
        case = ticket_case(token)
        request.user = user
        record_action(
            request,
            AuditLog.Action.UPDATE,
            case,
            after={"formed": True, "via": "ie-sign", "role": ticket.get("role")},
        )
        return Response({
            "ok": True,
            "formed": True,
            "purpose": "package",
            "claim_id": case.pk,
            "session": session_payload(token),
        })


class IeModeSiteListView(APIView):
    """GET /api/v1/ie-mode/sites.xml — список Edge: IE-режим только для /ie-sign/."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        host = request.query_params.get("host") or request.get_host()
        return HttpResponse(ie_mode_site_list(host), content_type="text/xml; charset=utf-8")
