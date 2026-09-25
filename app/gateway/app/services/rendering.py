"""Сборка текста оповещения из шаблона и контекста.

Подставляются только простые имена `{fio}`, `{account}` и т.п.
Доступ к атрибутам (`{fio.__class__}`) и позиционные поля не раскрываются.
"""

import re

from ..decorators.greeting import with_greeting

_PLACEHOLDER = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")


def _as_text(value: object) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    return str(value)


class MessageRenderer:
    def render_body(self, template_body: str, context: dict) -> str:
        def replace(match: re.Match[str]) -> str:
            text = _as_text(context.get(match.group(1)))
            return match.group(0) if text is None else text

        return _PLACEHOLDER.sub(replace, template_body)

    @with_greeting()
    async def render(self, template_body: str, context: dict, *, user_name: str) -> str:
        return self.render_body(template_body, context)
