"""Дело взыскания: чек-лист перехода, заглушки БНП и ОПИ, маршрут списания (ТЗ 4.2.4)."""

from datetime import date, datetime
from decimal import Decimal

from django.db.models import Exists, OuterRef, Q, QuerySet
from django.utils import timezone

from apps.core.exceptions import ServiceError
from apps.debts.models import Attachment, ClaimAct, ClaimApproval, ClaimCase, ClaimEvent, DebtWorkItem
from apps.notifications.models import Channel, Notification
from apps.users.models import User

LAWSUIT_KINDS = {code for code, _label in ClaimCase.LawsuitKind.choices}
EVICTION = {"notice", "lawsuit", "court", "enforced"}


def _claim_ready(account) -> bool:
    if (account.effective_group or 0) >= 3:
        return True
    if account.measures.filter(kind="collection").exists():
        return True
    from apps.debts.services.measures import _service_group

    return any(_service_group(service) >= 3 for service in account.services.all())


def claims_population(queryset: QuerySet) -> QuerySet:
    """Должники претензионно-исковой работы.

    Модуль включается с группы 3. Сюда же попадает уже открытое дело,
    этап «Испол. надпись / иск» или «ОПИ» и мероприятие «взыскание».
    """
    shown_group = Q(debt_group_manual__gte=3) | Q(debt_group_manual__isnull=True, debt_group__gte=3)
    matched = queryset.model.objects.filter(
        Q(pk=OuterRef("pk")),
        Q(claim_case__isnull=False)
        | Q(funnel_stage__in=[
            "enforcement", "court", "prep", "notary", "writ_done", "refused",
            "lawsuit", "judgment", "opi", "opi_measures", "impossible", "writeoff",
        ])
        | Q(measures__kind="collection")
        | shown_group,
    )
    return queryset.filter(Exists(matched))


NOTARY_STAGES = ("prep", "notary", "writ_done", "refused")
COURT_STAGES = ("lawsuit", "court")
SHARED_STAGES = ("opi", "opi_measures", "recovered", "impossible", "writeoff")
OPI_MODULE_STAGES = ("writ_done", "court", *SHARED_STAGES)

OPI_MEASURE_KINDS = (
    ("asset_arrest", "Арест имущества"),
    ("account_seizure", "Арест и списание денежных средств со счетов (АИС ИДО)"),
    ("wage_deduction", "Обращение взыскания на заработную плату и приравненные доходы"),
    ("travel_ban", "Временное ограничение права должника на выезд из Республики Беларусь"),
    ("drive_ban", "Временное ограничение права должника на управление механическими ТС"),
    ("reg_ban", "Запрет на совершение регистрационных действий в отношении имущества"),
    ("search", "Розыск должника / имущества должника"),
    ("inventory", "Опись и изъятие имущества"),
)

OPI_STATUS_CHOICES = (
    ("Возбуждено", "Возбуждено"),
    ("На исполнении", "На исполнении"),
    ("Меры приняты", "Меры приняты"),
    ("Частично исполнено", "Частично исполнено"),
    ("Приостановлено", "Приостановлено"),
    ("Окончено (взыскано)", "Окончено (взыскано)"),
    ("Возвращено (акт о невозможности взыскания)", "Возвращено (акт о невозможности взыскания)"),
    ("Прекращено", "Прекращено"),
)


def claims_on_module(queryset: QuerySet, module: str) -> QuerySet:
    """Одна ветка — одно место на доске.

    ОПИ и итог есть и у надписи, и у иска, но карточка остаётся на той ветке,
    которая до них дошла. Вход в иск или решение суда уводит дело из нотариата.
    Модуль «opi» показывает все дела, готовые к передаче в ОПИ или проходящие через ОПИ.
    """
    if module == "opi":
        return queryset.filter(
            Q(claim_case__stage__in=OPI_MODULE_STAGES)
            | Q(funnel_stage__in=[
                "writ_done", "judgment", "court", "opi", "opi_measures", "recovered", "impossible", "writeoff",
            ]),
        ).distinct()
    if module not in {"notary", "court"}:
        return queryset
    court_path = ClaimEvent.objects.filter(
        case__account_id=OuterRef("pk"),
        new_stage__in=COURT_STAGES,
    )
    marked = queryset.annotate(_court_path=Exists(court_path))
    if module == "court":
        return marked.filter(
            Q(claim_case__stage__in=COURT_STAGES) | Q(claim_case__stage__in=SHARED_STAGES, _court_path=True),
        )
    return marked.filter(
        Q(claim_case__isnull=True)
        | Q(claim_case__stage__in=NOTARY_STAGES)
        | Q(claim_case__stage__in=SHARED_STAGES, _court_path=False),
    )


class ClaimBlocked(ServiceError):
    default_detail = "Переход по делу заблокирован"
    default_code = "claim_blocked"


