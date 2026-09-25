"""ТЗ 4.2.2: реестр договоров поставщика, наследство на всех ЛС, свои услуги."""

from datetime import date, time
from decimal import Decimal

import pytest
from django.core.management import call_command

from apps.debts.models import AccountService, Contact, DebtWorkItem, Measure, StatusHistory
from apps.debts.services.contacts import choose_phone
from apps.debts.services.grouping import DebtGroupCalculator
from apps.debts.services.portfolio import PortfolioRefresher
from apps.nsi.models import CalculationSettings, DebtorCategory, ScenarioRule
from apps.users.models import ServiceOrganization, User

from .conftest import make_account, make_user


@pytest.fixture
def ready(org_a):
    call_command("loaddata", "debt_group_scale", verbosity=0)


def _supplier(org_a, account_a):
    water = AccountService.objects.create(
        organization=org_a, account=account_a, service_list_id=2, service_id=11,
        service_name="Вода", provider_id=900, shot_name="Водоканал", balance_out=Decimal("50"),
        balance_mulct_out=Decimal("5"), debt_period=1,
    )
    AccountService.objects.filter(account=account_a).exclude(pk=water.pk).update(provider_id=800, balance_out=Decimal("100"))
    supplier_org = ServiceOrganization.objects.create(
        organization=org_a, provider_id=900, short_name="Водоканал", is_supplier=True,
    )
    supplier = make_user("supplier_dbr", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    supplier.service_organizations.add(supplier_org)
    account_a.payer_identifier = "IN-DBR"
    account_a.save(update_fields=["payer_identifier"])
    return supplier, water


def test_supplier_summary_hides_foreign_service_and_balance(api, org_a, account_a):
    supplier, water = _supplier(org_a, account_a)
    client = api(supplier)
    summary = client.get("/api/v1/contracts/summary/").json()
    assert summary["ls_count"] == 1
    assert Decimal(summary["principal"]) == Decimal("50")
    persons = client.get("/api/v1/contracts/persons/").json()["results"]
    assert persons[0]["payer_identifier"] == "IN-DBR"
    assert persons[0]["ls_count"] == 1
    assert persons[0]["payer_unp"] == ""
    card = client.get(f"/api/v1/accounts/{account_a.id}/").json()
    assert Decimal(card["balance_out"]) == Decimal("50")
    gas = account_a.services.exclude(pk=water.pk).get()
    denied = client.post(
        "/api/v1/measures/",
        {"kind": "disconnect", "account_ids": [account_a.id], "service_ids": [gas.id]},
        format="json",
    )
    assert denied.status_code == 400
    DebtWorkItem.objects.create(
        organization=org_a, account=account_a, service=gas, kind=DebtWorkItem.Kind.WARNING, title="Чужое",
    )
    titles = [row["title"] for row in client.get(f"/api/v1/accounts/{account_a.id}/work-items/").json()["results"]]
    assert "Чужое" not in titles


def test_dossier_shows_periods_contacts_and_journal(api, specialist_a, org_a, account_a, ready):
    account_a.operational_date = date(2026, 9, 1)
    account_a.payer_identifier = "IN-DBR"
    account_a.save(update_fields=["operational_date", "payer_identifier"])
    DebtGroupCalculator().recalculate(account_a, operational=date(2026, 9, 1))
    service = account_a.services.get()
    service.refresh_from_db()
    assert service.repayment_due_on == date(2026, 4, 25)
    person = account_a.registrations.get()
    patched = api(specialist_a).patch(
        f"/api/v1/registrations/{person.id}/",
        {"social_category": "Пенсионер", "unfit_for_work": True, "heritage_transfer": "accept"},
        format="json",
    )
    assert patched.status_code == 200
    created = api(specialist_a).post(
        "/api/v1/contacts/",
        {"account": account_a.id, "kind": "mobile", "value": "+375291110000", "priority": 2},
        format="json",
    )
    assert created.status_code == 201
    dossier = api(specialist_a).get(f"/api/v1/contracts/{service.id}/dossier/").json()
    assert dossier["periods"]
    assert dossier["people"][0]["social_category"] == "Пенсионер"
    assert dossier["people"][0]["unfit_for_work"] is True
    assert any(row["kind"] == "contact" for row in dossier["journal"])
    assert any(row["kind"] == "registration" for row in dossier["journal"])


def test_inheritance_pauses_every_account_and_resumes_after_the_term(api, specialist_a, org_a, account_a, ready):
    account_a.payer_identifier = "IN-DBR"
    account_a.save(update_fields=["payer_identifier"])
    other = make_account(org_a, 1002, client_account="00001002", payer_identifier="IN-DBR")
    AccountService.objects.create(
        organization=org_a, account=other, service_list_id=3, service_id=12,
        service_name="Газ", balance_out=Decimal("10"), debt_period=1,
    )
    measure = Measure.objects.create(
        organization=org_a, kind=Measure.Kind.CALL, status=Measure.Status.ASSIGNED, template_name="Шаблон",
    )
    measure.accounts.add(other)
    response = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/",
        {"inheritance_case": True, "inheritance_until": "2020-01-01"},
        format="json",
    )
    assert response.status_code == 200
    other.refresh_from_db()
    measure.refresh_from_db()
    assert other.inheritance_case is True
    assert measure.status == Measure.Status.PAUSED
    account_a.refresh_from_db()
    PortfolioRefresher().refresh_account(account_a)
    account_a.refresh_from_db()
    other.refresh_from_db()
    measure.refresh_from_db()
    assert account_a.inheritance_case is False
    assert other.inheritance_case is False
    assert measure.status == Measure.Status.ASSIGNED
    assert StatusHistory.objects.filter(account=account_a, kind="inheritance").exists()


