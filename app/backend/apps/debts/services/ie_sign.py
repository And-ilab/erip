"""Одноразовый доступ к комплекту для подписи в Internet Explorer.

Chrome/Edge не загружают AvCMXWebP. Специалист открывает лёгкую страницу
`/ie-sign/` в IE по ссылке с ticket. Cookie сессии Chrome в IE нет — поэтому
JWT не подходит, нужен короткий подписанный ticket в URL.
"""

from __future__ import annotations

import secrets
from typing import Any

from django.contrib.auth import get_user_model
from django.core import signing
from django.core.cache import cache

from apps.debts.models import ClaimCase
from apps.debts.services.bnp_package import package_payload, stored_package
from apps.debts.services.claims import ClaimBlocked

User = get_user_model()

TICKET_TTL = 2 * 60 * 60
CACHE_PREFIX = "ie-sign:"
SIGN_SALT = "erip.ie-sign.v1"


def issue_ticket(*, case: ClaimCase, user, role: str = "all") -> dict[str, Any]:
    """Создаёт ticket на подпись комплекта. role: applicant | head | all."""
    if stored_package(case) is None:
        raise ClaimBlocked("Сначала соберите документы комплекта")
    normalized = str(role or "all").strip().lower()
    if normalized not in {"applicant", "head", "all"}:
        raise ClaimBlocked("Роль подписи: applicant, head или all")
    data = {
        "claim_id": case.pk,
        "user_id": user.pk,
        "role": normalized,
        "nonce": secrets.token_hex(4),
    }
    signed = signing.dumps(data, salt=SIGN_SALT, compress=True)
    token = signed.replace(":", ".")
    cache.set(CACHE_PREFIX + token, data, timeout=TICKET_TTL)
    return {
        "token": token,
        "expires_in": TICKET_TTL,
        "path": f"/ie-sign/?t={token}",
        "role": normalized,
        "claim_id": case.pk,
    }


def load_ticket(token: str) -> dict[str, Any]:
    raw = str(token or "").strip()
    if not raw or len(raw) > 512:
        raise ClaimBlocked("Ссылка подписи недействительна или истекла. В Chrome нажмите «Подпись в Internet Explorer» заново.")
    payload = cache.get(CACHE_PREFIX + raw)
    if not isinstance(payload, dict):
        try:
            payload = signing.loads(raw.replace(".", ":"), salt=SIGN_SALT, max_age=TICKET_TTL)
        except signing.BadSignature as exc:
            raise ClaimBlocked(
                "Ссылка подписи недействительна или истекла. В Chrome нажмите «Подпись в Internet Explorer» заново."
            ) from exc
    if not isinstance(payload, dict) or not payload.get("claim_id") or not payload.get("user_id"):
        raise ClaimBlocked("Ссылка подписи недействительна или истекла. В Chrome нажмите «Подпись в Internet Explorer» заново.")
    return payload


def session_payload(token: str) -> dict[str, Any]:
    ticket = load_ticket(token)
    case = ClaimCase.objects.select_related("account").filter(pk=ticket["claim_id"]).first()
    if case is None:
        raise ClaimBlocked("Дело по ссылке подписи не найдено")
    user = User.objects.filter(pk=ticket["user_id"]).first()
    package = package_payload(case)
    role = ticket.get("role") or "all"
    documents = []
    for doc in package.get("documents") or []:
        if not doc.get("has_pdf"):
            continue
        signer = str(doc.get("signer") or "applicant")
        if role == "applicant" and signer == "head":
            continue
        if role == "head" and signer != "head":
            continue
        documents.append({
            "id": doc.get("id"),
            "file_name": doc.get("file_name"),
            "doc_type": doc.get("doc_type"),
            "doc_type_label": doc.get("doc_type_label") or doc.get("doc_type"),
            "signer": signer,
            "signer_label": doc.get("signer_label") or signer,
            "has_signature": bool(doc.get("has_signature")),
        })
    account = case.account
    return {
        "token": token,
        "claim_id": case.pk,
        "role": role,
        "account": account.client_account or account.pk,
        "debtor": account.short_fio or "",
        "user": getattr(user, "username", "") if user else "",
        "documents": documents,
    }


def ticket_user(token: str):
    ticket = load_ticket(token)
    user = User.objects.filter(pk=ticket["user_id"]).first()
    if user is None or not user.is_active:
        raise ClaimBlocked("Пользователь ссылки подписи недоступен")
    return user, ticket


def ticket_case(token: str) -> ClaimCase:
    ticket = load_ticket(token)
    case = ClaimCase.objects.select_related("account").filter(pk=ticket["claim_id"]).first()
    if case is None:
        raise ClaimBlocked("Дело по ссылке подписи не найдено")
    return case
