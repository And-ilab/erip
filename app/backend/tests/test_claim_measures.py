"""Лицевой счёт из дела взыскания и счёт с долгом видны в реестре мероприятий."""

from decimal import Decimal

import pytest
from django.db.models import Count, Q
from django.utils import timezone

from apps.debts.models import Account, AccountScenarioRun, AccountService, ClaimCase, Measure, MeasureItem

from .conftest import make_account


def _accounts(payload) -> set[str]:
    found = set()
    for group in payload["groups"]:
        for row in group["results"]:
            if row["debtor_account"]:
                found.add(row["debtor_account"])
    return found


@pytest.mark.django_db
def test_claim_account_is_listed_in_measures_and_refusal_updates_the_row(api, specialist_a, account_a):
    opened = api(specialist_a).post("/api/v1/claims/", {"account": account_a.id}, format="json")
    assert opened.status_code == 201, opened.content
    case_id = opened.json()["id"]
    api(specialist_a).patch(
        f"/api/v1/claims/{case_id}/",
        {"warning_delivered_on": "2026-03-01", "notary_tariff": "12.50"},
        format="json",
    )
    api(specialist_a).post(f"/api/v1/claims/{case_id}/move/", {"stage": "lawsuit", "reason": "Спор о праве"}, format="json")

    listed = api(specialist_a).get("/api/v1/measures/registry/")
    assert listed.status_code == 200, listed.content
    assert account_a.client_account in _accounts(listed.json())
    titles = [row["title"] for group in listed.json()["groups"] for row in group["results"]]
    assert any("Исковое заявление" in title for title in titles)

    api(specialist_a).post(
        f"/api/v1/claims/{case_id}/move/",
        {"stage": "refused", "reason": "Отказ нотариуса"},
        format="json",
    )
    again = api(specialist_a).get("/api/v1/measures/registry/").json()
    titles = [row["title"] for group in again["groups"] for row in group["results"]]
    assert any("Отказ нотариуса" in title for title in titles)
    assert Measure.objects.filter(accounts=account_a, source_action="claim").count() == 1
    assert ClaimCase.objects.get(pk=case_id).stage == "refused"


def _with_group(org, number, group, period):
    account = make_account(org, number, client_account=f"{number:08d}", contact_phone="1111111")
    account.debt_group = group
    account.save(update_fields=["debt_group"])
    AccountService.objects.create(
        organization=org, account=account, service_list_id=1, service_id=number,
        service_name="Отопление", balance_out=Decimal("100"), debt_period=period, debt_group=group,
    )
    return account


@pytest.mark.django_db
def test_debt_group_opens_its_own_measure(org_a, specialist_a):
    from apps.nsi.services.scenario_engine import ensure_imported_run

    first = _with_group(org_a, 8101, 1, 1)
    second = _with_group(org_a, 8102, 2, 2)
    third = _with_group(org_a, 8103, 5, 14)
    fourth = _with_group(org_a, 8105, 6, 42)
    fourth.scenario_name = "Взыскание, безнадёжная задолженность"
    fourth.save(update_fields=["scenario_name"])
    ensure_imported_run(first)
    ensure_imported_run(second)
    ensure_imported_run(third)
    ensure_imported_run(fourth)

    assert list(Measure.objects.filter(accounts=first).values_list("kind", "template_name")) == [
        (Measure.Kind.CALL, "Голос группы 1"),
    ]
    assert set(Measure.objects.filter(accounts=second).values_list("kind", "template_name")) == {
        (Measure.Kind.WARNING, "Предупреждение"),
        (Measure.Kind.CALL, "Голос группы 2"),
    }
    row = Measure.objects.get(accounts=third)
    assert row.kind == Measure.Kind.COLLECTION
    assert row.template_name == "Взыскание через ОПИ"
    assert row.status == Measure.Status.ASSIGNED
    assert row.assignee_id == specialist_a.id
    from apps.debts.services.registry import measure_title

    hopeless = Measure.objects.get(accounts=fourth)
    assert hopeless.kind == Measure.Kind.COLLECTION
    assert measure_title(hopeless) == "Взыскание, безнадёжная задолженность"


@pytest.mark.django_db
def test_old_autodial_for_a_higher_group_is_replaced(org_a, specialist_a):
    from apps.nsi.models import ScenarioDefinition
    from apps.nsi.services.scenario_engine import ensure_imported_run
    from apps.nsi.services.scenarios import LEGACY_STANDARD_STEPS, ensure_standard_scenario

    ensure_standard_scenario()
    scenario = ScenarioDefinition.objects.get(organization=None, name="Стандартное взыскание")
    scenario.steps = LEGACY_STANDARD_STEPS
    scenario.save(update_fields=["steps", "updated_at"])
    revision = scenario.revisions.get(version=scenario.version)
    revision.steps = LEGACY_STANDARD_STEPS
    revision.save(update_fields=["steps"])
    account = _with_group(org_a, 8104, 5, 14)
    AccountScenarioRun.objects.create(
        organization=org_a, account=account, scenario=scenario, version=scenario.version,
    )
    failed = Measure.objects.create(
        organization=org_a, kind=Measure.Kind.CALL, status=Measure.Status.FAILED,
        template_name="Голос группы 1", scenario_name=scenario.name, note="Нет номера +375",
        started_on=timezone.localdate(), due_on=timezone.localdate(),
        source_scenario=scenario, source_version=scenario.version, source_step=1, source_action="call",
    )
    failed.accounts.add(account)
    MeasureItem.objects.create(
        organization=org_a, measure=failed, account=account,
        status=MeasureItem.Status.FAILED, note="Нет номера +375",
    )
    ensure_imported_run(account)
    rows = list(Measure.objects.filter(accounts=account).values_list("kind", "template_name", "status"))
    assert (Measure.Kind.CALL, "Голос группы 1", Measure.Status.FAILED) not in rows
    assert (Measure.Kind.COLLECTION, "Взыскание через ОПИ", Measure.Status.ASSIGNED) in rows
    assert Measure.objects.get(accounts=account, kind=Measure.Kind.COLLECTION).assignee_id == specialist_a.id


