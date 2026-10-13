from datetime import date
from decimal import Decimal

import pytest
from django.core.management import call_command

from apps.debts.models import AccountService, BalanceHistory
from apps.users.models import ServiceOrganization, User

from .conftest import make_account, make_user


@pytest.fixture
def scale(org_a):
    call_command("loaddata", "debt_group_scale", verbosity=0)


def test_charts_follow_stage_group_and_history(api, specialist_a, org_a, org_b, scale):
    first = make_account(org_a, 3001, funnel_stage="warning", debt_group=1, debt_group_manual=4,
                         debt_group_manual_reason="Комиссия", operational_date=date(2026, 7, 9))
    service = AccountService.objects.create(
        organization=org_a, account=first, service_list_id=31, service_id=31, service_name="Газ",
        provider_id=501, balance_out=Decimal("40000"), balance_mulct_out=Decimal("8000"),
    )
    AccountService.objects.create(
        organization=org_a, account=first, service_list_id=32, service_id=32, service_name="Вода",
        provider_id=501, balance_out=Decimal("10000"), balance_mulct_out=Decimal("2000"),
    )
    second = make_account(org_a, 3002, funnel_stage="", debt_group=1, operational_date=date(2026, 6, 1))
    AccountService.objects.create(
        organization=org_a, account=second, service_list_id=33, service_id=33, service_name="Газ",
        provider_id=501, balance_out=Decimal("12000"), balance_mulct_out=Decimal("400"),
    )
    foreign = make_account(org_b, 3003, funnel_stage="court", debt_group=6)
    AccountService.objects.create(
        organization=org_b, account=foreign, service_list_id=34, service_id=34, service_name="Газ",
        provider_id=501, balance_out=Decimal("999"), balance_mulct_out=Decimal("1"),
    )
    BalanceHistory.objects.create(
        organization=org_a, account=first, service=service, period=date(2026, 6, 1),
        principal=Decimal("30000"), penalty=Decimal("5000"),
    )
    BalanceHistory.objects.create(
        organization=org_a, account=second, service=second.services.get(), period=date(2026, 7, 1),
        principal=Decimal("12000"), penalty=Decimal("400"),
    )

    body = api(specialist_a).get("/api/v1/accounts/charts/").json()

    assert body["as_of"] == "2026-07-09"
    assert body["cases"] == 2
    assert Decimal(body["principal"]) == Decimal("62000")
    assert Decimal(body["penalty"]) == Decimal("10400")
    by_stage = {row["code"]: row for row in body["stages"]}
    assert by_stage["warning"]["cases"] == 1
    assert Decimal(by_stage["warning"]["principal"]) == Decimal("50000")
    assert Decimal(by_stage["warning"]["penalty"]) == Decimal("10000")
    assert by_stage["new"]["cases"] == 1
    assert by_stage["court"]["cases"] == 0
    groups = {row["group"]: row for row in body["groups"]}
    assert groups[4]["cases"] == 1
    assert groups[4]["title"] == "Группа 4 · 6–12 месяцев"
    assert groups[1]["cases"] == 1
    assert 6 not in groups
    assert body["months_source"] == "history"
    assert [row["period"] for row in body["months"]] == ["2026-06-01", "2026-07-01"]
    assert body["months"][0]["cases"] == 1


def test_charts_without_history_are_the_current_slice(api, specialist_a, org_a, scale):
    account = make_account(org_a, 3101, funnel_stage="new", debt_group=2)
    AccountService.objects.create(
        organization=org_a, account=account, service_list_id=41, service_id=41,
        balance_out=Decimal("15.50"), balance_mulct_out=Decimal("1.25"), provider_id=501,
    )
    body = api(specialist_a).get("/api/v1/accounts/charts/").json()
    assert body["months_source"] == "current"
    assert len(body["months"]) == 1
    assert Decimal(body["months"][0]["principal"]) == Decimal("15.50")
    assert Decimal(body["months"][0]["penalty"]) == Decimal("1.25")


def test_supplier_charts_skip_foreign_services(api, org_a, scale):
    account = make_account(org_a, 3201, funnel_stage="disconnect", debt_group=3)
    AccountService.objects.create(
        organization=org_a, account=account, service_list_id=51, service_id=51, service_name="Вода",
        provider_id=900, balance_out=Decimal("70"), balance_mulct_out=Decimal("7"),
    )
    AccountService.objects.create(
        organization=org_a, account=account, service_list_id=52, service_id=52, service_name="Газ",
        provider_id=800, balance_out=Decimal("900"), balance_mulct_out=Decimal("90"),
    )
    supplier_org = ServiceOrganization.objects.create(
        organization=org_a, provider_id=900, short_name="Водоканал", is_supplier=True,
    )
    supplier = make_user("charts_supplier", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    supplier.service_organizations.add(supplier_org)
    body = api(supplier).get("/api/v1/accounts/charts/").json()
    assert body["cases"] == 1
    assert Decimal(body["principal"]) == Decimal("70")
    assert Decimal(body["penalty"]) == Decimal("7")