def open_case(account, user) -> ClaimCase:
    existing = ClaimCase.objects.filter(account=account).first()
    created = False
    if existing is None:
        if not _claim_ready(account):
            raise ClaimBlocked("Исполнительная надпись и иск включаются с группы 3")
        existing, created = ClaimCase.objects.get_or_create(
            account=account,
            defaults={"organization": account.organization, "defendant_name": account.short_fio},
        )
        if created:
            _event(existing, user, "", ClaimCase.Stage.PREP, "Дело открыто")
    from apps.debts.services.claim_measures import sync_claim_measure
    from apps.debts.services.writ_flow import seed_task_checks

    sync_claim_measure(existing)
    seed_task_checks(existing)
    return existing


DATE_FIELDS = {
    "warning_delivered_on", "lawsuit_filed_on", "package_filed_on",
    "opi_sent_on", "opi_started_on", "opi_ended_on",
}
MONEY_FIELDS = {"notary_tariff", "state_duty"}


def update_case(case: ClaimCase, data: dict, user) -> ClaimCase:
    previous_warning = case.warning_delivered_on
    previous_tariff = case.notary_tariff
    if "notary_office" in data:
        data["notary_office"] = str(data.get("notary_office") or "").strip()[:250]
    if data.get("application_withdrawn"):
        data["notary_tariff"] = Decimal("0")
    kind = data.get("lawsuit_kind")
    if kind and kind not in LAWSUIT_KINDS:
        raise ClaimBlocked("Неизвестный вид иска")
    eviction = data.get("eviction_stage")
    if eviction and eviction not in EVICTION:
        raise ClaimBlocked("Неизвестный этап ветви выселения")
    for field, value in data.items():
        setattr(case, field, _coerce(field, value))
    case.save()
    if case.warning_delivered_on != previous_warning or case.notary_tariff != previous_tariff:
        from apps.debts.services.bnp_package import drop_formed_package

        drop_formed_package(case)
    _event(case, user, case.stage, case.stage, "Карточка дела изменена")
    from apps.debts.services.claim_measures import sync_claim_measure

    sync_claim_measure(case)
    sync_case_checks(case)
    return case


ADJACENT = {
    ClaimCase.Stage.PREP: {ClaimCase.Stage.NOTARY},
    ClaimCase.Stage.NOTARY: {ClaimCase.Stage.WRIT_DONE, ClaimCase.Stage.REFUSED},
    ClaimCase.Stage.WRIT_DONE: {ClaimCase.Stage.OPI},
    ClaimCase.Stage.REFUSED: {ClaimCase.Stage.LAWSUIT},
    ClaimCase.Stage.LAWSUIT: {ClaimCase.Stage.COURT},
    ClaimCase.Stage.COURT: {ClaimCase.Stage.OPI},
    ClaimCase.Stage.OPI: {ClaimCase.Stage.OPI_MEASURES},
    ClaimCase.Stage.OPI_MEASURES: {ClaimCase.Stage.RECOVERED, ClaimCase.Stage.IMPOSSIBLE},
    ClaimCase.Stage.IMPOSSIBLE: {ClaimCase.Stage.WRITEOFF},
}


def stage_is_skip(case: ClaimCase, stage: str) -> bool:
    """Переход мимо соседнего этапа. Обычный следующий шаг пропуском не считается."""
    if stage == case.stage:
        return False
    return stage not in ADJACENT.get(case.stage, set())


def move_case(case: ClaimCase, stage: str, user, reason: str = "", *, checklist_reason: str | None = None) -> ClaimCase:
    if stage not in ClaimCase.Stage.values:
        raise ClaimBlocked("Неизвестный этап")
    if stage == case.stage:
        return case
    skipping = stage_is_skip(case, stage)
    supplied = reason if checklist_reason is None else checklist_reason
    from apps.debts.services.document_gate import claim_gate

    claim_gate(case, stage, supplied or "")
    _guard(case, stage, reason, checklist_reason=supplied)
    kept = case.skip_reason if getattr(case, "_checklist_skip", False) else None
    old = case.stage
    case.stage = stage
    if reason and skipping:
        case.skip_reason = reason
    if kept:
        case.skip_reason = kept
    if stage == ClaimCase.Stage.WRITEOFF:
        case.writeoff_note = "Акт о списании сформирован. Уведомление в АИС «Расчет-ЖКУ» ещё не выгружено."
        DebtWorkItem.objects.create(
            organization=case.organization, account=case.account, kind=DebtWorkItem.Kind.CLOSURE,
            title="Акт о списании задолженности", note=case.writeoff_note, started_on=timezone.localdate(),
        )
    case.save()
    _event(case, user, old, stage, reason or "Переход по воронке")
    from apps.debts.services.claim_measures import sync_claim_measure

    sync_claim_measure(case)
    from apps.debts.services.funnel import claim_to_account_stage, set_stage

    mapped = claim_to_account_stage(stage)
    if mapped:
        set_stage(case.account, mapped, user, reason or "Переход дела", check=False)
    if case.account.assigned_to_id and stage == ClaimCase.Stage.WRITEOFF:
        _notify(case, case.account.assigned_to_id, "Сформирован акт о списании. В АИС уйдёт уведомление, когда появится файл статусов.")
    sync_case_checks(case)
    return case


