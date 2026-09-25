"""Пересчёт полей ПМ после загрузки АИС: группа, рейтинг, контакты, история, снятие мер."""

from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Max, Q
from django.utils import timezone

from apps.debts.models import (
    Account,
    AccountService,
    BalanceHistory,
    Contact,
    Measure,
    Payment,
    RefreshRequest,
    Registration,
    StatusHistory,
)
from apps.debts.services.grouping import DebtGroupCalculator
from apps.nsi.models import CalculationSettings, ScenarioRule
from apps.users.models import ServiceOrganization

STAGE_BY_GROUP = {
    1: "prevention",
    2: "warning",
    3: "disconnect",
    4: "enforcement",
    5: "enforcement",
    6: "court",
}
AUTO_MEASURES = {
    Measure.Kind.CALL,
    Measure.Kind.NOTICE,
    Measure.Kind.WARNING,
    Measure.Kind.DISCONNECT,
    Measure.Kind.SCENARIO,
}


def scenario_names() -> dict[int, str]:
    rows = dict(
        ScenarioRule.objects.active().filter(category__isnull=True).values_list("group", "name")
    )
    return rows or {
        1: "Превентивный обзвон и уведомления",
        2: "Письменное предупреждение",
        3: "Отключение и подготовка взыскания",
        4: "Взыскание через ОПИ",
        5: "Взыскание через ОПИ",
        6: "Взыскание, безнадёжная задолженность",
    }


def rating_letter(group: int | None, aggravating: bool) -> str:
    if group is None or group <= 2:
        return "A"
    if group == 3:
        return "B"
    if group == 6:
        return "E"
    return "D" if aggravating else "C"


