"""Собирает справочник улиц Беларуси из выгрузки OpenStreetMap.

Нужен пакет osmium (в боевой образ он не входит, справочник уже лежит в репозитории):

    py -3 -m pip install osmium
    py -3 scripts/build_belarus_gazetteer.py

Берёт name:ru, белорусское имя и старые названия. Город улицы — ближайший
населённый пункт с радиусом по типу (город шире деревни). Область — по контуру.
"""

from __future__ import annotations

import json
import math
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app" / "backend"))

from apps.debts.services.street_names import norm, street_label  # noqa: E402

PBF_URL = "https://download.geofabrik.de/europe/belarus-latest.osm.pbf"
OBLAST_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/BLR/ADM1/"
    "geoBoundaries-BLR-ADM1_simplified.geojson"
)
PBF_PATH = ROOT / ".cache" / "map" / "belarus-latest.osm.pbf"
OBLAST_PATH = ROOT / ".cache" / "map" / "blr-adm1.geojson"
OUT_PATH = ROOT / "app" / "backend" / "apps" / "debts" / "data" / "belarus_streets.sqlite"

ISO_OBLAST = {
    "BY-BR": "Брестская область",
    "BY-HO": "Гомельская область",
    "BY-HR": "Гродненская область",
    "BY-MI": "Минская область",
    "BY-HM": "Минская область",
    "BY-VI": "Витебская область",
    "BY-MA": "Могилёвская область",
}
RANK = {"city": 1, "town": 2, "village": 3, "hamlet": 4}
RADIUS_KM = {1: 24.0, 2: 14.0, 3: 6.0, 4: 3.0}
LAST_RESORT_KM = 30.0
SKIP_HIGHWAY = {
    "motorway", "motorway_link", "trunk_link", "primary_link", "secondary_link",
    "tertiary_link", "raceway", "busway", "bus_guideway", "construction", "proposed",
    "platform", "corridor", "elevator", "steps", "cycleway", "footway", "path",
    "bridleway", "escape", "services",
}
NAME_TAGS = (
    "name:ru", "alt_name:ru", "old_name:ru", "official_name:ru",
    "name", "alt_name", "old_name", "official_name", "name:be",
)
CELL = 0.2


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    arc = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(arc))


def ring_contains(lon: float, lat: float, ring: list) -> bool:
    inside = False
    previous = len(ring) - 1
    for index, point in enumerate(ring):
        lon_i, lat_i = point[0], point[1]
        lon_j, lat_j = ring[previous][0], ring[previous][1]
        if (lat_i > lat) != (lat_j > lat):
            cross = (lon_j - lon_i) * (lat - lat_i) / ((lat_j - lat_i) or 1e-12) + lon_i
            if lon < cross:
                inside = not inside
        previous = index
    return inside


def polygon_contains(lon: float, lat: float, polygons: list) -> bool:
    for polygon in polygons:
        if not polygon or not ring_contains(lon, lat, polygon[0]):
            continue
        if any(ring_contains(lon, lat, hole) for hole in polygon[1:]):
            continue
        return True
    return False


def load_regions(path: Path) -> list[tuple]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    regions = []
    for feature in payload["features"]:
        iso = feature["properties"].get("shapeISO")
        name = ISO_OBLAST.get(iso)
        if not name:
            print(f"пропущен контур {iso}")
            continue
        geometry = feature["geometry"]
        if geometry["type"] == "Polygon":
            polygons = [geometry["coordinates"]]
        elif geometry["type"] == "MultiPolygon":
            polygons = geometry["coordinates"]
        else:
            continue
        points = [point for polygon in polygons for point in polygon[0]]
        lon = sum(point[0] for point in points) / len(points)
        lat = sum(point[1] for point in points) / len(points)
        bbox = (
            min(point[0] for point in points),
            min(point[1] for point in points),
            max(point[0] for point in points),
            max(point[1] for point in points),
        )
        regions.append((name, norm(name), (lat, lon), bbox, polygons))
    return regions


