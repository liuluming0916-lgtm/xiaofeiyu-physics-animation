/**
 * 应用状态（zustand）。
 *
 * 管理三件事：
 *   1. 解题页的运行状态（题面、阶段进度、流式文本、判定、取消）；
 *   2. 动画页要用的程序载荷与宿主控制状态（时间轴、倍速、矢量开关）；
 *   3. 端点配置（第 3 期从 `ai-rules/endpoints.json` 读，UI 留第 6 期设置页）。
 */

import { create } from 'zustand'

import type { StageNotes } from '../lib/stage-notes'

import { DEFAULT_MASK, type AnimationSlots, type ProgramMode, type VectorMask } from '../lib/host-protocol'
import type { EventSourceKind, RepairBanner, RepairCheckSnapshot, RunEvent, KnowledgecardEvidence, ProgramProvenance } from '../lib/run-stream'

/** 一轮自愈修复的留档（B6：修复过程对用户可见） */
export interface RepairRound {
  round: number
  requested: string[]
  updated: string[]
  unchanged: string[]
  triggeringChecks: string[]
  diagnostics: RepairCheckSnapshot[]
  verdict: string
  ms: number
}

/** 一次运行的完整状态 */
export interface RunState {
  running: boolean
  source: EventSourceKind | null
  entry: string
  model: string | null
  stages: string[]
  /** 已收到的阶段正文（stage → 文本），用于三段式渲染 */
  stageText: Record<string, string>
  /** 每个阶段的状态（`skipped` = 本次不适用，例如纯文字题的读图转写） */
  stageStatus: Record<string, 'pending' | 'running' | 'done' | 'error' | 'skipped'>
  stageMs: Record<string, number>
  /** 阶段被跳过的原因（第 5 期引入；第 5.7 期起 read_problem 总是跑，但 skipped 机制保留且必须能说出原因） */
  stageSkipReason: Record<string, string>
  promptHash: string | null
  /** 校验结果（演示源为 skipped，并带 note 说明） */
  verdict: 'pass' | 'pass-with-warnings' | 'fail' | 'skipped' | null
  /** 本次被"开发模式"放行的检查号（空数组 = 没放行任何东西） */
  gatesBypassed: string[]
  /** 本次是否走了开发模式（不拦截） */
  advisory: boolean
  verdictNote: string | null
  /** `offenders` = 该条检查抓到的**具体条目**（第 8 期：C6 的时间/分量/前后值就靠它显示） */
  checks: Array<{ id: string; status: string; blocking: boolean; message: string; offenders?: Array<Record<string, unknown>> }>
  extensions: Array<{ id: string; status: string; blocking: boolean; message: string }>
  diagnostics: Array<Record<string, unknown>>
  /** 第 4 期：自愈轮次留档（第 1 轮在前） */
  repairRounds: RepairRound[]
  /** 第 4 期：自愈是否收敛（`pass` 即停；上限 3 轮） */
  repairConverged: boolean | null
  /** 第 4 期：告警横幅（§21.2 第 8 条：**绝不静默交付**；为 null 表示没有告警） */
  banner: RepairBanner | null
  /** 第 4 期：交付形态（8 槽位齐全才 playable） */
  delivery: { playable: boolean; mode: string; missing: string[] } | null
  /** 第 5 期：世界书依据（命中清单 / 注入槽位 / 空槽与截断）；调用方没提供词条集合时为 null */
  knowledgecard: KnowledgecardEvidence | null
  error: { stage: string; kind: string; message: string; hint?: string } | null
  elapsedMs: number
  /** v1.1.18 手动打回：上一版读题/分析原文（不是 8 槽位的一部分） */
  readProblemText: string | null
  analysisText: string | null
  /** 进入动画页的警告弹窗是否已确认（“我知道了”/开始打回后置 true） */
  warningAcknowledged: boolean
}

/** 一次生成/修复留档：用于动画页“版本对比 / 回退” */
export interface ProgramVersion {
  id: number
  at: string
  slots: AnimationSlots
  mode: ProgramMode
  verdict: string | null
  checks: Array<{ id: string; status: string; blocking: boolean; message: string }>
  source: 'run' | 'repair' | 'manual'
}

