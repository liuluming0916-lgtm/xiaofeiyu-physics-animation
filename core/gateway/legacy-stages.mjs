/**
 * 旧 `stageModels` 键的**读时迁移**（v1.1.9alpha）。
 *
 * 背景：`distill`（教辅蒸馏）已从产品与 `PIPELINE_STAGES` 里删除，但用户
 * `endpoints.json` 里可能还留着 `"distill": "default"`。若不处理，整份配置会因
 * `stageModels.unknown-stage` 校验失败，软件直接打不开。
 *
 * 口径：
 *   · **只丢弃已删除的阶段键**，不动其它字段；
 *   · 读时丢弃并在 `loadEndpointStore` 里给 warning；下一次保存会把磁盘上的旧键清掉；
 *   · 这里不读写文件（纯函数），因此 `endpoint-store` 与 `endpoint-config` 都能用。
 */

/** 已删除/改名的旧 stageModels 键 → 给用户看的理由 */
export const LEGACY_STAGE_MODELS = Object.freeze({
  distill: '教辅蒸馏功能已在 v1.1.9alpha 删除，这个阶段不再存在',
});

/**
 * 丢掉旧阶段键。
 *
 * @param {Record<string, string|null>|undefined|null} stageModels
 * @returns {{ stageModels: Record<string, string|null>, dropped: Array<{ stage: string, reason: string }> }}
 */
export function normalizeLegacyStageModels(stageModels) {
  const out = { ...(stageModels && typeof stageModels === 'object' ? stageModels : {}) };
  const dropped = [];
  for (const [stage, reason] of Object.entries(LEGACY_STAGE_MODELS)) {
    if (Object.prototype.hasOwnProperty.call(out, stage)) {
      delete out[stage];
      dropped.push({ stage, reason });
    }
  }
  return { stageModels: out, dropped };
}
