"""Замечания главы 3: карточка ЛС и реестр договоров."""

from datetime import date
from decimal import Decimal

import pytest

from apps.debts.models import AccountService, Measure, Registration, StatusHistory
from apps.nsi.models import DebtorCategory, ExtraMeasureCatalog
from apps.notifications.models import Notification
from apps.users.models import User

from .conftest import make_account, make_user


def _service(org, account, list_id, **extra):
    extra.setdefault("balance_out", Decimal("40"))
    extra.setdefault("service_name", "Вода")
    return AccountService.objects.create(
        organization=org, account=account, service_list_id=list_id, service_id=list_id,
        provider_id=700, shot_name="Водоканал", **extra,
    )


def _person(org, account, registration_id, **extra):
    extra.setdefault("subj_id", registration_id)
    extra.setdefault("fam", "Сидоров")
    return Registration.objects.create(
        organization=org, account=account, registration_id=registration_id, **extra,
    )


@pytest.mark.django_db
def test_registered_count_skips_departed(api, admin_a, org_a):
    account = make_account(org_a, 3101, client_account="00003101", subj_count=9)
    _service(org_a, account, 31)
    _person(org_a, account, 1, reg_status=1, subj_is_main=True)
    _person(org_a, account, 2, reg_status=1)
    _person(org_a, account, 3, reg_status=0)
    _person(org_a, account, 4, subj_is_check_out=True, reg_status=1)
    listed = api(admin_a).get("/api/v1/accounts/", {"search": "00003101"}).json()
    row = next(item for item in listed["results"] if item["id"] == account.id)
    assert row["registered_count"] == 2
    contracts = api(admin_a).get("/api/v1/contracts/", {"search": "00003101"}).json()
    service = contracts["results"][0]
    assert service["registered_count"] == 2
    assert service["subj_count"] == 2


@pytest.mark.django_db
def test_auto_category_from_registration_flags(org_a):
    from apps.debts.services.portfolio import PortfolioRefresher

    account = make_account(org_a, 3102, client_account="00003102")
    _person(org_a, account, 1, reg_status=1, idler_val=True, subj_is_main=True)
    PortfolioRefresher().refresh_account(account)
    account.refresh_from_db()
    assert account.debtor_category.code == "ais-17"
    _person(org_a, account, 2, reg_status=1, left_country=True)
    PortfolioRefresher().refresh_account(account)
    account.refresh_from_db()
    assert account.debtor_category.code == "ais-08"
    manual = DebtorCategory.objects.get(code="ais-01")
    account.debtor_category = manual
    account.save(update_fields=["debtor_category"])
    PortfolioRefresher().refresh_account(account)
    account.refresh_from_db()
    assert account.debtor_category_id == manual.id


@pytest.mark.django_db
def test_payer_death_pauses_and_new_payer_resumes(org_a, specialist_a):
    from apps.debts.services.portfolio import PortfolioRefresher

    account = make_account(org_a, 3103, client_account="00003103", assigned_to=specialist_a)
    _service(org_a, account, 33, balance_out=Decimal("80"), debt_period=4)
    _person(org_a, account, 1, subj_id=50, subj_is_main=True, subj_death_date=date(2026, 1, 2))
    measure = Measure.objects.create(organization=org_a, kind=Measure.Kind.CALL, status=Measure.Status.ASSIGNED)
    measure.accounts.add(account)
    PortfolioRefresher().refresh_account(account)
    account.refresh_from_db()
    measure.refresh_from_db()
    assert account.payer_deceased is True
    assert measure.status == Measure.Status.PAUSED
    assert Notification.objects.filter(account=account, recipient_user=specialist_a).exists()
    _person(org_a, account, 2, subj_id=51, subj_is_main=True)
    PortfolioRefresher().refresh_account(account)
    account.refresh_from_db()
    measure.refresh_from_db()
    assert account.payer_deceased is False
    assert measure.status == Measure.Status.ASSIGNED


