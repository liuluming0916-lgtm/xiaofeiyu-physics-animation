/**
 * 前端的事件流接口（**唯一入口**）。
 *
 * ── 为什么要有这一层（诚实说明架构边界）
 *
 * 第 3 期的**真正链路**住在 `core/`（Node ESM）：网关、Prompt、切分、Dry-Run 沙箱。
 * 它是**后端代码** —— 读文件、用 `node:vm`、用 `worker_threads`，
 * **浏览器里跑不了**（这和第 1 期"成品页必须自包含、不能有 Node 依赖"是同一个约束）。
 *
 * 因此前端只能从**本机服务**拿事件流（方案 §2.1：Node 服务 + 浏览器，回环 `127.0.0.1:随机端口`）。
 * 但沙箱允许的工作方式限制了两件事：
 *   · 起 HTTP 服务 / 绑定端口不在当前沙箱许可内；
 *   · `pnpm run` 前的依赖检查会因管道限制而崩。
 * ⇒ **第 3 期把"服务端事件流"留到第 9 步**（那时再定它跑在服务里还是 Worker 里）。
 *
 * ── 本期前端怎么可测、可见
 *
 * 本文件定义两个实现，**共用同一个接口与同一个事件形状**（与
 * `core/orchestrator/events.mjs` 逐字段一致）：
 *
 *   1. `demoEventSource()` —— **演示源**：不调模型，用本地真题槽位走完整的前端流程。
 *      它的 `dryrun_done` 判定是 **`skipped`**，**绝不谎报 pass**
 *      （因为浏览器里没有校验内核，无法真的判 C1–C9）。
 *   2. `serverEventSource()` —— **服务端源**（SSE）：接口已就位，接上第 9 步的本地服务即可用。
 *
 * 这样做的价值：**前端的一切接线（三段渲染、阶段进度、事件流、iframe 注入、取消、门控禁用态）
 * 现在就能被真实驱动与肉眼验证**，而"判定"这件事仍然只由后端说 —— 不会被前端伪装。
 */

import { SLOT_KEYS, type AnimationSlots, type ProgramMode } from './host-protocol'
import { WORLDBOOK_DEMO_EVENT } from './worldbook-demo'

