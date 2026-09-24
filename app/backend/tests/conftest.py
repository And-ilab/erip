from decimal import Decimal

import pytest
from django.conf import settings
from rest_framework.test import APIClient

from apps.debts.models import Account, AccountService, Registration
from apps.notifications.services.gateway_client import FakeGatewayClient, set_gateway_client
from apps.users.models import Organization, ServiceOrganization, User


@pytest.fixture
def org_a(db):
    return Organization.objects.create(schema_name="schema_a", name="Организация A")


@pytest.fixture
def org_b(db):
    return Organization.objects.create(schema_name="schema_b", name="Организация B")


def make_user(username, role, organization=None, **extra):
    user = User.objects.create_user(username=username, password="Passw0rd!x", role=role,
                                    organization=organization, **extra)
    return user


@pytest.fixture
def superadmin(db):
    return User.objects.create_superuser("root", "root@example.com", "Passw0rd!x")


@pytest.fixture
def specialist_a(org_a):
    return make_user("spec_a", User.Role.SPECIALIST, org_a, first_name="Анна", middle_name="Петровна",
                     email="a@example.com")


@pytest.fixture
def admin_a(org_a):
    return make_user("admin_a", User.Role.LOCAL_ADMIN, org_a)


@pytest.fixture
def specialist_b(org_b):
    return make_user("spec_b", User.Role.SPECIALIST, org_b)


@pytest.fixture
def observer_a(org_a):
    return make_user("obs_a", User.Role.OBSERVER, org_a)


def client_for(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def api():
    return client_for


def make_account(org, account_id, provider_id=501, client_account=None, **extra) -> Account:
    ServiceOrganization.objects.get_or_create(organization=org, provider_id=provider_id,
                                              defaults={"short_name": f"ЖЭС {provider_id}"})
    return Account.objects.create(
        organization=org, account_id=account_id, provider_id=provider_id,
        client_account=client_account or f"{account_id:08d}", short_fio="Иванов И.И.",
        balance_out=Decimal("150.00"), contact_phone="+375291112233", **extra,
    )


@pytest.fixture
def account_a(org_a):
    account = make_account(org_a, 1001, client_account="00001001")
    AccountService.objects.create(organization=org_a, account=account, service_list_id=1, service_id=10,
                                  service_name="Газ", balance_out=Decimal("100"), debt_period=7)
    Registration.objects.create(organization=org_a, account=account, registration_id=1, subj_id=1,
                                fam="Иванов", im="Иван", ot="Иванович", subj_is_main=True, email="ivan@example.com")
    return account


@pytest.fixture
def account_b(org_b):
    return make_account(org_b, 2001)


@pytest.fixture
def fake_gateway():
    client = FakeGatewayClient()
    set_gateway_client(client)
    yield client
    set_gateway_client(None)


@pytest.fixture
def internal_headers():
    return {"HTTP_X_INTERNAL_TOKEN": settings.INTERNAL_TOKEN}
