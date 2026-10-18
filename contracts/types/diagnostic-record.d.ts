/* eslint-disable */
// ⚠ 本文件由 contracts/generate-contracts.mjs 自动生成，请勿手改。
// 来源：contracts/spec/contract-fields.mjs（与 JSON Schema 同源）。
// 契约 id：diagnostic-record · 依据：物理解题动画软件 v1.0 自研方案
/**
 * 三档证据强度（顺序即"可信度从高到低"，不得重排）
 * exact=埋点直记 · replayed=快照重放推导 · candidate=静态候选（须先读上下文）
 */
export type Precision = "exact" | "replayed" | "candidate";

/**
 * §7.2 冻结检查号（C1–C9）；扩展检查 X1/X2/C10 见报告 extensions[]
 */
export type CheckId = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8" | "C9";

/**
 * 上下文行（前后各一行）
 */
export interface ContextLine {
  "line": number;
  "text": string;
  /**
   * 该行是否为诊断指向的那一行
   */
  "isTarget"?: boolean;
}

/**
 * 诊断条目（§6.2 / §7.5 · 含三档证据强度）
 * 校验报告与自愈回灌共用的诊断条目。`precision` 是**三档证据强度**（第 4 期写入契约）：exact（埋点直记）/ replayed（快照重放推导）/ candidate（静态候选）。回灌给模型时**必须**带上强度，否则模型会照着"候选行"改代码。本契约不新增判据、不改 §7.2 的 C1–C9。
 */
export interface Diagnostic {
  "check": CheckId;
  /**
   * 规则名（机器可读，如 unknown-global / boundary-jump）
   * @minLength 1
   */
  "rule": string;
  /**
   * 槽位名（§3.2 冻结键名之一，或数据型槽位）；空槽位级的诊断也必须有槽位名
   * @minLength 1
   */
  "slot": string;
  /**
   * 槽位内 1-based 行号；无法定位时为 null（**不得**假装精确）
   */
  "line": number | null;
  /**
   * 列号；acorn 后端给得出，其他手段可能为 null
   */
  "column"?: number | null;
  /**
   * 面向模型可读的说明（不含 stack trace、不含绝对路径）
   * @minLength 1
   */
  "message": string;
  "precision": Precision;
  "context"?: Array<ContextLine>;
}
