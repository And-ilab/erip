"""Уведомление по e-mail: отправитель схемы, ошибка в частной строке, повтор без второго письма."""

import pytest

from apps.debts.models import MeasureItem
from apps.notifications.models import MessageTemplate, Notification

pytestmark = pytest.mark.django_db


def _notice(api, admin_a, account_a, name="Письмо"):
    created = api(admin_a).post(
        "/api/v1/measures/",
        {"kind": "notice", "account_ids": [account_a.id], "template_name": name, "channel": "email"},
        format="json",
    )
    assert created.status_code == 201, created.content
    return created.json()["id"]


def test_scheme_mail_is_saved_and_a_bad_address_is_rejected(api, admin_a, specialist_a):
    denied = api(specialist_a).get("/api/v1/nsi/scenarios/mail/")
    assert denied.status_code == 403
    bad = api(admin_a).patch("/api/v1/nsi/scenarios/mail/", {"mail_from": "не адрес"}, format="json")
    assert bad.status_code == 400
    saved = api(admin_a).patch(
        "/api/v1/nsi/scenarios/mail/",
        {
            "mail_from": "debt@zhes.by",
            "mail_from_name": "ЖЭС",
            "mail_subject": "Долг ЖЭС",
            "mail_signature": "С уважением, ЖЭС №1",
        },
        format="json",
    )
    assert saved.status_code == 200, saved.content
    assert saved.json()["mail_from"] == "debt@zhes.by"
    assert saved.json()["mail_signature"] == "С уважением, ЖЭС №1"


def test_notice_uses_scheme_sender_and_account_amount(api, admin_a, account_a, org_a, fake_gateway):
    org_a.mail_from = "debt@zhes.by"
    org_a.mail_from_name = "ЖЭС"
    org_a.mail_subject = "Долг ЖЭС"
    org_a.mail_signature = "С уважением, ЖЭС №1"
    org_a.save()
    MessageTemplate.objects.create(
        organization=org_a, code="letter", name="Письмо", channel="email",
        subject="", body="Долг {amount} по ЛС {account}",
    )
    measure_id = _notice(api, admin_a, account_a)
    sent = api(admin_a).post(f"/api/v1/measures/{measure_id}/send/", {}, format="json")
    assert sent.status_code == 200, sent.content
    payload = fake_gateway.sent[0]
    assert payload["subject"] == "Долг ЖЭС"
    assert payload["template_body"] == "Долг {amount} по ЛС {account}"
    assert payload["context"]["amount"] == "150.00"
    assert payload["context"]["account"] == "00001001"
    assert payload["meta"]["mail_from"] == "debt@zhes.by"
    assert payload["meta"]["signature"] == "С уважением, ЖЭС №1"
    assert payload["meta"]["fail"] is False
    again = api(admin_a).post(f"/api/v1/measures/{measure_id}/send/", {}, format="json")
    assert again.status_code == 200, again.content
    assert len(fake_gateway.sent) == 1
    assert Notification.objects.filter(account=account_a, channel="email").count() == 1


def test_template_subject_wins_over_the_scheme(api, admin_a, account_a, org_a, fake_gateway):
    org_a.mail_subject = "Долг ЖЭС"
    org_a.save(update_fields=["mail_subject"])
    MessageTemplate.objects.create(
        organization=org_a, code="letter-subject", name="Письмо с темой", channel="email",
        subject="Из шаблона", body="Текст",
    )
    measure_id = _notice(api, admin_a, account_a, "Письмо с темой")
    sent = api(admin_a).post(f"/api/v1/measures/{measure_id}/send/", {}, format="json")
    assert sent.status_code == 200, sent.content
    assert fake_gateway.sent[0]["subject"] == "Из шаблона"


def test_delivery_error_fails_the_row_and_read_is_not_tracked(
    api, client, admin_a, specialist_a, account_a, fake_gateway, internal_headers,
):
    measure_id = _notice(api, admin_a, account_a)
    api(admin_a).post(f"/api/v1/measures/{measure_id}/send/", {}, format="json")
    item = MeasureItem.objects.get(measure_id=measure_id)
    failed = client.post(
        f"/api/v1/notifications/{item.notification_id}/delivery-status/",
        {"status": "failed", "error": "550 User unknown", "external_call": True, "provider_message_id": "smtp-abc"},
        content_type="application/json", **internal_headers,
    )
    assert failed.status_code == 200, failed.content
    item.refresh_from_db()
    assert item.status == MeasureItem.Status.FAILED
    assert item.delivery_error == "550 User unknown"
    assert item.external_call is True
    assert item.provider_message_id == "smtp-abc"
    notice = Notification.objects.get(pk=item.notification_id)
    assert notice.is_read is False
    blocked = api(specialist_a).post(f"/api/v1/notifications/{notice.id}/mark-read/")
    assert blocked.status_code == 400


def test_stub_delivery_says_the_letter_was_not_sent(
    api, client, admin_a, account_a, fake_gateway, internal_headers,
):
    measure_id = _notice(api, admin_a, account_a)
    api(admin_a).post(f"/api/v1/measures/{measure_id}/send/", {}, format="json")
    item = MeasureItem.objects.get(measure_id=measure_id)
    delivered = client.post(
        f"/api/v1/notifications/{item.notification_id}/delivery-status/",
        {
            "status": "delivered", "external_call": False, "provider_message_id": "email-abc",
            "rendered_text": "Добрый день",
        },
        content_type="application/json", **internal_headers,
    )
    assert delivered.status_code == 200, delivered.content
    detail = api(admin_a).get(f"/api/v1/measures/{measure_id}/")
    row = detail.json()["items"][0]
    assert row["status"] == "done"
    assert row["external_call"] is False
    assert row["provider_message_id"] == "email-abc"
    assert any("Письмо не отправлялось" in event["reason"] for event in detail.json()["events"])
    assert Notification.objects.get(pk=item.notification_id).is_read is False


def test_gateway_outage_fails_the_notice_row(api, admin_a, account_a, fake_gateway):
    measure_id = _notice(api, admin_a, account_a)
    fake_gateway.fail = True
    sent = api(admin_a).post(f"/api/v1/measures/{measure_id}/send/", {}, format="json")
    assert sent.status_code == 200, sent.content
    item = MeasureItem.objects.get(measure_id=measure_id)
    assert item.status == MeasureItem.Status.FAILED
    assert item.delivery_error
