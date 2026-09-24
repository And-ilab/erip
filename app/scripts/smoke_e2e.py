"""Сквозная проверка MVP на запущенных backend и шлюзе (критерии приёмки 1, 3, 4, 5).

Перед запуском: выполнены миграции, загружены фикстуры, импортированы тестовые выгрузки
(generate_ais_samples + import_ais), есть пользователь с правами на оповещения.

  python scripts/smoke_e2e.py --backend http://localhost:8080 --gateway http://localhost:8080 \
      --user admin --password admin
"""

import argparse
import sys
import time
import uuid

import httpx

MANIFEST = {
    "version": 1,
    "applications": [{
        "externalId": "SMOKE-1", "contactData": "+375170000000", "notificationE-mail": "legal@example.com",
        "userMessage": "Проверка", "serviceId": 572,
        "debtors": [{"personType": "natural", "personalId": "3230587H066PB5", "secondName": "Тест",
                     "firstName": "Тест", "middleName": "Тестович"}],
        "debts": [{"startDate": "2025-01-01", "endDate": "2025-02-01", "amount": "10.00", "currency": "BYN",
                   "typeId": "dolg_9_3"}],
        "docs": [{"fileName": "a.pdf", "signatureName": "a.pdf.p7s", "docType": "application", "detachedSign": True}],
    }],
}


def check(condition: bool, message: str) -> None:
    print(("OK   " if condition else "FAIL ") + message)
    if not condition:
        sys.exit(1)


def wait_status(api: httpx.Client, notification_id: int, expected: str, timeout: float = 15) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = api.get(f"/api/v1/notifications/{notification_id}/").json()
        if body["status"] == expected:
            return body
        time.sleep(0.5)
    return body


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", default="http://127.0.0.1:8000")
    parser.add_argument("--gateway", default="http://127.0.0.1:8001")
    parser.add_argument("--user", default="admin")
    parser.add_argument("--password", default="admin")
    args = parser.parse_args()

    token = httpx.post(f"{args.backend}/api/v1/auth/token/",
                       json={"username": args.user, "password": args.password}).json()["access"]
    api = httpx.Client(base_url=args.backend, headers={"Authorization": f"Bearer {token}"}, timeout=20)

    accounts = api.get("/api/v1/accounts/", params={"page_size": 100}).json()
    check(accounts["count"] > 0, f"1. Реестр ЛС содержит импортированные записи ({accounts['count']})")
    groups = sorted({a["debt_group"] for a in accounts["results"] if a["debt_group"]})
    check(bool(groups), f"1. Группы задолженности рассчитаны: {groups}")
    account = accounts["results"][0]

    code = f"smoke-{uuid.uuid4().hex[:6]}"
    template = api.post("/api/v1/templates/", json={
        "code": code, "name": "Smoke", "channel": "email", "subject": "Долг",
        "body": "Задолженность по ЛС {account} составляет {amount} руб.",
    })
    check(template.status_code == 201, f"Шаблон создан ({template.status_code})")
    template_id = template.json()["id"]

    ok_id = api.post("/api/v1/notifications/", json={"channel": "email", "template": template_id,
                                                     "account": account["id"]}).json()["id"]
    sent = wait_status(api, ok_id, "sent")
    check(sent["status"] == "sent", "3. Оповещение доставлено шлюзом, статус sent")
    text = sent["rendered_text"]
    check(text.startswith("Добрый день, ") and text.endswith("С уважением, ЖКУ"),
          f"3. Текст обёрнут приветствием: {text.splitlines()[0]} … {text.splitlines()[-1]}")

    rid = uuid.uuid4().hex
    fail_id = api.post("/api/v1/notifications/", headers={"X-Request-ID": rid}, json={
        "channel": "email", "template": template_id, "account": account["id"], "context": {"_fail": True},
    }).json()["id"]
    failed = wait_status(api, fail_id, "failed")
    check(failed["status"] == "failed", f"4. Отказ адаптера → статус failed ({failed['error']})")
    time.sleep(1)
    errors = api.get("/api/v1/audit/errors/", params={"request_id": rid})
    if errors.status_code == 200:
        rows = errors.json()["results"]
        check(any(e["service"] == "gateway" for e in rows), f"4. ErrorLog шлюза с тем же request_id {rid}")
    else:
        print("SKIP 4. Журнал ошибок доступен только суперадминистратору")

    gw = httpx.Client(base_url=args.gateway, timeout=20)
    good = gw.post("/gw/v1/integrations/bnp/validate", json=MANIFEST)
    check(good.status_code == 200, "5. Корректный манифест БНП принят")
    bad = dict(MANIFEST)
    bad["applications"] = [{**MANIFEST["applications"][0],
                            "debtors": [{**MANIFEST["applications"][0]["debtors"][0], "personalId": "3230587H066PB5X"}]}]
    check(gw.post("/gw/v1/integrations/bnp/validate", json=bad).status_code == 422,
          "5. Манифест с personalId длиннее 14 символов отклонён")
    print("Все проверки пройдены")


if __name__ == "__main__":
    main()
