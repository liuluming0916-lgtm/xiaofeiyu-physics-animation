"""把《软件说明书.md》转成可直接提交的 .docx，并为 9 处【截图 N：…】留出占位。

复用 gen-process-docs.py 的排版原语（同一套字体/表格/标题风格）。
"""

import importlib.util
import re
import sys
from pathlib import Path

from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

HERE = Path(__file__).resolve().parent
SRC = HERE / "软件说明书.md"
OUT = HERE / "软件说明书.docx"

spec = importlib.util.spec_from_file_location("gpd", HERE / "gen-process-docs.py")
gpd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gpd)


def add_page_number(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = "PAGE"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(end)


def add_placeholder(doc, text):
    """截图占位：一行灰字提示 + 一行空白（留给粘贴图片）。"""
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(2)
    run = p.add_run(f"▼ 在此处插入「{text}」")
    gpd.set_run(run, size=Pt(10), bold=True)
    run.font.color.rgb = RGBColor(0x99, 0x99, 0x99)

    blank = doc.add_paragraph()
    blank.alignment = WD_ALIGN_PARAGRAPH.CENTER
    blank.paragraph_format.space_after = Pt(10)
    r = blank.add_run("（粘贴图片后删除本行）")
    gpd.set_run(r, size=Pt(9))
    r.font.color.rgb = RGBColor(0xCC, 0xCC, 0xCC)


def build():
    lines = SRC.read_text(encoding="utf-8").splitlines()
    doc = gpd.new_doc()
    add_page_number(doc.sections[0].footer.paragraphs[0])

    i = 0
    while i < len(lines):
        raw = lines[i]
        s = raw.strip()

        if s.startswith("```"):
            i += 1
            fence = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                fence.append(lines[i])
                i += 1
            gpd.add_code(doc, fence)
            i += 1
            continue

        if s.startswith("|") and s.endswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                if not gpd.is_sep(lines[i]):
                    rows.append(gpd.split_row(lines[i]))
                i += 1
            if rows:
                gpd.add_table(doc, rows)
            continue

        if not s:
            i += 1
            continue

        m = re.match(r"^【(截图\s*\d+[^】]*)】$", s)
        if m:
            add_placeholder(doc, m.group(1))
            i += 1
            continue

        if s.startswith("### "):
            gpd.add_heading(doc, s[4:], 3)
        elif s.startswith("## "):
            gpd.add_heading(doc, s[3:], 2)
        elif s.startswith("# "):
            gpd.add_heading(doc, s[2:], 1)
        elif re.match(r"^\d+\.\s", s):
            gpd.add_bullet(doc, re.sub(r"^\d+\.\s", "", s), numbered=True)
        elif s.startswith("- "):
            gpd.add_bullet(doc, s[2:])
        elif s.startswith("> "):
            gpd.add_para(doc, s[2:])
        else:
            gpd.add_para(doc, s)
        i += 1

    doc.save(OUT)
    print(f"✓ {OUT.name} · {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    build()
