"""Глава 4: приостановка мероприятия, контакты поставщика и проверки надписи."""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.debts.models import AccountService, ClaimCase, DebtWorkItem, Measure, MeasureItem, ServiceDebtPeriod, StatusHistory
from apps.debts.services.autocall import dial_due_calls
from apps.debts.services.extra_measures import ExtraMeasureError, hold_measure, release_expired_holds
from apps.notifications.models import Channel, Notification
from apps.users.models import ServiceOrganization, User

from .conftest import make_account


@pytest.mark.django_db
def test_hold_rejects_past_date(admin_a, account_a):
    measure = Measure.objects.create(
        organization=account_a.organization,
        kind=Measure.Kind.WARNING,
        status=Measure.Status.ASSIGNED,
        template_name="Предупреждение",
        created_by=admin_a,
    )
    measure.accounts.add(account_a)
    yesterday = timezone.localdate() - timedelta(days=1)
    with pytest.raises(ExtraMeasureError) as err:
        hold_measure(measure, admin_a, yesterday.isoformat(), "тест")
    assert "раньше сегодняшней" in str(err.value.detail)


@pytest.mark.django_db
def test_hold_indefinite_and_auto_resume_notification(admin_a, account_a, org_a):
    spec = User.objects.create_user(
        username="hold_spec", password="x", role=User.Role.SPECIALIST, organization=org_a,
    )
    account_a.assigned_to = spec
    account_a.save(update_fields=["assigned_to"])

    forever = Measure.objects.create(
        organization=org_a,
        kind=Measure.Kind.WARNING,
        status=Measure.Status.ASSIGNED,
        template_name="Предупреждение",
        created_by=admin_a,
    )
    forever.accounts.add(account_a)
    hold_measure(forever, admin_a, "", "навсегда", indefinite=True)
    forever.refresh_from_db()
    assert forever.status == Measure.Status.PAUSED
    assert forever.pause_until is None
    assert forever.pause_reason == "навсегда"

    timed = Measure.objects.create(
        organization=org_a,
        kind=Measure.Kind.CALL,
        status=Measure.Status.PAUSED,
        stopped=True,
        pause_until=timezone.localdate() - timedelta(days=1),
        pause_reason="Отсрочка",
    )
    timed.accounts.add(account_a)
    release_expired_holds(account_a)
    timed.refresh_from_db()
    forever.refresh_from_db()
    assert timed.status == Measure.Status.ASSIGNED
    assert timed.stopped is False
    assert forever.status == Measure.Status.PAUSED
    assert Notification.objects.filter(
        recipient_user=spec, channel=Channel.INBOX, body__icontains="срок приостановки истёк",
    ).exists()


@pytest.mark.django_db
def test_contact_visibility_and_writ_gates(api, org_a, specialist_a, admin_a):
    account = make_account(org_a, 4901, client_account="00004901", contact_phone="+375291000001", debt_group=2)
    AccountService.objects.create(
        organization=org_a, account=account, service_list_id=91, service_id=10,
        service_name="Вода", provider_id=777, balance_out=Decimal("50"), debt_period=3, debt_group=2,
    )
    so, _ = ServiceOrganization.objects.get_or_create(
        organization=org_a, provider_id=777, defaults={"short_name": "Водоканал", "is_supplier": True},
    )
    supplier = User.objects.create_user(
        username="sup_777", password="x", role=User.Role.SPECIALIST, contour=User.Contour.SUPPLIER, organization=org_a,
    )
    supplier.service_organizations.add(so)

    ais_list = api(supplier).get(f"/api/v1/accounts/{account.id}/contacts/").json()["results"]
    assert any(row["source"] == "ais" and row["value"] == "+375291000001" for row in ais_list)

    api(specialist_a).post(
        "/api/v1/contacts/",
        {"account": account.id, "kind": "mobile", "value": "+375292222222"},
        format="json",
    )
    api(supplier).post(
        "/api/v1/contacts/",
        {"account": account.id, "kind": "mobile", "value": "+375293333333"},
        format="json",
    )
    sup_values = {row["value"] for row in api(supplier).get(f"/api/v1/accounts/{account.id}/contacts/").json()["results"]}
    spec_values = {row["value"] for row in api(specialist_a).get(f"/api/v1/accounts/{account.id}/contacts/").json()["results"]}
    admin_values = {row["value"] for row in api(admin_a).get(f"/api/v1/accounts/{account.id}/contacts/").json()["results"]}
    assert "+375293333333" in sup_values and "+375292222222" not in sup_values
    assert "+375292222222" in spec_values and "+375293333333" not in spec_values
    assert {"+375292222222", "+375293333333"} <= admin_values

    account.operational_date = date(2026, 10, 15)
    account.save(update_fields=["operational_date"])
    service = account.services.first()
    for month in (5, 6, 7):
        ServiceDebtPeriod.objects.create(
            organization=org_a, account=account, service=service,
            period=date(2026, month, 1), principal=Decimal("20"), penalty=Decimal("1"),
            due_on=date(2026, month, 25), started_on=date(2026, month, 1),
        )
    warn = Measure.objects.create(organization=org_a, kind=Measure.Kind.WARNING)
    MeasureItem.objects.create(organization=org_a, measure=warn, account=account, delivered_on=date(2026, 8, 1))

    blocked_ais = api(specialist_a).post(
        f"/api/v1/accounts/{account.id}/writ-draft/",
        {"debt_from": "2026-05-01", "debt_to": "2026-07-01", "warning_delivered_on": "2026-08-01", "notary_office": "К1"},
        format="json",
    )
    assert blocked_ais.status_code == 400
    assert "Создайте исполнительную надпись в АИС" in blocked_ais.content.decode("utf-8")

    DebtWorkItem.objects.create(organization=org_a, account=account, kind=DebtWorkItem.Kind.WRIT, title="ИН из АИС")
    still = api(specialist_a).post(
        f"/api/v1/accounts/{account.id}/writ-draft/",
        {"debt_from": "2026-05-01", "debt_to": "2026-07-01", "warning_delivered_on": "2026-08-01", "notary_office": "К1"},
        format="json",
    )
    assert still.status_code == 400
    assert "Создайте исполнительную надпись в АИС" in still.content.decode("utf-8")

    created = api(supplier).post(
        f"/api/v1/accounts/{account.id}/writ-draft/",
        {"debt_from": "2026-05-01", "debt_to": "2026-07-01", "warning_delivered_on": "2026-08-01", "notary_office": "К1"},
        format="json",
    )
    assert created.status_code == 201, created.content


