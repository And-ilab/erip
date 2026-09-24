"""Зависимости FastAPI (DI): сервисы собираются из одиночек и настроек."""

from functools import lru_cache

from fastapi import Depends

from ..adapters.registry import AdapterRegistry, build_default_registry
from ..core.config import Settings, get_settings
from ..core.singletons import Database, HttpClient
from ..services.notification_service import NotificationService


@lru_cache
def get_registry() -> AdapterRegistry:
    return build_default_registry()


def get_notification_service(
    settings: Settings = Depends(get_settings),
    registry: AdapterRegistry = Depends(get_registry),
) -> NotificationService:
    return NotificationService(Database(), registry, HttpClient(), settings)
