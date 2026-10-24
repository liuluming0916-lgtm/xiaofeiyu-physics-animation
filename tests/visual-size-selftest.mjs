#!/usr/bin/env node
/**
 * 方案二绘制门禁（2026-10-24：物理世界坐标 + 相机自动取景）。
 *
 * 判什么：
 *   1. `state` 只给 `x/y/type`（物理米、质心）；**没有 cx/cy、anchor、w/h/r**；
 *   2. `VIEW` **没有 SIM.stage**；`bodies.at` 返回物理 `[x,y]`；
 *   3. `Draw` 不再折算坐标：drawFrame 写多少（米）就是多少；
 *   4. 相机自动取景：世界跨度变了，像素比例跟着变（这是方案二接受的代价）；
 *      主体仍在画布内；
 *   5. 老程序（无 stage）行为不变；
 *   6. 手动放大只改相机，不动物理与 state。
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
  return { player, frame, canvas, slots };
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

/* ── ① state 只给物理位置，不给 cx/cy/anchor/尺寸 ── */
const DRAW = 'Draw.ground(-2, 8, 0);\nDraw.box([state.block_A.x, state.block_A.y], 0.4, 0.3);';
{
  const { player, slots } = build(1.2, DRAW);
  const st = player.program.stateAt(0);
  const b = st.block_A;
  console.log('state.block_A =', JSON.stringify(b));
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) fail('state 没有物理坐标 x/y');
  if (b.cx !== undefined || b.cy !== undefined) fail('state 仍带 cx/cy（方案二应删除）');
  if (b.anchor !== undefined) fail('state 仍带 anchor（方案二应删除）');
  if (b.w !== undefined || b.h !== undefined || b.r !== undefined) fail('state 仍带尺寸（w/h/r 应已删除）');
  if (String(slots.VIEW).includes('stage')) fail('VIEW 仍带 SIM.stage（方案二应删除）');
  if (!String(slots.VIEW).includes('b.x, b.y')) fail('VIEW 的 bodies 没有用物理 x/y');
}

/* ── ② Draw 不折算：写多少米就是多少 ── */
{
  const { player } = build(1.2, 'Draw.box([2, 3], 0.4, 0.3);');
  const box = player.buffer.records.find((r) => r.op === 'polygon' && r.points.length === 4);
  const xs = box.points.map((p) => p[0]);
  const ys = box.points.map((p) => p[1]);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  console.log(`\nDraw.box([2,3],0.4,0.3) → 世界中心 (${cx}, ${cy})、宽 ${(Math.max(...xs) - Math.min(...xs)).toFixed(3)}`);
  if (Math.abs(cx - 2) > 1e-9 || Math.abs(cy - 3) > 1e-9) fail('Draw 把坐标又折算了一次（位置被改）');
  if (Math.abs(Math.max(...xs) - Math.min(...xs) - 0.4) > 1e-9) fail('Draw 把长度缩放了（长度应原样，单位米）');
}

/* ── ③ 相机自动取景：跨度变了像素比例跟着变，主体仍在画布内 ── */
{
  const rows = SPANS.map((span) => {
    const { player, frame } = build(span, DRAW);
    return { span, world: boxWidthOf(player), scale: frame.transform.scale, frame };
  });
  console.log('\n跨度(m)\t世界宽(m)\tpx/m\t物块像素宽');
  for (const r of rows) console.log(`${r.span}\t${r.world.toFixed(3)}\t${r.scale.toFixed(4)}\t${(r.world * r.scale).toFixed(2)}`);
  if (!rows.every((r) => Math.abs(r.world - 0.4) < 1e-9)) fail('drawFrame 写死的 0.4 m 被改动了');
  if (!rows.every((r) => r.scale > 0 && Number.isFinite(r.scale))) fail('相机没有给出有效比例');
  const px = rows.map((r) => r.world * r.scale);
  if (!(Math.max(...px) - Math.min(...px) > 1e-6)) fail('不同跨度像素比例相同（说明相机没有自动取景）');
  /* 主体仍可见：物块世界中心在画布内 */
  for (const r of rows) {
    const c = r.frame.transform.worldToScreen(0, 0.05);
    if (!(c.x >= 0 && c.x <= W && c.y >= 0 && c.y <= H)) fail(`跨度 ${r.span} 的主体被取景裁掉了`);
  }
}

/* ── ④ 老程序（无 stage）不受影响：坐标与长度原样 ── */
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

/* ── ⑤ 手动放大：只改相机，不动物理与 state ── */
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
  if (!Number.isFinite(st.block_A.x)) fail('放大把 state 弄坏了');
  if (player.program.SIM.stage !== undefined) fail('方案二不应有 SIM.stage');
  console.log(`\n手动放大：auto ${autoScale.toFixed(2)} px/m → 2× ${z2.scale.toFixed(2)} · 平移 40/-25 px · 世界宽 ${boxWidthOf(player).toFixed(3)}（不受影响）`);
}

console.log(failed ? `\n✗ 方案二绘制门禁：失败 ${failed} 条` : '\n✓ 方案二绘制门禁：通过');
process.exitCode = failed ? 1 : 0;
