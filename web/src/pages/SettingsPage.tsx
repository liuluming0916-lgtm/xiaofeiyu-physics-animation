/**
 * 设置页（§15 第三页）—— v1.1.9alpha 起是**唯一**的规则/知识入口。
 *
 * ── 页面结构（用户 2026-10-19 决议）
 *
 *   知识卡 / 提示词卡 / 本地规则卡 / AI 帮写（本轮只做可见占位）。
 *   原「规则页」与「蒸馏页」删除；端点与 Key 仍走右上角 ⚙ 连接设置。
 *
 * ── 知识卡这一栏能做什么（v1.1.9 起，不再只是"内存预览"）
 *
 *   · 卡片列表 / 编辑 / 启用开关 / 冲突提示 / 实时试触发（不调用模型）
 *   · **保存到本机**：走 `/api/worldbook/*`（`tools/rules-service.mjs`）→ `ai-rules/worldbook/`，
 *     写前滚动备份 5 份、整批校验、原子写；关掉软件再打开还在
 *   · **导入并保存**：粘贴 `od-worldbook` 包 → Node 侧完整校验后落盘
 *   · **一键恢复本版本内置**：只撤销"覆盖内置"的副本，不删用户自己新建的卡
 *
 * ── 两条必须说清的语义
 *
 *   ① **内置只读**。点编辑内置卡 ⇒ 自动生成一条同 id 的 `origin: user` 覆盖副本；
 *      恢复内置 = 删掉这份副本，内置原样生效（§9.3 ④）。
 *   ② **发行版自带本机服务**（Electron 主进程起 `rules-service`），所以装出来就能存；
 *      开发期用 `3-OpenRules.bat` 起同一个服务。连不上时页面会明确说"只读快照，不会落盘"。
 *
 * ── 为什么"实时试触发"是真的
 *
 * 它调用的是 `web/src/lib/worldbook-engine.js` —— `core/worldbook/engine.mjs` 的
 * **逐字节副本**（构建期判据钉住）。所以这里的拼接结果与真实请求**必然一致**（W10）。
 */

import { useEffect, useMemo, useState } from 'react'

import { CleaningPanel } from '../components/rules/CleaningPanel'
import { PromptsPanel } from '../components/rules/PromptsPanel'
import { api } from '../lib/rules-api'
import {
  WORLDBOOK_BUDGET,
  buildSlotPreview,
  detectConflicts,
  type ConflictHint,
} from '../lib/worldbook-engine.js'
/**
 * ⚠ 第 5.7 期：解析器用的是**逐字节副本**（`core/worldbook/concepts.mjs` → 本文件）。
 *   前端绝不另写一份"差不多的解析" —— 那会让"粘贴解析结果"与"真实链路解析结果"
 *   悄悄不一致，而那种不一致看不出来（构建期判据钉住了两份副本的字节）。
 */
import { parseJudgement } from '../lib/worldbook-concepts.js'
import {
  WORLDBOOK_BUILTIN,
  WORLDBOOK_COVERAGE,
  WORLDBOOK_HASH,
  WORLDBOOK_PACK_FORMAT,
  WORLDBOOK_PACK_VERSION,
  WORLDBOOK_SOURCES,
  type WorldbookEntryLike,
} from '../lib/worldbook-demo'

const CATEGORY_LABEL: Record<string, string> = {
  solution_skill: '解题规范',
  scene_modeling: '场景建模',
  both_slot: '双槽',
  user_lore: '用户知识',
}

const SLOT_LABEL: Record<string, string> = { solve: '解题', scene_code: '动画建模' }

const VIA_LABEL: Record<string, string> = {
  key: '主键命中',
  secondary: '次级键命中',
  constant: '常驻',
  recursive: '递归唤醒',
}

const LOGIC_LIST = ['AND_ANY', 'AND_ALL', 'OR', 'NOT'] as const
const LOGIC_LABEL: Record<string, string> = {
  AND_ANY: 'AND_ANY（次级键任一命中）',
  AND_ALL: 'AND_ALL（次级键全部命中）',
  OR: 'OR（主键或次级键任一命中）',
  NOT: 'NOT（主键命中且次级键全部不命中）',
}

type SlotFilter = 'all' | 'solve' | 'scene_code' | 'dual' | 'unmounted'

type CardKind = 'anim_rule' | 'element' | 'scene'
type KindFilter = 'all' | CardKind

const CARD_KINDS: CardKind[] = ['anim_rule', 'element', 'scene']
const KIND_LABEL: Record<CardKind, string> = {
  anim_rule: '动画规范卡',
  element: '元件卡',
  scene: '场景卡',
}
const KIND_FILTER_LABEL: Record<KindFilter, string> = {
  all: '全部类型',
  anim_rule: '动画规范',
  element: '元件',
  scene: '场景',
}

/** 旧包没有 kind ⇒ 按 element；未知值也回落，避免下拉框出现空选项 */
const kindOf = (e: WorldbookEntryLike): CardKind =>
  CARD_KINDS.includes(e.kind as CardKind) ? (e.kind as CardKind) : 'element'

type SettingsTab = 'cards' | 'prompts' | 'cleaning' | 'ai'

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; hint: string }> = [
  { id: 'cards', label: '知识卡', hint: '元件卡 / 场景卡 / 动画规范卡；能存回本机' },
  { id: 'prompts', label: '提示词卡', hint: '按阶段改模型指令；下一题生效' },
  { id: 'cleaning', label: '本地规则卡', hint: '模型输出后处理；内置 4 条锁定' },
  { id: 'ai', label: 'AI 帮写', hint: '生成卡片草稿；本轮只做占位' },
]

/** 一条词条从哪来：内置（只读）或某个用户包（可写） */
type EntrySource = { kind: 'builtin' } | { kind: 'user'; pack: string }

/** 新建卡片默认落这个文件（一卡一文件是内置覆盖副本的做法；用户自建卡集中放这里） */
const DEFAULT_PACK = 'my-cards.json'

const BUILTIN_IDS = new Set(WORLDBOOK_BUILTIN.map((e) => e.id))

/**
 * 落盘前的规范化：只写 §9.1 认识的字段，顺序固定。
 * 客户端对象里有页面自己的状态（比如来源标记），绝不能原样写进词条文件
 * —— `validateEntry` 的 `additionalProperties: false` 会整批拒绝。
 */