def send_to_notary(case: ClaimCase, user, skip_reason: str = "") -> ClaimCase:
    _require_notary_fields(case, skip_reason)
    from apps.debts.services.bnp_package import require_formed_package

    require_formed_package(case)
    case.submission_mode = "stub"
    case.submission_id = f"stub-{case.pk}"
    note = f"Заглушка БНП, номер {case.submission_id}"
    if skip_reason.strip():
        note = f"{note}. Пропуск: {skip_reason.strip()}"
    case.save(update_fields=["submission_mode", "submission_id", "updated_at"])
    DebtWorkItem.objects.create(
        organization=case.organization, account=case.account, kind=DebtWorkItem.Kind.WRIT,
        title="Пакет на исполнительную надпись",
        note="Пакет сформирован в ПМ. В личный кабинет БНП не отправлялся: канал-заглушка.",
        started_on=timezone.localdate(),
    )
    return move_case(case, ClaimCase.Stage.NOTARY, user, note, checklist_reason=skip_reason)


def notary_result(case: ClaimCase, result: str, user, note: str = "", attachment_id=None) -> ClaimCase:
    if case.stage != ClaimCase.Stage.NOTARY:
        raise ClaimBlocked("Результат нотариуса фиксируется со статуса «Направлено нотариусу»")
    file_name = _refusal_file(case, attachment_id) if result == "refused" else ""
    if result == "refused" and not note.strip() and not file_name:
        raise ClaimBlocked("Отказ нотариуса записывается с комментарием или постановлением об отказе")
    case.notary_note = note
    case.save(update_fields=["notary_note", "updated_at"])
    if result == "done":
        return move_case(case, ClaimCase.Stage.WRIT_DONE, user, note or "Надпись совершена")
    if result == "refused":
        reason = note.strip() or "Отказ нотариуса"
        if file_name:
            reason = f"{reason}. Файл: {file_name}"
        moved = move_case(case, ClaimCase.Stage.REFUSED, user, reason)
        return move_case(moved, ClaimCase.Stage.LAWSUIT, user, "Отказ открывает подготовку иска")
    raise ClaimBlocked("Результат: done или refused")


def _refusal_file(case: ClaimCase, attachment_id) -> str:
    rows = list(Attachment.objects.filter(account_id=case.account_id))
    if attachment_id:
        found = next((item for item in rows if item.pk == int(attachment_id)), None)
        if found is None:
            raise ClaimBlocked("Файл не с этого лицевого счёта")
        if _file_role(found.doc_type, found.original_name) != "scan":
            raise ClaimBlocked("Нужно постановление об отказе, а не другой файл счёта")
        return found.original_name
    for item in rows:
        if _file_role(item.doc_type, item.original_name) == "scan":
            return item.original_name
    return ""


def add_act(
    case: ClaimCase,
    title: str,
    user,
    *,
    act_number: str = "",
    act_date=None,
    reason: str = "",
    upload=None,
    attachment_id=None,
) -> ClaimAct:
    parsed_date = _coerce("opi_sent_on", act_date) if act_date else None
    attached = None
    if upload is not None:
        attached = Attachment.objects.create(
            organization=case.organization,
            account=case.account,
            doc_type="Акт ОПИ о невозможности взыскания",
            file=upload,
            original_name=getattr(upload, "name", "") or "act_opi.pdf",
            uploaded_by=user if getattr(user, "is_authenticated", False) else None,
        )
    elif attachment_id:
        attached = Attachment.objects.filter(account_id=case.account_id, pk=int(attachment_id)).first()
    act = ClaimAct.objects.create(
        organization=case.organization,
        case=case,
        title=(title or "").strip()[:250] or "Акт ОПИ",
        act_number=(act_number or "").strip()[:80],
        act_date=parsed_date,
        reason=(reason or "").strip()[:500],
        attachment=attached,
    )
    work_note_parts = [p for p in (act.act_number and f"№ {act.act_number}", act.reason) if p]
    item = DebtWorkItem.objects.create(
        organization=case.organization,
        account=case.account,
        kind=DebtWorkItem.Kind.IMPOSSIBILITY,
        title=act.title,
        started_on=act.act_date or timezone.localdate(),
        note="; ".join(work_note_parts)[:500] or "Акт ОПИ о невозможности взыскания",
    )
    if attached is not None and attached.work_item_id is None:
        attached.work_item = item
        attached.save(update_fields=["work_item", "updated_at"])
    _sync_opi_activity(case, "acts", f"{act.title} ({case.acts.count()})")
    detail = act.title
    if act.act_number:
        detail = f"{detail} № {act.act_number}"
    _event(case, user, case.stage, case.stage, f"Акт ОПИ: {detail}")
    return act


