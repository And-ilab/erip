"""Глава 4: приостановка мероприятия, контакты поставщика и проверки надписи."""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.debts.models import AccountService, DebtWorkItem, Measure, MeasureItem, ServiceDebtPeriod
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
    created = api(specialist_a).post(
        f"/api/v1/accounts/{account.id}/writ-draft/",
        {"debt_from": "2026-05-01", "debt_to": "2026-07-01", "warning_delivered_on": "2026-08-01", "notary_office": "К1"},
        format="json",
    )
    assert created.status_code == 201, created.content
