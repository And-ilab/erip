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
        url = settings.GATEWAY_URL.rstrip("/") + path
        try:
            response = httpx.post(
                url,
                json=payload,
                headers={REQUEST_ID_HEADER: get_request_id(), "X-Internal-Token": settings.INTERNAL_TOKEN},
                timeout=60.0,
            )
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

    def __init__(self, mode: str = "stub"):
        self.mode = mode
        self.calls: list[tuple[str, dict]] = []

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
                    "p_action": [],
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
