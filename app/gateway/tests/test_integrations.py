"""Каркас интеграций: ПРИС (контракты, кэш токена) и БНП (манифест, критерий приёмки 5)."""

import copy

import httpx
import pytest

from app.core.config import Settings
from app.integrations.bnp.client import BnpValidationError, StubBnpClient, check_files
from app.integrations.bnp.schemas import BnpManifest
from app.integrations.pris.client import HttpPrisClient, InMemoryTokenCache, PrisError, StubPrisClient
from app.integrations.pris.schemas import ByProcNumRequest, SaveDataDebtRequest, SaveRepayRequest

MANIFEST = {
    "version": 1,
    "applications": [{
        "externalId": "IN-2026-0001",
        "contactData": "+375 17 000-00-00, юрист Иванова",
        "notificationE-mail": "legal@zhes.by, boss@zhes.by",
        "userMessage": "Прошу совершить исполнительную надпись",
        "serviceId": 572,
        "debtors": [{"personType": "natural", "personalId": "3230587H066PB5", "secondName": "Усков",
                     "firstName": "Юрий", "middleName": "Викторович"}],
        "debts": [{"startDate": "2025-01-01", "endDate": "2025-06-30", "amount": "211.24", "currency": "BYN",
                   "typeId": "dolg_9_3"}],
        "docs": [{"fileName": "zayavlenie.pdf", "signatureName": "zayavlenie.pdf.p7s", "docType": "application",
                  "detachedSign": True}],
    }],
}


def manifest_with(**changes):
    data = copy.deepcopy(MANIFEST)
    app = data["applications"][0]
    for path, value in changes.items():
        section, _, field = path.partition("__")
        target = app[section][0] if field else app
        target[field or section] = value
    return data


def test_bnp_validate_accepts_correct_manifest(client):
    response = client.post("/gw/v1/integrations/bnp/validate", json=MANIFEST)
    assert response.status_code == 200, response.json()
    assert response.json()["data"]["status"] == "validated"


def test_bnp_validate_rejects_long_personal_id(client):
    response = client.post("/gw/v1/integrations/bnp/validate",
                           json=manifest_with(debtors__personalId="3230587H066PB5X"))
    assert response.status_code == 422
    assert "personalId" in str(response.json()["error"]["details"])


@pytest.mark.parametrize("changes, fragment", [
    ({"debtors__personalId": "3230587h066pb5"}, "личный номер"),
    ({"debts__amount": "10,00"}, "10.00"),
    ({"debts__startDate": "01.01.2025"}, "YYYY-MM-DD"),
    ({"debts__typeId": "bank"}, "недопустимы"),
    ({"serviceId": 999}, "serviceId"),
    ({"docs__fileName": "scan.jpg"}, ".pdf"),
    ({"docs__docType": "photo"}, "тип документа"),
    ({"notificationE-mail": "not-an-email"}, "e-mail"),
    ({"debtors__middleName": None}, "middleName"),
])
def test_bnp_manifest_rules(changes, fragment):
    with pytest.raises(ValueError) as exc:
        BnpManifest.model_validate(manifest_with(**changes))
    assert fragment in str(exc.value)


def test_bnp_legal_debtor_and_date_at():
    data = manifest_with(debtors__personType="legal")
    data["applications"][0]["debtors"] = [{"personType": "legal", "unp": "101528843", "regNumber": "101528843",
                                           "regName": "ООО «Пример»"}]
    data["applications"][0]["debts"] = [{"dateAt": "2025-06-30", "amount": "5.00", "currency": "BYN",
                                         "description": "Долг по ЖКУ"}]
    assert BnpManifest.model_validate(data).applications[0].debtors[0].unp == "101528843"


async def test_bnp_files_limit():
    manifest = BnpManifest.model_validate(MANIFEST)
    with pytest.raises(BnpValidationError):
        check_files(manifest, {"zayavlenie.pdf": 16 * 1024 * 1024, "zayavlenie.pdf.p7s": 10})
    result = await StubBnpClient().submit(manifest, {"zayavlenie.pdf": 1000, "zayavlenie.pdf.p7s": 10})
    assert result.applications == 1


def test_bnp_dictionaries_endpoint(client):
    data = client.get("/gw/v1/integrations/bnp/dictionaries").json()["data"]
    assert any(s["service_id"] == 572 for s in data["services"])
    assert data["doc_types"]["executive_inscription"] == "Исполнительная надпись"


