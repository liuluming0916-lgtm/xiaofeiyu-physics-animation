/**
 * _gate-probe —— 验证"有舞台时 drawFrame 不得用物理坐标"这道闸。
 * 用法：node tools/_gate-probe.mjs
 */
import { dryRun } from '../core/dryrun/dry-run.mjs';

const base = {
  PROBLEM: 'p',
  STEPS: 'title: 甲\ntex: 说明',
  ANSWERS: '',
  VIEW:
    'SIM = { duration: 2, stage: {"u0":0,"u1":10,"v0":0,"v1":6}, bodies: [{ id: "e0", at: function (s) { const b = s.e0; return [b.cx ?? b.x, b.cy ?? b.y]; } }] };',
  setup: 'const T_PHYS = 2;',
  stateAt:
    'const state = {}; state.e0 = { x: t, y: 0, u: 5, v: 3, type: "block", cx: 5.2, cy: 3.15, w: 0.4, h: 0.3 }; return state;',
  drawFrame: 'Draw.box([state.e0.cx, state.e0.cy], state.e0.w, state.e0.h);',
  readouts: 'return [{ key: "x", label: "x", value: state.e0.x, unit: "m" }];',
};

const meta = { mode: 'BOTH', tPhys: 2, boundaries: [0, 2] };

const ok = await dryRun({ slots: base, entry: 'ok', meta });
const c1ok = ok.report.checks.find((c) => c.id === 'C1');
console.log('布局坐标 → verdict', ok.report.verdict, '| C1', c1ok.status, 'blocking', c1ok.blocking);

const bad = { ...base, drawFrame: 'Draw.box([state.e0.x, state.e0.y], state.e0.w, state.e0.h);' };
const ng = await dryRun({ slots: bad, entry: 'bad', meta });
const c1 = ng.report.checks.find((c) => c.id === 'C1');
console.log('物理坐标 → verdict', ng.report.verdict, '| C1', c1.status, 'blocking', c1.blocking);
console.log('诊断：', (c1.diagnostics ?? []).map((d) => `${d.rule}:${d.message}`).join(' | ').slice(0, 240));
process.exitCode = ok.report.verdict === 'pass' && ng.report.verdict !== 'pass' ? 0 : 1;
