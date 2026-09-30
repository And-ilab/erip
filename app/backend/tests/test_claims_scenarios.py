"""Показательный контур ТЗ 4.2.4 и 4.2.5: дело взыскания и конструктор сценария."""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.debts.models import AccountScenarioRun, Attachment, DebtWorkItem

from .conftest import make_account


def _ready(api, user, account):
    opened = api(user).post("/api/v1/claims/", {"account": account.id}, format="json")
    assert opened.status_code == 201, opened.content
    case_id = opened.json()["id"]
    saved = api(user).patch(
        f"/api/v1/claims/{case_id}/",
        {"warning_delivered_on": "2026-03-01", "notary_tariff": "12.50"},
        format="json",
    )
    assert saved.status_code == 200, saved.content
    return case_id


@pytest.mark.django_db
def test_notary_is_blocked_without_tariff_and_refusal_opens_lawsuit(api, specialist_a, account_a):
    opened = api(specialist_a).post("/api/v1/claims/", {"account": account_a.id}, format="json")
    case_id = opened.json()["id"]
    blocked = api(specialist_a).post(f"/api/v1/claims/{case_id}/send-notary/", {}, format="json")
    assert blocked.status_code == 400
    assert "тариф" in blocked.content.decode() or "вручен" in blocked.content.decode()

    _ready(api, specialist_a, account_a)
    sent = api(specialist_a).post(f"/api/v1/claims/{case_id}/send-notary/", {}, format="json")
    assert sent.status_code == 200, sent.content
    body = sent.json()
    assert body["submission_mode"] == "stub"
    assert body["submission_id"].startswith("stub-")
    assert body["stage"] == "notary"

    refused = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/notary-result/",
        {"result": "refused", "note": "Спор о праве"},
        format="json",
    )
    assert refused.status_code == 200, refused.content
    assert refused.json()["stage"] == "lawsuit"


@pytest.mark.django_db
def test_writeoff_needs_three_acts_and_every_approval(api, specialist_a, admin_a, account_a, org_a):
    case_id = _ready(api, specialist_a, account_a)
    for index in range(3):
        added = api(specialist_a).post(
            f"/api/v1/claims/{case_id}/acts/", {"title": f"Акт {index + 1}"}, format="json",
        )
        assert added.status_code == 200, added.content
    early = api(specialist_a).post(f"/api/v1/claims/{case_id}/writeoff/", {"approver_ids": [admin_a.id]}, format="json")
    assert early.status_code == 400

    moved = api(specialist_a).post(f"/api/v1/claims/{case_id}/move/", {"stage": "impossible"}, format="json")
    assert moved.status_code == 200, moved.content

    started = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/writeoff/",
        {"approver_ids": [specialist_a.id, admin_a.id]},
        format="json",
    )
    assert started.status_code == 200, started.content
    assert started.json()["writeoff_status"] == "pending"

    one = api(specialist_a).post(f"/api/v1/claims/{case_id}/decide/", {"decision": "yes"}, format="json")
    assert one.status_code == 200, one.content
    assert one.json()["stage"] == "impossible"

    both = api(admin_a).post(f"/api/v1/claims/{case_id}/decide/", {"decision": "yes"}, format="json")
    assert both.status_code == 200, both.content
    assert both.json()["stage"] == "writeoff"
    assert DebtWorkItem.objects.filter(account=account_a, kind="closure").exists()
    assert "не выгружено" in both.json()["writeoff_note"]


@pytest.mark.django_db
def test_one_refusal_blocks_writeoff(api, specialist_a, admin_a, org_a):
    account = make_account(org_a, 4101)
    case_id = _ready(api, specialist_a, account)
    for index in range(3):
        api(specialist_a).post(f"/api/v1/claims/{case_id}/acts/", {"title": f"Акт {index}"}, format="json")
    api(specialist_a).post(f"/api/v1/claims/{case_id}/move/", {"stage": "impossible"}, format="json")
    api(specialist_a).post(
        f"/api/v1/claims/{case_id}/writeoff/", {"approver_ids": [admin_a.id]}, format="json",
    )
    refused = api(admin_a).post(
        f"/api/v1/claims/{case_id}/decide/", {"decision": "no", "reason": "Нет трёх возвратов по регламенту"}, format="json",
    )
    assert refused.status_code == 200, refused.content
    assert refused.json()["stage"] == "impossible"
    assert refused.json()["writeoff_status"] == "rejected"


