#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""_shot 的栅格化端：把 `tools/_shot.mjs` 录下来的画笔调用画成 PNG。

一次性的取证工具（`_` 前缀）。为什么要这一端：仓库里没有 headless 浏览器，
而 `<canvas>` 的像素只能靠人双击 HTML 去看；把录制 JSON 用 Pillow 画出来，
就能在验收时把"画面"变成一张可以直接看的图。

用法：
    node tools/_shot.mjs tests/real-exam/q06.program.json --n 6 --out tests/reports/shot-q06
    python tools/_shot.py tests/reports/shot-q06 [--sheet out.png] [--scale 1]

产出：
    <dir>/frame-XX.png        每帧单独一张
    <dir>/sheet.png           拼版（3 列，标注时间）
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

SS = 2  # 超采样倍数：Pillow 没有抗锯齿，放大画再缩回去

CJK_FONTS = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]
MONO_FONTS = [r"C:\Windows\Fonts\consola.ttf"]


def load_font(size, mono=False):
    for path in (MONO_FONTS if mono else CJK_FONTS):
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def parse_color(c):
    """把 #rrggbb / #rgb / rgba(...) / 具名色 转成 (r,g,b,a)；认不出就黑色。"""
    if not isinstance(c, str):
        return (0, 0, 0, 255)
    s = c.strip().lower()
    if s.startswith("rgba(") or s.startswith("rgb("):
        nums = s[s.index("(") + 1 : s.rindex(")")].replace(",", " ").split()
        try:
            r, g, b = (int(round(float(x))) for x in nums[:3])
            a = int(round(float(nums[3]) * 255)) if len(nums) > 3 else 255
            return (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)), max(0, min(255, a)))
        except (ValueError, IndexError):
            return (0, 0, 0, 255)
    if s.startswith("#"):
        h = s[1:]
        if len(h) == 3:
            h = "".join(ch * 2 for ch in h)
        if len(h) >= 6:
            try:
                return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
            except ValueError:
                return (0, 0, 0, 255)
    named = {
        "black": (0, 0, 0, 255),
        "white": (255, 255, 255, 255),
        "red": (220, 40, 40, 255),
        "blue": (40, 80, 220, 255),
        "green": (30, 150, 70, 255),
        "gray": (128, 128, 128, 255),
        "grey": (128, 128, 128, 255),
        "orange": (240, 140, 30, 255),
    }
    return named.get(s, (0, 0, 0, 255))


def paint_op(draw, op, img):
    """画一个画笔调用（fill / stroke / text）。`clip` 由 draw_frame 在外层处理。"""
    kind = op.get("kind")
    if kind in ("fill", "stroke"):
        color = parse_color(op.get("color"))
        alpha = float(op.get("alpha", 1) or 1)
        color = (color[0], color[1], color[2], int(color[3] * alpha))
        for sub in op.get("subpaths") or []:
            pts = [(p[0] * SS, p[1] * SS) for p in sub]
            if len(pts) < 2:
                if kind == "fill" and len(pts) == 1:
                    r = 1.2 * SS
                    draw.ellipse([pts[0][0] - r, pts[0][1] - r, pts[0][0] + r, pts[0][1] + r], fill=color)
                continue
            if kind == "fill":
                draw.polygon(pts, fill=color)
            else:
                width = max(2, int(round(float(op.get("width", 1)) * SS)))
                if op.get("dash"):
                    dash_polyline(draw, pts, color, width, op["dash"])
                else:
                    draw.line(pts, fill=color, width=width, joint="curve")
    elif kind == "text":
        color = parse_color(op.get("color"))
        size = max(8, int(float(op.get("size", 12)) * SS))
        font = load_font(size)
        text = op.get("text", "")
        x, y = op.get("x", 0) * SS, op.get("y", 0) * SS
        align = op.get("align", "left")
        try:
            bbox = draw.textbbox((0, 0), text, font=font)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
        except Exception:  # noqa: BLE001 - 字体量不到就按等宽估
            tw, th = len(text) * size * 0.6, size
        if align == "center":
            x -= tw / 2
        elif align == "right":
            x -= tw
        if op.get("rot"):
            layer = Image.new("RGBA", (int(tw) + 8, int(th) + 8), (0, 0, 0, 0))
            ImageDraw.Draw(layer).text((4, 4 - th * 0.2), text, font=font, fill=color)
            layer = layer.rotate(-math.degrees(op["rot"]), expand=True, resample=Image.BICUBIC)
            img.paste(layer, (int(x - 4), int(y - th - 2)), layer)
        else:
            draw.text((x, y - th * 1.15), text, font=font, fill=color)


