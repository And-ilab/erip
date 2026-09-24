"""JSON-логи в stdout (готовы к сбору в ELK/OpenSearch)."""

import logging

from django.conf import settings

try:
    from pythonjsonlogger.json import JsonFormatter as BaseJsonFormatter
except ImportError:  # python-json-logger < 3
    from pythonjsonlogger.jsonlogger import JsonFormatter as BaseJsonFormatter

from .context import path_var, request_id_var, user_id_var


class RequestContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.service = getattr(settings, "SERVICE_NAME", "backend")
        record.request_id = request_id_var.get()
        record.user_id = user_id_var.get()
        record.path = path_var.get()
        return True


class JsonFormatter(BaseJsonFormatter):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault(
            "fmt", "%(asctime)s %(levelname)s %(service)s %(request_id)s %(user_id)s %(path)s %(name)s %(message)s"
        )
        kwargs.setdefault("rename_fields", {"asctime": "timestamp", "levelname": "level"})
        super().__init__(*args, **kwargs)
