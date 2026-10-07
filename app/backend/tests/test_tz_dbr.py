"""ТЗ 4.2.2: реестр договоров поставщика, наследство на всех ЛС, свои услуги."""

from datetime import date, time
from decimal import Decimal

import pytest
from django.core.management import call_command

from apps.debts.models import AccountService, Contact, DebtShare, DebtWorkItem, Measure, MeasureItem, StatusHistory
from apps.debts.services.contacts import choose_phone
from apps.debts.services.grouping import DebtGroupCalculator
from apps.debts.services.portfolio import PortfolioRefresher
from apps.nsi.models import CalculationSettings, DebtorCategory, ScenarioRule
from apps.users.models import ServiceOrganization, User

from .conftest import make_account, make_user


@pytest.fixture
def ready(org_a):
    call_command("loaddata", "debt_group_scale", verbosity=0)


def _supplier(org_a, account_a):
    water = AccountService.objects.create(
        organization=org_a, account=account_a, service_list_id=2, service_id=11,
        service_name="Вода", provider_id=900, shot_name="Водоканал", balance_out=Decimal("50"),
        balance_mulct_out=Decimal("5"), debt_period=1,
    )
    AccountService.objects.filter(account=account_a).exclude(pk=water.pk).update(provider_id=800, balance_out=Decimal("100"))
    supplier_org = ServiceOrganization.objects.create(
        organization=org_a, provider_id=900, short_name="Водоканал", is_supplier=True,
    )
    supplier = make_user("supplier_dbr", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    supplier.service_organizations.add(supplier_org)
    account_a.payer_identifier = "IN-DBR"
    account_a.save(update_fields=["payer_identifier"])
    return supplier, water


def test_supplier_card_shows_his_service_group(api, org_a, account_a):
    account_a.debt_group = 5
    account_a.scenario_name = "Взыскание через ОПИ"
    account_a.funnel_stage = "enforcement"
    account_a.rating = "D"
    account_a.rating_repeat = 1
    account_a.balance_out = Decimal("31.02")
    account_a.save()
    water = AccountService.objects.create(
        organization=org_a, account=account_a, service_list_id=2, service_id=11,
        service_name="Горячая вода", provider_id=32200087, shot_name="ГП Брестводоканал",
        balance_out=Decimal("21.84"), debt_group=1, debt_period=0, debt_started_on=date(2026, 9, 26),
    )
    power = account_a.services.exclude(pk=water.pk).get()
    power.provider_id = 29
    power.shot_name = "БЭС"
    power.service_name = "Электроэнергия"
    power.balance_out = Decimal("9.69")
    power.debt_group = 5
    power.debt_period = 15
    power.debt_started_on = date(2025, 8, 26)
    power.save()
    water_org = ServiceOrganization.objects.create(
        organization=org_a, provider_id=32200087, short_name="ГП Брестводоканал", is_supplier=True,
    )
    power_org = ServiceOrganization.objects.create(
        organization=org_a, provider_id=29, short_name="БЭС", is_supplier=True,
    )
    water_user = make_user("water_face", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    power_user = make_user("power_face", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    water_user.service_organizations.add(water_org)
    power_user.service_organizations.add(power_org)

    water_card = api(water_user).get(f"/api/v1/accounts/{account_a.id}/").json()
    assert water_card["effective_group"] == 1
    assert water_card["scenario_name"] == "Превентивный обзвон и уведомления"
    assert water_card["funnel_stage"] == "prevention"
    assert water_card["rating_label"] == "A"
    assert water_card["debt_started_on"] == "2026-09-26"
    assert Decimal(str(water_card["balance_out"])).quantize(Decimal("0.01")) == Decimal("21.84")

    power_card = api(power_user).get(f"/api/v1/accounts/{account_a.id}/").json()
    assert power_card["effective_group"] == 5
    assert power_card["scenario_name"] == "Взыскание через ОПИ"
    assert power_card["funnel_stage"] == "enforcement"
    assert power_card["debt_started_on"] == "2025-08-26"
    assert Decimal(str(power_card["balance_out"])).quantize(Decimal("0.01")) == Decimal("9.69")


def test_supplier_summary_hides_foreign_service_and_balance(api, org_a, account_a):
    supplier, water = _supplier(org_a, account_a)
    client = api(supplier)
    summary = client.get("/api/v1/contracts/summary/").json()
    assert summary["ls_count"] == 1
    assert Decimal(summary["principal"]) == Decimal("50")
    persons = client.get("/api/v1/contracts/persons/").json()["results"]
    assert persons[0]["payer_identifier"] == "IN-DBR"
    assert persons[0]["ls_count"] == 1
    assert persons[0]["payer_unp"] == ""
    card = client.get(f"/api/v1/accounts/{account_a.id}/").json()
    assert Decimal(card["balance_out"]) == Decimal("50")
    gas = account_a.services.exclude(pk=water.pk).get()
    denied = client.post(
        "/api/v1/measures/",
        {"kind": "disconnect", "account_ids": [account_a.id], "service_ids": [gas.id]},
        format="json",
    )
    assert denied.status_code == 400
    DebtWorkItem.objects.create(
        organization=org_a, account=account_a, service=gas, kind=DebtWorkItem.Kind.WARNING, title="Чужое",
    )
    titles = [row["title"] for row in client.get(f"/api/v1/accounts/{account_a.id}/work-items/").json()["results"]]
    assert "Чужое" not in titles


def test_dossier_shows_periods_contacts_and_journal(api, specialist_a, org_a, account_a, ready):
    account_a.operational_date = date(2026, 9, 1)
    account_a.payer_identifier = "IN-DBR"
    account_a.save(update_fields=["operational_date", "payer_identifier"])
    DebtGroupCalculator().recalculate(account_a, operational=date(2026, 9, 1))
    service = account_a.services.get()
    service.refresh_from_db()
    assert service.repayment_due_on == date(2026, 4, 25)
    person = account_a.registrations.get()
    patched = api(specialist_a).patch(
        f"/api/v1/registrations/{person.id}/",
        {"social_category": "Пенсионер", "unfit_for_work": True, "heritage_transfer": "accept"},
        format="json",
    )
    assert patched.status_code == 200
    created = api(specialist_a).post(
        "/api/v1/contacts/",
        {"account": account_a.id, "kind": "mobile", "value": "+375291110000", "priority": 2},
        format="json",
    )
    assert created.status_code == 201
    dossier = api(specialist_a).get(f"/api/v1/contracts/{service.id}/dossier/").json()
    assert dossier["periods"]
    assert dossier["people"][0]["social_category"] == "Пенсионер"
    assert dossier["people"][0]["unfit_for_work"] is True
    assert any(row["kind"] == "contact" for row in dossier["journal"])
    assert any(row["kind"] == "registration" for row in dossier["journal"])


def test_inheritance_pauses_every_account_and_resumes_after_the_term(api, specialist_a, org_a, account_a, ready):
    account_a.payer_identifier = "IN-DBR"
    account_a.save(update_fields=["payer_identifier"])
    other = make_account(org_a, 1002, client_account="00001002", payer_identifier="IN-DBR")
    AccountService.objects.create(
        organization=org_a, account=other, service_list_id=3, service_id=12,
        service_name="Газ", balance_out=Decimal("10"), debt_period=1,
    )
    measure = Measure.objects.create(
        organization=org_a, kind=Measure.Kind.CALL, status=Measure.Status.ASSIGNED, template_name="Шаблон",
    )
    measure.accounts.add(other)
    response = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/",
        {"inheritance_case": True, "inheritance_until": "2020-01-01"},
        format="json",
    )
    assert response.status_code == 200
    other.refresh_from_db()
    measure.refresh_from_db()
    assert other.inheritance_case is True
    assert measure.status == Measure.Status.PAUSED
    account_a.refresh_from_db()
    PortfolioRefresher().refresh_account(account_a)
    account_a.refresh_from_db()
    other.refresh_from_db()
    measure.refresh_from_db()
    assert account_a.inheritance_case is False
    assert other.inheritance_case is False
    assert measure.status == Measure.Status.ASSIGNED
    assert StatusHistory.objects.filter(account=account_a, kind="inheritance").exists()


def test_disconnect_confirmation_and_mobile_hours(api, specialist_a, account_a):
    service = account_a.services.get()
    created = api(specialist_a).post(
        "/api/v1/measures/",
        {
            "kind": "disconnect", "account_ids": [account_a.id], "service_ids": [service.id],
            "override_reason": "Проверка подтверждения приостановления",
        },
        format="json",
    )
    assert created.status_code == 201
    confirmed = api(specialist_a).post(
        f"/api/v1/measures/{created.json()['id']}/confirm/",
        {"action": "suspend", "source": "ais"},
        format="json",
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["suspension_source"] == "ais"
    assert confirmed.json()["status"] == "running"
    Contact.objects.create(
        organization=account_a.organization, account=account_a, kind=Contact.Kind.CITY, value="+375172220000",
        source=Contact.Source.PM, priority=9,
    )
    Contact.objects.create(
        organization=account_a.organization, account=account_a, kind=Contact.Kind.MOBILE, value="+375291110000",
        source=Contact.Source.PM, priority=1,
    )
    settings = CalculationSettings.load()
    settings.dial_mobile_from_hour = 18
    settings.dial_mobile_to_hour = 23
    settings.save()
    picked = choose_phone(account_a, date(2026, 9, 10), time(20, 0))
    assert picked.value == "+375291110000"
    daytime = choose_phone(account_a, date(2026, 9, 10), time(12, 0))
    assert daytime.value == "+375172220000"


def test_contract_kanban_and_saved_shape(api, specialist_a, account_a):
    columns = api(specialist_a).get("/api/v1/contracts/kanban/").json()
    assert {column["stage"] for column in columns}
    grouped = api(specialist_a).get("/api/v1/contracts/grouped/", {"group_by": "debt_group"}).json()
    assert isinstance(grouped, list)


def test_supplier_picks_service_kind_for_measure(api, org_a, account_a):
    supplier, water = _supplier(org_a, account_a)
    client = api(supplier)
    choices = client.get("/api/v1/services/choices/")
    assert choices.status_code == 200
    assert choices.json()["results"] == [{"service_id": water.service_id, "service_name": "Вода"}]
    created = client.post(
        "/api/v1/measures/",
        {
            "kind": "warning",
            "account_ids": [account_a.id],
            "catalog_service_ids": [water.service_id],
            "template_name": "Предупреждение",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    assert water.id in created.json()["service_ids"]
    foreign = client.post(
        "/api/v1/measures/",
        {
            "kind": "warning",
            "account_ids": [account_a.id],
            "catalog_service_ids": [10],
            "template_name": "Предупреждение",
        },
        format="json",
    )
    assert foreign.status_code == 400


def test_supplier_warning_needs_own_service(api, org_a, account_a):
    supplier, water = _supplier(org_a, account_a)
    client = api(supplier)
    denied = client.post(
        "/api/v1/measures/",
        {"kind": "warning", "account_ids": [account_a.id], "template_name": "Предупреждение"},
        format="json",
    )
    assert denied.status_code == 400
    allowed = client.post(
        "/api/v1/measures/",
        {
            "kind": "warning", "account_ids": [account_a.id], "service_ids": [water.id],
            "template_name": "Предупреждение",
        },
        format="json",
    )
    assert allowed.status_code == 201


def test_category_recalculates_scenario_immediately(api, specialist_a, org_a, account_a):
    service = account_a.services.get()
    service.debt_group = 4
    service.save(update_fields=["debt_group"])
    account_a.debt_group = 4
    account_a.payer_identifier = "IN-DBR"
    account_a.save(update_fields=["debt_group", "payer_identifier"])
    other = make_account(org_a, 1003, client_account="00001003", payer_identifier="IN-DBR")
    AccountService.objects.create(
        organization=org_a, account=other, service_list_id=4, service_id=13,
        service_name="Газ", balance_out=Decimal("10"), debt_group=4,
    )
    category = DebtorCategory.objects.create(organization=org_a, code="pens", name="Пенсионер")
    ScenarioRule.objects.create(group=4, category=category, name="Сценарий пенсионера")
    response = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"debtor_category": category.id}, format="json",
    )
    assert response.status_code == 200
    service.refresh_from_db()
    other.refresh_from_db()
    assert service.scenario_name == "Сценарий пенсионера"
    assert other.debtor_category_id == category.id
    assert other.services.get().scenario_name == "Сценарий пенсионера"


def test_kanban_is_one_card_per_debtor(api, org_a, specialist_a, account_a):
    account_a.payer_identifier = "IN-DBR"
    account_a.funnel_stage = "warning"
    account_a.debt_group = 2
    account_a.debt_group_manual = 5
    account_a.debt_group_manual_reason = "Комиссия"
    account_a.save(update_fields=["payer_identifier", "funnel_stage", "debt_group", "debt_group_manual", "debt_group_manual_reason"])
    AccountService.objects.create(
        organization=org_a, account=account_a, service_list_id=8, service_id=18,
        service_name="Свет", balance_out=Decimal("20"),
    )
    columns = api(specialist_a).get("/api/v1/contracts/kanban/").json()
    warning = next(column for column in columns if column["stage"] == "warning")
    assert warning["total"] == 1
    assert warning["cards"][0]["ls_count"] == 1
    assert warning["cards"][0]["payer_identifier"] == "IN-DBR"
    assert warning["cards"][0]["debt_group"] == 5
    assert warning["cards"][0]["service_name"] == "Газ"
    assert warning["cards"][0]["service_count"] == 2
    assert "penalty" in warning["cards"][0]
    assert "due_on" in warning["cards"][0]


def test_contract_kanban_moves_like_the_account_board(api, org_a, org_b, specialist_a, observer_a, account_a):
    columns = api(specialist_a).get("/api/v1/contracts/kanban/").json()
    card = next(item for column in columns for item in column["cards"] if account_a.id in item["account_ids"])
    moved = api(specialist_a).post(
        "/api/v1/contracts/stage/",
        {"account_ids": card["account_ids"], "funnel_stage": "disconnect", "funnel_reason": "Проверка переноса этапа"},
        format="json",
    )
    assert moved.status_code == 200
    account_a.refresh_from_db()
    assert account_a.funnel_stage == "disconnect"
    assert account_a.funnel_locked is True
    board = api(specialist_a).get("/api/v1/contracts/kanban/").json()
    disconnect = next(column for column in board if column["stage"] == "disconnect")
    assert any(account_a.id in item["account_ids"] for item in disconnect["cards"])
    assert api(observer_a).post(
        "/api/v1/contracts/stage/",
        {"account_ids": [account_a.id], "funnel_stage": "warning", "funnel_reason": "Проверка переноса этапа"},
        format="json",
    ).status_code == 403
    foreign = make_account(org_b, 777)
    denied = api(specialist_a).post(
        "/api/v1/contracts/stage/",
        {"account_ids": [account_a.id, foreign.id], "funnel_stage": "court", "funnel_reason": "Проверка переноса этапа"},
        format="json",
    )
    assert denied.status_code == 404
    account_a.refresh_from_db()
    assert account_a.funnel_stage == "disconnect"
    supplier, _water = _supplier(org_a, account_a)
    assert api(supplier).post(
        "/api/v1/contracts/stage/",
        {"account_ids": [account_a.id], "funnel_stage": "warning", "funnel_reason": "Проверка переноса этапа"},
        format="json",
    ).status_code == 400


def test_contract_calendar_creates_an_event_on_the_chosen_day(api, specialist_a, observer_a, account_a):
    created = api(specialist_a).post("/api/v1/contracts/events/", {
        "kind": "scenario", "scenario_name": "Мягкий", "started_on": "2026-11-02", "due_on": "2026-11-02",
    }, format="json")
    assert created.status_code == 201
    rows = api(specialist_a).get("/api/v1/contracts/calendar/", {"date_from": "2026-11-02", "date_to": "2026-11-02"}).json()
    assert any(row.get("measure_id") == created.json()["id"] for row in rows)
    denied = api(observer_a).post("/api/v1/contracts/events/", {
        "kind": "scenario", "scenario_name": "Мягкий", "started_on": "2026-11-02", "due_on": "2026-11-02",
    }, format="json")
    assert denied.status_code == 403


def test_calendar_filters_one_day_or_a_range(api, specialist_a, account_a):
    account_a.warning_due = date(2026, 10, 3)
    account_a.claim_due = date(2026, 10, 20)
    account_a.save(update_fields=["warning_due", "claim_due"])
    client = api(specialist_a)
    one = client.get("/api/v1/accounts/calendar/", {"date_from": "2026-10-03", "date_to": "2026-10-03"})
    assert one.status_code == 200
    assert {row["date"] for row in one.json()} == {"2026-10-03"}
    span = client.get("/api/v1/accounts/calendar/", {"date_from": "2026-10-20", "date_to": "2026-10-03"})
    assert {row["date"] for row in span.json()} == {"2026-10-03", "2026-10-20"}
    month = client.get("/api/v1/accounts/calendar/", {"month": "2026-11"})
    assert month.status_code == 200
    assert month.json() == []
    bad = client.get("/api/v1/accounts/calendar/", {"date_from": "03.10.2026"})
    assert bad.status_code == 400


def test_account_kanban_exposes_card_marks(api, specialist_a, account_a):
    account_a.funnel_stage = "warning"
    account_a.short_fio = "Соловьёва Марина Дмитриевна"
    account_a.account_address = "г. Минск, ул. Октябрьская, д.3, кв.15"
    account_a.rating = "A"
    account_a.debt_group = 1
    account_a.assigned_to = specialist_a
    account_a.warning_due = date(2026, 7, 10)
    account_a.save()
    measure = Measure.objects.create(
        organization=account_a.organization, kind=Measure.Kind.WARNING, started_on=date(2026, 7, 5),
    )
    measure.accounts.add(account_a)
    MeasureItem.objects.create(
        organization=account_a.organization, measure=measure, account=account_a, delivered_on=date(2026, 7, 5),
    )
    columns = api(specialist_a).get("/api/v1/accounts/kanban/").json()
    titles = [column["title"] for column in columns]
    assert titles[:6] == [
        "Новый должник", "Автообзвон/уведомления", "Предупреждение вручено",
        "Отключение услуг", "Испол. надпись / иск", "ОПИ",
    ]
    warning = next(column for column in columns if column["stage"] == "warning")
    card = warning["cards"][0]
    assert card["short_fio"] == "Соловьёва Марина Дмитриевна"
    assert card["warning_handed_on"] == "2026-07-05"
    assert card["rating_label"] == "A"
    assert card["effective_group"] == 1
    assert card["assigned_name"] == "Анна Петровна"
    assert card["mulct_total"] is not None or card["debt_total"] is not None


def test_contact_is_tied_to_a_person_and_stop_date_does_not_confirm(api, specialist_a, org_a, account_a):
    person = account_a.registrations.get()
    created = api(specialist_a).post(
        "/api/v1/contacts/",
        {
            "account": account_a.id, "registration": person.id, "kind": "mobile",
            "value": "+375291110000", "priority": 1,
        },
        format="json",
    )
    assert created.status_code == 201
    assert created.json()["person_name"].startswith("Иванов")
    service = account_a.services.get()
    measure = api(specialist_a).post(
        "/api/v1/measures/",
        {
            "kind": "disconnect", "account_ids": [account_a.id], "service_ids": [service.id],
            "started_on": "2026-09-01", "override_reason": "Проверка, что дата договора не подтверждает отключение",
        },
        format="json",
    )
    assert measure.status_code == 201
    service.stop_date = date(2026, 9, 10)
    service.save(update_fields=["stop_date"])
    PortfolioRefresher().refresh_account(account_a)
    row = Measure.objects.get(pk=measure.json()["id"])
    assert row.suspension_source == ""
    assert row.suspension_confirmed_on is None
    assert row.status == Measure.Status.ASSIGNED
    legal = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/", {"legal_status": "liquidation"}, format="json",
    )
    assert legal.status_code == 200
    account_a.refresh_from_db()
    assert account_a.legal_status == "liquidation"
    assert account_a.bankruptcy is True


def test_supplier_without_organizations_sees_nothing(api, org_a, account_a):
    supplier = make_user("empty_supplier", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    client = api(supplier)
    assert client.get("/api/v1/accounts/").json()["count"] == 0
    assert client.get("/api/v1/contracts/").json()["count"] == 0


def test_supplier_cannot_rewrite_billing_fields(api, org_a, account_a):
    supplier, _water = _supplier(org_a, account_a)
    response = api(supplier).patch(
        f"/api/v1/accounts/{account_a.id}/",
        {"debt_group_manual": 3, "debt_group_manual_reason": "чужая группа"},
        format="json",
    )
    assert response.status_code == 400
    account_a.refresh_from_db()
    assert account_a.debt_group_manual is None


def test_supplier_category_and_inheritance_stay_on_visible_accounts(api, org_a, account_a):
    supplier, _water = _supplier(org_a, account_a)
    other = make_account(org_a, 4401, provider_id=800, payer_identifier="IN-DBR")
    AccountService.objects.create(
        organization=org_a, account=other, service_list_id=9, service_id=19,
        service_name="Газ", provider_id=800, balance_out=Decimal("10"), debt_group=4,
    )
    category = DebtorCategory.objects.create(organization=org_a, code="pens2", name="Пенсионер")
    client = api(supplier)
    category_response = client.patch(
        f"/api/v1/accounts/{account_a.id}/", {"debtor_category": category.id}, format="json",
    )
    assert category_response.status_code == 200
    inheritance = client.patch(
        f"/api/v1/accounts/{account_a.id}/",
        {"inheritance_case": True, "inheritance_until": "2026-12-31"},
        format="json",
    )
    assert inheritance.status_code == 200
    other.refresh_from_db()
    account_a.refresh_from_db()
    assert account_a.debtor_category_id == category.id
    assert account_a.inheritance_case is True
    assert other.debtor_category_id is None
    assert other.inheritance_case is False


def test_foreign_service_work_item_is_rejected(api, org_a, account_a):
    supplier, water = _supplier(org_a, account_a)
    gas = account_a.services.exclude(pk=water.pk).get()
    denied = api(supplier).post(
        "/api/v1/work-items/",
        {"account": account_a.id, "kind": "warning", "service": gas.id, "title": "чужая"},
        format="json",
    )
    assert denied.status_code == 400
    allowed = api(supplier).post(
        "/api/v1/work-items/",
        {"account": account_a.id, "kind": "warning", "service": water.id, "title": "своя"},
        format="json",
    )
    assert allowed.status_code == 201


def test_writ_checks_stay_unique_on_repeat_open(api, specialist_a, account_a):
    url = f"/api/v1/accounts/{account_a.id}/writ-checks/"
    first = api(specialist_a).get(url)
    second = api(specialist_a).get(url)
    assert first.status_code == 200
    assert second.status_code == 200
    assert [row["code"] for row in first.json()] == ["debt", "warning", "ownership", "package"]
    assert second.json() == first.json()
    assert account_a.writ_checks.count() == 4
    saved = api(specialist_a).post(url, {"code": "debt", "done": True}, format="json")
    assert saved.status_code == 200
    assert next(row["done"] for row in saved.json() if row["code"] == "debt") is True
    assert account_a.writ_checks.count() == 4


def test_contract_schema_label_is_billing_organization(api, specialist_a, org_a, account_a):
    row = api(specialist_a).get("/api/v1/contracts/").json()["results"][0]
    assert row["schema_label"] == "Организация A"
    assert row["billing_provider"] == account_a.provider_short_name


def test_contract_billing_filter_accepts_name_or_code(api, specialist_a, org_a, account_a):
    account_a.provider_short_name = "Тест ЖЭС"
    account_a.schema_name = "schema_a"
    account_a.save(update_fields=["provider_short_name", "schema_name"])
    client = api(specialist_a)
    by_name = client.get("/api/v1/contracts/", {"billing_provider": "Тест ЖЭС"})
    by_code = client.get("/api/v1/contracts/", {"billing_provider": str(account_a.provider_id)})
    by_schema = client.get("/api/v1/contracts/", {"billing_provider": "schema_a"})
    missing = client.get("/api/v1/contracts/", {"billing_provider": "Чужая организация"})
    assert by_name.status_code == 200
    assert by_name.json()["count"] == account_a.services.count()
    assert by_code.json()["count"] == by_name.json()["count"]
    assert by_schema.json()["count"] == by_name.json()["count"]
    assert missing.status_code == 200
    assert missing.json()["count"] == 0


def test_blank_payer_keys_stay_separate_and_bad_ids_are_400(api, specialist_a, org_a, account_a):
    account_a.payer_identifier = ""
    account_a.payer_unp = ""
    account_a.save(update_fields=["payer_identifier", "payer_unp"])
    other = make_account(org_a, 4402, payer_identifier="", payer_unp="")
    AccountService.objects.create(
        organization=org_a, account=other, service_list_id=10, service_id=20,
        service_name="Свет", balance_out=Decimal("5"),
    )
    persons = api(specialist_a).get("/api/v1/contracts/persons/").json()
    assert persons["count"] == 2
    bad_page = api(specialist_a).get("/api/v1/contracts/kanban/", {"page_size": "abc"})
    assert bad_page.status_code == 400
    service = account_a.services.get()
    bad_ids = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "disconnect", "account_ids": [account_a.id], "service_ids": ["нет"]},
        format="json",
    )
    assert bad_ids.status_code == 400
    assert service.id


def test_debt_shares_keep_parts_and_supplier_sees_only_his(api, specialist_a, org_a, account_a):
    supplier, water = _supplier(org_a, account_a)
    gas = account_a.services.exclude(pk=water.pk).get()
    account_a.balance_out = Decimal("180.00")
    account_a.balance_in = Decimal("999.00")
    account_a.pay_sum = Decimal("400.00")
    account_a.save(update_fields=["balance_out", "balance_in", "pay_sum"])
    water.balance_in = Decimal("10.00")
    water.share_service_summ = Decimal("3.00")
    water.save(update_fields=["balance_in", "share_service_summ"])
    gas.balance_in = Decimal("20.00")
    gas.save(update_fields=["balance_in"])
    rows = api(specialist_a).get(f"/api/v1/accounts/{account_a.id}/debt-shares/").json()
    by_provider = {row["provider_id"]: row for row in rows if row["provider_name"] != "Не разнесено по поставщикам"}
    assert Decimal(by_provider[900]["principal"]) == Decimal("50.00")
    assert Decimal(by_provider[900]["penalty"]) == Decimal("5.00")
    assert Decimal(by_provider[gas.provider_id]["principal"]) == Decimal("100.00")
    gap = next(row for row in rows if row["provider_name"] == "Не разнесено по поставщикам")
    assert Decimal(gap["principal"]) == Decimal("30.00")
    assert DebtShare.objects.filter(account=account_a).count() == 2
    own = api(supplier).get(f"/api/v1/accounts/{account_a.id}/debt-shares/").json()
    assert [row["provider_id"] for row in own] == [900]
    card = api(supplier).get(f"/api/v1/accounts/{account_a.id}/").json()
    assert Decimal(card["balance_out"]) == Decimal("50.00")
    assert Decimal(card["balance_in"]) == Decimal("10.00")
    assert Decimal(card["pay_sum"]) == Decimal("3.00")
    grouped = api(supplier).get("/api/v1/accounts/grouped/", {"group_by": "rating"}).json()
    assert sum(Decimal(row["debt"] or 0) for row in grouped) == Decimal("50.00")


def test_two_suppliers_set_the_same_measure_on_their_own_services(api, specialist_a, org_a, account_a):
    water_user, water = _supplier(org_a, account_a)
    gas = account_a.services.exclude(pk=water.pk).get()
    gas_org = ServiceOrganization.objects.create(
        organization=org_a, provider_id=gas.provider_id, short_name="Газ", is_supplier=True,
    )
    gas_user = make_user("supplier_gas", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    gas_user.service_organizations.add(gas_org)
    water_warning = api(water_user).post(
        "/api/v1/measures/",
        {
            "kind": "warning", "account_ids": [account_a.id], "service_ids": [water.id],
            "template_name": "Предупреждение",
        },
        format="json",
    )
    gas_warning = api(gas_user).post(
        "/api/v1/measures/",
        {
            "kind": "warning", "account_ids": [account_a.id], "service_ids": [gas.id],
            "template_name": "Предупреждение",
        },
        format="json",
    )
    assert water_warning.status_code == 201, water_warning.content
    assert gas_warning.status_code == 201, gas_warning.content
    assert water_warning.json()["owner_provider_id"] == 900
    assert gas_warning.json()["owner_provider_id"] == gas.provider_id
    assert water_warning.json()["owner_name"] == "Водоканал"
    water_seen = {
        row["id"] for row in api(water_user).get(f"/api/v1/accounts/{account_a.id}/measures/").json()["results"]
    }
    gas_seen = {
        row["id"] for row in api(gas_user).get(f"/api/v1/accounts/{account_a.id}/measures/").json()["results"]
    }
    assert water_warning.json()["id"] in water_seen
    assert gas_warning.json()["id"] not in water_seen
    assert gas_warning.json()["id"] in gas_seen
    assert water_warning.json()["id"] not in gas_seen
    billing = {
        row["id"] for row in api(specialist_a).get(f"/api/v1/accounts/{account_a.id}/measures/").json()["results"]
    }
    assert water_warning.json()["id"] in billing and gas_warning.json()["id"] in billing
    scenario = api(water_user).post(
        "/api/v1/measures/",
        {
            "kind": "scenario", "account_ids": [account_a.id], "service_ids": [water.id],
            "scenario_name": "Сценарий водоканала", "started_on": "2026-09-01",
        },
        format="json",
    )
    assert scenario.status_code == 201, scenario.content
    water.refresh_from_db()
    gas.refresh_from_db()
    account_a.refresh_from_db()
    assert water.scenario_name == "Сценарий водоканала"
    assert water.scenario_locked is True
    assert gas.scenario_name == ""
    assert account_a.scenario_name == ""
