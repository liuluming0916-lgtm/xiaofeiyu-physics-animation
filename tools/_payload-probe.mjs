#!/usr/bin/env node
/**
 * _payload-probe —— 量「**一道题会给模型发多少东西**」（第 9 期）。
 *
 * 为什么需要它：项目里所有"注入量"的数字以前都是**世界书侧**的局部数字（`_wb-measure.mjs`），
 * 而真正花掉的是**五次调用的 system + user 之和**：固定前缀、阶段指令、命中的词条、任务段、
 * 判定词表 …… 分散在四个模块里，没人一次算清楚过。
 *
 * 它**不是判据**（`_` 前缀 = 一次性/取证工具，不进门禁）。口径与真实链路一致：
 *   system = 固定前缀 + 条件段（`【本阶段指令】` + 命中的词条）
 *   user   = 任务段（题面 / 题面+解题 / 判定词表 …）
 * 用的都是**真函数**：`buildFixedPrefix` / `buildSlotPreview` / `assemblePrompt` / `getPrompt().buildUser`。
 *
 * 用法：node tools/_payload-probe.mjs [q01]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildStagePrefix } from '../core/prompts/fixed-prefix.mjs';
import { getPrompt, buildJudgementVocab } from '../core/prompts/templates.mjs';
import { buildSlotPreview } from '../core/knowledgecard/engine.mjs';
import { loadLibrary } from '../core/knowledgecard/store.mjs';
import { PROJECT_ROOT } from './paths.mjs';

const lib = loadLibrary();

/** 拿一道真题的 PROBLEM / STEPS / ANSWERS 当"真实体量"的输入 */
const q = await import(new URL(`../tests/regression-15/${process.argv[2] ?? 'q01-conveyor-heat'}.mjs`, import.meta.url).href);
const slots = q.default.slots;
const problem = slots.PROBLEM;

/** 解题文字：真题里没有（它是人手写的程序），这里按"一道完整解题过程"的典型体量合成 */
const solution = [
  '取向右为正方向。物块刚放上传送带时速度为零，传送带速度 u = 2 m/s，故物块相对传送带向左滑动，',
  '所受滑动摩擦力方向向右，大小 f = μmg，加速度 a1 = f/m = μg = 2 m/s²。',
  '物块做匀加速运动，速度 v = a1 t，直到 v = u 时与传送带共速，所需时间 t* = u/a1 = 1.0 s，',
  '这一段的位移 Δx = a1 t*²/2 = 1.0 m。',
  '共速之后两者无相对滑动，摩擦力为零，物块随传送带一起匀速运动。',
  '摩擦生热用相对位移计算：Δs = u t* − Δx = 1.0 m，Q = μmg Δs = 2.0 J。',
  '结论：(1) t* = 1.0 s，Δx = 1.0 m；(2) Q = 2.0 J。',
].join('\n');

const vocab = buildJudgementVocab(JSON.parse(readFileSync(join(PROJECT_ROOT, 'contracts', 'knowledgecard-concepts.json'), 'utf8')));

const prefix = buildStagePrefix('scene_code');
const rows = [];
const fmt = (n) => String(n).padStart(6);

/** 按阶段组装（与 orchestrator 的口径一致：词条走本阶段的槽位，指令走 prompt.system） */
function stage({ id, slot, problemText, extraUser = null, concepts = [], tags = [], elements = [] }) {
  const prompt = getPrompt(id);
  const wb = slot ? buildSlotPreview({ entries: lib.entries, slot, text: problemText, concepts, tags, elements }) : { knowledgecardText: '' };
  // 第 9 期：前缀**按阶段取**（只有写代码的阶段才带骨架与 SDK 摘要）
  const stagePrefix = buildStagePrefix(id);
  const system = [stagePrefix.text, buildSlotConditionalText(prompt, wb.knowledgecardText)].filter(Boolean).join('\n\n');
  const user = extraUser ?? prompt.buildUser({ problem: problemText });
  rows.push({ id, slot: slot ?? '—', sys: system.length, user: user.length, wb: (wb.knowledgecardText ?? '').length });
  return { system, user };
}

/** 条件段：本阶段指令 + 命中的词条（与 `buildConditionalSegment` 同形，这里只取长度） */
function buildSlotConditionalText(prompt, knowledgecardText) {
  return [`【本阶段指令：${prompt.label}】`, prompt.system, knowledgecardText].filter(Boolean).join('\n\n');
}

/* 五个阶段，输入按真实链路累积 */
stage({ id: 'read_problem', slot: null, problemText: problem, extraUser: getPrompt('read_problem').buildUser({ problem, vocab }) });
stage({ id: 'solve', slot: 'solve', problemText: problem, concepts: ['conveyor_belt'], elements: ['belt', 'block'] });
/* 第 9 期调序：steps 先于 answers（答案的时间锚点必须照着已定的时间轴填） */
stage({
  id: 'steps',
  slot: 'solve',
  problemText: problem,
  concepts: ['conveyor_belt'],
  elements: ['belt', 'block'],
  extraUser: getPrompt('steps').buildUser({ problem, solution }),
});
stage({
  id: 'answers',
  slot: 'solve',
  problemText: problem,
  concepts: ['conveyor_belt'],
  elements: ['belt', 'block'],
  extraUser: getPrompt('answers').buildUser({ problem, solution, steps: slots.STEPS }),
});
stage({
  id: 'scene_code',
  slot: 'scene_code',
  problemText: problem,
  concepts: ['conveyor_belt'],
  elements: ['belt', 'block'],
  extraUser: getPrompt('scene_code').buildUser({
    problem,
    solution,
    steps: slots.STEPS,
    answers: slots.ANSWERS,
    timeAxis: '总时长 2.0 s；第 1 步 [0, 1.0]、第 2 步 [1.0, 2.0]。',
  }),
});

console.log(`固定前缀：${prefix.text.length} 字（promptHash ${prefix.promptHash.slice(0, 8)}…）`);
console.log('\n阶段           槽位        system     user     其中词条');
console.log('─'.repeat(62));
let total = 0;
for (const r of rows) {
  total += r.sys + r.user;
  console.log(`${r.id.padEnd(14)} ${r.slot.padEnd(10)} ${fmt(r.sys)}  ${fmt(r.user)}   ${fmt(r.wb)}`);
}
console.log('─'.repeat(62));
console.log(`五阶段合计：${total} 字`);
console.log(`\n修复轮次（只在 Dry-Run 没过时发生）：每轮再发一次 scene_code 的 system + 诊断，约 +${rows.at(-1).sys + 800} 字（上限 3 轮）`);
console.log(`最坏情况（首轮 + 3 轮修复）：约 ${total + 3 * (rows.at(-1).sys + 800)} 字`);
