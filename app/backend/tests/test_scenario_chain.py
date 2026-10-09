"""Цепочка сценария, сроки схемы, задания и пропуск этапа."""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.debts.models import Measure
from apps.nsi.services.scenario_engine import advance_account, ensure_imported_run

from .conftest import make_account


def _owing(org, number, group):
    from decimal import Decimal

    from apps.debts.models import AccountService

    account = make_account(org, number, client_account=f"{number:08d}", contact_phone="1111111")
    account.debt_group = group
    account.save(update_fields=["debt_group"])
    AccountService.objects.create(
        organization=org, account=account, service_list_id=1, service_id=number,
        service_name="Отопление", balance_out=Decimal("80"), debt_period=group, debt_group=group,
    )
    return account


@pytest.mark.django_db
def test_chain_starts_with_a_call_for_any_group(org_a):
    young = _owing(org_a, 9101, 1)
    senior = _owing(org_a, 9102, 5)
    ensure_imported_run(young)
    ensure_imported_run(senior)
    for account in (young, senior):
        row = Measure.objects.get(accounts=account)
        assert row.kind == Measure.Kind.CALL
        assert row.template_name == "Автообзвон"


@pytest.mark.django_db
def test_org_wait_holds_the_next_step(org_a):
    account = _owing(org_a, 9103, 1)
    ensure_imported_run(account)
    call = Measure.objects.get(accounts=account)
    call.status = Measure.Status.DONE
    call.save(update_fields=["status", "updated_at"])
    call.items.update(status="done")
    org_a.step_waits = {"email": 10}
    org_a.save(update_fields=["step_waits"])
    advance_account(account)
    assert not Measure.objects.filter(accounts=account, kind=Measure.Kind.NOTICE).exists()


@pytest.mark.django_db
def test_org_warning_wait_overrides_the_central_clock(api, admin_a, account_a, org_a):
    org_a.warning_wait_days = 2
    org_a.save(update_fields=["warning_wait_days"])
    today = timezone.localdate()
    created = api(admin_a).post(
        "/api/v1/measures/",
        {"kind": "warning", "account_ids": [account_a.id], "template_name": "Предупреждение"},
        format="json",
    )
    assert created.status_code == 201, created.content
    delivered = api(admin_a).post(
        f"/api/v1/measures/{created.json()['id']}/deliver/",
        {"delivery_method": "personal", "delivered_on": today.isoformat(), "recipient_name": "Иванов Иван"},
        format="json",
    )
    assert delivered.status_code == 200, delivered.content
    account_a.refresh_from_db()
    assert account_a.warning_due == today + timedelta(days=2)


@pytest.mark.django_db
def test_only_admin_launches_a_measure_outside_the_scenario(api, admin_a, specialist_a, account_a):
    account_a.debt_group = 1
    account_a.save(update_fields=["debt_group"])
    denied = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "call", "account_ids": [account_a.id], "template_name": "Напоминание", "time_from": "09:00", "time_to": "18:00"},
        format="json",
    )
    assert denied.status_code == 403
    created = api(admin_a).post(
        "/api/v1/measures/",
        {"kind": "call", "account_ids": [account_a.id], "template_name": "Напоминание", "time_from": "09:00", "time_to": "18:00"},
        format="json",
    )
    assert created.status_code == 201, created.content


@pytest.mark.django_db
def test_specialist_adds_a_task_and_a_checklist(api, admin_a, specialist_a, account_a):
    account_a.debt_group = 1
    account_a.save(update_fields=["debt_group"])
    created = api(admin_a).post(
        "/api/v1/measures/",
        {"kind": "call", "account_ids": [account_a.id], "template_name": "Напоминание", "time_from": "09:00", "time_to": "18:00"},
        format="json",
    )
    measure_id = created.json()["id"]
    added = api(specialist_a).post(
        f"/api/v1/measures/{measure_id}/tasks/",
        {"title": "Позвонить повторно", "due_on": "2026-10-20"},
        format="json",
    )
    assert added.status_code == 201, added.content
    task = added.json()["tasks"][0]
    assert task["title"] == "Позвонить повторно"
    checked = api(specialist_a).post(
        f"/api/v1/measures/{measure_id}/task-checks/",
        {"task_id": task["id"], "title": "Сверить номер"},
        format="json",
    )
    assert checked.status_code == 200, checked.content
    point = checked.json()["tasks"][0]["checks"][0]
    assert point["title"] == "Сверить номер"
    assert point["done"] is False
    marked = api(specialist_a).post(
        f"/api/v1/measures/{measure_id}/task-checks/",
        {"check_id": point["id"], "done": True},
        format="json",
    )
    assert marked.json()["tasks"][0]["checks"][0]["done"] is True


@pytest.mark.django_db
def test_funnel_skip_needs_an_approver(api, specialist_a, account_a):
    denied = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/",
        {"funnel_stage": "warning", "funnel_reason": "Проверка пропуска"},
        format="json",
    )
    assert denied.status_code == 403
    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
    moved = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/",
        {"funnel_stage": "warning", "funnel_reason": "Проверка пропуска"},
        format="json",
    )
    assert moved.status_code == 200, moved.content
    account_a.refresh_from_db()
    assert account_a.funnel_stage == "warning"


@pytest.mark.django_db
def test_admin_skip_continues_the_chain(api, admin_a, specialist_a, org_a):
    account = _owing(org_a, 9104, 1)
    from apps.debts.models import Registration

    Registration.objects.create(
        organization=org_a, account=account, registration_id=1, subj_id=1,
        fam="Иванов", im="Иван", subj_is_main=True, email="ivan@example.com",
    )
    ensure_imported_run(account)
    denied = api(specialist_a).post(
        f"/api/v1/accounts/{account.id}/skip-step/", {"reason": "Номер не отвечает"}, format="json",
    )
    assert denied.status_code == 403
    skipped = api(admin_a).post(
        f"/api/v1/accounts/{account.id}/skip-step/", {"reason": "Номер не отвечает"}, format="json",
    )
    assert skipped.status_code == 200, skipped.content
    assert 1 in skipped.json()["skipped"]
    assert Measure.objects.filter(accounts=account, kind=Measure.Kind.CALL, status=Measure.Status.CANCELLED).exists()
    assert Measure.objects.filter(accounts=account, kind=Measure.Kind.NOTICE).exists()
