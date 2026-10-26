"""Клиент Asterisk AMI на локальном сокете. Наружу звонков нет."""

import logging
import socket
import threading

import pytest

from app.adapters.ami_client import AmiClient, belarus_dial_number, channel_for
from app.adapters.ami_frames import encode_frame, parse_frame
from app.adapters.ami_status import classify_cause, classify_originate
from app.adapters.base import OutgoingMessage
from app.adapters.registry import AdapterRegistry, voice_adapter
from app.adapters.voice_ami import AmiVoiceAdapter
from app.api.deps import get_registry
from app.core.config import Settings, get_settings
from app.core.errors import AdapterError


def test_originate_reasons_and_hangup_causes():
    assert classify_originate("4") == ("answered", "")
    assert classify_originate("5") == ("busy", "")
    assert classify_originate("1") == ("no_answer", "")
    assert classify_originate("0") == ("bad_number", "Неверный номер")
    assert classify_originate("8")[0] == "no_answer"
    assert classify_originate("", "ANSWER") == ("answered", "")
    assert classify_originate("", "CHANUNAVAIL") == ("bad_number", "Неверный номер")
    assert classify_cause("17") == ("busy", "")
    assert classify_cause("16") == ("no_answer", "")
    assert belarus_dial_number("+49 151 123") == ""
    assert belarus_dial_number("375 29 111-22-33") == "+375291112233"
    assert channel_for("Local/{digits}@out", "+375291112233") == "Local/375291112233@out"


class AmiPeer:
    """Минимальная станция: баннер, Login и ответы, которые задаёт тест."""

    def __init__(self, respond):
        self.respond = respond
        self.raw: list[str] = []
        self.messages: list[dict] = []
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(1)
        self._sock.settimeout(5)
        self.port = self._sock.getsockname()[1]
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def _serve(self):
        try:
            conn, _ = self._sock.accept()
        except OSError:
            return
        with conn:
            conn.settimeout(5)
            conn.sendall(b"Asterisk Call Manager/2.10.0\r\n")
            buf = b""
            while True:
                try:
                    data = conn.recv(8192)
                except OSError:
                    break
                if not data:
                    break
                buf += data
                while b"\r\n\r\n" in buf:
                    raw, buf = buf.split(b"\r\n\r\n", 1)
                    text = raw.decode("utf-8", "replace")
                    self.raw.append(text)
                    message = parse_frame(text)
                    self.messages.append(message)
                    for reply in self.respond(message):
                        conn.sendall(encode_frame(list(reply.items())))
                    if message.get("Action") == "Logoff":
                        return

    def close(self):
        self._sock.close()
        self._thread.join(timeout=2)


def _settings(port: int) -> Settings:
    return Settings(
        voice_mode="ami",
        ami_host="127.0.0.1",
        ami_port=port,
        ami_username="erip",
        ami_secret="station-secret",
        ami_context="erip-autocall",
        ami_channel="Local/{digits}@outbound",
        ami_wait_sec=3,
        ami_timeout_ms=1000,
    )


def _message(phone="+375291112233", text="долг, пеня\nвторая", record=True):
    return OutgoingMessage(
        "voice", phone, text,
        meta={"caller_id": "+375172000001", "audio": "custom/debt", "record": record, "transfer": False},
    )


def _answered(message):
    action = message.get("Action")
    if action == "Login":
        if message.get("Secret") != "station-secret":
            return [{"Response": "Error", "Message": "Authentication failed"}]
        return [{"Response": "Success", "Message": "Authentication accepted"}]
    if action == "Logoff":
        return [{"Response": "Goodbye", "Message": "Thanks"}]
    if action != "Originate":
        return []
    action_id = message.get("ActionID", "")
    channel = message.get("Channel", "")
    unique = "171000.10"
    digits = channel.rsplit("/", 1)[-1].split("@", 1)[0]
    reason = {"00": "0", "01": "5", "02": "1", "08": "8"}.get(digits[-2:], "4")
    frames = [
        {"Response": "Success", "ActionID": action_id, "Message": "Originate successfully queued"},
    ]
    if reason == "4":
        frames.extend([
            {
                "Event": "OriginateResponse", "ActionID": action_id, "Response": "Success",
                "Reason": "4", "Uniqueid": unique, "Channel": channel,
            },
            {
                "Event": "UserEvent", "UserEvent": "ERIP", "Uniqueid": unique,
                "Billsec": "12", "ListenPercent": "70", "Recording": "https://pbx.example/rec/1.wav",
            },
            {"Event": "Hangup", "Uniqueid": unique, "Channel": channel, "Cause": "16"},
        ])
    else:
        frames.append({
            "Event": "OriginateResponse", "ActionID": action_id, "Response": "Failure",
            "Reason": reason, "Uniqueid": unique, "Channel": channel,
        })
    return frames


