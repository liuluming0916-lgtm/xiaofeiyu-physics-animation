/**
 * 蒸馏页（§15 第五页 / M19 简版的前端）
 *
 * 用户 2026-10-17 的裁决：**不做 PDF 解析**，所以这一页的输入只有两种：
 *   · 丢图片（扫描页导出成 PNG/JPG 拖进来）
 *   · 粘文字（把教辅正文贴进文本框，按"一页"算）
 *
 * 流程严格照 §15 的四件事，一步不省：
 *   导入 → 建会话（含**成本预估**）→ 逐页跑（**页级进度**，可中断续做）
 *   → 候选卡片 → **人工勾选** → 入库（走世界书编辑器：整批校验 + 备份）
 *
 * ⚠ 纪律：**绝不自动入库**。这一页所有"写规则区"的动作都必须经过用户点"确认入库"。
 *   失败页也**不静默跳过**：卡片上直接显示失败原因与模型原文，方便人判断是重跑还是手工补。
 */

import { useCallback, useMemo, useRef, useState } from 'react'

type PageInput = {
  kind: 'image' | 'text'
  name?: string
  mime?: string
  base64?: string
  text?: string
}

type Candidate = {
  title: string
  keys: string[]
  slot: 'solve' | 'scene_code'
  content: string
  pageIndex: number
}

type PageState = {
  index: number
  kind: 'image' | 'text'
  status: 'pending' | 'done' | 'failed'
  entries: Candidate[]
  issues: Array<{ code: string; message: string }>
  raw?: string
}

type Session = {
  id: string
  title: string
  pages: PageState[]
  estimate: { pages: number; tokensIn: number; tokensOut: number; note: string }
}

const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp']

const readAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })

