"""Декоратор приветствия: оборачивает тело сообщения в «Добрый день, {имя}! … С уважением, ЖКУ»."""

import functools
from collections.abc import Awaitable, Callable

DEFAULT_SIGN = "С уважением, ЖКУ"


def with_greeting(sign: str = DEFAULT_SIGN, greeting: str = "Добрый день, {user_name}!"):
    def decorator(func: Callable[..., Awaitable[str]]):
        @functools.wraps(func)
        async def wrapper(*args, user_name: str, **kwargs) -> str:
            body = await func(*args, user_name=user_name, **kwargs)
            return f"{greeting.format(user_name=user_name)}\n\n{body}\n\n{sign}"

        return wrapper

    return decorator
