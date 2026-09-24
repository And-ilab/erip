"""Справочники Белорусской нотариальной палаты (serviceId, debtTypeId, docTypeId).

Данные — bnp_dictionaries.json, извлечённый из «Справочники БНП.docx»
скриптом app/scripts/extract_bnp_dictionaries.py.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DATA_FILE = Path(__file__).with_name("bnp_dictionaries.json")


@dataclass(frozen=True)
class BnpDictionaries:
    services: dict[int, dict]
    debt_types: dict[str, str]
    doc_types: dict[str, str]

    def allowed_debt_types(self, service_id: int) -> set[str]:
        return set(self.services.get(service_id, {}).get("debt_type_ids", []))


@lru_cache
def load_dictionaries() -> BnpDictionaries:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    return BnpDictionaries(
        services={s["service_id"]: s for s in data["services"]},
        debt_types={d["code"]: d["name"] for d in data["debt_types"]},
        doc_types={d["code"]: d["name"] for d in data["doc_types"]},
    )
