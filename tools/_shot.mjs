#!/usr/bin/env node
/**
 * _shot —— 把一道题的 drawFrame 真的"画"成一张 PNG（取证工具，不是判据）。
 *
 * 为什么需要它：
 *   · Dry-Run 只回答契约与自洽，**看不见画面**；
 *   · 仓库里没有 headless 浏览器，`<canvas>` 的像素一直只能靠人双击 HTML 去看；
 *   · 但 replayToCanvas 之后的所有画笔调用都是**有序的、带颜色的数字**，
 *     所以可以录下来，再用 Pillow 栅格化成 PNG —— 人（和我）就能直接看图。
 *
 * 用法：
 *   node tools/_shot.mjs tests/real-exam/q06.program.json --n 6 --out tests/reports/shot-q06
 *   node tools/_shot.mjs tests/real-exam/q06.program.json --times 0,1,2,4
 *
 * 产出：
 *   <out>/frame-<i>.json   每帧的画笔录制（屏幕坐标）
 *   <out>/meta.json        画布尺寸与时间点
 * 之后用 `python tools/_shot.py <out>` 栅格化成 PNG。
 *
 * 只读：不写题目、不改程序。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assembleProgramSource, sandboxBundle, createPlayerFromFactory, replayToCanvas } from '../sdk/runtime/animation-runtime.mjs';
import { makeMockCanvas } from '../tests/harness/canvas-harness.mjs';

const TAU = Math.PI * 2;

function parseArgs(argv) {
  const out = { program: null, n: 6, times: null, out: null, w: 880, h: 388 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--n') out.n = Number(argv[++i]);
    else if (a === '--times') out.times = String(argv[++i]).split(',').map(Number).filter((x) => Number.isFinite(x));
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--w') out.w = Number(argv[++i]);
    else if (a === '--h') out.h = Number(argv[++i]);
    else if (!a.startsWith('--')) out.program = a;
  }
  return out;
}

/** 2D 变换矩阵：与 canvas 的 (a,b,c,d,e,f) 同序 */
function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function hexOf(v, fallback = '#000000') {
  if (typeof v !== 'string') return fallback;
  return v;
}

/**
 * 记录型 ctx：把 replayToCanvas 的画笔调用**当场压成屏幕坐标的折线**。
 *
 * 只支持 replay 实际用到的那一小撮调用；遇到没实现的就跳过（不会崩整帧）。
 */
