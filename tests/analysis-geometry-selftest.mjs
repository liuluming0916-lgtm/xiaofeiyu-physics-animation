#!/usr/bin/env node
/**
 * 视觉几何表 + state 中心点自检（P1）。
 *
 * 验：
 *   · 几何表能被读、数值合法；
 *   · block/ball 的接触点 → 视觉中心偏移正确；
 *   · buildStateAt 真的生成 type / cx / cy / w / h / r；
 *   · VIEW 的 body 用 cx/cy，而不是 x/y；
 *   · 未知 type 退化为 cx=x、cy=y，不硬失败。
 */

import {
  ANALYSIS_EXAMPLE,
  buildStateAt,
  buildView,
  centerOffset,
  geometryFields,
  loadElementGeometry,
  parseAnalysisTable,
} from '../core/analysis/index.mjs';

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

function stateAt(code, t) {
  // buildStateAt 的输出以 return state; 结尾，可以直接当函数体。
  return new Function('t', code)(t);
}

console.log('视觉几何与 state 中心点自检（P1）\n');

console.log('『A』几何表');
{
  const all = loadElementGeometry();
  check('block/ball/board/belt/incline 都在表里', ['block', 'ball', 'board', 'belt', 'incline'].every((k) => all[k]), Object.keys(all).join(','));
  check('block 是底部锚点 + 0.4×0.3', all.block.anchor === 'bottom' && all.block.w === 0.4 && all.block.h === 0.3);
  check('ball 有球半径与质点点半径', all.ball.r === 0.08 && all.ball.pointR === 0.02);
  check('未知类型退化为中心锚点', centerOffset('nope').dx === 0 && centerOffset('nope').dy === 0);
}

console.log('\n『B』接触点 → 视觉中心');
{
  const block = centerOffset('block');
  check('block：cx=x+0.2、cy=y+0.15', block.dx === 0.2 && block.dy === 0.15, JSON.stringify(block));
  const ball = centerOffset('ball');
  check('ball：cx=x、cy=y+0.08', ball.dx === 0 && ball.dy === 0.08, JSON.stringify(ball));
  const ballFields = geometryFields('ball');
  check('ball 字段带 r / pointR / w / h', ballFields.r === 0.08 && ballFields.pointR === 0.02 && ballFields.w === 0.2 && ballFields.h === 0.2, JSON.stringify(ballFields));
}

console.log('\n『C』buildStateAt / VIEW');
{
  const a = parseAnalysisTable(ANALYSIS_EXAMPLE);
  const s0 = stateAt(buildStateAt(a), 0);
  check('block 的 state 带 type', s0.e0?.type === 'block', JSON.stringify(s0.e0));
  /* 2026-10-23 舞台化：`cx/cy` 是**布局坐标**（`u/v` + 几何偏移），`x/y` 才是物理米。
     所以这里断言"偏移量"，而不是"cx 等于某个米数"。 */
  check(
    'block t=0：x=0、y=0，且 cx=u+0.2、cy=v+0.15（偏移在布局单位里）',
    s0.e0.x === 0 &&
      s0.e0.y === 0 &&
      Math.abs(s0.e0.cx - s0.e0.u - 0.2) < 1e-9 &&
      Math.abs(s0.e0.cy - s0.e0.v - 0.15) < 1e-9,
    JSON.stringify(s0.e0),
  );
  check('block 的 u/v 落在 0–10 / 0–6 布局纸内', s0.e0.u >= 0 && s0.e0.u <= 10 && s0.e0.v >= 0 && s0.e0.v <= 6, JSON.stringify({ u: s0.e0.u, v: s0.e0.v }));
  check('block 的 w/h 来自几何表', s0.e0.w === 0.4 && s0.e0.h === 0.3);

  const view = buildView(a, a.tPhys);
  check('VIEW 的 body 用 cx/cy', view.includes('.cx') && view.includes('.cy'), view);

  const ballText = [
    'element: ball_A',
    'type: ball',
    'segment: 1',
    't0: 0',
    't1: 1',
    'x0: 0',
    'y0: 0',
    'vx0: 0',
    'vy0: 0',
    'ax: 0',
    'ay: 0',
    'x: 0',
    'y: 0',
  ].join('\n');
  const b = parseAnalysisTable(ballText);
  const sb = stateAt(buildStateAt(b), 0);
  check('ball 的 r / pointR 进 state', sb.e0?.r === 0.08 && sb.e0?.pointR === 0.02, JSON.stringify(sb.e0));
  check('ball 的中心 cy = v + r', Math.abs(sb.e0?.cy - sb.e0?.v - 0.08) < 1e-9, JSON.stringify(sb.e0));

  const unknown = parseAnalysisTable(ANALYSIS_EXAMPLE.replace(/^type: block\n/gm, ''));
  const su = stateAt(buildStateAt(unknown), 0);
  check(
    '缺 type 退化为 unknown + cx=u、cy=v',
    su.e0?.type === 'unknown' && Math.abs(su.e0.cx - su.e0.u) < 1e-9 && Math.abs(su.e0.cy - su.e0.v) < 1e-9,
    JSON.stringify(su.e0),
  );

  const mercuryText = [
    'element: mercury_A',
    'type: mercury',
    'segment: 1',
    't0: 0',
    't1: 1',
    'x0: 0',
    'y0: 0.2',
    'vx0: 0',
    'vy0: 0',
    'ax: 0',
    'ay: 0',
    'x: 0',
    'y: 0.2',
    'yA: 0.1',
    'yB: 0.3',
  ].join('\n');
  const m = parseAnalysisTable(mercuryText);
  const sm = stateAt(buildStateAt(m), 0.5);
  check('水银柱的 yA/yB 两个液面进 state', sm.e0?.yA === 0.1 && sm.e0?.yB === 0.3, JSON.stringify(sm.e0));

}

console.log(`\n通过 ${passed}，失败 ${failures.length}`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
