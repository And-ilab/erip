"""Клиент шлюза оповещений (FastAPI). Вызовы асинхронные (httpx.AsyncClient).

NotificationDispatcher зависит от абстракции GatewayClient: в проде — HttpGatewayClient,
в тестах — FakeGatewayClient; при выносе шлюза в Go-микросервис меняется только реализация.
"""

from __future__ import annotations

import logging
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

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


class HttpGatewayClient(GatewayClient):
    def __init__(self, base_url: str, timeout: float = 10.0, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.transport = transport

    def _client(self) -> httpx.AsyncClient:
        # Клиент создаётся на вызов: async_to_sync может выполнять вызовы в разных event loop
        return httpx.AsyncClient(
            base_url=self.base_url, timeout=self.timeout, transport=self.transport,
            headers={REQUEST_ID_HEADER: get_request_id()},
        )

    async def _post(self, path: str, payload: dict) -> dict:
        try:
            async with self._client() as client:
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
