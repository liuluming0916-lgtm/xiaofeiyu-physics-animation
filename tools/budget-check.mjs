#!/usr/bin/env node
/**
 * budget-check —— 逐题核对 §6.2 / §20 的代码长度硬上限，并汇总观测指标。
 *
 *   · 单槽位 ≤ 400 行（`STEPS` 正文按行式表的实际行数计）
 *   · ~~stateAt + drawFrame 合计 ≤ 150 行~~ → 第 8 期用户裁决取消
 *   · 顺带给出每题的 readouts 项数、时长、步数、Draw.raw 使用率、单帧命令数峰值
 *
 * 这些阈值是 §6.2 的 C1 判据之一；本脚本用独立口径复核一遍（不依赖报告文件）。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUESTION_DIR = join(PROJECT_ROOT, 'tests', 'regression-15');

const TOTAL_LIMIT = 400;
/**
 * 第 8 期用户裁决：`stateAt + drawFrame ≤ 150 行` 已取消（可读性预算，不是对错判据）。
 * 这个数字只作"观测列"显示，**不再参与判定**。
 */
const STATE_DRAW_INFO_ONLY = 150;

const lines = (text) => String(text ?? '').split('\n').length;

export async function main() {
  const files = readdirSync(QUESTION_DIR).filter((f) => f.endsWith('.mjs')).sort();
  let reports = new Map();
  try {
    const list = JSON.parse(readFileSync(join(PROJECT_ROOT, 'tests', 'reports', 'dry-run-report.json'), 'utf8'));
    reports = new Map(list.map((r) => [r.entry, r]));
  } catch {
    /* 未跑过 Dry-Run */
  }

  let over = 0;
  console.log('budget-check · 代码长度上限（§6.2 / §20）');
  console.log('  #  题目                  stateAt+drawFrame   最长槽位   读数量  时长   步数  raw%  峰值命令');
  for (const file of files) {
    const program = (await import(pathToFileURL(join(QUESTION_DIR, file)).href)).default;
    const slots = program.slots;
    const stateDraw = lines(slots.stateAt) + lines(slots.drawFrame);
    const longest = Object.entries(slots)
      .map(([k, v]) => [k, lines(v)])
      .sort((a, b) => b[1] - a[1])[0];
    const bad = longest[1] > TOTAL_LIMIT;
    if (bad) over += 1;
    const r = reports.get(program.id);
    console.log(
      `  ${String(program.index).padStart(2, '0')} ${program.title.padEnd(18, '　')} ` +
        `${String(stateDraw).padStart(6)} / (无上限)   ${longest[0]}=${String(longest[1]).padStart(3)}   ` +
        `${String(r?.observations?.readoutKeys?.length ?? '—').padStart(4)}  ` +
        `${(r?.execution?.duration ?? 0).toFixed(2).padStart(5)}s ` +
        `${String(r?.execution?.frameCount ?? '—').padStart(5)}  ` +
        `${((r?.observations?.drawRawUsage ?? 0) * 100).toFixed(2).padStart(4)}  ` +
        `${String(r?.observations?.maxCommandsPerFrame ?? '—').padStart(4)}` +
        (bad ? '  ← 超限' : ''),
    );
  }
  console.log(over ? `\n✗ ${over} 道题超出长度上限` : `\n✓ ${files.length} 道题均在长度上限内（单槽位 ≤${TOTAL_LIMIT} 行；stateAt+drawFrame 不再设限）`);
  if (over) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  Promise.resolve(main()).catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
