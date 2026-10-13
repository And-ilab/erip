import pytest

from apps.debts.models import Account, AccountService, Territory
from apps.debts.services.street_catalog import PlaceHit, StreetCatalog, StreetHit
from apps.debts.services.territory import AddressPath, TerritoryIndex
from apps.users.models import ServiceOrganization, User

from .conftest import make_account, make_user


def _chain(account):
    names = []
    node = account.territory
    while node is not None:
        names.append(node.name)
        node = node.parent
    names.reverse()
    return names


def test_minsk_city_hangs_on_minsk_oblast(org_a):
    account = make_account(org_a, 1, house_address="г. Минск, ул. Тестовая, д. 1, кв. 2")
    TerritoryIndex().assign_queryset(Account.objects.filter(pk=account.pk))
    account.refresh_from_db()
    assert _chain(account) == ["Беларусь", "Минская область", "Минск", "ул. Тестовая", "д. 1"]


def test_fanipol_keeps_its_district(org_a):
    account = make_account(
        org_a, 2,
        house_address="Минская обл., Дзержинский район, г. Фаниполь, ул. Ленина, д. 3",
    )
    TerritoryIndex().assign_queryset(Account.objects.filter(pk=account.pk))
    account.refresh_from_db()
    assert _chain(account) == [
        "Беларусь", "Минская область", "Дзержинский район", "Фаниполь", "ул. Ленина", "д. 3",
    ]


def test_minsk_district_and_microdistrict_sit_under_the_city(org_a):
    account = make_account(
        org_a, 3,
        house_address="г. Минск, Московский район, мкр. Грушевка, ул. Корженевского, д. 10",
    )
    TerritoryIndex().assign_queryset(Account.objects.filter(pk=account.pk))
    account.refresh_from_db()
    assert _chain(account) == [
        "Беларусь", "Минская область", "Минск", "Московский район", "ул. Корженевского", "д. 10",
    ]


def test_known_point_replaces_an_earlier_offset(org_a):
    account = make_account(
        org_a, 31,
        house_address="Минская обл., Дзержинский район, г. Фаниполь, ул. Ленина, д. 3",
    )
    TerritoryIndex().assign_queryset(Account.objects.filter(pk=account.pk))
    account.refresh_from_db()
    district = account.territory.parent.parent.parent
    assert district.name_key == "дзержинский"
    district.latitude = 1
    district.longitude = 1
    district.save(update_fields=["latitude", "longitude"])
    TerritoryIndex().assign_queryset(Account.objects.filter(pk=account.pk))
    district.refresh_from_db()
    assert float(district.latitude) == 53.720
    assert float(district.longitude) == 27.250


def test_known_minsk_street_uses_its_point(org_a):
    account = make_account(org_a, 30, house_address="г. Минск, Центральный район, ул. Немига, д. 5, кв. 2")
    TerritoryIndex(StreetCatalog.empty()).assign_queryset(Account.objects.filter(pk=account.pk))
    account.refresh_from_db()
    street = account.territory.parent
    assert street.name == "ул. Немига"
    assert float(street.latitude) == 53.9054
    assert float(street.longitude) == 27.5512
    assert abs(float(account.territory.latitude) - 53.9054) < 0.01
    assert abs(float(account.territory.longitude) - 27.5512) < 0.01


def test_blank_address_stays_unplaced(org_a):
    account = make_account(org_a, 4, house_address="")
    TerritoryIndex().assign_queryset(Account.objects.filter(pk=account.pk))
    account.refresh_from_db()
    assert account.territory_id is None


def test_assign_is_idempotent(org_a):
    account = make_account(org_a, 5, house_address="г. Минск, Первомайский район, ул. Советская, д. 4")
    TerritoryIndex().assign_queryset(Account.objects.filter(pk=account.pk))
    first = Territory.objects.count()
    TerritoryIndex().assign_queryset(Account.objects.filter(pk=account.pk))
    assert Territory.objects.count() == first


def test_map_places_accounts_that_are_not_linked_yet(api, specialist_a, org_a):
    make_account(org_a, 41, house_address="г. Минск, ул. Тестовая, д. 9", debt_group=2)
    body = api(specialist_a).get("/api/v1/accounts/map/")
    assert body.status_code == 200
    payload = body.json()
    assert payload["children"][0]["name"] == "Минская область"
    assert payload["children"][0]["accounts"] == 1
    assert Account.objects.get(account_id=41).territory_id is not None