@pytest.mark.django_db
def test_status_history_shows_registry_name(api, specialist_a, account_a):
    specialist_a.last_name = "Соколова"
    specialist_a.save(update_fields=["last_name"])
    StatusHistory.objects.create(
        organization=account_a.organization, account=account_a, kind=StatusHistory.Kind.CATEGORY,
        old_value="", new_value="1", reason="Категория должника", author=specialist_a,
    )
    response = api(specialist_a).get(f"/api/v1/accounts/{account_a.id}/status-history/")
    assert response.status_code == 200, response.content
    names = [row["author_name"] for row in response.json()["results"]]
    assert "Соколова Анна Петровна" in names


@pytest.mark.django_db
def test_zero_debt_leaves_claims_without_notary_documents(api, specialist_a, admin_a, org_a):
    bare = make_account(org_a, 4801, client_account="00004801", months_debt=0, funnel_stage="prep")
    ClaimCase.objects.create(organization=org_a, account=bare, stage=ClaimCase.Stage.PREP)
    kept = make_account(org_a, 4802, client_account="00004802", months_debt=0, funnel_stage="notary")
    ClaimCase.objects.create(
        organization=org_a, account=kept, stage=ClaimCase.Stage.NOTARY, notary_tariff=Decimal("10"),
    )
    manual = make_account(org_a, 4803, client_account="00004803", months_debt=4, debt_group=3, funnel_stage="prep")
    opened = ClaimCase.objects.create(organization=org_a, account=manual, stage=ClaimCase.Stage.PREP)
    party = Measure.objects.create(
        organization=org_a, kind=Measure.Kind.COLLECTION, status=Measure.Status.ASSIGNED,
    )
    party.accounts.add(manual)

    listed = api(specialist_a).get("/api/v1/accounts/", {"scope": "claims", "page_size": 50})
    assert listed.status_code == 200, listed.content
    ids = {row["id"] for row in listed.json()["results"]}
    assert bare.id not in ids
    assert kept.id in ids
    assert manual.id in ids

    patched = api(admin_a).patch(
        f"/api/v1/accounts/{manual.id}/",
        {"debt_group_manual": 0, "debt_group_manual_reason": "долга нет"},
        format="json",
    )
    assert patched.status_code == 200, patched.content
    assert not ClaimCase.objects.filter(pk=opened.pk).exists()
    party.refresh_from_db()
    assert party.status == Measure.Status.CANCELLED
    manual.refresh_from_db()
    assert manual.funnel_stage == "new"
    again = {row["id"] for row in api(specialist_a).get("/api/v1/accounts/", {"scope": "claims", "page_size": 50}).json()["results"]}
    assert manual.id not in again
    assert kept.id in again


@pytest.mark.django_db
def test_expired_pause_resumes_from_dial_without_account_refresh(admin_a, org_a):
    account = make_account(org_a, 4810, client_account="00004810")
    account.assigned_to = admin_a
    account.save(update_fields=["assigned_to"])
    paused = Measure.objects.create(
        organization=org_a, kind=Measure.Kind.WARNING, status=Measure.Status.PAUSED, stopped=True,
        template_name="Предупреждение", pause_until=timezone.localdate() - timedelta(days=1), pause_reason="Отсрочка",
    )
    paused.accounts.add(account)
    dial_due_calls()
    paused.refresh_from_db()
    assert paused.status == Measure.Status.ASSIGNED
    assert paused.pause_until is None
    assert Notification.objects.filter(
        account=account, channel=Channel.INBOX, body__icontains="срок приостановки истёк",
    ).exists()