/** 与 `core/orchestrator/events.mjs` 一致的事件形状（前端只声明用到的字段） */
export type RunEvent =
  | { seq: number; type: 'run_start'; at: string; entry: string; stages: string[]; model: string | null; mode: string; imageCount: number; maxRepairRounds?: number; source: EventSourceKind }
  | { seq: number; type: 'stage_start'; at: string; stage: string; index: number; total: number; round?: number; maxRounds?: number; slots?: string[] }
  | { seq: number; type: 'stage_delta'; at: string; stage: string; text: string; round?: number; promptHash?: string; note?: string }
  | { seq: number; type: 'stage_done'; at: string; stage: string; chars: number; ms: number; chunks?: number; round?: number; merged?: boolean; updated?: string[]; skipped?: boolean; reason?: string; note?: string }
  | { seq: number; type: 'stage_error'; at: string; stage: string; round?: number; error: { kind: string; message: string; hint?: string; diagnostics?: Array<Record<string, unknown>> } }
  | {
      seq: number
      type: 'dryrun_done'
      at: string
      round?: number
      verdict: 'pass' | 'pass-with-warnings' | 'fail' | 'skipped'
      cancelled: boolean
      /**
       * `offenders` 是第 8 期补的"**现场**"：C6 的 { t, key, before, after, delta } 等。
       * 以前只发 message（"位置跳变"四个字），用户看不出"哪个量、什么时刻、跳了多少"。
       */
      checks: Array<{ id: string; status: string; blocking: boolean; message: string; offenders?: Array<Record<string, unknown>> }>
      /** 第 8 期：开发模式（不拦截）—— 校验照做，但结论不拦路 */
      advisory?: boolean
      gatesBypassed?: string[]
      extensions: Array<{ id: string; status: string; blocking: boolean; message: string }>
      diagnostics: Array<Record<string, unknown>>
      /** ⚠ 真实链路（`core/orchestrator`）发的字段名是 `program`；演示源历史上用的是 `programs`。两个都认。 */
      program?: { slots: AnimationSlots; mode: ProgramMode; templateVersion?: string | null; provenance?: ProgramProvenance | null }
      programs?: { slots: AnimationSlots; mode: ProgramMode }
      /**
       * 第 8 期（C2）：Dry-Run 顺手算出的「标注避让表」。
       * 宿主把它随 program 一起发给模板，模板交给播放器按表挪字 + 画引线。
       * 形状由 `core/dryrun/label-avoid.mjs` 决定，前端**只转发不解读**。
       */
      labelAvoid?: Record<string, unknown> | null
      note?: string
    }
  /** 第 4 期（M30）：每一轮自愈的诊断快照（B6 修复过程对用户可见） */
  | {
      seq: number
      type: 'repair_round'
      at: string
      round: number
      requested: string[]
      updated: string[]
      kept: string[]
      unchanged: string[]
      triggeringChecks: string[]
      diagnostics: RepairCheckSnapshot[]
      verdict: string
      ms: number
    }
  /** 第 4 期：自愈循环结束（含告警横幅） */
  | {
      seq: number
      type: 'repair_done'
      at: string
      rounds: number
      verdict: string
      converged: boolean
      banner: RepairBanner | null
      stoppedReason?: string | null
      reason?: string
      updates?: Array<{ round: number; updated: string[]; verdict: string }>
    }
  /** 第 5 期：本次解题实际命中了哪些词条、进了哪个槽、有没有空槽/截断（§9.2 第 6 步 / §15） */
  | {
      seq: number
      type: 'worldbook_done'
      at: string
      hash: string
      libraryCount: number
      matched: number
      entries: WorldbookProvenance[]
      /** ⚠ 空槽与"被截断"是**两个**字段（§9.2 的"重要边界"）：空槽静默，截断必须显性告警 */
      emptySlots: string[]
      truncatedSlots: Array<{ slot: string; dropped: number; droppedIds: string[] }>
      warnings: Array<{ code: string; entryId?: string; slot?: string; message: string }>
      charsBySlot: Record<string, number>
      injectedBySlot: Record<string, number>
      /**
       * 第 5.7 期：把"模型判了什么"与"世界书据此抽了什么"接在一起。
       * 没有这三样，"世界书依据"面板只能显示"抽到了哪几条"，答不了"为什么抽它"。
       */
      judgement?: { concepts: string[]; tags: string[]; elements: string[] }
      judgementUnknowns?: { concept: string[]; tag: string[]; element: string[] }
      judgementProblems?: Array<{ code: string; message?: string; word?: string; field?: string }>
      judgementEmpty?: boolean
    }
  /**
   * 第 5.7 期（两侧分发）：**第 0 步判了什么**单独一条事件。
   *
   * 为什么不塞进 `worldbook_done`：判定是"可复核的判定结果"，世界书是"据此抽到的词条"；
   * 两者的消费方不同（前者给"判定是否可信"面板，后者给"依据"面板），而且判定发生在世界书之前。
   */
  | {
      seq: number
      type: 'judgement_done'
      at: string
      stage: string
      concepts: string[]
      tags: string[]
      elements: string[]
      unknowns: { concept: string[]; tag: string[]; element: string[] }
      problems: Array<{ code: string; message?: string; word?: string; field?: string }>
      why: string
      /** 判定为空 ⇒ 本次触发退化为纯字面 keys（UI 要如实说出来） */
      empty: boolean
    }
  /** 纯图片题在开跑时没有标题，读题与判定跑完后回填一次 */
  | { seq: number; type: 'run_label'; at: string; entry: string; source?: string }
  | { seq: number; type: 'cancelled'; at: string; stage: string }
  | {
      seq: number
      type: 'run_done'
      at: string
      verdict: string
      ms: number
      cancelled?: boolean
      rounds?: number
      converged?: boolean
      banner?: RepairBanner | null
      delivery?: { playable: boolean; mode: string; missing: string[] }
    }

