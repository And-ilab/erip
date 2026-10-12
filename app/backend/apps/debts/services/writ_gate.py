"""Проверка чек-листа надписи по сценарию, назначенному на лицевой счёт."""

from datetime import timedelta

from django.core.exceptions import ObjectDoesNotExist
from django.utils import timezone

from apps.debts.models import AccountScenarioRun, Measure
from apps.nsi.services.timelines import warning_wait_for
from apps.nsi.services.writ_checklist import CATALOG, LOCKED, ChecklistInvalid, default_checklist, normalize_checklist


def checklist_rows(case) -> list[dict]:
    """Этапы в порядке сценария и факт выполнения каждого."""
    rows = _stored(case.account)
    return [{**row, "locked": row["code"] in LOCKED, **_status(case, row["code"])} for row in rows]


def assert_writ_checklist(case, skip_reason: str = "", *, defer: frozenset[str] = frozenset()) -> None:
    """Обязательный этап блокирует переход. Пропуск записывается с причиной.

    defer — коды, которые вызывающий закроет сам до повторной проверки.
    «Подписать и направить» сначала собирает пакет, потом проверяет его.
    """
    from apps.debts.services.claims import ClaimBlocked

    pending_optional = []
    for row in checklist_rows(case):
        if row["code"] in defer or row["met"]:
            continue
        if row["mandatory"]:
            raise ClaimBlocked(f"{row['name']}: {row['gap']}")
        pending_optional.append(row["name"])
    if not pending_optional:
        return
    reason = (skip_reason or "").strip()
    if not reason:
        raise ClaimBlocked(f"Пропуск этапа записывается с причиной: {', '.join(pending_optional)}")
    case.skip_reason = reason[:500]
    case._checklist_skip = True


def _stored(account) -> list[dict]:
    step = _writ_step(account)
    raw = None if step is None else step.get("checklist")
    if not raw:
        return default_checklist()
    try:
        return normalize_checklist(raw)
    except ChecklistInvalid:
        return default_checklist()


def _writ_step(account) -> dict | None:
    run = AccountScenarioRun.objects.filter(account_id=account.pk).select_related("scenario").first()
    if run is None:
        return None
    revision = run.scenario.revisions.filter(version=run.version).first()
    steps = list((revision.steps if revision else run.scenario.steps) or [])
    group = account.effective_group or 0
    legal = bool((account.payer_unp or "").strip()) and not (account.payer_identifier or "").strip()
    for step in steps:
        if step.get("action") != "writ":
            continue
        groups = step.get("groups") or []
        if groups and group not in [int(item) for item in groups]:
            continue
        minimum = step.get("branch_group")
        if minimum not in (None, "", 0) and group < int(minimum):
            continue
        party = step.get("party") or "any"
        if party == "legal" and not legal:
            continue
        if party == "person" and legal:
            continue
        return step
    return None


def _status(case, code: str) -> dict:
    gap = _gap(case, code)
    return {"met": gap is None, "gap": gap or ""}


def _gap(case, code: str) -> str | None:
    if code == "warning":
        if not case.warning_delivered_on:
            return "Нет даты вручения предупреждения"
        return None
    if code == "voluntary":
        if not case.warning_delivered_on:
            return "Нет даты вручения предупреждения"
        due = case.warning_delivered_on + timedelta(days=warning_wait_for(case.account.organization))
        if timezone.localdate() < due:
            return f"Срок добровольной оплаты ещё не истёк, до {due.isoformat()}"
        return None
    if code == "tariff":
        if case.application_withdrawn or case.notary_tariff is None or case.notary_tariff <= 0:
            return "Нет нотариального тарифа"
        return None
    if code == "package":
        if not _package_formed(case):
            return "Пакет на исполнительную надпись ещё не сформирован"
        return None
    if code == "disconnect":
        done = Measure.objects.filter(
            accounts=case.account, kind=Measure.Kind.DISCONNECT, status=Measure.Status.DONE,
        ).exists()
        if done or case.account.funnel_stage == "disconnect":
            return None
        return "Нет завершённого отключения услуг"
    return CATALOG.get(code, {}).get("criteria") or "Этап не выполнен"


def _package_formed(case) -> bool:
    try:
        package = case.package
    except ObjectDoesNotExist:
        return False
    return bool(package and package.formed_at)
