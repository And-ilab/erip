"""Каталог интеграций для экрана настроек."""

import httpx
import pytest

from apps.nsi.services import integrations as catalog


@pytest.fixture
def gateway_ok(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/email/status"):
            return httpx.Response(200, json={"data": {
                "mode": "stub", "system": "SMTP", "places_mail": False,
                "connected": False, "missing": [], "detail": "Заглушка SMTP",
            }})
        if path.endswith("/voice/status"):
            return httpx.Response(200, json={"data": {
                "mode": "stub", "system": "Asterisk AMI", "places_calls": False,
                "connected": False, "missing": [], "detail": "Заглушка AMI",
            }})
        if path.endswith("/pris/status"):
            return httpx.Response(200, json={"data": {
                "mode": "stub", "system": "АИС ПРИС", "sends": False,
                "ministry": False, "tunnel": False, "detail": "заглушка ПРИС",
            }})
        return httpx.Response(404, json={"detail": "нет"})

    transport = httpx.MockTransport(handler)
    real_get = httpx.get

    def fake_get(url, **kwargs):
        with httpx.Client(transport=transport) as client:
            return client.get(url, headers=kwargs.get("headers"))

    monkeypatch.setattr(httpx, "get", fake_get)
    yield
    monkeypatch.setattr(httpx, "get", real_get)


def test_catalog_lists_known_channels(gateway_ok, api, admin_a):
    response = api(admin_a).get("/api/v1/integrations/")
    assert response.status_code == 200
    codes = [row["code"] for row in response.json()["results"]]
    assert codes == [item.code for item in catalog.INTEGRATIONS]
    smtp = next(row for row in response.json()["results"] if row["code"] == "smtp")
    assert smtp["settings"] == "mail"
    assert smtp["status"]["mode"] == "stub"


def test_integration_detail_and_unknown(gateway_ok, api, admin_a):
    ok = api(admin_a).get("/api/v1/integrations/smtp/")
    assert ok.status_code == 200
    assert ok.json()["title"] == "SMTP"
    missing = api(admin_a).get("/api/v1/integrations/telegram/")
    assert missing.status_code == 404


def test_status_action(gateway_ok, api, admin_a):
    response = api(admin_a).get("/api/v1/integrations/pris/status/")
    assert response.status_code == 200
    assert response.json()["mode"] == "stub"
