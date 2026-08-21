#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ERIP_TZ_v1.4.docx на базе ERIP_TZ_v1.3.docx:

1) Убрать вводные «Ответ Исполнителя», «Разъяснение», «Уточнено»;
   оставить «Принято» / «Изменено» / «Удалено».
2) Сделать все ответы Исполнителя отдельными комментариями
   (без w15:paraIdParent — без вложенного reply).
"""

from __future__ import annotations

import re
import shutil
import zipfile
from pathlib import Path

from lxml import etree

ROOT = Path("/Users/nikita/Desktop/ERIP")
SRC = ROOT / "ERIP_TZ_v1.3.docx"
OUT = ROOT / "ERIP_TZ_v1.4.docx"
WORK = ROOT / "Служебные файлы курсора" / "_tz_v14_work"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"
W15 = "http://schemas.microsoft.com/office/word/2012/wordml"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

KEEP_INTROS = ("принято", "изменено", "удалено")


def q(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}"


def get_text(el: etree._Element) -> str:
    return "".join(el.itertext())


def clean_answer_text(text: str) -> str:
    """Remove intro boilerplate; keep Принято/Изменено/Удалено and body."""
    s = text.strip()
    # "Ответ Исполнителя:" / variants
    s = re.sub(r"^Ответ\s+Исполнителя\s*:\s*", "", s, flags=re.IGNORECASE)
    s = s.strip()

    # Leading "Разъяснение." / "Уточнено." — remove
    # Do NOT remove Принято / Изменено / Удалено
    m = re.match(
        r"^(Разъяснение|Уточнено|Разъяснения)\s*\.?\s*",
        s,
        flags=re.IGNORECASE,
    )
    if m:
        s = s[m.end() :].strip()

    return s


def set_comment_text(comment: etree._Element, new_text: str) -> None:
    """Replace visible text of comment, keep first para structure/annotationRef."""
    paras = comment.findall(q(W, "p"))
    if not paras:
        return

    # Keep first paragraph, remove extras
    first = paras[0]
    for p in paras[1:]:
        comment.remove(p)

    # Preserve annotationRef run and rPr from first content run
    ann_run = None
    rPr = None
    for r in first.findall(q(W, "r")):
        if r.find(q(W, "annotationRef")) is not None:
            ann_run = r
            continue
        if rPr is None and r.find(q(W, "rPr")) is not None:
            rPr = etree.fromstring(etree.tostring(r.find(q(W, "rPr"))))

    pPr = first.find(q(W, "pPr"))
    # Clear children except pPr
    for child in list(first):
        if child is pPr:
            continue
        first.remove(child)

    if ann_run is not None:
        first.append(ann_run)

    # Support multi-line answers as multiple paragraphs
    lines = new_text.split("\n") if "\n" in new_text else [new_text]
    # first line into first para
    r = etree.SubElement(first, q(W, "r"))
    if rPr is not None:
        r.insert(0, rPr)
    t = etree.SubElement(r, q(W, "t"))
    if lines[0][:1].isspace() or lines[0][-1:].isspace():
        t.set(XML_SPACE, "preserve")
    t.text = lines[0]

    for line in lines[1:]:
        p = etree.SubElement(comment, q(W, "p"))
        # copy pPr/style if any
        if pPr is not None:
            p.append(etree.fromstring(etree.tostring(pPr)))
        # new paraId
        import random

        p.set(q(W14, "paraId"), f"{random.randint(0, 0xFFFFFFFF):08X}")
        p.set(q(W14, "textId"), f"{random.randint(0, 0xFFFFFFFF):08X}")
        r2 = etree.SubElement(p, q(W, "r"))
        if rPr is not None:
            r2.insert(0, etree.fromstring(etree.tostring(rPr)))
        t2 = etree.SubElement(r2, q(W, "t"))
        t2.text = line


def unthread_executor_replies(ext_root: etree._Element, comments_root: etree._Element) -> int:
    """Remove paraIdParent from all Исполнитель comments → standalone cards."""
    exec_para_ids = set()
    for c in comments_root.findall(q(W, "comment")):
        if c.get(q(W, "author")) != "Исполнитель":
            continue
        for p in c.findall(q(W, "p")):
            pid = p.get(q(W14, "paraId"))
            if pid:
                exec_para_ids.add(pid)

    n = 0
    for cex in ext_root.findall(q(W15, "commentEx")):
        pid = cex.get(q(W15, "paraId"))
        parent = cex.get(q(W15, "paraIdParent"))
        if parent and pid in exec_para_ids:
            del cex.attrib[q(W15, "paraIdParent")]
            n += 1
    return n


def main() -> None:
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)

    with zipfile.ZipFile(SRC, "r") as z:
        z.extractall(WORK)

    comments = etree.parse(WORK / "word" / "comments.xml")
    ext = etree.parse(WORK / "word" / "commentsExtended.xml")
    com_root = comments.getroot()
    ext_root = ext.getroot()

    cleaned = 0
    samples_before_after = []
    for c in com_root.findall(q(W, "comment")):
        if c.get(q(W, "author")) != "Исполнитель":
            continue
        old = get_text(c).strip()
        new = clean_answer_text(old)
        if new != old:
            set_comment_text(c, new)
            cleaned += 1
            if len(samples_before_after) < 8:
                samples_before_after.append((old[:90], new[:90]))

    unthreaded = unthread_executor_replies(ext_root, com_root)

    comments.write(
        WORK / "word" / "comments.xml",
        xml_declaration=True,
        encoding="UTF-8",
        standalone=True,
    )
    ext.write(
        WORK / "word" / "commentsExtended.xml",
        xml_declaration=True,
        encoding="UTF-8",
        standalone=True,
    )

    if OUT.exists():
        OUT.unlink()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z_out:
        for path in sorted(WORK.rglob("*")):
            if path.is_file():
                z_out.write(path, path.relative_to(WORK).as_posix())

    print(f"Wrote {OUT}")
    print(f"Cleaned texts: {cleaned}")
    print(f"Unthreaded (removed paraIdParent): {unthreaded}")
    print("Samples:")
    for a, b in samples_before_after:
        print(f"  OLD: {a}")
        print(f"  NEW: {b}")
        print("  ---")

    # Verify
    with zipfile.ZipFile(OUT) as z:
        comments2 = etree.fromstring(z.read("word/comments.xml"))
        ext2 = etree.fromstring(z.read("word/commentsExtended.xml"))

    still_prefix = 0
    still_threaded = 0
    starts = {}
    exec_paras = set()
    for c in comments2.findall(q(W, "comment")):
        if c.get(q(W, "author")) != "Исполнитель":
            continue
        t = get_text(c).strip()
        if t.lower().startswith("ответ исполнителя") or t.lower().startswith("разъяснение"):
            still_prefix += 1
        key = " ".join(t.split()[:2])
        starts[key] = starts.get(key, 0) + 1
        for p in c.findall(q(W, "p")):
            exec_paras.add(p.get(q(W14, "paraId")))

    for cex in ext2.findall(q(W15, "commentEx")):
        if cex.get(q(W15, "paraIdParent")) and cex.get(q(W15, "paraId")) in exec_paras:
            still_threaded += 1

    print("Verify still_prefix", still_prefix, "still_threaded", still_threaded)
    print("Top starts:")
    for k, v in sorted(starts.items(), key=lambda x: -x[1])[:15]:
        print(f"  {v:3} {k}")


if __name__ == "__main__":
    main()
