/**
 * 清洗与切分（§12 / §3.5 / §3.6）。
 *
 * 一句话分工：
 *   · `marker-split.mjs`  —— **主路径**：按 `/* @slot:KEY *​/ … /* @end *​/` 零猜测切分；
 *   · `regex-rules.mjs`   —— **兜底**：只做点状修补，且不许碰标记、不许有灾难性回溯；
 *   · `to-program.mjs`    —— 组装成 `AnimationProgram`，并给出**行偏移表**（诊断靠它）。
 */

export { splitSlots, formatSplitDiagnostics } from './marker-split.mjs';

export {
  ProgramBuildError,
  checkProgramShape,
  buildProgramFromText,
  mergeRepairOutput,
  buildLineOffsets,
  toSourceLine,
} from './to-program.mjs';

export {
  BUILTIN_RULES,
  MAX_CLEAN_INPUT_CHARS,
  applyRegexRules,
  assertNoMarkerPatches,
  assertSlotKeysIntact,
  detectCatastrophicPattern,
  listBuiltinRules,
} from './regex-rules.mjs';

/**
 * 第 6 期第 3 项：§12 的**锁定策略**与规则表编辑器。
 *
 * `policy.mjs` 是纯数据 + 纯函数（锁哪几条、为什么锁、用户表允不允许存在）；
 * `editor.mjs` 才碰磁盘（通过 `core/rules/` 的原子写与哈希校验改 `ai-rules/cleaning.json`）。
 * 分开的理由：策略要被**保存路径**（`core/rules/kinds.mjs`）和**运行时**（`regex-rules.mjs`）
 * 同时使用，不能有一处绕开它。
 */
export {
  CLEANING_POLICY,
  CLEANING_POLICY_VERSION,
  lockedRuleIds,
  isLockedRuleId,
  lockOf,
  assertPolicyIntegrity,
  lockedBuiltinRules,
  validateUserCleaningRules,
  effectiveCleaningTable,
} from './policy.mjs';

export {
  CLEANING_TABLE_FORMAT,
  CLEANING_TABLE_VERSION,
  WARN_RULE_COUNT,
  emptyCleaningTable,
  cleaningTableText,
  loadCleaningTable,
  addCleaningRule,
  updateCleaningRule,
  removeCleaningRule,
  setCleaningRuleEnabled,
  moveCleaningRule,
  resetCleaningTable,
  cleaningTableMeta,
} from './editor.mjs';
