"""Почта. Письмо уходит через оповещения, этот маршрут только показывает режим.

По умолчанию адаптер — заглушка и на сервер не ходит. GW_EMAIL_MODE=smtp
подставляет клиент SMTP. Конверт полей один и тот же.
"""

import asyncio

from fastapi import APIRouter, Depends

from ...adapters.email_smtp import SmtpClient
from ...core.config import Settings, get_settings
from ...decorators import api_response
from ..deps import require_internal_token

router = APIRouter(prefix="/email", tags=["Почта"], dependencies=[Depends(require_internal_token)])


@router.get("/status", summary="Режим почты и доступность SMTP, без отправки письма")
@api_response
async def email_status(settings: Settings = Depends(get_settings)):
    missing = settings.smtp_missing() if settings.email_mode == "smtp" else []
    places_mail = settings.email_mode == "smtp" and not missing
    connected = False
    detail = "Заглушка SMTP: письмо не отправляется"
    if settings.email_mode == "smtp" and missing:
        detail = "Режим smtp, не задано: " + ", ".join(missing)
    elif places_mail:
        try:
            await asyncio.to_thread(SmtpClient(settings).ping)
            connected = True
            detail = "Сервер SMTP ответил"
        except Exception as exc:  # noqa: BLE001 — статус не должен ронять шлюз
            detail = str(exc)[:300]
    return {
        "mode": settings.email_mode,
        "system": "SMTP",
        "places_mail": places_mail,
        "connected": connected,
        "missing": missing,
        "detail": detail,
    }
