"""Боевой ход АИС ПРИС: очередь погашения после выгрузки оплат и такт автоопроса.

Период опроса задаётся на экране интеграций. Пока он пуст, такт ничего не вызывает:
срок в регламенте API не задан. В очередь попадают только новые и изменённые оплаты
дела, которое контур уже принял. Уже принятая сумма повторно не ставится.
Запрос хода без номера производства и погашение по задолженности, переданной в Минюст
сегодня, не вызываются: исполнитель вносит решение вручную.
"""

from __future__ import annotations

import logging
from datetime import datetime

from django.utils import timezone

from apps.debts.models import ClaimCase, Payment, PrisRepayment, PrisRepayQueue
from apps.debts.services.pris_submit import (
    _ACCEPTED,
    PrisFollowupEarly,
    _amount,
    flush_repay_queue,
    pris_channel_status,
    refresh_open_proceedings,
)
from apps.nsi.models import PrisPoll

logger = logging.getLogger(__name__)

_LIVE = {"http", "channel"}


def enqueue_repayments(payment_ids: list[int]) -> int:
    """Ставит оплаты в очередь дел, которые ПРИС уже принял. Уже принятую сумму пропускает."""
    if not payment_ids:
        return 0
    payments = [
        payment for payment in Payment.objects.filter(pk__in=payment_ids).exclude(pay_date=None)
        if _amount(payment.pay_service_summ) + _amount(payment.pay_mulct_summ) > 0
    ]
    if not payments:
        return 0
    cases = list(
        ClaimCase.objects.filter(
            account_id__in={payment.account_id for payment in payments},
            pris_process_status__in=_ACCEPTED,
        ).exclude(pris_cl_num="")
    )
    if not cases:
        return 0
    sent = set(
        PrisRepayment.objects.filter(
            case__in=cases, payment_id__in=[payment.pk for payment in payments],
        ).values_list("case_id", "payment_id")
    )
    rows = []
    for case in cases:
        for payment in payments:
            if payment.account_id != case.account_id:
                continue
            if (case.pk, payment.pk) in sent:
                continue
            rows.append(PrisRepayQueue(case=case, payment=payment))
    if not rows:
        return 0
    PrisRepayQueue.objects.bulk_create(rows, ignore_conflicts=True)
    return len(rows)


def report_imported_payments(payment_ids: list[int]) -> dict:
    """После файла оплат: очередь и, если канал живой, сразу передача. Ошибка импорт не роняет."""
    try:
        queued = enqueue_repayments(payment_ids)
        flushed = flush_pending() if queued else {"sent": 0, "failed": 0, "mode": ""}
        return {"queued": queued, **flushed}
    except Exception:
        logger.exception("Погашение ПРИС после импорта оплат не собрано")
        return {"queued": 0, "sent": 0, "failed": 0, "mode": ""}


def flush_pending() -> dict:
    """Передаёт очередь, когда канал http или channel. В заглушке очередь остаётся."""
    status = pris_channel_status()
    mode = str(status.get("mode") or "stub")
    if mode not in _LIVE:
        return {"sent": 0, "failed": 0, "waiting": 0, "mode": mode}
    from apps.core.exceptions import GatewayUnavailable
    from apps.debts.services.claims import ClaimBlocked

    sent = 0
    failed = 0
    waiting = 0
    case_ids = PrisRepayQueue.objects.values_list("case_id", flat=True).distinct()
    cases = ClaimCase.objects.filter(pk__in=case_ids).select_related("organization", "account")
    for case in cases.iterator(chunk_size=50):
        try:
            if flush_repay_queue(case, None) is not None:
                sent += 1
        except PrisFollowupEarly:
            waiting += 1
        except (ClaimBlocked, GatewayUnavailable) as exc:
            failed += 1
            logger.warning("Погашение дела %s не ушло: %s", case.pk, exc)
    return {"sent": sent, "failed": failed, "waiting": waiting, "mode": mode}


def tick_pris_poll(now: datetime | None = None) -> dict:
    """Один такт расписания. Пустой период и ранний повтор контур не вызывают."""
    row = PrisPoll.load()
    if not row.interval_minutes:
        return {"ran": False, "wait": 30, "reason": "период не задан", "summary": ""}
    moment = now or timezone.now()
    if row.last_tick_at is not None:
        elapsed = (moment - row.last_tick_at).total_seconds()
        period = row.interval_minutes * 60
        if elapsed < period:
            remain = max(1, int(period - elapsed))
            return {"ran": False, "wait": min(30, remain), "reason": "рано", "summary": row.last_summary}
    _open_session()
    repay = flush_pending()
    refreshed = refresh_open_proceedings()
    summary = (
        f"Ход: {refreshed['refreshed']}, на следующий день: {refreshed['waiting']}, "
        f"без ответа: {len(refreshed['blocked'])}. "
        f"Погашения: {repay['sent']}, на следующий день: {repay['waiting']}."
    )[:500]
    row.last_tick_at = moment
    row.last_summary = summary
    row.save(update_fields=["last_tick_at", "last_summary", "updated_at"])
    return {"ran": True, "wait": 30, "reason": "", "summary": summary}


def _open_session() -> None:
    """Вход модуля на такте: служебные вызовы, если для этого токена их ещё не было."""
    try:
        from apps.nsi.services.integrations import pris_session

        pris_session()
    except Exception as exc:
        logger.warning("Вход ПРИС на такте опроса не выполнен: %s", exc)
