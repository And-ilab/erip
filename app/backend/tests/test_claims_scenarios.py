"""Показательный контур ТЗ 4.2.4 и 4.2.5: дело взыскания и конструктор сценария."""

from datetime import date

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.debts.models import AccountScenarioRun, Attachment, DebtWorkItem, Measure
from apps.nsi.services.scenario_engine import step_template_name
from apps.notifications.models import MessageTemplate

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
    account = make_account(org_a, 4101, debt_group=3)
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
        organization=account_a.organization, account=account_a, doc_type="договор",
        original_name="dogovor.pdf", file=SimpleUploadedFile("dogovor.pdf", b"%PDF"),
    )
    other = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/notary-result/", {"result": "refused", "note": ""}, format="json",
    )
    assert other.status_code == 400

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


@pytest.mark.django_db
def test_scenario_branches_by_group_and_starts_the_step(api, admin_a, org_a, account_a):
    from apps.debts.models import Measure

    account_a.debt_group = 2
    account_a.save(update_fields=["debt_group"])
    older = make_account(org_a, 1002, client_account="00001002")
    older.debt_group = 4
    older.save(update_fields=["debt_group"])
    steps = [
        {"order": 1, "action": "email", "groups": [1, 2], "template": "Письмо", "terminal": False, "blocks_next": True},
        {"order": 2, "action": "warning", "branch_group": 3, "template": "Предупреждение", "terminal": True},
    ]
    created = api(admin_a).post("/api/v1/nsi/scenarios/", {"name": "Ветки", "steps": steps}, format="json")
    assert created.status_code == 201, created.content
    scenario_id = created.json()["id"]
    published = api(admin_a).post(f"/api/v1/nsi/scenarios/{scenario_id}/publish/", {}, format="json")
    assert published.status_code == 200, published.content
    young = api(admin_a).post(f"/api/v1/nsi/scenarios/{scenario_id}/assign/", {"account": account_a.id}, format="json")
    assert young.status_code == 200, young.content
    notice = Measure.objects.get(accounts=account_a, source_scenario_id=scenario_id)
    assert notice.kind == "notice"
    assert notice.channel == "email"
    assert notice.source_version == published.json()["version"]
    mature = api(admin_a).post(f"/api/v1/nsi/scenarios/{scenario_id}/assign/", {"account": older.id}, format="json")
    assert mature.status_code == 200, mature.content
    warning = Measure.objects.get(accounts=older, source_scenario_id=scenario_id)
    assert warning.kind == "warning"
    assert warning.source_action == "warning"


@pytest.mark.django_db
def test_pause_keeps_a_history(api, admin_a, account_a):
    from apps.debts.models import Measure, ScenarioPause

    listing = api(admin_a).get("/api/v1/nsi/scenarios/")
    standard = next(row for row in listing.json()["results"] if row["name"] == "Стандартное взыскание")
    copied = api(admin_a).post(f"/api/v1/nsi/scenarios/{standard['id']}/copy/", {}, format="json")
    scenario_id = copied.json()["id"]
    api(admin_a).post(f"/api/v1/nsi/scenarios/{scenario_id}/publish/", {}, format="json")
    paused = api(admin_a).post(
        f"/api/v1/nsi/scenarios/{scenario_id}/assign/",
        {"account": account_a.id, "paused": True, "pause_reason": "судебный спор"},
        format="json",
    )
    assert paused.status_code == 200, paused.content
    assert paused.json()["pauses"][0]["reason"] == "судебный спор"
    assert not Measure.objects.filter(source_scenario_id=scenario_id).exists()
    resumed = api(admin_a).post(
        f"/api/v1/nsi/scenarios/{scenario_id}/assign/",
        {"account": account_a.id, "paused": False},
        format="json",
    )
    assert resumed.status_code == 200, resumed.content
    assert ScenarioPause.objects.filter(run__account=account_a).count() == 2


