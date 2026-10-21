"""Даты сценария и меры, режим организации и закрытие при нулевом долге.

Замечание заказчика важнее шкалы групп: базовый ряд открывается по месяцам долга,
замена сценария закрывает старый, ручной режим ждёт кнопку.
"""

from __future__ import annotations

from decimal import Decimal

from django.db.models import Q
from django.utils import timezone

from apps.debts.models import Account, AccountScenarioRun, Measure, MeasureItem, ScenarioAssignment
from apps.debts.services.measures import MeasureLaunchError, log_event, rollup
from apps.nsi.models import ScenarioDefinition, ServiceScenarioMode
from apps.users.models import ServiceOrganization, User

PAID = "Долг оплачен"
REPLACED = "сценарий заменён"
OPEN = {Measure.Status.ASSIGNED, Measure.Status.RUNNING, Measure.Status.PAUSED, Measure.Status.FAILED}
ITEM_OPEN = {MeasureItem.Status.ASSIGNED, MeasureItem.Status.RUNNING, MeasureItem.Status.FAILED}


def launch_mode(account: Account) -> str:
    row = _mode_row(account)
    if row is None:
        return ServiceScenarioMode.Launch.MANUAL
    return row.launch or ServiceScenarioMode.Launch.MANUAL


def default_scenario(account: Account):
    row = _mode_row(account)
    if row is not None and row.scenario_id and row.scenario.status == ScenarioDefinition.Status.ACTIVE:
        return row.scenario
    from apps.nsi.services.scenario_engine import _scenario_for_import

    return _scenario_for_import(account)


def bind_imported_run(account: Account) -> None:
    """Новый должник получает сценарий организации. Меры стартуют только в автоматическом режиме."""
    from apps.nsi.services.scenario_engine import advance_account
    from apps.nsi.services.scenarios import upgrade_legacy_scenario

    if account.inheritance_case or not account.effective_group:
        return
    scenario = default_scenario(account)
    if scenario is None:
        return
    upgrade_legacy_scenario(scenario)
    scenario.refresh_from_db()
    run = AccountScenarioRun.objects.filter(account=account).select_related("scenario").first()
    today = timezone.localdate()
    manual = launch_mode(account) != ServiceScenarioMode.Launch.AUTO
    if run is None:
        run = AccountScenarioRun.objects.create(
            organization=account.organization,
            account=account,
            scenario=scenario,
            version=scenario.version,
            assigned_on=today,
            awaiting_start=manual,
        )
        _remember(account, scenario, scenario.version, today)
    elif run.finished_on:
        return
    elif run.assigned_on is None:
        run.assigned_on = timezone.localtime(run.created_at).date()
        run.save(update_fields=["assigned_on", "updated_at"])
    if run.awaiting_start or run.paused or account.inheritance_case:
        return
    advance_account(account)


def start_accounts(accounts: list[Account], user) -> int:
    """Кнопка «Запустить сценарий». Наследственное дело по-прежнему не пускает автомеры."""
    from apps.nsi.services.scenario_engine import advance_account

    started = 0
    for account in accounts:
        if account.inheritance_case:
            continue
        run = AccountScenarioRun.objects.filter(account=account).first()
        if run is None:
            bind_imported_run(account)
            run = AccountScenarioRun.objects.filter(account=account).first()
        if run is None or run.finished_on:
            continue
        if run.awaiting_start:
            run.awaiting_start = False
            run.save(update_fields=["awaiting_start", "updated_at"])
        advance_account(account)
        started += 1
    return started


