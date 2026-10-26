"""Критерий приёмки 2: пользователь организации A не видит ЛС организации B."""

import pytest

from apps.users.models import ServiceOrganization

from .conftest import make_account, make_user

pytestmark = pytest.mark.django_db


def test_list_contains_only_own_organization(api, specialist_a, account_a, account_b):
    response = api(specialist_a).get("/api/v1/accounts/")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()["results"]}
    assert ids == {account_a.id}


def test_foreign_account_by_id_is_404(api, specialist_a, account_b):
    for url in (
        f"/api/v1/accounts/{account_b.id}/",
        f"/api/v1/accounts/{account_b.id}/services/",
        f"/api/v1/accounts/{account_b.id}/payments/",
    ):
        assert api(specialist_a).get(url).status_code == 404


def test_superadmin_sees_all(api, superadmin, account_a, account_b):
    response = api(superadmin).get("/api/v1/accounts/")
    assert response.json()["count"] == 2


def test_service_organization_contour(api, specialist_a, org_a, account_a):
    other = make_account(org_a, 1002, provider_id=777)
    # Пустой контур — вся схема
    assert api(specialist_a).get("/api/v1/accounts/").json()["count"] == 2
    specialist_a.service_organizations.set([ServiceOrganization.objects.get(organization=org_a, provider_id=777)])
    ids = {r["id"] for r in api(specialist_a).get("/api/v1/accounts/").json()["results"]}
    assert ids == {other.id}


def test_child_endpoints_scoped(api, specialist_b, account_a):
    assert api(specialist_b).get("/api/v1/services/").json()["count"] == 0
    assert api(specialist_b).get("/api/v1/registrations/").json()["count"] == 0


def test_user_without_organization_sees_nothing(api, db, account_a):
    from .conftest import make_user

    orphan = make_user("orphan", "specialist")
    assert api(orphan).get("/api/v1/accounts/").json()["count"] == 0


