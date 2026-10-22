#!/usr/bin/env node
/**
 * _show-run —— 从 `q06-model-events.json` 这样的全事件文件里把**某一阶段的模型原文**拼回来，
 * 并打印 dryrun 的失败明细。诊断用（`_` 一次性工具）。
 *
 * 用法：
 *   node tools/_show-run.mjs tests/reports/q06-model-events.json scene_code
 *   node tools/_show-run.mjs tests/reports/q06-model-events.json --checks
 */
import { readFileSync } from 'node:fs';

const [file, what = 'scene_code'] = process.argv.slice(2);
const events = JSON.parse(readFileSync(file, 'utf8'));

if (what === '--checks' || what === '-c') {
  const d = [...events].reverse().find((e) => e.type === 'dryrun_done');
  console.log('verdict', d?.verdict, 'frames', d?.frameCount, 'stage', d?.stage ?? '-');
  for (const c of d?.checks ?? []) {
    console.log(`\n=== ${c.id} ${c.status}${c.blocking ? ' (blocking)' : ''} :: ${c.message ?? ''}`);
    for (const o of (c.offenders ?? []).slice(0, 6)) console.log('  offender', JSON.stringify(o).slice(0, 600));
    if (c.diagnostics) console.log('  diagnostics', JSON.stringify(c.diagnostics).slice(0, 1500));
  }
  console.log('\n--- detail ---\n' + String(d?.detail ?? '').slice(0, 4000));
  process.exit(0);
}

const text = events
  .filter((e) => e.type === 'stage_delta' && e.stage === what && e.text)
  .map((e) => e.text)
  .join('');
console.log(text);
console.error(`\n[${what}] ${text.length} chars`);
