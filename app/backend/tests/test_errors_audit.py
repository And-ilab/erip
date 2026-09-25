"""Журнал ошибок, единый формат ошибок API, журнал аудита, НСИ."""

import pytest
from django.core.management import call_command

from apps.audit.models import AuditLog, ErrorLog
from apps.debts.models import Account, AccountService
from apps.debts.services.grouping import DebtGroupCalculator
from apps.nsi.models import BnpService, DebtGroupScale

pytestmark = pytest.mark.django_db


def test_unhandled_exception_is_logged(api, specialist_a, monkeypatch):
    from apps.debts import views

    def boom(self, *args, **kwargs):
        raise RuntimeError("сбой базы")

    monkeypatch.setattr(views.AccountViewSet, "list", boom)
    response = api(specialist_a).get("/api/v1/accounts/", HTTP_X_REQUEST_ID="rid-1")
    assert response.status_code == 500
    assert response.json()["error"] == {
        "code": "internal_error", "message": "Внутренняя ошибка сервера", "details": None, "request_id": "rid-1",
    }
    assert response["X-Request-ID"] == "rid-1"
    entry = ErrorLog.objects.get()
    assert entry.error_type == "RuntimeError" and entry.request_id == "rid-1" and entry.user_id == specialist_a.id


def test_gateway_error_ingest(client, internal_headers, api, superadmin, specialist_a):
    response = client.post(
        "/api/v1/audit/errors/ingest/",
        {"service": "gateway", "request_id": "rid-9", "error_type": "AdapterError", "message": "SMTP"},
        content_type="application/json", **internal_headers,
    )
    assert response.status_code == 201
    assert ErrorLog.objects.get().service == "gateway"
    assert client.post("/api/v1/audit/errors/ingest/", {}, content_type="application/json").status_code in (401, 403)
    assert api(specialist_a).get("/api/v1/audit/errors/").status_code == 403
    assert api(superadmin).get("/api/v1/audit/errors/?request_id=rid-9").json()["count"] == 1


def test_card_view_and_update_are_audited(api, specialist_a, account_a):
    api(specialist_a).get(f"/api/v1/accounts/{account_a.id}/")
    assert AuditLog.objects.filter(action="view", object_id=str(account_a.id)).exists()
    response = api(specialist_a).patch(f"/api/v1/accounts/{account_a.id}/", {"debt_group_manual": 5})
    assert response.status_code == 400  # без причины
    response = api(specialist_a).patch(
        f"/api/v1/accounts/{account_a.id}/",
        {"debt_group_manual": 5, "debt_group_manual_reason": "Решение комиссии", "short_fio": "Подмена"},
    )
    assert response.status_code == 200
    account_a.refresh_from_db()
    assert account_a.effective_group == 5
    assert account_a.short_fio == "Иванов И.И."  # поле АИС не редактируется
    log = AuditLog.objects.get(action="update")
    assert log.before["debt_group_manual"] is None and log.after["debt_group_manual"] == 5


def test_registry_search_and_totals(api, specialist_a, account_a):
    rows = api(specialist_a).get("/api/v1/accounts/?q=1001").json()["results"]
    assert [r["id"] for r in rows] == [account_a.id]
    assert rows[0]["debt_total"] == "100.00" and rows[0]["services_count"] == 1
    assert api(specialist_a).get("/api/v1/accounts/?q=99999").json()["count"] == 0
    detail = api(specialist_a).get(f"/api/v1/accounts/{account_a.id}/registrations/").json()
    assert detail["results"][0]["full_name"] == "Иванов Иван Иванович"


def test_group_calculator_uses_nsi_scale(org_a, account_a):
    call_command("loaddata", "debt_group_scale", verbosity=0)
    assert DebtGroupScale.objects.count() == 6
    calc = DebtGroupCalculator()
    assert [calc.group_for_months(m) for m in (0, 1, 2, 3, 6, 12, 35, 36, 120)] == [None, 1, 2, 3, 4, 5, 5, 6, 6]
    assert calc.recalculate(account_a) == 4  # 7 месяцев долга по газу
    AccountService.objects.update(balance_out=0)
    assert calc.recalculate(Account.objects.get(pk=account_a.pk)) is None


