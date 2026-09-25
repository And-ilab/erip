from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Настройки шлюза; переменные окружения с префиксом GW_."""

    model_config = SettingsConfigDict(env_prefix="GW_", env_file=".env", extra="ignore")

    service_name: str = "gateway"
    # dev — локальный запуск; prod — отказ стартовать с токеном из примера и без публичной документации
    environment: str = "dev"
    database_url: str = "sqlite+aiosqlite:///./gateway.db"
    # Схема PostgreSQL для таблиц шлюза; для SQLite — пусто
    db_schema: str | None = None
    backend_url: str = "http://localhost:8000"
    internal_token: str = "dev-internal-token"
    http_timeout: float = 10.0
    redis_url: str | None = None
    log_level: str = "INFO"
    # Завершённые записи delivery_log старше этого срока удаляются при старте шлюза.
    log_retention_days: int = 90

    # stub — заглушка (MVP); http — реальные вызовы по регламенту после получения доступа
    pris_mode: str = "stub"
    pris_base_url: str = "http://192.168.101.81:10116"
    pris_user_id: str = ""
    pris_access_key: str = ""
    # Время жизни токена ПРИС по регламенту — 30 минут
    pris_token_ttl_seconds: int = 30 * 60

    def assert_prod(self) -> None:
        if self.environment != "prod":
            return
        if self.internal_token in {"", "change-me", "change-me-internal", "dev-internal-token", "dev"}:
            raise RuntimeError("GW_INTERNAL_TOKEN в prod не может быть заготовкой из примера")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.assert_prod()
    return settings
