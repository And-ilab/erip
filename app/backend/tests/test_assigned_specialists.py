"""Закреплённые специалисты: выборка для фильтра и группировка по полному имени."""

from django.core.management import call_command

from apps.users.models import User

from .conftest import make_account


def test_seed_pins_free_accounts_and_keeps_a_manual_specialist(api, specialist_a, specialist_b, org_a):
    free = [make_account(org_a, 8100 + index) for index in range(4)]
    manual = make_account(org_a, 8199, assigned_to=specialist_a)

    call_command("seed_assigned_specialists")

    manual.refresh_from_db()
    assert manual.assigned_to_id == specialist_a.id
    names = set()
    for account in free:
        account.refresh_from_db()
        assert account.assigned_to_id != specialist_a.id
        names.add(account.assigned_to.registry_name)
    assert names == {
        "Ковалёва Ольга Сергеевна",
        "Левчук Андрей Михайлович",
        "Гриневич Татьяна Ивановна",
        "Савич Пётр Николаевич",
    }
    assert User.objects.filter(username__startswith="spec_schema_a_").count() == 4

    call_command("seed_assigned_specialists")
    assert User.objects.filter(username__startswith="spec_schema_a_").count() == 4

    listed = api(specialist_a).get("/api/v1/accounts/specialists/").json()
    assert {row["name"] for row in listed} >= names
    assert api(specialist_b).get("/api/v1/accounts/specialists/").json() == []

    pinned = free[0]
    pinned.refresh_from_db()
    filtered = api(specialist_a).get("/api/v1/accounts/", {"assigned_name": pinned.assigned_to.registry_name}).json()
    assert filtered["count"] == 1
    assert filtered["results"][0]["assigned_name"] == pinned.assigned_to.registry_name

    grouped = api(specialist_a).get("/api/v1/accounts/grouped/", {"group_by": "specialist"}).json()
    assert pinned.assigned_to.registry_name in {row["value"] for row in grouped}


def test_same_name_on_two_schemas_is_one_filter_row(api, superadmin, org_a, org_b):
    make_account(org_a, 8201)
    make_account(org_b, 8202)
    call_command("seed_assigned_specialists")

    listed = api(superadmin).get("/api/v1/accounts/specialists/").json()
    names = [row["name"] for row in listed]
    assert names.count("Ковалёва Ольга Сергеевна") == 1
    filtered = api(superadmin).get("/api/v1/accounts/", {"assigned_name": "Ковалёва Ольга Сергеевна"}).json()
    assert filtered["count"] == 2