def replace_accounts(accounts: list[Account], scenario: ScenarioDefinition, user) -> int:
    """Смена сценария закрывает старый ряд и его открытые меры. Новый стартует по режиму организации."""
    from apps.nsi.services.scenario_engine import advance_account

    if scenario.status != ScenarioDefinition.Status.ACTIVE:
        raise MeasureLaunchError({"scenario": "На лицевой счёт назначается опубликованный сценарий"})
    changed = 0
    today = timezone.localdate()
    for account in accounts:
        if scenario.organization_id not in (None, account.organization_id):
            raise MeasureLaunchError({"scenario": "Сценарий другой схемы"})
        run = AccountScenarioRun.objects.filter(account=account).select_related("scenario").first()
        manual = launch_mode(account) != ServiceScenarioMode.Launch.AUTO
        if run is not None and run.scenario_id == scenario.pk and not run.finished_on:
            run.version = scenario.version
            run.awaiting_start = manual
            run.save(update_fields=["version", "awaiting_start", "updated_at"])
        else:
            if run is not None and not run.finished_on:
                _close_measures(account, REPLACED, today, user)
                _finish_run(run, today, REPLACED)
            run = AccountScenarioRun.objects.filter(account=account).first()
            if run is None:
                run = AccountScenarioRun.objects.create(
                    organization=account.organization,
                    account=account,
                    scenario=scenario,
                    version=scenario.version,
                    assigned_on=today,
                    awaiting_start=manual,
                )
            else:
                run.scenario = scenario
                run.version = scenario.version
                run.assigned_on = today
                run.finished_on = None
                run.finish_reason = ""
                run.skipped_orders = []
                run.last_skip = ""
                run.paused = False
                run.awaiting_start = manual
                run.save()
            _remember(account, scenario, scenario.version, today)
            account.scenario_name = scenario.name
            account.scenario_locked = True
            account.save(update_fields=["scenario_name", "scenario_locked", "updated_at"])
        if not run.awaiting_start and not account.inheritance_case:
            advance_account(account)
        changed += 1
    return changed


def settle_if_paid(account: Account) -> bool:
    """Долг счета равен нулю: все открытые меры и сценарий закрываются с основанием «Долг оплачен»."""
    if not account_is_clear(account):
        return False
    today = timezone.localdate()
    _close_measures(account, PAID, today, None)
    run = AccountScenarioRun.objects.filter(account=account).first()
    if run is not None and not run.finished_on:
        _finish_run(run, today, PAID)
    return True


def account_is_clear(account: Account) -> bool:
    from apps.nsi.models import CalculationSettings

    threshold = CalculationSettings.load().close_threshold or Decimal("0")
    services = list(account.services.all())
    if not services:
        return (account.balance_out or Decimal("0")) <= threshold
    for service in services:
        balance = service.balance_out if service.balance_out is not None else Decimal("0")
        penalty = service.balance_mulct_out if service.balance_mulct_out is not None else Decimal("0")
        overdue = service.overdue_debt if service.overdue_debt is not None else Decimal("0")
        if balance > threshold or penalty > threshold or overdue > threshold:
            return False
    return True


def stop_measure(account: Account, measure: Measure, user) -> Measure:
    """Галочка на кружке шага. Пока есть открытые задания, мера не закрывается."""
    if measure.tasks.exclude(status="done").exists():
        raise MeasureLaunchError({"tasks": "сначала завершите все задания"})
    if not measure.accounts.filter(pk=account.pk).exists():
        raise MeasureLaunchError({"account": "Мероприятие не относится к этому лицевому счёту"})
    today = timezone.localdate()
    item = measure.items.filter(account=account).first()
    if item is not None and item.status not in {MeasureItem.Status.DONE, MeasureItem.Status.CANCELLED}:
        old = item.status
        item.status = MeasureItem.Status.DONE
        item.note = (item.note or "")[:500]
        item.acted_by = user
        item.acted_at = timezone.now()
        item.save()
        log_event(measure, item, user, old, item.status, "Остановлено специалистом")
    if measure.items.exclude(status__in=[MeasureItem.Status.DONE, MeasureItem.Status.CANCELLED]).exists():
        rollup(measure, respect_pause=False)
        return measure
    old = measure.status
    measure.status = Measure.Status.DONE
    measure.stopped = True
    measure.finished_on = today
    if not measure.finish_reason:
        measure.finish_reason = "Остановлено специалистом"
    measure.save(update_fields=["status", "stopped", "finished_on", "finish_reason", "updated_at"])
    log_event(measure, None, user, old, measure.status, "Остановлено специалистом")
    _finish_if_complete(account, today)
    return measure


