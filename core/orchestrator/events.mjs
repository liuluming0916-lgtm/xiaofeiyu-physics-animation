/**
 * SSE 事件定义（§2.3 / M3）。
 *
 * 为什么要单独一个文件：事件名是**前后端之间的接口**，而 §2.3 明确要求
 * "阶段枚举（清洗与 SSE 共用，定案）"—— 事件里的 `stage` 必须逐字取自
 * `PIPELINE_STAGES`，不能各自拼字符串。
 *
 * ⚠ 阶段枚举**含 `repair`**（第 4 期实现）。因此事件模型里它是合法阶段值，
 *   前端不要写死"最后一个阶段是 dry_run"（那会在第 4 期返工）。
 */

import { PIPELINE_STAGES } from '../../contracts/spec/frozen-keys.mjs';

/**
 * **当前**执行链（第 5 期追加第 0 步；**第 5.7 期改名为 `read_problem`**）。
 *
 * ⚠ `read_problem` 在**最前面**（它是"第 0 步"）：第 5 期引入时叫 `read_image`（读图转写），
 *   第 5.7 期按用户裁决改名为 `read_problem`（**读题与判定**）：
 *   除了转写，还要判出【考点】【题型】【动画元件】，作为世界书两侧分发的触发源。
 *   **它现在总是跑**（含纯文字题）—— 考点不可能写在题面里，必须由模型判。
 *   `repair`"只在 Dry-Run 未通过时才真正执行"仍是另一回事：链条按完整形态排布，
 *   进度模型不写死任何一步是否一定执行（`skipped` 机制保留，通用）。
 */
/**
 * ⚠ **第 9 期调序**（用户裁决）：`answers` 与 `steps` 换了位置 —— **先切 STEPS，再抽 ANSWERS**。
 *
 * 为什么必须换：`ANSWERS` 每条都带 `at_t` 与 `step`，而这两个字段只有在**时间轴已经定下来**时
 * 才填得对。旧顺序（answers → steps）下，模型是在**看不到 STEPS 的情况下盲填**这两个字段，
 * 再让 STEPS 去凑它 —— C5（步骤与时长一致）与 C7（答案在 at_t 复现）会稳定地在这里打回。
 * 这不是"容易错"，是**结构上必然错**：要求模型满足一个它看不见的约束。
 *
 * 换成 steps → answers 之后，`answers` 的输入里直接带着 STEPS 行式表，
 * 符号、步序、时间锚点在同一次上下文里天然对齐。
 */
export const PHASE5_STAGES = Object.freeze(['read_problem', 'solve', 'steps', 'answers', 'scene_code', 'dry_run', 'repair']);

/**
 * **需要调用模型、且要跑 Prompt 的阶段**（= 执行链去掉本地阶段）。
 *
 * `dry_run` 是本地沙箱（不调模型）；`repair` 由自愈循环单独驱动（不在这个列表里，
 * 因为它不是"每道题都跑一遍"的阶段，而是"未通过才跑"的循环）。
 *
 * ⚠ `snapshotConfig()` 的默认 `promptIds` 取的就是它 —— 改了这里就等于改了默认要跑哪些阶段。
 */
export const MODEL_STAGES = Object.freeze(PHASE5_STAGES.filter((s) => s !== 'dry_run' && s !== 'repair'));

/**
 * 第 4 期的执行链（**留档**）：不含第 0 步（那时它叫 read_image，还没引入）。
 *
 * ⚠ 保留它只是为了"第 4 期的口径可查"。**新代码一律用 `PHASE5_STAGES`**。
 */
export const PHASE4_STAGES = Object.freeze(['solve', 'answers', 'steps', 'scene_code', 'dry_run', 'repair']);

/**
 * 第 3 期的阶段链（**留档**）：不含 `repair`，也不含第 0 步（那时还没有它）。
 */
export const PHASE3_STAGES = Object.freeze(['solve', 'answers', 'steps', 'scene_code', 'dry_run']);

/** 事件类型（宿主与服务端共用；前端有一份同源 TS 类型，见 web/src/lib/sse.ts） */
export const EVENT_TYPES = Object.freeze([
  'run_start', // { entry, model, promptHash, stages }
  'stage_start', // { stage, index, total }
  'stage_delta', // { stage, text }        流式增量（解题过程逐字上屏）
  'stage_done', // { stage, chars, ms, skipped?, reason? }   skipped 机制保留（通用）；read_problem 现在总是跑
  'dryrun_done', // { verdict, cancelled, checks[], extensions[], diagnostics[] }
  'stage_error', // { stage, error: { kind, message, hint } }
  /**
   * 第 5.7 期（两侧分发）：**模型判了什么**必须留痕（计划 §5 S4 第 4 项）。
   *
   * 没有这条，"判定错了"与"词条配错了"在 UI 上长得一模一样 ——
   * 而这两者的修法完全不同（前者调 Prompt/词表，后者改词条）。
   */
  'judgement_done', // { stage, concepts[], tags[], elements[], unknowns{}, problems[], why, empty }
  // 第 4 期（M30 自愈循环）：修复过程**对用户可见**（§14.2 的 B6）
  'repair_round', // { round, maxRounds, slots, updated, kept, failingChecks, verdict, diagnostics[] }
  'repair_done', // { rounds, verdict, converged, banner }
  // 第 5 期（世界书）：本次解题实际命中了哪些词条、进了哪个槽、有没有空槽/截断（§9.2 第 6 步 / §15）
  'knowledgecard_done', // { hash, entries[], emptySlots[], truncatedSlots[], warnings[], charsBySlot, injectedBySlot }
  // 第 5 期追加（读题与判定）：**纯图片题**在开跑时没有标题可显示，转写出来后回填一次
  'run_label', // { entry, source }
  'run_done', // { verdict, ms, cancelled, banner }
  'cancelled', // { stage }
]);

/** 判定枚举（与 dry-run 报告的 verdict 对齐） */
export const VERDICTS = Object.freeze(['pass', 'pass-with-warnings', 'fail', 'cancelled', 'error']);

/**
 * 造一个事件对象。带**单调递增序号**：SSE 只保证顺序、不保证不丢，
 * 序号让客户端能发现缺口（§13.2 的 state 消息也用得到）。
 */
export function makeEvent(type, payload = {}, seq) {
  if (!EVENT_TYPES.includes(type)) {
    throw new Error(`未知事件类型 "${type}"；可用：${EVENT_TYPES.join(' / ')}`);
  }
  return { seq, type, at: new Date().toISOString(), ...payload };
}

/** 阶段索引（用于进度条；未知阶段返回 -1 而不是抛错，避免把 UI 打崩） */
export function stageIndexOf(stage, stages = PHASE5_STAGES) {
  return stages.indexOf(stage);
}

/** 校验一个阶段名是否是合法的主链路阶段（§2.3 冻结枚举） */
export function isValidStage(stage) {
  return PIPELINE_STAGES.includes(stage);
}

/**
 * 事件 → SSE 帧（`text/event-stream` 的线上格式）。
 *
 * 一次事件发两行：`event:` 带类型、`data:` 带 JSON。
 * `id:` 带上序号，浏览器断线重连时会用 `Last-Event-ID` 带回来。
 */
export function toSseFrame(event) {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** 只保留可在网络上传输的字段（**绝不把 Key / 原始请求体发出去**） */
export function toPublicEvent(event) {
  const { seq, type, at, ...rest } = event;
  return { seq, type, at, ...rest };
}
