"""Этапы воронки взыскания по матрице E0–E14.

Колонка карточки — один хранимый этап основной ветви. Открытое мероприятие
младшего этапа колонку не занимает: на карточке оно остаётся бейджем.
Параллельные P1 и P2 колонками не становятся.
"""

from rest_framework.exceptions import ValidationError

# code, полное имя колонки, короткая подпись ленты, метка
MAIN = (
    ("new", "Новый должник", "Новый должник", "E0"),
    ("call", "Автообзвон", "Автообзвон", "E1"),
    ("notice", "Уведомление/Предупреждение", "Уведомление", "E2"),
    ("disconnect", "Отключение услуг", "Отключение", "E3"),
    ("prep", "Подготовка пакета на исполнительную надпись", "Пакет на ИН", "E4"),
    ("notary", "Направлено нотариусу", "У нотариуса", "E5"),
    ("writ_done", "Исполнительная надпись совершена", "ИН совершена", "E6"),
    ("refused", "Отказ нотариуса", "Отказ нотариуса", "E7"),
    ("lawsuit", "Исковое заявление в суд", "Иск в суд", "E8"),
    ("judgment", "Судебное решение получено", "Решение суда", "E9"),
    ("opi", "Направлено в ОПИ", "В ОПИ", "E10"),
    ("opi_measures", "Меры ОПИ приняты", "Меры ОПИ", "E11"),
    ("recovered", "Взыскано", "Взыскано", "E12"),
    ("impossible", "Невозможность взыскания", "Невозможность взыскания", "E13"),
    ("writeoff", "Подготовка документов о списании безнадежной задолженности", "Списание", "E14"),
)
PARALLEL = (
    ("p1", "Уведомление о возможном выселении/отчуждении", "Уведомление о выселении", "P1"),
    ("p2", "Выселение/принудительная продажа", "Выселение / продажа", "P2"),
)
FUNNEL_STAGES = [(code, title) for code, title, _short, _mark in MAIN]
CHAIN = [code for code, _title, _short, _mark in MAIN if code not in {"impossible", "writeoff"}]
TERMINAL = ("impossible", "writeoff")
# Старые коды карточки. «court» на лицевом счёте значил ОПИ, не решение суда.
ALIASES = {
    "prevention": "call",
    "warning": "notice",
    "enforcement": "prep",
    "court": "opi",
    "closed": "recovered",
}
FUNNEL_RANK = {code: index for index, (code, *_rest) in enumerate(MAIN)}
for _alias, _code in ALIASES.items():
    FUNNEL_RANK[_alias] = FUNNEL_RANK[_code]
RANK_STAGE = {index: code for code, index in FUNNEL_RANK.items() if code not in ALIASES}
MEASURE_STAGE = {
    "call": "call",
    "notice": "notice",
    "warning": "notice",
    "disconnect": "disconnect",
    "collection": "prep",
}
CLAIM_STAGE = {
    "prep": "prep",
    "notary": "notary",
    "writ_done": "writ_done",
    "refused": "refused",
    "lawsuit": "lawsuit",
    "court": "judgment",
    "opi": "opi",
    "opi_measures": "opi_measures",
    "recovered": "recovered",
    "impossible": "impossible",
    "writeoff": "writeoff",
}
GATED = {"disconnect", "notary"}
OPEN_ITEM = ("assigned", "running")
_MAIN_CODES = {code for code, *_rest in MAIN}
_TITLES = {code: title for code, title, _short, _mark in (*MAIN, *PARALLEL)}
_SHORT = {code: short for code, _title, short, _mark in (*MAIN, *PARALLEL)}


def normalize(raw: str | None) -> str:
    code = (raw or "").strip()
    if not code:
        return "new"
    code = ALIASES.get(code, code)
    return code if code in _MAIN_CODES or code in {"p1", "p2"} else code


def canonical(raw: str | None) -> str:
    code = normalize(raw)
    if code not in _MAIN_CODES:
        raise ValidationError({"funnel_stage": "Неизвестный этап"})
    return code


def stored_codes(raw: str | None) -> list[str]:
    """Коды, которые в выборке означают один и тот же этап, включая прежние имена."""
    code = normalize(raw)
    found = [code]
    for alias, target in ALIASES.items():
        if target == code:
            found.append(alias)
    if code == "new":
        found.append("")
    return found


