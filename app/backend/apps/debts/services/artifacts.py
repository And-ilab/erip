"""Файлы мероприятий: список для телефонии и предупреждение для печати."""

import csv
import io
from pathlib import Path

from datetime import date

from django.core.files.base import ContentFile

from apps.debts.models import Account, Measure
from apps.debts.services.contacts import choose_phone

WRIT_CHECKS = (
    ("debt", "Подтверждены сумма, пеня и период долга"),
    ("warning", "Предупреждение вручено, срок требования истёк"),
    ("ownership", "Проверен тип собственности для статей Жилищного кодекса"),
    ("package", "Сформирован пакет документов на исполнительную надпись"),
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


def _pdf_bytes(lines: list[str]) -> bytes:
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
    pdf.set_font("Body", size=12)
    for line in lines:
        pdf.multi_cell(pdf.epw, 8, line or " ")
    return bytes(pdf.output())


def _font_path() -> Path | None:
    candidates = [
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/TTF/DejaVuSans.ttf"),
    ]
    return next((path for path in candidates if path.is_file()), None)
