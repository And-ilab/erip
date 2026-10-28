"""Документы, без которых канбан не переносит карточку.

Проверяется этап, на который кладут карточку, и — при шаге вперёд — документы
этапа, с которого её забирают. Файл уже есть, если пункт загрузки закрыт,
вложение лежит на счёте или PDF есть в пакете дела. Окно перехода называет
недостающие документы и вкладку, где их прикладывают.
"""

from apps.debts.services.activities import TEMPLATES
from apps.debts.services.funnel import FunnelGate, normalize, rank_of

# Куда вести, чтобы приложить документ: вкладка, подпись кнопки, пункт на вкладке.
PLACE = {
    "pdf": ("activities", "Активности", "pdf"),
    "pack_calc": ("pack", "Комплект", "calc-file"),
    "pack_claim": ("pack", "Комплект", "application"),
    "proxy": ("pack", "Комплект", "proxy"),
    "writ": ("activities", "Активности", "writ"),
    "refusal": ("pack", "Комплект", "scan"),
    "suit": ("court", "Суд", "lawsuit"),
    "decision": ("activities", "Активности", "decision"),
    "enforcement_doc": ("activities", "Активности", "writ"),
    "opi_act": ("opi", "ОПИ", "opi_act"),
    "acts": ("opi", "ОПИ", "acts"),
    "docs": ("writeoff", "Списание", "docs"),
    "evict_notice": ("activities", "Активности", "evict_notice"),
    "hand": ("activities", "Активности", "hand"),
}

# Документы, которые уже должны лежать на карточке, чтобы она встала в колонку.
# code, которого нет в шаблоне активностей, проверяется отдельно.
ENTRY = {
    "disconnect": (("notice", "pdf", "Предупреждение (PDF, печать)"),),
    "notary": (
        ("prep", "pack_calc", "Расчёт задолженности"),
        ("prep", "pack_claim", "Заявление"),
        ("prep", "proxy", "Доверенность"),
    ),
    "writ_done": (("writ_done", "writ", "Исполнительная надпись"),),
    "refused": (("refused", "refusal", "Отказ нотариуса"),),
    "judgment": (("judgment", "decision", "Судебное решение"),),
    "opi": (("writ_done", "enforcement_doc", "Исполнительный документ"),),
    "opi_measures": (("opi_measures", "opi_act", "Меры ОПИ"),),
    "impossible": (("impossible", "acts", "Акты о невозможности взыскания"),),
    "p1": (("p1", "evict_notice", "Уведомление о возможном выселении"),),
}

# Файл мероприятия. Пустой набор — у вида нет документа, перенос не останавливается.
MEASURE_DOCS = {
    "call": (),
    "notice": (),
    "warning": (("notice", "pdf", "Предупреждение (PDF, печать)"),),
    "disconnect": (),
    "collection": (
        ("prep", "pack_calc", "Расчёт задолженности"),
        ("prep", "pack_claim", "Заявление"),
        ("prep", "proxy", "Доверенность"),
    ),
    "scenario": (),
    "extra": (),
}

# Эти коды закрывает синхронизация дела и без файла. Для них нужен сам файл.
FILE_CODES = {"acts", "opi_act", "enforcement_doc", "proxy"}


def _uploads(stage: str) -> list[tuple[str, str]]:
    return [(code, title) for code, _parent, title, kind in TEMPLATES.get(stage, ()) if kind == "upload"]


def _forward(current: str, target: str) -> bool:
    current = normalize(current)
    target = normalize(target)
    if target in {"p1", "p2"}:
        return True
    if current in {"p1", "p2"}:
        return False
    return rank_of(target) > rank_of(current)


def _claim_id(account) -> int | None:
    from apps.debts.models import ClaimCase

    return ClaimCase.objects.filter(account=account).order_by("-id").values_list("id", flat=True).first()


def _attachment_texts(account) -> list[str]:
    from apps.debts.models import Attachment

    rows = Attachment.objects.filter(account=account).values_list("doc_type", "original_name")
    return [f"{doc_type} {name}".casefold() for doc_type, name in rows]


