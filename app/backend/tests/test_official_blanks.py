"""Бланки образцов: статичный текст остаётся, числа образца не подставляются."""

from datetime import date
from decimal import Decimal

import pytest

from apps.debts.models import ServiceDebtPeriod
from apps.nsi.services.official_blanks import (
    blank_context,
    context_for_account,
    context_for_blank,
    money_text,
    render_official_html,
    words_int,
)


def test_warning_keeps_the_statute_line_and_the_account_amount():
    ctx = blank_context("warning", values={
        "organization": "ТС «Тест»",
        "fio": "Иванов Иван",
        "address": "г. Минск, ул. Пример, 1",
        "amount": "10.00",
        "services": "Отопление",
        "due_days": "5",
        "date": "04.06.2026",
        "doc_number": "1",
    })
    html = render_official_html("warning", ctx)
    assert "ПРЕДУПРЕЖДЕНИЕ" in html
    assert "постановлением Совета Министров Республики Беларусь от 27.08.2025 № 465" in html
    assert "Иванов Иван" in html
    assert "10.00" in html
    assert "637.66" not in html
    assert "{fio}" not in html
    assert 'class="slot"' in html


def test_notices_keep_their_own_article():
    notice_137 = render_official_html("notice-137", blank_context("notice-137", values={"amount": "1.00"}))
    notice_80 = render_official_html("notice-80", blank_context("notice-80"))
    notice_86 = render_official_html("notice-86", blank_context("notice-86"))
    notice_tko = render_official_html("notice-tko", blank_context("notice-tko", values={"amount": "2.00"}))
    assert "статья 137" in notice_137 and "отчуждению" in notice_137
    assert "статьи 80, 87" in notice_80 and "выселение" in notice_80
    assert "статья 86" in notice_86 and "арендным жильем" in notice_86
    assert "твердыми коммунальными отходами" in notice_tko
    assert "отчуждению" not in notice_tko
    assert "758.53" not in notice_137


def test_reminder_has_postal_lines_and_totals():
    html = render_official_html("reminder", blank_context("reminder", values={
        "fio": "Военный я.",
        "account": "1230001",
        "principal": "643.81",
        "penalty": "8.48",
        "total": "652.29",
        "months_debt": "4",
    }))
    assert "НАПОМИНАНИЕ" in html
    assert "Куда:" in html and "Кому:" in html
    assert "1230001" in html
    assert "643.81" in html
    assert "Расчет пени" in html


def test_calculation_prints_only_the_periods_we_have():
    ctx = blank_context("calculation", values={
        "account": "00001001",
        "fio": "Иванов И.И.",
        "total": "18.32",
        "principal": "10.63",
        "penalty": "7.69",
    }, periods=[{
        "label": "период долга (срок оплаты): март 2026 (25.04.2026)",
        "services": [{
            "name": "Техническое обслуживание",
            "principal": "0.94",
            "penalty": "0.74",
            "total": "1.68",
        }],
        "principal": "0.94",
        "penalty": "0.74",
        "total": "1.68",
    }])
    html = render_official_html("calculation", ctx)
    assert "Расчёт задолженности по лицевому счету №" in html
    assert "ОАО «НКФО «ЕРИП»" in html
    assert "Наименование услуги" in html
    assert "Техническое обслуживание" in html
    assert "март 2026" in html
    assert "сентябрь 2025" not in html
    assert "435.53" not in html
    assert "белорусских рублей" in html


def test_money_words_follow_the_calculation_blank():
    assert words_int(435) == "четыреста тридцать пять"
    assert words_int(396) == "триста девяносто шесть"
    assert words_int(39) == "тридцать девять"
    assert words_int(12) == "двенадцать"
    assert words_int(1000) == "одна тысяча"
    assert words_int(2000) == "две тысячи"
    assert words_int(21000) == "двадцать одна тысяча"
    assert money_text(Decimal("2003.44")) == "2 003.44"
    assert money_text(Decimal("50.00")) == "50.00"


@pytest.mark.django_db
def test_account_context_uses_card_figures(account_a):
    account_a.acc_total_space = Decimal("50.00")
    account_a.account_address = "г. Минск, ул. Пример, д.1"
    account_a.save(update_fields=["acc_total_space", "account_address"])
    ServiceDebtPeriod.objects.create(
        organization=account_a.organization, account=account_a, service=account_a.services.get(),
        period=date(2026, 3, 1), principal=Decimal("80.00"), penalty=Decimal("4.00"),
        due_on=date(2026, 4, 25),
    )
    ctx = context_for_blank("calculation", account_a)
    assert ctx["values"]["account"] == "00001001"
    assert ctx["values"]["fio"] == "Иванов И.И."
    assert ctx["values"]["area"] == "50"
    assert ctx["pairs"][0]["rows"][0]["name"] == "Газ"
    assert ctx["pairs"][0]["rows"][0]["l_principal"] == "80.00"
    assert ctx["values"]["total"] == "84.00"
    assert ctx["values"]["penalty"] == "4.00"
    assert "сентябрь 2025" not in ctx["pairs"][0]["left_label"]
    assert "Иванов Иван Иванович" in ctx["residents"][0]["fio"]
    warning = context_for_blank("warning", account_a)
    assert "Газ" in warning["values"]["services"]
    assert warning["values"]["amount"] == "150.00"
