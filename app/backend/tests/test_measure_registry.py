"""Реестр мероприятий: состав строки, поиск, период и матрица по видам."""

from datetime import date, time

import pytest

from apps.audit.models import AuditLog
from apps.debts.models import Measure
from tests.conftest import make_account


def _call(api, user, account, **extra):
    body = {
        "kind": "call",
        "account_ids": [account.id],
        "template_name": "Напоминание",
        "time_from": "18:00",
        "time_to": "20:00",
        "started_on": "2026-07-10",
        "due_on": "2026-07-20",
    }
    body.update(extra)
    return api(user).post("/api/v1/measures/", body, format="json")


@pytest.fixture
def party(api, specialist_a, org_a, account_a):
    second = make_account(org_a, 1002, client_account="00001002")
    second.short_fio = "Петров П.П."
    second.save(update_fields=["short_fio"])
    created = _call(
        api, specialist_a, account_a,
        account_ids=[account_a.id, second.id], assignee=specialist_a.id,
    )
    assert created.status_code == 201
    failed = _call(api, specialist_a, account_a, started_on="2026-08-01", due_on="2026-08-02")
    Measure.objects.filter(pk=failed.json()["id"]).update(status=Measure.Status.FAILED, note="Неверный номер")
    return created.json()["id"]


def test_registry_groups_show_debtor_assignee_and_only_visible_accounts(api, specialist_a, specialist_b, party):
    listed = api(specialist_a).get("/api/v1/measures/registry/")
    assert listed.status_code == 200
    groups = {item["status"]: item for item in listed.json()["groups"]}
    assigned = groups["assigned"]["results"][0]
    assert assigned["title"] == "Автообзвон — Напоминание"
    assert assigned["debtor_name"] == "Иванов И.И."
    assert assigned["debtor_account"] == "00001001"
    assert assigned["accounts_count"] == 2
    assert assigned["assignee_name"] == "Анна Петровна"
    assert assigned["next_action"] == "20.07.2026"
    assert groups["failed"]["results"][0]["next_action"] == "Неверный номер"
    hidden = api(specialist_b).get("/api/v1/measures/registry/")
    assert hidden.json()["total"] == 0
    assert AuditLog.objects.filter(action=AuditLog.Action.VIEW, object_type="debts.Measure").exists()


def test_search_and_period_narrow_the_same_registry(api, specialist_a, party):
    by_name = api(specialist_a).get("/api/v1/measures/registry/", {"search": "Петров"})
    assert by_name.json()["total"] == 1
    assert by_name.json()["groups"][0]["results"][0]["debtor_name"] == "Петров П.П."
    grid = api(specialist_a).get("/api/v1/measures/matrix/", {"search": "00001002"})
    assert [row["client_account"] for row in grid.json()["results"]] == ["00001002"]
    by_kind = api(specialist_a).get("/api/v1/measures/registry/", {"search": "автообзвон"})
    assert by_kind.json()["total"] == 2
    july = api(specialist_a).get("/api/v1/measures/registry/", {"period": "2026-07"})
    assert july.json()["total"] == 1
    assert july.json()["groups"][0]["status"] == "assigned"
    august = api(specialist_a).get("/api/v1/measures/registry/", {"period": "2026-08"})
    assert august.json()["groups"][0]["status"] == "failed"
    earlier = api(specialist_a).get("/api/v1/measures/registry/", {"period": "2026-06"})
    assert earlier.json()["total"] == 0
    bad = api(specialist_a).get("/api/v1/measures/registry/", {"period": "июль"})
    assert bad.status_code == 400


def test_matrix_puts_the_latest_measure_of_each_kind_on_the_account(api, specialist_a, account_a, party):
    warning = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "warning", "account_ids": [account_a.id], "template_name": "Предупреждение", "started_on": "2026-07-11"},
        format="json",
    )
    assert warning.status_code == 201
    Measure.objects.filter(pk=warning.json()["id"]).update(status=Measure.Status.DONE, due_on=date(2026, 7, 15))
    grid = api(specialist_a).get("/api/v1/measures/matrix/", {"period": "2026-07"})
    assert grid.status_code == 200
    kinds = [item["code"] for item in grid.json()["kinds"]]
    assert kinds == ["call", "notice", "warning", "disconnect", "collection"]
    rows = {row["client_account"]: row for row in grid.json()["results"]}
    assert rows["00001001"]["cells"]["call"]["tone"] == "pending"
    assert rows["00001001"]["cells"]["warning"]["label"] == "15.07"
    assert rows["00001001"]["cells"]["warning"]["tone"] == "done"
    assert rows["00001001"]["cells"]["notice"] is None
    assert "00001002" in rows
    assert grid.json()["truncated"] is False


def test_open_measure_stays_visible_until_its_due_month(api, specialist_a, account_a):
    created = _call(api, specialist_a, account_a, started_on="2026-06-20", due_on="2026-07-05")
    assert created.status_code == 201
    assert api(specialist_a).get("/api/v1/measures/registry/", {"period": "2026-07"}).json()["total"] == 1
    assert api(specialist_a).get("/api/v1/measures/registry/", {"period": "2026-08"}).json()["total"] == 0
    running = _call(api, specialist_a, account_a, started_on="2026-07-01")
    Measure.objects.filter(pk=running.json()["id"]).update(status=Measure.Status.RUNNING, due_on=None, time_from=time(18, 0))
    listed = api(specialist_a).get("/api/v1/measures/registry/", {"period": "2026-09"})
    assert listed.json()["groups"][0]["results"][0]["next_action"] == "Дозвон…"