@pytest.mark.django_db
def test_scale_rejects_overlap_and_history_stays(api, superadmin, account_a):
    from django.core.management import call_command

    from apps.debts.models import StatusHistory
    from apps.nsi.models import DebtGroupScale

    call_command("loaddata", "debt_group_scale", verbosity=0)
    group = DebtGroupScale.objects.get(group=2)
    overlapped = api(superadmin).patch(
        f"/api/v1/nsi/debt-groups/{group.id}/", {"months_from": 0}, format="json",
    )
    assert overlapped.status_code == 400
    account_a.debt_group = 6
    account_a.rating = "E"
    account_a.save(update_fields=["debt_group", "rating"])
    past = StatusHistory.objects.create(
        organization=account_a.organization, account=account_a, kind=StatusHistory.Kind.RATING,
        old_value="C/1", new_value="E", reason="было",
    )
    saved = api(superadmin).patch(
        "/api/v1/nsi/calculation-settings/current/",
        {"rating_b_group": 3, "rating_c_from": 4, "rating_c_to": 6, "rating_e_from": 7},
        format="json",
    )
    assert saved.status_code == 200, saved.content
    past.refresh_from_db()
    account_a.refresh_from_db()
    assert past.new_value == "E"
    assert account_a.rating == "E"
    applied = api(superadmin).patch(
        "/api/v1/nsi/calculation-settings/current/",
        {"rating_b_group": 3, "rating_c_from": 4, "rating_c_to": 5, "rating_e_from": 6, "apply_recorded": True},
        format="json",
    )
    assert applied.status_code == 200, applied.content
    past.refresh_from_db()
    assert past.new_value == "E"


@pytest.mark.django_db
def test_weekday_rule_and_scenario_call_legal(api, admin_a, org_a, account_a):
    from datetime import date

    from apps.debts.models import Contact, Measure
    from apps.debts.services.contacts import choose_phone
    from apps.nsi.models import CalculationSettings

    Contact.objects.create(
        organization=org_a, account=account_a, kind=Contact.Kind.CITY, value="+375172220000",
        source=Contact.Source.PM, priority=9,
    )
    Contact.objects.create(
        organization=org_a, account=account_a, kind=Contact.Kind.MOBILE, value="+375291110000",
        source=Contact.Source.PM, priority=1,
    )
    settings = CalculationSettings.load()
    settings.dial_mobile_weekdays = [0]
    settings.dial_mobile_from_day = 28
    settings.dial_mobile_from_hour = None
    settings.dial_mobile_to_hour = None
    settings.save()
    assert choose_phone(account_a, date(2026, 10, 5), None).value == "+375291110000"
    account_a.payer_unp = "190000000"
    account_a.payer_identifier = ""
    account_a.debt_group = 1
    account_a.save(update_fields=["payer_unp", "payer_identifier", "debt_group"])
    created = api(admin_a).post(
        "/api/v1/nsi/scenarios/",
        {"name": "ЮЛ", "call_legal": True, "steps": [
            {"order": 1, "action": "call", "template": "Голос", "terminal": True},
        ]},
        format="json",
    )
    assert created.status_code == 201, created.content
    scenario_id = created.json()["id"]
    api(admin_a).post(f"/api/v1/nsi/scenarios/{scenario_id}/publish/", {}, format="json")
    assigned = api(admin_a).post(f"/api/v1/nsi/scenarios/{scenario_id}/assign/", {"account": account_a.id}, format="json")
    assert assigned.status_code == 200, assigned.content
    measure = Measure.objects.get(source_scenario_id=scenario_id)
    assert measure.call_legal is True
    assert measure.kind == "call"


@pytest.mark.django_db
def test_message_template_version_stays_on_the_sent_notice(api, admin_a, specialist_a, account_a, fake_gateway):
    from apps.notifications.models import Notification

    created = api(admin_a).post(
        "/api/v1/templates/",
        {"code": "letter-v", "name": "Письмо", "channel": "email", "subject": "Долг", "body": "Первая {fio}"},
        format="json",
    )
    assert created.status_code == 201, created.content
    template_id = created.json()["id"]
    sent = api(specialist_a).post(
        "/api/v1/notifications/",
        {"channel": "email", "template": template_id, "account": account_a.id},
        format="json",
    )
    assert sent.status_code == 201, sent.content
    assert sent.json()["template_version"] == 1
    changed = api(admin_a).patch(f"/api/v1/templates/{template_id}/", {"body": "Вторая {fio}"}, format="json")
    assert changed.status_code == 200, changed.content
    assert changed.json()["version"] == 2
    assert Notification.objects.get(pk=sent.json()["id"]).template_version == 1
    rolled = api(admin_a).post(f"/api/v1/templates/{template_id}/rollback/", {"version": 1}, format="json")
    assert rolled.status_code == 200, rolled.content
    assert rolled.json()["version"] == 3
    assert rolled.json()["body"] == "Первая {fio}"
    assert Notification.objects.get(pk=sent.json()["id"]).template_version == 1