export function DistillPage() {
  const [pages, setPages] = useState<PageInput[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [pastedText, setPastedText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const estimate = useMemo(() => {
    const imagePages = pages.filter((p) => p.kind === 'image').length
    const textPages = pages.filter((p) => p.kind === 'text').length
    return { imagePages, textPages, total: pages.length }
  }, [pages])

  /* ── 导入：文件与粘贴文字都只是"待处理页"，还没花一分钱 ── */
  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files || !files.length) return
    const next: PageInput[] = []
    for (const file of Array.from(files)) {
      if (!IMAGE_MIME.includes(file.type)) {
        setNote({ ok: false, text: `跳过 ${file.name}：只支持 ${IMAGE_MIME.join(' / ')}` })
        continue
      }
      if (file.size > 15 * 1024 * 1024) {
        setNote({ ok: false, text: `跳过 ${file.name}：超过 15 MB（本项目不替你静默压缩）` })
        continue
      }
      next.push({ kind: 'image', name: file.name, mime: file.type, base64: await readAsBase64(file) })
    }
    if (next.length) setPages((prev) => [...prev, ...next])
  }, [])

  const addPastedText = useCallback(() => {
    const text = pastedText.trim()
    if (!text) return
    setPages((prev) => [...prev, { kind: 'text', text }])
    setPastedText('')
  }, [pastedText])

  const removePage = useCallback((index: number) => {
    setPages((prev) => prev.filter((_, i) => i !== index))
    setSession(null)
    setPicked(new Set())
  }, [])

  /* ── 建会话：立刻给出成本预估（页数 × 单页 token） ── */
  const startSession = useCallback(async () => {
    if (!pages.length) return
    setBusy('正在建会话…')
    setNote(null)
    try {
      const res = await fetch('/api/distill/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: `教辅蒸馏 ${new Date().toLocaleString()}`,
          source: pages.some((p) => p.kind === 'image') ? 'image' : 'text',
          pages: pages.map((p) => ({ kind: p.kind, chars: p.text?.length ?? 0 })),
        }),
      })
      const data = (await res.json()) as { ok: boolean; issues?: Array<{ message: string }>; session?: Session }
      if (!data.ok || !data.session) throw new Error(data.issues?.[0]?.message ?? '建会话失败')
      setSession(data.session)
      setPicked(new Set())
      setNote({ ok: true, text: `会话已建：${data.session.estimate.note}` })
    } catch (err) {
      setNote({ ok: false, text: `建会话失败：${(err as Error).message}` })
    } finally {
      setBusy(null)
    }
  }, [pages])

  /* ── 逐页跑：只跑 pending（这就是"中断续做"） ── */
  const runPending = useCallback(async () => {
    if (!session) return
    const todo = session.pages.filter((p) => p.status === 'pending')
    if (!todo.length) {
      setNote({ ok: true, text: '没有待处理的页了（done / failed 的页不会重跑）' })
      return
    }
    setNote(null)
    for (const page of todo) {
      const input = pages[page.index]
      if (!input) continue
      setBusy(`正在蒸馏第 ${page.index + 1} / ${session.pages.length} 页…`)
      try {
        const res = await fetch('/api/distill/page', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: session.id,
            pageIndex: page.index,
            kind: input.kind,
            text: input.text,
            image: input.kind === 'image' ? { mime: input.mime, base64: input.base64, name: input.name } : undefined,
          }),
        })
        const data = (await res.json()) as { ok: boolean; session?: Session; issues?: Array<{ message: string }> }
        if (!res.ok || !data.ok) {
          setNote({ ok: false, text: `第 ${page.index + 1} 页失败：${data.issues?.[0]?.message ?? '未知错误'}` })
          continue
        }
        if (data.session) setSession(data.session)
      } catch (err) {
        setNote({ ok: false, text: `第 ${page.index + 1} 页请求失败：${(err as Error).message}` })
      }
    }
    setBusy(null)
  }, [pages, session])

  /* ── 人工确认后入库 ── */
  const commit = useCallback(async () => {
    if (!session) return
    const picks: Candidate[] = []
    for (const page of session.pages) {
      page.entries.forEach((entry, i) => {
        if (picked.has(`${page.index}:${i}`)) picks.push(entry)
      })
    }
    if (!picks.length) {
      setNote({ ok: false, text: '还没有勾选任何候选词条' })
      return
    }
    setBusy('正在入库…')
    try {
      const res = await fetch('/api/distill/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, picks }),
      })
      const data = (await res.json()) as { ok: boolean; name?: string; entries?: number; issues?: Array<{ message: string }> }
      if (!data.ok) throw new Error(data.issues?.[0]?.message ?? '入库失败')
      setNote({ ok: true, text: `已入库 ${data.entries ?? picks.length} 条 → 词条包 ${data.name}（可到「设置 → 世界书」查看）` })
      setPicked(new Set())
    } catch (err) {
      setNote({ ok: false, text: `入库失败：${(err as Error).message}` })
    } finally {
      setBusy(null)
    }
  }, [picked, session])

  const togglePick = useCallback((key: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const doneCount = session?.pages.filter((p) => p.status === 'done').length ?? 0
  const failedCount = session?.pages.filter((p) => p.status === 'failed').length ?? 0
  const candidateCount = session?.pages.reduce((n, p) => n + p.entries.length, 0) ?? 0

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-medium text-slate-900">教辅蒸馏（简版：图片 / 文字 → 候选词条）</h2>
        <p className="mt-1 text-xs text-slate-500">
          不做 PDF 解析：扫描页请在阅读器里导出成 PNG/JPG 再拖进来，或者直接粘文字。
          候选词条**必须你点确认才会入库**，不会自动写规则区。
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={IMAGE_MIME.join(',')}
            className="hidden"
            onChange={(e) => void addFiles(e.target.files)}
          />
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
          >
            选择页图…
          </button>
          <span className="text-xs text-slate-500">
            {estimate.total ? `已选 ${estimate.total} 页（图 ${estimate.imagePages} · 文字 ${estimate.textPages}）` : '还没有选页'}
          </span>
          {pages.length > 0 && (
            <button
              type="button"
              className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:bg-slate-300"
              onClick={() => void startSession()}
              disabled={busy !== null}
            >
              建会话并预估成本
            </button>
          )}
        </div>

        <div className="mt-3">
          <textarea
            className="w-full rounded-md border border-slate-300 p-2 text-sm"
            rows={3}
            placeholder="也可以直接粘一页教辅正文（会按“一页文字”算）"
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
          />
          <button
            type="button"
            className="mt-1 rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50 disabled:text-slate-400"
            onClick={addPastedText}
            disabled={!pastedText.trim() || busy !== null}
          >
            添加这一页文字
          </button>
        </div>

        {pages.length > 0 && (
          <ol className="mt-3 space-y-1 text-xs text-slate-600">
            {pages.map((p, i) => (
              <li key={`${p.name ?? 'text'}-${i}`} className="flex items-center gap-2">
                <span className="font-mono text-slate-400">{String(i + 1).padStart(2, '0')}</span>
                <span className="truncate">{p.kind === 'image' ? p.name ?? '（图片）' : `文字页（${p.text?.length ?? 0} 字）`}</span>
                <button
                  type="button"
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => removePage(i)}
                  disabled={busy !== null}
                  aria-label={`移除第 ${i + 1} 页`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {note && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            note.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'
          }`}
          role={note.ok ? undefined : 'alert'}
        >
          {note.text}
        </div>
      )}

      {session && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-slate-900">页级进度</span>
            <span className="text-xs text-slate-500">
              共 {session.pages.length} 页 · 完成 {doneCount} · 失败 {failedCount} · 候选 {candidateCount} 条
            </span>
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:text-slate-400"
              onClick={() => void runPending()}
              disabled={busy !== null}
            >
              开始 / 继续蒸馏
            </button>
            <button
              type="button"
              className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:bg-slate-300"
              onClick={() => void commit()}
              disabled={busy !== null || picked.size === 0}
            >
              确认入库（已勾 {picked.size} 条）
            </button>
            {busy && <span className="text-xs text-slate-600">{busy}</span>}
          </div>

          <div className="mt-3 space-y-3">
            {session.pages.map((page) => (
              <div key={page.index} className="rounded-md border border-slate-200">
                <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs">
                  <span className="font-mono text-slate-400">第 {page.index + 1} 页</span>
                  <span
                    className={
                      page.status === 'done'
                        ? 'text-emerald-700'
                        : page.status === 'failed'
                          ? 'text-red-700'
                          : 'text-slate-500'
                    }
                  >
                    {page.status === 'done' ? '已完成' : page.status === 'failed' ? '失败' : '待处理'}
                  </span>
                  <span className="text-slate-500">{page.entries.length} 条候选</span>
                </div>

                {page.issues.length > 0 && (
                  <ul className="border-b border-slate-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {page.issues.map((issue, i) => (
                      <li key={`${issue.code}-${i}`}>
                        {issue.code}：{issue.message}
                      </li>
                    ))}
                  </ul>
                )}

                {page.entries.length > 0 && (
                  <ul className="divide-y divide-slate-100">
                    {page.entries.map((entry, i) => {
                      const key = `${page.index}:${i}`
                      return (
                        <li key={key} className="flex gap-2 px-3 py-2">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={picked.has(key)}
                            onChange={() => togglePick(key)}
                            aria-label={`选择候选：${entry.title}`}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900">
                              {entry.title}
                              <span className="ml-2 font-mono text-xs text-slate-400">{entry.slot}</span>
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">触发词：{entry.keys.join(' / ') || '—'}</p>
                            <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">{entry.content}</p>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {page.status === 'failed' && page.raw && (
                  <details className="px-3 py-2">
                    <summary className="cursor-pointer text-xs text-slate-500">模型原文（排查用）</summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-600">{page.raw}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs text-slate-500">会话保存在本机 distill-sessions/，关掉页面再回来可以接着做。</p>
        </div>
      )}
    </div>
  )
}
