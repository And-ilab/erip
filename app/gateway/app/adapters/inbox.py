from .stub import StubAdapter


class InboxAdapter(StubAdapter):
    """Панель уведомлений ПМ: текст сохраняется в оповещении backend через callback, внешней системы нет."""

    channel = "inbox"
    system = "панель уведомлений ПМ"
