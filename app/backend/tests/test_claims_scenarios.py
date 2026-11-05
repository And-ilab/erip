"""Показательный контур ТЗ 4.2.4 и 4.2.5: дело взыскания и конструктор сценария."""

from datetime import date
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command

from apps.debts.models import (
    AccountScenarioRun, AccountService, Attachment, ClaimCase, ClaimEvent, ClaimPackage, DebtWorkItem, Measure,
)
from apps.debts.services.eds import sample_detached_pkcs7
from apps.notifications.models import MessageTemplate
from apps.nsi.services.scenario_engine import step_template_name
from apps.users.models import ServiceOrganization, User

from .conftest import make_account, make_user


def _formed_package(api, user, account, case_id):
    """Собирает пакет и прикладывает файлы ЭЦП, чтобы заглушка отправки могла сработать."""
    call_command("loaddata", "bnp_dictionaries", verbosity=0)
    saved = api(user).post(
        f"/api/v1/claims/{case_id}/package/",
        {
            "service_id": 572,
            "contact_data": "+375291112233",
            "notification_email": "ivan@example.com",
            "user_message": "Прошу совершить исполнительную надпись",
            "debtors": [{
                "personType": "natural",
                "personalId": "3230587H066PB5",
                "secondName": "Иванов",
                "firstName": "Иван",
                "middleName": "Иванович",
            }],
            "debts": [{"source": "balance", "typeId": "dolg_9_3", "dateAt": "2026-03-01"}],
        },
        format="json",
    )
    assert saved.status_code == 200, saved.content
    application = api(user).post(f"/api/v1/claims/{case_id}/package/application/", {}, format="json")
    assert application.status_code == 200, application.content
    for doc_type, filename in (("debt_calculation", "raschet.pdf"), ("proxy", "doverennost.pdf")):
        uploaded = api(user).post(
            f"/api/v1/claims/{case_id}/package/documents/",
            {"doc_type": doc_type, "signature_kind": "p7s", "pdf": SimpleUploadedFile(filename, b"%PDF-1.4")},
            format="multipart",
        )
        assert uploaded.status_code == 200, uploaded.content
    formed = api(user).post(f"/api/v1/claims/{case_id}/package/form/", {}, format="json")
    assert formed.status_code == 200, formed.content
    body = formed.json()
    for doc in body["package"]["documents"]:
        signed = api(user).post(
            f"/api/v1/claims/{case_id}/package/documents/",
            {
                "doc_type": doc["doc_type"],
                "doc_id": doc["id"],
                "signature_kind": "p7s",
                "signature": SimpleUploadedFile(doc["signature_name"], sample_detached_pkcs7()),
            },
            format="multipart",
        )
        assert signed.status_code == 200, signed.content
        assert signed.json()["package"]["formed_at"]


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
    _formed_package(api, specialist_a, account_a, case_id)
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
def test_bnp_stub_result_marks_writ_without_cabinet(api, specialist_a, account_a):
    opened = api(specialist_a).post("/api/v1/claims/", {"account": account_a.id}, format="json")
    assert opened.status_code == 201, opened.content
    case_id = opened.json()["id"]
    early = api(specialist_a).post(f"/api/v1/claims/{case_id}/bnp-result/", {}, format="json")
    assert early.status_code == 400
    assert "Направлено нотариусу" in early.content.decode()

    _ready(api, specialist_a, account_a)
    _formed_package(api, specialist_a, account_a, case_id)
    sent = api(specialist_a).post(f"/api/v1/claims/{case_id}/send-notary/", {}, format="json")
    assert sent.status_code == 200, sent.content
    assert sent.json()["stage"] == "notary"

    answered = api(specialist_a).post(f"/api/v1/claims/{case_id}/bnp-result/", {}, format="json")
    assert answered.status_code == 200, answered.content
    body = answered.json()
    assert body["stage"] == "writ_done"
    assert body["submission_mode"] == "stub"
    assert "Ответ БНП — заглушка. Кабинет не вызывался." in body["notary_note"]
    assert any(event["reason"].startswith("Ответ БНП — заглушка") for event in body["events"])
    stub = next(item for item in body["files"] if item["doc_type"] == "Исполнительная надпись")
    assert stub["name"].startswith("zaglushka-bnp-")
    assert body["pris"]["request"]["pdf_id"] == stub["id"]
    stored = Attachment.objects.get(pk=stub["id"])
    assert stored.file.read().startswith(b"%PDF")

    again = api(specialist_a).post(f"/api/v1/claims/{case_id}/bnp-result/", {}, format="json")
    assert again.status_code == 400
    assert "Направлено нотариусу" in again.content.decode()


