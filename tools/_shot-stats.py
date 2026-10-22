#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""画面占用率统计（取证用）：读 `tools/_shot.mjs` 的录制 JSON，报每帧内容包围盒。

回答的是"这张画面到底用了多少纸"：
    · `w/880` `h/388`：内容包围盒占画布宽高的比例；
    · `area`：包围盒面积占画布的比例（构图松散度）；
    · `ink`：真正落笔的像素占比（画面密度）。

用法：
    python tools/_shot-stats.py tests/reports/shot-q04 [tests/reports/shot-q06 ...]
"""
import json
import os
import sys


def _is_pale(color):
    """网格/坐标轴是很浅的灰：统计内容包围盒时要把它们剔掉，否则量到的是纸不是画。

    theme.grid = rgba(31,42,52,0.10) / gridStrong = 0.22 —— 所以 rgba 只要 alpha < 0.35 就当网格。
    """
    if not isinstance(color, str):
        return False
    s = color.strip().lower()
    if s.startswith("rgba("):
        try:
            alpha = float(s[s.rindex(",") + 1 : s.rindex(")")])
        except ValueError:
            return False
        return alpha < 0.35
    if not s.startswith("#"):
        return False
    h = s[1:]
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    if len(h) < 6:
        return False
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except ValueError:
        return False
    return (0.299 * r + 0.587 * g + 0.114 * b) > 225


def main(dirs):
    for d in dirs:
        meta = json.load(open(os.path.join(d, "meta.json"), encoding="utf-8"))
        W, H = meta["width"], meta["height"]
        print(f"== {d}  canvas={W}x{H}  duration={meta['duration']:.2f}")
        for f in meta["frames"]:
            fr = json.load(open(os.path.join(d, f"frame-{f['index']:02d}.json"), encoding="utf-8"))
            xs, ys = [], []
            for op in fr["ops"]:
                if op["kind"] in ("fill", "stroke") and not _is_pale(op.get("color")):
                    for sub in op.get("subpaths") or []:
                        for x, y in sub:
                            xs.append(x)
                            ys.append(y)
            if not xs:
                print(f"  t={f['t']:>6.3f}  empty")
                continue
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            cover = (x1 - x0) * (y1 - y0) / (W * H)
            print(
                f"  t={f['t']:>6.3f}  bbox=({x0:4.0f},{y0:4.0f})-({x1:4.0f},{y1:4.0f})"
                f"  w={x1-x0:4.0f}/{W}  h={y1-y0:4.0f}/{H}  area={cover*100:5.1f}%  ops={len(fr['ops'])}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
