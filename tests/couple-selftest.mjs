#!/usr/bin/env node
/**
 * couple（步骤耦合）纯函数取证。
 *
 * 用法：node tests/couple-selftest.mjs
 */

import { parseStepTimes, fallbackStepTimes, formatStepsForCouple } from '../core/couple/index.mjs';
import { buildDisplayTiming } from '../core/timing/display-time.mjs';

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

const T = 3;
const steps = [
  { title: '第 1 步 · 加速', tex: '物块加速' },
  { title: '第 2 步 · 匀速', tex: '物块匀速' },
  { title: '第 3 步 · 结论', tex: '总结' },
];

const valid = ['step: 1', 't0: 0', 't1: 1', '', 'step: 2', 't0: 1', 't1: 3'].join('\n');
{
  const r = parseStepTimes(valid, { stepCount: 3, tPhys: T });
  check('合法表通过', r.ok, r.problems.join('；'));
  check('保留两条时间记录（第 3 步是概念步，可省略）', r.stepTimes.length === 2, JSON.stringify(r.stepTimes));
  check('按 step 升序', r.stepTimes[0].step === 1 && r.stepTimes[1].step === 2);
}

{
  const r = parseStepTimes('', { stepCount: 3, tPhys: T });
  check('空输出合法（全是纯概念步，可无时间）', r.ok && r.stepTimes.length === 0, r.problems.join('；'));
}
{
  const r = parseStepTimes(['step: 1', 't0: 0', 't1: 1', 'x: 2'].join('\n'), { stepCount: 3, tPhys: T });
  check('未知字段被拒', !r.ok && r.problems.some((p) => p.includes('不认识的字段')), r.problems.join('；'));
}
{
  const r = parseStepTimes(['step: 1', 't0: 0', 't1: 1', '', 'step: 1', 't0: 1', 't1: 2'].join('\n'), { stepCount: 3, tPhys: T });
  check('step 重复被拒', !r.ok && r.problems.some((p) => p.includes('重复')), r.problems.join('；'));
}
{
  const r = parseStepTimes(['step: 1', 't0: 0', 't1: 2', '', 'step: 2', 't0: 1', 't1: 3'].join('\n'), { stepCount: 3, tPhys: T });
  check('时间重叠被拒', !r.ok && r.problems.some((p) => p.includes('重叠')), r.problems.join('；'));
}
{
  const r = parseStepTimes(['step: 1', 't0: 0', 't1: 4'].join('\n'), { stepCount: 3, tPhys: T });
  check('超出 T_phys 被拒', !r.ok && r.problems.some((p) => p.includes('超出')), r.problems.join('；'));
}
{
  const r = parseStepTimes(['step: 1', 't0: 2', 't1: 2'].join('\n'), { stepCount: 3, tPhys: T });
  check('t1 <= t0 被拒', !r.ok && r.problems.some((p) => p.includes('t1 必须大于 t0')), r.problems.join('；'));
}
{
  const r = parseStepTimes(['step: 9', 't0: 0', 't1: 1'].join('\n'), { stepCount: 3, tPhys: T });
  check('step 越界被拒', !r.ok && r.problems.some((p) => p.includes('1..3')), r.problems.join('；'));
}

{
  const fb = fallbackStepTimes(3, T);
  check('回退生成 3 段', fb.length === 3);
  check('回退首尾覆盖 [0, T]', fb[0].t0 === 0 && fb[2].t1 === T, JSON.stringify(fb));
  check('回退不重叠', fb.every((s, i) => i === 0 || s.t0 === fb[i - 1].t1));
}

{
  const text = formatStepsForCouple(steps);
  check('步骤文本只有 title/tex，不含 t0/t1', !/\bt0\s*:/.test(text) && !/\bt1\s*:/.test(text), text);
  check('步骤文本包含三步标题', text.includes('第 1 步') && text.includes('第 2 步') && text.includes('第 3 步'));
}

/* ── sub（第几小问）与时长归一化（2026-10-23）────────────────────── */
{
  const withSub = ['step: 1', 'sub: 1', 't0: 0', 't1: 1', '', 'step: 2', 'sub: 2', 't0: 1', 't1: 3'].join('\n');
  const r = parseStepTimes(withSub, { stepCount: 3, tPhys: T });
  check('带 sub 的合法表通过', r.ok, r.problems.join('；'));
  check('sub 被保留', r.stepTimes.every((s) => Number.isInteger(s.sub)), JSON.stringify(r.stepTimes));

  const noSub = parseStepTimes(valid, { stepCount: 3, tPhys: T });
  check('不写 sub 时缺省为 1', noSub.stepTimes.every((s) => s.sub === 1), JSON.stringify(noSub.stepTimes));

  const badSub = parseStepTimes(['step: 1', 'sub: 0', 't0: 0', 't1: 1'].join('\n'), { stepCount: 3, tPhys: T });
  check('sub=0 被拒', !badSub.ok && badSub.problems.some((p) => p.includes('sub')), badSub.problems.join('；'));

  const timing = buildDisplayTiming(r.stepTimes);
  check('两个小问 → 显示时长 8 s', timing.displayDuration === 8, String(timing.displayDuration));
  check('映射表两段，物理区间 [0,1] 与 [1,3]', timing.timeMap.length === 2 && timing.timeMap[0].p1 === 1 && timing.timeMap[1].p1 === 3, JSON.stringify(timing.timeMap));
  check('步骤时间换到显示秒（step2 起点 = 4）', timing.stepTimes[1].t0 === 4, JSON.stringify(timing.stepTimes));

  const single = buildDisplayTiming(noSub.stepTimes);
  check('一个小问也是 4 s', single.displayDuration === 4, String(single.displayDuration));
  check('没有 stepTimes ⇒ 不做映射', buildDisplayTiming(null).timeMap === null);
}

console.log(`\n${failures.length ? '✗' : '✓'} 步骤耦合取证：通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
  process.exitCode = 1;
}
