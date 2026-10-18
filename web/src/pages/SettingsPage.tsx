/**
 * 设置页（§15 第三页）—— 第 5 期先落「**世界书管理器 + 实时试触发预览器**」（M7 / M20 / §9.5）。
 *
 * ── 本期这一页能做什么、不能做什么（**必须显式告知，不能含糊**）
 *
 * 能做：
 *   · 卡片列表（分类分栏 / 搜索 / 启用开关 / 常驻与递归标记 / 槽位标记与按槽位筛选）
 *   · 卡片编辑（§9.1 全字段 + 槽位多选 + 正文 + code_examples）
 *   · **实时试触发预览器**：边打字边给出四个区块（命中清单与命中方式 / 解题槽拼接 /
 *     动画槽拼接 / 空槽与截断提示）——**不调用模型、不保存**
 *   · 冲突提示（同名 id / 正则错误 / 递归环 / 未挂槽位 / 双槽无标题）
 *   · 导出 / 导入 JSON 文本
 *
 * 做不到（诚实声明）：
 *   · **写回 `ai-rules/worldbook/`**：浏览器读不到文件系统，需要一个本地服务（排在第 9 步）。
 *     页面里的编辑只存在内存中，"导出 JSON"能拿到文本。
 *   · 完整校验与旧名归一化（`scene_spec` → `scene_code`）在 Node 侧执行，
 *     由门禁 ㉒ 逐条取证；本页的导入只做**形状提示**。
 *
 * ── 为什么"实时试触发"是真的
 *
 * 它调用的是 `web/src/lib/worldbook-engine.js` —— `core/worldbook/engine.mjs` 的
 * **逐字节副本**（构建期判据钉住）。所以这里的拼接结果与真实请求**必然一致**（W10），
 * 而不是"两处写得一样"。
 */

