"""Сборка текста оповещения из шаблона и контекста."""

import string

from ..decorators.greeting import with_greeting


class _SafeDict(dict):
    """Неизвестная переменная остаётся в тексте как есть — {name} — и видна в предпросмотре."""

    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


class MessageRenderer:
    formatter = string.Formatter()

    def render_body(self, template_body: str, context: dict) -> str:
        try:
            return self.formatter.vformat(template_body, (), _SafeDict({k: v for k, v in context.items()}))
        except (ValueError, IndexError):
            # Некорректные фигурные скобки в шаблоне — отдаём текст без подстановки
            return template_body

    @with_greeting()
    async def render(self, template_body: str, context: dict, *, user_name: str) -> str:
        return self.render_body(template_body, context)
