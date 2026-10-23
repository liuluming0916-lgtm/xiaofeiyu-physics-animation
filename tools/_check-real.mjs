#!/usr/bin/env node
/**
 * _check-real —— 跑 `tests/real-exam/<id>.program.json` 的 Dry-Run（v6 口径）。
 *
 * 为什么不用 `_check-q04.mjs` / `_check-q06.mjs` 那种写法：
 *   v6 之后 `STEPS` 只有 title/tex，C5 改判 `VIEW.duration == T_phys`、C6 改判 analysis 分段边界。
 *   这两个数在流水线里来自 analysis，而"单份 program.json"里没有 analysis —— 只能从
 *   `setup` 的 `T_PHYS` 与 `VIEW` 的 `phases` 反推（解析在 `core/dryrun/question-sources.mjs`
 *   的 `deriveTiming()` 里，与门禁 ③ 共用同一份，避免两处漂移）。
 *
 * 用法：
 *   node tools/_check-real.mjs q06
 *   node tools/_check-real.mjs q06 --json     # 打完整报告
 */
import { readFileSync } from 'node:fs';

import { dryRun } from '../core/dryrun/dry-run.mjs';
import { deriveTiming } from '../core/dryrun/question-sources.mjs';

const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith('--'));
const wantJson = argv.includes('--json');
if (!id) {
  console.error('用法：node tools/_check-real.mjs <q01|q04|q05|q06|q07|q08|q09> [--json]');
  process.exit(2);
}
const program = JSON.parse(readFileSync(`tests/real-exam/${id}.program.json`, 'utf8'));
const slots = program.slots ?? program;
const timing = deriveTiming(slots);

const res = await dryRun({
  slots,
  entry: program.id ?? id,
  meta: {
    index: program.index,
    title: program.title,
    mode: program.mode ?? 'BOTH',
    sourceFile: `tests/real-exam/${id}.program.json`,
    ...timing,
  },
});
const r = res.report;
if (wantJson) {
  console.log(JSON.stringify(r, null, 2));
} else {
  console.log(
    `${id} · verdict=${r.verdict} · frames=${r.execution?.frameCount ?? 0} · T_phys=${timing.tPhys ?? '—'} · 边界 ${(timing.boundaries ?? []).join('/')}`,
  );
  for (const c of r.checks ?? []) {
    if (c.status !== 'pass') console.log(`  ${c.id} ${c.status} ${JSON.stringify(c.offenders ?? []).slice(0, 500)}`);
  }
}
if (r.verdict !== 'pass') process.exitCode = 1;
