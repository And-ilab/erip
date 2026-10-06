"""Запуск шагов сценария по лицевому счёту (ТЗ 4.2.5).

Мессенджер шаг не отправляет. Уже запущенное мероприятие хранит версию сценария.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import IntegrityError
from django.utils import timezone

from apps.debts.models import Account, AccountScenarioRun, Measure, MeasureItem
from apps.debts.services.measures import MeasureLaunchError, is_legal_entity, launch_measure, phone_for_call, rollup
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
}


def ensure_imported_runs(account_ids: list[int]) -> None:
    """После выгрузки у счёта с группой долга есть запуск сценария и строка мероприятия."""
    if not account_ids:
        return
    for account in Account.objects.filter(pk__in=account_ids).select_related("organization"):
        ensure_imported_run(account)


def ensure_imported_run(account: Account) -> None:
    if account.inheritance_case or not account.effective_group:
        return
    from apps.nsi.services.scenarios import ensure_standard_scenario, upgrade_legacy_scenario

    ensure_standard_scenario()
    run = AccountScenarioRun.objects.filter(account=account).select_related("scenario").first()
    if run is None:
        scenario = _scenario_for_import(account)
        if scenario is None:
            return
        try:
            run, _created = AccountScenarioRun.objects.get_or_create(
                account=account,
                defaults={
                    "organization": account.organization, "scenario": scenario, "version": scenario.version,
                },
            )
        except IntegrityError:
            run = AccountScenarioRun.objects.filter(account=account).first()
        if run is None:
            return
    if run.paused:
        return
    upgrade_legacy_scenario(run.scenario)
    advance_account(account)


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


def advance_after_measure(measure: Measure) -> None:
    if any(account_id in _advancing for account_id in measure.accounts.values_list("pk", flat=True)):
        return
    for account in measure.accounts.all():
        advance_account(account)


def advance_account(account: Account) -> None:
    if account.pk in _advancing:
        return
    _advancing.add(account.pk)
    try:
        for _ in range(12):
            if not _advance_once(account):
                break
    finally:
        _advancing.discard(account.pk)


def _step_for(steps: list[dict], measure: Measure) -> dict | None:
    action = measure.source_action or ""
    for step in steps:
        if step.get("order") == measure.source_step and (step.get("action") or "") == action:
            return step
    return None


def _outside_groups(step: dict, account: Account) -> bool:
    groups = step.get("groups") or []
    if not groups:
        return False
    return account.effective_group not in [int(item) for item in groups]


def _release_other_groups(account: Account, steps: list[dict], measures: list[Measure]) -> list[Measure]:
    """Открытый шаг чужой группы снимается, чтобы счёт остался на мероприятии своей группы."""
    kept = []
    for item in measures:
        if item.status in {Measure.Status.DONE, Measure.Status.CANCELLED}:
            kept.append(item)
            continue
        step = _step_for(steps, item)
        if step is not None and not _outside_groups(step, account):
            kept.append(item)
            continue
        item.items.all().delete()
        item.delete()
    return kept


def _advance_once(account: Account) -> bool:
    run = AccountScenarioRun.objects.filter(account=account).select_related("scenario").first()
    if run is None or run.paused:
        return False
    revision = run.scenario.revisions.filter(version=run.version).first()
    steps = list((revision.steps if revision else run.scenario.steps) or [])
    if not steps:
        return False
    measures = _release_other_groups(account, steps, list(
        Measure.objects.filter(
            source_scenario=run.scenario, source_version=run.version, accounts=account,
        )
    ))
    skipped = set(run.skipped_orders or [])
    if any(item.status in OPEN and _blocks(steps, item) for item in measures):
        return False
    done_orders = {item.source_step for item in measures if item.status == Measure.Status.DONE}
    done_orders |= skipped
    previous = _latest_done(measures)
    for order in sorted({step.get("order") for step in steps}):
        if order in done_orders:
            continue
        if any(item.source_step == order and item.status in OPEN for item in measures):
            continue
        candidates = [step for step in steps if step.get("order") == order and _matches(step, account, previous)]
        if not candidates:
            continue
        step = candidates[0]
        if not _wait_elapsed(run, previous, step):
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
            return False
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


def _wait_elapsed(run: AccountScenarioRun, previous: Measure | None, step: dict) -> bool:
    days = int(step.get("wait_days") or 0)
    if days <= 0:
        return True
    anchor = previous.updated_at if previous is not None else run.created_at
    return timezone.localdate() >= timezone.localtime(anchor).date() + timedelta(days=days)


def _matches(step: dict, account: Account, previous: Measure | None) -> bool:
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
        data["time_from"] = "09:00"
        data["time_to"] = "18:00"
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
        assignee = User.objects.filter(
            organization_id=account.organization_id, is_active=True,
        ).exclude(role=User.Role.OBSERVER).order_by("id").first()
        if assignee is not None:
            data["assignee"] = assignee.pk
    user = run.scenario.revisions.filter(version=run.version).values_list("author", flat=True).first()
    actor = User.objects.filter(pk=user).first() if user else None
    if actor is None:
        actor = User.objects.filter(organization_id=account.organization_id, is_active=True).order_by("id").first()
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
    return measure


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
