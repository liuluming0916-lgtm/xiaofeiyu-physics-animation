#!/usr/bin/env node
/**
 * 本地运动学矢量取证（v1.1.9）
 *
 * 守四条口径（用户 2026-10-19 拍板）：
 *   ① 边界集 = {0,duration} ∪ STEPS ∪ phases（`phases` 可以是函数）；
 *   ② 速度在间断点取**碰后（右侧）**；碰前时刻仍取碰前；
 *   ③ 速度跳变处加速度**画点**（0）；平滑边界用二阶单侧；
 *   ④ 有 bodies 时**过滤**模型手写的 v/a 箭头；force/aux 原样保留。
 *
 * 另外钉住 `Phys.interp` 的升级：有斜率走 C¹ Hermite，没斜率退回线性。
 *
 * 用法：node tests/kinematic-vectors-selftest.mjs
 */

import {
  integrate,
  interp,
  instantiate,
  sampleFrame,
  collectKinematicBoundaries,
  kinematicsInfo,
  derivatives,
  emitKinematicArrows,
  computeArrowStackOffsets,
  assembleProgramSource,
  sandboxBundle,
  KINEMATIC_ACC_H,
} from '../sdk/runtime/animation-runtime.mjs';
import { renderQuestion } from './harness/canvas-harness.mjs';

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
const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol;

function makeProgram(slots, mode = 'NUMERIC') {
  const src = assembleProgramSource(slots, { mode });
  // eslint-disable-next-line no-new-func
  const factory = new Function('runtime', `${src}\nreturn buildProgram;`)(sandboxBundle());
  return instantiate(factory).program;
}

function slotsOf({ view, setup = 'const a = 2; RETURN("a", a);', stateAt, drawFrame = 'Draw.box([state.x, state.y], 0.3, 0.3);' }) {
  return {
    PROBLEM: '测试题',
    STEPS: 'title: 第 1 步\ntex: x\nt0: 0\nt1: 0.5\n\ntitle: 第 2 步\ntex: x\nt0: 0.5\nt1: 2',
    ANSWERS: 'symbol: x\nvalue: 1\nunit: m\nat_t: 2\nstep: 1',
    VIEW: view,
    setup,
    stateAt,
    drawFrame,
    readouts: 'return [];',
  };
}

console.log('\n『A』Phys.interp：有斜率走 Hermite，没斜率退回线性');

{
  const solved = integrate({ x: 0, v: 1 }, (t, s) => ({ x: s.v, v: 2 }), 0, 1, { dt: 1 / 100 });
  check('integrate 每个采样点都带 dy', solved.samples.every((s) => s.dy && Number.isFinite(s.dy.v)));
  // x(t) = t + t² ⇒ x(0.505) = 0.505 + 0.255025
  const x = interp(solved.samples, 0.505, 'x');
  check('★ Hermite 对二次运动精确（误差 < 1e-9）', near(x, 0.760025, 1e-9), String(x));
  const v = interp(solved.samples, 0.505, 'v');
  check('★ 速度插值同样精确（1 + 2t = 2.01）', near(v, 2.01, 1e-9), String(v));

  const linearTable = solved.samples.map((s) => ({ t: s.t, y: { ...s.y } }));
  const xl = interp(linearTable, 0.505, 'x');
  check('★ 没有 dy 的老表逐字退回线性插值', Number.isFinite(xl) && xl !== x, `${xl} vs ${x}`);
}

console.log('\n『B』边界集：{0,duration} ∪ STEPS ∪ phases');

{
  const program = makeProgram(
    slotsOf({
      view: 'SIM = { duration: 2, phases: [{ t0: 0.9, t1: 1.4 }] };',
      stateAt: 'return { x: t, y: 0 };',
    }),
  );
  const bounds = collectKinematicBoundaries(program, 2);
  check('★ 含 STEPS 的 0.5 与 phases 的 0.9/1.4', [0, 0.5, 0.9, 1.4, 2].every((b) => bounds.includes(b)), JSON.stringify(bounds));
  check('端点与重复值已去重', bounds.length === 5 && bounds[0] === 0 && bounds[bounds.length - 1] === 2, JSON.stringify(bounds));

  const fnProgram = makeProgram(
    slotsOf({
      view: 'SIM = { duration: 2, phases: () => [{ t0: 0, t1: context.a / 4 }] };',
      stateAt: 'return { x: t, y: 0 };',
    }),
  );
  const fnBounds = collectKinematicBoundaries(fnProgram, 2);
  check('★ phases 写成函数也能取到（setup 之后求值）', fnBounds.includes(0.5), JSON.stringify(fnBounds));
}

console.log('\n『C』求导：解析运动、间断点、圆周');

{
  const program = makeProgram(
    slotsOf({
      view: "SIM = { duration: 2, bodies: [{ id: 'b', at: (s) => [s.x, s.y] }] };",
      stateAt: 'return { x: 0.5 * 2 * t * t, y: 0 };',
    }),
  );
  const info = kinematicsInfo(program);
  const d = derivatives(program, info.bodies[0], 0.3, info);
  check('★ 匀加速 v = a·t（0.6）', near(d.vx, 0.6, 1e-6), String(d.vx));
  check('★ 匀加速 a = 2', near(d.ax, 2, 1e-5), String(d.ax));
  check('a 的 y 分量 ≈ 0', near(d.ay, 0, 1e-6), String(d.ay));
}

