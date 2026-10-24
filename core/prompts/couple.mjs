/**
 * `couple`（步骤耦合）Prompt。
 *
 * 任务只有一个：看 analysis 的物理时间轴 + breakdown 的讲解步骤，
 * 给每一步标出它对应的动画时间区间。
 *
 * 它**不重写讲解**、不读题、不画图、不改 analysis。
 */

import { formatStepsForCouple } from '../couple/parse.mjs';

export const COUPLE_ROLE = [
  '你是一名高中物理教学编排助手：只负责把“讲解步骤”对齐到“动画时间轴”。',
  '· 你只输出步骤时间表，不改写讲解、不重算物理、不画图；',
  '· 时间是物理分析表已经定好的，你只负责把步骤挂到这些时间段上。',
].join('\n');

export const COUPLE_INSTRUCTION = [
  '现在执行【步骤耦合】阶段。',
  '',
  '你会拿到两样东西：',
  '① 物理分析表（每个元件的分段 t0/t1 与位置表达式）；',
  '② 讲解步骤（只有 title / tex，没有时间）。',
  '',
  '你的任务：给**需要时间**的步骤标出它在动画里的起止时间，并标出它属于**第几小问**。',
  '',
  '规则：',
  '1. 时间必须落在物理分析表的 `[0, T_phys]` 内；',
  '2. 一步可以跨多个物理段；也可以几个步骤共用一段（但不能重叠）；',
  '3. **纯概念步骤可以不写**（不写 = 点它不跳动画）；',
  '4. 按 step 升序；时间不能重叠；允许中间有空档；',
  '5. `sub` 是这一步回答的**小问编号**：题面有 (1)(2)(3) 就写 1/2/3；整题不分问就写 1；',
  '   跨两问的步骤写“它主要讲的那一问”；同一小问的步骤 `sub` 必须相同；',
  '6. 不要改 title / tex，不要新增步骤，不要解释。',
  '7. **条件变更 / 另一情形**的步骤必须写时间：如果题目里有“若… / 再加… / 改变条件 / 另一种情况”，',
  '   它对应 `branch: true` 的分支段（例如 q08 第 3 问），不能因为“没有新公式”就当纯概念步骤省掉。',
  '   分支前的主过程步骤到 `T_BRANCH` 为止；分支后的步骤从 `T_BRANCH` 开始；两组时间不能重叠。',
  '',
  '输出格式（行式表，记录之间空一行）：',
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
  '只输出这张表。',
].join('\n');

/**
 * @param {{
 *   problem?: string,
 *   analysisText?: string,
 *   steps?: Array<{title?: string, tex?: string}>,
 *   tPhys?: number,
 *   feedback?: string[],
 * }} input
 */
export function buildCoupleUser({ problem, analysisText, steps = [], tPhys, feedback = [] } = {}) {
  return [
    '【题目（只用于理解步骤在讲什么，不要重新解题）】',
    problem ?? '',
    '',
    '【物理分析表（时间的唯一来源）】',
    String(analysisText ?? '').trim(),
    '',
    `【T_phys】${tPhys ?? '（缺失）'} 秒`,
    '',
    '【讲解步骤（只给标题与讲解，不含时间）】',
    formatStepsForCouple(steps),
    '',
    ...(Array.isArray(feedback) && feedback.length
      ? ['【上一次输出不合法，请只修正时间表】', ...feedback.map((p) => `· ${p}`), '']
      : []),
    '只输出 step / t0 / t1 的行式表。',
  ].join('\n');
}

export const COUPLE_PROMPT = Object.freeze({
  id: 'couple',
  label: '步骤耦合',
  duty: '把讲解步骤对齐到 analysis 的动画时间轴（只输出 step/t0/t1）',
  system: COUPLE_INSTRUCTION,
  buildUser: buildCoupleUser,
});
