"""Справочник улиц Беларуси: имя → населённый пункт и точка на карте.

Файл собирается из OpenStreetMap и не зависит от того, были ли на улице должники.
Пустой справочник оставляет прежнюю раскладку: город из текста адреса или «Без населённого пункта».
"""

from __future__ import annotations

import os
import re
import sqlite3
import threading
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
        self._by_last: dict[tuple[str, str, str], list[StreetHit]] = {}
        self._houses: dict[tuple[str, str, str], tuple[float, float, str]] = {}
        self._path: Path | None = None
        self._house_db: sqlite3.Connection | None = None
        self._house_mode = ""
        self._house_lock = threading.Lock()
        self._aliases: dict[tuple[str, str], list[str]] | None = None
        for street in streets:
            self._by_exact.setdefault((street.oblast_key, street.settlement_key, street.name_key), street)
            self._by_name.setdefault(street.name_key, []).append(street)
            bare = bare_street_key(street.name_key)
            self._by_bare.setdefault(bare, []).append(street)
            last = bare.split()[-1] if bare else ""
            if last and last != bare:
                prefix = street.name_key[: -len(bare)]
                self._by_last.setdefault((street.settlement_key, prefix, last), []).append(street)

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
        catalog = cls(streets, places)
        catalog._path = chosen
        return catalog

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

    def house_point(
        self, street_key: str, house_key: str, settlement_key: str, oblast_key: str = "",
    ) -> tuple[float, float] | None:
        street = self._in_settlement(street_key, settlement_key, oblast_key)
        resolved = street.name_key if street is not None else street_key
        found = self._houses.get((settlement_key, resolved, house_key))
        if found is not None:
            if oblast_key and found[2] and found[2] != oblast_key:
                return None
            return found[0], found[1]
        found = self._house_from_db(settlement_key, resolved, house_key)
        if found is not None:
            return found
        for alias in self._alias_keys(settlement_key, resolved):
            found = self._house_from_db(settlement_key, alias, house_key)
            if found is not None:
                return found
        return None

    def _alias_keys(self, settlement_key: str, street_key: str) -> list[str]:
        """Русское и белорусское имя одной улицы лежат в одной точке: «Кольцова» и «Кальцова»."""
        if self._aliases is None:
            grouped: dict[tuple, list[tuple[str, str]]] = {}
            for street in self._by_exact.values():
                cell = (street.settlement_key, round(street.latitude, 4), round(street.longitude, 4))
                folded = bare_street_key(street.name_key).replace("і", "и").replace("ў", "у").replace("а", "о")
                grouped.setdefault(cell, [])
                if (street.name_key, folded) not in grouped[cell]:
                    grouped[cell].append((street.name_key, folded))
            aliases: dict[tuple[str, str], list[str]] = {}
            for (settlement, _lat, _lon), pairs in grouped.items():
                for name_key, folded in pairs:
                    others = [other for other, other_folded in pairs if other != name_key and other_folded == folded]
                    if others:
                        aliases[(settlement, name_key)] = others
            self._aliases = aliases
        return self._aliases.get((settlement_key, street_key), [])

    def _house_from_db(self, settlement_key: str, street_key: str, house_key: str) -> tuple[float, float] | None:
        if self._path is None:
            return None
        with self._house_lock:
            if self._house_db is None:
                connection = sqlite3.connect(self._path, check_same_thread=False)
                columns = [row[1] for row in connection.execute("PRAGMA table_info(houses)")]
                if "street_id" in columns:
                    self._house_mode = "slim"
                elif "settlement_key" in columns:
                    self._house_mode = "wide"
                else:
                    self._house_mode = ""
                self._house_db = connection
            if self._house_mode == "slim":
                row = self._house_db.execute(
                    """
                    SELECT h.latitude, h.longitude
                    FROM house_streets s
                    JOIN houses h ON h.street_id = s.id
                    WHERE s.settlement_key = ? AND s.street_key = ? AND h.house_key = ?
                    """,
                    (settlement_key, street_key, house_key),
                ).fetchone()
                if row is None:
                    return None
                return row[0] / 1_000_000, row[1] / 1_000_000
            if self._house_mode == "wide":
                row = self._house_db.execute(
                    """
                    SELECT latitude, longitude FROM houses
                    WHERE settlement_key = ? AND street_key = ? AND house_key = ?
                    """,
                    (settlement_key, street_key, house_key),
                ).fetchone()
                if row is None:
                    return None
                return float(row[0]), float(row[1])
        return None

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
        return self._longer_name(street_key, bare, settlement_key, oblast_key)

    def _longer_name(self, street_key: str, bare: str, settlement_key: str, oblast_key: str) -> StreetHit | None:
        """«ул. Богдановича» — это «ул. Максима Богдановича», если в городе такое имя одно."""
        if not bare or " " in bare:
            return None
        prefix = street_key[: -len(bare)] if street_key.endswith(bare) else ""
        hits = self._scoped(self._by_last.get((settlement_key, prefix, bare), []), settlement_key, oblast_key)
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
