"""Ответ заглушки AMI. Боевой адаптер вернёт тот же набор полей в тот же вызов.

Номер и текст сюда приходят, набор не выполняется. Последние две цифры номера
задают устойчивый исход, чтобы прогон на стенде не зависел от случайности.
"""

from __future__ import annotations

import re
import uuid

ANSWERED = "answered"
NO_ANSWER = "no_answer"
BUSY = "busy"
BAD_NUMBER = "bad_number"


def call_outcome(phone: str, text: str, caller_id: str = "") -> dict:
    compact = re.sub(r"\D", "", phone or "")
    tail = compact[-2:] if len(compact) >= 2 else ""
    if not compact.startswith("375"):
        return _row(BAD_NUMBER, "Не номер +375", 0, None, caller_id)
    if not (text or "").strip():
        return _row(BAD_NUMBER, "Пустой текст шаблона", 0, None, caller_id)
    if tail == "00":
        return _row(BAD_NUMBER, "Неверный номер", 0, None, caller_id)
    if tail == "01":
        return _row(BUSY, "", 0, None, caller_id)
    if tail == "02":
        return _row(NO_ANSWER, "", 0, None, caller_id)
    return _row(ANSWERED, "", 36, 72, caller_id)


def _row(status: str, error: str, duration: int, listen: int | None, caller_id: str) -> dict:
    return {
        "status": status,
        "error": error,
        "duration_sec": duration,
        "listen_percent": listen,
        "provider_message_id": f"voice-{uuid.uuid4().hex[:12]}",
        "external_call": False,
        "caller_id": caller_id,
    }