def test_pris_echo_and_claimant_info(client):
    assert "заглушка ПРИС" in client.get("/gw/v1/integrations/pris/echo").json()["data"]["result"]
    info = client.post("/gw/v1/integrations/pris/claimant-info", json={"p_proc_num": "60118000051"}).json()["data"]
    assert info[0]["p_ispdoc"][0]["proc_num"] == "60118000051"


SAVE_DATA = {"package": [{
    "identif": {"p_cl_num": "00020600034", "p_opi": "601", "p_solidar_num": ""},
    "debtor": {"p_d_country": "112", "p_d_surname": "Малачетыре", "p_d_first_name": "Четверик",
               "p_d_father_name": "Итестычтэры", "p_d_idf_num": "3070786A070PB0",
               "p_d_phones": [{"Phone": ""}], "p_r_req_init": "205",
               "p_arr_sum": [{"p_price": "211.24", "p_curr_code": "933", "p_rest_sum": "211.24"}]},
    "claimant": {"p_c_firm_name": "Унитарное предприятие", "p_c_reg_num": "101528843", "p_b_unp": "101528843"},
    "documents": [{"p_doc_code": "15", "p_doc_date": "09.12.2025", "p_doc_num": "124-2025", "p_doc_org_code": "6",
                   "p_doc_org": "нотариус", "p_doc_date_in": "09.12.2025",
                   "p_files": [{"file_body": "JVBERi0=", "file_ecp": "MII="}]}],
}]}


def test_pris_save_data_validation(client):
    ok = client.post("/gw/v1/integrations/pris/save-data-debt/validate", json=SAVE_DATA)
    assert ok.json()["data"]["code"] == "1"
    broken = copy.deepcopy(SAVE_DATA)
    broken["package"][0]["debtor"]["p_d_surname"] = ""
    assert client.post("/gw/v1/integrations/pris/save-data-debt/validate", json=broken).status_code == 422


def test_pris_repay_schema_accepts_regulation_casing():
    request = SaveRepayRequest.model_validate({"Package": [{"p_cl_num": "1", "p_status": "1", "p_req_init": "101",
                                                            "Repayment": [{"p_pay_date": "01.10.2020",
                                                                           "p_pay_num": "1", "p_pay_sum": "5.5"}]}]})
    assert request.package[0].repayment[0].p_pay_sum == "5.5"
    assert SaveDataDebtRequest.model_validate(SAVE_DATA).package[0].debtor.p_d_phones[0].phone == ""


async def test_stub_token_is_cached_for_ttl():
    now = [0.0]
    cache = InMemoryTokenCache(clock=lambda: now[0])
    client = StubPrisClient(Settings(), cache)
    await client.echo()
    await client.echo()
    assert client.authorize_calls == 1
    now[0] += 30 * 60  # токен живёт 30 минут
    await client.echo()
    assert client.authorize_calls == 2


async def test_http_pris_client_headers_and_errors():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path == "/core/auth/authorizate":
            assert request.headers["x-accesskey"] == "key"
            return httpx.Response(200, json={"x-token": "T", "x-timestamp": "04.12.2020 15:25:52", "message": "ok"})
        if request.url.path == "/core/bi/GetClaimantInfoByProcNum":
            assert request.headers["x-token"] == "T" and request.headers["x-user_id"] == "u1"
            return httpx.Response(200, json={"code": "1", "data": [{"p_status": [{"status": "6", "actual": "1"}]}],
                                             "message": "", "tag": ""})
        return httpx.Response(200, json={"code": "0", "data": [], "message": "Ошибка бизнес-логики", "tag": ""})

    settings = Settings(pris_base_url="http://pris.test", pris_user_id="u1", pris_access_key="key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = HttpPrisClient(settings, http)
        info = await client.get_by_proc_num(ByProcNumRequest(p_proc_num="1"))
        assert info[0].actual_status["status"] == "6"
        with pytest.raises(PrisError, match="Ошибка бизнес-логики"):
            await client.put_save_data_debt(SaveDataDebtRequest.model_validate(SAVE_DATA))
    assert sum(1 for c in calls if c.url.path == "/core/auth/authorizate") == 1


async def test_http_pris_authorize_rejected():
    handler = lambda r: httpx.Response(200, json={"response": "Внимание! Пользователь не найден!"})  # noqa: E731
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(PrisError, match="не найден"):
            await HttpPrisClient(Settings(pris_base_url="http://pris.test"), http).token()
