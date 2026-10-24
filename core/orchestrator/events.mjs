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
/**
 * 阶段顺序（2026-10-24 调序：`couple` 挪到 `scene_code` **之前**）。
 *
 * 为什么：画图要按"第几步、这一步对应哪段时间"来画。`couple` 本来只吃
 * `analysis` + `breakdown`，这两样在 `scene_code` 之前就齐了；挪过去不增加模型调用，
 * 只是把"步骤时间表"从**交付前的收尾**变成**画图的输入**。
 *
 * 顺带解决了两个老问题：
 *   · `scene_code` 之前拿不到步骤边界，只能在 drawFrame 里按 `t` 硬编码猜；
 *   · 时间表不合法时要等到最后才发现，画已经画完了。
 */
export const PHASE5_STAGES = Object.freeze(['read_problem', 'solve', 'breakdown', 'analysis', 'couple', 'scene_code', 'dry_run', 'repair']);

/**
 * **需要调用模型的阶段**（= 执行链去掉两个本地阶段）。
 *
 * 2026-10-24：`couple` 也是模型阶段（每道题都跑），所以它在 `MODEL_STAGES` 里；
 * 但它由 `runCoupleStage()` 在 `scene_code` 之前单独驱动，**不在主循环的 `promptIds` 里**。
 * 主循环要跑哪些阶段用 `PROMPT_STAGES`。
 */
export const MODEL_STAGES = Object.freeze(PHASE5_STAGES.filter((s) => s !== 'dry_run' && s !== 'repair'));

/**
 * **主循环实际逐段执行的阶段**（5 个）：`couple` 由单独函数驱动，所以不在里面。
 * `snapshotConfig()` 的默认 `promptIds` 取的是它。
 */
export const PROMPT_STAGES = Object.freeze(MODEL_STAGES.filter((s) => s !== 'couple'));

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
  /**
   * v1.1.16（拆图）：读题给了【示意图范围】之后，程序有没有真裁出图。
   * 留痕的理由：裁图失败（JPEG / 框歪）与"模型没给框"在界面上长得一样，
   * 而两者的修法不同（前者换格式，后者调 Prompt）。
   */
  'diagram_done', // { ok, reason?, bbox?, width?, height?, fallbackWhole? }
  'coupling_done', // { stepTimes, fallback, warning, attempts }
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
