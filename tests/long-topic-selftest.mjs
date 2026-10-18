#!/usr/bin/env node
/**
 * 长题归一 + 判据放宽取证（第 8 期 · 用户 2026-10-17 裁决）
 *
 * 三件事，都是用户当场拍的板：
 *
 *  ① **取消 `stateAt + drawFrame ≤ 150 行`**。
 *     理由：它是"可读性预算"，不是对错判据；我们自己的 15 道真题最长已到 147 行，
 *     只剩 3 行余量，一道"两物体 + 弹簧 + 五支箭头 + 墙面纹理"的题必然超（实测 154 行）。
 *     真正要防的"跑不动/画不动"由 C2（10 秒）与 C9（每帧命令数）管。
 *
 *  ② **C2 的执行预算 4 秒 → 10 秒**。长题被 4 秒卡死是不公平的。
 *
 *  ③ **采样按题长归一**：物理时长越长，采样帧数**不再线性膨胀**。
 *     规则：短题（≤10 s）仍按 1/240 s 采样（15 道真题行为逐字不变）；
 *     长题封顶 **2400 帧**（= 10 s × 240 Hz），`dt` 按 `duration / 2400` 等分。
 *
 *  ⚠ 归一的是**校验采样密度**，不是动画时长：`SIM.duration` 该多长还是多长。
 *     正因如此 C7 必须在 `at_t` 处**精确求值**（否则长题会被冤杀 —— 用户当场指出的风险）。
 *
 * 用法：node tests/long-topic-selftest.mjs
 */

import { CODE_LENGTH_LIMITS, DRY_RUN_BUDGET } from '../contracts/spec/frozen-keys.mjs';
import { CommandBuffer, scanAll } from '../sdk/runtime/animation-runtime.mjs';
import { lintProgram } from '../core/lint/contract-lint.mjs';
import { isCliEntry } from '../tools/paths.mjs';

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

/** 造一个只关心"时长"的最小 program（几十帧足够验证采样口径） */
function timedProgram(duration) {
  const buffer = new CommandBuffer();
  return {
    SIM: { duration },
    buffer,
    stateAt: (t) => ({ t }),
    drawFrame: (t) => {
      buffer.reset();
      buffer.push({ op: 'line', from: [0, 0], to: [t, 1], width: 1 });
    },
    readouts: (t) => [{ label: 't', value: t, unit: 's' }],
  };
}

async function main() {
  console.log('长题归一 + 判据放宽取证（第 8 期）\n');

  /* ══ A 150 行上限已取消 ══ */
  console.log('『A』`stateAt + drawFrame ≤150 行` 已取消（400 行总上限仍在）');
  {
    check('限值表里不再有 stateDrawLines', CODE_LENGTH_LIMITS.stateDrawLines === undefined, JSON.stringify(CODE_LENGTH_LIMITS));
    check('单槽位 400 行总上限**仍在**', CODE_LENGTH_LIMITS.totalLines === 400, String(CODE_LENGTH_LIMITS.totalLines));

    const slot = (n) => Array.from({ length: n }, (_, i) => `var a${i} = ${i};`).join('\n');
    const ok160 = lintProgram({ stateAt: slot(80), drawFrame: slot(80) });
    const rulesOf = (r) => r.results.flatMap((x) => x.diagnostics.map((d) => d.rule));
    check('★ stateAt+drawFrame 合计 160 行 ⇒ **通过**（以前会被 150 行卡掉）', ok160.ok === true, JSON.stringify(rulesOf(ok160)));

    const ok410 = lintProgram({ stateAt: slot(410) });
    check('★ 单槽位 410 行 ⇒ 仍然拒绝（400 行总上限没被误伤）', ok410.ok === false && rulesOf(ok410).includes('slot-too-long'));
  }

  /* ══ B 执行预算 4 s → 10 s ══ */
  console.log('\n『B』C2 执行预算 4 秒 → 10 秒');
  {
    check('★ wallClockMs = 10000', DRY_RUN_BUDGET.wallClockMs === 10000, String(DRY_RUN_BUDGET.wallClockMs));
    check('采样步长常量仍是 1/240（短题口径不变）', Math.abs(DRY_RUN_BUDGET.dt - 1 / 240) < 1e-12);
  }

  /* ══ C 采样归一：短题不变、长题封顶 ══ */
  console.log('\n『C』采样归一：短题行为不变，长题封顶 2400 帧');
  {
    const short = scanAll(timedProgram(2), { dt: 1 / 240 });
    check('★ 2 秒题：`dt` 仍是 1/240（15 道真题行为逐字不变）', Math.abs(short.dt - 1 / 240) < 1e-12, String(short.dt));
    check(`★ 2 秒题：帧数 = ${short.frames.length}（≈ 481，与以前一致）`, short.frames.length >= 480 && short.frames.length <= 482, String(short.frames.length));

    const long = scanAll(timedProgram(60), { dt: 1 / 240 });
    check('★ 60 秒题：帧数**封顶** 2400（不再线性膨胀到 14400）', long.frames.length <= 2401, String(long.frames.length));
    check('★ 60 秒题：`dt` 自动放大到 duration/2400', Math.abs(long.dt - 60 / 2400) < 1e-9, String(long.dt));
    check('★ 60 秒题：采样覆盖到末时刻（时间轴不缺口）', Math.abs(long.frames[long.frames.length - 1].t - 60) < 1e-6, String(long.frames[long.frames.length - 1].t));
  }

  /* ══ D 归一化不能改动画时长 ══ */
  console.log('\n『D』归一的是采样，不是动画时长');
  {
    const p = timedProgram(60);
    const out = scanAll(p, { dt: 1 / 240 });
    check('★ `SIM.duration` 仍是 60（播放器照原时长播）', out.duration === 60, String(out.duration));
  }

  console.log(`\n${failures.length ? '✗' : '✓'} 长题归一取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
