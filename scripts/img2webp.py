"""把 apps/web/assets/fish 下的 .jpg 批量转成 .webp（同名，覆盖旧文件）。

用法：python scripts/img2webp.py
只做三件事：转格式、压体积、报告前后大小。尺寸原样保留。
"""
import glob
import os
from PIL import Image

FOLDER = os.path.join("apps", "web", "assets", "fish")
# 文件名笔误兼容
RENAME = {"slove": "solve"}

total_before = total_after = 0
for p in sorted(glob.glob(os.path.join(FOLDER, "*.jpg"))):
    stem = os.path.splitext(os.path.basename(p))[0]
    stem = RENAME.get(stem, stem)
    out = os.path.join(FOLDER, stem + ".webp")
    im = Image.open(p).convert("RGB")
    im.save(out, "WEBP", quality=82, method=6)
    before = os.path.getsize(p)
    after = os.path.getsize(out)
    total_before += before
    total_after += after
    print(f"{stem:<8} {im.size[0]}x{im.size[1]}  {before//1024:>4} KB -> {after//1024:>3} KB")

print(f"\n合计 {total_before//1024} KB -> {total_after//1024} KB")