/** 世界书依据（第 5 期 · §9.2 第 6 步 / §15 的"世界书依据"面板） */
export interface WorldbookEvidence {
  /** 本次使用词条集合的稳定哈希（与 `provenance.worldbookHash` 同源） */
  hash: string
  /** 库里一共有多少条（与"这次命中了几条"是两件事） */
  libraryCount: number
  matched: number
  entries: WorldbookProvenance[]
  /** ⚠ 空槽与"被截断"是**两个**字段：空槽静默跳过，截断必须显性告警（§9.2 的"重要边界"） */
  emptySlots: string[]
  truncatedSlots: Array<{ slot: string; dropped: number; droppedIds: string[] }>
  warnings: Array<{ code: string; entryId?: string; slot?: string; message: string }>
  charsBySlot: Record<string, number>
  injectedBySlot: Record<string, number>
}

/** 一个词条的溯源记录（与 `core/worldbook/engine.mjs` 的第 6 步同形） */
export interface WorldbookProvenance {
  entry_id: string
  title: string
  /** 命中方式：key / secondary / constant / recursive */
  via: string
  /** 递归唤醒的来源词条 id（`via==='recursive'` 时有值） */
  from: string | null
  depth: number
  key: string | null
  origin: string
  category: string
  declaredSlots: string[]
  injectedSlots: string[]
  charsBySlot: Record<string, number>
  /** `insertion_slot` 为空 ⇒ 不参与注入，但必须有明确标记（§19.2） */
  unmounted: boolean
  /** 因三重预算被截断（与"空槽"是两回事） */
  truncated: boolean
}

/** 烧录进导出的生成溯源（§3.6 / §14：导出 HTML 必须能解释"它是用哪套规则生成的"） */
export interface ProgramProvenance {
  model: string
  /** 第 5 期起不再恒为 null（第 0 个阶段组装时就拿到了） */
  promptHash: string | null
  /** 第 5 期起不再写 'empty-phase3' 这个假值；空集合也算出一个真哈希 */
  worldbookHash: string
  generatedAt: string
  sdkVersion?: string
  templateVersion?: string
}

/** 一轮修复里某条失败检查的诊断快照（与 `core/orchestrator/pipeline.mjs` 的 `collectRoundDiagnostics` 同形） */export interface RepairCheckSnapshot {
  check: string
  status: string
  blocking: boolean
  message: string
  diagnostics: Array<{
    check: string
    slot?: string
    line?: number | null
    column?: number | null
    /** 三档证据强度（第 4 期写进契约）：exact / replayed / candidate */
    precision?: string | null
    rule?: string | null
    message: string
  }>
}

/**
 * 告警横幅（§21.2 第 8 条：**绝不静默交付**）。
 * 由 `core/repair/plan.mjs` 的 `buildBanner()` 生成，前端只负责**显著显示**它。
 */
export interface RepairBanner {
  level: 'warning'
  title: string
  message: string
  failedChecks: string[]
  rounds: number
  playable: boolean
  missing: string[]
}

/** 事件流的来源（UI 必须把它显示出来 —— 演示数据不能冒充真实结果） */
export type EventSourceKind = 'demo' | 'server'

export interface RunInput {
  problem: { text: string; description?: string; knownConditions?: string }
  images: Array<{ mime: string; dataUrl: string; name?: string }>
  mode: ProgramMode
  /**
   * 第 8 期：**开发模式（不拦截）**。
   * 勾上后 C1–C9 照做但不再拦住交付（也不跑自愈），程序直接流进动画页；
   * 报告里会留 `gatesBypassed`，界面上必须有显著提示。
   */
  devMode?: boolean
  /** 演示源用的真题（id 对应 `tests/regression-15/`） */
  demoQuestionId?: string
}

export interface RunHandle {
  source: EventSourceKind
  events: AsyncIterable<RunEvent>
  cancel: () => void
}

