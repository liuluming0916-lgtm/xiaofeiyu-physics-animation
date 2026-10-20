/**
 * 知识卡 v2 面板（Phase 3C-1）。
 *
 * 只做“读整库 + 编辑已有卡 + 保存到本机”。
 * 新建卡 / 新增词表 / 导入导出 / 删除保护放在 3C-2。
 *
 * 为什么单独一个组件：旧 SettingsPage 的知识卡区是 v1 字段（keys/考点/题型/槽位），
 * 直接改它 1,450 行风险太大；先并行一个 v2 面板，旧面板保留但不再挂 tab。
 */

import { useEffect, useMemo, useState } from 'react'

import { api, type V2CardKind, type V2Entry, type V2Library, type V2ParsedJudgement } from '../../lib/rules-api'

const KIND_LABEL: Record<V2CardKind, string> = {
  anim_rule: '动画规范',
  element: '元件卡',
  scene: '场景卡',
}

const KIND_TONE: Record<V2CardKind, string> = {
  anim_rule: 'bg-rose-100 text-rose-700',
  element: 'bg-blue-100 text-blue-700',
  scene: 'bg-emerald-100 text-emerald-700',
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const examplesToText = (list?: string[]) => (list ?? []).join('\n\n---\n\n')
const textToExamples = (text: string) =>
  text
    .split(/\n\s*---\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)

export function KnowledgecardV2Panel() {
  const [lib, setLib] = useState<V2Library | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<V2Entry | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | V2CardKind>('all')
  const [newCardOpen, setNewCardOpen] = useState(false)
  const [newKind, setNewKind] = useState<V2CardKind>('element')
  const [newTrigger, setNewTrigger] = useState('')
  const [vocabFormOpen, setVocabFormOpen] = useState(false)
  const [vocabKind, setVocabKind] = useState<'element' | 'scene'>('element')
  const [vocabForm, setVocabForm] = useState({ id: '', name: '', aliases: '', primitive: 'Draw.box' })
  const [vocabBusy, setVocabBusy] = useState(false)
  const [ioBusy, setIoBusy] = useState(false)
  const [judgeText, setJudgeText] = useState('')
  const [parsed, setParsed] = useState<V2ParsedJudgement | null>(null)
  const [parseBusy, setParseBusy] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.knowledgecardV2()
      setLib(data)
      const keep = selectedId && data.entries.some((e) => e.id === selectedId) ? selectedId : data.entries[0]?.id ?? null
      setSelectedId(keep)
      const picked = data.entries.find((e) => e.id === keep) ?? null
      setDraft(picked ? clone(picked) : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLib(null)
      setDraft(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 实时试触发：用户粘贴 read_problem 的回复 → 后端用同一份 v2 词表解析
   * → 前端只看命中，不调模型、不改磁盘。
   * 350ms 防抖，避免每敲一个字都打一次 HTTP。
   */
  useEffect(() => {
    const text = judgeText.trim()
    if (!text) {
      setParsed(null)
      setParseError(null)
      setParseBusy(false)
      return
    }
    let live = true
    const timer = window.setTimeout(async () => {
      setParseBusy(true)
      try {
        const r = await api.parseKnowledgecardV2Judgement(text)
        if (live) {
          setParsed(r)
          setParseError(null)
        }
      } catch (e) {
        if (live) {
          setParsed(null)
          setParseError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (live) setParseBusy(false)
      }
    }, 350)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [judgeText])

  const original = useMemo(() => lib?.entries.find((e) => e.id === selectedId) ?? null, [lib, selectedId])
  const dirty = useMemo(() => Boolean(draft && original && JSON.stringify(draft) !== JSON.stringify(original)), [draft, original])

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = (lib?.entries ?? []).filter((e) => {
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false
      if (!q) return true
      return `${e.id} ${e.title} ${e.content}`.toLowerCase().includes(q)
    })
    const order: V2CardKind[] = ['anim_rule', 'element', 'scene']
    return order
      .map((kind) => ({ kind, list: list.filter((e) => e.kind === kind) }))
      .filter((g) => g.list.length > 0)
  }, [lib, search, kindFilter])

  const usedBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of lib?.entries ?? []) {
      for (const id of e.elements ?? []) m.set(`e:${id}`, (m.get(`e:${id}`) ?? 0) + 1)
      for (const id of e.scenes ?? []) m.set(`s:${id}`, (m.get(`s:${id}`) ?? 0) + 1)
    }
    return m
  }, [lib])

  const select = (e: V2Entry) => {
    if (dirty && !window.confirm('当前卡有未保存改动，确定切换？')) return
    setSelectedId(e.id)
    setDraft(clone(e))
    setNotice(null)
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const r = await api.saveKnowledgecardV2Entry(draft)
      const saved = r.entry
      setLib((prev) => {
        if (!prev) return prev
        const exists = prev.entries.some((e) => e.id === saved.id)
        return {
          ...prev,
          entries: exists ? prev.entries.map((e) => (e.id === saved.id ? saved : e)) : [...prev.entries, saved],
          userCount: exists && prev.entries.find((e) => e.id === saved.id)?.origin === 'user' ? prev.userCount : prev.userCount + 1,
        }
      })
      setDraft(clone(saved))
      setNotice(`已保存到 ${r.name}（用户覆盖副本；内置卡原件不动）`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const createCard = () => {
    if (!lib) return
    const firstElement = lib.vocab.elements.find((e) => e.enabled !== false)?.id ?? ''
    const firstScene = lib.vocab.scenes.find((s) => s.enabled !== false)?.id ?? ''
    const trigger = newTrigger || (newKind === 'element' ? firstElement : newKind === 'scene' ? firstScene : '')
    if (newKind === 'element' && !trigger) {
      setError('没有可用元件；先在右侧新增/启用一个元件词条。')
      return
    }
    if (newKind === 'scene' && !trigger) {
      setError('没有可用场景；先在右侧新增/启用一个场景词条。')
      return
    }
    const entry: V2Entry = {
      id: `local-${Date.now().toString(36)}`,
      title: '新建卡片',
      kind: newKind,
      origin: 'user',
      enabled: true,
      ...(newKind === 'anim_rule' ? { constant: true } : {}),
      ...(newKind === 'element' ? { elements: [trigger] } : {}),
      ...(newKind === 'scene' ? { scenes: [trigger] } : {}),
      order: 1000,
      priority: 'normal',
      content: '# 新建卡片\n\n## 判据\n（什么时候用这张卡）\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] ',
      code_examples: [],
    }
    setLib((prev) => (prev ? { ...prev, entries: [...prev.entries, entry], userCount: prev.userCount + 1 } : prev))
    setSelectedId(entry.id)
    setDraft(entry)
    setNewCardOpen(false)
    setNotice('新卡已建（未保存）；改完点“保存到本机”。')
  }

  const applyVocabEnabled = async (keys: string[], enabled: boolean) => {
    if (!lib || keys.length === 0) return
    setVocabBusy(true)
    setError(null)
    try {
      const de = new Set(lib.vocab.elements.filter((e) => e.enabled === false).map((e) => e.id))
      const ds = new Set(lib.vocab.scenes.filter((s) => s.enabled === false).map((s) => s.id))
      for (const key of keys) {
        const [kind, id = ''] = key.split(':')
        if (!id) continue
        if (kind === 'e') {
          if (enabled) de.delete(id)
          else de.add(id)
        } else if (kind === 's') {
          if (enabled) ds.delete(id)
          else ds.add(id)
        }
      }
      await api.saveKnowledgecardV2VocabState([...de], [...ds])
      await load()
      setNotice(enabled ? `已启用 ${keys.length} 个词条` : `已关闭 ${keys.length} 个词条（不会从词表删除）`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setVocabBusy(false)
    }
  }

  const addVocab = async () => {
    if (!vocabForm.id.trim() || !vocabForm.name.trim()) {
      setError('词表项 id / 名字不能为空。')
      return
    }
    setVocabBusy(true)
    setError(null)
    try {
      await api.addKnowledgecardV2VocabEntry(vocabKind, {
        id: vocabForm.id.trim(),
        name: vocabForm.name.trim(),
        aliases: vocabForm.aliases.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
        ...(vocabKind === 'element' ? { primitive: vocabForm.primitive.trim() } : {}),
      })
      setVocabForm({ id: '', name: '', aliases: '', primitive: 'Draw.box' })
      setVocabFormOpen(false)
      await load()
      setNotice(`已新增${vocabKind === 'element' ? '元件' : '场景'}词条`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setVocabBusy(false)
    }
  }

  const deleteCard = async () => {
    if (!draft) return
    if (draft.origin === 'builtin') {
      setError('内置卡不能删除；只能停用，或编辑后保存成覆盖副本。')
      return
    }
    if (!window.confirm(`删除用户卡「${draft.title}」？\n会先备份，再删 ${draft.id}.json。`)) return
    setIoBusy(true)
    setError(null)
    try {
      await api.deleteKnowledgecardV2Entry(draft.id)
      setSelectedId(null)
      setDraft(null)
      await load()
      setNotice(`已删除 ${draft.id}（删前已备份）`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIoBusy(false)
    }
  }

  const exportBundle = async () => {
    setIoBusy(true)
    setError(null)
    try {
      const r = await api.exportKnowledgecardV2()
      const blob = new Blob([r.text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = r.name
      a.click()
      URL.revokeObjectURL(url)
      setNotice(`已导出 ${r.entries} 张用户卡 + 用户词表（${r.elements} 元件 / ${r.scenes} 场景）`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIoBusy(false)
    }
  }

  const importBundle = async (file: File) => {
    if (!window.confirm(`导入「${file.name}」？\n会先把包里的用户词表合并进来，再写卡；任何一张不合法就整包拒绝。`)) return
    setIoBusy(true)
    setError(null)
    try {
      const text = await file.text()
      const r = await api.importKnowledgecardV2(text)
      await load()
      setNotice(`已导入 ${r.entries} 张卡；新增词表 ${r.vocabAdded.elements} 元件 / ${r.vocabAdded.scenes} 场景`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIoBusy(false)
    }
  }

  const restoreBuiltin = async () => {
    if (!window.confirm('恢复内置：会删除所有“内置卡的覆盖副本”，不删你自己新建的卡。继续？')) return
    setIoBusy(true)
    setError(null)
    try {
      const r = await api.restoreKnowledgecardV2Builtin()
      await load()
      setNotice(`已恢复内置：撤销覆盖 ${r.removed} 条`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIoBusy(false)
    }
  }

  const removeVocab = async (kind: 'element' | 'scene', id: string) => {
    if (!window.confirm(`删除用户词表项「${id}」？\n内置项不能删；删除后引用它的卡会变成“触发已关闭”。`)) return
    setVocabBusy(true)
    setError(null)
    try {
      await api.removeKnowledgecardV2VocabEntry(kind, id)
      await load()
      setNotice(`已删除用户词表项 ${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setVocabBusy(false)
    }
  }

  const disabledKeys = useMemo(() => {
    const s = new Set<string>()
    for (const e of lib?.vocab.elements ?? []) if (e.enabled === false) s.add(`e:${e.id}`)
    for (const x of lib?.vocab.scenes ?? []) if (x.enabled === false) s.add(`s:${x.id}`)
    return s
  }, [lib])

  const isTriggerDisabled = (entry: V2Entry | null) => {
    if (!entry) return false
    return [...(entry.elements ?? []).map((id) => `e:${id}`), ...(entry.scenes ?? []).map((id) => `s:${id}`)].some((k) => disabledKeys.has(k))
  }

  const previewHits = useMemo(() => {
    const rank: Record<V2CardKind, number> = { anim_rule: 0, element: 1, scene: 2 }
    const entries = (lib?.entries ?? []).map((e) => (e.id === draft?.id ? draft : e)).filter((e) => e.enabled !== false)
    const els = new Set(parsed?.elements ?? [])
    const sc = new Set(parsed?.scenes ?? [])
    const list = entries
      .map((e) => {
        let via: string | null = null
        if (e.constant) via = '常驻'
        else if (e.kind === 'element' && (e.elements ?? []).some((id) => els.has(id))) via = '元件命中'
        else if (e.kind === 'scene' && (e.scenes ?? []).some((id) => sc.has(id))) via = '场景命中'
        if (!via) return null
        const chars = (e.content ?? '').length + (e.code_examples ?? []).join('').length
        return { entry: e, via, chars }
      })
      .filter(Boolean) as Array<{ entry: V2Entry; via: string; chars: number }>
    list.sort((a, b) => rank[a.entry.kind] - rank[b.entry.kind] || (a.entry.order ?? 100) - (b.entry.order ?? 100))
    return { list, chars: list.reduce((n, x) => n + x.chars, 0) }
  }, [lib, draft, parsed])

  if (loading) return <p className="rounded border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">正在读取知识卡库…</p>

  if (error && !lib) {
    return (
      <div className="rounded border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900">
        <p className="font-medium">连不上本机知识卡服务</p>
        <p className="mt-1 text-xs">{error}</p>
        <p className="mt-2 text-xs">
          开发期请用 <code className="rounded bg-white px-1">3-OpenRules.bat</code> 起服务；发布版请从桌面快捷方式启动。
        </p>
        <button type="button" className="mt-3 rounded border border-rose-300 px-3 py-1 text-xs" onClick={() => void load()}>
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-od-region="knowledgecard-v2">
      <section className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">知识卡</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            触发只来自词表：元件卡按 <code>elements</code>，场景卡按 <code>scenes</code>，动画规范卡常驻。
          </p>
        </div>
        <div className="text-right text-[11px] text-slate-500">
          <div>
            内置 {lib?.builtinCount ?? 0} · 用户 {lib?.userCount ?? 0} · 元件 {lib?.vocab.elements.length ?? 0} · 场景{' '}
            {lib?.vocab.scenes.length ?? 0}
          </div>
          <div className="mt-1 flex flex-wrap justify-end gap-2">
            <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700" onClick={() => setNewCardOpen((v) => !v)}>
              新建卡
            </button>
            <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 disabled:opacity-40" disabled={ioBusy} onClick={() => void exportBundle()}>
              导出知识卡包
            </button>
            <label className={`cursor-pointer rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 ${ioBusy ? 'opacity-40' : ''}`}>
              导入知识卡包
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                disabled={ioBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.currentTarget.value = ''
                  if (f) void importBundle(f)
                }}
              />
            </label>
            <button
              type="button"
              data-od-action="knowledgecard-restore-builtin"
              className="rounded border border-rose-300 px-2 py-0.5 text-[11px] text-rose-700 disabled:opacity-40"
              disabled={ioBusy}
              onClick={() => void restoreBuiltin()}
            >
              恢复本版内置
            </button>
            <button type="button" className="underline" onClick={() => void load()}>
              重新读取
            </button>
          </div>
        </div>
      </section>

      {newCardOpen && (
        <section className="rounded border border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] text-slate-600">
              类型
              <select
                className="ml-1 rounded border border-slate-300 px-2 py-1 text-[11px]"
                value={newKind}
                onChange={(e) => {
                  const k = e.target.value as V2CardKind
                  setNewKind(k)
                  setNewTrigger(k === 'element' ? lib?.vocab.elements.find((x) => x.enabled !== false)?.id ?? '' : k === 'scene' ? lib?.vocab.scenes.find((x) => x.enabled !== false)?.id ?? '' : '')
                }}
              >
                <option value="element">元件卡</option>
                <option value="scene">场景卡</option>
                <option value="anim_rule">动画规范卡</option>
              </select>
            </label>
            {newKind !== 'anim_rule' && (
              <label className="text-[11px] text-slate-600">
                触发
                <select
                  className="ml-1 rounded border border-slate-300 px-2 py-1 text-[11px]"
                  value={newTrigger}
                  onChange={(e) => setNewTrigger(e.target.value)}
                >
                  <option value="">（先选）</option>
                  {(newKind === 'element' ? (lib?.vocab.elements ?? []) : (lib?.vocab.scenes ?? []))
                    .filter((x) => x.enabled !== false)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.id}｜{x.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <button type="button" className="rounded bg-slate-900 px-3 py-1 text-[11px] text-white" onClick={createCard}>
              建一张
            </button>
            <span className="text-[10px] text-slate-500">建完在中间改内容，再点“保存到本机”。</span>
          </div>
        </section>
      )}

      {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>}
      {notice && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div>}
      {lib?.problems?.length ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <div className="font-medium">库里有 {lib.problems.length} 条问题（不阻断显示）：</div>
          <ul className="mt-1 list-disc pl-5">
            {lib.problems.slice(0, 5).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {lib?.migration?.length ? (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          旧卡迁移：{lib.migration.filter((m) => m.action === 'convert').length} 张已转换，
          {lib.migration.filter((m) => m.action === 'disable').length} 张停用（只有 keys/考点、无 elements）。
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* 左：卡列表 */}
        <section className="lg:col-span-3 rounded border border-slate-200 bg-white">
          <div className="border-b border-slate-100 p-3">
            <input
              className="input w-full text-xs"
              placeholder="搜索 id / 标题 / 正文"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {(['all', 'anim_rule', 'element', 'scene'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`rounded border px-2 py-0.5 text-[10px] ${
                    kindFilter === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'
                  }`}
                  onClick={() => setKindFilter(k)}
                >
                  {k === 'all' ? '全部' : KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[620px] overflow-y-auto">
            {grouped.length === 0 && <p className="px-3 py-4 text-xs text-slate-500">没有匹配的卡。</p>}
            {grouped.map((g) => (
              <div key={g.kind}>
                <div className="bg-slate-50 px-3 py-1 text-[10px] font-medium text-slate-500">
                  {KIND_LABEL[g.kind]}（{g.list.length}）
                </div>
                <ul>
                  {g.list.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        className={`w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50 ${
                          e.id === selectedId ? 'bg-blue-50' : ''
                        }`}
                        onClick={() => select(e)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className={`text-xs font-medium ${e.enabled ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                            {e.title}
                          </span>
                          <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${KIND_TONE[e.kind]}`}>{KIND_LABEL[e.kind]}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[9px] text-slate-500">
                          <code>{e.id}</code>
                          <span className="rounded bg-slate-100 px-1">{e.origin === 'builtin' ? '内置' : '用户'}</span>
                          {e.constant && <span className="rounded bg-rose-100 px-1 text-rose-700">常驻</span>}
                          {!e.enabled && <span className="rounded bg-slate-200 px-1">停用</span>}
                          {isTriggerDisabled(e) && <span className="rounded bg-amber-100 px-1 text-amber-800">触发关闭</span>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* 中：编辑 */}
        <section className="lg:col-span-6 rounded border border-slate-200 bg-white p-4">
          {draft ? (
            <>
              <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${KIND_TONE[draft.kind]}`}>{KIND_LABEL[draft.kind]}</span>
                    <code className="text-[11px] text-slate-500">{draft.id}</code>
                    <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-600">
                      {draft.origin === 'builtin' ? '内置（保存=生成用户覆盖副本）' : '用户卡'}
                    </span>
                  </div>
                  <input
                    className="input mt-2 w-full text-sm font-medium"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                    />
                    启用
                  </label>
                  <button
                    type="button"
                    className="rounded border border-rose-300 px-2 py-1.5 text-xs text-rose-700 disabled:opacity-40"
                    disabled={ioBusy || draft.origin === 'builtin'}
                    title={draft.origin === 'builtin' ? '内置卡不能删除；只能停用或保存成覆盖副本' : '删除用户卡'}
                    onClick={() => void deleteCard()}
                  >
                    删除
                  </button>
                  <button
                    type="button"
                    data-od-action="knowledgecard-save"
                    className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-40"
                    disabled={!dirty || saving}
                    onClick={() => void save()}
                  >
                    {saving ? '保存中…' : '保存到本机'}
                  </button>
                </div>
              </header>

              {isTriggerDisabled(draft) && (
                <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  ⚠ 这张卡的触发词条在“词表开关”里被关闭了：它现在不会命中。需要时在右栏重新启用，或改触发对象。
                </div>
              )}

              <div className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                {draft.kind === 'anim_rule' && <p>常驻卡：每道题都会注入，不需要触发条件。</p>}
                {draft.kind === 'element' && (
                  <div>
                    <p className="font-medium">触发：模型判出下列任一元件时注入</p>
                    <select
                      multiple
                      size={Math.min(6, Math.max(3, lib?.vocab.elements.length ?? 3))}
                      className="mt-1 w-full rounded border border-slate-300 bg-white text-[11px]"
                      value={draft.elements ?? []}
                      onChange={(e) =>
                        setDraft({ ...draft, elements: Array.from(e.target.selectedOptions).map((o) => o.value) })
                      }
                    >
                      {(lib?.vocab.elements ?? []).map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.id}｜{e.name}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[10px] text-slate-500">Ctrl / Cmd 多选；至少 1 个。</p>
                  </div>
                )}
                {draft.kind === 'scene' && (
                  <div>
                    <p className="font-medium">触发：模型判出这个场景时注入</p>
                    <select
                      className="mt-1 w-full rounded border border-slate-300 bg-white text-[11px]"
                      value={draft.scenes?.[0] ?? ''}
                      onChange={(e) => setDraft({ ...draft, scenes: e.target.value ? [e.target.value] : [] })}
                    >
                      <option value="">（未选）</option>
                      {(lib?.vocab.scenes ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.id}｜{s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <label className="mb-1 block text-[11px] font-medium text-slate-700">正文（Markdown）</label>
              <textarea
                className="input h-56 w-full font-mono text-[11px]"
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              />

              <label className="mb-1 mt-3 block text-[11px] font-medium text-slate-700">
                示例（多段用单独一行 <code>---</code> 分隔；会原样给模型看）
              </label>
              <textarea
                className="input h-28 w-full font-mono text-[10px]"
                value={examplesToText(draft.code_examples)}
                onChange={(e) => setDraft({ ...draft, code_examples: textToExamples(e.target.value) })}
              />

              <details className="mt-3 rounded border border-slate-200 px-3 py-2">
                <summary className="cursor-pointer text-[11px] text-slate-600">高级（order / priority）</summary>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-[10px] text-slate-500">
                    order
                    <input
                      type="number"
                      className="input mt-0.5 w-full text-[11px]"
                      value={draft.order ?? 100}
                      onChange={(e) => setDraft({ ...draft, order: Number(e.target.value) })}
                    />
                  </label>
                  <label className="text-[10px] text-slate-500">
                    priority
                    <select
                      className="input mt-0.5 w-full text-[11px]"
                      value={draft.priority ?? 'normal'}
                      onChange={(e) => setDraft({ ...draft, priority: e.target.value as 'normal' | 'high' })}
                    >
                      <option value="normal">normal</option>
                      <option value="high">high</option>
                    </select>
                  </label>
                </div>
              </details>
            </>
          ) : (
            <p className="text-sm text-slate-500">左侧选一张卡。</p>
          )}
        </section>

        {/* 实时试触发：用户模拟 read_problem 的回复，后端用同一份词表解析 */}
        <section className="lg:col-span-3 rounded border border-slate-200 bg-white p-3">
          <h3 className="text-xs font-semibold text-slate-800">实时试触发</h3>
          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
            把模型在【读题与判定】阶段的回复粘到这里；自动解析【动画元件】【场景】，看当前库（含正在编辑的这张）命中谁。
          </p>

          <textarea
            className="input mt-2 h-28 w-full font-mono text-[10px]"
            placeholder={'【动画元件】belt、block\n【场景】conveyor_block\n【判定依据】水平传送带上的物块'}
            value={judgeText}
            onChange={(e) => setJudgeText(e.target.value)}
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
            {parseBusy ? '解析中…' : judgeText.trim() ? '已按当前回复解析' : '粘贴后自动解析；空着时只显示常驻卡'}
          </div>
          {parseError && <p className="mt-1 rounded bg-rose-50 px-2 py-1 text-[10px] text-rose-700">{parseError}</p>}

          {parsed && (
            <div className="mt-2 space-y-1 rounded border border-slate-100 bg-slate-50 p-2 text-[10px]">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-medium text-slate-700">解析：</span>
                <span>元件 {parsed.elements.length}</span>
                <span>· 场景 {parsed.scenes.length}</span>
                {parsed.problems.length > 0 && <span className="text-amber-700">· 结构问题 {parsed.problems.length}</span>}
              </div>
              {(parsed.elements.length > 0 || parsed.scenes.length > 0) && (
                <div className="flex flex-wrap gap-1">
                  {parsed.elements.map((id) => (
                    <span key={`e-${id}`} className="rounded bg-blue-100 px-1 text-blue-800">{id}</span>
                  ))}
                  {parsed.scenes.map((id) => (
                    <span key={`s-${id}`} className="rounded bg-emerald-100 px-1 text-emerald-800">{id}</span>
                  ))}
                </div>
              )}
              {parsed.problems.length > 0 && (
                <ul className="list-disc pl-4 text-amber-800">
                  {parsed.problems.slice(0, 3).map((p, i) => (
                    <li key={`${p.code}-${i}`}>{p.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {draft && (
            <div className={`mt-2 rounded px-2 py-1 text-[10px] ${previewHits.list.some((x) => x.entry.id === draft.id) ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
              当前编辑卡：{previewHits.list.some((x) => x.entry.id === draft.id) ? '会命中' : '不会命中'}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-600">
            <span>
              命中 <strong>{previewHits.list.length}</strong> 张 · 正文约 <strong>{previewHits.chars}</strong> 字
            </span>
            {isTriggerDisabled(draft) && <span className="rounded bg-amber-100 px-1 text-amber-800">当前卡触发已关闭</span>}
          </div>

          <ul className="mt-1 max-h-36 space-y-0.5 overflow-y-auto rounded border border-slate-100 p-2 text-[10px]">
            {previewHits.list.length === 0 && <li className="text-slate-400">（无命中；至少会命中 3 张常驻规范卡）</li>}
            {previewHits.list.map((x) => (
              <li key={x.entry.id} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-slate-400">{x.via}</span>
                <span className="truncate text-slate-700">{x.entry.title}</span>
                <span className="ml-auto shrink-0 text-slate-400">{x.chars} 字</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 词表与开关（放在编辑卡片下面） */}
        <aside className="lg:col-span-12 rounded border border-slate-200 bg-white p-3">
          <h3 className="text-xs font-semibold text-slate-800">词表与开关</h3>
          <p className="mt-0.5 text-[10px] text-slate-500">
            关闭 = 只从 Prompt/触发里拿掉，不删词条；按当前章节/教学进度自由开关。
          </p>

          <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-slate-500">
            逐个点右侧勾选框即可启用/关闭；不会删除词条。
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <div className="text-[10px] font-medium text-slate-600">动画元件（{lib?.vocab.elements.length ?? 0}）</div>
            <div className="mt-1 max-h-56 overflow-y-auto rounded border border-slate-100">
              {(lib?.vocab.elements ?? []).map((e) => {
                const key = `e:${e.id}`
                const enabled = e.enabled !== false
                return (
                  <div key={e.id} className={`border-b border-slate-50 px-2 py-1 text-[10px] ${enabled ? '' : 'bg-slate-50 opacity-60'}`}>
                    <div className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        title={enabled ? '关闭（不删词条）' : '启用'}
                        checked={enabled}
                        disabled={vocabBusy}
                        onChange={(ev) => void applyVocabEnabled([key], ev.target.checked)}
                      />
                      <code className="text-slate-800">{e.id}</code>
                      <span className="ml-auto text-slate-400">×{usedBy.get(key) ?? 0}</span>
                      {e.origin === 'user' && (
                        <button type="button" className="text-[9px] text-rose-600 underline" onClick={() => void removeVocab('element', e.id)}>
                          删
                        </button>
                      )}
                    </div>
                    <div className="ml-10 text-slate-500">{e.name}</div>
                    <div className="ml-10 text-[9px] text-slate-400">{e.primitive}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-3">
            <div className="text-[10px] font-medium text-slate-600">场景（{lib?.vocab.scenes.length ?? 0}）</div>
            <div className="mt-1 max-h-44 overflow-y-auto rounded border border-slate-100">
              {(lib?.vocab.scenes ?? []).map((s) => {
                const key = `s:${s.id}`
                const enabled = s.enabled !== false
                return (
                  <div key={s.id} className={`border-b border-slate-50 px-2 py-1 text-[10px] ${enabled ? '' : 'bg-slate-50 opacity-60'}`}>
                    <div className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        title={enabled ? '关闭（不删词条）' : '启用'}
                        checked={enabled}
                        disabled={vocabBusy}
                        onChange={(ev) => void applyVocabEnabled([key], ev.target.checked)}
                      />
                      <code className="text-slate-800">{s.id}</code>
                      <span className="ml-auto text-slate-400">×{usedBy.get(key) ?? 0}</span>
                      {s.origin === 'user' && (
                        <button type="button" className="text-[9px] text-rose-600 underline" onClick={() => void removeVocab('scene', s.id)}>
                          删
                        </button>
                      )}
                    </div>
                    <div className="ml-10 text-slate-500">{s.name}</div>
                  </div>
                )
              })}
            </div>
          </div>
          </div>

          <details className="mt-3 rounded border border-slate-200 px-2 py-1.5" open={vocabFormOpen} onToggle={(e) => setVocabFormOpen((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-[10px] font-medium text-slate-700">新增词表项</summary>
            <div className="mt-2 space-y-1">
              <select
                className="w-full rounded border border-slate-300 px-1 py-0.5 text-[10px]"
                value={vocabKind}
                onChange={(e) => setVocabKind(e.target.value as 'element' | 'scene')}
              >
                <option value="element">元件</option>
                <option value="scene">场景</option>
              </select>
              <input
                className="w-full rounded border border-slate-300 px-1 py-0.5 text-[10px]"
                placeholder="id（英文/数字/._-）"
                value={vocabForm.id}
                onChange={(e) => setVocabForm({ ...vocabForm, id: e.target.value })}
              />
              <input
                className="w-full rounded border border-slate-300 px-1 py-0.5 text-[10px]"
                placeholder="中文名"
                value={vocabForm.name}
                onChange={(e) => setVocabForm({ ...vocabForm, name: e.target.value })}
              />
              <input
                className="w-full rounded border border-slate-300 px-1 py-0.5 text-[10px]"
                placeholder="别名（逗号分隔，可空）"
                value={vocabForm.aliases}
                onChange={(e) => setVocabForm({ ...vocabForm, aliases: e.target.value })}
              />
              {vocabKind === 'element' && (
                <input
                  className="w-full rounded border border-slate-300 px-1 py-0.5 text-[10px]"
                  placeholder="画法，如 Draw.box"
                  value={vocabForm.primitive}
                  onChange={(e) => setVocabForm({ ...vocabForm, primitive: e.target.value })}
                />
              )}
              <button
                type="button"
                className="w-full rounded bg-slate-900 px-2 py-1 text-[10px] text-white disabled:opacity-40"
                disabled={vocabBusy}
                onClick={() => void addVocab()}
              >
                新增
              </button>
              <p className="text-[9px] text-slate-500">内置项不能删除，只能在上面的开关里关闭；这里只新增。</p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  )
}
