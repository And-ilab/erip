from .base import *  # noqa: F401,F403

SECRET_KEY = "test-secret-key-that-is-long-enough-for-hs256-signing"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
INTERNAL_TOKEN = "test-internal-token"
GATEWAY_URL = "http://gateway.test"
