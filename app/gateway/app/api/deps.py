"""Зависимости FastAPI (DI): сервисы собираются из одиночек и настроек."""

import hmac
from functools import lru_cache

from fastapi import Depends, Header

from ..adapters.registry import AdapterRegistry, build_default_registry
from ..core.config import Settings, get_settings
from ..core.errors import UnauthorizedError
from ..core.singletons import Database, HttpClient
from ..services.notification_service import NotificationService


@lru_cache
def get_registry() -> AdapterRegistry:
    return build_default_registry()


def require_internal_token(
    x_internal_token: str = Header(default=""),
    settings: Settings = Depends(get_settings),
) -> None:
    """Служебные вызовы backend → шлюз. Тот же секрет, что и у callback в обратную сторону."""
    if not x_internal_token or not hmac.compare_digest(x_internal_token, settings.internal_token):
        raise UnauthorizedError("Нужен заголовок X-Internal-Token")


def get_notification_service(
    settings: Settings = Depends(get_settings),
    registry: AdapterRegistry = Depends(get_registry),
) -> NotificationService:
    return NotificationService(Database(), registry, HttpClient(), settings)
