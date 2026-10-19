/**
 * `worldbook-engine.js` 的类型声明（第 5 期）。
 *
 * ⚠ 这个 `.js` 是 `core/worldbook/engine.mjs` 的**逐字节副本**（由
 *   `tools/build-worldbook-web.mjs` 生成）。TS 靠**本文件**拿到类型：
 *   `moduleResolution: "bundler"` 下 `import … from './worldbook-engine.js'`
 *   会解析到 `worldbook-engine.d.ts`。
 *
 * ⚠ 因此本文件是**抄录**，而抄录一定会漂移 —— 由构建期判据兜住：
 *   `tools/web-build.mjs` 断言"这里声明的每个名字都真的在 engine.mjs 里导出"、
 *   且"每个导出的名字都在这里有声明"。少一个 / 多一个都会让构建失败。
 */

export interface PreparedText {
  raw: string
  normalized: string
}

export interface ParsedKey {
  kind: 'literal' | 'regex'
  source: string
  flags: string
  literal: string | null
  regex: RegExp | null
  error: string | null
  raw: string
}

export interface KeyScanResult {
  hit: boolean
  key: string | null
  error: string | null
}

export interface SecondaryKeys {
  logic: 'AND_ANY' | 'AND_ALL' | 'OR' | 'NOT' | string
  list: string[]
}

export interface WorldbookEntryLike {
  id: string
  title?: string
  origin?: string
  category?: string
  /** v1.1.9alpha：知识卡类型；缺省按 element（旧包兼容） */
  kind?: 'anim_rule' | 'element' | 'scene'
  enabled?: boolean
  constant?: boolean
  recursive?: boolean
  keys?: string[]
  secondary_keys?: SecondaryKeys
  /** 第 5.7 期新增：考点（词表 A）。缺省/空 ⇒ 不走概念分发（灰度期老词条只走 keys 字面） */
  concepts?: string[]
  /** 第 5.7 期新增：题型标签 / 细考点（词表 B）；空数组 = 该考点下的通用词条（方案 b 兜底） */
  tags?: string[]
  /** 第 5.7 期新增：实体物理图元 · 动画元件（原名 devices / 器材）；动画侧触发源 */
  elements?: string[]
  insertion_slot?: string[]
  order?: number
  priority?: string
  content?: string
  code_examples?: string[]
}

export interface WorldbookBudget {
  maxDepth: number
  maxEntries: number
  maxChars: number
  /** 第 8 期：正文 + 示例的**合计**上限（30000 + 10000 = 40000） */
  maxTotalChars: number
}

export interface ProvenanceRecord {
  entry_id: string
  title: string
  /** 命中方式。第 5.7 期新增三档：concept+tag / concept / element+concept / element */
  via: 'key' | 'secondary' | 'concept+tag' | 'concept' | 'element+concept' | 'element' | 'constant' | 'recursive' | string
  from: string | null
  depth: number
  key: string | null
  /** 第 5.7 期：概念分发命中的具体项（哪几个考点/题型/元件对上了） */
  matched: { concepts: string[]; tags: string[]; elements: string[] }
  origin: string
  category: string
  priority: string
  order: number
  constant: boolean
  recursive: boolean
  declaredSlots: string[]
  injectedSlots: string[]
  charsBySlot: Record<string, number>
  unmounted: boolean
  truncated: boolean
}

export interface SlotResult {
  slot: string
  candidates: number
  injected: Array<{
    id: string
    title: string
    via: string
    from: string | null
    mode: string
    chars: number
    /** 第 8 期 L3：这条词条追加的示例占多少字符（0 = 没给示例）。`chars` 仍只算正文 */
    exampleChars?: number
  }>
  chars: number
  /** 第 8 期 L3：示例合计字符数（**不计入** `chars`：`chars` 是正文预算口径） */
  examplesChars?: number
  examplesIncluded?: string[]
  examplesDropped?: string[]
  /** 因"与正文/前面的示例重复"整条未发（第 8 期示例去重） */
  examplesDeduped?: string[]
  examplesDedupedChars?: number
  empty: boolean
  truncated: boolean
  dropped: Array<{ id: string; title: string }>
}

export interface TriggerResult {
  text: Record<string, string>
  slots: Record<string, SlotResult>
  emptySlots: string[]
  truncatedSlots: Array<{ slot: string; dropped: number; droppedIds: string[] }>
  provenance: ProvenanceRecord[]
  warnings: Array<{ code: string; entryId?: string; slot?: string; message: string }>
  stats: {
    scanned: number
    matched: number
    byVia: Record<string, number>
    /** 第 5.7 期：本次是否带了模型判定（灰度期对比"概念路径 vs 字面路径"要用） */
    judgementProvided: boolean
    judgement: { concepts: string[]; tags: string[]; elements: string[] }
    maxDepth: number
    budget: WorldbookBudget
    charsBySlot: Record<string, number>
    injectedBySlot: Record<string, number>
  }
}

export interface SlotConditional {
  text: string
  instructionText: string
  worldbookText: string
  hasInstruction: boolean
  hasWorldbook: boolean
}

export interface ConflictHint {
  code: string
  level: 'error' | 'warn' | 'info'
  entryIds: string[]
  message: string
}

