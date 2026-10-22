#!/usr/bin/env node
/**
 * _check-real —— 跑 `tests/real-exam/<id>.program.json` 的 Dry-Run（v6 口径）。
 *
 * 为什么不用 `_check-q04.mjs` / `_check-q06.mjs` 那种写法：
 *   v6 之后 `STEPS` 只有 title/tex，C5 改判 `VIEW.duration == T_phys`、C6 改判 analysis 分段边界。
 *   这两个数在流水线里来自 analysis，而"单份 program.json"里没有 analysis —— 只能从
 *   `setup` 的 `T_PHYS` 与 `VIEW` 的 `phases` 反推。老的两个检查脚本没给这两个 meta，
 *   于是会被**旧口径 C5**（STEPS 必须有 t0/t1）误判成 fail。
 *
 * 用法：node tools/_check-real.mjs q06
 */
import { readFileSync } from 'node:fs';
import { dryRun } from '../core/dryrun/dry-run.mjs';

const id = process.argv[2];
if (!id) {
  console.error('用法：node tools/_check-real.mjs <q04|q06|q09>');
  process.exit(2);
}
const program = JSON.parse(readFileSync(`tests/real-exam/${id}.program.json`, 'utf8'));
const slots = program.slots ?? program;

const num = (s) => Number(s);
const setupTs = /T_PHYS\s*=\s*([0-9.eE+-]+)/.exec(slots.setup ?? '');
const viewDur = /duration\s*:\s*([0-9.eE+-]+)/.exec(slots.VIEW ?? '');
const tPhys = setupTs ? num(setupTs[1]) : viewDur ? num(viewDur[1]) : undefined;

const boundaries = [...new Set([...(slots.VIEW ?? '').matchAll(/t0\s*:\s*([0-9.eE+-]+)\s*,\s*t1\s*:\s*([0-9.eE+-]+)/g)].flatMap((m) => [num(m[1]), num(m[2])]))]
  .filter((v) => Number.isFinite(v) && v >= 0)
  .sort((a, b) => a - b);

const res = await dryRun({
  slots,
  entry: id,
  meta: { mode: program.mode ?? 'BOTH', ...(tPhys ? { tPhys } : {}), ...(boundaries.length ? { boundaries } : {}) },
});
const r = res.report;
console.log(`${id} · verdict=${r.verdict} · frames=${r.execution?.frameCount ?? 0} · T_phys=${tPhys ?? '—'} · 边界 ${boundaries.join('/')}`);
for (const c of r.checks ?? []) {
  if (c.status !== 'pass') console.log(`  ${c.id} ${c.status} ${JSON.stringify(c.offenders ?? []).slice(0, 500)}`);
}
if (r.verdict !== 'pass') process.exitCode = 1;
