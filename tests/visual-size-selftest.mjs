#!/usr/bin/env node
/**
 * 视觉尺寸一致性门禁（2026-10-23，A 方案的验收判据）。
 *
 * 判什么：**同一类元件，在量级完全不同的题里，屏幕上的像素宽度必须一样。**
 *   造三道同构题（物块匀速，只有跨度不同：1.2 m / 12 m / 1.2×10⁶ m），
 *   都走"分析表 → 生成器 → 运行时"这条真链路，量物块的实际像素宽度。
 *   判据：最大 / 最小 ≤ 1.2（差 < 20%）。
 *
 * 为什么需要它：归一化是"约定"，约定会被后来的改动悄悄破坏（比如某人又把相机改回 fit 包络）。
 *   没有这条闸门，"元件又变小了"只能靠人眼发现。
 *
 * 用法：node tests/visual-size-selftest.mjs
 */
import { parseAnalysisTable } from '../core/analysis/parse.mjs';
import { generateProgramSlots } from '../core/analysis/generate.mjs';
import { assembleProgramSource, sandboxBundle, createPlayerFromFactory } from '../sdk/runtime/animation-runtime.mjs';
import { makeMockCanvas } from './harness/canvas-harness.mjs';

const W = 880;
const H = 388;
const SPANS = [1.2, 12, 1.2e6];

function analysisFor(span) {
  const v = span / 2; // 2 s 走完整段
  return [
    'element: block_A',
    'type: block',
    'segment: 1',
    't0: 0',
    't1: 2',
    'x0: 0',
    'y0: 0',
    `vx0: ${v}`,
    'vy0: 0',
    'ax: 0',
    'ay: 0',
    'x: x0 + vx0*(t - t0)',
    'y: y0',
  ].join('\n');
}

function measure(span) {
  const a = parseAnalysisTable(analysisFor(span));
  if (!a.ok) throw new Error(`分析表解析失败：${JSON.stringify(a.problems)}`);
  const slots = generateProgramSlots({
    analysis: a,
    problem: '合成用例',
    breakdownText: 'title: 一路匀速\ntex: 演示',
    drawFrame: 'Draw.ground(0, 10, 0);\nDraw.box([state.e0.cx, state.e0.cy], state.e0.w, state.e0.h);',
  });
  const canvas = makeMockCanvas(W, H);
  const assembly = assembleProgramSource(slots, { mode: 'BOTH' });
  // eslint-disable-next-line no-new-func
  const factory = new Function('runtime', `${assembly}\nreturn buildProgram;`)(sandboxBundle());
  const player = createPlayerFromFactory(factory, { canvas, dpr: 1 });
  player.state.t = 0;
  player.render();
  const st = player.program.stateAt(0);
  const scale = player.program.SIM?.stage ? (canvas.width && player.transform?.scale) || 0 : 0;
  /* 相机 scale：stage 存在时由纸决定；直接取渲染后的写实值 */
  const frame = player.render();
  const px = frame.transform.scale;
  return {
    span,
    stage: Boolean(player.program.SIM?.stage),
    w: st.e0.w,
    h: st.e0.h,
    scale: px,
    widthPx: st.e0.w * px,
    heightPx: st.e0.h * px,
  };
}

const rows = SPANS.map(measure);
console.log('视觉尺寸一致性 · 画布 ' + W + '×' + H);
console.log('跨度(m)\tstage\tw(布局)\tscale(px/单位)\t物块宽(px)\t物块高(px)');
for (const r of rows) {
  console.log(`${r.span}\t${r.stage}\t${r.w}\t${r.scale.toFixed(1)}\t${r.widthPx.toFixed(1)}\t${r.heightPx.toFixed(1)}`);
}

let failed = 0;
const widths = rows.map((r) => r.widthPx);
const ratio = Math.max(...widths) / Math.min(...widths);
const ok = ratio <= 1.2;
console.log(`\n物块宽度：最大 ${Math.max(...widths).toFixed(1)} px / 最小 ${Math.min(...widths).toFixed(1)} px ⇒ 比 ${ratio.toFixed(3)}（判据 ≤ 1.2）`);
if (!ok) {
  console.log('✗ 视觉尺寸不一致：同一元件在不同量级的题里像素宽度差超过 20%');
  failed += 1;
}
if (!rows.every((r) => r.stage)) {
  console.log('✗ 有题目没有 stage（相机仍在 fit 物理包络）');
  failed += 1;
}

console.log(failed ? `\n✗ 视觉尺寸门禁：失败 ${failed} 条` : '\n✓ 视觉尺寸门禁：通过');
process.exitCode = failed ? 1 : 0;
