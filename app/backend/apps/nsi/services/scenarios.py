"""Конструктор сценариев и печатных форм (ТЗ 4.2.5). Мессенджер в шаге не отправляет сообщения."""

from apps.core.exceptions import ServiceError
from apps.debts.models import AccountScenarioRun, DebtWorkItem
from apps.nsi.models import CalculationSettings, PrintForm, PrintFormRevision, ScenarioDefinition, ScenarioRevision

ACTIONS = {
    "call", "sms", "email", "messenger", "warning", "disconnect", "writ", "lawsuit", "manual_call",
}
EXCLUSIVE = {"call", "disconnect", "writ"}
VARIABLES = ("fio", "account", "amount", "address", "services", "last_payment", "organization", "due_days", "tariff")


class ScenarioInvalid(ServiceError):
    default_detail = "Сценарий не сохранён"
    default_code = "scenario_invalid"


def check_steps(steps: list[dict]) -> list[str]:
    if not isinstance(steps, list) or not steps:
        raise ScenarioInvalid("В сценарии нет шагов")
    orders = []
    warnings = []
    for step in steps:
        action = step.get("action")
        if action not in ACTIONS:
            raise ScenarioInvalid(f"Неизвестное действие: {action}")
        order = step.get("order")
        if not isinstance(order, int) or order < 1:
            raise ScenarioInvalid("У шага должен быть порядковый номер")
        orders.append(order)
        if action == "messenger":
            warnings.append("Шаг «мессенджер» сохранён. Отправка в мессенджеры на этом этапе не выполняется.")
    by_order: dict[int, list[str]] = {}
    for step in steps:
        by_order.setdefault(step["order"], []).append(step["action"])
    for order, actions in by_order.items():
        clash = [item for item in actions if item in EXCLUSIVE]
        if len(set(clash)) > 1:
            raise ScenarioInvalid(f"Шаги с номером {order} требуют взаимоисключающие ресурсы: {', '.join(clash)}")
    for step in steps:
        if step.get("terminal"):
            continue
        if not any(other.get("order", 0) > step["order"] for other in steps):
            raise ScenarioInvalid(f"Тупик: шаг {step['order']} ({step['action']}) никуда не ведёт")
    return warnings


def publish(scenario: ScenarioDefinition, user) -> list[str]:
    warnings = check_steps(scenario.steps)
    last = scenario.revisions.order_by("-version").values_list("version", flat=True).first()
    scenario.version = (last or 0) + 1
    scenario.status = ScenarioDefinition.Status.ACTIVE
    scenario.save(update_fields=["version", "status", "updated_at"])
    ScenarioRevision.objects.create(
        scenario=scenario, version=scenario.version, steps=scenario.steps, author=user,
    )
    return warnings


def copy_scenario(scenario: ScenarioDefinition, user) -> ScenarioDefinition:
    organization = None if user.is_superadmin else user.organization
    return ScenarioDefinition.objects.create(
        organization=organization,
        name=f"{scenario.name} (копия)",
        status=ScenarioDefinition.Status.DRAFT,
        version=1,
        steps=scenario.steps,
        based_on=scenario,
    )


def assign_run(account, scenario: ScenarioDefinition, user, *, upgrade: bool = False, paused: bool = False, reason: str = ""):
    if scenario.status != ScenarioDefinition.Status.ACTIVE:
        raise ScenarioInvalid("На лицевой счёт назначается опубликованный сценарий")
    if paused and not reason.strip():
        raise ScenarioInvalid("Пауза записывается с причиной")
    run = AccountScenarioRun.objects.filter(account=account).first()
    if run is None:
        return AccountScenarioRun.objects.create(
            organization=account.organization, account=account, scenario=scenario, version=scenario.version,
            paused=paused, pause_reason=reason,
        )
    if upgrade or run.scenario_id != scenario.pk:
        run.scenario = scenario
        run.version = scenario.version
    run.paused = paused
    run.pause_reason = reason
    run.save()
    return run


def render_print(form: PrintForm, account, tariff: str = "") -> str:
    services = ", ".join(
        account.services.exclude(service_name="").values_list("service_name", flat=True)[:8]
    ) or "—"
    last = account.payments.exclude(pay_date=None).order_by("-pay_date").values_list("pay_date", flat=True).first()
    values = {
        "fio": account.short_fio or "—",
        "account": account.client_account,
        "amount": "" if account.balance_out is None else str(account.balance_out),
        "address": account.account_address or "—",
        "services": services,
        "last_payment": last.isoformat() if last else "нет",
        "organization": account.organization.name,
        "due_days": str(CalculationSettings.load().warning_wait_days),
        "tariff": tariff or "—",
    }
    text = form.body
    for key, value in values.items():
        text = text.replace("{" + key + "}", value)
    DebtWorkItem.objects.create(
        organization=account.organization, account=account, kind=_work_kind(form.doc_kind),
        title=form.name, note=f"Собран по шаблону {form.code} версии {form.version}",
    )
    return text


def remember_print_version(form: PrintForm, previous_body: str | None) -> None:
    if previous_body is None:
        PrintFormRevision.objects.get_or_create(form=form, version=form.version, defaults={"body": form.body})
        return
    if previous_body == form.body:
        return
    form.version += 1
    form.save(update_fields=["version", "updated_at"])
    PrintFormRevision.objects.create(form=form, version=form.version, body=form.body)


def _work_kind(doc_kind: str) -> str:
    if doc_kind in {DebtWorkItem.Kind.WARNING, DebtWorkItem.Kind.WRIT, DebtWorkItem.Kind.CLAIM, DebtWorkItem.Kind.CLOSURE}:
        return doc_kind
    if doc_kind == "writeoff":
        return DebtWorkItem.Kind.CLOSURE
    return DebtWorkItem.Kind.WARNING


STANDARD_STEPS = [
    {"order": 1, "action": "call", "wait_days": 0, "template": "Голос группы 1", "terminal": False},
    {"order": 2, "action": "manual_call", "wait_days": 1, "template": "", "terminal": False},
    {"order": 3, "action": "warning", "wait_days": 5, "template": "Предупреждение", "terminal": False},
    {"order": 4, "action": "disconnect", "wait_days": 0, "approval": True, "terminal": False},
    {"order": 5, "action": "writ", "wait_days": 0, "branch_group": 3, "terminal": True},
]


def ensure_standard_scenario() -> None:
    if ScenarioDefinition.objects.filter(organization=None, name="Стандартное взыскание").exists():
        return
    ScenarioDefinition.objects.create(
        organization=None, name="Стандартное взыскание", status=ScenarioDefinition.Status.ACTIVE,
        version=1, steps=STANDARD_STEPS,
    )