async def test_ami_originate_returns_the_station_outcome_without_logging_the_call(caplog):
    caplog.set_level(logging.INFO)
    peer = AmiPeer(_answered)
    try:
        result = await AmiVoiceAdapter(_settings(peer.port)).send(_message())
    finally:
        peer.close()
    assert result.external_call is True
    assert result.call_status == "answered"
    assert result.duration_sec == 12
    assert result.listen_percent == 70
    assert result.recording_ref == "https://pbx.example/rec/1.wav"
    assert result.provider_message_id == "ami-171000.10"
    originate = next(raw for raw in peer.raw if "Originate" in raw)
    assert "Variable: ERIP_TEXT=долг, пеня вторая" in originate
    assert "Variable: ERIP_AUDIO=custom/debt" in originate
    assert "Variable: ERIP_RECORD=1" in originate
    assert "Channel: Local/375291112233@outbound" in originate
    assert "долг, пеня\nвторая" not in originate
    assert "+375291112233" not in caplog.text
    assert "station-secret" not in caplog.text
    assert "долг, пеня" not in caplog.text


@pytest.mark.parametrize("phone,status,error", [
    ("+375291112200", "bad_number", "Неверный номер"),
    ("+375291112201", "busy", ""),
    ("+375291112202", "no_answer", ""),
    ("+375291112208", "no_answer", "Перегрузка линии"),
])
async def test_ami_failure_reasons(phone, status, error):
    peer = AmiPeer(_answered)
    try:
        result = await AmiVoiceAdapter(_settings(peer.port)).send(_message(phone, "текст", False))
    finally:
        peer.close()
    assert result.call_status == status
    assert result.error == error
    assert result.external_call is True
    assert result.duration_sec == 0
    assert result.listen_percent is None
    assert result.recording_ref == ""


async def test_foreign_number_does_not_open_a_socket():
    result = await AmiVoiceAdapter(_settings(1)).send(_message("+491511234567", "текст", False))
    assert result.call_status == "bad_number"
    assert result.error == "Не номер +375"
    assert result.external_call is False
    assert result.provider_message_id == ""


async def test_missing_station_settings_are_not_a_bad_number():
    settings = _settings(1).model_copy(update={"ami_channel": ""})
    with pytest.raises(AdapterError) as caught:
        await AmiVoiceAdapter(settings).send(_message())
    assert "AMI не настроен" in caught.value.message
    assert "GW_AMI_CHANNEL" in caught.value.message


async def test_unreachable_station_is_not_a_bad_number():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    with pytest.raises(AdapterError) as caught:
        await AmiVoiceAdapter(_settings(port)).send(_message())
    assert "Нет соединения с AMI" in caught.value.message
    assert "Неверный номер" not in caught.value.message


async def test_ping_only_logs_in():
    peer = AmiPeer(_answered)
    try:
        await AmiClient("127.0.0.1", peer.port, "erip", "station-secret").ping()
    finally:
        peer.close()
    actions = [message.get("Action") for message in peer.messages]
    assert actions[0] == "Login"
    assert "Logoff" in actions
    assert "Originate" not in actions


def test_voice_mode_ami_registers_the_client(monkeypatch):
    monkeypatch.setenv("GW_VOICE_MODE", "ami")
    get_settings.cache_clear()
    try:
        assert voice_adapter(get_settings()).__class__.__name__ == "AmiVoiceAdapter"
    finally:
        get_settings.cache_clear()


def test_dial_http_uses_the_ami_adapter(client):
    peer = AmiPeer(_answered)
    registry = AdapterRegistry()
    registry.register(AmiVoiceAdapter(_settings(peer.port)))
    client.app.dependency_overrides[get_registry] = lambda: registry
    try:
        response = client.post(
            "/gw/v1/voice/dial",
            json={
                "phone": "+375291112233",
                "text": "Долг",
                "caller_id": "+375172000001",
                "record": True,
            },
        )
    finally:
        client.app.dependency_overrides.clear()
        peer.close()
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["status"] == "answered"
    assert data["external_call"] is True
    assert data["duration_sec"] == 12
    assert data["listen_percent"] == 70
    assert data["recording_ref"] == "https://pbx.example/rec/1.wav"
    assert data["provider_message_id"] == "ami-171000.10"