/**
 * 三档证据强度的中文标签（**与契约同源**）。
 *
 * 来源：`contracts/diagnostic-evidence.json`（由 `contracts/spec/diagnostic.mjs` 生成）。
 * 前端不直接读那份 JSON（它在 Node 侧的 contracts 目录里，浏览器里拿不到），
 * 因此这里是一份**抄录**——由 `tools/web-build.mjs` 的产物体检断言它与契约一致，
 * 抄错会让构建失败，而不是让 UI 悄悄显示错的强度。
 */
export const PRECISION_LABEL: Record<string, string> = {
  exact: '精确',
  replayed: '重放定位',
  candidate: '候选',
}

/** 取证据强度的展示标签；未知值**如实标注**，不默认成"精确" */
export function precisionLabel(p: string | null | undefined): string {
  if (!p) return '未标注'
  return PRECISION_LABEL[p] ?? '未知强度'
}

/**
 * 阶段链（与 §2.3 / `core/orchestrator/events.mjs` 的 `PHASE5_STAGES` 一致）。
 *
 * ⚠ 最前面是 `read_problem`（**读题与判定**，"第 0 步"）。第 5 期叫 `read_image`（读图转写），
 *   第 5.7 期按用户裁决改名并**取消了"纯文字题跳过"**：考点不可能写在题面里，必须由模型判，
 *   所以**所有题都跑它**。`repair` 仍只在 Dry-Run 未通过时真正执行。
 *   ⇒ **链条按完整形态排布，不要在别处写死"某一步一定跑"（`skipped` 机制保留，通用）。**
 */
export const STAGE_CHAIN = ['read_problem', 'solve', 'steps', 'answers', 'scene_code', 'dry_run', 'repair'] as const

export const STAGE_LABEL: Record<string, string> = {
  read_problem: '读题与判定',
  solve: '解题',
  answers: '答案抽取',
  steps: '分步解析',
  scene_code: '动画代码',
  dry_run: '校验',
  repair: '自愈修复',
}

/* ────────────────────────────── 演示源 ────────────────────────────── */

/**
 * 演示源：**不调模型**，用本地真题走完整前端流程。
 *
 * ⚠ 它**不做校验**：浏览器里没有 `node:vm` / `worker_threads`，跑不了第 2 期的校验内核。
 *   因此 `dryrun_done.verdict` 被诚实标成 `'skipped'`，并在 `note` 里写明原因。
 *   **绝不谎报 pass。**
 */
