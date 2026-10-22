#!/usr/bin/env node
/** 修复分类取证：画图错误 vs 物理错误。 */

import { classifyRepair } from '../core/repair/index.mjs';

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

const mk = (id, diagnostics = [], blocking = true) => ({ id, status: 'fail', blocking, diagnostics, offenders: [] });
const rep = (checks) => ({ checks });

check('C4 是画图错误', classifyRepair(rep([mk('C4')])).mode === 'draw');
check('C7 不存在；C8/C9 是画图错误', classifyRepair(rep([mk('C8'), mk('C9')])).mode === 'draw');
check('C3 是物理错误', classifyRepair(rep([mk('C3')])).mode === 'physical');
check('C5 是物理错误', classifyRepair(rep([mk('C5')])).mode === 'physical');
check('C6 是物理错误', classifyRepair(rep([mk('C6')])).mode === 'physical');

{
  const r = classifyRepair(rep([mk('C1', [{ check: 'C1', slot: 'stateAt', message: 'x 未返回' }])]));
  check('C1 指向 stateAt ⇒ 物理', r.mode === 'physical', JSON.stringify(r));
}
{
  const r = classifyRepair(rep([mk('C1', [{ check: 'C1', slot: 'drawFrame', message: 'Draw.nope' }])]));
  check('C1 指向 drawFrame ⇒ 画图', r.mode === 'draw', JSON.stringify(r));
}
{
  const r = classifyRepair(rep([mk('C1')]));
  check('C1 没有槽位 ⇒ 按物理（不赌）', r.mode === 'physical', JSON.stringify(r));
}
{
  const r = classifyRepair(rep([mk('C2', [{ check: 'C2', slot: 'setup', message: 'boom' }])]));
  check('C2 指向 setup ⇒ 物理', r.mode === 'physical', JSON.stringify(r));
}
{
  const r = classifyRepair(rep([mk('C4'), mk('C5')]));
  check('画图 + 物理混合 ⇒ 先修物理', r.mode === 'physical' && r.physical.includes('C5') && r.draw.includes('C4'), JSON.stringify(r));
}
{
  const r = classifyRepair(rep([{ id: 'C4', status: 'fail', blocking: false, diagnostics: [] }]));
  check('非阻塞失败不算（不触发修复）', r.mode === 'none', JSON.stringify(r));
}
{
  const r = classifyRepair(rep([mk('C1', [{ check: 'C1', slot: 'drawFrame', message: 'Draw.nope' }]), { ...mk('C5'), skipped: true }]));
  check('skipped 的 C5 不算（C1 指向 drawFrame ⇒ 画图）', r.mode === 'draw', JSON.stringify(r));
}
{
  const r = classifyRepair(rep([mk('C99')]));
  check('未知检查号按物理处理', r.mode === 'physical' && r.physical.includes('C99'), JSON.stringify(r));
}

console.log(`\n${failures.length ? '✗' : '✓'} 修复分类取证：通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
  process.exitCode = 1;
}
