"""Сроки схемы: ожидание шага сценария и дни после вручения предупреждения."""

from apps.nsi.models import CalculationSettings

WAIT_ACTIONS = ("call", "manual_call", "sms", "email", "warning", "disconnect", "writ", "lawsuit")


def warning_wait_for(organization) -> int:
    """Срок оплаты после предупреждения. Пустое поле схемы берёт общую настройку."""
    custom = getattr(organization, "warning_wait_days", None) if organization is not None else None
    if custom is not None:
        return int(custom)
    return CalculationSettings.load().warning_wait_days or 5


def step_wait_days(organization, step: dict) -> int:
    """Дни перед шагом. Схема перекрывает срок, записанный в самом шаге."""
    action = (step or {}).get("action") or ""
    waits = getattr(organization, "step_waits", None) or {}
    if action in waits and waits[action] not in (None, ""):
        return int(waits[action])
    return int((step or {}).get("wait_days") or 0)


def clean_step_waits(raw) -> dict[str, int]:
    if raw in (None, ""):
        return {}
    if not isinstance(raw, dict):
        raise ValueError("Сроки шагов — объект по действиям")
    cleaned: dict[str, int] = {}
    for key, value in raw.items():
        if key not in WAIT_ACTIONS:
            raise ValueError(f"Неизвестный шаг: {key}")
        if value in (None, ""):
            continue
        days = int(value)
        if days < 0 or days > 3650:
            raise ValueError("Срок шага — число дней от 0 до 3650")
        cleaned[str(key)] = days
    return cleaned
