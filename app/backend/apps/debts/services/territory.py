"""Дерево адресов для карты реестра.

У лицевого счёта хранится только текст адреса. Узел создаётся из этого текста,
родитель один, как колонка «Родительская задача». Пустой адрес узел не получает.
Город Минск вешается на Минскую область.
"""

from __future__ import annotations

import hashlib
import math
import re
from decimal import Decimal

from django.db.models import Count, Q, QuerySet
from django.db.models.functions import Coalesce

from apps.debts.models import Account, Territory, TerritoryLink

COUNTRY = "Беларусь"
UNKNOWN_OBLAST = "Без области"
UNKNOWN_SETTLEMENT = "Без населённого пункта"

# Город без слова «область» в адресе. Минск специально лежит в Минской области.
CITY_OBLAST = {
    "минск": "Минская область",
    "фаниполь": "Минская область",
    "дзержинск": "Минская область",
    "борисов": "Минская область",
    "солигорск": "Минская область",
    "молодечно": "Минская область",
    "слуцк": "Минская область",
    "жодино": "Минская область",
    "заславль": "Минская область",
    "брест": "Брестская область",
    "барановичи": "Брестская область",
    "пинск": "Брестская область",
    "витебск": "Витебская область",
    "орша": "Витебская область",
    "полоцк": "Витебская область",
    "новополоцк": "Витебская область",
    "гомель": "Гомельская область",
    "мозырь": "Гомельская область",
    "гродно": "Гродненская область",
    "лида": "Гродненская область",
    "могилев": "Могилёвская область",
    "бобруйск": "Могилёвская область",
}

OBLAST_NAMES = {
    "брестская": "Брестская область",
    "витебская": "Витебская область",
    "гомельская": "Гомельская область",
    "гродненская": "Гродненская область",
    "минская": "Минская область",
    "могилевская": "Могилёвская область",
}

# Районы города Минска, не районы области.
MINSK_DISTRICTS = {
    "заводской": (53.870, 27.668),
    "ленинский": (53.872, 27.568),
    "московский": (53.876, 27.455),
    "октябрьский": (53.850, 27.540),
    "партизанский": (53.880, 27.640),
    "первомайский": (53.938, 27.647),
    "советский": (53.922, 27.583),
    "фрунзенский": (53.905, 27.465),
    "центральный": (53.905, 27.555),
}

# Известные точки. Остальные сдвигаются от родителя, чтобы пузыри не легли друг на друга.
KNOWN_POINTS = {
    ("country", "беларусь"): (53.70, 27.95),
    ("oblast", "брестская область"): (52.35, 25.00),
    ("oblast", "витебская область"): (55.15, 28.80),
    ("oblast", "гомельская область"): (52.30, 29.80),
    ("oblast", "гродненская область"): (53.60, 25.20),
    ("oblast", "минская область"): (53.95, 27.95),
    ("oblast", "могилевская область"): (53.70, 30.20),
    ("settlement", "минск"): (53.9006, 27.5590),
    ("settlement", "фаниполь"): (53.751, 27.333),
    ("settlement", "дзержинск"): (53.683, 27.138),
    ("district", "дзержинский"): (53.720, 27.250),
    ("settlement", "брест"): (52.097, 23.734),
    ("settlement", "витебск"): (55.190, 30.205),
    ("settlement", "гомель"): (52.434, 30.975),
    ("settlement", "гродно"): (53.678, 23.829),
    ("settlement", "могилев"): (53.917, 30.345),
    ("microdistrict", "грушевка"): (53.869, 27.445),
    # Улицы Минска. Ключ — как его собирает разбор адреса. Дом от этой точки чуть сдвигается.
    ("street", "ул. немига"): (53.9054, 27.5512),
    ("street", "ул. комсомольская"): (53.9012, 27.5618),
    ("street", "просп. независимости"): (53.9035, 27.5585),
    ("street", "ул. якуба коласа"): (53.9248, 27.5992),
    ("street", "ул. сурганова"): (53.9220, 27.5915),
    ("street", "ул. богдановича"): (53.9285, 27.6010),
    ("street", "ул. калиновского"): (53.9445, 27.6488),
    ("street", "ул. волгоградская"): (53.9462, 27.6755),
    ("street", "ул. ваупшасова"): (53.8878, 27.6315),
    ("street", "ул. плеханова"): (53.8820, 27.6180),
    ("street", "ул. ангарская"): (53.8665, 27.6720),
    ("street", "ул. кабушкина"): (53.8580, 27.6555),
    ("street", "ул. маяковского"): (53.8865, 27.5475),
    ("street", "ул. ульяновская"): (53.8788, 27.5720),
    ("street", "ул. кижеватова"): (53.8525, 27.5080),
    ("street", "ул. аранская"): (53.8470, 27.5285),
    ("street", "ул. притыцкого"): (53.9088, 27.4785),
    ("street", "ул. кольцова"): (53.8715, 27.4480),
    ("street", "просп. пушкина"): (53.9095, 27.4580),
    ("street", "ул. бурдейного"): (53.9020, 27.4420),
}
for _key, _point in MINSK_DISTRICTS.items():
    KNOWN_POINTS[("district", _key)] = _point

