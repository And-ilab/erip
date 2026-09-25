"""Базовые настройки Django. Значения окружения читаются из переменных среды (.env)."""

import os
from datetime import timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def env_bool(name: str, default: bool = False) -> bool:
    return env(name, "1" if default else "0").lower() in {"1", "true", "yes", "on"}


SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-insecure-key")
DEBUG = env_bool("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS", "*").split(",")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "apps.core",
    "apps.users",
    "apps.audit",
    "apps.nsi",
    "apps.debts",
    "apps.imports",
    "apps.notifications",
]

MIDDLEWARE = [
    "apps.core.middleware.RequestIdMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.core.middleware.ErrorLoggingMiddleware",
]

MEDIA_ROOT = BASE_DIR / "media"
MEDIA_URL = "/media/"

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", "erip"),
        "USER": env("POSTGRES_USER", "erip"),
        "PASSWORD": env("POSTGRES_PASSWORD", "erip"),
        "HOST": env("POSTGRES_HOST", "localhost"),
        "PORT": env("POSTGRES_PORT", "5432"),
        # Пулом соединений управляет ORM: постоянные соединения + проверка живости.
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
    }
}

AUTH_USER_MODEL = "users.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "ru-ru"
TIME_ZONE = "Europe/Minsk"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
DATA_UPLOAD_MAX_MEMORY_SIZE = 50 * 1024 * 1024

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.core.authentication.ContextJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 50,
    # NGINX дописывает адрес клиента в конец X-Forwarded-For. Берём его, а не всю строку.
    "NUM_PROXIES": 1,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(hours=8),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "USER_AUTHENTICATION_RULE": "apps.users.auth.user_authentication_rule",
}

REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {"login": "10/minute", "refresh": "30/minute"}

# httpOnly-cookie с refresh. В проде Secure, локально по HTTP — нет.
AUTH_COOKIE_SECURE = env_bool("AUTH_COOKIE_SECURE", not DEBUG)
AUTH_COOKIE_NAME = "erip_refresh"

# ---------- Интеграция со шлюзом ----------
GATEWAY_URL = env("GATEWAY_URL", "http://localhost:8001")
GATEWAY_TIMEOUT = float(env("GATEWAY_TIMEOUT", "10"))
INTERNAL_TOKEN = env("INTERNAL_TOKEN", "dev-internal-token")
# Сроки хранения: raw выгрузок, журнал аудита, журнал ошибок. Чистит manage.py purge_retained.
RAW_RETENTION_DAYS = int(env("RAW_RETENTION_DAYS", "90"))
AUDIT_RETENTION_DAYS = int(env("AUDIT_RETENTION_DAYS", "365"))
ERROR_LOG_RETENTION_DAYS = int(env("ERROR_LOG_RETENTION_DAYS", "90"))
# Базовый URL, по которому шлюз вызывает backend (callback статуса доставки)
BACKEND_PUBLIC_URL = env("BACKEND_PUBLIC_URL", "http://backend:8000")

# ---------- Импорт выгрузок АИС ----------
AIS_SPEC_DIR = Path(env("AIS_SPEC_DIR", str(BASE_DIR.parent.parent / "Примеры данных")))

SERVICE_NAME = "backend"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"request_context": {"()": "apps.core.logging.RequestContextFilter"}},
    "formatters": {"json": {"()": "apps.core.logging.JsonFormatter"}},
    "handlers": {
        "stdout": {"class": "logging.StreamHandler", "formatter": "json", "filters": ["request_context"]},
    },
    "root": {"handlers": ["stdout"], "level": env("LOG_LEVEL", "INFO")},
    "loggers": {
        "django.request": {"handlers": ["stdout"], "level": "WARNING", "propagate": False},
    },
}