function createRecorder(width, height) {
  const ops = [];
  const stateStack = [];
  const st = {
    m: [1, 0, 0, 1, 0, 0],
    strokeStyle: '#000000',
    fillStyle: '#000000',
    lineWidth: 1,
    lineDash: [],
    font: '12px sans-serif',
    textAlign: 'left',
    globalAlpha: 1,
    /** `clip()` 之后要生效的裁剪多边形（屏幕坐标）；null = 不裁 */
    clipPaths: null,
  };

  const apply = (x, y) => [st.m[0] * x + st.m[2] * y + st.m[4], st.m[1] * x + st.m[3] * y + st.m[5]];
  const sx = () => Math.hypot(st.m[0], st.m[1]) || 1;
  const sy = () => Math.hypot(st.m[2], st.m[3]) || 1;

  let path = []; // 当前路径的子路径数组：每项是点列
  let cur = null;

  const push = (x, y) => {
    if (!cur) {
      cur = [];
      path.push(cur);
    }
    cur.push([Number(x.toFixed(2)), Number(y.toFixed(2))]);
  };

  const flush = (kind) => {
    const subpaths = path.filter((p) => p.length > 0);
    if (!subpaths.length) return;
    const clip = st.clipPaths ? { clip: st.clipPaths.map((p) => p.map((q) => q.slice())) } : {};
    if (kind === 'fill') {
      ops.push({ kind: 'fill', subpaths, color: hexOf(st.fillStyle, '#000000'), alpha: st.globalAlpha, ...clip });
    } else {
      ops.push({
        kind: 'stroke',
        subpaths,
        color: hexOf(st.strokeStyle, '#000000'),
        width: Math.max(0.6, st.lineWidth),
        dash: st.lineDash.slice(),
        alpha: st.globalAlpha,
        ...clip,
      });
    }
  };

  const ctx = {
    canvas: { width, height },
    save() {
      stateStack.push({ ...st, m: st.m.slice(), lineDash: st.lineDash.slice() });
    },
    restore() {
      const prev = stateStack.pop();
      if (prev) Object.assign(st, prev);
    },
    translate(x, y) {
      st.m = mul(st.m, [1, 0, 0, 1, x, y]);
    },
    scale(x, y) {
      st.m = mul(st.m, [x, 0, 0, y, 0, 0]);
    },
    rotate(rad) {
      st.m = mul(st.m, [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0]);
    },
    setTransform(a, b, c, d, e, f) {
      st.m = [a, b, c, d, e, f];
    },
    beginPath() {
      path = [];
      cur = null;
    },
    moveTo(x, y) {
      cur = [];
      path.push(cur);
      push(...apply(x, y));
    },
    lineTo(x, y) {
      push(...apply(x, y));
    },
    closePath() {
      if (cur && cur.length) cur.push(cur[0].slice());
    },
    arc(cx, cy, r, a0, a1, ccw = false) {
      let start = a0;
      let end = a1;
      if (!ccw) {
        while (end < start) end += TAU;
      } else {
        while (end > start) end -= TAU;
      }
      const steps = Math.max(8, Math.ceil((Math.abs(end - start) / TAU) * 64));
      const c = apply(cx, cy);
      const rx = r * sx();
      const ry = r * sy();
      for (let i = 0; i <= steps; i += 1) {
        const th = start + ((end - start) * i) / steps;
        push(c[0] + rx * Math.cos(th), c[1] + ry * Math.sin(th));
      }
    },
    ellipse(cx, cy, rx, ry, rot = 0, a0 = 0, a1 = TAU) {
      const steps = 64;
      const c = apply(cx, cy);
      const rx2 = rx * sx();
      const ry2 = ry * sy();
      for (let i = 0; i <= steps; i += 1) {
        const th = a0 + ((a1 - a0) * i) / steps;
        const px = rx2 * Math.cos(th);
        const py = ry2 * Math.sin(th);
        push(c[0] + px * Math.cos(rot) - py * Math.sin(rot), c[1] + px * Math.sin(rot) + py * Math.cos(rot));
      }
    },
    quadraticCurveTo(x1, y1, x2, y2) {
      const p0 = cur && cur.length ? cur[cur.length - 1] : apply(x1, y1);
      const p1 = apply(x1, y1);
      const p2 = apply(x2, y2);
      for (let i = 1; i <= 16; i += 1) {
        const u = i / 16;
        const a = (1 - u) * (1 - u);
        const b = 2 * (1 - u) * u;
        const d = u * u;
        push(a * p0[0] + b * p1[0] + d * p2[0], a * p0[1] + b * p1[1] + d * p2[1]);
      }
    },
    fill() {
      flush('fill');
      path = [];
      cur = null;
    },
    stroke() {
      flush('stroke');
      path = [];
      cur = null;
    },
    fillRect(x, y, w, h) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      flush('fill');
      path = [];
      cur = null;
    },
    strokeRect(x, y, w, h) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      flush('stroke');
      path = [];
      cur = null;
    },
    setLineDash(arr) {
      st.lineDash = Array.isArray(arr) ? arr.slice() : [];
    },
    /**
     * `clip()`：`hatchPolygon` 会先建立路径再 clip，然后画斜线。
     * 这里把当前路径记成"后续画笔的裁剪多边形"，交给 Python 端做遮罩 ——
     * 不这么做，剖面线会铺满整张画布（`Draw.ground` 的斜线就溢出来了）。
     */
    clip() {
      const subs = path.filter((p) => p.length >= 3).map((p) => p.map((q) => q.slice()));
      if (subs.length) st.clipPaths = subs;
    },
    rect(x, y, w, h) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
    },
    fillText(text, x, y) {
      const p = apply(x, y);
      const size = Number((/(\d+(?:\.\d+)?)px/.exec(st.font) ?? [])[1] ?? 12);
      ops.push({
        kind: 'text',
        text: String(text),
        x: Number(p[0].toFixed(2)),
        y: Number(p[1].toFixed(2)),
        size: Math.max(6, Math.round(size * sy())),
        color: hexOf(st.fillStyle, '#000000'),
        align: st.textAlign,
        rot: Math.atan2(st.m[1], st.m[0]),
        alpha: st.globalAlpha,
      });
    },
    strokeText(text, x, y) {
      ctx.fillText(text, x, y);
    },
    measureText: (t) => ({ width: String(t).length * 7 }),
    drawImage() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };

  // 样式赋值：直接落到 st 上（replay 里都是 `ctx.strokeStyle = ...` 这类）
  const proxy = new Proxy(ctx, {
    set(target, prop, value) {
      if (prop in st) st[prop] = value;
      else target[prop] = value;
      return true;
    },
    get(target, prop) {
      if (prop in st) return st[prop];
      return target[prop];
    },
  });

  return { ctx: proxy, ops };
}