_FLAT = re.compile(r"^(?:кв\.?|квартира|комн\.?|комната|оф\.?|офис)\b", re.IGNORECASE)
_CORPUS = re.compile(r"^(?:корп\.?|корпус|к\.)\s*(\d+\S*)$", re.IGNORECASE)
_OBLAST = re.compile(r"^(.+?)\s+(?:область|обл\.?)$", re.IGNORECASE)
_RAYON = re.compile(r"^(.+?)\s+(?:район|р-н\.?)$", re.IGNORECASE)
_MICRO = re.compile(r"^(?:микрорайон|мкр\.?)\s+(.+)$", re.IGNORECASE)
_STREET = re.compile(
    r"^(улица|ул\.?|проспект|пр-т|просп\.?|переулок|пер\.?|бульвар|бул\.?|б-р|тракт|площадь|пл\.?)\s+(.+)$",
    re.IGNORECASE,
)
_HOUSE = re.compile(r"^(?:дом|д\.)\s*(\d+\S*)$", re.IGNORECASE)
_SETTLEMENT = re.compile(
    r"^(?:город|г\.|гп|аг|агрогородок|деревня|д\.|посёлок|поселок|п\.|село|с\.)\s+(.+)$",
    re.IGNORECASE,
)
_STREET_PREFIX = {
    "улица": "ул.",
    "ул": "ул.",
    "проспект": "просп.",
    "пр-т": "просп.",
    "просп": "просп.",
    "переулок": "пер.",
    "пер": "пер.",
    "бульвар": "бул.",
    "бул": "бул.",
    "б-р": "бул.",
    "тракт": "тракт",
    "площадь": "пл.",
    "пл": "пл.",
}


def norm(value: str) -> str:
    return " ".join(value.lower().replace("ё", "е").split())


def _title(value: str) -> str:
    return " ".join(part[:1].upper() + part[1:].lower() for part in value.split() if part)


def _spread(latitude: float, longitude: float, key: str, kind: str) -> tuple[float, float]:
    span = {
        "oblast": 0.35,
        "district": 0.12,
        "settlement": 0.2,
        "microdistrict": 0.03,
        "street": 0.012,
        "house": 0.003,
    }.get(kind, 0.05)
    digest = int(hashlib.sha1(key.encode("utf-8")).hexdigest()[:8], 16)
    angle = (digest % 360) * math.pi / 180
    radius = span * (0.45 + (digest % 50) / 100)
    lat = latitude + radius * math.sin(angle)
    lon = longitude + radius * math.cos(angle) / max(math.cos(math.radians(latitude)), 0.2)
    return round(lat, 6), round(lon, 6)


def _point(kind: str, name_key: str, parent: Territory | None) -> tuple[Decimal, Decimal]:
    known = KNOWN_POINTS.get((kind, name_key))
    if known:
        lat, lon = known
    else:
        base_lat = float(parent.latitude) if parent and parent.latitude is not None else 53.7
        base_lon = float(parent.longitude) if parent and parent.longitude is not None else 27.95
        lat, lon = _spread(base_lat, base_lon, f"{kind}:{name_key}", kind)
    return Decimal(str(lat)), Decimal(str(lon))


