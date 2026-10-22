/**
 * Prompt 系统（§10）。
 *
 * `fixed-prefix.mjs` —— §10.2 的三段注入：[固定前缀] + [条件段] + [任务段]。
 * `templates.mjs`   —— 主链路的 4 份 Prompt（analysis / scene_code / solve / breakdown）
 *                      + 扩展 Prompt（repair / read_problem）。
 */

export {
  assemblePrompt,
  buildConditionalSegment,
  buildFixedPrefix,
  /** 第 9 期：按阶段取前缀（只有写代码的阶段才带模板骨架与 SDK 摘要） */
  buildStagePrefix,
  PREFIX_STAGES,
  promptHashValue,
  buildTaskSegment,
  buildTemplateSkeleton,
  loadSignatureSummary,
} from './fixed-prefix.mjs';

export {
  PROMPTS,
  EXTENSION_PROMPTS,
  ROLE_AND_OUTPUT_RULES,
  getPrompt,
  listPrompts,
  listExtensionPrompts,
  /** 第 5.7 期：把判定词表（单源真相 = contracts/knowledgecard-concepts.json）渲染成注入 Prompt 的文本 */
  buildJudgementVocab,
} from './templates.mjs';

/**
 * `analysis`（物理分析）—— 新链路第 4 段，取代旧 `answers`。
 * 现在已进 `PROMPTS`（key=analysis），这里保留独立入口给自检/测试。
 */
export {
  ANALYSIS_PROMPT,
  ANALYSIS_ROLE,
  ANALYSIS_INSTRUCTION,
  buildAnalysisUser,
} from './analysis.mjs';

/** 步骤耦合：只输出 step/t0/t1 */
export {
  COUPLE_PROMPT,
  COUPLE_ROLE,
  COUPLE_INSTRUCTION,
  buildCoupleUser,
} from './couple.mjs';

/**
 * 第 6 期第 2 项：覆盖层与编辑器。
 *
 * `overlay.mjs` 是**纯函数**（硬约束 / 代际状态 / 行级差异），`editor.mjs` 才碰磁盘
 * （它通过 `core/rules/` 的原子写与哈希校验去改 `ai-rules/prompts/*.md`）。
 * 分开的理由：硬约束要被保存路径、界面、CLI 三处共用，不能有一处逃过它。
 */
export {
  PROMPT_REQUIREMENTS,
  PROMPT_STATUS,
  inspectPromptOverride,
  promptStatus,
  diffLines,
  diffSummary,
  MIN_OVERRIDE_CHARS,
} from './overlay.mjs';

export {
  PROMPT_SECTORS,
  builtinPromptText,
  editablePromptIds,
  listPromptCatalog,
  openPrompt,
  savePromptOverride,
  resetPromptOverride,
  rebasePromptOverride,
} from './editor.mjs';