import { useMemo, useState } from 'react'

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
  WORLDBOOK_USER,
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
  /** 词条库（构建期快照 + 本页的内存编辑） */
  const [entries, setEntries] = useState<WorldbookEntryLike[]>(() => [
    ...WORLDBOOK_BUILTIN.map((e) => ({ ...e })),
    ...WORLDBOOK_USER.map((e) => ({ ...e })),
  ])
  const [selectedId, setSelectedId] = useState<string>(() => WORLDBOOK_BUILTIN[0]?.id ?? '')
  const [search, setSearch] = useState('')
  const [slotFilter, setSlotFilter] = useState<SlotFilter>('all')
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

  const selected = entries.find((e) => e.id === selectedId) ?? null

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

  const patch = (id: string, next: Partial<WorldbookEntryLike>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...next } : e)))
  }

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
      if (!q) return true
      return (
        e.id.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.keys.some((k) => k.toLowerCase().includes(q)) ||
        e.content.toLowerCase().includes(q)
      )
    })
  }, [entries, search, slotFilter])

  const grouped = useMemo(() => {
    const map = new Map<string, WorldbookEntryLike[]>()
    for (const e of visible) {
      const list = map.get(e.category) ?? []
      list.push(e)
      map.set(e.category, list)
    }
    return [...map.entries()]
  }, [visible])

  const exportText = useMemo(() => {
    // ⚠ 这里的导出**只是给用户拿到文本**：完整规范化与旧名归一化由 Node 侧执行
    //   （门禁 ㉒ 的 W11/W12 逐条取证）。格式常量从构建期快照来，并由 web-build 判据钉住。
    const userOnly = entries.filter((e) => e.origin === 'user')
    return JSON.stringify({ format: WORLDBOOK_PACK_FORMAT, version: WORLDBOOK_PACK_VERSION, entries: userOnly }, null, 2)
  }, [entries])

  return (
    <div data-od-region="settings-page" className="space-y-4">
      <section data-od-region="worldbook-honesty" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
        这一页是<strong>预览与分析</strong>用的：编辑只存在<strong>本页内存</strong>中，刷新即丢。
        <strong>要真正写回 <code>ai-rules/worldbook/</code>，请去「规则」页的「世界书」页签</strong>（第 6 期已接上本机服务；
        用 <code className="rounded bg-amber-100 px-1">3-OpenRules.bat</code> 打开才可用）。
        本页的预览器<strong>触发与组装是真的</strong>（用的是 <code>core/worldbook/engine.mjs</code> 的逐字节副本）。
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(240px,300px)_1fr_minmax(320px,420px)]">
        {/* ── 左：卡片列表（§9.5） ── */}
        <section data-od-region="worldbook-list" className="rounded-md border border-slate-200 bg-white">
          <header className="border-b border-slate-200 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-900">世界书词条</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              共 {entries.length} 条 · 启用 {enabled.length} 条 · 内置 {WORLDBOOK_BUILTIN.length} 条
            </p>
          </header>

          <div className="space-y-2 border-b border-slate-200 px-3 py-2">
            <input
              data-od-field="worldbook-search"
              aria-label="搜索词条"
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
          </div>

          <div className="max-h-[560px] overflow-y-auto">
            {grouped.length === 0 && <p className="px-3 py-4 text-xs text-slate-500">没有匹配的词条。</p>}
            {grouped.map(([category, list]) => (
              <div key={category}>
                <div className="bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                  {CATEGORY_LABEL[category] ?? category}（{list.length}）
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
                            {e.origin === 'builtin' ? (
                              <span className="rounded bg-slate-100 px-1">内置</span>
                            ) : (
                              <span className="rounded bg-amber-100 px-1 text-amber-700">我的</span>
                            )}
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
              <header className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">编辑词条</h2>
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    data-od-field="worldbook-enabled"
                    checked={selected.enabled}
                    onChange={(e) => patch(selected.id, { enabled: e.target.checked })}
                  />
                  启用
                </label>
              </header>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="id（库内唯一；字母/数字/点/下划线/连字符）">
                  <input
                    className="input"
                    data-od-field="worldbook-id"
                    value={selected.id}
                    onChange={(e) => {
                      const next = e.target.value
                      setEntries((prev) => prev.map((x) => (x.id === selected.id ? { ...x, id: next } : x)))
                      setSelectedId(next)
                    }}
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
                    onChange={(e) => patch(selected.id, { constant: e.target.checked })}
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
            <p className="rounded-md border border-slate-200 bg-white p-4 text-xs text-slate-500">左侧选一条词条开始编辑。</p>
          )}

          {/* ── 导入导出（§9.5 / §9.3 ③：默认只导 origin:user） ── */}
          <div className="rounded-md border border-slate-200 bg-white p-4" data-od-region="worldbook-io">
            <h2 className="text-sm font-semibold text-slate-900">导入 / 导出</h2>
            <p className="mt-1 text-[11px] text-slate-500">
              导出默认只含 <code>origin: user</code> 的词条（§9.3 ③）。格式：<code>{WORLDBOOK_PACK_FORMAT}</code> v
              {WORLDBOOK_PACK_VERSION}。
              <strong>完整校验与旧名归一化（scene_spec → scene_code）在 Node 侧执行</strong>（门禁 ㉒ 的 W11/W12 取证），
              本页导入只做形状提示。
            </p>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <p className="label">导出文本（可复制）</p>
                <textarea className="input h-40 font-mono text-[11px]" data-od-field="worldbook-export" readOnly value={exportText} />
              </div>
              <div>
                <p className="label">导入文本（粘贴后点"检查形状"）</p>
                <textarea
                  className="input h-40 font-mono text-[11px]"
                  data-od-field="worldbook-import"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                <button
                  type="button"
                  data-od-action="worldbook-import-check"
                  className="mt-1 rounded bg-slate-900 px-3 py-1 text-xs text-white"
                  onClick={() => setNotice(checkImportShape(importText))}
                >
                  检查形状
                </button>
              </div>
            </div>
            {notice && (
              <p data-od-region="worldbook-import-notice" className="mt-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
                {notice}
              </p>
            )}
          </div>
        </section>

        {/* ── 右：实时试触发预览器（§9.5 / W15） ── */}
        <section data-od-region="worldbook-preview" className="space-y-3">
          <div className="rounded-md border border-slate-200 bg-white p-3">
            <h2 className="text-sm font-semibold text-slate-900">实时试触发</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              边打字边出结果，<strong>不调用模型、不保存</strong>。用与真实请求同一份引擎代码，所以拼接结果逐字节一致。
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
              <p className="text-xs text-slate-500">本次没有任何词条命中（预览器必须显式说出来）。</p>
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
              {preview.solve.worldbookText || '（该槽本次未注入任何词条）'}
            </pre>
          </Block>

          <Block title="③ 动画槽最终拼接内容" region="worldbook-scene">
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap text-[10px] text-slate-700">
              {preview.scene_code.worldbookText || '（该槽本次未注入任何词条）'}
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

          <Block title="内置词条覆盖率（§19.3）" region="worldbook-coverage">
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
    </div>
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
  return `形状检查通过：${list.length} 条词条。（完整字段校验与旧名归一化在 Node 侧执行，落盘时再做一次。）`
}
