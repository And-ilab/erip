"""Проверки, без которых prod-настройки не должны поднимать процесс."""

from django.core.exceptions import ImproperlyConfigured

_INSECURE_SECRETS = {"", "change-me", "dev-insecure-key"}
_INSECURE_TOKENS = {"", "change-me", "change-me-internal", "dev-internal-token", "dev"}
_INSECURE_PASSWORDS = {"admin", "password", "change-me"}


def assert_production_safe(secret_key: str, internal_token: str, allowed_hosts: list[str], superuser_password: str) -> None:
    problems: list[str] = []
    if secret_key in _INSECURE_SECRETS or len(secret_key) < 32:
        problems.append("DJANGO_SECRET_KEY")
    if internal_token in _INSECURE_TOKENS:
        problems.append("INTERNAL_TOKEN")
    if not allowed_hosts or "*" in allowed_hosts:
        problems.append("DJANGO_ALLOWED_HOSTS")
    if superuser_password.strip().lower() in _INSECURE_PASSWORDS:
        problems.append("DJANGO_SUPERUSER_PASSWORD")
    if problems:
        raise ImproperlyConfigured("Прод не стартует с заготовками из примера: " + ", ".join(problems))
