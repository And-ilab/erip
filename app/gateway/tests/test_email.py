"""Почта: заглушка не отправляет письмо, SMTP-клиент собирает то же письмо без отметки прочтения."""

import asyncio
from email.header import decode_header

import pytest
import smtplib

from app.adapters.base import OutgoingMessage
from app.adapters.email_smtp import SmtpClient, SmtpEmailAdapter
from app.adapters.registry import email_adapter
from app.core.config import Settings, get_settings
from app.core.errors import AdapterError


def test_email_status_stub_does_not_connect(client):
    data = client.get("/gw/v1/email/status").json()["data"]
    assert data["mode"] == "stub"
    assert data["places_mail"] is False
    assert data["connected"] is False
    assert "не отправляется" in data["detail"]


def test_bad_address_is_not_delivered(client, backend):
    payload = {
        "notification_id": 8,
        "channel": "email",
        "user_name": "Иван",
        "recipient": "не адрес",
        "subject": "Долг",
        "template_body": "Текст",
        "context": {},
    }
    delivery_id = client.post("/gw/v1/notifications", json=payload).json()["data"]["id"]
    log = client.get(f"/gw/v1/notifications/{delivery_id}").json()["data"]
    assert log["status"] == "failed"
    assert "адрес" in log["error"].lower() or "Некорректный" in log["error"] or "Нет адреса" in log["error"]
    callback = json_body(backend)
    assert callback["status"] == "failed"
    assert callback["external_call"] is False


def test_scheme_signature_replaces_the_default(client):
    payload = {
        "notification_id": 9,
        "channel": "email",
        "user_name": "Иван",
        "recipient": "ivan@example.com",
        "subject": "Долг",
        "template_body": "Сумма {amount}",
        "context": {"amount": "10.00"},
        "meta": {"signature": "С уважением, ЖЭС №1", "mail_from": "debt@zhes.by"},
    }
    delivery_id = client.post("/gw/v1/notifications", json=payload).json()["data"]["id"]
    text = client.get(f"/gw/v1/notifications/{delivery_id}").json()["data"]["text"]
    assert text.endswith("С уважением, ЖЭС №1")
    assert "Сумма 10.00" in text
    assert "ЖКУ" not in text


def test_smtp_client_sends_without_a_read_receipt(monkeypatch):
    sent = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            sent["host"] = (host, port)

        def ehlo(self):
            sent["ehlo"] = True

        def starttls(self):
            sent["tls"] = True

        def login(self, user, password):
            sent["login"] = (user, password)

        def send_message(self, message):
            sent["message"] = message

        def quit(self):
            sent["quit"] = True

        def close(self):
            sent["closed"] = True

    monkeypatch.setattr("app.adapters.email_smtp.smtplib.SMTP", FakeSMTP)
    settings = _smtp_settings()
    token = SmtpClient(settings).send(
        mail_from="debt@zhes.by", from_name="ЖЭС", recipient="ivan@example.com",
        subject="Долг", text="Текст письма",
    )
    message = sent["message"]
    assert token.startswith("smtp-")
    assert sent["host"] == ("mail.example", 587)
    assert sent["tls"] is True
    assert sent["login"] == ("mailbox", "secret")
    assert message["To"] == "ivan@example.com"
    sender = _decoded(message, "From")
    assert "ЖЭС" in sender and "debt@zhes.by" in sender
    assert _decoded(message, "Subject") == "Долг"
    assert "Disposition-Notification-To" not in message
    assert "Return-Receipt-To" not in message
    assert "Текст письма" in message.get_content()


def test_smtp_refusal_is_undelivered_without_the_address(monkeypatch):
    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            return None

        def ehlo(self):
            return None

        def starttls(self):
            return None

        def login(self, user, password):
            return None

        def send_message(self, message):
            raise smtplib.SMTPRecipientsRefused({"ivan@example.com": (550, b"User unknown")})

        def quit(self):
            return None

        def close(self):
            return None

    monkeypatch.setattr("app.adapters.email_smtp.smtplib.SMTP", FakeSMTP)
    result = asyncio.run(SmtpEmailAdapter(_smtp_settings()).send(_letter()))
    assert result.delivered is False
    assert result.external_call is True
    assert "550" in result.error
    assert "ivan@" not in result.error


def test_smtp_outage_is_an_adapter_error():
    class Down(SmtpClient):
        def send(self, **kwargs):
            raise OSError("connection refused")

    settings = _smtp_settings()
    with pytest.raises(AdapterError, match="connection refused"):
        asyncio.run(SmtpEmailAdapter(settings, Down(settings)).send(_letter()))


def test_smtp_without_sender_or_host_does_not_call_the_server():
    settings = _smtp_settings()
    with pytest.raises(AdapterError, match="отправитель"):
        asyncio.run(SmtpEmailAdapter(settings).send(_letter(mail_from="")))
    bare = Settings(email_mode="smtp", smtp_host="", smtp_username="", smtp_password="")
    with pytest.raises(AdapterError, match="GW_SMTP_HOST"):
        asyncio.run(SmtpEmailAdapter(bare).send(_letter()))


def test_email_mode_selects_the_smtp_client(monkeypatch):
    monkeypatch.setenv("GW_EMAIL_MODE", "smtp")
    get_settings.cache_clear()
    try:
        assert email_adapter(get_settings()).__class__.__name__ == "SmtpEmailAdapter"
    finally:
        get_settings.cache_clear()


def test_prod_smtp_requires_a_host():
    settings = Settings(
        environment="prod", internal_token="prod-token-not-example", email_mode="smtp", smtp_host="",
    )
    with pytest.raises(RuntimeError, match="GW_SMTP_HOST"):
        settings.assert_prod()
    with pytest.raises(RuntimeError, match="GW_EMAIL_MODE"):
        Settings(email_mode="imap").assert_prod()


def _smtp_settings() -> Settings:
    return Settings(
        email_mode="smtp", smtp_host="mail.example", smtp_port=587,
        smtp_username="mailbox", smtp_password="secret", smtp_tls=True, smtp_ssl=False,
    )


def _letter(mail_from: str = "debt@zhes.by") -> OutgoingMessage:
    return OutgoingMessage(
        channel="email", recipient="ivan@example.com", text="Текст", subject="Долг",
        meta={"mail_from": mail_from, "mail_from_name": "ЖЭС"},
    )


def _decoded(message, name: str) -> str:
    parts = []
    for text, encoding in decode_header(str(message[name])):
        parts.append(text.decode(encoding or "utf-8") if isinstance(text, bytes) else text)
    return "".join(parts)


def json_body(backend):
    import json

    return json.loads(backend.by_path("/delivery-status/")[-1].content)
