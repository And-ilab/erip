"""Дело взыскания — та же строка, что реестр мероприятий. Иначе ЛС есть в исковой работе и нет в мероприятиях."""

from django.db.models import Count, Q, QuerySet
from django.utils import timezone

from apps.debts.models import Account, ClaimCase, Measure, MeasureItem

STAGE_STATUS = {
    ClaimCase.Stage.PREP: Measure.Status.ASSIGNED,
    ClaimCase.Stage.NOTARY: Measure.Status.RUNNING,
    ClaimCase.Stage.WRIT_DONE: Measure.Status.RUNNING,
    ClaimCase.Stage.REFUSED: Measure.Status.RUNNING,
    ClaimCase.Stage.LAWSUIT: Measure.Status.RUNNING,
    ClaimCase.Stage.COURT: Measure.Status.RUNNING,
    ClaimCase.Stage.OPI: Measure.Status.RUNNING,
    ClaimCase.Stage.OPI_MEASURES: Measure.Status.RUNNING,
    ClaimCase.Stage.RECOVERED: Measure.Status.DONE,
    ClaimCase.Stage.IMPOSSIBLE: Measure.Status.RUNNING,
    ClaimCase.Stage.WRITEOFF: Measure.Status.DONE,
}


def sync_claim_measure(case: ClaimCase) -> Measure:
    """Этап дела становится статусом и названием мероприятия. Отказ остаётся строкой, а не пустым списком."""
    account = case.account
    status = STAGE_STATUS.get(case.stage, Measure.Status.RUNNING)
    label = case.get_stage_display()
    note = (case.notary_note or case.skip_reason or label)[:500]
    measure = Measure.objects.filter(accounts=account, source_action="claim").order_by("id").first()
    if measure is None:
        measure = Measure.objects.create(
            organization=account.organization,
            kind=Measure.Kind.COLLECTION,
            status=status,
            template_name=label,
            scenario_name=label,
            note=note,
            started_on=timezone.localdate(),
            due_on=timezone.localdate(),
            assignee_id=account.assigned_to_id,
            source_action="claim",
        )
        measure.accounts.add(account)
    else:
        fields = []
        if measure.status != status:
            measure.status = status
            fields.append("status")
        if measure.template_name != label:
            measure.template_name = label
            fields.append("template_name")
        if measure.scenario_name != label:
            measure.scenario_name = label
            fields.append("scenario_name")
        if measure.note != note:
            measure.note = note
            fields.append("note")
        if measure.assignee_id != account.assigned_to_id:
            measure.assignee_id = account.assigned_to_id
            fields.append("assignee")
        if fields:
            measure.save(update_fields=[*fields, "updated_at"])
    item_status = _item_status(status)
    item = measure.items.filter(account=account).first()
    if item is None:
        MeasureItem.objects.create(
            organization=account.organization, measure=measure, account=account,
            status=item_status, note=note,
        )
    elif item.status != item_status or item.note != note:
        item.status = item_status
        item.note = note
        item.save(update_fields=["status", "note", "updated_at"])
    return measure


def backfill_visible_measures(accounts: QuerySet) -> None:
    """Открытие реестра добирает строки: дело взыскания и счёт с группой долга без мероприятия."""
    if not accounts.exists():
        return
    for case in ClaimCase.objects.filter(account__in=accounts).select_related("account"):
        sync_claim_measure(case)
    claimed = ClaimCase.objects.filter(account__in=accounts).values("account_id")
    # order_by() снимает сортировку модели. Иначе PostgreSQL отвергает GROUP BY по id
    # вместе с ORDER BY client_account, и реестр отвечает 500.
    bare = (
        accounts.filter(Q(debt_group__isnull=False) | Q(debt_group_manual__isnull=False))
        .exclude(pk__in=claimed)
        .order_by()
        .values("pk")
        .annotate(measure_count=Count("measures"))
        .filter(measure_count=0)
        .order_by("pk")
        .values_list("pk", flat=True)[:2000]
    )
    ids = list(bare)
    retry = list(
        accounts.filter(measures__kind=Measure.Kind.CALL, measures__status=Measure.Status.FAILED)
        .order_by()
        .values_list("pk", flat=True)
        .distinct()[:2000]
    )
    ordered = list(dict.fromkeys([*ids, *retry]))
    if not ordered:
        return
    from apps.nsi.services.scenario_engine import ensure_imported_runs

    ensure_imported_runs(ordered)


def backfill_account(account: Account) -> None:
    case = ClaimCase.objects.filter(account=account).first()
    if case is not None:
        sync_claim_measure(case)
        return
    if account.effective_group:
        from apps.nsi.services.scenario_engine import ensure_imported_run

        ensure_imported_run(account)


def _item_status(status: str) -> str:
    if status == Measure.Status.DONE:
        return MeasureItem.Status.DONE
    if status == Measure.Status.CANCELLED:
        return MeasureItem.Status.CANCELLED
    if status == Measure.Status.FAILED:
        return MeasureItem.Status.FAILED
    if status == Measure.Status.ASSIGNED:
        return MeasureItem.Status.ASSIGNED
    return MeasureItem.Status.RUNNING
