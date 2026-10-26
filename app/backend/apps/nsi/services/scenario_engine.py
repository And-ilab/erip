"""Запуск шагов сценария по лицевому счёту (ТЗ 4.2.5).

Мессенджер шаг не отправляет. Уже запущенное мероприятие хранит версию сценария.
"""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from apps.debts.models import Account, AccountScenarioRun, Measure, MeasureItem
from apps.debts.services.measures import (
    MeasureLaunchError, is_legal_entity, launch_measure, log_event, phone_for_call, rollup,
)
from apps.users.models import ServiceOrganization, User

_advancing: set[int] = set()
OPEN = {Measure.Status.ASSIGNED, Measure.Status.RUNNING, Measure.Status.PAUSED}

ACTION_KIND = {
    "call": ("call", ""),
    "manual_call": ("call", ""),
    "sms": ("notice", "sms"),
    "email": ("notice", "email"),
    "warning": ("warning", ""),
    "disconnect": ("disconnect", ""),
    "writ": ("collection", ""),
    "lawsuit": ("collection", ""),
    "opi": ("collection", "opi"),
}


def ensure_imported_runs(account_ids: list[int]) -> None:
    """После выгрузки у счёта с группой долга есть запуск сценария и строка мероприятия."""
    if not account_ids:
        return
    for account in Account.objects.filter(pk__in=account_ids).select_related("organization"):
        ensure_imported_run(account)


def ensure_imported_run(account: Account) -> None:
    if account.inheritance_case or account.payer_deceased or not account.effective_group:
        return
    from apps.nsi.services.scenarios import ensure_standard_scenario

    ensure_standard_scenario()
    from apps.debts.services.scenario_flow import bind_imported_run

    bind_imported_run(account)


def _scenario_for_import(account: Account):
    from apps.nsi.models import ScenarioDefinition
    from apps.nsi.services.scenarios import ensure_standard_scenario

    own = (
        ScenarioDefinition.objects.filter(
            organization_id=account.organization_id, status=ScenarioDefinition.Status.ACTIVE,
        )
        .order_by("id")
        .first()
    )
    from apps.nsi.services.scenarios import upgrade_legacy_scenario

    if own is not None:
        chosen = own
    else:
        shared = (
            ScenarioDefinition.objects.filter(
                organization__isnull=True, status=ScenarioDefinition.Status.ACTIVE,
            )
            .order_by("id")
            .first()
        )
        if shared is not None:
            chosen = shared
        else:
            ensure_standard_scenario()
            chosen = ScenarioDefinition.objects.filter(organization__isnull=True, name="Стандартное взыскание").first()
    upgrade_legacy_scenario(chosen)
    return chosen


def skip_current_step(account: Account, user, reason: str) -> AccountScenarioRun:
    """Пропуск текущего шага. Дальше сценарий идёт сам. Открытая партия этого шага закрывается."""
    from apps.users.access import can_skip_stage

    text = (reason or "").strip()
    if not can_skip_stage(user):
        raise MeasureLaunchError({"skip": "Пропуск доступен администратору и специалисту с согласованием"})
    if not text:
        raise MeasureLaunchError({"reason": "Укажите причину пропуска"})
    run = AccountScenarioRun.objects.filter(account=account).select_related("scenario").first()
    if run is None:
        raise MeasureLaunchError({"scenario": "На лицевом счёте нет сценария"})
    if run.paused:
        raise MeasureLaunchError({"scenario": "Сценарий на паузе"})
    revision = run.scenario.revisions.filter(version=run.version).first()
    steps = list((revision.steps if revision else run.scenario.steps) or [])
    measures = list(Measure.objects.filter(
        source_scenario=run.scenario, source_version=run.version, accounts=account,
    ))
    skipped = set(run.skipped_orders or [])
    done = {item.source_step for item in measures if item.status == Measure.Status.DONE} | skipped
    target = None
    for order in sorted({step.get("order") for step in steps}):
        if order in done:
            continue
        target = order
        break
    if target is None:
        raise MeasureLaunchError({"skip": "Пропускать нечего: шаги сценария уже пройдены"})
    closing = OPEN | {Measure.Status.FAILED}
    for item in measures:
        if item.source_step != target or item.status not in closing:
            continue
        old = item.status
        item.status = Measure.Status.CANCELLED
        item.note = text[:500]
        item.save(update_fields=["status", "note", "updated_at"])
        item.items.exclude(status=MeasureItem.Status.DONE).update(
            status=MeasureItem.Status.CANCELLED, note=text[:500], updated_at=timezone.now(),
        )
        log_event(item, None, user, old, item.status, text[:500])
    skipped.add(target)
    run.skipped_orders = sorted(int(item) for item in skipped if item is not None)
    run.last_skip = text[:300]
    run.save(update_fields=["skipped_orders", "last_skip", "updated_at"])
    advance_account(account)
    run.refresh_from_db()
    return run


