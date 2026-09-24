from .stub import StubAdapter


class VoiceStubAdapter(StubAdapter):
    """Будущий адаптер Asterisk AMI: originate + TTS (ТЗ 4.2.10.6)."""

    channel = "voice"
    system = "Asterisk AMI"