def test_observer_cannot_write(api, observer_a, account_a):
    response = api(observer_a).patch(f"/api/v1/accounts/{account_a.id}/", {"debt_group_manual": 3,
                                                                          "debt_group_manual_reason": "x"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


def test_local_admin_cannot_create_superadmin(api, admin_a):
    response = api(admin_a).post("/api/v1/users/", {"username": "evil", "role": "superadmin",
                                                    "password": "Passw0rd!x"}, format="json")
    assert response.status_code == 400


def test_local_admin_cannot_edit_peer_or_assign_same_role(api, admin_a, org_a):
    peer = make_user("peer_admin", "local_admin", org_a)
    assert api(admin_a).patch(f"/api/v1/users/{peer.id}/", {"first_name": "X"}, format="json").status_code == 404
    response = api(admin_a).post("/api/v1/users/", {"username": "boss", "role": "local_admin", "password": "Passw0rd!x"},
                                 format="json")
    assert response.status_code == 400


def test_notification_stays_inside_provider_contour(api, specialist_a, admin_a, org_a, account_a, fake_gateway):
    other = make_account(org_a, 1002, provider_id=777)
    specialist_a.service_organizations.set([ServiceOrganization.objects.get(organization=org_a, provider_id=777)])
    created = api(admin_a).post("/api/v1/notifications/", {"channel": "email", "account": account_a.id, "body": "чужой"},
                                format="json")
    assert created.status_code == 201, created.json()
    visible = {row["id"] for row in api(specialist_a).get("/api/v1/notifications/").json()["results"]}
    assert created.json()["id"] not in visible
    denied = api(specialist_a).post("/api/v1/notifications/", {"channel": "email", "account": account_a.id, "body": "x"},
                                    format="json")
    assert denied.status_code == 400
    own = api(specialist_a).post("/api/v1/notifications/", {"channel": "email", "account": other.id, "body": "свой"},
                                 format="json")
    assert own.status_code == 201, own.json()


def test_local_admin_edits_name_role_contacts_and_keeps_password(api, admin_a, specialist_a, org_a):
    supplier = ServiceOrganization.objects.create(
        organization=org_a, provider_id=42, short_name="ЖЭС 42", is_supplier=True,
    )
    response = api(admin_a).patch(
        f"/api/v1/users/{specialist_a.id}/",
        {
            "last_name": "Иванова",
            "first_name": "Мария",
            "middle_name": "Сергеевна",
            "username": "spec_a_new",
            "email": "maria@example.com",
            "phone": "+375291112233",
            "position": "Юрист",
            "role": "specialist",
            "can_approve": True,
            "contour": "supplier",
            "service_organizations": [supplier.id],
            "password": "N3w-pass-word",
        },
        format="json",
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["registry_name"] == "Иванова Мария Сергеевна"
    assert body["username"] == "spec_a_new"
    assert body["email"] == "maria@example.com"
    assert body["phone"] == "+375291112233"
    assert body["position"] == "Юрист"
    assert body["can_approve"] is True
    assert body["contour"] == "supplier"
    assert body["service_organizations"] == [supplier.id]
    specialist_a.refresh_from_db()
    assert specialist_a.check_password("N3w-pass-word")

    kept = api(admin_a).patch(
        f"/api/v1/users/{specialist_a.id}/",
        {
            "role": "observer",
            "can_approve": False,
            "contour": "billing",
            "service_organizations": [],
        },
        format="json",
    )
    assert kept.status_code == 200, kept.json()
    assert kept.json()["role"] == "observer"
    assert kept.json()["can_approve"] is False
    assert kept.json()["contour"] == "billing"
    assert kept.json()["service_organizations"] == []
    assert kept.json()["registry_name"] == "Иванова Мария Сергеевна"
    specialist_a.refresh_from_db()
    assert specialist_a.check_password("N3w-pass-word")


def test_local_admin_creates_user_in_own_schema(api, admin_a, org_a, org_b):
    response = api(admin_a).post("/api/v1/users/", {"username": "new", "role": "specialist",
                                                    "organization": org_b.id, "password": "Passw0rd!x"},
                                 format="json")
    assert response.status_code == 201
    assert response.json()["organization"] == org_a.id


def test_directory_counts_and_block_reassigns_open_work(api, admin_a, specialist_a, org_a, account_a):
    from apps.debts.models import Measure, MeasureTask

    account_a.assigned_to = specialist_a
    account_a.save(update_fields=["assigned_to"])
    open_measure = Measure.objects.create(
        organization=org_a, kind=Measure.Kind.CALL, assignee=specialist_a, status=Measure.Status.ASSIGNED,
    )
    done = Measure.objects.create(
        organization=org_a, kind=Measure.Kind.CALL, assignee=specialist_a, status=Measure.Status.DONE,
    )
    task = MeasureTask.objects.create(
        organization=org_a, measure=open_measure, assignee=specialist_a, title="Позвонить",
    )
    listed = api(admin_a).get("/api/v1/organizations/")
    assert listed.status_code == 200
    row = listed.json()["results"][0]
    assert row["id"] == org_a.id
    assert row["user_count"] == 2
    assert row["account_count"] == 1
    assert row["local_admin_name"] == "admin_a"
    blocked = api(admin_a).patch(f"/api/v1/users/{specialist_a.id}/", {"is_active": False}, format="json")
    assert blocked.status_code == 200, blocked.json()
    assert blocked.json()["registry_name"] == "Анна Петровна"
    account_a.refresh_from_db()
    open_measure.refresh_from_db()
    done.refresh_from_db()
    task.refresh_from_db()
    assert account_a.assigned_to_id == admin_a.id
    assert open_measure.assignee_id == admin_a.id
    assert task.assignee_id == admin_a.id
    assert done.assignee_id == specialist_a.id


def test_unauthenticated_is_rejected(client, account_a):
    response = client.get("/api/v1/accounts/")
    assert response.status_code == 401
    assert "request_id" in response.json()["error"]
