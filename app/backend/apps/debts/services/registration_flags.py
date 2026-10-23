"""Активная регистрация, проживающие и признаки, которые сами ставят категорию и стоп.

Карточка считает зарегистрированным того, кто не снят и у кого статус регистрации не «нет».
Проживающие в реестре договоров — те же действующие строки со статусом 1.
"""

from __future__ import annotations

from django.db.models import Count, IntegerField, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce

from apps.debts.models import Account, Measure, Registration, StatusHistory

ABROAD_CODE = "ais-08"
IDLER_CODE = "ais-17"
AUTO_CODES = {ABROAD_CODE, IDLER_CODE}
DEATH_REASON = "Смерть плательщика"


def active_q(prefix: str = "") -> Q:
    """Не снят с учёта и статус регистрации не «нет»."""
    p = f"{prefix}__" if prefix else ""
    departed = (
        Q(**{f"{p}subj_is_check_out": True})
        | Q(**{f"{p}sheet_removed": True})
        | Q(**{f"{p}reg_status": 0})
    )
    return ~departed


def resident_q(prefix: str = "") -> Q:
    """Проживающий: действующая регистрация и «Статус регистрации» = 1."""
    p = f"{prefix}__" if prefix else ""
    return active_q(prefix) & Q(**{f"{p}reg_status": 1})


def registration_count(outer: str, mode: str):
    extra = active_q() if mode == "active" else resident_q()
    return Coalesce(
        Subquery(
            Registration.objects.filter(account_id=OuterRef(outer))
            .filter(extra)
            .order_by()
            .values("account_id")
            .annotate(total=Count("id"))
            .values("total")[:1],
            output_field=IntegerField(),
        ),
        0,
    )


def flags_from_raw(raw: dict | None) -> tuple[int | None, bool, bool]:
    """Статус, выезд за пределы РБ и «снят» из исходной строки, если колонки ещё в raw."""
    status = None
    left = False
    removed = False
    for key, value in (raw or {}).items():
        folded = _fold(key)
        text = _fold(value)
        if "статус регистрации" in folded:
            status = _status(text)
        if "выехав" in folded:
            left = text in {"1", "да", "true", "yes"}
        if "снят" in folded and "снятия" not in folded and "убыт" not in folded:
            if text.startswith("1") or text in {"да", "true", "yes"}:
                removed = True
    return status, left, removed


def sync_account_flags(account: Account) -> None:
    """Категория по флагам регистрации и остановка мер, если умер плательщик."""
    _sync_category(account)
    _sync_death(account)


def _sync_category(account: Account) -> None:
    from apps.nsi.models import DebtorCategory

    active = account.registrations.filter(active_q())
    if active.filter(left_country=True).exists():
        code = ABROAD_CODE
    elif active.filter(idler_val=True).exists():
        code = IDLER_CODE
    else:
        code = ""
    current = account.debtor_category
    current_code = current.code if current is not None else ""
    if code:
        if current is not None and current_code not in AUTO_CODES:
            return
        if current_code == code:
            return
        category = DebtorCategory.objects.filter(
            organization__isnull=True, code=code, is_active=True,
        ).first()
        if category is None:
            return
        old = current.name if current else ""
        account.debtor_category = category
        account.save(update_fields=["debtor_category", "updated_at"])
        _history(account, StatusHistory.Kind.CATEGORY, old, category.name, "По регистрации")
        return
    if current_code in AUTO_CODES:
        old = current.name if current else ""
        account.debtor_category = None
        account.save(update_fields=["debtor_category", "updated_at"])
        _history(account, StatusHistory.Kind.CATEGORY, old, "", "Признак регистрации снят")


def _sync_death(account: Account) -> None:
    dead = (
        account.registrations.filter(subj_is_main=True, subj_death_date__isnull=False)
        .order_by("-subj_death_date", "-id")
        .first()
    )
    newcomers = account.registrations.filter(subj_is_main=True, subj_death_date__isnull=True)
    if account.deceased_payer_id:
        newcomers = newcomers.exclude(subj_id=account.deceased_payer_id)
    if account.payer_deceased and newcomers.exists():
        _resume_death(account)
        account.payer_deceased = False
        account.deceased_payer_id = None
        account.save(update_fields=["payer_deceased", "deceased_payer_id", "updated_at"])
        _history(account, StatusHistory.Kind.MEASURE, "paused", "assigned", "Новый плательщик")
        return
    if dead is None or account.payer_deceased:
        return
    account.payer_deceased = True
    account.deceased_payer_id = dead.subj_id
    account.save(update_fields=["payer_deceased", "deceased_payer_id", "updated_at"])
    _pause_for_death(account)
    _notify_death(account)
    _history(account, StatusHistory.Kind.MEASURE, "", "paused", DEATH_REASON)


def _pause_for_death(account: Account) -> None:
    rows = Measure.objects.filter(
        accounts=account,
        status__in=[Measure.Status.ASSIGNED, Measure.Status.RUNNING],
    )
    for measure in rows:
        measure.status = Measure.Status.PAUSED
        measure.stopped = True
        measure.pause_reason = DEATH_REASON
        measure.save(update_fields=["status", "stopped", "pause_reason", "updated_at"])


def _resume_death(account: Account) -> None:
    rows = Measure.objects.filter(
        accounts=account, status=Measure.Status.PAUSED, pause_reason=DEATH_REASON,
    )
    for measure in rows:
        measure.status = Measure.Status.ASSIGNED
        measure.stopped = False
        measure.pause_until = None
        measure.pause_reason = ""
        measure.save(update_fields=["status", "stopped", "pause_until", "pause_reason", "updated_at"])


def _notify_death(account: Account) -> None:
    from apps.notifications.models import Channel, Notification
    from apps.users.models import User

    if account.assigned_to_id:
        recipients = [account.assigned_to]
    else:
        recipients = list(User.objects.filter(
            organization=account.organization, role=User.Role.LOCAL_ADMIN, is_active=True,
        ))
    text = f"Плательщик по ЛС {account.client_account} умер. Мероприятия приостановлены."
    for user in recipients:
        if user is None:
            continue
        Notification.objects.create(
            organization=account.organization,
            channel=Channel.INBOX,
            body=text,
            rendered_text=text,
            recipient_user=user,
            account=account,
            status=Notification.Status.SENT,
        )


def _history(account: Account, kind: str, old: str, new: str, reason: str) -> None:
    StatusHistory.objects.create(
        organization=account.organization, account=account, kind=kind,
        old_value=old, new_value=new, reason=reason,
    )


def _fold(value) -> str:
    return str(value or "").strip().casefold().replace("ё", "е")


def _status(text: str) -> int | None:
    if text in {"0", "нет", "false", "no"}:
        return 0
    if text in {"1", "да", "true", "yes"}:
        return 1
    try:
        return int(float(text.replace(",", ".")))
    except ValueError:
        return None