@pytest.mark.django_db
def test_contracts_closed_for_billing_specialist(api, specialist_a, admin_a, observer_a, org_a, account_a):
    denied = api(specialist_a).get("/api/v1/contracts/")
    assert denied.status_code == 403
    viewer = make_user("viewer_a", User.Role.VIEWER, org_a)
    assert api(admin_a).get("/api/v1/contracts/").status_code == 200
    assert api(observer_a).get("/api/v1/contracts/").status_code == 200
    assert api(viewer).get("/api/v1/contracts/").status_code == 200
    supplier = make_user("sup_ch3", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    assert api(supplier).get("/api/v1/contracts/").status_code == 200


@pytest.mark.django_db
def test_registry_hides_services_without_debt(api, admin_a, org_a, account_a):
    empty = _service(org_a, account_a, 88, balance_out=0, balance_mulct_out=0, overdue_debt=0, service_name="Нулевая")
    owed = _service(org_a, account_a, 89, balance_out=Decimal("5"))
    listed = api(admin_a).get("/api/v1/contracts/", {"account": account_a.id}).json()
    ids = {row["id"] for row in listed["results"]}
    assert owed.id in ids
    assert empty.id not in ids
    card = api(admin_a).get(f"/api/v1/contracts/{empty.id}/")
    assert card.status_code == 200


@pytest.mark.django_db
def test_group_zero_on_contracts(api, admin_a, org_a):
    account = make_account(org_a, 3104, client_account="00003104")
    bare = _service(org_a, account, 41, debt_group=None, debt_group_manual=None)
    marked = _service(org_a, account, 42, debt_group=2, debt_group_manual=0, debt_group_manual_reason="нет группы")
    found = api(admin_a).get("/api/v1/contracts/", {"debt_group": 0}).json()
    ids = {row["id"] for row in found["results"]}
    assert bare.id in ids
    assert marked.id in ids


@pytest.mark.django_db
def test_extra_measure_and_hold(api, admin_a, org_a, account_a):
    catalog = ExtraMeasureCatalog.objects.create(name="Обход", note="лично")
    created = api(admin_a).post(
        "/api/v1/accounts/extra-measures/",
        {"catalog_id": catalog.id, "account_ids": [account_a.id]},
        format="json",
    )
    assert created.status_code == 201, created.content
    measure = Measure.objects.get(pk=created.json()["id"])
    assert measure.extra is True
    assert measure.accounts.filter(pk=account_a.id).exists()
    held = api(admin_a).post(
        f"/api/v1/measures/{measure.id}/hold/",
        {"until": "2026-12-01", "reason": "ожидание справки"},
        format="json",
    )
    assert held.status_code == 200, held.content
    measure.refresh_from_db()
    assert measure.status == Measure.Status.PAUSED
    assert measure.pause_reason == "ожидание справки"
    released = api(admin_a).post(f"/api/v1/measures/{measure.id}/release/", {}, format="json")
    assert released.status_code == 200
    measure.refresh_from_db()
    assert measure.status == Measure.Status.ASSIGNED
    assert StatusHistory.objects.filter(account=account_a, kind=StatusHistory.Kind.MEASURE).exists()


@pytest.mark.django_db
def test_service_catalog_uses_contract_id_and_drops_periods(api, admin_a):
    body = api(admin_a).get("/api/v1/contracts/columns/", {"board": "services"}).json()
    available = body["available"]
    assert "period_balances" not in available
    assert available.index("service_list_id") < available.index("service_name")
    assert "agreement_number" in available
    assert "address" in available
    assert "idn_unp" in available


@pytest.mark.django_db
def test_due_day_comes_from_contract(api, admin_a, org_a, account_a):
    row = _service(org_a, account_a, 90, payment_due_day=31)
    listed = api(admin_a).get(f"/api/v1/contracts/{row.id}/").json()
    assert listed["payment_due_day"] == 31
    assert listed["agreement_number"] == ""