def _activity_done(account, stage: str, code: str) -> bool:
    from apps.debts.models import StageActivity

    return StageActivity.objects.filter(
        account=account, stage=stage, code=code, status=StageActivity.Status.DONE,
    ).exists()


def _package_pdf(account, doc_type: str) -> bool:
    from apps.debts.models import ClaimPackageDocument

    return ClaimPackageDocument.objects.filter(
        package__case__account=account, doc_type=doc_type,
    ).exclude(pdf="").exists()


def _package_any(account, doc_types: tuple[str, ...]) -> bool:
    from apps.debts.models import ClaimPackageDocument

    return ClaimPackageDocument.objects.filter(
        package__case__account=account, doc_type__in=doc_types,
    ).exclude(pdf="").exists()


def document_present(account, stage: str, code: str, title: str) -> bool:
    """Файл этого документа уже лежит на счёте, в пакете или в закрытом пункте загрузки."""
    texts = None

    def attachments() -> list[str]:
        nonlocal texts
        if texts is None:
            texts = _attachment_texts(account)
        return texts

    if code == "proxy":
        return _package_pdf(account, "proxy")
    if code == "pack_claim":
        return _activity_done(account, stage, code) or _package_pdf(account, "application") or _titled(attachments(), title)
    if code == "pack_calc":
        return _activity_done(account, stage, code) or _package_pdf(account, "debt_calculation") or _titled(attachments(), title)
    if code == "suit":
        return (
            _activity_done(account, stage, code)
            or _package_any(account, ("lawsuit", "eviction", "alienation"))
            or _titled(attachments(), title)
        )
    if code == "pdf":
        from apps.debts.models import Measure

        artifact = Measure.objects.filter(accounts=account, kind=Measure.Kind.WARNING).exclude(artifact="").exists()
        return artifact or _activity_done(account, stage, code) or _titled(attachments(), title)
    if code == "acts":
        from apps.debts.models import ClaimAct

        filed = ClaimAct.objects.filter(case__account=account, attachment__isnull=False).exists()
        return filed or _marked(attachments(), "акт")
    if code == "opi_act":
        from apps.debts.models import ClaimCase

        for taken, inquiry in ClaimCase.objects.filter(account=account).values_list("opi_measures_taken", "pris_inquiry"):
            for item in taken or []:
                if isinstance(item, dict) and item.get("attachment_id"):
                    return True
            actions = inquiry.get("p_action") if isinstance(inquiry, dict) else None
            if actions:
                return True
        return _marked(attachments(), "постановление опи") or _marked(attachments(), "меры опи")
    if code == "enforcement_doc":
        if _activity_done(account, "writ_done", "writ") or _activity_done(account, "judgment", "decision"):
            return True
        blob = " ".join(attachments())
        return "исполнительн" in blob or "судебное решение" in blob
    if code == "opi_doc":
        if _activity_done(account, stage, code):
            return True
        return "исполнительн" in " ".join(attachments())
    if code == "refusal":
        if _activity_done(account, stage, code):
            return True
        return _marked(attachments(), "отказ")
    if code in FILE_CODES:
        return False
    if _activity_done(account, stage, code):
        return True
    return _titled(attachments(), title)


def _titled(rows: list[str], title: str) -> bool:
    needle = title.casefold()
    return any(needle in row for row in rows)


def _marked(rows: list[str], needle: str) -> bool:
    return any(needle in row for row in rows)


def _specs_for(current: str, target: str, *, entry_only: bool) -> list[tuple[str, str, str]]:
    specs: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    if not entry_only and _forward(current, target):
        for code, title in _uploads(normalize(current)):
            specs.append((normalize(current), code, title))
    for stage, code, title in ENTRY.get(normalize(target), ()):
        specs.append((stage, code, title))
    unique = []
    for spec in specs:
        if spec[1] in seen:
            continue
        seen.add(spec[1])
        unique.append(spec)
    return unique


