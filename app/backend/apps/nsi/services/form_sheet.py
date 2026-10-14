"""Лист печатной формы: строка с меткой становится полем, PDF собирается из того же HTML."""

from __future__ import annotations

import re
from html import escape
from pathlib import Path

TOKEN_RE = re.compile(r"\{([a-z0-9_]+)\}")
FIELD_RE = re.compile(r"^([^:{]{1,80}):\s*\{([a-z0-9_]+)\}\s*$")
BARE_RE = re.compile(r"^\{([a-z0-9_]+)\}\s*$")
FILLED_RE = re.compile(r"^([^:{]{1,80}):\s*(.*?)\s*$")

FIELD_LABELS = {
    "fio": "Должник",
    "account": "Лицевой счёт",
    "amount": "Задолженность",
    "penalty": "Пеня",
    "address": "Адрес",
    "services": "Услуги",
    "last_payment": "Последняя оплата",
    "organization": "Организация",
    "due_days": "Срок, дней",
    "tariff": "Нотариальный тариф",
    "debt_group": "Группа задолженности",
    "rating": "Рейтинг",
    "months_debt": "Месяцев долга",
    "personal_id": "Идентификационный номер",
    "unp": "УНП",
    "warning_date": "Дата вручения",
    "debt_started": "Начало долга",
}

# Обратные подписи строк из макетов нотариата и исков. Нужны, когда в тексте уже подставлено значение.
LABEL_TOKENS = {
    "должник": "fio",
    "ответчик": "fio",
    "заявитель": "organization",
    "истец": "organization",
    "организация": "organization",
    "лицевой счёт": "account",
    "лицевой счет": "account",
    "адрес": "address",
    "идентификационный номер": "personal_id",
    "унп": "unp",
    "услуги": "services",
    "задолженность": "amount",
    "исходящее сальдо": "amount",
    "исходящее сальдо по данным аис «расчет-жку»": "amount",
    "исходящее сальдо с пенями": "amount",
    "пеня": "penalty",
    "исходящие пени": "penalty",
    "пеня по данным аис «расчет-жку»": "penalty",
    "нотариальный тариф": "tariff",
    "дата вручения предупреждения": "warning_date",
    "группа задолженности": "debt_group",
    "рейтинг": "rating",
    "месяцев долга": "months_debt",
    "наиболее ранний период": "debt_started",
}

_CSS = Path(__file__).with_name("form_sheet.css").read_text(encoding="utf-8")
_FRAME_TOKENS = {"fio", "address"}