def draw_frame(frame, out_path):
    w = frame["width"] * SS
    h = frame["height"] * SS
    img = Image.new("RGB", (w, h), (255, 255, 255))
    draw = ImageDraw.Draw(img, "RGBA")

    for op in frame["ops"]:
        """`clip` = 先画到图层，再用多边形遮罩贴回去。
        没有这一步，`Draw.ground` 的剖面线会铺满整张画布（看上去像一坨大三角）。"""
        clip = op.get("clip")
        if not clip:
            paint_op(draw, op, img)
            continue
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        paint_op(ImageDraw.Draw(layer, "RGBA"), op, layer)
        mask = Image.new("L", (w, h), 0)
        md = ImageDraw.Draw(mask)
        for sub in clip:
            if len(sub) >= 3:
                md.polygon([(p[0] * SS, p[1] * SS) for p in sub], fill=255)
        mask = ImageChops.multiply(mask, layer.split()[3])
        img.paste(layer.convert("RGB"), (0, 0), mask)

    img = img.resize((frame["width"], frame["height"]), Image.LANCZOS)
    img.save(out_path)
    return out_path


def dash_polyline(draw, pts, color, width, dash):
    on, off = (dash + [4, 3])[:2] if dash else (4, 3)
    period = on + off
    if period <= 0:
        draw.line(pts, fill=color, width=width, joint="curve")
        return
    dist = 0.0
    carry = 0.0
    for i in range(1, len(pts)):
        x0, y0 = pts[i - 1]
        x1, y1 = pts[i]
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg <= 0:
            continue
        t = 0.0
        while t < seg:
            phase = (dist + t) % period
            step = min(seg - t, (on - phase) if phase < on else (period - phase))
            if phase < on:
                a = (x0 + (x1 - x0) * (t / seg), y0 + (y1 - y0) * (t / seg))
                b = (x0 + (x1 - x0) * ((t + step) / seg), y0 + (y1 - y0) * ((t + step) / seg))
                draw.line([a, b], fill=color, width=width)
            t += step
            carry = phase + step
        dist += seg


def make_sheet(dir_path, pngs, cols=3):
    if not pngs:
        return None
    imgs = [Image.open(p).convert("RGB") for _, _, p in pngs]
    cw, ch = imgs[0].size
    pad = 14
    label_h = 26
    rows = math.ceil(len(imgs) / cols)
    sheet = Image.new("RGB", (cols * cw + (cols + 1) * pad, rows * (ch + label_h) + (rows + 1) * pad), (246, 246, 248))
    draw = ImageDraw.Draw(sheet)
    font = load_font(18, mono=True)
    for i, (t, title, path) in enumerate(pngs):
        r, c = divmod(i, cols)
        x = pad + c * (cw + pad)
        y = pad + r * (ch + label_h + pad)
        sheet.paste(Image.open(path).convert("RGB"), (x, y + label_h))
        draw.rectangle([x, y + label_h, x + cw, y + label_h + ch], outline=(200, 200, 205))
        draw.text((x + 2, y + 3), f"t={t:.3f}  {title}", font=font, fill=(40, 40, 48))
    out = dir_path / "sheet.png"
    sheet.save(out)
    return out


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    dir_path = Path(argv[1]).resolve()
    meta = json.loads((dir_path / "meta.json").read_text(encoding="utf-8"))
    pngs = []
    for f in meta["frames"]:
        frame = json.loads((dir_path / f"frame-{f['index']:02d}.json").read_text(encoding="utf-8"))
        out = dir_path / f"frame-{f['index']:02d}.png"
        draw_frame(frame, out)
        pngs.append((f["t"], meta.get("id") or "", out))
        print(f"  frame {f['index']:02d} t={f['t']} → {out.name}")
    sheet = make_sheet(dir_path, pngs)
    print(f"sheet → {sheet}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
