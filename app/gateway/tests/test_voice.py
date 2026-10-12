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
    assert "+375291112233" not in caplog.text
    assert "Долг Иванов" not in caplog.text

    tail = client.post("/gw/v1/voice/dial", json={"phone": "+375291112200", "text": "текст"})
    assert tail.json()["data"]["status"] == "bad_number"
    assert tail.json()["data"]["error"] == "Неверный номер"
    assert client.post("/gw/v1/voice/dial", json={"phone": "+375291112201", "text": "текст"}).json()["data"]["status"] == "busy"
    assert client.post("/gw/v1/voice/dial", json={"phone": "+375291112202", "text": "текст"}).json()["data"]["status"] == "no_answer"
