"""JSON-логи шлюза в stdout с тем же набором полей, что у backend."""

import logging
import sys

try:
    from pythonjsonlogger.json import JsonFormatter
except ImportError:  # python-json-logger < 3
    from pythonjsonlogger.jsonlogger import JsonFormatter

from .config import get_settings
from .context import path_var, request_id_var


class RequestContextFilter(logging.Filter):
    def __init__(self, service: str):
        super().__init__()
        self.service = service

    def filter(self, record: logging.LogRecord) -> bool:
        record.service = self.service
        record.request_id = request_id_var.get()
        record.user_id = getattr(record, "user_id", None)
        record.path = path_var.get()
        return True


def setup_logging() -> None:
    settings = get_settings()
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RequestContextFilter(settings.service_name))
    handler.setFormatter(
        JsonFormatter(
            "%(asctime)s %(levelname)s %(service)s %(request_id)s %(user_id)s %(path)s %(name)s %(message)s",
            rename_fields={"asctime": "timestamp", "levelname": "level"},
        )
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(settings.log_level)
