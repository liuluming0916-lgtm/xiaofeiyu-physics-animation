#!/usr/bin/env node
/**
 * 内置词条：**源（source）→ 运行时库（data）** 的通道（§9.3 治理 / §9.4 内容规范 / §19.3 覆盖率）。
 *
 * ── 两个目录的分工（第 5.5 期的 P1 改造）
 *
 *   `core/worldbook/source/*.json`   ← **词条写在这里**。按章分文件，格式就是 §9.5 的导出包
 *                                       （与运行时库同形，**不另发明一种格式**）。
 *   `core/worldbook/data/*.json`     ← **运行时库**（派生物，**不许手改**）。`loadLibrary()` 读的是它。
 *
 *   为什么要有这一层：第 5.5 期要写上百条词条。若把它们内联在本脚本里，
 *   每写一个批次都要改同一个几千行的源文件，极易互相踩；而且"内容"与"通道"混在一起，
 *   `--check` 那条判据也就失去了意义。现在每批只动 `source/` 里的**一个文件**。
 *
 * ── 本脚本做四件事
 *
 *   ① 读 `source/` 并逐条按 §9.1 校验（不合法 ⇒ **中止**：因为载入是"整批失败"，
 *      写出去一条坏的会让整个库读不回来）；
 *   ② 打印**治理报告**（§9.3 ②：将被替换的内置条目 / 因用户覆盖副本而保留的条目）；
 *   ③ 打印**覆盖率**（§19.3：每条内置词条必须含「生成后自检」小节 + ≥1 段 `code_examples`）
 *      与**触发词撞车提示**（第 5.5 期 P2：上百条并存时最容易翻车的地方）；
 *   ④ 写盘或核对。
 *
 * 用法（从仓库根）：
 *   node tools/rewrite-worldbook-entries.mjs             # 校验 + 写出 data/（默认）
 *   node tools/rewrite-worldbook-entries.mjs --check      # 只比对"盘上的 data/ == 会写出的"，不写盘（门禁 ㉒『W14』用）
 *   node tools/rewrite-worldbook-entries.mjs --prune      # 写盘时顺带删掉 data/ 里已经不该存在的文件（默认只报告，不删）
 *
 * ⚠ `--prune` 默认关闭是刻意的：本仓库没有 git，删除不可逆。看到"data/ 里有不该存在的文件"时，
 *   先确认那是不是你手放的，再决定加不加 `--prune`。
 */

import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from './paths.mjs';
import {
  BUILTIN_DIR,
  PACK_FORMAT,
  PACK_VERSION,
  USER_DIR,
  canonicalizeEntry,
  loadLibrary,
  parseEntryFile,
  readCoverageTarget,
  validateEntry,
  writeFileAtomic,
} from '../core/worldbook/store.mjs';
import { planUpgrade } from '../core/worldbook/governance.mjs';
import { checkCoverage, formatCoverageLine, targetFromFile } from '../core/worldbook/coverage.mjs';
import { detectKeyCollisions } from '../core/worldbook/engine.mjs';

/** 词条源目录（**人/模型写的地方**） */
export const SOURCE_DIR = join(PROJECT_ROOT, 'core', 'worldbook', 'source');

/** 列出源文件（按文件名排序 = 载入顺序提示） */
export function listSourceFiles(dir = SOURCE_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .sort();
}

/**
 * 读全部源文件。
 * @returns {{ layers: Array<{file: string, entries: object[]}>, problems: string[] }}
 */
export function readSource(dir = SOURCE_DIR) {
  const problems = [];
  const layers = [];
  for (const file of listSourceFiles(dir)) {
    const text = readFileSync(join(dir, file), 'utf8');
    const parsed = parseEntryFile(text, `source:${file}`);
    problems.push(...parsed.problems);
    layers.push({ file, entries: parsed.entries });
  }
  if (!layers.length) problems.push(`词条源目录是空的：${dir}（第 5.5 期应当在这里按章写词条）`);
  return { layers, problems };
}

/** 组装一个运行时库的导出包（字段顺序按 §9.1 冻结序 ⇒ 逐字节可复现） */
function buildPackText(entries) {
  const pack = {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    entries: entries.map((e) => canonicalizeEntry({ ...e, origin: 'builtin' })),
  };
  return `${JSON.stringify(pack, null, 2)}\n`;
}

/** 会写出的运行时库文件清单（`--check` 与门禁 ㉒『W14』都用它） */
export function plannedFiles(dir = SOURCE_DIR, outDir = BUILTIN_DIR) {
  const { layers } = readSource(dir);
  return layers.map((l) => ({ file: l.file, path: join(outDir, l.file), text: buildPackText(l.entries) }));
}