export const WORLDBOOK_BUDGET: WorldbookBudget
/**
 * 第 8 期 L3：**示例预算**（独立第二份额度）。
 *
 * 第 8 期定案：正文用 `WORLDBOOK_BUDGET.maxChars`（30000），示例用
 * `maxTotalChars − 正文`（合计 40000），两者**各用各的池子**。
 * （旧口径"示例只吃正文剩下的"等于把示例塞进正文的 30000 里，永远拿不满。）
 */
export const WORLDBOOK_EXAMPLE_BUDGET: {
  maxCharsPerEntry: number
  maxCharsPerSlot: number
  slots: readonly string[]
}
export const HIT_STRENGTH: Record<string, number>
export const WORLDBOOK_SLOTS: readonly string[]
export const WORLDBOOK_KIND_ORDER: readonly ('anim_rule' | 'element' | 'scene')[]
export function kindOfEntry(entry: WorldbookEntryLike): 'anim_rule' | 'element' | 'scene'
export const SLOT_MARKER_LABEL: Record<string, string>
export const SELF_CHECK_HEADING: string
export const WAKE_BY_TITLE_FOR_KEYLESS: boolean

export function normalizeText(input: unknown): string
export function parseKey(rawKey: unknown): ParsedKey
export function matchKey(rawKey: string, text: PreparedText): { hit: boolean; error: string | null }
export function prepareText(input: unknown): PreparedText
export function scanKeys(keys: unknown, text: PreparedText): KeyScanResult
export function evaluateSecondary(entry: WorldbookEntryLike, text: PreparedText, primaryHit: boolean): boolean
export function entryMatches(
  entry: WorldbookEntryLike,
  text: PreparedText,
): { hit: boolean; primary: KeyScanResult; secondary: boolean; via: string | null; key: string | null }
export function splitEntryContent(
  entry: WorldbookEntryLike,
  slot: string,
): { text: string; mode: 'full' | 'by-heading' | 'heading-missing'; warning: string | null }
export function renderEntryBlock(slot: string, title: string, content: string): string
/**
 * 第 8 期 L3：渲染一条词条的**示例段**（只在 `WORLDBOOK_EXAMPLE_BUDGET.slots` 里的槽位、
 * 且词条不是常驻时返回非空）。返回空串 = 这条不带示例。
 */
export function renderExampleBlock(slot: string, entry: WorldbookEntryLike): string
export function renderInstructionBlock(label: string, instruction: string): string
export function triggerWorldbook(input: {
  entries?: WorldbookEntryLike[]
  text?: string
  /** 第 5.7 期：模型的判定（两侧分发）。三者都可缺省 ⇒ 退化为纯字面 keys 触发 */
  concepts?: string[]
  tags?: string[]
  elements?: string[]
  budget?: Partial<WorldbookBudget>
}): TriggerResult
export function buildSlotConditional(input: {
  slot?: string
  instruction?: string | null
  instructionLabel?: string | null
  segment?: string | null
}): SlotConditional
export function buildSlotPreview(input: {
  entries?: WorldbookEntryLike[]
  slot: string
  text?: string
  budget?: Partial<WorldbookBudget>
  instruction?: string | null
  instructionLabel?: string | null
}): { text: string; result: TriggerResult; worldbookText: string; wordCount: number }
export function detectConflicts(entries?: WorldbookEntryLike[]): ConflictHint[]
/**
 * 触发词撞车检查（第 5.5 期 P2）：只比**主键**、只比"会被注入同一个槽位"的两条词条，
 * 且**只提示不阻断**。上百条词条并存时最容易翻车的地方（短词吃掉长词的题面）。
 */
export function detectKeyCollisions(entries?: WorldbookEntryLike[]): Array<
  ConflictHint & { keys: string[]; kind: 'same' | 'subset' }
>
/**
 * 两侧命中判定（第 5.7 期 S3）：解题侧 `concepts∩ 且（tags∩ 或 tags 为空）`；
 * 动画侧 `elements∩ 且 concepts∩`（用考点收窄），`concepts` 为空的通用条才允许纯 element。
 * **元件命中但考点不相交 ⇒ 不命中**（防止"图上有弹簧"就教"弹簧振子"）。
 */
export function matchByConcepts(
  entry: WorldbookEntryLike,
  judgement: { concepts?: string[]; tags?: string[]; elements?: string[] },
): { hit: boolean; via: string | null; matched: { concepts: string[]; tags: string[]; elements: string[] } }
/**
 * 标签撞车（第 5.7 期）：两条词条**考点相交**且共用同一 `tags` 项 ⇒ 提示（不阻断）。
 * 判据里带"考点相交"是因为：考点不相交的两条词条永远不会同时进同一段上下文。
 */
export function detectTagCollisions(entries?: WorldbookEntryLike[]): Array<
  ConflictHint & { tag: string; concepts: string[] }
>
/**
 * 元件撞车（第 5.7 期）：两条词条的 `elements` 有交集 ⇒ 提示（不阻断）。
 * 与标签撞车不同，这条**不要求考点相交**：两条词条都教同一个元件怎么画，本身就是作者该知道的事。
 */
export function detectElementCollisions(entries?: WorldbookEntryLike[]): Array<
  ConflictHint & { element: string; concepts: string[] }
>
