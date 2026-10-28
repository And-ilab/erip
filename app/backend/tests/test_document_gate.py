"""Перенос карточки без документа открывает вкладку, где этот документ прикладывают."""

import pytest
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.debts.models import ClaimCase, Measure, MeasureItem, StageActivity

from .conftest import make_account


def _find(nodes, code):
    for node in nodes:
        if node.get("code") == code:
            return node
        found = _find(node.get("children") or [], code)
        if found:
            return found
    return None


def _row(board, code):
    found = _find(board.get("current") or [], code)
    if found:
        return found
    for block in board.get("parallel") or []:
        found = _find(block.get("items") or [], code)
        if found:
            return found
    return None


@pytest.mark.django_db
def test_writ_column_stays_put_until_the_file_is_on_the_activities_tab(api, specialist_a, account_a):
    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
    account_a.funnel_stage = "notary"
    account_a.save(update_fields=["funnel_stage"])
    blocked = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"funnel_stage": "writ_done"}, format="json",
    )
    assert blocked.status_code == 400
    error = blocked.json()["error"]
    assert error["code"] == "funnel_gate"
    assert "Исполнительная надпись" in error["message"]
    assert error["details"]["tab"] == "activities"
    assert error["details"]["tab_label"] == "Активности"
    assert error["details"]["focus"] == "writ"
    assert error["details"]["account_id"] == account_a.id
    account_a.refresh_from_db()
    assert account_a.funnel_stage == "notary"
    board = api(specialist_a).get(f"/api/v1/accounts/{account_a.id}/activities/").json()
    row = _row(board, "writ")
    assert row is not None
    uploaded = api(specialist_a).post(
        f"/api/v1/accounts/{account_a.id}/activities/",
        {"id": row["id"], "file": SimpleUploadedFile("writ.pdf", b"%PDF", content_type="application/pdf")},
    )
    assert uploaded.status_code == 200, uploaded.content
    moved = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"funnel_stage": "writ_done"}, format="json",
    )
    assert moved.status_code == 200, moved.content
    account_a.refresh_from_db()
    assert account_a.funnel_stage == "writ_done"


@pytest.mark.django_db
def test_impossible_without_an_act_file_opens_the_opi_tab(api, specialist_a, account_a):
    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
    case = ClaimCase.objects.create(
        organization=account_a.organization, account=account_a, stage=ClaimCase.Stage.OPI_MEASURES,
    )
    blocked = api(specialist_a).post(
        f"/api/v1/claims/{case.id}/move/", {"stage": "impossible"}, format="json",
    )
    assert blocked.status_code == 400
    error = blocked.json()["error"]
    assert error["code"] == "funnel_gate"
    assert error["details"]["tab"] == "opi"
    assert error["details"]["tab_label"] == "ОПИ"
    assert error["details"]["claim_id"] == case.id
    case.refresh_from_db()
    assert case.stage == ClaimCase.Stage.OPI_MEASURES
    filed = api(specialist_a).post(
        f"/api/v1/claims/{case.id}/acts/",
        {
            "title": "Акт о невозможности взыскания",
            "file": SimpleUploadedFile("act.pdf", b"%PDF-1.4", content_type="application/pdf"),
        },
    )
    assert filed.status_code == 200, filed.content
    moved = api(specialist_a).post(
        f"/api/v1/claims/{case.id}/move/", {"stage": "impossible"}, format="json",
    )
    assert moved.status_code == 200, moved.content
    case.refresh_from_db()
    assert case.stage == ClaimCase.Stage.IMPOSSIBLE


@pytest.mark.django_db
def test_collection_card_without_the_package_names_the_claim_tab(api, specialist_a, org_a, account_a):
    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
    case = ClaimCase.objects.create(organization=org_a, account=account_a, stage=ClaimCase.Stage.PREP)
    measure = Measure.objects.create(organization=org_a, kind=Measure.Kind.COLLECTION, status=Measure.Status.ASSIGNED)
    measure.accounts.add(account_a)
    MeasureItem.objects.create(organization=org_a, measure=measure, account=account_a, status=MeasureItem.Status.ASSIGNED)
    blocked = api(specialist_a).post(f"/api/v1/measures/{measure.id}/status/", {"status": "done"}, format="json")
    assert blocked.status_code == 400
    error = blocked.json()["error"]
    assert error["code"] == "funnel_gate"
    assert "Расчёт задолженности" in error["message"]
    assert error["details"]["tab"] == "pack"
    assert error["details"]["claim_id"] == case.id
    assert error["details"]["measure_id"] == measure.id
    measure.refresh_from_db()
    assert measure.status == Measure.Status.ASSIGNED


@pytest.mark.django_db
def test_warning_file_on_the_measure_lets_the_card_move(api, specialist_a, org_a, account_a):
    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
    measure = Measure.objects.create(organization=org_a, kind=Measure.Kind.WARNING, status=Measure.Status.RUNNING)
    measure.artifact.save("warning.pdf", ContentFile(b"%PDF-1.4"), save=True)
    measure.accounts.add(account_a)
    MeasureItem.objects.create(organization=org_a, measure=measure, account=account_a, status=MeasureItem.Status.RUNNING)
    moved = api(specialist_a).post(f"/api/v1/measures/{measure.id}/status/", {"status": "done"}, format="json")
    assert moved.status_code == 200, moved.content
    assert moved.json()["status"] == "done"


@pytest.mark.django_db
def test_call_measure_has_no_document_to_attach(api, specialist_a, org_a):
    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
    account = make_account(org_a, 8811)
    measure = Measure.objects.create(organization=org_a, kind=Measure.Kind.CALL, status=Measure.Status.ASSIGNED)
    measure.accounts.add(account)
    moved = api(specialist_a).post(f"/api/v1/measures/{measure.id}/status/", {"status": "running"}, format="json")
    assert moved.status_code == 200, moved.content


@pytest.mark.django_db
def test_eviction_notice_is_required_before_the_parallel_branch(api, specialist_a, account_a):
    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
    account_a.debt_group = 4
    account_a.save(update_fields=["debt_group"])
    blocked = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"parallel_stage": "p1"}, format="json",
    )
    assert blocked.status_code == 400
    error = blocked.json()["error"]
    assert error["code"] == "funnel_gate"
    assert "выселен" in error["message"].lower()
    assert error["details"]["tab"] == "activities"
    account_a.refresh_from_db()
    assert account_a.parallel_stage in {"", None}
    row = StageActivity.objects.get(account=account_a, code="evict_notice")
    uploaded = api(specialist_a).post(
        f"/api/v1/accounts/{account_a.id}/activities/",
        {"id": row.id, "file": SimpleUploadedFile("evict.pdf", b"%PDF", content_type="application/pdf")},
    )
    assert uploaded.status_code == 200, uploaded.content
    opened = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"parallel_stage": "p1"}, format="json",
    )
    assert opened.status_code == 200, opened.content
    account_a.refresh_from_db()
    assert account_a.parallel_stage == "p1"
