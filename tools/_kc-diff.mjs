#!/usr/bin/env node
/**
 * _kc-diff —— 生成 v1 卡（`core/knowledgecard/source` 与 `data`）与 v2 卡（`data-v2`）的对照表。
 *
 * 为什么要它：v1 与 v2 不是"同一批卡的两种格式"，触发方式、字段、内容口径都变了；
 * 光看文件名看不出"哪张卡在教模型写 stateAt（v6 之后已经不写了）"。
 * 这里把差异**逐条摆出来**，并附指定几张卡的双栏全文。
 *
 * 用法：node tools/_kc-diff.mjs --out docs/history/2026-10-23-卡v1-v2对照.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const v1 = read('core/knowledgecard/data/93-elements.json').entries;
const v2 = read('core/knowledgecard/data-v2/93-elements.json').entries;
const core1 = read('core/knowledgecard/data/92-animation-core.json').entries ?? [];
const core2 = read('core/knowledgecard/data-v2/92-animation-core.json').entries ?? [];

const ids = (a) => a.map((e) => e.id);
const v1ids = ids(v1);
const v2ids = ids(v2);

const PAIRS = [
  ['wb_el_block', 'wb_el_block', '物块'],
  ['wb_el_circuit', 'wb_sc_wire', '电路 / 导线'],
  ['wb_el_field_region', 'wb_sc_magnetic_field', '磁场'],
];

const chars = (a) => Math.round(a.reduce((n, e) => n + String(e.content ?? '').length, 0) / a.length);
const maxChars = (a) => Math.max(...a.map((e) => String(e.content ?? '').length));

const out = [];
out.push('# 知识卡 v1 / v2 对照（2026-10-23 实测）');
out.push('');
out.push('> **结论先说：v1 已弃用，v2 是唯一在用的版本（2026-10-23 用户裁决）。** 本文只为对照留档。');
out.push('');
out.push('> 生成方式：`node tools/_kc-diff.mjs --out docs/history/2026-10-23-卡v1-v2对照.md`（正文逐字取自两个 JSON，不是手抄）。');
out.push('');
out.push('## 1. 两份文件分别是什么');
out.push('');
out.push('| | v1 | v2 |');
out.push('|---|---|---|');
out.push('| 目录 | `core/knowledgecard/data/`（由 `source/` 生成） | `core/knowledgecard/data-v2/` |');
out.push(`| 张数 | ${v1.length} 张（另有规范卡 ${core1.length} 张） | ${v2.length} 张（另有规范卡 ${core2.length} 张） |`);
out.push(`| 触发 | \`keys\` 字面量 + \`concepts\`/\`tags\` | \`elements\`/\`scenes\` 与读题判定**词表 id** 相交 |`);
out.push(`| 分类 | 全部 \`kind: element\` | \`kind: element ${v2.filter((e) => e.kind === 'element').length} 张\` / \`kind: scene ${v2.filter((e) => e.kind === 'scene').length} 张\` |`);
out.push(`| 平均正文 | ${chars(v1)} 字 / 最长 ${maxChars(v1)} | ${chars(v2)} 字 / 最长 ${maxChars(v2)} |`);
out.push(`| 写 \`stateAt\` 的卡 | ${v1.filter((e) => /stateAt/.test(e.content)).length}/${v1.length} | ${v2.filter((e) => /stateAt/.test(e.content)).length}/${v2.length} |`);
out.push('| 运行时读谁 | 不读（v6 已切 v2 引擎） | **读这份**（`loadV2Library`） |');
out.push('');
out.push('### 字段差异');
out.push('');
out.push('```text');
out.push('v1: id,title,origin,category,kind,enabled,constant,recursive,keys,secondary_keys,concepts,tags,elements,insertion_slot,order,priority,content,code_examples');
out.push('v2: id,title,origin,enabled,content,order,priority,code_examples,kind,constant,elements');
out.push('```');
out.push('');
out.push('v2 删掉：`category` `recursive` `keys` `secondary_keys` `concepts` `tags` `insertion_slot`。');
out.push('v2 新增：`kind` 允许 `scene`；`elements` 改成词表 id 列表。');
out.push('');
out.push('## 2. 拆分与增删');
out.push('');
out.push('> 下面两张"仅 v1 / 仅 v2"是**按 id 字符串**比出来的：同名概念大多换了前缀（`wb_el_incline` → `wb_sc_incline`），');
out.push('> 所以别把它读成"v1 有 23 张卡被删了"；真正的删改看紧随其后的对应关系。');
out.push('');
out.push(`仅 v1（${v1ids.filter((x) => !v2ids.includes(x)).length} 张）：${v1ids.filter((x) => !v2ids.includes(x)).map((x) => `\`${x}\``).join('、')}`);
out.push('');
out.push(`仅 v2（${v2ids.filter((x) => !v1ids.includes(x)).length} 张）：${v2ids.filter((x) => !v1ids.includes(x)).map((x) => `\`${x}\``).join('、')}`);
out.push('');
out.push('对应关系：`rod` → `conductor_rod` + `light_rod`；`circuit` → `wire` + `meter`；`field_region` → `electric_field` + `magnetic_field`；');
out.push('`cylinder_piston` → `cylinder` + `piston`；`orbit` → `celestial_orbit`（卫星并入 `ball`）；新增 `rail`、`mercury`；删除 7 张（stand/vector/paper_tape/ghosts/measuring_tool/chart/raw_composite）。');
out.push('');
out.push('## 3. 同一件事，两张卡怎么教（全文对照）');
for (const [a, b, label] of PAIRS) {
  const e1 = v1.find((x) => x.id === a);
  const e2 = v2.find((x) => x.id === b);
  out.push('');
  out.push(`### 3.${PAIRS.indexOf(PAIRS.find((p) => p[0] === a)) + 1} ${label}`);
  out.push('');
  out.push(`**v1 \`${a}\`**（${String(e1.content).length} 字）`);
  out.push('');
  out.push('```markdown');
  out.push(String(e1.content).trimEnd());
  out.push('```');
  out.push('');
  out.push(`**v2 \`${b}\`**（${String(e2.content).length} 字）`);
  out.push('');
  out.push('```markdown');
  out.push(String(e2.content).trimEnd());
  out.push('```');
}
out.push('');
/* ⚠ 不要用 `node … > file.md`：PowerShell 的 `>` 默认写 UTF-16，中文还会先被按 GBK 解一遍。
   所以由脚本自己写盘（UTF-8，无 BOM）。 */
const outIdx = process.argv.indexOf('--out');
if (outIdx >= 0) {
  writeFileSync(process.argv[outIdx + 1], `${out.join('\n')}\n`, 'utf8');
  console.log(`wrote ${process.argv[outIdx + 1]}`);
} else {
  console.log(out.join('\n'));
}
