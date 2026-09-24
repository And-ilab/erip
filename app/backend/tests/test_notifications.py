"""Критерии 3–4 на стороне Django: отправка в шлюз, callback статуса, ошибка → failed + ErrorLog."""

import httpx
import pytest

from apps.audit.models import ErrorLog
from apps.notifications.models import MessageTemplate, Notification
from apps.notifications.services.dispatcher import NotificationDispatcher
from apps.notifications.services.gateway_client import HttpGatewayClient

pytestmark = pytest.mark.django_db


@pytest.fixture
def template(org_a):
    return MessageTemplate.objects.create(
        organization=None, code="debt-reminder", name="Напоминание о долге", channel="email",
        subject="Задолженность", body="Задолженность по ЛС {account} составляет {amount} руб.",
    )


def test_create_notification_sends_payload_to_gateway(api, specialist_a, account_a, template, fake_gateway):
    response = api(specialist_a).post(
        "/api/v1/notifications/", {"channel": "email", "template": template.id, "account": account_a.id},
        format="json",
    )
    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["status"] == "queued"
    payload = fake_gateway.sent[0]
    assert payload["user_name"] == "Иван Иванович"
    assert payload["recipient"] == "ivan@example.com"
    assert payload["context"]["account"] == "00001001"
    assert payload["template_body"] == template.body
    assert payload["callback_url"].endswith(f"/api/v1/notifications/{body['id']}/delivery-status/")
    assert payload["meta"] == {"fail": False}


def test_debt_group_selects_template_and_fills_client_context(api, specialist_a, account_a, fake_gateway):
    from django.core.management import call_command

    call_command("loaddata", "debt_group_scale", "message_templates", verbosity=0)
    account_a.debt_group = 4
    account_a.account_address = "г. Минск, ул. Примерная, 1"
    account_a.save(update_fields=["debt_group", "account_address"])
    response = api(specialist_a).post(
        "/api/v1/notifications/", {"channel": "email", "account": account_a.id}, format="json",
    )
    assert response.status_code == 201, response.json()
    payload = fake_gateway.sent[0]
    assert payload["subject"] == "Требование об оплате задолженности"
    assert "{amount}" in payload["template_body"]
    assert "Требуем погасить задолженность" in payload["template_body"]
    assert payload["context"]["debt_group"] == "4"
    assert payload["context"]["group_name"] == "6–12 месяцев"
    assert payload["context"]["fio"] == "Иванов И.И."
    assert payload["context"]["amount"] == "150.00"
    assert payload["context"]["address"] == "г. Минск, ул. Примерная, 1"
    assert response.json()["template"] is not None


def test_manual_group_overrides_calculated_when_picking_template(api, specialist_a, account_a, fake_gateway):
    from django.core.management import call_command

    call_command("loaddata", "message_templates", verbosity=0)
    account_a.debt_group = 1
    account_a.debt_group_manual = 6
    account_a.save(update_fields=["debt_group", "debt_group_manual"])
    response = api(specialist_a).post(
        "/api/v1/notifications/", {"channel": "email", "account": account_a.id}, format="json",
    )
    assert response.status_code == 201, response.json()
    assert fake_gateway.sent[0]["context"]["debt_group"] == "6"
    assert "длительная задолженность" in fake_gateway.sent[0]["template_body"]


def test_fail_flag_is_passed_as_meta(api, specialist_a, account_a, template, fake_gateway):
    api(specialist_a).post(
        "/api/v1/notifications/",
        {"channel": "email", "template": template.id, "account": account_a.id, "context": {"_fail": True}},
        format="json",
    )
    payload = fake_gateway.sent[0]
    assert payload["meta"] == {"fail": True} and "_fail" not in payload["context"]


def test_delivery_callback_marks_sent(api, client, specialist_a, account_a, template, fake_gateway, internal_headers):
    notification_id = api(specialist_a).post(
        "/api/v1/notifications/", {"channel": "email", "template": template.id, "account": account_a.id},
        format="json",
    ).json()["id"]
    text = "Добрый день, Иван Иванович!\n\n...\n\nС уважением, ЖКУ"
    response = client.post(
        f"/api/v1/notifications/{notification_id}/delivery-status/",
        {"status": "delivered", "rendered_text": text}, content_type="application/json", **internal_headers,
    )
    assert response.status_code == 200
    notification = Notification.objects.get(pk=notification_id)
    assert notification.status == Notification.Status.SENT
    assert notification.rendered_text == text
    assert notification.sent_at is not None


def test_delivery_callback_requires_internal_token(client, specialist_a, account_a, template, fake_gateway):
    n = Notification.objects.create(organization=account_a.organization, channel="email", template=template,
                                    account=account_a)
    response = client.post(f"/api/v1/notifications/{n.id}/delivery-status/", {"status": "delivered"},
                           content_type="application/json")
    assert response.status_code in (401, 403)


