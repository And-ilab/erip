"""Боевой голосовой адаптер: один Originate и исход в том же вызове send().

Номер не из +375 на станцию не уходит. Недоступная станция — ошибка адаптера,
а не «неверный номер»: строка партии остаётся открытой и попадёт в следующий прогон.
"""

from __future__ import annotations

import logging

from ..core.config import Settings
from ..core.errors import AdapterError
from .ami_client import AmiClient, AmiError, belarus_dial_number, channel_for
from .ami_status import ANSWERED
from .base import ChannelAdapter, DeliveryResult, OutgoingMessage

logger = logging.getLogger("gateway.adapters")


class AmiVoiceAdapter(ChannelAdapter):
    channel = "voice"
    system = "Asterisk AMI"

    def __init__(self, settings: Settings):
        self.settings = settings

    async def send(self, message: OutgoingMessage) -> DeliveryResult:
        if message.meta.get("fail"):
            raise AdapterError(f"{self.system}: имитация отказа доставки")
        caller_id = str(message.meta.get("caller_id") or "")
        audio = str(message.meta.get("audio") or "")
        phone = belarus_dial_number(message.recipient)
        if not phone:
            return _rejected("bad_number", "Не номер +375")
        if not (message.text or "").strip() and not audio.strip():
            return _rejected("bad_number", "Пустой текст шаблона")
        missing = self.settings.ami_missing()
        if missing:
            raise AdapterError("AMI не настроен: " + ", ".join(missing))
        try:
            channel = channel_for(self.settings.ami_channel, phone)
        except AmiError as exc:
            raise AdapterError(exc.message) from exc
        client = AmiClient(
            self.settings.ami_host.strip(),
            self.settings.ami_port,
            self.settings.ami_username,
            self.settings.ami_secret,
        )
        try:
            await client.connect()
            await client.login()
            report = await client.originate(
                channel=channel,
                context=self.settings.ami_context.strip(),
                exten=self.settings.ami_exten.strip() or "s",
                priority=self.settings.ami_priority,
                caller_id=caller_id,
                text=message.text,
                audio=audio,
                record=bool(message.meta.get("record")),
                transfer=bool(message.meta.get("transfer")),
                timeout_ms=self.settings.ami_timeout_ms,
                wait_sec=float(self.settings.ami_wait_sec),
            )
        except AmiError as exc:
            raise AdapterError(exc.message) from exc
        finally:
            await client.close()
        logger.info(
            "Голосовой вызов через Asterisk AMI",
            extra={
                "channel": self.channel,
                "chars": len(message.text or ""),
                "has_audio": bool(audio.strip()),
                "record": bool(message.meta.get("record")),
                "transfer": bool(message.meta.get("transfer")),
                "status": report.status,
            },
        )
        return DeliveryResult(
            delivered=report.status == ANSWERED,
            provider_message_id=report.provider_message_id,
            error=report.error,
            call_status=report.status,
            duration_sec=report.duration_sec,
            listen_percent=report.listen_percent,
            external_call=True,
            recording_ref=report.recording_ref,
        )


def _rejected(status: str, error: str) -> DeliveryResult:
    return DeliveryResult(
        delivered=False,
        provider_message_id="",
        error=error,
        call_status=status,
        duration_sec=0,
        listen_percent=None,
        external_call=False,
        recording_ref="",
    )
