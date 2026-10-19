#!/usr/bin/env node
/**
 * _stage-trace —— 回放「一道题在五个阶段里，模型分别收到什么、要交出什么」（第 9 期）。
 *
 * 为什么要有它：`_payload-probe.mjs` 只给数字，`_prefix-dump.mjs` 只给静态的前缀。
 * 但"它到底看到了什么"必须**逐字**看一遍才能判断设计对不对 —— 尤其是：
 *   · 每个阶段的 system 里到底拼了几块、顺序是什么；
 *   · 上一阶段的输出是怎么变成下一阶段的输入的（这是整条链最容易被想错的地方）。
 *
 * 口径与生产链路一致：system = 固定前缀 + 条件段（【本阶段指令】+ 命中词条），user = `prompt.buildUser()`。
 * 用的都是真函数；题目取真题 q01（传送带），**模型输出用真题里那份 C1–C9 全绿的程序**当模拟结果 ——
 * 因为编一段"像样的输出"没有意义，真程序才能看出下游吃不吃得下。
 *
 * 用法：node tools/_stage-trace.mjs   →  一次提问的全过程-临时.md
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildStagePrefix } from '../core/prompts/fixed-prefix.mjs';
import { getPrompt, buildJudgementVocab } from '../core/prompts/templates.mjs';
import { buildSlotConditional, buildSlotPreview } from '../core/knowledgecard/engine.mjs';
import { loadLibrary } from '../core/knowledgecard/store.mjs';
import { renderProgram } from './build-animation-cards.mjs';
import { PROJECT_ROOT } from './paths.mjs';
import { readFileSync } from 'node:fs';

const lib = loadLibrary();
const prefixHash = buildStagePrefix('scene_code').promptHash;
const q = (await import(new URL('../tests/regression-15/q01-conveyor-heat.mjs', import.meta.url).href)).default;
const S = q.slots;

const vocab = buildJudgementVocab(JSON.parse(readFileSync(join(PROJECT_ROOT, 'contracts', 'knowledgecard-concepts.json'), 'utf8')));
const judge = { concepts: ['conveyor_belt'], tags: [], elements: ['belt', 'block'] };

/** 按生产链路拼一个阶段的 system / user（第 9 期：前缀**按阶段取**） */
function compose(id, slot, text) {
  const prompt = getPrompt(id);
  const stagePrefix = buildStagePrefix(id);
  const wb = slot ? buildSlotPreview({ entries: lib.entries, slot, text, ...judge }).knowledgecardText : '';
  const cond = buildSlotConditional({ slot: slot ?? 'solve', instruction: prompt.system, instructionLabel: prompt.label, segment: wb });
  const system = [stagePrefix.text, cond.text].filter(Boolean).join('\n\n');
  return { prompt, system, condText: cond.text, prefixText: stagePrefix.text, prefixChars: stagePrefix.text.length, wb, systemChars: system.length };
}

/* ── 五个阶段（模型调用）── */
const st1 = compose('read_problem', null, S.PROBLEM);
const user1 = st1.prompt.buildUser({ problem: S.PROBLEM, vocab });

const st2 = compose('solve', 'solve', S.PROBLEM);
const user2 = st2.prompt.buildUser({ problem: S.PROBLEM });

const solutionText = `取向右为正方向。物块刚放上传送带时速度为零，传送带速度 $u=2\\ \\mathrm{m/s}$，故物块相对传送带向左滑动，所受滑动摩擦力方向向右，大小 $f=\\mu mg$，加速度 $a_1=f/m=\\mu g=2\\ \\mathrm{m/s^2}$。

物块做匀加速直线运动，速度 $v=a_1t$，直到 $v=u$ 时与传送带共速，所需时间 $t^{*}=u/a_1=1.0\\ \\mathrm{s}$，该段位移 $\\Delta x=\\tfrac{1}{2}a_1t^{*2}=1.0\\ \\mathrm{m}$。

共速之后两者无相对滑动，摩擦力为零，物块随传送带一起匀速运动。

摩擦生热用**相对位移**计算：$\\Delta s=ut^{*}-\\Delta x=1.0\\ \\mathrm{m}$，$Q=\\mu mg\\,\\Delta s=2.0\\ \\mathrm{J}$。

结论：(1) $t^{*}=1.0\\ \\mathrm{s}$，$\\Delta x=1.0\\ \\mathrm{m}$；(2) $Q=2.0\\ \\mathrm{J}$。`;

const st3 = compose('steps', 'solve', S.PROBLEM);
const user3 = st3.prompt.buildUser({ problem: S.PROBLEM, solution: solutionText });

/* 第 9 期调序：answers 在 steps 之后，并且**输入里带 STEPS** */
const st4 = compose('answers', 'solve', S.PROBLEM);
const user4 = st4.prompt.buildUser({ problem: S.PROBLEM, solution: solutionText, steps: S.STEPS });

