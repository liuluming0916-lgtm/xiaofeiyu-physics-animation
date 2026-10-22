#!/usr/bin/env node
/**
 * 把 v1 的运行时内置卡迁移成 v2 数据（Phase 2 过渡工具）。
 *
 * 为什么要过渡：Phase 2 只切“引擎/触发”，v1 的卡片生成器（build-animation-cards.mjs）
 * 还没改成 v2。先用这份工具把现有 33 张内置卡转成 v2 数据，v2 引擎直接读；
 * Phase 5 再把生成器本体改成 v2，这份工具就可以退役。
 *
 * 用法：node tools\build-knowledgecard-v2-data.mjs --force
 *
 * ⚠ 2026-10-22 起 `data-v2` 已经是**手写源**（按 drawFrame-only 口径重写）。
 *   本工具只用于"从 v1 重新生成一份对照"，默认拒绝执行，免得把重写结果盖掉。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from './paths.mjs';
import { migrateEntryV1toV2, validateEntryV2 } from '../core/knowledgecard/v2/entry.mjs';

if (!process.argv.includes('--force')) {
  console.error('✗ data-v2 现在是手写源，拒绝覆盖。确需从 v1 重新生成一份对照，请加 --force。');
  process.exit(1);
}

const SRC = join(PROJECT_ROOT, 'core', 'knowledgecard', 'data');
const OUT = join(PROJECT_ROOT, 'core', 'knowledgecard', 'data-v2');
const VOCAB = JSON.parse(readFileSync(join(PROJECT_ROOT, 'contracts', 'knowledgecard-vocab-v2.json'), 'utf8'));

const files = ['92-animation-core.json', '93-elements.json'];
const report = { converted: 0, disabled: [], problems: [] };
const outFiles = [];

for (const file of files) {
  const pack = JSON.parse(readFileSync(join(SRC, file), 'utf8'));
  const entries = [];
  for (const e of pack.entries ?? []) {
    const r = migrateEntryV1toV2(e, { vocab: VOCAB });
    if (!r.ok) {
      report.disabled.push({ id: e.id, reasons: r.reasons });
      continue;
    }
    const problems = validateEntryV2(r.entry, { vocab: VOCAB, where: `source/${file} · ${e.id}` });
    if (problems.length) {
      report.problems.push(...problems);
      continue;
    }
    entries.push(r.entry);
    report.converted += 1;
  }
  outFiles.push({ file, entries });
}

if (report.problems.length) {
  console.error('✗ 迁移后的数据不合法，未写出：');
  for (const p of report.problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  mkdirSync(OUT, { recursive: true });
  for (const { file, entries } of outFiles) {
    const pack = { format: 'od-knowledgecard', version: 2, entries };
    writeFileSync(join(OUT, file), `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  }
  console.log(`✓ 已写出 ${report.converted} 张 v2 内置卡 → core/knowledgecard/data-v2/`);
  if (report.disabled.length) {
    console.log(`  停用 ${report.disabled.length} 张：`);
    for (const d of report.disabled) console.log(`    · ${d.id}：${d.reasons.join('；')}`);
  }
}
