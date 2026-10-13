"""Обезличенная выгрузка для тестов: четыре схемы, по четыре файла (ЛС, услуги, оплаты, регистрации)."""

from __future__ import annotations

import re
from pathlib import Path

ENTITY_ORDER = ("account", "service", "payment", "registration")
_PREFIXES = (
    ("Карточка ЛС", "account"),
    ("Услуги", "service"),
    ("Оплата", "payment"),
    ("Регистрация", "registration"),
)
_SCHEMA = re.compile(r"\b([A-Z]{2}\d{4})\b")
_SUFFIXES = {".csv", ".txt", ".xlsx", ".xlsm", ".xls"}


def classify(name: str) -> tuple[str, str] | None:
    schema = _SCHEMA.search(name)
    if schema is None:
        return None
    for prefix, entity in _PREFIXES:
        if name.startswith(prefix):
            return schema.group(1), entity
    return None


def sample_files(directory: Path) -> list[tuple[str, str, Path]]:
    found: list[tuple[str, str, Path]] = []
    if not directory.is_dir():
        return found
    order = {entity: index for index, entity in enumerate(ENTITY_ORDER)}
    for path in directory.iterdir():
        if not path.is_file() or path.suffix.lower() not in _SUFFIXES:
            continue
        parsed = classify(path.name)
        if parsed is not None:
            found.append((*parsed, path))
    return sorted(found, key=lambda item: (item[0], order[item[1]], item[2].name))
