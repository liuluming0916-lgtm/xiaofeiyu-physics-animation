#!/usr/bin/env node
/**
 * 元件尺寸（C 方案）自检：**physical 是唯一尺寸来源（物理米）**。
 *
 * 验：
 *   · 内置卡 physical 表：7 类运动元件齐全；
 *   · `state.w/h/r` = 卡里的 physical（物理米），不再有纸面固定尺寸；
 *   · 删掉卡的 physical ⇒ 明确报错，不回退隐藏表；
 *   · 用户卡覆盖 physical ⇒ state 跟着变；
 *   · 质心口径：`cx = u`、`cy = v`，`x/y` 是物理质心。
 */

import {
  ANALYSIS_EXAMPLE,
  PHYSICAL_REQUIRED_TYPES,
  buildStateAt,
  buildView,
  builtinCardEntries,
  builtinPhysicalTable,
  geometryFields,
  geometryFor,
  parseAnalysisTable,
  physicalTableFromCards,
  physicalTableFromEntries,
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
  return new Function('t', code)(t);
}

function cloneCards(cards) {
  return JSON.parse(JSON.stringify(cards));
}

function without(entry, key) {
  const out = { ...entry };
  delete out[key];
  return out;
}

const cards = builtinCardEntries();
const table = physicalTableFromCards(cards);

console.log('元件尺寸（C：physical = 唯一尺寸来源）自检\n');

console.log('『A』内置卡 → physical 表');
{
  check('physical 表无问题', table.problems.length === 0, table.problems.join(' | '));
  check('7 类运动元件齐了', PHYSICAL_REQUIRED_TYPES.every((t) => table.physical[t]), Object.keys(table.physical).join(','));
  check('block = 0.2×0.1 米', table.physical.block.w === 0.2 && table.physical.block.h === 0.1, JSON.stringify(table.physical.block));
  check('ball = r 0.05（另有 0.1×0.1 包围盒）', table.physical.ball.r === 0.05 && table.physical.ball.w === 0.1, JSON.stringify(table.physical.ball));
  check('board 只有厚度 h=0.02（板长按题面）', table.physical.board.h === 0.02 && table.physical.board.w === undefined, JSON.stringify(table.physical.board));
  check('spring/rope 没有 physical', !table.physical.spring && !table.physical.rope);
  check('尺寸记录来源卡 id', table.owners.block === 'wb_el_block', table.owners.block);
  check('未知类型没有尺寸', geometryFor(table.physical, 'nope').h === undefined);
}

console.log('\n『B』state 字段（physical 直接进 state；质心即中心）');
{
  const a = parseAnalysisTable(ANALYSIS_EXAMPLE);
  const s0 = stateAt(buildStateAt(a), 0);
  check('block 的 state 带 type', s0.e0?.type === 'block', JSON.stringify(s0.e0));
  check(
    'block t=0：x=0、y=0.05（质心），cx=u、cy=v',
    s0.e0.x === 0 && s0.e0.y === 0.05 && Math.abs(s0.e0.cx - s0.e0.u) < 1e-9 && Math.abs(s0.e0.cy - s0.e0.v) < 1e-9,
    JSON.stringify(s0.e0),
  );
  check('block 的 w/h = physical 0.2×0.1（物理米）', s0.e0.w === 0.2 && s0.e0.h === 0.1, JSON.stringify(s0.e0));

  const view = buildView(a, a.tPhys);
  check('VIEW 的 body 用 cx/cy', view.includes('.cx') && view.includes('.cy'), view);

  const ballText = [
    'element: ball_A',
    'type: ball',
    'segment: 1',
    't0: 0',
    't1: 1',
    'x0: 0',
    'y0: 0.05',
    'vx0: 0',
    'vy0: 0',
    'ax: 0',
    'ay: 0',
    'x: 0',
    'y: 0.05',
  ].join('\n');
  const sb = stateAt(buildStateAt(parseAnalysisTable(ballText)), 0);
  check('ball 的 r / w / h 进 state', sb.e0?.r === 0.05 && sb.e0?.w === 0.1 && sb.e0?.h === 0.1, JSON.stringify(sb.e0));
  check('ball 的 cy = v（质心即中心）', Math.abs(sb.e0?.cy - sb.e0?.v) < 1e-9, JSON.stringify(sb.e0));

  const unknown = parseAnalysisTable(ANALYSIS_EXAMPLE.replace(/^type: block\n/gm, ''));
  const su = stateAt(buildStateAt(unknown), 0);
  check('缺 type 退化为 unknown + 无尺寸 + cx=u', su.e0?.type === 'unknown' && su.e0?.w === undefined && Math.abs(su.e0.cx - su.e0.u) < 1e-9, JSON.stringify(su.e0));
}

