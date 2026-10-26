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
    from ..core.config import get_settings

    settings = get_settings()
    from .inbox import InboxAdapter
    from .sms_stub import SmsStubAdapter

    registry = AdapterRegistry()
    for adapter in (InboxAdapter(), email_adapter(settings), SmsStubAdapter(), voice_adapter(settings)):
        registry.register(adapter)
    return registry


def email_adapter(settings):
    """stub остаётся, пока GW_EMAIL_MODE не smtp. Сценарий и карточка этого не знают."""
    if settings.email_mode == "smtp":
        from .email_smtp import SmtpEmailAdapter

        return SmtpEmailAdapter(settings)
    from .email_stub import EmailStubAdapter

    return EmailStubAdapter()


def voice_adapter(settings):
    """stub остаётся, пока GW_VOICE_MODE не ami. Сценарий и карточка этого не знают."""
    if settings.voice_mode == "ami":
        from .voice_ami import AmiVoiceAdapter

        return AmiVoiceAdapter(settings)
    from .voice_stub import VoiceStubAdapter

    return VoiceStubAdapter()
