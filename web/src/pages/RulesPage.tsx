/**
 * 规则工作室（第 6 期第 5 项的界面）。
 *
 * 四个页签对应 §18 第 6 行的"四类改动"，另加一个**状态**页说明这些规则存在哪、有没有坏：
 *   解题 Prompt / 清洗规则 / 端点与 Key / 工作区状态
 *
 * 三条刻意的界面口径（都不是装饰）：
 *   ① **分组并且写明"会不会跑"**：`worldbook` / `distill` 现在主链路不跑，平铺会让人以为改了有效果；
 *   ② **内置正文与我的覆盖并排**：改之前看得见"原来长什么样"，内置变了还能看行级差异；
 *   ③ **Key 只进不出**：输入框是密码型，列表里永远是打码值，导出按钮拿到的文本里没有 Key。
 *
 * 它不自己判任何东西：能不能保存、位置对不对、有没有撞锁定规则，全部由服务端的
 * 那套 Node 代码回答（前端只显示 `issues`）—— 否则就是"两套判据各说各话"。
 */

import { useCallback, useEffect, useState } from 'react'

import {
  RulesApiError,
  api,
  type CleaningRule,
  type CleaningTable,
  type EndpointConfig,
  type EndpointsPayload,
  type PromptCatalog,
  type PromptItem,
  type PromptOpen,
  type RuleIssue,
  type WorldbookList,
} from '../lib/rules-api'

type Tab = 'prompts' | 'cleaning' | 'endpoints' | 'worldbook' | 'status'

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'prompts', label: '解题 Prompt', hint: '改模型怎么解题、怎么判考点（§10）' },
  { id: 'cleaning', label: '清洗规则', hint: '模型输出的小修补；内置 3 条锁定不可关（§12）' },
  { id: 'endpoints', label: '端点与 Key', hint: '填地址、模型、Key；导出不含 Key（§11）' },
  { id: 'worldbook', label: '世界书', hint: '你自己的词条：能存回 ai-rules/worldbook/（§9）' },
  { id: 'status', label: '工作区状态', hint: '这些规则存在哪、有没有坏（§16）' },
]

export function RulesPage() {
  const [health, setHealth] = useState<'checking' | 'up' | 'down'>('checking')
  const [tab, setTab] = useState<Tab>('prompts')

  useEffect(() => {
    let alive = true
    api
      .health()
      .then(() => alive && setHealth('up'))
      .catch(() => alive && setHealth('down'))
    return () => {
      alive = false
    }
  }, [])

  if (health === 'checking') {
    return <p className="text-sm text-slate-500">正在连接本机规则服务…</p>
  }
  if (health === 'down') {
    return <ServiceDown />
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">规则工作室</h2>
          <p className="mt-1 text-xs text-slate-500">
            改的是 <code className="rounded bg-slate-100 px-1">ai-rules/</code> 下的真实文件：原子写入、逐文件哈希、整批生效或整批失败。
          </p>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1" aria-label="规则分类">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`rounded-md border px-3 py-1.5 text-left text-xs ${
              tab === t.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="block font-medium">{t.label}</span>
            <span className={tab === t.id ? 'text-slate-200' : 'text-slate-400'}>{t.hint}</span>
          </button>
        ))}
      </nav>

      {tab === 'prompts' ? (
        <PromptsPanel />
      ) : tab === 'cleaning' ? (
        <CleaningPanel />
      ) : tab === 'endpoints' ? (
        <EndpointsPanel />
      ) : tab === 'worldbook' ? (
        <WorldbookPanel />
      ) : (
        <StatusPanel />
      )}
    </div>
  )
}

function ServiceDown() {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">连不上本机规则服务</p>
      <p className="mt-2 text-xs leading-relaxed">
        规则在磁盘上（<code>ai-rules/</code>），浏览器自己改不了文件，所以需要一个本机服务。
        请用项目根目录的 <code className="rounded bg-amber-100 px-1">3-OpenRules.bat</code> 打开这个页面
        （它会在 127.0.0.1:8080 起一个服务，同时发页面和接口）。
      </p>
      <p className="mt-2 text-xs">
        你也可以在命令行里跑：<code className="rounded bg-amber-100 px-1">node tools/rules-service.mjs</code>
      </p>
      <p className="mt-2 text-xs text-amber-800">
        如果页面是用旧的 <code>2-OpenUI.bat</code>（纯静态）打开的，那就没有接口可用 —— 那边只能看，不能改。
      </p>
    </div>
  )
}

/* ────────────────────────────── 通用小件 ────────────────────────────── */

