/* eslint-disable */
// ⚠ 本文件由 contracts/generate-contracts.mjs 自动生成，请勿手改。
// 来源：contracts/spec/contract-fields.mjs（与 JSON Schema 同源）。
// 契约 id：worldbook-pack · 依据：物理解题动画软件 v1.0 自研方案
/**
 * 世界书导出包（§9.5 导入导出）
 * §9.5 的 `.json` 交换格式（format:"od-worldbook", version:1）。包内词条的形状**引用** worldbook-entry 契约，不得另立一套字段；旧名归一化（scene_spec → scene_code、"both" → ["solve","scene_code"]）只发生在**导入路径**，导出与内部一律只写新名。
 */
export interface WorldbookPack {
  /**
   * §9.5 冻结格式标识
   */
  "format": "od-worldbook";
  /**
   * 不支持版本必须明确拒绝
   */
  "version": 1;
  /**
   * 实际导出的词条（导入时逐条按 §9.1 校验，整批生效或整批失败）
   */
  "entries": Array<WorldbookEntry>;
}