class AddressPath:
    """Разбирает строку адреса в цепочку от страны до дома."""

    def steps(self, text: str) -> list[tuple[str, str, str]]:
        parts = self._scan(text)
        if not parts:
            return []
        settlement_key = norm(parts["settlement"]) if parts["settlement"] else ""
        district_key = norm(parts["district"]).removesuffix(" район") if parts["district"] else ""
        oblast_name = parts["oblast"] or CITY_OBLAST.get(settlement_key) or UNKNOWN_OBLAST
        chain: list[tuple[str, str, str]] = [
            (Territory.Kind.COUNTRY, COUNTRY, norm(COUNTRY)),
            (Territory.Kind.OBLAST, oblast_name, norm(oblast_name)),
        ]
        minsk_city = settlement_key == "минск" or district_key in MINSK_DISTRICTS
        if minsk_city:
            chain.append((Territory.Kind.SETTLEMENT, "Минск", "минск"))
            if district_key:
                chain.append((Territory.Kind.DISTRICT, parts["district"], district_key))
        else:
            if district_key:
                chain.append((Territory.Kind.DISTRICT, parts["district"], district_key))
            if settlement_key:
                chain.append((Territory.Kind.SETTLEMENT, parts["settlement"], settlement_key))
            elif parts["street"] or parts["house"]:
                chain.append((Territory.Kind.SETTLEMENT, UNKNOWN_SETTLEMENT, norm(UNKNOWN_SETTLEMENT)))
        if parts["microdistrict"]:
            chain.append((Territory.Kind.MICRODISTRICT, parts["microdistrict"], norm(parts["microdistrict"])))
        if parts["street"]:
            chain.append((Territory.Kind.STREET, parts["street"], norm(parts["street"])))
        if parts["house"]:
            chain.append((Territory.Kind.HOUSE, parts["house"], norm(parts["house"])))
        return chain

    def _scan(self, text: str) -> dict[str, str] | None:
        found = {"oblast": "", "district": "", "settlement": "", "microdistrict": "", "street": "", "house": ""}
        house_key = ""
        for raw in re.split(r"\s*[,;]\s*", text or ""):
            token = " ".join(raw.split())
            if not token or _FLAT.match(token):
                continue
            corpus = _CORPUS.match(token)
            if corpus and house_key:
                house_key = f"{house_key}к{norm(corpus.group(1))}"
                found["house"] = f"д. {house_key}"
                continue
            oblast = _OBLAST.match(token)
            if oblast:
                stem = norm(oblast.group(1))
                found["oblast"] = OBLAST_NAMES.get(stem, _title(oblast.group(1)) + " область")
                continue
            rayon = _RAYON.match(token)
            if rayon:
                found["district"] = _title(rayon.group(1)) + " район"
                continue
            micro = _MICRO.match(token)
            if micro:
                found["microdistrict"] = _title(micro.group(1))
                continue
            street = _STREET.match(token)
            if street:
                prefix = _STREET_PREFIX.get(norm(street.group(1)).rstrip("."), "ул.")
                found["street"] = f"{prefix} {_title(street.group(2))}"
                continue
            house = _HOUSE.match(token)
            if house:
                house_key = norm(house.group(1))
                found["house"] = f"д. {house.group(1).upper()}"
                continue
            settlement = _SETTLEMENT.match(token)
            if settlement and not re.match(r"\d", settlement.group(1)):
                found["settlement"] = _title(settlement.group(1))
        if not any(found.values()):
            return None
        return found