@pytest.mark.django_db
def test_other_schema_does_not_see_claim(api, specialist_a, specialist_b, account_a):
    case_id = _ready(api, specialist_a, account_a)
    hidden = api(specialist_b).get(f"/api/v1/claims/{case_id}/")
    assert hidden.status_code == 404


@pytest.mark.django_db
def test_published_scenario_keeps_running_version(api, admin_a, account_a):
    listing = api(admin_a).get("/api/v1/nsi/scenarios/")
    assert listing.status_code == 200, listing.content
    standard = next(row for row in listing.json()["results"] if row["name"] == "Стандартное взыскание")
    copied = api(admin_a).post(f"/api/v1/nsi/scenarios/{standard['id']}/copy/", {}, format="json")
    assert copied.status_code == 201, copied.content
    scenario_id = copied.json()["id"]
    published = api(admin_a).post(f"/api/v1/nsi/scenarios/{scenario_id}/publish/", {}, format="json")
    assert published.status_code == 200, published.content
    assert published.json()["version"] == 1

    assigned = api(admin_a).post(
        f"/api/v1/nsi/scenarios/{scenario_id}/assign/", {"account": account_a.id}, format="json",
    )
    assert assigned.status_code == 200, assigned.content
    assert assigned.json()["version"] == 1

    steps = copied.json()["steps"]
    steps[-1]["terminal"] = False
    steps.append({"order": 6, "action": "manual_call", "wait_days": 0, "terminal": True})
    saved = api(admin_a).patch(f"/api/v1/nsi/scenarios/{scenario_id}/", {"steps": steps}, format="json")
    assert saved.status_code == 200, saved.content
    again = api(admin_a).post(f"/api/v1/nsi/scenarios/{scenario_id}/publish/", {}, format="json")
    assert again.status_code == 200, again.content
    assert again.json()["version"] == 2
    run = AccountScenarioRun.objects.get(account=account_a)
    assert run.version == 1


@pytest.mark.django_db
def test_scenario_rejects_dead_end_and_warns_about_messenger(api, admin_a):
    created = api(admin_a).post(
        "/api/v1/nsi/scenarios/",
        {"name": "Тупик", "steps": [{"order": 1, "action": "call", "terminal": False}]},
        format="json",
    )
    assert created.status_code == 400

    messenger = api(admin_a).post(
        "/api/v1/nsi/scenarios/",
        {"name": "С мессенджером", "steps": [{"order": 1, "action": "messenger", "terminal": True}]},
        format="json",
    )
    assert messenger.status_code == 201, messenger.content
    published = api(admin_a).post(f"/api/v1/nsi/scenarios/{messenger.json()['id']}/publish/", {}, format="json")
    assert published.status_code == 200, published.content
    assert any("мессенджер" in text.lower() for text in published.json()["warnings"])


@pytest.mark.django_db
def test_print_form_keeps_version_on_the_document(api, admin_a, specialist_a, account_a):
    created = api(admin_a).post(
        "/api/v1/nsi/print-forms/",
        {"code": "writ-local", "name": "Надпись", "doc_kind": "writ", "body": "Долг {amount} тарифа {tariff}"},
        format="json",
    )
    assert created.status_code == 201, created.content
    form_id = created.json()["id"]
    first = api(specialist_a).post(f"/api/v1/nsi/print-forms/{form_id}/render/", {"account": account_a.id, "tariff": "12.50"}, format="json")
    assert first.status_code == 200, first.content
    assert "150.00" in first.json()["text"]
    assert first.json()["version"] == 1

    api(admin_a).patch(f"/api/v1/nsi/print-forms/{form_id}/", {"body": "Новая редакция {fio}"}, format="json")
    second = api(specialist_a).post(f"/api/v1/nsi/print-forms/{form_id}/render/", {"account": account_a.id}, format="json")
    assert second.json()["version"] == 2
    notes = list(DebtWorkItem.objects.filter(account=account_a).order_by("id").values_list("note", flat=True))
    assert any("версии 1" in note for note in notes)
    assert any("версии 2" in note for note in notes)