const args = parseArgs(process.argv.slice(2));
if (!args.program) {
  console.error('用法：node tools/_shot.mjs <program.json> [--n 6] [--times 0,1] [--out dir]');
  process.exit(2);
}
const programPath = resolve(args.program);
/** `.json` 直接解析（动态 import 带 JSON 属性会报 ERR_IMPORT_ATTRIBUTE_MISSING）；`.mjs` 走 import */
const program = programPath.toLowerCase().endsWith('.json')
  ? JSON.parse(readFileSync(programPath, 'utf8'))
  : (await import(pathToFileURL(programPath).href)).default;
const outDir = resolve(args.out ?? join('tests', 'reports', `shot-${program.id ?? 'q'}`));
mkdirSync(outDir, { recursive: true });

const canvas = makeMockCanvas(args.w, args.h);
const assembly = assembleProgramSource(program.slots, { mode: program.mode ?? 'NUMERIC' });
// eslint-disable-next-line no-new-func
const factory = new Function('runtime', `${assembly}\nreturn buildProgram;`)(sandboxBundle());
const player = createPlayerFromFactory(factory, { canvas, dpr: 1 });
const duration = player.duration;
const times = args.times?.length
  ? args.times
  : Array.from({ length: args.n }, (_, i) => (duration * i) / Math.max(1, args.n - 1));

const frames = [];
for (const [i, t] of times.entries()) {
  player.state.t = Math.max(0, Math.min(duration, t));
  const frame = player.render();
  const rec = createRecorder(args.w, args.h);
  replayToCanvas(rec.ctx, frame.records, frame.transform, {});
  const file = join(outDir, `frame-${String(i).padStart(2, '0')}.json`);
  writeFileSync(
    file,
    JSON.stringify({ t: player.state.t, width: args.w, height: args.h, ops: rec.ops }),
    'utf8',
  );
  frames.push({ index: i, t: Number(player.state.t.toFixed(4)), ops: rec.ops.length, file });
}

writeFileSync(
  join(outDir, 'meta.json'),
  JSON.stringify({ id: program.id ?? null, title: program.title ?? null, duration, width: args.w, height: args.h, frames }, null, 2),
  'utf8',
);
console.log(`_shot ${program.id ?? ''} · duration=${duration.toFixed(3)} · ${frames.length} 帧 → ${outDir}`);
for (const f of frames) console.log(`  t=${String(f.t).padEnd(7)} ops=${f.ops}`);
