"""Контекст текущего запроса: доступен логам, журналу ошибок и клиенту шлюза."""

import uuid
from contextvars import ContextVar

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
user_id_var: ContextVar[int | None] = ContextVar("user_id", default=None)
path_var: ContextVar[str | None] = ContextVar("path", default=None)

REQUEST_ID_HEADER = "X-Request-ID"


def new_request_id() -> str:
    return uuid.uuid4().hex


def get_request_id() -> str:
    """Текущий request_id; вне HTTP-запроса (команды, задачи) создаётся новый."""
    rid = request_id_var.get()
    if rid is None:
        rid = new_request_id()
        request_id_var.set(rid)
    return rid
