"""Колонки карточки зависят от роли. Вход без пароля закрыт."""

import pytest
from rest_framework.test import APIClient

from apps.users.models import ServiceOrganization, User

pytestmark = pytest.mark.django_db


def test_passwordless_role_route_is_closed():
    client = APIClient()
    assert client.get("/api/v1/auth/stub-role/").status_code == 404
    assert client.post("/api/v1/auth/stub-role/", {"role": "specialist"}, format="json").status_code == 404


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