def title_of(raw: str | None) -> str:
    code = normalize(raw)
    return _TITLES.get(code, code or "Новый должник")


def short_of(raw: str | None) -> str:
    code = normalize(raw)
    return _SHORT.get(code, title_of(code))


def rank_of(raw: str | None) -> int:
    return FUNNEL_RANK.get(normalize(raw), 0)


def warning_handed(account) -> bool:
    from apps.debts.models import ClaimCase, MeasureItem

    if ClaimCase.objects.filter(account=account, warning_delivered_on__isnull=False).exists():
        return True
    return MeasureItem.objects.filter(
        account=account, measure__kind="warning", delivered_on__isnull=False,
    ).exists()


def assert_transition(account, stage: str) -> None:
    if stage in GATED and not warning_handed(account):
        raise ValidationError({
            "funnel_stage": "Нет даты вручения предупреждения. Чек-лист не пускает карточку в эту колонку.",
        })


def set_stage(account, stage: str, user=None, reason: str = "", *, lock: bool = False, check: bool = True) -> bool:
    """Пишет этап карточки и строку истории. Повтор того же этапа ничего не меняет."""
    stage = canonical(stage)
    current = account.funnel_stage or "new"
    if normalize(current) == stage and current == stage:
        return False
    if check:
        assert_transition(account, stage)
    account.funnel_stage = stage
    fields = ["funnel_stage", "updated_at"]
    if lock:
        account.funnel_locked = True
        fields.append("funnel_locked")
    account.save(update_fields=fields)
    if current != stage:
        from apps.debts.models import StatusHistory

        StatusHistory.objects.create(
            organization=account.organization, account=account, kind=StatusHistory.Kind.FUNNEL,
            old_value=current, new_value=stage, reason=(reason or "")[:500], author=user,
        )
    return True


def promote(account, stage: str, user=None, reason: str = "") -> bool:
    """Старший этап сменяет колонку. Младший открытый этап колонку не тянет назад."""
    if rank_of(stage) < rank_of(account.funnel_stage):
        return False
    try:
        return set_stage(account, stage, user, reason, check=True)
    except ValidationError:
        return False


def settle_paid(account, user=None) -> bool:
    """Оплата до нуля ставит «Взыскано», если карточка уже вышла из «Нового должника»."""
    current = normalize(account.funnel_stage)
    if current in {"new", "recovered", "impossible", "writeoff"}:
        return False
    return set_stage(account, "recovered", user, "Оплата до нуля", check=False)


def claim_to_account_stage(claim_stage: str) -> str:
    return CLAIM_STAGE.get(claim_stage or "", "")


def open_badges(pairs: list[tuple[int, str]]) -> dict[int, list[dict]]:
    """Бейдж открытого мероприятия, чья колонка не совпадает с колонкой карточки."""
    from apps.debts.models import Measure, MeasureItem

    result = {account_id: [] for account_id, _stage in pairs}
    if not result:
        return result
    stage_of = {account_id: normalize(stage) for account_id, stage in pairs}
    kind_label = dict(Measure.Kind.choices)
    status_label = dict(MeasureItem.Status.choices)
    seen: set[tuple[int, int]] = set()
    rows = (
        MeasureItem.objects.filter(account_id__in=result, status__in=OPEN_ITEM)
        .select_related("measure")
        .order_by("id")
    )
    for item in rows:
        key = (item.account_id, item.measure_id)
        if key in seen:
            continue
        seen.add(key)
        measure_stage = MEASURE_STAGE.get(item.measure.kind)
        if measure_stage and measure_stage == stage_of.get(item.account_id):
            continue
        kind = kind_label.get(item.measure.kind, item.measure.kind)
        status = status_label.get(item.status, item.status)
        result[item.account_id].append({
            "measure_id": item.measure_id,
            "account_id": item.account_id,
            "label": f"{kind} · {status}",
            "kind": item.measure.kind,
            "status": item.status,
        })
    return result


def attach_badges(cards: list[dict]) -> None:
    badges = open_badges([(row["id"], row.get("funnel_stage") or "") for row in cards if row.get("id")])
    for row in cards:
        row["open_badges"] = badges.get(row.get("id"), [])
