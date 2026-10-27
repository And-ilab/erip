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

    # stub — пакет проверяется и не отправляется.
    # channel — тестовый канал: HttpPrisClient и встроенный стенд, контур Минюста не вызывается.
    # http — контур Минюста по pris_base_url после itVPN, user_id и ключа.
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

    # stub — письмо не уходит. smtp — SMTP заказчика, когда задан хост.
    email_mode: str = "stub"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    # STARTTLS на 587. Для порта 465 включите GW_SMTP_SSL и не ждите STARTTLS.
    smtp_tls: bool = True
    smtp_ssl: bool = False
    smtp_timeout: float = 30.0

    def smtp_missing(self) -> list[str]:
        missing = []
        if not self.smtp_host.strip():
            missing.append("GW_SMTP_HOST")
        if self.smtp_username.strip() and not self.smtp_password:
            missing.append("GW_SMTP_PASSWORD")
        return missing

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

    def channel_credentials(self) -> tuple[str, str]:
        """Пара стенда. Пустые user_id и ключ — учётная запись самого канала, не Минюста."""
        user = self.pris_user_id.strip()
        key = self.pris_access_key.strip()
        if not user and not key:
            return ("channel", "channel")
        return (user, key)

    def assert_prod(self) -> None:
        if self.voice_mode not in {"stub", "ami"}:
            raise RuntimeError("GW_VOICE_MODE должен быть stub или ami")
        if self.email_mode not in {"stub", "smtp"}:
            raise RuntimeError("GW_EMAIL_MODE должен быть stub или smtp")
        if self.pris_mode not in {"stub", "channel", "http"}:
            raise RuntimeError("GW_PRIS_MODE должен быть stub, channel или http")
        if self.environment != "prod":
            return
        if self.internal_token in {"", "change-me", "change-me-internal", "dev-internal-token", "dev"}:
            raise RuntimeError("GW_INTERNAL_TOKEN в prod не может быть заготовкой из примера")
        if self.voice_mode == "ami" and self.ami_missing():
            raise RuntimeError(
                "GW_VOICE_MODE=ami в prod требует хост, логин, секрет, контекст и шаблон канала AMI"
            )
        if self.email_mode == "smtp" and self.smtp_missing():
            raise RuntimeError("GW_EMAIL_MODE=smtp в prod требует GW_SMTP_HOST")
        if self.pris_mode == "channel":
            raise RuntimeError("GW_PRIS_MODE=channel — тестовый канал, в prod его не включают")
        if self.pris_mode == "http" and (not self.pris_user_id.strip() or not self.pris_access_key.strip()):
            raise RuntimeError("GW_PRIS_MODE=http в prod требует GW_PRIS_USER_ID и GW_PRIS_ACCESS_KEY")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.assert_prod()
    return settings
