"""生成应用图标：蓝底 + 白色小鱼，输出多尺寸 .ico 和一张 1024 PNG。

自绘，无版权问题。ico 里装 16/24/32/48/64/128/256 七个尺寸，
Windows 会按场景挑最合适的那张，不会在小尺寸下糊掉。
"""
from PIL import Image, ImageDraw

S = 1024
OUT_ICO = r"build-resources/icon.ico"
OUT_PNG = r"build-resources/icon-1024.png"
SIZES = [16, 24, 32, 48, 64, 128, 256]

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角蓝底（品牌蓝 #3B82F6 到 #2563EB 的近似平涂）
d.rounded_rectangle([0, 0, S, S], radius=int(S * 0.22), fill=(59, 130, 246, 255))

# 鱼身
d.ellipse([int(S * 0.16), int(S * 0.32), int(S * 0.62), int(S * 0.70)], fill=(255, 255, 255, 255))
# 尾巴
d.polygon(
    [(int(S * 0.56), int(S * 0.51)), (int(S * 0.84), int(S * 0.24)), (int(S * 0.84), int(S * 0.78))],
    fill=(255, 255, 255, 255),
)
# 眼睛
d.ellipse([int(S * 0.28), int(S * 0.42), int(S * 0.38), int(S * 0.52)], fill=(37, 99, 235, 255))

img.save(OUT_PNG)
img.save(OUT_ICO, sizes=[(s, s) for s in SIZES])
print("saved", OUT_ICO, OUT_PNG)