/** 全部内置词条（规范化后） */
export function allBuiltinEntries(dir = SOURCE_DIR) {
  const { layers } = readSource(dir);
  return layers.flatMap((l) => l.entries.map((e) => canonicalizeEntry({ ...e, origin: 'builtin' })));
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const prune = process.argv.includes('--prune');

  /* ① 读源 + 校验 */
  const { layers, problems } = readSource();
  const extraProblems = [];
  for (const l of layers) {
    for (const e of l.entries) {
      extraProblems.push(...validateEntry({ ...e, origin: 'builtin' }, `source/${l.file} · ${e.id ?? '(无 id)'}`));
    }
  }
  const allProblems = [...problems, ...extraProblems];
  if (allProblems.length) {
    console.error(`✗ 词条源不合法，已中止（${allProblems.length} 条）：`);
    for (const p of allProblems) console.error(`  - ${p}`);
    console.error('\n  → 修好 source/ 里的文件再重跑。**不要**绕过校验去手改 data/（那是派生物）。');
    process.exitCode = 1;
    return;
  }

  const entries = allBuiltinEntries();
  const files = plannedFiles();

  /* ② 治理报告（§9.3 ② / 16.3 ④）：先说清"会覆盖谁、会保留谁" */
  const lib = loadLibrary({ userDir: USER_DIR });
  const plan = planUpgrade({ newBuiltin: entries, oldBuiltin: lib.builtin, userEntries: lib.user });
  console.log('内置词条：源 → 运行时库（§9.3 治理）');
  console.log(`  源文件 ${layers.length} 个 · 词条 ${entries.length} 条`);
  console.log(`  当前运行时库 ${lib.builtin.length} 条 · 用户 ${lib.user.length} 条 · 用户覆盖副本 ${lib.overriddenIds.length} 条`);
  console.log(`  → 将被新版替换的内置条目 ${plan.replacedList.length} 条`);
  for (const s of plan.replacedList.slice(0, 20)) console.log(`      · ${s}`);
  if (plan.replacedList.length > 20) console.log(`      …（其余 ${plan.replacedList.length - 20} 条略）`);
  if (plan.kept.length) {
    console.log(`  → **因存在用户覆盖副本而保留不动** ${plan.kept.length} 条（§9.3 ②）：`);
    for (const k of plan.kept) console.log(`      · ${k.id}（${k.title}）`);
  }
  if (plan.added.length) console.log(`  → 新增 ${plan.added.length} 条：${plan.added.map((a) => a.id).join(', ')}`);
  if (plan.removed.length) {
    console.log(`  → 旧版有、新版没有（**不自动删除**）${plan.removed.length} 条：${plan.removed.map((a) => a.id).join(', ')}`);
  }
  if (lib.problems.length) {
    console.log(`  ⚠ 当前运行时库有 ${lib.problems.length} 条载入问题（本次会照常写出，但载入问题要单独修）：`);
    for (const p of lib.problems.slice(0, 5)) console.log(`      · ${p}`);
  }

  /* ③ 覆盖率 + 触发词撞车（§19.3 / P2 / P3） */
  const coverage = checkCoverage({ entries, target: targetFromFile(readCoverageTarget()) });
  console.log(`  覆盖率：${formatCoverageLine(coverage)}`);
  if (coverage.nonCompliant.length) {
    for (const r of coverage.nonCompliant.slice(0, 10)) {
      console.log(`      ✗ ${r.id}（${r.title}）：${r.problems.join('；')}`);
    }
  }
  const collisions = detectKeyCollisions(entries);
  if (collisions.length) {
    console.log(`  ⚠ 触发词撞车提示 ${collisions.length} 条（提示不阻断；上百条并存时最容易翻车的地方）：`);
    for (const c of collisions.slice(0, 15)) console.log(`      · ${c.message}`);
    if (collisions.length > 15) console.log(`      …（其余 ${collisions.length - 15} 条略）`);
  }

  /* ④ 写盘 / 核对 */
  const stale = existsSync(BUILTIN_DIR)
    ? readdirSync(BUILTIN_DIR)
        .filter((f) => f.toLowerCase().endsWith('.json') && !files.some((p) => p.file === f))
        .sort()
    : [];

  if (checkOnly) {
    const drifted = files.filter((f) => !existsSync(f.path) || readFileSync(f.path, 'utf8') !== f.text).map((f) => f.file);
    if (drifted.length) {
      console.error(`\n✗ 盘上的运行时库与从 source/ 会写出的不一致：${drifted.join(', ')}`);
      console.error('  → 请跑 `node tools/rewrite-worldbook-entries.mjs` 重新生成。**不要手改 data/ 里的 JSON。**');
      process.exitCode = 1;
      return;
    }
    if (stale.length) {
      console.error(`\n✗ data/ 里有 source/ 里已经不存在的文件：${stale.join(', ')}`);
      console.error('  → 它们会被 loadLibrary 当成正式词条载入。确认后跑 `node tools/rewrite-worldbook-entries.mjs --prune` 删除。');
      process.exitCode = 1;
      return;
    }
    console.log(`\n✓ 运行时库与 source/ 一致（${files.length} 个文件 · ${entries.length} 条词条）`);
    return;
  }

  let bytes = 0;
  for (const f of files) {
    writeFileAtomic(f.path, f.text);
    bytes += statSync(f.path).size;
  }
  console.log(`\n✓ 已写出运行时库：${files.length} 个文件 · ${entries.length} 条词条 · ${(bytes / 1024).toFixed(1)} KB → core/worldbook/data/`);
  if (stale.length && prune) {
    for (const f of stale) {
      unlinkSync(join(BUILTIN_DIR, f));
      console.log(`  − 已删除 data/${f}（source/ 里已不存在）`);
    }
  } else if (stale.length) {
    console.log(`  ⚠ data/ 里有 source/ 里已经不存在的文件（未被删除）：${stale.join(', ')}`);
    console.log('    → 确认无用后跑 `node tools/rewrite-worldbook-entries.mjs --prune`');
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  try {
    main();
  } catch (err) {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exitCode = 1;
  }
}
