#!/usr/bin/env node
/**
 * _golden-probe —— 把提示词里的【一页范例】**真跑一遍 C1–C9**（第 9 期）。
 *
 * 为什么需要它：
 *   提示词里放了 8 槽位完整程序之后，"范例本身是否合规"就成了一个**会随内容漂移的判据**。
 *   光靠人读不行 —— 我读不出 C4 的相邻帧位移、也读不出 C7 的读数复现。所以用真判据内核跑。
 *
 * 它**不是门禁**（不在 verify-all 的 STEPS 里，`_` 前缀 = 一次性取证工具）。
 * 但改 `core/prompts/golden-example.mjs` 之后必须跑它：
 *
 *   node tools/_golden-probe.mjs
 *
 * 它和门禁 ③ 用的是**同一套东西**：真切分器 + 真 dryRun，所以"探针绿"与"门禁绿"同口径。
 */

import { splitSlots } from '../core/cleaner/marker-split.mjs';
import { dryRun } from '../core/dryrun/dry-run.mjs';
import { GOLDEN_EXAMPLE } from '../core/prompts/golden-example.mjs';
import { CHECK_IDS, TEMPLATE_VERSION, SDK_VERSION } from '../contracts/spec/frozen-keys.mjs';
import { labelOf } from '../contracts/evidence.mjs';

const split = splitSlots(GOLDEN_EXAMPLE);
console.log(`切分：ok=${split.ok} · 槽位 ${Object.keys(split.slots).length} 个 · 顺序 ${split.order.join(' → ')}`);
if (split.strayLines.length) console.log(`标记之外的散落行：${split.strayLines.join(', ')}`);
if (split.diagnostics.length) {
  for (const d of split.diagnostics) console.log(`✗ 切分诊断 ${d.code}（第 ${d.line} 行）：${d.message}`);
}

const { report } = await dryRun({
  slots: split.slots,
  entry: 'golden-example',
  meta: {
    index: 0,
    title: '一页范例（提示词内）',
    examPoint: '范例自检',
    mode: 'BOTH',
    sourceFile: 'core/prompts/golden-example.mjs',
    examSelfChecks: 0,
    templateVersion: TEMPLATE_VERSION,
    sdkVersion: SDK_VERSION,
  },
});

console.log(`判定：${report.verdict}`);
for (const c of report.checks ?? []) {
  const mark = c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
  const label = labelOf(c.id);
  const shown = label && label !== '未知强度' ? ` ${label}` : '';
  console.log(`  ${mark} ${c.id}${shown}${c.status === 'pass' ? '' : ` — ${c.message ?? ''}`}`);
}
const failed = (report.checks ?? []).filter((c) => c.status === 'fail');
console.log(failed.length ? `\n✗ 范例不过关：${failed.length} 项失败` : '\n✓ 范例 C1–C9 全绿');
if (report.verdict !== 'pass') process.exitCode = 1;
