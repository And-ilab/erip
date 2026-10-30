"""Страница подписи в Internet Explorer: ticket без JWT Chrome."""

import base64

import pytest

from apps.debts.services.eds import sample_detached_pkcs7

from .test_claims_scenarios import _formed_package, _ready


@pytest.mark.django_db
def test_ie_sign_ticket_session_and_submit(api, specialist_a, account_a, client):
    case_id = _ready(api, specialist_a, account_a)
    _formed_package(api, specialist_a, account_a, case_id)

    issued = api(specialist_a).post(f"/api/v1/claims/{case_id}/ie-sign-ticket/", {"role": "all"}, format="json")
    assert issued.status_code == 200, issued.content
    token = issued.json()["token"]
    assert issued.json()["path"].startswith("/ie-sign/?t=")

    session = client.get(f"/api/v1/ie-sign/{token}/")
    assert session.status_code == 200, session.content
    body = session.json()
    assert body["claim_id"] == case_id
    assert body["documents"]
    doc = body["documents"][0]

    pdf = client.get(f"/api/v1/ie-sign/{token}/documents/{doc['id']}/pdf/")
    assert pdf.status_code == 200
    assert b"%PDF" in b"".join(pdf.streaming_content)[:20] or pdf["Content-Type"] == "application/pdf"

    signed = client.post(
        f"/api/v1/ie-sign/{token}/sign/",
        {"signatures": [{"doc_id": doc["id"], "pkcs7": base64.b64encode(sample_detached_pkcs7()).decode()}]},
        content_type="application/json",
    )
    assert signed.status_code == 200, signed.content
    assert signed.json()["ok"] is True
    refreshed = next(item for item in signed.json()["session"]["documents"] if item["id"] == doc["id"])
    assert refreshed["has_signature"] is True

    stale = client.get("/api/v1/ie-sign/not-a-real-token/")
    assert stale.status_code == 400
