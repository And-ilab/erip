"""Страница подписи в Internet Explorer: ticket без JWT Chrome."""

import base64

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command

from apps.debts.models import ClaimPackage
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
    second = api(specialist_a).post(f"/api/v1/claims/{case_id}/ie-sign-ticket/", {"role": "all"}, format="json")
    assert second.status_code == 200
    assert second.json()["token"] != token
    assert second.json()["path"] != issued.json()["path"]

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


def _unsigned_package(api, user, case_id):
    call_command("loaddata", "bnp_dictionaries", verbosity=0)
    saved = api(user).post(
        f"/api/v1/claims/{case_id}/package/",
        {
            "service_id": 572,
            "contact_data": "+375291112233",
            "notification_email": "ivan@example.com",
            "user_message": "Прошу совершить исполнительную надпись",
            "debtors": [{
                "personType": "natural",
                "personalId": "3230587H066PB5",
                "secondName": "Иванов",
                "firstName": "Иван",
                "middleName": "Иванович",
            }],
            "debts": [{"source": "balance", "typeId": "dolg_9_3", "dateAt": "2026-03-01"}],
        },
        format="json",
    )
    assert saved.status_code == 200, saved.content
    return saved.json()


@pytest.mark.django_db
def test_ie_sign_form_waits_for_signatures_then_writes_archive(api, specialist_a, account_a, client):
    case_id = _ready(api, specialist_a, account_a)
    saved = _unsigned_package(api, specialist_a, case_id)
    assert any("Нет документа" in item for item in saved["package"]["problems"])
    assert ClaimPackage.objects.get(case_id=case_id).problems == []

    application = api(specialist_a).post(f"/api/v1/claims/{case_id}/package/application/", {}, format="json")
    assert application.status_code == 200, application.content
    for doc_type, filename in (("debt_calculation", "raschet.pdf"), ("proxy", "doverennost.pdf")):
        uploaded = api(specialist_a).post(
            f"/api/v1/claims/{case_id}/package/documents/",
            {"doc_type": doc_type, "signature_kind": "p7s", "pdf": SimpleUploadedFile(filename, b"%PDF-1.4")},
            format="multipart",
        )
        assert uploaded.status_code == 200, uploaded.content

    issued = api(specialist_a).post(f"/api/v1/claims/{case_id}/ie-sign-ticket/", {"role": "all"}, format="json")
    assert issued.status_code == 200, issued.content
    token = issued.json()["token"]
    docs = client.get(f"/api/v1/ie-sign/{token}/").json()["documents"]
    assert len(docs) >= 3

    blocked = client.post(f"/api/v1/ie-sign/{token}/form/", {}, content_type="application/json")
    assert blocked.status_code == 400, blocked.content
    assert "ЭЦП" in blocked.json()["error"]["message"]

    pkcs7 = base64.b64encode(sample_detached_pkcs7()).decode()
    signed = client.post(
        f"/api/v1/ie-sign/{token}/sign/",
        {"signatures": [{"doc_id": doc["id"], "pkcs7": pkcs7} for doc in docs]},
        content_type="application/json",
    )
    assert signed.status_code == 200, signed.content

    formed = client.post(f"/api/v1/ie-sign/{token}/form/", {}, content_type="application/json")
    assert formed.status_code == 200, formed.content
    assert formed.json()["formed"] is True

    card = api(specialist_a).get(f"/api/v1/claims/{case_id}/")
    package = card.json()["package"]
    assert package["formed_at"]
    assert package["has_archive"] is True
    assert package["send_blockers"] == []
    assert package["problems"] == []


@pytest.mark.django_db
def test_ie_mode_site_list_opens_only_the_sign_page(client):
    response = client.get("/api/v1/ie-mode/sites.xml")
    assert response.status_code == 200
    body = response.content.decode()
    assert response["Content-Type"].startswith("text/xml")
    assert '<site url="testserver/ie-sign">' in body
    assert "<open-in>IE11</open-in>" in body
    assert '<site url="testserver">' not in body
    assert "/claims" not in body

    with_port = client.get("/api/v1/ie-mode/sites.xml?host=10.0.0.5:8080").content.decode()
    assert '<site url="10.0.0.5:8080/ie-sign">' in with_port
