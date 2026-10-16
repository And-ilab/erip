"""Шаги сценария на карточке лицевого счёта.

Мероприятия, которые сценарий уже создал, лежат внутри шага. Мероприятия,
запущенные специалистом вне шага, остаются в отдельной группе.
"""

from __future__ import annotations

from apps.debts.models import AccountScenarioRun, Measure
from apps.debts.services.tasks import task_row
from apps.nsi.services.scenario_engine import ACTION_KIND

DEFAULT_STEPS = (
    ("call", "Автообзвон"),
    ("notice", "Уведомление"),
    ("warning", "Предупреждение"),
    ("writ", "Исполнительная надпись"),
    ("opi", "ОПИ"),
)

_KIND_TO_ACTION = {
    Measure.Kind.CALL: "call",
    Measure.Kind.NOTICE: "notice",
    Measure.Kind.WARNING: "warning",
    Measure.Kind.DISCONNECT: "disconnect",
    Measure.Kind.COLLECTION: "writ",
}


def scenario_outline(account) -> dict:
    run = AccountScenarioRun.objects.filter(account=account).select_related("scenario").first()
    scenario = run.scenario if run is not None else None
    steps = _steps(scenario)
    measures = list(account.measures.all())
    used: set[int] = set()
    payload = []
    for index, step in enumerate(steps):
        action = step["action"]
        matched = [
            row for row in measures
            if row.pk not in used and _same_step(row, action, step["order"])
        ]
        for row in matched:
            used.add(row.pk)
        payload.append({**step, "measures": [_measure(row) for row in matched], "index": index})
    manual = [_measure(row) for row in measures if row.pk not in used]
    return {
        "scenario_id": scenario.pk if scenario else None,
        "scenario_name": scenario.name if scenario else (account.scenario_name or ""),
        "steps": payload,
        "manual": manual,
    }


def _steps(scenario) -> list[dict]:
    stored = list(scenario.steps or []) if scenario is not None else []
    if not stored:
        return [
            {"order": index + 1, "action": action, "title": title, "checklist": []}
            for index, (action, title) in enumerate(DEFAULT_STEPS)
        ]
    rows = []
    for index, step in enumerate(stored):
        action = str(step.get("action") or "")
        rows.append({
            "order": step.get("order") or index + 1,
            "action": action,
            "title": _title(action),
            "checklist": list(step.get("checklist") or []),
        })
    return rows


def _title(action: str) -> str:
    labels = dict(DEFAULT_STEPS)
    labels.update({
        "manual_call": "Ручной обзвон",
        "sms": "Уведомление",
        "email": "Уведомление",
        "disconnect": "Отключение",
        "lawsuit": "Иск",
    })
    return labels.get(action, action or "Шаг")


def _same_step(measure: Measure, action: str, order) -> bool:
    expected = ACTION_KIND.get(action)
    kind_code = expected[0] if isinstance(expected, tuple) else action
    if measure.source_action:
        return measure.source_action == action or (
            measure.source_step == order and ACTION_KIND.get(measure.source_action, ("", ""))[0] == kind_code
        )
    return _KIND_TO_ACTION.get(measure.kind) == action or measure.kind == kind_code


def _measure(measure: Measure) -> dict:
    return {
        "id": measure.pk,
        "kind": measure.kind,
        "kind_label": measure.get_kind_display(),
        "status": measure.status,
        "status_label": measure.get_status_display(),
        "source_action": measure.source_action,
        "tasks": [task_row(task) for task in measure.tasks.all()],
    }
