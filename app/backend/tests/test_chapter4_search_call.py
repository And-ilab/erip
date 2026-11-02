"""Глава 4: поиск по адресу токенами и автообзвон только по отмеченным ЛС."""

import json

import pytest

from apps.debts.models import Measure

from .conftest import make_account


@pytest.mark.django_db
def test_search_and_domain_match_address_tokens(api, specialist_a, org_a):
    hit = make_account(
        org_a, 4101, client_account="00004101",
        account_address="г. Минск, ул. Советская, д. 17, кв. 3",
    )
    miss = make_account(
        org_a, 4102, client_account="00004102",
        account_address="г. Минск, ул. Ленина, д. 17",
    )
    listed = api(specialist_a).get("/api/v1/accounts/", {"q": "советская 17"})
    assert listed.status_code == 200, listed.content
    ids = {row["id"] for row in listed.json()["results"]}
    assert hit.id in ids
    assert miss.id not in ids

    domain = api(specialist_a).get("/api/v1/accounts/", {
        "domain": json.dumps({
            "join": "and",
            "rules": [{"field": "account_address", "op": "contains", "value": "советская 17"}],
        }),
    })
    assert domain.status_code == 200, domain.content
    domain_ids = {row["id"] for row in domain.json()["results"]}
    assert hit.id in domain_ids
    assert miss.id not in domain_ids


@pytest.mark.django_db
def test_call_all_matching_needs_confirm_or_ids(api, admin_a, org_a):
    first = make_account(org_a, 4201, client_account="00004201", contact_phone="+375291111111", debt_group=1)
    second = make_account(org_a, 4202, client_account="00004202", contact_phone="+375292222222", debt_group=1)
    payload = {
        "kind": "call",
        "all_matching": True,
        "filters": {},
        "template_name": "Автообзвон",
        "time_from": "18:00",
        "time_to": "21:00",
        "started_on": "2026-11-02",
    }
    blocked = api(admin_a).post("/api/v1/measures/", payload, format="json")
    assert blocked.status_code == 400, blocked.content

    one = api(admin_a).post(
        "/api/v1/measures/",
        {**payload, "all_matching": False, "account_ids": [first.id]},
        format="json",
    )
    assert one.status_code == 201, one.content
    measure = Measure.objects.get(pk=one.json()["id"])
    assert set(measure.accounts.values_list("id", flat=True)) == {first.id}

    bulk = api(admin_a).post(
        "/api/v1/measures/",
        {**payload, "confirm_bulk": True},
        format="json",
    )
    assert bulk.status_code == 201, bulk.content
    party = Measure.objects.get(pk=bulk.json()["id"])
    assert set(party.accounts.values_list("id", flat=True)) >= {first.id, second.id}
