"""Боевой почтовый адаптер: одно письмо через SMTP заказчика.

Отказ сервера по адресу — недоставка. Обрыв соединения — ошибка адаптера,
строка мероприятия закрывается с этой ошибкой. Позднее уведомление о недоставке
(DSN) этот клиент не читает: ящика для разбора возвратов заказчик не задал.
Заголовок прочтения не ставится.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
import uuid
from email.message import EmailMessage
from email.utils import formataddr

from ..core.config import Settings
from ..core.errors import AdapterError
from .base import ChannelAdapter, DeliveryResult, OutgoingMessage
from .email_address import address_problem

logger = logging.getLogger("gateway.adapters")


class SmtpEmailAdapter(ChannelAdapter):
    channel = "email"
    system = "SMTP"

    def __init__(self, settings: Settings, client: SmtpClient | None = None):
        self.settings = settings
        self.client = client or SmtpClient(settings)

    async def send(self, message: OutgoingMessage) -> DeliveryResult:
        if message.meta.get("fail"):
            raise AdapterError(f"{self.system}: имитация отказа доставки")
        problem = address_problem(message.recipient)
        if problem:
            return DeliveryResult(delivered=False, error=problem, external_call=False)
        mail_from = str(message.meta.get("mail_from") or "").strip()
        if address_problem(mail_from):
            raise AdapterError("У схемы не задан отправитель")
        missing = self.settings.smtp_missing()
        if missing:
            raise AdapterError("SMTP не настроен: " + ", ".join(missing))
        from_name = str(message.meta.get("mail_from_name") or "").strip()
        subject = (message.subject or "").strip() or "Уведомление"
        try:
            provider_id = await asyncio.to_thread(
                self.client.send,
                mail_from=mail_from,
                from_name=from_name,
                recipient=message.recipient.strip(),
                subject=subject,
                text=message.text or "",
            )
        except _Rejected as exc:
            return DeliveryResult(delivered=False, error=str(exc)[:500], external_call=True)
        except (smtplib.SMTPException, OSError, TimeoutError) as exc:
            raise AdapterError(f"SMTP: {exc}") from exc
        logger.info(
            "Письмо через SMTP",
            extra={"channel": self.channel, "chars": len(message.text or "")},
        )
        return DeliveryResult(delivered=True, provider_message_id=provider_id, external_call=True)


class _Rejected(Exception):
    """Сервер принял соединение и отказал в адресе. Это недоставка, не обрыв канала."""


class SmtpClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    def ping(self) -> None:
        smtp = self._open()
        try:
            smtp.noop()
        finally:
            self._close(smtp)

    def send(self, *, mail_from: str, from_name: str, recipient: str, subject: str, text: str) -> str:
        token = f"smtp-{uuid.uuid4().hex[:12]}"
        domain = mail_from.split("@", 1)[-1]
        msg = EmailMessage()
        msg["From"] = formataddr((from_name, mail_from)) if from_name else mail_from
        msg["To"] = recipient
        msg["Subject"] = subject
        msg["Message-ID"] = f"<{token}@{domain}>"
        msg.set_content(text)
        smtp = self._open()
        try:
            smtp.send_message(msg)
        except smtplib.SMTPRecipientsRefused as exc:
            raise _Rejected(_refused_text(exc)) from exc
        except (smtplib.SMTPSenderRefused, smtplib.SMTPDataError) as exc:
            raise _Rejected(str(exc)[:500] or "Сервер SMTP отклонил письмо") from exc
        finally:
            self._close(smtp)
        return token

    def _open(self) -> smtplib.SMTP:
        host = self.settings.smtp_host.strip()
        port = self.settings.smtp_port
        timeout = self.settings.smtp_timeout
        if self.settings.smtp_ssl:
            smtp: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=timeout)
        else:
            smtp = smtplib.SMTP(host, port, timeout=timeout)
            smtp.ehlo()
            if self.settings.smtp_tls:
                smtp.starttls()
                smtp.ehlo()
        username = self.settings.smtp_username.strip()
        if username:
            smtp.login(username, self.settings.smtp_password)
        return smtp

    @staticmethod
    def _close(smtp: smtplib.SMTP) -> None:
        try:
            smtp.quit()
        except (smtplib.SMTPException, OSError):
            try:
                smtp.close()
            except (smtplib.SMTPException, OSError):
                return


def _refused_text(exc: smtplib.SMTPRecipientsRefused) -> str:
    parts = []
    for info in exc.recipients.values():
        if isinstance(info, tuple) and len(info) >= 2:
            code, message = info[0], info[1]
            text = message.decode("utf-8", "replace") if isinstance(message, bytes) else str(message)
            parts.append(f"{code} {text}".strip())
        else:
            parts.append(str(info))
    return "; ".join(parts)[:500] or "Сервер SMTP отклонил получателя"
