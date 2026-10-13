"""Макет печатной формы и одна подпись комплекта."""

from pathlib import Path

import pytest

from apps.debts.models import ClaimCase
from apps.debts.services.bnp_package import (
    generate_from_form,
    stamp_package_signatures,
    update_document_text,
)
from apps.nsi.models import PrintForm
from apps.nsi.services.form_layout import recognize_bytes

from .test_claims_scenarios import _ready


def test_text_labels_become_placeholders():
    raw = "Должник: Иванов И.И.\nЛицевой счёт: 00001001\nАдрес: ул. Примерная\n".encode()
    draft = recognize_bytes("zayavlenie.txt", raw)
    assert draft["recognized"] is True
    body = next(block["text"] for block in draft["blocks"] if block["key"] == "body")
    assert "{fio}" in body
    assert "{account}" in body
    assert "{address}" in body


def test_broken_pdf_is_not_dumped_as_text():
    draft = recognize_bytes("zayavlenie.pdf", b"%PDF-1.4\n5 0 obj\n<< /Length 4 >>stream\nxxxx\nendstream")
    assert draft["recognized"] is False
    body = next(block["text"] for block in draft["blocks"] if block["key"] == "body")
    assert body == ""
    assert "%PDF" not in body


def test_warning_template_pdf_is_readable():
    found = list(Path(__file__).resolve().parents[3].glob("Шаблоны/**/Предупреждение о задолженности r99116.pdf"))
    assert found
    draft = recognize_bytes(found[0].name, found[0].read_bytes())
    assert draft["recognized"] is True
    body = next(block["text"] for block in draft["blocks"] if block["key"] == "body")
    assert "ПРЕДУПРЕЖДЕНИЕ" in body
    assert "В связи с наличием" in body
    assert "%PDF" not in body
    assert "endstream" not in body


def test_image_scan_stays_empty_draft():
    draft = recognize_bytes("blank.png", b"\x89PNG")
    assert draft["recognized"] is False
    assert draft["blocks"][0]["text"] == ""


@pytest.mark.django_db
def test_one_stamp_signs_package_and_edit_clears_it(api, specialist_a, account_a):
    case_id = _ready(api, specialist_a, account_a)
    form = PrintForm.objects.get(code="notary-application")
    case = ClaimCase.objects.get(pk=case_id)
    document = generate_from_form(case, specialist_a, form.id)
    package = stamp_package_signatures(case)
    signed = package.documents.get(pk=document.pk)
    assert signed.signature
    assert signed.signature_name.endswith(".pdf.p7s")

    update_document_text(case, document.pk, "Исправленный текст заявления")
    signed.refresh_from_db()
    assert not signed.signature
