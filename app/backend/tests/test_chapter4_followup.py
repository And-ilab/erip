"""Глава 4: месяцы долга, порядок истории, телефоны и отдельный автообзвон."""

import pytest

from apps.debts.models import Contact, Measure, StatusHistory
from apps.users.models import ServiceOrganization, User

from .conftest import make_account, make_user


@pytest.mark.django_db
def test_refresh_writes_group_before_rating_and_fills_months(account_a):
    from apps.debts.services.portfolio import PortfolioRefresher

    account_a.rating = ""
    account_a.debt_group = None
    account_a.months_debt = None
    account_a.save(update_fields=["rating", "debt_group", "months_debt"])
    PortfolioRefresher().refresh_account(account_a)
    account_a.refresh_from_db()
    assert account_a.months_debt == 7
    rows = list(
        StatusHistory.objects.filter(account=account_a, kind__in=["group", "rating"]).order_by("id")
    )
    assert [row.kind for row in rows][:2] == ["group", "rating"]
    assert rows[0].old_value == ""
    assert rows[1].old_value == ""


@pytest.mark.django_db
def test_account_card_shows_months_from_the_service_period(api, specialist_a, account_a):
    account_a.months_debt = None
    account_a.save(update_fields=["months_debt"])
    card = api(specialist_a).get(f"/api/v1/accounts/{account_a.id}/")
    assert card.status_code == 200, card.content
    assert card.json()["months_debt"] == 7


@pytest.mark.django_db
def test_contacts_show_ais_phones_and_split_by_who_created_them(api, specialist_a, admin_a, org_a, account_a):
    service = account_a.services.get()
    service.provider_id = 900
    service.save(update_fields=["provider_id"])
    account_a.phone = "80171234567"
    account_a.raw = {"Телефон мобильный": "+375291112233"}
    account_a.save(update_fields=["phone", "raw"])
    supplier_org = ServiceOrganization.objects.create(
        organization=org_a, provider_id=900, short_name="Вода", is_supplier=True,
    )
    supplier = make_user("sup_phone", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    supplier.service_organizations.add(supplier_org)

    own = api(specialist_a).post(
        "/api/v1/contacts/",
        {"account": account_a.id, "kind": "mobile", "value": "+375339990000"},
        format="json",
    )
    assert own.status_code == 201, own.content
    assert own.json()["owner_provider_id"] is None
    theirs = api(supplier).post(
        "/api/v1/contacts/",
        {"account": account_a.id, "kind": "mobile", "value": "+375259998877"},
        format="json",
    )
    assert theirs.status_code == 201, theirs.content
    assert theirs.json()["owner_provider_id"] == 900

    def values(user):
        page = api(user).get(f"/api/v1/accounts/{account_a.id}/contacts/")
        assert page.status_code == 200, page.content
        return {row["value"] for row in page.json()["results"]}

    billing = values(specialist_a)
    assert "80171234567" in billing
    assert "+375291112233" in billing
    assert "+375339990000" in billing
    assert "+375259998877" not in billing
    supplied = values(supplier)
    assert "80171234567" in supplied
    assert "+375291112233" in supplied
    assert "+375259998877" in supplied
    assert "+375339990000" not in supplied
    both = values(admin_a)
    assert "+375339990000" in both and "+375259998877" in both

    dossier = api(supplier).get(f"/api/v1/contracts/{service.id}/dossier/")
    assert dossier.status_code == 200, dossier.content
    shown = {row["value"] for row in dossier.json()["contacts"]}
    assert "80171234567" in shown
    assert "+375339990000" not in shown
    assert Contact.objects.filter(account=account_a, source=Contact.Source.AIS, value="80171234567").exists()


@pytest.mark.django_db
def test_each_autocall_keeps_its_own_account(api, admin_a, org_a):
    first = make_account(org_a, 4301, client_account="00004301", contact_phone="+375291111111", debt_group=2)
    second = make_account(org_a, 4302, client_account="00004302", contact_phone="+375292222222", debt_group=2)
    payload = {
        "kind": "call", "template_name": "Автообзвон",
        "time_from": "18:00", "time_to": "21:00", "started_on": "2026-11-04",
    }
    one = api(admin_a).post("/api/v1/measures/", {**payload, "account_ids": [first.id]}, format="json")
    two = api(admin_a).post("/api/v1/measures/", {**payload, "account_ids": [second.id]}, format="json")
    assert one.status_code == 201, one.content
    assert two.status_code == 201, two.content
    assert one.json()["id"] != two.json()["id"]
    opened = api(admin_a).get(f"/api/v1/measures/{one.json()['id']}/")
    assert opened.status_code == 200, opened.content
    assert {row["account"] for row in opened.json()["items"]} == {first.id}
    assert Measure.objects.get(pk=two.json()["id"]).accounts.get().id == second.id