@pytest.mark.django_db
def test_writeoff_needs_three_acts_and_every_approval(api, specialist_a, admin_a, account_a, org_a):
    case_id = _ready(api, specialist_a, account_a)
    for index in range(3):
        added = api(specialist_a).post(
            f"/api/v1/claims/{case_id}/acts/",
            {
                "title": f"Акт {index + 1}",
                "file": SimpleUploadedFile(f"act-{index}.pdf", b"%PDF-1.4", content_type="application/pdf"),
            },
        )
        assert added.status_code == 200, added.content
    early = api(specialist_a).post(f"/api/v1/claims/{case_id}/writeoff/", {"approver_ids": [admin_a.id]}, format="json")
    assert early.status_code == 400

    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
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
        api(specialist_a).post(
            f"/api/v1/claims/{case_id}/acts/",
            {
                "title": f"Акт {index}",
                "file": SimpleUploadedFile(f"act-{index}.pdf", b"%PDF-1.4", content_type="application/pdf"),
            },
        )
    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
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


def _supplier_user(org, provider_id, username):
    organization = ServiceOrganization.objects.create(
        organization=org, provider_id=provider_id, short_name=username, is_supplier=True,
    )
    user = make_user(username, User.Role.SPECIALIST, org, contour=User.Contour.SUPPLIER)
    user.service_organizations.add(organization)
    return user