class TerritoryIndex:
    """Кладёт лицевой счёт на дом (или на самый глубокий распознанный узел)."""

    def __init__(self):
        self._cache: dict[tuple, Territory] = {}
        self._parser = AddressPath()

    def assign_queryset(self, queryset: QuerySet) -> int:
        changed: list[Account] = []
        updated = 0
        accounts = queryset.only("id", "house_address", "account_address", "territory_id").iterator(chunk_size=500)
        for account in accounts:
            place = self.place_for(account.house_address or account.account_address or "")
            new_id = place.pk if place else None
            if account.territory_id != new_id:
                account.territory_id = new_id
                changed.append(account)
            if len(changed) >= 500:
                Account.objects.bulk_update(changed, ["territory"])
                updated += len(changed)
                changed = []
        if changed:
            Account.objects.bulk_update(changed, ["territory"])
            updated += len(changed)
        return updated

    def place_for(self, text: str) -> Territory | None:
        parent = None
        node = None
        for kind, name, name_key in self._parser.steps(text):
            node = self._node(parent, kind, name, name_key)
            parent = node
        return node

    def _node(self, parent: Territory | None, kind: str, name: str, name_key: str) -> Territory:
        cache_key = (parent.pk if parent else None, kind, name_key)
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached
        latitude, longitude = _point(kind, name_key, parent)
        node, created = Territory.objects.get_or_create(
            parent=parent,
            kind=kind,
            name_key=name_key,
            defaults={"name": name, "latitude": latitude, "longitude": longitude},
        )
        if created:
            self._link(node, parent)
        elif (kind, name_key) in KNOWN_POINTS and (node.latitude != latitude or node.longitude != longitude):
            node.latitude = latitude
            node.longitude = longitude
            node.save(update_fields=["latitude", "longitude", "updated_at"])
        self._cache[cache_key] = node
        return node

    @staticmethod
    def _link(node: Territory, parent: Territory | None) -> None:
        rows = [TerritoryLink(ancestor=node, descendant=node, depth=0)]
        if parent is not None:
            rows.extend(
                TerritoryLink(ancestor_id=link.ancestor_id, descendant=node, depth=link.depth + 1)
                for link in TerritoryLink.objects.filter(descendant=parent)
            )
        TerritoryLink.objects.bulk_create(rows)


class TerritoryMap:
    """Один уровень дерева: дети текущего узла и число лицевых счетов в поддереве."""

    def level(self, accounts: QuerySet, parent: Territory | None) -> dict:
        if parent is None:
            parent = Territory.objects.filter(kind=Territory.Kind.COUNTRY, name_key=norm(COUNTRY)).first()
        unplaced = accounts.filter(territory__isnull=True).count()
        if parent is None:
            return {"parent": None, "breadcrumb": [], "unplaced": unplaced, "children": []}
        annotated = accounts.annotate(shown_group=Coalesce("debt_group_manual", "debt_group"))
        rows = (
            annotated.filter(territory__ancestor_links__ancestor__parent_id=parent.pk)
            .values(
                "territory__ancestor_links__ancestor_id",
                "territory__ancestor_links__ancestor__name",
                "territory__ancestor_links__ancestor__kind",
                "territory__ancestor_links__ancestor__latitude",
                "territory__ancestor_links__ancestor__longitude",
            )
            .annotate(
                accounts=Count("id", distinct=True),
                **{f"g{number}": Count("id", distinct=True, filter=Q(shown_group=number)) for number in range(1, 7)},
            )
        )
        children = []
        for row in rows:
            if not row["accounts"]:
                continue
            groups = {str(number): row[f"g{number}"] for number in range(1, 7)}
            latitude = row["territory__ancestor_links__ancestor__latitude"]
            longitude = row["territory__ancestor_links__ancestor__longitude"]
            children.append({
                "id": row["territory__ancestor_links__ancestor_id"],
                "name": row["territory__ancestor_links__ancestor__name"],
                "kind": row["territory__ancestor_links__ancestor__kind"],
                "latitude": float(latitude) if latitude is not None else None,
                "longitude": float(longitude) if longitude is not None else None,
                "accounts": row["accounts"],
                "groups": groups,
                "dominant_group": _dominant(groups),
            })
        children.sort(key=lambda item: (-item["accounts"], item["name"]))
        return {
            "parent": {"id": parent.pk, "name": parent.name, "kind": parent.kind},
            "breadcrumb": _breadcrumb(parent),
            "unplaced": unplaced,
            "children": children,
        }


def _dominant(groups: dict[str, int]) -> int | None:
    best_group = None
    best_count = 0
    for number in range(1, 7):
        count = groups.get(str(number), 0)
        if count >= best_count and count > 0:
            best_group = number
            best_count = count
    return best_group


def _breadcrumb(node: Territory) -> list[dict]:
    rows = []
    current = node
    while current is not None:
        rows.append({"id": current.pk, "name": current.name, "kind": current.kind})
        current = current.parent
    rows.reverse()
    return rows