def advance_after_measure(measure: Measure) -> None:
    if any(account_id in _advancing for account_id in measure.accounts.values_list("pk", flat=True)):
        return
    for account in measure.accounts.all():
        advance_account(account)


def advance_account(account: Account) -> None:
    if account.pk in _advancing or account.inheritance_case or account.payer_deceased:
        return
    run = AccountScenarioRun.objects.filter(account=account).only(
        "awaiting_start", "finished_on", "paused",
    ).first()
    if run is not None and (run.awaiting_start or run.finished_on or run.paused):
        return
    _advancing.add(account.pk)
    try:
        for _ in range(12):
            if not _advance_once(account):
                break
    finally:
        _advancing.discard(account.pk)


def _already_started(measures: list[Measure], step: dict) -> bool:
    """Повторно не открываем тот же шаг. Сорвавшийся шаг с другим шаблоном можно заменить."""
    action = step.get("action") or ""
    order = step.get("order")
    template = step.get("template") or ""
    for item in measures:
        if item.source_step != order or (item.source_action or "") != action:
            continue
        if item.status != Measure.Status.FAILED:
            return True
        if not template or (item.template_name or "") == template:
            return True
    return False


def _step_for(steps: list[dict], measure: Measure) -> dict | None:
    action = measure.source_action or ""
    for step in steps:
        if step.get("order") == measure.source_step and (step.get("action") or "") == action:
            return step
    return None


def _steps_for_account(steps: list[dict], account: Account) -> list[dict]:
    """Цепочка сценария идёт как опубликована. Группа не подменяет её другим шаблоном."""
    return steps


def _advance_once(account: Account) -> bool:
    run = AccountScenarioRun.objects.filter(account=account).select_related("scenario").first()
    if run is None or run.paused:
        return False
    revision = run.scenario.revisions.filter(version=run.version).first()
    steps = _steps_for_account(list((revision.steps if revision else run.scenario.steps) or []), account)
    if not steps:
        return False
    measures = list(
        Measure.objects.filter(
            source_scenario=run.scenario, source_version=run.version, accounts=account,
        )
    )
    skipped = set(run.skipped_orders or [])
    if any(item.status in OPEN and _blocks(steps, item) for item in measures):
        return False
    done_orders = {item.source_step for item in measures if item.status == Measure.Status.DONE}
    done_orders |= skipped
    previous = _latest_done(measures)
    for order in sorted({step.get("order") for step in steps}):
        if order in done_orders:
            continue
        if any(item.source_step == order and item.status in OPEN and _blocks(steps, item) for item in measures):
            return False
        candidates = [
            step for step in steps
            if step.get("order") == order
            and not _already_started(measures, step)
            and _matches(step, account, previous)
        ]
        if not candidates:
            continue
        step = candidates[0]
        if not step.get("after_delivered") and not _wait_elapsed(account, run, previous, step):
            return False
        if step.get("action") == "messenger":
            skipped.add(order)
            run.skipped_orders = sorted(skipped)
            run.last_skip = "Шаг «мессенджер» не отправляет сообщение"
            run.save(update_fields=["skipped_orders", "last_skip", "updated_at"])
            return True
        try:
            measure = _launch(account, run, step)
        except MeasureLaunchError as exc:
            reason = _skip_text(exc)[:300]
            run.last_skip = reason
            run.save(update_fields=["last_skip", "updated_at"])
            _remember_blocked(account, run, step, reason)
            return step.get("blocks_next", True) is False
        _forget_blocked(account, run, step)
        run.last_skip = ""
        run.save(update_fields=["last_skip", "updated_at"])
        if step.get("auto_complete") and measure.kind == Measure.Kind.NOTICE:
            measure.items.update(status=Measure.Status.DONE)
            rollup(measure)
        return not step.get("blocks_next", True) or bool(step.get("auto_complete"))
    return False


def _blocks(steps: list[dict], measure: Measure) -> bool:
    for step in steps:
        if step.get("order") == measure.source_step and step.get("action") == (measure.source_action or step.get("action")):
            return bool(step.get("blocks_next", True)) and not step.get("auto_complete")
    return True


def _latest_done(measures: list[Measure]) -> Measure | None:
    done = [item for item in measures if item.status == Measure.Status.DONE]
    if not done:
        return None
    return max(done, key=lambda item: (item.updated_at, item.pk))