{
  // 位置连续、速度在 0.5 s 从 2 跳到 1：x = 2t (t<0.5)，之后 x = 1 + 1·(t−0.5)
  const program = makeProgram(
    slotsOf({
      view: "SIM = { duration: 2, bodies: [{ id: 'b', at: (s) => [s.x, 0] }] };",
      stateAt: 'return { x: t < 0.5 ? 2 * t : 1 + (t - 0.5) };',
    }),
  );
  const info = kinematicsInfo(program);
  const body = info.bodies[0];
  check('0.5 s 被识别为速度跳变', info.jumps[info.boundIndex.get(0.5)] === true);
  const at = derivatives(program, body, 0.5, info);
  check('★ 边界时刻取**碰后**速度（1，不是 2）', near(at.vx, 1, 1e-6), String(at.vx));
  const before = derivatives(program, body, 0.49, info);
  check('碰前时刻仍取碰前速度（2）', near(before.vx, 2, 1e-6), String(before.vx));
  check('★ 跳变处加速度画点（a = 0）', Math.abs(at.ax) < 1e-9 && Math.abs(at.ay) < 1e-9, `${at.ax},${at.ay}`);
}

{
  const program = makeProgram(
    slotsOf({
      view: "SIM = { duration: 2, bodies: [{ id: 'p', at: (s) => [s.x, s.y] }] };",
      stateAt: 'return { x: Math.cos(2 * t), y: Math.sin(2 * t) };',
    }),
  );
  const info = kinematicsInfo(program);
  const d = derivatives(program, info.bodies[0], 0.7, info);
  check('★ 圆周运动 |a| = 4（R=1, ω=2）', near(Math.hypot(d.ax, d.ay), 4, 1e-3), String(Math.hypot(d.ax, d.ay)));
  check('向心方向指向圆心（a ≈ −4r）', near(d.ax, -4 * Math.cos(2 * 0.7), 1e-3) && near(d.ay, -4 * Math.sin(2 * 0.7), 1e-3), `${d.ax},${d.ay}`);
}

console.log('\n『D』注入与过滤：bodies 存在时只留本地 v/a + 模型 force/aux');

{
  const program = makeProgram(
    slotsOf({
      view: "SIM = { duration: 2, bodies: [{ id: 'b', at: (s) => [s.x, s.y] }] };",
      stateAt: 'return { x: t, y: 0 };',
      drawFrame:
        'Draw.arrow([state.x, state.y], [1, 0], { category: "velocity", mag: 1 });' +
        'Draw.arrow([state.x, state.y], [1, 0], { category: "force", mag: 3 });' +
        'Draw.arrow([state.x, state.y], [1, 0], { category: "aux", mag: 2 });',
    }),
  );
  const frame = sampleFrame(program, 0.4, {});
  const arrows = frame.records.filter((r) => r.op === 'arrow');
  check('★ 模型手写的 velocity 被过滤', !arrows.some((r) => r.category === 'velocity' && r.mag === 1));
  check('★ 本地 velocity + acceleration 各一支', arrows.filter((r) => r.category === 'velocity').length === 1 && arrows.filter((r) => r.category === 'acceleration').length === 1);
  check('force 与 aux 原样保留', arrows.some((r) => r.category === 'force') && arrows.some((r) => r.category === 'aux'));
  check('本地 v/a 带同一个 stackKey（同类错开）', (() => {
    const local = arrows.filter((r) => r.category === 'velocity' || r.category === 'acceleration');
    return local.length === 2 && local[0].stackKey && local[0].stackKey === local[1].stackKey;
  })());
  check('错开表算出了 2 支（±4px）', computeArrowStackOffsets(arrows).size === 2);
}

{
  const program = makeProgram(
    slotsOf({
      view: 'SIM = { duration: 2 };',
      stateAt: 'return { x: t, y: 0 };',
      drawFrame: 'Draw.arrow([state.x, state.y], [1, 0], { category: "velocity", mag: 1 });',
    }),
  );
  const frame = sampleFrame(program, 0.4, {});
  check('没有 bodies 的老程序保持旧行为（模型 v 箭头还在）', frame.records.some((r) => r.op === 'arrow' && r.category === 'velocity'));
}

console.log('\n『E』播放路径：render() 与 sampleFrame() 同口径');

{
  const slotSet = slotsOf({
    view: "SIM = { duration: 2, bodies: [{ id: 'b', at: (s) => [s.x, s.y] }] };",
    stateAt: 'return { x: t, y: 0 };',
    drawFrame: 'Draw.box([state.x, state.y], 0.3, 0.3);Draw.arrow([state.x, state.y], [1, 0], { category: "velocity", mag: 1 });',
  });
  const rendered = renderQuestion({ slots: slotSet, mode: 'NUMERIC' }, { samples: 8, width: 880, height: 388 });
  check('render() 能跑完整题（不炸）', rendered.frames.length === 9 && rendered.frames.every((r) => r.commands > 0));
  check('render() 的 paintCalls > 0', rendered.frames.every((r) => r.paintCalls > 0));

  const program = makeProgram(slotSet);
  const frame = sampleFrame(program, 0.6, {});
  const arrows = frame.records.filter((r) => r.op === 'arrow');
  check('★ 两条路径都只有本地 v/a（模型那支已过滤）', arrows.filter((r) => r.category === 'velocity').length === 1 && arrows.length === 2, String(arrows.length));
  check('加速度窗常量是 2ms（Hermite 之后收窄）', KINEMATIC_ACC_H === 2e-3, String(KINEMATIC_ACC_H));
}

console.log(`\n${failures.length ? '✗' : '✓'} 本地运动学矢量取证：通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
  process.exitCode = 1;
}

export async function main() {
  // CLI 入口已在模块顶层跑完；这里保留 main 以兼容 verify-all 的同进程回退模式
}
