"""UC-EVT-01: сценарий прозванивает партию заглушкой AMI, специалист статусы не вводит."""

from datetime import datetime, time
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.debts.models import AccountService, Contact, Measure, MeasureItem
from apps.debts.services.autocall import dial_due_calls
from apps.notifications.models import MessageTemplate
from apps.nsi.models import CalculationSettings, ScenarioDefinition
from apps.nsi.services.scenario_engine import ensure_imported_run
from apps.nsi.services.scenarios import ensure_standard_scenario

from .conftest import make_account


def _owing(org, number, group, phone):
    account = make_account(org, number, client_account=f"{number:08d}", contact_phone=phone)
    account.debt_group = group
    account.short_fio = "Иванов И.И."
    account.save(update_fields=["debt_group", "short_fio"])
    AccountService.objects.create(
        organization=org, account=account, service_list_id=1, service_id=number,
        service_name="Отопление", balance_out=Decimal("80"), debt_period=group, debt_group=group,
    )
    return account


def _at(day, hour, minute=0):
    moment = datetime(2026, 10, day, hour, minute)
    return timezone.make_aware(moment, timezone.get_current_timezone())


@pytest.mark.django_db
def test_uc_evt_01_stub_fills_statuses_without_manual_entry(api, admin_a, org_a, fake_gateway):
    org_a.outgoing_numbers = ["80172000001", "+375172000002"]
    org_a.save(update_fields=["outgoing_numbers"])
    MessageTemplate.objects.create(
        organization=org_a, code="voice-debt", name="Автообзвон", channel="voice",
        body="Долг {fio} по счёту {account}",
    )
    person = _owing(org_a, 9301, 2, "+375291112233")
    legal = _owing(org_a, 9302, 2, "+375291112244")
    legal.payer_unp = "190000001"
    legal.payer_identifier = ""
    legal.save(update_fields=["payer_unp", "payer_identifier"])
    paused = _owing(org_a, 9303, 2, "+375291112255")
    ensure_imported_run(person)
    ensure_imported_run(legal)
    ensure_imported_run(paused)
    paused.inheritance_case = True
    paused.save(update_fields=["inheritance_case"])

    scenario = ScenarioDefinition.objects.get(organization=None, name="Стандартное взыскание")
    repeat = scenario.steps[0]["repeat"]
    assert repeat["1"]["every_days"] == 1
    assert repeat["2"]["every_days"] == 1
    assert repeat["3"]["every_days"] == 3
    assert repeat["4"]["once"] is True

    party = Measure.objects.get(accounts=person, kind=Measure.Kind.CALL, status=Measure.Status.ASSIGNED)
    from apps.debts.services.autocall import call_window

    assert (party.time_from, party.time_to) == call_window(scenario, timezone.localdate())
    assert (party.time_from, party.time_to) != (time(9, 0), time(18, 0))
    assert party.items.get().call_result == ""

    early = dial_due_calls(_at(12, 18, 30))
    assert early["dialed"] == 0
    morning = dial_due_calls(_at(27, 10, 0))
    assert morning["dialed"] == 0

    done = dial_due_calls(_at(27, 18, 30))
    assert done["dialed"] == 1
    assert dial_due_calls(_at(27, 19, 0))["dialed"] == 0

    item = party.items.get()
    item.refresh_from_db()
    party.refresh_from_db()
    assert item.call_result == MeasureItem.CallResult.ANSWERED
    assert item.duration_sec == 36
    assert item.listen_percent == 72
    assert item.external_call is False
    assert item.recording_ref == ""
    assert item.caller_id == "+375172000001"
    assert item.provider_message_id.startswith("voice-")
    assert item.phone == "+375291112233"
    assert party.status == Measure.Status.DONE
    assert MeasureItem.objects.get(account=legal).call_result == ""
    assert MeasureItem.objects.get(account=paused).call_result == ""

    payload = fake_gateway.sent[-1]["dial"]
    assert payload["phone"] == "+375291112233"
    assert payload["text"] == "Долг Иванов И.И. по счёту 00009301"
    assert payload["caller_id"] == "+375172000001"
    assert payload["record"] is False
    assert payload["transfer"] is False

    detail = api(admin_a).get(f"/api/v1/measures/{party.id}/")
    body = detail.json()["items"][0]
    assert body["external_call"] is False
    assert body["call_result"] == "answered"
    assert any("Внешний вызов не выполнялся" in event["reason"] for event in detail.json()["events"])
    assert any("+375172000001" in event["reason"] for event in detail.json()["events"])

    card = api(admin_a).get(f"/api/v1/accounts/{person.id}/measures/")
    line = next(row["account_call_line"] for row in card.json()["results"] if row["id"] == party.id)
    assert "Дозвон" in line
    assert "Внешний вызов не выполнялся" in line

    denied = api(admin_a).patch(
        "/api/v1/nsi/scenarios/calling/",
        {"call_legal": False, "call_recording": True, "outgoing_numbers": []},
        format="json",
    )
    assert denied.status_code == 400
    saved = api(admin_a).patch(
        "/api/v1/nsi/scenarios/calling/",
        {"call_legal": False, "outgoing_numbers": ["+375172000001"]},
        format="json",
    )
    assert saved.status_code == 200, saved.content
    assert saved.json()["call_recording"] is False
    assert saved.json()["call_transfer"] is False
    assert saved.json()["outgoing_numbers"] == ["+375172000001"]
    foreign = api(admin_a).patch(
        "/api/v1/nsi/scenarios/calling/",
        {"call_legal": False, "outgoing_numbers": ["+491511234567"]},
        format="json",
    )
    assert foreign.status_code == 400