console.log('\n『C』负例：没有隐藏表可退');
{
  const noBlock = cloneCards(cards).map((e) => (e.id === 'wb_el_block' ? without(e, 'physical') : e));
  const broken = physicalTableFromCards(noBlock);
  check('删掉 block 的 physical ⇒ 明确报错', broken.problems.some((p) => p.includes('wb_el_block') && p.includes('physical')), broken.problems.join(' | '));
  check('删掉 block 的 physical ⇒ 表里没有 block（不回退）', broken.physical.block === undefined);

  const bad = cloneCards(cards).map((e) => (e.id === 'wb_el_block' ? { ...e, physical: { w: 0.2, h: -1 } } : e));
  check('physical 负数 ⇒ 报错', physicalTableFromCards(bad).problems.some((p) => p.includes('正有限数')), physicalTableFromCards(bad).problems.join(' | '));

  const noH = cloneCards(cards).map((e) => (e.id === 'wb_el_block' ? { ...e, physical: { w: 0.2 } } : e));
  check('physical 缺 h/r ⇒ 报错', physicalTableFromCards(noH).problems.some((p) => p.includes('至少要给 h 或 r')), physicalTableFromCards(noH).problems.join(' | '));

  const scenePhys = cloneCards(cards).map((e) => (e.id === 'wb_sc_belt' ? { ...e, physical: { h: 0.1 } } : e));
  check('场景卡带 physical ⇒ 报错', physicalTableFromCards(scenePhys).problems.some((p) => p.includes('场景卡') && p.includes('physical')), physicalTableFromCards(scenePhys).problems.join(' | '));

  const conflict = cloneCards(cards);
  conflict.push({
    id: 'wb_el_block_alt',
    title: '元件·物块（副本）',
    kind: 'element',
    enabled: true,
    origin: 'user',
    content: 'x',
    elements: ['block'],
    physical: { w: 0.5, h: 0.25 },
  });
  check('同类型两份不同 physical ⇒ 冲突', physicalTableFromCards(conflict).problems.some((p) => p.includes('不同 physical')), physicalTableFromCards(conflict).problems.join(' | '));
}

console.log('\n『D』运行期：用户卡覆盖 / 缺省');
{
  check('builtinPhysicalTable 与纯函数一致', builtinPhysicalTable().physical.block.h === table.physical.block.h);

  const wider = physicalTableFromEntries(
    cloneCards(cards).map((e) => (e.id === 'wb_el_block' ? { ...e, physical: { w: 0.3, h: 0.2 } } : e)),
  );
  const s = stateAt(buildStateAt(parseAnalysisTable(ANALYSIS_EXAMPLE), { physical: wider.physical }), 0);
  check('改卡 physical ⇒ state.w/h 跟着变', s.e0?.w === 0.3 && s.e0?.h === 0.2, JSON.stringify(s.e0));

  const empty = physicalTableFromEntries([]);
  check('空卡表 ⇒ 用内置卡（不是隐藏表）', empty.problems.length === 0 && empty.physical.block.w === 0.2, empty.problems.join(' | '));

  const missingUser = physicalTableFromEntries([
    { id: 'wb_el_block_user', kind: 'element', enabled: true, origin: 'user', content: 'x', elements: ['block'] },
  ]);
  check('用户卡漏写 physical ⇒ 告警并沿用内置', missingUser.warnings.some((w) => w.includes('wb_el_block_user')) && missingUser.physical.block.w === 0.2, missingUser.warnings.join(' | '));
}

console.log(`\n通过 ${passed}，失败 ${failures.length}`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
