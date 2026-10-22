/* eslint-disable */
// ⚠ 本文件由 contracts/generate-contracts.mjs 自动生成，请勿手改。
// 来源：contracts/spec/contract-fields.mjs（与 JSON Schema 同源）。
// 契约 id：endpoint · 依据：物理解题动画软件 v1.0 自研方案
/**
 * §2.3 主链路阶段枚举（stageModels 的键）
 */
export type PipelineStage = "read_problem" | "solve" | "breakdown" | "analysis" | "scene_code" | "dry_run" | "repair" | "couple" | "knowledgecard";

/**
 * 端点
 */
export interface Endpoint {
  /**
   * 只能字母/数字/点/下划线/连字符
   * @minLength 1 @pattern ^[A-Za-z0-9._-]+$
   */
  "id": string;
  "displayName": string;
  /**
   * 必须 HTTPS；http://127.0.0.1 与 http://localhost 例外（本地推理）
   * @minLength 1
   */
  "baseURL": string;
  "defaultModel": string;
  /**
   * 可选；留空则用 defaultModel 做视觉请求
   */
  "visionModel"?: string;
  "apiKeyModelId": string | null;
  "supportsJsonMode": boolean;
  "supportsVision": boolean;
  "enableThinking": boolean;
  "preserveThinking": boolean;
  "timeoutMs": number;
}

/**
 * 端点与分阶段模型配置（§11.1）
 * §11.1 字段 + §11.2 校验规则的可表达部分。HTTPS/无凭据/无查询参数/无片段/id 合法且不重复/≤300 项/apiKeyModelId 必须指向已存在端点且不得成环/stageModels 引用必须存在——这些是跨字段约束，JSON Schema 层只表达字段形状；跨字段部分由 contracts/validate.mjs 的 validateEndpointConfig 实现（第 3 期第 1 步补齐；逐条取证见 tests/contract-validator-selftest.mjs）。
 */
export interface EndpointConfig {
  "endpoints": Array<Endpoint>;
  /**
   * 阶段 → 端点 id；未配置的阶段为 null
   */
  "stageModels": Record<string, string | null>;
  /**
   * 端点 id → 明文 Key（本机配置文件；永不写入日志/导出包/复现包）
   */
  "keys": Record<string, string>;
  /**
   * §11.2 扩展位：keys 预留 encrypted:true 分支（本期不实现，字段形状先冻结）
   * @default false
   */
  "keysEncrypted"?: boolean;
  /**
   * 导入时校验版本，不支持版本明确拒绝
   */
  "configVersion"?: 1;
}
