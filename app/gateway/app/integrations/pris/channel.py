"""Тестовый канал АИС ПРИС.

Стенд говорит на тех же путях, что регламент, и принимает тот же HttpPrisClient.
В контур Минюста запросы не уходят. Состояние живёт в памяти процесса шлюза:
перезапуск стенд очищает, карточка дела в ПМ хранит последний сохранённый ответ.
Номер производства начинается с CH- и не совпадает с примером регламента.
Справочник — тот же сокращённый пример 120, что у заглушки.
"""

from __future__ import annotations

import time
import uuid

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .client import PrisEndpoints, STUB_NSI

CHANNEL_BASE = "http://pris-channel"
CHANNEL_USER = "channel"
CHANNEL_KEY = "channel"
_VERSION = "channel"


class _ChannelState:
    def __init__(self) -> None:
        self.user = CHANNEL_USER
        self.key = CHANNEL_KEY
        self.tokens: dict[str, str] = {}
        self.debts: dict[str, dict] = {}
        self.by_proc: dict[str, str] = {}
        self.seq = 0

    def reset(self, user: str = CHANNEL_USER, key: str = CHANNEL_KEY) -> None:
        self.user = user
        self.key = key
        self.tokens.clear()
        self.debts.clear()
        self.by_proc.clear()
        self.seq = 0


state = _ChannelState()
_http: httpx.AsyncClient | None = None


def reset_channel(user: str = CHANNEL_USER, key: str = CHANNEL_KEY) -> None:
    state.reset(user, key)


def configure_channel(user: str, key: str) -> None:
    if state.user != user or state.key != key:
        state.reset(user, key)


def channel_http() -> httpx.AsyncClient:
    global _http
    if _http is None or _http.is_closed:
        _http = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=channel_app),
            base_url=CHANNEL_BASE,
            timeout=60.0,
        )
    return _http


async def close_channel_client() -> None:
    global _http
    if _http is not None and not _http.is_closed:
        await _http.aclose()
    _http = None


def proceeding_number(opi: str, cl_num: str) -> str:
    opi_part = "".join(ch for ch in opi if ch.isdigit())[:6] or "0"
    tail = "".join(ch for ch in cl_num if ch.isalnum())[-12:] or "0"
    return f"CH-{opi_part}-{tail}"[:50]


def _json(body, status: int = 200) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers={"X-Version": _VERSION})


def _authorized(request: Request) -> JSONResponse | None:
    token = request.headers.get("x-token", "")
    user = request.headers.get("x-user_id", "")
    stamp = request.headers.get("x-timestamp", "")
    if not token or not user or not stamp or user != state.user or state.tokens.get(token) != stamp:
        return _json({"message": "Не авторизован"}, 401)
    return None


async def _payload(request: Request) -> tuple[dict | None, JSONResponse | None]:
    denied = _authorized(request)
    if denied is not None:
        return None, denied
    try:
        body = await request.json()
    except Exception:
        return None, _json(
            {"code": "0", "data": [], "message": "Тело запроса не JSON", "tag": ""},
            400,
        )
    if not isinstance(body, dict):
        return None, _json(
            {"code": "0", "data": [], "message": "Тело запроса не объект", "tag": ""},
            400,
        )
    return body, None


async def authorize(request: Request) -> JSONResponse:
    user = request.headers.get("x-user_id", "")
    key = request.headers.get("x-accesskey", "")
    if not user or not key:
        return _json({
            "code": "0",
            "data": [],
            "message": "Отсутствуют требуемые параметры в заголовке запроса! (Система)",
            "tag": "Отсутствуют требуемые параметры в заголовке запроса! (Система)",
        })
    if user != state.user or key != state.key:
        return _json({"response": "Внимание! Пользователь не найден!"})
    state.seq += 1
    token = f"channel-token-{state.seq}"
    timestamp = time.strftime("%d.%m.%Y %H:%M:%S")
    state.tokens[token] = timestamp
    return _json({"x-token": token, "x-timestamp": timestamp, "message": "Добро пожаловать!"})


