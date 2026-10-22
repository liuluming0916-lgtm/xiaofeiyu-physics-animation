/**
 * 修复分类：这次失败该“重画 drawFrame”，还是“重跑物理”？
 *
 * 用户 2026-10-22 裁决：
 *   · 画图错误 → 只重画 drawFrame（3 轮）；
 *   · 物理错误 → 重跑 read_problem + solve + analysis + scene_code + breakdown（2 轮）。
 *
 * 归类不能只看检查号：C1 既可能是 drawFrame 调错 API，也可能是 stateAt 少返回键。
 * 所以优先看诊断指向的槽位，再看检查号。
 */

const DRAW_CHECKS = new Set(['C4', 'C8', 'C9']);
const PHYSICAL_CHECKS = new Set(['C3', 'C5', 'C6']);
const PHYSICAL_SLOTS = new Set(['stateAt', 'setup', 'VIEW']);
const DRAW_SLOTS = new Set(['drawFrame']);

function diagnosticSlots(check) {
  const out = new Set();
  for (const d of check?.diagnostics ?? []) {
    if (d?.slot) out.add(d.slot);
  }
  for (const o of check?.offenders ?? []) {
    if (o?.slot) out.add(o.slot);
  }
  return out;
}

/**
 * @param {object} report dry-run 报告
 * @returns {{
 *   mode: 'none'|'draw'|'physical',
 *   physical: string[],
 *   draw: string[],
 *   reasons: string[],
 * }}
 */
export function classifyRepair(report) {
  const blocking = (report?.checks ?? []).filter(
    (c) => c?.blocking && c?.status === 'fail' && !c?.skipped,
  );
  const physical = [];
  const draw = [];
  const reasons = [];

  for (const c of blocking) {
    const id = String(c.id ?? '');
    const slots = diagnosticSlots(c);
    const hasPhysicalSlot = [...slots].some((s) => PHYSICAL_SLOTS.has(s));
    const hasDrawSlot = [...slots].some((s) => DRAW_SLOTS.has(s));

    if (PHYSICAL_CHECKS.has(id)) {
      physical.push(id);
      reasons.push(`${id} 是物理类检查`);
      continue;
    }
    if (DRAW_CHECKS.has(id)) {
      draw.push(id);
      reasons.push(`${id} 是画图类检查`);
      continue;
    }
    if (id === 'C1' || id === 'C2') {
      if (hasPhysicalSlot) {
        physical.push(id);
        reasons.push(`${id} 的诊断指向物理槽位（${[...slots].filter((s) => PHYSICAL_SLOTS.has(s)).join('/')}）`);
      } else if (hasDrawSlot) {
        draw.push(id);
        reasons.push(`${id} 的诊断指向 drawFrame`);
      } else {
        physical.push(id);
        reasons.push(`${id} 无法归类，按物理处理`);
      }
      continue;
    }

    // 未知检查号：宁可多算一次物理，也不要用画图修去修物理
    physical.push(id || '(unknown)');
    reasons.push(`${id || '(unknown)'} 未登记，按物理处理`);
  }

  // 混合失败时先修物理（物理一变，画法可能跟着变）
  const mode = physical.length ? 'physical' : draw.length ? 'draw' : 'none';
  return { mode, physical: [...new Set(physical)], draw: [...new Set(draw)], reasons };
}
