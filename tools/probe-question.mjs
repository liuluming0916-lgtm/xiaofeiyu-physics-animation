#!/usr/bin/env node
/**
 * probe-question —— 单题数值/几何探针（**作者自检工具**，不是 §7.2 判据）。
 *
 * 用法：
 *   node tools/probe-question.mjs q02
 *   node tools/probe-question.mjs q02 --dt 0.002 --json
 *
 * 为什么需要它：C1–C9 只回答"契约与自洽"，C10 只回答"是否越出**自己声明**的区域"。
 * 而"圆弧到底和斜面切没切上""滑块有没有穿进斜面里""阶段交界处画面上的滑块有没有横向跳"
 * 这类问题，判据看不见，人眼又只能看到生成后的 HTML。这个探针把这些问题变成数字：
 *
 *   · `setup()` 用 RETURN 导出的常量（自检量应全部为 0）；
 *   · 按 `phase` 变化的时刻分段，给出每段的实测包围范围（可直接抄进 `SIM.regions`）；
 *   · 每个阶段交界处比较 `state` 与"**画出来的**滑块位置"`state + n̂·rOff` 的前后差 ——
 *     位置连续但法向翻转时，画面上仍会横跳一次，这一项专门抓它；
 *   · 全时段最小 y、最大单步位移、命令数峰值。
 *
 * 只读：不写文件、不改题目。
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assembleProgramSource, sandboxBundle, createPlayerFromFactory } from '../sdk/runtime/animation-runtime.mjs';
import { makeMockCanvas } from '../tests/harness/canvas-harness.mjs';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUESTION_DIR = join(PROJECT_ROOT, 'tests', 'regression-15');

function parseArgs(argv) {
  const out = { filter: null, dt: 0.002, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dt') out.dt = Number(argv[++i]);
    else if (a === '--json') out.json = true;
    else if (!a.startsWith('--')) out.filter = a;
  }
  return out;
}

/** 只打印能一眼看懂的量：数字、字符串、短数组 */
function printable(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toPrecision(8)) : String(value);
  if (typeof value === 'string') return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  if (Array.isArray(value)) return `[${value.length} 项]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).join(', ')}}`;
  return String(value);
}

export function probe(program, opts = {}) {
  const dt = opts.dt ?? 0.002;
  const canvas = makeMockCanvas();
  const assembly = assembleProgramSource(program.slots, { mode: program.mode ?? 'NUMERIC' });
  // eslint-disable-next-line no-new-func
  const factory = new Function('runtime', `${assembly}\nreturn buildProgram;`)(sandboxBundle());
  const player = createPlayerFromFactory(factory, { canvas, dpr: 1 });
  const ctx = player.program.context;
  const duration = player.duration;

  const exported = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (typeof v === 'function') continue;
    exported[k] = printable(v);
  }

  const series = [];
  for (let t = 0; t <= duration + 1e-9; t += dt) {
    const time = Math.min(t, duration);
    const st = player.program.stateAt(time);
    series.push({ t: time, st });
  }

  // 阶段切分：phase 变化处 + 首尾。
  // 注意有些题的 `phase` 是**连续**量（如 q04 的相位），逐点分组会炸成上千段 —— 只在
  // 取值数 ≤ 8 时才按 phase 分段，否则整段当作一段（phase = null）。
  const phaseValues = new Set(series.map((p) => p.st.phase));
  const segmentByPhase = phaseValues.size <= 8;
  const segments = [];
  for (const point of series) {
    const ph = segmentByPhase ? point.st.phase : null;
    const last = segments[segments.length - 1];
    if (!last || last.phase !== ph) segments.push({ phase: ph, t0: point.t, t1: point.t, keys: {} });
    const seg = segments[segments.length - 1];
    seg.t1 = point.t;
    for (const [k, v] of Object.entries(point.st)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const box = (seg.keys[k] = seg.keys[k] ?? { min: v, max: v });
      if (v < box.min) box.min = v;
      if (v > box.max) box.max = v;
    }
  }
  if (!segmentByPhase) segments.splice(1);

  const offsets = (st) => [st.x + (st.nx ?? 0) * (st.rOff ?? 0), st.y + (st.ny ?? 0) * (st.rOff ?? 0)];
  const boundaries = [];
  for (let i = 1; i < segments.length; i += 1) {
    const before = segments[i - 1];
    const after = segments[i];
    const a = at(series, before.t1);
    const b = at(series, after.t0);
    boundaries.push({ t: after.t0, from: before.phase, to: after.phase, a, b });
  }

  let maxStep = { delta: 0, t: 0, key: null };
  let minY = { value: Infinity, t: 0 };
  for (let i = 0; i < series.length; i += 1) {
    const st = series[i].st;
    if (typeof st.y === 'number' && st.y < minY.value) minY = { value: st.y, t: series[i].t };
    if (i === 0) continue;
    const prev = series[i - 1].st;
    for (const [k, v] of Object.entries(st)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const p = prev[k];
      if (typeof p !== 'number' || !Number.isFinite(p)) continue;
      const d = Math.abs(v - p);
      if (d > maxStep.delta) maxStep = { delta: d, t: series[i].t, key: k };
    }
  }

  return { program, player, duration, exported, segments, boundaries, maxStep, minY, series, offsets, dt };
}