async def logout(request: Request) -> JSONResponse:
    token = request.headers.get("x-token", "")
    if token:
        state.tokens.pop(token, None)
    return _json({"Response": "Всего доброго!"})


async def echo(_: Request) -> JSONResponse:
    moment = time.strftime("%d.%m.%Y %H:%M:%S")
    return _json({"result": f"Echo: тестовый канал ПРИС. Время-дата сервера: {moment}"})


async def version(_: Request) -> JSONResponse:
    return _json({"result": "Версия API: channel"})


async def get_ip(_: Request) -> JSONResponse:
    return _json({"result": "channel"})


def _sums(debtor: dict) -> list[dict]:
    rows = []
    for row in debtor.get("p_arr_sum") or []:
        if not isinstance(row, dict):
            continue
        price = str(row.get("p_price") or "")
        rows.append({
            "req_sum": price,
            "ost_sum": str(row.get("p_rest_sum") or price),
            "curr_code": str(row.get("p_curr_code") or "933"),
        })
    return rows


def _remember(item: dict) -> dict:
    identif = item.get("identif") if isinstance(item.get("identif"), dict) else {}
    cl_num = str(identif.get("p_cl_num") or "").strip()
    opi = str(identif.get("p_opi") or "").strip()
    debtor = item.get("debtor") if isinstance(item.get("debtor"), dict) else {}
    documents = item.get("documents") if isinstance(item.get("documents"), list) else []
    document = documents[0] if documents and isinstance(documents[0], dict) else {}
    proc = proceeding_number(opi, cl_num)
    previous = state.by_proc.get(proc)
    if previous and previous != cl_num:
        proc = proceeding_number(opi, f"{cl_num}{state.seq}")
    record = {
        "cl_num": cl_num,
        "proc_num": proc,
        "opi": opi,
        "req_init": str(debtor.get("p_r_req_init") or ""),
        "document": {
            "p_doc_code": str(document.get("p_doc_code") or ""),
            "p_doc_num": str(document.get("p_doc_num") or ""),
            "p_doc_date": str(document.get("p_doc_date") or ""),
        },
        "sums": _sums(debtor),
        "repays": [],
        "accepted_at": time.strftime("%d.%m.%Y %H:%M:%S"),
        "response_id": str(uuid.uuid4()),
    }
    state.debts[cl_num] = record
    state.by_proc[proc] = cl_num
    return record


def _accepted(record: dict) -> dict:
    return {
        "responseId": record["response_id"],
        "processStatus": 1000,
        "processMessage": "Данные получены успешно!",
    }


def _info(record: dict) -> dict:
    document = record["document"]
    return {
        "p_ispdoc": [{
            "doc_name": document["p_doc_code"],
            "doc_num": document["p_doc_num"],
            "doc_date": document["p_doc_date"],
            "proc_num": record["proc_num"],
            "opi": record["opi"],
            "crednum": "",
            "req_init": record["req_init"],
        }],
        "p_ost": record["sums"],
        "p_status": [{
            "status": "канал",
            "date_status": record["accepted_at"],
            "reason": "тестовый канал шлюза",
            "actual": "1",
        }],
        "p_action": [],
        "p_nachisl": [],
        "p_repay": record["repays"],
        "p_cred": [],
        "p_debt": [],
    }


async def save_debt(request: Request) -> JSONResponse:
    body, error = await _payload(request)
    if error is not None:
        return error
    package = body.get("package")
    if not isinstance(package, list) or not package:
        return _json({
            "code": "0", "data": [], "message": "В пакете нет package", "tag": "",
        })
    saved = []
    for item in package:
        if not isinstance(item, dict):
            return _json({
                "code": "1",
                "data": [{
                    "responseId": str(uuid.uuid4()),
                    "processStatus": 1013,
                    "processMessage": "Не корректные данные",
                }],
                "message": "",
                "tag": "",
            })
        identif = item.get("identif") if isinstance(item.get("identif"), dict) else {}
        if not str(identif.get("p_cl_num") or "").strip():
            return _json({
                "code": "1",
                "data": [{
                    "responseId": str(uuid.uuid4()),
                    "processStatus": 1013,
                    "processMessage": "Не корректные данные",
                }],
                "message": "",
                "tag": "",
            })
        saved.append(_accepted(_remember(item)))
    return _json({"code": "1", "data": saved, "message": "", "tag": ""})


