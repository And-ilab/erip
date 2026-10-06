"""Лицевой счёт из дела взыскания и счёт с долгом видны в реестре мероприятий."""

import pytest
from django.db.models import Count, Q

from apps.debts.models import Account, ClaimCase, Measure

from .conftest import make_account


def _accounts(payload) -> set[str]:
    found = set()
    for group in payload["groups"]:
        for row in group["results"]:
            if row["debtor_account"]:
                found.add(row["debtor_account"])
    return found


@pytest.mark.django_db
def test_claim_account_is_listed_in_measures_and_refusal_updates_the_row(api, specialist_a, account_a):
    opened = api(specialist_a).post("/api/v1/claims/", {"account": account_a.id}, format="json")
    assert opened.status_code == 201, opened.content
    case_id = opened.json()["id"]
    api(specialist_a).patch(
        f"/api/v1/claims/{case_id}/",
        {"warning_delivered_on": "2026-03-01", "notary_tariff": "12.50"},
        format="json",
    )
    api(specialist_a).post(f"/api/v1/claims/{case_id}/move/", {"stage": "lawsuit", "reason": "Спор о праве"}, format="json")

    listed = api(specialist_a).get("/api/v1/measures/registry/")
    assert listed.status_code == 200, listed.content
    assert account_a.client_account in _accounts(listed.json())
    titles = [row["title"] for group in listed.json()["groups"] for row in group["results"]]
    assert any("Исковое заявление" in title for title in titles)

    api(specialist_a).post(
        f"/api/v1/claims/{case_id}/move/",
        {"stage": "refused", "reason": "Отказ нотариуса"},
        format="json",
    )
    again = api(specialist_a).get("/api/v1/measures/registry/").json()
    titles = [row["title"] for group in again["groups"] for row in group["results"]]
    assert any("Отказ нотариуса" in title for title in titles)
    assert Measure.objects.filter(accounts=account_a, source_action="claim").count() == 1
    assert ClaimCase.objects.get(pk=case_id).stage == "refused"


@pytest.mark.django_db
def test_debt_account_without_a_claim_appears_in_measures(api, specialist_a, org_a):
    account = make_account(org_a, 7701, client_account="00007701", phone="1111111", contact_phone="1111111")
    account.debt_group = 1
    account.save(update_fields=["debt_group"])
    listed = api(specialist_a).get("/api/v1/measures/registry/")
    assert listed.status_code == 200, listed.content
    assert account.client_account in _accounts(listed.json())


@pytest.mark.django_db
def test_accounts_without_measures_are_grouped_by_id():
    query = (
        Account.objects.filter(Q(debt_group__isnull=False) | Q(debt_group_manual__isnull=False))
        .order_by()
        .values("pk")
        .annotate(measure_count=Count("measures"))
        .filter(measure_count=0)
        .order_by("pk")
    )
    sql = str(query.query).lower()
    assert "group by" in sql
    assert "client_account" not in sql.split("order by", 1)[-1]
