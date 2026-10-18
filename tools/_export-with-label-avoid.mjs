#!/usr/bin/env node
/**
 * 生成"带标注避让"的导出网页（**一次性取证工具**，不是门禁）
 *
 * 为什么需要它：演示页（`web/` 里的动画页）用的是**内置演示源**，
 * 那条路上没有 Dry-Run，也就没有避让表 —— 所以在界面里看不见"字让位"。
 * 真正能立刻看见的路径是**导出**：导出页由 `buildQuestionHtml()` 打包，
 * 而避让表会被烧进 `PROGRAM_DATA`，双击即播、字已让位、引线也在。
 *
 * 用法：
 *   node tools/_export-with-label-avoid.mjs              # 默认 q01 / q04 / q07 / q09
 *   node tools/_export-with-label-avoid.mjs q01 q14      # 指定题号
 * 产物：`_preview-label-avoid/<id>-with-avoid.html`
 *
 * ⚠ 文件名以 `_` 开头 ⇒ 按仓库口径属"一次性取证工具"，不进 ⓪ 覆盖自检。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from './paths.mjs';
import { dryRun } from '../core/dryrun/dry-run.mjs';
import { loadQuestions } from '../core/dryrun/run-suite.mjs';
import { buildExportPage } from '../core/export/page.mjs';

const OUT_DIR = join(PROJECT_ROOT, '_preview-label-avoid');
const DEFAULT_QUESTIONS = ['q01', 'q04', 'q07', 'q09'];

const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const wanted = filters.length ? filters : DEFAULT_QUESTIONS;

const questions = await loadQuestions(wanted);
if (!questions.length) {
  console.error(`没有匹配的题目：${wanted.join(', ')}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
console.log(`生成带避让的导出页：${questions.length} 道`);

for (const { file, program } of questions) {
  const { report } = await dryRun({
    slots: program.slots,
    entry: program.id,
    meta: { mode: program.mode ?? 'NUMERIC', index: program.index, title: program.title, sourceFile: file },
  });

  const table = report.labelAvoid ?? null;
  const built = await buildExportPage({
    slots: program.slots,
    id: `${program.id}-with-avoid`,
    index: program.index,
    title: program.title,
    examPoint: program.examPoint,
    mode: program.mode ?? 'NUMERIC',
    model: 'label-avoid-demo',
    promptHash: table ? 'demo' : undefined,
    worldbookHash: table ? 'demo' : undefined,
    labelAvoid: table,
  });

  if (!built.ok) {
    console.error(`  ✗ ${program.id}：${built.code} ${built.message ?? ''}`);
    continue;
  }

  const out = join(OUT_DIR, `${program.id}-v4.html`);
  writeFileSync(out, built.html, 'utf8');
  const s = table?.summary ?? {};
  console.log(
    `  ✓ ${program.id}：注 ${s.total ?? 0} · 挪 ${s.moved ?? 0}（方案 A 之后不再画字，仅作留档）` +
      `  → ${out.replace(PROJECT_ROOT + '\\', '')}`,
  );
}

console.log('\n双击上面任意一个 HTML：画布上只有物理元件与矢量（绿=速度 蓝=加速度 红=受力），');
console.log('文字与数值全部不写；图例在画布下方。离线、自包含。');
