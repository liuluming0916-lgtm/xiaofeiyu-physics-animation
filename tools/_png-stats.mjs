/**
 * PNG 内容体检（一次性/取证工具）。
 *
 * 用途：渲帧截图会写出一张 PNG，但"文件非空"不等于"画面里真的画了东西"。
 * （截图来源见文末的"上游依赖"说明。）
 * 这里不依赖任何图像库，直接按 PNG 规范解码：IHDR → IDAT（zlib inflate）→ 逐行反滤波，
 * 然后统计**非白像素**的总量与分布（按列分带），用数字回答两个问题：
 *   1. 这张图里有没有内容（不是一张白纸）？
 *   2. 内容分布在哪些列带（左栏文字 / 中间画布 / 右栏）？
 *
 * 用法：node tools/_png-stats.mjs tests/reports/q02-preview.png [...]
 *
 * ⚠ 上游依赖（迁移后已变化）：过去这些 PNG 由 **Open Design 的 `od export --format image`**
 * 产出。现已在 DeepSeek Harness 下工作，`od` 不在 PATH 上，**新的截图暂时无法生成**。
 * 本工具对**任何** PNG 都仍然有效，`tests/reports/*.png` 是第 1、2 期的留档截图。
 * 详见 `清理台账-2026-10-16.md` 第三节。
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`只支持 8 bit（实际 ${bitDepth}）`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`不支持的 colorType ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rp];
    rp += 1;
    const row = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, pixels: out };
}

export function stats(file) {
  const img = decodePng(readFileSync(file));
  const { width, height, channels, pixels } = img;
  const bands = 10;
  const bandInk = new Array(bands).fill(0);
  let ink = 0;
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  const colors = new Set();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      const r = pixels[i];
      const g = channels >= 3 ? pixels[i + 1] : r;
      const b = channels >= 3 ? pixels[i + 2] : r;
      const a = channels === 4 ? pixels[i + 3] : 255;
      const isInk = a > 8 && (r < 244 || g < 244 || b < 244);
      if (!isInk) continue;
      ink += 1;
      bandInk[Math.min(bands - 1, Math.floor((x / width) * bands))] += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (colors.size < 4096) colors.add((r << 16) | (g << 8) | b);
    }
  }
  return {
    file,
    width,
    height,
    channels,
    inkPixels: ink,
    inkRatio: ink / (width * height),
    bbox: ink ? { minX, minY, maxX, maxY } : null,
    bandInk,
    distinctColors: colors.size,
  };
}

/** 主题配色（只出现在画布图元里，用来判断"画布到底画了没有"） */
const PALETTE = {
  body: [0x2b, 0x34, 0x40],
  amber: [0xa4, 0x61, 0x0d],
  teal: [0x2a, 0x6f, 0x8f],
  red: [0xb3, 0x38, 0x2f],
  purple: [0x6b, 0x5a, 0xa6],
  blue: [0x1f, 0x6f, 0xb2],
  guide: [0xc8, 0xd0, 0xd8],
};

export function colorProbe(file, tol = 26) {
  const img = decodePng(readFileSync(file));
  const { width, height, channels, pixels } = img;
  const counts = {};
  const boxes = {};
  for (const name of Object.keys(PALETTE)) {
    counts[name] = 0;
    boxes[name] = { minX: width, minY: height, maxX: -1, maxY: -1 };
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      for (const [name, c] of Object.entries(PALETTE)) {
        if (Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol) {
          counts[name] += 1;
          const box = boxes[name];
          if (x < box.minX) box.minX = x;
          if (x > box.maxX) box.maxX = x;
          if (y < box.minY) box.minY = y;
          if (y > box.maxY) box.maxY = y;
        }
      }
    }
  }
  return { file, width, height, counts, boxes };
}

export function diff(a, b) {
  const A = decodePng(readFileSync(a));
  const B = decodePng(readFileSync(b));
  if (A.width !== B.width || A.height !== B.height) throw new Error('尺寸不同，无法逐像素比较');
  const { width, height, channels } = A;
  let all = 0;
  let mid = 0; // 0.5W ≤ x < 0.56W
  let right = 0; // x ≥ 0.56W：动画列（三栏为 5:7:10，动画列从 0.545W 起）
  const band = (lo, hi) => (hi - lo) * height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      if (A.pixels[i] !== B.pixels[i] || A.pixels[i + 1] !== B.pixels[i + 1] || A.pixels[i + 2] !== B.pixels[i + 2]) {
        all += 1;
        if (x >= width * 0.5 && x < width * 0.56) mid += 1;
        if (x >= width * 0.56) right += 1;
      }
    }
  }
  return {
    a,
    b,
    all,
    allRatio: all / (width * height),
    mid,
    midRatio: mid / band(width * 0.5, width * 0.56),
    right,
    rightRatio: right / band(width * 0.56, width),
  };
}

if (process.argv[1] && process.argv[1].endsWith('_png-stats.mjs')) {
  const args = process.argv.slice(2);
  if (args[0] === '--pixel') {
    const [x, y] = args[1].split(',').map(Number);
    for (const f of args.slice(2)) {
      const img = decodePng(readFileSync(f));
      const i = (y * img.width + x) * img.channels;
      const hex = [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
      console.log(`${f}  像素(${x},${y}) = #${hex}`);
    }
    process.exit(0);
  }
  if (args[0] === '--diff') {
    const d = diff(args[1], args[2]);
    console.log(`\n${d.a} 与 ${d.b} 逐像素比较：`);
    console.log(`  全图不同 ${d.all}（${(d.allRatio * 100).toFixed(2)}%）`);
    console.log(`  中栏右缘（0.50–0.56W）不同 ${d.mid}（${(d.midRatio * 100).toFixed(2)}%）`);
    console.log(`  动画列（≥0.56W，JS 填充）不同 ${d.right}（${(d.rightRatio * 100).toFixed(2)}%）`);
    process.exit(0);
  }
  const files = args;
  if (!files.length) {
    console.error('用法：node tools/_png-stats.mjs <a.png> [b.png …]');
    process.exit(1);
  }
  for (const f of files) {
    const s = stats(f);
    console.log(`\n${s.file}`);
    console.log(`  ${s.width}×${s.height} · ${s.channels} 通道 · 颜色数 ${s.distinctColors}`);
    console.log(`  非白像素 ${s.inkPixels}（占 ${(s.inkRatio * 100).toFixed(2)}%）· bbox ${JSON.stringify(s.bbox)}`);
    console.log(`  按列分带（左→右 10 带）：${s.bandInk.map((n) => (n / 1000).toFixed(1) + 'k').join(' ')}`);
    const p = colorProbe(f);
    const hits = Object.entries(p.counts).filter(([, n]) => n > 0);
    console.log(
      `  画布主题色命中：${hits.length ? hits.map(([k, n]) => `${k}=${n}@x[${p.boxes[k].minX}–${p.boxes[k].maxX}]`).join(' · ') : '（无 —— 画布可能没画）'}`,
    );
  }
}
