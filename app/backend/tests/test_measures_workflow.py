"""Мероприятия 4.2.3: отбор, частный статус, вручение, отключение и отмена."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.debts.models import AccountService, Measure, MeasureItem
from apps.notifications.models import Notification
from apps.nsi.models import CalculationSettings
from apps.users.models import User

from .conftest import make_account, make_user


def _warning(api, user, account, delivered_on):
    created = api(user).post(
        "/api/v1/measures/",
        {"kind": "warning", "account_ids": [account.id], "template_name": "Предупреждение"},
        format="json",
    )
    assert created.status_code == 201, created.content
    delivered = api(user).post(
        f"/api/v1/measures/{created.json()['id']}/deliver/",
        {
            "delivery_method": "personal",
            "delivered_on": delivered_on,
            "recipient_name": "Иванов Иван",
        },
        format="json",
    )
    assert delivered.status_code == 200, delivered.content
    return created.json()["id"]


def test_phone_without_prefix_gets_375():
    from apps.debts.services.measures import belarus_phone

    assert belarus_phone("1111111") == "+3751111111"
    assert belarus_phone("+375291112233") == "+375291112233"
    assert belarus_phone("375291112233") == "+375291112233"
    assert belarus_phone("80291112233") == "+375291112233"
    assert belarus_phone("+491511234567") == ""
    assert belarus_phone("") == ""


@pytest.mark.django_db
def test_call_keeps_only_accounts_with_belarus_phone(api, specialist_a, account_a, org_a):
    legal = make_account(org_a, 3001, client_account="00003001", payer_unp="100000001")
    legal.payer_identifier = ""
    legal.debt_group = 1
    legal.save(update_fields=["payer_identifier", "debt_group"])
    foreign = make_account(org_a, 3002, client_account="00003002", contact_phone="+491511234567")
    foreign.debt_group = 1
    foreign.save(update_fields=["debt_group"])
    account_a.debt_group = 1
    account_a.save(update_fields=["debt_group"])
    created = api(specialist_a).post(
        "/api/v1/measures/",
        {
            "kind": "call",
            "account_ids": [account_a.id, legal.id, foreign.id],
            "template_name": "Напоминание",
            "time_from": "18:00",
            "time_to": "21:00",
            "group_from": 1,
            "group_to": 3,
            "call_legal": False,
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    body = created.json()
    reasons = {row["client_account"]: row["reason"] for row in body["skipped"]}
    assert reasons["00003001"].startswith("Юридическое лицо")
    assert "Нет номера" in reasons["00003002"]
    assert body["accounts_count"] == 1
    item = MeasureItem.objects.get(measure_id=body["id"])
    assert item.phone.startswith("+375")
    assert item.status == MeasureItem.Status.ASSIGNED
    result = api(specialist_a).post(
        f"/api/v1/measures/{body['id']}/result/",
        {"item_id": item.id, "call_result": "answered", "duration_sec": 40, "listen_percent": 80},
        format="json",
    )
    assert result.status_code == 200, result.content
    item.refresh_from_db()
    assert item.status == MeasureItem.Status.DONE
    assert Measure.objects.get(pk=body["id"]).status == Measure.Status.DONE


@pytest.mark.django_db
def test_notice_requires_email_and_rejects_messenger(api, specialist_a, account_a, org_a):
    silent = make_account(org_a, 3003, client_account="00003003", contact_phone="")
    missing = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "notice", "account_ids": [silent.id], "template_name": "Письмо", "channel": "email"},
        format="json",
    )
    assert missing.status_code == 400
    messenger = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "notice", "account_ids": [account_a.id], "template_name": "Письмо", "channel": "messenger"},
        format="json",
    )
    assert messenger.status_code == 400
    created = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "notice", "account_ids": [account_a.id], "template_name": "Письмо", "channel": "email"},
        format="json",
    )
    assert created.status_code == 201, created.content
    assert created.json()["items"][0]["recipient"] == "ivan@example.com"


@pytest.mark.django_db
def test_warning_delivery_starts_the_payment_clock(api, specialist_a, account_a):
    today = timezone.localdate()
    measure_id = _warning(api, specialist_a, account_a, today.isoformat())
    account_a.refresh_from_db()
    assert account_a.warning_due == today + timedelta(days=5)
    detail = api(specialist_a).get(f"/api/v1/measures/{measure_id}/")
    assert detail.json()["items"][0]["status"] == "done"
    assert account_a.work_items.filter(kind="warning").exists()


@pytest.mark.django_db
def test_disconnect_waits_for_warning_then_can_be_cancelled(api, specialist_a, account_a):
    service = account_a.services.get()
    early = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "disconnect", "account_ids": [account_a.id], "service_ids": [service.id]},
        format="json",
    )
    assert early.status_code == 400
    today = timezone.localdate()
    _warning(api, specialist_a, account_a, today.isoformat())
    soon = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "disconnect", "account_ids": [account_a.id], "service_ids": [service.id]},
        format="json",
    )
    assert soon.status_code == 400
    MeasureItem.objects.filter(account=account_a, measure__kind=Measure.Kind.WARNING).update(
        delivered_on=today - timedelta(days=6),
    )
    ready = api(specialist_a).get("/api/v1/measures/ready-to-disconnect/")
    assert len(ready.json()["results"]) == 1
    created = api(specialist_a).post(
        "/api/v1/measures/",
        {"kind": "disconnect", "account_ids": [account_a.id], "service_ids": [service.id]},
        format="json",
    )
    assert created.status_code == 201, created.content
    ready_after = api(specialist_a).get("/api/v1/measures/ready-to-disconnect/")
    assert ready_after.json()["results"] == []
    cancelled = api(specialist_a).post(
        f"/api/v1/measures/{created.json()['id']}/cancel/",
        {"reason": "Должник оплатил до выезда"},
        format="json",
    )
    assert cancelled.status_code == 200, cancelled.content
    assert cancelled.json()["status"] == "cancelled"
    suspended = api(specialist_a).post(
        "/api/v1/measures/",
        {
            "kind": "disconnect", "account_ids": [account_a.id], "service_ids": [service.id],
            "override_reason": "Повтор после отмены",
        },
        format="json",
    )
    assert suspended.status_code == 201
    confirmed = api(specialist_a).post(
        f"/api/v1/measures/{suspended.json()['id']}/confirm/",
        {"action": "suspend", "source": "pm"},
        format="json",
    )
    assert confirmed.status_code == 200, confirmed.content
    blocked = api(specialist_a).post(
        f"/api/v1/measures/{suspended.json()['id']}/cancel/",
        {"reason": "Поздно"},
        format="json",
    )
    assert blocked.status_code == 400


@pytest.mark.django_db
def test_paid_suspension_asks_to_resume(api, specialist_a, account_a):
    service = account_a.services.get()
    created = api(specialist_a).post(
        "/api/v1/measures/",
        {
            "kind": "disconnect", "account_ids": [account_a.id], "service_ids": [service.id],
            "override_reason": "Уже отключено",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    api(specialist_a).post(
        f"/api/v1/measures/{created.json()['id']}/confirm/",
        {"action": "suspend", "source": "pm"},
        format="json",
    )
    service.balance_out = Decimal("0")
    service.balance_mulct_out = Decimal("0")
    service.save(update_fields=["balance_out", "balance_mulct_out"])
    from apps.debts.services.portfolio import PortfolioRefresher

    PortfolioRefresher().refresh_account(account_a)
    measure = Measure.objects.get(pk=created.json()["id"])
    assert measure.status == Measure.Status.RUNNING
    assert Notification.objects.filter(account=account_a, body__startswith=f"Проверить возобновление #{measure.id}").exists()


@pytest.mark.django_db
def test_approval_blocks_supplier_until_admin_agrees(api, specialist_a, admin_a, org_a, account_a):
    CalculationSettings.load()
    CalculationSettings.objects.filter(pk=1).update(disconnect_requires_approval=True)
    service = account_a.services.get()
    service.provider_id = 9201
    service.save(update_fields=["provider_id"])
    from apps.users.models import ServiceOrganization

    house = ServiceOrganization.objects.create(organization=org_a, provider_id=9201, short_name="Водоканал", is_supplier=True)
    supplier = make_user("sup", User.Role.SPECIALIST, org_a, contour=User.Contour.SUPPLIER)
    supplier.service_organizations.add(house)
    created = api(specialist_a).post(
        "/api/v1/measures/",
        {
            "kind": "disconnect", "account_ids": [account_a.id], "service_ids": [service.id],
            "override_reason": "Согласовать",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    assert created.json()["approval"] == "pending"
    denied = api(supplier).post(f"/api/v1/measures/{created.json()['id']}/accept/")
    assert denied.status_code == 400
    agreed = api(admin_a).post(f"/api/v1/measures/{created.json()['id']}/approve/", {"note": "Можно"}, format="json")
    assert agreed.status_code == 200, agreed.content
    billing = api(specialist_a).post(f"/api/v1/measures/{created.json()['id']}/accept/")
    assert billing.status_code == 400
    accepted = api(supplier).post(f"/api/v1/measures/{created.json()['id']}/accept/")
    assert accepted.status_code == 200, accepted.content
    account_a.refresh_from_db()
    assert account_a.funnel_stage == "disconnect"


@pytest.mark.django_db
def test_unpaid_service_that_cannot_be_disconnected_is_rejected(api, specialist_a, account_a):
    service = account_a.services.get()
    service.service_name = "Содержание жилья"
    service.save(update_fields=["service_name"])
    response = api(specialist_a).post(
        "/api/v1/measures/",
        {
            "kind": "disconnect", "account_ids": [account_a.id], "service_ids": [service.id],
            "override_reason": "Не та услуга",
        },
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_disconnect_skips_the_younger_service(api, specialist_a, account_a):
    gas = account_a.services.get()
    water = AccountService.objects.create(
        organization=account_a.organization, account=account_a, service_list_id=2, service_id=11,
        service_name="Вода", balance_out=Decimal("20"), debt_period=1,
    )
    today = timezone.localdate()
    _warning(api, specialist_a, account_a, (today - timedelta(days=6)).isoformat())
    created = api(specialist_a).post(
        "/api/v1/measures/",
        {
            "kind": "disconnect",
            "account_ids": [account_a.id],
            "service_ids": [gas.id, water.id],
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    assert created.json()["service_ids"] == [gas.id]
    assert created.json()["dropped_services"][0]["id"] == water.id
