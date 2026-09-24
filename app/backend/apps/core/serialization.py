"""Приведение значений модели к JSON для журналов (до/после изменения)."""

import datetime
import decimal
import uuid

from django.db import models


def to_jsonable(value):
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, datetime.datetime | datetime.date | datetime.time):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {k: to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [to_jsonable(v) for v in value]
    return value


def snapshot(instance: models.Model | None) -> dict | None:
    """Плоский снимок полей модели (FK — как id)."""
    if instance is None:
        return None
    data = {}
    for field in instance._meta.concrete_fields:
        if field.name in {"password", "raw"}:
            continue
        data[field.attname] = to_jsonable(getattr(instance, field.attname))
    return data
