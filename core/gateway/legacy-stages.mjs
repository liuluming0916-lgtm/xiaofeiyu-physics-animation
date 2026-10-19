/**
 * 旧 `stageModels` 键的**读时迁移**（v1.1.9alpha）。
 *
 * 两类：
 *   · `distill`：功能删除，**丢弃**；
 *   · `worldbook`：阶段改名为 `knowledgecard`，**改名保留值**。
 *
 * 口径：
 *   · 只动这些已知旧键，其它字段原样保留；
 *   · 读时迁移并在 `loadEndpointStore` 里给 warning；下一次保存把磁盘旧键清掉；
 *   · 纯函数，无 IO，`endpoint-store` 与 `endpoint-config` 共用。
 */

/** 已删除/改名的旧 stageModels 键 → 迁移动作 */
export const LEGACY_STAGE_MODELS = Object.freeze({
  distill: { action: 'drop', reason: '教辅蒸馏功能已在 v1.1.9alpha 删除，这个阶段不再存在' },
  worldbook: { action: 'rename', to: 'knowledgecard', reason: '世界书已改名为知识卡（knowledgecard）' },
});

/**
 * 迁移旧阶段键。
 *
 * @param {Record<string, string|null>|undefined|null} stageModels
 * @returns {{
 *   stageModels: Record<string, string|null>,
 *   dropped: Array<{ stage: string, action: 'drop'|'rename', to?: string, reason: string }>
 * }}
 */
export function normalizeLegacyStageModels(stageModels) {
  const out = { ...(stageModels && typeof stageModels === 'object' ? stageModels : {}) };
  const dropped = [];
  for (const [stage, spec] of Object.entries(LEGACY_STAGE_MODELS)) {
    if (!Object.prototype.hasOwnProperty.call(out, stage)) continue;
    const value = out[stage];
    delete out[stage];
    if (spec.action === 'rename') {
      // 新键已有值时以新键为准（不覆盖用户已经写好的新配置）
      if (!Object.prototype.hasOwnProperty.call(out, spec.to)) out[spec.to] = value;
      dropped.push({ stage, action: 'rename', to: spec.to, reason: spec.reason });
    } else {
      dropped.push({ stage, action: 'drop', reason: spec.reason });
    }
  }
  return { stageModels: out, dropped };
}