@pytest.mark.django_db
def test_debt_account_without_a_claim_appears_in_measures(api, specialist_a, org_a):
    account = make_account(org_a, 7701, client_account="00007701", phone="1111111", contact_phone="1111111")
    account.debt_group = 1
    account.save(update_fields=["debt_group"])
    listed = api(specialist_a).get("/api/v1/measures/registry/")
    assert listed.status_code == 200, listed.content
    assert account.client_account in _accounts(listed.json())


@pytest.mark.django_db
def test_accounts_without_measures_are_grouped_by_id():
    query = (
        Account.objects.filter(Q(debt_group__isnull=False) | Q(debt_group_manual__isnull=False))
        .order_by()
        .values("pk")
        .annotate(measure_count=Count("measures"))
        .filter(measure_count=0)
        .order_by("pk")
    )
    sql = str(query.query).lower()
    assert "group by" in sql
    assert "client_account" not in sql.split("order by", 1)[-1]


@pytest.mark.django_db
def test_assigned_autodial_without_a_group_yields_to_the_card_scenario(api, specialist_a, org_a):
    """Карточка и реестр читают шаг группы. Назначенный автообзвон без группы не остаётся вместо взыскания."""
    from apps.nsi.models import ScenarioDefinition, ScenarioRevision

    account = _with_group(org_a, 8201, 5, 14)
    account.scenario_name = "Взыскание через ОПИ"
    account.save(update_fields=["scenario_name"])
    steps = [{"order": 1, "action": "call", "wait_days": 0, "template": "Голос группы 1", "terminal": False}]
    scenario = ScenarioDefinition.objects.create(
        organization=org_a, name="Всем звонок", status=ScenarioDefinition.Status.ACTIVE, version=1, steps=steps,
    )
    ScenarioRevision.objects.create(scenario=scenario, version=1, steps=steps)
    AccountScenarioRun.objects.create(
        organization=org_a, account=account, scenario=scenario, version=1,
    )
    call = Measure.objects.create(
        organization=org_a, kind=Measure.Kind.CALL, status=Measure.Status.ASSIGNED,
        template_name="Голос группы 1", scenario_name=scenario.name,
        started_on=timezone.localdate(), due_on=timezone.localdate(),
        source_scenario=scenario, source_version=1, source_step=1, source_action="call",
    )
    call.accounts.add(account)
    MeasureItem.objects.create(
        organization=org_a, measure=call, account=account, status=MeasureItem.Status.ASSIGNED,
    )

    listed = api(specialist_a).get("/api/v1/measures/registry/")
    assert listed.status_code == 200, listed.content
    titles = [row["title"] for group in listed.json()["groups"] for row in group["results"]]
    assert "Взыскание через ОПИ" in titles
    assert not any(title.startswith("Автообзвон") for title in titles)
    opened = api(specialist_a).get(f"/api/v1/accounts/{account.id}/measures/")
    assert opened.status_code == 200, opened.content
    card_titles = [row["title"] for row in opened.json()["results"]]
    assert card_titles == ["Взыскание через ОПИ"]
    account.refresh_from_db()
    assert account.scenario_name == card_titles[0]


@pytest.mark.django_db
def test_collection_executor_is_the_pinned_billing_specialist(org_a, specialist_a):
    from apps.nsi.services.scenario_engine import ensure_imported_run
    from apps.users.models import User

    from .conftest import make_user

    pinned = make_user("spec_pin", User.Role.SPECIALIST, org_a, first_name="Борис")
    account = _with_group(org_a, 8301, 5, 14)
    account.assigned_to = pinned
    account.save(update_fields=["assigned_to"])
    ensure_imported_run(account)
    row = Measure.objects.get(accounts=account, kind=Measure.Kind.COLLECTION)
    assert row.status == Measure.Status.ASSIGNED
    assert row.assignee_id == pinned.id
    assert row.assignee_id != specialist_a.id


@pytest.mark.django_db
def test_collection_without_a_specialist_is_assigned_not_failed(org_a):
    from apps.nsi.services.scenario_engine import ensure_imported_run

    account = _with_group(org_a, 8302, 5, 14)
    ensure_imported_run(account)
    row = Measure.objects.get(accounts=account)
    assert row.kind == Measure.Kind.COLLECTION
    assert row.status == Measure.Status.ASSIGNED
    assert row.assignee_id is None
    assert "исполнител" not in (row.note or "").casefold()