def test_disconnect_confirmation_and_mobile_hours(api, specialist_a, account_a):
    service = account_a.services.get()
    created = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "disconnect", "account_ids": [account_a.id], "service_ids": [service.id]},
        format="json",
    )
    assert created.status_code == 201
    confirmed = api(specialist_a).post(
        f"/api/v1/measures/{created.json()['id']}/confirm/",
        {"action": "suspend", "source": "ais"},
        format="json",
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["suspension_source"] == "ais"
    assert confirmed.json()["status"] == "running"
    Contact.objects.create(
        organization=account_a.organization, account=account_a, kind=Contact.Kind.CITY, value="+375172220000",
        source=Contact.Source.PM, priority=9,
    )
    Contact.objects.create(
        organization=account_a.organization, account=account_a, kind=Contact.Kind.MOBILE, value="+375291110000",
        source=Contact.Source.PM, priority=1,
    )
    settings = CalculationSettings.load()
    settings.dial_mobile_from_hour = 18
    settings.dial_mobile_to_hour = 23
    settings.save()
    picked = choose_phone(account_a, date(2026, 9, 10), time(20, 0))
    assert picked.value == "+375291110000"
    daytime = choose_phone(account_a, date(2026, 9, 10), time(12, 0))
    assert daytime.value == "+375172220000"


def test_contract_kanban_and_saved_shape(api, specialist_a, account_a):
    columns = api(specialist_a).get("/api/v1/contracts/kanban/").json()
    assert {column["stage"] for column in columns}
    grouped = api(specialist_a).get("/api/v1/contracts/grouped/", {"group_by": "debt_group"}).json()
    assert isinstance(grouped, list)


def test_supplier_warning_needs_own_service(api, org_a, account_a):
    supplier, water = _supplier(org_a, account_a)
    client = api(supplier)
    denied = client.post(
        "/api/v1/measures/",
        {"kind": "warning", "account_ids": [account_a.id], "template_name": "Предупреждение"},
        format="json",
    )
    assert denied.status_code == 400
    allowed = client.post(
        "/api/v1/measures/",
        {
            "kind": "warning", "account_ids": [account_a.id], "service_ids": [water.id],
            "template_name": "Предупреждение",
        },
        format="json",
    )
    assert allowed.status_code == 201


def test_category_recalculates_scenario_immediately(api, specialist_a, org_a, account_a):
    service = account_a.services.get()
    service.debt_group = 4
    service.save(update_fields=["debt_group"])
    account_a.debt_group = 4
    account_a.payer_identifier = "IN-DBR"
    account_a.save(update_fields=["debt_group", "payer_identifier"])
    other = make_account(org_a, 1003, client_account="00001003", payer_identifier="IN-DBR")
    AccountService.objects.create(
        organization=org_a, account=other, service_list_id=4, service_id=13,
        service_name="Газ", balance_out=Decimal("10"), debt_group=4,
    )
    category = DebtorCategory.objects.create(organization=org_a, code="pens", name="Пенсионер")
    ScenarioRule.objects.create(group=4, category=category, name="Сценарий пенсионера")
    response = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"debtor_category": category.id}, format="json",
    )
    assert response.status_code == 200
    service.refresh_from_db()
    other.refresh_from_db()
    assert service.scenario_name == "Сценарий пенсионера"
    assert other.debtor_category_id == category.id
    assert other.services.get().scenario_name == "Сценарий пенсионера"


def test_kanban_is_one_card_per_debtor(api, org_a, specialist_a, account_a):
    account_a.payer_identifier = "IN-DBR"
    account_a.funnel_stage = "warning"
    account_a.save(update_fields=["payer_identifier", "funnel_stage"])
    AccountService.objects.create(
        organization=org_a, account=account_a, service_list_id=8, service_id=18,
        service_name="Свет", balance_out=Decimal("20"),
    )
    columns = api(specialist_a).get("/api/v1/contracts/kanban/").json()
    warning = next(column for column in columns if column["stage"] == "warning")
    assert warning["total"] == 1
    assert warning["cards"][0]["ls_count"] == 1
    assert warning["cards"][0]["payer_identifier"] == "IN-DBR"


