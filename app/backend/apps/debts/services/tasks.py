"""Задания внутри мероприятия и чек-лист, который заводит пользователь."""

from datetime import datetime

from apps.debts.models import Measure, MeasureTask, TaskCheck
from apps.users.models import User


class TaskError(Exception):
    def __init__(self, detail):
        self.detail = detail


def add_task(measure: Measure, user, title: str, due_on=None, assignee_id=None) -> MeasureTask:
    text = (title or "").strip()
    if not text:
        raise TaskError({"title": "Укажите задание"})
    assignee = None
    if assignee_id:
        assignee = User.objects.filter(pk=assignee_id, is_active=True, organization_id=measure.organization_id).first()
        if assignee is None:
            raise TaskError({"assignee": "Исполнитель не из этой схемы"})
    due = _date(due_on)
    return MeasureTask.objects.create(
        organization=measure.organization, measure=measure, assignee=assignee, title=text[:250], due_on=due,
    )


def set_task_status(measure: Measure, task_id: int, status: str) -> MeasureTask:
    task = measure.tasks.filter(pk=task_id).first()
    if task is None:
        raise TaskError({"task_id": "Задание не найдено"})
    if status not in {MeasureTask.Status.OPEN, MeasureTask.Status.DONE}:
        raise TaskError({"status": "Статус: open или done"})
    task.status = status
    task.save(update_fields=["status", "updated_at"])
    return task


def add_check(measure: Measure, task_id: int, title: str) -> TaskCheck:
    task = measure.tasks.filter(pk=task_id).first()
    if task is None:
        raise TaskError({"task_id": "Задание не найдено"})
    text = (title or "").strip()
    if not text:
        raise TaskError({"title": "Укажите пункт чек-листа"})
    return TaskCheck.objects.create(organization=measure.organization, task=task, title=text[:250])


def set_check(measure: Measure, check_id: int, done: bool) -> TaskCheck:
    row = TaskCheck.objects.filter(pk=check_id, task__measure=measure).first()
    if row is None:
        raise TaskError({"check_id": "Пункт не найден"})
    row.done = bool(done)
    row.save(update_fields=["done", "updated_at"])
    return row


def _date(value):
    if not value:
        return None
    if hasattr(value, "year") and not isinstance(value, str):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError as exc:
        raise TaskError({"due_on": "Дата в формате ГГГГ-ММ-ДД"}) from exc
