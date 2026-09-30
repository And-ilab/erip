"""Дело взыскания: чек-лист перехода, заглушки БНП и ОПИ, маршрут списания (ТЗ 4.2.4)."""

from datetime import date, datetime
from decimal import Decimal

from django.utils import timezone

from apps.core.exceptions import ServiceError
from apps.debts.models import ClaimAct, ClaimApproval, ClaimCase, ClaimEvent, DebtWorkItem
from apps.notifications.models import Channel, Notification
from apps.users.models import User

LAWSUIT_KINDS = {code for code, _label in ClaimCase.LawsuitKind.choices}
EVICTION = {"notice", "lawsuit", "court", "enforced"}


class ClaimBlocked(ServiceError):
    default_detail = "Переход по делу заблокирован"
    default_code = "claim_blocked"


def open_case(account, user) -> ClaimCase:
    case, created = ClaimCase.objects.get_or_create(
        account=account,
        defaults={"organization": account.organization, "defendant_name": account.short_fio},
    )
    if created:
        _event(case, user, "", ClaimCase.Stage.PREP, "Дело открыто")
    return case


DATE_FIELDS = {
    "warning_delivered_on", "lawsuit_filed_on", "package_filed_on",
}
MONEY_FIELDS = {"notary_tariff", "state_duty"}


def update_case(case: ClaimCase, data: dict, user) -> ClaimCase:
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
    _event(case, user, case.stage, case.stage, "Карточка дела изменена")
    return case


def move_case(case: ClaimCase, stage: str, user, reason: str = "") -> ClaimCase:
    if stage not in ClaimCase.Stage.values:
        raise ClaimBlocked("Неизвестный этап")
    if stage == case.stage:
        return case
    _guard(case, stage, reason)
    old = case.stage
    case.stage = stage
    if reason:
        case.skip_reason = reason
    if stage == ClaimCase.Stage.WRITEOFF:
        case.writeoff_note = "Акт о списании сформирован. Уведомление в АИС «Расчет-ЖКУ» ещё не выгружено."
        DebtWorkItem.objects.create(
            organization=case.organization, account=case.account, kind=DebtWorkItem.Kind.CLOSURE,
            title="Акт о списании задолженности", note=case.writeoff_note, started_on=timezone.localdate(),
        )
    case.save()
    _event(case, user, old, stage, reason or "Переход по воронке")
    if case.account.assigned_to_id and stage == ClaimCase.Stage.WRITEOFF:
        _notify(case, case.account.assigned_to_id, "Сформирован акт о списании. В АИС уйдёт уведомление, когда появится файл статусов.")
    return case


def send_to_notary(case: ClaimCase, user) -> ClaimCase:
    _require_notary_fields(case)
    case.submission_mode = "stub"
    case.submission_id = f"stub-{case.pk}"
    case.save(update_fields=["submission_mode", "submission_id", "updated_at"])
    DebtWorkItem.objects.create(
        organization=case.organization, account=case.account, kind=DebtWorkItem.Kind.WRIT,
        title="Пакет на исполнительную надпись",
        note="В личный кабинет БНП не отправлялся: канал-заглушка.",
        started_on=timezone.localdate(),
    )
    return move_case(case, ClaimCase.Stage.NOTARY, user, f"Заглушка БНП, номер {case.submission_id}")


def notary_result(case: ClaimCase, result: str, user, note: str = "") -> ClaimCase:
    if case.stage != ClaimCase.Stage.NOTARY:
        raise ClaimBlocked("Результат нотариуса фиксируется со статуса «Направлено нотариусу»")
    case.notary_note = note
    case.save(update_fields=["notary_note", "updated_at"])
    if result == "done":
        return move_case(case, ClaimCase.Stage.WRIT_DONE, user, note or "Надпись совершена")
    if result == "refused":
        moved = move_case(case, ClaimCase.Stage.REFUSED, user, note or "Отказ нотариуса")
        return move_case(moved, ClaimCase.Stage.LAWSUIT, user, "Отказ открывает подготовку иска")
    raise ClaimBlocked("Результат: done или refused")


