"""Справочник нотариальных контор с сайта Белорусской нотариальной палаты."""

import pytest
from django.core.management import call_command

from apps.debts.models import ClaimCase
from apps.nsi.models import NotaryOffice


@pytest.mark.django_db
def test_notary_directory_lists_the_chamber_offices(api, specialist_a):
    call_command("loaddata", "notary_offices", verbosity=0)
    found = api(specialist_a).get("/api/v1/nsi/notary-offices/", {
        "page_size": 20, "search": "Брестская городская",
    })
    assert found.status_code == 200, found.content
    assert [row["name"] for row in found.data["results"]] == ["Брестская городская нотариальная контора"]
    assert found.data["results"][0]["district"] == "Брестский нотариальный округ"
    full = api(specialist_a).get("/api/v1/nsi/notary-offices/", {"page_size": 500})
    assert full.data["count"] == 218


@pytest.mark.django_db
def test_claim_stores_the_chosen_office(api, specialist_a, account_a):
    case = ClaimCase.objects.create(organization=account_a.organization, account=account_a)
    saved = api(specialist_a).patch(
        f"/api/v1/claims/{case.id}/",
        {"notary_office": "  Брестская городская нотариальная контора  "},
        format="json",
    )
    assert saved.status_code == 200, saved.content
    assert saved.json()["notary_office"] == "Брестская городская нотариальная контора"


@pytest.mark.django_db
def test_deactivated_office_leaves_the_list(api, specialist_a):
    call_command("loaddata", "notary_offices", verbosity=0)
    NotaryOffice.objects.get(pk="brestskaya-gorodskaya-notarialnaya-kontora").delete()
    found = api(specialist_a).get("/api/v1/nsi/notary-offices/", {
        "page_size": 20, "search": "Брестская городская",
    })
    assert found.status_code == 200
    assert found.data["results"] == []
