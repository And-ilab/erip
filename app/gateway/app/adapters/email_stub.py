from .stub import StubAdapter


class EmailStubAdapter(StubAdapter):
    """Будущий адаптер SMTP Заказчика (ТЗ 4.2.10.7)."""

    channel = "email"
    system = "SMTP"
