#!/usr/bin/env node
/**
 * 元件尺寸 / 锚点自检。
 *
 * 2026-10-24 回滚动画契约后，这里分两件事：
 *   · **绘制**：`state` 只给布局坐标 `cx/cy` + `anchor`，**不给任何尺寸**（尺寸归 drawFrame）；
 *   · **物理**：`physical`（物理米）只喂 `analysis` 算接触点/质心高度，不再进 state。
 *
 * 验：
 *   · 内置卡 physical 表：7 类运动元件齐全；
 *   · `state` 没有 `w/h/r`，但有 `cx/cy` 与 `anchor`；
 *   · 删掉卡的 physical ⇒ 明确报错，不回退隐藏表；
 *   · 用户卡覆盖 physical ⇒ **不影响 state**（只影响 analysis）。
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

console.log('元件锚点与尺寸归属自检（绘制=模型定尺寸）\n');

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

console.log('\n『B』state 字段（只给布局坐标 + anchor，不给尺寸）');
{
  const a = parseAnalysisTable(ANALYSIS_EXAMPLE);
  const s0 = stateAt(buildStateAt(a), 0);
  check('block 的 state 键是语义 key（block_A）', s0.block_A?.type === 'block', JSON.stringify(s0.block_A));
  check(
    'block t=0：x=0、y=0.05（物理），另有布局坐标 cx/cy',
    s0.block_A.x === 0 &&
      s0.block_A.y === 0.05 &&
      Number.isFinite(s0.block_A.cx) &&
      Number.isFinite(s0.block_A.cy),
    JSON.stringify(s0.block_A),
  );
  check(
    'block 的 anchor = bottom（底面中心）',
    s0.block_A.anchor === 'bottom',
    JSON.stringify(s0.block_A),
  );
  check(
    'state 不带任何尺寸（没有 w/h/r）',
    s0.block_A.w === undefined && s0.block_A.h === undefined && s0.block_A.r === undefined,
    JSON.stringify(s0.block_A),
  );
  check(
    '布局坐标落在 10×6 纸内',
    s0.block_A.cx >= 0 && s0.block_A.cx <= 10 && s0.block_A.cy >= 0 && s0.block_A.cy <= 6,
    `${s0.block_A.cx}, ${s0.block_A.cy}`,
  );

  const view = buildView(a, a.tPhys);
  check('VIEW 的 body 用 cx/cy（布局坐标）', view.includes('b.cx, b.cy'), view);
  check('VIEW 的 stage 不带 s/cx/cy（否则 Draw 会二次折算）', !/"s":|"cx":|"cy":/.test(view), view);

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
  check(
    'ball 只给位置 + anchor=bottom，不给 r/w/h',
    sb.ball_A?.anchor === 'bottom' &&
      sb.ball_A?.r === undefined &&
      sb.ball_A?.w === undefined &&
      sb.ball_A?.h === undefined,
    JSON.stringify(sb.ball_A),
  );

  const unknown = parseAnalysisTable(ANALYSIS_EXAMPLE.replace(/^type: block\n/gm, ''));
  const su = stateAt(buildStateAt(unknown), 0);
  check(
    '缺 type 退化为 unknown + anchor=center + 无尺寸',
    su.block_A?.type === 'unknown' && su.block_A?.anchor === 'center' && su.block_A?.w === undefined,
    JSON.stringify(su.block_A),
  );
}

console.log('\n『B2』语义 key 清洗（非 ASCII / JS 保留字）');
{
  const mk = (id) =>
    [
      `element: ${id}`,
      'type: block',
      'segment: 1',
      't0: 0',
      't1: 1',
      'x0: 0',
      'y0: 0.05',
      'vx0: 1',
      'vy0: 0',
      'ax: 0',
      'ay: 0',
      'x: x0 + vx0*(t - t0)',
      'y: y0',
    ].join('\n');
  const cn = stateAt(buildStateAt(parseAnalysisTable(mk('物块A'))), 0);
  check('非 ASCII id → type_序号（block_1）', cn.block_1?.type === 'block', Object.keys(cn).join(','));
  const rsv = stateAt(buildStateAt(parseAnalysisTable(mk('class'))), 0);
  check('JS 保留字 → 自动加 _2（class_2）', rsv.class_2?.type === 'block', Object.keys(rsv).join(','));
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
  const s = stateAt(buildStateAt(parseAnalysisTable(ANALYSIS_EXAMPLE)), 0);
  check(
    '改卡 physical ⇒ **不影响 state**（尺寸不进绘制）',
    wider.physical.block.w === 0.3 && s.block_A?.w === undefined && s.block_A?.h === undefined,
    `${JSON.stringify(wider.physical.block)} / ${JSON.stringify(s.block_A)}`,
  );

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
