"""Декоратор ответа API: единый конверт {"data": ..., "meta": {"request_id", "duration_ms"}} и логирование ошибок."""

import functools
import logging
import time

from ..core.context import get_request_id

logger = logging.getLogger("gateway.api")


def api_response(func):
    @functools.wraps(func)  # сохраняет сигнатуру — FastAPI продолжает разбирать параметры и Depends
    async def wrapper(*args, **kwargs):
        started = time.perf_counter()
        try:
            data = await func(*args, **kwargs)
        except Exception:
            logger.exception("Ошибка в обработчике %s", func.__name__)
            raise
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        return {"data": data, "meta": {"request_id": get_request_id(), "duration_ms": duration_ms}}

    return wrapper
