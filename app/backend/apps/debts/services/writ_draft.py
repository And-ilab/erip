"""Создание исполнительной надписи по одному лицевому счёту.

Период, суммы и ФИО берутся из выгрузки. Предыдущий и текущий месяц к долгу не относятся:
они ещё не предъявлены. Вторая надпись за тот же период не создаётся.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db.models import Q

from apps.core.exceptions import ServiceError
from apps.debts.models import ClaimCase, ClaimEvent, ClaimPackage, Measure, MeasureItem, ServiceDebtPeriod
from apps.debts.services.claims import _claim_ready


class WritDraftError(ServiceError):
    default_detail = "Исполнительную надпись создать нельзя"
    default_code = "writ_draft"


def writ_preview(account) -> dict:
    eligible = _eligible_periods(account)
    cases = list(_writs(account))
    uncovered = _uncovered(eligible, cases)
    records = [_record(case) for case in cases]
    warning = _warning_date(account)
    start, end = _bounds(uncovered)
    principal, penalty = _sums(uncovered)
    blockers = _blockers(account, uncovered, warning, None)
    return {
        "eligible_from": _iso(start),
        "eligible_to": _iso(end),
        "months": len({(row.period.year, row.period.month) for row in uncovered}),
        "warning_delivered_on": _iso(warning),
        "defendant_name": _defendant(account, start, end),
        "principal": _money(principal),
        "penalty": _money(penalty),
        "tariff": None,
        "repayment_days": 7,
        "blockers": blockers,
        "records": records,
    }


def create_writ(account, user, payload: dict) -> ClaimCase:
    start = _parse_date(payload.get("debt_from"), "Период задолженности с")
    end = _parse_date(payload.get("debt_to"), "Период задолженности по")
    if end < start:
        raise WritDraftError("Дата окончания периода раньше даты начала")
    warning = _optional_date(payload.get("warning_delivered_on"))
    act_on = _optional_date(payload.get("non_delivery_act_on"))
    office = str(payload.get("notary_office") or "").strip()
    if not office:
        raise WritDraftError("Выберите нотариальную контору")
    days = _days(payload.get("repayment_days"))
    chosen = [
        row for row in _eligible_periods(account)
        if start <= row.period <= end
    ]
    months = {(row.period.year, row.period.month) for row in chosen}
    if len(months) < 2:
        raise WritDraftError("Исполнительная надпись формируется, если долг составляет 2 и более расчётных периода")
    if not warning and not act_on:
        raise WritDraftError(
            "Нужна дата вручения предупреждения или дата акта о невручении предупреждения",
        )
    for case in _writs(account):
        if case.debt_from and case.debt_to and _overlaps(start, end, case.debt_from, case.debt_to):
            raise WritDraftError(
                "За период "
                f"{case.debt_from.strftime('%d.%m.%Y')}–{case.debt_to.strftime('%d.%m.%Y')} "
                "исполнительная надпись уже сформирована",
            )
    if not _claim_ready(account):
        raise WritDraftError("Исполнительная надпись открывается с группы 3")
    principal, penalty = _sums(chosen)
    case = ClaimCase.objects.create(
        organization=account.organization,
        account=account,
        debt_from=start,
        debt_to=end,
        warning_delivered_on=warning,
        non_delivery_act_on=act_on,
        repayment_days=days,
        writ_principal=principal,
        writ_penalty=penalty,
        notary_office=office[:250],
        defendant_name=_defendant(account, start, end)[:250],
    )
    ClaimEvent.objects.create(
        case=case, actor=user if getattr(user, "is_authenticated", False) else None,
        old_stage="", new_stage=ClaimCase.Stage.PREP,
        reason=(
            f"Исполнительная надпись {start.strftime('%d.%m.%Y')}–{end.strftime('%d.%m.%Y')}, "
            f"погашение {days} календарных дней"
        ),
    )
    from apps.debts.services.claim_measures import sync_claim_measure
    from apps.debts.services.writ_flow import seed_task_checks

    sync_claim_measure(case)
    seed_task_checks(case)
    return case


def _writs(account):
    return ClaimCase.objects.filter(account=account).exclude(debt_from__isnull=True).order_by("debt_from", "id")


def _eligible_periods(account) -> list[ServiceDebtPeriod]:
    cutoff = _presented_cutoff(account)
    rows = list(
        ServiceDebtPeriod.objects.filter(account=account, period__lt=cutoff).filter(
            Q(principal__gt=0) | Q(penalty__gt=0),
        ).order_by("period", "id")
    )
    return rows


def _presented_cutoff(account) -> date:
    """Первый день предыдущего месяца: он и текущий месяц ещё не предъявлены."""
    anchor = account.operational_date or date.today()
    start = anchor.replace(day=1)
    return _add_months(start, -1)


def _add_months(value: date, months: int) -> date:
    index = value.month - 1 + months
    year = value.year + index // 12
    month = index % 12 + 1
    return date(year, month, 1)


def _uncovered(periods, cases) -> list[ServiceDebtPeriod]:
    covered = [(case.debt_from, case.debt_to) for case in cases if case.debt_from and case.debt_to]
    free = []
    for row in periods:
        if any(_overlaps(row.period, row.period, start, end) for start, end in covered):
            continue
        free.append(row)
    return free


def _overlaps(left_from, left_to, right_from, right_to) -> bool:
    return left_from <= right_to and right_from <= left_to


def _bounds(periods):
    if not periods:
        return None, None
    return periods[0].period, periods[-1].period


def _sums(periods) -> tuple[Decimal, Decimal]:
    principal = sum((row.principal or Decimal("0")) for row in periods)
    penalty = sum((row.penalty or Decimal("0")) for row in periods)
    return principal, penalty


def _warning_date(account):
    row = (
        MeasureItem.objects.filter(
            account=account, measure__kind=Measure.Kind.WARNING, delivered_on__isnull=False,
        )
        .order_by("-delivered_on")
        .first()
    )
    return row.delivered_on if row else None


def _defendant(account, start, end) -> str:
    people = list(account.registrations.all())
    mains = [row for row in people if row.subj_is_main]
    pool = mains or people[:1]

    def present(row) -> bool:
        if start and row.check_out_date and row.check_out_date <= start:
            return False
        if end and row.check_in_date and row.check_in_date > end:
            return False
        return True

    chosen = next((row for row in pool if present(row)), None)
    if chosen is not None:
        name = str(chosen).strip()
        if name:
            return name
    return account.short_fio or ""


def _blockers(account, uncovered, warning, act_on) -> list[str]:
    messages = []
    if not _claim_ready(account):
        messages.append("Исполнительная надпись открывается с группы 3")
    if len({(row.period.year, row.period.month) for row in uncovered}) < 2:
        messages.append("Нет двух и более предъявленных расчётных периодов без уже созданной надписи")
    if not warning and not act_on:
        messages.append("Нет даты вручения предупреждения и нет даты акта о невручении")
    return messages


def _record(case: ClaimCase) -> dict:
    package = ClaimPackage.objects.filter(case=case).prefetch_related("documents").first()
    documents = []
    if package is not None:
        documents = [
            {"id": doc.pk, "name": doc.file_name, "doc_type": doc.doc_type, "signed": bool(doc.signature)}
            for doc in package.documents.all()
        ]
    return {
        "id": case.pk,
        "stage": case.stage,
        "stage_label": case.get_stage_display(),
        "debt_from": _iso(case.debt_from),
        "debt_to": _iso(case.debt_to),
        "warning_delivered_on": _iso(case.warning_delivered_on),
        "non_delivery_act_on": _iso(case.non_delivery_act_on),
        "repayment_days": case.repayment_days,
        "principal": _money(case.writ_principal),
        "penalty": _money(case.writ_penalty),
        "tariff": _money(case.notary_tariff) if case.notary_tariff is not None else None,
        "defendant_name": case.defendant_name,
        "notary_office": case.notary_office,
        "submission_id": case.submission_id,
        "formed": bool(package and package.formed_at),
        "documents": documents,
        "created_at": case.created_at.isoformat() if case.created_at else "",
    }


def _parse_date(value, label: str) -> date:
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    if not text:
        raise WritDraftError(f"Укажите поле «{label}»")
    try:
        return date.fromisoformat(text[:10])
    except ValueError as exc:
        raise WritDraftError(f"Поле «{label}» ожидается в формате ГГГГ-ММ-ДД") from exc


def _optional_date(value):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError as exc:
        raise WritDraftError("Дата ожидается в формате ГГГГ-ММ-ДД") from exc


def _days(value) -> int:
    if value in (None, ""):
        return 7
    try:
        days = int(value)
    except (TypeError, ValueError) as exc:
        raise WritDraftError("Количество дней на погашение — целое число") from exc
    if days < 1 or days > 365:
        raise WritDraftError("Количество дней на погашение указывается от 1 до 365. По постановлению это 7 календарных дней")
    return days


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _money(value) -> str:
    return f"{(value or Decimal('0')):.2f}"
