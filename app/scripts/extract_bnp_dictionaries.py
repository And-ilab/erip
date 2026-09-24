"""Извлекает справочники БНП из «Информация по интеграции/Справочники БНП.docx».

Результат:
  backend/apps/nsi/fixtures/bnp_dictionaries.json — фикстура Django (loaddata bnp_dictionaries);
  gateway/app/integrations/bnp/bnp_dictionaries.json — справочники для валидации манифеста в шлюзе.

Запуск из каталога app/: python scripts/extract_bnp_dictionaries.py
"""

import json
import re
import zipfile
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
SRC = APP.parent / "Информация по интеграции" / "Справочники БНП.docx"
OUT_FIXTURE = APP / "backend" / "apps" / "nsi" / "fixtures" / "bnp_dictionaries.json"
OUT_GATEWAY = APP / "gateway" / "app" / "integrations" / "bnp" / "bnp_dictionaries.json"


def cell_text(tc: str) -> str:
    return " ".join("".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", p)) for p in re.findall(r"<w:p[ >].*?</w:p>", tc, re.S)).strip()


def tables(xml: str) -> list[list[list[str]]]:
    result = []
    for tbl in re.findall(r"<w:tbl>.*?</w:tbl>", xml, re.S):
        rows = []
        for tr in re.findall(r"<w:tr[ >].*?</w:tr>", tbl, re.S):
            rows.append([cell_text(tc) for tc in re.findall(r"<w:tc>.*?</w:tc>", tr, re.S)])
        result.append(rows)
    return result


def main() -> None:
    xml = zipfile.ZipFile(SRC).read("word/document.xml").decode("utf-8")
    services_t, debts_t, docs_t = tables(xml)[:3]

    services = []
    for row in services_t[1:]:
        type_id, service_id, name, debt_ids = (row + [""] * 4)[:4]
        if not service_id.strip().isdigit():
            continue
        codes = [c.strip() for c in re.findall(r'"([^"]+)"', debt_ids)]
        services.append({"type_id": type_id.strip(), "service_id": int(service_id), "name": name.strip(),
                         "debt_type_ids": codes})
    debt_types = [{"code": r[0].strip(), "name": r[1].strip()} for r in debts_t[1:] if len(r) >= 2 and r[0].strip()]
    doc_types = [{"code": r[0].strip(), "name": r[1].strip()} for r in docs_t[1:] if len(r) >= 2 and r[0].strip()]

    known = {d["code"] for d in debt_types}
    for s in services:
        missing = [c for c in s["debt_type_ids"] if c not in known]
        for code in missing:
            # В справочнике услуг встречаются коды, отсутствующие в справочнике типов — добавляем с пометкой
            debt_types.append({"code": code, "name": f"{code} (нет в справочнике типов БНП)"})
            known.add(code)

    OUT_GATEWAY.parent.mkdir(parents=True, exist_ok=True)
    OUT_GATEWAY.write_text(json.dumps({"services": services, "debt_types": debt_types, "doc_types": doc_types},
                                      ensure_ascii=False, indent=1), encoding="utf-8")

    fixture = [{"model": "nsi.bnpdebttype", "pk": d["code"], "fields": {"name": d["name"]}} for d in debt_types]
    fixture += [{"model": "nsi.bnpdoctype", "pk": d["code"], "fields": {"name": d["name"]}} for d in doc_types]
    fixture += [
        {"model": "nsi.bnpservice", "pk": s["service_id"],
         "fields": {"type_id": s["type_id"], "name": s["name"], "debt_types": s["debt_type_ids"]}}
        for s in services
    ]
    OUT_FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FIXTURE.write_text(json.dumps(fixture, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"services={len(services)} debt_types={len(debt_types)} doc_types={len(doc_types)}")


if __name__ == "__main__":
    main()
