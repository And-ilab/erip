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
        ("send", "", "Направление нотариусу", "field"),
    ),
    "writ_done": (
        ("writ", "", "Исполнительная надпись", "upload"),
    ),
    "refused": (
        ("refusal", "", "Отказ нотариуса", "upload"),
    ),
    "lawsuit": (
        ("suit", "", "Исковое заявление", "upload"),
        ("duty", "", "Госпошлина", "field"),
    ),
    "judgment": (
        ("decision", "", "Судебное решение", "upload"),
    ),
    "opi": (
        ("opi_send", "", "Направление в ОПИ", "field"),
    ),
    "opi_measures": (
        ("opi_act", "", "Меры ОПИ", "upload"),
    ),
    "recovered": (
        ("paid", "", "Погашение подтверждено", "field"),
    ),
    "impossible": (
        ("acts", "", "Акты о невозможности взыскания", "upload"),
    ),
    "writeoff": (
        ("docs", "", "Документы на списание", "upload"),
    ),
    "p1": (
        ("evict_notice", "", "Уведомление о возможном выселении", "upload"),
    ),
    "p2": (
        ("evict", "", "Выселение / принудительная продажа", "field"),
    ),
}
LEAF = {"upload", "field", "email", "call"}
STATUS_LABEL = {"running": "В работе", "done": "Завершено"}


def _rows_for(stage: str):
    return TEMPLATES.get(stage) or (
        ("step", "", title_of(stage), "field"),
    )


def ensure_stage(account, stage: str) -> None:
    """Пункты этапа, чтобы их можно было закрыть до перехода колонки."""
    _ensure(account, stage)


def _ensure(account, stage: str, measure_id=None) -> None:
    existing = set(
        StageActivity.objects.filter(account=account, stage=stage).values_list("code", flat=True),
    )
    fresh = []
    for index, (code, parent, title, kind) in enumerate(_rows_for(stage)):
        if code in existing:
            continue
        fresh.append(StageActivity(
            organization=account.organization, account=account, stage=stage, code=code,
            parent_code=parent, title=title, kind=kind, sort=index, measure_id=measure_id,
        ))
    if fresh:
        StageActivity.objects.bulk_create(fresh)
    if measure_id:
        StageActivity.objects.filter(account=account, stage=stage, measure__isnull=True).update(measure_id=measure_id)


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
    leaves_done = {}

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
    current = ensure_board(account)
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
        Attachment.objects.create(
            organization=account.organization, account=account, doc_type=row.title, file=upload,
            original_name=getattr(upload, "name", "") or "file", uploaded_by=user,
        )
        row.note = text or getattr(upload, "name", "")
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
        if row.code == "hand":
            if parse_handed_on(text) is None:
                raise ValidationError({"note": "Укажите дату вручения в формате дд.мм.гггг"})
        elif not text:
            raise ValidationError({"note": "Заполните поле"})
        row.note = text
    row.status = "done"
    row.save(update_fields=["status", "note", "updated_at"])
    return activity_board(account)
