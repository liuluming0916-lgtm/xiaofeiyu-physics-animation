#!/usr/bin/env node
/** 生成当前卡片全文快照（元件 / 场景 / 常驻），不参与运行时。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'docs', 'plans', '当前卡片快照.md');

const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const core = read('core/knowledgecard/data-v2/92-animation-core.json');
const pack = read('core/knowledgecard/data-v2/93-elements.json');
const vocab = read('contracts/knowledgecard-vocab-v2.json');
const all = [...core.entries, ...pack.entries];

const aliasById = new Map([
  ...(vocab.elements ?? []).map((e) => [e.id, e.aliases ?? []]),
  ...(vocab.scenes ?? []).map((s) => [s.id, s.aliases ?? []]),
]);

const demote = (text) =>
  String(text ?? '')
    .split('\n')
    .map((line) => (/^#{1,6}\s/.test(line) ? `##${line}` : line))
    .join('\n');

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const fence = (s) => {
  let n = 3;
  while (String(s).includes('`'.repeat(n))) n += 1;
  return '`'.repeat(n);
};

const kindOf = (e) => e.kind ?? 'element';
const binding = (e) =>
  kindOf(e) === 'element'
    ? (e.elements ?? []).join(', ')
    : kindOf(e) === 'scene'
      ? (e.scenes ?? []).join(', ')
      : '—';

const elements = all.filter((e) => kindOf(e) === 'element');
const scenes = all.filter((e) => kindOf(e) === 'scene');
const constants = all.filter((e) => kindOf(e) === 'anim_rule');
const active = (list) => list.filter((e) => e.enabled !== false);

const out = [];
out.push('# 现在的卡片（快照）');
out.push('');
out.push('> 生成时间：2026-10-22');
out.push('> 数据源：`core/knowledgecard/data-v2/92-animation-core.json`、`93-elements.json`、`contracts/knowledgecard-vocab-v2.json`');
out.push('> 本文件由 `tools/_build-current-cards.mjs` 生成；以 JSON 为准。');
out.push('');
out.push('## 0. 一览');
out.push('');
out.push(`- 元件卡：**${elements.length}** 张（启用 ${active(elements).length}；` + '`graph_wave` 封存）');
out.push(`- 场景卡：**${scenes.length}** 张（启用 ${active(scenes).length}）`);
out.push(`- 常驻卡：**${constants.length}** 张`);
out.push(`- 词表：元件 ${vocab.elements?.length ?? 0} 个 / 场景 ${vocab.scenes?.length ?? 0} 个`);
out.push('');
out.push('> 正文按 JSON 原样复制；标题整体降两级以适配本文档层级。');
out.push('');
out.push('## 1. 索引');
out.push('');
out.push('| # | kind | id | 标题 | 绑定 | enabled | 字数 |');
out.push('|---:|---|---|---|---|---:|---:|');
all.forEach((e, i) => {
  out.push(`| ${i + 1} | ${kindOf(e)} | \`${e.id}\` | ${cell(e.title)} | ${cell(binding(e))} | ${e.enabled !== false} | ${String(e.content ?? '').length} |`);
});
out.push('');

const section = (title, list, start) => {
  out.push(`## ${start}. ${title}`);
  out.push('');
  list.forEach((e, i) => {
    out.push(`### ${start}.${i + 1} ${e.title}`);
    out.push('');
    out.push(`- id：\`${e.id}\``);
    out.push(`- kind：\`${kindOf(e)}\``);
    out.push(`- 绑定：\`${binding(e)}\``);
    out.push(`- enabled：${e.enabled !== false}`);
    out.push(`- 正文字数：${String(e.content ?? '').length}`);
    const aliases = aliasById.get(binding(e).split(',')[0]) ?? [];
    if (aliases.length) out.push(`- 词表别名：${aliases.join('、')}`);
    out.push('');
    out.push(demote(e.content).trimEnd());
    out.push('');
    const examples = e.code_examples ?? [];
    if (examples.length) {
      out.push('**代码示例**');
      out.push('');
      examples.forEach((code, j) => {
        const f = fence(code);
        out.push(`示例 ${j + 1}`);
        out.push('');
        out.push(`${f}js`);
        out.push(String(code).trimEnd());
        out.push(f);
        out.push('');
      });
    }
    out.push('---');
    out.push('');
  });
};

section('元件卡', elements, 2);
section('场景卡', scenes, 3);
section('常驻卡', constants, 4);
out.push('## 5. 说明');
out.push('');
out.push('- `graph_wave` 为封存卡：`enabled:false`，不再命中。');
out.push('- 删除项（`stand / vector / paper_tape / ghosts / measuring_tool / chart / raw_composite`）已不在本快照里。');
out.push('- 旧 `orbit / cylinder_piston / gas_tube / field_region / rod` 已拆分，旧卡不再存在。');
out.push('');

writeFileSync(OUT, `${out.join('\n')}\n`, 'utf8');
console.log(`✓ ${OUT}`);
console.log(`  元件 ${elements.length} · 场景 ${scenes.length} · 常驻 ${constants.length}`);