@pytest.mark.django_db
def test_manual_call_writes_the_same_row_without_the_stub_sentence(api, admin_a, account_a):
    account_a.debt_group = 1
    account_a.save(update_fields=["debt_group"])
    created = api(admin_a).post(
        "/api/v1/measures/",
        {
            "kind": "call", "account_ids": [account_a.id], "template_name": "Напоминание",
            "time_from": "18:00", "time_to": "21:00",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    measure_id = created.json()["id"]
    item_id = created.json()["items"][0]["id"]
    result = api(admin_a).post(
        f"/api/v1/measures/{measure_id}/result/",
        {
            "item_id": item_id, "call_result": "answered", "duration_sec": 40, "listen_percent": 80,
            "recording_ref": "https://pbx.example/rec/1.wav",
        },
        format="json",
    )
    assert result.status_code == 200, result.content
    item = result.json()["items"][0]
    assert item["call_result"] == "answered"
    assert item["duration_sec"] == 40
    assert item["listen_percent"] == 80
    assert item["external_call"] is None
    assert item["recording_ref"] == "https://pbx.example/rec/1.wav"
    assert MeasureItem.objects.filter(measure_id=measure_id).count() == 1
    card = api(admin_a).get(f"/api/v1/accounts/{account_a.id}/measures/")
    line = next(row["account_call_line"] for row in card.json()["results"] if row["id"] == measure_id)
    assert "Дозвон" in line
    assert "запись https://pbx.example/rec/1.wav" in line
    assert "не выполнялся" not in line


@pytest.mark.django_db
def test_group_frequency_comes_from_the_step(org_a, admin_a, fake_gateway):
    rare = _owing(org_a, 9401, 3, "+375291110202")
    once = _owing(org_a, 9402, 4, "+375291110302")
    _assign(org_a, admin_a, rare, "Реже", {"3": {"every_days": 2}})
    _assign(org_a, admin_a, once, "Разово", {"4": {"once": True}})

    org_a.outgoing_numbers = ["+375172000001", "+375172000002"]
    org_a.save(update_fields=["outgoing_numbers"])
    assert dial_due_calls(_at(27, 18, 30))["dialed"] == 2
    rare_item = MeasureItem.objects.get(account=rare)
    once_item = MeasureItem.objects.get(account=once)
    assert rare_item.call_result == "no_answer"
    assert once_item.call_result == "no_answer"
    assert rare_item.caller_id == "+375172000001"
    assert once_item.caller_id == "+375172000002"
    assert dial_due_calls(_at(27, 19, 0))["dialed"] == 0
    assert dial_due_calls(_at(28, 18, 30))["dialed"] == 0
    assert dial_due_calls(_at(29, 18, 30))["dialed"] == 1
    rare_item.refresh_from_db()
    assert rare_item.caller_id == "+375172000001"
    assert Measure.objects.filter(accounts=once, kind=Measure.Kind.CALL).count() == 1
    assert Measure.objects.filter(accounts=rare, kind=Measure.Kind.CALL).count() == 1


@pytest.mark.django_db
def test_answered_call_is_not_repeated_and_a_miss_retries_next_evening(org_a, admin_a, fake_gateway):
    from apps.nsi.services.scenarios import CALL_REPEAT, assign_run

    missed = _owing(org_a, 9701, 2, "+375291110102")
    reached = _owing(org_a, 9702, 1, "+375291110133")
    scenario = _scenario(org_a, "Каждый вечер", CALL_REPEAT)
    assign_run(missed, scenario, admin_a)
    assign_run(reached, scenario, admin_a)
    assert dial_due_calls(_at(27, 18, 30))["dialed"] == 2
    assert MeasureItem.objects.get(account=missed).call_result == "no_answer"
    assert MeasureItem.objects.get(account=reached).call_result == "answered"
    assert dial_due_calls(_at(27, 20, 0))["dialed"] == 0
    assert dial_due_calls(_at(28, 18, 30))["dialed"] == 1
    assert MeasureItem.objects.get(account=reached).status == MeasureItem.Status.DONE
    assert Measure.objects.filter(accounts=reached, kind=Measure.Kind.CALL).count() == 1


@pytest.mark.django_db
def test_weekend_dials_mobile_and_weekday_evening_can_dial_city(org_a, admin_a, fake_gateway):
    from apps.nsi.services.scenarios import assign_run

    settings = CalculationSettings.load()
    settings.dial_mobile_from_day = 28
    settings.dial_mobile_weekdays = [5, 6]
    settings.dial_mobile_from_hour = None
    settings.dial_mobile_to_hour = None
    settings.save()
    account = _owing(org_a, 9501, 1, "")
    account.contact_phone = ""
    account.phone = ""
    account.save(update_fields=["contact_phone", "phone"])
    Contact.objects.create(
        organization=org_a, account=account, kind=Contact.Kind.CITY, value="+375172220002",
        source=Contact.Source.PM, priority=9,
    )
    Contact.objects.create(
        organization=org_a, account=account, kind=Contact.Kind.MOBILE, value="+375291110202",
        source=Contact.Source.PM, priority=1,
    )
    scenario = _scenario(org_a, "Номер", {"1": {"every_days": 1}})
    assign_run(account, scenario, admin_a)
    assert dial_due_calls(_at(27, 18, 30))["dialed"] == 1
    item = MeasureItem.objects.get(account=account)
    assert item.phone == "+375172220002"
    assert dial_due_calls(_at(31, 11, 0))["dialed"] == 1
    item.refresh_from_db()
    assert item.phone == "+375291110202"


def _scenario(org, name, repeat):
    steps = [{
        "order": 1, "action": "call", "wait_days": 0, "template": "Голос", "terminal": True,
        "repeat": repeat,
    }]
    scenario = ScenarioDefinition.objects.create(
        organization=org, name=name, status=ScenarioDefinition.Status.ACTIVE, version=1, steps=steps,
    )
    from apps.nsi.models import ScenarioRevision

    ScenarioRevision.objects.create(scenario=scenario, version=1, steps=steps)
    return scenario


def _assign(org, user, account, name, repeat):
    from apps.nsi.services.scenarios import assign_run

    assign_run(account, _scenario(org, name, repeat), user)


@pytest.mark.django_db
def test_standard_window_replaces_the_office_hours_placeholder(org_a):
    from apps.debts.services.autocall import call_window

    ensure_standard_scenario()
    account = _owing(org_a, 9601, 1, "+375291112233")
    ensure_imported_run(account)
    party = Measure.objects.get(accounts=account, kind=Measure.Kind.CALL)
    scenario = ScenarioDefinition.objects.get(pk=party.source_scenario_id)
    assert (party.time_from, party.time_to) == call_window(scenario, timezone.localdate())
    assert party.time_from != time(9, 0)


def _open_call(api, admin, account):
    created = api(admin).post(
        "/api/v1/measures/",
        {
            "kind": "call",
            "account_ids": [account.id],
            "template_name": "Напоминание",
            "time_from": "00:00",
            "time_to": "23:59:59",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    return created.json()["id"]


@pytest.mark.django_db
def test_specialist_dials_open_party_from_the_card(api, admin_a, specialist_a, account_a, fake_gateway):
    party_id = _open_call(api, admin_a, account_a)
    response = api(specialist_a).post(f"/api/v1/measures/{party_id}/dial/", {}, format="json")
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["dialed"] == 1
    item = MeasureItem.objects.get(measure_id=party_id)
    assert item.call_result == MeasureItem.CallResult.ANSWERED
    assert item.external_call is False
    again = api(specialist_a).post(f"/api/v1/measures/{party_id}/dial/", {}, format="json")
    assert again.status_code == 400
    assert "закрыта" in again.content.decode()


@pytest.mark.django_db
def test_dial_outside_the_measure_window_keeps_the_row(api, admin_a, specialist_a, account_a, fake_gateway):
    now = timezone.localtime()
    other = (now.hour + 12) % 24
    created = api(admin_a).post(
        "/api/v1/measures/",
        {
            "kind": "call",
            "account_ids": [account_a.id],
            "template_name": "Напоминание",
            "time_from": f"{other:02d}:00",
            "time_to": f"{other:02d}:10",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    response = api(specialist_a).post(f"/api/v1/measures/{created.json()['id']}/dial/", {}, format="json")
    assert response.status_code == 400
    assert "окна" in response.content.decode()
    item = MeasureItem.objects.get(measure_id=created.json()["id"])
    assert item.call_result == ""


@pytest.mark.django_db
def test_observer_and_supplier_cannot_dial(api, admin_a, observer_a, account_a, org_a, fake_gateway):
    from apps.users.models import User

    from .conftest import make_user

    party_id = _open_call(api, admin_a, account_a)
    observer = api(observer_a).post(f"/api/v1/measures/{party_id}/dial/", {}, format="json")
    assert observer.status_code == 403
    supplier = make_user("sup_dial", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    denied = api(supplier).post(f"/api/v1/measures/{party_id}/dial/", {}, format="json")
    assert denied.status_code == 403
    item = MeasureItem.objects.get(measure_id=party_id)
    assert item.call_result == ""
    denied = api(observer_a).post("/api/v1/measures/conduct/", {"ids": [party_id]}, format="json")
    assert denied.status_code == 403
    supplier_batch = api(supplier).post("/api/v1/measures/conduct/", {"ids": [party_id]}, format="json")
    assert supplier_batch.status_code == 403


@pytest.mark.django_db
def test_measure_card_lists_every_account_of_the_step(api, admin_a, org_a):
    from apps.nsi.services.scenarios import assign_run

    first = _owing(org_a, 9801, 1, "+375291110301")
    second = _owing(org_a, 9802, 1, "+375291110302")
    scenario = _scenario(org_a, "Один шаг", {"1": {"every_days": 1}})
    assign_run(first, scenario, admin_a)
    assign_run(second, scenario, admin_a)
    opened = Measure.objects.get(accounts=first, kind=Measure.Kind.CALL)
    response = api(admin_a).get(f"/api/v1/measures/{opened.pk}/")
    assert response.status_code == 200, response.content
    body = response.json()
    numbers = {row["client_account"] for row in body["items"]}
    assert first.client_account in numbers
    assert second.client_account in numbers
    assert body["campaign_total"] == 2
    assert {row["measure"] for row in body["items"]} == {
        opened.pk,
        Measure.objects.get(accounts=second, kind=Measure.Kind.CALL).pk,
    }


@pytest.mark.django_db
def test_registry_conduct_dials_manual_and_skips_scenario(
    api, admin_a, specialist_a, org_a, account_a, fake_gateway,
):
    from apps.nsi.services.scenarios import assign_run

    manual = _open_call(api, admin_a, account_a)
    person = _owing(org_a, 9811, 1, "+375291110401")
    assign_run(person, _scenario(org_a, "Сценарий", {"1": {"every_days": 1}}), admin_a)
    scenario_id = Measure.objects.get(accounts=person, kind=Measure.Kind.CALL).pk
    response = api(specialist_a).post(
        "/api/v1/measures/conduct/", {"ids": [manual, scenario_id]}, format="json",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["dialed"] == 1
    assert any(row["id"] == scenario_id and "сценари" in row["reason"].lower() for row in body["skipped"])
    assert MeasureItem.objects.get(measure_id=manual).call_result == MeasureItem.CallResult.ANSWERED
    assert MeasureItem.objects.get(measure_id=scenario_id).call_result == ""
