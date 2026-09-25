from datetime import date
from decimal import Decimal

import pytest
from django.core.management import call_command

from apps.debts.models import AccountService, Contact, Measure, Registration, StatusHistory
from apps.debts.services.contacts import choose_phone
from apps.debts.services.grouping import DebtGroupCalculator
from apps.debts.services.portfolio import PortfolioRefresher
from apps.nsi.models import DebtorCategory
from apps.users.models import ServiceOrganization, User

from .conftest import make_user


@pytest.fixture
def ready(org_a):
    call_command("loaddata", "debt_group_scale", verbosity=0)


def test_manual_group_is_what_the_registry_filters(api, specialist_a, account_a, ready):
    account_a.debt_group = 2
    account_a.debt_group_manual = 5
    account_a.debt_group_manual_reason = "Комиссия"
    account_a.debt_group_basis = 2
    account_a.save()
    listed = api(specialist_a).get("/api/v1/accounts/?debt_group=5").json()
    assert listed["count"] == 1
    assert api(specialist_a).get("/api/v1/accounts/?debt_group=2").json()["count"] == 0


def test_rating_and_debt_start_follow_the_rules(org_a, account_a, ready):
    account_a.operational_date = date(2026, 9, 1)
    account_a.payer_identifier = "7010180A001PB2"
    account_a.save()
    Registration.objects.filter(account=account_a).update(personal_num="7010180A001PB2", idler_val=False)
    PortfolioRefresher().refresh_account(account_a)
    account_a.refresh_from_db()
    assert account_a.debt_group == 4
    assert account_a.rating == "C"
    assert account_a.rating_repeat == 1
    assert account_a.debt_started_on == date(2026, 4, 26)
    assert account_a.scenario_name
    assert StatusHistory.objects.filter(account=account_a, kind="group").exists()


def test_grounds_change_clears_manual_group(org_a, account_a, ready):
    service = account_a.services.get()
    account_a.debt_group_manual = 1
    account_a.debt_group_manual_reason = "Перерасчёт"
    account_a.debt_group_basis = 4
    account_a.save()
    service.debt_period = 1
    service.save(update_fields=["debt_period"])
    DebtGroupCalculator().recalculate(account_a)
    account_a.refresh_from_db()
    assert account_a.debt_group == 1
    assert account_a.debt_group_manual is None


def test_supplier_sees_only_own_service(api, org_a, account_a):
    other = AccountService.objects.create(
        organization=org_a, account=account_a, service_list_id=2, service_id=11,
        service_name="Вода", provider_id=900, shot_name="Водоканал", balance_out=Decimal("50"), debt_period=1,
    )
    AccountService.objects.filter(pk=account_a.services.exclude(pk=other.pk).get().pk).update(provider_id=800)
    supplier_org = ServiceOrganization.objects.create(
        organization=org_a, provider_id=900, short_name="Водоканал", is_supplier=True,
    )
    supplier = make_user("supplier", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    supplier.service_organizations.add(supplier_org)
    rows = api(supplier).get("/api/v1/contracts/").json()["results"]
    assert [row["id"] for row in rows] == [other.id]
    assert api(supplier).get("/api/v1/accounts/").json()["count"] == 1
    services = api(supplier).get(f"/api/v1/accounts/{account_a.id}/services/").json()["results"]
    assert [row["service_name"] for row in services] == ["Вода"]


def test_pm_contact_survives_ais_refresh_and_dial_prefers_mobile(org_a, account_a, ready):
    Contact.objects.create(
        organization=org_a, account=account_a, kind=Contact.Kind.MOBILE, value="+375291110000",
        source=Contact.Source.PM, priority=5,
    )
    PortfolioRefresher().refresh_account(account_a)
    pm = Contact.objects.get(source=Contact.Source.PM)
    assert pm.value == "+375291110000"
    assert Contact.objects.filter(source=Contact.Source.AIS, value=account_a.contact_phone).exists()
    picked = choose_phone(account_a, date(2026, 9, 26))
    assert picked.value == "+375291110000"


def test_inheritance_blocks_auto_measure_and_lifts_for_new_payer(api, specialist_a, org_a, account_a, ready):
    payer = Registration.objects.get(account=account_a)
    response = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/",
        {"inheritance_case": True, "inheritance_until": "2026-12-31"},
        format="json",
    )
    assert response.status_code == 200
    account_a.refresh_from_db()
    assert account_a.inheritance_payer_id == payer.subj_id
    blocked = api(specialist_a).post("/api/v1/measures/", {"kind": "call", "account_ids": [account_a.id]}, format="json")
    assert blocked.status_code == 400
    allowed = api(specialist_a).post(
        "/api/v1/measures/",
        {
            "kind": "collection", "account_ids": [account_a.id], "service_ids": [account_a.services.get().id],
            "assignee": specialist_a.id, "due_on": "2026-10-01",
        },
        format="json",
    )
    assert allowed.status_code == 201
    Registration.objects.create(
        organization=org_a, account=account_a, registration_id=2, subj_id=77, fam="Новый", im="Пётр",
        subj_is_main=True,
    )
    PortfolioRefresher().refresh_account(account_a)
    account_a.refresh_from_db()
    assert account_a.inheritance_case is False