def oblast_of(lat: float, lon: float, regions: list[tuple]) -> tuple[str, str]:
    for name, key, _center, bbox, polygons in regions:
        if not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]):
            continue
        if polygon_contains(lon, lat, polygons):
            return name, key
    best_name = ""
    best_key = ""
    best_distance = 250.0
    for name, key, center, _bbox, _polygons in regions:
        distance = haversine(lat, lon, center[0], center[1])
        if distance < best_distance:
            best_name, best_key, best_distance = name, key, distance
    return best_name, best_key


def download(url: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.stat().st_size > 1000:
        print(f"уже есть {path.name}")
        return
    print(f"скачиваю {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "erip-map-build"})
    with urllib.request.urlopen(request, timeout=120) as response, path.open("wb") as handle:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)


def labels_of(tags) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for key in NAME_TAGS:
        raw = tags.get(key)
        if not raw:
            continue
        for part in raw.split(";"):
            parsed = street_label(part.strip())
            if parsed is None or parsed[1] in seen:
                continue
            seen.add(parsed[1])
            found.append(parsed)
    return found


def way_point(nodes) -> tuple[float, float, float] | None:
    lats: list[float] = []
    lons: list[float] = []
    length = 0.0
    previous = None
    for node in nodes:
        if not node.location.valid():
            continue
        lat, lon = node.location.lat, node.location.lon
        lats.append(lat)
        lons.append(lon)
        if previous is not None:
            length += haversine(previous[0], previous[1], lat, lon)
        previous = (lat, lon)
    if len(lats) < 2:
        return None
    return sum(lats) / len(lats), sum(lons) / len(lats), max(length, 0.05)


def main() -> None:
    try:
        import osmium
    except ImportError as exc:
        raise SystemExit("Нужен пакет osmium: pip install osmium") from exc

    download(PBF_URL, PBF_PATH)
    download(OBLAST_URL, OBLAST_PATH)
    regions = load_regions(OBLAST_PATH)
    print(f"контуров областей: {len(regions)}")

    class Handler(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.places: dict[tuple, dict] = {}
            self.ways: list[tuple] = []
            self.seen_ways = 0
            self.named_ways = 0

        def node(self, node):
            kind = node.tags.get("place")
            rank = RANK.get(kind or "")
            if rank is None or not node.location.valid():
                return
            russian = node.tags.get("name:ru") or ""
            raw = russian or node.tags.get("name") or ""
            name_key = norm(raw)
            if len(name_key) < 2:
                return
            bucket = (name_key, int(round(node.location.lat * 20)), int(round(node.location.lon * 20)))
            current = self.places.get(bucket)
            if current is not None and (current["rank"] < rank or (current["rank"] == rank and current["russian"])):
                return
            self.places[bucket] = {
                "name": raw.strip(),
                "name_key": name_key,
                "lat": node.location.lat,
                "lon": node.location.lon,
                "rank": rank,
                "russian": bool(russian),
            }

        def way(self, way):
            self.seen_ways += 1
            if self.seen_ways % 400000 == 0:
                print(f"линий {self.seen_ways}, с именем {self.named_ways}", flush=True)
            highway = way.tags.get("highway")
            if not highway or highway in SKIP_HIGHWAY:
                return
            parsed = labels_of(way.tags)
            if not parsed:
                return
            point = way_point(way.nodes)
            if point is None:
                return
            self.named_ways += 1
            self.ways.append((point[0], point[1], point[2], parsed))

    started = time.time()
    handler = Handler()
    handler.apply_file(str(PBF_PATH), locations=True)
    print(f"прочитано за {time.time() - started:.0f} с: пунктов {len(handler.places)}, улиц-линий {handler.named_ways}")

    places = []
    for row in handler.places.values():
        oblast_name, oblast_key = oblast_of(row["lat"], row["lon"], regions)
        if not oblast_name:
            continue
        row["oblast_name"] = oblast_name
        row["oblast_key"] = oblast_key
        places.append(row)
    print(f"пунктов внутри страны: {len(places)}")

    grid: dict[tuple[int, int], list] = {}
    for place in places:
        cell = (int(math.floor(place["lat"] / CELL)), int(math.floor(place["lon"] / CELL)))
        grid.setdefault(cell, []).append(place)

    def nearest(lat: float, lon: float):
        best = None
        best_score = 2.0
        fallback = None
        fallback_distance = LAST_RESORT_KM + 1
        center = (int(math.floor(lat / CELL)), int(math.floor(lon / CELL)))
        for lat_cell in range(center[0] - 2, center[0] + 3):
            for lon_cell in range(center[1] - 2, center[1] + 3):
                for place in grid.get((lat_cell, lon_cell), ()):
                    distance = haversine(lat, lon, place["lat"], place["lon"])
                    if distance < fallback_distance:
                        fallback, fallback_distance = place, distance
                    radius = RADIUS_KM[place["rank"]]
                    if distance > radius:
                        continue
                    score = distance / radius
                    if best is None or score < best_score or (score == best_score and place["rank"] < best["rank"]):
                        best, best_score = place, score
        if best is not None:
            return best
        if fallback is not None and fallback_distance <= LAST_RESORT_KM:
            return fallback
        return None

    groups: dict[tuple[str, str, str], list] = {}
    missed = 0
    for lat, lon, weight, parsed in handler.ways:
        place = nearest(lat, lon)
        if place is None:
            missed += 1
            continue
        for display, key in parsed:
            bucket_key = (place["oblast_key"], place["name_key"], key)
            bucket = groups.get(bucket_key)
            if bucket is None:
                groups[bucket_key] = [
                    lat * weight, lon * weight, weight, display,
                    place["name"], place["oblast_name"], place["oblast_key"], place["name_key"],
                ]
            else:
                bucket[0] += lat * weight
                bucket[1] += lon * weight
                bucket[2] += weight
    print(f"улиц в справочнике: {len(groups)}, линий без населённого пункта: {missed}")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    if OUT_PATH.exists():
        OUT_PATH.unlink()
    connection = sqlite3.connect(OUT_PATH)
    connection.executescript(
        """
        CREATE TABLE places (
            name TEXT NOT NULL,
            name_key TEXT NOT NULL,
            oblast_name TEXT NOT NULL,
            oblast_key TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            rank INTEGER NOT NULL
        );
        CREATE TABLE streets (
            name TEXT NOT NULL,
            name_key TEXT NOT NULL,
            settlement_name TEXT NOT NULL,
            settlement_key TEXT NOT NULL,
            oblast_name TEXT NOT NULL,
            oblast_key TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL
        );
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        """
    )
    connection.executemany(
        "INSERT INTO places VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            (row["name"], row["name_key"], row["oblast_name"], row["oblast_key"], row["lat"], row["lon"], row["rank"])
            for row in places
        ],
    )
    connection.executemany(
        "INSERT INTO streets VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                bucket[3], key, bucket[4], bucket[7], bucket[5], bucket[6],
                bucket[0] / bucket[2], bucket[1] / bucket[2],
            )
            for (_oblast, _settlement, key), bucket in groups.items()
        ],
    )
    connection.executemany(
        "INSERT INTO meta VALUES (?, ?)",
        [
            ("source", "OpenStreetMap Geofabrik belarus, ODbL"),
            ("streets", str(len(groups))),
            ("places", str(len(places))),
        ],
    )
    connection.executescript(
        """
        CREATE INDEX places_key ON places(name_key);
        CREATE INDEX streets_key ON streets(name_key);
        CREATE INDEX streets_place ON streets(settlement_key, name_key);
        """
    )
    connection.commit()
    print("проверка имён из выборки:")
    for key in (
        "ул. челюскинцев",
        "просп. рокоссовского",
        "ул. немига",
        "наб. франциска скорины",
        "проезд бумажкова",
        "тракт логойский",
        "ул. ленина",
    ):
        rows = connection.execute(
            """
            SELECT settlement_name, oblast_name, printf('%.4f', latitude), printf('%.4f', longitude)
            FROM streets WHERE name_key = ? ORDER BY settlement_name
            """,
            (key,),
        ).fetchall()
        preview = "; ".join(f"{name} ({oblast})" for name, oblast, _lat, _lon in rows[:6])
        print(f"  {key}: {len(rows)} — {preview}")
    connection.close()
    print(f"записан {OUT_PATH} ({OUT_PATH.stat().st_size / 1024 / 1024:.1f} МБ) за {time.time() - started:.0f} с")


if __name__ == "__main__":
    main()
