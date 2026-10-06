"""Справочник улиц Беларуси: имя → населённый пункт и точка на карте.

Файл собирается из OpenStreetMap и не зависит от того, были ли на улице должники.
Пустой справочник оставляет прежнюю раскладку: город из текста адреса или «Без населённого пункта».
"""

from __future__ import annotations

import os
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from .street_names import bare_street_key, norm

CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "belarus_streets.sqlite"
_LATIN_LOOKALIKES = str.maketrans({"a": "а", "c": "с", "e": "е", "o": "о", "p": "р", "x": "х", "y": "у"})
_default: StreetCatalog | None = None


@dataclass(frozen=True)
class PlaceHit:
    name: str
    name_key: str
    oblast_name: str
    oblast_key: str
    latitude: float
    longitude: float
    rank: int


@dataclass(frozen=True)
class StreetHit:
    name: str
    name_key: str
    settlement_name: str
    settlement_key: str
    oblast_name: str
    oblast_key: str
    latitude: float
    longitude: float


class StreetCatalog:
    def __init__(self, streets: list[StreetHit], places: list[PlaceHit]):
        self._places = places
        self._places_by_key: dict[str, list[PlaceHit]] = {}
        self._best_rank: dict[str, int] = {}
        for place in places:
            self._places_by_key.setdefault(place.name_key, []).append(place)
            rank = self._best_rank.get(place.name_key)
            if rank is None or place.rank < rank:
                self._best_rank[place.name_key] = place.rank
        self._by_exact: dict[tuple[str, str, str], StreetHit] = {}
        self._by_name: dict[str, list[StreetHit]] = {}
        self._by_bare: dict[str, list[StreetHit]] = {}
        for street in streets:
            self._by_exact.setdefault((street.oblast_key, street.settlement_key, street.name_key), street)
            self._by_name.setdefault(street.name_key, []).append(street)
            self._by_bare.setdefault(bare_street_key(street.name_key), []).append(street)

    @classmethod
    def empty(cls) -> StreetCatalog:
        return cls([], [])

    @classmethod
    def from_rows(cls, streets: list[StreetHit], places: list[PlaceHit]) -> StreetCatalog:
        return cls(streets, places)

    @classmethod
    def load(cls, path: Path | None = None) -> StreetCatalog:
        chosen = path or _catalog_path()
        if chosen is None or not chosen.is_file():
            return cls.empty()
        connection = sqlite3.connect(chosen)
        try:
            places = [
                PlaceHit(*row)
                for row in connection.execute(
                    "SELECT name, name_key, oblast_name, oblast_key, latitude, longitude, rank FROM places"
                )
            ]
            streets = [
                StreetHit(*row)
                for row in connection.execute(
                    """
                    SELECT name, name_key, settlement_name, settlement_key,
                           oblast_name, oblast_key, latitude, longitude
                    FROM streets
                    """
                )
            ]
        except sqlite3.Error:
            return cls.empty()
        finally:
            connection.close()
        return cls(streets, places)

    @property
    def is_empty(self) -> bool:
        return not self._by_name and not self._places

    @property
    def street_count(self) -> int:
        return len(self._by_exact)

    @property
    def place_count(self) -> int:
        return len(self._places)

    def resolve(self, street_key: str, settlement_key: str, oblast_key: str, hint: str) -> StreetHit | None:
        if settlement_key:
            return self._in_settlement(street_key, settlement_key, oblast_key)
        hits = self._named(street_key)
        unique = self._one_settlement(hits, street_key)
        if unique is not None:
            return unique
        if not hint or not hits:
            return None
        matched = [hit for hit in hits if mentioned(hit.settlement_key, hint)]
        if not matched:
            return None
        names = {hit.settlement_key for hit in matched}
        if len(names) > 1:
            best_name = min(names, key=lambda key: (self._best_rank.get(key, 9), -len(key)))
            matched = [hit for hit in matched if hit.settlement_key == best_name]
        return self._one_settlement(matched, street_key)

    def place_of(self, settlement_key: str, oblast_key: str = "") -> PlaceHit | None:
        rows = self._places_by_key.get(settlement_key, [])
        if oblast_key:
            scoped = [row for row in rows if row.oblast_key == oblast_key]
            if scoped:
                rows = scoped
        if not rows:
            return None
        return min(rows, key=lambda row: row.rank)

    def place_from_hint(self, hint: str) -> PlaceHit | None:
        matched = [place for place in self._places if mentioned(place.name_key, hint)]
        if not matched:
            return None
        return min(matched, key=lambda place: (place.rank, -len(place.name_key)))

    def street_point(self, street_key: str, settlement_key: str, oblast_key: str = "") -> tuple[float, float] | None:
        hit = self._in_settlement(street_key, settlement_key, oblast_key)
        if hit is None:
            return None
        return hit.latitude, hit.longitude

    def _named(self, street_key: str) -> list[StreetHit]:
        exact = self._by_name.get(street_key, [])
        if exact:
            return exact
        bare = bare_street_key(street_key)
        if bare == street_key:
            return []
        return self._by_bare.get(bare, [])

    def _in_settlement(self, street_key: str, settlement_key: str, oblast_key: str) -> StreetHit | None:
        hits = self._scoped(self._by_name.get(street_key, []), settlement_key, oblast_key)
        if hits:
            return hits[0]
        bare = bare_street_key(street_key)
        if bare == street_key:
            return None
        hits = self._scoped(self._by_bare.get(bare, []), settlement_key, oblast_key)
        keys = {hit.name_key for hit in hits}
        if len(keys) == 1:
            return hits[0]
        return None

    @staticmethod
    def _scoped(hits: list[StreetHit], settlement_key: str, oblast_key: str) -> list[StreetHit]:
        rows = [hit for hit in hits if hit.settlement_key == settlement_key]
        if not oblast_key:
            return rows
        scoped = [hit for hit in rows if hit.oblast_key == oblast_key]
        return scoped or rows

    def _one_settlement(self, hits: list[StreetHit], street_key: str) -> StreetHit | None:
        grouped: dict[tuple[str, str], list[StreetHit]] = {}
        for hit in hits:
            grouped.setdefault((hit.oblast_key, hit.settlement_key), []).append(hit)
        if not grouped:
            return None
        names = {settlement for _oblast, settlement in grouped}
        if len(names) != 1:
            return None
        if len(grouped) > 1:
            chosen = min(grouped, key=lambda key: self._group_rank(key))
            group = grouped[chosen]
        else:
            group = next(iter(grouped.values()))
        exact = [hit for hit in group if hit.name_key == street_key]
        return exact[0] if exact else group[0]

    def _group_rank(self, key: tuple[str, str]) -> tuple[int, int]:
        oblast_key, settlement_key = key
        rows = [place for place in self._places_by_key.get(settlement_key, []) if place.oblast_key == oblast_key]
        rank = min((place.rank for place in rows), default=9)
        return (rank, -len(settlement_key))


def mentioned(name_key: str, hint: str) -> bool:
    if len(name_key) < 4 or not hint:
        return False
    folded = norm(hint).translate(_LATIN_LOOKALIKES)
    return re.search(rf"(?<!\w){re.escape(name_key)}(?!\w)", folded) is not None


def default_catalog() -> StreetCatalog:
    global _default
    if _default is None:
        _default = StreetCatalog.load()
    return _default


def _catalog_path() -> Path | None:
    override = os.environ.get("ERIP_STREET_CATALOG")
    if override == "":
        return None
    if override:
        path = Path(override)
        return path if path.is_file() else None
    return CATALOG_PATH if CATALOG_PATH.is_file() else None