def remove_act(case: ClaimCase, act_id: int, user) -> ClaimCase:
    if case.stage == ClaimCase.Stage.WRITEOFF or case.writeoff_status == ClaimCase.WriteoffStatus.APPROVED:
        raise ClaimBlocked("После согласования списания акт ОПИ не удаляется")
    act = case.acts.filter(pk=act_id).first()
    if act is None:
        raise ClaimBlocked("Акт ОПИ не найден")
    title = act.title
    act.delete()
    _event(case, user, case.stage, case.stage, f"Удалён акт ОПИ: {title}")
    sync_case_checks(case)
    return case


def record_opi(
    case: ClaimCase,
    user,
    number: str,
    status: str,
    *,
    department: str | None = None,
    sent_on=None,
    started_on=None,
    ended_on=None,
    bailiff: str | None = None,
    note: str | None = None,
    manual: bool = True,
) -> ClaimCase:
    case.opi_number = (number or "").strip()[:50]
    case.opi_status = (status or "").strip()[:120]
    fields = ["opi_number", "opi_status", "updated_at"]
    if manual:
        case.opi_mode = "manual"
        fields.append("opi_mode")
    if department is not None:
        case.opi_department = str(department).strip()[:250]
        fields.append("opi_department")
        m = __import__("re").match(r"^(\d{2,6})\b", case.opi_department)
        if m:
            req = dict(case.pris_request or {})
            if not req.get("opi"):
                req["opi"] = m.group(1)
                case.pris_request = req
                fields.append("pris_request")
    if sent_on is not None:
        case.opi_sent_on = _coerce("opi_sent_on", sent_on)
        fields.append("opi_sent_on")
    elif case.opi_number and not case.opi_sent_on:
        case.opi_sent_on = timezone.localdate()
        fields.append("opi_sent_on")
    if started_on is not None:
        case.opi_started_on = _coerce("opi_started_on", started_on)
        fields.append("opi_started_on")
    if ended_on is not None:
        case.opi_ended_on = _coerce("opi_ended_on", ended_on)
        fields.append("opi_ended_on")
    if bailiff is not None:
        case.opi_bailiff = str(bailiff).strip()[:250]
        fields.append("opi_bailiff")
    if note is not None:
        case.opi_note = str(note).strip()[:500]
        fields.append("opi_note")
    case.save(update_fields=fields)
    summary = ", ".join(p for p in (case.opi_number and f"ИП {case.opi_number}", case.opi_status, case.opi_department) if p)
    _sync_opi_activity(case, "opi_send", summary or "Статус ОПИ внесён вручную")
    if manual:
        _event(case, user, case.stage, case.stage, "Статус ОПИ внесён вручную, сервисы 3.11.01–3.11.05 не вызывались")
    else:
        _event(case, user, case.stage, case.stage, "Чек-лист ОПИ обновлён")
    return case


def add_opi_measure(case: ClaimCase, user, data: dict, upload=None) -> ClaimCase:
    kind = str(data.get("kind") or "").strip()
    kind_labels = dict(OPI_MEASURE_KINDS)
    title = str(data.get("title") or "").strip() or kind_labels.get(kind, kind)
    if not title:
        raise ClaimBlocked("Укажите вид принятой меры ОПИ")
    measure_date = _coerce("opi_sent_on", data.get("date")) or timezone.localdate()
    doc_number = str(data.get("doc_number") or "").strip()[:80]
    note = str(data.get("note") or "").strip()[:500]
    attached = None
    if upload is not None:
        attached = Attachment.objects.create(
            organization=case.organization,
            account=case.account,
            doc_type=f"Постановление ОПИ: {title}"[:100],
            file=upload,
            original_name=getattr(upload, "name", "") or "opi_measure.pdf",
            uploaded_by=user if getattr(user, "is_authenticated", False) else None,
        )
    elif data.get("attachment_id"):
        attached = Attachment.objects.filter(account_id=case.account_id, pk=int(data["attachment_id"])).first()
    rows = list(case.opi_measures_taken or [])
    next_id = max((int(item.get("id") or 0) for item in rows if isinstance(item, dict)), default=0) + 1
    entry = {
        "id": next_id,
        "kind": kind or "custom",
        "title": title[:250],
        "date": measure_date.isoformat(),
        "doc_number": doc_number,
        "note": note,
        "attachment_id": attached.pk if attached else None,
        "attachment_name": attached.original_name if attached else "",
    }
    rows.append(entry)
    case.opi_measures_taken = rows
    case.save(update_fields=["opi_measures_taken", "updated_at"])
    _sync_opi_activity(case, "opi_act", f"{title} ({measure_date.strftime('%d.%m.%Y')})")
    _event(case, user, case.stage, case.stage, f"Мера ОПИ: {title}" + (f" (постановление № {doc_number})" if doc_number else ""))
    if data.get("move_stage") and case.stage in {ClaimCase.Stage.WRIT_DONE, ClaimCase.Stage.COURT, ClaimCase.Stage.OPI}:
        if case.stage in {ClaimCase.Stage.WRIT_DONE, ClaimCase.Stage.COURT}:
            case = move_case(case, ClaimCase.Stage.OPI, user, "Направлено в ОПИ")
        if case.stage == ClaimCase.Stage.OPI:
            case = move_case(case, ClaimCase.Stage.OPI_MEASURES, user, f"Принята мера ОПИ: {title}")
    return case


