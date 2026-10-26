"""Голосовой канал. Ответ — в том же запросе, набор делает выбранный адаптер.

По умолчанию адаптер — заглушка и на станцию не ходит. GW_VOICE_MODE=ami
подставляет клиент Asterisk AMI. Конверт полей один и тот же.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, model_validator

from ...adapters.ami_client import AmiClient, AmiError
from ...adapters.base import DeliveryResult, OutgoingMessage
from ...adapters.registry import AdapterRegistry
from ...core.config import Settings, get_settings
from ...decorators import api_response
from ..deps import get_registry, require_internal_token

router = APIRouter(prefix="/voice", tags=["Голос"], dependencies=[Depends(require_internal_token)])


class DialIn(BaseModel):
    phone: str = Field(min_length=1, max_length=250)
    text: str = Field(default="", max_length=4000)
    audio: str = Field(default="", max_length=500)
    caller_id: str = Field(default="", max_length=30)
    record: bool = False
    transfer: bool = False

    @model_validator(mode="after")
    def has_message(self):
        if not self.text.strip() and not self.audio.strip():
            raise ValueError("Нужен текст для TTS или ролик")
        return self


class CallIn(BaseModel):
    phone: str = Field(min_length=1, max_length=250)
    text: str = Field(default="", max_length=4000)
    audio: str = Field(default="", max_length=500)
    caller_id: str = Field(default="", max_length=30)


class BatchIn(BaseModel):
    text: str = Field(default="", max_length=4000)
    audio: str = Field(default="", max_length=500)
    caller_id: str = Field(default="", max_length=30)
    record: bool = False
    transfer: bool = False
    calls: list[CallIn] = Field(min_length=1, max_length=30)


def _message(phone: str, text: str, audio: str, caller_id: str, record: bool, transfer: bool) -> OutgoingMessage:
    return OutgoingMessage(
        channel="voice",
        recipient=phone,
        text=text,
        meta={
            "caller_id": caller_id,
            "record": record,
            "transfer": transfer,
            "audio": audio,
        },
    )


def _body(result: DeliveryResult, phone: str, caller_id: str) -> dict:
    status = result.call_status or ("answered" if result.delivered else "no_answer")
    return {
        "phone": phone,
        "status": status,
        "error": result.error,
        "duration_sec": result.duration_sec,
        "listen_percent": result.listen_percent,
        "provider_message_id": result.provider_message_id,
        "external_call": result.external_call,
        "caller_id": caller_id,
        "recording_ref": result.recording_ref,
    }


async def _dial_one(adapter, message: OutgoingMessage, caller_id: str) -> dict:
    result = await adapter.send(message)
    return _body(result, message.recipient, caller_id)


@router.get("/status", summary="Режим голосового канала и вход в AMI, без набора номера")
@api_response
async def voice_status(settings: Settings = Depends(get_settings)):
    missing = settings.ami_missing()
    places_calls = settings.voice_mode == "ami" and not missing
    connected = False
    detail = "Заглушка AMI: набор не выполняется"
    if settings.voice_mode == "ami" and missing:
        detail = "Режим ami, не задано: " + ", ".join(missing)
    elif places_calls:
        client = AmiClient(
            settings.ami_host.strip(),
            settings.ami_port,
            settings.ami_username,
            settings.ami_secret,
        )
        try:
            await client.ping()
            connected = True
            detail = "Вход в AMI выполнен"
        except AmiError as exc:
            detail = exc.message
    return {
        "mode": settings.voice_mode,
        "system": "Asterisk AMI",
        "places_calls": places_calls,
        "connected": connected,
        "missing": missing,
        "detail": detail,
    }


@router.post("/dial", summary="Один номер: текст TTS или ролик, исход в этом же ответе")
@api_response
async def dial(payload: DialIn, registry: AdapterRegistry = Depends(get_registry)):
    adapter = registry.get("voice")
    message = _message(
        payload.phone, payload.text, payload.audio, payload.caller_id, payload.record, payload.transfer,
    )
    return await _dial_one(adapter, message, payload.caller_id)


@router.post("/batch", summary="Список номеров и одно сообщение. До 30 номеров, набор по очереди")
@api_response
async def batch(payload: BatchIn, registry: AdapterRegistry = Depends(get_registry)):
    adapter = registry.get("voice")
    results = []
    for call in payload.calls:
        text = call.text or payload.text
        audio = call.audio or payload.audio
        caller_id = call.caller_id or payload.caller_id
        message = _message(call.phone, text, audio, caller_id, payload.record, payload.transfer)
        results.append(await _dial_one(adapter, message, caller_id))
    return {"results": results}
