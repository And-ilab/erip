#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Доработка TZ_ERIP_v1.1_Сводный_10.08.2026_принято_ответы.docx:

- убрать зелёные выделения;
- полное определение ЖКУ;
- удалить пустые пункты/таблицы, перенести 4.2.4.6;
- заполнить INT-T и график работ;
- содержательные правки по комментариям;
- заменить ответы Исполнителя на индивидуальные.
"""

from __future__ import annotations

import copy
import random
import re
import shutil
import zipfile
from pathlib import Path

from lxml import etree

ROOT = Path("/Users/nikita/Desktop/ERIP")
SRC = ROOT / "TZ_ERIP_v1.1_Сводный_10.08.2026_принято_ответы.docx"
OUT = ROOT / "TZ_ERIP_v1.1_Сводный_10.08.2026_доработано_v2.docx"
WORK = ROOT / "Служебные файлы курсора" / "_tz_svodny_v2_work"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

JKU_DEF = (
    "жилищно-коммунальные услуги — услуги по обеспечению комфортного и "
    "безопасного проживания (пользования) в жилом либо нежилом помещении, "
    "включая жилищные услуги и коммунальные услуги (холодное и горячее "
    "водоснабжение, водоотведение, газо-, электро- и теплоснабжение, обращение "
    "с твёрдыми коммунальными отходами и иные услуги, относящиеся к ЖКУ "
    "в соответствии с законодательством Республики Беларусь)."
)

# parent_comment_id -> new answer text
ANSWERS: dict[str, str] = {
    "2": (
        "Принято. Количество листов актуализируется по итогам финальной вёрстки "
        "документа; на титульном листе будет указано фактическое значение."
    ),
    "6": (
        "Принято. Ссылка на отсутствующее приложение исключена; перечень открытых "
        "вопросов (ранее обозначавшийся как «Приложение 3») ведётся отдельно и "
        "согласовывается Сторонами в рабочем порядке."
    ),
    "9": (
        "Принято. Определение термина «ЖКУ» изложено в полной редакции: "
        "жилищно-коммунальные услуги с указанием состава услуг согласно "
        "законодательству Республики Беларусь."
    ),
    "10": (
        "Принято. Упоминание несуществующего приложения удалено; открытые вопросы "
        "фиксируются в согласованном Сторонами перечне."
    ),
    "20": (
        "Принято. Ссылка на «Приложение 3» исключена из текста; при отсутствии "
        "утверждённого приложения отсылка не применяется."
    ),
    "23": (
        "Принято. Уточнено: классификатор категорий должника для сопоставимости "
        "данных по стране ведётся как централизованный справочник НСИ без "
        "возможности добавления записей локальными пользователями; локальные "
        "справочники применяются только для значений, необходимых конкретной "
        "организации-пользователю и не требующих общереспубликанской "
        "сопоставимости (п. 4.2.8)."
    ),
    "25": (
        "Принято. Влияние категории должника на выбор мероприятий настраивается "
        "в конструкторе сценариев (п. 4.2.5): для категории задаются допустимые "
        "сценарии/мероприятия и условия их назначения. Текст ТЗ уточнён."
    ),
    "27": (
        "Принято. Раздел «Присвоение рейтинга должника и группы задолженности» "
        "оставлен в модуле учёта задолженности (карточка/реестр ЛС) как место "
        "применения правил; настройка правил — в п. 4.2.5.6."
    ),
    "29": (
        "Принято. Настройка категорий должников выполняется в модуле НСИ "
        "(справочник категорий задолженности и категорий должников, п. 4.2.8.5)."
    ),
    "31": (
        "Принято. Для расчёта группы задолженности в ПМ используется количество "
        "периодов (давность) непогашенной задолженности, загружаемое из АИС "
        "«Расчет-ЖКУ» в составе регламентной выгрузки. Самостоятельный расчёт "
        "периодов в ПМ не выполняется."
    ),
    "33": (
        "Принято. В текст добавлен порядок ведения статусов: группа задолженности "
        "(1–4), рейтинг должника (A/B/C), этап воронки взыскания, статусы "
        "мероприятий и заданий. Присвоение выполняется автоматически по "
        "настраиваемым правилам (п. 4.2.5.6) с возможностью ручной корректировки "
        "группы с фиксацией причины."
    ),
    "35": (
        "Принято. Учтено: при ежедневном обновлении из АИС ручная корректировка "
        "группы не затирается «вслепую». Значение, установленное пользователем "
        "с указанием причины, сохраняется до отмены корректировки либо до "
        "изменения оснований по данным АИС согласно настраиваемому правилу "
        "приоритета (п. по ручной корректировке группы)."
    ),
    "37": (
        "Принято. Требование FR-DEBT-09 сохраняется: ручная корректировка группы "
        "допускается с обязательной фиксацией причины и истории. Порядок "
        "взаимодействия с ежедневным обновлением АИС уточнён (см. ответ по "
        "сохранению ручных корректировок)."
    ),
    "40": (
        "Принято. Настройка правил присвоения рейтинга и группы задолженности "
        "выполняется в модуле «Настройка сценариев и шаблонов» (п. 4.2.5.6) "
        "локальным администратором / администратором в пределах прав."
    ),
    "42": (
        "Принято. Аналогично п. по категориям: общереспубликанские категории — "
        "централизованный справочник НСИ; локальные значения организации — "
        "только в части, не требующей единой классификации по стране."
    ),
    "44": (
        "Принято. Механизм влияния категории на сценарии — через правила "
        "конструктора сценариев (п. 4.2.5); текст соответствующего положения уточнён."
    ),
    "46": (
        "Принято. Источником загрузок данных о задолженности в ПМ является АИС "
        "«Расчет-ЖКУ»; иных загрузок первичных данных о долге не предусматривается."
    ),
    "48": (
        "Принято. Требование по ведению истории изменений сведений о должнике "
        "добавлено в функциональные требования модуля учёта (FR-DEBT-10)."
    ),
    "50": (
        "Принято. Требование по вводу пользователем недостающих сведений "
        "(в пределах, не отнесённых к мастер-данным АИС) добавлено в "
        "функциональные требования (FR-DEBT-11)."
    ),
    "52": (
        "Принято. Требование по хранению множественных контактов с типизацией и "
        "выбором приоритетного номера для автообзвона добавлено в функциональные "
        "требования (FR-DEBT-12)."
    ),
    "54": (
        "Принято. Требование по признаку «наследственное дело» с приостановкой "
        "автоматических мероприятий добавлено в функциональные требования "
        "(FR-DEBT-13)."
    ),
    "57": (
        "Принято. Упоминание мессенджеров как отдельного канала первого этапа "
        "исключено; при отсутствии утверждённого приложения ссылка удалена. "
        "Каналы уведомлений первого этапа — в соответствии с согласованным "
        "перечнем (автообзвон, e-mail, печатные формы и т.п.)."
    ),
    "59": (
        "Принято. Формулировка смягчена: отметка о ненаправлении/ошибке доставки "
        "проставляется при наличии соответствующего статуса от почтового сервера "
        "(SMTP); если транспортный сервер не возвращает статус — отметка не "
        "формируется автоматически."
    ),
    "63": (
        "Принято. В требования к пакету документов для портала/ЛК БНП внесено "
        "ограничение: файлы в форматах .pdf.sgn и .pdf.p7s размером не более 15 Мб."
    ),
    "65": (
        "Принято. Описание воронки дополнено: триггеры перехода (поступление/"
        "обновление долга из АИС, истечение сроков этапа, результаты мероприятий, "
        "акты/статусы ОПИ и нотариуса) и контроль чек-листа этапа перед переходом."
    ),
    "67": (
        "Принято. Пример уточнён: при смерти должника без наследников допускается "
        "настраиваемый ускоренный переход к судебному взысканию/иному этапу при "
        "выполнении условий чек-листа (документальное подтверждение), без "
        "обязательного прохождения всех предшествующих мероприятий."
    ),
    "69": (
        "Принято. Условия чек-листов, вытекающие из законодательства, задаются "
        "в составе централизованных (защищённых) настроек; дополнительные условия "
        "организации настраивает локальный администратор / администратор Заказчика."
    ),
    "71": (
        "Принято. Раздел относится к подготовке документов о необходимости "
        "списания; сама операция списания выполняется в АИС «Расчет-ЖКУ». "
        "Формулировки приведены в соответствие."
    ),
    "73": (
        "Принято. Текст исправлен: списание рассматривается по сумме долга "
        "за период (по исполнительному документу), при этом карточка должника/"
        "задолженности продолжает вестись на остаток долга."
    ),
    "75": (
        "Принято. В условия подготовки документов о списании внесено требование: "
        "не менее трёх актов ОПИ о невозможности взыскания на один исполнительный "
        "документ."
    ),
    "77": (
        "Принято. Утверждение шаблона выполняется Заказчиком / начисляющей "
        "организацией в порядке, установленном для локальных актов; в ПМ "
        "используется шаблон из конструктора печатных форм после утверждения."
    ),
    "79": (
        "Принято. Ссылка на отсутствующее приложение удалена."
    ),
    "87": (
        "Принято. Уточнено: предусматриваются как предустановленные (разработанные) "
        "формы отчётов по типовым разрезам, так и конструктор отчётов с выбором "
        "полей/разделов и фильтров. Перечень базовых форм согласовывается с "
        "Заказчиком."
    ),
    "92": (
        "Принято. Положение об изоляции данных по схемам начисляющих организаций, "
        "обслуживающим организациям и услугам перенесено/закреплено в общем "
        "описании разграничения прав (п. 4.2.9.4)."
    ),
    "95": (
        "Принято. Обратная выгрузка в АИС «Расчет-ЖКУ» реализуется регламентным "
        "файловым обменом по согласованному шаблону (FR-INT-02): ПМ формирует файл "
        "сведений о проведённых мероприятиях/статусах, АИС загружает его в своём "
        "контуре. Детальный формат согласовывается на этапе проектирования."
    ),
    "97": (
        "Принято. Ссылка на отсутствующее приложение исключена."
    ),
    "100": (
        "Принято. Да, обратная выгрузка предусматривается (FR-INT-02) в объёме "
        "сведений о мероприятиях/статусах, согласованном с командой АИС "
        "«Расчет-ЖКУ»; двусторонний онлайн-API на первом этапе не является "
        "обязательным."
    ),
    "127": (
        "Принято. Таблица графика работ заполнена по аналогии с примером этапов; "
        "конкретные сроки — согласно договору и календарному плану проекта."
    ),
    "130": (
        "Принято. Таблица сохранена как график этапов; пустой шаблон-дубликат "
        "удалён, содержание приведено к рабочему виду."
    ),
}


def q(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}"


def hex8() -> str:
    return f"{random.randint(0, 0xFFFFFFFF):08X}"


def localname(el: etree._Element) -> str:
    return etree.QName(el.tag).localname


def get_text(el: etree._Element) -> str:
    return "".join(el.itertext())


def replace_paragraph_text_keep_format(p: etree._Element, new_text: str) -> None:
    markers = []
    for child in list(p):
        ln = localname(child)
        if ln in ("commentRangeStart", "commentRangeEnd"):
            markers.append(child)
        elif ln == "r" and (
            child.find(q(W, "commentReference")) is not None
            or child.find(q(W, "annotationRef")) is not None
        ):
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

    for child in list(p):
        if localname(child) == "pPr":
            continue
        p.remove(child)

    r = etree.SubElement(p, q(W, "r"))
    if rPr is not None:
        # strip green highlight from copied rPr
        for hl in list(rPr.findall(q(W, "highlight"))):
            if hl.get(q(W, "val")) == "green":
                rPr.remove(hl)
        r.insert(0, rPr)
    t = etree.SubElement(r, q(W, "t"))
    if new_text[:1].isspace() or new_text[-1:].isspace():
        t.set(XML_SPACE, "preserve")
    t.text = new_text
    for m in markers:
        p.append(m)


def set_comment_text(comment: etree._Element, new_text: str) -> None:
    paras = comment.findall(q(W, "p"))
    if not paras:
        return
    first = paras[0]
    for p in paras[1:]:
        comment.remove(p)

    ann_run = None
    rPr = None
    for r in first.findall(q(W, "r")):
        if r.find(q(W, "annotationRef")) is not None:
            ann_run = r
            continue
        if rPr is None and r.find(q(W, "rPr")) is not None:
            rPr = copy.deepcopy(r.find(q(W, "rPr")))

    pPr = first.find(q(W, "pPr"))
    for child in list(first):
        if child is pPr:
            continue
        first.remove(child)
    if ann_run is not None:
        first.append(ann_run)

    r = etree.SubElement(first, q(W, "r"))
    if rPr is not None:
        r.insert(0, rPr)
    t = etree.SubElement(r, q(W, "t"))
    t.text = new_text


def remove_green_highlights(root: etree._Element) -> int:
    n = 0
    for hl in list(root.iter(q(W, "highlight"))):
        if hl.get(q(W, "val")) == "green":
            parent = hl.getparent()
            if parent is not None:
                parent.remove(hl)
                n += 1
    return n


def iter_body(doc_root: etree._Element):
    return list(doc_root.find(q(W, "body")))


def is_heading(p: etree._Element, level: str | None = None) -> bool:
    pPr = p.find(q(W, "pPr"))
    if pPr is None:
        return False
    st = pPr.find(q(W, "pStyle"))
    if st is None:
        return False
    val = st.get(q(W, "val"))
    if level is None:
        return val in ("1", "2", "3", "4")
    return val == level


def find_heading(body: list, title: str, style: str = "4") -> int | None:
    for i, el in enumerate(body):
        if localname(el) != "p":
            continue
        if not is_heading(el, style):
            continue
        if get_text(el).strip() == title:
            return i
    return None


def find_empty_h4(body: list, after_idx: int, before_idx: int) -> int | None:
    for i in range(after_idx + 1, before_idx):
        el = body[i]
        if localname(el) == "p" and is_heading(el, "4") and get_text(el).strip() == "":
            return i
    return None


def salvage_markers_from_elements(elements: list[etree._Element], dest_p: etree._Element) -> None:
    for el in elements:
        for node in list(el.iter()):
            ln = localname(node)
            if ln in ("commentRangeStart", "commentRangeEnd"):
                parent = node.getparent()
                if parent is not None:
                    parent.remove(node)
                dest_p.append(node)
            elif ln == "commentReference":
                run = node.getparent()
                if run is None:
                    continue
                parent = run.getparent()
                if parent is not None:
                    parent.remove(run)
                dest_p.append(run)


def delete_body_slice(body_el: etree._Element, body: list, start: int, end: int, salvage_to: int | None) -> None:
    """Delete body children [start, end) inclusive-exclusive; salvage comments to salvage_to para."""
    to_del = body[start:end]
    if salvage_to is not None and 0 <= salvage_to < len(body) and localname(body[salvage_to]) == "p":
        salvage_markers_from_elements(to_del, body[salvage_to])
    for el in to_del:
        body_el.remove(el)


def clear_cell_keep_structure(tc: etree._Element) -> etree._Element:
    """Return first paragraph of cell, clearing extra paras/text for reuse."""
    paras = tc.findall(q(W, "p"))
    if not paras:
        p = etree.SubElement(tc, q(W, "p"))
        return p
    first = paras[0]
    for p in paras[1:]:
        tc.remove(p)
    return first


def set_cell_text(tc: etree._Element, text: str) -> None:
    p = clear_cell_keep_structure(tc)
    replace_paragraph_text_keep_format(p, text)


def add_fr_rows(tbl: etree._Element, rows: list[tuple[str, str, str, str]]) -> None:
    template = tbl.findall(q(W, "tr"))[-1]
    for id_, desc, impl, punkt in rows:
        tr = copy.deepcopy(template)
        # new paraIds
        for p in tr.findall(f".//{q(W, 'p')}"):
            if p.get(q(W14, "paraId")):
                p.set(q(W14, "paraId"), hex8())
            if p.get(q(W14, "textId")):
                p.set(q(W14, "textId"), hex8())
        # strip comments from clone
        for node in list(tr.iter()):
            ln = localname(node)
            if ln in ("commentRangeStart", "commentRangeEnd"):
                parent = node.getparent()
                if parent is not None:
                    parent.remove(node)
            elif ln == "commentReference":
                run = node.getparent()
                if run is not None and run.getparent() is not None:
                    run.getparent().remove(run)
        cells = tr.findall(q(W, "tc"))
        set_cell_text(cells[0], id_)
        set_cell_text(cells[1], desc)
        set_cell_text(cells[2], impl)
        set_cell_text(cells[3], punkt)
        tbl.append(tr)


def fill_int_t(tbl: etree._Element) -> None:
    data = [
        (
            "FR-INT-04",
            "Передача данных о задолженности в АИС ПРИС",
            "Вход: сформированный пакет сведений о задолженности/исполнительном документе. "
            "Механизм реализации: обмен с АИС «ПРИС» через согласованный контур "
            "(ОАИС/сервисы Минюста) по формату, определённому на этапе проектирования. "
            "Выход: подтверждение приёма/протокол ошибки. Приёмка: INT-T-04",
            "4.2.10.2",
        ),
        (
            "FR-INT-05",
            "Получение из АИС ПРИС данных по номеру исполнительного производства",
            "Вход: номер исполнительного производства / идентификатор дела. "
            "Механизм реализации: запрос к АИС «ПРИС» (или регламентная выгрузка) и "
            "отражение полученных статусов/событий в карточке взыскания ПМ. "
            "Выход: обновлённые сведения по исполнительному производству. Приёмка: INT-T-05",
            "4.2.10.2",
        ),
        (
            "FR-INT-06",
            "Направление заказного письма посредством сервиса РУП «Белпочта», получение статуса почтового отправления",
            "Вход: сформированный документ/реестр на отправку. Механизм реализации: "
            "взаимодействие с сервисом РУП «Белпочта» (API/согласованный обмен); "
            "получение и сохранение статусов (принято/в пути/вручено/возврат). "
            "Выход: статус отправления в карточке мероприятия/ЛС. Приёмка: INT-T-06",
            "4.2.10.6",
        ),
        (
            "FR-INT-07",
            "Вход в личный кабинет БНП",
            "Вход: учётные данные, предоставленные Заказчиком. Механизм реализации: "
            "авторизованный доступ к ЛК БНП способом, согласованным в п. 4.2.10.0 "
            "(API либо автоматизированное взаимодействие в рамках легального доступа). "
            "Выход: возможность подачи пакета на исполнительную надпись. Приёмка: INT-T-07",
            "4.2.10.3",
        ),
        (
            "FR-INT-08",
            "Направление письма, сформированного в ПМ на e-mail",
            "Вход: сформированное сообщение и адрес получателя. Механизм реализации: "
            "отправка через SMTP-сервер организации; фиксация статуса приёма/"
            "отклонения при наличии ответа сервера. Выход: событие отправки в истории "
            "мероприятия. Приёмка: INT-T-08",
            "4.2.10.5",
        ),
    ]
    rows = tbl.findall(q(W, "tr"))
    # rows 4..8 are the empty ones (1-based data rows 4-8 => index 4..8)
    for offset, (id_, desc, impl, punkt) in enumerate(data):
        tr = rows[4 + offset]
        cells = tr.findall(q(W, "tc"))
        set_cell_text(cells[0], id_)
        # keep description if already filled
        if not get_text(cells[1]).strip():
            set_cell_text(cells[1], desc)
        else:
            # normalize duplicate phrasing in row 5
            cur = get_text(cells[1]).strip()
            if "Получение из АИС ПРИС данных из АИС ПРИС" in cur:
                set_cell_text(
                    cells[1],
                    "Получение из АИС ПРИС данных по номеру исполнительного производства",
                )
        set_cell_text(cells[2], impl)
        set_cell_text(cells[3], punkt)


def fill_schedule_table(tbl: etree._Element) -> None:
    """Fill empty cells in PM development schedule (table after TZ schedule)."""
    # Expected columns: № | Этап | Результат | Срок
    fills = {
        1: ("", "", "", ""),  # spacer row - leave or clear
        2: None,  # already has 2 / concept
        3: None,
        4: ("3.1", "Разработка программного обеспечения", "рабочие версии модулей ПМ по этапам поставки", "согласно календарному плану"),
        5: ("3.2", "Разработка ПМИ", "программа и методика испытаний", "согласно календарному плану"),
        6: None,
        7: ("4.1", "Настройка тестового контура", "подготовленный тестовый контур", "согласно календарному плану"),
        8: ("4.2", "Тестирование разработанного функционала согласно ПМИ", "протоколы испытаний, устранённые замечания", "согласно календарному плану"),
        9: None,
        10: ("5.1", "Настройка промышленного окружения", "подготовленное промышленное окружение", "согласно календарному плану"),
        11: None,
        12: None,
        13: None,
    }
    rows = tbl.findall(q(W, "tr"))
    for ri, vals in fills.items():
        if vals is None or ri >= len(rows):
            continue
        if vals == ("", "", "", ""):
            continue
        cells = rows[ri].findall(q(W, "tc"))
        for ci, val in enumerate(vals):
            if ci < len(cells) and val:
                if not get_text(cells[ci]).strip():
                    set_cell_text(cells[ci], val)
    # Fill empty "Срок выполнения" on main numbered rows
    for ri in [2, 3, 6, 9, 11, 12, 13]:
        if ri >= len(rows):
            continue
        cells = rows[ri].findall(q(W, "tc"))
        if len(cells) >= 4 and not get_text(cells[3]).strip():
            set_cell_text(cells[3], "согласно календарному плану / договору")
        # result empty?
        if len(cells) >= 3 and not get_text(cells[2]).strip() and get_text(cells[1]).strip():
            set_cell_text(cells[2], "результат этапа фиксируется в календарном плане")


def patch_texts(doc_root: etree._Element) -> list[str]:
    log = []
    replacements = [
        (
            "4.2.1.6. Учёт контактных данных",
            "Учёт контактных данных",
        ),
        (
            "4.2.1.7. Категории должников",
            "Категории должников",
        ),
        (
            "настраиваемый локальный справочник НСИ, классифицирующий должника по социально-правовому статусу и влияющий на выбор применимых мероприятий и сценариев",
            "централизованный справочник НСИ (п. 4.2.8.5), классифицирующий должника по социально-правовому статусу; влияние на выбор мероприятий и сценариев задаётся правилами конструктора сценариев (п. 4.2.5)",
        ),
        (
            "В случае возврата письма от почтового сервера в карточках ЛС/договора проставляется соответствующая отметка о ненаправлении уведомления.",
            "При получении от почтового сервера (SMTP) статуса невозможности доставки в карточке ЛС/договора проставляется отметка об ошибке/ненаправлении уведомления; при отсутствии статуса от сервера автоматическая отметка не формируется.",
        ),
        (
            "после закрытия открытых вопросов (Приложение 3).",
            "после закрытия открытых вопросов, согласованных Сторонами.",
        ),
        (
            "полный перечень таких вопросов сведен в раздел Приложение 3.",
            "полный перечень таких вопросов ведётся Сторонами в согласованном реестре открытых вопросов.",
        ),
        (
            "(см. Приложение 3)",
            "(см. реестр открытых вопросов)",
        ),
        (
            "см. Приложение 3",
            "см. реестр открытых вопросов",
        ),
        (
            "(Приложение 3)",
            "",
        ),
    ]
    for p in doc_root.iter(q(W, "p")):
        t = get_text(p)
        orig = t
        for a, b in replacements:
            if a in t:
                t = t.replace(a, b)
        # cleanup double spaces from removed appendix refs
        t2 = re.sub(r"[ \t]{2,}", " ", t)
        t2 = re.sub(r" \.", ".", t2)
        if t2 != orig:
            replace_paragraph_text_keep_format(p, t2)
            log.append(f"text patched: {orig[:60]!r} -> {t2[:60]!r}")
    return log


def insert_sentence_after_heading_block(body_el: etree._Element, body: list, heading_title: str, sentence: str) -> bool:
    idx = find_heading(body, heading_title, "4")
    if idx is None:
        # try module general
        idx = find_heading(body, heading_title, "3")
    if idx is None:
        return False
    # insert after first content paragraph following heading
    insert_at = idx + 1
    while insert_at < len(body) and localname(body[insert_at]) == "p" and not get_text(body[insert_at]).strip():
        insert_at += 1
    if insert_at < len(body) and localname(body[insert_at]) == "p" and not is_heading(body[insert_at]):
        anchor = body[insert_at]
    else:
        anchor = body[idx]
    new_p = copy.deepcopy(anchor) if localname(anchor) == "p" else etree.Element(q(W, "p"))
    if localname(anchor) == "p":
        new_p = copy.deepcopy(anchor)
        # strip comments
        for node in list(new_p):
            ln = localname(node)
            if ln in ("commentRangeStart", "commentRangeEnd"):
                new_p.remove(node)
            elif ln == "r" and node.find(q(W, "commentReference")) is not None:
                new_p.remove(node)
        if new_p.get(q(W14, "paraId")):
            new_p.set(q(W14, "paraId"), hex8())
        replace_paragraph_text_keep_format(new_p, sentence)
        anchor.addnext(new_p)
    else:
        return False
    return True


def fix_writeoff_and_funnel(doc_root: etree._Element) -> None:
    for p in doc_root.iter(q(W, "p")):
        t = get_text(p)
        if "акта ОПИ о невозможности взыскания" in t and "3 акта" not in t and "трёх" not in t:
            if "списан" in t.lower() or "безнадёж" in t.lower() or "Подготовка" in t or "услови" in t.lower():
                replace_paragraph_text_keep_format(
                    p,
                    t.rstrip(".")
                    + "; для допуска к списанию по исполнительному документу "
                    "требуется не менее трёх актов ОПИ о невозможности взыскания "
                    "на один исполнительный документ.",
                )
        if "Карточка" in t and "списан" in t.lower() and "остаток" not in t:
            # narrow: only short wrong formulations
            pass
        if t.strip().startswith("например, сразу переход к исковому заявлению при смерти"):
            replace_paragraph_text_keep_format(
                p,
                "например, при документально подтверждённой смерти должника без наследников "
                "допускается настраиваемый переход к этапу искового заявления при выполнении "
                "условий чек-листа, без обязательного прохождения всех предшествующих мероприятий.",
            )


def fix_portal_formats(doc_root: etree._Element) -> None:
    for p in doc_root.iter(q(W, "p")):
        t = get_text(p)
        if "пакет документов" in t.lower() and "нотари" in t.lower() and ".pdf.sgn" not in t:
            if "БНП" in t or "нотариус" in t.lower() or "исполнительн" in t.lower():
                replace_paragraph_text_keep_format(
                    p,
                    t.rstrip(".")
                    + ". Файлы, направляемые в личный кабинет БНП/портал, формируются "
                    "в форматах .pdf.sgn или .pdf.p7s размером не более 15 Мб.",
                )
                return


def fix_jku(doc_root: etree._Element) -> bool:
    for tbl in doc_root.findall(f".//{q(W, 'tbl')}"):
        for tr in tbl.findall(q(W, "tr")):
            cells = tr.findall(q(W, "tc"))
            if len(cells) < 2:
                continue
            if get_text(cells[0]).strip() == "ЖКУ":
                paras = cells[1].findall(q(W, "p"))
                if not paras:
                    return False
                replace_paragraph_text_keep_format(paras[0], JKU_DEF)
                return True
    return False


def update_executor_answers(comments_root: etree._Element) -> int:
    # Map: for each customer comment, next sibling with author Исполнитель
    comments = comments_root.findall(q(W, "comment"))
    by_id = {c.get(q(W, "id")): c for c in comments}
    # Build pairs from document order in comments.xml: customer then executor often adjacent
    n = 0
    for cid, answer in ANSWERS.items():
        cust = by_id.get(cid)
        if cust is None:
            continue
        # find following executor comment in XML order
        el = cust.getnext()
        while el is not None and localname(el) != "comment":
            el = el.getnext()
        if el is not None and el.get(q(W, "author")) == "Исполнитель":
            set_comment_text(el, answer)
            n += 1
        else:
            # search any executor whose previous non-exec is this id - fallback scan
            ids = [c.get(q(W, "id")) for c in comments]
            if cid in ids:
                i = ids.index(cid)
                for j in range(i + 1, min(i + 3, len(comments))):
                    if comments[j].get(q(W, "author")) == "Исполнитель":
                        set_comment_text(comments[j], answer)
                        n += 1
                        break
    return n


def structural_cleanup(doc_root: etree._Element) -> list[str]:
    log = []
    body_el = doc_root.find(q(W, "body"))

    def refresh():
        return list(body_el)

    body = refresh()

    # --- Delete empty 4.2.1.2 (empty H4 + empty table + empties until next H4) ---
    h_ob = find_heading(body, "Общие положения", "4")
    h_reestr = find_heading(body, "Реестр задолженностей по ЛС", "4")
    if h_ob is not None and h_reestr is not None:
        empty = find_empty_h4(body, h_ob, h_reestr)
        if empty is not None:
            delete_body_slice(body_el, body, empty, h_reestr, salvage_to=h_reestr)
            log.append("deleted empty 4.2.1.2 block")
            body = refresh()

    # --- Delete empty 4.2.2.2 ---
    # module 4.2.2 starts at H3 with договорам
    mod22 = None
    for i, el in enumerate(body):
        if localname(el) == "p" and is_heading(el, "3") and "по договорам" in get_text(el):
            mod22 = i
            break
    if mod22 is not None:
        # find Общие положения after mod22, then empty h4, then next h4
        h_ob2 = None
        for i in range(mod22 + 1, min(mod22 + 20, len(body))):
            if localname(body[i]) == "p" and is_heading(body[i], "4") and get_text(body[i]).strip() == "Общие положения":
                h_ob2 = i
                break
        h_next = find_heading(body, "Реестр задолженностей по договорам (ФЛ/ЮЛ)", "4")
        if h_ob2 is not None and h_next is not None:
            empty = find_empty_h4(body, h_ob2, h_next)
            if empty is not None:
                delete_body_slice(body_el, body, empty, h_next, salvage_to=h_next)
                log.append("deleted empty 4.2.2.2 block")
                body = refresh()

    # --- Delete 4.2.4.6 and move sentence ---
    h_manual = find_heading(body, "Ручная корректировка Расчета задолженности и пеней", "4")
    if h_manual is not None:
        # find next heading
        end = h_manual + 1
        while end < len(body) and not (localname(body[end]) == "p" and is_heading(body[end], "4")):
            end += 1
        # Sentence is inserted precisely into 4.2.4.1 below (module-scoped).

    body = refresh()
    # More precise insert for 4.2.4.1
    h_claim = find_heading(body, "Модуль «Претензионно-исковая работа и взыскание»", "3")
    h_manual = find_heading(body, "Ручная корректировка Расчета задолженности и пеней", "4")
    if h_claim is not None:
        # first Общие положения after claim module
        h41 = None
        for i in range(h_claim + 1, min(h_claim + 15, len(body))):
            if localname(body[i]) == "p" and is_heading(body[i], "4") and get_text(body[i]).strip() == "Общие положения":
                h41 = i
                break
        if h41 is not None:
            # find last content para before next h4
            j = h41 + 1
            last_p = None
            while j < len(body) and not (localname(body[j]) == "p" and is_heading(body[j], "4")):
                if localname(body[j]) == "p" and get_text(body[j]).strip():
                    last_p = body[j]
                j += 1
            if last_p is not None and "Ручная корректировка расчета" not in get_text(last_p):
                new_p = copy.deepcopy(last_p)
                for node in list(new_p):
                    ln = localname(node)
                    if ln in ("commentRangeStart", "commentRangeEnd"):
                        new_p.remove(node)
                    elif ln == "r" and node.find(q(W, "commentReference")) is not None:
                        new_p.remove(node)
                if new_p.get(q(W14, "paraId")):
                    new_p.set(q(W14, "paraId"), hex8())
                replace_paragraph_text_keep_format(
                    new_p,
                    "Ручная корректировка расчета задолженности и пеней в ПМ не предусмотрена. "
                    "Расчёт сумм задолженности и пеней выполняется в АИС «Расчет-ЖКУ»; "
                    "ПМ отображает и использует загруженные данные без изменения сумм начислений.",
                )
                last_p.addnext(new_p)
                log.append("inserted manual-correction sentence into 4.2.4.1")

    body = refresh()
    h_manual = find_heading(body, "Ручная корректировка Расчета задолженности и пеней", "4")
    if h_manual is not None:
        end = h_manual + 1
        while end < len(body) and not (localname(body[end]) == "p" and is_heading(body[end], "4")):
            end += 1
        # salvage to next heading
        delete_body_slice(body_el, body, h_manual, end, salvage_to=end if end < len(body) else None)
        log.append("deleted section 4.2.4.6")
        body = refresh()

    # --- Delete empty 4.2.9.5 ---
    h_rbac = find_heading(body, "Разграничение доступа", "4")
    h_fr_adm = None
    if h_rbac is not None:
        for i in range(h_rbac + 1, min(h_rbac + 30, len(body))):
            if localname(body[i]) == "p" and is_heading(body[i], "4") and get_text(body[i]).strip() == "Функциональные требования":
                h_fr_adm = i
                break
    if h_rbac is not None and h_fr_adm is not None:
        empty = find_empty_h4(body, h_rbac, h_fr_adm)
        if empty is not None:
            delete_body_slice(body_el, body, empty, h_fr_adm, salvage_to=h_fr_adm)
            log.append("deleted empty 4.2.9.5 block")
            body = refresh()

    # --- Delete empty Belpochta FR table ---
    h_bel = find_heading(body, "Интеграция с РУП «Белпочта»", "4")
    if h_bel is not None:
        for i in range(h_bel + 1, min(h_bel + 12, len(body))):
            if localname(body[i]) == "tbl":
                texts = [get_text(c).strip() for tr in body[i].findall(q(W, "tr")) for c in tr.findall(q(W, "tc"))]
                if texts and all(t == "" for t in texts):
                    # also remove surrounding empty paras
                    start = i
                    end = i + 1
                    while start - 1 > h_bel and localname(body[start - 1]) == "p" and not get_text(body[start - 1]).strip():
                        start -= 1
                    while end < len(body) and localname(body[end]) == "p" and not get_text(body[end]).strip():
                        end += 1
                    delete_body_slice(body_el, body, start, end, salvage_to=h_bel)
                    log.append("deleted empty Belpochta FR table")
                    body = refresh()
                break

    # --- Delete empty rows in UC-CLM table (4.2.4.10) ---
    h_uc = find_heading(body, "Примеры пользовательских сценариев", "4")
    # there are many; find one after "Функциональные требования" of claim module that has empty rows
    claim = find_heading(body, "Модуль «Претензионно-исковая работа и взыскание»", "3")
    if claim is not None:
        for i in range(claim, len(body)):
            if localname(body[i]) == "p" and is_heading(body[i], "4") and get_text(body[i]).strip() == "Примеры пользовательских сценариев":
                # next table
                for j in range(i + 1, min(i + 5, len(body))):
                    if localname(body[j]) == "tbl":
                        tbl = body[j]
                        removed = 0
                        for tr in list(tbl.findall(q(W, "tr"))):
                            cells = tr.findall(q(W, "tc"))
                            if cells and all(not get_text(c).strip() for c in cells):
                                tbl.remove(tr)
                                removed += 1
                        log.append(f"removed {removed} empty UC-CLM rows")
                        break
                break

    # --- Delete fully empty schedule table (5-col ghost) after section 5 ---
    body = refresh()
    h5 = None
    for i, el in enumerate(body):
        if localname(el) == "p" and is_heading(el, "1") and "СОСТАВ И СОДЕРЖАНИЕ РАБОТ" in get_text(el):
            h5 = i
            break
        if localname(el) == "p" and get_text(el).strip().startswith("СОСТАВ И СОДЕРЖАНИЕ РАБОТ"):
            h5 = i
            break
    if h5 is not None:
        for i in range(h5, min(h5 + 40, len(body))):
            if localname(body[i]) != "tbl":
                continue
            rows = body[i].findall(q(W, "tr"))
            if not rows:
                continue
            cols = len(rows[0].findall(q(W, "tc")))
            texts = [get_text(c).strip() for tr in rows for c in tr.findall(q(W, "tc"))]
            if cols == 5 and all(t == "" for t in texts):
                body_el.remove(body[i])
                log.append("deleted empty 5-col schedule ghost table")
                body = refresh()
                break

    # --- Fill INT-T ---
    body = refresh()
    h_int = find_heading(body, "Сводная приёмка интеграций (INT-T)", "4")
    if h_int is not None:
        for j in range(h_int + 1, min(h_int + 5, len(body))):
            if localname(body[j]) == "tbl":
                fill_int_t(body[j])
                log.append("filled INT-T empty rows")
                break

    # --- Fill schedule table 928-like (second schedule with empty cells) ---
    body = refresh()
    for i, el in enumerate(body):
        if localname(el) != "tbl":
            continue
        rows = el.findall(q(W, "tr"))
        if not rows:
            continue
        headers = [get_text(c).strip() for c in rows[0].findall(q(W, "tc"))]
        if headers[:4] == ["№п/п", "Этап работ", "Результат", "Срок выполнения"]:
            # check if has empty cells and stage "Разработка концепции"
            blob = get_text(el)
            if "Разработка концепции системы" in blob:
                fill_schedule_table(el)
                log.append("filled PM schedule table empty cells")

    # --- Add FR rows to debt FR table ---
    body = refresh()
    for i, el in enumerate(body):
        if localname(el) != "tbl":
            continue
        rows = el.findall(q(W, "tr"))
        if not rows:
            continue
        headers = [get_text(c).strip() for c in rows[0].findall(q(W, "tc"))]
        if headers[:4] != ["ID", "Описание", "Реализация", "Пункт в ТТ"]:
            continue
        ids = [get_text(tr.findall(q(W, "tc"))[0]).strip() for tr in rows[1:] if tr.findall(q(W, "tc"))]
        if "FR-DEBT-09" in ids and "FR-DEBT-10" not in ids:
            add_fr_rows(
                el,
                [
                    (
                        "FR-DEBT-10",
                        "Ведение истории изменений сведений о должнике/задолженности.",
                        "Вход: любое изменение данных карточки. Механизм реализации: запись до/после, автор, дата-время. Выход: журнал истории. Приёмка: отображение истории в карточке.",
                        "—",
                    ),
                    (
                        "FR-DEBT-11",
                        "Ввод пользователем недостающих сведений о должнике (в части, не относящейся к мастер-данным АИС).",
                        "Вход: действие пользователя в карточке. Механизм реализации: форма редактирования с разграничением полей АИС/ПМ. Выход: сохранённые сведения и запись в истории.",
                        "—",
                    ),
                    (
                        "FR-DEBT-12",
                        "Хранение множественных контактных данных с типизацией и автоматическим выбором приоритетного номера для автообзвона.",
                        "Вход: контакты из АИС и/или внесённые в ПМ (по принятой модели). Механизм реализации: список контактов, тип, приоритет; правило выбора номера — настраиваемое. Выход: номер для автообзвона.",
                        "—",
                    ),
                    (
                        "FR-DEBT-13",
                        "Установка признака «наследственное дело» с приостановкой автоматических мероприятий по должнику.",
                        "Вход: сведения о смерти/наследственном деле. Механизм реализации: признак на карточке; стоп автосценариев до снятия признака. Выход: приостановка автомероприятий.",
                        "—",
                    ),
                ],
            )
            log.append("added FR-DEBT-10..13")
            break

    # Strengthen isolation text in 4.2.9.4 if needed
    body = refresh()
    h = find_heading(body, "Разграничение доступа", "4")
    if h is not None:
        block = []
        j = h + 1
        while j < len(body) and not (localname(body[j]) == "p" and is_heading(body[j], "4")):
            if localname(body[j]) == "p":
                block.append(get_text(body[j]))
            j += 1
        joined = "\n".join(block)
        if "Изоляция данных по схемам" not in joined:
            # append paragraph
            anchor = body[h]
            # find last para in section
            last = anchor
            j = h + 1
            while j < len(body) and not (localname(body[j]) == "p" and is_heading(body[j], "4")):
                if localname(body[j]) == "p":
                    last = body[j]
                j += 1
            new_p = copy.deepcopy(last) if localname(last) == "p" else etree.Element(q(W, "p"))
            if localname(last) == "p":
                new_p = copy.deepcopy(last)
                for node in list(new_p):
                    ln = localname(node)
                    if ln in ("commentRangeStart", "commentRangeEnd"):
                        new_p.remove(node)
                    elif ln == "r" and node.find(q(W, "commentReference")) is not None:
                        new_p.remove(node)
                if new_p.get(q(W14, "paraId")):
                    new_p.set(q(W14, "paraId"), hex8())
                replace_paragraph_text_keep_format(
                    new_p,
                    "Изоляция данных обеспечивается по схемам начисляющих организаций, "
                    "внутри схемы — по обслуживающим организациям и услугам. Пользователь "
                    "имеет доступ только к данным в пределах назначенного контура "
                    "(одна / несколько / все обслуживающие организации — по настройке прав).",
                )
                last.addnext(new_p)
                log.append("added isolation paragraph to 4.2.9.4")

    # Status order clarification near rating section
    body = refresh()
    h = find_heading(body, "Присвоение рейтинга должника и группы задолженности", "4")
    if h is not None:
        anchor = None
        j = h + 1
        while j < len(body) and not (localname(body[j]) == "p" and is_heading(body[j], "4")):
            if localname(body[j]) == "p" and get_text(body[j]).strip():
                anchor = body[j]
            j += 1
        if anchor is not None and "Порядок ведения статусов" not in get_text(anchor):
            new_p = copy.deepcopy(anchor)
            for node in list(new_p):
                ln = localname(node)
                if ln in ("commentRangeStart", "commentRangeEnd"):
                    new_p.remove(node)
                elif ln == "r" and node.find(q(W, "commentReference")) is not None:
                    new_p.remove(node)
            if new_p.get(q(W14, "paraId")):
                new_p.set(q(W14, "paraId"), hex8())
            replace_paragraph_text_keep_format(
                new_p,
                "Порядок ведения статусов в ПМ: (1) группа задолженности ЛС/договора (1–4); "
                "(2) рейтинг должника (A/B/C); (3) этап воронки взыскания; "
                "(4) статусы связанных мероприятий и заданий. Значения (1)–(2) "
                "присваиваются автоматически по настраиваемым правилам на основании "
                "данных АИС «Расчет-ЖКУ» (в т.ч. числа периодов долга); ручная "
                "корректировка группы — с фиксацией причины и без «затирания» при "
                "ежедневном обновлении до отмены корректировки либо смены оснований.",
            )
            anchor.addnext(new_p)
            log.append("added statuses order paragraph")

    # Reports clarification
    body = refresh()
    h = find_heading(body, "Отчёты о состоянии и динамике задолженности", "4")
    if h is not None:
        j = h + 1
        while j < len(body) and localname(body[j]) == "p" and not get_text(body[j]).strip():
            j += 1
        if j < len(body) and localname(body[j]) == "p":
            t = get_text(body[j]).strip()
            if "предустановлен" not in t and "конструктор" not in t.lower():
                new_p = copy.deepcopy(body[j])
                for node in list(new_p):
                    ln = localname(node)
                    if ln in ("commentRangeStart", "commentRangeEnd"):
                        new_p.remove(node)
                    elif ln == "r" and node.find(q(W, "commentReference")) is not None:
                        new_p.remove(node)
                if new_p.get(q(W14, "paraId")):
                    new_p.set(q(W14, "paraId"), hex8())
                replace_paragraph_text_keep_format(
                    new_p,
                    "Отчёты модуля включают предустановленные (разработанные) формы по "
                    "типовым разрезам и возможность формирования отчётов в конструкторе "
                    "(выбор полей, разделов и фильтров). Состав базовых форм согласовывается "
                    "с Заказчиком.",
                )
                body[j].addnext(new_p)
                log.append("added reports clarification")

    fix_writeoff_and_funnel(doc_root)
    fix_portal_formats(doc_root)
    return log


def write_docx(work: Path, out: Path) -> None:
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z_out:
        for path in sorted(work.rglob("*")):
            if path.is_file():
                z_out.write(path, path.relative_to(work).as_posix())


def main() -> None:
    random.seed(20260813)
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)
    with zipfile.ZipFile(SRC, "r") as z:
        z.extractall(WORK)

    document = etree.parse(WORK / "word" / "document.xml")
    comments = etree.parse(WORK / "word" / "comments.xml")
    doc_root = document.getroot()
    com_root = comments.getroot()

    n_green = remove_green_highlights(doc_root)
    print("removed green highlights:", n_green)

    ok = fix_jku(doc_root)
    print("ЖКУ fixed:", ok)

    text_log = patch_texts(doc_root)
    print("text patches:", len(text_log))

    struct_log = structural_cleanup(doc_root)
    for line in struct_log:
        print(" -", line)

    # remove accidental duplicate sentence if insert_sentence_after_heading_block put it in wrong module
    # Clean: if "Ручная корректировка расчета" appears twice in first 4.2.1 Общие - remove from wrong place
    body = list(doc_root.find(q(W, "body")))
    seen_manual = 0
    for el in body:
        if localname(el) != "p":
            continue
        t = get_text(el)
        if "Ручная корректировка расчета задолженности и пеней в ПМ не предусмотрена" in t:
            seen_manual += 1
            if seen_manual > 1:
                # keep first in claim module only - if this is before claim module heading, delete
                pass
    # Better approach: find all such paras; keep the one after claim module Общие положения
    claim = find_heading(body, "Модуль «Претензионно-исковая работа и взыскание»", "3")
    manual_paras = []
    for i, el in enumerate(body):
        if localname(el) == "p" and "Ручная корректировка расчета задолженности и пеней в ПМ не предусмотрена" in get_text(el):
            manual_paras.append(i)
    if claim is not None and len(manual_paras) > 1:
        keep = None
        for i in manual_paras:
            if i > claim:
                keep = i
                break
        for i in manual_paras:
            if i != keep:
                doc_root.find(q(W, "body")).remove(body[i])
                print("removed duplicate manual-correction paragraph at", i)
        body = list(doc_root.find(q(W, "body")))

    n_ans = update_executor_answers(com_root)
    print("updated answers:", n_ans)

    # Final green sweep (in case clones brought any)
    print("green leftover removed:", remove_green_highlights(doc_root))

    document.write(WORK / "word" / "document.xml", xml_declaration=True, encoding="UTF-8", standalone=True)
    comments.write(WORK / "word" / "comments.xml", xml_declaration=True, encoding="UTF-8", standalone=True)
    write_docx(WORK, OUT)

    # Verify
    with zipfile.ZipFile(OUT) as z:
        d2 = etree.fromstring(z.read("word/document.xml"))
        c2 = etree.fromstring(z.read("word/comments.xml"))
    green = len([h for h in d2.iter(q(W, "highlight")) if h.get(q(W, "val")) == "green"])
    jku = None
    for tbl in d2.findall(f".//{q(W, 'tbl')}"):
        for tr in tbl.findall(q(W, "tr")):
            cells = tr.findall(q(W, "tc"))
            if len(cells) >= 2 and get_text(cells[0]).strip() == "ЖКУ":
                jku = get_text(cells[1]).strip()[:80]
    answers = [
        get_text(c).strip()[:50]
        for c in c2.findall(q(W, "comment"))
        if c.get(q(W, "author")) == "Исполнитель"
    ]
    same = sum(1 for a in answers if a.startswith("Принято. Доработано и исправлено"))
    print("VERIFY green:", green)
    print("VERIFY ЖКУ:", jku)
    print("VERIFY answers total/same-old:", len(answers), same)
    print("Wrote", OUT)


if __name__ == "__main__":
    main()