function IssueList({ issues, warnings }: { issues: RuleIssue[]; warnings?: RuleIssue[] }) {
  if (!issues.length && !(warnings?.length ?? 0)) return null
  return (
    <div className="space-y-2">
      {issues.map((it, i) => (
        <div key={`e-${i}`} className="rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
          <span className="font-mono text-[11px] text-rose-700">[{it.code}]</span> <span className="font-mono">{it.path}</span>
          <div className="mt-0.5">{it.message}</div>
          {it.hint ? <div className="mt-1 text-rose-700">→ {it.hint}</div> : null}
        </div>
      ))}
      {(warnings ?? []).map((it, i) => (
        <div key={`w-${i}`} className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <span className="font-mono text-[11px]">[{it.code}]</span> {it.message}
          {it.hint ? <div className="mt-1 text-amber-700">→ {it.hint}</div> : null}
        </div>
      ))}
    </div>
  )
}

function Button({
  children,
  onClick,
  disabled,
  tone = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'primary' | 'danger'
}) {
  const cls =
    tone === 'primary'
      ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
      : tone === 'danger'
        ? 'border-rose-300 bg-white text-rose-700 hover:bg-rose-50'
        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  )
}

function toIssues(e: unknown): { issues: RuleIssue[]; warnings: RuleIssue[]; message: string } {
  if (e instanceof RulesApiError) return { issues: e.issues, warnings: e.warnings, message: e.message }
  return { issues: [{ code: 'client.error', path: '.', message: String(e instanceof Error ? e.message : e) }], warnings: [], message: '出错了' }
}

/* ────────────────────────────── 1. Prompt ────────────────────────────── */

const STATUS_TEXT: Record<string, string> = {
  builtin: '内置',
  ok: '已覆盖',
  stale: '⚠ 内置变过',
  'unknown-base': '⚠ 基线未知',
}

