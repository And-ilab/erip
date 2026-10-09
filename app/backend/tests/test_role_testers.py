"""Тестовые логины входят паролем и выбирают роль. Обычный пользователь этот шаг не видит."""

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.users.models import User
from apps.users.role_testers import PASSWORD, TESTER_USERNAMES, issue_ticket

pytestmark = pytest.mark.django_db


def test_seed_creates_both_logins_and_resets_the_password():
    call_command("seed_role_testers")
    call_command("seed_role_testers")
    assert User.objects.filter(username__in=TESTER_USERNAMES).count() == 2
    user = User.objects.get(username=TESTER_USERNAMES[0])
    user.set_password("Other-Password-1")
    user.save(update_fields=["password"])
    call_command("seed_role_testers")
    user.refresh_from_db()
    assert user.check_password(PASSWORD)
    assert user.email == user.username
    assert user.is_superuser is False


def test_tester_picks_a_role_after_the_password(org_a, account_a):
    call_command("seed_role_testers")
    client = APIClient()
    wrong = client.post(
        "/api/v1/auth/token/",
        {"username": TESTER_USERNAMES[0], "password": "nope"},
        format="json",
    )
    assert wrong.status_code == 401
    assert "erip_refresh" not in wrong.cookies

    gate = client.post(
        "/api/v1/auth/token/",
        {"username": "A.Poleshchuk@raschet.by", "password": PASSWORD},
        format="json",
    )
    assert gate.status_code == 200
    body = gate.json()
    assert body["choose_role"] is True
    assert "access" not in body
    assert "erip_refresh" not in gate.cookies
    assert {row["id"] for row in body["roles"]} == {
        "superadmin", "local_admin", "specialist", "observer", "supplier", "test_zhes",
    }

    chosen = client.post("/api/v1/auth/role-choice/", {"ticket": body["ticket"], "role": "observer"}, format="json")
    assert chosen.status_code == 200
    assert "refresh" not in chosen.json()
    assert "erip_refresh" in chosen.cookies
    me = client.get("/api/v1/auth/me/", HTTP_AUTHORIZATION=f"Bearer {chosen.json()['access']}")
    assert me.json()["username"] == TESTER_USERNAMES[0]
    assert me.json()["role"] == "observer"
    assert me.json()["display_name"] == "Наблюдатель"
    assert me.json()["organization"] == org_a.id
    assert client.get("/api/v1/accounts/", HTTP_AUTHORIZATION=f"Bearer {chosen.json()['access']}").status_code == 200

    again = client.post("/api/v1/auth/role-choice/", {"ticket": body["ticket"], "role": "supplier"}, format="json")
    user = User.objects.get(username=TESTER_USERNAMES[0])
    assert again.status_code == 200
    assert user.contour == User.Contour.SUPPLIER
    assert user.organization_id == org_a.id


def test_role_choice_rejects_a_stranger_and_a_bad_ticket(specialist_a):
    client = APIClient()
    stranger = client.post(
        "/api/v1/auth/role-choice/",
        {"ticket": issue_ticket(specialist_a), "role": "superadmin"},
        format="json",
    )
    assert stranger.status_code == 400
    specialist_a.refresh_from_db()
    assert specialist_a.role == User.Role.SPECIALIST

    broken = client.post("/api/v1/auth/role-choice/", {"ticket": "not-a-ticket", "role": "observer"}, format="json")
    assert broken.status_code == 400
    unknown = client.post(
        "/api/v1/auth/token/",
        {"username": TESTER_USERNAMES[1], "password": PASSWORD},
        format="json",
    )
    assert unknown.status_code == 401


def test_ordinary_login_does_not_ask_for_a_role(specialist_a):
    client = APIClient()
    entered = client.post(
        "/api/v1/auth/token/",
        {"username": "spec_a", "password": "Passw0rd!x"},
        format="json",
    )
    assert entered.status_code == 200
    assert entered.json()["access"]
    assert "choose_role" not in entered.json()