def _wait_elapsed(account: Account, run: AccountScenarioRun, previous: Measure | None, step: dict) -> bool:
    from apps.nsi.services.timelines import step_wait_days

    days = step_wait_days(account.organization, step)
    if days <= 0:
        return True
    anchor = previous.updated_at if previous is not None else run.created_at
    return timezone.localdate() >= timezone.localtime(anchor).date() + timedelta(days=days)


def _matches(step: dict, account: Account, previous: Measure | None) -> bool:
    months = account.months_debt
    minimum_months = step.get("months_from")
    if minimum_months not in (None, ""):
        if (months if months is not None else 0) < int(minimum_months):
            return False
    if step.get("action") == "call" and months is not None and months <= 1 and not _call_day_open(account):
        return False
    if not _delivery_ready(account, step):
        return False
    group = account.effective_group
    groups = step.get("groups") or []
    if groups and group not in [int(item) for item in groups]:
        return False
    minimum = step.get("branch_group")
    if minimum not in (None, "", 0) and (group or 0) < int(minimum):
        return False
    if step.get("exclude_if_paid"):
        balance = account.balance_out or 0
        if balance <= 0:
            return False
    party = step.get("party") or "any"
    legal = is_legal_entity(account)
    if party == "legal" and not legal:
        return False
    if party == "person" and legal:
        return False
    if step.get("require_phone") and not phone_for_call(account, timezone.localdate(), None):
        return False
    category = step.get("debtor_category")
    if category not in (None, "", 0) and account.debtor_category_id != int(category):
        return False
    org_kind = step.get("org_kind") or "any"
    if org_kind in {"supplier", "billing"}:
        supplier = ServiceOrganization.objects.filter(
            organization_id=account.organization_id,
            is_supplier=True,
            provider_id__in=account.services.values_list("provider_id", flat=True),
        ).exists()
        if org_kind == "supplier" and not supplier:
            return False
        if org_kind == "billing" and supplier:
            return False
    previous_action = step.get("previous_action") or ""
    if previous_action and (previous is None or previous.source_action != previous_action):
        return False
    require_status = step.get("require_status") or ""
    if require_status and (previous is None or previous.status != require_status):
        return False
    return True


def _call_day_open(account: Account) -> bool:
    run = AccountScenarioRun.objects.filter(account=account).select_related("scenario").first()
    day = 27
    if run is not None and run.scenario.call_from_day:
        day = int(run.scenario.call_from_day)
    return timezone.localdate().day >= day


def _delivery_ready(account: Account, step: dict) -> bool:
    action = step.get("after_delivered") or ""
    if not action:
        return True
    days = int(step.get("wait_days") or 5)
    item = (
        MeasureItem.objects.filter(
            account=account, measure__source_action=action, delivered_on__isnull=False,
        )
        .order_by("-delivered_on")
        .first()
    )
    if item is None or item.delivered_on is None:
        return False
    from apps.debts.services.scenario_flow import account_is_clear

    if account_is_clear(account):
        return False
    return timezone.localdate() >= item.delivered_on + timedelta(days=days)


def step_template_name(step: dict, fallback: str) -> str:
    """Имя шаблона по идентификатору. Старые шаги без id остаются на сохранённой строке."""
    template_id = step.get("template_id")
    if template_id:
        from apps.notifications.models import MessageTemplate

        found = MessageTemplate.objects.filter(pk=template_id).only("name").first()
        if found is not None and found.name:
            return found.name
    name = (step.get("template") or "").strip()
    return name or fallback


def resolve_call_legal(account: Account, scenario) -> bool:
    if scenario is not None and scenario.call_legal is not None:
        return bool(scenario.call_legal)
    return bool(account.organization.call_legal)