async def save_repay(request: Request) -> JSONResponse:
    body, error = await _payload(request)
    if error is not None:
        return error
    package = body.get("package") or body.get("Package")
    if not isinstance(package, list) or not package:
        return _json({"code": "0", "data": [], "message": "В пакете нет package", "tag": ""})
    results = []
    for item in package:
        if not isinstance(item, dict):
            results.append({
                "responseId": str(uuid.uuid4()),
                "processStatus": 1013,
                "processMessage": "Не корректные данные",
            })
            continue
        cl_num = str(item.get("p_cl_num") or "").strip()
        record = state.debts.get(cl_num)
        if record is None:
            results.append({
                "responseId": str(uuid.uuid4()),
                "processStatus": 1004,
                "processMessage": f"ЗАДОЛЖЕННОСТЬ P_CL_NUM = {cl_num} ОТСУТСТВУЕТ",
            })
            continue
        req_arr = item.get("req_arr") or []
        if isinstance(req_arr, list) and req_arr:
            record["sums"] = _sums({"p_arr_sum": req_arr})
        payments = item.get("repayment") or item.get("Repayment") or []
        if isinstance(payments, list):
            record["repays"] = [
                {
                    "p_pay_date": str(row.get("p_pay_date") or ""),
                    "p_pay_num": str(row.get("p_pay_num") or ""),
                    "p_pay_sum": str(row.get("p_pay_sum") or ""),
                    "p_pay_curr": str(row.get("p_pay_curr") or "933"),
                }
                for row in payments
                if isinstance(row, dict)
            ]
        record["response_id"] = str(uuid.uuid4())
        results.append(_accepted(record))
    return _json({"code": "1", "data": results, "message": "", "tag": ""})


async def by_proc(request: Request) -> JSONResponse:
    body, error = await _payload(request)
    if error is not None:
        return error
    proc = str(body.get("p_proc_num") or "").strip()
    cl_num = state.by_proc.get(proc)
    record = state.debts.get(cl_num) if cl_num else None
    data = [_info(record)] if record else []
    return _json({"code": "1", "data": data, "message": "", "tag": ""})


async def by_debt(request: Request) -> JSONResponse:
    body, error = await _payload(request)
    if error is not None:
        return error
    cl_num = str(body.get("p_cl_num") or "").strip()
    proc = str(body.get("p_proc_num") or "").strip()
    record = state.debts.get(cl_num) if cl_num else None
    if record is None and proc:
        linked = state.by_proc.get(proc)
        record = state.debts.get(linked) if linked else None
    data = [_info(record)] if record else []
    return _json({"code": "1", "data": data, "message": "", "tag": ""})


async def nsi(request: Request) -> JSONResponse:
    denied = _authorized(request)
    if denied is not None:
        return denied
    return _json(list(STUB_NSI))


channel_app = Starlette(routes=[
    Route(PrisEndpoints.AUTHORIZE, authorize, methods=["POST"]),
    Route(PrisEndpoints.LOGOUT, logout, methods=["POST"]),
    Route(PrisEndpoints.ECHO, echo, methods=["GET"]),
    Route(PrisEndpoints.VERSION, version, methods=["GET"]),
    Route(PrisEndpoints.GET_IP, get_ip, methods=["GET"]),
    Route(PrisEndpoints.BY_PROC_NUM, by_proc, methods=["POST"]),
    Route(PrisEndpoints.BY_NUM_DEBT, by_debt, methods=["POST"]),
    Route(PrisEndpoints.SAVE_DATA_DEBT, save_debt, methods=["POST"]),
    Route(PrisEndpoints.SAVE_DATA_DEBT_WOFE, save_debt, methods=["POST"]),
    Route(PrisEndpoints.SAVE_REPAY_DEBT, save_repay, methods=["POST"]),
    Route(PrisEndpoints.NSI, nsi, methods=["POST"]),
])