export interface AppState {
  /* 解题页 */
  problemText: string
  description: string
  knownConditions: string
  /** v1.1.18：按阶段补充描述（空串/未填 = 该阶段不注入） */
  stageNotes: StageNotes
  images: Array<{ mime: string; dataUrl: string; name?: string }>
  /**
   * v1.1.16：**老师提供的参考答案 / 解析**（可选）。
   *
   * 为什么要有它：模型的错绝大多数出在"解题"（漏约束、漏边界），
   * 而老师手里本来就有标准解析。给了它，模型的任务就从"自己解题"
   * 变成"照着解析整理过程 + 画动画" —— 把开放题变成填空题。
   *
   * ⚠ 有内容时才切到"参考解析"那套提示词；空着时流程与旧版**逐字一致**。
   */
  referenceText: string
  referenceImages: Array<{ mime: string; dataUrl: string; name?: string }>
  mode: ProgramMode
  /**
   * 第 8 期：**开发模式（不拦截）**的开关（界面偏好，持久化到 localStorage）。
   * 打开后 C1–C9 照做、报告照写，但不拦交付、不跑自愈。
   */
  devMode: boolean
  run: RunState

  /* 动画页 */
  programSlots: AnimationSlots | null
  programMode: ProgramMode
  programTitle: string
  /**
   * 第 8 期（C2）：Dry-Run 算出的标注避让表（原样转发给模板，前端不解读）。
   * 没有表时播放器行为与第 7 期一致 —— 它是增强项，不是前提。
   */
  programLabelAvoid: Record<string, unknown> | null
  /**
   * v1.1.19：本次程序的真实溯源（模型 / promptHash / knowledgecardHash）。
   * 导出网页时烧进 Provenance；以前真实跑没把它传下去，只能写“未记录”。
   */
  programProvenance: ProgramProvenance | null
  /** v6：步骤 ↔ 动画时间（couple 阶段产出；原始物理秒，导出用） */
  programStepTimes: Array<{ step: number; t0: number; t1: number }> | null
  /** v1.1.17：换算到显示秒的步骤时间 + 时间映射（live 动画页用；每小问 4 s） */
  programDisplayStepTimes: Array<{ step: number; sub: number; t0: number; t1: number }> | null
  programTimeMap: Array<{ sub: number; p0: number; p1: number; d0: number; d1: number }> | null
  programDisplayDuration: number | null
  /** iframe 是否已发出 ready */
  templateReady: boolean
  /** v1.1.18：版本历史（初次 + 每轮修复，最多保留 8 个） */
  programVersions: ProgramVersion[]
  programVersionIndex: number
  /** iframe 重挂载计数：换版本/回退时递增，避免模板“首次注入即锁死” */
  programEpoch: number
  playing: boolean
  t: number
  duration: number
  rate: number
  mask: VectorMask
  templateError: { code: string; message: string } | null

  /* Actions */
  setProblemText: (s: string) => void
  setDescription: (s: string) => void
  setKnownConditions: (s: string) => void
  setStageNotes: (notes: StageNotes) => void
  addImage: (i: { mime: string; dataUrl: string; name?: string }) => void
  removeImage: (index: number) => void
  /** v1.1.16：参考答案（文字 / 图片）；与题目图片分开存，互不覆盖 */
  setReferenceText: (s: string) => void
  addReferenceImage: (i: { mime: string; dataUrl: string; name?: string }) => void
  removeReferenceImage: (index: number) => void
  /** 第 8 期：切换开发模式（不拦截）；写 localStorage，下次进来还是这个状态 */
  setDevMode: (on: boolean) => void
  /** ⚠ 第 8 期：不再有 setMode（数值/符号按条目走，界面上的模式开关已删除） */

  startRun: (
    source: EventSourceKind,
    entry: string,
    model: string | null,
    stages: string[],
    preserveVersions?: boolean,
    preserveTiming?: boolean,
  ) => void
  applyEvent: (e: RunEvent) => void
  failRun: (message: string) => void

  /** 进入动画页的警告弹窗：确认后不再重复弹（“我知道了”/开始打回） */
  acknowledgeWarning: () => void
  /** 回退到某个历史版本（iframe 会因 programEpoch 变化而重挂载） */
  rollbackProgram: (index: number) => void

  loadProgram: (slots: AnimationSlots, mode: ProgramMode, title: string) => void
  setTemplateReady: (v: boolean) => void
  setTemplateError: (e: { code: string; message: string } | null) => void
  setPlaying: (v: boolean) => void
  setT: (t: number) => void
  setDuration: (d: number) => void
  setRate: (r: number) => void
  setMask: (patch: Partial<VectorMask>) => void
}

