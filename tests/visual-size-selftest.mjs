#!/usr/bin/env node
/**
 * 布局坐标门禁（2026-10-24 回滚动画契约后）。
 *
 * 判什么：
 *   1. `state` **只给位置**（`cx/cy` + `anchor`），**不给尺寸**（没有 w/h/r）；
 *   2. `Draw` **不再折算坐标**：drwFrame 写的就是纸面单位，原样进命令缓冲；
 *   3. 相机固定拍 10×6 纸：**同一个 drawFrame 在 1.2 m 与 1.2×10⁶ m 的题里像素尺寸相同**
 *      —— 这条是"物块只剩 4 px"那个病的回归钉；
 *   4. 画到纸外仍要告警一次（不静默）；
 *   5. 老程序（无 `SIM.stage`）不受影响；手动放大只改相机，不动纸面与物理。
 */
import { parseAnalysisTable } from '../core/analysis/parse.mjs';
import { generateProgramSlots } from '../core/analysis/generate.mjs';
import { assembleProgramSource, sandboxBundle, createPlayerFromFactory } from '../sdk/runtime/animation-runtime.mjs';
import { makeMockCanvas } from './harness/canvas-harness.mjs';

const W = 880;
const H = 388;
const SPANS = [1.2, 12, 1.2e6];

function analysisFor(span, type = 'block') {
  const v = span / 2;
  return [
    'element: block_A',
    `type: ${type}`,
    'segment: 1',
    't0: 0',
    't1: 2',
    'x0: 0',
    'y0: 0.05',
    `vx0: ${v}`,
    'vy0: 0',
    'ax: 0',
    'ay: 0',
    'x: x0 + vx0*(t - t0)',
    'y: y0',
  ].join('\n');
}

function build(span, drawFrame, type = 'block') {
  const a = parseAnalysisTable(analysisFor(span, type));
  if (!a.ok) throw new Error(`分析表解析失败：${JSON.stringify(a.problems)}`);
  const slots = generateProgramSlots({ analysis: a, problem: '合成用例', breakdownText: 'title: 一路匀速\ntex: 演示', drawFrame });
  const canvas = makeMockCanvas(W, H);
  const assembly = assembleProgramSource(slots, { mode: 'BOTH' });
  const factory = new Function('runtime', `${assembly}\nreturn buildProgram;`)(sandboxBundle());
  const player = createPlayerFromFactory(factory, { canvas, dpr: 1 });
  player.state.mask = { velocity: false, acceleration: false, force: false, aux: false, trace: false, grid: false };
  player.state.t = 0;
  const frame = player.render();
  return { player, frame, canvas };
}

const boxWidthOf = (player) => {
  const box = player.buffer.records.find((r) => r.op === 'polygon' && r.points.length === 4);
  if (!box) return NaN;
  return Math.max(...box.points.map((p) => p[0])) - Math.min(...box.points.map((p) => p[0]));
};

let failed = 0;
const fail = (msg) => {
  console.log(`✗ ${msg}`);
  failed += 1;
};

/* ── ① state 只给位置，不给尺寸 ── */
const DRAW = 'Draw.ground(-0.4, 10.4, 0);\nDraw.box([state.block_A.cx, state.block_A.cy], 0.4, 0.3);';
{
  const { player } = build(1.2, DRAW);
  const st = player.program.stateAt(0);
  const b = st.block_A;
  console.log('state.block_A =', JSON.stringify(b));
  if (!Number.isFinite(b.cx) || !Number.isFinite(b.cy)) fail('state 没有布局坐标 cx/cy');
  if (b.w !== undefined || b.h !== undefined || b.r !== undefined) fail('state 仍然带尺寸（w/h/r 应已删除）');
  if (b.anchor !== 'bottom') fail(`anchor 应为 bottom，实际 ${b.anchor}`);
  if (!(b.cx >= 0 && b.cx <= 10 && b.cy >= 0 && b.cy <= 6)) fail('布局坐标不在 10×6 纸内');
}

/* ── ② Draw 不折算：写多少就是多少 ── */
{
  const { player } = build(1.2, 'Draw.box([2, 3], 0.4, 0.3);');
  const box = player.buffer.records.find((r) => r.op === 'polygon' && r.points.length === 4);
  const xs = box.points.map((p) => p[0]);
  const ys = box.points.map((p) => p[1]);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  console.log(`\nDraw.box([2,3],0.4,0.3) → 中心 (${cx}, ${cy})、宽 ${(Math.max(...xs) - Math.min(...xs)).toFixed(3)}`);
  if (Math.abs(cx - 2) > 1e-9 || Math.abs(cy - 3) > 1e-9) fail('Draw 把纸面坐标又折算了一次（位置被改）');
  if (Math.abs(Math.max(...xs) - Math.min(...xs) - 0.4) > 1e-9) fail('Draw 把长度缩放了（长度应原样）');
}

