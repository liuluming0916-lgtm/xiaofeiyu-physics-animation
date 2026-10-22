#!/usr/bin/env node
/**
 * 朝向角 angleDeg 自检：
 *   · 水平运动 → 0°
 *   · 抛体上升/下降 → 速度方向角
 *   · 零速点 → 向前/向后找最近的非零方向
 *   · 全程静止 → 不注入（交给场景卡给静态角）
 */

import {
  assembleProgramSource,
  instantiate,
  sampleFrame,
  sandboxBundle,
} from '../sdk/runtime/animation-runtime.mjs';

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function makeProgram(stateAt) {
  const slots = {
    PROBLEM: '朝向角测试',
    STEPS: 'title: 一步\ntex: x\nt0: 0\nt1: 2',
    ANSWERS: 'symbol: x\nvalue: 1\nunit: m\nat_t: 2\nstep: 1',
    VIEW: 'SIM = { duration: 2, bodies: [{ id: "e0", at: function (s) { return [s.e0.x, s.e0.y]; } }] };',
    setup: 'const _unused = 0;',
    stateAt,
    drawFrame: 'Draw.box([state.e0.x, state.e0.y], 0.2, 0.2, { angleDeg: state.e0.angleDeg });',
    readouts: 'return [];',
  };
  const src = assembleProgramSource(slots, { mode: 'NUMERIC' });
  // eslint-disable-next-line no-new-func
  const factory = new Function('runtime', `${src}\nreturn buildProgram;`)(sandboxBundle());
  return instantiate(factory).program;
}

const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol;

console.log('朝向角 angleDeg 自检\n');

{
  const p = makeProgram('return { e0: { x: t, y: 0 } };');
  const f = sampleFrame(p, 1);
  check('水平向右 → 0°', near(f.state.e0.angleDeg, 0), String(f.state.e0.angleDeg));
}

{
  const p = makeProgram('return { e0: { x: t, y: 2*t - 5*t*t } };');
  const up = sampleFrame(p, 0.1);
  check('抛体上升 → 45°', near(up.state.e0.angleDeg, 45, 2), String(up.state.e0.angleDeg));
  const down = sampleFrame(p, 0.3);
  check('抛体下降 → -45°', near(down.state.e0.angleDeg, -45, 2), String(down.state.e0.angleDeg));
}

{
  const p = makeProgram('return { e0: { x: 0, y: 2*t - 5*t*t } };');
  const peak = sampleFrame(p, 0.2);
  check('零速峰值 → 取最近的非零方向（±90°）', near(Math.abs(peak.state.e0.angleDeg), 90, 1), String(peak.state.e0.angleDeg));
}

{
  const p = makeProgram('return { e0: { x: 1, y: 1 } };');
  const still = sampleFrame(p, 1);
  check('全程静止 → 不注入 angleDeg', still.state.e0.angleDeg === undefined, String(still.state.e0.angleDeg));
}

console.log(`\n通过 ${passed}，失败 ${failures.length}`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