@pytest.mark.django_db
def test_recovered_waits_for_ais_flag(api, specialist_a, account_a):
    case_id = _ready(api, specialist_a, account_a)
    blocked = api(specialist_a).post(f"/api/v1/claims/{case_id}/move/", {"stage": "recovered"}, format="json")
    assert blocked.status_code == 400
    marked = api(specialist_a).post(f"/api/v1/claims/{case_id}/ais-receipt/", {}, format="json")
    assert marked.status_code == 200
    assert marked.json()["balance_out"] == "150.00"
    opened = api(specialist_a).post(f"/api/v1/claims/{case_id}/move/", {"stage": "recovered"}, format="json")
    assert opened.status_code == 200, opened.content
    assert opened.json()["stage"] == "recovered"
    account_a.refresh_from_db()
    assert account_a.balance_out is not None


@pytest.mark.django_db
def test_notary_refusal_needs_a_note_or_a_file(api, specialist_a, account_a):
    case_id = _ready(api, specialist_a, account_a)
    api(specialist_a).post(f"/api/v1/claims/{case_id}/send-notary/", {}, format="json")
    empty = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/notary-result/", {"result": "refused", "note": ""}, format="json",
    )
    assert empty.status_code == 400

    Attachment.objects.create(
        organization=account_a.organization, account=account_a, doc_type="постановление об отказе",
        original_name="otkaz.pdf", file=SimpleUploadedFile("otkaz.pdf", b"%PDF"),
    )
    refused = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/notary-result/", {"result": "refused", "note": ""}, format="json",
    )
    assert refused.status_code == 200, refused.content
    assert refused.json()["stage"] == "lawsuit"
    assert any(item["role"] == "scan" for item in refused.json()["files"])


@pytest.mark.django_db
def test_publish_can_move_running_accounts_and_restore_does_not(api, admin_a, account_a):
    listing = api(admin_a).get("/api/v1/nsi/scenarios/")
    standard = next(row for row in listing.json()["results"] if row["name"] == "Стандартное взыскание")
    copied = api(admin_a).post(f"/api/v1/nsi/scenarios/{standard['id']}/copy/", {}, format="json")
    scenario_id = copied.json()["id"]
    api(admin_a).post(f"/api/v1/nsi/scenarios/{scenario_id}/publish/", {}, format="json")
    api(admin_a).post(f"/api/v1/nsi/scenarios/{scenario_id}/assign/", {"account": account_a.id}, format="json")
    steps = copied.json()["steps"]
    steps[-1]["terminal"] = False
    steps.append({"order": 6, "action": "manual_call", "wait_days": 0, "terminal": True})
    api(admin_a).patch(f"/api/v1/nsi/scenarios/{scenario_id}/", {"steps": steps}, format="json")
    moved = api(admin_a).post(
        f"/api/v1/nsi/scenarios/{scenario_id}/publish/", {"apply_to_running": True}, format="json",
    )
    assert moved.status_code == 200, moved.content
    assert moved.json()["version"] == 2
    assert moved.json()["moved"] == 1
    assert AccountScenarioRun.objects.get(account=account_a).version == 2

    restored = api(admin_a).post(
        f"/api/v1/nsi/scenarios/{scenario_id}/restore/", {"version": 1}, format="json",
    )
    assert restored.status_code == 200, restored.content
    assert restored.json()["version"] == 3
    assert AccountScenarioRun.objects.get(account=account_a).version == 2
    assert restored.json()["steps"][-1]["action"] != "manual_call"


@pytest.mark.django_db
def test_print_form_restore_keeps_printed_documents(api, admin_a, specialist_a, account_a):
    created = api(admin_a).post(
        "/api/v1/nsi/print-forms/",
        {"code": "writ-restore", "name": "Надпись 2", "doc_kind": "writ", "body": "Первая {amount}"},
        format="json",
    )
    form_id = created.json()["id"]
    api(specialist_a).post(f"/api/v1/nsi/print-forms/{form_id}/render/", {"account": account_a.id}, format="json")
    api(admin_a).patch(f"/api/v1/nsi/print-forms/{form_id}/", {"body": "Вторая {fio}"}, format="json")
    restored = api(admin_a).post(f"/api/v1/nsi/print-forms/{form_id}/restore/", {"version": 1}, format="json")
    assert restored.status_code == 200, restored.content
    assert restored.json()["version"] == 3
    assert restored.json()["body"] == "Первая {amount}"
    notes = list(DebtWorkItem.objects.filter(account=account_a).values_list("note", flat=True))
    assert any("версии 1" in note for note in notes)
    assert not any("версии 3" in note for note in notes)
