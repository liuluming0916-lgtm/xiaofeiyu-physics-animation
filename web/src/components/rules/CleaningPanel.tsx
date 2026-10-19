/**
 * 本地规则卡编辑器（原 `RulesPage` 的 `CleaningPanel`，只搬家、不改行为）。
 *
 * 口径不变：
 *   · 锁定集是**数据**（`core/cleaner/policy.mjs`），不可禁用、不可改、不可删，永远先跑；
 *   · 非法正则 / 动 @slot 标记的用户规则保存不上；
 *   · 顺序只允许在用户规则之间调整。
 *
 * 顺手修正的旧文案：内置锁定是 **4 条**，不是 3 条
 * （`strip-code-fence` / `strip-function-wrapper` / `drop-console-log` / `trim-edges`）。
 */

import { useCallback, useEffect, useState } from 'react'

import { api, type CleaningRule, type CleaningTable, type RuleIssue } from '../../lib/rules-api'
import { Button, Field, IssueList, toIssues } from './shared'

const EMPTY_RULE: CleaningRule = { id: '', name: '', stage: 'scene_code', pattern: '', flags: 'g', replacement: '', enabled: true }

export function CleaningPanel() {
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
    }, '已加入（排在用户规则最后；它在内置 4 条之后执行）')

  const userRows = (table?.effective ?? []).filter((r) => r.source === 'user')
  const userIndex = (id: string) => userRows.findIndex((r) => r.id === id)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-3">
        <div className="rounded border border-slate-200 bg-white">
          <header className="border-b border-slate-100 px-3 py-2">
            <div className="text-sm font-medium text-slate-900">生效顺序（从上到下执行）</div>
            <div className="text-[11px] text-slate-500">
              前 4 条是**锁定**的内置规则：不可禁用、不可改、不可删，永远先跑。你的规则在它们之后。
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
              }, '已恢复默认（删掉了你的规则表，只剩内置 4 条）')
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
            {['read_problem', 'solve', 'steps', 'answers', 'scene_code', 'worldbook'].map((s) => (
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
