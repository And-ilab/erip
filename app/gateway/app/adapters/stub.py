"""Общая заглушка канала: реальной отправки нет, сообщение пишется в лог.

meta.fail=true имитирует отказ внешней системы (для проверки обработки ошибок).
"""

import logging
import uuid

from ..core.errors import AdapterError
from .base import ChannelAdapter, DeliveryResult, OutgoingMessage

logger = logging.getLogger("gateway.adapters")


class StubAdapter(ChannelAdapter):
    channel = "stub"
    system = "заглушка"

    async def send(self, message: OutgoingMessage) -> DeliveryResult:
        if message.meta.get("fail"):
            raise AdapterError(f"{self.system}: имитация отказа доставки на {message.recipient or '—'}")
        logger.info(
            "Отправка через %s (заглушка)", self.system,
            extra={"channel": self.channel, "recipient": message.recipient, "chars": len(message.text)},
        )
        return DeliveryResult(delivered=True, provider_message_id=f"{self.channel}-{uuid.uuid4().hex[:12]}")
