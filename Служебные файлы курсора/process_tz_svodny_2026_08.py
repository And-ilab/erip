#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Обработка TZ_ERIP_v1.1_Сводный_10.08.2026:

1) Принять все предложения правок заказчика (w:ins / w:del из Google Docs suggestions).
2) Развернуть goog_rdk SDT-обёртки.
3) Восстановить определение ЖКУ.
4) На обычные комментарии (не suggestions) ответить отдельным комментарием Исполнителя:
   «Принято. Доработано и исправлено.»
"""

from __future__ import annotations

import copy
import random
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from lxml import etree

ROOT = Path("/Users/nikita/Desktop/ERIP")
SRC = ROOT / "TZ_ERIP_v1.1_Сводный_10.08.2026_work.docx"
OUT = ROOT / "TZ_ERIP_v1.1_Сводный_10.08.2026_ответы.docx"
WORK = ROOT / "Служебные файлы курсора" / "_tz_svodny_work"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"
W15 = "http://schemas.microsoft.com/office/word/2012/wordml"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

REPLY_AUTHOR = "Исполнитель"
REPLY_INITIALS = "И"
REPLY_TEXT = "Принято. Доработано и исправлено."

JKU_DEF = "жилищно-коммунальная услуга."


def q(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}"


def hex8() -> str:
    return f"{random.randint(0, 0xFFFFFFFF):08X}"


def get_text(el: etree._Element) -> str:
    return "".join(el.itertext())


def localname(el: etree._Element) -> str:
    return etree.QName(el.tag).localname


def accept_revisions(root: etree._Element) -> tuple[int, int]:
    """Accept all w:ins / w:del (innermost first). Returns (accepted_ins, accepted_del)."""
    accepted_ins = 0
    accepted_del = 0

    while True:
        # Find leaf revision markers (no nested ins/del)
        leaves: list[etree._Element] = []
        for el in root.iter():
            ln = localname(el)
            if ln not in ("ins", "del"):
                continue
            has_nested = False
            for child in el.iter():
                if child is el:
                    continue
                if localname(child) in ("ins", "del"):
                    has_nested = True
                    break
            if not has_nested:
                leaves.append(el)

        if not leaves:
            break

        for el in leaves:
            parent = el.getparent()
            if parent is None:
                continue
            ln = localname(el)
            if ln == "del":
                parent.remove(el)
                accepted_del += 1
            else:
                # Accept insertion: unwrap children in place
                idx = list(parent).index(el)
                children = list(el)
                for i, child in enumerate(children):
                    el.remove(child)
                    parent.insert(idx + i, child)
                parent.remove(el)
                accepted_ins += 1

    return accepted_ins, accepted_del


def unwrap_goog_sdt(root: etree._Element) -> int:
    """Replace Google suggestion SDT wrappers with their content."""
    unwrapped = 0
    # Process deepest first
    while True:
        targets = []
        for sdt in root.iter(q(W, "sdt")):
            tag_el = sdt.find(f"{q(W, 'sdtPr')}/{q(W, 'tag')}")
            tag_val = tag_el.get(q(W, "val")) if tag_el is not None else ""
            if tag_val.startswith("goog_rdk") or tag_val == "":
                # Only unwrap goog suggestion SDTs (and the one without tag if empty shell)
                if tag_val.startswith("goog_rdk"):
                    targets.append(sdt)
        if not targets:
            break

        # deepest first
        targets.sort(key=lambda e: len(list(e.iterancestors())), reverse=True)
        progressed = False
        for sdt in targets:
            parent = sdt.getparent()
            if parent is None:
                continue
            content = sdt.find(q(W, "sdtContent"))
            idx = list(parent).index(sdt)
            if content is not None:
                kids = list(content)
                for i, child in enumerate(kids):
                    content.remove(child)
                    parent.insert(idx + i, child)
            parent.remove(sdt)
            unwrapped += 1
            progressed = True
        if not progressed:
            break
    return unwrapped


def replace_paragraph_text_keep_format(p: etree._Element, new_text: str) -> None:
    """Replace visible text runs; keep pPr and comment markers."""
    markers = []
    for child in list(p):
        ln = localname(child)
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

    for child in list(p):
        if localname(child) == "pPr":
            continue
        p.remove(child)

    r = etree.SubElement(p, q(W, "r"))
    if rPr is not None:
        r.insert(0, rPr)
    t = etree.SubElement(r, q(W, "t"))
    t.text = new_text
    for m in markers:
        p.append(m)


def fix_jku_definition(document: etree._Element) -> bool:
    """Restore ЖКУ glossary definition after accidental mash."""
    for tbl in document.findall(f".//{q(W, 'tbl')}"):
        for tr in tbl.findall(q(W, "tr")):
            cells = tr.findall(q(W, "tc"))
            if len(cells) < 2:
                continue
            term = get_text(cells[0]).strip()
            if term != "ЖКУ":
                continue
            paras = cells[1].findall(q(W, "p"))
            if not paras:
                return False
            replace_paragraph_text_keep_format(paras[0], JKU_DEF)
            # drop extra empty/paras if any
            for extra in paras[1:]:
                if not get_text(extra).strip():
                    cells[1].remove(extra)
            return True
    return False


def remove_empty_glossary_rows(document: etree._Element) -> int:
    """Remove glossary rows where both term and definition are empty after accepts."""
    removed = 0
    for tbl in document.findall(f".//{q(W, 'tbl')}"):
        rows = tbl.findall(q(W, "tr"))
        if not rows:
            continue
        cells0 = rows[0].findall(q(W, "tc"))
        if not cells0 or get_text(cells0[0]).strip() != "Термин":
            continue
        all_rows = list(rows)
        for i, tr in enumerate(all_rows[1:], start=1):
            cells = tr.findall(q(W, "tc"))
            if len(cells) < 2:
                continue
            if get_text(cells[0]).strip() or get_text(cells[1]).strip():
                continue

            # Salvage comment markers before dropping the row
            markers = []
            for el in list(tr.iter()):
                ln = localname(el)
                if ln in ("commentRangeStart", "commentRangeEnd"):
                    markers.append(el)
                elif ln == "commentReference":
                    run = el.getparent()
                    if run is not None:
                        markers.append(run)

            # Prefer next non-empty row, else previous
            target_row = None
            for nxt in all_rows[i + 1 :]:
                ncells = nxt.findall(q(W, "tc"))
                if ncells and get_text(ncells[0]).strip():
                    target_row = nxt
                    break
            if target_row is None:
                for prev in reversed(all_rows[:i]):
                    pcells = prev.findall(q(W, "tc"))
                    if pcells and get_text(pcells[0]).strip():
                        target_row = prev
                        break

            if target_row is not None and markers:
                tcells = target_row.findall(q(W, "tc"))
                paras = tcells[0].findall(q(W, "p")) if tcells else []
                if paras:
                    dest = paras[0]
                    for m in markers:
                        parent = m.getparent()
                        if parent is not None:
                            parent.remove(m)
                        dest.append(m)

            tbl.remove(tr)
            removed += 1
            # refresh row list after removal
            all_rows = tbl.findall(q(W, "tr"))
    return removed


def fix_known_glues(document: etree._Element) -> int:
    """Fix obvious broken joins left after accepting partial suggestions."""
    fixed = 0
    replacements = [
        (
            "после закрытия открытых вопросовПриложение 3).",
            "после закрытия открытых вопросов (Приложение 3).",
        ),
    ]
    for p in document.iter(q(W, "p")):
        t = get_text(p)
        for old, new in replacements:
            if old in t:
                replace_paragraph_text_keep_format(p, t.replace(old, new))
                fixed += 1
                break
    return fixed


def repair_orphan_comment_markers(document: etree._Element) -> int:
    """Restore commentRangeEnd + commentReference where only Start survived accepts."""
    repaired = 0
    starts = {
        el.get(q(W, "id")): el
        for el in document.iter(q(W, "commentRangeStart"))
    }
    ends = {el.get(q(W, "id")) for el in document.iter(q(W, "commentRangeEnd"))}
    refs = {el.get(q(W, "id")) for el in document.iter(q(W, "commentReference"))}

    for cid, start in starts.items():
        if cid in ends and cid in refs:
            continue
        parent = start.getparent()
        if parent is None:
            continue
        # Insert missing end/ref immediately after start
        node = start
        if cid not in ends:
            end = etree.Element(q(W, "commentRangeEnd"))
            end.set(q(W, "id"), cid)
            node.addnext(end)
            node = end
            repaired += 1
        if cid not in refs:
            run = etree.Element(q(W, "r"))
            cref = etree.SubElement(run, q(W, "commentReference"))
            cref.set(q(W, "id"), cid)
            node.addnext(run)
            repaired += 1
    return repaired


def ensure_comment_para_ids(comment: etree._Element) -> str:
    last = None
    for p in comment.findall(q(W, "p")):
        pid = p.get(q(W14, "paraId"))
        if not pid:
            pid = hex8()
            p.set(q(W14, "paraId"), pid)
        last = pid
    if last is None:
        p = etree.SubElement(comment, q(W, "p"))
        last = hex8()
        p.set(q(W14, "paraId"), last)
    return last


def make_reply_comment(cid: str, text: str, date: str) -> tuple[etree._Element, str]:
    c = etree.Element(q(W, "comment"))
    c.set(q(W, "id"), cid)
    c.set(q(W, "author"), REPLY_AUTHOR)
    c.set(q(W, "date"), date)
    c.set(q(W, "initials"), REPLY_INITIALS)

    p = etree.SubElement(c, q(W, "p"))
    para_id = hex8()
    p.set(q(W14, "paraId"), para_id)
    p.set(q(W, "rsidR"), "00000000")
    p.set(q(W, "rsidDel"), "00000000")
    p.set(q(W, "rsidP"), "00000000")
    p.set(q(W, "rsidRDefault"), "00000000")
    p.set(q(W, "rsidRPr"), "00000000")

    # annotationRef run (Word comment marker)
    r0 = etree.SubElement(p, q(W, "r"))
    etree.SubElement(r0, q(W, "annotationRef"))

    r = etree.SubElement(p, q(W, "r"))
    t = etree.SubElement(r, q(W, "t"))
    t.text = text
    return c, para_id


def insert_reply_anchors(document: etree._Element, parent_id: str, reply_id: str) -> bool:
    for ref in document.iter(q(W, "commentReference")):
        if ref.get(q(W, "id")) != parent_id:
            continue
        parent_run = ref.getparent()
        if parent_run is None:
            continue

        start = etree.Element(q(W, "commentRangeStart"))
        start.set(q(W, "id"), reply_id)
        end = etree.Element(q(W, "commentRangeEnd"))
        end.set(q(W, "id"), reply_id)
        run = etree.Element(q(W, "r"))
        rPr_src = parent_run.find(q(W, "rPr"))
        if rPr_src is not None:
            run.append(copy.deepcopy(rPr_src))
        cref = etree.SubElement(run, q(W, "commentReference"))
        cref.set(q(W, "id"), reply_id)

        parent_run.addnext(run)
        parent_run.addnext(end)
        parent_run.addnext(start)
        return True
    return False


def add_executor_replies(
    comments_root: etree._Element,
    ext_root: etree._Element,
    document: etree._Element,
) -> int:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    comments = list(comments_root.findall(q(W, "comment")))
    if not comments:
        return 0

    max_id = max(int(c.get(q(W, "id"))) for c in comments)
    next_id = max_id + 1
    created = 0

    # Index existing commentEx by paraId
    ext_by_para = {
        cex.get(q(W15, "paraId")): cex for cex in ext_root.findall(q(W15, "commentEx"))
    }

    for comment in comments:
        # Skip already-ours and empty comments
        if comment.get(q(W, "author")) == REPLY_AUTHOR:
            continue
        text = get_text(comment).strip()
        if not text:
            continue

        parent_cid = comment.get(q(W, "id"))
        parent_last = ensure_comment_para_ids(comment)

        # Ensure parent has commentEx
        if parent_last not in ext_by_para:
            # Remap orphaned? create new
            cex = etree.SubElement(ext_root, q(W15, "commentEx"))
            cex.set(q(W15, "paraId"), parent_last)
            cex.set(q(W15, "done"), "0")
            ext_by_para[parent_last] = cex
        else:
            # keep done as-is (visible with reply)
            pass

        reply_el, reply_para = make_reply_comment(str(next_id), REPLY_TEXT, now)
        comment.addnext(reply_el)

        if not insert_reply_anchors(document, parent_cid, str(next_id)):
            # Still keep the reply comment even if anchor missing
            print(f"WARN: no commentReference for parent id={parent_cid}")

        # Standalone comment card (no paraIdParent) — как в v1.4
        cex_r = etree.SubElement(ext_root, q(W15, "commentEx"))
        cex_r.set(q(W15, "paraId"), reply_para)
        cex_r.set(q(W15, "done"), "0")
        ext_by_para[reply_para] = cex_r

        next_id += 1
        created += 1

    # Deduplicate commentEx by paraId
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
    random.seed(20260812)

    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)

    with zipfile.ZipFile(SRC, "r") as z:
        z.extractall(WORK)

    document = etree.parse(WORK / "word" / "document.xml")
    comments = etree.parse(WORK / "word" / "comments.xml")
    ext = etree.parse(WORK / "word" / "commentsExtended.xml")

    doc_root = document.getroot()
    com_root = comments.getroot()
    ext_root = ext.getroot()

    # 1) Accept all customer text suggestions (track changes)
    ins_n, del_n = accept_revisions(doc_root)
    print(f"Accepted revisions: ins={ins_n}, del={del_n}")

    # 2) Unwrap Google SDT wrappers
    sdt_n = unwrap_goog_sdt(doc_root)
    print(f"Unwrapped goog SDT: {sdt_n}")

    # Safety: leftover revisions / goog tags
    left_ins = len(list(doc_root.iter(q(W, "ins"))))
    left_del = len(list(doc_root.iter(q(W, "del"))))
    left_goog = 0
    for sdt in doc_root.iter(q(W, "sdt")):
        tag_el = sdt.find(f"{q(W, 'sdtPr')}/{q(W, 'tag')}")
        if tag_el is not None and (tag_el.get(q(W, "val")) or "").startswith("goog_rdk"):
            left_goog += 1
    print(f"Leftover: ins={left_ins}, del={left_del}, goog_sdt={left_goog}")

    # 3) Cleanup after accepts
    repaired = repair_orphan_comment_markers(doc_root)
    print(f"Repaired orphan comment markers: {repaired}")
    empty_n = remove_empty_glossary_rows(doc_root)
    print(f"Removed empty glossary rows: {empty_n}")
    glue_n = fix_known_glues(doc_root)
    print(f"Fixed known glues: {glue_n}")

    # 4) Fix ЖКУ
    ok = fix_jku_definition(doc_root)
    print(f"ЖКУ fixed: {ok}")

    # 5) Reply comments
    n_replies = add_executor_replies(com_root, ext_root, doc_root)
    print(f"Reply comments: {n_replies}")

    for tree, name in [
        (document, "document.xml"),
        (comments, "comments.xml"),
        (ext, "commentsExtended.xml"),
    ]:
        tree.write(
            WORK / "word" / name,
            xml_declaration=True,
            encoding="UTF-8",
            standalone=True,
        )

    write_docx(WORK, OUT)

    # Verify
    with zipfile.ZipFile(OUT) as z:
        doc2 = etree.fromstring(z.read("word/document.xml"))
        com2 = etree.fromstring(z.read("word/comments.xml"))

    jku = None
    for tbl in doc2.findall(f".//{q(W, 'tbl')}"):
        for tr in tbl.findall(q(W, "tr")):
            cells = tr.findall(q(W, "tc"))
            if len(cells) >= 2 and get_text(cells[0]).strip() == "ЖКУ":
                jku = get_text(cells[1]).strip()
    print(f"Verify ЖКУ: {jku!r}")
    print(f"Verify comments total: {len(com2.findall(q(W, 'comment')))}")
    exec_n = sum(
        1
        for c in com2.findall(q(W, "comment"))
        if c.get(q(W, "author")) == REPLY_AUTHOR
    )
    print(f"Verify executor replies: {exec_n}")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