def test_contact_is_tied_to_a_person_and_stop_date_does_not_confirm(api, specialist_a, org_a, account_a):
    person = account_a.registrations.get()
    created = api(specialist_a).post(
        "/api/v1/contacts/",
        {
            "account": account_a.id, "registration": person.id, "kind": "mobile",
            "value": "+375291110000", "priority": 1,
        },
        format="json",
    )
    assert created.status_code == 201
    assert created.json()["person_name"].startswith("Иванов")
    service = account_a.services.get()
    measure = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "disconnect", "account_ids": [account_a.id], "service_ids": [service.id], "started_on": "2026-09-01"},
        format="json",
    )
    assert measure.status_code == 201
    service.stop_date = date(2026, 9, 10)
    service.save(update_fields=["stop_date"])
    PortfolioRefresher().refresh_account(account_a)
    row = Measure.objects.get(pk=measure.json()["id"])
    assert row.suspension_source == ""
    assert row.suspension_confirmed_on is None
    assert row.status == Measure.Status.ASSIGNED
    legal = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"legal_status": "liquidation"}, format="json",
    )
    assert legal.status_code == 200
    account_a.refresh_from_db()
    assert account_a.legal_status == "liquidation"
    assert account_a.bankruptcy is True


def test_supplier_without_organizations_sees_nothing(api, org_a, account_a):
    supplier = make_user("empty_supplier", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    client = api(supplier)
    assert client.get("/api/v1/accounts/").json()["count"] == 0
    assert client.get("/api/v1/contracts/").json()["count"] == 0


def test_supplier_cannot_rewrite_billing_fields(api, org_a, account_a):
    supplier, _water = _supplier(org_a, account_a)
    response = api(supplier).patch(
        f"/api/v1/accounts/{account_a.id}/",
        {"debt_group_manual": 3, "debt_group_manual_reason": "чужая группа"},
        format="json",
    )
    assert response.status_code == 400
    account_a.refresh_from_db()
    assert account_a.debt_group_manual is None


def test_supplier_category_and_inheritance_stay_on_visible_accounts(api, org_a, account_a):
    supplier, _water = _supplier(org_a, account_a)
    other = make_account(org_a, 4401, provider_id=800, payer_identifier="IN-DBR")
    AccountService.objects.create(
        organization=org_a, account=other, service_list_id=9, service_id=19,
        service_name="Газ", provider_id=800, balance_out=Decimal("10"), debt_group=4,
    )
    category = DebtorCategory.objects.create(organization=org_a, code="pens2", name="Пенсионер")
    client = api(supplier)
    category_response = client.patch(
        f"/api/v1/accounts/{account_a.id}/", {"debtor_category": category.id}, format="json",
    )
    assert category_response.status_code == 200
    inheritance = client.patch(
        f"/api/v1/accounts/{account_a.id}/",
        {"inheritance_case": True, "inheritance_until": "2026-12-31"},
        format="json",
    )
    assert inheritance.status_code == 200
    other.refresh_from_db()
    account_a.refresh_from_db()
    assert account_a.debtor_category_id == category.id
    assert account_a.inheritance_case is True
    assert other.debtor_category_id is None
    assert other.inheritance_case is False


def test_foreign_service_work_item_is_rejected(api, org_a, account_a):
    supplier, water = _supplier(org_a, account_a)
    gas = account_a.services.exclude(pk=water.pk).get()
    denied = api(supplier).post(
        "/api/v1/work-items/",
        {"account": account_a.id, "kind": "warning", "service": gas.id, "title": "чужая"},
        format="json",
    )
    assert denied.status_code == 400
    allowed = api(supplier).post(
        "/api/v1/work-items/",
        {"account": account_a.id, "kind": "warning", "service": water.id, "title": "своя"},
        format="json",
    )
    assert allowed.status_code == 201


def test_blank_payer_keys_stay_separate_and_bad_ids_are_400(api, specialist_a, org_a, account_a):
    account_a.payer_identifier = ""
    account_a.payer_unp = ""
    account_a.save(update_fields=["payer_identifier", "payer_unp"])
    other = make_account(org_a, 4402, payer_identifier="", payer_unp="")
    AccountService.objects.create(
        organization=org_a, account=other, service_list_id=10, service_id=20,
        service_name="Свет", balance_out=Decimal("5"),
    )
    persons = api(specialist_a).get("/api/v1/contracts/persons/").json()
    assert persons["count"] == 2
    bad_page = api(specialist_a).get("/api/v1/contracts/kanban/", {"page_size": "abc"})
    assert bad_page.status_code == 400
    service = account_a.services.get()
    bad_ids = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "disconnect", "account_ids": [account_a.id], "service_ids": ["нет"]},
        format="json",
    )
    assert bad_ids.status_code == 400
    assert service.id
