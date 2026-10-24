import { useEffect, useState } from 'react'

import { STAGE_NOTE_META, type StageNotes } from '../lib/stage-notes'

export interface StageNotesDialogProps {
  open: boolean
  value: StageNotes
  /** 旧版单框“配图补充描述”：第一次打开时迁移到读题/解题/分析，避免老内容丢失 */
  legacyDescription?: string
  onClose: () => void
  onSave: (notes: StageNotes) => void
}

const emptyNotes = (): StageNotes => ({})

export function StageNotesDialog({ open, value, legacyDescription = '', onClose, onSave }: StageNotesDialogProps) {
  const [draft, setDraft] = useState<StageNotes>(emptyNotes)

  useEffect(() => {
    if (!open) return
    if (Object.keys(value).length) {
      setDraft({ ...value })
      return
    }
    if (legacyDescription.trim()) {
      const text = legacyDescription.trim()
      setDraft({ read_problem: text, solve: text, analysis: text })
      return
    }
    setDraft({})
  }, [open, value, legacyDescription])

  if (!open) return null

  const filled = STAGE_NOTE_META.filter((s) => (draft[s.key] ?? '').trim()).length

  const toggle = (key: (typeof STAGE_NOTE_META)[number]['key'], on: boolean) => {
    setDraft((prev) => {
      const next = { ...prev }
      if (on) next[key] = ''
      else delete next[key]
      return next
    })
  }

  const save = () => {
    const next: StageNotes = {}
    for (const s of STAGE_NOTE_META) {
      const text = (draft[s.key] ?? '').trim()
      if (text) next[s.key] = text
    }
    onSave(next)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">补充信息（按阶段）</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              勾选要注入的阶段，再写该阶段的补充。空着 = 不注入；各阶段互不影响。
            </p>
          </div>
          <button type="button" className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {STAGE_NOTE_META.map((s) => {
            const on = draft[s.key] !== undefined
            return (
              <div key={s.key} className="rounded-lg border border-slate-200 p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <input type="checkbox" checked={on} onChange={(e) => toggle(s.key, e.target.checked)} />
                  {s.label}
                </label>
                <p className="ml-6 mt-1 text-xs text-slate-500">{s.hint}</p>
                <textarea
                  rows={2}
                  disabled={!on}
                  className="mt-2 w-full rounded-md border border-slate-300 p-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                  value={draft[s.key] ?? ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [s.key]: e.target.value }))}
                  placeholder={on ? '写这一阶段需要补充的信息…' : '勾选后才能填写'}
                />
              </div>
            )
          })}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <span className="text-xs text-slate-500">{filled ? `已填 ${filled} 个阶段` : '未填任何阶段'}</span>
          <div className="flex gap-2">
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50" onClick={onClose}>
              取消
            </button>
            <button type="button" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700" onClick={save}>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
