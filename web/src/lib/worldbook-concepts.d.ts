/**
 * ⚠ **手写的类型声明**，对应 `web/src/lib/worldbook-concepts.js` ——
 * 它是 `core/worldbook/concepts.mjs`（第 5.7 期新增的判定解析器）的**逐字节副本**。
 *
 * 为什么手写而不是自动生成：这份声明只描述**前端用到的那几个导出**
 * （`parseJudgement` 与它的返回形状）。构建期有一条判据钉住"声明的名字集合 == 真实导出面"
 * （`tools/web-build.mjs`），所以**漏写/多写都会被拦下**——抄录不会漂移。
 *
 * ⚠ 改 `core/worldbook/concepts.mjs` 的导出面时，必须同步改这里，否则构建失败。
 */

/** 解析出的"表外词"（词表里没有、但模型写了的东西；**如实报出，不许静默丢**） */
export interface JudgementUnknowns {
  concepts: string[]
  tags: string[]
  elements: string[]
}

/** 结构问题（缺段 / 表外词 / 细考点挂不上考点 …） */
export interface JudgementProblem {
  code: string
  field?: string
  word?: string
  owners?: string[]
  selectedConcepts?: string[]
  message?: string
}

export interface JudgementResult {
  /** 考点 id（已按词表归一化；表外词不进这里，进 unknowns） */
  concepts: string[]
  /** 题型标签 / 细考点（已归一化） */
  tags: string[]
  /** 动画元件 id（已归一化） */
  elements: string[]
  unknowns: JudgementUnknowns
  problems: JudgementProblem[]
  /** 【判定依据】原文（判定必须留下可复核的理由） */
  why: string
  raw: Record<string, string>
}

/** 模型判定里允许出现的段标签（容错用；含改名前的旧标签） */
export const JUDGEMENT_SECTIONS: Record<string, readonly string[]>

/** 归一化一个"词"（去包裹符号、NFKC、折叠空白） */
export function normalizeWord(raw: unknown): string

/**
 * 把模型在 `read_problem` 阶段写出的判定段解析成结构化结果。
 * ⚠ 坏输入**不抛异常**（返回空列表 + 进 `problems`）。
 */
export function parseJudgement(text: string, opts?: { vocab?: unknown; index?: unknown }): JudgementResult

/** 别名 → 正式名的归一化索引（含 tag 归属表与冲突清单） */
export function buildVocabIndex(vocab: unknown): {
  conceptsByAlias: Map<string, string>
  conceptIds: Set<string>
  tagOwners: Map<string, string[]>
  tagDuplicates: Array<{ tag: string; alsoIn: string }>
  elementsByAlias: Map<string, string>
  elementIds: Set<string>
  conflicts: { concepts: Array<Record<string, string>>; elements: Array<Record<string, string>> }
}

export function normalizeConcept(word: string, index: unknown): string | null
export function normalizeElement(word: string, index: unknown): string | null
export function normalizeTag(word: string, concepts: string[], index: unknown): { ok: boolean; reason: string | null; owners: string[]; tag?: string }
export function summarizeUnknowns(parsed: JudgementResult): { concept: string[]; tag: string[]; element: string[] }
export function isEmptyJudgement(parsed: JudgementResult): boolean