const EMPTY_RUN: RunState = {
  running: false,
  source: null,
  entry: '',
  model: null,
  stages: [],
  stageText: {},
  stageStatus: {},
  stageMs: {},
  stageSkipReason: {},
  promptHash: null,
  verdict: null,
  gatesBypassed: [],
  advisory: false,
  verdictNote: null,
  checks: [],
  extensions: [],
  diagnostics: [],
  repairRounds: [],
  repairConverged: null,
  banner: null,
  delivery: null,
  knowledgecard: null,
  error: null,
  elapsedMs: 0,
  readProblemText: null,
  analysisText: null,
  warningAcknowledged: false,
}

export const useApp = create<AppState>((set) => ({
  problemText: '',
  description: '',
  knownConditions: '',
  stageNotes: {},
  images: [],
  referenceText: '',
  referenceImages: [],
  mode: 'BOTH',
  /** 第 8 期：开发模式（不拦截）—— 记住上次的选择 */
  devMode: readDevMode(),
  run: { ...EMPTY_RUN },

  programSlots: null,
  programMode: 'BOTH',
  programTitle: '',
  programLabelAvoid: null,
  programProvenance: null,
  programStepTimes: null,
  programDisplayStepTimes: null,
  programTimeMap: null,
  programDisplayDuration: null,
  templateReady: false,
  programVersions: [],
  programVersionIndex: -1,
  programEpoch: 0,
  playing: false,
  t: 0,
  duration: 0,
  rate: 1,
  mask: { ...DEFAULT_MASK },
  templateError: null,

  setProblemText: (s) => set({ problemText: s }),
  setDescription: (s) => set({ description: s }),
  setKnownConditions: (s) => set({ knownConditions: s }),
  setStageNotes: (notes) => set({ stageNotes: notes }),
  addImage: (i) => set((st) => ({ images: [...st.images, i] })),
  removeImage: (index) => set((st) => ({ images: st.images.filter((_, i) => i !== index) })),
  setReferenceText: (s) => set({ referenceText: s }),
  addReferenceImage: (i) => set((st) => ({ referenceImages: [...st.referenceImages, i] })),
  removeReferenceImage: (index) => set((st) => ({ referenceImages: st.referenceImages.filter((_, i) => i !== index) })),
  setDevMode: (on) => {
    try {
      localStorage.setItem('od-dev-mode', on ? '1' : '0')
    } catch {
      /* 隐私模式 / 禁用存储：只影响"记住上次选择"，不影响本次开关 */
    }
    set({ devMode: on })
  },
  /** ⚠ 第 8 期：没有 setMode 了（数值/符号按条目走，界面上不再有开关） */

  startRun: (source, entry, model, stages, preserveVersions = false, preserveTiming = false) =>
    set((st) => ({
      run: {
        ...EMPTY_RUN,
        running: true,
        source,
        entry,
        model,
        stages,
        stageStatus: Object.fromEntries(stages.map((s) => [s, 'pending' as const])),
      },
      // 新一轮开始就清掉上一轮的动画（避免把旧动画当新结果看）
      programSlots: null,
      programStepTimes: preserveTiming ? st.programStepTimes : null,
      programDisplayStepTimes: preserveTiming ? st.programDisplayStepTimes : null,
      programTimeMap: preserveTiming ? st.programTimeMap : null,
      programDisplayDuration: preserveTiming ? st.programDisplayDuration : null,
      templateReady: false,
      templateError: null,
      /** 手动打回保留旧版本；正常开新题清空历史 */
      programVersions: preserveVersions ? st.programVersions : [],
      programVersionIndex: preserveVersions ? st.programVersionIndex : -1,
      programProvenance: preserveVersions ? st.programProvenance : null,
      programEpoch: st.programEpoch + 1,
    })),

  applyEvent: (e) =>
    set((st) => {
      const run = {
        ...st.run,
        stageText: { ...st.run.stageText },
        stageStatus: { ...st.run.stageStatus },
        stageMs: { ...st.run.stageMs },
        stageSkipReason: { ...st.run.stageSkipReason },
        repairRounds: [...st.run.repairRounds],
      }
      switch (e.type) {
        case 'run_start':
          run.entry = e.entry
          run.model = e.model
          run.stages = e.stages
          break
        case 'run_label':
          // 第 5 期追加：纯图片题开跑时标题是"(未命名题目)"，读图转写跑完后回填成转写的第一句
          run.entry = e.entry
          break
        case 'stage_start':
          run.stageStatus[e.stage] = 'running'
          break
        case 'stage_delta':
          run.stageText[e.stage] = (run.stageText[e.stage] ?? '') + e.text
          if (e.promptHash) run.promptHash = e.promptHash
          break
        case 'stage_done':
          // 第 5 期：`skipped:true` 表示"这一步本次不适用"（纯文字题的读图转写）。
          // 它**必须**与 `done` 分开显示 —— 否则界面上会把"跳过了"看成"做完了"。
          if (e.skipped) {
            run.stageStatus[e.stage] = 'skipped'
            run.stageSkipReason[e.stage] = e.reason ?? '本次不适用，已跳过'
          } else {
            run.stageStatus[e.stage] = 'done'
          }
          run.stageMs[e.stage] = e.ms
          break
        case 'stage_error':
          run.stageStatus[e.stage] = 'error'
          run.error = { stage: e.stage, kind: e.error.kind, message: e.error.message, ...(e.error.hint ? { hint: e.error.hint } : {}) }
          break
        case 'repair_round':
          // 第 4 期：每轮修复都留档，UI 上要能看出"改了什么、为什么改"
          run.repairRounds.push({
            round: e.round,
            requested: e.requested,
            updated: e.updated,
            unchanged: e.unchanged,
            triggeringChecks: e.triggeringChecks,
            diagnostics: e.diagnostics,
            verdict: e.verdict,
            ms: e.ms,
          })
          break
        case 'repair_done':
          run.repairConverged = e.converged
          run.banner = e.banner ?? null
          break
        case 'knowledgecard_done':
          // 第 5 期：世界书依据（§15）。**整条载荷留着**：面板要显示命中方式、
          // 实际注入槽位、字符数与"空槽 / 被截断"这两个**必须分开**的状态。
          run.knowledgecard = {
            hash: e.hash,
            libraryCount: e.libraryCount,
            matched: e.matched,
            entries: e.entries,
            emptySlots: e.emptySlots,
            truncatedSlots: e.truncatedSlots,
            warnings: e.warnings,
            charsBySlot: e.charsBySlot,
            injectedBySlot: e.injectedBySlot,
          }
          break
        case 'dryrun_done':
          // ⚠ 自愈会**多次**推 `dryrun_done`（首轮 + 每轮修复后）。
          //   最终判定必须取**最后一次**，否则 UI 会把中间那轮的 fail 当成结论。
          run.verdict = e.verdict
          run.verdictNote = e.note ?? null
          run.checks = e.checks
          run.extensions = e.extensions
          run.diagnostics = e.diagnostics
          /**
           * v1.1.17 修：`dry_run` 的完成信号本来就是 `dryrun_done`（协议约定），
           * 旧代码却没把 stageStatus 从 running 改掉 ⇒ 校验没过、进入 repair 时，
           * 前端仍认为 dry_run 在跑，小肥鱼会永远停在“校验中”（用户实测）。
           * 这里在拿到报告后收尾；若已经因组装失败标了 error，不覆盖。
           */
          if (run.stageStatus.dry_run !== 'error') run.stageStatus.dry_run = 'done'
          /**
           * 第 8 期：**开发模式（不拦截）**。
           * 这里只记"放行了哪几条"；界面必须显著提示（否则就成了看不见的绿灯）。
           * 同时把整份报告存进 localStorage（用户要求："在本地网页中保存它认为错误的部分"）。
           */
          run.advisory = e.advisory === true
          run.gatesBypassed = e.gatesBypassed ?? []
          if (e.advisory === true) {
            saveDevReport({
              at: new Date().toISOString(),
              entry: run.entry,
              verdict: e.verdict,
              gatesBypassed: run.gatesBypassed,
              checks: e.checks,
              diagnostics: e.diagnostics,
              /**
               * ★ 把 8 个槽位一起存下来（第 8 期补）。
               * 用户第一次发来的留档 JSON 里**没有代码**，于是"播放键不动""曲线图没生成"
               * 这类问题只能靠看画面猜 —— 存下来才可能复现。
               */
              slots: (e.program?.slots ?? e.programs?.slots ?? null) as Record<string, string> | null,
            })
          }
          {
            // 真实链路发 `program`（单数）；演示源历史上发 `programs`。两个都认，
            // 否则接上服务端后这里会静默拿不到载荷。
            const payload = e.program ?? e.programs
            if (payload?.slots) {
              const slots = payload.slots
              // 清掉行偏移补出来的前导空行会让槽位看起来"缩进很深"，模板页能容忍，
              // 但为了观感这里做一次最小归一化（只去首尾空行，不动行内内容）。
              const trimmed: Record<string, string> = {}
              for (const [k, v] of Object.entries(slots)) {
                trimmed[k] = String(v).replace(/^\n+/, '').replace(/\n+$/, '')
              }
              const normalized = trimmed as unknown as AnimationSlots
              /**
               * v1.1.18：每份程序（首画 + 每轮修复）都进版本历史。
               * 同一份内容重复推送时不重复记（自愈偶尔会 same payload 再推一次）。
               */
              const last = st.programVersions[st.programVersions.length - 1]
              const same = last !== undefined && JSON.stringify(last.slots) === JSON.stringify(normalized)
              const versions = same
                ? st.programVersions
                : [
                    ...st.programVersions,
                    {
                      id: (last?.id ?? 0) + 1,
                      at: new Date().toISOString(),
                      slots: normalized,
                      mode: payload.mode as ProgramMode,
                      verdict: e.verdict ?? null,
                      checks: (e.checks ?? []).map((c) => ({
                        id: c.id,
                        status: c.status,
                        blocking: c.blocking,
                        message: c.message,
                      })),
                      source: e.round != null ? ('repair' as const) : ('run' as const),
                    },
                  ].slice(-8)
              set({
                programSlots: normalized,
                programMode: payload.mode,
                programTitle: run.entry,
                /* C2：避让表随 program 一起走；没有就是 null（播放器照常工作） */
                programLabelAvoid: e.labelAvoid ?? null,
                /* v1.1.19：本次程序溯源（导出页烧录真实 promptHash / 知识卡哈希） */
                programProvenance: e.program?.provenance ?? st.programProvenance,
                templateReady: false,
                templateError: null,
                programVersions: versions,
                programVersionIndex: same ? st.programVersionIndex : versions.length - 1,
                programEpoch: same ? st.programEpoch : st.programEpoch + 1,
              })
            }
          }
          break
        case 'cancelled':
          run.verdict = 'skipped'
          run.verdictNote = '已被用户取消'
          break
        case 'coupling_done':
          set({
            programStepTimes: Array.isArray(e.stepTimes) ? e.stepTimes : null,
            programDisplayStepTimes: Array.isArray(e.displayStepTimes) ? e.displayStepTimes : null,
            programTimeMap: Array.isArray(e.timeMap) ? e.timeMap : null,
            programDisplayDuration:
              typeof e.displayDuration === 'number' && Number.isFinite(e.displayDuration) ? e.displayDuration : null,
          })
          if (e.fallback) run.verdictNote = `步骤耦合回退：${e.warning ?? '已按比例分配'}`
          break
        case 'run_done':
          run.running = false
          run.elapsedMs = e.ms
          if (e.banner !== undefined) run.banner = e.banner ?? null
          if (Number.isFinite(e.rounds)) run.repairConverged = e.converged ?? run.repairConverged
          if (e.delivery) run.delivery = e.delivery
          if (!run.verdict) run.verdict = (e.verdict as RunState['verdict']) ?? null
          if (e.readProblemText) run.readProblemText = e.readProblemText
          if (e.analysisText) run.analysisText = e.analysisText
          if (e.stepTimes || e.displayStepTimes || e.timeMap || typeof e.displayDuration === 'number') {
            set({
              ...(e.stepTimes ? { programStepTimes: e.stepTimes } : {}),
              ...(e.displayStepTimes ? { programDisplayStepTimes: e.displayStepTimes } : {}),
              ...(e.timeMap ? { programTimeMap: e.timeMap } : {}),
              ...(typeof e.displayDuration === 'number' ? { programDisplayDuration: e.displayDuration } : {}),
            })
          }
          break
      }
      return { run }
    }),

  failRun: (message) =>
    set((st) => ({ run: { ...st.run, running: false, error: { stage: 'client', kind: 'client', message } } })),

  acknowledgeWarning: () =>
    set((st) => ({ run: { ...st.run, warningAcknowledged: true } })),

  rollbackProgram: (index) =>
    set((st) => {
      const v = st.programVersions[index]
      if (!v) return {}
      return {
        programSlots: v.slots,
        programMode: v.mode,
        programTitle: st.run.entry,
        programVersionIndex: index,
        programLabelAvoid: null,
        /* 回退到旧版本时，当前 run 的溯源不一定对应这一份程序；宁可写“未记录” */
        programProvenance: null,
        templateReady: false,
        templateError: null,
        /** 换一份程序就换一个 iframe：模板“第一次注入即锁死”，不能复用旧 iframe */
        programEpoch: st.programEpoch + 1,
      }
    }),

  loadProgram: (slots, mode, title) =>
    set({
      programSlots: slots,
      programMode: mode,
      programTitle: title,
      programProvenance: null,
      programStepTimes: null,
      programDisplayStepTimes: null,
      programTimeMap: null,
      programDisplayDuration: null,
      templateReady: false,
      templateError: null,
    }),

  setTemplateReady: (v) => set({ templateReady: v }),
  setTemplateError: (e) => set({ templateError: e }),
  setPlaying: (v) => set({ playing: v }),
  setT: (t) => set({ t }),
  setDuration: (d) => set({ duration: d }),
  setRate: (r) => set({ rate: r }),
  setMask: (patch) => set((st) => ({ mask: { ...st.mask, ...patch } })),
}))


