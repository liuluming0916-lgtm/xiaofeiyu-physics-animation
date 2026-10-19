#!/usr/bin/env node
/**
 * 生成「内置词条编译包」（第 8 期 · 用户 2026-10-17 裁决）
 *
 * 口径（用户原话）：**「封死不是对我们本地的源码封死，本地依旧需要可编辑的内置知识层，
 * 包装的软件中封死才对。」**
 *
 * 所以这里做的不是"删文件"，而是**多产出一份"编译进去的副本"**：
 *   · 本地开发：`loadLibrary()` 照旧读 `core/knowledgecard/data/*.json`（可编辑）；
 *   · 打包运行：`OD_BUILTIN_BUNDLE=1` ⇒ 读本脚本生成的常量，**不需要那些 JSON 文件**。
 *
 * 为什么把**原文**（JSON 文本）打进常量，而不是把解析后的对象打进去：
 *   解析、校验、哈希、去重全都在 `store.mjs` 的 `parseEntryFile` 里，
 *   把对象提前解析等于**把同一套规则实现两遍** —— 两份判据迟早会漂。
 *   打原文字节，= 保证"发布读到的"与"开发读到的"是**逐字节同一份数据**。
 *
 * 用法：node tools/build-builtin-bundle.mjs [--check]
 *   `--check`：只比对"生成的会是什么"与"盘上那份"，不一致就 exit 1（门禁 ㊴ 用）。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from './paths.mjs';

const BUILTIN_DIR = join(PROJECT_ROOT, 'core', 'knowledgecard', 'data');
const OUT_FILE = join(PROJECT_ROOT, 'core', 'knowledgecard', 'builtin-bundle.generated.mjs');
export const BUNDLE_FORMAT = 'od-builtin-bundle';
export const BUNDLE_VERSION = 1;

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * 算出"应该写成什么样"（纯函数 ⇒ 门禁可以直接比对，不必真的写盘）。
 * @returns {{ content: string, hash: string, files: {name: string, sha256: string, bytes: number}[] }}
 */
export function buildBundleSource() {
  const files = readdirSync(BUILTIN_DIR)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .sort()
    .map((name) => {
      const text = readFileSync(join(BUILTIN_DIR, name), 'utf8');
      return { name, sha256: sha256(text), text };
    });

  // 全量哈希：文件顺序固定（已 sort）⇒ 结果可复现
  const overall = sha256(files.map((f) => `${f.name}:${f.sha256}`).join('\n'));

  const payload = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    generatedFrom: 'core/knowledgecard/data',
    /** 内置层版本号（第 8 期风险 2 的答复：改了内容它就变，能对得上导出页的溯源） */
    hash: overall,
    files: files.map((f) => ({ name: f.name, sha256: f.sha256, text: f.text })),
  };

  const content = [
    '/*',
    ' * ⚠ 自动生成，请勿手改。',
    ' *   生成命令：node tools/build-builtin-bundle.mjs',
    ' *   门禁 ㊴ 会断言"这份内容 == 从 data/ 重新生成的结果"，所以手改一定会红。',
    ' */',
    `export const BUILTIN_BUNDLE = ${JSON.stringify(payload)};`,
    '',
  ].join('\n');

  return { content, hash: overall, files: files.map(({ name, sha256: h, text }) => ({ name, sha256: h, bytes: Buffer.byteLength(text, 'utf8') })) };
}

function main() {
  const check = process.argv.includes('--check');
  const { content, hash, files } = buildBundleSource();

  if (check) {
    const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : '';
    if (current !== content) {
      console.error('✗ 内置词条编译包与 data/ 不一致：请运行 node tools/build-builtin-bundle.mjs');
      process.exitCode = 1;
      return;
    }
    console.log(`✓ 编译包与 data/ 一致（${files.length} 个文件 · hash ${hash.slice(0, 12)}…）`);
    return;
  }

  writeFileSync(OUT_FILE, content, 'utf8');
  const kb = (Buffer.byteLength(content, 'utf8') / 1024).toFixed(1);
  console.log(`✓ 内置词条编译包已生成：${files.length} 个文件 · ${kb} KB · hash ${hash.slice(0, 12)}…`);
  console.log(`  → ${OUT_FILE}`);
  console.log('  发布形态（OD_BUILTIN_BUNDLE=1）读这份常量；本地开发仍读 data/ 下的可编辑文件。');
}

if (import.meta.url === new URL(`file://${process.argv[1]?.replace(/\\/g, '/')}`).href) main();
