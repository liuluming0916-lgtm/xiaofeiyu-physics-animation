/**
 * 三档证据强度的**运行时入口**（第 4 期）。
 *
 * 为什么不让 core/ 直接 import `contracts/spec/diagnostic.mjs`：
 *   `contracts/*.schema.json`、`contracts/types/*.d.ts` 与 `contracts/diagnostic-evidence.json`
 *   三份产物都从 `spec/diagnostic.mjs` 生成，**规格文件是生成器的输入**；
 *   运行时应该只依赖"已生成的契约"，而不是直接依赖生成器的输入。
 *   这里做一次显式转发，规格改了、产物会跟着变，运行时读到的仍是同一份口径。
 *
 * ⚠ 单一事实来源仍是 `contracts/spec/diagnostic.mjs`（见 `contracts/diagnostic-evidence.json`
 *   的 `sourceOfTruth` 字段）。本文件**不定义**任何枚举值，只转发。
 */

import {
  EVIDENCE_PRECISIONS,
  PRECISION_LABELS,
  PRECISION_GUIDANCE,
} from './spec/diagnostic.mjs';

/** 三档证据强度（顺序即"可信度从高到低"） */
export const PRECISIONS = EVIDENCE_PRECISIONS;

/** 中文标签（UI 与报告渲染） */
export const LABELS = PRECISION_LABELS;

/** 回灌给模型时**必须**附上的强度说明（§14.5 风险 3 的对策） */
export const GUIDANCE = PRECISION_GUIDANCE;

/**
 * 取一档的展示文案；未知值**如实标注为未知**而不是悄悄当成 `exact`。
 *
 * ⚠ 这一条是有意的严格：第 2 期的报告里 `precision` 缺失时，
 *   下游（`build-overview.mjs` / `run-injection.mjs`）用 `?? 'exact'` 兜底过，
 *   那会让"没标注强度"看起来像"精确"。回灌路径不能这么办 ——
 *   路径是给模型的，宁可说"未知"，也不能让它以为是精确行号。
 */
export function labelOf(precision) {
  return LABELS[precision] ?? '未知强度';
}

export function guidanceOf(precision) {
  return GUIDANCE[precision] ?? '未能判定该行号的可靠程度，请先通读整个槽位再修改。';
}

/** 是不是一档合法的证据强度 */
export function isPrecision(value) {
  return PRECISIONS.includes(value);
}

/**
 * 按可信度排序（`exact` 在前）：诊断回灌、报告渲染都按这个顺序呈现，
 * 让"最可信的证据"先被模型/用户看到。
 */
export function rankOf(precision) {
  const i = PRECISIONS.indexOf(precision);
  return i === -1 ? PRECISIONS.length : i;
}

/** 排序比较器：可信度高的排前面 */
export function comparePrecision(a, b) {
  return rankOf(a?.precision) - rankOf(b?.precision);
}