/* ── ③ 跨量级像素一致：同一段画法在 1.2 m 与 1.2e6 m 的题里一样大 ── */
{
  const rows = SPANS.map((span) => {
    const { player, frame } = build(span, DRAW);
    return { span, paper: boxWidthOf(player), scale: frame.transform.scale };
  });
  console.log('\n跨度(m)\t纸面宽\tpx/纸面单位\t物块像素宽');
  for (const r of rows) console.log(`${r.span}\t${r.paper.toFixed(3)}\t${r.scale.toFixed(2)}\t${(r.paper * r.scale).toFixed(2)}`);
  if (!rows.every((r) => Math.abs(r.paper - 0.4) < 1e-9)) fail('不同量级的题里物块纸面宽不一致（尺寸被世界跨度影响了）');
  const px = rows.map((r) => r.paper * r.scale);
  if (Math.max(...px) - Math.min(...px) > 1e-6) fail('不同量级的题里物块像素宽不一致（"太小"的病回来了）');
}

/* ── ④ 画到纸外要告警一次 ── */
{
  const warns = [];
  const orig = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    build(1.2, 'Draw.box([0, 0], 100, 100);');
  } finally {
    console.warn = orig;
  }
  console.log(`\n纸面溢出告警：${warns.length} 条`);
  if (!warns.some((w) => w.includes('画面超出'))) fail('纸面溢出没有告警（超纸应提示一次）');
}

/* ── ⑤ 老程序（无 stage）不受影响：坐标与长度原样 ── */
{
  const slots = {
    PROBLEM: 'p',
    STEPS: 'title: a\ntex: b',
    ANSWERS: '',
    VIEW: 'SIM = { duration: 1, bodies: [] };',
    setup: 'const T_PHYS = 1;',
    stateAt: 'return { e0: { x: 0, y: 0 } };',
    drawFrame: 'Draw.box([0, 0], 1, 1);',
    readouts: 'return [];',
  };
  const canvas = makeMockCanvas(W, H);
  const assembly = assembleProgramSource(slots, { mode: 'BOTH' });
  const factory = new Function('runtime', `${assembly}\nreturn buildProgram;`)(sandboxBundle());
  const player = createPlayerFromFactory(factory, { canvas, dpr: 1 });
  player.state.t = 0;
  player.render();
  const width = boxWidthOf(player);
  if (Math.abs(width - 1) > 1e-9) fail('无 stage 的老程序被缩放了（回归题会坏）');
}

/* ── ⑥ 手动放大（v1.1.18）：只改相机，不动纸面与物理 ── */
{
  const { player } = build(3, DRAW);
  player.state.t = 0;
  const auto = player.render().transform;
  const autoScale = auto.scale;
  const autoScreen = auto.worldToScreen(1, 1);

  const reset = player.setView({ zoom: 1, panX: 0, panY: 0 });
  if (Math.abs(reset.scale - autoScale) > 0) fail('zoom=1 时相机 scale 变了（老页面会逐像素不同）');
  const resetScreen = reset.worldToScreen(1, 1);
  if (Math.abs(resetScreen.x - autoScreen.x) > 0 || Math.abs(resetScreen.y - autoScreen.y) > 0) {
    fail('zoom=1 时 worldToScreen 变了');
  }

  const z2 = player.setView({ zoom: 2 });
  if (Math.abs(z2.scale - autoScale * 2) > 1e-9) fail(`zoom=2 的 scale ${z2.scale} ≠ 自动取景 ×2（${autoScale * 2}）`);
  const mid = z2.worldToScreen(auto.centerX, auto.centerY);
  if (Math.abs(mid.x - W / 2) > 1e-6 || Math.abs(mid.y - H / 2) > 1e-6) fail('放大后取景中心没有落在画布中心');

  const z3 = player.setView({ panX: 40, panY: -25 });
  if (Math.abs(z3.scale - autoScale * 2) > 1e-9) fail('平移时 scale 变了（平移不该改缩放）');
  const p1 = z2.worldToScreen(1, 1);
  const p3 = z3.worldToScreen(1, 1);
  if (Math.abs(p3.x - p1.x - 40) > 1e-6 || Math.abs(p3.y - p1.y + 25) > 1e-6) fail('平移量没有精确作用到屏幕上');

  player.setView({ zoom: 1, panX: 0, panY: 0 });
  player.render();
  const st = player.program.stateAt(0);
  if (!Number.isFinite(st.block_A.cx)) fail('放大把 state 弄坏了');
  if (!(player.program.SIM.stage && player.program.SIM.stage.s === undefined)) {
    fail('SIM.stage 不应带 s（带了 Draw 会二次折算）');
  }
  console.log(`\n手动放大：auto ${autoScale.toFixed(2)} px/纸面单位 → 2× ${z2.scale.toFixed(2)} · 平移 40/-25 px · 纸面宽 ${boxWidthOf(player).toFixed(3)}（不受影响）`);
}

console.log(failed ? `\n✗ 布局坐标门禁：失败 ${failed} 条` : '\n✓ 布局坐标门禁：通过');
process.exitCode = failed ? 1 : 0;
