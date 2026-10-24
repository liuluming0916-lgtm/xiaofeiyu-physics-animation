/**
 * 编排层（§2.3 / M3）。
 *
 * `events.mjs`   —— SSE 事件定义（事件名是前后端接口；阶段名逐字取自 `PIPELINE_STAGES`）。
 * `pipeline.mjs` —— 阶段链、配置快照、取消语义、事件流。
 */

export {
  PHASE3_STAGES,
  PHASE4_STAGES,
  PHASE5_STAGES,
  MODEL_STAGES,
  PROMPT_STAGES,
  EVENT_TYPES,
  VERDICTS,
  makeEvent,
  stageIndexOf,
  isValidStage,
  toSseFrame,
  toPublicEvent,
} from './events.mjs';

export { runPipeline, collectEvents, snapshotConfig, deriveTimeAxis, deriveEntryLabel } from './pipeline.mjs';
