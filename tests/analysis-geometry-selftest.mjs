#!/usr/bin/env node
/**
 * 元件尺寸（B1'）自检：**两层尺寸都只来自 v2 卡**。
 *
 * 验：
 *   · `size`（纸面单位）从元件卡派生；**场景卡没有尺寸**；
 *   · `physical`（物理米）7 类齐全，且只有 element 卡有；
 *   · 删掉卡的 `size` / `physical` ⇒ 明确报错，不回退隐藏表；
 *   · `board` 的 `size.w` 可缺省（板长由模型给），`h` 仍必填；
 *   · 改卡里的尺寸 ⇒ `state.<key>.w` 跟着变；
 *   · `buildStateAt` 的 type/cx/cy/w/h/r 与 B1' 之前一致（零视觉差）。
 */

import {
  ANALYSIS_EXAMPLE,
  PHYSICAL_REQUIRED_TYPES,
  buildStateAt,
  buildView,
  builtinCardEntries,
  builtinPhysicalTable,
  builtinSizeTable,
  geometryFields,
  geometryFor,
  parseAnalysisTable,
  physicalTableFromCards,
  physicalTableFromEntries,
  sizeTableFromCards,
  sizeTableFromEntries,
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
const sizeTable = sizeTableFromCards(cards);
const physicalTable = physicalTableFromCards(cards);

console.log('元件尺寸（B1\'：size 纸面 + physical 物理米）自检\n');

console.log('『A』内置卡 → 纸面尺寸表（size）');
{
  check('纸面尺寸表无问题', sizeTable.problems.length === 0, sizeTable.problems.join(' | '));
  check('block/ball/board 都有 size', ['block', 'ball', 'board'].every((k) => sizeTable.sizes[k]), Object.keys(sizeTable.sizes).join(','));
  const block = sizeTable.sizes.block;
  check('block 是底部锚点 + 0.4×0.3（纸面）', block.anchor === 'bottom' && block.w === 0.4 && block.h === 0.3, JSON.stringify(block));
  check('尺寸记录来源卡 id', sizeTable.owners.block === 'wb_el_block', sizeTable.owners.block);
  check('场景卡不再带 size（belt/incline 不在表里）', !sizeTable.sizes.belt && !sizeTable.sizes.incline);
  check('未知类型退化为“中心锚点 / 点”', geometryFor(sizeTable.sizes, 'nope').shape === 'point');
}

console.log('\n『B』内置卡 → 物理尺寸表（physical）');
{
  check('物理尺寸表无问题', physicalTable.problems.length === 0, physicalTable.problems.join(' | '));
  check('7 类运动元件齐了', PHYSICAL_REQUIRED_TYPES.every((t) => physicalTable.physical[t]), Object.keys(physicalTable.physical).join(','));
  check('block 是 0.2×0.1 米', physicalTable.physical.block.w === 0.2 && physicalTable.physical.block.h === 0.1, JSON.stringify(physicalTable.physical.block));
  check('ball 只有 r=0.05', physicalTable.physical.ball.r === 0.05, JSON.stringify(physicalTable.physical.ball));
  check('board 只有 h=0.02（板长可缺省）', physicalTable.physical.board.h === 0.02 && physicalTable.physical.board.w === undefined, JSON.stringify(physicalTable.physical.board));
  check('spring/rope 没有 physical', !physicalTable.physical.spring && !physicalTable.physical.rope);
}

console.log('\n『C』质心口径 / state 字段（B2/B3：质心即中心）');
{
  const ballFields = geometryFields(sizeTable.sizes, 'ball');
  check(
    'ball 字段带 r / pointR / w / h',
    ballFields.r === 0.08 && ballFields.pointR === 0.02 && ballFields.w === 0.2 && ballFields.h === 0.2,
    JSON.stringify(ballFields),
  );

  const a = parseAnalysisTable(ANALYSIS_EXAMPLE);
  const s0 = stateAt(buildStateAt(a), 0);
  check('block 的 state 带 type', s0.e0?.type === 'block', JSON.stringify(s0.e0));
  check(
    'block t=0：x=0、y=0.05（质心），且 cx=u、cy=v（不再偏移）',
    s0.e0.x === 0 &&
      s0.e0.y === 0.05 &&
      Math.abs(s0.e0.cx - s0.e0.u) < 1e-9 &&
      Math.abs(s0.e0.cy - s0.e0.v) < 1e-9,
    JSON.stringify(s0.e0),
  );
  check('block 的 w/h 来自 size', s0.e0.w === 0.4 && s0.e0.h === 0.3);

  const view = buildView(a, a.tPhys);
  check('VIEW 的 body 用 cx/cy', view.includes('.cx') && view.includes('.cy'), view);

  const unknown = parseAnalysisTable(ANALYSIS_EXAMPLE.replace(/^type: block\n/gm, ''));
  const su = stateAt(buildStateAt(unknown), 0);
  check(
    '缺 type 退化为 unknown + cx=u、cy=v',
    su.e0?.type === 'unknown' && Math.abs(su.e0.cx - su.e0.u) < 1e-9 && Math.abs(su.e0.cy - su.e0.v) < 1e-9,
    JSON.stringify(su.e0),
  );

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
  check('ball 的 r / pointR 进 state', sb.e0?.r === 0.08 && sb.e0?.pointR === 0.02, JSON.stringify(sb.e0));
  check('ball 的 cy = v（质心即中心）', Math.abs(sb.e0?.cy - sb.e0?.v) < 1e-9, JSON.stringify(sb.e0));
}

console.log('\n『D』负例：没有隐藏表可退');
{
  const noBlockSize = cloneCards(cards).map((e) => (e.id === 'wb_el_block' ? without(e, 'size') : e));
  const broken = sizeTableFromCards(noBlockSize);
  check('删掉 block 卡的 size ⇒ 明确报“缺 size”', broken.problems.some((p) => p.includes('wb_el_block') && p.includes('缺 size')), broken.problems.join(' | '));
  check('删掉 block 卡的 size ⇒ 尺寸表里没有 block（不回退）', broken.sizes.block === undefined);

  const noBlockPhysical = cloneCards(cards).map((e) => (e.id === 'wb_el_block' ? without(e, 'physical') : e));
  const brokenPhys = physicalTableFromCards(noBlockPhysical);
  check('删掉 block 卡的 physical ⇒ 明确报错', brokenPhys.problems.some((p) => p.includes('wb_el_block') && p.includes('physical')), brokenPhys.problems.join(' | '));
  check('删掉 block 卡的 physical ⇒ 物理表里没有 block', brokenPhys.physical.block === undefined);

  const badPhysical = cloneCards(cards).map((e) =>
    e.id === 'wb_el_block' ? { ...e, physical: { w: 0.2, h: -1 } } : e,
  );
  check('physical 负数 ⇒ 校验报错', physicalTableFromCards(badPhysical).problems.some((p) => p.includes('正有限数')), physicalTableFromCards(badPhysical).problems.join(' | '));

  const sceneWithSize = cloneCards(cards).map((e) =>
    e.id === 'wb_sc_belt' ? { ...e, size: { anchor: 'top', shape: 'belt', w: 4, h: 0.1 } } : e,
  );
  check('场景卡带 size ⇒ 报错', sizeTableFromCards(sceneWithSize).problems.some((p) => p.includes('场景卡') && p.includes('size')), sizeTableFromCards(sceneWithSize).problems.join(' | '));

  const conflicting = cloneCards(cards);
  conflicting.push({
    id: 'wb_el_block_alt',
    title: '元件·物块（副本）',
    kind: 'element',
    enabled: true,
    origin: 'user',
    content: 'x',
    elements: ['block'],
    size: { anchor: 'bottom', shape: 'box', w: 0.8, h: 0.6, minPx: 36, rotatable: true },
  });
  check('同类型两张卡给不同 size ⇒ 冲突报错', sizeTableFromCards(conflicting).problems.some((p) => p.includes('block') && p.includes('不同 size')), sizeTableFromCards(conflicting).problems.join(' | '));

  /* board 特例：只给 h、不给 w，仍合法 */
  const boardNoW = cloneCards(cards).map((e) =>
    e.id === 'wb_el_board' ? { ...e, size: { anchor: 'bottom', shape: 'box', h: 0.1, minPx: 36, rotatable: true } } : e,
  );
  const boardOk = sizeTableFromCards(boardNoW);
  check('board 的 size.w 可缺省（h 必填）', boardOk.problems.length === 0 && boardOk.sizes.board.h === 0.1 && boardOk.sizes.board.w === undefined, boardOk.problems.join(' | '));

  const boardNoH = cloneCards(cards).map((e) =>
    e.id === 'wb_el_board' ? { ...e, size: { anchor: 'bottom', shape: 'box', w: 3, minPx: 36, rotatable: true } } : e,
  );
  check('board 缺 h ⇒ 报错', sizeTableFromCards(boardNoH).problems.some((p) => p.includes('必须给 h')), sizeTableFromCards(boardNoH).problems.join(' | '));
}

console.log('\n『E』运行期：用户卡覆盖 / 缺省');
{
  check('builtinSizeTable 与纯函数结果一致', builtinSizeTable().sizes.block.w === sizeTable.sizes.block.w);
  check('builtinPhysicalTable 与纯函数结果一致', builtinPhysicalTable().physical.block.h === physicalTable.physical.block.h);

  const widened = sizeTableFromEntries(
    cloneCards(cards).map((e) => (e.id === 'wb_el_block' ? { ...e, size: { ...e.size, w: 1.0 } } : e)),
  );
  const a = parseAnalysisTable(ANALYSIS_EXAMPLE);
  const s = stateAt(buildStateAt(a, { sizes: widened.sizes }), 0);
  check('改卡里的 w=1.0 ⇒ state.w 跟着变', s.e0?.w === 1.0, JSON.stringify(s.e0));
  check('质心口径下 w 不再影响中心（cx=u）', Math.abs(s.e0.cx - s.e0.u) < 1e-9, JSON.stringify(s.e0));

  const phys = physicalTableFromEntries(
    cloneCards(cards).map((e) => (e.id === 'wb_el_block' ? { ...e, physical: { w: 0.3, h: 0.2 } } : e)),
  );
  check('改卡里的 physical ⇒ analysis 用的表跟着变', phys.physical.block.w === 0.3 && phys.physical.block.h === 0.2, JSON.stringify(phys.physical.block));

  const empty = sizeTableFromEntries([]);
  check('空卡表 ⇒ 用内置卡尺寸（不是隐藏表）', empty.problems.length === 0 && empty.sizes.block.w === 0.4, empty.problems.join(' | '));

  const missingUser = sizeTableFromEntries([
    { id: 'wb_el_block_user', kind: 'element', enabled: true, origin: 'user', content: 'x', elements: ['block'] },
  ]);
  check('用户卡漏写 size ⇒ 告警并沿用内置尺寸', missingUser.warnings.some((w) => w.includes('wb_el_block_user')) && missingUser.sizes.block.w === 0.4, missingUser.warnings.join(' | '));
}

console.log(`\n通过 ${passed}，失败 ${failures.length}`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
