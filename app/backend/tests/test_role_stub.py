"""Временный вход по роли без пароля. В проде маршрут закрыт."""

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.users.models import ServiceOrganization, User

pytestmark = pytest.mark.django_db


@override_settings(DEBUG=False)
def test_stub_role_hidden_when_debug_off():
    client = APIClient()
    assert client.get("/api/v1/auth/stub-role/").status_code == 404
    assert client.post("/api/v1/auth/stub-role/", {"role": "specialist"}, format="json").status_code == 404


@override_settings(DEBUG=True)
def test_stub_role_issues_session_for_schema_with_data(org_a, account_a):
    account_a.services.update(provider_id=account_a.provider_id)
    supplier_org = ServiceOrganization.objects.get(organization=org_a, provider_id=account_a.provider_id)
    supplier_org.is_supplier = True
    supplier_org.short_name = "Поставщик"
    supplier_org.save(update_fields=["is_supplier", "short_name", "updated_at"])
    client = APIClient()
    listed = client.get("/api/v1/auth/stub-role/")
    assert listed.status_code == 200
    assert {row["id"] for row in listed.json()} == {
        "superadmin", "local_admin", "specialist", "observer", "supplier", "test_zhes",
    }

    entered = client.post("/api/v1/auth/stub-role/", {"role": "specialist"}, format="json")
    assert entered.status_code == 200
    assert "refresh" not in entered.json()
    assert "erip_refresh" in entered.cookies
    me = client.get("/api/v1/auth/me/", HTTP_AUTHORIZATION=f"Bearer {entered.json()['access']}")
    assert me.status_code == 200
    assert me.json()["role"] == "specialist"
    assert me.json()["organization"] == org_a.id
    assert me.json()["show_schema"] is False
    assert me.json()["show_supplier"] is False
    assert me.json()["show_service_org"] is False
    assert client.get("/api/v1/accounts/", HTTP_AUTHORIZATION=f"Bearer {entered.json()['access']}").json()["count"] == 1

    supplier = client.post("/api/v1/auth/stub-role/", {"role": "supplier"}, format="json")
    user = User.objects.get(username="stub-supplier")
    assert user.contour == User.Contour.SUPPLIER
    assert user.organization_id == org_a.id
    assert list(user.service_organizations.values_list("provider_id", flat=True)) == [account_a.provider_id]
    supplier_token = supplier.json()["access"]
    assert client.get("/api/v1/accounts/", HTTP_AUTHORIZATION=f"Bearer {supplier_token}").json()["count"] == 1

    zhes = client.post("/api/v1/auth/stub-role/", {"role": "test_zhes"}, format="json")
    assert zhes.status_code == 200
    zhes_user = User.objects.get(username="stub-test-zhes")
    assert zhes_user.display_name == "Тест ЖЭС"
    assert zhes_user.contour == User.Contour.SUPPLIER
    assert zhes_user.organization_id == org_a.id
    assert list(zhes_user.service_organizations.values_list("short_name", flat=True)) == ["Поставщик"]
    zhes_me = client.get("/api/v1/auth/me/", HTTP_AUTHORIZATION=f"Bearer {zhes.json()['access']}")
    assert zhes_me.json()["supplier_name"] == "Поставщик"
    assert zhes_me.json()["show_schema"] is False
    assert zhes_me.json()["show_supplier"] is False
    assert zhes_me.json()["show_service_org"] is False
    assert client.get("/api/v1/accounts/", HTTP_AUTHORIZATION=f"Bearer {zhes.json()['access']}").json()["count"] == 1

    unknown = client.post("/api/v1/auth/stub-role/", {"role": "auditor"}, format="json")
    assert unknown.status_code == 400


def test_identity_columns_follow_what_each_role_can_see(api, org_a, specialist_a, admin_a, observer_a, superadmin):
    from apps.debts.models import AccountService
    from tests.conftest import make_account, make_user

    house = ServiceOrganization.objects.create(
        organization=org_a, provider_id=11, short_name="ЖЭС-1", is_supplier=True,
    )
    water = ServiceOrganization.objects.create(
        organization=org_a, provider_id=12, short_name="Вода", is_supplier=True,
    )
    second_house = ServiceOrganization.objects.create(organization=org_a, provider_id=13, short_name="ЖЭС-2")
    first = make_account(org_a, 7101, provider_id=11)
    second = make_account(org_a, 7102, provider_id=13)
    AccountService.objects.create(
        organization=org_a, account=first, service_list_id=71, service_id=1, provider_id=12, shot_name="Вода",
    )
    AccountService.objects.create(
        organization=org_a, account=second, service_list_id=72, service_id=2, provider_id=11, shot_name="ЖЭС-1",
    )

    for user in (specialist_a, admin_a, observer_a):
        me = api(user).get("/api/v1/auth/me/").json()
        assert me["show_schema"] is False
        assert me["show_supplier"] is True
        assert me["show_service_org"] is True

    root = api(superadmin).get("/api/v1/auth/me/").json()
    assert root["show_schema"] is True
    assert root["show_supplier"] is True
    assert root["show_service_org"] is True

    only_water = make_user("only_water", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    only_water.service_organizations.set([water])
    single = api(only_water).get("/api/v1/auth/me/").json()
    assert single["show_supplier"] is False
    assert single["show_service_org"] is False

    both = make_user("two_suppliers", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    both.service_organizations.set([water, house])
    multi = api(both).get("/api/v1/auth/me/").json()
    assert multi["show_supplier"] is True
    assert multi["show_service_org"] is True

    one_house = make_user("one_house", User.Role.SPECIALIST, org_a)
    one_house.service_organizations.set([second_house])
    narrow = api(one_house).get("/api/v1/auth/me/").json()
    assert narrow["show_schema"] is False
    assert narrow["show_service_org"] is False
    assert narrow["show_supplier"] is False
