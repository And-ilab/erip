"""Сборка пакета АИС ПРИС из дела. Заглушка канала не записывает чужой номер производства."""

from datetime import date
from decimal import Decimal

import pytest
from django.core.files.base import ContentFile

from apps.debts.models import Attachment, ClaimCase, Payment, PrisExchange, Registration, Territory
from apps.debts.services.eds import sample_detached_pkcs7
from apps.debts.services.pris_gateway import RecordingPrisTransport, set_pris_transport
from apps.debts.services.pris_nsi import clear_pris_dictionary_cache
from apps.debts.services.pris_submit import refresh_open_proceedings
from apps.users.models import Organization

from .conftest import make_account


@pytest.fixture
def pris_transport():
    transport = RecordingPrisTransport()
    set_pris_transport(transport)
    yield transport
    set_pris_transport(None)


def _ready_case(org: Organization):
    org.unp = "101528843"
    org.name = "Унитарное предприятие"
    org.pris_claimant = {
        "opf": "1300",
        "country": "112",
        "full_adr": "220030, г. Минск, ул. Интернациональная, 36",
        "np_type": "1",
        "np": "Минск",
        "house": "36",
        "bank_code": "PJCBBY2X",
        "acc_num": "BY05PJCB30120002411000000933",
        "acc_type": "4",
        "curr_code": "933",
    }
    org.save()
    country = Territory.objects.create(kind="country", name="Беларусь", name_key="by-pris")
    oblast = Territory.objects.create(parent=country, kind="oblast", name="Минская", name_key="minsk-obl")
    district = Territory.objects.create(parent=oblast, kind="district", name="Минский", name_key="minsk-dist")
    city = Territory.objects.create(parent=district, kind="settlement", name="Минск", name_key="minsk")
    street = Territory.objects.create(parent=city, kind="street", name="Пример", name_key="primer")
    house = Territory.objects.create(parent=street, kind="house", name="1", name_key="1")
    account = make_account(org, 7701, client_account="00007701", territory=house)
    account.balance_out = Decimal("211.24")
    account.save(update_fields=["balance_out"])
    Registration.objects.create(
        organization=org, account=account, registration_id=1, subj_id=1, subj_is_main=True,
        fam="Малачетыре", im="Четверик", ot="Итестычтэры", birthday=date(1984, 4, 11),
        personal_num="3070786A070PB0", citizenship_name="Республика Беларусь",
        registration_address="220030, г. Минск, ул. Пример, д. 1",
    )
    pdf = Attachment.objects.create(
        organization=org, account=account, doc_type="исполнительная надпись", original_name="writ.pdf",
        file=ContentFile(b"%PDF-1.4 writ", name="writ.pdf"),
    )
    signature = Attachment.objects.create(
        organization=org, account=account, doc_type="подпись", original_name="writ.pdf.p7s",
        file=ContentFile(sample_detached_pkcs7(), name="writ.pdf.p7s"),
    )
    case = ClaimCase.objects.create(organization=org, account=account, stage=ClaimCase.Stage.WRIT_DONE)
    return case, pdf, signature


def _body(pdf_id: int, signature_id: int, **extra) -> dict:
    body = {
        "opi": "601",
        "req_init": "205",
        "doc_code": "15",
        "doc_num": "124-2025",
        "doc_date": "09.12.2025",
        "doc_org_code": "6",
        "doc_org": "нотариус Минского городского нотариального округа",
        "doc_date_in": "09.12.2025",
        "debtor_np_type": "1",
        "pdf_id": pdf_id,
        "signature_id": signature_id,
    }
    body.update(extra)
    return body