@pytest.mark.django_db
def test_print_package_keeps_the_pdf_of_its_version(api, admin_a, specialist_a, org_a, account_a):
    other = make_account(org_a, 1003, client_account="00001003")
    created = api(admin_a).post(
        "/api/v1/nsi/print-forms/",
        {
            "code": "warn-pdf", "name": "Предупреждение PDF", "doc_kind": "warning", "addressee": "district",
            "body": "Долг {amount}", "font_size": 14, "indent_mm": 10,
            "logo_text": "ЕРИП", "requisites": "УНП 1", "signatory": "Директор",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    form_id = created.json()["id"]
    rendered = api(specialist_a).post(
        f"/api/v1/nsi/print-forms/{form_id}/render/",
        {"accounts": [account_a.id, other.id]},
        format="json",
    )
    assert rendered.status_code == 200, rendered.content
    assert len(rendered.json()["documents"]) == 2
    assert rendered.json()["documents"][0]["version"] == 1
    document_id = rendered.json()["documents"][0]["id"]
    downloaded = api(specialist_a).get(f"/api/v1/nsi/print-forms/{form_id}/documents/{document_id}/")
    assert downloaded.status_code == 200
    payload = b"".join(downloaded.streaming_content)
    assert payload.startswith(b"%PDF")
    api(admin_a).patch(f"/api/v1/nsi/print-forms/{form_id}/", {"body": "Новая {fio}"}, format="json")
    again = api(specialist_a).get(f"/api/v1/nsi/print-forms/{form_id}/documents/{document_id}/")
    assert b"".join(again.streaming_content) == payload


@pytest.mark.django_db
def test_claims_views_share_the_collection_population(api, specialist_a, org_a):
    on_writ = make_account(org_a, 4101, funnel_stage="enforcement")
    on_measure = make_account(org_a, 4102, funnel_stage="warning")
    party = Measure.objects.create(
        organization=org_a, kind=Measure.Kind.COLLECTION, status=Measure.Status.ASSIGNED,
        due_on=date(2026, 10, 15),
    )
    party.accounts.add(on_measure)
    outsider = make_account(org_a, 4103, funnel_stage="new")
    from_group = make_account(org_a, 4104, funnel_stage="disconnect", debt_group=3)

    listed = api(specialist_a).get("/api/v1/accounts/", {"scope": "claims", "page_size": 50})
    assert listed.status_code == 200, listed.content
    ids = {row["id"] for row in listed.json()["results"]}
    assert {on_writ.id, on_measure.id, from_group.id} <= ids
    assert outsider.id not in ids

    columns = api(specialist_a).get("/api/v1/accounts/kanban/", {"scope": "claims"}).json()
    cards = {card["id"] for column in columns for card in column["cards"]}
    assert {on_writ.id, on_measure.id, from_group.id} <= cards
    assert outsider.id not in cards
    by_stage = {column["stage"]: column["total"] for column in columns}
    assert [column["stage"] for column in columns][:2] == ["queue", "prep"]
    assert by_stage["queue"] >= 3
    assert by_stage["prep"] == 0
    queued = next(column for column in columns if column["stage"] == "queue")
    assert all(card["claim_id"] is None and card["claim_stage"] == "queue" for card in queued["cards"])

    events = api(specialist_a).get("/api/v1/accounts/calendar/", {
        "scope": "claims", "date_from": "2026-10-01", "date_to": "2026-10-31",
    })
    assert events.status_code == 200, events.content
    assert "Взыскание" in {row["title"] for row in events.json()}

    charts = api(specialist_a).get("/api/v1/accounts/charts/", {"scope": "claims"}).json()
    assert charts["cases"] == 3


@pytest.mark.django_db
def test_scenario_step_keeps_the_template_after_rename(org_a):
    template = MessageTemplate.objects.create(
        organization=org_a, code="remind", name="Старое имя", channel="sms", body="Текст",
    )
    assert step_template_name({"template_id": template.id, "template": "Старое имя"}, "Сценарий") == "Старое имя"
    template.name = "Новое имя"
    template.save(update_fields=["name"])
    assert step_template_name({"template_id": template.id, "template": "Старое имя"}, "Сценарий") == "Новое имя"
    assert step_template_name({"template": "Как записано"}, "Сценарий") == "Как записано"
