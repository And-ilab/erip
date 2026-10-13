"""Заглушка Asterisk AMI. Номер и текст принимаются, набор не выполняется."""

import logging

from ..core.errors import AdapterError
from .base import DeliveryResult, OutgoingMessage
from .stub import StubAdapter
from .voice_outcome import call_outcome

logger = logging.getLogger("gateway.adapters")


class VoiceStubAdapter(StubAdapter):
    """Будущий адаптер Asterisk AMI: originate + TTS (ТЗ 4.2.10.6).

    Пока вместо станции отвечает эта заглушка. Поля ответа те же, что запишет боевой клиент.
    """

    channel = "voice"
    system = "Asterisk AMI"

    async def send(self, message: OutgoingMessage) -> DeliveryResult:
        if message.meta.get("fail"):
            raise AdapterError(f"{self.system}: имитация отказа доставки")
        # В журнал шлюза номер и текст не пишем: только факт, что набор не выполнялся.
        logger.info(
            "Голосовой вызов через заглушку AMI: набор не выполняется",
            extra={
                "channel": self.channel,
                "chars": len(message.text),
                "has_caller": bool(message.meta.get("caller_id")),
                "record": bool(message.meta.get("record")),
                "transfer": bool(message.meta.get("transfer")),
            },
        )
        outcome = call_outcome(message.recipient, message.text, str(message.meta.get("caller_id") or ""))
        return DeliveryResult(
            delivered=outcome["status"] == "answered",
            provider_message_id=outcome["provider_message_id"],
            error=outcome["error"],
            call_status=outcome["status"],
            duration_sec=outcome["duration_sec"],
            listen_percent=outcome["listen_percent"],
            external_call=False,
        )
