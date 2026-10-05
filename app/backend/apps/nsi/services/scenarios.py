"""Конструктор сценариев и печатных форм (ТЗ 4.2.5). Мессенджер в шаге не отправляет сообщения."""

import uuid

from django.core.files.base import ContentFile

from apps.core.exceptions import ServiceError
from apps.debts.models import AccountScenarioRun, DebtWorkItem, ScenarioPause
from apps.debts.services.artifacts import _pdf_bytes
from apps.nsi.models import (
    CalculationSettings, PrintForm, PrintFormRevision, PrintedDocument, ScenarioDefinition, ScenarioRevision,
)

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
        groups = step.get("groups") or []
        if groups and (
            not isinstance(groups, list) or any(not isinstance(item, int) or item < 1 or item > 6 for item in groups)
        ):
            raise ScenarioInvalid("Группы шага — числа от 1 до 6")
        party = step.get("party") or "any"
        if party not in {"any", "person", "legal"}:
            raise ScenarioInvalid("Лицо шага: любое, физическое или юридическое")
        org_kind = step.get("org_kind") or "any"
        if org_kind not in {"any", "billing", "supplier"}:
            raise ScenarioInvalid("Тип организации: любая, начисляющая или поставщик")
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


def publish(scenario: ScenarioDefinition, user, *, apply_to_running: bool = False) -> tuple[list[str], int]:
    warnings = check_steps(scenario.steps)
    last = scenario.revisions.order_by("-version").values_list("version", flat=True).first()
    scenario.version = (last or 0) + 1
    scenario.status = ScenarioDefinition.Status.ACTIVE
    scenario.save(update_fields=["version", "status", "updated_at"])
    ScenarioRevision.objects.create(
        scenario=scenario, version=scenario.version, steps=scenario.steps, author=user,
    )
    moved = 0
    if apply_to_running:
        moved = AccountScenarioRun.objects.filter(scenario=scenario).update(version=scenario.version)
    return warnings, moved


def restore_scenario(scenario: ScenarioDefinition, version: int, user, *, apply_to_running: bool = False) -> tuple[list[str], int]:
    """Откат публикует старые шаги новым номером. Уже запущенные счета не двигаются, пока это не выбрано."""
    revision = scenario.revisions.filter(version=version).first()
    if revision is None:
        raise ScenarioInvalid("Такой версии сценария нет")
    scenario.steps = revision.steps
    scenario.save(update_fields=["steps", "updated_at"])
    return publish(scenario, user, apply_to_running=apply_to_running)


def copy_scenario(scenario: ScenarioDefinition, user) -> ScenarioDefinition:
    organization = None if user.is_superadmin else user.organization
    return ScenarioDefinition.objects.create(
        organization=organization,
        name=f"{scenario.name} (копия)",
        status=ScenarioDefinition.Status.DRAFT,
        version=1,
        steps=scenario.steps,
        based_on=scenario,
        call_legal=scenario.call_legal,
        dial_mobile_from_day=scenario.dial_mobile_from_day,
        dial_mobile_weekdays=scenario.dial_mobile_weekdays,
    )


def assign_run(account, scenario: ScenarioDefinition, user, *, upgrade: bool = False, paused: bool = False, reason: str = ""):
    if scenario.status != ScenarioDefinition.Status.ACTIVE:
        raise ScenarioInvalid("На лицевой счёт назначается опубликованный сценарий")
    if paused and not reason.strip():
        raise ScenarioInvalid("Пауза записывается с причиной")
    run = AccountScenarioRun.objects.filter(account=account).first()
    if run is None:
        run = AccountScenarioRun.objects.create(
            organization=account.organization, account=account, scenario=scenario, version=scenario.version,
            paused=paused, pause_reason=reason,
        )
        ScenarioPause.objects.create(run=run, paused=paused, reason=reason, actor=user)
    else:
        pause_changed = run.paused != paused or (run.pause_reason or "") != reason
        if upgrade or run.scenario_id != scenario.pk:
            run.scenario = scenario
            run.version = scenario.version
        run.paused = paused
        run.pause_reason = reason
        run.save()
        if pause_changed:
            ScenarioPause.objects.create(run=run, paused=paused, reason=reason, actor=user)
    if not paused:
        from apps.nsi.services.scenario_engine import advance_account

        advance_account(account)
    return run


