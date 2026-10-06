"""Общий разбор названия улицы для адреса АИС и справочника OpenStreetMap."""

from __future__ import annotations

import re

STREET_RE = re.compile(
    r"^(улица|ул\.?|проспект|просп\.?|пр-т|пр-д|пр\.|проезд|"
    r"переулок|пер\.?|бульвар|бул\.?|б-р|тракт|тр-т|площадь|пл\.?|"
    r"шоссе|набережная|наб\.?|тупик|туп\.?|"
    r"вуліца|вул\.?|праспект|прасп\.?|завулак|плошча)\s+(.+)$",
    re.IGNORECASE,
)
STREET_SUFFIX_RE = re.compile(
    r"^(.+?)\s+(улица|ул\.?|проспект|просп\.?|пр-т|пр-д|пр\.|проезд|"
    r"переулок|пер\.?|бульвар|бул\.?|б-р|тракт|тр-т|площадь|пл\.?|"
    r"шоссе|набережная|наб\.?|тупик|туп\.?|"
    r"вуліца|вул\.?|праспект|прасп\.?|завулак|плошча)$",
    re.IGNORECASE,
)
ROAD_NUMBER = re.compile(
    r"^[A-Za-zА-Яа-яЁё]{1,3}\s*-?\s*\d+[A-Za-zА-Яа-яЁё]?$",
)
STREET_PREFIX = {
    "улица": "ул.",
    "ул": "ул.",
    "вуліца": "ул.",
    "вул": "ул.",
    "проспект": "просп.",
    "просп": "просп.",
    "пр-т": "просп.",
    "пр": "просп.",
    "праспект": "просп.",
    "прасп": "просп.",
    "проезд": "проезд",
    "пр-д": "проезд",
    "переулок": "пер.",
    "пер": "пер.",
    "завулак": "пер.",
    "бульвар": "бул.",
    "бул": "бул.",
    "б-р": "бул.",
    "тракт": "тракт",
    "тр-т": "тракт",
    "площадь": "пл.",
    "пл": "пл.",
    "плошча": "пл.",
    "шоссе": "шоссе",
    "набережная": "наб.",
    "наб": "наб.",
    "тупик": "туп.",
    "туп": "туп.",
}
_BARE_PREFIXES = (
    "просп. ", "проезд ", "шоссе ", "тракт ", "наб. ", "туп. ", "бул. ", "пер. ", "пл. ", "ул. ",
)


def norm(value: str) -> str:
    return " ".join(value.lower().replace("ё", "е").split())


def title_name(value: str) -> str:
    return " ".join(part[:1].upper() + part[1:].lower() for part in value.split() if part)


def bare_street_key(street_key: str) -> str:
    for prefix in _BARE_PREFIXES:
        if street_key.startswith(prefix):
            return street_key[len(prefix):]
    return street_key


def street_label(raw: str) -> tuple[str, str] | None:
    """«улица Челюскинцев» и «Логойский тракт» → подпись и ключ, как в дереве адресов."""
    token = " ".join((raw or "").split())
    if not token or ROAD_NUMBER.fullmatch(token):
        return None
    match = STREET_RE.match(token)
    if match:
        kind, stem = match.group(1), match.group(2)
    else:
        suffix = STREET_SUFFIX_RE.match(token)
        if suffix is None:
            if len(token) < 2:
                return None
            display = f"ул. {title_name(token)}"
            return display, norm(display)
        stem, kind = suffix.group(1), suffix.group(2)
    prefix = STREET_PREFIX.get(norm(kind).rstrip("."), "ул.")
    display = f"{prefix} {title_name(stem)}"
    return display, norm(display)