def remove_opi_measure(case: ClaimCase, measure_id: int, user) -> ClaimCase:
    rows = [item for item in (case.opi_measures_taken or []) if isinstance(item, dict)]
    target = next((item for item in rows if int(item.get("id") or 0) == int(measure_id)), None)
    if target is None:
        raise ClaimBlocked("Мера ОПИ не найдена")
    case.opi_measures_taken = [item for item in rows if int(item.get("id") or 0) != int(measure_id)]
    case.save(update_fields=["opi_measures_taken", "updated_at"])
    _event(case, user, case.stage, case.stage, f"Удалена мера ОПИ: {target.get('title') or ''}")
    sync_case_checks(case)
    return case


def sync_case_checks(case: ClaimCase) -> None:
    from apps.debts.services.activities import sync_stage_checks

    sync_stage_checks(case.account)


def _sync_opi_activity(case: ClaimCase, code: str, note: str) -> None:
    """Пункт активности и остальные пункты чек-листа сверяются с делом."""
    del code, note
    sync_case_checks(case)


def apply_ais_receipt(case: ClaimCase, user) -> ClaimCase:
    """Имитация ночной выгрузки: тариф поступил и долг с пеней закрыты. Сальдо АИС не переписывается."""
    case.tariff_received = True
    case.ais_debt_cleared = True
    case.save(update_fields=["tariff_received", "ais_debt_cleared", "updated_at"])
    _event(case, user, case.stage, case.stage, "Имитация выгрузки АИС: тариф и погашение. Поле сальдо не изменено")
    sync_case_checks(case)
    return case


def start_writeoff(case: ClaimCase, approver_ids: list[int], user) -> ClaimCase:
    if case.stage != ClaimCase.Stage.IMPOSSIBLE:
        raise ClaimBlocked("Согласование списания запускается из статуса «Невозможность взыскания»")
    if case.acts.count() < 3:
        raise ClaimBlocked("Для списания по исполнительному документу нужно не меньше трёх актов ОПИ")
    approvers = list(
        User.objects.filter(pk__in=approver_ids, is_active=True, organization_id=case.organization_id)
    )
    if not approvers:
        raise ClaimBlocked("Выберите хотя бы одного согласующего своей схемы")
    case.approvals.all().delete()
    for approver in approvers:
        ClaimApproval.objects.create(organization=case.organization, case=case, approver=approver)
        _notify(case, approver.pk, f"Согласуйте списание по ЛС {case.account.client_account}")
    case.writeoff_status = ClaimCase.WriteoffStatus.PENDING
    case.writeoff_note = ""
    case.save(update_fields=["writeoff_status", "writeoff_note", "updated_at"])
    _event(case, user, case.stage, case.stage, "Запущено согласование списания")
    return case


def decide_writeoff(case: ClaimCase, user, decision: str, reason: str = "") -> ClaimCase:
    approval = case.approvals.filter(approver=user).first()
    if approval is None:
        raise ClaimBlocked("Вы не в маршруте согласования этого дела")
    if decision not in {ClaimApproval.Decision.YES, ClaimApproval.Decision.NO}:
        raise ClaimBlocked("Решение: yes или no")
    if decision == ClaimApproval.Decision.NO and not reason.strip():
        raise ClaimBlocked("Отказ записывается с причиной")
    approval.decision = decision
    approval.reason = reason
    approval.decided_at = timezone.now()
    approval.save()
    if decision == ClaimApproval.Decision.NO:
        case.writeoff_status = ClaimCase.WriteoffStatus.REJECTED
        case.writeoff_note = reason
        case.save(update_fields=["writeoff_status", "writeoff_note", "updated_at"])
        _notify_initiator(case, user, f"Списание не согласовано: {reason}")
        _event(case, user, case.stage, case.stage, reason)
        return case
    if case.approvals.exclude(decision=ClaimApproval.Decision.YES).exists():
        _event(case, user, case.stage, case.stage, "Согласовано, ждут остальные")
        return case
    case.writeoff_status = ClaimCase.WriteoffStatus.APPROVED
    case.save(update_fields=["writeoff_status", "updated_at"])
    _notify_initiator(case, user, "Все согласующие подтвердили списание")
    return move_case(case, ClaimCase.Stage.WRITEOFF, user, "Согласовали все участники маршрута")


def _cached(instance, name, fallback):
    cache = getattr(instance, "_prefetched_objects_cache", {})
    if name in cache:
        return cache[name]
    return fallback