function PromptsPanel() {
  const [cat, setCat] = useState<PromptCatalog | null>(null)
  const [sel, setSel] = useState('read_problem')
  const [open, setOpen] = useState<PromptOpen | null>(null)
  const [text, setText] = useState('')
  const [issues, setIssues] = useState<RuleIssue[]>([])
  const [warnings, setWarnings] = useState<RuleIssue[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const refreshCat = useCallback(async () => {
    try {
      setCat(await api.promptCatalog())
    } catch (e) {
      const r = toIssues(e)
      setIssues(r.issues)
    }
  }, [])

  const loadOpen = useCallback(async (id: string) => {
    try {
      const o = await api.prompt(id)
      setOpen(o)
      setText(o.overrideText ?? o.builtinText)
      setIssues([])
      setWarnings([])
      setNote('')
    } catch (e) {
      const r = toIssues(e)
      setIssues(r.issues)
    }
  }, [])

  useEffect(() => {
    void refreshCat()
  }, [refreshCat])

  useEffect(() => {
    void loadOpen(sel)
  }, [sel, loadOpen])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setNote('')
    setIssues([])
    setWarnings([])
    try {
      await fn()
      await refreshCat()
      await loadOpen(sel)
    } catch (e) {
      const r = toIssues(e)
      setIssues(r.issues)
      setWarnings(r.warnings)
      setNote(r.message)
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      const r = await api.savePrompt(sel, text, open?.expectedHash ?? null)
      setWarnings(r.warnings)
      setNote(`已保存（revision ${r.revision}）。下一题生效；正在跑的题仍用它开始时那份。`)
    })

  const reset = () =>
    run(async () => {
      await api.resetPrompt(sel, open?.expectedHash ?? null)
      setNote('已恢复默认（删掉了覆盖副本）。下一题用内置。')
    })

  const rebase = () =>
    run(async () => {
      await api.rebasePrompt(sel)
      setNote('已换基线：正文没动，只是把"我基于哪版内置"更新成现在这版。')
    })

  const groups = ['always', 'conditional', 'not-wired', 'embedded']
  const itemsOf = (g: string) => (cat?.items ?? []).filter((it) => it.group === g)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="space-y-3">
        {cat?.problems?.length ? <IssueList issues={cat.problems} /> : null}
        {groups.map((g) => {
          const items = itemsOf(g)
          if (!items.length) return null
          const first = items[0] as PromptItem
          return (
            <section key={g} className="rounded border border-slate-200 bg-white">
              <header className="border-b border-slate-100 px-2 py-1.5">
                <div className="text-xs font-medium text-slate-800">{first.groupTitle}</div>
                <div className="text-[11px] leading-snug text-slate-500">{first.groupHint}</div>
              </header>
              <ul className="divide-y divide-slate-100">
                {items.map((it) => {
                  const badge = it.override ? STATUS_TEXT[it.override.status] ?? it.override.status : STATUS_TEXT.builtin
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => setSel(it.id)}
                        className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-xs ${
                          sel === it.id ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="truncate">
                          <span className="font-mono">{it.id}</span>
                          <span className={sel === it.id ? 'ml-1 text-slate-300' : 'ml-1 text-slate-400'}>{it.label}</span>
                        </span>
                        <span className={`ml-2 shrink-0 text-[11px] ${sel === it.id ? 'text-slate-200' : it.override ? 'text-amber-700' : 'text-slate-400'}`}>
                          {badge}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
        {cat?.unknownFiles?.length ? (
          <div className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
            <p className="font-medium">工作区里有、但程序不认识的文件：</p>
            {cat.unknownFiles.map((u) => (
              <p key={u.rel} className="mt-1 font-mono">
                {u.rel}
              </p>
            ))}
            <p className="mt-1">这些不会被任何阶段用到（要么改名，要么删掉）。</p>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        {open ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2">
              <div>
                <div className="text-sm font-medium text-slate-900">
                  {open.label} <span className="ml-1 font-mono text-xs text-slate-400">{open.rel}</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  状态：{STATUS_TEXT[open.status] ?? open.status}
                  {open.status === 'stale' ? ' —— 内置这套正文变了，你那份还是老的（下方有差异）' : ''}
                  {open.status === 'unknown-base' ? ' —— 不知道它基于哪版内置（外部改过）' : ''}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button onClick={save} disabled={busy} tone="primary">
                  保存
                </Button>
                <Button onClick={rebase} disabled={busy || !open.overrideText}>
                  换基线
                </Button>
                <Button onClick={reset} disabled={busy || !open.overrideText} tone="danger">
                  恢复默认
                </Button>
              </div>
            </div>

          {/* ⚠ 用 `?? []` 兜底：第 6 期第 5 项的白屏就是"某一份 Prompt 只配了 warnings"导致的 */}
          {(open.requirements?.errors ?? []).length ? (
            <div className="rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-900">
              <p className="font-medium">这份正文里**不能删**的记号（删了保存不上）：</p>
              {(open.requirements?.errors ?? []).map((r) => (
                <p key={r.token} className="mt-1">
                  <span className="font-mono">{r.token}</span> —— {r.why}
                </p>
              ))}
            </div>
          ) : null}

            <IssueList issues={issues} warnings={warnings} />
            {note ? <p className="text-xs text-slate-600">{note}</p> : null}

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700">我的覆盖（实际发出去的就是这段）</span>
                  <span className="text-[11px] text-slate-400">{text.length} 字符</span>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  spellCheck={false}
                  className="h-[26rem] w-full resize-y rounded border border-slate-300 p-2 font-mono text-[12px] leading-relaxed text-slate-800"
                />
                {!open.overrideText ? (
                  <p className="mt-1 text-[11px] text-slate-500">
                    现在显示的是**内置正文**。直接改了保存 = 生成一份覆盖副本；不保存就离开不会改任何东西。
                  </p>
                ) : null}
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-700">内置正文（程序自带的那份）</div>
                <pre className="h-[26rem] overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[12px] leading-relaxed text-slate-600">
                  {open.builtinText}
                </pre>
              </div>
            </div>

            {open.status === 'stale' && open.diff ? (
              <div className="rounded border border-amber-300 bg-amber-50 p-2">
                <div className="text-xs font-medium text-amber-900">
                  内置变了：+ 是内置新加的（也许值得抄进你那份），- 是内置删掉的
                </div>
                <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-amber-900">
                  {open.diff.lines
                    .filter((l) => l.type !== 'same')
                    .map((l) => `${l.type === 'add' ? '+' : '-'} ${l.text}`)
                    .join('\n') || '（只有空白/顺序的差别）'}
                </pre>
                {open.baseSavedAt ? <p className="mt-1 text-[11px] text-amber-700">你这份的基线保存于 {open.baseSavedAt}</p> : null}
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-slate-500">选中左边一份 Prompt 查看。</p>
        )}
      </div>
    </div>
  )
}

/* ────────────────────────────── 2. 清洗规则 ────────────────────────────── */

const EMPTY_RULE: CleaningRule = { id: '', name: '', stage: 'scene_code', pattern: '', flags: 'g', replacement: '', enabled: true }

function CleaningPanel() {
  const [table, setTable] = useState<CleaningTable | null>(null)
  const [draft, setDraft] = useState<CleaningRule>(EMPTY_RULE)
  const [issues, setIssues] = useState<RuleIssue[]>([])
  const [warnings, setWarnings] = useState<RuleIssue[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const t = await api.cleaning()
      // 兜底：接口少给一个数组时按空数组显示，而不是让整个页面崩掉（第 6 期白屏的教训）
      setTable({
        ...t,
        rules: Array.isArray(t.rules) ? t.rules : [],
        effective: Array.isArray(t.effective) ? t.effective : [],
        locked: Array.isArray(t.locked) ? t.locked : [],
      })
    } catch (e) {
      const r = toIssues(e)
      setIssues(r.issues)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (fn: () => Promise<void>, success: string) => {
    setBusy(true)
    setIssues([])
    setWarnings([])
    setNote('')
    try {
      await fn()
      await refresh()
      setNote(success)
    } catch (e) {
      const r = toIssues(e)
      setIssues(r.issues)
      setWarnings(r.warnings)
      setNote(r.message)
    } finally {
      setBusy(false)
    }
  }

  const add = () =>
    run(async () => {
      const r = await api.addRule(draft)
      setWarnings(r.warnings)
      setDraft(EMPTY_RULE)
    }, '已加入（排在用户规则最后；它在内置 3 条之后执行）')

  const userRows = (table?.effective ?? []).filter((r) => r.source === 'user')
  const userIndex = (id: string) => userRows.findIndex((r) => r.id === id)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-3">
        <div className="rounded border border-slate-200 bg-white">
          <header className="border-b border-slate-100 px-3 py-2">
            <div className="text-sm font-medium text-slate-900">生效顺序（从上到下执行）</div>
            <div className="text-[11px] text-slate-500">
              前 3 条是**锁定**的内置规则：不可禁用、不可改、不可删，永远先跑。你的规则在它们之后。
            </div>
          </header>
          <ol className="divide-y divide-slate-100">
            {(table?.effective ?? []).map((row) => (
              <li key={`${row.source}-${row.id}`} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="w-6 shrink-0 text-right font-mono text-slate-400">{row.order}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${
                      row.source === 'locked' ? 'bg-slate-900 text-white' : row.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {row.source === 'locked' ? '锁定' : row.enabled ? '启用' : '停用'}
                  </span>
                  <span className="font-mono text-slate-800">{row.id}</span>
                  <span className="text-slate-500">{row.name}</span>
                  <span className="text-[11px] text-slate-400">stage={row.stage}</span>
                  {row.source === 'user' ? (
                    <span className="ml-auto flex gap-1">
                      <Button
                        onClick={() =>
                          void run(async () => {
                            await api.enableRule(row.id, !row.enabled)
                          }, `已${row.enabled ? '停用' : '启用'} ${row.id}`)
                        }
                        disabled={busy}
                      >
                        {row.enabled ? '停用' : '启用'}
                      </Button>
                      <Button
                        onClick={() => {
                          const i = userIndex(row.id)
                          if (i > 0)
                            void run(async () => {
                              await api.moveRule(row.id, i - 1)
                            }, '已上移')
                        }}
                        disabled={busy || userIndex(row.id) <= 0}
                      >
                        ↑
                      </Button>
                      <Button
                        onClick={() => {
                          const i = userIndex(row.id)
                          if (i < userRows.length - 1)
                            void run(async () => {
                              await api.moveRule(row.id, i + 1)
                            }, '已下移')
                        }}
                        disabled={busy || userIndex(row.id) >= userRows.length - 1}
                      >
                        ↓
                      </Button>
                      <Button
                        tone="danger"
                        onClick={() =>
                          void run(async () => {
                            await api.deleteRule(row.id)
                          }, `已删除 ${row.id}`)
                        }
                        disabled={busy}
                      >
                        删除
                      </Button>
                    </span>
                  ) : null}
                </div>
                {row.source === 'locked' && row.note ? (
                  <div className="mt-1 pl-8 text-[11px] leading-snug text-slate-500">因为它兜住的是：{row.note}</div>
                ) : null}
                {row.source === 'user' && row.pattern ? (
                  <div className="mt-1 pl-8 font-mono text-[11px] text-slate-500">/{row.pattern}/</div>
                ) : null}
              </li>
            ))}
          </ol>
        </div>

        <IssueList issues={issues} warnings={warnings} />
        {note ? <p className="whitespace-pre-wrap text-xs text-slate-600">{note}</p> : null}

        <div className="flex gap-2">
          <Button
            tone="danger"
            disabled={busy || !(table?.rules.length ?? 0)}
            onClick={() =>
              void run(async () => {
                await api.resetCleaning()
              }, '已恢复默认（删掉了你的规则表，只剩内置 3 条）')
            }
          >
            恢复默认（删掉我的全部规则）
          </Button>
          <Button disabled={busy} onClick={() => void refresh()}>
            重新载入
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded border border-slate-200 bg-white p-3">
        <div className="text-sm font-medium text-slate-900">加一条规则</div>
        <p className="text-[11px] leading-snug text-slate-500">
          id / name / stage / pattern / flags / replacement。正则会先试编译：**非法正则保存不上**；动
          <code className="mx-1 rounded bg-slate-100 px-1">@slot</code>
          标记的规则也会被拒（§3.5 零猜测）。
        </p>
        <Field label="id（字母数字._-）">
          <input
            value={draft.id}
            onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            placeholder="pow-rewrite"
          />
        </Field>
        <Field label="名称">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
            placeholder="Math.pow 改写成乘法"
          />
        </Field>
        <Field label="阶段">
          <select
            value={draft.stage}
            onChange={(e) => setDraft({ ...draft, stage: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
          >
            {['read_problem', 'solve', 'steps', 'answers', 'scene_code', 'worldbook', 'distill'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="正则 pattern">
          <input
            value={draft.pattern}
            onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            placeholder="Math\\.pow\\(([^,]+),\\s*2\\)"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="flags">
            <input
              value={draft.flags}
              onChange={(e) => setDraft({ ...draft, flags: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
              placeholder="g"
            />
          </Field>
          <Field label="替换为">
            <input
              value={draft.replacement}
              onChange={(e) => setDraft({ ...draft, replacement: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
              placeholder="($1)*($1)"
            />
          </Field>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button tone="primary" disabled={busy || !draft.id || !draft.pattern} onClick={add}>
            加入
          </Button>
          <span className="text-[11px] text-slate-400">加入后默认启用、排在最后</span>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-slate-500">{label}</span>
      {children}
    </label>
  )
}

/* ────────────────────────────── 3. 端点与 Key ────────────────────────────── */

function emptyEndpoint(): EndpointConfig {
  return {
    id: '',
    displayName: '',
    baseURL: 'https://',
    defaultModel: '',
    visionModel: '',
    apiKeyModelId: null,
    supportsJsonMode: true,
    supportsVision: false,
    enableThinking: false,
    preserveThinking: false,
    timeoutMs: 120000,
  }
}

function EndpointsPanel() {
  const [data, setData] = useState<EndpointsPayload | null>(null)
  const [draft, setDraft] = useState<EndpointConfig>(emptyEndpoint())
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({})
  const [issues, setIssues] = useState<RuleIssue[]>([])
  const [warnings, setWarnings] = useState<RuleIssue[]>([])
  const [note, setNote] = useState('')
  const [testText, setTestText] = useState<Record<string, string>>({})
  const [importText, setImportText] = useState('')
  const [exportText, setExportText] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const d = await api.endpoints()
      // 兜底同清洗面板：形状不对就当空，不崩整页
      setData({
        ...d,
        endpoints: Array.isArray(d.endpoints) ? d.endpoints : [],
        stages: Array.isArray(d.stages) ? d.stages : [],
        stageModels: d.stageModels && typeof d.stageModels === 'object' ? d.stageModels : {},
        keysMasked: d.keysMasked && typeof d.keysMasked === 'object' ? d.keysMasked : {},
        warnings: Array.isArray(d.warnings) ? d.warnings : [],
      })
      setIssues([])
    } catch (e) {
      const r = toIssues(e)
      // 409 = 还没配置：这是"空"而不是"坏"，用空列表显示 + 提示
      if (e instanceof RulesApiError && e.status === 409) {
        setData({ endpoints: [], stageModels: {}, stages: [], keysMasked: {}, keyCount: 0, warnings: [], hash: null })
        setIssues(r.issues)
      } else {
        setIssues(r.issues)
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (fn: () => Promise<void>, success: string) => {
    setBusy(true)
    setIssues([])
    setWarnings([])
    setNote('')
    try {
      await fn()
      await refresh()
      setNote(success)
    } catch (e) {
      const r = toIssues(e)
      setIssues(r.issues)
      setWarnings(r.warnings)
      setNote(r.message)
    } finally {
      setBusy(false)
    }
  }

  const upsert = () =>
    run(async () => {
      if (!data) return
      const list = [...data.endpoints]
      const i = list.findIndex((e) => e.id === draft.id)
      if (i >= 0) list[i] = draft
      else list.push(draft)
      const r = await api.saveEndpoints(list, data.stageModels, data.hash)
      setWarnings(r.warnings)
      setDraft(emptyEndpoint())
    }, '已保存（写盘前已过 §11.2 九条校验）')

  const test = (id: string) =>
    run(async () => {
      const r = await api.testEndpoint(id)
      setTestText({ ...testText, [id]: r.text })
    }, '')

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-3">
        <div className="rounded border border-slate-200 bg-white">
          <header className="border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-900">已配置的端点</header>
          {!(data?.endpoints.length ?? 0) ? (
            <p className="px-3 py-3 text-xs text-slate-500">还没有端点。在右边填一个（地址必须 https，或本机 http://127.0.0.1）。</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(data?.endpoints ?? []).map((ep) => {
                const usedBy = Object.entries(data?.stageModels ?? {})
                  .filter(([, v]) => v === ep.id)
                  .map(([k]) => k)
                return (
                  <li key={ep.id} className="space-y-1 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono text-slate-900">{ep.id}</span>
                      <span className="text-slate-600">{ep.displayName}</span>
                      <span className="text-slate-400">{ep.baseURL}</span>
                      <span className="rounded bg-slate-100 px-1 text-[11px] text-slate-600">{ep.defaultModel}</span>
                      <span className="text-[11px] text-slate-500">Key：{data?.keysMasked[ep.id] ?? '（未设置）'}</span>
                      <span className="ml-auto flex gap-1">
                        <Button disabled={busy} onClick={() => void test(ep.id)}>
                          测试连接
                        </Button>
                        <Button disabled={busy} onClick={() => setDraft(ep)}>
                          编辑
                        </Button>
                        <Button
                          tone="danger"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const r = await api.deleteEndpoint(ep.id)
                              setWarnings(r.warnings)
                            }, `已删除 ${ep.id}（指向它的阶段已置空，Key 也一并删掉）`)
                          }
                        >
                          删除
                        </Button>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>被这些阶段使用：{usedBy.length ? usedBy.join(' / ') : '（无）'}</span>
                      <span className="ml-2 flex items-center gap-1">
                        <input
                          type="password"
                          value={keyDraft[ep.id] ?? ''}
                          onChange={(e) => setKeyDraft({ ...keyDraft, [ep.id]: e.target.value })}
                          placeholder="粘贴 Key（只写本机 keys.json）"
                          className="w-56 rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[11px]"
                        />
                        <Button
                          disabled={busy || !(keyDraft[ep.id] ?? '')}
                          onClick={() =>
                            void run(async () => {
                              await api.setKey(ep.id, keyDraft[ep.id] ?? '')
                              setKeyDraft({ ...keyDraft, [ep.id]: '' })
                            }, `已保存 ${ep.id} 的 Key（不会出现在导出包里）`)
                          }
                        >
                          保存 Key
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api.clearKey(ep.id)
                            }, `已清除 ${ep.id} 的 Key`)
                          }
                        >
                          清除
                        </Button>
                      </span>
                    </div>
                    {testText[ep.id] ? (
                      <pre className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-700">{testText[ep.id]}</pre>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="text-sm font-medium text-slate-900">分阶段指定端点</div>
          <p className="text-[11px] text-slate-500">只有一个端点时可以不设：程序会自动用它。多个端点时必须指定，程序不猜。</p>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
            {(data?.stages ?? []).map((stage) => (
              <Field key={stage} label={stage}>
                <select
                  value={data?.stageModels[stage] ?? ''}
                  onChange={(e) =>
                    void run(async () => {
                      await api.setStage(stage, e.target.value || null)
                    }, `阶段 ${stage} 已更新`)
                  }
                  disabled={busy}
                  className="w-full rounded border border-slate-300 px-1.5 py-1 text-[11px]"
                >
                  <option value="">（未指定）</option>
                  {(data?.endpoints ?? []).map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.id}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        </div>

        <IssueList issues={issues} warnings={warnings} />
        {note ? <p className="whitespace-pre-wrap text-xs text-slate-600">{note}</p> : null}
      </div>

      <div className="space-y-3">
        <div className="space-y-2 rounded border border-slate-200 bg-white p-3">
          <div className="text-sm font-medium text-slate-900">{draft.id ? `编辑端点 ${draft.id}` : '新增端点'}</div>
          <Field label="id（字母数字._-）">
            <input
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
              placeholder="ep_main"
            />
          </Field>
          <Field label="显示名">
            <input
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="我的主力模型"
            />
          </Field>
          <Field label="baseURL（https 或 http://127.0.0.1）">
            <input
              value={draft.baseURL}
              onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            />
          </Field>
          <Field label="默认模型">
            <input
              value={draft.defaultModel}
              onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
              placeholder="deepseek-chat"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="超时（毫秒，≥1000）">
              <input
                type="number"
                value={draft.timeoutMs}
                onChange={(e) => setDraft({ ...draft, timeoutMs: Number(e.target.value) })}
                className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              />
            </Field>
            <label className="mt-4 flex items-center gap-1 text-[11px] text-slate-600">
              <input type="checkbox" checked={draft.supportsVision} onChange={(e) => setDraft({ ...draft, supportsVision: e.target.checked })} />
              支持图片输入
            </label>
          </div>
          <div className="flex gap-1 pt-1">
            <Button tone="primary" disabled={busy || !draft.id || !draft.defaultModel} onClick={upsert}>
              保存端点
            </Button>
            <Button disabled={busy} onClick={() => setDraft(emptyEndpoint())}>
              清空表单
            </Button>
          </div>
        </div>

        <div className="space-y-2 rounded border border-slate-200 bg-white p-3">
          <div className="text-sm font-medium text-slate-900">导出 / 导入</div>
          <p className="text-[11px] leading-snug text-slate-500">
            导出的是**不含 Key** 的那份（导出函数根本不读 keys.json）。带 Key 的文件导入会被拒。
          </p>
          <div className="flex gap-1">
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await api.exportEndpoints()
                  setExportText(r.text)
                }, '已生成导出文本（可直接复制去另一台机器）')
              }
            >
              生成导出文本
            </Button>
          </div>
          {exportText ? (
            <textarea readOnly value={exportText} className="h-40 w-full rounded border border-slate-300 p-2 font-mono text-[11px]" />
          ) : null}
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="把导出文本粘到这里再点导入"
            className="h-24 w-full rounded border border-slate-300 p-2 font-mono text-[11px]"
          />
          <Button
            disabled={busy || !importText.trim()}
            onClick={() =>
              void run(async () => {
                await api.importEndpoints(importText)
                setImportText('')
              }, '已导入（已有 Key 不受影响；请对每个端点跑一次测试连接）')
            }
          >
            导入
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────── 4. 世界书（第 6 期补齐） ────────────────────────────── */

function WorldbookPanel() {
  const [list, setList] = useState<WorldbookList | null>(null)
  const [sel, setSel] = useState('')
  const [text, setText] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [issues, setIssues] = useState<RuleIssue[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('my-entries.json')
  const [builtinId, setBuiltinId] = useState('')

  const refresh = useCallback(async (keep = '') => {
    try {
      const d = await api.worldbook()
      const packs = Array.isArray(d.packs) ? d.packs : []
      setList({ ...d, packs, problems: Array.isArray(d.problems) ? d.problems : [], builtinIds: Array.isArray(d.builtinIds) ? d.builtinIds : [] })
      if (keep && packs.some((p) => p.name === keep)) setSel(keep)
      else if (!packs.some((p) => p.name === sel) && packs.length) setSel(packs[0]?.name ?? '')
    } catch (e) {
      setIssues(toIssues(e).issues)
    }
  }, [sel])

  const load = useCallback(async (name: string) => {
    if (!name) return
    try {
      const p = await api.worldbookPack(name)
      setText(typeof p.text === 'string' ? p.text : '')
      setProblems(Array.isArray(p.problems) ? p.problems : [])
    } catch (e) {
      setIssues(toIssues(e).issues)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void load(sel)
  }, [sel, load])

  const run = async (fn: () => Promise<void>, success: string) => {
    setBusy(true)
    setIssues([])
    setNote('')
    try {
      await fn()
      await refresh(sel)
      await load(sel)
      setNote(success)
    } catch (e) {
      const r = toIssues(e)
      setIssues(r.issues)
      setNote(r.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="space-y-3">
        <div className="rounded border border-slate-200 bg-white">
          <header className="border-b border-slate-100 px-2 py-1.5">
            <div className="text-xs font-medium text-slate-800">我的词条包</div>
            <div className="text-[11px] leading-snug text-slate-500">
              一个文件 = 一个导出包。内置 {list?.builtinCount ?? '—'} 条**只读**；同 id 的用户词条会覆盖内置。
            </div>
          </header>
          {(list?.packs.length ?? 0) === 0 ? (
            <p className="px-2 py-2 text-[11px] text-slate-500">还没有自己的词条包。用右边"从内置复制一条"开始最省事。</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(list?.packs ?? []).map((p) => (
                <li key={p.name}>
                  <button
                    type="button"
                    onClick={() => setSel(p.name)}
                    className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-xs ${
                      sel === p.name ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="truncate font-mono">{p.name}</span>
                    <span className={sel === p.name ? 'ml-2 text-slate-300' : 'ml-2 text-slate-400'}>{p.count} 条</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 rounded border border-slate-200 bg-white p-2">
          <div className="text-xs font-medium text-slate-800">从内置复制一条（生成覆盖副本）</div>
          <select
            value={builtinId}
            onChange={(e) => setBuiltinId(e.target.value)}
            className="w-full rounded border border-slate-300 px-1.5 py-1 text-[11px]"
          >
            <option value="">（选一条内置词条）</option>
            {(list?.builtinIds ?? []).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <Button
            disabled={busy || !builtinId}
            onClick={() =>
              void run(async () => {
                const r = await api.copyBuiltinWorldbook(builtinId)
                setSel(r.name)
              }, '已生成覆盖副本：改它、保存，就覆盖了同 id 的内置那条')
            }
          >
            复制成覆盖副本
          </Button>

          <div className="pt-2 text-xs font-medium text-slate-800">新建空包</div>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded border border-slate-300 px-1.5 py-1 font-mono text-[11px]"
            placeholder="my-entries.json"
          />
          <Button
            disabled={busy || !newName}
            onClick={() =>
              void run(async () => {
                await api.createWorldbookPack(newName)
              }, '已新建空包')
            }
          >
            新建
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2">
          <div>
            <div className="text-sm font-medium text-slate-900">{sel || '（未选中）'}</div>
            <div className="text-[11px] text-slate-500">
              保存前会逐条按 §9.1 校验：**任何一条不合法就整批不写**（不会写进去半套）。
            </div>
          </div>
          <div className="flex gap-1">
            <Button
              tone="primary"
              disabled={busy || !sel}
              onClick={() =>
                void run(async () => {
                  await api.saveWorldbookPack(sel, text)
                }, '已保存（原子写 + 整批校验通过）')
              }
            >
              保存
            </Button>
            <Button disabled={busy || !sel} onClick={() => void load(sel)}>
              重新载入
            </Button>
            <Button
              tone="danger"
              disabled={busy || !sel}
              onClick={() =>
                void run(async () => {
                  await api.deleteWorldbookPack(sel)
                  setSel('')
                  setText('')
                }, '已删除（如果是覆盖副本，内置那条恢复生效）')
              }
            >
              删除
            </Button>
          </div>
        </div>

        <IssueList issues={issues} />
        {problems.length ? (
          <div className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
            <p className="font-medium">这份文件本身有问题（载入时会被整批拒绝）：</p>
            {problems.map((p, i) => (
              <p key={i} className="mt-1 font-mono">
                {p}
              </p>
            ))}
          </div>
        ) : null}
        {note ? <p className="text-xs text-slate-600">{note}</p> : null}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="h-[32rem] w-full resize-y rounded border border-slate-300 p-2 font-mono text-[12px] leading-relaxed text-slate-800"
          placeholder='{ "format": "od-worldbook", "version": 1, "entries": [ … ] }'
        />
        <p className="text-[11px] text-slate-500">
          一个包 = <code>{'{format:"od-worldbook", version:1, entries:[…]}'}</code>。词条字段见{' '}
          <code>contracts/worldbook-entry.schema.json</code>；两个槽位的正文用 <code>## 解题</code> / <code>## 动画建模</code> 分开。
        </p>
      </div>
    </div>
  )
}

/* ────────────────────────────── 5. 状态 ────────────────────────────── */

function StatusPanel() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [issues, setIssues] = useState<RuleIssue[]>([])

  useEffect(() => {
    api
      .status()
      .then(setStatus)
      .catch((e: unknown) => setIssues(toIssues(e).issues))
  }, [])

  const problems = (status?.problems as RuleIssue[] | undefined) ?? []
  const files = (status?.files as Record<string, { sha256: string; bytes: number }> | undefined) ?? {}

  return (
    <div className="space-y-3">
      <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-700">
        <p>
          规则目录：<code className="rounded bg-slate-100 px-1">{String(status?.dir ?? '')}</code>
        </p>
        <p className="mt-1">
          revision：<span className="font-mono">{String(status?.revision ?? '—')}</span>
          <span className="ml-3">已登记文件：{Object.keys(files).length} 个</span>
          <span className="ml-3">可载入：{status?.ok ? '✓ 是' : '✗ 否'}</span>
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          缺文件 = 用内置默认。只有你亲手改过的那一条才会出现在下面的清单里。
        </p>
      </div>

      {problems.length ? <IssueList issues={problems} /> : <p className="text-xs text-emerald-700">✓ 工作区是干净的（每个文件都与登记簿一致）</p>}
      {issues.length ? <IssueList issues={issues} /> : null}

      {Object.keys(files).length ? (
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1">文件</th>
              <th className="py-1">字节</th>
              <th className="py-1">SHA256（前 12）</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(files).map(([rel, f]) => (
              <tr key={rel} className="border-b border-slate-100">
                <td className="py-1 font-mono">{rel}</td>
                <td className="py-1 font-mono text-slate-500">{f.bytes}</td>
                <td className="py-1 font-mono text-slate-500">{f.sha256.slice(0, 12)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
        <p className="font-medium text-slate-700">同一件事也能在命令行做（界面的能力与它一一对应）</p>
        <pre className="mt-1 whitespace-pre-wrap font-mono">{`node core/rules/cli.mjs prompts
node core/rules/cli.mjs cleaning
node core/rules/cli.mjs endpoints
node core/rules/cli.mjs check`}</pre>
        <p className="mt-2">
          改坏了怎么办：界面会拒绝保存并指出位置；如果你是在编辑器里手改坏的，跑一次 <code>node core/rules/cli.mjs check</code>
          就能看到"哪个文件、哪一行"。
        </p>
      </div>
    </div>
  )
}
