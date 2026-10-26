"""Проверка адреса письма. В журнал адрес не пишется."""

from __future__ import annotations

import re

_ADDRESS = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$")


def address_problem(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return "Нет адреса e-mail"
    if len(text) > 250 or _ADDRESS.fullmatch(text) is None:
        return "Некорректный адрес e-mail"
    return ""
