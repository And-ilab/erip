import logging

from .context import REQUEST_ID_HEADER, new_request_id, path_var, request_id_var, user_id_var

logger = logging.getLogger(__name__)


class RequestIdMiddleware:
    """Читает X-Request-ID (от NGINX/клиента) или создаёт новый и возвращает его в ответе."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        rid = request.headers.get(REQUEST_ID_HEADER) or new_request_id()
        request.request_id = rid
        tokens = (request_id_var.set(rid), path_var.set(request.path), user_id_var.set(None))
        try:
            response = self.get_response(request)
        finally:
            request_id_var.reset(tokens[0])
            path_var.reset(tokens[1])
            user_id_var.reset(tokens[2])
        response[REQUEST_ID_HEADER] = rid
        return response


class ErrorLoggingMiddleware:
    """Необработанные исключения вне DRF (admin, служебные вьюхи) попадают в ErrorLog."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_exception(self, request, exception):
        from apps.audit.services import record_error

        record_error(exception, path=request.path)
        return None
