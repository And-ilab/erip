"""Чтение спецификаций колонок «Примеры данных» (COLUMN_NAME;DATA_TYPE;COMMENTS).

Сами тестовые строки лежат в fixtures/ais_sample и загружаются командой load_ais_sample.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from pathlib import Path

from .parsing import decode


@dataclass(frozen=True)
class SpecColumn:
    column: str
    data_type: str
    comment: str


def read_spec(path: Path) -> list[SpecColumn]:
    text, _encoding = decode(path.read_bytes())
    reader = csv.reader(io.StringIO(text), delimiter=";")
    next(reader, None)
    return [SpecColumn(row[0].strip(), row[1].strip(), row[2].strip()) for row in reader if len(row) >= 3]
