"""Справочники АИС ПРИС. Заглушка отдаёт только пример регламента, полный список — при GW_PRIS_MODE=http."""

from __future__ import annotations

import time

from apps.debts.services.pris_gateway import get_pris_transport

_TTL = 30 * 60
_cache: dict = {"at": 0.0, "payload": None}


def load_pris_dictionaries(*, force: bool = False) -> dict:
    now = time.monotonic()
    cached = _cache["payload"]
    if not force and cached is not None and now - _cache["at"] < _TTL:
        return cached
    result = get_pris_transport().get("/gw/v1/integrations/pris/nsi")
    dictionaries = {}
    for item in result.get("items") or []:
        if not isinstance(item, dict):
            continue
        code = str(item.get("type") or "").strip()
        if not code:
            continue
        dictionaries[code] = {
            "name": str(item.get("type_name") or "").strip(),
            "rows": _rows(item.get("content")),
        }
    payload = {"mode": str(result.get("mode") or ""), "dictionaries": dictionaries}
    _cache["at"] = now
    _cache["payload"] = payload
    return payload


def clear_pris_dictionary_cache() -> None:
    _cache["at"] = 0.0
    _cache["payload"] = None


def _rows(content) -> list[dict]:
    data = content.get("data") if isinstance(content, dict) else None
    if not isinstance(data, list):
        return []
    rows = []
    for row in data:
        if not isinstance(row, dict) or row.get("code") is None:
            continue
        code = str(row.get("code")).strip()
        if code == "":
            continue
        rows.append({"code": code, "name": str(row.get("lex1") or "").strip()})
    return rows
