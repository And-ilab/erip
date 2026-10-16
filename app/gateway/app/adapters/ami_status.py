"""Исход Originate/Hangup → статус карточки: дозвон, недозвон, занято, неверный номер.

Коды Reason — те, что Asterisk кладёт в OriginateResponse (0, 1, 4, 5, 8).
Cause — Q.850 из Hangup. Доля прослушивания и файл записи берутся только из
события, которое пришлёт диалплан; сами их не вычисляем.
"""

from __future__ import annotations

ANSWERED = "answered"
NO_ANSWER = "no_answer"
BUSY = "busy"
BAD_NUMBER = "bad_number"

DIAL_STATUS = {
    "ANSWER": (ANSWERED, ""),
    "BUSY": (BUSY, ""),
    "NOANSWER": (NO_ANSWER, ""),
    "CANCEL": (NO_ANSWER, ""),
    "CONGESTION": (NO_ANSWER, "Перегрузка линии"),
    "CHANUNAVAIL": (BAD_NUMBER, "Неверный номер"),
    "INVALIDARGS": (BAD_NUMBER, "Неверный номер"),
}

# Reason из OriginateResponse, как его отдаёт Asterisk.
ORIGINATE_REASON = {
    "0": (BAD_NUMBER, "Неверный номер"),
    "1": (NO_ANSWER, ""),
    "3": (NO_ANSWER, ""),
    "4": (ANSWERED, ""),
    "5": (BUSY, ""),
    "8": (NO_ANSWER, "Перегрузка линии"),
}

HANGUP_CAUSE = {
    "1": (BAD_NUMBER, "Неверный номер"),
    "17": (BUSY, ""),
    "18": (NO_ANSWER, ""),
    "19": (NO_ANSWER, ""),
    "21": (NO_ANSWER, ""),
    "22": (BAD_NUMBER, "Неверный номер"),
    "28": (BAD_NUMBER, "Неверный номер"),
    "34": (NO_ANSWER, "Перегрузка линии"),
    "38": (NO_ANSWER, "Перегрузка линии"),
    "42": (NO_ANSWER, "Перегрузка линии"),
    "102": (NO_ANSWER, ""),
    "16": (NO_ANSWER, ""),
}


def classify_originate(reason: str, dial_status: str = "") -> tuple[str, str] | None:
    dial = (dial_status or "").strip().upper()
    if dial:
        return DIAL_STATUS.get(dial, (NO_ANSWER, f"Исход AMI {dial_status}"))
    code = (reason or "").strip()
    if not code:
        return None
    return ORIGINATE_REASON.get(code, (NO_ANSWER, f"Исход AMI {code}"))


def classify_cause(cause: str) -> tuple[str, str]:
    code = (cause or "").strip()
    if not code:
        return NO_ANSWER, ""
    return HANGUP_CAUSE.get(code, (NO_ANSWER, f"Исход AMI {code}"))


def pick_int(message: dict, keys: tuple[str, ...]) -> int | None:
    for key in keys:
        raw = message.get(key)
        if raw in (None, ""):
            continue
        try:
            return max(0, int(float(raw)))
        except (TypeError, ValueError):
            continue
    return None


def pick_listen(message: dict) -> int | None:
    value = pick_int(message, ("ListenPercent", "Listen", "ERIP_LISTEN"))
    if value is None or value > 100:
        return None
    return value


def pick_recording(message: dict) -> str:
    for key in ("Recording", "ERIP_RECORDING", "RecordingFile"):
        raw = (message.get(key) or "").strip()
        if raw:
            return raw[:500]
    return ""
