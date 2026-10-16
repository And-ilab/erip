"""Заглушка AMI отвечает в том же запросе и не пишет номер в журнал шлюза."""

import logging

from app.adapters.voice_outcome import call_outcome


def test_stub_outcomes_cover_the_four_statuses():
    bad = call_outcome("+375291112200", "текст")
    busy = call_outcome("+375291112201", "текст")
    missed = call_outcome("+375291112202", "текст")
    answered = call_outcome("+375291112233", "Долг")
    foreign = call_outcome("+491511234567", "текст")
    empty = call_outcome("+375291112233", "  ")
    assert bad["status"] == "bad_number" and bad["error"] == "Неверный номер"
    assert busy["status"] == "busy"
    assert missed["status"] == "no_answer"
    assert answered["status"] == "answered"
    assert answered["duration_sec"] == 36 and answered["listen_percent"] == 72
    assert answered["external_call"] is False
    assert answered["provider_message_id"].startswith("voice-")
    assert foreign["error"] == "Не номер +375"
    assert empty["error"] == "Пустой текст шаблона"


def test_dial_returns_the_outcome_without_logging_the_number(client, caplog):
    caplog.set_level(logging.INFO)
    response = client.post(
        "/gw/v1/voice/dial",
        json={"phone": "+375291112233", "text": "Долг Иванов", "caller_id": "+375172000001"},
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["status"] == "answered"
    assert data["duration_sec"] == 36
    assert data["listen_percent"] == 72
    assert data["external_call"] is False
    assert data["provider_message_id"].startswith("voice-")
    assert data["caller_id"] == "+375172000001"
    assert data["phone"] == "+375291112233"
    assert data["recording_ref"] == ""
    assert "+375291112233" not in caplog.text
    assert "Долг Иванов" not in caplog.text

    tail = client.post("/gw/v1/voice/dial", json={"phone": "+375291112200", "text": "текст"})
    assert tail.json()["data"]["status"] == "bad_number"
    assert tail.json()["data"]["error"] == "Неверный номер"
    assert client.post("/gw/v1/voice/dial", json={"phone": "+375291112201", "text": "текст"}).json()["data"]["status"] == "busy"
    assert client.post("/gw/v1/voice/dial", json={"phone": "+375291112202", "text": "текст"}).json()["data"]["status"] == "no_answer"


def test_status_reports_the_stub_without_calling_a_station(client):
    response = client.get("/gw/v1/voice/status")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["mode"] == "stub"
    assert data["system"] == "Asterisk AMI"
    assert data["places_calls"] is False
    assert data["connected"] is False
    assert "Заглушка" in data["detail"]
    assert "GW_AMI_HOST" in data["missing"]


def test_audio_without_text_is_accepted_by_the_stub(client):
    response = client.post(
        "/gw/v1/voice/dial",
        json={"phone": "+375291112233", "audio": "custom/debt", "record": True},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["status"] == "answered"
    assert response.json()["data"]["external_call"] is False


def test_batch_returns_one_outcome_per_number(client):
    response = client.post(
        "/gw/v1/voice/batch",
        json={
            "text": "Долг",
            "caller_id": "+375172000001",
            "calls": [
                {"phone": "+375291110033"},
                {"phone": "+375291110000"},
                {"phone": "+375291110001"},
                {"phone": "+375291110002"},
                {"phone": "+491511234567"},
            ],
        },
    )
    assert response.status_code == 200, response.text
    statuses = [row["status"] for row in response.json()["data"]["results"]]
    assert statuses == ["answered", "bad_number", "busy", "no_answer", "bad_number"]
    assert response.json()["data"]["results"][4]["error"] == "Не номер +375"
    assert response.json()["data"]["results"][0]["caller_id"] == "+375172000001"


def test_dial_without_a_message_is_rejected(client):
    response = client.post("/gw/v1/voice/dial", json={"phone": "+375291112233"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_dial_without_the_internal_token_is_rejected(client):
    response = client.post(
        "/gw/v1/voice/dial",
        json={"phone": "+375291112233", "text": "текст"},
        headers={"X-Internal-Token": "no"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"
