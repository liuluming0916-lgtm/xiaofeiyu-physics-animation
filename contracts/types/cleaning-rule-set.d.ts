/* eslint-disable */
// ⚠ 本文件由 contracts/generate-contracts.mjs 自动生成，请勿手改。
// 来源：contracts/spec/contract-fields.mjs（与 JSON Schema 同源）。
// 契约 id：cleaning-rule-set · 依据：物理解题动画软件 v1.0 自研方案
/**
 * 清洗规则表（§12 / §16）
 * 按列表从上到下执行；内置规则保留必需的最小集（剥代码围栏 + 去首尾空白）。
 */
export interface CleaningRuleSet {
  "format": "od-cleaning-rules";
  "version": 1;
  "rules": Array<CleaningRule>;
}
