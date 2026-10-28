"""Этапы воронки взыскания по матрице E0–E14.

Колонка карточки — один хранимый этап основной ветви. Открытое мероприятие
младшего этапа колонку не занимает: на карточке оно остаётся бейджем.
Параллельные P1 и P2 колонками не становятся.
"""

from datetime import datetime

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


def parse_handed_on(raw: str | None):
    """Дата вручения из пункта «Вручение под роспись»: дд.мм.гггг или ГГГГ-ММ-ДД."""
    token = (raw or "").strip().split()[0] if (raw or "").strip() else ""
    if not token:
        return None
    for sample, fmt in ((token, "%d.%m.%Y"), (token[:10], "%Y-%m-%d")):
        try:
            return datetime.strptime(sample, fmt).date()
        except ValueError:
            continue
    return None


class FunnelGate(ValidationError):
    """Переход закрыт, пока на карточке не сделаны указанные действия."""

    status_code = 400
    default_code = "funnel_gate"

    def __init__(
        self, message: str, *, actions: list[str], tab: str, tab_label: str, account_id: int,
        claim_id: int | None = None, measure_id: int | None = None, focus: str = "",
    ):
        super().__init__(detail=message, code="funnel_gate")
        self.gate_message = message
        self.extra = {
            "actions": actions,
            "tab": tab,
            "tab_label": tab_label,
            "account_id": account_id,
            "claim_id": claim_id,
            "measure_id": measure_id,
            "focus": focus or "",
        }


def warning_handed(account) -> bool:
    from apps.debts.models import ClaimCase, MeasureItem, StageActivity

    if ClaimCase.objects.filter(account=account, warning_delivered_on__isnull=False).exists():
        return True
    if MeasureItem.objects.filter(
        account=account, measure__kind="warning", delivered_on__isnull=False,
    ).exists():
        return True
    note = (
        StageActivity.objects.filter(account=account, code="hand", status="done")
        .order_by("-id")
        .values_list("note", flat=True)
        .first()
    )
    return parse_handed_on(note) is not None


def assert_transition(account, stage: str) -> None:
    """Дата вручения и документы этапа. Пустой перечень документов переход не держит."""
    from apps.debts.services.document_gate import stage_gate

    date_missing = stage in GATED and not warning_handed(account)
    stage_gate(account, account.funnel_stage or "new", stage, date_missing=date_missing)


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
