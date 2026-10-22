#!/usr/bin/env node
/**
 * _prefix-dump —— 把**每个阶段的前缀**逐字导出成一份可读的 md（第 9 期）。
 *
 * 第 9 期起前缀**不再是全局一条**：只有要写代码的阶段（`scene_code` / `repair`）
 * 才带 `模板骨架` 与 `SDK 签名摘要`；读题/解题/分步/答案只吃「角色 + 输出纪律」。
 * 起因是用户发现「第一阶段没必要告诉 SDK 什么」——那约 3,600 字在四段里是白的。
 *
 * ⚠ 导出的正文是**真函数产出的逐字原文**（`buildStagePrefix(stage).text`），不是手抄，
 *   所以这份 md 永远和模型看到的一致。
 *
 * 用法：node tools/_prefix-dump.mjs   →  固定前缀-临时.md
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildStagePrefix, PREFIX_STAGES } from '../core/prompts/fixed-prefix.mjs';
import { PROJECT_ROOT } from './paths.mjs';

const OUT = join(PROJECT_ROOT, '固定前缀-临时.md');
const fence = (s) => ['```text', s, '```'].join('\n');

const LABEL = {
  read_problem: '读题（v1）',
  read_problem_v2: '读题（v2）',
  solve: '解题',
  breakdown: '答案讲解',
  analysis: '物理分析',
  scene_code: '动画代码',
  repair: '自愈修复',
  couple: '步骤耦合',
};

const all = PREFIX_STAGES.map((s) => ({ stage: s, ...buildStagePrefix(s) }));
const hash = all.find((x) => x.stage === 'scene_code').promptHash;
const perQuestion = ['read_problem', 'solve', 'breakdown', 'analysis', 'scene_code']
  .map((s) => all.find((x) => x.stage === s).text.length)
  .reduce((a, b) => a + b, 0);

const rows = all
  .map((x) => `| ${LABEL[x.stage]}（\`${x.stage}\`） | ${x.text.length} | ${x.parts.skeleton ? '有' : '—'} | ${x.parts.sdk ? '有' : '—'} |`)
  .join('\n');

const md = `# 固定前缀（按阶段）——模型每次都会先读到的那一段

> 临时文件，由 \`node tools/_prefix-dump.mjs\` 从代码里逐字导出，看完可删。
> 字数是**字符数**（中文按 1 字算）。

## 一句话

前缀 = **跨题永远不变的那段说明书**。它和"这道题是什么"无关，所以可以被模型缓存。

但第 9 期起它**按阶段分条**了：**只有要写代码的阶段**才带「SDK 函数清单」。
原因很直白——读题只转写、解题只写推导、分步/答案只吐行式表，这四段**一个字的代码都不写**，
原来却每段都收了完整前缀（4 段合计白扔约 14,000 字/题）。

| 阶段 | 字数 | 模板骨架 | SDK 摘要 |
|---|---|---|---|
${rows}

- 一道题跑五个阶段，前缀总量：**${perQuestion} 字**（重构前是 5 × 3,563 = 17,815 字）。
- 整版指纹 \`promptHash = ${hash}\`（覆盖八条前缀 + 两个版本号）。
- ⚠ 每条前缀仍然**跨题逐字节不变** ⇒ 缓存不受影响（缓存比的是"跨题"，不是"跨阶段"）。

---

## ① 四个"只写字"的阶段：角色 + 输出纪律（80–130 字）

${['read_problem', 'solve', 'breakdown', 'analysis']
  .map((s) => {
    const x = all.find((y) => y.stage === s);
    return `### ${LABEL[s]}（\`${s}\`，${x.text.length} 字）\n\n${fence(x.text)}`;
  })
  .join('\n\n')}

**白话**：这三四行只干一件事——**告诉它是谁、以及别乱说话**。
"只输出被要求的内容本身"就是"别寒暄、别总结"；"公式用 LaTeX"是为了下游能渲染；
"看不清就写图中未标注"是防它编图。**没有一句和代码有关**，因为这几段不写代码。

---

## ② 要写代码的舞台：角色 + SDK 摘要

### 原文（\`scene_code\`；\`repair\` 逐字相同）

${fence(all.find((x) => x.stage === 'scene_code').text)}

### 白话（三块分工）

1. **角色与输出规约（242 字）**：它是谁；只输出内容本身；公式用 LaTeX；
   代码是"受控 JS"——只能算数 + 调 SDK 函数，没有浏览器/网络/文件；画面用**世界坐标**（米），写像素就废。
2. **模板骨架（已取消）**：v6 只写 `drawFrame` 函数体，不再需要 8 槽位标记。
3. **SDK 签名摘要（约 2,900 字）**：它能调的**全部函数**（画图原语 + 四个计算辅助 + 6 条绘制约定 + 世界坐标）。
   最容易踩的两条已经写在里面：箭头**必须给 \`mag\`**；\`Phys.integrate\` **只能在 \`setup()\` 里调**。
   ⚠ 这一段是**机器生成**的（\`sdk/generate-signature-summary.mjs\` 扫真实导出面），门禁 ② 每次核对，**不要手改**。

---

## 为什么"不变"这件事很重要

模型服务端有缓存：一段前缀只要和上次**逐字节相同**，就按缓存价算；改一个字，整段作废。
所以代码上堵了三道：

1. \`buildFixedPrefix()\` **不接受任何参数**（门禁 ⑱ 断言 \`length === 0\`），从签名上堵死"把题面塞进来"；
2. 门禁 ⑱ 断言**六条前缀都不含**"题目/图片"字样；
3. \`promptHash\` 覆盖**全部八条前缀 + 两个版本号**——任何一条被改，指纹必变（那是预期行为）。

## 它里面**没有**什么

- 没有题面、图片、已知条件（在**任务段**，每题不同）；
- 没有世界书词条（在**条件段**，随命中变化）；
- 没有物理知识、没有各阶段的专属指令（那些在**本阶段指令**里，紧跟在前缀之后）。
`;

writeFileSync(OUT, md, 'utf8');
console.log(`✓ 已写出 ${OUT.replace(PROJECT_ROOT, '.')}`);
console.log(`  五个阶段前缀合计 ${perQuestion} 字（省 ${5 * 3563 - perQuestion}）· promptHash ${hash.slice(0, 8)}…`);
