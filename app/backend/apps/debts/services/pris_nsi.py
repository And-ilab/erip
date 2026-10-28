"""Справочники АИС ПРИС. stub и channel отдают пример регламента и локальные справочники, полный список — при GW_PRIS_MODE=http."""

from __future__ import annotations

import time

from apps.debts.services.pris_gateway import get_pris_transport

_TTL = 30 * 60
_cache: dict = {"at": 0.0, "payload": None}

FALLBACK_DICTIONARIES = {
    "201": (
        "ВИДЫ ИСПОЛНИТЕЛЬНЫХ ДОКУМЕНТОВ",
        (
            ("15", "Исполнительная надпись нотариуса"),
            ("1", "Исполнительный лист суда"),
            ("5", "Определение о судебном приказе"),
            ("2", "Судебный приказ экономического суда"),
            ("10", "Постановление суда / государственного органа"),
        ),
    ),
    "202": (
        "СТАТУСЫ ИСПОЛНИТЕЛЬНОГО ПРОИЗВОДСТВА",
        (
            ("1", "Возбуждено"),
            ("2", "На исполнении"),
            ("3", "Приостановлено"),
            ("6", "Окончено (возвращено без исполнения / акт о невозможности)"),
            ("7", "Окончено (исполнено полностью)"),
            ("8", "Прекращено"),
        ),
    ),
    "204": (
        "ОСНОВАНИЯ СТАТУСОВ ИСПОЛНИТЕЛЬНОГО ПРОИЗВОДСТВА",
        (
            ("1", "п. 4 ч. 1 ст. 52 Закона об ИП — отсутствие у должника имущества и доходов"),
            ("2", "п. 3 ч. 1 ст. 52 Закона об ИП — невозможно установить местонахождение должника"),
            ("3", "п. 5 ч. 1 ст. 52 Закона об ИП — отказ взыскателя оставить имущество за собой"),
            ("4", "п. 1 ч. 1 ст. 52 Закона об ИП — заявление взыскателя о возвращении ИД"),
            ("5", "п. 1 ч. 1 ст. 55 Закона об ИП — фактическое исполнение требований"),
        ),
    ),
    "214": (
        "ВИДЫ ТРЕБОВАНИЙ ИСПОЛНИТЕЛЬНОГО ДОКУМЕНТА",
        (
            ("205", "Взыскание задолженности по плате за жилищно-коммунальные услуги"),
            ("201", "Взыскание денежных средств"),
            ("210", "Взыскание государственной пошлины / нотариального тарифа"),
            ("301", "Выселение из жилого помещения"),
            ("302", "Понуждение к отчуждению жилого помещения"),
        ),
    ),
    "217": (
        "ОРГАНЫ, ВЫДАВШИЕ ИСПОЛНИТЕЛЬНЫЙ ДОКУМЕНТ",
        (
            ("6", "Нотариус / нотариальная контора"),
            ("1", "Суд общей юрисдикции"),
            ("2", "Экономический суд"),
            ("9", "Иной уполномоченный орган"),
        ),
    ),
    "306": (
        "СТРАНЫ МИРА (ОКРБ 017)",
        (
            ("112", "Республика Беларусь"),
            ("643", "Российская Федерация"),
            ("804", "Украина"),
            ("398", "Республика Казахстан"),
        ),
    ),
    "308": (
        "ТИПЫ ЭЛЕМЕНТОВ УЛИЧНО-ДОРОЖНОЙ СЕТИ",
        (
            ("1", "улица (ул.)"),
            ("2", "проспект (пр-т)"),
            ("3", "переулок (пер.)"),
            ("4", "бульвар (б-р)"),
            ("5", "площадь (пл.)"),
            ("6", "проезд (пр-д)"),
            ("7", "тракт (тр-т)"),
            ("8", "набережная (наб.)"),
            ("9", "шоссе (ш.)"),
        ),
    ),
    "309": (
        "ТИПЫ НАСЕЛЁННЫХ ПУНКТОВ",
        (
            ("1", "город (г.)"),
            ("2", "городской посёлок (г.п.)"),
            ("3", "агрогородок (аг.)"),
            ("4", "деревня (д.)"),
            ("5", "посёлок (п.)"),
            ("6", "сельсовет (с/с)"),
        ),
    ),
}


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
    _enrich_opi_120(dictionaries)
    for code, (title, pairs) in FALLBACK_DICTIONARIES.items():
        if code not in dictionaries or not dictionaries[code].get("rows"):
            dictionaries[code] = {
                "name": title,
                "rows": [{"code": k, "name": v} for k, v in pairs],
            }
    payload = {"mode": str(result.get("mode") or ""), "dictionaries": dictionaries}
    _cache["at"] = now
    _cache["payload"] = payload
    return payload


def _enrich_opi_120(dictionaries: dict) -> None:
    try:
        from apps.nsi.models import OpiOffice

        offices = list(OpiOffice.objects.filter(is_active=True).order_by("code", "id"))
    except Exception:
        return
    book = dictionaries.setdefault(
        "120",
        {"name": "ОРГАНЫ ПРИНУДИТЕЛЬНОГО ИСПОЛНЕНИЯ МИНИСТЕРСТВА ЮСТИЦИИ", "rows": []},
    )
    rows = list(book.get("rows") or [])
    seen = {str(r.get("code") or "").strip() for r in rows}
    for office in offices:
        code = (office.code or "").strip()
        if not code or code in seen:
            continue
        seen.add(code)
        rows.append({"code": code, "name": office.name})
    book["rows"] = rows


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
