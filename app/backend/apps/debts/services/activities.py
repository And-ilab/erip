"""Активности карточки ЛС: чек-лист текущего этапа и незакрытые параллельные.

Пункты система создаёт из шаблона этапа. «Нужно действие» закрывает пункт:
файл ложится во вложения, поле и обзвон пишутся в строку, повтор письма фиксируется.
Мероприятие этой кнопкой не закрывается — бейдж снимает завершение или прерывание меры.
"""

from django.conf import settings
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.debts.models import Attachment, StageActivity
from apps.debts.services.funnel import MAIN, MEASURE_STAGE, PARALLEL, normalize, parse_handed_on, short_of, title_of

# code, parent, title, kind. kind группы не нажимается: статус складывается из детей.
# kind «check» считает система по делу, кнопки «Нужно действие» у него нет.
TEMPLATES = {
    "call": (
        ("dial", "", "Автообзвон", "call"),
        ("dial_try", "dial", "Дозвон вручную", "call"),
    ),
    "notice": (
        ("sms", "", "Рассылка SMS", "group"),
        ("sms_info", "sms", "Информационное SMS", "field"),
        ("email", "", "Сообщение на e-mail", "email"),
        ("email_send", "email", "Отправка по шаблону", "email"),
        ("email_retry", "email", "Ошибка SMTP, повторить", "email"),
        ("pdf", "", "Предупреждение (PDF, печать)", "upload"),
        ("hand", "", "Вручение под роспись / Белпочта", "field"),
    ),
    "disconnect": (
        ("order", "", "Задание на отключение", "field"),
        ("suspend", "", "Факт приостановления услуги", "field"),
    ),
    "prep": (
        ("pack", "", "Пакет на исполнительную надпись", "group"),
        ("pack_calc", "pack", "Расчёт задолженности", "upload"),
        ("pack_claim", "pack", "Заявление", "upload"),
        ("pack_fields", "pack", "Реквизиты пакета", "field"),
    ),
    "notary": (
        ("send_group", "", "Направление нотариусу", "group"),
        ("send", "send_group", "Пакет направлен", "field"),
        ("send_reg", "send_group", "Регистрационный номер обращения", "check"),
    ),
    "writ_done": (
        ("writ", "", "Электронный исполнительный документ", "upload"),
    ),
    "refused": (
        ("refusal", "", "Отказ нотариуса", "upload"),
    ),
    "lawsuit": (
        ("suit_group", "", "Иск", "group"),
        ("suit", "suit_group", "Исковое заявление", "upload"),
        ("duty", "suit_group", "Госпошлина", "field"),
        ("filed", "suit_group", "Дата подачи иска", "field"),
    ),
    "judgment": (
        ("court_group", "", "Решение суда", "group"),
        ("decision", "court_group", "Судебное решение", "upload"),
        ("sheet", "court_group", "Исполнительный лист", "upload"),
    ),
    "opi": (
        ("opi_work", "", "Направление в ОПИ", "group"),
        ("opi_office", "opi_work", "Орган ОПИ", "field"),
        ("opi_sent", "opi_work", "Дата направления в ОПИ", "field"),
        ("opi_doc", "opi_work", "Исполнительный документ", "upload"),
        ("opi_send", "opi_work", "Номер и статус производства", "field"),
    ),
    "opi_measures": (
        ("opi_track", "", "Меры ОПИ", "group"),
        ("opi_act", "opi_track", "Принятые меры ОПИ", "upload"),
        ("opi_full", "opi_track", "Полнота: долг, пеня и тариф", "check"),
    ),
    "recovered": (
        ("paid", "", "Погашение долга, пени и тарифа", "check"),
    ),
    "impossible": (
        ("acts_group", "", "Невозможность взыскания", "group"),
        ("acts", "acts_group", "Акт о невозможности взыскания", "upload"),
        ("acts_three", "acts_group", "Три акта для списания", "check"),
    ),
    "writeoff": (
        ("write_group", "", "Списание", "group"),
        ("docs", "write_group", "Акт о списании", "upload"),
        ("route", "write_group", "Согласование списания", "check"),
    ),
    "p1": (
        ("evict_notice", "", "Уведомление о возможном выселении", "upload"),
    ),
    "p2": (
        ("evict", "", "Выселение / принудительная продажа", "field"),
    ),
}
LEAF = {"upload", "field", "email", "call"}
# Эти пункты блокируют переход. На карточке ЛС незакрытый пункт помечен.
MANDATORY = {
    "hand", "pack_calc", "pack_claim", "pack_fields",
    "send", "send_reg",
    "suit", "duty", "filed",
    "decision", "sheet",
    "opi_office", "opi_sent", "opi_doc", "opi_send",
    "opi_act",
    "docs", "route",
}
# Ручная отметка не снимается, пока дело само не подтвердит пункт.
STICKY = {"send", "opi_doc"}
STATUS_LABEL = {"running": "В работе", "done": "Завершено"}


