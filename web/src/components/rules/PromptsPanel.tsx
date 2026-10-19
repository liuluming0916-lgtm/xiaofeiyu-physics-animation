/**
 * 提示词卡编辑器（原 `RulesPage` 的 `PromptsPanel`，只搬家、不改行为）。
 *
 * 口径不变：
 *   · 内置正文与我的覆盖并排；
 *   · 能不能保存、哪些记号不能删，全部由服务端回答，前端只显示 `issues`；
 *   · 分组写明"会不会跑"。
 */

import { useCallback, useEffect, useState } from 'react'

import {
  api,
  type PromptCatalog,
  type PromptItem,
  type PromptOpen,
  type RuleIssue,
} from '../../lib/rules-api'
import { Button, IssueList, toIssues } from './shared'

const STATUS_TEXT: Record<string, string> = {
  builtin: '内置',
  ok: '已覆盖',
  stale: '⚠ 内置变过',
  'unknown-base': '⚠ 基线未知',
}

export function PromptsPanel() {
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
                        <span
                          className={`ml-2 shrink-0 text-[11px] ${
                            sel === it.id ? 'text-slate-200' : it.override ? 'text-amber-700' : 'text-slate-400'
                          }`}
                        >
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