function cleanEntry(e: WorldbookEntryLike) {
  return {
    id: e.id,
    title: e.title,
    origin: 'user' as const,
    category: e.category,
    kind: kindOf(e),
    enabled: e.enabled,
    constant: e.constant,
    recursive: e.recursive,
    keys: e.keys,
    secondary_keys: { logic: e.secondary_keys.logic, list: e.secondary_keys.list },
    concepts: e.concepts ?? [],
    tags: e.tags ?? [],
    elements: e.elements ?? [],
    insertion_slot: e.insertion_slot,
    order: e.order,
    priority: e.priority,
    content: e.content,
    code_examples: e.code_examples ?? [],
  }
}

/** 一份 `od-worldbook` 包的文本（与导出的格式完全一致） */
function packText(list: WorldbookEntryLike[]): string {
  return `${JSON.stringify({ format: WORLDBOOK_PACK_FORMAT, version: WORLDBOOK_PACK_VERSION, entries: list.map(cleanEntry) }, null, 2)}\n`
}

const SLOT_FILTER_LABEL: Record<SlotFilter, string> = {
  all: '全部',
  solve: '解题槽',
  scene_code: '动画槽',
  dual: '双槽',
  unmounted: '未挂槽位',
}

/** 一条词条的槽位标记（§9.5 的"槽位标记（解题/动画/双槽/未挂槽）"） */
function slotTagOf(entry: WorldbookEntryLike): { text: string; tone: string } {
  const slots = entry.insertion_slot
  if (slots.length === 0) return { text: '未挂槽位', tone: 'bg-slate-100 text-slate-500' }
  if (slots.length >= 2) return { text: '双槽', tone: 'bg-violet-100 text-violet-700' }
  const only = slots[0] ?? ''
  return only === 'scene_code'
    ? { text: '动画槽', tone: 'bg-emerald-100 text-emerald-700' }
    : { text: '解题槽', tone: 'bg-blue-100 text-blue-700' }
}

