from apps.debts.models import Account, Territory
from apps.debts.services.territory import AddressPath, TerritoryIndex

from .conftest import make_account


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
        "Беларусь", "Минская область", "Минск", "Московский район", "Грушевка", "ул. Корженевского", "д. 10",
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
    TerritoryIndex().assign_queryset(Account.objects.filter(pk=account.pk))
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
