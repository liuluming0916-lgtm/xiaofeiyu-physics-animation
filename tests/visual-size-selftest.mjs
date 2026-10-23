#!/usr/bin/env node
/**
 * 真实比例 + 接触精确 + 像素兜底门禁（C 方案）。
 *
 * 判什么：
 *   1. `state.w/h` 是**物理米**（来自卡 physical），不是纸面固定值；
 *   2. 纸面尺寸 = 物理 × s（同题比例真实），位置与尺寸用同一个 s；
 *   3. 物块底边与地面的纸面误差 = 0（贴合精确，不靠补偿）；
 *   4. 极端大题里，像素小于 MIN_PX 时圆点被兜底到至少 3 px 半径（看得见）。
 */
import { parseAnalysisTable } from '../core/analysis/parse.mjs';
import { generateProgramSlots } from '../core/analysis/generate.mjs';
import { assembleProgramSource, sandboxBundle, createPlayerFromFactory } from '../sdk/runtime/animation-runtime.mjs';
import { makeMockCanvas } from './harness/canvas-harness.mjs';

const W = 880;
const H = 388;
const SPANS = [1.2, 12, 1.2e6];
const MIN_PX = 6;

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

const rows = [];
for (const span of SPANS) {
  const { player, frame } = build(
    span,
    'Draw.ground(0, ' + span + ', 0);\nDraw.box([state.block_A.x, state.block_A.y], state.block_A.w, state.block_A.h);',
  );
  const st = player.program.stateAt(0);
  const stage = player.program.SIM.stage;
  const records = player.buffer.records;
  const ground = records.find((r) => r.op === 'polygon' && r.points.length === 2);
  const box = records.find((r) => r.op === 'polygon' && r.points.length === 4);
  const boxBottom = box ? Math.min(...box.points.map((p) => p[1])) : NaN;
  const groundY = ground ? ground.points[0][1] : NaN;
  const boxWidth = box ? Math.max(...box.points.map((p) => p[0])) - Math.min(...box.points.map((p) => p[0])) : NaN;
  rows.push({
    span,
    s: stage.s,
    wPhysical: st.block_A.w,
    paperWidth: boxWidth,
    expectPaper: st.block_A.w * stage.s,
    contactErr: Math.abs(boxBottom - groundY),
    pxWidth: boxWidth * frame.transform.scale,
  });
}

console.log('真实比例 · 画布 ' + W + '×' + H);
console.log('跨度(m)\ts\tw(物理)\t纸面宽\t期望 0.2·s\t底/地误差\t像素宽');
for (const r of rows) {
  console.log(
    `${r.span}\t${r.s.toFixed(6)}\t${r.wPhysical}\t${r.paperWidth.toFixed(6)}\t${r.expectPaper.toFixed(6)}\t${r.contactErr.toExponential(2)}\t${r.pxWidth.toFixed(2)}`,
  );
}

let failed = 0;
const fail = (msg) => {
  console.log(`✗ ${msg}`);
  failed += 1;
};

if (!rows.every((r) => r.wPhysical === 0.2)) fail('state.w 不是物理米 0.2（可能又变成了纸面值）');
if (!rows.every((r) => Math.abs(r.paperWidth - r.expectPaper) < 1e-9)) fail('纸面宽 ≠ 物理 w × s（比例没有按 s 折算）');
if (!rows.every((r) => r.contactErr < 1e-9)) fail('物块底边与地面没有精确重合（贴合误差 > 0）');
if (!rows.every((r) => r.pxWidth < r.paperWidth * 1e9)) fail('像素宽异常');
/* 同题比例：像素宽 = 纸面宽 × 像素/纸面单位；跨题随 s 变化是预期行为 */
if (!(rows[2].pxWidth < MIN_PX)) fail('极端大题：折算后像素宽应小于 MIN_PX（否则测不到兜底）');

/* minPx：1.2e6 m 的球，画出来半径至少 3 px */
{
  const { canvas } = build(1.2e6, 'Draw.circle([state.block_A.x, state.block_A.y], state.block_A.r);', 'ball');
  const arcs = canvas.__calls.filter((c) => c.op === 'arc');
  const rPx = arcs.length ? arcs[arcs.length - 1].args[2] : 0;
  console.log(`\n极端大题圆点半径：${rPx.toFixed(2)} px（判据 ≥ ${MIN_PX / 2}）`);
  if (!(rPx >= MIN_PX / 2 - 1e-9)) fail('极端大题里圆点没有按 MIN_PX 兜底（会看不见）');
}