def test_stub_submit_keeps_regulation_package_and_does_not_open_proceeding(api, specialist_a, org_a, pris_transport):
    case, pdf, signature = _ready_case(org_a)
    response = api(specialist_a).post(f"/api/v1/claims/{case.pk}/pris/submit/", _body(pdf.pk, signature.pk), format="json")
    assert response.status_code == 200, response.content
    case.refresh_from_db()
    assert case.opi_mode == "stub"
    assert case.opi_number == ""
    assert case.stage == ClaimCase.Stage.WRIT_DONE
    assert case.pris_cl_num == "schema_a-00007701"
    assert case.pris_process_status == "1000"
    path, payload = pris_transport.calls[0]
    assert path.endswith("save-data-debt/validate")
    item = payload["package"][0]
    assert item["identif"]["p_cl_num"] == "schema_a-00007701"
    assert item["identif"]["p_opi"] == "601"
    assert item["debtor"]["p_d_date_reg"] == "11.04.1984"
    assert item["debtor"]["p_d_adr_reg"]["house"] == "1"
    assert item["debtor"]["p_d_adr_reg"]["np_type"] == "1"
    assert item["debtor"]["p_arr_sum"][0]["p_curr_code"] == "933"
    assert item["documents"][0]["p_files"][0]["file_ecp"] != "writ.pdf"


def test_submit_without_opi_code_does_not_call_pris(api, specialist_a, org_a, pris_transport):
    case, pdf, signature = _ready_case(org_a)
    response = api(specialist_a).post(
        f"/api/v1/claims/{case.pk}/pris/submit/", _body(pdf.pk, signature.pk, opi=""), format="json",
    )
    assert response.status_code == 400
    assert "120" in response.json()["error"]["message"]
    assert pris_transport.calls == []


def test_stub_refresh_does_not_store_sample_proceeding(api, specialist_a, org_a, pris_transport):
    case, _pdf, _signature = _ready_case(org_a)
    case.pris_cl_num = "schema_a-00007701"
    case.save(update_fields=["pris_cl_num"])
    response = api(specialist_a).post(f"/api/v1/claims/{case.pk}/pris/refresh/", {}, format="json")
    assert response.status_code == 200, response.content
    case.refresh_from_db()
    assert case.opi_number == ""
    assert case.stage == ClaimCase.Stage.WRIT_DONE
    assert pris_transport.calls[0][1] == {"p_cl_num": "schema_a-00007701"}


def test_http_refresh_moves_case_when_proceeding_appears(api, specialist_a, org_a):
    transport = RecordingPrisTransport(mode="http")
    set_pris_transport(transport)
    try:
        case, _pdf, _signature = _ready_case(org_a)
        case.pris_cl_num = "schema_a-00007701"
        case.opi_mode = "pris"
        case.save(update_fields=["pris_cl_num", "opi_mode"])
        response = api(specialist_a).post(f"/api/v1/claims/{case.pk}/pris/refresh/", {}, format="json")
        assert response.status_code == 200, response.content
        case.refresh_from_db()
        assert case.opi_number == "60118000051"
        assert case.opi_status == "6"
        assert case.stage == ClaimCase.Stage.OPI
    finally:
        set_pris_transport(None)


def test_channel_keeps_its_proceeding_off_the_regulation_sample(api, specialist_a, org_a):
    transport = RecordingPrisTransport(mode="channel")
    set_pris_transport(transport)
    try:
        case, pdf, signature = _ready_case(org_a)
        response = api(specialist_a).post(
            f"/api/v1/claims/{case.pk}/pris/submit/", _body(pdf.pk, signature.pk), format="json",
        )
        assert response.status_code == 200, response.content
        case.refresh_from_db()
        assert case.opi_mode == "channel"
        assert case.opi_number == ""
        assert case.stage == ClaimCase.Stage.WRIT_DONE
        assert "Тестовый канал" in case.pris_process_message
        submit_row = PrisExchange.objects.get(case=case, operation="submit")
        assert submit_row.mode == "channel"
        assert submit_row.response["note"] == "Ответ тестового канала шлюза."
        assert "60118000051" not in str(submit_row.response)
        refreshed = api(specialist_a).post(f"/api/v1/claims/{case.pk}/pris/refresh/", {}, format="json")
        assert refreshed.status_code == 200, refreshed.content
        case.refresh_from_db()
        assert case.opi_number == "CH-601-0001"
        assert case.opi_status == "канал"
        assert case.stage == ClaimCase.Stage.OPI
        assert case.pris_inquiry["applied"] is True
        assert "60118000051" not in str(case.pris_inquiry)
        blocked = api(specialist_a).post(
            f"/api/v1/claims/{case.pk}/pris/submit/", _body(pdf.pk, signature.pk), format="json",
        )
        assert blocked.status_code == 400
    finally:
        set_pris_transport(None)


