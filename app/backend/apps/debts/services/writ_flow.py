"""Шаг «исполнительная надпись» открывает одно дело и подставляет печатные формы.

Названия пунктов задания берутся из чек-листа сценария. В кабинет БНП модуль не ходит.
"""

from __future__ import annotations

from django.db.models import Q

from apps.debts.models import ClaimCase, ClaimPackage, Measure, MeasureTask, TaskCheck

TEMPLATE_KINDS = ("warning", "writ", "calculation", "proxy")


def seed_task_checks(case: ClaimCase) -> None:
    """Порядок и названия чек-листа сценария становятся пунктами задания того же мероприятия."""
    from apps.debts.services.writ_gate import checklist_rows

    measure = _collection_measure(case.account)
    if measure is None:
        return
    task = measure.tasks.order_by("id").first()
    if task is None:
        task = MeasureTask.objects.create(
            organization=case.organization,
            measure=measure,
            assignee_id=case.account.assigned_to_id,
            title="Собрать документы исполнительной надписи",
        )
    if task.checks.exists():
        return
    for row in checklist_rows(case):
        TaskCheck.objects.create(
            organization=case.organization, task=task, title=str(row.get("name") or "")[:250],
        )


def fill_writ_templates(case: ClaimCase, user) -> None:
    """PDF из печатных форм заявления, расчёта, доверенности и предупреждения.

    Уже приложенный файл этого типа не заменяется.
    """
    if user is None:
        return
    from apps.debts.services.bnp_package import generate_from_form
    from apps.debts.services.claims import ClaimBlocked

    present = _present_types(case)
    for kind in TEMPLATE_KINDS:
        form = _form_for(user, kind)
        if form is None:
            continue
        doc_type = _doc_type(kind)
        if doc_type in present:
            continue
        try:
            generate_from_form(case, user, form.pk)
        except ClaimBlocked:
            continue
        present.add(doc_type)


def _doc_type(kind: str) -> str:
    if kind == "writ":
        return "application"
    if kind == "calculation":
        return "debt_calculation"
    if kind == "proxy":
        return "proxy"
    return "other_document"


def _collection_measure(account) -> Measure | None:
    measure = Measure.objects.filter(accounts=account, source_action="claim").order_by("id").first()
    if measure is not None:
        return measure
    return (
        Measure.objects.filter(accounts=account, kind=Measure.Kind.COLLECTION, source_action="writ")
        .order_by("id")
        .first()
    )


def _present_types(case: ClaimCase) -> set[str]:
    package = ClaimPackage.objects.filter(case=case).first()
    if package is None:
        return set()
    return set(package.documents.exclude(pdf="").values_list("doc_type", flat=True))


def _form_for(user, kind: str):
    from apps.nsi.models import PrintForm

    qs = PrintForm.objects.filter(is_active=True, doc_kind=kind)
    if not getattr(user, "is_superadmin", False):
        qs = qs.filter(Q(organization__isnull=True) | Q(organization_id=getattr(user, "organization_id", None)))
    return qs.order_by("id").first()
