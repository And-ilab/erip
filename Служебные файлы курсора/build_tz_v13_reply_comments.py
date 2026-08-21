#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка ERIP_TZ_v1.3.docx на основе
«ерип tz 1.1 коммы, ответы + исправления.docx»:

1) Ответы Исполнителя выносятся из исходных комментариев
   в отдельные reply-комментарии (w15:paraIdParent).
2) Принято замечание по переименованию «Договор» → «Услуги»
   (+ восстановление сломанной строки глоссария).
3) Общая оговорка о трёх способах интеграции (п. 4.2.10.0).
4) Дописаны ранее не описанные требования
   (дубли, возобновление, перманентность, холодный архив).
"""

from __future__ import annotations

import copy
import random
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from lxml import etree

ROOT = Path("/Users/nikita/Desktop/ERIP")
SRC = ROOT / "ерип tz 1.1 коммы, ответы + исправления.docx"
OUT = ROOT / "ERIP_TZ_v1.3.docx"
WORK = ROOT / "Служебные файлы курсора" / "_tz_v13_work"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"
W15 = "http://schemas.microsoft.com/office/word/2012/wordml"
W16CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"

ANSWER_MARKER = "Ответ Исполнителя:"
REPLY_AUTHOR = "Исполнитель"
REPLY_INITIALS = "И"

# Обновлённый ответ на замечание о переименовании «Договор» → «Услуги»
ANSWER_OVERRIDE = {
    "5": (
        "Принято. Термин переименован на «Услуги»; определение изложено "
        "в редакции Заказчика."
    ),
}

USLUGI_DEF = (
    "комплекс сервисов, ресурсов, которые оказываются/предоставляются "
    "плательщику ЖКУ, которые обеспечивают комфортное и безопасное "
    "использование жилого либо нежилого помещения."
)

INTEGRATION_WAYS = [
    (
        "Способы интеграционного взаимодействия. Взаимодействие ПМ со смежными "
        "системами (АИС «Расчет-ЖКУ», РУП «Белпочта», Белорусская нотариальная "
        "палата, АИС «ПРИС»/ОАИС и иные, указанные в п. 4.2.10) реализуется "
        "одним из следующих способов — в зависимости от технических и "
        "организационных возможностей стороны-владельца внешней системы:"
    ),
    (
        "(1) Регламентный файловый обмен (ручные/полуавтоматические выгрузки "
        "по согласованному шаблону и расписанию). Пример — интеграция с АИС "
        "«Расчет-ЖКУ»: сторона-источник формирует выгрузку по шаблону, файл "
        "помещается в согласованный каталог обмена, ПМ забирает файлы из "
        "каталога и обрабатывает их (см. 4.2.10.1)."
    ),
    (
        "(2) Программный интерфейс (API / веб-сервис) промышленного уровня — "
        "при наличии у внешней системы документированного и согласованного "
        "для использования интерфейса. Пример — интеграция с РУП «Белпочта» "
        "(см. 4.2.10.6)."
    ),
    (
        "(3) Автоматизированное взаимодействие через пользовательский "
        "веб-интерфейс внешней системы (в том числе личный кабинет) с "
        "применением фонового программного робота (RPA): штатный вход по "
        "учётным данным, предоставленным Заказчиком, навигация по "
        "интерфейсу и выгрузка/загрузка документов в объёме, доступном "
        "авторизованному пользователю. Пример — личный кабинет Белорусской "
        "нотариальной палаты (см. 4.2.10.3). Такой способ применяется "
        "исключительно при наличии технической возможности и в рамках "
        "легального доступа; он зависит от стабильности и правил работы "
        "внешнего интерфейса. При изменении интерфейса, введении "
        "ограничений на автоматизированный доступ либо иных технических "
        "препятствиях со стороны владельца внешней системы работоспособность "
        "данного способа может быть ограничена; в этом случае применяется "
        "резервный порядок (файловый обмен и/или ручная обработка) до "
        "согласования альтернативы."
    ),
]

# Тексты, которыми заменяется плейсхолдер в 4.2.4.2
MISSING_ENFORCEMENT = [
    (
        "Контроль на дублирующие действия пользователей. ПМ не допускает "
        "создания двух одинаковых сущностей либо заданий с пересекающимися "
        "лицевыми счетами разными пользователями (блокировка/отклонение "
        "повторного создания с уведомлением инициатора). Для исполнительных "
        "надписей дополнительно действует контроль: недопустимо создание "
        "более одного документа за один и тот же период по совпадающему "
        "(пересекающемуся) набору услуг по одному ЛС; если хотя бы одна "
        "услуга уже была задействована в исполнительной надписи за "
        "аналогичный период — создание новой надписи отклоняется."
    ),
]

RESUME_NOTE = (
    "Отметка о возобновлении (подключении) ранее отключённых услуг. "
    "Погашение задолженности (в том числе полное) не гарантирует "
    "автоматического возобновления предоставления услуг: факт оплаты "
    "отражается в ПМ по данным АИС «Расчет-ЖКУ», а решение/действие "
    "по возобновлению фиксируется отдельно (поставщиком услуги и/или "
    "специалистом) с указанием даты возобновления. При обнаружении "
    "расхождения «долг погашен — услуга фактически отключена» "
    "формируется уведомление ответственному специалисту для проверки "
    "необходимости возобновления (см. выше)."
)

PERMANENT_NOTE = (
    "Накопление информации по перманентным долгам. По каждому ЛС/должнику "
    "сохраняется история циклов «появление в должниках — погашение — "
    "повторное появление»: даже если задолженность была полностью "
    "погашена, а через несколько периодов плательщик снова попал в "
    "выгрузку должников, сведения о предыдущих эпизодах сохраняются "
    "и учитываются в анализе перманентности и приоритезации работы "
    "(в том числе при формировании целевого списка «перманентных должников»)."
)

ARCHIVE_NOTE = (
    "Возврат карточки из архивного («холодного») хранилища. Если первичная "
    "карточка задолженности/должника уже переведена в архивное («холодное») "
    "хранилище, то при новой выгрузке должников из АИС «Расчет-ЖКУ» по тому "
    "же идентификатору (ЛС/договор в контуре обслуживающей организации) "
    "карточка поднимается (реактивируется) из архива с сохранением истории; "
    "новая карточка по тому же объекту учёта не создаётся. Создание новой "
    "карточки допускается только при отсутствии архивной/оперативной записи "
    "по данному идентификатору."
)

BNP_SOFT = (
    "При отсутствии промышленного API взаимодействие с личным кабинетом БНП "
    "может быть организовано способом (3) п. 4.2.10.0 (фоновый программный "
    "робот в рамках легального доступа по учётным данным Заказчика) — "
    "при наличии технической возможности. Работоспособность данного способа "
    "зависит от условий и интерфейса БНП; при их изменении применяется "
    "резервный порядок обмена до согласования альтернативы."
)


def q(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}"


def hex8() -> str:
    return f"{random.randint(0, 0xFFFFFFFF):08X}"


def get_text(el: etree._Element) -> str:
    return "".join(el.itertext())


def set_run_text(p: etree._Element, text: str) -> None:
    """Replace all w:t in paragraph with a single text run, keep first rPr if any."""
    runs = p.findall(q(W, "r"))
    # keep annotationRef run if present
    keep_prefix = []
    content_runs = []
    for r in runs:
        if r.find(q(W, "annotationRef")) is not None:
            keep_prefix.append(r)
        else:
            content_runs.append(r)

    rPr = None
    if content_runs:
        rPr_el = content_runs[0].find(q(W, "rPr"))
        if rPr_el is not None:
            rPr = copy.deepcopy(rPr_el)

    for r in content_runs:
        p.remove(r)

    r = etree.SubElement(p, q(W, "r"))
    if rPr is not None:
        r.insert(0, rPr)
    t = etree.SubElement(r, q(W, "t"))
    if text.startswith(" ") or text.endswith(" ") or "  " in text:
        t.set(XML_SPACE, "preserve")
    t.text = text


def clone_paragraph_with_text(template: etree._Element, text: str) -> etree._Element:
    p = copy.deepcopy(template)
    # new paraId
    p.set(q(W14, "paraId"), hex8())
    p.set(q(W14, "textId"), hex8())
    # remove comment markers from clone
    for el in list(p):
        ln = etree.QName(el.tag).localname
        if ln in ("commentRangeStart", "commentRangeEnd"):
            p.remove(el)
        elif ln == "r" and el.find(q(W, "commentReference")) is not None:
            p.remove(el)
    # clear hyperlinks etc — keep simple runs
    # Rebuild content runs
    # Remove all runs that are not annotationRef
    for r in list(p.findall(q(W, "r"))):
        if r.find(q(W, "annotationRef")) is None:
            p.remove(r)
    # Also remove hyperlinks wrapping text
    for hl in list(p.findall(q(W, "hyperlink"))):
        p.remove(hl)

    # Take rPr from template's first content run if possible
    rPr = None
    for r in template.findall(q(W, "r")):
        if r.find(q(W, "commentReference")) is not None:
            continue
        if r.find(q(W, "annotationRef")) is not None:
            continue
        rp = r.find(q(W, "rPr"))
        if rp is not None:
            rPr = copy.deepcopy(rp)
            break

    r = etree.SubElement(p, q(W, "r"))
    if rPr is not None:
        r.insert(0, rPr)
    t = etree.SubElement(r, q(W, "t"))
    if text.startswith(" ") or text.endswith(" "):
        t.set(XML_SPACE, "preserve")
    t.text = text
    return p


def extract_answer_from_comment(comment: etree._Element) -> str | None:
    paras = comment.findall(q(W, "p"))
    answer_parts: list[str] = []
    answer_started = False
    for p in paras:
        text = get_text(p)
        if ANSWER_MARKER in text:
            answer_started = True
            idx = text.find(ANSWER_MARKER)
            rest = text[idx + len(ANSWER_MARKER) :].strip()
            # Keep full "Ответ Исполнителя: ..." as user requested not to change answers
            answer_parts.append(ANSWER_MARKER + (" " + rest if rest else ""))
            # If question and answer somehow in same para, we still only take answer part
            continue
        if answer_started:
            if text.strip():
                answer_parts.append(text.strip())
    if not answer_parts:
        return None
    return "\n".join(answer_parts).strip()


def strip_answers_from_comment(comment: etree._Element) -> str | None:
    """Remove answer paragraphs; return answer text. Also strip answer from mixed para."""
    answer = extract_answer_from_comment(comment)
    if not answer:
        return None

    paras = comment.findall(q(W, "p"))
    to_remove = []
    answer_seen = False
    for p in paras:
        text = get_text(p)
        if ANSWER_MARKER in text:
            # If marker not at start, keep question part
            idx = text.find(ANSWER_MARKER)
            before = text[:idx].strip()
            if before:
                # Keep only question in this paragraph
                # Preserve annotationRef
                ann = None
                for r in p.findall(q(W, "r")):
                    if r.find(q(W, "annotationRef")) is not None:
                        ann = copy.deepcopy(r)
                        break
                rPr = None
                for r in p.findall(q(W, "r")):
                    if r.find(q(W, "annotationRef")) is None and r.find(q(W, "rPr")) is not None:
                        rPr = copy.deepcopy(r.find(q(W, "rPr")))
                        break
                for child in list(p):
                    if etree.QName(child.tag).localname != "pPr":
                        # keep pPr
                        if child is not None and etree.QName(child.tag).localname == "pPr":
                            continue
                # simpler: clear non-pPr children and rebuild
                for child in list(p):
                    if etree.QName(child.tag).localname != "pPr":
                        p.remove(child)
                if ann is not None:
                    p.append(ann)
                r = etree.SubElement(p, q(W, "r"))
                if rPr is not None:
                    r.insert(0, rPr)
                t = etree.SubElement(r, q(W, "t"))
                t.text = before
            else:
                to_remove.append(p)
            answer_seen = True
            continue
        if answer_seen:
            to_remove.append(p)

    for p in to_remove:
        comment.remove(p)

    # Remove trailing empty paragraphs after cleanup (but keep at least one)
    paras = comment.findall(q(W, "p"))
    while len(paras) > 1 and not get_text(paras[-1]).strip():
        comment.remove(paras[-1])
        paras = comment.findall(q(W, "p"))

    return answer


def ensure_comment_para_ids(comment: etree._Element) -> str:
    """Ensure paragraphs have paraIds; return last paragraph paraId."""
    last = None
    for p in comment.findall(q(W, "p")):
        pid = p.get(q(W14, "paraId"))
        if not pid:
            pid = hex8()
            p.set(q(W14, "paraId"), pid)
            p.set(q(W14, "textId"), hex8())
        last = pid
    if last is None:
        # create empty para
        p = etree.SubElement(comment, q(W, "p"))
        last = hex8()
        p.set(q(W14, "paraId"), last)
        p.set(q(W14, "textId"), hex8())
        pPr = etree.SubElement(p, q(W, "pPr"))
        style = etree.SubElement(pPr, q(W, "pStyle"))
        style.set(q(W, "val"), "a8")
        r = etree.SubElement(p, q(W, "r"))
        rPr = etree.SubElement(r, q(W, "rPr"))
        rStyle = etree.SubElement(rPr, q(W, "rStyle"))
        rStyle.set(q(W, "val"), "a7")
        etree.SubElement(r, q(W, "annotationRef"))
    return last


def make_reply_comment(
    cid: str,
    answer_text: str,
    date: str,
    style_template: etree._Element | None,
) -> tuple[etree._Element, str]:
    """Create reply comment element; return (element, paraId)."""
    c = etree.Element(q(W, "comment"))
    c.set(q(W, "id"), cid)
    c.set(q(W, "author"), REPLY_AUTHOR)
    c.set(q(W, "date"), date)
    c.set(q(W, "initials"), REPLY_INITIALS)

    p = etree.SubElement(c, q(W, "p"))
    para_id = hex8()
    p.set(q(W14, "paraId"), para_id)
    p.set(q(W14, "textId"), hex8())

    # style from template if available
    if style_template is not None:
        pPr_src = style_template.find(q(W, "pPr"))
        if pPr_src is not None:
            p.append(copy.deepcopy(pPr_src))
        else:
            pPr = etree.SubElement(p, q(W, "pPr"))
            style = etree.SubElement(pPr, q(W, "pStyle"))
            style.set(q(W, "val"), "a8")
    else:
        pPr = etree.SubElement(p, q(W, "pPr"))
        style = etree.SubElement(pPr, q(W, "pStyle"))
        style.set(q(W, "val"), "a8")

    # annotationRef run
    r0 = etree.SubElement(p, q(W, "r"))
    rPr0 = etree.SubElement(r0, q(W, "rPr"))
    rStyle = etree.SubElement(rPr0, q(W, "rStyle"))
    rStyle.set(q(W, "val"), "a7")
    etree.SubElement(r0, q(W, "annotationRef"))

    # split answer by newlines into multiple paragraphs if needed
    lines = answer_text.split("\n")
    first = lines[0]
    r = etree.SubElement(p, q(W, "r"))
    t = etree.SubElement(r, q(W, "t"))
    if first.startswith(" ") or first.endswith(" "):
        t.set(XML_SPACE, "preserve")
    t.text = first

    last_para_id = para_id
    for line in lines[1:]:
        p2 = etree.SubElement(c, q(W, "p"))
        last_para_id = hex8()
        p2.set(q(W14, "paraId"), last_para_id)
        p2.set(q(W14, "textId"), hex8())
        if style_template is not None and style_template.find(q(W, "pPr")) is not None:
            p2.append(copy.deepcopy(style_template.find(q(W, "pPr"))))
        r2 = etree.SubElement(p2, q(W, "r"))
        t2 = etree.SubElement(r2, q(W, "t"))
        t2.text = line

    return c, last_para_id


def insert_reply_anchors(document: etree._Element, parent_id: str, reply_id: str) -> None:
    """Insert commentRange/Reference for reply next to parent anchors."""
    # Find commentReference for parent
    for ref in document.iter(q(W, "commentReference")):
        if ref.get(q(W, "id")) != parent_id:
            continue
        parent_run = ref.getparent()
        container = parent_run.getparent()
        kids = list(container)
        idx = kids.index(parent_run)

        # Insert after parent run:
        # commentRangeStart, commentRangeEnd, run with commentReference
        start = etree.Element(q(W, "commentRangeStart"))
        start.set(q(W, "id"), reply_id)
        end = etree.Element(q(W, "commentRangeEnd"))
        end.set(q(W, "id"), reply_id)
        run = etree.Element(q(W, "r"))
        # copy rPr from parent run if has CommentReference style
        rPr_src = parent_run.find(q(W, "rPr"))
        if rPr_src is not None:
            run.append(copy.deepcopy(rPr_src))
        else:
            rPr = etree.SubElement(run, q(W, "rPr"))
            rStyle = etree.SubElement(rPr, q(W, "rStyle"))
            rStyle.set(q(W, "val"), "a7")
        cref = etree.SubElement(run, q(W, "commentReference"))
        cref.set(q(W, "id"), reply_id)

        parent_run.addnext(run)
        parent_run.addnext(end)
        parent_run.addnext(start)
        return
    raise RuntimeError(f"commentReference for parent {parent_id} not found")


def update_comments_extended(
    ext_root: etree._Element,
    old_para_to_new: dict[str, str],
    new_entries: list[tuple[str, str | None]],
) -> None:
    """
    old_para_to_new: map old commentEx paraId -> new parent last paraId
    new_entries: list of (paraId, paraIdParent|None)
    """
    # Update existing
    for cex in ext_root.findall(q(W15, "commentEx")):
        pid = cex.get(q(W15, "paraId"))
        if pid in old_para_to_new:
            cex.set(q(W15, "paraId"), old_para_to_new[pid])

    # Add new
    for para_id, parent_id in new_entries:
        cex = etree.SubElement(ext_root, q(W15, "commentEx"))
        cex.set(q(W15, "paraId"), para_id)
        cex.set(q(W15, "done"), "0")
        if parent_id:
            cex.set(q(W15, "paraIdParent"), parent_id)


def add_comment_ids(ids_root: etree._Element, para_ids: list[str]) -> None:
    for para_id in para_ids:
        el = etree.SubElement(ids_root, q(W16CID, "commentId"))
        el.set(q(W16CID, "paraId"), para_id)
        el.set(q(W16CID, "durableId"), hex8())


def find_para_by_startswith(document: etree._Element, prefix: str) -> etree._Element | None:
    for p in document.iter(q(W, "p")):
        if get_text(p).strip().startswith(prefix):
            return p
    return None


def find_para_exact(document: etree._Element, text: str) -> etree._Element | None:
    for p in document.iter(q(W, "p")):
        if get_text(p).strip() == text:
            return p
    return None


def insert_after(anchor: etree._Element, new_elems: list[etree._Element]) -> None:
    node = anchor
    for el in new_elems:
        node.addnext(el)
        node = el


def replace_paragraph_text_keep_format(p: etree._Element, new_text: str) -> None:
    """Replace visible text in paragraph, keeping pPr and first rPr; drop comment markers carefully."""
    # If paragraph has comment markers, only replace text runs that are not comment refs
    pPr = p.find(q(W, "pPr"))
    markers = []
    for child in list(p):
        ln = etree.QName(child.tag).localname
        if ln in ("commentRangeStart", "commentRangeEnd"):
            markers.append(child)
        elif ln == "r" and child.find(q(W, "commentReference")) is not None:
            markers.append(child)
        elif ln == "r" and child.find(q(W, "annotationRef")) is not None:
            markers.append(child)

    rPr = None
    for r in p.findall(q(W, "r")):
        if r.find(q(W, "commentReference")) is not None:
            continue
        if r.find(q(W, "annotationRef")) is not None:
            continue
        rp = r.find(q(W, "rPr"))
        if rp is not None:
            rPr = copy.deepcopy(rp)
            break

    # Remove everything except pPr and markers (we'll re-append markers in order)
    for child in list(p):
        ln = etree.QName(child.tag).localname
        if ln == "pPr":
            continue
        p.remove(child)

    # Reconstruct: for glossary term with comments around empty range after text,
    # typical order was: text_run, commentStart, commentEnd, commentRef_run
    # We'll put: text_run, then markers in original relative order if we can
    r = etree.SubElement(p, q(W, "r"))
    if rPr is not None:
        r.insert(0, rPr)
    t = etree.SubElement(r, q(W, "t"))
    t.text = new_text
    for m in markers:
        p.append(m)


def fix_glossary(document: etree._Element) -> None:
    """Restore mashed glossary row; rename Договор → Услуги."""
    tables = document.findall(f".//{q(W, 'tbl')}")
    gloss = None
    for tbl in tables:
        rows = tbl.findall(q(W, "tr"))
        if not rows:
            continue
        c0 = "".join(rows[0].findall(q(W, "tc"))[0].itertext()).strip() if rows[0].findall(q(W, "tc")) else ""
        if c0 == "Термин" and any(
            "Начисляющая организация" in "".join(tr.itertext()) for tr in rows
        ):
            gloss = tbl
            break
    if gloss is None:
        raise RuntimeError("Glossary table not found")

    rows = gloss.findall(q(W, "tr"))
    nach_row = None
    dog_row = None
    for tr in rows:
        cells = tr.findall(q(W, "tc"))
        if not cells:
            continue
        term = "".join(
            (t.text or "") for t in cells[0].findall(f".//{q(W, 't')}")
        ).strip()
        # more reliable
        term = "".join(cells[0].findall(q(W, "p"))[0].itertext()).strip() if cells[0].findall(q(W, "p")) else ""
        if term.startswith("Начисляющая организация"):
            nach_row = tr
        if term == "Договор":
            dog_row = tr

    if nach_row is None or dog_row is None:
        raise RuntimeError("Required glossary rows not found")

    cells = nach_row.findall(q(W, "tc"))
    c1 = cells[1]
    paras = c1.findall(q(W, "p"))
    # Expected mashed: [def_nach, 'Обслуживающая...', def_obsl, 'Поставщик...', def_post, 'Услуги', def_usl]
    if len(paras) < 7:
        # already fixed? skip mash repair but still do rename
        print(f"WARN: expected mashed row with >=7 paras, got {len(paras)}")
        obsl_term = "Обслуживающая организация"
        obsl_def = (
            "организация, за которой в АИС «Расчет-ЖКУ» закреплены ЛС в зоне обслуживания "
            "(например, ЖЭС/РСЦ); определяет контур видимости данных в ПМ для пользователей, "
            "имеющих доступ к данной обслуживающей организации."
        )
        post_term = "Поставщик услуги"
        post_def = (
            "организация, фактически поставляющая коммунальный ресурс/услугу и выполняющая "
            "(при наличии оснований) отключение/возобновление; может совпадать или не совпадать "
            "с обслуживающей/начисляющей организацией. В ПМ получает задания на отключение."
        )
    else:
        obsl_term = get_text(paras[1]).strip()
        obsl_def = get_text(paras[2]).strip()
        post_term = get_text(paras[3]).strip()
        post_def = get_text(paras[4]).strip()
        # Remove extra paras from c1, keep only first
        for p in paras[1:]:
            c1.remove(p)

    # Template row = Лицевой счёт row (clean) or dog_row
    ls_row = None
    for tr in rows:
        cells = tr.findall(q(W, "tc"))
        if not cells:
            continue
        term = "".join(cells[0].findall(q(W, "p"))[0].itertext()).strip() if cells[0].findall(q(W, "p")) else ""
        if term.startswith("Лицевой счёт"):
            ls_row = tr
            break
    template_row = ls_row if ls_row is not None else dog_row

    def make_row(term: str, definition: str) -> etree._Element:
        tr = copy.deepcopy(template_row)
        # clear comments from clone
        for el in list(tr.iter()):
            ln = etree.QName(el.tag).localname
            if ln in ("commentRangeStart", "commentRangeEnd"):
                parent = el.getparent()
                if parent is not None:
                    parent.remove(el)
            elif ln == "commentReference":
                run = el.getparent()
                if run is not None and run.getparent() is not None:
                    run.getparent().remove(run)
        tcells = tr.findall(q(W, "tc"))
        # set term
        tp = tcells[0].findall(q(W, "p"))[0]
        replace_paragraph_text_keep_format(tp, term)
        # ensure new paraIds
        for p in tr.findall(f".//{q(W, 'p')}"):
            p.set(q(W14, "paraId"), hex8())
            p.set(q(W14, "textId"), hex8())
        # set definition - only first para in cell1, remove extras
        c1paras = tcells[1].findall(q(W, "p"))
        replace_paragraph_text_keep_format(c1paras[0], definition)
        for extra in c1paras[1:]:
            tcells[1].remove(extra)
        return tr

    # Insert Обслуживающая and Поставщик after nach_row if missing as separate rows
    existing_terms = set()
    for tr in gloss.findall(q(W, "tr")):
        cells = tr.findall(q(W, "tc"))
        if not cells:
            continue
        ps = cells[0].findall(q(W, "p"))
        if ps:
            existing_terms.add(get_text(ps[0]).strip())

    insert_point = nach_row
    if obsl_term not in existing_terms:
        r = make_row(obsl_term, obsl_def)
        insert_point.addnext(r)
        insert_point = r
    if post_term not in existing_terms:
        r = make_row(post_term, post_def)
        insert_point.addnext(r)
        insert_point = r

    # Rename Договор → Услуги
    dog_cells = dog_row.findall(q(W, "tc"))
    term_p = dog_cells[0].findall(q(W, "p"))[0]
    # Keep comment markers on term cell
    # Current structure: run"Договор", commentStart, commentEnd, commentRef
    replace_paragraph_text_keep_format(term_p, "Услуги")
    def_p = dog_cells[1].findall(q(W, "p"))[0]
    replace_paragraph_text_keep_format(def_p, USLUGI_DEF)

    # Поставить строку «Услуги» сразу после «Поставщик услуги»
    post_row = None
    for tr in gloss.findall(q(W, "tr")):
        cells = tr.findall(q(W, "tc"))
        if not cells:
            continue
        ps = cells[0].findall(q(W, "p"))
        if ps and get_text(ps[0]).strip() == "Поставщик услуги":
            post_row = tr
            break
    if post_row is not None and dog_row.getparent() is not None:
        parent = dog_row.getparent()
        parent.remove(dog_row)
        post_row.addnext(dog_row)


def patch_document_body(document: etree._Element) -> dict[str, str]:
    """Apply textual TZ edits. Returns map of insertion descriptions."""
    placements: dict[str, str] = {}

    # --- Integration ways after 4.2.10.0 header block ---
    # Insert after "Для каждой интеграции фиксируется..."
    anchor = find_para_by_startswith(document, "Для каждой интеграции фиксируется")
    if anchor is None:
        raise RuntimeError("Integration anchor not found")
    new_paras = [clone_paragraph_with_text(anchor, t) for t in INTEGRATION_WAYS]
    insert_after(anchor, new_paras)
    placements["integration_ways"] = (
        "п. 4.2.10.0 «Общие положения и принципы интеграционного взаимодействия» "
        "(после абзаца «Для каждой интеграции фиксируется...»)"
    )

    # Soft note in BNP section
    bnp = find_para_by_startswith(
        document, "Точный программный интерфейс личного кабинета БНП"
    )
    if bnp is not None:
        insert_after(bnp, [clone_paragraph_with_text(bnp, BNP_SOFT)])
        placements["bnp_robot"] = (
            "п. 4.2.10.3 «Интеграция с Белорусской нотариальной палатой» "
            "(после абзаца о программном интерфейсе ЛК БНП)"
        )

    # --- Replace placeholder in 4.2.4.2 ---
    ph = find_para_exact(
        document, "Не описаны в ТЗ, но имеют значение в жизненном цикле документов на взыскание."
    )
    if ph is None:
        ph = find_para_by_startswith(document, "Не описаны в ТЗ")
    if ph is None:
        raise RuntimeError("Placeholder paragraph not found")
    # Replace placeholder with first missing text, then add rest after
    replace_paragraph_text_keep_format(ph, MISSING_ENFORCEMENT[0])
    placements["duplicates_control"] = (
        "п. 4.2.4.2 «Исполнительные надписи» "
        "(вместо плейсхолдера «Не описаны в ТЗ...» — контроль дублей/пересечения услуг)"
    )

    # --- Resume note after disconnection mark paragraph ---
    disc = find_para_by_startswith(document, "Отметка о фактическом отключении")
    if disc is None:
        raise RuntimeError("Disconnection paragraph not found")
    insert_after(disc, [clone_paragraph_with_text(disc, RESUME_NOTE)])
    placements["resume_note"] = (
        "п. 4.2.3.5 «Инициирование отключения услуг» "
        "(после абзаца об отметке фактического отключения/возобновления)"
    )

    # --- Permanent debts note ---
    perm = find_para_by_startswith(
        document, "Возможность формирования целевого списка «перманентных должников»"
    )
    if perm is None:
        raise RuntimeError("Permanent debt paragraph not found")
    insert_after(perm, [clone_paragraph_with_text(perm, PERMANENT_NOTE)])
    placements["permanent_note"] = (
        "п. 4.2.7.4 «Анализ перманентности задолженности» "
        "(после абзаца о целевом списке перманентных должников)"
    )

    # --- Archive reactivation note ---
    arch = find_para_by_startswith(document, "по истечении срока хранения — перевод в отдельное архивное")
    if arch is None:
        arch = find_para_by_startswith(document, "по истечении срока хранения")
    if arch is None:
        raise RuntimeError("Archive paragraph not found")
    insert_after(arch, [clone_paragraph_with_text(arch, ARCHIVE_NOTE)])
    placements["archive_note"] = (
        "раздел параметров хранения/архивации данных "
        "(после абзаца о переводе в архивное («холодное») хранилище) — "
        "реактивация карточки из архива при повторном появлении должника"
    )

    # Also reinforce in glossary definition of cold storage if short
    for p in document.iter(q(W, "p")):
        t = get_text(p).strip()
        if t.startswith("отдельное хранилище для данных, переводимых из «горячей» базы"):
            if "реактивир" not in t:
                replace_paragraph_text_keep_format(
                    p,
                    t.rstrip(".")
                    + "; при повторном появлении должника в выгрузке карточка "
                    "реактивируется из архива с сохранением истории (новая по тому же "
                    "идентификатору не создаётся).",
                )
                placements["archive_glossary"] = (
                    "глоссарий, термин «Архивное («холодное») хранилище» — уточнение "
                    "про реактивацию карточки"
                )
            break

    return placements


def split_comments_to_replies(
    comments_root: etree._Element,
    ext_root: etree._Element,
    ids_root: etree._Element,
    document: etree._Element,
) -> int:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    comments = comments_root.findall(q(W, "comment"))

    # Build map: current commentEx paraId -> comment element (by last para)
    # We'll update after stripping

    max_id = max(int(c.get(q(W, "id"))) for c in comments)
    next_id = max_id + 1

    # Existing ext paraIds
    ext_by_para = {
        cex.get(q(W15, "paraId")): cex for cex in ext_root.findall(q(W15, "commentEx"))
    }

    old_to_new_parent_para: dict[str, str] = {}
    new_ext_entries: list[tuple[str, str | None]] = []
    new_id_paras: list[str] = []
    created = 0

    # Process in document order of comments as listed
    for comment in list(comments):
        parent_cid = comment.get(q(W, "id"))
        raw_answer = strip_answers_from_comment(comment)
        if not raw_answer:
            continue

        # Override specific answers if needed
        if parent_cid in ANSWER_OVERRIDE:
            # Keep "Ответ Исполнителя: " prefix
            answer_text = ANSWER_MARKER + " " + ANSWER_OVERRIDE[parent_cid]
        else:
            answer_text = raw_answer
            # Ensure prefix present
            if not answer_text.startswith(ANSWER_MARKER):
                answer_text = ANSWER_MARKER + " " + answer_text

        # Old last para id from commentsExtended — find which ext entry belonged to this comment
        # Before strip, last para had the answer; after strip, last para is question.
        # Find ext entry that pointed to a paraId that was in this comment.
        # We'll compute old ids from remaining? Better: capture before strip.
        # Re-extract: we already stripped. So capture para ids differently.

        parent_last = ensure_comment_para_ids(comment)

        # Find and update the commentEx that previously pointed to any para of this comment
        # Since we removed answer paras, their paraIds may still be in commentsExtended.
        # Strategy: for each removed scenario — map ANY ext paraId that is NOT in any
        # remaining comment para to be updated when we know parent.

        style_tmpl = comment.find(q(W, "p"))
        reply_el, reply_para = make_reply_comment(
            str(next_id), answer_text, now, style_tmpl
        )
        # Insert reply comment immediately after parent in comments.xml
        comment.addnext(reply_el)

        insert_reply_anchors(document, parent_cid, str(next_id))

        # Update/create extended: parent_last is parent; reply_para parented to parent_last
        # We need to fix old commentEx that pointed to removed answer paraId.
        # Collect all paraIds currently in this parent comment
        parent_para_ids = {
            p.get(q(W14, "paraId")) for p in comment.findall(q(W, "p"))
        }

        new_ext_entries.append((reply_para, parent_last))
        new_id_paras.append(reply_para)

        # Remember to set parent's commentEx to parent_last
        # We'll fix orphaned ext entries in a second pass
        old_to_new_parent_para[parent_cid] = parent_last

        next_id += 1
        created += 1

    # Second pass: fix commentsExtended for parents
    # For each parent comment id we processed, find commentEx whose paraId is not
    # present in any comment (orphaned answer para) OR matches old answer — update to parent_last
    all_live_para_ids = set()
    for c in comments_root.findall(q(W, "comment")):
        for p in c.findall(q(W, "p")):
            pid = p.get(q(W14, "paraId"))
            if pid:
                all_live_para_ids.add(pid)

    # Map parent_cid -> parent_last
    parent_last_by_cid = old_to_new_parent_para

    # Also build paraId -> comment id for live paras
    para_to_cid = {}
    for c in comments_root.findall(q(W, "comment")):
        cid = c.get(q(W, "id"))
        for p in c.findall(q(W, "p")):
            pid = p.get(q(W14, "paraId"))
            if pid:
                para_to_cid[pid] = cid

    # Update orphaned commentEx paraIds to the corresponding parent_last
    # Problem: orphaned paraIds lost association to parent.cid.
    # Fix: before strip we should have recorded mapping. Let's re-do properly
    # by recording during strip.

    # Fallback approach: ensure every top-level (non-reply) comment has a commentEx
    # pointing to its last para. Remove orphaned commentEx entries that point to
    # dead paraIds and aren't parents of replies.

    existing_parent_paras = set()
    for cex in list(ext_root.findall(q(W15, "commentEx"))):
        pid = cex.get(q(W15, "paraId"))
        parent = cex.get(q(W15, "paraIdParent"))
        if pid not in all_live_para_ids and not parent:
            # orphaned parent pointer from old answer para — try to remap via nearby logic
            # Delete and recreate below
            ext_root.remove(cex)
        elif pid not in all_live_para_ids and parent:
            # shouldn't happen for new replies yet
            ext_root.remove(cex)

    # Ensure each non-reply comment has commentEx on last para
    reply_cids = set()
    # replies are those we just added with author Исполнитель — also detect via ext later
    for c in comments_root.findall(q(W, "comment")):
        if c.get(q(W, "author")) == REPLY_AUTHOR:
            reply_cids.add(c.get(q(W, "id")))

    live_ext_paras = {
        cex.get(q(W15, "paraId")) for cex in ext_root.findall(q(W15, "commentEx"))
    }

    for c in comments_root.findall(q(W, "comment")):
        cid = c.get(q(W, "id"))
        last = ensure_comment_para_ids(c)
        if last not in live_ext_paras:
            # add
            if cid in reply_cids:
                continue  # added via new_ext_entries
            cex = etree.SubElement(ext_root, q(W15, "commentEx"))
            cex.set(q(W15, "paraId"), last)
            cex.set(q(W15, "done"), "0")
            live_ext_paras.add(last)
        else:
            # already there
            pass

    # For parents that already had commentEx updated incorrectly — set paraId to last
    # Rebuild: for each non-reply comment, there must be exactly one commentEx without parent
    # pointing to its last para.
    for c in comments_root.findall(q(W, "comment")):
        cid = c.get(q(W, "id"))
        if cid in reply_cids:
            continue
        last = ensure_comment_para_ids(c)
        # find commentEx without parent that should represent this comment
        # If none points to last, update any orphan-free: create if missing
        found = False
        for cex in ext_root.findall(q(W15, "commentEx")):
            if cex.get(q(W15, "paraId")) == last and not cex.get(q(W15, "paraIdParent")):
                found = True
                break
        if not found:
            # maybe an old one points to something else for this comment - skip
            cex = etree.SubElement(ext_root, q(W15, "commentEx"))
            cex.set(q(W15, "paraId"), last)
            cex.set(q(W15, "done"), "0")

    # Add reply extended entries with correct parent
    for reply_para, parent_last in new_ext_entries:
        cex = etree.SubElement(ext_root, q(W15, "commentEx"))
        cex.set(q(W15, "paraId"), reply_para)
        cex.set(q(W15, "done"), "0")
        cex.set(q(W15, "paraIdParent"), parent_last)

    # Add commentIds for new reply paras
    existing_id_paras = {
        el.get(q(W16CID, "paraId")) for el in ids_root.findall(q(W16CID, "commentId"))
    }
    for para_id in new_id_paras:
        if para_id not in existing_id_paras:
            el = etree.SubElement(ids_root, q(W16CID, "commentId"))
            el.set(q(W16CID, "paraId"), para_id)
            el.set(q(W16CID, "durableId"), hex8())

    # Also ensure parent last paras have commentId entries
    for c in comments_root.findall(q(W, "comment")):
        last = ensure_comment_para_ids(c)
        if last not in existing_id_paras and last not in new_id_paras:
            # check again
            live_ids = {
                el.get(q(W16CID, "paraId")) for el in ids_root.findall(q(W16CID, "commentId"))
            }
            if last not in live_ids:
                el = etree.SubElement(ids_root, q(W16CID, "commentId"))
                el.set(q(W16CID, "paraId"), last)
                el.set(q(W16CID, "durableId"), hex8())

    # Deduplicate commentEx by paraId (keep first)
    seen = set()
    for cex in list(ext_root.findall(q(W15, "commentEx"))):
        pid = cex.get(q(W15, "paraId"))
        if pid in seen:
            ext_root.remove(cex)
        else:
            seen.add(pid)

    return created


def split_comments_to_replies_v2(
    comments_root: etree._Element,
    ext_root: etree._Element,
    ids_root: etree._Element,
    document: etree._Element,
) -> int:
    """Cleaner implementation: record old paraIds before strip."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    created = 0
    max_id = max(int(c.get(q(W, "id"))) for c in comments_root.findall(q(W, "comment")))
    next_id = max_id + 1

    # Index commentEx by paraId
    ext_by_para = {
        cex.get(q(W15, "paraId")): cex
        for cex in ext_root.findall(q(W15, "commentEx"))
    }

    for comment in list(comments_root.findall(q(W, "comment"))):
        parent_cid = comment.get(q(W, "id"))

        # Record all para ids before strip
        before_paras = comment.findall(q(W, "p"))
        before_ids = [p.get(q(W14, "paraId")) for p in before_paras]
        # The commentsExtended typically points to the LAST paragraph
        old_ext_para = before_ids[-1] if before_ids else None

        raw_answer = strip_answers_from_comment(comment)
        if not raw_answer:
            continue

        if parent_cid in ANSWER_OVERRIDE:
            answer_text = ANSWER_MARKER + " " + ANSWER_OVERRIDE[parent_cid]
        else:
            answer_text = raw_answer
            if not answer_text.startswith(ANSWER_MARKER):
                answer_text = ANSWER_MARKER + " " + answer_text

        parent_last = ensure_comment_para_ids(comment)

        # Update or create parent commentEx
        if old_ext_para and old_ext_para in ext_by_para:
            cex = ext_by_para[old_ext_para]
            cex.set(q(W15, "paraId"), parent_last)
            # update index
            del ext_by_para[old_ext_para]
            ext_by_para[parent_last] = cex
            # also fix commentsIds if needed
            for el in ids_root.findall(q(W16CID, "commentId")):
                if el.get(q(W16CID, "paraId")) == old_ext_para:
                    el.set(q(W16CID, "paraId"), parent_last)
        else:
            # ensure commentEx exists for parent
            if parent_last not in ext_by_para:
                cex = etree.SubElement(ext_root, q(W15, "commentEx"))
                cex.set(q(W15, "paraId"), parent_last)
                cex.set(q(W15, "done"), "0")
                ext_by_para[parent_last] = cex

        style_tmpl = comment.find(q(W, "p"))
        reply_el, reply_para = make_reply_comment(
            str(next_id), answer_text, now, style_tmpl
        )
        comment.addnext(reply_el)
        insert_reply_anchors(document, parent_cid, str(next_id))

        # reply commentEx
        cex_r = etree.SubElement(ext_root, q(W15, "commentEx"))
        cex_r.set(q(W15, "paraId"), reply_para)
        cex_r.set(q(W15, "done"), "0")
        cex_r.set(q(W15, "paraIdParent"), parent_last)
        ext_by_para[reply_para] = cex_r

        # reply commentId
        el = etree.SubElement(ids_root, q(W16CID, "commentId"))
        el.set(q(W16CID, "paraId"), reply_para)
        el.set(q(W16CID, "durableId"), hex8())

        # ensure parent last has commentId
        id_paras = {
            e.get(q(W16CID, "paraId")) for e in ids_root.findall(q(W16CID, "commentId"))
        }
        if parent_last not in id_paras:
            elp = etree.SubElement(ids_root, q(W16CID, "commentId"))
            elp.set(q(W16CID, "paraId"), parent_last)
            elp.set(q(W16CID, "durableId"), hex8())

        next_id += 1
        created += 1

    # Deduplicate commentEx
    seen = set()
    for cex in list(ext_root.findall(q(W15, "commentEx"))):
        pid = cex.get(q(W15, "paraId"))
        if pid in seen:
            ext_root.remove(cex)
        else:
            seen.add(pid)

    return created


