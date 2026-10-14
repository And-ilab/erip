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


def _sample(name: str) -> bytes:
    found = list(Path(__file__).resolve().parents[3].glob(f"Шаблоны/**/{name}"))
    assert found
    return found[0].read_bytes()


def test_warning_template_pdf_is_readable():
    draft = recognize_bytes("warning.pdf", _sample("Предупреждение о задолженности r99116.pdf"))
    assert draft["recognized"] is True
    blocks = {block["key"]: block for block in draft["blocks"]}
    assert "signatory" not in blocks
    assert blocks["block-1"]["y"] == blocks["block-2"]["y"]
    assert "Республика Беларусь" in blocks["block-1"]["text"]
    assert "Собственник" in blocks["block-2"]["text"]
    assert blocks["block-2"]["align"] == "right"
    body = blocks["body"]["text"]
    assert body.startswith("ПРЕДУПРЕЖДЕНИЕ")
    paragraph = next(line for line in body.splitlines() if line.startswith("В связи"))
    assert "№ 465." in paragraph
    assert "\n" not in paragraph
    assert "%PDF" not in body


def test_notice_template_keeps_paragraphs():
    draft = recognize_bytes("notice.pdf", _sample("Уведомление о задолженности (ст. 80, 87 ЖК) r99188.pdf"))
    blocks = {block["key"]: block for block in draft["blocks"]}
    assert "Республика Беларусь" in blocks["block-1"]["text"]
    assert "Собственник ИВАН ИВАНОВИЧ" in blocks["block-2"]["text"]
    body = blocks["body"]["text"]
    assert body.startswith("УВЕДОМЛЕНИЕ")
    paragraph = next(line for line in body.splitlines() if line.startswith("В связи"))
    assert "исполнительной надписи." in paragraph
    assert "адресу: г. Минск" in body
    assert not any(line.startswith("адресу:") for line in body.splitlines())


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
