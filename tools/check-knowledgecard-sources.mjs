#!/usr/bin/env node
/**
 * 词条源**预检**（第 5.5 期的作者工具，**不是**门禁）。
 *
 * ── 为什么要有它
 *
 * 第 5.5 期是手写 JSON：一个 `]` 漏掉，`rewrite-knowledgecard-entries.mjs` 就会以
 * \"不是合法 JSON\" 中止。那时它的报错是 `JSON.parse` 的原文（`Expected ',' or ']'`），
 * 指向的位置对人不友好，而且**一次只报第一个坏文件**。
 * 本工具把这件事提前、并说清楚：
 *
 *   · 逐个源文件 `JSON.parse`，报出**文件名 + 行:列 + 上下文片段**；
 *   · 额外检查三件最容易手滑的事 ——
 *     ① `entries` 是否为数组、每条的 `code_examples` 是否为**非空数组**；
 *     ② 每条的必填字段是否齐全（id/title/origin/category/enabled/keys/insertion_slot/content）；
 *     ③ 主键里是否有**重复**（同一文件内 / 与其它文件的主键**互相包含** —— 这正是 P2 撞车检查的口径，
 *        在这里提前看一眼比等 rewrite 报出来快）。
 *
 * ⚠ 它**不替代** `node tools/rewrite-knowledgecard-entries.mjs`（那条才是唯一权威的校验 + 写库通道）。
 *   本工具只做\"让作者少返工\"的预检，故意不写盘、不改任何文件。
 *
 * 用法：node tools/check-knowledgecard-sources.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SOURCE_DIR, listSourceFiles } from './rewrite-knowledgecard-entries.mjs';

const REQUIRED = ['id', 'title', 'origin', 'category', 'enabled', 'keys', 'insertion_slot', 'content'];

/** 把 JSON.parse 的位置换算成 行:列 并给出上下文片段 */
function locate(text, err) {
  const m = /position (\d+)/.exec(String(err?.message ?? ''));
  if (!m) return { where: '(位置未知)', snippet: '' };
  const pos = Number(m[1]);
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  const from = Math.max(0, pos - 60);
  const snippet = text.slice(from, pos + 20).replace(/\n/g, '⏎');
  return { where: `${line}:${col}`, snippet };
}

const files = listSourceFiles();
if (!files.length) {
  console.error(`✗ 源目录是空的：${SOURCE_DIR}`);
  process.exit(1);
}

/**
 * `--fix-brackets`：把"数组收尾少了一个 `]`"这一**类**手滑自动修好。
 *
 * ── 为什么值得内置（而不是每次手动改）
 *
 * 第 5.5 期我是手写 JSON 的：`code_examples` 常常只有一个元素，
 * 于是 `"...\n`"` 之后**忘了写 `]`** 就接 `}`。`JSON.parse` 的报错点在**前一行**，
 * 人得来回找。这个模式在真实数据里是**可判定**的：
 * 报错位置前面最近的、非空行如果以 `"` 结尾（即字符串刚闭合），
 * 那么缺的就是该字符串所在数组的 `]`。
 *
 * ⚠ 三道保险：① 插入前先看该位置**上一非空行**是否以 `"` 结尾（否则不动它）；
 *   ② 插入后**必须**能 `JSON.parse` 通过，通不过就不写盘；③ 只在显式传 `--fix-brackets` 时才动文件。
 */
