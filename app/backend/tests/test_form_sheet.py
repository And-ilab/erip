"""Лист A4 печатной формы и сборка PDF."""

import pytest

from apps.debts.services.artifacts import render_layout_pdf
from apps.nsi.services.form_layout import clean_blocks
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


def test_word_like_formatting_and_table_column_widths_render_in_html():
    cleaned = clean_blocks([
        {
            "key": "custom-head",
            "title": "Шапка",
            "enabled": True,
            "align": "justify",
            "bold": True,
            "italic": True,
            "font_size": 16,
            "font_family": "Georgia",
            "text": "Текст блока с выбранным шрифтом",
            "columns": [
                {"title": "Колонка 1", "width": 75},
                {"title": "Колонка 2", "width": 25},
            ],
            "rows": [["Ячейка 1", "Ячейка 2"]],
            "x": 4,
            "y": 12,
            "w": 60,
        },
    ])
    assert cleaned[0]["font_family"] == "Georgia"
    assert cleaned[0]["font_size"] == 16
    assert cleaned[0]["bold"] is True
    assert cleaned[0]["italic"] is True
    assert cleaned[0]["align"] == "justify"
    html = render_form_html(cleaned)
    assert "Georgia" in html
    assert "font-size:16pt" in html
    assert "font-weight:700" in html
    assert "font-style:italic" in html
    assert "text-align:justify" in html
    assert 'style="width:75.0%"' in html
    assert 'style="width:25.0%"' in html


@pytest.mark.django_db
def test_custom_template_creation_and_blank_blocks(api, specialist_a):
    blank_resp = api(specialist_a).get("/api/v1/nsi/print-forms/blank-data/", {"blank": "warning"})
    assert blank_resp.status_code == 200
    assert len(blank_resp.json()["blocks"]) >= 4

    created = api(specialist_a).post(
        "/api/v1/nsi/print-forms/",
        {
            "name": "Мой собственный шаблон ЖЭС",
            "code": "",
            "doc_kind": "warning",
            "addressee": "debtor",
            "blocks": [
                {
                    "key": "custom-1",
                    "title": "Мой блок",
                    "enabled": True,
                    "align": "center",
                    "bold": True,
                    "italic": False,
                    "font_size": 14,
                    "font_family": "Arial",
                    "text": "Уважаемый {fio}, долг {amount}",
                    "columns": [{"title": "Услуга", "width": 60}, {"title": "Сумма", "width": 40}],
                    "rows": [["{services}", "{amount}"]],
                    "x": 4,
                    "y": 12,
                    "w": 92,
                },
            ],
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    data = created.json()
    assert data["code"].startswith("moy-sobstvennyy-shablon")
    assert data["blocks"][0]["font_family"] == "Arial"
    assert "Уважаемый {fio}" in data["body"]

