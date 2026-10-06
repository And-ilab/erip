"""Файлы мероприятий: список для телефонии и предупреждение для печати."""

import csv
import io
from datetime import date
from pathlib import Path

from django.core.files.base import ContentFile

from apps.debts.models import Account, Measure, WritCheck
from apps.debts.services.contacts import choose_phone

WRIT_CHECKS = (
    ("debt", "Подтверждены сумма, пеня и период долга"),
    ("warning", "Предупреждение вручено, срок требования истёк"),
    ("ownership", "Проверен тип собственности для статей Жилищного кодекса"),
    ("package", "Сформирован пакет документов на исполнительную надпись"),
)


def ensure_writ_checks(account: Account) -> None:
    """Досоздаёт пункты чек-листа. Уже сохранённый код повторно не вставляется."""
    present = set(account.writ_checks.values_list("code", flat=True))
    for code, title in WRIT_CHECKS:
        if code in present:
            continue
        WritCheck.objects.get_or_create(
            account=account,
            code=code,
            defaults={"organization": account.organization, "title": title},
        )


def _text(value) -> str:
    if value is None or value == "":
        return ""
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def attach_call_file(measure: Measure, accounts: list[Account]) -> None:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(["Номер ЛС", "Телефон", "Шаблон", "Дата начала", "Дней", "Время с", "Время по"])
    for account in accounts:
        on_date = measure.started_on
        if isinstance(on_date, str):
            on_date = date.fromisoformat(on_date[:10])
        phone = choose_phone(account, on_date if isinstance(on_date, date) else None)
        writer.writerow([
            account.client_account,
            phone.value if phone else "",
            measure.template_name,
            _text(measure.started_on),
            measure.days or "",
            _text(measure.time_from),
            _text(measure.time_to),
        ])
    measure.artifact.save(f"call-{measure.pk}.csv", ContentFile(buffer.getvalue().encode("utf-8-sig")), save=True)


def attach_warning_pdf(measure: Measure, accounts: list[Account]) -> None:
    lines = [f"Предупреждение. Шаблон: {measure.template_name}", ""]
    for account in accounts:
        debt = account.balance_out if account.balance_out is not None else ""
        lines.append(f"ЛС {account.client_account}  {account.short_fio}  {account.account_address}  долг {debt}")
    payload = _pdf_bytes(lines)
    measure.artifact.save(f"warning-{measure.pk}.pdf", ContentFile(payload), save=True)


def _pdf_bytes(lines: list[str], font_size: int = 12, indent_mm: int = 0, outdent_mm: int = 0) -> bytes:
    size = font_size if 8 <= font_size <= 24 else 12
    font = _font_path()
    if font is not None:
        try:
            from fpdf import FPDF
        except ImportError:
            font = None
    if font is None:
        text = "\n".join(lines).encode("utf-8")
        return b"%PDF-1.4\n" + text
    pdf = FPDF()
    pdf.add_font("Body", "", str(font))
    pdf.add_page()
    pdf.set_font("Body", size=size)
    if indent_mm:
        pdf.set_left_margin(pdf.l_margin + min(indent_mm, 40))
    hang = min(max(outdent_mm, 0), 20)
    first = True
    for line in lines:
        if hang and first and line:
            pdf.set_x(max(pdf.l_margin - hang, 5))
        pdf.multi_cell(pdf.epw, max(size * 0.5, 6), line or " ")
        first = not line
    return bytes(pdf.output())


def _font_path() -> Path | None:
    candidates = [
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/TTF/DejaVuSans.ttf"),
    ]
    return next((path for path in candidates if path.is_file()), None)
