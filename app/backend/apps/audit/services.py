"""Запись в журнал ошибок и журнал аудита. Сбой записи не должен ронять основной запрос."""

import logging
import traceback as tb

from apps.core.context import get_request_id, path_var, user_id_var
from apps.core.request import client_ip
from apps.core.serialization import snapshot

from .models import AuditLog, ErrorLog

logger = logging.getLogger(__name__)


def record_error(
    exc: BaseException | None = None,
    *,
    service: str = "backend",
    path: str | None = None,
    error_type: str | None = None,
    message: str | None = None,
    trace: str | None = None,
    request_id: str | None = None,
    user_id: int | None = None,
) -> ErrorLog | None:
    rid = request_id or get_request_id()
    logger.error(
        message or str(exc),
        exc_info=exc if isinstance(exc, BaseException) else None,
        extra={"error_service": service},
    )
    try:
        return ErrorLog.objects.create(
            service=service,
            request_id=rid,
            path=(path or path_var.get() or "")[:500],
            error_type=(error_type or (type(exc).__name__ if exc else "Error"))[:200],
            message=message or str(exc),
            traceback=trace if trace is not None else ("".join(tb.format_exception(exc)) if exc else ""),
            user_id=user_id if user_id is not None else user_id_var.get(),
        )
    except Exception:  # noqa: BLE001 — журнал не должен ломать обработку
        logger.exception("Не удалось записать ErrorLog")
        return None


def record_action(request, action: str, instance=None, *, before=None, after=None, object_type=None) -> None:
    user = getattr(request, "user", None)
    try:
        AuditLog.objects.create(
            user=user if user is not None and user.is_authenticated else None,
            action=action,
            object_type=object_type or (instance._meta.label if instance is not None else ""),
            object_id=str(getattr(instance, "pk", "") or ""),
            before=before,
            after=after if after is not None else (snapshot(instance) if action != AuditLog.Action.VIEW else None),
            request_id=get_request_id(),
            ip=client_ip(request),
        )
    except Exception:  # noqa: BLE001
        logger.exception("Не удалось записать AuditLog")


def record_query(request, object_type: str, *, count: int | None = None) -> None:
    """Одна запись на список или поиск: фильтры и страница, без строки на каждую запись."""
    params = {}
    if request is not None:
        for key in ("search", "q", "page", "page_size", "ordering"):
            value = request.query_params.get(key)
            if value:
                params[key] = value[:200]
    record_action(
        request, AuditLog.Action.VIEW, object_type=object_type, after={"query": params, "count": count},
    )
