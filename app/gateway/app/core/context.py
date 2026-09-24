import uuid
from contextvars import ContextVar

REQUEST_ID_HEADER = "X-Request-ID"

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
path_var: ContextVar[str | None] = ContextVar("path", default=None)


def new_request_id() -> str:
    return uuid.uuid4().hex


def get_request_id() -> str:
    rid = request_id_var.get()
    if rid is None:
        rid = new_request_id()
        request_id_var.set(rid)
    return rid
