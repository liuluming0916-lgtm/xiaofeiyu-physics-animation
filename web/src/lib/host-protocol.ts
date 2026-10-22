/**
 * 宿主 ⇄ 模板页 控制协议（宿主侧 TS 类型与收发封装）。
 *
 * **唯一依据是 `contracts/host-protocol.md`**（第 3 期定稿）。
 * 改协议要先改那份文档；这里的类型必须跟着它走（§21.1 第 1 条）。
 */

/** §3.2 的 8 个冻结键名（顺序即冻结键序） */
export const SLOT_KEYS = [
  'PROBLEM',
  'STEPS',
  'ANSWERS',
  'VIEW',
  'setup',
  'stateAt',
  'drawFrame',
  'readouts',
] as const

export type SlotKey = (typeof SLOT_KEYS)[number]

/** 恰好 8 个键，缺一不可（映射类型把"缺键"变成编译错误） */
export type AnimationSlots = { [K in SlotKey]: string }

/**
 * 程序模式（§3.3 / M9）。
 *
 * ── 第 8 期：**数值与符号已合并**（用户 2026-10-18 裁决）──
 * 判据（C7）本来就按条目走：`value` 是数字就数值复现、是 `null` 就要求 `latex`。
 * 所以这个字段不再决定"渲染符号还是数值"（那由每条 readout 有没有 `latex` 决定），
 * 只作为溯源/显示用的标签；新产出恒为 `'BOTH'`。
 * `'NUMERIC' | 'SYMBOLIC'` 保留在类型里是为了**读旧产物**（历史导出、旧事件不再报错）。
 */
export type ProgramMode = 'BOTH' | 'NUMERIC' | 'SYMBOLIC'

/** 倍速档位（§13.2 / §13.3 至少覆盖这些） */
export const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2, 4] as const
export type PlaybackRate = (typeof PLAYBACK_RATES)[number]

/** 矢量与视图开关（§13.3 三类独立开关 + 轨迹 + 网格） */
export interface VectorMask {
  velocity: boolean
  acceleration: boolean
  force: boolean
  trace: boolean
  grid: boolean
}

/** 模板 → 宿主的 `state` 心跳载荷 */
export interface TemplateState {
  t: number
  duration: number
  playing: boolean
  rate: number
  stepIndex: number
  readouts: Array<{ label: string; value: number | null; unit: string; latex?: string }>
}

/** 模板 → 宿主的 `ready` 载荷 */
export interface TemplateReady {
  duration: number
  stepCount: number
}

/** 模板 → 宿主的 `error` 载荷（错误码见协议 §6） */
export interface TemplateError {
  code:
    | 'runtime-missing'
    | 'no-program'
    | 'program-already-inlined'
    | 'bad-program'
    | 'load-failed'
  message: string
  slot?: string
}

/** 宿主 → 模板：`program` 注入载荷（协议 §3） */
export interface ProgramPayload {
  slots: AnimationSlots
  mode: ProgramMode
  texSvg?: { renderer?: string; formulas?: Record<string, string> } | null
  /**
   * 第 8 期（C2）：标注避让表（`od-label-avoid` v1）。
   *
   * 由 Dry-Run 产出、宿主**原样转发**给模板 —— 前端不解读它的语义。
   * 它不是 §13.2 的冻结消息的一部分，只是 `load` 载荷里的一个可选字段：
   * 缺了它模板照常播放（字不挪），所以不影响冻结协议。
   */
  labelAvoid?: Record<string, unknown> | null
  /** v6：讲解步骤 ↔ 动画时间（没有就不发；模板据此做联动） */
  stepTimes?: Array<{ step: number; t0: number; t1: number }> | null
}

/* ────────────────────────────── 消息常量 ────────────────────────────── */

export const HOST_SOURCE = 'od-host'
export const TEMPLATE_SOURCE = 'od-template'

export const HOST_TO_TEMPLATE = [
  'play',
  'pause',
  'toggle',
  'seek',
  'setRate',
  'showStep',
  'setVectorMask',
  'setTheme',
  'program',
] as const

export const TEMPLATE_TO_HOST = ['ready', 'state', 'error'] as const

export type HostToTemplateType = (typeof HOST_TO_TEMPLATE)[number]
export type TemplateToHostType = (typeof TEMPLATE_TO_HOST)[number]

/* ────────────────────────────── 收发封装 ────────────────────────────── */

/** 协议 §2：接受 od-host；缺 source 也接受（向后兼容 §13.2 草案）；其余忽略 */
export function isHostMessage(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const src = (data as { source?: unknown }).source
  return src === undefined || src === HOST_SOURCE
}

/** 协议 §2 的对称规则：接受 od-template；缺 source 也接受 */
export function isTemplateMessage(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const src = (data as { source?: unknown }).source
  return src === undefined || src === TEMPLATE_SOURCE
}

/** 宿主 → 模板。iframe 未就绪时静默丢弃（由调用方决定是否排队重发）。 */
export function postToTemplate(
  win: Window | null | undefined,
  type: HostToTemplateType,
  payload: Record<string, unknown> = {},
): boolean {
  if (!win) return false
  try {
    win.postMessage({ source: HOST_SOURCE, type, ...payload }, '*')
    return true
  } catch {
    // 跨源或 iframe 已销毁
    return false
  }
}

/**
 * 从一条原始消息里解析出模板事件。
 * 返回 `null` 表示"不是给宿主的消息"或"类型不认识"。
 */
export function parseTemplateMessage(
  data: unknown,
): { type: TemplateToHostType; payload: Record<string, unknown> } | null {
  if (!isTemplateMessage(data)) return null
  const type = (data as { type?: unknown }).type
  if (typeof type !== 'string') return null
  if (!(TEMPLATE_TO_HOST as readonly string[]).includes(type)) return null
  const { source: _s, type: _t, ...payload } = data as Record<string, unknown>
  return { type: type as TemplateToHostType, payload }
}

/** 默认开关状态（§13.3：三类矢量 + 轨迹 + 网格各自独立） */
export const DEFAULT_MASK: VectorMask = {
  velocity: true,
  acceleration: true,
  force: true,
  trace: true,
  grid: true,
}

/** 校验一份载荷是否满足 §3.2（宿主侧先自检，别把坏数据发给模板） */
export function validateProgramPayload(payload: ProgramPayload): string | null {
  const slots = payload?.slots as Record<string, unknown> | undefined
  if (!slots || typeof slots !== 'object') return 'program.slots 缺失'
  const keys = Object.keys(slots)
  if (keys.length !== SLOT_KEYS.length) {
    return `program.slots 必须恰好含 ${SLOT_KEYS.length} 个键，实际 ${keys.length} 个`
  }
  for (const k of SLOT_KEYS) {
    const v = slots[k]
    if (typeof v !== 'string' || v.length === 0) return `槽位 ${k} 缺失或为空（§3.2 审计 2）`
  }
  if (payload.mode !== 'BOTH' && payload.mode !== 'NUMERIC' && payload.mode !== 'SYMBOLIC') {
    return `未知的 mode：${String(payload.mode)}`
  }
  return null
}
