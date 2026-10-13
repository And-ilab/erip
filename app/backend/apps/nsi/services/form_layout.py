"""Макет печатной формы: блоки с флажками и черновик разбора скана."""

from __future__ import annotations

BLOCK_KEYS = ("logo", "requisites", "body", "signatory", "table")
ALIGNS = {"left", "center", "right"}
LABELS = (
    ("должник", "fio"),
    ("заявитель", "organization"),
    ("организац", "organization"),
    ("лицевой сч", "account"),
    ("адрес", "address"),
    ("идентификац", "personal_id"),
    ("унп", "unp"),
    ("задолжен", "amount"),
    ("исходящее сальдо", "amount"),
    ("пен", "penalty"),
    ("тариф", "tariff"),
    ("услуг", "services"),
    ("группа", "debt_group"),
    ("рейтинг", "rating"),
    ("вручен", "warning_date"),
)


def default_blocks(form) -> list[dict]:
    size = form.font_size or 12
    rows = [
        ("logo", "Логотип", form.logo_text or "", bool(form.logo_text), 12),
        ("requisites", "Реквизиты", form.requisites or "", bool(form.requisites), 80),
        ("body", "Текст", form.body or "", True, 160),
        ("signatory", "Подпись", form.signatory or "", bool(form.signatory), 420),
    ]
    return [_block(key, title, text, size, enabled, y) for key, title, text, enabled, y in rows]


def blocks_of(form) -> list[dict]:
    raw = list(form.blocks or [])
    if not raw:
        return default_blocks(form)
    try:
        return clean_blocks(raw)
    except ValueError:
        return default_blocks(form)


def clean_blocks(raw) -> list[dict]:
    if not isinstance(raw, list) or not raw:
        raise ValueError("Макет — список блоков")
    if len(raw) > 12:
        raise ValueError("В макете не больше 12 блоков")
    cleaned = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError("Блок макета — объект")
        key = str(item.get("key") or f"block-{index + 1}")[:30]
        if key not in BLOCK_KEYS and not key.startswith("block-"):
            key = f"block-{index + 1}"
        text = str(item.get("text") or "")
        if len(text) > 20000:
            raise ValueError("Текст блока длиннее 20000 символов")
        try:
            size = int(item.get("font_size") or 12)
        except (TypeError, ValueError) as exc:
            raise ValueError("Размер шрифта — число") from exc
        if size < 8 or size > 24:
            raise ValueError("Размер шрифта от 8 до 24")
        align = str(item.get("align") or "left")
        if align not in ALIGNS:
            raise ValueError("Выравнивание: слева, по центру или справа")
        columns = _columns(item.get("columns") or [])
        rows = _rows(item.get("rows") or [], len(columns))
        cleaned.append({
            "key": key,
            "title": str(item.get("title") or "Блок")[:80],
            "enabled": bool(item.get("enabled", True)),
            "align": align,
            "bold": bool(item.get("bold")),
            "italic": bool(item.get("italic")),
            "font_size": size,
            "text": text,
            "columns": columns,
            "rows": rows,
            "x": _span(item.get("x"), 4, 0, 70),
            "y": _span(item.get("y"), 12 + index * 96, 0, 1600),
            "w": _span(item.get("w"), 92, 24, 100),
        })
    if not any(block["key"] == "body" for block in cleaned):
        raise ValueError("В макете нужен блок текста")
    return cleaned


def apply_blocks(form, blocks: list[dict]) -> None:
    form.blocks = blocks
    for block in blocks:
        if block["key"] == "body":
            form.body = block["text"]
        elif block["key"] == "logo":
            form.logo_text = block["text"][:250]
        elif block["key"] == "requisites":
            form.requisites = block["text"]
        elif block["key"] == "signatory":
            form.signatory = block["text"][:250]


def fill_blocks(blocks: list[dict], values: dict) -> list[dict]:
    filled = []
    for block in blocks:
        copy = dict(block)
        text = copy.get("text") or ""
        for key, value in values.items():
            text = text.replace("{" + key + "}", str(value))
        copy["text"] = text
        copy["rows"] = [[_fill_cell(cell, values) for cell in row] for row in (copy.get("rows") or [])]
        filled.append(copy)
    return filled