const st5 = compose('scene_code', 'scene_code', S.PROBLEM);
const user5 = st5.prompt.buildUser({
  problem: S.PROBLEM,
  solution: solutionText,
  steps: S.STEPS,
  answers: S.ANSWERS,
  timeAxis: '总时长 2.0 s；第 1 步 [0, 1.0]、第 2 步 [1.0, 2.0]、第 3 步 [1.0, 1.5]、第 4 步 [1.5, 2.0]（以 STEPS 为准）。',
});

/* ── 模拟的模型输出（除 scene_code 外是写的；scene_code 用真题真程序）── */
const out1 = `【题面复述】水平传送带以恒定速率 u = 2 m/s 向右运行。将质量 m = 1 kg 的物块无初速轻放在传送带左端，物块与传送带之间的动摩擦因数 μ = 0.2，取 g = 10 m/s²。求：(1) 物块从放上传送带到与传送带共速所用的时间 t* 与位移 Δx；(2) 该过程中因摩擦产生的热量 Q。
【物体与姿态】物块（水平放置）；传送带（水平，两端滚轮）。
【相对位置与朝向】物块在传送带左端；传送带向右运行；正方向向右。
【尺寸与比例】图中未标注带长；物块尺寸未标注。
【已知量与标注】u = 2 m/s，m = 1 kg，μ = 0.2，g = 10 m/s²。
【图中文字与符号】u、m、μ。
【不确定之处】带的长度与物块尺寸图中未标注。
【考点】conveyor_belt
【题型】conveyor_belt — 共速与生热
【动画元件】belt、block
【判定依据】题面明确给出传送带速率与动摩擦因数，并求共速时刻与摩擦生热，属传送带传送带模型（conveyor_belt）。`;

const md = `# 一次提问的全过程回放（模拟）

> 临时文件，由 \`node tools/_stage-trace.mjs\` 生成，看完可删。
> 题目：真题 **q01 传送带共速与摩擦生热**（\`tests/regression-15/q01-conveyor-heat.mjs\`）。
> 数字是**字符数**（中文按 1 字算）。

---

## 0. 先回答你的问题：每次发前缀，对不对？

**对，而且必须发。** 原因有三层，从浅到深：

1. **模型没有记忆。** 每次请求是一次独立的 HTTP 调用，服务端不会替你记住"上一句说过什么"。
   所谓"对话历史"，其实是客户端每次都把之前的消息**重新发一遍**。我们这里更极端：
   每个阶段是一次**独立请求**，所以五个阶段各要一份 system。
2. **前缀放在最前面，是为了命中缓存。** 缓存的工作方式是"从头开始逐字节比对"——
   一旦中间有一处不同，后面全部作废。所以要把**永远不变的**放最前（固定前缀），
   **每阶段会变的**放其次（阶段指令 + 命中词条），**每题不同的**放最后（题面与上一阶段的产出）。
   现在的顺序正是这个（\`前缀 → 阶段指令 → 词条 → 任务段\`）。
3. **"发"和"付钱"是两件事。** 发 5 次共 17,815 字；但如果服务端命中前缀缓存，
   那 4 次重复是按缓存价算的。**所以真正要关心的不是"能不能不发"，而是"发出去的是不是逐字节一样"**。
   这也解释了为什么代码里要堵死"往前缀塞题面"——那会让 4 次缓存全部失效。

**唯一还能省的，是"减少调用次数"**（比如把"解题+答案+分步"合并成一次），代价是失去
"只重生成出错那一槽"的能力。当前设计选择了"多调用、可局部重试"，在本项目里是对的
（因为打回率是主要成本，不是 token）。

---

## 1. 五个阶段里，模型分别收到什么、交出什么

| # | 阶段 | 收到的 system | 收到的 user | 要交出 | 交出去之后给谁 |
|---|---|---|---|---|---|
| 1 | 读题与判定 | ${st1.systemChars} | ${user1.length} | 转写文字 + 三行判定 | 判定 → 世界书检索；转写 → 也进检索文本 |
| 2 | 解题 | ${st2.systemChars} | ${user2.length} | 解题过程（LaTeX） | → 分步解析 → 答案抽取 |
| 3 | 分步解析 | ${st3.systemChars} | ${user3.length} | STEPS 行式表 | → 答案抽取 / 动画代码 |
| 4 | 答案抽取 | ${st4.systemChars} | ${user4.length} | ANSWERS 行式表 | → 动画代码 |
| 5 | 动画代码 | ${st5.systemChars} | ${user5.length} | 8 槽位程序 | → 本地干跑（不调模型） |

> **⓪ 步要先说清**：第 9 期起前缀**按阶段分条**——前四个阶段只有一两百字（角色 + 输出纪律），
> 只有动画阶段带 8 槽位骨架与 SDK 函数清单。所以下面**每一段都把前缀逐字贴出来**，不再省略。
> 你在真实请求里看到的，就是 "前缀 + 空行 + 本阶段指令 + 命中词条"。

---
`;

