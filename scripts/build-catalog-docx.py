"""把重写好的 6 个 markdown 片段合成一份 docx。

用法：python scripts/build-catalog-docx.py
输入：开源日志/_check/catalog-part1.md ~ part6.md
输出：开源日志/人教版高中物理-动画考点提示词-重写版.docx
"""
import os
import re

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, Cm, RGBColor

PARTS = [f"开源日志/_check/catalog-part{i}.md" for i in range(1, 7)]
OUT = "开源日志/人教版高中物理-动画考点提示词-重写版.docx"

HEAD = ["考点", "考点说明（物理过程与易错点）", "提示词（可直接粘贴给软件）"]


def set_cjk(run, size=9, bold=False, color=None):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.name = "微软雅黑"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    if color:
        run.font.color.rgb = color


def shade(cell, hex_color):
    from docx.oxml import OxmlElement

    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)


def add_table(doc, rows):
    table = doc.add_table(rows=1, cols=3)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False

    widths = [Cm(4.6), Cm(7.6), Cm(8.2)]
    hdr = table.rows[0].cells
    for i, text in enumerate(HEAD):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        run = p.add_run(text)
        set_cjk(run, 9, True, RGBColor(0xFF, 0xFF, 0xFF))
        shade(hdr[i], "2F6FEB")
        hdr[i].width = widths[i]

    for cells in rows:
        row = table.add_row().cells
        for i, text in enumerate(cells):
            row[i].text = ""
            p = row[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            run = p.add_run(text)
            set_cjk(run, 9, i == 0)
            row[i].width = widths[i]
    return table


def main():
    doc = Document()

    # 页面：A4 横向，表格才放得下三栏
    sec = doc.sections[0]
    sec.orientation = 1
    sec.page_width, sec.page_height = sec.page_height, sec.page_width
    sec.left_margin = Cm(1.6)
    sec.right_margin = Cm(1.6)

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_cjk(title.add_run("人教版高中物理 · 可动画化考点与提示词"), 18, True)

    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_cjk(sub.add_run("覆盖必修 1~3 与选择性必修 1~3 共 50 个考点"), 10, False, RGBColor(0x66, 0x74, 0x8A))

    intro = doc.add_paragraph()
    set_cjk(
        intro.add_run(
            "怎么用：把「提示词」整段复制到小肥鱼的输入框，直接生成。提示词只描述要讲清的物理过程与关键结论，"
            "画面怎么组织交给它自己决定；如果生成的画面不合意，在输入框里补一句你的修改意见即可。"
        ),
        9.5,
    )
    doc.add_paragraph()

    total = 0
    for path in PARTS:
        if not os.path.exists(path):
            raise SystemExit(f"缺少片段：{path}")
        current_rows = []
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\n")
                if line.startswith("### "):
                    if current_rows:
                        add_table(doc, current_rows)
                        total += len(current_rows)
                        current_rows = []
                    h = doc.add_heading(level=1)
                    set_cjk(h.add_run(line[4:].strip()), 13, True, RGBColor(0x1F, 0x2A, 0x3A))
                elif line.startswith("#### "):
                    if current_rows:
                        add_table(doc, current_rows)
                        total += len(current_rows)
                        current_rows = []
                    h = doc.add_heading(level=2)
                    set_cjk(h.add_run(line[5:].strip()), 11, True, RGBColor(0x2F, 0x6F, 0xEB))
                elif line.startswith("|") and not re.match(r"^\|\s*-", line):
                    cells = [c.strip() for c in line.strip().strip("|").split("|")]
                    if len(cells) == 3:
                        current_rows.append(cells)
        if current_rows:
            add_table(doc, current_rows)
            total += len(current_rows)
        doc.add_paragraph()

    doc.save(OUT)
    print(f"考点 {total} 条 → {OUT}")


if __name__ == "__main__":
    main()
