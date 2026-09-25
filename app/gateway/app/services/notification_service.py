"""Приём и доставка оповещений: journal delivery_log → адаптер канала → callback в backend."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import and_, delete, or_, select, update

from ..adapters.base import OutgoingMessage
from ..adapters.registry import AdapterRegistry
from ..core.config import Settings
from ..core.context import request_id_var
from ..core.errors import AdapterError, NotFoundError, report_error
from ..core.singletons import Database, HttpClient
from ..models import DeliveryLog, utcnow
from ..schemas import NotificationIn
from .rendering import MessageRenderer

logger = logging.getLogger(__name__)


class NotificationService:
    def __init__(self, db: Database, registry: AdapterRegistry, http: HttpClient, settings: Settings,
                 renderer: MessageRenderer | None = None):
        self.db = db
        self.registry = registry
        self.http = http
        self.settings = settings
        self.renderer = renderer or MessageRenderer()

    async def accept(self, payload: NotificationIn, request_id: str) -> DeliveryLog:
        self.registry.get(payload.channel)  # неизвестный канал — ошибка сразу, до постановки в работу
        async with self.db.session() as session:
            log = DeliveryLog(
                notification_id=payload.notification_id, channel=payload.channel, recipient=payload.recipient,
                user_name=payload.user_name, subject=payload.subject, request_id=request_id,
                payload=payload.model_dump(),
            )
            session.add(log)
            await session.commit()
            return log

    async def claim(self, log_id: str) -> bool:
        """Один процесс забирает запись: accepted → processing. Второй получает False и не шлёт повторно."""
        now = utcnow()
        stale = now - timedelta(minutes=2)
        async with self.db.session() as session:
            result = await session.execute(
                update(DeliveryLog)
                .where(
                    DeliveryLog.id == log_id,
                    DeliveryLog.finished_at.is_(None),
                    or_(
                        DeliveryLog.status == "accepted",
                        and_(
                            DeliveryLog.status == "processing",
                            or_(DeliveryLog.claimed_at.is_(None), DeliveryLog.claimed_at < stale),
                        ),
                    ),
                )
                .values(status="processing", claimed_at=now)
                .returning(DeliveryLog.id)
            )
            claimed = result.scalar_one_or_none()
            await session.commit()
            return claimed is not None

    async def process(self, log_id: str, payload: NotificationIn, request_id: str) -> None:
        """Фоновая доставка (BackgroundTasks): request_id передаётся явно, т.к. ответ уже отправлен."""
        if not await self.claim(log_id):
            logger.info("Доставка %s уже выполняется другим процессом", log_id)
            return
        request_id_var.set(request_id)
        text = await self.renderer.render(payload.template_body, payload.context, user_name=payload.user_name)
        adapter = self.registry.get(payload.channel)
        message = OutgoingMessage(payload.channel, payload.recipient, text, payload.subject, payload.meta)
        status, error, provider_id = "delivered", "", ""
        try:
            result = await adapter.send(message)
            provider_id = result.provider_message_id
            if not result.delivered:
                status, error = "failed", result.error or "Не доставлено"
        except AdapterError as exc:
            status, error = "failed", exc.message
            await report_error(exc, path=f"adapter:{payload.channel}")
        except Exception as exc:  # noqa: BLE001 — любая ошибка канала фиксируется, процесс не падает
            status, error = "failed", f"Внутренняя ошибка: {exc}"
            await report_error(exc, path=f"adapter:{payload.channel}")

        async with self.db.session() as session:
            log = await session.get(DeliveryLog, log_id)
            log.text, log.status, log.error = text, status, error
            log.provider_message_id, log.finished_at = provider_id, utcnow()
            await session.commit()
        logger.info("Оповещение %s: %s", payload.notification_id, status, extra={"delivery_id": log_id})
        await self._callback(payload, status, error, text, request_id)

    def callback_url(self, notification_id: int) -> str:
        """Адрес backend берётся только из настроек, не из тела запроса."""
        base = self.settings.backend_url.rstrip("/")
        return f"{base}/api/v1/notifications/{notification_id}/delivery-status/"

    async def resume_pending(self) -> None:
        """После рестарта дожимает принятые и зависшие (дольше 2 минут) доставки."""
        stale = utcnow() - timedelta(minutes=2)
        async with self.db.session() as session:
            rows = await session.execute(
                select(DeliveryLog).where(
                    DeliveryLog.finished_at.is_(None),
                    or_(
                        DeliveryLog.status == "accepted",
                        and_(
                            DeliveryLog.status == "processing",
                            or_(DeliveryLog.claimed_at.is_(None), DeliveryLog.claimed_at < stale),
                        ),
                    ),
                )
            )
            pending = list(rows.scalars())
        for log in pending:
            try:
                payload = NotificationIn.model_validate(log.payload)
            except Exception:  # noqa: BLE001 — битая запись не должна крутиться на каждом старте
                logger.warning("Пропущена доставка %s: payload не читается", log.id)
                continue
            await self.process(log.id, payload, log.request_id)

    async def purge_old(self, days: int = 90) -> None:
        """Удаляет завершённые журналы доставки старше срока. Незавершённые не трогает."""
        if days <= 0:
            return
        cutoff = utcnow() - timedelta(days=days)
        async with self.db.session() as session:
            await session.execute(
                delete(DeliveryLog).where(DeliveryLog.finished_at.is_not(None), DeliveryLog.finished_at < cutoff)
            )
            await session.commit()

    async def _callback(self, payload: NotificationIn, status: str, error: str, text: str, request_id: str) -> None:
        if payload.notification_id is None:
            return
        url = self.callback_url(payload.notification_id)
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                response = await self.http.client.post(
                    url,
                    json={"status": status, "error": error, "rendered_text": text},
                    headers={"X-Internal-Token": self.settings.internal_token, "X-Request-ID": request_id},
                )
                response.raise_for_status()
                return
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                await asyncio.sleep(0.05 * attempt)
        logger.warning("Callback в backend не выполнен: %s", last_error)

    async def get(self, log_id: str) -> DeliveryLog:
        async with self.db.session() as session:
            log = await session.get(DeliveryLog, log_id)
            if log is None:
                raise NotFoundError("Запись доставки не найдена")
            return log

    async def list_recent(self, limit: int = 50) -> list[DeliveryLog]:
        async with self.db.session() as session:
            rows = await session.execute(select(DeliveryLog).order_by(DeliveryLog.created_at.desc()).limit(limit))
            return list(rows.scalars())