def recognize_bytes(name: str, raw: bytes) -> dict:
    """Черновик макета из файла. Картинка без текстового слоя не становится готовым шаблоном."""
    lower = (name or "").lower()
    if lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp")):
        return {
            "recognized": False,
            "note": "У изображения нет текстового слоя. Поправьте макет вручную и сохраните.",
            "blocks": [_block("body", "Текст", "", 12, True)],
            "name": _title(name),
        }
    text = _pdf_text(raw) if lower.endswith(".pdf") else raw.decode("utf-8", errors="ignore")
    text = text.replace("\x00", "").strip()
    if not text:
        return {
            "recognized": False,
            "note": "В файле не найден текст. Поправьте макет вручную и сохраните.",
            "blocks": [_block("body", "Текст", "", 12, True)],
            "name": _title(name),
        }
    body = _tokens(text)
    return {
        "recognized": True,
        "note": "Черновик разложен по полям. Проверьте макет и сохраните.",
        "blocks": [
            _block("body", "Текст", body, 12, True, 12),
            _block("signatory", "Подпись", "{organization}", 12, True, 280),
        ],
        "name": _title(name),
    }


def _block(key: str, title: str, text: str, size: int, enabled: bool, y: int = 12) -> dict:
    return {
        "key": key,
        "title": title,
        "enabled": enabled,
        "align": "left",
        "bold": False,
        "italic": False,
        "font_size": size,
        "text": text,
        "columns": [],
        "rows": [],
        "x": 4,
        "y": y,
        "w": 92,
    }


def _span(value, default: int, low: int, high: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return min(high, max(low, number))


def _columns(raw) -> list[dict]:
    if not isinstance(raw, list):
        raise ValueError("Колонки таблицы — список")
    if len(raw) > 12:
        raise ValueError("В таблице не больше 12 колонок")
    columns = []
    for item in raw:
        if isinstance(item, str):
            title, width = item, 20
        elif isinstance(item, dict):
            title = str(item.get("title") or "")
            try:
                width = int(item.get("width") or 20)
            except (TypeError, ValueError) as exc:
                raise ValueError("Ширина колонки — число") from exc
        else:
            raise ValueError("Колонка таблицы — название и ширина")
        if width < 8 or width > 80:
            raise ValueError("Ширина колонки от 8 до 80")
        columns.append({"title": title[:40], "width": width})
    return columns


def _rows(raw, width: int) -> list[list[str]]:
    if not isinstance(raw, list):
        raise ValueError("Строки таблицы — список")
    if len(raw) > 40:
        raise ValueError("В таблице не больше 40 строк")
    rows = []
    for row in raw:
        if not isinstance(row, list):
            raise ValueError("Строка таблицы — список ячеек")
        cells = [str(cell)[:80] for cell in row[:12]]
        if width and len(cells) > width:
            cells = cells[:width]
        rows.append(cells)
    return rows


def _fill_cell(cell, values: dict) -> str:
    text = str(cell)
    for key, value in values.items():
        text = text.replace("{" + key + "}", str(value))
    return text


def _tokens(text: str) -> str:
    lines = []
    for line in text.splitlines():
        lowered = line.lower()
        replaced = line
        for label, token in LABELS:
            if label in lowered and "{" not in line:
                head, sep, _tail = line.partition(":")
                if sep and label in head.lower():
                    replaced = f"{head.strip()}: {{{token}}}"
                break
        lines.append(replaced)
    return "\n".join(lines).strip()


def _pdf_text(raw: bytes) -> str:
    try:
        from io import BytesIO

        from pypdf import PdfReader

        reader = PdfReader(BytesIO(raw))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception:
        return raw.decode("utf-8", errors="ignore")


def _title(name: str) -> str:
    stem = (name or "Шаблон").rsplit(".", 1)[0].strip()
    return (stem or "Шаблон")[:250]
