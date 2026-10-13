"""Состав долга лицевого счёта: сколько должен каждому поставщику.

Доли пишутся из услуг и не правятся вручную: суммы по-прежнему приходят из АИС.
"""

from decimal import Decimal

from django.db.models import Max, Sum
from django.db.models.functions import Coalesce

from apps.debts.models import Account, DebtShare
from apps.users.scoping import AccessScope

ZERO = Decimal("0.00")
UNALLOCATED = "Не разнесено по поставщикам"


def sync_debt_shares(account: Account) -> None:
    """Пересобирает доли по текущим услугам. Повтор с теми же суммами ничего не меняет."""
    grouped = account.services.values("provider_id").annotate(
        principal=Coalesce(Sum("balance_out"), ZERO),
        penalty=Coalesce(Sum("balance_mulct_out"), ZERO),
        provider_name=Max("shot_name"),
    )
    seen: set[int] = set()
    for row in grouped:
        provider_id = row["provider_id"] if row["provider_id"] is not None else 0
        seen.add(provider_id)
        name = (row["provider_name"] or "").strip()
        if not name and provider_id:
            name = f"Поставщик {provider_id}"
        DebtShare.objects.update_or_create(
            account=account,
            provider_id=provider_id,
            defaults={
                "provider_name": name[:250],
                "principal": row["principal"],
                "penalty": row["penalty"],
            },
        )
    if seen:
        account.debt_shares.exclude(provider_id__in=seen).delete()
    else:
        account.debt_shares.all().delete()


def _money(value) -> str:
    amount = value if value is not None else ZERO
    return f"{amount:.2f}"


def _payload(provider_id: int | None, name: str, principal, penalty) -> dict:
    principal = principal or ZERO
    penalty = penalty or ZERO
    return {
        "provider_id": provider_id,
        "provider_name": name or "Без поставщика",
        "principal": _money(principal),
        "penalty": _money(penalty),
        "total": _money(principal + penalty),
    }


def visible_shares(account: Account, user) -> list[dict]:
    """Поставщик получает только свои доли. Чужой остаток и неразнесённый хвост ему не отдаются."""
    rows = list(account.debt_shares.all())
    supplier = getattr(user, "contour", "") == "supplier"
    if supplier:
        allowed = set(AccessScope(user).provider_ids())
        rows = [row for row in rows if row.provider_id in allowed]
    payload = [
        _payload(
            None if row.provider_id == 0 else row.provider_id,
            row.provider_name,
            row.principal,
            row.penalty,
        )
        for row in rows
    ]
    if supplier:
        return payload
    parts = sum((row.principal or ZERO for row in account.debt_shares.all()), ZERO)
    gap = (account.balance_out or ZERO) - parts
    if gap != 0:
        payload.append(_payload(None, UNALLOCATED, gap, ZERO))
    return payload
