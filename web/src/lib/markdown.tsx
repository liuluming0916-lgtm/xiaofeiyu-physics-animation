/**
 * 极小的 Markdown + **构建期预渲染公式**渲染器（前端用）。
 *
 * ── 公式怎么渲染（这一节是本文件最重要的部分）
 *
 * 走**构建期 MathJax 预渲染**，与 15 个成品页**同一套实现**（`tools/tex-render.mjs`）：
 * 构建时把演示界面会显示的每一条 LaTeX 渲染成真 MathJax SVG（含按需内联的字形 `<path>`），
 * 存在 `demo-questions.ts` 的 `TEX_SVG.formulas` 里，前端只做一次字符串注入。
 *
 * 为什么**不**在浏览器里跑 MathJax：§2.2 定案是「完全内联、无外部请求」，
 * 而把 MathJax 打进浏览器需要额外打包步骤，代价是产物再大几百 KB。
 * 构建期渲染是本项目的既定做法，而且**成品页与演示界面因此长得一样**。
 *
 * ★ 为什么写这段注释：第 3 期交付后我**直接喂了原始文本**给这里，
 *   于是演示界面上公式变成了一堆 `\mathrm`、`\frac` 原文（用户当场发现）。
 *   根因是"真页面有预渲染、演示界面没有，而我没对齐这条路径"。详见 README 13.12。
 *
 * 降级链（与模板页一致）：预渲染命中 → 真 SVG；未命中 → 显示公式原文（可见但标出未渲染，绝不空白）。
 */

import type { ReactNode } from 'react'
import { createElement, Fragment, useEffect, useReducer } from 'react'

import { TEX_SVG } from './demo-questions'
import { splitTexMix } from './tex-mix'

/** 预渲染公式表：LaTeX 原文 → MathJax 标记 */
const FORMULAS: Record<string, string> = (TEX_SVG as unknown as { formulas: Record<string, string> }).formulas

/* ══════════════════════════════ 运行时公式（第 8 期） ══════════════════════════════
 *
 * ── 为什么必须加这条路 ──
 *
 * 上面那张 `FORMULAS` 是**构建期**给演示题预渲染的。真跑一道题时，模型产出的公式
 * 一条都不在表里 ⇒ 全部走"未预渲染"兜底 ⇒ 屏幕上是一长串原始 LaTeX（还带着模型写的 `$`）。
 * 用户看到的就是"公式全挤在一行、还用 `$$` 包着"。
 *
 * 所以补一条**运行时**通道：查表未命中 ⇒ 请本机服务渲染（`POST /api/tex`，
 * 服务端用 `tools/tex-render.mjs`，与成品页同一套 mathjax-full），结果按公式文本缓存。
 * 仍然满足 §2.2「浏览器不跑 MathJax、无外部请求」：渲染在服务端，页面只吃 SVG。
 *
 * 降级链（四级，任何一级都不空白）：
 *   ① 构建期预渲染命中 → 同步出 SVG；
 *   ② 运行时渲染命中（缓存）→ 立刻出 SVG；
 *   ③ 正在请求 → 先显示原文（带"渲染中"提示），回来后自动替换；
 *   ④ 服务没开 / 渲染失败 → 保持原文并**标出未渲染**（琥珀底色），绝不假装成功。
 */
const RUNTIME_TEX = new Map<string, string>()
const RUNTIME_FAILED = new Set<string>()
/** 失败原因（服务端返回的 code/message）——标题上要能说清"为什么没渲染"，不能只说"未预渲染" */
const RUNTIME_ERROR = new Map<string, string>()
const RUNTIME_PENDING = new Set<string>()
const TEX_LISTENERS = new Set<() => void>()

function notifyTexListeners() {
  for (const l of TEX_LISTENERS) l()
}

/** 请服务端渲染一条公式；失败只记一次，不重试、不刷屏 */
function requestRuntimeTex(tex: string) {
  if (FORMULAS[tex] || RUNTIME_TEX.has(tex) || RUNTIME_FAILED.has(tex) || RUNTIME_PENDING.has(tex)) return
  RUNTIME_PENDING.add(tex)
  void (async () => {
    try {
      const res = await fetch('/api/tex', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tex }),
      })
      const json = (await res.json()) as {
        ok?: boolean
        svg?: string
        issues?: Array<{ code?: string; message?: string }>
      }
      if (json?.ok && typeof json.svg === 'string') RUNTIME_TEX.set(tex, json.svg)
      else {
        RUNTIME_FAILED.add(tex)
        RUNTIME_ERROR.set(tex, json?.issues?.[0]?.message ?? '服务端拒绝了这条公式')
      }
    } catch {
      // 服务没开（例如直接双击静态页）—— 当作"渲染不可用"，保持原文
      RUNTIME_FAILED.add(tex)
    } finally {
      RUNTIME_PENDING.delete(tex)
      notifyTexListeners()
    }
  })()
}

/**
 * 一条公式：查预渲染表 → 运行时缓存 → 都没有就显示原文并去请求。
 *
 * ⚠ `dangerouslySetInnerHTML` 的边界：标记来自 MathJax（构建期或服务端），
 *   服务端那一路在 `rules-service.mjs` 里已断言"必须是 SVG 且不含 script/on*"。
 */
