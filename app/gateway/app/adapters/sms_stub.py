from .stub import StubAdapter


class SmsStubAdapter(StubAdapter):
    """Будущий адаптер SMS-шлюза (канал упомянут в ТЗ 4.2.3.3, интеграция не описана)."""

    channel = "sms"
    system = "SMS-шлюз"