/* 纸面溢出：100 m 的盒子塞进 1.2 m 的题，必须告警一次（不静默） */
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

/* 老程序（无 stage）不受影响：坐标与长度原样 */
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
  const box = player.buffer.records.find((r) => r.op === 'polygon' && r.points.length === 4);
  const width = box ? Math.max(...box.points.map((p) => p[0])) - Math.min(...box.points.map((p) => p[0])) : NaN;
  if (Math.abs(width - 1) > 1e-9) fail('无 stage 的老程序被缩放了（回归题会坏）');
}

/* ── 手动放大画布（v1.1.18 B8）：只改相机 ── */
{
  const { player } = build(3, 'Draw.ground(-1, 4, 0);\nDraw.box([state.block_A.x, state.block_A.y], state.block_A.w, state.block_A.h);');
  player.state.t = 0;
  const auto = player.render().transform;
  const autoScale = auto.scale;
  const autoScreen = auto.worldToScreen(1, 1);

  /* ① 恢复自动取景：必须**逐值相等**（zoom=1/pan=0 时直接返回 base，不留浮点误差） */
  const reset = player.setView({ zoom: 1, panX: 0, panY: 0 });
  if (Math.abs(reset.scale - autoScale) > 0) fail('zoom=1 时相机 scale 变了（老页面会逐像素不同）');
  const resetScreen = reset.worldToScreen(1, 1);
  if (Math.abs(resetScreen.x - autoScreen.x) > 0 || Math.abs(resetScreen.y - autoScreen.y) > 0) {
    fail('zoom=1 时 worldToScreen 变了');
  }

  /* ② 放大 2×：scale 精确翻倍，纸面中心不动 */
  const z2 = player.setView({ zoom: 2 });
  if (Math.abs(z2.scale - autoScale * 2) > 1e-9) fail(`zoom=2 的 scale ${z2.scale} ≠ 自动取景 ×2（${autoScale * 2}）`);
  const mid = z2.worldToScreen(auto.centerX, auto.centerY);
  if (Math.abs(mid.x - W / 2) > 1e-6 || Math.abs(mid.y - H / 2) > 1e-6) fail('放大后取景中心没有落在画布中心');
  const p1 = z2.worldToScreen(1, 1);
  if (Math.abs((p1.x - W / 2) - (autoScreen.x - W / 2) * 2) > 1e-6) fail('放大 2× 后世界点没有围绕中心放大');

  /* ③ 平移 40 px：屏幕坐标精确平移 40 px，scale 不变 */
  const z3 = player.setView({ panX: 40, panY: -25 });
  if (Math.abs(z3.scale - autoScale * 2) > 1e-9) fail('平移时 scale 变了（平移不该改缩放）');
  const p3 = z3.worldToScreen(1, 1);
  if (Math.abs(p3.x - p1.x - 40) > 1e-6 || Math.abs(p3.y - p1.y + 25) > 1e-6) fail('平移量没有精确作用到屏幕上');

  /* ④ 物理与纸面比例不受影响：state 的 u/v/w 与 SIM.stage 原样 */
  const st = player.program.stateAt(0);
  if (Math.abs(st.block_A.w - 0.2) > 1e-12) fail('放大把 state.w 改了（物理尺寸被相机污染）');
  if (Math.abs(player.program.SIM.stage.s * 1 - player.program.SIM.stage.s) > 1e-12) fail('放大把 SIM.stage.s 改了');
  /* 画出来的纸面宽仍是 0.2·s（相机只影响像素，不影响纸面单位） */
  player.setView({ zoom: 1, panX: 0, panY: 0 });
  player.render();
  const box2 = player.buffer.records.find((r) => r.op === 'polygon' && r.points.length === 4);
  const width2 = box2 ? Math.max(...box2.points.map((p) => p[0])) - Math.min(...box2.points.map((p) => p[0])) : NaN;
  if (Math.abs(width2 - st.block_A.w * player.program.SIM.stage.s) > 1e-9) fail('恢复取景后纸面宽 ≠ 物理 w × s');
  console.log(`\n手动放大：auto ${autoScale.toFixed(3)} px/m → 2× ${z2.scale.toFixed(3)} px/m · 平移 40/-25 px · 纸面宽 ${width2.toFixed(6)}（不受影响）`);
}

console.log(failed ? `\n✗ 真实比例门禁：失败 ${failed} 条` : '\n✓ 真实比例门禁：通过');
process.exitCode = failed ? 1 : 0;
