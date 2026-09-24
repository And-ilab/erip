from .base import *  # noqa: F401,F403
from .base import BASE_DIR, env

DEBUG = True

if env("POSTGRES_HOST") == "":
    # Локальный запуск без PostgreSQL
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}