def layout_of(form: PrintForm) -> dict:
    return {
        "addressee": form.addressee,
        "font_size": form.font_size,
        "indent_mm": form.indent_mm,
        "logo_text": form.logo_text,
        "requisites": form.requisites,
        "signatory": form.signatory,
        "doc_kind": form.doc_kind,
    }


def render_print(form: PrintForm, account, tariff: str = "", batch: str = "") -> PrintedDocument:
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
    lines = _document_lines(form, text)
    payload = _pdf_bytes(lines, font_size=form.font_size or 12, indent_mm=form.indent_mm or 0)
    document = PrintedDocument(
        form=form, version=form.version, account=account, addressee=form.addressee or "debtor",
        body=text, batch=batch,
    )
    document.file.save(
        f"{form.code}-v{form.version}-{account.pk}.pdf", ContentFile(payload), save=True,
    )
    DebtWorkItem.objects.create(
        organization=account.organization, account=account, kind=_work_kind(form.doc_kind),
        title=form.name, note=f"Собран по шаблону {form.code} версии {form.version}",
    )
    return document


def package_pdf(form: PrintForm, batch: str) -> bytes:
    documents = form.documents.filter(batch=batch).select_related("account").order_by("id")
    lines = [form.logo_text, form.requisites, ""]
    for document in documents:
        lines.append(f"ЛС {document.account.client_account} · версия макета {document.version}")
        lines.extend(document.body.splitlines() or [""])
        lines.append("")
    if form.signatory:
        lines.append(form.signatory)
    return _pdf_bytes(lines, font_size=form.font_size or 12, indent_mm=form.indent_mm or 0)


def new_batch() -> str:
    return uuid.uuid4().hex


def _document_lines(form: PrintForm, text: str) -> list[str]:
    lines = []
    if form.logo_text:
        lines.append(form.logo_text)
    if form.requisites:
        lines.extend(form.requisites.splitlines())
    if lines:
        lines.append("")
    lines.extend(text.splitlines() or [""])
    if form.signatory:
        lines.extend(["", form.signatory])
    return lines


def restore_print(form: PrintForm, version: int) -> PrintForm:
    """Старый текст становится новой версией. Уже собранные документы остаются на номере, которым их печатали."""
    revision = form.revisions.filter(version=version).first()
    if revision is None:
        raise ScenarioInvalid("Такой версии печатной формы нет")
    previous = form.body
    previous_layout = layout_of(form)
    form.body = revision.body
    for key, value in (revision.layout or {}).items():
        if key in {"addressee", "font_size", "indent_mm", "logo_text", "requisites", "signatory"}:
            setattr(form, key, value)
    form.save(update_fields=[
        "body", "addressee", "font_size", "indent_mm", "logo_text", "requisites", "signatory", "updated_at",
    ])
    remember_print_version(form, previous, previous_layout)
    return form


def remember_print_version(form: PrintForm, previous_body: str | None, previous_layout: dict | None = None) -> None:
    layout = layout_of(form)
    if previous_body is None:
        PrintFormRevision.objects.get_or_create(
            form=form, version=form.version, defaults={"body": form.body, "layout": layout},
        )
        return
    if previous_body == form.body and (previous_layout or layout) == layout:
        return
    form.version += 1
    form.save(update_fields=["version", "updated_at"])
    PrintFormRevision.objects.create(form=form, version=form.version, body=form.body, layout=layout)


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
    scenario = ScenarioDefinition.objects.filter(organization=None, name="Стандартное взыскание").first()
    if scenario is None:
        scenario = ScenarioDefinition.objects.create(
            organization=None, name="Стандартное взыскание", status=ScenarioDefinition.Status.ACTIVE,
            version=1, steps=STANDARD_STEPS,
        )
    if not scenario.revisions.filter(version=scenario.version).exists():
        ScenarioRevision.objects.create(scenario=scenario, version=scenario.version, steps=scenario.steps)