function at(series, t) {
  let best = series[0];
  for (const p of series) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best.st;
}
const nearest = at;

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const files = readdirSync(QUESTION_DIR)
    .filter((f) => f.endsWith('.mjs'))
    .filter((f) => !args.filter || f.startsWith(args.filter))
    .sort();
  if (!files.length) {
    console.error(`✗ 没有匹配的题目：${args.filter ?? '(全部)'}`);
    process.exitCode = 1;
    return;
  }
  const payload = [];
  for (const file of files) {
    const program = (await import(pathToFileURL(join(QUESTION_DIR, file)).href)).default;
    const r = probe(program, { dt: args.dt });
    const entry = {
      id: program.id,
      title: program.title,
      duration: r.duration,
      exported: r.exported,
      segments: r.segments.map((s) => ({
        phase: s.phase,
        t0: s.t0,
        t1: s.t1,
        x: [s.keys.x?.min, s.keys.x?.max],
        y: [s.keys.y?.min, s.keys.y?.max],
        /* 全部数值键的实测范围：写 C10 的 SIM.regions 时直接抄 */
        ranges: Object.fromEntries(
          Object.entries(s.keys).map(([k, box]) => [k, [Number(box.min.toPrecision(6)), Number(box.max.toPrecision(6))]]),
        ),
      })),
      boundaries: r.boundaries.map((b) => {
        const da = b.a && r.offsets(b.a);
        const db = b.b && r.offsets(b.b);
        return {
          t: b.t,
          from: b.from,
          to: b.to,
          stateJump: b.a && b.b ? Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) : null,
          drawnJump: da && db ? Math.hypot(db[0] - da[0], db[1] - da[1]) : null,
          normalFlip: b.a && b.b ? Math.hypot(b.b.nx - b.a.nx, b.b.ny - b.a.ny) : null,
        };
      }),
      minY: r.minY,
      maxStep: r.maxStep,
    };
    payload.push(entry);

    if (args.json) continue;
    console.log(`\n=== ${program.index ?? ''} ${program.id} · ${program.title} ===`);
    console.log(`时长 ${r.duration.toFixed(4)}s · 采样步长 ${args.dt}s · ${r.series.length} 帧`);
    console.log('setup 导出：');
    for (const [k, v] of Object.entries(r.exported)) console.log(`  ${k.padEnd(14, ' ')} = ${v}`);
    console.log('阶段实测范围（可直接抄进 SIM.regions）：');
    for (const s of entry.segments) {
      console.log(
        `  phase ${s.phase}  t∈[${s.t0.toFixed(4)}, ${s.t1.toFixed(4)}]  ` +
          `x∈[${fmt(s.x[0])}, ${fmt(s.x[1])}]  y∈[${fmt(s.y[0])}, ${fmt(s.y[1])}]`,
      );
    }
    console.log('阶段交界：');
    for (const b of entry.boundaries) {
      console.log(
        `  t=${b.t.toFixed(4)}  phase ${b.from}→${b.to}  ` +
          `state 位移 ${fmt(b.stateJump)}  画出的滑块位移 ${fmt(b.drawnJump)}  法向变化 ${fmt(b.normalFlip)}`,
      );
    }
    console.log(`最小 y = ${fmt(entry.minY.value)}（t=${entry.minY.t.toFixed(4)}）· 最大单步位移 ${fmt(entry.maxStep.delta)}（${entry.maxStep.key} @ t=${entry.maxStep.t.toFixed(4)}）`);
  }
  if (args.json) console.log(JSON.stringify(payload, null, 2));
}

function fmt(v) {
  if (v === null || v === undefined) return '—';
  if (!Number.isFinite(v)) return String(v);
  return Math.abs(v) >= 1e-4 && Math.abs(v) < 1e6 ? v.toFixed(4) : v.toExponential(3);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  Promise.resolve(main()).catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
