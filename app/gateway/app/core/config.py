from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Настройки шлюза; переменные окружения с префиксом GW_."""

    model_config = SettingsConfigDict(env_prefix="GW_", env_file=".env", extra="ignore")

    service_name: str = "gateway"
    database_url: str = "sqlite+aiosqlite:///./gateway.db"
    # Схема PostgreSQL для таблиц шлюза; для SQLite — пусто
    db_schema: str | None = None
    backend_url: str = "http://localhost:8000"
    internal_token: str = "dev-internal-token"
    http_timeout: float = 10.0
    redis_url: str | None = None
    log_level: str = "INFO"

    # stub — заглушка (MVP); http — реальные вызовы по регламенту после получения доступа
    pris_mode: str = "stub"
    pris_base_url: str = "http://192.168.101.81:10116"
    pris_user_id: str = ""
    pris_access_key: str = ""
    # Время жизни токена ПРИС по регламенту — 30 минут
    pris_token_ttl_seconds: int = 30 * 60


@lru_cache
def get_settings() -> Settings:
    return Settings()
