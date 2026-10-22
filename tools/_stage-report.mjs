#!/usr/bin/env node
/**
 * _stage-report —— 自动舞台 A/B 的**只读取证**：同一台相机下，各题目里的元件在屏幕上有多大。
 *
 * 回答的是"极端比例下元件会不会过小/过大"这一个问题，给出可比较的数字：
 *   · `scale`     px / 米（相机每米换多少像素）
 *   · `w×h px`    元件在画布上的实际像素尺寸
 *   · `占画布`     元件宽度 / 画布宽度
 *
 * 用法：node tools/_stage-report.mjs
 * 只读：不写题目、不改运行时。
 */
import { readFileSync } from 'node:fs';

import { assembleProgramSource, sandboxBundle, createPlayerFromFactory } from '../sdk/runtime/animation-runtime.mjs';
import { makeMockCanvas } from '../tests/harness/canvas-harness.mjs';

const W = 880;
const H = 388;

function measure(program, label) {
  const canvas = makeMockCanvas(W, H);
  const assembly = assembleProgramSource(program.slots, { mode: program.mode ?? 'BOTH' });
  // eslint-disable-next-line no-new-func
  const factory = new Function('runtime', `${assembly}\nreturn buildProgram;`)(sandboxBundle());
  const player = createPlayerFromFactory(factory, { canvas, dpr: 1 });
  player.state.t = 0;
  const frame = player.render();
  const scale = frame.transform.scale;
  const st = player.program.stateAt(0);
  const rows = [];
  for (const [key, b] of Object.entries(st ?? {})) {
    if (!b || typeof b !== 'object') continue;
    const w = Number(b.w);
    const h = Number(b.h);
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      rows.push({ key, note: '无 w/h（画法由 drawFrame 决定）' });
      continue;
    }
    rows.push({ key, wPx: +(w * scale).toFixed(1), hPx: +(h * scale).toFixed(1), share: +((w * scale) / W * 100).toFixed(1) });
  }
  return { label, duration: player.duration, scale: +scale.toFixed(1), rows };
}

const files = [
  ['tests/real-exam/q04.program.json', 'q04 传送带（实物：1 m 量级）'],
  ['tests/real-exam/q06.program.json', 'q06 导轨（符号题，v0=2 m/s）'],
  ['tests/real-exam/q09.program.json', 'q09 汽缸（ab=0.1 m）'],
];

/** 合成一份"1.2×10⁶ m"的题：同一台相机、同一个元件，只改尺度 —— 这正是要防的极端 */
function synthetic(span) {
  const x = `(${span})*(t/${2})`;
  return {
    id: `synthetic-${span}`,
    slots: {
      PROBLEM: '合成用例：量级对比',
      STEPS: 'title: 一路匀速\ntex: 演示',
      ANSWERS: '',
      VIEW: 'SIM = { duration: 2, bodies: [{ id: "e0", at: function (s) { const b = s.e0; return [b.cx ?? b.x, b.cy ?? b.y]; } }] };',
      setup: 'const T_PHYS = 2;',
      stateAt: [
        'const state = {};',
        `const x0 = ${x};`,
        'state.e0 = { x: x0, y: 0, type: "block", cx: x0 + 0.2, cy: 0.15, w: 0.4, h: 0.3 };',
        'return state;',
      ].join('\n'),
      drawFrame: 'Draw.ground(0, 1.2, 0);\nDraw.box([state.e0.cx, state.e0.cy], state.e0.w, state.e0.h);',
      readouts: 'return [{ key: "x", label: "x", value: state.e0.x, unit: "m" }];',
    },
    mode: 'BOTH',
  };
}
files.push(['synthetic-1.2', '合成：跨度 1.2 m（物块 w=0.4 m）']);
files.push(['synthetic-1200000', '合成：跨度 1.2×10⁶ m（同一个物块）']);

const load = (path) => JSON.parse(readFileSync(path, 'utf8'));

console.log(`自动舞台取证 · 画布 ${W}×${H}`);
console.log('（scale = 相机每米多少像素；share = 元件宽度占画布宽度的百分比）\n');
for (const [path, label] of files) {
  const prog = path.startsWith('synthetic') ? synthetic(Number(path.split('-')[1])) : load(path);
  const r = measure(prog, label);
  console.log(`${label}`);
  console.log(`  时长 ${r.duration}s · scale ${r.scale} px/m`);
  for (const row of r.rows) {
    if (row.note) console.log(`   · ${row.key}: ${row.note}`);
    else console.log(`   · ${row.key}: ${row.wPx}×${row.hPx} px（占宽 ${row.share}%）`);
  }
  console.log('');
}
console.log('判读：同一个 w=0.4 m 的物块，在 1.2 m 跨度里占画布 ~24%，在 1.2×10⁶ m 跨度里不到 1 像素。');
console.log('这就是"元件过小"的可量化形态；相机 fit 物理包络是根因，不是 drawFrame 写错。');