def test_repay_uses_payment_date_and_amount(api, specialist_a, org_a, pris_transport):
    case, _pdf, _signature = _ready_case(org_a)
    case.pris_cl_num = "schema_a-00007701"
    case.pris_request = {"req_init": "205"}
    case.save(update_fields=["pris_cl_num", "pris_request"])
    Payment.objects.create(
        organization=org_a, account=case.account, receipt_id=90, pay_date=date(2026, 3, 2),
        pp_num="333888", pay_service_summ=Decimal("10.50"), pay_mulct_summ=Decimal("1.25"),
    )
    response = api(specialist_a).post(f"/api/v1/claims/{case.pk}/pris/repay/", {}, format="json")
    assert response.status_code == 200, response.content
    item = pris_transport.calls[0][1]["package"][0]
    assert item["p_status"] == "2"
    assert item["repayment"][0]["p_pay_date"] == "02.03.2026"
    assert item["repayment"][0]["p_pay_sum"] == "11.75"
    case.refresh_from_db()
    assert "не отправлено" in case.pris_process_message


def test_submit_rejects_local_bnp_mark_and_plain_pdf(api, specialist_a, org_a, pris_transport):
    case, pdf, _signature = _ready_case(org_a)
    marked = Attachment.objects.create(
        organization=org_a, account=case.account, doc_type="отметка", original_name="writ.pdf.p7s",
        file=ContentFile(b"STUB-PACKAGE-SIGNATURE", name="writ.pdf.p7s"),
    )
    response = api(specialist_a).post(
        f"/api/v1/claims/{case.pk}/pris/submit/", _body(pdf.pk, marked.pk), format="json",
    )
    assert response.status_code == 400
    assert "БНП" in response.json()["error"]["message"]
    plain = Attachment.objects.create(
        organization=org_a, account=case.account, doc_type="pdf", original_name="copy.pdf",
        file=ContentFile(b"%PDF-1.4", name="copy.pdf"),
    )
    response = api(specialist_a).post(
        f"/api/v1/claims/{case.pk}/pris/submit/", _body(pdf.pk, plain.pk), format="json",
    )
    assert response.status_code == 400
    assert ".p7s" in response.json()["error"]["message"]
    assert pris_transport.calls == []


def test_submit_writes_exchange_without_file_body(api, specialist_a, org_a, pris_transport):
    case, pdf, signature = _ready_case(org_a)
    response = api(specialist_a).post(f"/api/v1/claims/{case.pk}/pris/submit/", _body(pdf.pk, signature.pk), format="json")
    assert response.status_code == 200, response.content
    row = PrisExchange.objects.get(case=case)
    assert row.operation == "submit"
    assert row.mode == "stub"
    assert row.process_status == "1000"
    dumped = str(row.request)
    assert "JVBER" not in dumped
    assert "скрыто" in dumped
    assert "не отправлено" in row.response["note"]
    card = response.json()["pris"]["exchanges"]
    assert card[0]["note"] == "В АИС ПРИС не отправлено: канал-заглушка"


def test_draft_keeps_debtor_opf(api, specialist_a, org_a):
    case, pdf, signature = _ready_case(org_a)
    body = _body(pdf.pk, signature.pk, debtor_opf="1131")
    response = api(specialist_a).post(f"/api/v1/claims/{case.pk}/pris/draft/", body, format="json")
    assert response.status_code == 200, response.content
    case.refresh_from_db()
    assert case.pris_request["debtor_opf"] == "1131"
    assert case.opi_mode == ""


