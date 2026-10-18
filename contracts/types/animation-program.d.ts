/* eslint-disable */
// ⚠ 本文件由 contracts/generate-contracts.mjs 自动生成，请勿手改。
// 来源：contracts/spec/contract-fields.mjs（与 JSON Schema 同源）。
// 契约 id：animation-program · 依据：物理解题动画软件 v1.0 自研方案
/**
 * Provenance（必须烧录进导出 HTML）
 */
export interface Provenance {
  /**
   * 生成模型标识，未接模型时可写 "handwritten"
   * @minLength 1
   */
  "model": string;
  /**
   * Prompt 集合哈希（本期手写题为 "handwritten"
   * @minLength 1
   */
  "promptHash": string;
  /**
   * 世界书集合哈希（本期为 "handwritten"
   * @minLength 1
   */
  "worldbookHash": string;
  /**
   * ISO 8601 时间戳
   * @minLength 1
   */
  "generatedAt": string;
  "sdkVersion"?: string;
  "templateVersion"?: string;
}

/** §3.2 冻结键序（8 个，大小写敏感）。顺序即 required 顺序，不得调换。 */
export type SlotKeyName = "PROBLEM" | "STEPS" | "ANSWERS" | "VIEW" | "setup" | "stateAt" | "drawFrame" | "readouts";

/** §3.6 slots：恰好 8 个键，缺一不可（用映射类型把"缺键"变成编译错误）。 */
export type AnimationSlots = { [K in SlotKeyName]: string };

/**
 * AnimationProgram（唯一事实来源）
 * §3.6 AnimationProgram。slots 恰好含 §3.2 的 8 个冻结键名，缺一不可；键名大小写敏感；required 覆盖全部 8 项且顺序即冻结键序。
 */
export interface AnimationProgram {
  "format": "od-animation-program";
  "version": 1;
  /**
   * 模板版本，Provenance 口径之一
   * @minLength 1
   */
  "templateVersion": string;
  "sdkVersion": string;
  /**
   * §3.2 冻结键序（8 个，大小写敏感）
   */
  "slots": { "PROBLEM": string; "STEPS": string; "ANSWERS": string; "VIEW": string; "setup": string; "stateAt": string; "drawFrame": string; "readouts": string };
  "provenance"?: Provenance;
}

/** 与非空字符串约束配套的运行时守卫常量（供 Schema 之外的运行时使用）。 */
export declare const SLOT_KEY_NAMES: readonly SlotKeyName[];