def test_failed_delivery_callback(client, account_a, template, internal_headers):
    n = Notification.objects.create(organization=account_a.organization, channel="email", template=template,
                                    account=account_a, status="queued")
    client.post(f"/api/v1/notifications/{n.id}/delivery-status/", {"status": "failed", "error": "SMTP down"},
                content_type="application/json", **internal_headers)
    n.refresh_from_db()
    assert n.status == Notification.Status.FAILED and n.error == "SMTP down"


def test_gateway_unavailable_marks_failed_and_logs_error(api, specialist_a, account_a, template, fake_gateway):
    fake_gateway.fail = True
    response = api(specialist_a).post(
        "/api/v1/notifications/", {"channel": "email", "template": template.id, "account": account_a.id},
        format="json", HTTP_X_REQUEST_ID="req-123",
    )
    assert response.status_code == 201
    assert response.json()["status"] == "failed"
    error = ErrorLog.objects.get()
    assert error.request_id == "req-123"
    assert error.error_type == "GatewayUnavailable"


def test_inbox_notification_and_unread_counter(api, specialist_a, admin_a, fake_gateway, internal_headers, client):
    n_id = api(admin_a).post(
        "/api/v1/notifications/", {"channel": "inbox", "body": "Новое задание", "recipient_user": specialist_a.id},
        format="json",
    ).json()["id"]
    assert fake_gateway.sent[0]["user_name"] == "Анна Петровна"
    client.post(f"/api/v1/notifications/{n_id}/delivery-status/", {"status": "delivered"},
                content_type="application/json", **internal_headers)
    assert api(specialist_a).get("/api/v1/notifications/unread-count/").json() == {"count": 1}
    api(specialist_a).post(f"/api/v1/notifications/{n_id}/mark-read/")
    assert api(specialist_a).get("/api/v1/notifications/unread-count/").json() == {"count": 0}


def test_validation_errors(api, specialist_a, account_b, template, fake_gateway):
    response = api(specialist_a).post("/api/v1/notifications/", {"channel": "email", "account": account_b.id,
                                                                 "template": template.id}, format="json")
    assert response.status_code == 400
    assert "account" in response.json()["error"]["details"]
    response = api(specialist_a).post("/api/v1/notifications/", {"channel": "sms", "template": template.id,
                                                                 "recipient_address": "+375"}, format="json")
    assert "template" in response.json()["error"]["details"]


def test_template_scope_and_preview(api, specialist_a, specialist_b, admin_a, org_b, template, fake_gateway):
    local_b = MessageTemplate.objects.create(organization=org_b, code="b", name="B", channel="sms", body="x")
    codes = {t["code"] for t in api(specialist_a).get("/api/v1/templates/").json()["results"]}
    assert codes == {"debt-reminder"}
    assert api(specialist_a).get(f"/api/v1/templates/{local_b.id}/").status_code == 404
    response = api(specialist_a).post(f"/api/v1/templates/{template.id}/preview/", {"user_name": "Олег"},
                                      format="json")
    assert response.status_code == 200
    assert response.json()["text"].startswith("Добрый день, Олег!")
    # Специалист не редактирует шаблоны
    assert api(specialist_a).patch(f"/api/v1/templates/{template.id}/", {"name": "x"}).status_code == 403
    created = api(admin_a).post("/api/v1/templates/", {"code": "local", "name": "L", "channel": "sms",
                                                       "body": "Долг {amount}"}, format="json")
    assert created.status_code == 201
    assert created.json()["organization"] == admin_a.organization_id


def test_http_gateway_client_uses_async_httpx(account_a, template):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["request_id"] = request.headers.get("X-Request-ID")
        return httpx.Response(202, json={"data": {"id": "gw-1", "status": "accepted"}, "meta": {}})

    client = HttpGatewayClient("http://gw", transport=httpx.MockTransport(handler))
    n = Notification.objects.create(organization=account_a.organization, channel="email", template=template,
                                    account=account_a)
    NotificationDispatcher(client).dispatch(n)
    n.refresh_from_db()
    assert n.status == Notification.Status.QUEUED and n.gateway_id == "gw-1"
    assert seen["path"] == "/gw/v1/notifications" and seen["request_id"]


def test_http_gateway_client_error(account_a, template):
    client = HttpGatewayClient("http://gw", transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    n = Notification.objects.create(organization=account_a.organization, channel="email", template=template,
                                    account=account_a)
    NotificationDispatcher(client).dispatch(n)
    assert n.status == Notification.Status.FAILED