def missing_documents(account, current: str, target: str, *, entry_only: bool = False) -> list[tuple[str, str, str]]:
    missing = []
    for stage, code, title in _specs_for(current, target, entry_only=entry_only):
        if document_present(account, stage, code, title):
            continue
        missing.append((stage, code, title))
    return missing


def _ensure(account, missing: list[tuple[str, str, str]]) -> None:
    from apps.debts.services.activities import ensure_stage

    stages = set()
    for stage, code, _title in missing:
        if code == "enforcement_doc":
            stages.add("writ_done")
        elif code != "proxy":
            stages.add(stage)
    for stage in stages:
        ensure_stage(account, stage)


def raise_document_gate(account, missing: list[tuple[str, str, str]], *, date_missing: bool = False, measure_id: int | None = None) -> None:
    if not missing and not date_missing:
        return
    _ensure(account, missing)
    if date_missing:
        from apps.debts.services.activities import ensure_stage

        ensure_stage(account, "notice")
    actions = []
    if date_missing:
        actions.append("Указать дату вручения предупреждения")
    actions.extend(f"Приложить документ «{title}»" for _stage, _code, title in missing)
    if date_missing and missing:
        message = "Нет даты вручения предупреждения и не приложены документы. Карточка остаётся в своей колонке."
    elif date_missing:
        message = "Нет даты вручения предупреждения. Карточка остаётся в своей колонке."
    else:
        names = ", ".join(f"«{title}»" for _stage, _code, title in missing)
        message = f"Нет документов: {names}. Карточка остаётся в своей колонке."
    claim_id = _claim_id(account)
    if date_missing:
        tab, tab_label, focus = PLACE["hand"]
    else:
        code = missing[0][1]
        tab, tab_label, focus = PLACE[code]
        if tab != "activities" and not claim_id:
            if code == "proxy":
                tab, tab_label, focus = "writ", "Исполнительная надпись", ""
            else:
                tab, tab_label, focus = "activities", "Активности", code
    raise FunnelGate(
        message,
        actions=actions,
        tab=tab,
        tab_label=tab_label,
        account_id=account.pk,
        claim_id=claim_id,
        measure_id=measure_id,
        focus=focus,
    )


def stage_gate(account, current: str, target: str, *, date_missing: bool = False) -> None:
    """Перенос карточки ЛС или договора. Пустой список документов переход не держит."""
    missing = missing_documents(account, current, target)
    raise_document_gate(account, missing, date_missing=date_missing)


def claim_gate(case, stage: str, reason: str = "") -> None:
    """Перенос дела. Документы колонки, в которую кладут карточку. Причина отказа заменяет скан."""
    from apps.debts.services.funnel import CLAIM_STAGE

    target = CLAIM_STAGE.get(stage or "", "")
    if not target:
        return
    missing = missing_documents(case.account, case.stage, target, entry_only=True)
    if target == "refused" and (reason or "").strip():
        missing = [item for item in missing if item[1] != "refusal"]
    raise_document_gate(case.account, missing)


def measure_gate(measure) -> None:
    """Перенос карточки мероприятия. Вид без файла в чек-листе не останавливается."""
    specs = MEASURE_DOCS.get(measure.kind)
    if not specs:
        return
    if measure.kind == "warning" and measure.artifact:
        return
    account_ids = list(measure.accounts.order_by("id").values_list("id", flat=True))
    if not account_ids:
        return
    from apps.debts.models import Account

    accounts = {row.pk: row for row in Account.objects.filter(pk__in=account_ids)}
    for account_id in account_ids:
        account = accounts.get(account_id)
        if account is None:
            continue
        missing = [
            (stage, code, title)
            for stage, code, title in specs
            if not document_present(account, stage, code, title)
        ]
        if missing:
            raise_document_gate(account, missing, measure_id=measure.pk)


def parallel_gate(account, stage: str) -> None:
    """Уведомление о выселении не включается без файла уведомления."""
    if stage != "p1":
        return
    missing = missing_documents(account, account.funnel_stage or "new", "p1", entry_only=True)
    raise_document_gate(account, missing)
