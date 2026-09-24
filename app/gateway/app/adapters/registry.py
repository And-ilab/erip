from __future__ import annotations

from ..core.errors import GatewayError
from .base import ChannelAdapter


class UnknownChannel(GatewayError):
    code = "unknown_channel"


class AdapterRegistry:
    def __init__(self):
        self._adapters: dict[str, ChannelAdapter] = {}

    def register(self, adapter: ChannelAdapter) -> ChannelAdapter:
        self._adapters[adapter.channel] = adapter
        return adapter

    def get(self, channel: str) -> ChannelAdapter:
        try:
            return self._adapters[channel]
        except KeyError:
            raise UnknownChannel(f"Канал «{channel}» не поддерживается") from None

    @property
    def channels(self) -> list[str]:
        return sorted(self._adapters)


def build_default_registry() -> AdapterRegistry:
    from .email_stub import EmailStubAdapter
    from .inbox import InboxAdapter
    from .sms_stub import SmsStubAdapter
    from .voice_stub import VoiceStubAdapter

    registry = AdapterRegistry()
    for adapter in (InboxAdapter(), EmailStubAdapter(), SmsStubAdapter(), VoiceStubAdapter()):
        registry.register(adapter)
    return registry
