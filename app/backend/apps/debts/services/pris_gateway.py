"""Вызов шлюза АИС ПРИС. Домен не знает, заглушка это или HTTP к 192.168.101.81."""

from __future__ import annotations

import logging

import httpx
from django.conf import settings

from apps.core.context import REQUEST_ID_HEADER, get_request_id
from apps.core.exceptions import GatewayUnavailable
from apps.debts.services.claims import ClaimBlocked

logger = logging.getLogger(__name__)

_transport: "PrisTransport | None" = None


class PrisTransport:
    def post(self, path: str, payload: dict) -> dict:
        raise NotImplementedError


class HttpPrisTransport(PrisTransport):
    def post(self, path: str, payload: dict) -> dict:
        return self._exchange("POST", path, payload)

    def get(self, path: str) -> dict:
        return self._exchange("GET", path, None)

    def _exchange(self, method: str, path: str, payload: dict | None) -> dict:
        url = settings.GATEWAY_URL.rstrip("/") + path
        headers = {REQUEST_ID_HEADER: get_request_id(), "X-Internal-Token": settings.INTERNAL_TOKEN}
        try:
            response = httpx.request(method, url, json=payload, headers=headers, timeout=60.0)
        except httpx.HTTPError as exc:
            logger.error("Шлюз ПРИС недоступен: %s", exc)
            raise GatewayUnavailable("Шлюз ПРИС недоступен") from exc
        if response.status_code >= 400:
            raise ClaimBlocked(_error_text(response))
        body = response.json()
        data = body.get("data", body)
        if not isinstance(data, dict):
            raise ClaimBlocked("Шлюз ПРИС вернул неожиданный ответ")
        return data


class RecordingPrisTransport(PrisTransport):
    """Тестовый канал: запоминает вызовы и отвечает как заглушка шлюза."""

    def __init__(self, mode: str = "stub", with_actions: bool = False):
        self.mode = mode
        self.with_actions = with_actions
        self.calls: list[tuple[str, dict]] = []

    def get(self, path: str) -> dict:
        self.calls.append((path, {}))
        if path.rstrip("/").endswith("/nsi"):
            return {
                "mode": self.mode,
                "items": [{
                    "type": "120",
                    "type_name": "ОРГАНЫ ПРИНУДИТЕЛЬНОГО ИСПОЛНЕНИЯ МИНИСТЕРСТВА ЮСТИЦИИ",
                    "content": {"code": "1", "data": [
                        {"code": 0, "lex1": "(пусто)", "code_sorting": 0},
                        {"code": 801, "lex1": "ГУПИ МИНИСТЕРСТВА ЮСТИЦИИ РЕСПУБЛИКИ БЕЛАРУСЬ", "code_sorting": 0},
                    ]},
                }],
            }
        raise ClaimBlocked("Шлюз ПРИС: неизвестный запрос")

    def post(self, path: str, payload: dict) -> dict:
        self.calls.append((path, payload))
        if path.endswith("claimant-info") or path.endswith("claimant-info-by-debt"):
            number = ""
            if isinstance(payload, dict):
                number = str(payload.get("p_proc_num") or "")
            return {
                "mode": self.mode,
                "items": [{
                    "p_ispdoc": [{"proc_num": number or "60118000051", "doc_num": "7"}],
                    "p_status": [{"status": "6", "actual": "1"}],
                    "p_ost": [{"req_sum": "211.24", "ost_sum": "200.00", "curr_code": "933"}],
                    "p_action": [{"measure": "арест"}] if self.with_actions else [],
                    "p_nachisl": [],
                    "p_repay": [{"p_pay_sum": "11.24"}],
                    "p_cred": [],
                    "p_debt": [],
                }],
            }
        cl_num = ""
        package = payload.get("package") if isinstance(payload, dict) else None
        if package:
            first = package[0]
            cl_num = str((first.get("identif") or {}).get("p_cl_num") or first.get("p_cl_num") or "")
        return {
            "mode": self.mode,
            "code": "1",
            "message": "",
            "tag": "",
            "data": [{
                "responseId": f"stub-{cl_num or 'debt'}",
                "processStatus": 1000,
                "processMessage": "Данные получены успешно!",
            }],
        }


def get_pris_transport() -> PrisTransport:
    return _transport or HttpPrisTransport()


def set_pris_transport(transport: PrisTransport | None) -> None:
    global _transport
    _transport = transport


def _error_text(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return f"Шлюз ПРИС вернул {response.status_code}"
    error = body.get("error") if isinstance(body, dict) else None
    if not isinstance(error, dict):
        return f"Шлюз ПРИС вернул {response.status_code}"
    message = str(error.get("message") or "Ошибка ПРИС")
    details = error.get("details")
    if details:
        message = f"{message}: {details}"
    return message[:500]
