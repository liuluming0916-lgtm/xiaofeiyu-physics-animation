/**
 * 规则工作室的**前端唯一出口**（第 6 期第 5 项）。
 *
 * 它与 `tools/rules-service.mjs` 的 `/api/*` 一一对应；页面里不出现裸 `fetch`，
 * 好处是：错误形状只有一种（`RulesApiError` 带 issues/warnings）、路径只写一次、
 * 以后换成别的服务端实现时改这一个文件。
 *
 * 同源：页面由同一个 Node 服务发出来（`127.0.0.1:8080`），所以 `BASE = '/api'`。
 * 用 `python -m http.server` 打开的老方式没有 `/api`，会走到"服务未启动"的兜底提示。
 */

export interface RuleIssue {
  code: string
  path: string
  message: string
  hint?: string
}

export class RulesApiError extends Error {
  readonly status: number
  readonly issues: RuleIssue[]
  readonly warnings: RuleIssue[]

  constructor(message: string, status: number, issues: RuleIssue[], warnings: RuleIssue[]) {
    super(message)
    this.name = 'RulesApiError'
    this.status = status
    this.issues = issues
    this.warnings = warnings
  }
}

const BASE = '/api'

function isIssueList(v: unknown): v is RuleIssue[] {
  return Array.isArray(v)
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, init)
  } catch {
    throw new RulesApiError(
      '连不上规则服务',
      0,
      [{ code: 'service.down', path: '/api', message: '连不上本机服务（请重开一次软件；仍不行就看「启动并诊断.bat」的输出）' }],
      [],
    )
  }

  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }

  if (!res.ok) {
    const rec = (json ?? {}) as Record<string, unknown>
    const issues = isIssueList(rec.issues) ? rec.issues : []
    const warnings = isIssueList(rec.warnings) ? rec.warnings : []
    const first = issues[0]?.message ?? `HTTP ${res.status}`
    throw new RulesApiError(first, res.status, issues, warnings)
  }

  return (json ?? {}) as T
}

/* ────────────────────────────── 形状 ────────────────────────────── */

export interface HealthPayload {
  ok: boolean
  dir: string
  hasWorkspace: boolean
  /** 第 8 期：本次"启动"的编号 —— 动画页的偏好键靠它隔离（重开服务即换新） */
  launchId?: string
}

export interface PromptDiffLine {
  type: 'same' | 'add' | 'del'
  text: string
}

export interface PromptDiff {
  added: number
  removed: number
  changed: number
  lines: PromptDiffLine[]
}

export interface PromptOverride {
  text: string
  sha256: string
  basedOn: { sha256: string; text?: string; savedAt?: string } | null
  status: 'builtin' | 'ok' | 'stale' | 'unknown-base'
  diff: PromptDiff | null
}

export interface PromptItem {
  id: string
  label: string
  duty: string
  group: string
  groupTitle: string
  groupHint: string
  risk: 'high' | 'normal'
  rel: string
  builtinText: string
  builtinSha: string
  override: PromptOverride | null
}

export interface PromptCatalog {
  ok: boolean
  revision: number | null
  problems: RuleIssue[]
  items: PromptItem[]
  unknownFiles: Array<{ rel: string; id: string; message: string; hint: string }>
}

export interface PromptRequirement {
  token: string
  why: string
}

export interface PromptOpen {
  ok: boolean
  id: string
  label: string
  rel: string
  builtinText: string
  overrideText: string | null
  status: PromptOverride['status']
  expectedHash: string | null
  diff: PromptDiff | null
  baseSavedAt: string | null
  requirements: { errors: PromptRequirement[]; warnings: PromptRequirement[] }
}

export interface CleaningRow {
  order: number
  source: 'locked' | 'user'
  id: string
  name: string
  stage: string
  enabled: boolean
  pattern: string | null
  note: string
}

export interface CleaningRule {
  id: string
  name: string
  stage: string
  pattern: string
  flags: string
  replacement: string
  enabled: boolean
}

export interface CleaningTable {
  ok: boolean
  rules: CleaningRule[]
  effective: CleaningRow[]
  locked: Array<{ id: string; name: string; guarantee: string }>
  expectedHash: string | null
}