def _rows_for(stage: str):
    return TEMPLATES.get(stage) or (
        ("step", "", title_of(stage), "field"),
    )


def ensure_stage(account, stage: str) -> None:
    """Пункты этапа, чтобы их можно было закрыть до перехода колонки."""
    _ensure(account, stage)


def _ensure(account, stage: str, measure_id=None) -> None:
    rows = {row.code: row for row in StageActivity.objects.filter(account=account, stage=stage)}
    fresh = []
    dirty = []
    for index, (code, parent, title, kind) in enumerate(_rows_for(stage)):
        row = rows.get(code)
        if row is None:
            fresh.append(StageActivity(
                organization=account.organization, account=account, stage=stage, code=code,
                parent_code=parent, title=title, kind=kind, sort=index, measure_id=measure_id,
            ))
            continue
        changed = False
        if row.parent_code != parent:
            row.parent_code = parent
            changed = True
        if row.title != title:
            row.title = title
            changed = True
        if row.kind != kind:
            row.kind = kind
            changed = True
        if row.sort != index:
            row.sort = index
            changed = True
        if measure_id and row.measure_id is None:
            row.measure_id = measure_id
            changed = True
        if changed:
            dirty.append(row)
    if fresh:
        StageActivity.objects.bulk_create(fresh)
    if dirty:
        StageActivity.objects.bulk_update(
            dirty, ["parent_code", "title", "kind", "sort", "measure"],
        )


def _open_measure_stages(account) -> dict[str, int]:
    from apps.debts.models import MeasureItem
    from apps.debts.services.funnel import OPEN_ITEM

    found = {}
    rows = (
        MeasureItem.objects.filter(account=account, status__in=OPEN_ITEM)
        .select_related("measure")
        .order_by("id")
    )
    for item in rows:
        stage = MEASURE_STAGE.get(item.measure.kind)
        if stage and stage not in found:
            found[stage] = item.measure_id
    return found


def ensure_board(account) -> str:
    known = {code for code, *_rest in MAIN}
    current = normalize(account.funnel_stage)
    if current not in known:
        current = "new"
    opened = _open_measure_stages(account)
    if current == "new":
        if not StageActivity.objects.filter(account=account, stage="new").exists():
            StageActivity.objects.create(
                organization=account.organization, account=account, stage="new", code="open",
                title="Карточка нового должника", kind="field", sort=0,
            )
    else:
        _ensure(account, current, opened.get(current))
    for stage, measure_id in opened.items():
        if stage != current:
            _ensure(account, stage, measure_id)
    parallel = (account.parallel_stage or "").strip()
    if parallel in {"p1", "p2"}:
        _ensure(account, parallel, None)
    return current


def _tree(rows: list[StageActivity]) -> list[dict]:
    by_parent: dict[str, list[StageActivity]] = {}
    for row in rows:
        by_parent.setdefault(row.parent_code or "", []).append(row)

    def status_of(row: StageActivity) -> str:
        children = by_parent.get(row.code, [])
        if not children:
            return row.status
        return "done" if all(status_of(child) == "done" for child in children) else "running"

    def pack(row: StageActivity) -> dict:
        status = status_of(row)
        children = [pack(child) for child in by_parent.get(row.code, [])]
        return {
            "id": row.id,
            "code": row.code,
            "title": row.title,
            "kind": row.kind,
            "status": status,
            "status_label": STATUS_LABEL.get(status, status),
            "measure_id": row.measure_id,
            "needs_action": row.kind in LEAF and row.status != "done",
            "mandatory": row.code in MANDATORY,
            "note": row.note,
            "children": children,
        }

    return [pack(row) for row in by_parent.get("", [])]


def _section_open(tree: list[dict]) -> bool:
    def walk(nodes) -> bool:
        for node in nodes:
            if node["status"] != "done":
                return True
            if walk(node["children"]):
                return True
        return False

    return walk(tree)


def activity_board(account) -> dict:
    from apps.debts.services.claims import align_claim_with_funnel

    case = align_claim_with_funnel(account)
    current = ensure_board(account)
    sync_stage_checks(account)
    rows = list(StageActivity.objects.filter(account=account).order_by("sort", "id"))
    grouped: dict[str, list[StageActivity]] = {}
    for row in rows:
        grouped.setdefault(row.stage, []).append(row)
    current_tree = _tree(grouped.get(current, []))
    parallel = []
    for stage, stage_rows in grouped.items():
        if stage == current:
            continue
        tree = _tree(stage_rows)
        if not _section_open(tree):
            continue
        parallel.append({
            "stage": stage,
            "title": title_of(stage),
            "short": short_of(stage),
            "items": tree,
        })
    return {
        "stage": current,
        "stage_title": title_of(current),
        "claim_id": case.pk if case is not None else None,
        "current": current_tree,
        "parallel": parallel,
        "parallel_labels": [{"id": code, "label": short} for code, _title, short, _mark in PARALLEL],
    }


