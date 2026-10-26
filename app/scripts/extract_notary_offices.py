"""Снимок нотариальных контор и бюро с сайта Белорусской нотариальной палаты.

Источник: https://belnotary.by/nayti-notariusa/notarialnye-kontory-i-notarialnye-byuro/
Бюро, прекратившие работу с 01.01.2026, на этой странице нет и в справочник не попадают.

Результат: backend/apps/nsi/fixtures/notary_offices.json (loaddata notary_offices).
Запуск из каталога app/: python scripts/extract_notary_offices.py
"""

from __future__ import annotations

import json
import re
import ssl
import urllib.request
from html import unescape
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
OUT = APP / "backend" / "apps" / "nsi" / "fixtures" / "notary_offices.json"
PAGE = "https://belnotary.by/nayti-notariusa/notarialnye-kontory-i-notarialnye-byuro/"
ROW = re.compile(
    r'<tr id="bx_\d+_(\d+)">\s*'
    r'<td>\s*<a href="([^"]+)">([^<]*)</a>\s*</td>\s*'
    r"<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>",
    re.S,
)


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "erip-notary-directory"})
    context = ssl._create_unverified_context()
    with urllib.request.urlopen(request, timeout=60, context=context) as response:
        return response.read().decode("utf-8", "replace")


def plain(value: str) -> str:
    text = re.sub(r"<br\s*/?>", ", ", value, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text).replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip(" ,")
    return text


def rows(html: str) -> list[dict]:
    found = []
    for source_id, href, name, district, address, phones in ROW.findall(html):
        title = plain(name)
        if not title:
            continue
        code = href.strip("/").rsplit("/", 1)[-1]
        found.append({
            "code": code,
            "source_id": int(source_id),
            "name": title,
            "district": plain(district),
            "address": plain(address),
            "phones": plain(phones),
        })
    return found


def collect() -> list[dict]:
    first = fetch(PAGE)
    end = int(re.search(r"var nEndPage = (\d+);", first).group(1))
    offices = rows(first)
    for page in range(2, end + 1):
        html = fetch(f"{PAGE}?type=html&dbAjaxNav=Y&PAGEN_1={page}")
        offices.extend(rows(html))
    unique = []
    seen = set()
    for office in offices:
        if office["code"] in seen:
            continue
        seen.add(office["code"])
        unique.append(office)
    unique.sort(key=lambda item: (item["district"], item["name"]))
    return unique


def fixture(offices: list[dict]) -> list[dict]:
    return [
        {
            "model": "nsi.notaryoffice",
            "pk": office["code"],
            "fields": {
                "source_id": office["source_id"],
                "name": office["name"],
                "district": office["district"],
                "address": office["address"],
                "phones": office["phones"],
            },
        }
        for office in offices
    ]


def main() -> None:
    offices = collect()
    if len(offices) < 50:
        raise SystemExit(f"слишком мало контор: {len(offices)}")
    OUT.write_text(json.dumps(fixture(offices), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    longest = max(offices, key=lambda item: len(item["name"]))
    print(f"{len(offices)} -> {OUT}")
    print("longest name", len(longest["name"]), longest["name"])
    print("longest address", max(len(item["address"]) for item in offices))
    print("longest phones", max(len(item["phones"]) for item in offices))
    print("longest district", max(len(item["district"]) for item in offices))
    print("longest code", max(len(item["code"]) for item in offices))


if __name__ == "__main__":
    main()
