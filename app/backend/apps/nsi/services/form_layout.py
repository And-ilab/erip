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
    if lower.endswith(".pdf"):
        laid = _letter_blocks(raw)
        if laid:
            return {
                "recognized": True,
                "note": "Черновик повторяет бланк: шапка в две колонки, заголовок по центру, дальше обычные абзацы. Проверьте и сохраните.",
                "blocks": laid,
                "name": _title(name),
            }
        text = _pdf_text(raw)
    else:
        text = _plain(raw.decode("utf-8", errors="ignore"))
    if not text:
        return {
            "recognized": False,
            "note": "В файле не найден текст. Поправьте макет вручную и сохраните.",
            "blocks": [_block("body", "Текст", "", 12, True)],
            "name": _title(name),
        }
    return {
        "recognized": True,
        "note": "Черновик разложен по полям. Проверьте макет и сохраните.",
        "blocks": [_block("body", "Текст", _tokens(text), 12, True, 12)],
        "name": _title(name),
    }


def _block(key: str, title: str, text: str, size: int, enabled: bool, y: int = 12, align: str = "left", x: int = 4, w: int = 92) -> dict:
    return {
        "key": key,
        "title": title,
        "enabled": enabled,
        "align": align,
        "bold": False,
        "italic": False,
        "font_size": size,
        "text": text,
        "columns": [],
        "rows": [],
        "x": x,
        "y": y,
        "w": w,
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
    return "\n".join(_token_line(line) for line in text.splitlines()).strip()


def _token_line(line: str) -> str:
    """Короткая строка «Подпись: значение» становится меткой. Абзац письма не трогаем."""
    if "{" in line or ":" not in line or len(line) > 80:
        return line
    head, sep, _tail = line.partition(":")
    if not sep or len(head.strip()) > 40:
        return line
    lowered = head.lower()
    for label, token in LABELS:
        if label in lowered:
            return f"{head.strip()}: {{{token}}}"
    return line


def _pdf_text(raw: bytes) -> str:
    lines = _positioned_lines(raw)
    if not lines:
        return ""
    text = "\n".join(line["text"] for line in lines)
    if "%PDF-" in text or "endstream" in text or "endobj" in text:
        return ""
    return text


def _letter_blocks(raw: bytes) -> list[dict] | None:
    """Письмо АИС: шапка слева и справа, заголовок по центру, абзацы без лесенки."""
    positioned = _positioned(raw)
    if not positioned:
        return None
    lines, width = positioned
    title_at = _title_index(lines, width)
    if title_at is None:
        return None
    left, right = _header_columns(lines[:title_at], width)
    body = _body_text(lines[title_at], lines[title_at + 1:])
    blocks = []
    if left:
        blocks.append(_block("block-1", "Шапка", "\n".join(_token_line(line) for line in left), 12, True, 12, x=4, w=48))
    if right:
        blocks.append(_block("block-2", "Адресат", "\n".join(_token_line(line) for line in right), 12, True, 12, align="right", x=52, w=44))
    blocks.append(_block("body", "Текст", body, 12, True, 80))
    return blocks


def _positioned(raw: bytes):
    lines = _positioned_lines(raw)
    if not lines:
        return None
    return lines, _page_width(raw)


def _page_width(raw: bytes) -> float:
    try:
        from io import BytesIO

        from pypdf import PdfReader

        box = PdfReader(BytesIO(raw)).pages[0].mediabox
        return float(box.width) or 595.0
    except Exception:
        return 595.0


def _positioned_lines(raw: bytes) -> list[dict]:
    try:
        from io import BytesIO

        from pypdf import PdfReader

        reader = PdfReader(BytesIO(raw))
    except Exception:
        return []
    lines: list[dict] = []
    for page in reader.pages:
        runs: list[dict] = []

        def visitor(text, _cm, tm, _font, font_size):
            cleaned = " ".join(str(text).replace("\xa0", " ").split())
            if cleaned:
                runs.append({"x": float(tm[4]), "y": float(tm[5]), "size": float(font_size or 10), "text": cleaned})

        try:
            page.extract_text(visitor_text=visitor)
        except Exception:
            continue
        lines.extend(_group_lines(runs))
    return lines


def _group_lines(runs: list[dict]) -> list[dict]:
    ordered = sorted(runs, key=lambda run: (-run["y"], run["x"]))
    grouped: list[dict] = []
    for run in ordered:
        if grouped and abs(grouped[-1]["y"] - run["y"]) <= 2.5:
            grouped[-1]["runs"].append(run)
            continue
        grouped.append({"y": run["y"], "runs": [run]})
    lines = []
    for group in grouped:
        runs = sorted(group["runs"], key=lambda run: run["x"])
        lines.append({
            "y": group["y"],
            "x": runs[0]["x"],
            "size": runs[0]["size"],
            "runs": runs,
            "text": _join_runs(runs),
        })
    return lines


def _join_runs(runs: list[dict]) -> str:
    parts: list[str] = []
    previous_end = None
    for run in runs:
        if parts and previous_end is not None and run["x"] > previous_end + (run["size"] or 10) * 0.35:
            parts.append(" ")
        parts.append(run["text"])
        previous_end = run["x"] + (run["size"] or 10) * 0.48 * len(run["text"])
    return " ".join("".join(parts).split())


def _title_index(lines: list[dict], width: float) -> int | None:
    for index, line in enumerate(lines):
        text = line["text"].strip()
        letters = [char for char in text if char.isalpha()]
        if len(text) < 4 or len(text) > 40 or len(letters) < 4:
            continue
        if any(char.islower() for char in letters):
            continue
        size = line["size"] or 10
        center = line["x"] + size * 0.5 * len(text) / 2
        if abs(center - width / 2) <= width * 0.2:
            return index
    return None


def _header_columns(lines: list[dict], width: float) -> tuple[list[str], list[str]]:
    middle = width * 0.55
    left: list[str] = []
    right: list[str] = []
    for line in lines:
        left_runs = [run for run in line["runs"] if run["x"] < middle]
        right_runs = [run for run in line["runs"] if run["x"] >= middle]
        if left_runs:
            left.append(_join_runs(left_runs))
        if right_runs:
            right.append(_join_runs(right_runs))
    return left, right


def _body_text(title: dict, lines: list[dict]) -> str:
    chunks = [title["text"].strip(), ""]
    if not lines:
        return title["text"].strip()
    margin = min(line["x"] for line in lines)
    paragraph: list[str] = []
    previous = None
    for line in lines:
        text = line["text"]
        gap = (previous["y"] - line["y"]) if previous else 0
        indented = line["x"] >= margin + 12
        new_paragraph = bool(paragraph) and (indented or gap > 16 or _new_sentence(paragraph[-1], text))
        if new_paragraph:
            chunks.append(" ".join(paragraph))
            chunks.append("")
            paragraph = []
        paragraph.append(text)
        previous = line
    if paragraph:
        chunks.append(" ".join(paragraph))
    return "\n".join(_token_line(line) if line else "" for line in chunks).strip()


def _new_sentence(previous: str, text: str) -> bool:
    tail = previous.rstrip()
    if not tail or tail[-1] not in ".!?":
        return False
    head = text.lstrip()
    return bool(head) and head[0].isupper()


def _plain(text: str) -> str:
    lines = []
    for line in text.replace("\x00", "").replace("\xa0", " ").splitlines():
        clean = " ".join(line.split())
        if clean:
            lines.append(clean)
    return "\n".join(lines).strip()


def _title(name: str) -> str:
    stem = (name or "Шаблон").rsplit(".", 1)[0].strip()
    return (stem or "Шаблон")[:250]
