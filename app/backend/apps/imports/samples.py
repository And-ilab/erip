"""Генератор тестовых выгрузок АИС по спецификациям «Примеры данных» (без реальных персональных данных).

Колонки и их порядок берутся из файла спецификации, значения — по типу поля в field_maps
(или по DATA_TYPE для колонок, которые хранятся только в raw). Идентификаторы согласованы
между файлами: услуги, оплаты и регистрации ссылаются на ACCOUNT_ID из «Карточки ЛС».
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .field_maps import ENTITY_MAPS, EntityMap, FieldSpec
from .parsing import decode

ROWS_PER_ACCOUNT = {"account": 1, "service": 2, "payment": 1, "registration": 2}
DEBT_MONTHS = (1, 2, 4, 8, 20, 40)  # по одной на каждую группу 1–6


@dataclass(frozen=True)
class SpecColumn:
    column: str
    data_type: str
    comment: str


def read_spec(path: Path) -> list[SpecColumn]:
    text, _ = decode(path.read_bytes())
    reader = csv.reader(io.StringIO(text), delimiter=";")
    next(reader, None)
    return [SpecColumn(r[0].strip(), r[1].strip(), r[2].strip()) for r in reader if len(r) >= 3]


def spec_for(entity_map: EntityMap, column: SpecColumn, occurrence: int) -> FieldSpec | None:
    candidates = [s for s in entity_map.specs if s.column == column.column]
    return candidates[occurrence] if occurrence < len(candidates) else None


class SampleGenerator:
    def __init__(self, spec_dir: Path, schema_name: str = "demo_schema", accounts: int = 12):
        self.spec_dir = Path(spec_dir)
        self.schema_name = schema_name
        self.accounts = accounts

    def generate(self, entity: str) -> str:
        entity_map = ENTITY_MAPS[entity]
        columns = read_spec(self.spec_dir / entity_map.spec_file)
        specs: list[FieldSpec | None] = []
        seen: dict[str, int] = {}
        for column in columns:
            occurrence = seen.get(column.column, 0)
            seen[column.column] = occurrence + 1
            specs.append(spec_for(entity_map, column, occurrence))
        headers = [(s.file_header if s else c.column) for c, s in zip(columns, specs, strict=True)]
        buf = io.StringIO()
        writer = csv.writer(buf, delimiter=";", lineterminator="\r\n")
        writer.writerow(headers)
        for i in range(self.accounts):
            for k in range(ROWS_PER_ACCOUNT[entity]):
                writer.writerow(
                    [self.value(entity, c, s, i, k) for c, s in zip(columns, specs, strict=True)]
                )
        return buf.getvalue()

    def write_all(self, out_dir: Path) -> dict[str, Path]:
        out_dir.mkdir(parents=True, exist_ok=True)
        result = {}
        for entity in ENTITY_MAPS:
            path = out_dir / f"{entity}.csv"
            path.write_bytes(self.generate(entity).encode("cp1251", errors="replace"))
            result[entity] = path
        return result

    # ------------------------------------------------------------------ значения

    def value(self, entity: str, column: SpecColumn, spec: FieldSpec | None, i: int, k: int) -> str:
        field = spec.field if spec else None
        special = {
            "account_id": str(100000 + i),
            "_account_id": str(100000 + i),
            "is_private_enterprise": str(i % 2),
            "client_account": f"{i + 1:08d}",
            "schema_name": self.schema_name,
            "provider_id": str(501 + i % 2) if entity == "account" else "900",
            "account_provider_id": str(501 + i % 2),
            "provider_short_name": f"ЖЭС №{1 + i % 2}" if entity == "account" else "Поставщик",
            "service_list_id": str(700000 + i * 10 + k),
            "service_id": str(10 + k),
            "service_name": ("Газоснабжение", "Водоснабжение")[k % 2],
            "receipt_id": str(800000 + i * 10 + k),
            "subj_id": str(300000 + i * 10 + k),
            "registration_id": str(400000 + i * 10 + k),
            "debt_period": str(DEBT_MONTHS[i % len(DEBT_MONTHS)] if k == 0 else 1),
            "balance_out": f"{(i + 1) * 10 + k},50",
            "subj_is_main": "1" if k == 0 else "0",
            "fam": ("Иванов", "Петрова", "Сидоренко")[i % 3],
            "im": ("Иван", "Анна", "Олег")[(i + k) % 3],
            "ot": ("Иванович", "Петровна", "Олегович")[(i + k) % 3],
            "short_fio": ("Иванов И.И.", "Петрова А.П.", "Сидоренко О.О.")[i % 3],
            "email": f"user{i}@example.com",
            "personal_num": f"{3000000 + i}A000PB{k}",
            "payment_type": "Файл",
        }
        if field in special:
            return special[field]
        kind = spec.kind if spec and spec.field else self._kind_by_type(column.data_type)
        if kind == "dec":
            return f"{i + k + 1},25"
        if kind in {"int", "months"}:
            return str(i + 1)
        if kind == "bool":
            return "0"
        if kind == "date":
            return date(2026, 1 + (i % 12), 1 + k).strftime("%d.%m.%Y")
        limit = self._varchar_len(column.data_type)
        return (column.comment or column.column)[:limit] if limit else (column.comment or column.column)

    @staticmethod
    def _kind_by_type(data_type: str) -> str:
        dt = data_type.upper()
        if dt.startswith("DATE"):
            return "date"
        if dt.startswith("NUMBER"):
            return "dec" if "," in dt else "int"
        return "str"

    @staticmethod
    def _varchar_len(data_type: str) -> int | None:
        if "(" in data_type and data_type.upper().startswith("VARCHAR"):
            try:
                return int(data_type.split("(")[1].rstrip(")"))
            except ValueError:
                return None
        return None
