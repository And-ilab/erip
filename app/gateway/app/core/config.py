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

    # stub — набор не выполняется. ami — Asterisk AMI, когда заказчик дал доступ к станции.
    voice_mode: str = "stub"
    ami_host: str = ""
    ami_port: int = 5038
    ami_username: str = ""
    ami_secret: str = ""
    ami_context: str = ""
    ami_exten: str = "s"
    ami_priority: int = 1
    # Шаблон канала абонента: {phone} это +375..., {digits} это 375...
    ami_channel: str = ""
    ami_timeout_ms: int = 30000
    ami_wait_sec: int = 90

    def ami_missing(self) -> list[str]:
        missing = []
        if not self.ami_host.strip():
            missing.append("GW_AMI_HOST")
        if not self.ami_username.strip():
            missing.append("GW_AMI_USERNAME")
        if not self.ami_secret.strip():
            missing.append("GW_AMI_SECRET")
        if not self.ami_context.strip():
            missing.append("GW_AMI_CONTEXT")
        channel = self.ami_channel
        if "{phone}" not in channel and "{digits}" not in channel:
            missing.append("GW_AMI_CHANNEL")
        return missing

    def assert_prod(self) -> None:
        if self.voice_mode not in {"stub", "ami"}:
            raise RuntimeError("GW_VOICE_MODE должен быть stub или ami")
        if self.environment != "prod":
            return
        if self.internal_token in {"", "change-me", "change-me-internal", "dev-internal-token", "dev"}:
            raise RuntimeError("GW_INTERNAL_TOKEN в prod не может быть заготовкой из примера")
        if self.voice_mode == "ami" and self.ami_missing():
            raise RuntimeError(
                "GW_VOICE_MODE=ami в prod требует хост, логин, секрет, контекст и шаблон канала AMI"
            )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.assert_prod()
    return settings
