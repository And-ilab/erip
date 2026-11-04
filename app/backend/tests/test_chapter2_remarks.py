"""Замечания главы 2: режим организации, даты сценария, шаги и столбцы реестра."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.debts.models import AccountScenarioRun, Measure, MeasureItem, MeasureTask, RegistryPreference
from apps.nsi.models import ScenarioDefinition, ServiceScenarioMode
from apps.nsi.services.scenario_engine import advance_account, ensure_imported_run
from apps.users.models import ServiceOrganization, User

from .conftest import make_account, make_user


def _mode(account, launch):
    org = ServiceOrganization.objects.get(organization=account.organization, provider_id=account.provider_id)
    row, _created = ServiceScenarioMode.objects.get_or_create(service_organization=org)
    row.launch = launch
    row.save(update_fields=["launch", "updated_at"])
    return row


def _debtor(org, number, months, balance="80"):
    group = 3 if months >= 3 else 2 if months >= 2 else 1
    account = make_account(
        org, number, client_account=f"{number:08d}", contact_phone="+375291110000",
        months_debt=months, debt_group=group, balance_out=Decimal(balance),
    )
    from apps.debts.models import AccountService

    AccountService.objects.create(
        organization=org, account=account, service_list_id=number, service_id=number,
        service_name="Отопление", balance_out=Decimal(balance), balance_mulct_out=Decimal("0"),
        debt_period=months, debt_group=group,
    )
    return account


@pytest.mark.django_db
def test_manual_org_assigns_scenario_and_waits_for_the_button(org_a):
    account = _debtor(org_a, 9401, 5)
    _mode(account, ServiceScenarioMode.Launch.MANUAL)
    ensure_imported_run(account)
    run = AccountScenarioRun.objects.get(account=account)
    assert run.assigned_on == timezone.localdate()
    assert run.awaiting_start is True
    assert run.finished_on is None
    assert not Measure.objects.filter(accounts=account, source_scenario__isnull=False).exclude(status="failed").exists()
    from apps.debts.services.scenario_flow import start_accounts

    start_accounts([account], None)
    run.refresh_from_db()
    assert run.awaiting_start is False
    assert Measure.objects.filter(accounts=account, source_action="call").exists()
    assert not Measure.objects.filter(accounts=account, kind=Measure.Kind.COLLECTION).exists()


@pytest.mark.django_db
def test_auto_org_waits_for_a_manual_assignment(org_a, admin_a):
    account = _debtor(org_a, 9402, 5)
    _mode(account, ServiceScenarioMode.Launch.AUTO)
    ensure_imported_run(account)
    assert not AccountScenarioRun.objects.filter(account=account).exists()
    assert not Measure.objects.filter(accounts=account).exists()
    from apps.debts.services.scenario_flow import default_scenario, replace_accounts

    replace_accounts([account], default_scenario(account), admin_a)
    run = AccountScenarioRun.objects.get(account=account)
    assert run.awaiting_start is False
    assert run.assigned_on == timezone.localdate()
    assert Measure.objects.filter(accounts=account, source_action="call").exists()
    assert not Measure.objects.filter(accounts=account, kind=Measure.Kind.COLLECTION).exists()


@pytest.mark.django_db
def test_replacing_a_scenario_closes_the_old_one(org_a, admin_a):
    account = _debtor(org_a, 9403, 5)
    _mode(account, ServiceScenarioMode.Launch.AUTO)
    from apps.debts.services.scenario_flow import default_scenario, replace_accounts

    replace_accounts([account], default_scenario(account), admin_a)
    other = ScenarioDefinition.objects.create(
        organization=org_a, name="Свой", status=ScenarioDefinition.Status.ACTIVE, version=1,
        steps=[{"order": 1, "action": "sms", "wait_days": 0, "template": "Письмо", "terminal": True, "blocks_next": False}],
    )
    replace_accounts([account], other, admin_a)
    run = AccountScenarioRun.objects.get(account=account)
    assert run.scenario_id == other.pk
    assert run.assigned_on == timezone.localdate()
    closed = account.scenario_assignments.exclude(scenario=other).get()
    assert closed.finished_on == timezone.localdate()
    assert closed.finish_reason == "сценарий заменён"
    assert Measure.objects.filter(accounts=account, finish_reason="сценарий заменён").exists()


@pytest.mark.django_db
def test_zero_debt_closes_measures_and_scenario(org_a, admin_a):
    account = _debtor(org_a, 9404, 5)
    _mode(account, ServiceScenarioMode.Launch.AUTO)
    from apps.debts.services.scenario_flow import default_scenario, replace_accounts

    replace_accounts([account], default_scenario(account), admin_a)
    account.balance_out = Decimal("0")
    account.save(update_fields=["balance_out"])
    account.services.update(balance_out=Decimal("0"), balance_mulct_out=Decimal("0"), overdue_debt=Decimal("0"))
    from apps.debts.services.scenario_flow import settle_if_paid

    assert settle_if_paid(account) is True
    run = AccountScenarioRun.objects.get(account=account)
    assert run.finish_reason == "Долг оплачен"
    assert run.finished_on == timezone.localdate()
    assert not Measure.objects.filter(accounts=account, finish_reason="").exclude(
        status__in=["done", "cancelled"],
    ).exists()
    paid = Measure.objects.filter(accounts=account, finish_reason="Долг оплачен")
    assert paid.exists()


@pytest.mark.django_db
def test_two_months_stop_before_disconnect_and_five_months_reach_the_writ(org_a, admin_a):
    short = _debtor(org_a, 9405, 2)
    long = _debtor(org_a, 9415, 5)
    _mode(short, ServiceScenarioMode.Launch.MANUAL)
    _mode(long, ServiceScenarioMode.Launch.MANUAL)
    ensure_imported_run(short)
    ensure_imported_run(long)
    from apps.debts.services.scenario_flow import start_accounts

    start_accounts([short, long], admin_a)
    assert Measure.objects.filter(accounts=short, source_action="call").exists()
    assert not Measure.objects.filter(accounts=short, source_action__in=["warning", "disconnect", "writ"]).exists()
    assert not Measure.objects.filter(accounts=long, kind=Measure.Kind.COLLECTION).exists()
    for account in (short, long):
        call = Measure.objects.get(accounts=account, source_action="call")
        call.status = Measure.Status.DONE
        call.save(update_fields=["status", "updated_at"])
        call.items.update(status=MeasureItem.Status.DONE)
        advance_account(account)
        manual = Measure.objects.get(accounts=account, source_action="manual_call")
        manual.status = Measure.Status.DONE
        manual.save(update_fields=["status", "updated_at"])
        manual.items.update(status=MeasureItem.Status.DONE)
        advance_account(account)
    assert Measure.objects.filter(accounts=short, source_action="warning").exists()
    assert not Measure.objects.filter(accounts=short, source_action__in=["disconnect", "writ"]).exists()
    assert Measure.objects.filter(accounts=long, source_action="warning").exists()
    warning = Measure.objects.get(accounts=long, source_action="warning")
    warning.status = Measure.Status.DONE
    warning.save(update_fields=["status", "updated_at"])
    warning.items.update(status=MeasureItem.Status.DONE)
    advance_account(long)
    assert Measure.objects.filter(accounts=long, source_action="disconnect").exists()
    assert not Measure.objects.filter(accounts=long, source_action="writ").exists()


@pytest.mark.django_db
def test_measure_cannot_close_while_a_task_is_open(org_a, specialist_a, admin_a):
    account = _debtor(org_a, 9406, 5)
    _mode(account, ServiceScenarioMode.Launch.AUTO)
    from apps.debts.services.scenario_flow import default_scenario, replace_accounts

    replace_accounts([account], default_scenario(account), admin_a)
    measure = Measure.objects.filter(accounts=account).exclude(status="failed").first()
    MeasureTask.objects.create(organization=org_a, measure=measure, title="Позвонить", status=MeasureTask.Status.OPEN)
    from apps.debts.services.measures import MeasureLaunchError
    from apps.debts.services.scenario_flow import stop_measure

    with pytest.raises(MeasureLaunchError) as caught:
        stop_measure(account, measure, specialist_a)
    assert caught.value.detail["tasks"] == "сначала завершите все задания"
    measure.tasks.update(status=MeasureTask.Status.DONE, completed_on=timezone.localdate())
    stop_measure(account, measure, specialist_a)
    measure.refresh_from_db()
    assert measure.stopped is True
    assert measure.finished_on == timezone.localdate()


@pytest.mark.django_db
def test_group_zero_filter_means_empty_group(api, specialist_a, org_a):
    empty = make_account(org_a, 9407, client_account="00009407", debt_group=None, debt_group_manual=None)
    filled = make_account(org_a, 9408, client_account="00009408", debt_group=2)
    found = api(specialist_a).get("/api/v1/accounts/", {"debt_group__in": "0"})
    assert found.status_code == 200, found.content
    ids = {row["id"] for row in found.json()["results"]}
    assert empty.id in ids
    assert filled.id not in ids


@pytest.mark.django_db
def test_account_registry_drops_the_tail_columns(api, specialist_a, admin_a):
    body = api(specialist_a).get("/api/v1/accounts/columns/")
    assert body.status_code == 200, body.content
    available = body.json()["available"]
    for name in (
        "services_debt_count", "contract_number", "contract_date", "service_provider",
        "initial_principal", "initial_penalty", "period_balances", "repayment_due_on", "last_payment_date",
    ):
        assert name not in available
    contracts = api(admin_a).get("/api/v1/contracts/columns/", {"board": "services"})
    assert contracts.status_code == 200, contracts.content
    assert "initial_principal" in contracts.json()["available"]
    assert "period_balances" not in contracts.json()["available"]


@pytest.mark.django_db
def test_two_users_keep_separate_column_sets(api, org_a):
    first = make_user("spec_cols_a", User.Role.SPECIALIST, org_a, last_name="Один", first_name="Иван", middle_name="Петрович")
    second = make_user("spec_cols_b", User.Role.SPECIALIST, org_a, last_name="Два", first_name="Пётр", middle_name="Иванович")
    saved = api(first).put("/api/v1/accounts/columns/", {"columns": ["client_account", "short_fio"]}, format="json")
    assert saved.status_code == 200, saved.content
    other = api(second).get("/api/v1/accounts/columns/")
    assert "account_address" in other.json()["columns"]
    own = api(first).get("/api/v1/accounts/columns/")
    assert own.json()["columns"] == ["client_account", "short_fio"]
    assert RegistryPreference.objects.filter(user=first, target="accounts").exists()
    assert RegistryPreference.objects.filter(user=second, target="accounts").exists()