/* ══════════════════ 第 8 期：开发模式（不拦截）的本地留档 ══════════════════
 *
 * 用户的诉求原话："勾选开发模式之后，C1–C9 只校验并在本地网页中保存它认为错误的部分，
 * 而动画代码则正常流入到动画页面播放。"
 *
 * 所以这里做两件事：
 *   ① 记住开关（localStorage: od-dev-mode）；
 *   ② 每次"放行"都把**整份报告**（含每条检查的 diagnostics / offenders）追加进
 *      localStorage: od-dev-reports（只留最近 20 条）。
 * 为什么放 localStorage 而不是服务端：这是"开发期的本地草稿"，不需要进历史库；
 * 也避免把"未经验证"的产物混进正式归档。
 */

const DEV_MODE_KEY = 'od-dev-mode'
const DEV_REPORTS_KEY = 'od-dev-reports'
const DEV_REPORTS_MAX = 20

function readDevMode(): boolean {
  try {
    return localStorage.getItem(DEV_MODE_KEY) === '1'
  } catch {
    return false
  }
}

export interface DevReport {
  at: string
  entry: string
  verdict: string
  gatesBypassed: string[]
  checks: Array<Record<string, unknown>>
  diagnostics: Array<Record<string, unknown>>
  /** 8 个槽位的源码（便于事后复现"播放不动 / 图线不对"这类问题） */
  slots?: Record<string, string> | null
}

