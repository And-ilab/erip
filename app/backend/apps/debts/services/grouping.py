"""Расчёт группы задолженности (ТЗ 4.2.1.4).

Группа услуги берётся по самому раннему непогашенному периоду. Периоды строятся из числа
месяцев долга и остатка: сумма и пеня раскладываются по этим месяцам. Группа ЛС — максимум
среди услуг. Ручная корректировка хранится отдельно и снимается, когда расчётная группа
перестала совпадать с основанием корректировки.
"""

import calendar
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from apps.debts.models import Account, AccountService
from apps.nsi.models import DebtGroupScale


@dataclass(frozen=True)
class GroupBand:
    group: int
    months_from: int
    months_to: int | None

    def contains(self, months: int) -> bool:
        return months >= self.months_from and (self.months_to is None or months < self.months_to)


DEFAULT_SCALE: tuple[GroupBand, ...] = (
    GroupBand(1, 0, 2),
    GroupBand(2, 2, 3),
    GroupBand(3, 3, 6),
    GroupBand(4, 6, 12),
    GroupBand(5, 12, 36),
    GroupBand(6, 36, None),
)


class DebtGroupCalculator:
    def __init__(self, scale: Sequence[GroupBand] | None = None):
        self.scale = tuple(scale) if scale else self.load_scale()

    @staticmethod
    def load_scale() -> tuple[GroupBand, ...]:
        bands = tuple(
            GroupBand(s.group, s.months_from, s.months_to) for s in DebtGroupScale.objects.active().order_by("group")
        )
        return bands or DEFAULT_SCALE

    def group_for_months(self, months: int | None) -> int | None:
        if months is None or months < 0:
            return None
        for band in self.scale:
            if band.contains(months):
                return band.group
        return self.scale[-1].group if self.scale else None

    @staticmethod
    def debt_started_on(operational: date | None, months: int | None, due_day: int) -> date | None:
        """День, следующий за сроком оплаты самого раннего непогашенного периода."""
        if operational is None or months is None or months < 0:
            return None
        year, month = operational.year, operational.month
        shift = max(months - 1, 0)
        month -= shift
        while month <= 0:
            month += 12
            year -= 1
        month += 1
        if month == 13:
            month = 1
            year += 1
        day = min(max(due_day, 1), calendar.monthrange(year, month)[1])
        return date(year, month, day) + timedelta(days=1)

    @staticmethod
    def has_debt(service: AccountService) -> bool:
        balance = service.balance_out if service.balance_out is not None else service.overdue_debt
        return balance is not None and balance > Decimal("0")

    def group_for_service(self, service: AccountService) -> int | None:
        if not self.has_debt(service):
            return None
        months = service.debt_period if service.debt_period is not None else 0
        return self.group_for_months(months)

    @staticmethod
    def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
        month += delta
        while month <= 0:
            month += 12
            year -= 1
        while month > 12:
            month -= 12
            year += 1
        return year, month

    def build_periods(
        self, operational: date | None, months: int | None, due_day: int,
        principal: Decimal | None, penalty: Decimal | None,
    ) -> list[dict]:
        """Непогашенные периоды от самого раннего. Остаток делится по месяцам, копейки — на ранний."""
        if operational is None or not months or months < 0:
            return []
        if (principal or Decimal("0")) <= 0 and (penalty or Decimal("0")) <= 0:
            return []
        year, month = self._shift_month(operational.year, operational.month, -(months - 1))
        principal_parts = self._split(principal, months)
        penalty_parts = self._split(penalty, months)
        rows = []
        for index in range(months):
            due_year, due_month = self._shift_month(year, month, 1)
            day = min(max(due_day, 1), calendar.monthrange(due_year, due_month)[1])
            due_on = date(due_year, due_month, day)
            rows.append({
                "period": date(year, month, 1),
                "principal": principal_parts[index],
                "penalty": penalty_parts[index],
                "due_on": due_on,
                "started_on": due_on + timedelta(days=1),
            })
            year, month = self._shift_month(year, month, 1)
        return rows

    @staticmethod
    def _split(total: Decimal | None, count: int) -> list[Decimal]:
        amount = total if total is not None else Decimal("0")
        share = (amount / count).quantize(Decimal("0.01"))
        parts = [share] * count
        parts[0] = amount - share * (count - 1)
        return parts

    def sync_periods(self, service: AccountService, operational: date | None, due_day: int) -> list[dict]:
        from apps.debts.models import ServiceDebtPeriod

        if not self.has_debt(service):
            ServiceDebtPeriod.objects.filter(service=service).delete()
            return []
        rows = self.build_periods(
            operational, service.debt_period, due_day, service.balance_out, service.balance_mulct_out,
        )
        ServiceDebtPeriod.objects.filter(service=service).delete()
        if rows:
            ServiceDebtPeriod.objects.bulk_create([
                ServiceDebtPeriod(
                    organization=service.organization, account=service.account, service=service, **row,
                )
                for row in rows
            ])
        open_rows = [row for row in rows if (row["principal"] or 0) > 0 or (row["penalty"] or 0) > 0]
        return open_rows

    @staticmethod
    def release_manual(obj, new_group: int | None) -> bool:
        """Снять ручную группу, если расчётная группа изменилась относительно основания."""
        if obj.debt_group_manual is None:
            return False
        if obj.debt_group_basis == new_group:
            return False
        obj.debt_group_manual = None
        obj.debt_group_manual_reason = ""
        obj.debt_group_basis = None
        return True

    def recalculate(self, account: Account, due_day: int = 25, operational: date | None = None) -> int | None:
        services = list(account.services.all())
        op_date = operational or account.operational_date
        for service in services:
            periods = self.sync_periods(service, op_date, due_day)
            if periods:
                earliest = min(periods, key=lambda row: row["period"])
                group = self.group_for_months(len(periods))
                started = earliest["started_on"]
            elif self.has_debt(service):
                months = service.debt_period if service.debt_period is not None else 0
                group = self.group_for_months(months)
                started = self.debt_started_on(op_date, months, due_day)
            else:
                group = None
                started = None
            released = self.release_manual(service, group)
            fields = []
            if service.debt_group != group:
                service.debt_group = group
                fields.append("debt_group")
            if service.debt_started_on != started:
                service.debt_started_on = started
                fields.append("debt_started_on")
            if released:
                fields.extend(["debt_group_manual", "debt_group_manual_reason", "debt_group_basis"])
            if fields:
                service.save(update_fields=[*fields, "updated_at"])
        calculated = max((s.debt_group for s in services if s.debt_group), default=None)
        self.release_manual(account, calculated)
        account.debt_group = calculated
        shown = [s.effective_group for s in services if s.effective_group]
        months = [s.debt_period for s in services if self.has_debt(s) and s.debt_period]
        account.months_debt = max(months) if months else (0 if shown else None)
        starts = [s.debt_started_on for s in services if s.debt_started_on and s.effective_group]
        account.debt_started_on = min(starts) if starts else None
        account.save(update_fields=[
            "debt_group", "debt_group_manual", "debt_group_manual_reason", "debt_group_basis",
            "months_debt", "debt_started_on", "updated_at",
        ])
        return account.effective_group

    def recalculate_many(self, accounts: Iterable[Account]) -> int:
        count = 0
        for account in accounts:
            self.recalculate(account)
            count += 1
        return count