export interface EndpointConfig {
  id: string
  displayName: string
  baseURL: string
  defaultModel: string
  visionModel: string
  apiKeyModelId: string | null
  supportsJsonMode: boolean
  supportsVision: boolean
  enableThinking: boolean
  preserveThinking: boolean
  timeoutMs: number
}

export interface EndpointsPayload {
  endpoints: EndpointConfig[]
  stageModels: Record<string, string | null>
  stages: string[]
  keysMasked: Record<string, string>
  keyCount: number
  warnings: RuleIssue[]
  hash: string | null
}

export interface ConnectionResult {
  ok: boolean
  code: string
  latencyMs: number | null
  status: number | null
  modelCount: number | null
  message: string
  note?: string
  notice: string
  /**
   * 看图能力的**实测**结论（第 8 期）。服务端会发一张 1×1 PNG 试一次，
   * 所以这里不是"按型号猜"，而是"这家服务商此刻收不收图"。
   */
  vision?: { ok: boolean; code: string; message: string; kind?: string }
}

/* ── 世界书（第 6 期补齐：只写 ai-rules/knowledgecard/） ── */

export interface KnowledgecardPackSummary {
  name: string
  bytes: number
  count: number
  entries: Array<{ id: string; title: string; category: string; origin: string }>
  problems: string[]
}

export interface KnowledgecardList {
  ok: boolean
  dir: string
  packs: KnowledgecardPackSummary[]
  problems: string[]
  builtinCount: number
  builtinIds: string[]
}

export interface KnowledgecardPack {
  ok: boolean
  name: string
  text: string
  bytes: number
  problems: string[]
}

/** 一键恢复本版本内置的结果（`POST /api/knowledgecard/restore`） */
export interface KnowledgecardRestoreResult {
  ok: boolean
  builtinCount: number
  overriddenIds: string[]
  confirmList: string[]
  removed: number
  packsTouched: number
  packsDeleted: number
  backupDir: string
  problems: string[]
}

/** v2 词表项 */
export interface V2VocabElement {
  id: string
  name: string
  aliases: string[]
  primitive: string
  enabled?: boolean
}
export interface V2VocabScene {
  id: string
  name: string
  aliases: string[]
  enabled?: boolean
}
export interface V2Vocab {
  format: string
  version: number
  elements: V2VocabElement[]
  scenes: V2VocabScene[]
}

export type V2CardKind = 'anim_rule' | 'element' | 'scene'
export interface V2Entry {
  id: string
  title: string
  kind: V2CardKind
  origin: 'builtin' | 'user'
  enabled: boolean
  constant?: boolean
  elements?: string[]
  scenes?: string[]
  order?: number
  priority?: 'normal' | 'high'
  content: string
  code_examples?: string[]
}

export interface V2Library {
  ok: boolean
  dir: string
  vocab: V2Vocab
  entries: V2Entry[]
  builtinCount: number
  userCount: number
  problems: string[]
  warnings: string[]
  migration: Array<{ id: string; action: 'convert' | 'disable'; reasons: string[]; warnings: string[] }>
}

/* ────────────────────────────── 接口 ────────────────────────────── */