def assign_legal(accounts: list[Account], person: User, actor) -> int:
    """Специалист ЮС становится закреплённым и исполнителем открытого взыскания."""
    if person.role != User.Role.LEGAL or not person.is_active:
        raise MeasureLaunchError({"user": "Выберите специалиста ЮС"})
    count = 0
    for account in accounts:
        if person.organization_id != account.organization_id:
            raise MeasureLaunchError({"user": "Специалист ЮС из другой схемы"})
        account.assigned_to = person
        account.save(update_fields=["assigned_to", "updated_at"])
        Measure.objects.filter(
            accounts=account, kind=Measure.Kind.COLLECTION, status__in=OPEN,
        ).update(assignee=person, updated_at=timezone.now())
        count += 1
    return count


def _mode_row(account: Account) -> ServiceScenarioMode | None:
    return (
        ServiceScenarioMode.objects.filter(
            service_organization__organization_id=account.organization_id,
            service_organization__provider_id=account.provider_id,
            service_organization__is_active=True,
        )
        .select_related("scenario")
        .first()
    )


def _remember(account: Account, scenario, version: int, day) -> None:
    ScenarioAssignment.objects.create(
        organization=account.organization,
        account=account,
        scenario=scenario,
        version=version,
        assigned_on=day,
    )


def _finish_run(run: AccountScenarioRun, day, reason: str) -> None:
    run.finished_on = day
    run.finish_reason = reason
    run.awaiting_start = False
    run.save(update_fields=["finished_on", "finish_reason", "awaiting_start", "updated_at"])
    ScenarioAssignment.objects.filter(account_id=run.account_id, scenario_id=run.scenario_id, finished_on__isnull=True).update(
        finished_on=day, finish_reason=reason, updated_at=timezone.now(),
    )


def _close_measures(account: Account, reason: str, day, user) -> None:
    now = timezone.now()
    measures = Measure.objects.filter(accounts=account).exclude(
        status__in=[Measure.Status.DONE, Measure.Status.CANCELLED],
    )
    for measure in measures:
        if measure.kind == Measure.Kind.DISCONNECT and (
            measure.suspension_confirmed_on or measure.items.filter(account=account, suspended_on__isnull=False).exists()
        ):
            continue
        old = measure.status
        measure.items.filter(account=account).exclude(
            status__in=[MeasureItem.Status.DONE, MeasureItem.Status.CANCELLED],
        ).update(status=MeasureItem.Status.CANCELLED, note=reason[:500], updated_at=now)
        if measure.items.filter(status__in=ITEM_OPEN).exists():
            rollup(measure, respect_pause=False)
            continue
        measure.status = Measure.Status.DONE if reason == PAID else Measure.Status.CANCELLED
        measure.finished_on = day
        measure.finish_reason = reason
        measure.stopped = True
        measure.save(update_fields=["status", "finished_on", "finish_reason", "stopped", "updated_at"])
        log_event(measure, None, user, old, measure.status, reason)


def _finish_if_complete(account: Account, day) -> None:
    run = AccountScenarioRun.objects.filter(account=account, finished_on__isnull=True).first()
    if run is None:
        return
    open_measures = Measure.objects.filter(
        accounts=account, source_scenario=run.scenario, source_version=run.version,
    ).exclude(status__in=[Measure.Status.DONE, Measure.Status.CANCELLED])
    if open_measures.exists():
        return
    started = Measure.objects.filter(accounts=account, source_scenario=run.scenario, source_version=run.version).exists()
    if not started:
        return
    _finish_run(run, day, "Все мероприятия завершены")


def service_org(account: Account) -> ServiceOrganization | None:
    return ServiceOrganization.objects.filter(
        organization_id=account.organization_id, provider_id=account.provider_id, is_active=True,
    ).first()


def visible_scenarios(account: Account):
    return ScenarioDefinition.objects.filter(status=ScenarioDefinition.Status.ACTIVE).filter(
        Q(organization_id=account.organization_id) | Q(organization__isnull=True),
    )