def parse_text(text: str, *, title: bool = False) -> list[dict]:
    """Пустая строка — отступ. «Подпись: {поле}» — поле. Остальное — абзац, метки внутри остаются."""
    lines = (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    nodes: list[dict] = []
    cursor = 0
    if title and lines and _is_title(lines[0]):
        nodes.append({"kind": "title", "text": lines[0]})
        cursor = 1
    while cursor < len(lines):
        line = lines[cursor]
        if line == "":
            nodes.append({"kind": "gap"})
            cursor += 1
            continue
        if _classify(line) == "text":
            nodes.append({"kind": "paragraph", "text": line})
            cursor += 1
            continue
        items = []
        while cursor < len(lines) and lines[cursor] != "" and _classify(lines[cursor]) != "text":
            items.append(_field(lines[cursor]))
            cursor += 1
        nodes.append({"kind": "fields", "framed": _framed(items), "items": items})
    return nodes


def serialize_nodes(nodes: list[dict]) -> str:
    lines: list[str] = []
    for node in nodes:
        if node["kind"] == "gap":
            lines.append("")
        elif node["kind"] == "title":
            lines.append(node["text"])
        elif node["kind"] == "fields":
            for item in node["items"]:
                if item["bare"]:
                    lines.append("{" + item["token"] + "}")
                elif item["literal"]:
                    lines.append(f"{item['label']}: {item['value']}")
                else:
                    lines.append(f"{item['label']}: {{{item['token']}}}")
        else:
            lines.append(node["text"])
    return "\n".join(lines)


def render_form_html(blocks: list[dict]) -> str:
    parts = [
        "<!DOCTYPE html><html lang=\"ru\"><head><meta charset=\"utf-8\">",
        f"<style>{_CSS}</style></head><body><article class=\"sheet\">",
    ]
    for row in _rows(_ordered(blocks)):
        split = len(row) > 1
        if split:
            parts.append('<div class="doc-row split">')
        for block in sorted(row, key=lambda item: _num(item.get("x"))):
            parts.append(_block_html(block))
        if split:
            parts.append("</div>")
    parts.append("</article></body></html>")
    return "".join(parts)


def pdf_from_html(html: str) -> bytes | None:
    """None — WeasyPrint на этой машине не загрузился, лист собирает запасной генератор."""
    try:
        from weasyprint import HTML
    except (ImportError, OSError):
        return None
    try:
        return HTML(string=html).write_pdf()
    except OSError:
        return None


def _rows(blocks: list[dict]) -> list[list[dict]]:
    rows: list[list[dict]] = []
    for block in blocks:
        if rows and abs(_num(rows[-1][0].get("y")) - _num(block.get("y"))) < 8:
            rows[-1].append(block)
        else:
            rows.append([block])
    return rows


def _ordered(blocks: list[dict]) -> list[dict]:
    indexed = list(enumerate(blocks or []))
    indexed.sort(key=lambda pair: (_num(pair[1].get("y")), pair[0]))
    return [item for _, item in indexed if item.get("enabled", True)]


def _block_html(block: dict) -> str:
    key = str(block.get("key") or "")
    classes = ["doc-block"]
    if key == "logo":
        classes.append("letterhead")
    if key == "signatory":
        classes.append("sign")
    chunks = [f'<section class="{" ".join(classes)}" style="{_style(block)}">']
    if key == "signatory":
        chunks.append('<div class="sign-caption">Подпись</div>')
    for node in parse_text(str(block.get("text") or ""), title=key == "body"):
        chunks.append(_node_html(node))
    table = _table_html(block.get("columns") or [], block.get("rows") or [])
    if table:
        chunks.append(table)
    chunks.append("</section>")
    return "".join(chunks)


def _node_html(node: dict) -> str:
    if node["kind"] == "gap":
        return '<div class="gap"></div>'
    if node["kind"] == "title":
        return f'<h1 class="doc-title">{escape(node["text"])}</h1>'
    if node["kind"] == "paragraph":
        klass = "prose indent" if len(node["text"]) > 80 else "prose"
        return f'<p class="{klass}">{_with_blanks(node["text"])}</p>'
    box = "frame" if node["framed"] else "panel"
    fields = "".join(_field_html(item) for item in node["items"])
    return f'<div class="{box}"><div class="fields">{fields}</div></div>'


def _field_html(item: dict) -> str:
    wide = " wide" if len(item["label"]) > 28 else ""
    inner = _with_blanks(item["value"]) if item["literal"] and item["value"] else "&nbsp;"
    shown = f'<span class="blank">{inner}</span>'
    return (
        f'<div class="field{wide}">'
        f'<span class="field-label">{escape(item["label"])}</span>{shown}</div>'
    )


def _table_html(columns: list, rows: list) -> str:
    if not columns or not rows:
        return ""
    heads = "".join(f"<th>{escape(str(col.get('title') or ''))}</th>" for col in columns if isinstance(col, dict))
    if not heads:
        return ""
    body = []
    width = len(columns)
    for row in rows:
        cells = list(row)[:width] if isinstance(row, list) else []
        cells += [""] * (width - len(cells))
        tds = "".join(f"<td>{_cell(str(cell))}</td>" for cell in cells)
        body.append(f"<tr>{tds}</tr>")
    return f'<table class="grid"><thead><tr>{heads}</tr></thead><tbody>{"".join(body)}</tbody></table>'


def _cell(value: str) -> str:
    if BARE_RE.match(value.strip()):
        return "&nbsp;"
    return _with_blanks(value) or "&nbsp;"


def _with_blanks(text: str) -> str:
    parts: list[str] = []
    position = 0
    for match in TOKEN_RE.finditer(text or ""):
        parts.append(escape(text[position:match.start()]))
        parts.append('<span class="blank inline">&nbsp;</span>')
        position = match.end()
    parts.append(escape((text or "")[position:]))
    return "".join(parts)


def _style(block: dict) -> str:
    size = _num(block.get("font_size"), 12)
    if size < 8 or size > 24:
        size = 12
    align = str(block.get("align") or "left")
    if align not in {"left", "center", "right"}:
        align = "left"
    weight = 700 if block.get("bold") else 400
    font_style = "italic" if block.get("italic") else "normal"
    return f"font-size:{size}pt;text-align:{align};font-weight:{weight};font-style:{font_style}"


def _is_title(line: str) -> bool:
    return bool(line) and len(line) <= 90 and "{" not in line and _classify(line) == "text"


def _classify(line: str) -> str:
    if BARE_RE.match(line):
        return "bare"
    if FIELD_RE.match(line):
        return "field"
    filled = FILLED_RE.match(line)
    if filled and "{" not in filled.group(2) and ":" not in filled.group(2):
        return "filled"
    return "text"


def _field(line: str) -> dict:
    bare = BARE_RE.match(line)
    if bare:
        token = bare.group(1)
        return {
            "label": FIELD_LABELS.get(token, token),
            "token": token,
            "bare": True,
            "literal": False,
            "value": "",
        }
    token_line = FIELD_RE.match(line)
    if token_line:
        return {
            "label": token_line.group(1).strip(),
            "token": token_line.group(2),
            "bare": False,
            "literal": False,
            "value": "",
        }
    filled = FILLED_RE.match(line)
    label = (filled.group(1) if filled else line).strip()
    value = (filled.group(2) if filled else "").strip()
    return {
        "label": label,
        "token": LABEL_TOKENS.get(label.lower(), ""),
        "bare": False,
        "literal": True,
        "value": value,
    }


def _framed(items: list[dict]) -> bool:
    for item in items:
        if item["token"] in _FRAME_TOKENS:
            return True
        label = item["label"].lower()
        if label in {"должник", "ответчик", "адрес"} or label.startswith("адрес"):
            return True
    return False


def _num(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
