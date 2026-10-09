"""Сборка пакета БНП в деле. Отправка в кабинет остаётся заглушкой."""

from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command

from apps.debts.models import ClaimPackageDocument

from .test_claims_scenarios import _formed_package, _ready


def _composition(service_id=572, type_id="dolg_9_3", amount="999.00"):
    return {
        "service_id": service_id,
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
        "debts": [{"source": "balance", "typeId": type_id, "dateAt": "2026-03-01", "amount": amount}],
    }


@pytest.mark.django_db
def test_package_uses_ais_amount_and_names_the_signature(api, specialist_a, account_a):
    call_command("loaddata", "bnp_dictionaries", verbosity=0)
    case_id = _ready(api, specialist_a, account_a)
    saved = api(specialist_a).post(f"/api/v1/claims/{case_id}/package/", _composition(), format="json")
    assert saved.status_code == 200, saved.content
    debt = saved.json()["package"]["debts"][0]
    assert debt["amount"] == "150.00"
    assert debt["amount"] != "999.00"

    application = api(specialist_a).post(f"/api/v1/claims/{case_id}/package/application/", {}, format="json")
    assert application.status_code == 200, application.content
    doc = next(item for item in application.json()["package"]["documents"] if item["doc_type"] == "application")
    assert doc["file_name"].endswith(".pdf")
    assert doc["signature_name"].endswith(".pdf.p7s")
    assert doc["signer"] == "applicant"
    assert doc["generated"] is True

    proxy = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/package/documents/",
        {"doc_type": "proxy", "signature_kind": "sgn", "pdf": SimpleUploadedFile("doverennost.pdf", b"%PDF-1.4")},
        format="multipart",
    )
    assert proxy.status_code == 200, proxy.content
    warrant = next(item for item in proxy.json()["package"]["documents"] if item["doc_type"] == "proxy")
    assert warrant["signature_name"].endswith(".pdf.sgn")
    assert warrant["signer"] == "head"


@pytest.mark.django_db
def test_send_stays_a_stub_until_the_package_and_signatures_exist(api, specialist_a, account_a):
    case_id = _ready(api, specialist_a, account_a)
    blocked = api(specialist_a).post(f"/api/v1/claims/{case_id}/send-notary/", {}, format="json")
    assert blocked.status_code == 400
    assert "пакет" in blocked.content.decode().lower()

    call_command("loaddata", "bnp_dictionaries", verbosity=0)
    api(specialist_a).post(f"/api/v1/claims/{case_id}/package/", _composition(), format="json")
    api(specialist_a).post(f"/api/v1/claims/{case_id}/package/application/", {}, format="json")
    for doc_type, filename in (("debt_calculation", "raschet.pdf"), ("proxy", "doverennost.pdf")):
        uploaded = api(specialist_a).post(
            f"/api/v1/claims/{case_id}/package/documents/",
            {"doc_type": doc_type, "pdf": SimpleUploadedFile(filename, b"%PDF-1.4")},
            format="multipart",
        )
        assert uploaded.status_code == 200, uploaded.content
    formed = api(specialist_a).post(f"/api/v1/claims/{case_id}/package/form/", {}, format="json")
    assert formed.status_code == 200, formed.content
    manifest = formed.json()["package"]["manifest"]["applications"][0]
    assert manifest["externalId"] == f"claim-{case_id}"
    assert manifest["serviceId"] == 572
    assert manifest["docs"][0]["detachedSign"] is True
    assert manifest["debts"][0]["amount"] == "150.00"
    assert "Сформирован пакет" in formed.json()["events"][0]["reason"]

    unsigned = api(specialist_a).post(f"/api/v1/claims/{case_id}/send-notary/", {}, format="json")
    assert unsigned.status_code == 400
    assert "ЭЦП" in unsigned.content.decode()

    _formed_package(api, specialist_a, account_a, case_id)
    sent = api(specialist_a).post(f"/api/v1/claims/{case_id}/send-notary/", {}, format="json")
    assert sent.status_code == 200, sent.content
    assert sent.json()["submission_mode"] == "stub"
    assert sent.json()["submission_id"].startswith("stub-")


@pytest.mark.django_db
def test_form_rejects_a_debt_type_from_another_service_and_a_bad_signature(api, specialist_a, account_a):
    call_command("loaddata", "bnp_dictionaries", verbosity=0)
    case_id = _ready(api, specialist_a, account_a)
    api(specialist_a).post(f"/api/v1/claims/{case_id}/package/", _composition(type_id="bank"), format="json")
    api(specialist_a).post(f"/api/v1/claims/{case_id}/package/application/", {}, format="json")
    for doc_type, filename in (("debt_calculation", "raschet.pdf"), ("proxy", "doverennost.pdf")):
        api(specialist_a).post(
            f"/api/v1/claims/{case_id}/package/documents/",
            {"doc_type": doc_type, "pdf": SimpleUploadedFile(filename, b"%PDF-1.4")},
            format="multipart",
        )
    formed = api(specialist_a).post(f"/api/v1/claims/{case_id}/package/form/", {}, format="json")
    assert formed.status_code == 400
    assert "недопустим" in formed.content.decode()

    api(specialist_a).post(f"/api/v1/claims/{case_id}/package/", _composition(), format="json")
    rejected = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/package/documents/",
        {"doc_type": "debt_calculation", "signature": SimpleUploadedFile("raschet.sig", b"eds")},
        format="multipart",
    )
    assert rejected.status_code == 400
    assert "pdf" in rejected.content.decode().lower()


@pytest.mark.django_db
def test_new_tariff_drops_the_formed_package(api, specialist_a, account_a):
    case_id = _ready(api, specialist_a, account_a)
    _formed_package(api, specialist_a, account_a, case_id)
    patched = api(specialist_a).patch(
        f"/api/v1/claims/{case_id}/", {"notary_tariff": "20.00"}, format="json",
    )
    assert patched.status_code == 200, patched.content
    assert patched.json()["package"]["formed_at"] is None


def test_changed_ais_amount_blocks_the_stub_send(api, specialist_a, account_a):
    case_id = _ready(api, specialist_a, account_a)
    _formed_package(api, specialist_a, account_a, case_id)
    account_a.balance_out = Decimal("10.00")
    account_a.save(update_fields=["balance_out"])
    sent = api(specialist_a).post(f"/api/v1/claims/{case_id}/send-notary/", {}, format="json")
    assert sent.status_code == 400
    assert "АИС" in sent.content.decode()
    assert ClaimPackageDocument.objects.filter(package__case_id=case_id, doc_type="application").exists()
