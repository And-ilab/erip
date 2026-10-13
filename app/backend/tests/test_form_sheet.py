"""Лист A4 печатной формы и сборка PDF."""

from apps.debts.services.artifacts import render_layout_pdf
from apps.nsi.services.form_sheet import parse_text, render_form_html, serialize_nodes

WARNING = (
    "Предупреждение о задолженности\n"
    "\n"
    "{organization}\n"
    "Должник: {fio}\n"
    "Лицевой счёт: {account}\n"
    "Адрес: {address}\n"
    "Услуги: {services}\n"
    "\n"
    "Задолженность: {amount}\n"
    "Пеня: {penalty}\n"
    "Просим погасить в течение {due_days} дней.\n"
    "Дата, которая учитывается в чек-листе, — дата вручения предупреждения."
)


def test_warning_sheet_round_trip():
    nodes = parse_text(WARNING, title=True)
    assert nodes[0]["kind"] == "title"
    assert any(node["kind"] == "fields" and node["framed"] for node in nodes)
    assert serialize_nodes(nodes) == WARNING


def test_filled_debtor_keeps_the_name():
    nodes = parse_text("Должник: Иванов И.И.", title=False)
    assert nodes[0]["kind"] == "fields"
    assert nodes[0]["items"][0]["token"] == "fio"
    assert nodes[0]["items"][0]["value"] == "Иванов И.И."
    assert serialize_nodes(nodes) == "Должник: Иванов И.И."


def test_sentence_with_two_amounts_stays_a_paragraph():
    line = "Задолженность по данным АИС: {amount}. Пеня: {penalty}."
    nodes = parse_text(line, title=False)
    assert nodes[0]["kind"] == "paragraph"
    assert serialize_nodes(nodes) == line


def test_html_sheet_has_frame_table_and_a4_page():
    blocks = [
        {
            "key": "body", "enabled": True, "align": "left", "bold": False, "italic": False,
            "font_size": 12, "y": 12,
            "text": "Предупреждение о задолженности\n\nДолжник: {fio}\nАдрес: {address}",
            "columns": [], "rows": [],
        },
        {
            "key": "table", "enabled": True, "align": "left", "font_size": 12, "y": 200,
            "text": "",
            "columns": [{"title": "Услуга", "width": 40}, {"title": "Сумма", "width": 20}],
            "rows": [["{services}", "{amount}"]],
        },
        {"key": "hidden", "enabled": False, "text": "СКРЫТО", "y": 300, "columns": [], "rows": []},
    ]
    html = render_form_html(blocks)
    assert "@page" in html and "A4" in html
    assert "Должник" in html and "Адрес" in html
    assert 'class="frame"' in html
    assert "<table" in html and "Услуга" in html
    assert 'class="blank"' in html
    assert "{fio}" not in html
    assert "СКРЫТО" not in html


def test_layout_pdf_uses_weasyprint_html(monkeypatch):
    seen = {}

    def fake(html):
        seen["html"] = html
        return b"%PDF-1.4 sheet"

    monkeypatch.setattr("apps.nsi.services.form_sheet.pdf_from_html", fake)
    payload = render_layout_pdf([
        {"key": "body", "enabled": True, "text": "Должник: {fio}", "font_size": 12, "align": "left", "columns": [], "rows": []},
    ])
    assert payload.startswith(b"%PDF")
    assert "Должник" in seen["html"]
    assert "A4" in seen["html"]


def test_layout_pdf_falls_back_without_weasyprint(monkeypatch):
    monkeypatch.setattr("apps.nsi.services.form_sheet.pdf_from_html", lambda html: None)
    payload = render_layout_pdf([
        {
            "key": "body", "enabled": True, "text": "Строка предупреждения", "font_size": 12,
            "align": "left", "bold": False, "italic": False, "columns": [], "rows": [], "x": 4, "y": 12, "w": 92,
        },
    ])
    assert payload.startswith(b"%PDF")
