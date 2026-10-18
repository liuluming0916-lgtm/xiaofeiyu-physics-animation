#!/usr/bin/env node
/**
 * 埋点自检（第 2 期新增门禁）。
 *
 * 第 2 期所有"行号级诊断"都压在一个前提上：**埋点不改变行号**。
 * 如果 `__odMark(...)` 的插入让某一行挪了位置，那么 C3/C4/C5/C6 报出来的
 * "第 N 行"就全是假话——而且这种错误**不会**被任何别的门禁发现
 * （判据照样通过，只是诊断指错地方）。所以这里对 15 道真题逐槽位取证三条：
 *
 *   ① **行数逐字不变**：埋点前 `code.split('\n').length` 必须等于埋点后；
 *   ② **埋点后可编译**：每一段埋点后的槽位正文都能被 acorn 接受；
 *   ③ **装配后可编译、行号可反查**：整份埋点装配源码能编译，
 *      且 `buildLineMap` 能把每个代码型槽位正文的每一行反查回它自己
 *      （即"生成第 X 行 → 槽位第 Y 行"是满射且自洽的）。
 *
 * 任何一条不过 → 退出码 1。这是纯静态检查，不执行槽位代码。
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Parser } from 'acorn';
import { PROBE_SLOTS, assembleInstrumented, instrumentSlot, buildLineMap } from '../core/lint/slot-instrument.mjs';
import { SLOT_PARAMS } from '../core/lint/contract-lint.mjs';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUESTION_DIR = join(PROJECT_ROOT, 'tests', 'regression-15');

function parseAsFunctionBody(code, params) {
  const src = `function __chk__(${params.join(', ')}) {\n${code}\n}`;
  Parser.parse(src, { ecmaVersion: 2022, sourceType: 'script', locations: true });
}

export async function main() {
  const files = readdirSync(QUESTION_DIR).filter((f) => f.endsWith('.mjs')).sort();
  const problems = [];
  let slotCount = 0;
  let markTotal = 0;
  let snapshotTotal = 0;

  for (const file of files) {
    const q = (await import(pathToFileURL(join(QUESTION_DIR, file)).href)).default;

    for (const slot of PROBE_SLOTS) {
      const code = q.slots[slot];
      if (typeof code !== 'string' || !code.trim()) continue;
      slotCount += 1;

      const mark = instrumentSlot(code, { slot, mode: 'mark' });
      const snap = instrumentSlot(code, { slot, mode: 'snapshot' });
      markTotal += mark.marks;
      snapshotTotal += snap.marks;

      if (mark.marks === 0) problems.push(`${q.id}/${slot}：一处理点都没插上（该槽位没有可插点的语句表？）`);

      for (const [mode, r] of [['mark', mark], ['snapshot', snap]]) {
        if (r.skipped) {
          problems.push(`${q.id}/${slot}（${mode}）：解析失败，埋点被跳过`);
          continue;
        }
        // ① 行数不变
        const before = code.split('\n').length;
        const after = r.code.split('\n').length;
        if (before !== after) problems.push(`${q.id}/${slot}（${mode}）：埋点改变行数 ${before} → ${after}`);
        // ② 埋点后可编译
        try {
          parseAsFunctionBody(r.code, SLOT_PARAMS[slot] ?? []);
        } catch (err) {
          problems.push(`${q.id}/${slot}（${mode}）：埋点后无法解析 —— ${err.message}（第 ${err.loc?.line} 行）`);
        }
      }

      // ③ 装配后可编译 + 行号可反查
      const assembled = assembleInstrumented(q.slots, { mode: 'mark', programMode: q.mode ?? 'NUMERIC' });
      try {
        // eslint-disable-next-line no-new-func
        new Function('runtime', `${assembled.source}\nreturn buildProgram;`);
      } catch (err) {
        problems.push(`${q.id}：埋点装配源码无法编译 —— ${err.message}`);
      }
      const entry = assembled.lineMap.entries.find((e) => e.slot === slot);
      if (!entry) {
        problems.push(`${q.id}/${slot}：行表里找不到该槽位`);
      } else {
        const bodyLines = entry.bodyEnd - entry.bodyStart + 1;
        const expectLines = code.split('\n').length;
        if (bodyLines !== expectLines) {
          problems.push(`${q.id}/${slot}：行表区间 ${bodyLines} 行 ≠ 槽位实际 ${expectLines} 行`);
        }
        if (!entry.verified) {
          problems.push(`${q.id}/${slot}：行表区间末尾不是函数收尾行（版式假设不成立）`);
        }
        for (let gen = entry.bodyStart; gen <= entry.bodyEnd; gen += 1) {
          const loc = assembled.lineMap.locate(gen);
          if (!loc || loc.slot !== slot || loc.line !== gen - entry.bodyStart + 1) {
            problems.push(`${q.id}/${slot}：生成第 ${gen} 行反查失败（${JSON.stringify(loc)}）`);
            break;
          }
        }
      }
    }
  }

  console.log('instrument-selftest · 埋点与行号映射（第 2 期所有行号级诊断的地基）');
  console.log(`  题量 ${files.length} · 槽位 ${slotCount} 个 · 埋点 ${markTotal} 处（快照模式同位置另行 ${snapshotTotal} 处）`);
  if (problems.length) {
    for (const p of problems.slice(0, 20)) console.log(`  ✗ ${p}`);
    console.log(`\n✗ 埋点自检未通过：${problems.length} 条`);
    process.exitCode = 1;
    return;
  }
  console.log('  ✓ 行数逐字不变 · 埋点后可解析 · 装配后可编译 · 生成行号可反查回槽位坐标');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