def test_stub_refresh_does_not_store_inquiry(api, specialist_a, org_a, pris_transport):
    case, _pdf, _signature = _ready_case(org_a)
    case.pris_cl_num = "schema_a-00007701"
    case.save(update_fields=["pris_cl_num"])
    response = api(specialist_a).post(f"/api/v1/claims/{case.pk}/pris/refresh/", {}, format="json")
    assert response.status_code == 200, response.content
    case.refresh_from_db()
    assert case.pris_inquiry == {}
    row = PrisExchange.objects.get(case=case)
    assert "60118000051" not in str(row.response)
    assert row.response["applied"] is False


def test_http_refresh_stores_balances_and_measures(api, specialist_a, org_a):
    transport = RecordingPrisTransport(mode="http", with_actions=True)
    set_pris_transport(transport)
    try:
        case, _pdf, _signature = _ready_case(org_a)
        case.pris_cl_num = "schema_a-00007701"
        case.opi_mode = "pris"
        case.save(update_fields=["pris_cl_num", "opi_mode"])
        response = api(specialist_a).post(f"/api/v1/claims/{case.pk}/pris/refresh/", {}, format="json")
        assert response.status_code == 200, response.content
        case.refresh_from_db()
        assert case.stage == ClaimCase.Stage.OPI_MEASURES
        assert case.pris_inquiry["applied"] is True
        assert case.pris_inquiry["p_ost"][0]["ost_sum"] == "200.00"
        assert case.pris_inquiry["p_action"][0]["measure"] == "арест"
        assert response.json()["pris"]["inquiry"]["p_repay"][0]["p_pay_sum"] == "11.24"
    finally:
        set_pris_transport(None)


def test_dictionary_catalog_uses_regulation_sample(api, specialist_a, pris_transport):
    clear_pris_dictionary_cache()
    response = api(specialist_a).get("/api/v1/claims/pris-dictionaries/")
    assert response.status_code == 200, response.content
    book = response.json()["dictionaries"]["120"]
    assert book["rows"][1] == {"code": "801", "name": "ГУПИ МИНИСТЕРСТВА ЮСТИЦИИ РЕСПУБЛИКИ БЕЛАРУСЬ"}
    assert pris_transport.calls[0][0].endswith("/nsi")
    clear_pris_dictionary_cache()


def test_refresh_command_leaves_sample_number(api, specialist_a, org_a, pris_transport):
    case, _pdf, _signature = _ready_case(org_a)
    case.pris_cl_num = "schema_a-00007701"
    case.save(update_fields=["pris_cl_num"])
    result = refresh_open_proceedings()
    assert result["refreshed"] == 1
    case.refresh_from_db()
    assert case.opi_number == ""


def test_local_admin_saves_claimant_on_organization(api, admin_a, org_a, specialist_a):
    denied = api(specialist_a).patch(
        f"/api/v1/organizations/{org_a.pk}/pris-claimant/", {"opf": "1300"}, format="json",
    )
    assert denied.status_code == 403
    response = api(admin_a).patch(
        f"/api/v1/organizations/{org_a.pk}/pris-claimant/",
        {"opf": "1300", "country": "112", "unknown": "нет"},
        format="json",
    )
    assert response.status_code == 200, response.content
    org_a.refresh_from_db()
    assert org_a.pris_claimant["opf"] == "1300"
    assert org_a.pris_claimant["country"] == "112"
    assert "unknown" not in org_a.pris_claimant
    loaded = api(admin_a).get(f"/api/v1/organizations/{org_a.pk}/pris-claimant/")
    assert loaded.json()["claimant"]["opf"] == "1300"