function TexSpan({ tex }: { tex: string }) {
  const [, force] = useReducer((x: number) => x + 1, 0)

  useEffect(() => {
    const listener = () => force()
    TEX_LISTENERS.add(listener)
    requestRuntimeTex(tex)
    return () => {
      TEX_LISTENERS.delete(listener)
    }
  }, [tex])

  const markup = FORMULAS[tex] ?? RUNTIME_TEX.get(tex)
  if (!markup) {
    const pending = RUNTIME_PENDING.has(tex)
    const why = RUNTIME_ERROR.get(tex)
    return createElement(
      'span',
      {
        className: 'tex-raw',
        title: pending ? `正在渲染：${tex}` : why ? `没渲染成功：${why}` : `未预渲染：${tex}`,
      },
      tex,
    )
  }
  const vertical = /vertical-align:\s*([^;"]+)/.exec(markup)
  const inner = markup.replace(/^<mjx-container[^>]*>/, '').replace(/<\/mjx-container>$/, '')
  return createElement('span', {
    className: 'tex-svg',
    title: tex,
    style: { verticalAlign: vertical?.[1]?.trim() ?? '-0.24em' },
    dangerouslySetInnerHTML: { __html: inner },
  })
}

/** 兼容旧签名：把一个公式变成 DOM 节点（现在走 `TexSpan`，支持运行时渲染） */
function mathNode(tex: string, key?: string): ReactNode {
  return createElement(TexSpan, { key, tex })
}

/**
 * ★ 渲染一段**公式或"混排"内容**（`STEPS` 的 `tex` 字段、`ANSWERS` 的 `latex`）。
 *
 * ── 第 8 期：从"整段当一条公式"改成**混排**（用户 2026-10-18 裁决）──
 *
 * 用户的原话："如果是解释+公式+解释+公式，会自动分行吗？我需要实现这个功能。"
 *
 * 现在按 `splitTexMix` 切段：**文字用普通 span（浏览器自动折行）**，公式各自内联成 SVG。
 * 于是"解释+公式+解释+公式"会在文字处自然换行，而不是挤成一整行；
 * 单个超长公式由 CSS 等比缩到容器宽度（`.tex-svg svg { max-width:100% }`），**永不横向滚动**。
 *
 * ⚠ 因此 `$` 在这里**不是要清洗掉的垃圾，而是切分依据** —— 归一化只做 `$$…$$` → `$…$`。
 */
export function MathBlock({ tex, block = false }: { tex: string; block?: boolean }) {
  const parts = splitTexMix(tex)
  if (!parts.length) return null
  const nodes: ReactNode[] = parts.map((p, i) =>
    p.type === 'math' ? mathNode(p.value, `t${i}`) : createElement('span', { key: `t${i}` }, p.value),
  )
  if (!block) return createElement(Fragment, null, ...nodes)
  return createElement('div', { className: 'tex-block' }, ...nodes)
}

/** 把一行文本按 `$…$` 切成文本/公式片段 */
function splitInlineMath(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\$([^$\n]+)\$/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(mathNode((m[1] ?? '').trim(), `m${key++}`))
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out.length ? out : [text]
}

/** 渲染一段解题文字（支持 `## 标题` / `- 列表` / `1. 列表` / 独立行公式 / 段落） */
export function Markdown({ text }: { text: string }) {
  if (!text.trim()) return null
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let para: string[] = []
  let list: string[] = []
  let ordered = false
  let key = 0

  const flushPara = () => {
    if (!para.length) return
    blocks.push(
      createElement('p', { key: `p${key++}`, className: 'mb-2 leading-relaxed' }, splitInlineMath(para.join(' '))),
    )
    para = []
  }
  const flushList = () => {
    if (!list.length) return
    blocks.push(
      createElement(
        ordered ? 'ol' : 'ul',
        { key: `l${key++}`, className: `mb-2 space-y-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}` },
        list.map((item, i) => createElement('li', { key: i }, splitInlineMath(item))),
      ),
    )
    list = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    if (/^#{1,4}\s+/.test(line)) {
      flushPara()
      flushList()
      blocks.push(
        createElement('h4', { key: `h${key++}`, className: 'mb-1 mt-3 font-semibold text-slate-900' }, line.replace(/^#{1,4}\s+/, '')),
      )
      continue
    }
    if (/^\$\$.*\$\$$/.test(line.trim())) {
      flushPara()
      flushList()
      const tex = line.trim().slice(2, -2).trim()
      // 独立行公式：命中预渲染就给真 SVG 居中显示，否则原文（同样标出未渲染）
      blocks.push(createElement('div', { key: `d${key++}`, className: 'tex-block' }, mathNode(tex)))
      continue
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      flushPara()
      if (ordered) flushList()
      ordered = false
      list.push(bullet[1] ?? '')
      continue
    }
    const num = /^\d+[.)]\s+(.*)$/.exec(line)
    if (num) {
      flushPara()
      if (!ordered) flushList()
      ordered = true
      list.push(num[1] ?? '')
      continue
    }
    para.push(line)
  }
  flushPara()
  flushList()

  return createElement(Fragment, null, ...blocks)
}

/** 行式表（`key: value`，空行分隔）→ 记录数组。与项目里 STEPS/ANSWERS 的书写约定一致。 */
export function parseRowTable(text: string): Array<Record<string, string>> {
  const records: Array<Record<string, string>> = []
  let current: Record<string, string> | null = null
  let multilineKey: string | null = null
  let multilineBuf: string[] = []

  const closeMultiline = () => {
    if (current && multilineKey) current[multilineKey] = multilineBuf.join('\n')
    multilineKey = null
    multilineBuf = []
  }
  const closeRecord = () => {
    closeMultiline()
    if (current && Object.keys(current).length) records.push(current)
    current = null
  }

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (multilineKey) {
      if (/^\s*"""\s*$/.test(line)) closeMultiline()
      else multilineBuf.push(raw)
      continue
    }
    if (!line.trim()) {
      closeRecord()
      continue
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue
    const [, k, v] = kv
    if (v === '"""') {
      current ??= {}
      multilineKey = k ?? null
      multilineBuf = []
      continue
    }
    current ??= {}
    current[k ?? ''] = v ?? ''
  }
  closeRecord()
  return records
}
