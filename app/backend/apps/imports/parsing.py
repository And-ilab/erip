"""Разбор CSV выгрузок АИС: кодировка, разделитель, заголовки с дублями, приведение типов."""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from .field_maps import EntityMap, FieldSpec

ENCODINGS = ("utf-8-sig", "cp1251")
DATE_FORMATS = ("%d.%m.%Y", "%Y-%m-%d", "%d.%m.%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d.%m.%y")
TRUE_VALUES = {"1", "true", "t", "y", "yes", "да", "д"}
PAYMENT_TYPES = {"файл": "file", "ввод вручную": "manual", "зачисление из зарплаты": "salary",
                 "file": "file", "manual": "manual", "salary": "salary"}


class ConversionError(ValueError):
    """Ошибка приведения значения колонки."""


def decode(content: bytes) -> tuple[str, str]:
    for encoding in ENCODINGS:
        try:
            return content.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ConversionError("Не удалось определить кодировку (ожидается UTF-8 или Windows-1251)")


def detect_delimiter(first_line: str) -> str:
    for delimiter in (";", "\t", ","):
        if delimiter in first_line:
            return delimiter
    return ";"


def read_rows(text: str) -> tuple[list[str], list[list[str]]]:
    first_line = text.split("\n", 1)[0]
    reader = csv.reader(io.StringIO(text), delimiter=detect_delimiter(first_line))
    rows = [row for row in reader if any(cell.strip() for cell in row)]
    if not rows:
        raise ConversionError("Файл пуст")
    return [h.strip() for h in rows[0]], rows[1:]


@dataclass
class ColumnBinding:
    index: int
    raw_key: str
    spec: FieldSpec | None


def bind_columns(headers: list[str], entity_map: EntityMap) -> tuple[list[ColumnBinding], list[str]]:
    """Сопоставляет позиции колонок файла со спецификацией с учётом повторяющихся имён."""
    by_header = entity_map.by_header()
    seen: dict[str, int] = {}
    bindings, unknown = [], []
    for index, header in enumerate(headers):
        occurrence = seen.get(header, 0)
        seen[header] = occurrence + 1
        raw_key = header if occurrence == 0 else f"{header}#{occurrence + 1}"
        candidates = by_header.get(header, [])
        spec = candidates[occurrence] if occurrence < len(candidates) else None
        if spec is None:
            unknown.append(raw_key)
        bindings.append(ColumnBinding(index, raw_key, spec))
    return bindings, unknown


def convert(value: str, kind: str):
    value = (value or "").strip()
    if value == "":
        return False if kind == "bool" else ("" if kind in {"str", "payment_type"} else None)
    try:
        if kind == "str":
            return value
        if kind in {"int", "months"}:
            return int(Decimal(value.replace(" ", "").replace(",", ".")))
        if kind == "dec":
            return Decimal(value.replace(" ", "").replace("\u00a0", "").replace(",", "."))
        if kind == "bool":
            return value.lower() in TRUE_VALUES
        if kind == "date":
            return parse_date(value)
        if kind == "payment_type":
            mapped = PAYMENT_TYPES.get(value.lower())
            if mapped is None:
                raise ConversionError(f"Неизвестный тип оплаты «{value}»")
            return mapped
    except (InvalidOperation, ValueError) as exc:
        if isinstance(exc, ConversionError):
            raise
        raise ConversionError(f"Некорректное значение «{value}» для типа {kind}") from exc
    raise ConversionError(f"Неизвестный тип {kind}")


def parse_date(value: str) -> date:
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ConversionError(f"Некорректная дата «{value}»")
