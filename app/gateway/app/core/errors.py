"""Ошибки шлюза, единый формат ответа и передача ошибок в журнал backend (ErrorLog)."""

from __future__ import annotations

import logging
import traceback as tb

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import get_settings
from .context import get_request_id, path_var
from .singletons import HttpClient

logger = logging.getLogger(__name__)


class GatewayError(Exception):
    status_code = 400
    code = "gateway_error"

    def __init__(self, message: str, details=None):
        super().__init__(message)
        self.message = message
        self.details = details


class NotFoundError(GatewayError):
    status_code = 404
    code = "not_found"


class UnauthorizedError(GatewayError):
    status_code = 401
    code = "unauthorized"


class AdapterError(GatewayError):
    """Ошибка канала доставки (email/sms/voice)."""

    status_code = 502
    code = "adapter_error"


def error_body(code: str, message: str, details=None) -> dict:
    return {"error": {"code": code, "message": message, "details": details, "request_id": get_request_id()}}


async def report_error(exc: BaseException, *, path: str | None = None) -> None:
    """Пишет ошибку в JSON-лог и (best effort) в ErrorLog backend с тем же request_id."""
    settings = get_settings()
    logger.error(str(exc), exc_info=exc)
    payload = {
        "service": settings.service_name,
        "request_id": get_request_id(),
        "path": path or path_var.get() or "",
        "error_type": type(exc).__name__,
        "message": str(exc),
        "traceback": "".join(tb.format_exception(exc)),
    }
    try:
        await HttpClient().client.post(
            f"{settings.backend_url}/api/v1/audit/errors/ingest/",
            json=payload,
            headers={"X-Internal-Token": settings.internal_token, "X-Request-ID": payload["request_id"]},
        )
    except Exception:  # noqa: BLE001 — недоступность backend не должна ронять шлюз
        logger.warning("Не удалось передать ошибку в backend", exc_info=True)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(GatewayError)
    async def _gateway_error(request: Request, exc: GatewayError):
        if exc.status_code >= 500:
            await report_error(exc, path=request.url.path)
        return JSONResponse(error_body(exc.code, exc.message, exc.details), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        details = [
            {"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()
        ]
        return JSONResponse(error_body("validation_error", "Ошибка валидации", details), status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        await report_error(exc, path=request.url.path)
        return JSONResponse(error_body("internal_error", "Внутренняя ошибка шлюза"), status_code=500)