def test_bnp_fixture_and_nsi_api(api, specialist_a, superadmin):
    call_command("loaddata", "bnp_dictionaries", verbosity=0)
    service = BnpService.objects.get(pk=572)
    assert service.debt_types.filter(code="dolg_9_1").exists()
    rows = api(specialist_a).get("/api/v1/nsi/bnp-services/?type_id=exec_order&page_size=100").json()
    assert rows["count"] > 30
    assert api(specialist_a).post("/api/v1/nsi/debt-groups/", {"group": 7, "name": "x", "months_from": 1},
                                  format="json").status_code == 403
    response = api(superadmin).delete("/api/v1/nsi/bnp-doc-types/proxy/")
    assert response.status_code == 204
    assert BnpService.objects.filter(pk=572).exists()
    from apps.nsi.models import BnpDocType

    assert BnpDocType.objects.get(pk="proxy").is_active is False  # деактивация вместо удаления


def test_me_and_token(client, specialist_a):
    login = client.post("/api/v1/auth/token/", {"username": "spec_a", "password": "Passw0rd!x"},
                        content_type="application/json")
    assert "refresh" not in login.json()
    assert "erip_refresh" in login.cookies
    token = login.json()["access"]
    me = client.get("/api/v1/auth/me/", HTTP_AUTHORIZATION=f"Bearer {token}").json()
    assert me["display_name"] == "Анна Петровна" and me["role"] == "specialist"
    old_refresh = login.cookies["erip_refresh"].value
    refreshed = client.post("/api/v1/auth/token/refresh/", {}, content_type="application/json")
    assert refreshed.status_code == 200 and refreshed.json()["access"]
    client.cookies["erip_refresh"] = old_refresh
    reused = client.post("/api/v1/auth/token/refresh/", {}, content_type="application/json")
    assert reused.status_code == 401, reused.content


def test_client_ip_is_the_proxy_appended_address():
    from django.test import RequestFactory

    from apps.core.request import client_ip

    request = RequestFactory().get("/")
    request.META["HTTP_X_FORWARDED_FOR"] = "1.2.3.4, 10.0.0.8"
    request.META["REMOTE_ADDR"] = "172.16.0.2"
    assert client_ip(request) == "10.0.0.8"


def test_account_list_is_audited_once(api, specialist_a, account_a):
    api(specialist_a).get("/api/v1/accounts/?page=1")
    logs = AuditLog.objects.filter(action="view", object_type="debts.Account", object_id="")
    assert logs.count() == 1
    assert logs.get().after["query"]["page"] == "1"


def test_registration_list_masks_personal_num(api, specialist_a, account_a):
    registration = account_a.registrations.get()
    registration.personal_num = "3230888A001PB5"
    registration.save(update_fields=["personal_num"])
    listed = api(specialist_a).get("/api/v1/registrations/").json()["results"][0]
    assert listed["personal_num"] != "3230888A001PB5"
    assert "*" in listed["personal_num"]
    card = api(specialist_a).get(f"/api/v1/accounts/{account_a.id}/registrations/").json()["results"][0]
    assert card["personal_num"] == "3230888A001PB5"


def test_password_change_revokes_refresh(client, specialist_a):
    login = client.post("/api/v1/auth/token/", {"username": "spec_a", "password": "Passw0rd!x"},
                        content_type="application/json")
    token = login.json()["access"]
    stolen = login.cookies["erip_refresh"].value
    changed = client.post(
        "/api/v1/auth/password/",
        {"old_password": "Passw0rd!x", "new_password": "N3w-password!"},
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert changed.status_code == 204, changed.content
    client.cookies["erip_refresh"] = stolen
    assert client.post("/api/v1/auth/token/refresh/", {}, content_type="application/json").status_code == 401
    again = client.post("/api/v1/auth/token/", {"username": "spec_a", "password": "N3w-password!"},
                        content_type="application/json")
    assert again.status_code == 200


def test_inactive_organization_cannot_log_in(client, specialist_a, org_a):
    org_a.is_active = False
    org_a.save(update_fields=["is_active"])
    response = client.post("/api/v1/auth/token/", {"username": "spec_a", "password": "Passw0rd!x"},
                           content_type="application/json")
    assert response.status_code == 401


def test_purge_retained_clears_old_raw_and_audit(account_a):
    from datetime import timedelta

    from django.utils import timezone

    Account.objects.filter(pk=account_a.pk).update(raw={"PHONE": "1"}, updated_at=timezone.now() - timedelta(days=120))
    AuditLog.objects.create(action="view", object_type="debts.Account", object_id="1")
    AuditLog.objects.filter(object_id="1").update(created_at=timezone.now() - timedelta(days=40))
    call_command("purge_retained", "--raw-days", "90", "--audit-days", "30", "--error-days", "30")
    account_a.refresh_from_db()
    assert account_a.raw == {}
    assert not AuditLog.objects.filter(object_id="1").exists()
