from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from .context import REQUEST_ID_HEADER, new_request_id, path_var, request_id_var


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Принимает X-Request-ID от backend/NGINX, чтобы логи сервисов связывались одним id."""

    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get(REQUEST_ID_HEADER) or new_request_id()
        t1, t2 = request_id_var.set(rid), path_var.set(request.url.path)
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(t1)
            path_var.reset(t2)
        response.headers[REQUEST_ID_HEADER] = rid
        return response