def _launch(account: Account, run: AccountScenarioRun, step: dict) -> Measure:
    action = step.get("action")
    kind, channel = ACTION_KIND[action]
    scenario = run.scenario
    data = {
        "kind": kind,
        "channel": channel,
        "template_name": step_template_name(step, scenario.name),
        "scenario_name": scenario.name,
        "note": f"Сценарий «{scenario.name}» v{run.version}, шаг {step.get('order')}",
        "started_on": timezone.localdate().isoformat(),
        "needs_approval": bool(step.get("approval")),
        "call_legal": resolve_call_legal(account, scenario),
    }
    if kind == Measure.Kind.CALL:
        from apps.debts.services.autocall import call_window

        start, end = call_window(scenario, timezone.localdate())
        data["time_from"] = start.strftime("%H:%M")
        data["time_to"] = end.strftime("%H:%M")
        groups = [int(item) for item in (step.get("groups") or [])]
        if groups:
            data["group_from"] = min(groups)
            data["group_to"] = max(groups)
        elif step.get("branch_group"):
            data["group_from"] = int(step["branch_group"])
            data["group_to"] = 6
    services = []
    if kind in {Measure.Kind.DISCONNECT, Measure.Kind.COLLECTION}:
        services = list(account.services.all())
        data["service_ids"] = [service.id for service in services]
    if kind == Measure.Kind.COLLECTION:
        from apps.debts.services.measures import collection_executor

        executor = collection_executor(account)
        if executor is not None:
            data["assignee"] = executor.pk
        else:
            data["allow_unassigned"] = True
    user = run.scenario.revisions.filter(version=run.version).values_list("author", flat=True).first()
    actor = User.objects.filter(pk=user).first() if user else None
    if actor is None:
        actor = User.objects.filter(organization_id=account.organization_id, is_active=True).order_by("id").first()
    if action == "writ":
        adopted = _adopt_claim_measure(account, run, step)
        if adopted is not None:
            _open_writ_case(account, actor)
            return adopted
    result = launch_measure(actor, [account], services, data)
    measure = result["measure"]
    measure.source_scenario = scenario
    measure.source_version = run.version
    measure.source_step = step.get("order")
    measure.source_action = action
    measure.auto_complete = bool(step.get("auto_complete"))
    measure.save(update_fields=[
        "source_scenario", "source_version", "source_step", "source_action", "auto_complete", "updated_at",
    ])
    if action == "writ":
        _open_writ_case(account, actor)
    return measure


def _adopt_claim_measure(account: Account, run: AccountScenarioRun, step: dict) -> Measure | None:
    """Дело, открытое раньше шага, остаётся той же строкой взыскания."""
    closed = {Measure.Status.DONE, Measure.Status.CANCELLED}
    measure = (
        Measure.objects.filter(accounts=account, source_action="claim", kind=Measure.Kind.COLLECTION)
        .exclude(status__in=closed)
        .order_by("id")
        .first()
    )
    if measure is None:
        return None
    measure.source_scenario = run.scenario
    measure.source_version = run.version
    measure.source_step = step.get("order")
    measure.source_action = "writ"
    measure.scenario_name = run.scenario.name
    measure.save(update_fields=[
        "source_scenario", "source_version", "source_step", "source_action", "scenario_name", "updated_at",
    ])
    return measure


def _open_writ_case(account: Account, actor) -> None:
    from apps.debts.services.claims import ClaimBlocked, open_case
    from apps.debts.services.writ_flow import fill_writ_templates

    try:
        case = open_case(account, actor)
    except ClaimBlocked:
        return
    fill_writ_templates(case, actor)


def _remember_blocked(account: Account, run: AccountScenarioRun, step: dict, reason: str) -> None:
    """Шаг не стартовал, но в реестре мероприятий строка есть: иначе счёт после загрузки не виден."""
    action = step.get("action") or ""
    kind, channel = ACTION_KIND.get(action, (Measure.Kind.SCENARIO, ""))
    existing = (
        Measure.objects.filter(
            accounts=account, source_scenario=run.scenario, source_version=run.version,
            source_step=step.get("order"), source_action=action, status=Measure.Status.FAILED,
        )
        .order_by("id")
        .first()
    )
    if existing is not None:
        if existing.note != reason:
            existing.note = reason
            existing.save(update_fields=["note", "updated_at"])
            existing.items.filter(account=account).update(note=reason)
        return
    measure = Measure.objects.create(
        organization=account.organization, kind=kind, channel=channel, status=Measure.Status.FAILED,
        template_name=step_template_name(step, run.scenario.name) or run.scenario.name,
        scenario_name=run.scenario.name, note=reason, started_on=timezone.localdate(), due_on=timezone.localdate(),
        source_scenario=run.scenario, source_version=run.version, source_step=step.get("order"), source_action=action,
    )
    measure.accounts.add(account)
    MeasureItem.objects.create(
        organization=account.organization, measure=measure, account=account,
        status=MeasureItem.Status.FAILED, note=reason,
    )


def _forget_blocked(account: Account, run: AccountScenarioRun, step: dict) -> None:
    blocked = Measure.objects.filter(
        accounts=account, source_scenario=run.scenario, source_version=run.version,
        source_step=step.get("order"), status=Measure.Status.FAILED,
    )
    for measure in blocked:
        measure.items.all().delete()
        measure.delete()


def _skip_text(exc: MeasureLaunchError) -> str:
    detail = exc.detail
    if isinstance(detail, dict):
        skipped = detail.get("skipped") or []
        if skipped:
            return str(skipped[0].get("reason") or detail)
        return "; ".join(str(value) for value in detail.values() if not isinstance(value, list))
    return str(detail)
