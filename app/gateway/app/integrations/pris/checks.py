"""Сверка ответов АИС ПРИС с прогоном 3–4 ноября 2026.

Кнопки экрана «Настройка → Интеграции → АИС ПРИС» повторяют шаги методички,
которые тестовый контур уже закрыл. Ключ и x-token в ответ экрана не попадают.
Повтор пакета P-01 и погашений R-01/R-02 отсюда не уходит: они создают
или меняют задолженность.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from ...core.errors import NotFoundError
from .client import HttpPrisClient, PrisClient, PrisEndpoints, PrisError

_IP = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")
RECORDED_IP = "10.198.128.209"
RECORDED_VERSION = "1.2.9735.20103"
RECORDED_NSI_TYPES = (
    "120", "201", "202", "204", "207", "214", "215", "217",
    "222", "228", "243", "303", "308", "309", "321",
)

_STUB = "Запрос в контур Минюста не отправлялся."


@dataclass(frozen=True)
class _Step:
    code: str
    title: str
    request: str
    expected: str
    run: Callable[[HttpPrisClient], Awaitable[dict]]


def _result_text(body) -> str:
    if isinstance(body, dict) and "result" in body:
        return str(body.get("result") or "").strip()
    if isinstance(body, str):
        return body.strip()
    return ""


def _http_line(status: int, text: str) -> str:
    if status == 0:
        return text or "Нет соединения с контуром"
    return f"HTTP {status}. {text}".strip()


async def _authorize(client: HttpPrisClient) -> dict:
    row = await client.describe_session()
    keys = ", ".join(row["keys"]) if row["keys"] else "нет полей"
    message = row["message"]
    matched = (
        row["http_status"] == 200
        and row["token_present"]
        and bool(row["timestamp"])
        and "Добро пожаловать" in message
        and {"message", "x-timestamp", "x-token"} <= set(row["keys"])
    )
    summary = _http_line(
        row["http_status"],
        f"Поля: {keys}. Сообщение: «{message}». Метка времени: {row['timestamp'] or 'нет'}. "
        f"Токен {'есть' if row['token_present'] else 'не выдан'}.",
    )
    return {"http_status": row["http_status"], "matched": matched, "summary": summary}


async def _get_ip(client: HttpPrisClient) -> dict:
    raw = await client.exchange("GET", PrisEndpoints.GET_IP, timeout=20.0)
    value = _result_text(raw["body"])
    matched = raw["http_status"] == 200 and bool(_IP.fullmatch(value))
    note = ""
    if value and value != RECORDED_IP:
        note = f" В прогоне 03.11.2026 был {RECORDED_IP}."
    return {
        "http_status": raw["http_status"],
        "matched": matched,
        "summary": _http_line(raw["http_status"], f"result: {value or raw.get('error') or 'пусто'}.{note}"),
    }


async def _echo(client: HttpPrisClient) -> dict:
    raw = await client.exchange("GET", PrisEndpoints.ECHO, timeout=20.0)
    value = _result_text(raw["body"])
    matched = raw["http_status"] == 200 and value.startswith("Echo: Hello user!")
    return {
        "http_status": raw["http_status"],
        "matched": matched,
        "summary": _http_line(raw["http_status"], value or raw.get("error") or "пустой result"),
    }


async def _version(client: HttpPrisClient) -> dict:
    raw = await client.exchange("GET", PrisEndpoints.VERSION, timeout=20.0)
    value = _result_text(raw["body"])
    header = str((raw.get("headers") or {}).get("x-version") or "")
    matched = raw["http_status"] == 200 and bool(value) and value == header
    recorded = ""
    if value != RECORDED_VERSION or header != RECORDED_VERSION:
        recorded = f" В прогоне 03.11.2026 оба были {RECORDED_VERSION}."
    return {
        "http_status": raw["http_status"],
        "matched": matched,
        "summary": _http_line(
            raw["http_status"],
            f"result: {value or 'пусто'}. X-Version: {header or 'нет'}.{recorded}",
        ),
    }


async def _stat(client: HttpPrisClient) -> dict:
    raw = await client.exchange("GET", PrisEndpoints.GET_STAT, timeout=20.0)
    body = raw["body"]
    if isinstance(body, dict) and "result" in body:
        value = str(body.get("result") or "")
    elif isinstance(body, (dict, list)):
        value = json.dumps(body, ensure_ascii=False)
    else:
        value = _result_text(body)
    matched = raw["http_status"] == 200 and bool(value.strip())
    return {
        "http_status": raw["http_status"],
        "matched": matched,
        "summary": _http_line(raw["http_status"], (value or raw.get("error") or "пустой result")[:500]),
    }


def _nsi_shape(body) -> tuple[bool, str]:
    if isinstance(body, dict):
        brief = {
            "code": body.get("code"), "message": body.get("message"), "tag": body.get("tag"),
        }
        return False, json.dumps(brief, ensure_ascii=False)
    if not isinstance(body, list):
        return False, "ответ не массив справочников"
    codes: list[str] = []
    lines: list[str] = []
    named = True
    for row in body:
        if not isinstance(row, dict):
            named = False
            continue
        code = str(row.get("type") or "")
        name = str(row.get("type_name") or "").strip()
        if not code or not name:
            named = False
        codes.append(code)
        content = row.get("content")
        items = []
        if isinstance(content, dict) and isinstance(content.get("data"), list):
            items = content["data"]
        elif isinstance(content, list):
            items = content
        sample = ""
        if items and isinstance(items[0], dict):
            lex = items[0].get("lex1")
            sample = f", пример {items[0].get('code')}: {str(lex)[:40]}"
        lines.append(f"{code} {name} ({len(items)}{sample})")
    matched = named and len(codes) == len(RECORDED_NSI_TYPES) and set(codes) == set(RECORDED_NSI_TYPES)
    text = f"{len(body)} справочников. " + "; ".join(lines)
    return matched, text[:1500]


async def _nsi(client: HttpPrisClient) -> dict:
    raw = await client.post_authed(PrisEndpoints.NSI, b"{}", timeout=60.0)
    shape, text = _nsi_shape(raw["body"])
    return {
        "http_status": raw["http_status"],
        "matched": raw["http_status"] == 200 and shape,
        "summary": _http_line(raw["http_status"], text or raw.get("error") or "пустой ответ"),
    }


def _farewell(body) -> str:
    if not isinstance(body, dict):
        return ""
    for key in ("Response", "response", "message", "result"):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


async def _logout(client: HttpPrisClient) -> dict:
    token = await client.token()
    logout = await client.exchange(
        "POST", PrisEndpoints.LOGOUT, headers={"x-token": token.token}, timeout=20.0,
    )
    await client.cache.clear()
    stale = await client.exchange(
        "POST", PrisEndpoints.NSI,
        headers={
            "x-user_id": client.settings.pris_user_id,
            "x-token": token.token,
            "x-timestamp": token.timestamp,
            "Content-Type": "application/json",
        },
        body=b"{}",
        timeout=30.0,
    )
    fresh = await client.describe_session()
    farewell = _farewell(logout["body"])
    matched = (
        logout["http_status"] == 200
        and "Всего доброго" in farewell
        and stale["http_status"] == 401
        and fresh["http_status"] == 200
        and fresh["token_present"]
    )
    summary = (
        f"Выход: {_http_line(logout['http_status'], farewell or logout.get('error') or 'без текста')}. "
        f"Старый токен на GetNSIData: HTTP {stale['http_status']}. "
        f"Новый вход: HTTP {fresh['http_status']}, токен {'есть' if fresh['token_present'] else 'не выдан'}."
    )
    return {"http_status": logout["http_status"], "matched": matched, "summary": summary}


_DEBT_P04 = "FS-P04-04112026"
_DEBT_P01 = "FS-P01-04112026"
_PROC_P04 = "60126002755"
_PROC_P01 = "60126002757"
_DOC_P04 = "124-2025"
_DOC_P01 = "125-2026"
_RESPONSE_P04 = "84e22a7d-ee93-4871-b2d6-897414f905f5"
_PROC_CASES = (
    ("60126002755", "124-2025", True),
    ("70417878885", "15-407", False),
    ("10317888450", "7-945", True),
    ("60217763613", "6-1456", False),
)
_R03_BODY = json.dumps({
    "package": [{
        "p_cl_num": "FS-R03-04112026",
        "p_status": "2",
        "p_req_init": "205",
        "req_arr": [{"p_price": "211.24", "p_curr_code": "933", "p_rest_sum": "201.24"}],
        "repayment": [{
            "p_pay_date": "04.11.2026",
            "p_pay_num": "FS-R03-04112026",
            "p_pay_sum": "10.00",
            "p_pay_curr": "933",
        }],
    }],
}, ensure_ascii=False).encode()


def _nodes(body):
    pending = [body]
    while pending:
        node = pending.pop()
        if isinstance(node, dict):
            yield node
            pending.extend(node.values())
        elif isinstance(node, list):
            pending.extend(node)


def _code(body) -> str:
    if isinstance(body, dict) and body.get("code") is not None:
        return str(body["code"])
    return ""


def _field(body, key: str) -> str:
    for node in _nodes(body):
        value = node.get(key)
        if value not in (None, ""):
            return str(value)
    return ""


def _has(body, expected: dict[str, str]) -> bool:
    found = {key: False for key in expected}
    for node in _nodes(body):
        for key, value in expected.items():
            if str(node.get(key) if node.get(key) is not None else "") == value:
                found[key] = True
    return all(found.values())


def _debt_ok(raw: dict, expected: dict[str, str]) -> bool:
    return raw["http_status"] == 200 and _code(raw["body"]) == "1" and _has(raw["body"], expected)


def _debt_line(raw: dict, label: str) -> str:
    body = raw["body"]
    organ = _field(body, "doc_organ")
    tail = "" if organ else " Орган пустой."
    return (
        f"{label}: HTTP {raw['http_status']}, code {_code(body) or 'нет'}, "
        f"производство {_field(body, 'proc_num') or 'нет'}, "
        f"документ {_field(body, 'doc_num') or 'нет'}, "
        f"crednum {_field(body, 'crednum') or 'нет'}.{tail}"
    )


async def _by_debt(client: HttpPrisClient, body: dict) -> dict:
    payload = json.dumps(body, ensure_ascii=False).encode()
    return await client.post_authed(PrisEndpoints.BY_NUM_DEBT, payload, timeout=30.0)


async def _q02(client: HttpPrisClient) -> dict:
    lines: list[str] = []
    matched = True
    status = 200
    for cl_num, proc, doc in (
        (_DEBT_P04, _PROC_P04, _DOC_P04),
        (_DEBT_P01, _PROC_P01, _DOC_P01),
    ):
        raw = await _by_debt(client, {"p_cl_num": cl_num})
        matched = matched and _debt_ok(raw, {"proc_num": proc, "doc_num": doc, "crednum": cl_num})
        status = raw["http_status"] if status == 200 else status
        lines.append(_debt_line(raw, cl_num))
    return {"http_status": status, "matched": matched, "summary": " ".join(lines)}


async def _q03(client: HttpPrisClient) -> dict:
    raw = await _by_debt(client, {"p_cl_num": _DEBT_P04, "p_response_id": _RESPONSE_P04})
    matched = _debt_ok(raw, {"proc_num": _PROC_P04, "doc_num": _DOC_P04, "crednum": _DEBT_P04})
    return {
        "http_status": raw["http_status"],
        "matched": matched,
        "summary": _debt_line(raw, f"{_DEBT_P04} + responseId"),
    }


async def _q01(client: HttpPrisClient) -> dict:
    lines: list[str] = []
    matched = True
    status = 200
    for proc, doc, organ_required in _PROC_CASES:
        payload = json.dumps({"p_proc_num": proc}).encode()
        raw = await client.post_authed(PrisEndpoints.BY_PROC_NUM, payload, timeout=25.0)
        ok = _debt_ok(raw, {"proc_num": proc, "doc_num": doc})
        if organ_required and not _field(raw["body"], "doc_organ"):
            ok = False
        matched = matched and ok
        status = raw["http_status"] if status == 200 else status
        lines.append(_debt_line(raw, proc))
    return {"http_status": status, "matched": matched, "summary": " ".join(lines)}


async def _n01(client: HttpPrisClient) -> dict:
    raw = await client.exchange(
        "POST", PrisEndpoints.BY_NUM_DEBT,
        headers={"x-user_id": client.settings.pris_user_id, "Content-Type": "application/json"},
        body=json.dumps({"p_cl_num": _DEBT_P04}).encode(),
        timeout=30.0,
    )
    text = json.dumps(raw["body"], ensure_ascii=False) if raw["body"] is not None else (raw.get("error") or "")
    matched = raw["http_status"] in {400, 401} and "Отсутствуют требуемые параметры" in text
    return {
        "http_status": raw["http_status"],
        "matched": matched,
        "summary": _http_line(raw["http_status"], text[:300] or "пустой ответ"),
    }


async def _r03(client: HttpPrisClient) -> dict:
    raw = await client.post_authed(PrisEndpoints.SAVE_REPAY_DEBT, _R03_BODY, timeout=40.0)
    status = _field(raw["body"], "processStatus")
    message = _field(raw["body"], "processMessage")
    matched = (
        raw["http_status"] == 200
        and status == "1004"
        and "FS-R03-04112026" in message
        and "ОТСУТСТВУЕТ" in message.upper()
    )
    return {
        "http_status": raw["http_status"],
        "matched": matched,
        "summary": _http_line(
            raw["http_status"],
            f"processStatus {status or 'нет'}. {message or raw.get('error') or 'без текста'}",
        ),
    }


_STEPS = (
    _Step(
        "s06", "S-06 Authorizate", "POST /core/auth/authorizate",
        "HTTP 200. В ответе есть message, x-timestamp и x-token. Сообщение «Добро пожаловать!».",
        _authorize,
    ),
    _Step(
        "s01", "S-01 GetIP", "GET /core/service/GetIP",
        f"HTTP 200. result — адрес клиента. В прогоне 03.11.2026 это был {RECORDED_IP}.",
        _get_ip,
    ),
    _Step(
        "s02", "S-02 Echo", "GET /core/service/Echo",
        "HTTP 200. result начинается с «Echo: Hello user!».",
        _echo,
    ),
    _Step(
        "s03", "S-03 Version", "GET /core/service/Version",
        f"HTTP 200. Тело result и заголовок X-Version совпадают. В прогоне 03.11.2026 оба были {RECORDED_VERSION}.",
        _version,
    ),
    _Step(
        "s04", "S-04 GetStat", "GET /core/service/getstat",
        "HTTP 200. В теле есть непустой result, сокращённая метрика.",
        _stat,
    ),
    _Step(
        "s05", "S-05 GetNSIData", "POST /core/BI/NSI/GetNSIData",
        "HTTP 200. 15 справочников с type и type_name: "
        + ", ".join(RECORDED_NSI_TYPES) + ".",
        _nsi,
    ),
    _Step(
        "s07", "S-07 Logout", "POST /core/auth/logout",
        "HTTP 200 и текст «Всего доброго!». Повтор GetNSIData со старым токеном — HTTP 401. "
        "Новый вход снова выдаёт сессию.",
        _logout,
    ),
    _Step(
        "q02", "Q-02 GetClaimantInfoByNumDebt", "POST /core/bi/GetClaimantInfoByNumDebt",
        "HTTP 200, code «1». FS-P04-04112026 — производство 60126002755, документ 124-2025. "
        "FS-P01-04112026 — производство 60126002757, документ 125-2026.",
        _q02,
    ),
    _Step(
        "q03", "Q-03 и P-02 по responseId", "POST /core/bi/GetClaimantInfoByNumDebt",
        "HTTP 200, code «1». FS-P04-04112026 и responseId 84e22a7d-ee93-4871-b2d6-897414f905f5 "
        "возвращают производство 60126002755 и документ 124-2025.",
        _q03,
    ),
    _Step(
        "q01", "Q-01 GetClaimantInfoByProcNum", "POST /core/bi/GetClaimantInfoByProcNum",
        "HTTP 200, code «1». Производства 60126002755, 70417878885, 10317888450 и 60217763613 "
        "отдают документы 124-2025, 15-407, 7-945 и 6-1456. У 60126002755 и 10317888450 орган заполнен.",
        _q01,
    ),
    _Step(
        "n01", "N-01 запрос без токена", "POST /core/bi/GetClaimantInfoByNumDebt",
        "HTTP 400 или 401 и текст «Отсутствуют требуемые параметры в заголовке запроса!». "
        "Заголовок x-token не отправляется.",
        _n01,
    ),
    _Step(
        "r03", "R-03 неизвестный номер задолженности", "POST /core/BI/PutClaimantSaveRepayDebt",
        "HTTP 200, processStatus 1004, текст «ЗАДОЛЖЕННОСТЬ P_CL_NUM = FS-R03-04112026 ОТСУТСТВУЕТ».",
        _r03,
    ),
)
_BY_CODE = {step.code: step for step in _STEPS}


def known_steps() -> tuple[str, ...]:
    return tuple(step.code for step in _STEPS)


async def run_pris_check(step: str, client: PrisClient, settings) -> dict:
    spec = _BY_CODE.get((step or "").strip().lower())
    if spec is None:
        raise NotFoundError("Неизвестный проверочный запрос ПРИС")
    card = {
        "step": spec.code,
        "title": spec.title,
        "request": spec.request,
        "expected": spec.expected,
        "mode": settings.pris_mode,
        "ministry": settings.pris_mode == "http",
    }
    if not isinstance(client, HttpPrisClient):
        return {**card, "http_status": None, "matched": False, "summary": _STUB}
    try:
        outcome = await spec.run(client)
    except PrisError as exc:
        outcome = {"http_status": None, "matched": False, "summary": exc.message}
    return {**card, **outcome}