export function demoEventSource(): RunHandle {
  const ac = new AbortController()
  const questionId = 'q01-conveyor-heat'

  async function* gen(): AsyncGenerator<RunEvent> {
    let seq = 0
    const at = () => new Date().toISOString()
    const started = Date.now()

    yield {
      seq: ++seq,
      type: 'run_start',
      at: at(),
      entry: '演示：传送带共速与摩擦生热',
      stages: [...STAGE_CHAIN],
      model: '(演示源：未调用模型)',
      mode: 'BOTH',
      imageCount: 0,
      source: 'demo',
    }

    // 演示用的"模型输出"：直接取真题 q01 的槽位（前端只读题目文件，不跑 core/）
    const q = await loadDemoQuestion(questionId)

    const stageTexts: Record<string, string> = {
      solve:
        '物块无初速放到传送带上时相对传送带向左滑，摩擦力方向向右，大小 f = μmg。\n' +
        '由牛顿第二定律 a₁ = μg = 2 m/s²，物块加速到与带同速需要 t* = u/a₁ = 1.0 s。\n' +
        '此间位移 Δx = u²/(2μg) = 1.0 m；相对位移 Δs = u·t* − Δx = 1.0 m；\n' +
        '摩擦生热 Q = μmg·Δs = 2.0 J。共速后摩擦力为零，物块随带匀速。',
      answers: q.slots.ANSWERS,
      steps: q.slots.STEPS,
      scene_code: q.slots
        ? SLOT_KEYS.map((k) => `/* @slot:${k} */\n${q.slots[k]}\n/* @end */`).join('\n')
        : '',
    }

    /**
     * 第 0 步 `read_problem`（读题与判定）：演示源没有图片，也不会调模型，
     * 所以**不伪造转写正文**；但按真实口径发一条 `judgement_done`，
     * 让"两侧分发"这条链路在演示里也走得通（面板上能看到判了什么、命中路径是哪一条）。
     *
     * ⚠ 判定值取自**夹具词表里的真实 id**（`uniform_acceleration` 等）—— 编一个表外的词
     *   会让前端拿不到它要显示的那条路径，等于把演示做成假的。
     */
    const demoJudgement = {
      concepts: ['work_energy_relation', 'conveyor_belt'],
      tags: ['摩擦生热（相对位移）'],
      elements: ['belt', 'block_board', 'vector', 'chart'],
    }
    yield {
      seq: ++seq,
      type: 'stage_done',
      at: at(),
      stage: 'read_problem',
      chars: 0,
      ms: 0,
      note: '(演示源：不调模型，故无转写正文；判定见 judgement_done)',
    }
    yield {
      seq: ++seq,
      type: 'judgement_done',
      at: at(),
      stage: 'read_problem',
      concepts: demoJudgement.concepts,
      tags: demoJudgement.tags,
      elements: demoJudgement.elements,
      unknowns: { concept: [], tag: [], element: [] },
      problems: [],
      why: '(演示源：这几个判定是构建期按真题 q01 的人工口径写死的，不是模型输出)',
      empty: false,
    }

    // `noUncheckedIndexedAccess` 下 `STAGE_CHAIN[i]` 是 `string | undefined`；
    // 用 `slice` + `entries` 拿到既有下标又有确定字符串的遍历，避免到处写非空断言。
    // `read_problem` 已在上面单独处理，所以从 `solve` 开始，到 `dry_run` 前结束
    //（`dry_run` 与 `repair` 由下面单独推）。
    const modelStages = STAGE_CHAIN.slice(STAGE_CHAIN.indexOf('solve'), STAGE_CHAIN.indexOf('dry_run'))
    for (const [i, stage] of modelStages.entries()) {
      if (ac.signal.aborted) {
        yield { seq: ++seq, type: 'cancelled', at: at(), stage }
        break
      }
      yield { seq: ++seq, type: 'stage_start', at: at(), stage, index: i, total: STAGE_CHAIN.length }
      const t0 = Date.now()
      const full: string = stageTexts[stage] ?? ''
      // 逐片吐，模拟流式（前端必须能一边收一边渲染）
      const chunk = 24
      for (let p = 0; p < full.length; p += chunk) {
        if (ac.signal.aborted) break
        await sleep(12)
        yield {
          seq: ++seq,
          type: 'stage_delta',
          at: at(),
          stage,
          text: full.slice(p, p + chunk),
          ...(i === 0 && p === 0 ? { note: 'promptHash', promptHash: '(演示源：不计算 promptHash)' } : {}),
        }
      }
      yield { seq: ++seq, type: 'stage_done', at: at(), stage, chars: full.length, ms: Date.now() - t0 }
      if (ac.signal.aborted) {
        yield { seq: ++seq, type: 'cancelled', at: at(), stage }
        break
      }
    }

    /**
     * 第 5 期：世界书依据（§15）。
     *
     * ⚠ 这份数据的**触发与组装是真的**（构建期用 `core/worldbook/engine.mjs` 在真题题面上跑出来，
     *   见 `tools/build-worldbook-web.mjs`）—— 世界书的命中只取决于题面与词条集合，与模型无关。
     *   所以演示源显示它不是"编一个好看的依据"，而是"用构建期的输入跑真引擎"。
     *   演示源里的**具体词条**仍是构建期快照（用户区在 `ai-rules/worldbook/`，浏览器读不到）。
     */
    yield { seq: ++seq, type: 'worldbook_done', at: at(), ...WORLDBOOK_DEMO_EVENT }

    if (!ac.signal.aborted) {
      yield {
        seq: ++seq,
        type: 'stage_start',
        at: at(),
        stage: 'dry_run',
        index: STAGE_CHAIN.indexOf('dry_run'),
        total: STAGE_CHAIN.length,
      }
      yield {
        seq: ++seq,
        type: 'dryrun_done',
        at: at(),
        verdict: 'skipped',
        cancelled: false,
        checks: [],
        extensions: [],
        diagnostics: [],
        // ⚠ 第 8 期：**渲染符号还是数值不再由 mode 决定** —— 看每条 readout 有没有 `latex`。
        //   漏掉它会让 SYMBOLIC 题在动画页里退回数值显示，直接违反 §18 期 3 的验收条件。
        //
        // ⚠ 字段名：真实链路（`core/orchestrator`）发的是 `program`（单数）。
        //   这里跟着改过来 —— 以前叫 `programs`，两处不一致会让前端只认演示源、
        //   而接上服务端（第 9 步）后**静默拿不到程序载荷**。
        program: { slots: q.slots, mode: q.mode },
        note:
          '演示源不执行校验：校验内核（C1–C9 + Worker 沙箱）是 Node 侧代码，浏览器里无法运行。' +
          '要得到真实判定，请走服务端事件流（第 9 步接入）。',
      }
    }

    yield {
      seq: ++seq,
      type: 'run_done',
      at: at(),
      verdict: ac.signal.aborted ? 'cancelled' : 'skipped',
      ms: Date.now() - started,
      cancelled: ac.signal.aborted,
      rounds: 0,
      // 演示源不跑自愈，因此**没有**横幅；真实链路的横幅由 core 侧生成
      banner: null,
    }
  }

  return { source: 'demo', events: gen(), cancel: () => ac.abort() }
}

