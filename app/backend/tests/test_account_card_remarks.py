"""Замечания по карточке ЛС: УЕН, солидарные, вторая исполнительная надпись, фильтр реестра."""

import json
from datetime import date
from decimal import Decimal

import pytest

from apps.debts.models import AccountService, ClaimCase, Measure, MeasureItem, Registration, ServiceDebtPeriod
from apps.debts.services.card_sheet import debtor_role, is_solidary
from apps.debts.services.writ_draft import WritDraftError, create_writ
from apps.imports.parsing import convert
from tests.conftest import make_account


def test_scientific_integer_is_stored():
    assert convert("1,2E+11", "int") == 120_000_000_000
    assert convert("Принятие наследства", "heritage") == "accept"


@pytest.mark.django_db
def test_departed_person_is_not_solidary(org_a):
    account = make_account(org_a, 3101, debt_started_on=date(2024, 3, 1))
    left = Registration.objects.create(
        organization=org_a, account=account, registration_id=1, subj_id=1,
        fam="Ушёл", check_out_date=date(2024, 3, 1),
    )
    stayed = Registration.objects.create(
        organization=org_a, account=account, registration_id=2, subj_id=2,
        fam="Остался", check_out_date=date(2024, 6, 1),
    )
    assert debtor_role(left) == "Выбывший"
    assert is_solidary(left) is False
    assert debtor_role(stayed) == "Солидарный должник"


@pytest.mark.django_db
def test_second_writ_rejects_the_same_period(org_a, specialist_a):
    account = make_account(org_a, 3102, debt_group=3, operational_date=date(2026, 10, 15))
    service = AccountService.objects.create(
        organization=org_a, account=account, service_list_id=1, service_id=10, service_name="Газ",
    )
    for month in (3, 4, 5, 6, 7, 8):
        ServiceDebtPeriod.objects.create(
            organization=org_a, account=account, service=service,
            period=date(2026, month, 1), principal=Decimal("10"), penalty=Decimal("1"),
            due_on=date(2026, month, 25), started_on=date(2026, month, 1),
        )
    measure = Measure.objects.create(organization=org_a, kind=Measure.Kind.WARNING)
    MeasureItem.objects.create(
        organization=org_a, measure=measure, account=account, delivered_on=date(2026, 8, 1),
    )
    first = create_writ(account, specialist_a, {
        "debt_from": "2026-03-01", "debt_to": "2026-05-01",
        "warning_delivered_on": "2026-08-01", "notary_office": "Контора 1",
    })
    assert first.debt_from == date(2026, 3, 1)
    with pytest.raises(WritDraftError):
        create_writ(account, specialist_a, {
            "debt_from": "2026-03-01", "debt_to": "2026-05-01",
            "warning_delivered_on": "2026-08-01", "notary_office": "Контора 1",
        })
    second = create_writ(account, specialist_a, {
        "debt_from": "2026-06-01", "debt_to": "2026-08-01",
        "warning_delivered_on": "2026-08-01", "notary_office": "Контора 1",
    })
    assert ClaimCase.objects.filter(account=account).count() == 2
    assert second.debt_from == date(2026, 6, 1)


@pytest.mark.django_db
def test_registry_filters_by_payer_name(api, specialist_a, org_a):
    named = make_account(org_a, 3103, client_account="00003103")
    named.short_fio = "Сидоров П.П."
    named.save(update_fields=["short_fio"])
    make_account(org_a, 3104, client_account="00003104")
    response = api(specialist_a).get("/api/v1/accounts/", {
        "domain": json.dumps({"field": "short_fio", "op": "contains", "value": "Сидоров"}),
    })
    assert response.status_code == 200
    names = [row["short_fio"] for row in response.data["results"]]
    assert names == ["Сидоров П.П."]
