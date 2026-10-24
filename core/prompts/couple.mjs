/**
 * `couple`（步骤耦合）Prompt。
 *
 * 任务只有一个：看 analysis 的物理时间轴 + 读题的【小问切分】 + breakdown 的讲解步骤，
 * 给每一步标出它对应的动画时间区间和 `sub`。
 *
 * 它**不重写讲解**、不读题、不画图、不改 analysis。
 */

import { formatStepsForCouple } from '../couple/parse.mjs';

export const COUPLE_ROLE = [
  '你是一名高中物理教学助手：只负责把“讲解步骤”对齐到“动画时间轴”，并标出每一步属于哪一问。',
  '· 你只输出步骤时间表，不改写讲解、不重算物理、不画图；',
  '· 时间是物理分析表已经定好的，你只负责把步骤挂到这些时间段上；',
  '· 小问编号来自读题的【小问切分】，不要自己重新数题号。',
].join('\n');

export const COUPLE_INSTRUCTION = [
  '现在执行【步骤耦合】阶段。',
  '',
  '你会拿到四样东西：',
  '① 物理分析表（每个元件的分段 t0/t1 与位置表达式）；',
  '② 读题的【小问切分】（按初始条件分组，组里写了覆盖哪些小问）；',
  '③ 分支时刻（没有分支就写“无”；有多个按顺序列出）；',
  '④ 讲解步骤（只有 title / tex，没有时间）。',
  '',
  '你的任务：给需要时间的步骤标出它在动画里的起止时间，并标出它属于哪一问。',
  '',
  '规则：',
  '0. **同一个连续过程要保持完整**：如果几个步骤只是从不同角度讲同一段运动（如选择题的 A/B/C/D，初始条件不变），不要把它们拆成几段先后时间；按纯概念步骤处理（不写时间），让动画保持一条连续过程。',
  '1. 时间必须落在物理分析表的 [0, T_phys] 内；',
  '2. 一步可以跨多个物理段；也可以几个步骤共用一段，但不能重叠；',
  '3. 纯概念步骤可以不写（不写 = 点它不跳动画）；但“条件变更 / 另一情形”的步骤必须写时间；',
  '4. 按 step 升序；时间不能重叠；允许中间有空档；',
  '5. `sub` 是这一步回答的小问编号，以读题【小问切分】的“覆盖小问”为准：',
  '   · 一组覆盖多个小问时，写这一步主要讲的那一问，不要新造编号；',
  '   · 一组覆盖 1–10 时，也是这样选，不要因为组大就全写 1；',
  '   · 条件变更的步骤写它所在分支组覆盖的小问；',
  '   · 整题没有分问时写 1；',
  '   · 如果【小问切分】缺失，按 title/tex 判断，整题写 1；',
  '6. 不要改 title / tex，不要新增步骤，不要解释；',
  '7. 分支处理：',
  '   · 以 user 里的【分支时刻】为准，不要写 `T_BRANCH` 或 `T_BRANCH_1`；',
  '   · 分支前的主过程步骤：`t1` 不能晚于分支时刻；',
  '   · 分支后的步骤：`t0` 不能早于分支时刻；',
  '   · 两组时间不能重叠；',
  '',
  '8. 只输出下面这种行式表，记录之间空一行：',
  '',
  'step: 1',
  'sub: 1',
  't0: 0',
  't1: 0.6',
  '',
  'step: 2',
  'sub: 1',
  't0: 0.6',
  't1: 1.7',
  '',
  'step: 3',
  'sub: 2',
  't0: 1.7',
  't1: 3.0',
  '',
  '只输出 step / sub / t0 / t1 的行式表。',
].join('\n');

/**
 * 从 read_problem 全文里取【小问切分】段。
 * 读题终稿的输出形如：
 *   【小问切分】2
 *   组1：覆盖小问 1、2；初始条件：不变；
 *   组2：覆盖小问 3；初始条件：在 b 点改变；
 */
export function extractSubQuestions(readProblem) {
  const text = String(readProblem ?? '').trim();
  const m = /【小问切分】([\s\S]*?)(?=\n【|$)/.exec(text);
  if (!m) return '（缺失）';
  return m[1].trim() || '（缺失）';
}

/**
 * @param {{
 *   problem?: string,
 *   analysisText?: string,
 *   readProblem?: string,
 *   branchTimes?: number[],
 *   steps?: Array<{title?: string, tex?: string}>,
 *   tPhys?: number,
 *   feedback?: string[],
 * }} input
 */
export function buildCoupleUser({
  problem,
  analysisText,
  readProblem,
  branchTimes = [],
  steps = [],
  tPhys,
  feedback = [],
} = {}) {
  const branchText = (Array.isArray(branchTimes) ? branchTimes : [])
    .filter((v) => Number.isFinite(v))
    .map((v) => String(Math.round(v * 1e6) / 1e6))
    .join(', ');
  return [
    '【题目（只用于理解步骤在讲什么，不要重新解题）】',
    problem ?? '',
    '',
    '【读题的小问切分（按初始条件分组；sub 以此为准）】',
    extractSubQuestions(readProblem),
    '',
    '【物理分析表（时间的唯一来源）】',
    String(analysisText ?? '').trim(),
    '',
    `【T_phys】${tPhys ?? '（缺失）'} 秒`,
    '',
    '【分支时刻（没有就写“无”；有多个按顺序逗号分隔）】',
    branchText || '无',
    '',
    '【讲解步骤（只给标题与讲解，不含时间）】',
    formatStepsForCouple(steps),
    '',
    ...(Array.isArray(feedback) && feedback.length
      ? ['【上一次输出不合法，请只修正时间表】', ...feedback.map((p) => `· ${p}`), '']
      : []),
    '只输出 step / sub / t0 / t1 的行式表。',
  ].join('\n');
}

export const COUPLE_PROMPT = Object.freeze({
  id: 'couple',
  label: '步骤耦合',
  duty: '把讲解步骤对齐到 analysis 的动画时间轴，并标出 sub（只输出 step/sub/t0/t1）',
  system: COUPLE_INSTRUCTION,
  buildUser: buildCoupleUser,
});
