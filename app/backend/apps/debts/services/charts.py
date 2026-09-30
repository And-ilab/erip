"""Сводки для раздела «Граф. аналитика»: этап воронки, группа, динамика по месяцам.

Суммы читаются из услуг видимого контура. Поставщик получает только свои услуги.
Месяцы берутся из срезов BalanceHistory; если их нет, остаётся один текущий срез.
"""

from datetime import date
from decimal import Decimal

from django.db.models import Count, Max, QuerySet, Sum
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone

from apps.debts.models import Account, AccountService, BalanceHistory
from apps.nsi.models import DebtGroupScale

MONEY = Decimal("0.01")
STAGES = [
    ("new", "Новый должник"),
    ("prevention", "Автообзвон / уведомления"),
    ("warning", "Предупреждение вручено"),
    ("disconnect", "Отключение услуг"),
    ("enforcement", "Испол. надпись / иск"),
    ("court", "ОПИ"),
]
CLOSED = ("closed", "Не должник")


def _money(value) -> str:
    amount = value if isinstance(value, Decimal) else Decimal(value or 0)
    return str(amount.quantize(MONEY))


def _stage(raw: str | None) -> str:
    return raw or "new"


def _period(value) -> str:
    if isinstance(value, date):
        return value.isoformat()
    return value.date().isoformat()


class DebtCharts:
    def __init__(self, accounts: QuerySet, supplier_ids: list[int] | None):
        # Сбрасываем аннотации вьюхи: join услуг у поставщика иначе умножает число дел.
        self.accounts = Account.objects.filter(pk__in=accounts.values("pk"))
        self.supplier_ids = supplier_ids

    def build(self) -> dict:
        stages = self._stages()
        principal = sum((Decimal(row["principal"]) for row in stages), Decimal("0"))
        penalty = sum((Decimal(row["penalty"]) for row in stages), Decimal("0"))
        cases = sum(row["cases"] for row in stages)
        as_of = self.accounts.aggregate(day=Max("operational_date"))["day"] or timezone.localdate()
        months, source = self._months()
        return {
            "as_of": as_of.isoformat(),
            "cases": cases,
            "principal": _money(principal),
            "penalty": _money(penalty),
            "stages": stages,
            "groups": self._groups(),
            "months": months,
            "months_source": source,
        }

    def _services(self) -> QuerySet:
        qs = AccountService.objects.filter(account_id__in=self.accounts.values("id"))
        if self.supplier_ids is not None:
            qs = qs.filter(provider_id__in=self.supplier_ids or [-1])
        return qs

    def _stages(self) -> list[dict]:
        cases: dict[str, int] = {}
        for row in self.accounts.values("funnel_stage").annotate(cases=Count("id")):
            code = _stage(row["funnel_stage"])
            cases[code] = cases.get(code, 0) + row["cases"]
        money: dict[str, list[Decimal]] = {}
        for row in self._services().values("account__funnel_stage").annotate(
            principal=Sum("balance_out"), penalty=Sum("balance_mulct_out"),
        ):
            code = _stage(row["account__funnel_stage"])
            bucket = money.setdefault(code, [Decimal("0"), Decimal("0")])
            bucket[0] += row["principal"] or Decimal("0")
            bucket[1] += row["penalty"] or Decimal("0")
        ordered = list(STAGES)
        known = {code for code, _title in ordered}
        if cases.get("closed") or money.get("closed"):
            ordered.append(CLOSED)
            known.add("closed")
        for code in list(cases) + list(money):
            if code not in known:
                ordered.append((code, code))
                known.add(code)
        result = []
        for code, title in ordered:
            principal, penalty = money.get(code, (Decimal("0"), Decimal("0")))
            result.append({
                "code": code,
                "title": title,
                "cases": cases.get(code, 0),
                "principal": _money(principal),
                "penalty": _money(penalty),
            })
        return result

    def _groups(self) -> list[dict]:
        names = {row.group: row.name for row in DebtGroupScale.objects.all()}
        cases: dict = {}
        annotated = self.accounts.annotate(shown=Coalesce("debt_group_manual", "debt_group"))
        for row in annotated.values("shown").annotate(cases=Count("id")):
            cases[row["shown"]] = row["cases"]
        money: dict = {}
        grouped = self._services().annotate(
            shown=Coalesce("account__debt_group_manual", "account__debt_group"),
        )
        for row in grouped.values("shown").annotate(principal=Sum("balance_out"), penalty=Sum("balance_mulct_out")):
            money[row["shown"]] = (row["principal"] or Decimal("0"), row["penalty"] or Decimal("0"))
        keys = sorted((key for key in set(cases) | set(money) if key is not None))
        if None in cases or None in money:
            keys.append(None)
        result = []
        for key in keys:
            count = cases.get(key, 0)
            principal, penalty = money.get(key, (Decimal("0"), Decimal("0")))
            if count == 0 and principal == 0 and penalty == 0:
                continue
            if key is None:
                title = "Без группы"
            else:
                title = f"Группа {key} · {names[key]}" if key in names else f"Группа {key}"
            result.append({
                "group": key,
                "title": title,
                "cases": count,
                "principal": _money(principal),
                "penalty": _money(penalty),
            })
        return result

    def _months(self) -> tuple[list[dict], str]:
        qs = BalanceHistory.objects.filter(account_id__in=self.accounts.values("id"))
        if self.supplier_ids is not None:
            qs = qs.filter(service__provider_id__in=self.supplier_ids or [-1])
        rows = list(
            qs.annotate(bucket=TruncMonth("period"))
            .values("bucket")
            .annotate(
                principal=Sum("principal"),
                penalty=Sum("penalty"),
                cases=Count("account_id", distinct=True),
            )
            .order_by("bucket")
        )
        rows = [row for row in rows if row["bucket"] is not None]
        if rows:
            return [
                {
                    "period": _period(row["bucket"]),
                    "cases": row["cases"],
                    "principal": _money(row["principal"]),
                    "penalty": _money(row["penalty"]),
                }
                for row in rows[-12:]
            ], "history"
        today = timezone.localdate().replace(day=1)
        totals = self._services().aggregate(principal=Sum("balance_out"), penalty=Sum("balance_mulct_out"))
        principal = totals["principal"] or Decimal("0")
        penalty = totals["penalty"] or Decimal("0")
        return [{
            "period": today.isoformat(),
            "cases": self.accounts.count(),
            "principal": _money(principal),
            "penalty": _money(penalty),
        }], "current"
