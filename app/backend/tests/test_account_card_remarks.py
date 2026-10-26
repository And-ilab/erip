"""Замечания по карточке ЛС: УЕН, солидарные, вторая исполнительная надпись, фильтр реестра."""

import json
from datetime import date
from decimal import Decimal

import pytest

from apps.debts.models import AccountService, ClaimCase, Measure, MeasureItem, Payment, Registration, ServiceDebtPeriod
from apps.debts.services.card_sheet import debtor_role, is_solidary
from apps.debts.services.writ_draft import WritDraftError, create_writ, writ_preview
from apps.imports.parsing import convert
from apps.users.models import User
from tests.conftest import make_account, make_user


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


def _periods(org, account, service):
    for month in (3, 4, 5, 6, 7, 8):
        ServiceDebtPeriod.objects.create(
            organization=org, account=account, service=service,
            period=date(2026, month, 1), principal=Decimal("10"), penalty=Decimal("1"),
            due_on=date(2026, month, 25), started_on=date(2026, month, 1),
        )


@pytest.mark.django_db
def test_writ_does_not_need_group_three_and_window_is_recalculated(org_a, specialist_a):
    account = make_account(org_a, 3113, debt_group=1, operational_date=date(2026, 10, 15))
    service = AccountService.objects.create(
        organization=org_a, account=account, service_list_id=1, service_id=10, service_name="Газ",
    )
    _periods(org_a, account, service)
    measure = Measure.objects.create(organization=org_a, kind=Measure.Kind.WARNING)
    MeasureItem.objects.create(
        organization=org_a, measure=measure, account=account, delivered_on=date(2026, 8, 1),
    )
    case = create_writ(account, specialist_a, {
        "debt_from": "2026-03-01", "debt_to": "2026-05-01",
        "warning_delivered_on": "2026-08-01", "notary_office": "Контора 1",
    })
    assert case.account_id == account.id
    preview = writ_preview(account, {
        "debt_from": "2026-06-01", "debt_to": "2026-08-01",
        "warning_delivered_on": "2026-08-01", "non_delivery_act_on": "",
    })
    assert preview["principal"] == "30.00"
    assert preview["penalty"] == "3.00"
    assert preview["blockers"] == []
    assert "Контора 1" in preview["offices"]


@pytest.mark.django_db
def test_refused_warning_fills_the_act_date(org_a):
    account = make_account(org_a, 3114, operational_date=date(2026, 10, 15))
    measure = Measure.objects.create(organization=org_a, kind=Measure.Kind.WARNING)
    MeasureItem.objects.create(
        organization=org_a, measure=measure, account=account,
        delivered_on=date(2026, 8, 2), refused=True,
    )
    preview = writ_preview(account)
    assert preview["warning_delivered_on"] is None
    assert preview["non_delivery_act_on"] == "2026-08-02"


@pytest.mark.django_db
def test_card_columns_belong_to_the_user(api, specialist_a, org_a):
    other = make_user("spec_columns", User.Role.SPECIALIST, org_a)
    first = api(specialist_a).get("/api/v1/accounts/card-columns/", {"board": "services"})
    assert first.status_code == 200
    body = first.json()
    assert body["columns"][:3] == ["service_list_id", "service_id", "service_name"]
    assert "months_debt" not in body["columns"]
    assert body["order"][-3:] == ["months_debt", "supplier", "debt_group"]
    saved = api(specialist_a).put(
        "/api/v1/accounts/card-columns/?board=services",
        {"board": "services", "columns": ["service_name"], "order": body["order"]},
        format="json",
    )
    assert saved.status_code == 200
    assert saved.json()["columns"] == ["service_name"]
    untouched = api(other).get("/api/v1/accounts/card-columns/", {"board": "services"}).json()
    assert untouched["columns"][0] == "service_list_id"
    assert "tarrif" in untouched["columns"]
    again = api(specialist_a).get("/api/v1/accounts/card-columns/", {"board": "services"}).json()
    assert again["columns"] == ["service_name"]


