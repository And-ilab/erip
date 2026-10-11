"""Пользовательский домен: И, ИЛИ, НЕ и только известные поля."""

import json

import pytest

from apps.audit.models import AuditLog
from apps.nsi.models import PrintForm

from .conftest import make_account
from .test_claims_scenarios import _ready


@pytest.mark.django_db
def test_account_domain_and_or_not(api, specialist_a, org_a):
    keep = make_account(org_a, 3101, client_account="00003101", debt_group=6, rating="E")
    other = make_account(org_a, 3102, client_account="00003102", debt_group=1, rating="A")
    both = {"domain": json.dumps({
        "join": "and",
        "rules": [
            {"field": "debt_group", "op": "eq", "value": 6},
            {"field": "rating", "op": "eq", "value": "E"},
        ],
    })}
    listed = api(specialist_a).get("/api/v1/accounts/", both)
    assert listed.status_code == 200, listed.content
    ids = {row["id"] for row in listed.json()["results"]}
    assert keep.id in ids
    assert other.id not in ids

    either = {"domain": json.dumps({
        "join": "or",
        "rules": [
            {"field": "debt_group", "op": "eq", "value": 6},
            {"field": "rating", "op": "eq", "value": "A"},
        ],
    })}
    wide = api(specialist_a).get("/api/v1/accounts/", either)
    wide_ids = {row["id"] for row in wide.json()["results"]}
    assert keep.id in wide_ids and other.id in wide_ids

    negated = {"domain": json.dumps({
        "join": "and",
        "not": True,
        "rules": [{"field": "debt_group", "op": "eq", "value": 1}],
    })}
    hidden = api(specialist_a).get("/api/v1/accounts/", negated)
    hidden_ids = {row["id"] for row in hidden.json()["results"]}
    assert other.id not in hidden_ids
    assert keep.id in hidden_ids

    unknown = api(specialist_a).get("/api/v1/accounts/", {"domain": json.dumps({
        "join": "and", "rules": [{"field": "secret_note", "op": "eq", "value": "x"}],
    })})
    assert unknown.status_code == 400


@pytest.mark.django_db
def test_password_change_rejects_wrong_current_and_audits_success(client, specialist_a):
    login = client.post(
        "/api/v1/auth/token/",
        {"username": "spec_a", "password": "Passw0rd!x"},
        content_type="application/json",
    )
    token = login.json()["access"]
    wrong = client.post(
        "/api/v1/auth/password/",
        {"old_password": "not-the-password", "new_password": "N3w-password!"},
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert wrong.status_code == 400
    specialist_a.refresh_from_db()
    assert specialist_a.check_password("Passw0rd!x")

    changed = client.post(
        "/api/v1/auth/password/",
        {"old_password": "Passw0rd!x", "new_password": "N3w-password!"},
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert changed.status_code == 204, changed.content
    assert AuditLog.objects.filter(object_id=str(specialist_a.pk), after__password="changed").exists()


@pytest.mark.django_db
def test_notary_document_is_created_from_template_and_edited(api, specialist_a, account_a):
    form = PrintForm.objects.get(code="notary-application", addressee="notary")
    case_id = _ready(api, specialist_a, account_a)
    created = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/package/from-template/",
        {"form": form.id},
        format="json",
    )
    assert created.status_code == 200, created.content
    document = next(item for item in created.json()["package"]["documents"] if item["doc_type"] == "application")
    assert document["generated"] is True
    assert account_a.client_account in document["body"]

    edited = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/package/documents/{document['id']}/text/",
        {"body": "Исправленный текст заявления по счёту"},
        format="json",
    )
    assert edited.status_code == 200, edited.content
    again = next(item for item in edited.json()["package"]["documents"] if item["id"] == document["id"])
    assert again["body"] == "Исправленный текст заявления по счёту"
