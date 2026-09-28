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
        "superadmin", "local_admin", "specialist", "observer", "supplier",
    }

    entered = client.post("/api/v1/auth/stub-role/", {"role": "specialist"}, format="json")
    assert entered.status_code == 200
    assert "refresh" not in entered.json()
    assert "erip_refresh" in entered.cookies
    me = client.get("/api/v1/auth/me/", HTTP_AUTHORIZATION=f"Bearer {entered.json()['access']}")
    assert me.status_code == 200
    assert me.json()["role"] == "specialist"
    assert me.json()["organization"] == org_a.id
    assert client.get("/api/v1/accounts/", HTTP_AUTHORIZATION=f"Bearer {entered.json()['access']}").json()["count"] == 1

    supplier = client.post("/api/v1/auth/stub-role/", {"role": "supplier"}, format="json")
    user = User.objects.get(username="stub-supplier")
    assert user.contour == User.Contour.SUPPLIER
    assert user.organization_id == org_a.id
    assert list(user.service_organizations.values_list("provider_id", flat=True)) == [account_a.provider_id]
    supplier_token = supplier.json()["access"]
    assert client.get("/api/v1/accounts/", HTTP_AUTHORIZATION=f"Bearer {supplier_token}").json()["count"] == 1

    unknown = client.post("/api/v1/auth/stub-role/", {"role": "auditor"}, format="json")
    assert unknown.status_code == 400