function fixBrackets() {
  let fixedCount = 0;
  for (const file of files) {
    const path = join(SOURCE_DIR, file);
    let text = readFileSync(path, 'utf8');
    let guard = 0;
    for (;;) {
      let err = null;
      try {
        JSON.parse(text);
        break;
      } catch (e) {
        err = e;
      }
      if (guard > 5) break; // 最多修 5 处，避免错误规则把文件改坏
      guard += 1;
      const m = /position (\d+)/.exec(String(err?.message ?? ''));
      if (!m) break;
      const pos = Number(m[1]);
      // 找到 pos 之前的最后一个非空行
      const before = text.slice(0, pos);
      const lines = before.split('\n');
      let idx = lines.length - 1;
      while (idx >= 0 && lines[idx].trim() === '') idx -= 1;
      if (idx < 0) break;
      const prevLine = lines[idx].trimEnd();
      // 这一模式的特征：上一个非空行以一个**字符串字面量**收尾。两种写法都要认 ——
      //   `…\n`"`（模板串，`code_examples` 里最常见的形态）与 `…"`（普通串）。
      //   认完**还要**靠下面那句 `JSON.parse(candidate)` 兜底：补了不合法就一定会放手。
      if (!(prevLine.endsWith('"') || prevLine.endsWith('`"'))) break;
      // 在该行末尾补 `]`（保持缩进）
      const insertAt = lines.slice(0, idx + 1).join('\n').length;
      const indent = /^\s*/.exec(lines[idx + 1] ?? lines[idx])[0];
      const candidate = `${text.slice(0, insertAt)}\n${indent}]${text.slice(insertAt)}`;
      try {
        JSON.parse(candidate);
      } catch {
        break; // 补了也不合法 ⇒ 不是这个模式
      }
      text = candidate;
      fixedCount += 1;
    }
    if (text !== readFileSync(path, 'utf8')) {
      writeFileSync(path, text, 'utf8');
      console.log(`  · 已补上数组收尾的 ]：${file}`);
    }
  }
  console.log(fixedCount ? `✓ 自动修补 ${fixedCount} 处` : '✓ 没有需要修补的位置');
}

if (process.argv.includes('--fix-brackets')) {
  fixBrackets();
  process.exit(0);
}

const problems = [];
/** @type {Array<{file: string, id: string, key: string}>} */
const primaryKeys = [];
let entryCount = 0;

for (const file of files) {
  const text = readFileSync(join(SOURCE_DIR, file), 'utf8');
  let pack;
  try {
    pack = JSON.parse(text);
  } catch (err) {
    const { where, snippet } = locate(text, err);
    problems.push(`${file} 不是合法 JSON（第 ${where} 行）\n      …${snippet}…\n      原始信息：${err?.message ?? err}`);
    continue;
  }
  if (pack?.format !== 'od-knowledgecard' || pack?.version !== 1) {
    problems.push(`${file} 的 format/version 必须是 od-knowledgecard / 1（实际：${pack?.format} / ${pack?.version}）`);
  }
  if (!Array.isArray(pack?.entries)) {
    problems.push(`${file} 的 entries 必须是数组`);
    continue;
  }
  for (const e of pack.entries) {
    entryCount += 1;
    const who = `${file} · ${e?.id ?? '(无 id)'}`;
    for (const f of REQUIRED) {
      if (!(f in (e ?? {}))) problems.push(`${who} 缺少必填字段 "${f}"`);
    }
    if (!Array.isArray(e?.code_examples) || e.code_examples.length === 0) {
      problems.push(`${who} 的 code_examples 必须是**非空数组**（§9.4 硬性要求）`);
    }
    if (typeof e?.content === 'string' && !/^#{2,6}[ \t]*生成后自检/m.test(e.content)) {
      problems.push(`${who} 的正文里找不到「生成后自检」小节标题（§9.4 硬性要求）`);
    }
    for (const k of Array.isArray(e?.keys) ? e.keys : []) {
      // 只预检**字面量**主键（正则主键的语义由作者控制，与 P2 口径一致）
      if (k.startsWith('/')) continue;
      primaryKeys.push({ file, id: String(e?.id ?? '?'), key: k });
    }
  }
}

// 主键互相包含（跨词条；同一条内部也值得看一眼，因为同一段文本会重复命中）
for (let i = 0; i < primaryKeys.length; i += 1) {
  for (let j = i + 1; j < primaryKeys.length; j += 1) {
    const a = primaryKeys[i];
    const b = primaryKeys[j];
    if (a.id === b.id && a.key === b.key) {
      problems.push(`${a.file} · ${a.id} 的主键重复：${a.key}`);
      continue;
    }
    if (a.id === b.id) continue;
    if (a.key.includes(b.key) || b.key.includes(a.key)) {
      problems.push(`主键互相包含：「${a.key}」(${a.id}) ⊃⊂ 「${b.key}」(${b.id}) —— P2 的撞车检查会报它`);
    }
  }
}

if (problems.length) {
  console.error(`✗ 词条源预检：${files.length} 个文件 / ${entryCount} 条词条，发现 ${problems.length} 个问题：`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\n  → 修好后跑 `node tools/rewrite-knowledgecard-entries.mjs`（那条才是权威校验 + 写库）。');
  process.exitCode = 1;
} else {
  console.log(`✓ 词条源预检通过：${files.length} 个文件 · ${entryCount} 条词条 · 主键无包含关系`);
}
