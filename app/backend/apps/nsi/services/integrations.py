"""Каталог интеграций для экрана «Настройка → Интеграции».

Новый канал — запись в INTEGRATIONS и, при необходимости, status_path шлюза.
Секреты .env из UI не правятся: там только статус и настройки схемы.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx
from django.conf import settings

from apps.core.context import REQUEST_ID_HEADER, get_request_id

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IntegrationDef:
    code: str
    title: str
    summary: str
    # Что можно править в ПМ: mail | calling | none
    settings: str = "none"
    # GET шлюза со статусом; None — только описание из каталога
    status_path: str | None = None
    stub_detail: str = ""


INTEGRATIONS: tuple[IntegrationDef, ...] = (
    IntegrationDef(
        code="smtp",
        title="SMTP",
        summary="Письма организации через SMTP заказчика. Отправитель, тема и подпись — у схемы.",
        settings="mail",
        status_path="/gw/v1/email/status",
        stub_detail="Письмо во внешнюю почту не уходит.",
    ),
    IntegrationDef(
        code="asterisk",
        title="Asterisk AMI",
        summary="Автообзвон через Asterisk AMI. Исходящие номера и признак ЮЛ — у схемы.",
        settings="calling",
        status_path="/gw/v1/voice/status",
        stub_detail="Звонок на станцию не выполняется.",
    ),
    IntegrationDef(
        code="sms",
        title="SMS",
        summary="SMS-шлюз. В ТЗ канал упомянут, боевая интеграция не описана.",
        stub_detail="Сообщение не уходит.",
    ),
    IntegrationDef(
        code="messengers",
        title="Мессенджеры",
        summary="Шаг сценария сохраняется. На этом этапе сообщения не отправляются.",
        stub_detail="Канал не подключён.",
    ),
    IntegrationDef(
        code="belpochta",
        title="Белпочта",
        summary="Статусы заказного отправления по идентификатору.",
        stub_detail="Статус вручения вводит пользователь. Сервис Белпочты не подключён.",
    ),
    IntegrationDef(
        code="pris",
        title="АИС ПРИС",
        summary="Сервисы ОАИС 3.11.01–3.11.05.",
        status_path="/gw/v1/integrations/pris/status",
        stub_detail="Пакет проверяется и в Минюст не уходит.",
    ),
    IntegrationDef(
        code="bnp",
        title="ЛК БНП",
        summary="Пакет PDF до 15 МБ и ЭЦП для кабинета Белорусской нотариальной палаты.",
        stub_detail="Пакет собирается в программе. В кабинет он не передаётся.",
    ),
    IntegrationDef(
        code="ais",
        title="АИС «Расчет-ЖКУ»",
        summary="Ночной CSV и «Обновить сейчас» по уже загруженным строкам.",
        stub_detail="Онлайн-запроса в АИС нет. Обратный файл статусов не выгружается.",
    ),
)


def get_integration(code: str) -> IntegrationDef | None:
    needle = (code or "").strip().lower()
    for item in INTEGRATIONS:
        if item.code == needle:
            return item
    return None


def list_integrations() -> list[dict[str, Any]]:
    return [_public(item, status=_status_for(item)) for item in INTEGRATIONS]


def integration_detail(code: str) -> dict[str, Any] | None:
    item = get_integration(code)
    if item is None:
        return None
    return _public(item, status=_status_for(item))


def _public(item: IntegrationDef, status: dict[str, Any]) -> dict[str, Any]:
    return {
        "code": item.code,
        "title": item.title,
        "summary": item.summary,
        "settings": item.settings,
        "stub_detail": item.stub_detail,
        "status": status,
    }


def _status_for(item: IntegrationDef) -> dict[str, Any]:
    if not item.status_path:
        return {
            "mode": "stub",
            "connected": False,
            "ready": False,
            "detail": item.stub_detail or "Внешний контур не подключён",
            "source": "catalog",
        }
    try:
        data = _gateway_get(item.status_path)
    except Exception as exc:  # noqa: BLE001 — экран настроек не должен падать
        logger.warning("Статус интеграции %s недоступен: %s", item.code, exc)
        return {
            "mode": "unknown",
            "connected": False,
            "ready": False,
            "detail": "Шлюз недоступен или не ответил",
            "source": "gateway",
        }
    mode = str(data.get("mode") or "stub")
    connected = bool(data.get("connected"))
    ready = bool(
        data.get("places_mail")
        or data.get("places_calls")
        or data.get("sends")
        or (mode not in {"stub", "unknown"} and connected)
    )
    if mode == "stub":
        ready = False
    detail = str(data.get("detail") or item.stub_detail or "")
    return {
        "mode": mode,
        "connected": connected,
        "ready": ready,
        "detail": detail,
        "source": "gateway",
        "raw": {
            key: data[key]
            for key in ("missing", "tunnel", "ministry", "system", "places_mail", "places_calls", "sends")
            if key in data
        },
    }


def _gateway_get(path: str) -> dict[str, Any]:
    url = settings.GATEWAY_URL.rstrip("/") + path
    headers = {REQUEST_ID_HEADER: get_request_id(), "X-Internal-Token": settings.INTERNAL_TOKEN}
    response = httpx.get(url, headers=headers, timeout=10.0)
    response.raise_for_status()
    body = response.json()
    data = body.get("data", body)
    if not isinstance(data, dict):
        raise ValueError("unexpected gateway payload")
    return data


class GatewayCallError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def pris_session() -> dict[str, Any]:
    """Вход модуля: Authorizate и служебные сервисы. Повтор того же токена контур не вызывает."""
    return _gateway_post("/gw/v1/integrations/pris/session", {}, timeout=150.0)


def pris_poll_state() -> dict[str, Any]:
    from apps.nsi.models import PrisPoll

    return _poll_payload(PrisPoll.load())


def save_pris_poll(raw) -> dict[str, Any]:
    from apps.nsi.models import PrisPoll

    if raw in (None, ""):
        minutes = None
    else:
        try:
            minutes = int(raw)
        except (TypeError, ValueError):
            raise ValueError("Период указывают целым числом минут") from None
        if minutes < 1 or minutes > 1440:
            raise ValueError("Период от 1 до 1440 минут")
    row = PrisPoll.load()
    row.interval_minutes = minutes
    row.save(update_fields=["interval_minutes", "updated_at"])
    return _poll_payload(row)


def _poll_payload(row) -> dict[str, Any]:
    return {
        "interval_minutes": row.interval_minutes,
        "last_tick_at": row.last_tick_at.isoformat() if row.last_tick_at else None,
        "last_summary": row.last_summary,
    }


def _gateway_post(path: str, payload: dict, *, timeout: float) -> dict[str, Any]:
    url = settings.GATEWAY_URL.rstrip("/") + path
    headers = {REQUEST_ID_HEADER: get_request_id(), "X-Internal-Token": settings.INTERNAL_TOKEN}
    try:
        response = httpx.post(url, json=payload, headers=headers, timeout=timeout)
    except httpx.HTTPError as exc:
        raise GatewayCallError(502, "Шлюз недоступен") from exc
    if response.status_code >= 400:
        message = "Шлюз не выполнил запрос"
        try:
            body = response.json()
        except ValueError:
            body = {}
        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict) and error.get("message"):
                message = str(error["message"])
            elif body.get("detail"):
                message = str(body["detail"])
        raise GatewayCallError(response.status_code, message)
    body = response.json()
    data = body.get("data", body) if isinstance(body, dict) else body
    if not isinstance(data, dict):
        raise GatewayCallError(502, "Шлюз вернул неожиданный ответ")
    return data


def pris_check(step: str) -> dict[str, Any]:
    """Проверочный запрос ПРИС. Тело — сверка, без ключа и токена."""
    try:
        return _gateway_post("/gw/v1/integrations/pris/checks", {"step": step}, timeout=120.0)
    except GatewayCallError as exc:
        if exc.detail == "Шлюз не выполнил запрос":
            raise GatewayCallError(exc.status, "Шлюз не выполнил проверочный запрос") from exc
        raise