def case_payload(case: ClaimCase, *, with_choices: bool = False) -> dict:
    acts = [
        {
            "id": act.pk,
            "title": act.title,
            "act_number": act.act_number,
            "act_date": _date(act.act_date),
            "reason": act.reason,
            "attachment_id": act.attachment_id,
            "file_name": act.attachment.original_name if act.attachment_id and act.attachment else "",
        }
        for act in _cached(case, "acts", case.acts.select_related("attachment"))
    ]
    approvals = [
        {
            "id": item.pk,
            "approver_id": item.approver_id,
            "approver_name": item.approver.display_name,
            "decision": item.decision,
            "reason": item.reason,
        }
        for item in _cached(case, "approvals", case.approvals.select_related("approver"))
    ]
    account = case.account
    penalty = sum(
        (service.balance_mulct_out or Decimal("0")) for service in account.services.all()
    )
    specialist = ""
    if account.assigned_to_id:
        specialist = account.assigned_to.display_name
    data = {
        "id": case.pk,
        "account": case.account_id,
        "client_account": account.client_account,
        "short_fio": account.short_fio,
        "account_address": account.account_address,
        "debt_group": account.effective_group,
        "rating": account.rating,
        "penalty": _money(penalty),
        "specialist": specialist,
        "balance_out": _money(account.balance_out),
        "stage": case.stage,
        "stage_label": case.get_stage_display(),
        "warning_delivered_on": _date(case.warning_delivered_on),
        "debt_from": _date(case.debt_from),
        "debt_to": _date(case.debt_to),
        "non_delivery_act_on": _date(case.non_delivery_act_on),
        "repayment_days": case.repayment_days,
        "writ_principal": _money(case.writ_principal),
        "writ_penalty": _money(case.writ_penalty),
        "notary_office": case.notary_office,
        "notary_tariff": _money(case.notary_tariff),
        "application_withdrawn": case.application_withdrawn,
        "submission_id": case.submission_id,
        "submission_mode": case.submission_mode,
        "notary_note": case.notary_note,
        "lawsuit_number": case.lawsuit_number,
        "lawsuit_kind": case.lawsuit_kind,
        "lawsuit_filed_on": _date(case.lawsuit_filed_on),
        "state_duty": _money(case.state_duty),
        "defendant_name": case.defendant_name,
        "package_filed_on": _date(case.package_filed_on),
        "lawsuit_note": case.lawsuit_note,
        "court_status": case.court_status,
        "opi_number": case.opi_number,
        "opi_status": case.opi_status,
        "opi_mode": case.opi_mode,
        "opi_department": case.opi_department,
        "opi_sent_on": _date(case.opi_sent_on),
        "opi_started_on": _date(case.opi_started_on),
        "opi_ended_on": _date(case.opi_ended_on),
        "opi_bailiff": case.opi_bailiff,
        "opi_note": case.opi_note,
        "opi_measures_taken": list(case.opi_measures_taken or []),
        "pris_cl_num": case.pris_cl_num,
        "pris_response_id": case.pris_response_id,
        "pris_process_status": case.pris_process_status,
        "pris_process_message": case.pris_process_message,
        "tariff_received": case.tariff_received,
        "ais_debt_cleared": case.ais_debt_cleared,
        "eviction_stage": case.eviction_stage,
        "skip_reason": case.skip_reason,
        "writeoff_status": case.writeoff_status,
        "writeoff_note": case.writeoff_note,
        "files": [
            {
                "id": item.pk,
                "doc_type": item.doc_type,
                "name": item.original_name,
                "role": _file_role(item.doc_type, item.original_name),
            }
            for item in list(_cached(account, "attachments", account.attachments.all()))[:30]
        ],
        "acts": acts,
        "acts_count": len(acts),
        "approvals": approvals,
        "blockers": blockers(case),
        "events": [
            {
                "old_stage": event.old_stage,
                "new_stage": event.new_stage,
                "reason": event.reason,
                "actor": event.actor.display_name if event.actor_id else "",
                "at": event.created_at.isoformat(),
            }
            for event in list(_cached(case, "events", case.events.select_related("actor")))[:20]
        ],
    }
    if with_choices:
        data["writ_checklist"] = _writ_checklist(case)
        data["approver_choices"] = [
            {"id": person.pk, "name": person.display_name, "role": person.role}
            for person in User.objects.filter(organization_id=case.organization_id, is_active=True).exclude(
                role=User.Role.OBSERVER,
            )
        ]
        data["lawsuit_kinds"] = [{"id": code, "label": label} for code, label in ClaimCase.LawsuitKind.choices]
        data["opi_measure_kinds"] = [{"id": code, "label": label} for code, label in OPI_MEASURE_KINDS]
        data["opi_statuses"] = [{"id": code, "label": label} for code, label in OPI_STATUS_CHOICES]
        data["stages"] = [{"id": code, "label": label} for code, label in ClaimCase.Stage.choices]
        from apps.debts.services.bnp_package import package_payload

        data["package"] = package_payload(case)
        from apps.debts.services.pris_submit import pris_card

        data["pris"] = pris_card(case)
    return data


def _file_role(doc_type: str, name: str) -> str:
    text = f"{doc_type} {name}".lower()
    if "расч" in text or "calc" in text:
        return "calculation"
    if "довер" in text:
        return "warrant"
    if "скан" in text or "постанов" in text or "отказ" in text:
        return "scan"
    return ""


