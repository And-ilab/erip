"""Расчёт группы задолженности (ТЗ 4.2.1.5).

Группа услуги — по числу месяцев долга (debt_period) и шкале НСИ; группа ЛС — максимальная
среди услуг с долгом. Ручная корректировка хранится отдельно и расчётом не перезаписывается.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
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
        if months is None or months <= 0:
            return None
        for band in self.scale:
            if band.contains(months):
                return band.group
        return self.scale[-1].group

    @staticmethod
    def has_debt(service: AccountService) -> bool:
        balance = service.balance_out if service.balance_out is not None else service.overdue_debt
        return balance is not None and balance > Decimal("0")

    def group_for_service(self, service: AccountService) -> int | None:
        return self.group_for_months(service.debt_period) if self.has_debt(service) else None

    def recalculate(self, account: Account) -> int | None:
        services = list(account.services.all())
        for service in services:
            group = self.group_for_service(service)
            if service.debt_group != group:
                service.debt_group = group
                service.save(update_fields=["debt_group", "updated_at"])
        groups = [s.debt_group for s in services if s.debt_group]
        account.debt_group = max(groups) if groups else None
        account.save(update_fields=["debt_group", "updated_at"])
        return account.debt_group

    def recalculate_many(self, accounts: Iterable[Account]) -> int:
        count = 0
        for account in accounts:
            self.recalculate(account)
            count += 1
        return count
