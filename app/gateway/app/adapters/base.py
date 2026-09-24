"""Каналы доставки: общий интерфейс адаптера (Strategy) над внешними системами (Adapter)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass(frozen=True)
class OutgoingMessage:
    channel: str
    recipient: str
    text: str
    subject: str = ""
    meta: dict = field(default_factory=dict)


@dataclass(frozen=True)
class DeliveryResult:
    delivered: bool
    provider_message_id: str = ""
    error: str = ""


class ChannelAdapter(ABC):
    """Новый канал = новый класс + регистрация в AdapterRegistry; существующий код не меняется."""

    channel: str

    @abstractmethod
    async def send(self, message: OutgoingMessage) -> DeliveryResult: ...
