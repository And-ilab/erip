"""Приёмка отсоединённой подписи PKCS#7. Криптографию СТБ проверяет AvCMXWebP."""

import base64

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.debts.services.eds import Pkcs7Error, inspect_detached_pkcs7, sample_detached_pkcs7

from .test_claims_scenarios import _formed_package, _ready


def test_detached_pkcs7_keeps_the_signer_name():
    checked = inspect_detached_pkcs7(sample_detached_pkcs7())
    assert checked.subject == "CN=Иванов И.И., UNP=100000000"
    assert checked.issuer == "CN=РУЦ ГосСУОК"
    assert checked.der[0] == 0x30


def test_base64_pkcs7_is_accepted_and_stub_mark_is_not():
    encoded = base64.b64encode(sample_detached_pkcs7())
    assert inspect_detached_pkcs7(encoded).subject.startswith("CN=")
    with pytest.raises(Pkcs7Error, match="локальная отметка"):
        inspect_detached_pkcs7(b"STUB-PACKAGE-SIGNATURE\n")
    with pytest.raises(Pkcs7Error, match="не PKCS"):
        inspect_detached_pkcs7(b"eds")
    with pytest.raises(Pkcs7Error, match="не вкладывается"):
        inspect_detached_pkcs7(sample_detached_pkcs7(detached=False))


@pytest.mark.django_db
def test_sign_documents_stores_pkcs7_and_empty_call_does_not_stamp(api, specialist_a, account_a):
    case_id = _ready(api, specialist_a, account_a)
    _formed_package(api, specialist_a, account_a, case_id)
    empty = api(specialist_a).post(f"/api/v1/claims/{case_id}/sign-documents/", {}, format="json")
    assert empty.status_code == 400
    assert "AvPass" in empty.content.decode()
    assert b"STUB-PACKAGE-SIGNATURE" not in empty.content

    formed = api(specialist_a).get(f"/api/v1/claims/{case_id}/")
    document = next(item for item in formed.json()["package"]["documents"] if item["has_pdf"])
    stored = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/sign-documents/",
        {"signatures": [{"doc_id": document["id"], "pkcs7": base64.b64encode(sample_detached_pkcs7()).decode()}]},
        format="json",
    )
    assert stored.status_code == 200, stored.content
    assert "ГосСУОК" in stored.json()["events"][0]["reason"]
    downloaded = api(specialist_a).get(f"/api/v1/claims/{case_id}/package/documents/{document['id']}/signature/")
    assert downloaded.status_code == 200
    body = b"".join(downloaded.streaming_content)
    assert body.startswith(b"\x30")
    assert b"STUB-PACKAGE-SIGNATURE" not in body


@pytest.mark.django_db
def test_upload_rejects_a_file_that_is_not_pkcs7(api, specialist_a, account_a):
    case_id = _ready(api, specialist_a, account_a)
    _formed_package(api, specialist_a, account_a, case_id)
    formed = api(specialist_a).get(f"/api/v1/claims/{case_id}/")
    document = next(item for item in formed.json()["package"]["documents"] if item["doc_type"] == "application")
    rejected = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/package/documents/",
        {
            "doc_type": "application",
            "doc_id": document["id"],
            "signature": SimpleUploadedFile(document["signature_name"], b"not-a-signature"),
        },
        format="multipart",
    )
    assert rejected.status_code == 400
    assert "PKCS" in rejected.content.decode()