def test_opi_module_registry_measures_acts_and_autofill(api, specialist_a, admin_a, org_a, pris_transport):
    case, pdf, signature = _ready_case(org_a)

    # 1. Справочник ОПИ (ТЗ 4.2.8.4)
    offices = api(specialist_a).get("/api/v1/nsi/opi-offices/")
    assert offices.status_code == 200, offices.content
    assert any(row["code"] == "701" for row in offices.json()["results"])

    created_office = api(admin_a).post(
        "/api/v1/nsi/opi-offices/",
        {"code": "799", "name": "ОПИ тестового района", "region": "г. Минск"},
        format="json",
    )
    assert created_office.status_code == 201, created_office.content
    office_id = created_office.json()["id"]
    deactivated = api(admin_a).delete(f"/api/v1/nsi/opi-offices/{office_id}/")
    assert deactivated.status_code == 204
    active_codes = {row["code"] for row in api(specialist_a).get("/api/v1/nsi/opi-offices/").json()["results"]}
    assert "799" not in active_codes

    # 2. Ручная регистрация ИП с реквизитами ОПИ (FR-CLM-07)
    recorded = api(specialist_a).post(
        f"/api/v1/claims/{case.pk}/opi/",
        {
            "number": "70126000555",
            "status": "Возбуждено",
            "department": "701 — ОПИ Заводского района г. Минска",
            "sent_on": "2026-10-01",
            "started_on": "2026-10-05",
            "bailiff": "Иванова А. С.",
            "note": "Постановление о возбуждении ИП",
        },
        format="json",
    )
    assert recorded.status_code == 200, recorded.content
    body = recorded.json()
    assert body["opi_number"] == "70126000555"
    assert body["opi_department"] == "701 — ОПИ Заводского района г. Минска"
    assert body["opi_sent_on"] == "2026-10-01"
    assert body["opi_started_on"] == "2026-10-05"
    assert body["opi_bailiff"] == "Иванова А. С."
    assert body["pris"]["request"]["opi"] == "701"

    # 3. Автозаполнение реквизитов пакета ПРИС из карточки ЛС и дела
    autofilled = api(specialist_a).post(f"/api/v1/claims/{case.pk}/pris/autofill/", {}, format="json")
    assert autofilled.status_code == 200, autofilled.content
    req = autofilled.json()["pris"]["request"]
    assert req["opi"] == "701"
    assert req["req_init"] == "205"
    assert req["doc_code"] == "15"
    assert req["debtor_country"] == "112"
    assert req["debtor_np"] == "Минск"

    # 4. Принятые меры ОПИ и автоматический переход на этап «Меры ОПИ»
    measured = api(specialist_a).post(
        f"/api/v1/claims/{case.pk}/opi-measures/",
        {
            "kind": "asset_arrest",
            "title": "Арест имущества",
            "date": "2026-10-12",
            "doc_number": "П-44/2026",
            "note": "Арест автомобиля",
            "move_stage": True,
        },
        format="json",
    )
    assert measured.status_code == 200, measured.content
    m_data = measured.json()
    assert m_data["stage"] == ClaimCase.Stage.OPI_MEASURES
    assert len(m_data["opi_measures_taken"]) == 1
    measure_id = m_data["opi_measures_taken"][0]["id"]
    assert m_data["opi_measures_taken"][0]["doc_number"] == "П-44/2026"

    # 5. Выборка модуля claim_module=opi в претензионно-исковой работе
    opi_board = api(specialist_a).get("/api/v1/accounts/", {"scope": "claims", "claim_module": "opi"})
    assert opi_board.status_code == 200, opi_board.content
    assert any(row["id"] == case.account_id for row in opi_board.json()["results"])

    removed_m = api(specialist_a).delete(f"/api/v1/claims/{case.pk}/opi-measures/{measure_id}/")
    assert removed_m.status_code == 200
    assert removed_m.json()["opi_measures_taken"] == []

    # 6. Акты ОПИ о невозможности взыскания с номером, датой и основанием
    act_resp = api(specialist_a).post(
        f"/api/v1/claims/{case.pk}/acts/",
        {
            "title": "Акт о невозможности взыскания",
            "act_number": "АКТ-01",
            "act_date": "2026-10-20",
            "reason": "п. 4 ч. 1 ст. 52 Закона об ИП — отсутствие имущества",
        },
        format="json",
    )
    assert act_resp.status_code == 200, act_resp.content
    acts = act_resp.json()["acts"]
    assert len(acts) == 1
    assert acts[0]["act_number"] == "АКТ-01"
    assert acts[0]["act_date"] == "2026-10-20"
    act_id = acts[0]["id"]

    del_act = api(specialist_a).delete(f"/api/v1/claims/{case.pk}/acts/{act_id}/")
    assert del_act.status_code == 200
    assert del_act.json()["acts_count"] == 0

