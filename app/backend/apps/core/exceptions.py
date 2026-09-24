"""Единый формат ошибки API: {"error": {"code", "message", "details", "request_id"}}."""

import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler

from .context import get_request_id

logger = logging.getLogger(__name__)


class ServiceError(exceptions.APIException):
    """Ошибка бизнес-логики, которую нужно показать пользователю."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "service_error"
    default_detail = "Ошибка обработки запроса"


class GatewayUnavailable(exceptions.APIException):
    status_code = status.HTTP_502_BAD_GATEWAY
    default_code = "gateway_unavailable"
    default_detail = "Шлюз оповещений недоступен"


def error_body(code: str, message: str, details=None) -> dict:
    return {"error": {"code": code, "message": message, "details": details, "request_id": get_request_id()}}


def api_exception_handler(exc, context):
    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()

    response = exception_handler(exc, context)
    if response is not None:
        details = response.data if isinstance(exc, exceptions.ValidationError) else None
        codes = exc.get_codes() if isinstance(exc, exceptions.APIException) else "error"
        code = codes if isinstance(codes, str) else "invalid"
        message = str(exc.detail) if isinstance(exc, exceptions.APIException) and not details else "Ошибка валидации"
        response.data = error_body(code, message, details)
        return response

    from apps.audit.services import record_error

    request = context.get("request")
    user = getattr(request, "user", None)
    record_error(
        exc,
        path=getattr(request, "path", None),
        user_id=user.pk if user is not None and user.is_authenticated else None,
    )
    return Response(
        error_body("internal_error", "Внутренняя ошибка сервера"), status=status.HTTP_500_INTERNAL_SERVER_ERROR
    )