def test_map_counts_subtree_inside_the_contour(api, specialist_a, org_a, org_b):
    make_account(org_a, 11, house_address="г. Минск, ул. Тестовая, д. 1", debt_group=1)
    make_account(org_a, 12, house_address="г. Минск, ул. Тестовая, д. 1", debt_group=6)
    make_account(org_b, 13, house_address="г. Минск, ул. Тестовая, д. 2", debt_group=3)
    TerritoryIndex().assign_queryset(Account.objects.all())

    root = api(specialist_a).get("/api/v1/accounts/map/").json()
    assert [child["name"] for child in root["children"]] == ["Минская область"]
    assert root["children"][0]["accounts"] == 2
    assert root["children"][0]["groups"]["1"] == 1
    assert root["children"][0]["groups"]["6"] == 1
    assert root["children"][0]["dominant_group"] == 6

    oblast_id = root["children"][0]["id"]
    cities = api(specialist_a).get(f"/api/v1/accounts/map/?parent={oblast_id}").json()
    assert [child["name"] for child in cities["children"]] == ["Минск"]

    house = Account.objects.get(account_id=11).territory
    listed = api(specialist_a).get(f"/api/v1/accounts/?territory={house.id}").json()
    assert listed["count"] == 2


def test_supplier_map_keeps_one_bubble_per_place(api, org_a):
    for offset, group in ((31, 1), (32, 4)):
        account = make_account(org_a, offset, house_address=f"г. Минск, ул. Тестовая, д. {offset}", debt_group=group)
        AccountService.objects.create(
            organization=org_a, account=account, service_list_id=offset, service_id=offset,
            service_name="Вода", provider_id=501, balance_out=10,
        )
    supplier = make_user("map_sup", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    house = ServiceOrganization.objects.get(organization=org_a, provider_id=501)
    house.is_supplier = True
    house.save(update_fields=["is_supplier", "updated_at"])
    supplier.service_organizations.add(house)
    TerritoryIndex().assign_queryset(Account.objects.filter(organization=org_a))
    body = api(supplier).get("/api/v1/accounts/map/").json()
    assert [child["name"] for child in body["children"]] == ["Минская область"]
    assert body["children"][0]["accounts"] == 2


def test_manual_group_is_the_bubble_group(api, specialist_a, org_a):
    account = make_account(org_a, 21, house_address="г. Брест, ул. Советская, д. 8", debt_group=1)
    account.debt_group_manual = 4
    account.save(update_fields=["debt_group_manual"])
    TerritoryIndex().assign_queryset(Account.objects.filter(pk=account.pk))
    body = api(specialist_a).get("/api/v1/accounts/map/").json()
    assert body["children"][0]["name"] == "Брестская область"
    assert body["children"][0]["dominant_group"] == 4


def test_address_without_a_place_is_not_a_path():
    assert AddressPath().steps("   ") == []
    assert AddressPath().steps("---") == []


def test_dzerzhinsk_hangs_on_minsk_oblast_without_a_district():
    steps = AddressPath().steps("г. Дзержинск, ул. Советская, д. 2")
    assert [name for _kind, name, _key in steps] == [
        "Беларусь", "Минская область", "Дзержинск", "ул. Советская", "д. 2",
    ]


def _sample_catalog() -> StreetCatalog:
    places = [
        PlaceHit("Могилёв", "могилев", "Могилёвская область", "могилевская область", 53.894, 30.331, 1),
        PlaceHit("Минск", "минск", "Минская область", "минская область", 53.9006, 27.559, 1),
        PlaceHit("Брест", "брест", "Брестская область", "брестская область", 52.097, 23.734, 1),
    ]
    streets = [
        StreetHit("ул. Челюскинцев", "ул. челюскинцев", "Могилёв", "могилев", "Могилёвская область", "могилевская область", 53.91, 30.34),
        StreetHit("ул. Ленина", "ул. ленина", "Могилёв", "могилев", "Могилёвская область", "могилевская область", 53.90, 30.35),
        StreetHit("ул. Ленина", "ул. ленина", "Минск", "минск", "Минская область", "минская область", 53.92, 27.56),
    ]
    return StreetCatalog.from_rows(streets, places)


def test_ais_prefixes_keep_the_house_under_the_street():
    parser = AddressPath(StreetCatalog.empty())
    cases = (
        ("наб. Франциска Скорины, д.32", "наб. Франциска Скорины", "д. 32"),
        ("пр-д Бумажкова, д.12", "проезд Бумажкова", "д. 12"),
        ("тр-т Логойский, д.31", "тракт Логойский", "д. 31"),
        ("пр-т Победителей, д.5", "просп. Победителей", "д. 5"),
    )
    for address, street, house in cases:
        names = [name for _kind, name, _key in parser.steps(address)]
        assert names[-2:] == [street, house]


def test_unique_street_without_a_city_uses_the_catalog(org_a):
    account = make_account(org_a, 71, house_address="ул. Челюскинцев, д.124")
    TerritoryIndex(_sample_catalog()).assign_queryset(Account.objects.filter(pk=account.pk))
    account.refresh_from_db()
    assert _chain(account) == ["Беларусь", "Могилёвская область", "Могилёв", "ул. Челюскинцев", "д. 124"]
    assert float(account.territory.parent.latitude) == 53.91


def test_ambiguous_street_follows_the_schema_name(org_a):
    org_a.name = "Могилев МОЦИС"
    org_a.save(update_fields=["name", "updated_at"])
    account = make_account(org_a, 72, house_address="ул. Ленина, д.3")
    TerritoryIndex(_sample_catalog()).assign_queryset(Account.objects.filter(pk=account.pk))
    account.refresh_from_db()
    assert _chain(account)[2] == "Могилёв"
    assert float(account.territory.parent.longitude) == 30.35


def test_ambiguous_street_without_a_hint_is_not_assigned_to_a_random_city(org_a):
    account = make_account(org_a, 73, house_address="ул. Ленина, д.3")
    TerritoryIndex(_sample_catalog()).assign_queryset(Account.objects.filter(pk=account.pk))
    account.refresh_from_db()
    assert "Без населённого пункта" in _chain(account)


def test_unknown_street_stays_near_the_schema_city(org_a):
    org_a.name = "Могилев МОЦИС"
    org_a.save(update_fields=["name", "updated_at"])
    account = make_account(org_a, 74, house_address="ул. Новая, д.1")
    TerritoryIndex(_sample_catalog()).assign_queryset(Account.objects.filter(pk=account.pk))
    account.refresh_from_db()
    assert _chain(account)[2] == "Могилёв"
    assert abs(float(account.territory.parent.latitude) - 53.894) < 0.05


def test_catalog_street_overrides_the_hardcoded_point(org_a):
    catalog = StreetCatalog.from_rows([
        StreetHit("ул. Кольцова", "ул. кольцова", "Минск", "минск", "Минская область", "минская область", 53.9515, 27.5918),
    ], [])
    account = make_account(org_a, 75, house_address="г. Минск, Московский район, мкр. Грушевка, ул. Кольцова, д. 4")
    TerritoryIndex(catalog).assign_queryset(Account.objects.filter(pk=account.pk))
    account.refresh_from_db()
    assert "Грушевка" not in _chain(account)
    assert "Московский район" not in _chain(account)
    assert "Советский район" in _chain(account)
    assert float(account.territory.parent.latitude) == 53.9515
    assert float(account.territory.parent.longitude) == 27.5918


def test_numbered_house_uses_its_own_point(org_a):
    catalog = StreetCatalog.from_rows([
        StreetHit("ул. Кольцова", "ул. кольцова", "Минск", "минск", "Минская область", "минская область", 53.9515, 27.5918),
    ], [])
    catalog._houses[("минск", "ул. кольцова", "4")] = (53.9522, 27.5931, "минская область")
    account = make_account(org_a, 77, house_address="г. Минск, ул. Кольцова, д. 4")
    TerritoryIndex(catalog).assign_queryset(Account.objects.filter(pk=account.pk))
    account.refresh_from_db()
    assert float(account.territory.latitude) == 53.9522
    assert float(account.territory.longitude) == 27.5931


def test_short_street_name_uses_the_full_osm_name(org_a):
    catalog = StreetCatalog.from_rows([
        StreetHit("ул. Максима Богдановича", "ул. максима богдановича", "Минск", "минск", "Минская область", "минская область", 53.9273, 27.5737),
        StreetHit("пер. Максима Богдановича", "пер. максима богдановича", "Минск", "минск", "Минская область", "минская область", 53.9462, 27.587),
    ], [])
    account = make_account(org_a, 76, house_address="г. Минск, ул. Богдановича, д. 80")
    TerritoryIndex(catalog).assign_queryset(Account.objects.filter(pk=account.pk))
    account.refresh_from_db()
    assert float(account.territory.parent.latitude) == 53.9273
    assert float(account.territory.parent.longitude) == 27.5737


def test_schema_hint_accepts_latin_c_in_brest():
    catalog = StreetCatalog.from_rows([], [
        PlaceHit("Брест", "брест", "Брестская область", "брестская область", 52.097, 23.734, 1),
    ])
    hinted = "Бре" + "c" + "т ЖРЭУ г.Брест"
    place = catalog.place_from_hint(hinted)
    assert place is not None
    assert place.name == "Брест"


def test_map_tile_rejects_a_foreign_name(client):
    assert client.get("/maps/other.pmtiles").status_code == 404


def test_map_tile_returns_the_requested_range(client):
    from django.conf import settings

    path = settings.BASE_DIR.parent / "maps" / "belarus.pmtiles"
    if not path.is_file():
        pytest.skip("файла подложки нет")
    response = client.get("/maps/belarus.pmtiles", HTTP_RANGE="bytes=0-15")
    assert response.status_code == 206
    body = b"".join(response.streaming_content)
    assert body.startswith(b"PMTiles")
    assert len(body) == 16
    assert response.headers["Content-Length"] == "16"


def test_shipped_catalog_knows_chelyuskintsev():
    catalog = StreetCatalog.load()
    if catalog.is_empty:
        pytest.skip("справочник улиц ещё не собран")
    hit = catalog.resolve("ул. челюскинцев", "", "", "Могилев МОЦИС")
    assert hit is not None
    assert hit.settlement_key == "могилев"

