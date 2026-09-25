"""Критерии 3–4 на стороне шлюза: текст с приветствием, delivery_log, callback, отказ адаптера."""

import json

import pytest

from app.adapters.base import ChannelAdapter, DeliveryResult, OutgoingMessage
from app.adapters.registry import AdapterRegistry, UnknownChannel, build_default_registry
from app.core.singletons import Database, HttpClient, SingletonMeta
from app.decorators import api_response, with_greeting
from app.services.rendering import MessageRenderer

PAYLOAD = {
    "notification_id": 7,
    "channel": "email",
    "user_name": "Иван Иванович",
    "recipient": "ivan@example.com",
    "subject": "Задолженность",
    "template_body": "Задолженность по ЛС {account} составляет {amount} руб.",
    "context": {"account": "00001001", "amount": "150.00"},
    "callback_url": "http://backend.test/api/v1/notifications/7/delivery-status/",
}


def test_second_claim_does_not_take_the_delivery(client):
    import asyncio

    from app.core.config import get_settings
    from app.core.singletons import Database, HttpClient
    from app.schemas import NotificationIn
    from app.services.notification_service import NotificationService

    service = NotificationService(Database(), build_default_registry(), HttpClient(), get_settings())
    payload = NotificationIn.model_validate({key: value for key, value in PAYLOAD.items() if key != "callback_url"})

    async def claim_twice():
        log = await service.accept(payload, "rid-claim")
        return await service.claim(log.id), await service.claim(log.id)

    first, second = asyncio.run(claim_twice())
    assert first is True
    assert second is False


def test_accept_and_deliver(client, backend):
    response = client.post("/gw/v1/notifications", json=PAYLOAD, headers={"X-Request-ID": "rid-42"})
    assert response.status_code == 202
    body = response.json()
    assert body["meta"]["request_id"] == "rid-42" and "duration_ms" in body["meta"]
    delivery_id = body["data"]["id"]

    log = client.get(f"/gw/v1/notifications/{delivery_id}").json()["data"]
    assert log["status"] == "delivered"
    assert log["text"] == (
        "Добрый день, Иван Иванович!\n\nЗадолженность по ЛС 00001001 составляет 150.00 руб.\n\nС уважением, ЖКУ"
    )
    assert log["request_id"] == "rid-42"

    callback = backend.by_path("/delivery-status/")[0]
    assert callback.headers["X-Internal-Token"] == "test-internal"
    assert callback.headers["X-Request-ID"] == "rid-42"
    assert json.loads(callback.content) == {"status": "delivered", "error": "", "rendered_text": log["text"]}


def test_adapter_failure_reports_error_with_same_request_id(client, backend):
    payload = {**PAYLOAD, "meta": {"fail": True}}
    delivery_id = client.post("/gw/v1/notifications", json=payload, headers={"X-Request-ID": "rid-fail"}).json()[
        "data"]["id"]
    log = client.get(f"/gw/v1/notifications/{delivery_id}").json()["data"]
    assert log["status"] == "failed" and "имитация отказа" in log["error"]

    ingest = backend.by_path("/api/v1/audit/errors/ingest/")[0]
    error = json.loads(ingest.content)
    assert error["request_id"] == "rid-fail" and error["error_type"] == "AdapterError"
    assert error["service"] == "gateway"
    callback = json.loads(backend.by_path("/delivery-status/")[0].content)
    assert callback["status"] == "failed"


def test_unknown_channel_rejected(client):
    response = client.post("/gw/v1/notifications", json={**PAYLOAD, "channel": "telegram"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "unknown_channel"


def test_validation_error_format(client):
    response = client.post("/gw/v1/notifications", json={"channel": "email"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_preview_and_recent(client):
    response = client.post("/gw/v1/notifications/preview", json={
        "user_name": "Олег", "template_body": "Долг {amount}, ЛС {unknown}", "context": {"amount": "5.00"},
    })
    assert response.json()["data"]["text"] == "Добрый день, Олег!\n\nДолг 5.00, ЛС {unknown}\n\nС уважением, ЖКУ"
    client.post("/gw/v1/notifications", json={**PAYLOAD, "callback_url": None})
    assert len(client.get("/gw/v1/notifications").json()["data"]) == 1
    assert client.get("/gw/v1/notifications/missing").status_code == 404


def test_health(client):
    assert client.get("/gw/v1/health").json()["data"] == {"status": "ok"}


def test_missing_token_is_rejected(client):
    client.headers.pop("X-Internal-Token", None)
    response = client.post("/gw/v1/notifications", json=PAYLOAD)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_client_callback_url_is_ignored(client, backend):
    response = client.post("/gw/v1/notifications", json={**PAYLOAD, "callback_url": "http://evil.test/steal"})
    assert response.status_code == 202
    assert backend.by_path("/delivery-status/")
    assert all(request.url.host != "evil.test" for request in backend.requests)


def test_prod_rejects_example_token():
    from app.core.config import Settings

    settings = Settings(environment="prod", internal_token="change-me-internal")
    with pytest.raises(RuntimeError):
        settings.assert_prod()


def test_renderer_ignores_attribute_access():
    assert MessageRenderer().render_body("{fio.__class__.__mro__}", {"fio": "Иван"}) == "{fio.__class__.__mro__}"
    assert MessageRenderer().render_body("ЛС {account}", {"account": "0001"}) == "ЛС 0001"


async def test_with_greeting_decorator():
    @with_greeting(sign="С уважением, ЖЭС №1")
    async def body(*, user_name: str) -> str:
        return f"Тело для {user_name}"

    assert await body(user_name="Анна") == "Добрый день, Анна!\n\nТело для Анна\n\nС уважением, ЖЭС №1"
    assert body.__name__ == "body"


async def test_api_response_decorator_reraises():
    @api_response
    async def ok():
        return 1

    @api_response
    async def broken():
        raise RuntimeError("x")

    assert (await ok())["data"] == 1
    with pytest.raises(RuntimeError):
        await broken()


def test_renderer_handles_broken_braces():
    assert MessageRenderer().render_body("Скобка { не закрыта", {}) == "Скобка { не закрыта"


def test_singletons_are_unique():
    Database.reset_instance()
    HttpClient.reset_instance()
    assert Database() is Database()
    assert HttpClient() is HttpClient()
    assert isinstance(Database, SingletonMeta)
    Database.reset_instance()
    HttpClient.reset_instance()


async def test_registry_open_for_extension():
    class TelegramAdapter(ChannelAdapter):
        channel = "telegram"

        async def send(self, message: OutgoingMessage) -> DeliveryResult:
            return DeliveryResult(True, "tg-1")

    registry = build_default_registry()
    assert registry.channels == ["email", "inbox", "sms", "voice"]
    registry.register(TelegramAdapter())
    result = await registry.get("telegram").send(OutgoingMessage("telegram", "@x", "hi"))
    assert result.provider_message_id == "tg-1"
    with pytest.raises(UnknownChannel):
        AdapterRegistry().get("email")
