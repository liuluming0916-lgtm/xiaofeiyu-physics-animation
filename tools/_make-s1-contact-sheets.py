#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
⚠ 一次性工具（`_` 前缀，第 5.7 期 S1 用，用完删）。

把 S1 的 40 道题**连同它们的配图**渲染成拼版 PNG（每张 5 题），
好让"人工标准答案"的标注方与模型**看到同样的输入**（模型那边也是文字 + 图）。

产出：`_s1-sheet-<set>-<n>.png`
用法：python tools/_make-s1-contact-sheets.py
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
IMG_ROOT = ROOT / "第5期世界书知识库参照" / "扫描结果" / "《2025版高中物理题型笔记》扫描结果"
RAW_MD = IMG_ROOT / "题型笔记总.md"

MAX_IMG_H = 340
ITEM_H = MAX_IMG_H + 120
COL_W = 700


def load_raw_by_uid():
    """从原始 md 里按 uid 抽"题面块原始文本"（保留 ![](images/..) 链接）"""
    text = RAW_MD.read_text(encoding="utf-8").replace("\r\n", "\n")
    out = {}
    chapter = None
    cur = None
    buf = []
    def flush():
        if cur:
            out[cur] = "\n".join(buf)
    for line in text.split("\n"):
        m = re.match(r"^题型笔记\s*(\d+)\\\.(\d+)", line)
        if m:
            flush(); cur = None; chapter = f"{m.group(1)}.{m.group(2)}"; buf = []
            continue
        m = re.match(r"^原型题\s*(\d+)", line)
        if m:
            flush(); cur = f"{chapter}#{m.group(1)}"; buf = []
            continue
        if line.startswith("【解析】"):
            flush(); cur = None; buf = []
            continue
        if cur:
            buf.append(line)
    flush()
    return out


def clean(s: str) -> str:
    s = re.sub(r"!\[\]\([^)]*\)", " ", s)
    s = re.sub(r"\$([^$]*)\$", r"\1", s)
    s = re.sub(r"\\[a-zA-Z]+", " ", s)
    s = re.sub(r"[{}]", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def wrap(draw, text, font, width):
    lines, cur = [], ""
    for ch in text:
        if draw.textlength(cur + ch, font=font) > width:
            lines.append(cur); cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def main():
    from PIL import ImageFont
    # Windows 自带中文字体（default 位图字体没有 CJK 字形，会渲染成方块）
    font = None
    for cand in ("msyh.ttc", "msyhbd.ttc", "simhei.ttf", "simsun.ttc", "Deng.ttf"):
        p = Path("C:/Windows/Fonts") / cand
        if p.exists():
            try:
                font = ImageFont.truetype(str(p), 19)
                font_small = ImageFont.truetype(str(p), 15)
                break
            except Exception:
                continue
    if font is None:
        font = ImageFont.load_default(size=20)
        font_small = ImageFont.load_default(size=17)
        print("⚠ 没找到中文字体，中文会渲染成方块", file=sys.stderr)

    samples = json.loads((ROOT / "_s1-samples.json").read_text(encoding="utf-8"))
    raw_by_uid = load_raw_by_uid()

    groups = [
        ("set1", [x["uid"] for x in samples["set1_documentOrder20"]]),
        ("set2", [x["uid"] for x in samples["set2_first10Concepts20"]]),
    ]

    made = []
    for name, uids in groups:
        for start in range(0, len(uids), 5):
            chunk = uids[start:start + 5]
            sheet = Image.new("RGB", (COL_W, ITEM_H * len(chunk)), "white")
            draw = ImageDraw.Draw(sheet)
            for i, uid in enumerate(chunk):
                y0 = i * ITEM_H
                draw.rectangle([0, y0, COL_W - 1, y0 + ITEM_H - 1], outline=(180, 180, 180))
                head = f"[{start + i + 1}] {uid}"
                draw.text((8, y0 + 6), head, fill=(200, 0, 0), font=font)
                body = clean(raw_by_uid.get(uid, ""))
                ty = y0 + 32
                for line in wrap(draw, body, font_small, COL_W - 16)[:4]:
                    draw.text((8, ty), line, fill=(0, 0, 0), font=font_small)
                    ty += 22
                # 图
                imgs = re.findall(r"!\[\]\(([^)]+)\)", raw_by_uid.get(uid, ""))[:2]
                x = 8
                for rel in imgs:
                    p = IMG_ROOT / rel
                    if not p.exists():
                        continue
                    try:
                        im = Image.open(p).convert("RGB")
                    except Exception:
                        continue
                    w, h = im.size
                    if h > MAX_IMG_H:
                        im = im.resize((max(1, int(w * MAX_IMG_H / h)), MAX_IMG_H))
                    sheet.paste(im, (x, y0 + 126))
                    x += im.size[0] + 6
                    if x > COL_W - 40:
                        break
            out = ROOT / f"_s1-sheet-{name}-{start // 5 + 1}.png"
            sheet.save(out)
            made.append(out)

    for p in made:
        im = Image.open(p)
        print(f"{p.name}  {im.size[0]}x{im.size[1]}  {p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