def add_act(case: ClaimCase, title: str, user) -> ClaimAct:
    act = ClaimAct.objects.create(organization=case.organization, case=case, title=title.strip() or "Акт ОПИ")
    _event(case, user, case.stage, case.stage, f"Акт ОПИ: {act.title}")
    return act


def record_opi(case: ClaimCase, user, number: str, status: str) -> ClaimCase:
    case.opi_number = number
    case.opi_status = status
    case.opi_mode = "manual"
    case.save(update_fields=["opi_number", "opi_status", "opi_mode", "updated_at"])
    _event(case, user, case.stage, case.stage, "Статус ОПИ внесён вручную, сервисы 3.11.01–3.11.05 не вызывались")
    return case


def apply_ais_receipt(case: ClaimCase, user) -> ClaimCase:
    """Имитация ночной выгрузки: тариф поступил и долг с пеней закрыты. Сальдо АИС не переписывается."""
    case.tariff_received = True
    case.ais_debt_cleared = True
    case.save(update_fields=["tariff_received", "ais_debt_cleared", "updated_at"])
    _event(case, user, case.stage, case.stage, "Имитация выгрузки АИС: тариф и погашение. Поле сальдо не изменено")
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


def case_payload(case: ClaimCase, *, with_choices: bool = False) -> dict:
    acts = [{"id": act.pk, "title": act.title} for act in case.acts.all()]
    approvals = [
        {
            "id": item.pk,
            "approver_id": item.approver_id,
            "approver_name": item.approver.display_name,
            "decision": item.decision,
            "reason": item.reason,
        }
        for item in case.approvals.select_related("approver")
    ]
    data = {
        "id": case.pk,
        "account": case.account_id,
        "client_account": case.account.client_account,
        "short_fio": case.account.short_fio,
        "balance_out": _money(case.account.balance_out),
        "stage": case.stage,
        "stage_label": case.get_stage_display(),
        "warning_delivered_on": _date(case.warning_delivered_on),
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
        "tariff_received": case.tariff_received,
        "ais_debt_cleared": case.ais_debt_cleared,
        "eviction_stage": case.eviction_stage,
        "skip_reason": case.skip_reason,
        "writeoff_status": case.writeoff_status,
        "writeoff_note": case.writeoff_note,
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
            for event in case.events.select_related("actor")[:20]
        ],
    }
    if with_choices:
        data["approver_choices"] = [
            {"id": person.pk, "name": person.display_name, "role": person.role}
            for person in User.objects.filter(organization_id=case.organization_id, is_active=True).exclude(
                role=User.Role.OBSERVER,
            )
        ]
        data["lawsuit_kinds"] = [{"id": code, "label": label} for code, label in ClaimCase.LawsuitKind.choices]
        data["stages"] = [{"id": code, "label": label} for code, label in ClaimCase.Stage.choices]
    return data


def blockers(case: ClaimCase) -> list[str]:
    missing = []
    if not case.warning_delivered_on:
        missing.append("Нет даты вручения предупреждения")
    if case.application_withdrawn or case.notary_tariff is None or case.notary_tariff <= 0:
        missing.append("Нет нотариального тарифа")
    if case.acts.count() < 1:
        missing.append("Нет акта ОПИ для статуса «Невозможность взыскания»")
    if case.acts.count() < 3:
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


def _guard(case: ClaimCase, stage: str, reason: str) -> None:
    if stage == ClaimCase.Stage.NOTARY:
        _require_notary_fields(case)
    if stage == ClaimCase.Stage.LAWSUIT and case.stage != ClaimCase.Stage.REFUSED and not reason.strip():
        raise ClaimBlocked("Пропуск до иска записывается с причиной")
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


def _require_notary_fields(case: ClaimCase) -> None:
    if not case.warning_delivered_on:
        raise ClaimBlocked("Нет даты вручения предупреждения")
    if case.application_withdrawn or case.notary_tariff is None or case.notary_tariff <= 0:
        raise ClaimBlocked("Нет нотариального тарифа")


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