let body = md;

/** 渲染一个阶段 */
function section(n, title, st, user, outWhat, outText, outNote) {
  const L = [];
  L.push(`## 阶段 ${n}：${title}（第 ${n} 次模型调用）`);
  L.push('');
  L.push(`**system**（合计 ${st.systemChars} 字 = 本阶段前缀 ${st.prefixChars} + 本阶段指令 ${st.condText.length}）`);
  L.push('');
  L.push('```text');
  /* 第 9 期：前缀按阶段取，前四段只有一两百字 —— 所以**每段都逐字贴出来**，不用省略 */
  L.push(st.prefixText);
  L.push('');
  L.push(`〔↑ 以上是本阶段的**前缀**（${st.prefixChars} 字）。前四个阶段只吃"角色 + 输出纪律"；`);
  L.push('  只有动画阶段带模板骨架与 SDK 函数清单。下面的 `【本阶段指令：…】` 才是这一阶段要干的事。〕');
  L.push('');
  L.push(st.condText);
  L.push('```');
  L.push('');
  L.push(`**user**（${user.length} 字）`);
  L.push('');
  L.push('```text');
  L.push(user);
  L.push('```');
  L.push('');
  L.push(`**模型交出的东西**：${outWhat}${outNote ? `（${outNote}）` : ''}`);
  L.push('');
  L.push('```text');
  L.push(outText);
  L.push('```');
  L.push('');
  L.push('---');
  L.push('');
  return L;
}

body += section(1, '读题与判定', st1, user1, '转写 + 三行判定', out1, '写死的模拟结果').join('\n');
body += section(2, '解题', st2, user2, '解题过程', solutionText, '写死的模拟结果').join('\n');
body += section(3, '分步解析', st3, user3, 'STEPS 行式表', S.STEPS, '取自真题').join('\n');
body += section(4, '答案抽取', st4, user4, 'ANSWERS 行式表', S.ANSWERS, '取自真题（时间锚点照着 step 3 的 STEPS 填）').join('\n');
body += section(5, '动画代码', st5, user5, '8 槽位程序', renderProgram(S), '取自真题，C1–C9 全绿').join('\n');

body += `## 3. 干跑：第 6 步**不调模型**

程序交出来之后，本地会跑一遍 C1–C9（静态预检 + 沙箱执行 + 逐帧判据）。这一步**不花 token**。
只有没过时才回到模型，而且**只重发生错的那几个槽位**：

\`\`\`text
[本阶段指令：自愈修复]
上一轮生成的动画代码没过校验。请只输出被要求修改的槽位，一个不多、一个不少……
（+ 诊断：哪一槽、第几行、什么规则、证据强度）
\`\`\`

每轮约再发一次"前缀 + 动画阶段指令 + 动画槽词条 + 诊断"，上限 3 轮。

## 4. 一次提问的账单

| 项 | 字数 |
|---|---|
| 各阶段前缀之和 | ${[st1, st2, st3, st4, st5].map((s) => s.prefixChars).reduce((a, b) => a + b, 0)}（前四段合计 ${[st1, st2, st3, st4].map((s) => s.prefixChars).reduce((a, b) => a + b, 0)}，动画那段 ${st5.prefixChars}） |
| 各阶段指令 | ${[st1, st2, st3, st4, st5].map((s) => s.prompt.system.length).reduce((a, b) => a + b, 0)} |
| 世界书词条 | ${[st2, st3, st4, st5].map((s) => s.wb.length).reduce((a, b) => a + b, 0)} |
| 任务段（含判定词表） | ${user1.length + user2.length + user3.length + user4.length + user5.length} |
| **合计** | **${st1.systemChars + user1.length + st2.systemChars + user2.length + st3.systemChars + user3.length + st4.systemChars + user4.length + st5.systemChars + user5.length}** |

## 5. 这份回放暴露的三个事实

1. **读题阶段的 user 比 system 还大**（6,344 vs 4,741）——因为判定词表（57 个考点 + 30 个元件）
   必须整张塞给模型让它挑。这是当前第二大的单项，比任何一张知识卡都大。
2. **动画阶段的 system 是最大的一屏**（12,848），近一半是命中的词条（5,990）+ 那份 85 行的范例。
3. **上一阶段的输出会**逐字**变成下一阶段的输入**（解题过程 → 答案/分步；解题+分步+答案 → 动画）。
   所以那一段文字写得含糊，会连锁污染后面三步 —— 这也是"答案抽取要逐条交代复现方式"的由来。
`;

writeFileSync(join(PROJECT_ROOT, '一次提问的全过程-临时.md'), body, 'utf8');
console.log('✓ 已写出 一次提问的全过程-临时.md');
console.log(`  五阶段 system 合计 ${[st1, st2, st3, st4, st5].map((s) => s.systemChars).reduce((a, b) => a + b, 0)} 字 · user 合计 ${user1.length + user2.length + user3.length + user4.length + user5.length} 字`);