function readDevReports(): DevReport[] {
  try {
    const raw = localStorage.getItem(DEV_REPORTS_KEY)
    const list = raw ? (JSON.parse(raw) as DevReport[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** 追加一条"开发模式放行"的报告（只留最近 DEV_REPORTS_MAX 条；存储满了就丢掉最旧的） */
export function saveDevReport(report: DevReport): void {
  try {
    const list = readDevReports()
    list.push(report)
    localStorage.setItem(DEV_REPORTS_KEY, JSON.stringify(list.slice(-DEV_REPORTS_MAX)))
  } catch {
    /* 隐私模式 / 配额满：留档失败不影响播放，但也不假装成功 */
  }
}

/** 读出全部本地留档（校验报告面板的"开发模式留档"用它） */
export function listDevReports(): DevReport[] {
  return readDevReports()
}

/** 清空留档（面板上的按钮） */
export function clearDevReports(): void {
  try {
    localStorage.removeItem(DEV_REPORTS_KEY)
  } catch {
    /* 同上 */
  }
}

/** 便利选择器：当前是否有可播放的程序 */
export const selectHasProgram = (st: AppState) => Boolean(st.programSlots)

/** 便利选择器：判定是否"未校验"（UI 必须显著区分它和 pass） */
export const selectIsSkipped = (st: AppState) => st.run.verdict === 'skipped'

/** 供其它模块读快照（非 React 环境，例如事件循环里） */
export const getState = () => useApp.getState()
