#!/usr/bin/env node
/**
 * `_check-built` —— 成品页"能不能真的启动"的体检（诊断工具）。
 *
 * 起因：只检查"占位符被替换掉了"是不够的 —— 注入的运行时脚本如果在浏览器里**语法都过不了**，
 * 占位符照样是替换好的，页面照样是白屏 + "运行时未注入"。
 * 这里把每个内联 `<script>` 拿出来按**经典脚本**（非模块）做一次语法检查，
 * 并额外报出残留的 `__OD_*` 标记与可疑的 `import`/`export` 行。
 *
 * 用法：node tools/_check-built.mjs [template/build/q02-....html]
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'template', 'build');

function checkOne(file) {
  const html = readFileSync(file, 'utf8');
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [];
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1].trim();
    const code = m[2];
    if (/type\s*=\s*["']module["']/.test(attrs)) {
      scripts.push({ attrs, code, kind: 'module', error: '（模块脚本，跳过经典语法检查）' });
      continue;
    }
    let error = null;
    try {
      new vm.Script(code, { filename: file });
    } catch (err) {
      error = err.message;
    }
    scripts.push({ attrs, code, kind: 'classic', error });
  }
  // 只认**构建期**占位符；`__OD_SLOT_*` 是运行时里数据槽位的内部标记（正常，见 layout-lint 注释）
  const leftover = [...new Set([...html.matchAll(/__(?:OD_TITLE|OD_PROVENANCE|OD_RUNTIME|OD_TEX_RENDERER|OD_PROGRAM|OD_TEX_GLYPHS)__/g)].map((x) => x[0]))];
  const slotTokens = [...new Set([...html.matchAll(/__OD_SLOT_[A-Z_]+/g)].map((x) => x[0]))];
  return { file, bytes: html.length, scripts, leftover, slotTokens };
}

const args = process.argv.slice(2);
const files = args.length
  ? args.map((a) => (a.includes('/') || a.includes('\\') ? a : join(BUILD, a)))
  : readdirSync(BUILD)
      .filter((f) => f.endsWith('.html'))
      .sort()
      .map((f) => join(BUILD, f));

let bad = 0;
for (const file of files) {
  const r = checkOne(file);
  const name = file.replace(/\\/g, '/').split('/').pop();
  const broken = r.scripts.filter((s) => s.error && s.kind === 'classic');
  if (broken.length || r.leftover.length) bad += 1;
  console.log(
    `\n${broken.length || r.leftover.length ? '✗' : '✓'} ${name}  ${(r.bytes / 1024).toFixed(1)} KB · 内联脚本 ${r.scripts.length} 段`,
  );
  r.scripts.forEach((s, i) => {
    const head = s.code.split('\n').find((l) => l.trim()) || '';
    console.log(
      `    #${i + 1} ${s.kind} ${String(s.code.length).padStart(7)} 字节  ${s.error ? '✗ ' + s.error : '✓'}  首行：${head.trim().slice(0, 60)}`,
    );
    if (s.error ? s.error.startsWith('Unexpected token') : false) {
      const suspects = s.code
        .split('\n')
        .map((l, n) => [n + 1, l])
        .filter(([, l]) => /^\s*(export|import)\b/.test(l))
        .slice(0, 4);
      for (const [n, l] of suspects) console.log(`        第 ${n} 行：${l.trim().slice(0, 100)}`);
    }
  });
  if (r.leftover.length) console.log(`    残留构建占位符：${r.leftover.join(' ')}`);
  if (r.slotTokens.length) console.log(`    （内部数据槽标记，正常）：${r.slotTokens.join(' ')}`);
}

console.log(bad ? `\n✗ ${bad} 个成品页无法启动` : `\n✓ ${files.length} 个成品页的内联脚本都能通过经典脚本语法检查，且无残留占位符`);
if (bad) process.exitCode = 1;