export const api = {
  health: () => request<HealthPayload>('GET', '/health'),

  status: () => request<Record<string, unknown>>('GET', '/status'),

  promptCatalog: () => request<PromptCatalog>('GET', '/prompts'),
  prompt: (id: string) => request<PromptOpen>('GET', `/prompts/${id}`),
  savePrompt: (id: string, text: string, expectedHash: string | null, force = false) =>
    request<{ ok: boolean; revision: number; warnings: RuleIssue[] }>('PUT', `/prompts/${id}`, { text, expectedHash, force }),
  resetPrompt: (id: string, expectedHash: string | null, force = false) =>
    request<{ ok: boolean; revision: number }>(
      'DELETE',
      `/prompts/${id}?expectedHash=${encodeURIComponent(expectedHash ?? '')}${force ? '&force=1' : ''}`,
    ),
  rebasePrompt: (id: string) => request<{ ok: boolean; revision: number }>('POST', `/prompts/${id}/rebase`),

  cleaning: () => request<CleaningTable>('GET', '/cleaning'),
  addRule: (rule: CleaningRule) => request<{ ok: boolean; warnings: RuleIssue[] }>('POST', '/cleaning/rules', { rule }),
  patchRule: (id: string, patch: Partial<CleaningRule>) =>
    request<{ ok: boolean; warnings: RuleIssue[] }>('PATCH', `/cleaning/rules/${id}`, { patch }),
  deleteRule: (id: string) => request<{ ok: boolean }>('DELETE', `/cleaning/rules/${id}`),
  enableRule: (id: string, enabled: boolean) => request<{ ok: boolean }>('POST', `/cleaning/rules/${id}/enable`, { enabled }),
  moveRule: (id: string, toIndex: number) => request<{ ok: boolean }>('POST', `/cleaning/rules/${id}/move`, { toIndex }),
  resetCleaning: () => request<{ ok: boolean }>('POST', '/cleaning/reset', {}),

  endpoints: () => request<EndpointsPayload>('GET', '/endpoints'),
  saveEndpoints: (endpoints: EndpointConfig[], stageModels: Record<string, string | null>, expectedHash: string | null, force = false) =>
    request<{ ok: boolean; hash: string; warnings: RuleIssue[] }>('PUT', '/endpoints', { endpoints, stageModels, expectedHash, force }),
  setKey: (id: string, key: string) => request<{ ok: boolean }>('POST', `/endpoints/${id}/key`, { key }),
  clearKey: (id: string) => request<{ ok: boolean }>('DELETE', `/endpoints/${id}/key`),
  deleteEndpoint: (id: string) => request<{ ok: boolean; warnings: RuleIssue[] }>('DELETE', `/endpoints/${id}`),
  testEndpoint: (id: string) => request<{ ok: boolean; result: ConnectionResult; text: string }>('POST', `/endpoints/${id}/test`, {}),
  setStage: (stage: string, endpointId: string | null) => request<{ ok: boolean }>('POST', '/endpoints/stage', { stage, endpointId }),
  exportEndpoints: () => request<{ ok: boolean; text: string; hash: string; bytes: number }>('GET', '/endpoints/export'),
  importEndpoints: (text: string) => request<{ ok: boolean; hash: string }>('POST', '/endpoints/import', { text }),

  knowledgecard: () => request<KnowledgecardList>('GET', '/knowledgecard'),
  knowledgecardPack: (name: string) => request<KnowledgecardPack>('GET', `/knowledgecard/packs/${encodeURIComponent(name)}`),
  saveKnowledgecardPack: (name: string, text: string) => request<{ ok: boolean; count: number }>('PUT', `/knowledgecard/packs/${encodeURIComponent(name)}`, { text }),
  createKnowledgecardPack: (name: string) => request<{ ok: boolean; name: string }>('POST', '/knowledgecard/packs', { name }),
  deleteKnowledgecardPack: (name: string) => request<{ ok: boolean }>('DELETE', `/knowledgecard/packs/${encodeURIComponent(name)}`),
  copyBuiltinKnowledgecard: (id: string) => request<{ ok: boolean; name: string }>('POST', '/knowledgecard/copy', { id }),
  restoreKnowledgecardBuiltin: () => request<KnowledgecardRestoreResult>('POST', '/knowledgecard/restore', {}),

  knowledgecardV2: () => request<V2Library>('GET', '/knowledgecard/v2'),
  saveKnowledgecardV2Entry: (entry: V2Entry) =>
    request<{ ok: boolean; entry: V2Entry; name: string }>('POST', '/knowledgecard/v2/entry', { entry }),
  saveKnowledgecardV2VocabState: (disabledElements: string[], disabledScenes: string[]) =>
    request<{ ok: boolean; disabled: { elements: string[]; scenes: string[] } }>('POST', '/knowledgecard/v2/vocab-state', {
      disabledElements,
      disabledScenes,
    }),
  addKnowledgecardV2VocabEntry: (kind: 'element' | 'scene', entry: Record<string, unknown>) =>
    request<{ ok: boolean; kind: string; entry: unknown; warnings: RuleIssue[] }>('POST', '/knowledgecard/v2/vocab-entry', { kind, entry }),
  removeKnowledgecardV2VocabEntry: (kind: 'element' | 'scene', id: string) =>
    request<{ ok: boolean }>('DELETE', '/knowledgecard/v2/vocab-entry', { kind, id }),
}