@pytest.mark.django_db
def test_supplier_opens_claim_for_his_services(api, specialist_a, org_a, account_a):
    water = AccountService.objects.create(
        organization=org_a, account=account_a, service_list_id=2, service_id=11,
        service_name="Вода", provider_id=900, balance_out=Decimal("40"),
        balance_mulct_out=Decimal("4"), debt_group=3,
    )
    gas = account_a.services.exclude(pk=water.pk).get()
    gas.provider_id = 800
    gas.balance_out = Decimal("100")
    gas.balance_mulct_out = Decimal("10")
    gas.debt_group = 5
    gas.save()
    water_user = _supplier_user(org_a, 900, "claim_water")
    gas_user = _supplier_user(org_a, 800, "claim_gas")
    stranger = _supplier_user(org_a, 777, "claim_stranger")
    empty = make_user("claim_empty", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    case_id = _ready(api, specialist_a, account_a)

    opened = api(water_user).get(f"/api/v1/claims/{case_id}/")
    assert opened.status_code == 200, opened.content
    body = opened.json()
    assert Decimal(body["balance_out"]) == Decimal("40")
    assert Decimal(body["penalty"]) == Decimal("4")
    assert body["debt_group"] == 3
    assert body["rating"] == "B"
    assert body["package"]["debts"][0]["amount"] == "40.00"

    gas_card = api(gas_user).get(f"/api/v1/claims/{case_id}/").json()
    assert Decimal(gas_card["balance_out"]) == Decimal("100")
    assert gas_card["debt_group"] == 5
    assert gas_card["package"]["debts"][0]["amount"] == "100.00"

    billing = api(specialist_a).get(f"/api/v1/claims/{case_id}/").json()
    assert Decimal(billing["balance_out"]) == Decimal("150.00")
    assert Decimal(billing["penalty"]) == Decimal("14")
    assert billing["package"]["debts"][0]["amount"] == "140.00"

    assert api(stranger).get(f"/api/v1/claims/{case_id}/").status_code == 404
    assert api(empty).get(f"/api/v1/claims/{case_id}/").status_code == 404
    listed = {row["id"] for row in api(water_user).get("/api/v1/claims/").json()["results"]}
    assert case_id in listed
    hidden = {row["id"] for row in api(stranger).get("/api/v1/claims/").json()["results"]}
    assert case_id not in hidden

    saved = api(water_user).post(
        f"/api/v1/claims/{case_id}/package/",
        {
            "service_id": 572,
            "contact_data": "+375291112233",
            "notification_email": "ivan@example.com",
            "user_message": "Прошу совершить исполнительную надпись",
            "debtors": [{
                "personType": "natural",
                "personalId": "3230587H066PB5",
                "secondName": "Иванов",
                "firstName": "Иван",
                "middleName": "Иванович",
            }],
            "debts": [{"source": "balance", "typeId": "dolg_9_3", "dateAt": "2026-03-01"}],
        },
        format="json",
    )
    assert saved.status_code == 200, saved.content
    assert saved.json()["package"]["debts"][0]["amount"] == "40.00"
    assert ClaimPackage.objects.get(case_id=case_id).debts[0]["amount"] == "40.00"

    fresh = make_account(org_a, 4401, debt_group=1)
    AccountService.objects.create(
        organization=org_a, account=fresh, service_list_id=3, service_id=12,
        service_name="Вода", provider_id=900, balance_out=Decimal("15"), debt_group=3,
    )
    created = api(water_user).post("/api/v1/claims/", {"account": fresh.id}, format="json")
    assert created.status_code == 201, created.content
    assert Decimal(created.json()["balance_out"]) == Decimal("15")
    denied = api(stranger).post("/api/v1/claims/", {"account": fresh.id}, format="json")
    assert denied.status_code == 400
    assert "не найден" in denied.content.decode()


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
    steps.append({"order": steps[-1]["order"] + 1, "action": "manual_call", "wait_days": 0, "terminal": True})
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
    specialist_a.can_approve = True
    specialist_a.save(update_fields=["can_approve"])
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
    _formed_package(api, specialist_a, account_a, case_id)
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
    steps.append({"order": steps[-1]["order"] + 1, "action": "manual_call", "wait_days": 0, "terminal": True})
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
    # Одна группа ≥ 3 без дела и без мероприятия взыскания в ПИР не попадает (гл. 4 §5, §9).
    from_group = make_account(org_a, 4104, funnel_stage="disconnect", debt_group=3)

    listed = api(specialist_a).get("/api/v1/accounts/", {"scope": "claims", "page_size": 50})
    assert listed.status_code == 200, listed.content
    ids = {row["id"] for row in listed.json()["results"]}
    assert {on_writ.id, on_measure.id} <= ids
    assert outsider.id not in ids
    assert from_group.id not in ids

    columns = api(specialist_a).get("/api/v1/accounts/kanban/", {"scope": "claims"}).json()
    cards = {card["id"] for column in columns for card in column["cards"]}
    assert {on_writ.id, on_measure.id} <= cards
    assert outsider.id not in cards
    assert from_group.id not in cards
    by_stage = {column["stage"]: column["total"] for column in columns}
    assert [column["stage"] for column in columns][:2] == ["queue", "prep"]
    assert by_stage["queue"] >= 1
    assert by_stage["prep"] >= 1
    queued = next(column for column in columns if column["stage"] == "queue")
    prepared = next(column for column in columns if column["stage"] == "prep")
    assert on_writ.id in {card["id"] for card in prepared["cards"]}
    assert on_writ.id not in {card["id"] for card in queued["cards"]}
    assert on_measure.id in {card["id"] for card in queued["cards"]}
    assert all(card["claim_id"] is None and card["claim_stage"] == "queue" for card in queued["cards"])

    events = api(specialist_a).get("/api/v1/accounts/calendar/", {
        "scope": "claims", "date_from": "2026-10-01", "date_to": "2026-10-31",
    })
    assert events.status_code == 200, events.content
    assert any("Взыскание" in row["title"] and "00004102" in row["title"] for row in events.json())

    charts = api(specialist_a).get("/api/v1/accounts/charts/", {"scope": "claims"}).json()
    assert charts["cases"] == 2


@pytest.mark.django_db
def test_account_stage_is_the_claim_and_measure_stage(api, specialist_a, org_a):
    account = make_account(org_a, 4190, funnel_stage="opi", debt_group=3)
    columns = api(specialist_a).get(
        "/api/v1/accounts/kanban/", {"scope": "claims", "claim_module": "opi"},
    ).json()
    opi = next(column for column in columns if column["stage"] == "opi")
    queue = next(column for column in columns if column["stage"] == "queue")
    assert account.id in {card["id"] for card in opi["cards"]}
    assert account.id not in {card["id"] for card in queue["cards"]}
    assert ClaimCase.objects.filter(account=account).count() == 0

    board = api(specialist_a).get(f"/api/v1/accounts/{account.id}/activities/").json()
    assert board["stage"] == "opi"
    case = ClaimCase.objects.get(account=account)
    assert case.stage == "opi"
    assert board["claim_id"] == case.id

    case.stage = ClaimCase.Stage.PREP
    case.save(update_fields=["stage"])
    opened = api(specialist_a).get(f"/api/v1/claims/{case.id}/")
    assert opened.status_code == 200, opened.content
    assert opened.json()["stage"] == "opi"

    from apps.debts.services.scenario_board import scenario_outline

    party = Measure.objects.get(accounts=account, source_action="claim")
    outline = scenario_outline(account)
    opi_step = next(step for step in outline["steps"] if step["action"] == "opi")
    writ_step = next(step for step in outline["steps"] if step["action"] == "writ")
    assert party.id in {row["id"] for row in opi_step["measures"]}
    assert all(row["id"] != party.id for row in writ_step["measures"])
    assert opi_step["measures"][0]["kind_label"] == "Направлено в ОПИ"


@pytest.mark.django_db
def test_second_open_returns_the_same_case(api, specialist_a, account_a):
    first = api(specialist_a).post("/api/v1/claims/", {"account": account_a.id}, format="json")
    second = api(specialist_a).post("/api/v1/claims/", {"account": account_a.id}, format="json")
    assert first.status_code == 201, first.content
    assert second.status_code == 201, second.content
    assert first.json()["id"] == second.json()["id"]
    assert ClaimCase.objects.filter(account=account_a).count() == 1


@pytest.mark.django_db
def test_notary_note_does_not_replace_the_lawsuit_note(api, specialist_a, account_a):
    case_id = _ready(api, specialist_a, account_a)
    saved = api(specialist_a).patch(
        f"/api/v1/claims/{case_id}/",
        {"notary_note": "Ждём постановление", "lawsuit_note": "Иск о взыскании"},
        format="json",
    )
    assert saved.status_code == 200, saved.content
    assert saved.json()["notary_note"] == "Ждём постановление"
    assert saved.json()["lawsuit_note"] == "Иск о взыскании"


@pytest.mark.django_db
def test_opi_card_stays_on_one_branch(api, specialist_a, org_a):
    writ = make_account(org_a, 7101, client_account="00007101", debt_group=3)
    court = make_account(org_a, 7102, client_account="00007102", debt_group=3)
    writ_case = ClaimCase.objects.create(organization=org_a, account=writ, stage=ClaimCase.Stage.OPI)
    ClaimEvent.objects.create(case=writ_case, old_stage="writ_done", new_stage="opi", reason="Направлено в ОПИ")
    court_case = ClaimCase.objects.create(organization=org_a, account=court, stage=ClaimCase.Stage.OPI)
    ClaimEvent.objects.create(case=court_case, old_stage="lawsuit", new_stage="court", reason="Решение суда")
    ClaimEvent.objects.create(case=court_case, old_stage="court", new_stage="opi", reason="Направлено в ОПИ")

    def ids(module):
        columns = api(specialist_a).get(
            "/api/v1/accounts/kanban/", {"scope": "claims", "claim_module": module},
        ).json()
        return {card["id"] for column in columns for card in column["cards"]}

    notary_ids = ids("notary")
    court_ids = ids("court")
    assert writ.id in notary_ids
    assert writ.id not in court_ids
    assert court.id in court_ids
    assert court.id not in notary_ids

    listed = api(specialist_a).get("/api/v1/accounts/", {"scope": "claims", "claim_module": "court", "page_size": 50})
    assert {row["id"] for row in listed.json()["results"]} >= {court.id}
    assert writ.id not in {row["id"] for row in listed.json()["results"]}


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


def _checklist_with_disconnect(*, mandatory: bool) -> list[dict]:
    from apps.nsi.services.writ_checklist import default_checklist

    rows = default_checklist()
    rows.append({
        "code": "disconnect",
        "order": len(rows) + 1,
        "name": "Отключение услуг",
        "criteria": "Услуги отключены или этап неприменим",
        "mandatory": mandatory,
    })
    return rows


def _publish_writ(api, admin, account, checklist: list[dict]):
    created = api(admin).post(
        "/api/v1/nsi/scenarios/",
        {
            "name": "Надпись с чек-листом",
            "steps": [
                {"order": 1, "action": "warning", "wait_days": 0, "terminal": False},
                {"order": 2, "action": "writ", "wait_days": 0, "terminal": True, "checklist": checklist},
            ],
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    scenario_id = created.json()["id"]
    published = api(admin).post(f"/api/v1/nsi/scenarios/{scenario_id}/publish/", {}, format="json")
    assert published.status_code == 200, published.content
    from apps.nsi.models import ScenarioDefinition

    scenario = ScenarioDefinition.objects.get(pk=scenario_id)
    AccountScenarioRun.objects.create(
        organization=account.organization, account=account, scenario=scenario, version=scenario.version,
    )
    return scenario_id


@pytest.mark.django_db
def test_writ_step_gets_the_legal_checklist_and_keeps_a_skippable_stage(api, admin_a):
    created = api(admin_a).post(
        "/api/v1/nsi/scenarios/",
        {"name": "Без чек-листа", "steps": [{"order": 1, "action": "writ", "terminal": True}]},
        format="json",
    )
    assert created.status_code == 201, created.content
    codes = [item["code"] for item in created.json()["steps"][0]["checklist"]]
    assert codes == ["warning", "voluntary", "package", "tariff"]
    assert all(item["mandatory"] for item in created.json()["steps"][0]["checklist"])

    dropped = api(admin_a).post(
        "/api/v1/nsi/scenarios/",
        {
            "name": "Без тарифа",
            "steps": [{
                "order": 1, "action": "writ", "terminal": True,
                "checklist": [item for item in created.json()["steps"][0]["checklist"] if item["code"] != "tariff"],
            }],
        },
        format="json",
    )
    assert dropped.status_code == 400
    assert "тариф" in dropped.content.decode().lower()

    optional = api(admin_a).post(
        "/api/v1/nsi/scenarios/",
        {
            "name": "С пропуском",
            "steps": [{
                "order": 1, "action": "writ", "terminal": True,
                "checklist": _checklist_with_disconnect(mandatory=False),
            }],
        },
        format="json",
    )
    assert optional.status_code == 201, optional.content
    saved = optional.json()["steps"][0]["checklist"]
    assert [item["code"] for item in saved][-1] == "disconnect"
    assert saved[-1]["mandatory"] is False

    forced = dict(saved[0])
    forced["mandatory"] = False
    rows = [forced, *saved[1:]]
    rejected = api(admin_a).patch(
        f"/api/v1/nsi/scenarios/{optional.json()['id']}/",
        {"steps": [{"order": 1, "action": "writ", "terminal": True, "checklist": rows}]},
        format="json",
    )
    assert rejected.status_code == 400
    assert "пропуск" in rejected.content.decode().lower()


@pytest.mark.django_db
def test_notary_follows_the_scenario_checklist(api, specialist_a, admin_a, account_a):
    from django.utils import timezone

    opened = api(specialist_a).post("/api/v1/claims/", {"account": account_a.id}, format="json")
    assert opened.status_code == 201, opened.content
    checklist = opened.json()["writ_checklist"]
    assert [item["code"] for item in checklist] == ["warning", "voluntary", "package", "tariff"]
    assert checklist[0]["met"] is False

    _publish_writ(api, admin_a, account_a, _checklist_with_disconnect(mandatory=True))
    case_id = _ready(api, specialist_a, account_a)
    _formed_package(api, specialist_a, account_a, case_id)
    blocked = api(specialist_a).post(f"/api/v1/claims/{case_id}/send-notary/", {}, format="json")
    assert blocked.status_code == 400
    assert "отключен" in blocked.content.decode().lower()

    measure = Measure.objects.create(
        organization=account_a.organization, kind=Measure.Kind.DISCONNECT, status=Measure.Status.DONE,
    )
    measure.accounts.add(account_a)
    sent = api(specialist_a).post(f"/api/v1/claims/{case_id}/send-notary/", {}, format="json")
    assert sent.status_code == 200, sent.content
    assert sent.json()["stage"] == "notary"

    other = make_account(account_a.organization, 1002, client_account="00001002", debt_group=3)
    _publish_writ(api, admin_a, other, _checklist_with_disconnect(mandatory=False))
    other_id = _ready(api, specialist_a, other)
    _formed_package(api, specialist_a, other, other_id)
    needs_reason = api(specialist_a).post(f"/api/v1/claims/{other_id}/send-notary/", {}, format="json")
    assert needs_reason.status_code == 400
    assert "причин" in needs_reason.content.decode().lower()
    skipped = api(specialist_a).post(
        f"/api/v1/claims/{other_id}/send-notary/",
        {"skip_reason": "Отключение технически невозможно"},
        format="json",
    )
    assert skipped.status_code == 200, skipped.content
    assert skipped.json()["skip_reason"] == "Отключение технически невозможно"
    assert any("Пропуск:" in item["reason"] for item in skipped.json()["events"])

    fresh = make_account(account_a.organization, 1003, client_account="00001003", debt_group=3)
    fresh_id = _ready(api, specialist_a, fresh)
    today = timezone.localdate().isoformat()
    api(specialist_a).patch(f"/api/v1/claims/{fresh_id}/", {"warning_delivered_on": today}, format="json")
    early = api(specialist_a).post(f"/api/v1/claims/{fresh_id}/send-notary/", {}, format="json")
    assert early.status_code == 400
    assert "истёк" in early.content.decode().lower()


def _activity(nodes, code):
    for node in nodes:
        if node["code"] == code:
            return node
        found = _activity(node["children"], code)
        if found:
            return found
    return None


@pytest.mark.django_db
def test_opi_direction_needs_office_date_and_document(api, specialist_a, account_a):
    case_id = _ready(api, specialist_a, account_a)
    case = ClaimCase.objects.get(pk=case_id)
    case.stage = ClaimCase.Stage.WRIT_DONE
    case.save(update_fields=["stage"])
    Attachment.objects.create(
        organization=account_a.organization,
        account=account_a,
        doc_type="Исполнительный документ",
        original_name="list.pdf",
        file=SimpleUploadedFile("list.pdf", b"%PDF", content_type="application/pdf"),
    )

    blocked = api(specialist_a).post(f"/api/v1/claims/{case_id}/move/", {"stage": "opi"}, format="json")
    assert blocked.status_code == 400
    assert "орган" in blocked.content.decode().lower()

    recorded = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/opi/",
        {"department": "701 — ОПИ Заводского района", "sent_on": "2026-04-01", "number": "", "status": ""},
        format="json",
    )
    assert recorded.status_code == 200, recorded.content
    moved = api(specialist_a).post(f"/api/v1/claims/{case_id}/move/", {"stage": "opi"}, format="json")
    assert moved.status_code == 200, moved.content
    assert moved.json()["stage"] == "opi"

    account_a.refresh_from_db()
    assert account_a.funnel_stage == "opi"
    board = api(specialist_a).get(f"/api/v1/accounts/{account_a.id}/activities/").json()
    office = _activity(board["current"], "opi_office")
    sent = _activity(board["current"], "opi_sent")
    document = _activity(board["current"], "opi_doc")
    proceeding = _activity(board["current"], "opi_send")
    assert office["status"] == "done"
    assert sent["status"] == "done"
    assert document["status"] == "done"
    assert proceeding["status"] == "running"

    no_measures = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/move/", {"stage": "opi_measures"}, format="json",
    )
    assert no_measures.status_code == 400
    assert "мер" in no_measures.content.decode().lower()

    measured = api(specialist_a).post(
        f"/api/v1/claims/{case_id}/opi-measures/",
        {
            "kind": "asset_arrest",
            "title": "Арест имущества",
            "date": "2026-04-12",
            "file": SimpleUploadedFile("arrest.pdf", b"%PDF", content_type="application/pdf"),
            "move_stage": "1",
        },
    )
    assert measured.status_code == 200, measured.content
    assert measured.json()["stage"] == "opi_measures"

    account_a.funnel_stage = "lawsuit"
    account_a.save(update_fields=["funnel_stage"])
    lawsuit = api(specialist_a).get(f"/api/v1/accounts/{account_a.id}/activities/").json()
    filed = _activity(lawsuit["current"], "filed")
    done = api(specialist_a).post(
        f"/api/v1/accounts/{account_a.id}/activities/",
        {"id": filed["id"], "note": "02.05.2026"},
        format="json",
    )
    assert done.status_code == 200, done.content
    case.refresh_from_db()
    assert case.lawsuit_filed_on == date(2026, 5, 2)
    assert _activity(done.json()["current"], "filed")["status"] == "done"


@pytest.mark.django_db
def test_scenario_delete_hides_the_row_and_keeps_a_running_account(api, admin_a, specialist_a, superadmin, account_a):
    from apps.nsi.models import ScenarioDefinition, ServiceScenarioMode

    created = api(admin_a).post(
        "/api/v1/nsi/scenarios/",
        {"name": "Лишний", "steps": [{"order": 1, "action": "warning", "wait_days": 0, "terminal": True}]},
        format="json",
    )
    assert created.status_code == 201, created.content
    scenario_id = created.json()["id"]
    mode = ServiceScenarioMode.objects.filter(service_organization__organization=account_a.organization).first()
    mode.scenario_id = scenario_id
    mode.save(update_fields=["scenario"])

    denied = api(specialist_a).delete(f"/api/v1/nsi/scenarios/{scenario_id}/")
    assert denied.status_code == 403

    removed = api(admin_a).delete(f"/api/v1/nsi/scenarios/{scenario_id}/")
    assert removed.status_code == 204, removed.content
    mode.refresh_from_db()
    assert mode.scenario_id is None
    listed = api(admin_a).get("/api/v1/nsi/scenarios/")
    assert scenario_id not in {row["id"] for row in listed.json()["results"]}
    stored = ScenarioDefinition.objects.get(pk=scenario_id)
    assert stored.is_active is False

    published = api(admin_a).post(
        "/api/v1/nsi/scenarios/",
        {"name": "На счетах", "steps": [{"order": 1, "action": "warning", "wait_days": 0, "terminal": True}]},
        format="json",
    )
    assert published.status_code == 201, published.content
    running_id = published.json()["id"]
    assert api(admin_a).post(f"/api/v1/nsi/scenarios/{running_id}/publish/", {}, format="json").status_code == 200
    assert api(admin_a).post(
        f"/api/v1/nsi/scenarios/{running_id}/assign/", {"account": account_a.id}, format="json",
    ).status_code == 200
    blocked = api(admin_a).delete(f"/api/v1/nsi/scenarios/{running_id}/")
    assert blocked.status_code == 400
    assert "счетах" in blocked.content.decode()

    standard = next(row for row in listed.json()["results"] if row["name"] == "Стандартное взыскание")
    kept = api(superadmin).delete(f"/api/v1/nsi/scenarios/{standard['id']}/")
    assert kept.status_code == 400
    assert "Стандартное взыскание" in kept.content.decode()

