"""Строки услуг для грида и канбана: договор, поставщик, первоначальные суммы и остатки по периодам."""

from decimal import Decimal

from apps.debts.models import AccountService


def _money(value) -> str | None:
    if value is None:
        return None
    return f"{Decimal(value):.2f}"


def _iso(value) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _has_debt(service: AccountService) -> bool:
    principal = service.balance_out or Decimal("0")
    penalty = service.balance_mulct_out or Decimal("0")
    overdue = service.overdue_debt or Decimal("0")
    return principal > 0 or penalty > 0 or overdue > 0


def period_rows(service: AccountService) -> list[dict]:
    """Непогашенные периоды услуги: остаток долга и пени."""
    rows = []
    for period in service.debt_periods.all():
        principal = period.principal or Decimal("0")
        penalty = period.penalty or Decimal("0")
        if principal <= 0 and penalty <= 0:
            continue
        rows.append({
            "period": _iso(period.period),
            "principal": _money(period.principal),
            "penalty": _money(period.penalty),
        })
    return rows


def service_line(service: AccountService) -> dict:
    return {
        "service_list_id": service.service_list_id,
        "service_name": service.service_name or "",
        "start_date": _iso(service.start_date),
        "shot_name": service.shot_name or "",
        "initial_principal": _money(service.initial_principal),
        "initial_penalty": _money(service.initial_penalty),
        "balance_out": _money(service.balance_out),
        "balance_mulct_out": _money(service.balance_mulct_out),
        "repayment_due_on": _iso(service.repayment_due_on),
        "last_payment_date": _iso(service.last_payment_date),
        "debt_started_on": _iso(service.debt_started_on),
        "periods": period_rows(service),
    }


def board_service_lines(services) -> tuple[list[dict], int]:
    lines = [service_line(service) for service in services]
    debt_count = sum(1 for service in services if _has_debt(service))
    return lines, debt_count