def write_docx(work: Path, out: Path) -> None:
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z_out:
        for path in sorted(work.rglob("*")):
            if path.is_file():
                z_out.write(path, path.relative_to(work).as_posix())


def main() -> None:
    random.seed(13)
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)

    with zipfile.ZipFile(SRC, "r") as z:
        z.extractall(WORK)

    document = etree.parse(WORK / "word" / "document.xml")
    comments = etree.parse(WORK / "word" / "comments.xml")
    ext = etree.parse(WORK / "word" / "commentsExtended.xml")
    ids = etree.parse(WORK / "word" / "commentsIds.xml")

    doc_root = document.getroot()
    com_root = comments.getroot()
    ext_root = ext.getroot()
    ids_root = ids.getroot()

    # 1) Body/content edits first (glossary, integration, missing)
    fix_glossary(doc_root)
    placements = patch_document_body(doc_root)

    # 2) Split answers into reply comments
    n = split_comments_to_replies_v2(com_root, ext_root, ids_root, doc_root)

    # Write XML back
    for tree, name in [
        (document, "document.xml"),
        (comments, "comments.xml"),
        (ext, "commentsExtended.xml"),
        (ids, "commentsIds.xml"),
    ]:
        tree.write(
            WORK / "word" / name,
            xml_declaration=True,
            encoding="UTF-8",
            standalone=True,
        )

    write_docx(WORK, OUT)

    print(f"Wrote {OUT}")
    print(f"Reply comments created: {n}")
    print("Placements:")
    for k, v in placements.items():
        print(f"  - {k}: {v}")


if __name__ == "__main__":
    main()
