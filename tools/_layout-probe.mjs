#!/usr/bin/env node
/**
 * 一次性取证工具：从导出截图里读出**版面事实**（宽表有没有溢出、渲染倍率是多少）。
 *
 * 背景：把判定表从 14 列加到 19 列之后，"会不会顶出容器"这件事只看 CSS 算不准
 * （auto 表格的最终宽度取决于 min-content 与可用宽度，还取决于渲染倍率）。
 * 这里不猜，直接量：
 *   · 逐列 × 逐行统计墨迹，给出内容真正的左右边界与行区间分布；
 *   · 找出全长横线（表格行分隔线 / header 下边框）的**像素厚度** ⇒ 反推 devicePixelRatio；
 *   · 给出容器右边距（1220px 居中 + 24px 内边距）之外还有没有墨迹 ⇒ 有没有横向溢出。
 *
 * 用法：node tools/_layout-probe.mjs tests/reports/overview-preview.png
 *
 * ⚠ 上游依赖（迁移后已变化）：这张总览页截图当时由 **Open Design 的 `od export --format image`**
 * 产出。现已在 DeepSeek Harness 下工作，`od` 不在 PATH 上，**新的截图暂时无法生成**；
 * `tests/reports/overview-preview.png`（1440×3156）是当时的留档。
 * 本工具对任何 PNG 仍有效。详见 `清理台账-2026-10-16.md` 第三节。
 */

import { readFileSync } from 'node:fs';
import { decodePng } from './_png-stats.mjs';

const file = process.argv[2];
if (!file) {
  console.error('用法：node tools/_layout-probe.mjs <png>');
  process.exit(1);
}

const img = decodePng(readFileSync(file));
const { width, height, channels, pixels } = img;
const rawInk = (x, y) => {
  const i = (y * width + x) * channels;
  const r = pixels[i];
  const g = channels >= 3 ? pixels[i + 1] : r;
  const b = channels >= 3 ? pixels[i + 2] : r;
  const a = channels === 4 ? pixels[i + 3] : 255;
  return a > 8 && (r < 244 || g < 244 || b < 244);
};

/* 先剥掉可能存在的滚动条：某一列在 >85% 的行里都有墨迹 ⇒ 它是滚动条，不是内容 */
let contentRight = width - 1;
for (let x = width - 1; x > width - 40; x -= 1) {
  let hits = 0;
  for (let y = 0; y < height; y += 1) if (rawInk(x, y)) hits += 1;
  if (hits / height > 0.85) {
    contentRight = x - 1;
    continue;
  }
  break;
}
const scrollbar = width - 1 - contentRight;
if (scrollbar > 0) console.log(`  检测到滚动条：x ∈ [${contentRight + 1}, ${width - 1}]（${scrollbar} 设备像素宽）——下面的统计已排除它`);

const isInk = (x, y) => x <= contentRight && rawInk(x, y);
const effectiveWidth = contentRight + 1;

/** 每一行的墨迹范围 */
const rowExtent = [];
for (let y = 0; y < height; y += 1) {
  let min = null;
  let max = null;
  let count = 0;
  for (let x = 0; x <= contentRight; x += 1) {
    if (!rawInk(x, y)) continue;
    if (min === null) min = x;
    max = x;
    count += 1;
  }
  rowExtent.push({ y, min, max, count });
}

const inked = rowExtent.filter((r) => r.count > 0);
console.log(`${file}`);
console.log(`  画布 ${width}×${height} · 有墨迹的行 ${inked.length}/${height}`);
const globalMinX = Math.min(...inked.map((r) => r.min));
const globalMaxX = Math.max(...inked.map((r) => r.max));
console.log(`  内容左右边界：x ∈ [${globalMinX}, ${globalMaxX}]（有效宽度 ${effectiveWidth}）`);

/** 全长横线：一行里墨迹跨越 >80% 宽度 */
const fullWidth = inked.filter((r) => r.max - r.min > effectiveWidth * 0.8);
console.log(`  全长横线 ${fullWidth.length} 条（表格行分隔线 / header 下边框）：`);
for (const r of fullWidth.slice(0, 6)) console.log(`    y=${r.y}  x∈[${r.min}, ${r.max}]  墨迹 ${r.count}`);

/* 溢出判定：容器 = min(视口, 1220) 居中，两侧各有 24px 内边距 */
for (const dpr of [1, 2]) {
  const cssW = effectiveWidth / dpr;
  const wrap = Math.min(cssW, 1220);
  const rightEdge = Math.round(((cssW - wrap) / 2 + wrap - 24) * dpr);
  const beyond = inked.filter((r) => r.max > rightEdge + 2 && r.count < effectiveWidth * 0.8);
  console.log(
    `  假设 dpr=${dpr}（CSS 视口 ${cssW.toFixed(0)}×${(height / dpr).toFixed(0)}）：容器内容右边界 x≈${rightEdge} · ` +
      `越过它的非全长行 ${beyond.length} 行${beyond.length ? `（最长越界 x=${Math.max(...beyond.map((r) => r.max))}）` : ' ⇒ 无横向溢出'}`,
  );
}

/** 右边缘逐列剖面：用来区分"内容真的伸到这里"和"这里是一条滚动条" */
const colProfile = (from, to, label) => {
  console.log(`  ${label}（x → 有墨迹的行数 / 首行）：`);
  for (let x = to; x >= from; x -= 2) {
    let hits = 0;
    let first = null;
    for (let y = 0; y < height; y += 1) {
      if (rawInk(x, y)) {
        hits += 1;
        if (first === null) first = y;
      }
    }
    console.log(`    x=${String(x).padStart(4)}  ${String(hits).padStart(5)} 行  ${first === null ? '' : `首行 y=${first}`}`);
  }
};
colProfile(width - 40, width - 1, '右边缘');
/* 容器右边界附近：表格的 border-bottom 只画到 .wrap 的内容右边界（约 1220px 居中 + 24px 内边距），
   越过它的应当只有 header 的全宽下边框（1 行）与滚动条。 */
colProfile(Math.max(0, Math.round(width * 0.86)), Math.round(width * 0.93), '容器右边界附近');

/* 纵向节奏：每 200 设备像素的墨迹量，用来判断"某一带全空"（渲染失败 / 元素没出来） */
const bands = 12;
const bandInk = new Array(bands).fill(0);
for (const r of inked) bandInk[Math.min(bands - 1, Math.floor((r.y / height) * bands))] += r.count;
console.log(`  纵向墨迹分布（${bands} 带）：${bandInk.map((n) => Math.round(n / 100) / 10 + 'k').join(' ')}`);
