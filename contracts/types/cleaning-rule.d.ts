/* eslint-disable */
// ⚠ 本文件由 contracts/generate-contracts.mjs 自动生成，请勿手改。
// 来源：contracts/spec/contract-fields.mjs（与 JSON Schema 同源）。
// 契约 id：cleaning-rule · 依据：物理解题动画软件 v1.0 自研方案
/**
 * §12 stage 枚举（有模型文本产出的阶段）
 */
export type CleaningStage = "read_problem" | "solve" | "breakdown" | "analysis" | "scene_code" | "couple" | "knowledgecard";

/**
 * 清洗规则（§12 条目字段）
 * §12 正则兜底规则。按列表从上到下执行；正则在隔离环境运行 + 超时；非法正则即时报错且不落盘。正则合法性无法在 JSON Schema 层表达，由运行时校验。
 */
export interface CleaningRule {
  "id": string;
  "name": string;
  "stage": CleaningStage;
  /**
   * 正则源文本；保存时用 new RegExp(pattern, flags) 试编译
   * @minLength 1
   */
  "pattern": string;
  /**
   * 正则 flags，允许 gimsuy 的子集
   */
  "flags": string;
  "replacement": string;
  "enabled": boolean;
}
