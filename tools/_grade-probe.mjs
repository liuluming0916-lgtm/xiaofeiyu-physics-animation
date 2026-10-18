#!/usr/bin/env node
/**
 * _grade-probe —— 取证「判据分级」真的按 §8 生效（第 9 期）。
 *
 * 三件事必须同时成立，缺一条这套分级就是装饰：
 *   ① 孤立的名字笔误（**没被执行到**）⇒ C1 红、但 `blocking: false` ⇒ verdict 不是 fail；
 *      而且 C3–C9 必须**照常跑**（不是 7 条"未执行"）。
 *   ② 同一个笔误**被执行到** ⇒ 运行期抛错 ⇒ C2 硬拦 ⇒ verdict 仍是 fail（降级不放过）。
 *   ③ 沙箱逃逸（`require`）⇒ 仍被硬拦（`banned-identifier`，不是被告警吞掉）。
 *
 * 用法：node tools/_grade-probe.mjs
 */

import { splitSlots } from '../core/cleaner/marker-split.mjs';
import { dryRun } from '../core/dryrun/dry-run.mjs';
import { GOLDEN_EXAMPLE } from '../core/prompts/golden-example.mjs';
import { CHECK_SEVERITY } from '../contracts/spec/frozen-keys.mjs';

const BASE = splitSlots(GOLDEN_EXAMPLE).slots;
const meta = { mode: 'BOTH', forceBackend: 'vm-fallback' };

let bad = 0;
const say = (ok, name, detail) => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) bad += 1;
};

async function run(slots, entry) {
  const { report } = await dryRun({ slots, entry, meta });
  return report;
}

console.log(`分级表：C1=${CHECK_SEVERITY.C1} · C4=${CHECK_SEVERITY.C4} · C6=${CHECK_SEVERITY.C6}`);

/* ① 笔误在**未被调用**的函数里 ⇒ 只出告警 */
{
  const slots = {
    ...BASE,
    setup: `${BASE.setup}\n// 未被调用的辅助函数：里面拼错了一个名字\nfunction unusedHelper() { return Matn.PI; }`,
  };
  const r = await run(slots, 'grade-unused-typo');
  const c1 = r.checks.find((c) => c.id === 'C1');
  say(c1.status === 'fail', '① 笔误 ⇒ C1 仍然报 fail（判据照跑）', c1.status);
  say(c1.blocking === false, '① 但 blocking 为假（降告警）', String(c1.blocking));
  say(r.verdict !== 'fail', '① verdict 不再是 fail', r.verdict);
  const skipped = r.checks.filter((c) => c.skipped).map((c) => c.id);
  say(skipped.length === 0, '① C3–C9 照常执行（没有被一票否决）', skipped.join(',') || '无跳过');
}

/* ② 同一个笔误**被执行到** ⇒ C2 硬拦 */
{
  const slots = { ...BASE, setup: `${BASE.setup}\nconst boom = Matn.PI;` };
  const r = await run(slots, 'grade-executed-typo');
  const c2 = r.checks.find((c) => c.id === 'C2');
  say(r.verdict === 'fail', '② 笔误被执行到 ⇒ verdict 仍是 fail（降级不放过）', r.verdict);
  say(c2.status === 'fail' && c2.blocking === true, '② C2 硬拦', `${c2.status}/${c2.blocking}`);
}

/* ③ 沙箱逃逸仍被硬拦 */
{
  const slots = { ...BASE, setup: `${BASE.setup}\nconst fs = require('fs');` };
  const r = await run(slots, 'grade-require');
  const c1 = r.checks.find((c) => c.id === 'C1');
  const rules = (c1.diagnostics ?? []).map((d) => d.rule);
  say(rules.includes('banned-identifier'), '③ require 命中 banned-identifier（不是只剩告警）', [...new Set(rules)].join(','));
  say(c1.blocking === true, '③ C1 仍然硬拦', String(c1.blocking));
  say(r.verdict === 'fail', '③ verdict 仍是 fail', r.verdict);
}

console.log(bad ? `\n✗ 分级取证失败 ${bad} 条` : '\n✓ 分级取证全部符合 §8');
if (bad) process.exitCode = 1;