def perform_activity(account, user, activity_id: int, note: str, upload) -> dict:
    if user is None or not getattr(user, "is_authenticated", False):
        raise PermissionDenied("Нет права выполнить шаг")
    if getattr(user, "role", "") not in {"superadmin", "local_admin", "specialist", "legal"}:
        raise PermissionDenied("Нет права выполнить шаг")
    row = StageActivity.objects.filter(account=account, pk=activity_id).first()
    if row is None:
        raise ValidationError({"id": "Пункт активности не найден"})
    if row.kind not in LEAF:
        raise ValidationError({"id": "Действие выполняется в строке пункта, не в заголовке группы"})
    if row.status == "done":
        return activity_board(account)
    text = (note or "").strip()
    if row.kind == "upload":
        if upload is None:
            raise ValidationError({"file": "Приложите файл"})
        created_att = Attachment.objects.create(
            organization=account.organization, account=account, doc_type=row.title, file=upload,
            original_name=getattr(upload, "name", "") or "file", uploaded_by=user,
        )
        row.note = text or getattr(upload, "name", "")
        if row.code in {"opi_act", "acts"}:
            _sync_claim_from_activity(account, user, row.code, row.note, created_att)
    elif row.kind == "email":
        mode = getattr(settings, "GW_EMAIL_MODE", "stub")
        if mode == "stub":
            row.note = text or "Повтор зафиксирован. Почта в режиме заглушки, письмо не уходило."
        else:
            row.note = text or "Повтор отправки зафиксирован."
    elif row.kind == "call":
        if not text:
            raise ValidationError({"note": "Укажите результат обзвона"})
        row.note = text
    else:
        if row.code in {"hand", "opi_sent", "filed"}:
            if parse_handed_on(text) is None:
                raise ValidationError({"note": "Укажите дату в формате дд.мм.гггг"})
        elif row.code == "duty":
            _duty_amount(text)
        elif not text:
            raise ValidationError({"note": "Заполните поле"})
        _push_activity_value(account, user, row.code, text)
        row.note = text
    row.status = "done"
    row.save(update_fields=["status", "note", "updated_at"])
    return activity_board(account)


def _duty_amount(text: str):
    from decimal import Decimal, InvalidOperation

    raw = (text or "").replace(" ", "").replace(",", ".")
    try:
        amount = Decimal(raw)
    except InvalidOperation:
        raise ValidationError({"note": "Укажите сумму госпошлины"}) from None
    if amount <= 0:
        raise ValidationError({"note": "Госпошлина больше нуля"})
    return amount


def _push_activity_value(account, user, code: str, text: str) -> None:
    """Поле чек-листа пишется в дело, если пункт к нему относится."""
    if code not in {"opi_office", "opi_sent", "opi_send", "filed", "duty"}:
        return
    from apps.debts.models import ClaimCase
    from apps.debts.services.claims import push_activity_value

    case = ClaimCase.objects.filter(account=account).order_by("-updated_at", "-id").first()
    if case is None:
        raise ValidationError({"note": "Сначала откройте дело взыскания"})
    push_activity_value(case, user, code, text)


def sync_stage_checks(account) -> None:
    """Закрывает и открывает пункты чек-листа по уже записанному делу."""
    from apps.debts.models import ClaimCase

    case = ClaimCase.objects.filter(account=account).order_by("-updated_at", "-id").first()
    if case is None:
        return
    from apps.debts.services.claims import stage_marks

    marks = {(stage, code): (met, note) for stage, code, met, note in stage_marks(case)}
    rows = list(StageActivity.objects.filter(account=account))
    dirty = []
    for row in rows:
        mark = marks.get((row.stage, row.code))
        if mark is None:
            continue
        met, note = mark
        note = (note or "")[:500]
        if met:
            if row.status == StageActivity.Status.DONE and row.note == note:
                continue
            row.status = StageActivity.Status.DONE
            row.note = note
            dirty.append(row)
            continue
        if row.status == StageActivity.Status.DONE and row.code in STICKY:
            continue
        if row.status == StageActivity.Status.RUNNING and not row.note:
            continue
        row.status = StageActivity.Status.RUNNING
        row.note = ""
        dirty.append(row)
    if dirty:
        StageActivity.objects.bulk_update(dirty, ["status", "note"])


def _sync_claim_from_activity(account, user, code: str, note: str, attachment) -> None:
    from apps.debts.models import ClaimCase

    case = ClaimCase.objects.filter(account=account).order_by("-id").first()
    if case is None:
        return
    if code == "opi_send":
        from apps.debts.services.claims import record_opi

        record_opi(case, user, case.opi_number or note[:50], case.opi_status or "Возбуждено", note=note)
    elif code == "opi_act":
        from apps.debts.services.claims import add_opi_measure

        add_opi_measure(
            case, user,
            {"title": "Меры ОПИ", "note": note, "attachment_id": attachment.pk if attachment else None},
        )
    elif code == "acts":
        from apps.debts.services.claims import add_act

        add_act(
            case, "Акт о невозможности взыскания", user,
            reason=note, attachment_id=attachment.pk if attachment else None,
        )
