/**
 * 自愈循环（M30 · §8）—— 第 4 期新增模块的公共入口。
 *
 * 分工：
 *   · `plan.mjs`   —— **决定**：重发哪些槽位、能否交付、回灌文本长什么样（纯函数，可逐条取证）
 *   · `index.mjs`  —— 入口聚合（本文件）
 *
 * **执行**在 `core/orchestrator/pipeline.mjs`：它按 `planRepair()` 的结论
 * 把回灌文本交给模型、清洗、再跑一次 Dry-Run，最多 `REPAIR_MAX_ROUNDS` 轮。
 */

export {
  REPAIR_MAX_ROUNDS,
  REPAIR_TABLE,
  CHECK_TO_SLOTS,
  CODE_SLOTS,
  DATA_SLOTS,
  VISUAL_CHECK_IDS,
  orderSlots,
  slotsFromReport,
  withEmptySlots,
  slotsFromChecks,
  planRepair,
  deliveryShape,
  buildBanner,
  renderDiagnostic,
  buildRepairTask,
  collectDiagnostics,
  /** 第 8 期 L4a：按诊断规则给出"这一类错误的正确写法"（只影响回灌文本，不改判定） */
  REPAIR_HINTS,
  hintsForDiagnostics,
  shouldContinue,
  roundBudget,
  involvesCodeSlots,
  repairModeOf,
} from './plan.mjs';

/** v1.1.5：纯符号 C7 的确定性快修（把答案符号原样加成读数，不调模型） */
export { planC7Alias, appendReadoutRows } from './c7-alias.mjs';