function matchesSlotFilter(entry: WorldbookEntryLike, filter: SlotFilter): boolean {
  const slots = entry.insertion_slot
  if (filter === 'all') return true
  if (filter === 'unmounted') return slots.length === 0
  if (filter === 'dual') return slots.length >= 2
  return slots.length === 1 && slots[0] === filter
}

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('cards')

  /** 词条库：构建期内置快照 + 本机用户区（连上服务后会被真实内容替换） */
  const [entries, setEntries] = useState<WorldbookEntryLike[]>(() => WORLDBOOK_BUILTIN.map((e) => ({ ...e })))
  const [selectedId, setSelectedId] = useState<string>(() => WORLDBOOK_BUILTIN[0]?.id ?? '')
  const [search, setSearch] = useState('')
  const [slotFilter, setSlotFilter] = useState<SlotFilter>('all')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [testText, setTestText] = useState(
    '水平传送带以恒定速率 $u=2\\ \\mathrm{m/s}$ 向右运行。将质量 $m=1\\ \\mathrm{kg}$ 的物块无初速轻放在传送带左端，物块与传送带之间的动摩擦因数 $\\mu=0.2$，取 $g=10\\ \\mathrm{m/s^2}$。求共速所用时间与因摩擦产生的热量。',
  )
  const [importText, setImportText] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  /**
   * ── 第 5.7 期：判定（两侧分发的输入） ──
   *
   * 预览器必须能像真实链路那样带上判定，否则"预览器 = 真实请求"（W10）
   * 会在概念分发这条新路径上破掉（两边抽到的词条不是同一批）。
   * 三个字段都是**表内 id**；粘贴一段模型转写可以直接解析出来（用同一份解析器副本）。
   */
  const [jury, setJury] = useState<{ concepts: string[]; tags: string[]; elements: string[] }>({
    concepts: [],
    tags: [],
    elements: [],
  })
  const [judgePaste, setJudgePaste] = useState('')
  const [judgeNote, setJudgeNote] = useState<string | null>(null)

  /* ── v1.1.9：本机落盘（保存 / 导入 / 恢复内置）── */
  const [sourceOf, setSourceOf] = useState<Record<string, EntrySource>>({})
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set())
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [importName, setImportName] = useState('imported.json')
  const [service, setService] = useState<{
    state: 'checking' | 'online' | 'offline'
    dir: string
    builtinCount: number
  }>({ state: 'checking', dir: '', builtinCount: WORLDBOOK_BUILTIN.length })

  const selected = entries.find((e) => e.id === selectedId) ?? null

  /** 从本机读用户区（登录/刷新/保存后都走这里，保证页面 = 磁盘） */
  const loadFromService = async () => {
    setBusy('正在读取本机知识卡库…')
    try {
      const list = await api.worldbook()
      const userEntries: WorldbookEntryLike[] = []
      const nextSource: Record<string, EntrySource> = {}
      for (const p of list.packs) {
        const pack = await api.worldbookPack(p.name)
        let parsed: unknown
        try {
          parsed = JSON.parse(pack.text)
        } catch {
          continue
        }
        const arr = (parsed as { entries?: unknown }).entries
        if (!Array.isArray(arr)) continue
        for (const raw of arr) {
          const e = raw as WorldbookEntryLike
          if (!e || typeof e.id !== 'string' || !e.id) continue
          userEntries.push({ ...e })
          nextSource[e.id] = { kind: 'user', pack: p.name }
        }
      }
      const userIds = new Set(userEntries.map((e) => e.id))
      const merged = [
        ...WORLDBOOK_BUILTIN.filter((b) => !userIds.has(b.id)).map((b) => ({ ...b })),
        ...userEntries,
      ]
      setEntries(merged)
      setSourceOf(nextSource)
      setDirtyIds(new Set())
      setNewIds(new Set())
      setService({ state: 'online', dir: list.dir, builtinCount: list.builtinCount })
      setSelectedId((prev) => (merged.some((e) => e.id === prev) ? prev : (merged[0]?.id ?? '')))
      return true
    } catch (err) {
      setService({ state: 'offline', dir: '', builtinCount: WORLDBOOK_BUILTIN.length })
      setNotice(`连不上本机知识卡库：${(err as Error).message}。当前显示构建期快照，编辑不会落盘。`)
      return false
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    void loadFromService()
    // 只在进页面时读一次；之后由按钮显式刷新（避免编辑中被静默覆盖）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 某条词条当前落在哪个用户包（内置返回 null） */
  const packOf = (id: string): string | null => {
    const s = sourceOf[id]
    return s && s.kind === 'user' ? s.pack : null
  }

  /**
   * 改一条词条。
   * 改内置 ⇒ 立刻转成同 id 的覆盖副本（§9.3 ①），保存时落到 `<id>.json`。
   */
  const patch = (id: string, next: Partial<WorldbookEntryLike>) => {
    const asOverride = packOf(id) === null
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...next, ...(asOverride ? { origin: 'user' } : {}) } : e)),
    )
    if (asOverride) setSourceOf((prev) => ({ ...prev, [id]: { kind: 'user', pack: `${id}.json` } }))
    setDirtyIds((prev) => new Set(prev).add(id))
  }

  const addEntry = () => {
    const id = `local-${Date.now().toString(36)}`
    const entry: WorldbookEntryLike = {
      id,
      title: '新建卡片',
      origin: 'user',
      category: 'scene_modeling',
      kind: 'element',
      enabled: true,
      constant: false,
      recursive: true,
      keys: [],
      secondary_keys: { logic: 'AND_ANY', list: [] },
      concepts: [],
      tags: [],
      elements: [],
      insertion_slot: ['scene_code'],
      order: 1000,
      priority: 'normal',
      content: '# 新建卡片\n\n## 判据\n（什么时候用这张卡）\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] ',
      code_examples: [],
    }
    setEntries((prev) => [entry, ...prev])
    setSourceOf((prev) => ({ ...prev, [id]: { kind: 'user', pack: DEFAULT_PACK } }))
    setNewIds((prev) => new Set(prev).add(id))
    setDirtyIds((prev) => new Set(prev).add(id))
    setSelectedId(id)
    setNotice('已新建一张空白卡：填好内容后点「保存到本机」。')
  }

  /** 只允许"新卡"改 id；已保存的 id 改了会让文件、覆盖关系对不上 */
  const changeId = (oldId: string, raw: string) => {
    const newId = raw.trim()
    if (!newId || newId === oldId) return
    if (entries.some((e) => e.id === newId)) {
      setNotice(`id "${newId}" 已被占用。`)
      return
    }
    setEntries((prev) => prev.map((e) => (e.id === oldId ? { ...e, id: newId } : e)))
    setSourceOf((prev) => {
      const src = prev[oldId]
      const next = { ...prev }
      delete next[oldId]
      if (src) next[newId] = src
      return next
    })
    setNewIds((prev) => {
      const n = new Set(prev)
      if (n.delete(oldId)) n.add(newId)
      return n
    })
    setDirtyIds((prev) => {
      const n = new Set(prev)
      n.delete(oldId)
      n.add(newId)
      return n
    })
    setSelectedId(newId)
  }

  /** 保存：把每条用户词条写回它所属的包；内置不被改到（改过的已转为覆盖副本） */
  const saveAll = async () => {
    if (service.state !== 'online') {
      setNotice('本机服务未启动，无法保存。开发期请用 3-OpenRules.bat 起服务。')
      return
    }
    const groups = new Map<string, WorldbookEntryLike[]>()
    for (const e of entries) {
      const pack = packOf(e.id)
      if (!pack) continue
      const list = groups.get(pack) ?? []
      list.push(e)
      groups.set(pack, list)
    }
    if (groups.size === 0) {
      setNotice('没有需要保存的卡。')
      return
    }
    setBusy('正在保存…')
    try {
      let total = 0
      for (const [pack, list] of groups) {
        await api.saveWorldbookPack(pack, packText(list))
        total += list.length
      }
      await loadFromService()
      setNotice(`已保存 ${total} 张卡到 ${groups.size} 个文件（写前自动备份 5 份）。`)
    } catch (err) {
      setNotice(`保存失败：${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const removeSelected = async () => {
    if (!selected) return
    const pack = packOf(selected.id)
    if (!pack) {
      setNotice('内置卡不能删除；可以关掉「启用」，或编辑它生成覆盖副本。')
      return
    }
    if (!window.confirm(`删除「${selected.title}」？删除前会自动备份。`)) return
    setBusy('正在删除…')
    try {
      const rest = entries.filter((e) => e.id !== selected.id && packOf(e.id) === pack)
      if (rest.length === 0) await api.deleteWorldbookPack(pack)
      else await api.saveWorldbookPack(pack, packText(rest))
      await loadFromService()
      setNotice(`已删除「${selected.title}」。`)
    } catch (err) {
      setNotice(`删除失败：${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  /** 一键恢复本版本内置：只撤销覆盖副本，不删用户自建卡 */
  const restoreBuiltin = async () => {
    if (service.state !== 'online') {
      setNotice('本机服务未启动，无法恢复内置。')
      return
    }
    if (
      !window.confirm(
        '恢复本版本内置卡：会删除你对内置卡的覆盖副本（删除前自动备份）；你自己新建的卡不受影响。继续？',
      )
    ) {
      return
    }
    setBusy('正在恢复内置…')
    try {
      const r = await api.restoreWorldbookBuiltin()
      await loadFromService()
      const extra = r.problems?.length
        ? `；有 ${r.problems.length} 个问题没处理：${r.problems.slice(0, 3).join(' / ')}`
        : ''
      setNotice(
        `已恢复 ${__OD_APP_VERSION__} 内置：撤销覆盖 ${r.removed} 条，涉及 ${r.packsTouched + r.packsDeleted} 个文件${extra}。`,
      )
    } catch (err) {
      setNotice(`恢复失败：${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const importPack = async () => {
    if (service.state !== 'online') {
      setNotice('本机服务未启动，无法导入。')
      return
    }
    const shape = checkImportShape(importText)
    if (!shape.startsWith('形状检查通过')) {
      setNotice(shape)
      return
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(importName)) {
      setNotice('文件名不合法：只允许字母数字 . _ -，并以 .json 结尾。')
      return
    }
    if (!window.confirm(`把导入内容写入 ${importName}？（同名文件会被覆盖，覆盖前自动备份）`)) return
    setBusy('正在导入…')
    try {
      await api.saveWorldbookPack(importName, importText)
      await loadFromService()
      setNotice(`已导入并保存到 ${importName}。`)
    } catch (err) {
      setNotice(`导入失败：${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  /**
   * 词表（供"只能从表里选"的多选与浏览面板用）。
   *
   * ⚠ 来源是**内置词条里出现过的值**（去重）—— 构建期快照里目前没有单独的词表产物。
   *   等 5.9 期写完新库（每条词条都有三栏）时，这里会自然变成全集；
   *   在那之前它只是"当前库里用到的值"，**面板会如实标注这一点**。
   */
  const vocab = useMemo(() => {
    const c = new Set<string>()
    const t = new Set<string>()
    const el = new Set<string>()
    for (const e of entries) {
      for (const x of e.concepts ?? []) c.add(x)
      for (const x of e.tags ?? []) t.add(x)
      for (const x of e.elements ?? []) el.add(x)
    }
    return { concepts: [...c].sort(), tags: [...t].sort(), elements: [...el].sort() }
  }, [entries])

  const enabled = useMemo(() => entries.filter((e) => e.enabled), [entries])

  /** 预览器：两个槽位各跑一次（与真实链路同一份引擎代码，**含判定**） */
  const preview = useMemo(
    () => ({
      solve: buildSlotPreview({ entries: enabled, slot: 'solve', text: testText, ...jury }),
      scene_code: buildSlotPreview({ entries: enabled, slot: 'scene_code', text: testText, ...jury }),
    }),
    [enabled, testText, jury],
  )

  const conflicts = useMemo(() => detectConflicts(entries), [entries])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (!matchesSlotFilter(e, slotFilter)) return false
      if (kindFilter !== 'all' && kindOf(e) !== kindFilter) return false
      if (!q) return true
      return (
        e.id.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.keys.some((k) => k.toLowerCase().includes(q)) ||
        e.content.toLowerCase().includes(q)
      )
    })
  }, [entries, search, slotFilter, kindFilter])

  const grouped = useMemo(() => {
    const map = new Map<CardKind, WorldbookEntryLike[]>()
    for (const e of visible) {
      const k = kindOf(e)
      const list = map.get(k) ?? []
      list.push(e)
      map.set(k, list)
    }
    return CARD_KINDS.filter((k) => map.has(k)).map((k) => [k, map.get(k)!] as const)
  }, [visible])

  const exportText = useMemo(() => {
    // 导出 = 当前所有 user 词条（含覆盖副本），与落盘用同一套规范化。
    const userOnly = entries.filter((e) => packOf(e.id) !== null)
    return `${JSON.stringify(
      { format: WORLDBOOK_PACK_FORMAT, version: WORLDBOOK_PACK_VERSION, entries: userOnly.map(cleanEntry) },
      null,
      2,
    )}\n`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, sourceOf])

  return (
    <div data-od-region="settings-page" className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">设置</h2>
          <p className="mt-1 text-xs text-slate-500">
            知识卡、提示词卡与本地规则卡都在这里。改的是 <code className="rounded bg-slate-100 px-1">ai-rules/</code>{' '}
            下的真实文件：原子写入、整批校验、整批生效或整批失败。
          </p>
        </div>
        <p className="text-[11px] text-slate-500">端点与 Key 在右上角「⚙ 连接设置」。</p>
      </header>

      <nav data-od-region="settings-tabs" className="flex flex-wrap gap-1" aria-label="设置分类">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`rounded-md border px-3 py-1.5 text-left text-xs ${
              tab === t.id
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="block font-medium">{t.label}</span>
            <span className={tab === t.id ? 'text-slate-200' : 'text-slate-400'}>{t.hint}</span>
          </button>
        ))}
      </nav>

      {tab === 'cards' ? (
        <>
      {/* ── v1.1.9：本机落盘工具栏（保存 / 恢复内置 / 重新读取）── */}
      <section data-od-region="worldbook-service" className="rounded-md border border-slate-200 bg-white px-4 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded px-2 py-0.5 font-medium ${
              service.state === 'online'
                ? 'bg-emerald-100 text-emerald-800'
                : service.state === 'checking'
                  ? 'bg-slate-100 text-slate-600'
                  : 'bg-rose-100 text-rose-800'
            }`}
          >
            {service.state === 'online'
              ? '本机知识卡库已连接'
              : service.state === 'checking'
                ? '正在连接本机知识卡库…'
                : '本机服务未启动（只读快照）'}
          </span>
          {service.state === 'online' && (
            <code className="text-[10px] text-slate-500" title="保存位置">
              {service.dir}
            </code>
          )}
          <span className="text-slate-500">
            内置 {service.builtinCount} 条 · 用户 {Object.keys(sourceOf).length} 条
            {dirtyIds.size ? ` · ${dirtyIds.size} 条未保存` : ''}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            data-od-action="worldbook-save"
            className="rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-40"
            disabled={busy !== null || service.state !== 'online' || dirtyIds.size === 0}
            onClick={() => void saveAll()}
          >
            保存到本机{dirtyIds.size ? `（${dirtyIds.size}）` : ''}
          </button>
          <button
            type="button"
            data-od-action="worldbook-restore-builtin"
            className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 disabled:opacity-40"
            disabled={busy !== null || service.state !== 'online'}
            onClick={() => void restoreBuiltin()}
            title="只撤销对内置卡的覆盖副本；你自己新建的卡不受影响"
          >
            恢复 {__OD_APP_VERSION__} 内置
          </button>
          <button
            type="button"
            data-od-action="worldbook-reload"
            className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 disabled:opacity-40"
            disabled={busy !== null}
            onClick={() => {
              if (dirtyIds.size > 0 && !window.confirm(`有 ${dirtyIds.size} 条未保存的修改，重新读取会丢弃。继续？`)) return
              void loadFromService()
            }}
          >
            重新读取
          </button>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          保存到 <code>ai-rules/worldbook/</code>（发布版在{' '}
          <code>{'%APPDATA%\\physics-animation-studio\\data\\ai-rules\\worldbook\\'}</code>）。
          内置只读；<strong>编辑内置会自动生成同 id 的覆盖副本</strong>；「恢复内置」只撤销覆盖，不删你自己新建的卡。
          {busy && <span className="ml-1 font-medium text-slate-700">{busy}</span>}
        </p>
      </section>

      {notice && (
        <p data-od-region="settings-notice" className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
          {notice}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(240px,300px)_1fr_minmax(320px,420px)]">
        {/* ── 左：卡片列表（§9.5） ── */}
        <section data-od-region="worldbook-list" className="rounded-md border border-slate-200 bg-white">
          <header className="border-b border-slate-200 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-900">知识卡</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              共 {entries.length} 条 · 启用 {enabled.length} 条 · 内置 {service.builtinCount} 条 · 用户{' '}
              {Object.keys(sourceOf).length} 条
            </p>
          </header>

          <div className="space-y-2 border-b border-slate-200 px-3 py-2">
            <input
              data-od-field="worldbook-search"
              aria-label="搜索知识卡"
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="搜索 id / 标题 / 关键词 / 正文"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex flex-wrap gap-1" role="group" aria-label="按槽位筛选">
              {(Object.keys(SLOT_FILTER_LABEL) as SlotFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  data-od-action={`worldbook-filter-${f}`}
                  aria-pressed={slotFilter === f}
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    slotFilter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  onClick={() => setSlotFilter(f)}
                >
                  {SLOT_FILTER_LABEL[f]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="按知识卡类型筛选">
              {(Object.keys(KIND_FILTER_LABEL) as KindFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  data-od-action={`worldbook-kind-filter-${f}`}
                  aria-pressed={kindFilter === f}
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    kindFilter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  onClick={() => setKindFilter(f)}
                >
                  {KIND_FILTER_LABEL[f]}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[560px] overflow-y-auto">
            {grouped.length === 0 && <p className="px-3 py-4 text-xs text-slate-500">没有匹配的卡片。</p>}
            {grouped.map(([kind, list]) => (
              <div key={kind}>
                <div className="bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                  {KIND_LABEL[kind]}（{list.length}）
                </div>
                <ul>
                  {list.map((e) => {
                    const tag = slotTagOf(e)
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          data-od-entry={e.id}
                          aria-current={e.id === selectedId ? 'true' : undefined}
                          className={`w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50 ${
                            e.id === selectedId ? 'bg-blue-50' : ''
                          }`}
                          onClick={() => setSelectedId(e.id)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className={`text-xs font-medium ${e.enabled ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                              {e.title}
                            </span>
                            <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${tag.tone}`}>{tag.text}</span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
                            <code>{e.id}</code>
                            <span className="rounded bg-slate-100 px-1">{KIND_LABEL[kindOf(e)]}</span>
                            {packOf(e.id) === null ? (
                              <span className="rounded bg-slate-100 px-1">内置</span>
                            ) : BUILTIN_IDS.has(e.id) ? (
                              <span className="rounded bg-amber-100 px-1 text-amber-700" title={`覆盖副本：${packOf(e.id)}`}>
                                覆盖内置
                              </span>
                            ) : (
                              <span className="rounded bg-amber-100 px-1 text-amber-700" title={`文件：${packOf(e.id)}`}>
                                我的
                              </span>
                            )}
                            {dirtyIds.has(e.id) && <span className="rounded bg-rose-100 px-1 text-rose-700">未保存</span>}
                            {e.constant && <span className="rounded bg-rose-100 px-1 text-rose-700">常驻</span>}
                            {e.recursive && <span className="rounded bg-teal-100 px-1 text-teal-700">递归</span>}
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ── 中：卡片编辑 + 导入导出 ── */}
        <section data-od-region="worldbook-editor" className="space-y-4">
          {selected ? (
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">编辑卡片</h2>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      data-od-field="worldbook-enabled"
                      checked={selected.enabled}
                      onChange={(e) => {
                        const next = e.target.checked
                        if (
                          !next &&
                          kindOf(selected) === 'anim_rule' &&
                          !window.confirm(
                            '这是动画规范卡：停用后动画阶段不再收到这条规范（坐标/单位/阶段表/元件总览），画质可能下降。确定停用？',
                          )
                        ) {
                          return
                        }
                        patch(selected.id, { enabled: next })
                      }}
                    />
                    启用
                  </label>
                  <button
                    type="button"
                    data-od-action="worldbook-new"
                    className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700"
                    onClick={addEntry}
                  >
                    新建
                  </button>
                  <button
                    type="button"
                    data-od-action="worldbook-delete"
                    className="rounded border border-rose-200 px-2 py-0.5 text-[11px] text-rose-700"
                    onClick={() => void removeSelected()}
                    disabled={packOf(selected.id) === null}
                    title={packOf(selected.id) === null ? '内置卡不能删除' : '删除这张用户卡（先备份）'}
                  >
                    删除
                  </button>
                </div>
              </header>
              <p className="mb-2 text-[11px] text-slate-500">
                {packOf(selected.id) === null
                  ? '这是内置卡（只读）。改动会自动转成一条同 id 的「覆盖副本」，保存后生效；要还原点上面的「恢复内置」。'
                  : `这条会保存到 ${packOf(selected.id)}${BUILTIN_IDS.has(selected.id) ? '（覆盖内置）' : ''}。`}
              </p>

              {kindOf(selected) === 'anim_rule' && (!selected.enabled || !selected.constant) ? (
                <p
                  data-od-region="worldbook-anim-rule-disabled-warning"
                  className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900"
                >
                  ⚠ 这张动画规范卡{!selected.enabled ? '已停用' : '已取消常驻'}：动画阶段可能收不到它。它会悄无声息地让画面规范变少，建议保持「启用 + 常驻」。
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="id（库内唯一；已保存的 id 不可改，要换 id 请新建）">
                  <input
                    className="input"
                    data-od-field="worldbook-id"
                    value={selected.id}
                    readOnly={!newIds.has(selected.id)}
                    onChange={(e) => changeId(selected.id, e.target.value)}
                  />
                </Field>
                <Field label="标题">
                  <input
                    className="input"
                    data-od-field="worldbook-title"
                    value={selected.title}
                    onChange={(e) => patch(selected.id, { title: e.target.value })}
                  />
                </Field>
                <Field label="知识卡类型（只影响分组与注入顺序；不影响命中语义）">
                  <select
                    className="input"
                    data-od-field="worldbook-kind"
                    value={kindOf(selected)}
                    onChange={(e) => patch(selected.id, { kind: e.target.value as CardKind })}
                  >
                    {CARD_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="分类（仅分类展示与统计）">
                  <select
                    className="input"
                    data-od-field="worldbook-category"
                    value={selected.category}
                    onChange={(e) => patch(selected.id, { category: e.target.value })}
                  >
                    {Object.keys(CATEGORY_LABEL).map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="来源（origin）：内置只读，编辑会生成 user 覆盖副本">
                  <input className="input bg-slate-50" value={selected.origin} readOnly />
                </Field>
                <Field label="order（同槽位内排序，小在前）">
                  <input
                    type="number"
                    className="input"
                    data-od-field="worldbook-order"
                    value={selected.order}
                    onChange={(e) => patch(selected.id, { order: Number(e.target.value) })}
                  />
                </Field>
                <Field label="priority（预算不足时 high 优先保留）">
                  <select
                    className="input"
                    data-od-field="worldbook-priority"
                    value={selected.priority}
                    onChange={(e) => patch(selected.id, { priority: e.target.value })}
                  >
                    <option value="normal">normal</option>
                    <option value="high">high</option>
                  </select>
                </Field>
              </div>

              <div className="mt-3 flex flex-wrap gap-4">
                <label className="flex items-center gap-1 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    data-od-field="worldbook-constant"
                    checked={selected.constant}
                    onChange={(e) => {
                      const next = e.target.checked
                      if (
                        !next &&
                        kindOf(selected) === 'anim_rule' &&
                        !window.confirm(
                          '这是动画规范卡：取消「常驻」后它只在命中 keys 时注入（当前 keys 可能为空，等于不会注入）。确定取消？',
                        )
                      ) {
                        return
                      }
                      patch(selected.id, { constant: next })
                    }}
                  />
                  常驻（无条件注入）
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    data-od-field="worldbook-recursive"
                    checked={selected.recursive}
                    onChange={(e) => patch(selected.id, { recursive: e.target.checked })}
                  />
                  递归（可被级联唤醒 / 可唤醒别人）
                </label>
              </div>

              <div className="mt-3">
                <p className="label">insertion_slot（槽位名 = 阶段名；两个都选时正文必须用 <code>## 解题</code> / <code>## 动画建模</code> 分开）</p>
                <div className="flex gap-4">
                  {(['solve', 'scene_code'] as const).map((slot) => (
                    <label key={slot} className="flex items-center gap-1 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        data-od-field={`worldbook-slot-${slot}`}
                        checked={selected.insertion_slot.includes(slot)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...selected.insertion_slot, slot]
                            : selected.insertion_slot.filter((s) => s !== slot)
                          patch(selected.id, { insertion_slot: [...new Set(next)].sort() })
                        }}
                      />
                      {SLOT_LABEL[slot]}（<code>{slot}</code>）
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-3">
                <Field label="keys（一行一条；`/…/flags` 视为正则，其余为字面量包含。字面量会做大小写与全半角归一化）">
                  <textarea
                    className="input h-20 font-mono"
                    data-od-field="worldbook-keys"
                    value={selected.keys.join('\n')}
                    onChange={(e) =>
                      patch(selected.id, { keys: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })
                    }
                  />
                </Field>
              </div>

              <div className="mt-3 border-t border-slate-200 pt-2">
                <p className="text-[11px] text-slate-500">
                  第 5.7 期三栏：<strong>只能从词表里选</strong>（点一下加/去）。它们与旧的 <code>keys</code> 是
                  <strong> OR 关系</strong>（灰度）：三栏都空 ⇒ 该词条只走旧的比字路径。
                </p>
                {(
                  [
                    ['concepts', '考点（词表 A）'],
                    ['tags', '题型 / 细考点（词表 B）'],
                    ['elements', '动画元件（原名"器材"）'],
                  ] as const
                ).map(([field, label]) => {
                  const chosen = (selected[field] as string[] | undefined) ?? []
                  const options = vocab[field]
                  return (
                    <div className="mt-2" key={field}>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-slate-700">{label}</span>
                        <span className="text-[10px] text-slate-500">已选 {chosen.length}</span>
                      </div>
                      {options.length === 0 ? (
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          （当前库里还没有词条用过这一栏，所以没有可选项 —— 等 5.9 期写完新库自然补全）
                        </p>
                      ) : (
                        <div
                          className="mt-0.5 flex max-h-24 flex-wrap gap-1 overflow-auto rounded border border-slate-200 p-1"
                          data-od-field={`worldbook-${field}`}
                        >
                          {options.map((v) => {
                            const on = chosen.includes(v)
                            return (
                              <button
                                key={v}
                                type="button"
                                className={
                                  'rounded px-1 text-[10px] ' +
                                  (on ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
                                }
                                onClick={() =>
                                  patch(selected.id, {
                                    [field]: on ? chosen.filter((x) => x !== v) : [...chosen, v],
                                  } as Partial<WorldbookEntryLike>)
                                }
                              >
                                {v}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="次级键逻辑">
                  <select
                    className="input"
                    data-od-field="worldbook-logic"
                    value={selected.secondary_keys.logic}
                    onChange={(e) =>
                      patch(selected.id, { secondary_keys: { ...selected.secondary_keys, logic: e.target.value } })
                    }
                  >
                    {LOGIC_LIST.map((l) => (
                      <option key={l} value={l}>
                        {LOGIC_LABEL[l]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="次级键（一行一条）">
                  <textarea
                    className="input h-20 font-mono"
                    data-od-field="worldbook-secondary"
                    value={selected.secondary_keys.list.join('\n')}
                    onChange={(e) =>
                      patch(selected.id, {
                        secondary_keys: {
                          ...selected.secondary_keys,
                          list: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                        },
                      })
                    }
                  />
                </Field>
              </div>

              <div className="mt-3">
                <Field label="正文 content（Markdown）">
                  <textarea
                    className="input h-56 font-mono text-[11px]"
                    data-od-field="worldbook-content"
                    value={selected.content}
                    onChange={(e) => patch(selected.id, { content: e.target.value })}
                  />
                </Field>
              </div>

              <div className="mt-3">
                <Field label="code_examples（每段之间用一行 --- 分隔）">
                  <textarea
                    className="input h-32 font-mono text-[11px]"
                    data-od-field="worldbook-examples"
                    value={selected.code_examples.join('\n---\n')}
                    onChange={(e) =>
                      patch(selected.id, {
                        code_examples: e.target.value.split(/\n---\n/).map((s) => s.trim()).filter(Boolean),
                      })
                    }
                  />
                </Field>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 bg-white p-4 text-xs text-slate-500">
              左侧选一张卡开始编辑，或
              <button
                type="button"
                data-od-action="worldbook-new-empty"
                className="mx-1 rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700"
                onClick={addEntry}
              >
                新建一条
              </button>
              。
            </div>
          )}

          {/* ── 导入导出（§9.5 / §9.3 ③：默认只导 origin:user） ── */}
          <div className="rounded-md border border-slate-200 bg-white p-4" data-od-region="worldbook-io">
            <h2 className="text-sm font-semibold text-slate-900">导入 / 导出</h2>
            <p className="mt-1 text-[11px] text-slate-500">
              导出含当前全部用户卡（§9.3 ③，含覆盖副本）。格式：<code>{WORLDBOOK_PACK_FORMAT}</code> v
              {WORLDBOOK_PACK_VERSION}。导入会在 <strong>Node 侧做完整校验与旧名归一化</strong>
              （scene_spec → scene_code，门禁 ㉒ 的 W11/W12 取证），通过后直接落盘；不通过会逐条报错。
            </p>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <p className="label">导出文本（可复制）</p>
                <textarea className="input h-40 font-mono text-[11px]" data-od-field="worldbook-export" readOnly value={exportText} />
              </div>
              <div>
                <p className="label">导入文本（粘贴后选文件名，再"导入并保存"）</p>
                <textarea
                  className="input h-40 font-mono text-[11px]"
                  data-od-field="worldbook-import"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <input
                    className="rounded border border-slate-300 px-2 py-1 text-[11px]"
                    data-od-field="worldbook-import-name"
                    aria-label="导入到的文件名"
                    value={importName}
                    onChange={(e) => setImportName(e.target.value)}
                    size={18}
                  />
                  <button
                    type="button"
                    data-od-action="worldbook-import-check"
                    className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700"
                    onClick={() => setNotice(checkImportShape(importText))}
                  >
                    检查形状
                  </button>
                  <button
                    type="button"
                    data-od-action="worldbook-import-save"
                    className="rounded bg-slate-900 px-2 py-1 text-[11px] text-white disabled:opacity-40"
                    disabled={busy !== null || service.state !== 'online'}
                    onClick={() => void importPack()}
                  >
                    导入并保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 右：实时试触发预览器（§9.5 / W15） ── */}
        <section data-od-region="worldbook-preview" className="space-y-3">
          <div className="rounded-md border border-slate-200 bg-white p-3">
            <h2 className="text-sm font-semibold text-slate-900">实时试触发</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              边打字边出结果，<strong>不调用模型、不改磁盘</strong>。用与真实请求同一份引擎代码，所以拼接结果逐字节一致。
            </p>
            <textarea
              className="input mt-2 h-24 text-[11px]"
              data-od-field="worldbook-testtext"
              aria-label="试触发题面文本"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
            />

            {/* ── 第 5.7 期：判定输入（两侧分发的输入；可粘贴模型转写自动解析） ── */}
            <div className="mt-3 border-t border-slate-200 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-700">判定（另一条触发路径）</span>
                <button
                  type="button"
                  className="text-[10px] text-slate-500 underline"
                  data-od-action="worldbook-clear-jury"
                  onClick={() => {
                    setJury({ concepts: [], tags: [], elements: [] })
                    setJudgeNote('已清空判定 —— 触发退化为纯字面 keys（灰度口径）')
                  }}
                >
                  清空
                </button>
              </div>
              <p className="mt-0.5 text-[10px] text-slate-500">
                第 0 步（读题与判定）产出这三样；命中 = 考点相交 且（题型相交 或 题型为空）
                <strong> 或 </strong>动画元件命中（经考点收窄）<strong> 或 </strong>旧的 keys 字面命中。
                {' '}下面的"命中方式"会写清每条走了哪条路。
              </p>
              <textarea
                className="input mt-1 h-20 text-[11px]"
                data-od-field="worldbook-judge-paste"
                aria-label="粘贴模型转写以自动解析判定"
                placeholder="把模型在【读题与判定】阶段的一段输出粘到这里，会自动解析出考点/题型/动画元件"
                value={judgePaste}
                onChange={(e) => setJudgePaste(e.target.value)}
              />
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  className="rounded border border-slate-300 px-2 py-0.5 text-[10px]"
                  data-od-action="worldbook-parse-judge"
                  onClick={() => {
                    if (!judgePaste.trim()) {
                      setJudgeNote('粘贴内容为空 —— 没有可解析的东西')
                      return
                    }
                    const p = parseJudgement(judgePaste)
                    setJury({ concepts: p.concepts, tags: p.tags, elements: p.elements })
                    const unk = [...p.unknowns.concepts, ...p.unknowns.tags, ...p.unknowns.elements]
                    setJudgeNote(
                      `解析：考点 ${p.concepts.length} · 题型 ${p.tags.length} · 动画元件 ${p.elements.length}` +
                        (unk.length ? ` · 表外词 ${unk.length} 个（已如实报出，不许静默丢）：${unk.join('、')}` : '') +
                        (p.problems.length ? ` · 结构问题 ${p.problems.length} 条` : ''),
                    )
                  }}
                >
                  解析粘贴内容
                </button>
                {judgeNote && <span className="text-[10px] text-slate-600">{judgeNote}</span>}
              </div>
              <div className="mt-1 space-y-1 text-[10px] text-slate-700">
                <div>
                  <span className="text-slate-500">考点 </span>
                  {jury.concepts.length ? jury.concepts.join('、') : <span className="text-slate-400">（空 ⇒ 该条路径不触发）</span>}
                </div>
                <div>
                  <span className="text-slate-500">题型 </span>
                  {jury.tags.length ? jury.tags.join('、') : <span className="text-slate-400">（空）</span>}
                </div>
                <div>
                  <span className="text-slate-500">动画元件 </span>
                  {jury.elements.length ? jury.elements.join('、') : <span className="text-slate-400">（空）</span>}
                </div>
              </div>
            </div>
          </div>

          {/* ── 词表浏览面板（计划 §S5：两套词表可浏览） ── */}
          <Block title="⑤ 词表（只能从表里选；当前库用到的值）" region="worldbook-vocab">
            <p className="text-[10px] text-slate-500">
              判定与标注**只能**取这三张表里的值。表的**单源真相**是 <code>contracts/worldbook-concepts.json</code>
              （schema 枚举、Prompt 注入、这里的三张清单都从它派生）。
              本期 137 条老词条还没带三栏 ⇒ 这里显示的是"**当前库里已经用到的值**"（含 0 条时为空），
              全集等 5.9 期写完新库自然补全。
            </p>
            <div className="mt-1 grid grid-cols-1 gap-2 text-[10px] md:grid-cols-3">
              <div>
                <div className="font-medium text-slate-700">考点（{vocab.concepts.length} 个已用）</div>
                <div className="mt-0.5 max-h-32 overflow-auto rounded border border-slate-200 p-1">
                  {vocab.concepts.length ? vocab.concepts.join('、') : <span className="text-slate-400">（空）</span>}
                </div>
              </div>
              <div>
                <div className="font-medium text-slate-700">题型标签（{vocab.tags.length} 条已用）</div>
                <div className="mt-0.5 max-h-32 overflow-auto rounded border border-slate-200 p-1">
                  {vocab.tags.length ? vocab.tags.join('、') : <span className="text-slate-400">（空）</span>}
                </div>
              </div>
              <div>
                <div className="font-medium text-slate-700">动画元件（{vocab.elements.length} 个已用）</div>
                <div className="mt-0.5 max-h-32 overflow-auto rounded border border-slate-200 p-1">
                  {vocab.elements.length ? vocab.elements.join('、') : <span className="text-slate-400">（空）</span>}
                </div>
              </div>
            </div>
          </Block>

          <Block title="① 命中清单与命中方式" region="worldbook-hits">
            {preview.solve.result.provenance.length === 0 ? (
              <p className="text-xs text-slate-500">本次没有任何卡片命中（预览器必须显式说出来）。</p>
            ) : (
              <ul className="space-y-1">
                {preview.solve.result.provenance.map((p) => (
                  <li key={p.entry_id} className="text-[11px] text-slate-700">
                    <span className="font-medium">{p.title}</span>
                    <span className="ml-1 rounded bg-slate-100 px-1 text-[10px]">{VIA_LABEL[p.via] ?? p.via}</span>
                    {p.from && <span className="ml-1 text-[10px] text-slate-500">← {p.from}</span>}
                    <span className="ml-1 text-[10px] text-slate-500">
                      注入 {p.injectedSlots.map((s) => SLOT_LABEL[s] ?? s).join(' / ') || '（无）'}
                      {p.truncated ? ' · 被截断' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title="② 解题槽最终拼接内容" region="worldbook-solve">
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap text-[10px] text-slate-700">
              {preview.solve.worldbookText || '（该槽本次未注入任何卡片）'}
            </pre>
          </Block>

          <Block title="③ 动画槽最终拼接内容" region="worldbook-scene">
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap text-[10px] text-slate-700">
              {preview.scene_code.worldbookText || '（该槽本次未注入任何卡片）'}
            </pre>
          </Block>

          <Block title="④ 空槽提示与截断告警" region="worldbook-slots">
            <p className="text-[11px] text-slate-700">
              空槽（静默跳过）：{preview.solve.result.emptySlots.length ? preview.solve.result.emptySlots.map((s) => SLOT_LABEL[s] ?? s).join(' / ') : '无'}
            </p>
            <p className="mt-1 text-[11px] text-slate-700">
              被截断（必须告警）：
              {preview.solve.result.truncatedSlots.length === 0
                ? '无'
                : preview.solve.result.truncatedSlots
                    .map((t) => `${SLOT_LABEL[t.slot] ?? t.slot} 丢弃 ${t.dropped} 条`)
                    .join(' / ')}
            </p>
            <p className="mt-1 text-[10px] text-slate-500">
              预算：深度 {WORLDBOOK_BUDGET.maxDepth} · 每槽 {WORLDBOOK_BUDGET.maxEntries} 条 · 每槽{' '}
              {WORLDBOOK_BUDGET.maxChars} 字符
            </p>
            {preview.solve.result.warnings.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {preview.solve.result.warnings.map((w) => (
                  <li key={`${w.code}-${w.entryId ?? ''}-${w.slot ?? ''}`} className="text-[10px] text-amber-800">
                    ⚠ {w.message}
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title="冲突提示（提示不阻断）" region="worldbook-conflicts">
            {conflicts.length === 0 ? (
              <p className="text-xs text-slate-500">没有发现冲突。</p>
            ) : (
              <ul className="space-y-0.5">
                {conflicts.map((c, i) => (
                  <li key={`${c.code}-${i}`} className={`text-[11px] ${toneOfLevel(c)}`}>
                    {c.message}
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title="内置卡覆盖率（§19.3）" region="worldbook-coverage">
            <p className="text-[11px] text-slate-700">
              共 {WORLDBOOK_COVERAGE.total} 条 · 结构合规{' '}
              <strong>{(WORLDBOOK_COVERAGE.structuralRate * 100).toFixed(0)}%</strong>
              （自检条款 {(WORLDBOOK_COVERAGE.selfCheckCoverage * 100).toFixed(0)}% · code_examples{' '}
              {(WORLDBOOK_COVERAGE.exampleCoverage * 100).toFixed(0)}%）
            </p>
            <p className="mt-1 text-[11px] text-amber-800">
              内容覆盖：<strong>未完成</strong> —— {WORLDBOOK_COVERAGE.reason}
            </p>
            <p className="mt-1 text-[10px] text-slate-500">库哈希 {WORLDBOOK_HASH.slice(0, 16)}…</p>
            <ul className="mt-1 space-y-0.5">
              {WORLDBOOK_SOURCES.map((s) => (
                <li key={s.name} className="text-[10px] text-slate-500">
                  {s.kind === 'builtin' ? '内置' : '用户'} · {s.name} · {s.count} 条 · {s.sha256.slice(0, 10)}…
                </li>
              ))}
            </ul>
          </Block>
        </section>
      </div>
        </>
      ) : tab === 'prompts' ? (
        <PromptsPanel />
      ) : tab === 'cleaning' ? (
        <CleaningPanel />
      ) : (
        <AiDraftPlaceholder />
      )}
    </div>
  )
}

/* ────────────────────────────── AI 帮写（本轮占位） ────────────────────────────── */

function AiDraftPlaceholder() {
  return (
    <section data-od-region="settings-ai-draft" className="rounded-md border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">AI 帮写</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
            目标流程：描述你要的卡片 → 生成草稿 → 立即在设置页编辑 → 导入 / 导出。
            <strong>不自动保存、不自动发布</strong>；草稿仍然要走本机校验，保存动作永远由你点。
          </p>
        </div>
        <button
          type="button"
          disabled
          title="本轮只做入口占位，暂不调用模型"
          className="cursor-not-allowed rounded border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-slate-400"
        >
          AI 帮写（暂未开放）
        </button>
      </div>
      <div className="mt-4 rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
        <p className="font-medium text-slate-700">这一版为什么先占位</p>
        <p className="mt-1">
          生成草稿需要模型调用、JSON 容错、C1 校验与失败修复；这些不在 v1.1.9alpha 的页面合并范围内。
          先把入口固定在这里，避免下个版本又在导航栏里多一个入口。
        </p>
        <p className="mt-2">
          现在可用：左侧「知识卡」里新建 / 编辑 / 导入 / 保存到本机；「提示词卡」与「本地规则卡」各自有保存按钮。
        </p>
      </div>
    </section>
  )
}

/* ────────────────────────────── 小组件 ────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

function Block({ title, region, children }: { title: string; region: string; children: React.ReactNode }) {
  return (
    <div data-od-region={region} className="rounded-md border border-slate-200 bg-white p-3">
      <h3 className="mb-1 text-xs font-semibold text-slate-800">{title}</h3>
      {children}
    </div>
  )
}

function toneOfLevel(c: ConflictHint): string {
  if (c.level === 'error') return 'text-rose-700'
  if (c.level === 'warn') return 'text-amber-800'
  return 'text-slate-600'
}

/** 导入的**形状提示**（不做完整校验：那在 Node 侧，见文件头说明） */
function checkImportShape(text: string): string {
  if (!text.trim()) return '先粘贴导出包文本。'
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch (err) {
    return `不是合法 JSON：${(err as Error).message}`
  }
  if (typeof obj !== 'object' || obj === null) return '顶层必须是对象。'
  const rec = obj as Record<string, unknown>
  const problems: string[] = []
  if (rec.format !== WORLDBOOK_PACK_FORMAT) problems.push(`format 必须是 "${WORLDBOOK_PACK_FORMAT}"`)
  if (rec.version !== WORLDBOOK_PACK_VERSION) problems.push(`version 必须是 ${WORLDBOOK_PACK_VERSION}`)
  if (!Array.isArray(rec.entries)) problems.push('entries 必须是数组')
  if (problems.length) return `形状有问题：${problems.join('；')}`
  const list = rec.entries as unknown[]
  return `形状检查通过：${list.length} 张卡。（完整字段校验与旧名归一化在 Node 侧执行，落盘时再做一次。）`
}