def blockers(case: ClaimCase) -> list[str]:
    missing = []
    if not case.warning_delivered_on:
        missing.append("Нет даты вручения предупреждения")
    if case.application_withdrawn or case.notary_tariff is None or case.notary_tariff <= 0:
        missing.append("Нет нотариального тарифа")
    act_count = len(case.acts.all())
    if act_count < 1:
        missing.append("Нет акта ОПИ для статуса «Невозможность взыскания»")
    if act_count < 3:
        missing.append("Для списания нужно три акта ОПИ")
    if not case.tariff_received or not case.ais_debt_cleared:
        missing.append("Статус «Взыскано» ждёт выгрузку АИС: погашены долг, пеня и тариф")
    return missing


def _coerce(field: str, value):
    if field in DATE_FIELDS:
        if not value:
            return None
        if isinstance(value, date):
            return value
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    if field in MONEY_FIELDS:
        if value in (None, ""):
            return None
        return Decimal(str(value))
    return value


def _money(value) -> str | None:
    if value is None:
        return None
    return str(value)


def _date(value) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _opi_from_pris(case: ClaimCase) -> bool:
    """Номер производства уже пришёл из АИС ПРИС: ручные поля направления не блокируют переход."""
    return case.opi_mode in {"pris", "channel"} and bool((case.opi_number or "").strip())


def _opi_measures_known(case: ClaimCase) -> bool:
    if list(case.opi_measures_taken or []):
        return True
    return bool((case.pris_inquiry or {}).get("p_action"))


def _enforcement_ready(case: ClaimCase) -> bool:
    """Исполнительный документ уже в карточке или ушёл в пакете ПРИС."""
    if case.opi_mode in {"pris", "channel", "stub"}:
        return True
    rows = Attachment.objects.filter(account_id=case.account_id).values_list("doc_type", "original_name")
    return any("исполнительн" in f"{doc_type} {name}".lower() for doc_type, name in rows)


def _split_proceeding(text: str) -> tuple[str, str]:
    raw = (text or "").strip()
    for sep in ("|", ";", "—"):
        if sep in raw:
            left, right = raw.split(sep, 1)
            return left.strip()[:50], (right.strip() or "Возбуждено")[:120]
    return raw[:50], "Возбуждено"


def push_activity_value(case: ClaimCase, user, code: str, text: str) -> ClaimCase:
    """Пункт чек-листа на карточке ЛС пишет то же поле, что вкладка дела."""
    from decimal import InvalidOperation

    from apps.debts.services.funnel import parse_handed_on

    if code == "opi_office":
        return record_opi(case, user, case.opi_number, case.opi_status, department=text, manual=False)
    if code == "opi_sent":
        parsed = parse_handed_on(text)
        if parsed is None:
            raise ClaimBlocked("Укажите дату направления в формате дд.мм.гггг")
        return record_opi(case, user, case.opi_number, case.opi_status, sent_on=parsed, manual=False)
    if code == "opi_send":
        number, status = _split_proceeding(text)
        if not number:
            raise ClaimBlocked("Укажите номер производства")
        return record_opi(case, user, number, status, manual=False)
    if code == "filed":
        parsed = parse_handed_on(text)
        if parsed is None:
            raise ClaimBlocked("Укажите дату подачи в формате дд.мм.гггг")
        case.lawsuit_filed_on = parsed
        case.save(update_fields=["lawsuit_filed_on", "updated_at"])
        _event(case, user, case.stage, case.stage, f"Дата подачи иска: {parsed.strftime('%d.%m.%Y')}")
        sync_case_checks(case)
        return case
    if code == "duty":
        raw = (text or "").replace(" ", "").replace(",", ".")
        try:
            amount = Decimal(raw)
        except InvalidOperation:
            raise ClaimBlocked("Укажите сумму госпошлины") from None
        if amount <= 0:
            raise ClaimBlocked("Госпошлина больше нуля")
        case.state_duty = amount
        case.save(update_fields=["state_duty", "updated_at"])
        _event(case, user, case.stage, case.stage, f"Госпошлина: {amount}")
        sync_case_checks(case)
        return case
    return case


