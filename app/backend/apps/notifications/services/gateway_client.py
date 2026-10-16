"""Клиент шлюза оповещений (FastAPI). Вызовы асинхронные (httpx.AsyncClient).

NotificationDispatcher зависит от абстракции GatewayClient: в проде — HttpGatewayClient,
в тестах — FakeGatewayClient; при выносе шлюза в отдельный процесс на Python меняется только реализация.
"""

from __future__ import annotations

import importlib.util
import logging
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from django.conf import settings

from apps.core.context import REQUEST_ID_HEADER, get_request_id
from apps.core.exceptions import GatewayUnavailable

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GatewayAccepted:
    id: str
    status: str


class GatewayClient(ABC):
    @abstractmethod
    async def send_notification(self, payload: dict) -> GatewayAccepted: ...

    @abstractmethod
    async def preview(self, payload: dict) -> str: ...

    @abstractmethod
    async def dial(self, payload: dict) -> dict: ...


class HttpGatewayClient(GatewayClient):
    def __init__(self, base_url: str, timeout: float = 10.0, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.transport = transport

    def _client(self, timeout: float | None = None) -> httpx.AsyncClient:
        # Клиент создаётся на вызов: async_to_sync может выполнять вызовы в разных event loop
        return httpx.AsyncClient(
            base_url=self.base_url, timeout=self.timeout if timeout is None else timeout, transport=self.transport,
            headers={REQUEST_ID_HEADER: get_request_id(), "X-Internal-Token": settings.INTERNAL_TOKEN},
        )

    async def _post(self, path: str, payload: dict, timeout: float | None = None) -> dict:
        try:
            async with self._client(timeout) as client:
                response = await client.post(path, json=payload)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as exc:
            logger.error("Шлюз вернул %s: %s", exc.response.status_code, exc.response.text[:500])
            raise GatewayUnavailable(f"Шлюз вернул ошибку {exc.response.status_code}") from exc
        except httpx.HTTPError as exc:
            logger.error("Шлюз недоступен: %s", exc)
            raise GatewayUnavailable() from exc

    async def send_notification(self, payload: dict) -> GatewayAccepted:
        body = await self._post("/gw/v1/notifications", payload)
        data = body.get("data", body)
        return GatewayAccepted(id=str(data["id"]), status=data.get("status", "accepted"))

    async def preview(self, payload: dict) -> str:
        body = await self._post("/gw/v1/notifications/preview", payload)
        return body.get("data", body)["text"]

    async def dial(self, payload: dict) -> dict:
        # AMI держит ответ до конца звонка, общий таймаут оповещений для этого короткий.
        body = await self._post("/gw/v1/voice/dial", payload, timeout=settings.GATEWAY_DIAL_TIMEOUT)
        return body.get("data", body)


@dataclass
class FakeGatewayClient(GatewayClient):
    """Тестовая реализация: запоминает отправки, может имитировать недоступность шлюза."""

    fail: bool = False
    sent: list[dict] = field(default_factory=list)

    async def send_notification(self, payload: dict) -> GatewayAccepted:
        if self.fail:
            raise GatewayUnavailable()
        self.sent.append(payload)
        return GatewayAccepted(id=f"fake-{len(self.sent)}", status="accepted")

    async def preview(self, payload: dict) -> str:
        if self.fail:
            raise GatewayUnavailable()
        return f"Добрый день, {payload.get('user_name')}!\n\n{payload.get('template_body')}\n\nС уважением, ЖКУ"

    async def dial(self, payload: dict) -> dict:
        """Тот же исход, что у VoiceStubAdapter: алгоритм живёт в адаптере шлюза."""
        if self.fail:
            raise GatewayUnavailable()
        outcome = _voice_outcome().call_outcome(
            payload.get("phone") or "",
            payload.get("text") or "",
            payload.get("caller_id") or "",
        )
        self.sent.append({"dial": payload, "outcome": outcome})
        return outcome


_voice_module = None


def _voice_outcome():
    """Загружает voice_outcome.py адаптера, не заводя второй расчёт исхода в Django."""
    global _voice_module
    if _voice_module is not None:
        return _voice_module
    path = Path(__file__).resolve().parents[4] / "gateway" / "app" / "adapters" / "voice_outcome.py"
    spec = importlib.util.spec_from_file_location("erip_voice_outcome", path)
    if spec is None or spec.loader is None:
        raise GatewayUnavailable("Нет заглушки голосового адаптера")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _voice_module = module
    return module


_client: GatewayClient | None = None
_lock = threading.Lock()


def get_gateway_client() -> GatewayClient:
    """Одиночка клиента шлюза на процесс."""
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                _client = HttpGatewayClient(settings.GATEWAY_URL, settings.GATEWAY_TIMEOUT)
    return _client


def set_gateway_client(client: GatewayClient | None) -> None:
    """Подмена клиента (тесты, альтернативный транспорт)."""
    global _client
    with _lock:
        _client = client
