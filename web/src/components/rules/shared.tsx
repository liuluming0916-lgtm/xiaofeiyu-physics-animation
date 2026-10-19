/**
 * 设置页里两个规则编辑器（提示词卡 / 本地规则卡）的共用小件。
 *
 * 从原 `RulesPage` 抽出来，行为不变。抽出的目的只有一个：
 * 设置页要同时承载知识卡、提示词卡、本地规则卡与 AI 帮写，
 * 不能让 1200 行的规则页再整页塞进设置页。
 */

import { RulesApiError, type RuleIssue } from '../../lib/rules-api'

export function IssueList({ issues, warnings }: { issues: RuleIssue[]; warnings?: RuleIssue[] }) {
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

export function Button({
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

export function toIssues(e: unknown): { issues: RuleIssue[]; warnings: RuleIssue[]; message: string } {
  if (e instanceof RulesApiError) return { issues: e.issues, warnings: e.warnings, message: e.message }
  return {
    issues: [{ code: 'client.error', path: '.', message: String(e instanceof Error ? e.message : e) }],
    warnings: [],
    message: '出错了',
  }
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-slate-500">{label}</span>
      {children}
    </label>
  )
}