class PortfolioRefresher:
    def __init__(self):
        self.settings = CalculationSettings.load()
        self.calculator = DebtGroupCalculator()
        self.scenarios = scenario_names()

    def refresh(self, account_ids: list[int]) -> None:
        if not account_ids:
            return
        accounts = Account.objects.filter(pk__in=account_ids).prefetch_related("services", "registrations", "payments")
        for account in accounts:
            self.refresh_account(account)

    def refresh_account(self, account: Account) -> None:
        operational = self._operational_date(account)
        if operational and account.operational_date != operational:
            account.operational_date = operational
            account.save(update_fields=["operational_date", "updated_at"])
        before_group = account.debt_group
        self.calculator.recalculate(account, due_day=self.settings.payment_due_day, operational=operational)
        account.refresh_from_db()
        if before_group != account.debt_group:
            self._log(account, StatusHistory.Kind.GROUP, "" if before_group is None else str(before_group),
                      "" if account.debt_group is None else str(account.debt_group))
        self._scenarios(account)
        self._funnel(account)
        self._payer(account)
        self._contacts(account)
        self._history_balances(account)
        self._initial_sums(account)
        self._last_payment(account)
        self._inheritance(account)
        self._rating(account)
        self._close_paid(account)
        RefreshRequest.objects.filter(account=account, status=RefreshRequest.Status.PENDING).update(
            status=RefreshRequest.Status.DONE, updated_at=timezone.now(),
        )
        if account.ais_updated_at is None or True:
            account.ais_updated_at = timezone.now()
            account.save(update_fields=["ais_updated_at", "updated_at"])

    def _operational_date(self, account: Account) -> date | None:
        dates = [d for d in account.registrations.values_list("oper_date", flat=True) if d]
        dates += [d for d in account.payments.values_list("acc_oper_date", flat=True) if d]
        return max(dates) if dates else account.operational_date

    def _scenario_name(self, group: int | None, category_id: int | None) -> str:
        if group and category_id:
            named = (
                ScenarioRule.objects.active()
                .filter(group=group, category_id=category_id)
                .values_list("name", flat=True)
                .first()
            )
            if named:
                return named
        return self.scenarios.get(group or 0, "")

    def _scenarios(self, account: Account) -> None:
        for service in account.services.all():
            if service.scenario_locked:
                continue
            name = self._scenario_name(service.effective_group, account.debtor_category_id)
            if service.scenario_name != name:
                self._log(account, StatusHistory.Kind.SCENARIO, service.scenario_name, name, service=service)
                service.scenario_name = name
                service.save(update_fields=["scenario_name", "updated_at"])
        if account.scenario_locked:
            return
        lead = self._scenario_name(account.effective_group, account.debtor_category_id)
        if account.scenario_name != lead:
            self._log(account, StatusHistory.Kind.SCENARIO, account.scenario_name, lead)
            account.scenario_name = lead
            account.save(update_fields=["scenario_name", "updated_at"])

    def _funnel(self, account: Account) -> None:
        if account.funnel_locked:
            return
        stage = "closed" if account.effective_group is None else STAGE_BY_GROUP.get(account.effective_group, "new")
        if account.funnel_stage != stage:
            self._log(account, StatusHistory.Kind.FUNNEL, account.funnel_stage, stage)
            account.funnel_stage = stage
            account.save(update_fields=["funnel_stage", "updated_at"])

    def _payer(self, account: Account) -> None:
        main = account.registrations.filter(subj_is_main=True).order_by("id").first()
        identifier = ""
        unp = ""
        if main and main.personal_num:
            if main.subj_legal_entity:
                unp = main.personal_num
            else:
                identifier = main.personal_num
        fields = []
        if account.payer_identifier != identifier:
            account.payer_identifier = identifier
            fields.append("payer_identifier")
        if account.payer_unp != unp:
            account.payer_unp = unp
            fields.append("payer_unp")
        if fields:
            account.save(update_fields=[*fields, "updated_at"])

    def _contacts(self, account: Account) -> None:
        now = timezone.now()
        pairs: list[tuple[str, str, Registration | None]] = []
        if account.contact_phone:
            pairs.append((Contact.Kind.MOBILE, account.contact_phone, None))
        if account.phone and account.phone != account.contact_phone:
            pairs.append((Contact.Kind.CITY, account.phone, None))
        for person in account.registrations.all():
            if person.contact_phone:
                pairs.append((Contact.Kind.MOBILE, person.contact_phone, person))
            if person.email:
                pairs.append((Contact.Kind.EMAIL, person.email, person))
        for kind, value, person in pairs:
            contact, created = Contact.objects.get_or_create(
                account=account, kind=kind, value=value, source=Contact.Source.AIS,
                defaults={
                    "organization": account.organization, "registration": person, "ais_updated_at": now, "priority": 0,
                },
            )
            if not created:
                contact.ais_updated_at = now
                contact.registration = person
                contact.save(update_fields=["ais_updated_at", "registration", "updated_at"])

    def _history_balances(self, account: Account) -> None:
        from apps.debts.models import ServiceDebtPeriod

        for service in account.services.all():
            periods = list(ServiceDebtPeriod.objects.filter(service=service))
            kept = set()
            for period in periods:
                kept.add(period.period)
                row, created = BalanceHistory.objects.get_or_create(
                    service=service, period=period.period,
                    defaults={
                        "organization": account.organization, "account": account,
                        "principal": period.principal, "penalty": period.penalty,
                    },
                )
                if not created and (row.principal != period.principal or row.penalty != period.penalty):
                    row.principal = period.principal
                    row.penalty = period.penalty
                    row.save(update_fields=["principal", "penalty", "updated_at"])
            stale = BalanceHistory.objects.filter(service=service).exclude(period__in=kept or [date.min])
            stale.filter(Q(principal__gt=0) | Q(penalty__gt=0)).update(
                principal=Decimal("0"), penalty=Decimal("0"), updated_at=timezone.now(),
            )

    def _initial_sums(self, account: Account) -> None:
        for service in account.services.all():
            fields = []
            if service.initial_principal is None and service.balance_out is not None:
                service.initial_principal = service.balance_out
                fields.append("initial_principal")
            if service.initial_penalty is None and service.balance_mulct_out is not None:
                service.initial_penalty = service.balance_mulct_out
                fields.append("initial_penalty")
            if fields:
                service.save(update_fields=[*fields, "updated_at"])

    def _last_payment(self, account: Account) -> None:
        for service in account.services.all():
            last = Payment.objects.filter(account=account, service_id=service.service_id).aggregate(last=Max("pay_date"))["last"]
            if service.last_payment_date != last:
                service.last_payment_date = last
                service.save(update_fields=["last_payment_date", "updated_at"])

    def _inheritance(self, account: Account) -> None:
        if not account.inheritance_case:
            return
        main = account.registrations.filter(subj_is_main=True).order_by("-id").first()
        if main and account.inheritance_payer_id and main.subj_id != account.inheritance_payer_id:
            account.inheritance_case = False
            account.inheritance_until = None
            account.inheritance_payer_id = None
            account.save(update_fields=["inheritance_case", "inheritance_until", "inheritance_payer_id", "updated_at"])

    def _rating(self, account: Account) -> None:
        peers = self._peer_accounts(account)
        worst = max((item.effective_group or 0 for item in peers), default=0) or None
        aggravating = any(item.bankruptcy for item in peers) or Registration.objects.filter(
            account__in=peers, idler_val=True,
        ).exists()
        if worst is None:
            if account.rating != "A" or account.rating_repeat is not None:
                previous = self._rating_label(account)
                self._log(account, StatusHistory.Kind.RATING, previous, "A")
                account.rating = "A"
                account.rating_repeat = None
                account.save(update_fields=["rating", "rating_repeat", "updated_at"])
            return
        letter = rating_letter(worst, aggravating)
        if account.rating == letter and (letter == "E" or account.rating_repeat):
            return
        repeat = self._repeat(account, letter)
        label = letter if letter == "E" else f"{letter}/{repeat}"
        self._log(account, StatusHistory.Kind.RATING, self._rating_label(account), label)
        account.rating = letter
        account.rating_repeat = None if letter == "E" else repeat
        account.save(update_fields=["rating", "rating_repeat", "updated_at"])

    @staticmethod
    def _rating_label(account: Account) -> str:
        if not account.rating:
            return ""
        if account.rating == "E" or not account.rating_repeat:
            return account.rating
        return f"{account.rating}/{account.rating_repeat}"

    def _peer_accounts(self, account: Account) -> list[Account]:
        if not account.payer_identifier:
            return [account]
        return list(Account.objects.filter(organization=account.organization, payer_identifier=account.payer_identifier))

    def _repeat(self, account: Account, letter: str) -> int:
        since = timezone.now() - timedelta(days=30 * self.settings.rating_period_months)
        previous = StatusHistory.objects.filter(
            account=account, kind=StatusHistory.Kind.RATING, created_at__gte=since, new_value__startswith=f"{letter}/",
        ).count()
        if letter == "E":
            previous = StatusHistory.objects.filter(
                account=account, kind=StatusHistory.Kind.RATING, created_at__gte=since, new_value="E",
            ).count()
        return previous + 1

    def _close_paid(self, account: Account) -> None:
        threshold = self.settings.close_threshold or Decimal("0")
        active = [Measure.Status.ASSIGNED, Measure.Status.RUNNING]
        for service in account.services.all():
            balance = service.balance_out if service.balance_out is not None else Decimal("0")
            penalty = service.balance_mulct_out if service.balance_mulct_out is not None else Decimal("0")
            if balance > threshold or penalty > threshold:
                continue
            Measure.objects.filter(services=service, status__in=active).update(
                status=Measure.Status.CANCELLED, updated_at=timezone.now(),
            )
            if service.scenario_name or service.scenario_locked:
                service.scenario_name = ""
                service.scenario_locked = False
                service.save(update_fields=["scenario_name", "scenario_locked", "updated_at"])
        if account.effective_group is None:
            Measure.objects.filter(accounts=account, status__in=active).update(
                status=Measure.Status.CANCELLED, updated_at=timezone.now(),
            )
            if account.scenario_name or account.scenario_locked:
                self._log(account, StatusHistory.Kind.SCENARIO, account.scenario_name, "")
                account.scenario_name = ""
                account.scenario_locked = False
                account.save(update_fields=["scenario_name", "scenario_locked", "updated_at"])

    @staticmethod
    def _log(account, kind, old, new, service=None, reason=""):
        if (old or "") == (new or ""):
            return
        StatusHistory.objects.create(
            organization=account.organization, account=account, service=service, kind=kind,
            old_value=old or "", new_value=new or "", reason=reason,
        )


def sync_supplier_organizations(accounts) -> None:
    services = AccountService.objects.filter(account__in=accounts).exclude(provider_id=None)
    pairs = services.values_list("account__organization_id", "provider_id", "shot_name", "full_name").distinct()
    for organization_id, provider_id, short_name, full_name in pairs:
        ServiceOrganization.objects.get_or_create(
            organization_id=organization_id, provider_id=provider_id,
            defaults={"short_name": short_name or str(provider_id), "full_name": full_name or "", "is_supplier": True},
        )
