"""Синхронный вызов голосового адаптера. Ответ возвращается в тот же запрос."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ...adapters.base import OutgoingMessage
from ...adapters.registry import AdapterRegistry
from ...core.errors import AdapterError
from ...decorators import api_response
from ..deps import get_registry, require_internal_token

router = APIRouter(prefix="/voice", tags=["Голос"], dependencies=[Depends(require_internal_token)])


class DialIn(BaseModel):
    phone: str = Field(min_length=1, max_length=250)
    text: str = Field(min_length=1)
    caller_id: str = Field(default="", max_length=30)
    record: bool = False
    transfer: bool = False


@router.post("/dial", summary="Инициировать звонок и вернуть исход в этом же ответе")
@api_response
async def dial(payload: DialIn, registry: AdapterRegistry = Depends(get_registry)):
    adapter = registry.get("voice")
    message = OutgoingMessage(
        channel="voice",
        recipient=payload.phone,
        text=payload.text,
        meta={
            "caller_id": payload.caller_id,
            "record": payload.record,
            "transfer": payload.transfer,
        },
    )
    try:
        result = await adapter.send(message)
    except AdapterError as exc:
        return {
            "status": "bad_number",
            "error": exc.message,
            "duration_sec": 0,
            "listen_percent": None,
            "provider_message_id": "",
            "external_call": False,
            "caller_id": payload.caller_id,
        }
    status = result.call_status or ("answered" if result.delivered else "no_answer")
    return {
        "status": status,
        "error": result.error,
        "duration_sec": result.duration_sec,
        "listen_percent": result.listen_percent,
        "provider_message_id": result.provider_message_id,
        "external_call": result.external_call,
        "caller_id": payload.caller_id,
    }