def test_refresh_recalculates_the_loaded_account(api, specialist_a, account_a, ready):
    created = api(specialist_a).post(f"/api/v1/accounts/{account_a.id}/refresh/")
    assert created.status_code == 200
    assert created.json()["status"] == "done"
    again = api(specialist_a).post(f"/api/v1/accounts/{account_a.id}/refresh/")
    assert again.status_code == 200
    assert again.json()["id"] != created.json()["id"]


def test_disconnect_requires_a_service_and_payment_cancels_it(api, specialist_a, account_a, ready):
    missing = api(specialist_a).post("/api/v1/measures/", {"kind": "disconnect", "account_ids": [account_a.id]}, format="json")
    assert missing.status_code == 400
    service = account_a.services.get()
    created = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "disconnect", "account_ids": [account_a.id], "service_ids": [service.id], "started_on": "2026-09-01", "days": 10},
        format="json",
    )
    assert created.status_code == 201
    assert created.json()["due_on"] == "2026-09-11"
    service.balance_out = Decimal("0")
    service.save(update_fields=["balance_out"])
    PortfolioRefresher().refresh_account(account_a)
    assert Measure.objects.get(pk=created.json()["id"]).status == Measure.Status.CANCELLED


def test_category_can_be_set_and_ais_field_stays_locked(api, specialist_a, account_a):
    category = DebtorCategory.objects.get(code="pensioner")
    response = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/",
        {"debtor_category": category.id, "residence_note": "фактически у сестры", "short_fio": "Чужой"},
        format="json",
    )
    assert response.status_code == 200
    account_a.refresh_from_db()
    assert account_a.debtor_category_id == category.id
    assert account_a.residence_note == "фактически у сестры"
    assert account_a.short_fio == "Иванов И.И."


def test_group_comes_from_unpaid_periods_and_reentry_raises_subrating(org_a, account_a, ready):
    from apps.debts.models import ServiceDebtPeriod

    account_a.operational_date = date(2026, 9, 1)
    account_a.save()
    PortfolioRefresher().refresh_account(account_a)
    service = account_a.services.get()
    periods = list(ServiceDebtPeriod.objects.filter(service=service).order_by("period"))
    assert len(periods) == 7
    assert periods[0].started_on == date(2026, 4, 26)
    assert sum(row.principal for row in periods) == service.balance_out
    account_a.refresh_from_db()
    assert account_a.rating_repeat == 1
    service.balance_out = Decimal("0")
    service.debt_period = 0
    service.save()
    PortfolioRefresher().refresh_account(account_a)
    account_a.refresh_from_db()
    assert account_a.rating == "A"
    assert account_a.rating_repeat is None
    assert account_a.scenario_name == ""
    service.balance_out = Decimal("100")
    service.debt_period = 7
    service.save()
    PortfolioRefresher().refresh_account(account_a)
    account_a.refresh_from_db()
    assert account_a.rating == "C"
    assert account_a.rating_repeat == 2


def test_call_file_uses_the_dial_rule_and_warning_is_a_file(api, specialist_a, account_a, ready):
    Contact.objects.create(
        organization=account_a.organization, account=account_a, kind=Contact.Kind.MOBILE, value="+375291110000",
        source=Contact.Source.PM, priority=3,
    )
    created = api(specialist_a).post(
        "/api/v1/measures/",
        {
            "kind": "call", "account_ids": [account_a.id], "template_name": "Напоминание",
            "time_from": "10:00", "time_to": "18:00", "days": 2, "started_on": "2026-09-26",
        },
        format="json",
    )
    assert created.status_code == 201
    measure = Measure.objects.get(pk=created.json()["id"])
    text = measure.artifact.read().decode("utf-8-sig")
    assert "+375291110000" in text
    assert "Напоминание" in text
    warning = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "warning", "account_ids": [account_a.id], "template_name": "Предупреждение"},
        format="json",
    )
    assert warning.status_code == 201
    assert Measure.objects.get(pk=warning.json()["id"]).artifact.name.endswith(".pdf")


def test_registry_filters_several_groups(api, specialist_a, account_a, ready):
    account_a.debt_group = 3
    account_a.save()
    listed = api(specialist_a).get("/api/v1/accounts/?debt_group__in=3,4").json()
    assert listed["count"] == 1
    grouped = api(specialist_a).get("/api/v1/accounts/grouped/?group_by=debt_group").json()
    assert any(row["value"] == "3" for row in grouped)
