"""Адрес клиента за одним доверенным прокси (NGINX)."""

from rest_framework.throttling import BaseThrottle


def client_ip(request) -> str | None:
    """Тот же адрес, что у лимита запросов: последний элемент X-Forwarded-For при NUM_PROXIES=1."""
    if request is None:
        return None
    ident = BaseThrottle().get_ident(request)
    if not ident or len(ident) > 45:
        return None
    return ident
