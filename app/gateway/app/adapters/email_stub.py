"""Заглушка SMTP. Адрес принимается, письмо не уходит."""

import logging
import uuid

from ..core.errors import AdapterError
from .base import DeliveryResult, OutgoingMessage
from .email_address import address_problem
from .stub import StubAdapter

logger = logging.getLogger("gateway.adapters")


class EmailStubAdapter(StubAdapter):
    """Почтовый адаптер, пока GW_EMAIL_MODE не smtp (ТЗ 4.2.10.7).

    Ответ тот же, что потом запишет боевой клиент: доставлено или ошибка,
    идентификатор, external_call=false. Отметки прочтения нет.
    """

    channel = "email"
    system = "SMTP"

    async def send(self, message: OutgoingMessage) -> DeliveryResult:
        if message.meta.get("fail"):
            raise AdapterError(f"{self.system}: имитация отказа доставки")
        problem = address_problem(message.recipient)
        if problem:
            logger.info(
                "Письмо через заглушку SMTP: адрес не принят, отправка не выполняется",
                extra={"channel": self.channel, "chars": len(message.text or "")},
            )
            return DeliveryResult(delivered=False, error=problem, external_call=False)
        logger.info(
            "Письмо через заглушку SMTP: отправка не выполняется",
            extra={"channel": self.channel, "chars": len(message.text or ""), "has_from": bool(message.meta.get("mail_from"))},
        )
        return DeliveryResult(
            delivered=True,
            provider_message_id=f"email-{uuid.uuid4().hex[:12]}",
            external_call=False,
        )
