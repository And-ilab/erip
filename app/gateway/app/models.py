"""Таблицы шлюза (схема gateway в PostgreSQL)."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Integer, MetaData, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .core.config import get_settings


class Base(DeclarativeBase):
    metadata = MetaData(schema=get_settings().db_schema)


def utcnow() -> datetime:
    return datetime.now(UTC)


class DeliveryLog(Base):
    """Журнал отправок: одна запись на оповещение, принятое шлюзом."""

    __tablename__ = "delivery_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    notification_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    channel: Mapped[str] = mapped_column(String(10))
    recipient: Mapped[str] = mapped_column(String(250), default="")
    user_name: Mapped[str] = mapped_column(String(250), default="")
    subject: Mapped[str] = mapped_column(String(250), default="")
    text: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="accepted")  # accepted | processing | delivered | failed
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    provider_message_id: Mapped[str] = mapped_column(String(100), default="")
    request_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
