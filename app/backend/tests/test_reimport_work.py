"""Повторная выгрузка того же ЛС сама закрывает взыскание и дело."""

from datetime import date
from decimal import Decimal

import pytest

from apps.debts.models import ClaimCase, ClaimEvent, Measure, MeasureItem
from apps.debts.services.portfolio import PortfolioRefresher

from .conftest import make_account


def _case(account, stage=ClaimCase.Stage.NOTARY, tariff="48.00"):
    return ClaimCase.objects.create(
        organization=account.organization,
        account=account,
        stage=stage,
        warning_delivered_on=date(2026, 3, 1),
        notary_tariff=Decimal(tariff) if tariff is not None else None,
        defendant_name=account.short_fio,
    )


def _collection(account):
    service = account.services.get()
    measure = Measure.objects.create(
        organization=account.organization, kind=Measure.Kind.COLLECTION, status=Measure.Status.ASSIGNED,
    )
    measure.accounts.add(account)
    measure.services.add(service)
    MeasureItem.objects.create(
        organization=account.organization, measure=measure, account=account, status=MeasureItem.Status.ASSIGNED,
    )
    return measure


@pytest.mark.django_db
def test_reimport_of_paid_account_recovers_the_case_and_measure(org_a):
    account = make_account(org_a, 501, client_account="00000501")
    from apps.debts.models import AccountService

    AccountService.objects.create(
        organization=org_a, account=account, service_list_id=1, service_id=10,
        service_name="Техобслуживание", balance_out=Decimal("100"), balance_mulct_out=Decimal("20"), debt_period=8,
    )
    account.funnel_stage = "enforcement"
    account.funnel_locked = True
    account.save(update_fields=["funnel_stage", "funnel_locked"])
    case = _case(account)
    measure = _collection(account)

    service = account.services.get()
    service.balance_out = Decimal("0")
    service.balance_mulct_out = Decimal("0")
    service.debt_period = 0
    service.save(update_fields=["balance_out", "balance_mulct_out", "debt_period"])
    account.balance_out = Decimal("0")
    account.save(update_fields=["balance_out"])

    PortfolioRefresher().refresh_account(account)
    case.refresh_from_db()
    measure.refresh_from_db()
    account.refresh_from_db()

    assert case.ais_debt_cleared is True
    assert case.tariff_received is True
    assert case.stage == ClaimCase.Stage.RECOVERED
    assert measure.status == Measure.Status.DONE
    assert measure.items.get().status == MeasureItem.Status.DONE
    assert account.funnel_stage == "closed"
    assert account.funnel_locked is False

    events = ClaimEvent.objects.filter(case=case).count()
    PortfolioRefresher().refresh_account(account)
    assert ClaimEvent.objects.filter(case=case).count() == events


@pytest.mark.django_db
def test_reimport_without_tariff_does_not_mark_recovered(org_a):
    account = make_account(org_a, 502, client_account="00000502")
    from apps.debts.models import AccountService

    AccountService.objects.create(
        organization=org_a, account=account, service_list_id=1, service_id=10,
        service_name="Холодная вода", balance_out=Decimal("0"), debt_period=0,
    )
    case = _case(account, tariff=None)
    PortfolioRefresher().refresh_account(account)
    case.refresh_from_db()
    assert case.ais_debt_cleared is True
    assert case.tariff_received is False
    assert case.stage == ClaimCase.Stage.NOTARY


@pytest.mark.django_db
def test_reimport_does_not_skip_refusal_or_open_debt(org_a):
    refused = make_account(org_a, 503, client_account="00000503")
    open_debt = make_account(org_a, 504, client_account="00000504")
    from apps.debts.models import AccountService

    AccountService.objects.create(
        organization=org_a, account=refused, service_list_id=1, service_id=10,
        service_name="Газ", balance_out=Decimal("0"), debt_period=0,
    )
    AccountService.objects.create(
        organization=org_a, account=open_debt, service_list_id=2, service_id=11,
        service_name="Газ", balance_out=Decimal("40"), debt_period=5,
    )
    refusal = _case(refused, stage=ClaimCase.Stage.REFUSED)
    waiting = _case(open_debt)
    PortfolioRefresher().refresh_account(refused)
    PortfolioRefresher().refresh_account(open_debt)
    refusal.refresh_from_db()
    waiting.refresh_from_db()
    assert refusal.stage == ClaimCase.Stage.REFUSED
    assert waiting.stage == ClaimCase.Stage.NOTARY
    assert waiting.ais_debt_cleared is False