def stage_marks(case: ClaimCase) -> list[tuple[str, str, bool, str]]:
    """Какие пункты чек-листа закрыты данными дела. ТЗ 4.2.4.2–4.2.4.7."""
    acts = case.acts.count()
    measures = [item for item in (case.opi_measures_taken or []) if isinstance(item, dict)]
    measures_known = bool(measures) or bool((case.pris_inquiry or {}).get("p_action"))
    measures_note = f"Мер: {len(measures)}" if measures else ("Меры из АИС ПРИС" if measures_known else "")
    sent = case.opi_sent_on.strftime("%d.%m.%Y") if case.opi_sent_on else ""
    filed = case.lawsuit_filed_on.strftime("%d.%m.%Y") if case.lawsuit_filed_on else ""
    number = (case.opi_number or "").strip()
    status = (case.opi_status or "").strip()
    paid = bool(case.tariff_received and case.ais_debt_cleared)
    paid_note = "Долг, пеня и тариф погашены" if paid else ""
    approved = case.writeoff_status == ClaimCase.WriteoffStatus.APPROVED
    duty_met = case.state_duty is not None and case.state_duty > 0
    doc = _enforcement_ready(case)
    reg = (case.submission_id or "").strip()
    proceeding = ", ".join(part for part in (number and f"ИП {number}", status) if part)
    return [
        ("notary", "send", bool(reg), reg),
        ("notary", "send_reg", bool(reg), reg),
        ("lawsuit", "duty", duty_met, str(case.state_duty or "") if duty_met else ""),
        ("lawsuit", "filed", bool(case.lawsuit_filed_on), filed),
        ("opi", "opi_office", bool((case.opi_department or "").strip()), case.opi_department or ""),
        ("opi", "opi_sent", bool(case.opi_sent_on), sent),
        ("opi", "opi_doc", doc, "Исполнительный документ в карточке" if doc else ""),
        ("opi", "opi_send", bool(number and status), proceeding),
        ("opi_measures", "opi_act", measures_known, measures_note),
        ("opi_measures", "opi_full", paid, paid_note),
        ("impossible", "acts", acts >= 1, f"Актов: {acts}" if acts else ""),
        ("impossible", "acts_three", acts >= 3, f"{acts} из 3"),
        ("writeoff", "route", approved, "Согласовали все" if approved else ""),
        ("recovered", "paid", paid, paid_note),
    ]


def _guard(case: ClaimCase, stage: str, reason: str, checklist_reason: str | None = None) -> None:
    if stage == ClaimCase.Stage.NOTARY:
        _require_notary_fields(case, reason if checklist_reason is None else checklist_reason)
        from apps.debts.services.bnp_package import require_formed_package

        require_formed_package(case)
    if stage == ClaimCase.Stage.LAWSUIT and case.stage != ClaimCase.Stage.REFUSED and not reason.strip():
        raise ClaimBlocked("Пропуск до иска записывается с причиной")
    if stage == ClaimCase.Stage.OPI and not _opi_from_pris(case):
        missing = []
        if not (case.opi_department or "").strip():
            missing.append("орган ОПИ")
        if not case.opi_sent_on:
            missing.append("дату направления в ОПИ")
        if not _enforcement_ready(case):
            missing.append("исполнительный документ")
        if missing:
            raise ClaimBlocked("Для статуса «Направлено в ОПИ» нужны: " + ", ".join(missing))
    if stage == ClaimCase.Stage.OPI_MEASURES and not _opi_measures_known(case):
        raise ClaimBlocked("Статус «Меры ОПИ приняты» требует хотя бы одну принятую меру")
    if stage == ClaimCase.Stage.IMPOSSIBLE and case.acts.count() < 1:
        raise ClaimBlocked("Статус «Невозможность взыскания» требует акт ОПИ")
    if stage == ClaimCase.Stage.WRITEOFF:
        if case.acts.count() < 3:
            raise ClaimBlocked("Для списания по исполнительному документу нужно не меньше трёх актов ОПИ")
        if case.writeoff_status != ClaimCase.WriteoffStatus.APPROVED:
            raise ClaimBlocked("Акт формируется только после согласия всех согласующих")
    if stage == ClaimCase.Stage.RECOVERED and not (case.tariff_received and case.ais_debt_cleared):
        raise ClaimBlocked("«Взыскано» — после погашения долга, пени и нотариального тарифа по данным АИС")
    early = {ClaimCase.Stage.PREP, ClaimCase.Stage.NOTARY}
    if stage in {ClaimCase.Stage.COURT, ClaimCase.Stage.OPI} and case.stage in early and not reason.strip():
        raise ClaimBlocked("Такой переход записывается с причиной пропуска")


def _require_notary_fields(case: ClaimCase, skip_reason: str = "", *, defer: frozenset[str] = frozenset()) -> None:
    from apps.debts.services.writ_gate import assert_writ_checklist

    assert_writ_checklist(case, skip_reason, defer=defer)


def _writ_checklist(case: ClaimCase) -> list[dict]:
    from apps.debts.services.writ_gate import checklist_rows

    return checklist_rows(case)


def _event(case, user, old, new, reason: str) -> None:
    ClaimEvent.objects.create(case=case, actor=user if getattr(user, "is_authenticated", False) else None,
                              old_stage=old, new_stage=new, reason=reason[:500])


def _notify(case: ClaimCase, user_id: int, body: str) -> None:
    Notification.objects.create(
        organization=case.organization, channel=Channel.INBOX, body=body, recipient_user_id=user_id,
        account=case.account, status=Notification.Status.SENT,
    )


def _notify_initiator(case: ClaimCase, actor, body: str) -> None:
    target = case.account.assigned_to_id
    if target and target != actor.pk:
        _notify(case, target, body)
    opened = case.events.exclude(actor=None).order_by("id").values_list("actor_id", flat=True).first()
    if opened and opened not in {actor.pk, target}:
        _notify(case, opened, body)

