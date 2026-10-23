"""Колонка карточки — старший этап матрицы. Бейдж не переносит карточку."""

from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.debts.models import AccountService, Measure, MeasureItem, StageActivity, StatusHistory
from apps.debts.services.portfolio import PortfolioRefresher

from .conftest import make_account


@pytest.mark.django_db
def test_ribbon_saves_without_a_reason_and_blocks_a_gated_stage(api, specialist_a, account_a):
    denied = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"funnel_stage": "call"}, format="json",
    )
    assert denied.status_code == 403
    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
    moved = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"funnel_stage": "notice"}, format="json",
    )
    assert moved.status_code == 200, moved.content
    account_a.refresh_from_db()
    assert account_a.funnel_stage == "notice"
    history = StatusHistory.objects.filter(account=account_a, kind=StatusHistory.Kind.FUNNEL).get()
    assert history.old_value == "new"
    assert history.new_value == "notice"
    assert history.author_id == specialist_a.id
    blocked = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"funnel_stage": "disconnect"}, format="json",
    )
    assert blocked.status_code == 400
    account_a.refresh_from_db()
    assert account_a.funnel_stage == "notice"
    back = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"funnel_stage": "call"}, format="json",
    )
    assert back.status_code == 200, back.content
    account_a.refresh_from_db()
    assert account_a.funnel_stage == "call"


@pytest.mark.django_db
def test_open_measure_stays_a_badge_outside_its_old_column(api, specialist_a, org_a, account_a):
    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
    account_a.funnel_stage = "prep"
    account_a.save(update_fields=["funnel_stage"])
    call = Measure.objects.create(organization=org_a, kind=Measure.Kind.CALL, status=Measure.Status.RUNNING)
    call.accounts.add(account_a)
    MeasureItem.objects.create(
        organization=org_a, measure=call, account=account_a, status=MeasureItem.Status.RUNNING,
    )
    columns = api(specialist_a).get("/api/v1/accounts/kanban/").json()
    by_stage = {column["stage"]: column for column in columns}
    assert by_stage["prep"]["total"] == 1
    assert by_stage["call"]["total"] == 0
    card = by_stage["prep"]["cards"][0]
    assert card["open_badges"][0]["label"].startswith("Автообзвон")
    assert card["open_badges"][0]["measure_id"] == call.id


@pytest.mark.django_db
def test_activities_open_on_the_current_stage_and_a_step_can_be_done(api, specialist_a, account_a):
    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
    api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"funnel_stage": "notice"}, format="json",
    )
    board = api(specialist_a).get(f"/api/v1/accounts/{account_a.id}/activities/").json()
    assert board["stage"] == "notice"
    titles = [row["title"] for row in board["current"]]
    assert "Сообщение на e-mail" in titles
    assert board["parallel"] == []
    field = next(
        child for row in board["current"] for child in row["children"] if child["kind"] == "field"
    )
    done = api(specialist_a).post(
        f"/api/v1/accounts/{account_a.id}/activities/",
        {"id": field["id"], "note": "Текст предупреждения"},
        format="json",
    )
    assert done.status_code == 200, done.content
    saved = StageActivity.objects.get(pk=field["id"])
    assert saved.status == "done"
    assert saved.note == "Текст предупреждения"
    upload_row = next(row for row in board["current"] if row["kind"] == "upload")
    uploaded = api(specialist_a).post(
        f"/api/v1/accounts/{account_a.id}/activities/",
        {"id": upload_row["id"], "file": SimpleUploadedFile("warn.pdf", b"%PDF", content_type="application/pdf")},
    )
    assert uploaded.status_code == 200, uploaded.content
    assert StageActivity.objects.get(pk=upload_row["id"]).status == "done"


@pytest.mark.django_db
def test_parallel_branch_does_not_move_the_main_stage(api, specialist_a, account_a):
    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
    account_a.debt_group = 4
    account_a.funnel_stage = "prep"
    account_a.save(update_fields=["debt_group", "funnel_stage"])
    early = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"parallel_stage": "p1"}, format="json",
    )
    assert early.status_code == 200, early.content
    account_a.refresh_from_db()
    assert account_a.funnel_stage == "prep"
    assert account_a.parallel_stage == "p1"
    account_a.debt_group = 2
    account_a.save(update_fields=["debt_group"])
    denied = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"parallel_stage": "p2"}, format="json",
    )
    assert denied.status_code == 400


@pytest.mark.django_db
def test_payment_to_zero_lands_on_recovered(org_a):
    account = make_account(org_a, 8801, funnel_stage="call")
    AccountService.objects.create(
        organization=org_a, account=account, service_list_id=1, service_id=10,
        balance_out=Decimal("0"), balance_mulct_out=Decimal("0"), debt_period=0,
    )
    PortfolioRefresher().refresh_account(account)
    account.refresh_from_db()
    assert account.funnel_stage == "recovered"
    fresh = make_account(org_a, 8802, funnel_stage="new")
    AccountService.objects.create(
        organization=org_a, account=fresh, service_list_id=1, service_id=11,
        balance_out=Decimal("0"), balance_mulct_out=Decimal("0"),
    )
    PortfolioRefresher().refresh_account(fresh)
    fresh.refresh_from_db()
    assert fresh.funnel_stage == "new"