@pytest.mark.django_db
def test_board_widths_belong_to_the_user(api, specialist_a, org_a):
    other = make_user("spec_widths", User.Role.SPECIALIST, org_a)
    watcher = make_user("watch_widths", User.Role.OBSERVER, org_a)
    saved = api(specialist_a).put(
        "/api/v1/board-widths/accounts/",
        {"widths": {"client_account": 180, "short_fio": 90, "bad name": 10, "select": True}},
        format="json",
    )
    assert saved.status_code == 200
    assert saved.json()["widths"] == {"client_account": 180, "short_fio": 90}
    own = api(specialist_a).get("/api/v1/board-widths/accounts/").json()
    assert own["widths"]["client_account"] == 180
    assert api(other).get("/api/v1/board-widths/accounts/").json()["widths"] == {}
    watched = api(watcher).put(
        "/api/v1/board-widths/claims/",
        {"widths": {"debtor": 240}},
        format="json",
    )
    assert watched.status_code == 200
    assert api(specialist_a).get("/api/v1/board-widths/claims/").json()["widths"] == {}
    assert api(watcher).get("/api/v1/board-widths/claims/").json()["widths"] == {"debtor": 240}
    layout = api(specialist_a).get("/api/v1/accounts/columns/")
    assert layout.status_code == 200
    order = layout.json()["order"]
    one = order[0]
    narrow = api(specialist_a).put(
        "/api/v1/accounts/columns/",
        {"columns": [one], "order": order},
        format="json",
    )
    assert narrow.status_code == 200, narrow.content
    assert api(specialist_a).get("/api/v1/board-widths/accounts/").json()["widths"]["client_account"] == 180
    assert api(specialist_a).get("/api/v1/accounts/columns/").json()["columns"] == [one]
    assert api(specialist_a).put("/api/v1/board-widths/unknown/", {"widths": {}}, format="json").status_code == 400
    card = api(specialist_a).put(
        "/api/v1/board-widths/account-registrations/",
        {"widths": {"payer": 160}},
        format="json",
    )
    assert card.status_code == 200
    assert card.json()["widths"]["payer"] == 160


@pytest.mark.django_db
def test_registry_filters_contract_columns(api, specialist_a, org_a):
    hit = make_account(org_a, 3111, client_account="00003111")
    miss = make_account(org_a, 3112, client_account="00003112")
    service = AccountService.objects.create(
        organization=org_a, account=hit, service_list_id=1, service_id=10, service_name="Газ",
        start_date=date(2019, 12, 1), initial_principal=Decimal("15.50"), initial_penalty=Decimal("1.25"),
        repayment_due_on=date(2026, 5, 20),
    )
    AccountService.objects.create(
        organization=org_a, account=miss, service_list_id=2, service_id=10, service_name="Вода",
        start_date=date(2024, 1, 1),
    )
    ServiceDebtPeriod.objects.create(
        organization=org_a, account=hit, service=service, period=date(2026, 3, 1),
        principal=Decimal("4"), penalty=Decimal("1"), due_on=date(2026, 3, 25), started_on=date(2026, 3, 26),
    )

    def accounts(field, value):
        response = api(specialist_a).get("/api/v1/accounts/", {
            "domain": json.dumps({"field": field, "op": "eq", "value": value}),
        })
        assert response.status_code == 200, response.content
        return [row["client_account"] for row in response.data["results"]]

    assert accounts("contract_date", "2019-12-01") == ["00003111"]
    assert accounts("initial_principal", "15.50") == ["00003111"]
    assert accounts("initial_penalty", "1.25") == ["00003111"]
    assert accounts("period_balances", "2026-03-01") == ["00003111"]
    assert accounts("repayment_due_on", "2026-05-20") == ["00003111"]


@pytest.mark.django_db
def test_receipt_pay_uses_the_operational_period(api, specialist_a, org_a):
    account = make_account(org_a, 3110, operational_date=date(2026, 10, 1))
    Payment.objects.create(
        organization=org_a, account=account, receipt_id=1, acc_oper_date=date(2026, 10, 1),
        pay_service_summ=Decimal("5"), pay_mulct_summ=Decimal("1"),
    )
    Payment.objects.create(
        organization=org_a, account=account, receipt_id=2, acc_oper_date=date(2026, 9, 1),
        pay_service_summ=Decimal("100"),
    )
    body = api(specialist_a).get(f"/api/v1/accounts/{account.id}/").json()
    assert body["receipt_pay"] == "6.00"
    assert body["info_param_id1"] is None
    assert body["acc_category_id"] is None
    assert body["housing_category_code"] is None
    assert body["ownership_type_code"] is None
