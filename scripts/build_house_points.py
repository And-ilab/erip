"""Дописывает в справочник улиц точки домов с номером из OpenStreetMap.

Справочник уже должен быть собран. Пакет osmium нужен только для этой сборки:

    E:\\erip-main\\.cache\\mapbuild\\Scripts\\python.exe scripts\\build_house_points.py
"""

from __future__ import annotations

import math
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app" / "backend"))

from apps.debts.services.street_names import bare_street_key, norm, street_label  # noqa: E402

PBF_PATH = ROOT / ".cache" / "map" / "belarus-latest.osm.pbf"
OUT_PATH = ROOT / "app" / "backend" / "apps" / "debts" / "data" / "belarus_streets.sqlite"
CELL = 0.2
RADIUS_KM = {1: 24.0, 2: 14.0, 3: 6.0, 4: 3.0}


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    arc = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(arc))


def house_key(raw: str) -> str:
    token = norm(raw).replace(" ", "")
    for prefix in ("дом", "д."):
        if token.startswith(prefix):
            token = token[len(prefix):]
    return token.strip(".,")


def load_index(connection: sqlite3.Connection):
    places = [
        {
            "name_key": row[0],
            "oblast_key": row[1],
            "lat": row[2],
            "lon": row[3],
            "rank": row[4],
        }
        for row in connection.execute("SELECT name_key, oblast_key, latitude, longitude, rank FROM places")
    ]
    grid: dict[tuple[int, int], list] = {}
    for place in places:
        cell = (int(math.floor(place["lat"] / CELL)), int(math.floor(place["lon"] / CELL)))
        grid.setdefault(cell, []).append(place)
    streets: dict[tuple[str, str], tuple[str, float, float]] = {}
    by_last: dict[tuple[str, str, str], set[str]] = {}
    for name_key, settlement_key, oblast_key, latitude, longitude in connection.execute(
        "SELECT name_key, settlement_key, oblast_key, latitude, longitude FROM streets"
    ):
        streets[(settlement_key, name_key)] = (oblast_key, latitude, longitude)
        bare = bare_street_key(name_key)
        last = bare.split()[-1] if bare else ""
        if last and last != bare:
            prefix = name_key[: -len(bare)]
            by_last.setdefault((settlement_key, prefix, last), set()).add(name_key)
    return grid, streets, by_last


def candidates(grid, lat: float, lon: float):
    """Ближние пункты. Улица Минска не должна теряться из-за соседнего хутора."""
    base_x, base_y = int(math.floor(lat / CELL)), int(math.floor(lon / CELL))
    found = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for place in grid.get((base_x + dx, base_y + dy), ()):
                distance = haversine(lat, lon, place["lat"], place["lon"])
                if distance <= RADIUS_KM.get(place["rank"], 6.0):
                    found.append((distance, place["rank"], place))
    found.sort()
    return [place for _distance, _rank, place in found]


def resolve_street(streets, by_last, settlement_key: str, street_key: str) -> str:
    if (settlement_key, street_key) in streets:
        return street_key
    bare = bare_street_key(street_key)
    if not bare or " " in bare:
        return ""
    prefix = street_key[: -len(bare)] if street_key.endswith(bare) else ""
    names = by_last.get((settlement_key, prefix, bare), set())
    if len(names) == 1:
        return next(iter(names))
    return ""


def point_of(entity) -> tuple[float, float] | None:
    location = getattr(entity, "location", None)
    if location is not None:
        if not location.valid():
            return None
        return location.lat, location.lon
    nodes = getattr(entity, "nodes", None)
    if not nodes:
        return None
    lats = []
    lons = []
    for node in nodes:
        if not node.location.valid():
            continue
        lats.append(node.location.lat)
        lons.append(node.location.lon)
    if not lats:
        return None
    return sum(lats) / len(lats), sum(lons) / len(lons)


def main() -> None:
    try:
        import osmium
    except ImportError as exc:
        raise SystemExit("Нужен пакет osmium") from exc
    if not PBF_PATH.is_file() or not OUT_PATH.is_file():
        raise SystemExit("нет выгрузки OSM или справочника улиц")

    connection = sqlite3.connect(OUT_PATH)
    grid, streets, by_last = load_index(connection)
    houses: dict[tuple[str, str, str], tuple] = {}
    labels: dict[str, str] = {}
    seen = 0
    started = time.time()
    processor = osmium.FileProcessor(str(PBF_PATH)).with_locations().with_filter(
        osmium.filter.KeyFilter("addr:housenumber")
    )
    for entity in processor:
        number = entity.tags.get("addr:housenumber")
        street = entity.tags.get("addr:street")
        if not number or not street:
            continue
        seen += 1
        if seen % 50000 == 0:
            print(f"addresses {seen} houses {len(houses)}", flush=True)
        point = point_of(entity)
        if point is None:
            continue
        street_key = labels.get(street)
        if street_key is None:
            parsed = street_label(street)
            street_key = parsed[1] if parsed else ""
            labels[street] = street_key
        if not street_key:
            continue
        place = None
        resolved = ""
        for candidate in candidates(grid, point[0], point[1]):
            resolved = resolve_street(streets, by_last, candidate["name_key"], street_key)
            if resolved:
                place = candidate
                break
        street_key = resolved
        if place is None:
            continue
        key = house_key(number)
        if not key:
            continue
        row_key = (place["name_key"], street_key, key)
        oblast_key, street_lat, street_lon = streets[(place["name_key"], street_key)]
        distance = haversine(point[0], point[1], street_lat, street_lon)
        current = houses.get(row_key)
        if current is not None and current[0] <= distance:
            continue
        houses[row_key] = (distance, point[0], point[1], oblast_key)
    connection.execute("DROP TABLE IF EXISTS houses")
    connection.execute("DROP TABLE IF EXISTS house_streets")
    connection.execute(
        """
        CREATE TABLE house_streets (
            id INTEGER PRIMARY KEY,
            settlement_key TEXT NOT NULL,
            street_key TEXT NOT NULL,
            oblast_key TEXT NOT NULL,
            UNIQUE (settlement_key, street_key)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE houses (
            street_id INTEGER NOT NULL,
            house_key TEXT NOT NULL,
            latitude INTEGER NOT NULL,
            longitude INTEGER NOT NULL,
            PRIMARY KEY (street_id, house_key)
        ) WITHOUT ROWID
        """
    )
    street_ids: dict[tuple[str, str], int] = {}
    street_rows = []
    house_rows = []
    for (settlement_key, street_key, key), row in houses.items():
        street_id = street_ids.get((settlement_key, street_key))
        if street_id is None:
            street_id = len(street_ids) + 1
            street_ids[(settlement_key, street_key)] = street_id
            street_rows.append((street_id, settlement_key, street_key, row[3]))
        house_rows.append((street_id, key, int(round(row[1] * 1_000_000)), int(round(row[2] * 1_000_000))))
    connection.executemany("INSERT INTO house_streets VALUES (?, ?, ?, ?)", street_rows)
    connection.executemany("INSERT INTO houses VALUES (?, ?, ?, ?)", house_rows)
    connection.commit()
    connection.execute("VACUUM")
    connection.close()
    print(f"houses {len(houses)} of addresses {seen} in {time.time() - started:.0f}s", flush=True)


if __name__ == "__main__":
    main()