/* ────────────────────────────── 服务端源 ────────────────────────────── */

/**
 * 服务端源（SSE）：接第 9 步的本地服务。
 *
 * **现在就能用**：只要有一个按 `core/orchestrator/events.mjs` 发事件的 `/api/run` 端点
 * （把 `toSseFrame()` 的输出直接写进响应体即可）。
 */
export function serverEventSource(baseURL: string, input: RunInput): RunHandle {
  const ac = new AbortController()

  async function* gen(): AsyncGenerator<RunEvent> {
    const res = await fetch(`${baseURL.replace(/\/+$/, '')}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        problem: input.problem,
        images: input.images.map((i) => ({ mime: i.mime, dataUrl: i.dataUrl })),
        mode: input.mode,
        devMode: input.devMode === true,
      }),
      signal: ac.signal,
    })
    if (!res.ok || !res.body) {
      throw new Error(`本地服务返回 ${res.status}；请确认它已启动（第 9 步接入）`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const sep = /\r?\n\r?\n/
      let m: RegExpExecArray | null
      while ((m = sep.exec(buffer)) !== null) {
        const frame = buffer.slice(0, m.index)
        buffer = buffer.slice(m.index + m[0].length)
        const dataLine = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n')
        if (!dataLine) continue
        try {
          yield JSON.parse(dataLine) as RunEvent
        } catch {
          // 单个坏帧不应毁掉整条流
        }
      }
    }
  }

  return { source: 'server', events: gen(), cancel: () => ac.abort() }
}

/* ────────────────────────────── 工具 ────────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 读一道本地真题的 8 个槽位与模式。
 *
 * ⚠ 这里用 `import.meta.glob` 是 Vite/Rollup 的静态导入能力吗？不是 ——
 *   Rollup 不认 `import.meta.glob`（那是 Vite 的）。因此改为**构建期生成清单**：
 *   `web/src/lib/demo-questions.ts` 由 `tools/build-demo-questions.mjs` 从
 *   `tests/regression-15/*.mjs`（唯一事实来源）生成，只登记演示需要的那几道题。
 *
 * ⚠ 返回类型必须带 `mode`：它现在只是**显示标签**（数值/符号已合并为按条目），
 *   漏掉它会让纯符号题在动画页里退回数值显示。
 */
async function loadDemoQuestion(id: string): Promise<{ slots: AnimationSlots; mode: ProgramMode }> {
  const mod = await import('./demo-questions')
  const entry = mod.DEMO_QUESTIONS[id]
  if (!entry) throw new Error(`演示题目 "${id}" 不在 demo-questions.ts 的清单里`)
  return { slots: entry.slots, mode: entry.mode }
}
