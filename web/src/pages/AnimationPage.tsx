/**
 * 动画页（§15 第二页 / M14 宿主侧）。
 *
 * 职责：**宿主控制条 + iframe 模板页**。
 * 协议实现依据 `contracts/host-protocol.md`（第 3 期定稿）：
 *   · 等模板发 `ready` 再发控制（协议 §4 的时序）；
 *   · 然后发 `program` 注入 8 槽位（协议 §3 的路径 B）；
 *   · 持续收 `state` 更新自己的进度条与读数；
 *   · `error` 如实显示（协议 §6 的错误码）。
 *
 * ⚠ 模板页的来源：
 *   本期宿主 iframe 装载的是 `template/build/animation-template.html`（空壳模板）的**副本**，
 *   它必须与宿主**同源或可被 postMessage 触达**。为了让"离线自包含"这条约束不被破坏，
 *   第 9 步的本地服务会把它挂到 `/template`；第 3 期先在 repo 内直接引用构建产物。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  DEFAULT_MASK,
  postToTemplate,
  parseTemplateMessage,
  validateProgramPayload,
  type TemplateReady,
  type TemplateState,
} from '../lib/host-protocol'
import { TEX_SVG } from '../lib/demo-questions'
import { api } from '../lib/rules-api'
import {
  DEFAULT_GIF_FPS,
  DEFAULT_GIF_HEIGHT,
  DEFAULT_GIF_WIDTH,
  encodeGif,
  frameTimes,
  readScaled,
} from '../lib/gif-encode.js'
import { useApp } from '../state/store'

/**
 * 模板页暴露的导出钩子（**不是** §13.2 协议，见模板里 ODExportHook 的注释）。
 * 之所以必须同源直接调用而不是 postMessage：GIF 要 960×540 的精确像素，且
 * "seek 完立刻取像素"必须同步 —— 消息往返或等 250ms 心跳都跟不上逐帧。
 */
interface TemplateExportHook {
  available(): boolean
  duration(): number
  stepCount(): number
  chartVisible(): boolean
  prepare(w: number, h: number): { width: number; height: number } | null
  restore(): void
  renderAt(t: number): HTMLCanvasElement | null
  canvas(): HTMLCanvasElement | null
}

/**
 * 模板页路径。
 *
 * ⚠ 必须是**相对 `dist/` 的落点**：`web/rollup.config.mjs` 的 `copyStaticAssets()`
 * 会把空壳模板拷到 `dist/template/animation-template.html`。
 * 若这里写成 `../../template/build/...`，构建后 `dist/` 里没有那个目录 ⇒ iframe 404 ⇒ 动画页永远空白。
 * 这正是产物体检（`tools/web-build.mjs`）会拦的一类问题。
 */
const TEMPLATE_URL = './template/animation-template.html'

export function AnimationPage() {
  const st = useApp()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState<TemplateReady | null>(null)
  /**
   * ── 第 8 期：**本次启动编号**（用户裁决"每次打开都要干净"）──
   *
   * 从 `/api/health` 拿一次，随 `program` 消息下发给模板；
   * 模板用它拼 localStorage 的键 ⇒ 重开服务必然干净，同一次启动内刷新仍保留开关。
   * 拿不到（离线/异常）就退化成 `standalone`：宁可不记忆，也不要"错记"。
   */
  const [launchId, setLaunchId] = useState('standalone')
  useEffect(() => {
    let alive = true
    api
      .health()
      .then((h) => {
        if (alive && typeof h.launchId === 'string' && h.launchId) setLaunchId(h.launchId)
      })
      .catch(() => {
        /* 拿不到就用 standalone：不记忆比错记好 */
      })
    return () => {
      alive = false
    }
  }, [])
  /**
   * ⚠ 第 7 期：`live`（模板 state 心跳的镜像）与页面上的"实时读数"表一起删掉了。
   *
   * 为什么删：用户 2026-10-17 看效果后裁决——动画页上只要**动画 + 曲线图**，
   * 两处重复的数值堆料（模板数据面板 / 宿主读数表）全部砍掉。
   * 心跳本身仍然照收（下面 state 分支的 setT / setDuration / setPlaying 还在用），
   * 只是不再在界面上重复一遍。
   */
  /**
   * 通信日志（诊断用）。
   *
   * ★ 为什么要有它：第 3 期交付后，"动画页停在空壳模板"这个问题我**两轮都没修对**，
   *   盲点在于**看不见宿主与模板之间到底交换了什么**：
   *     是模板没发 `ready`？宿主没发 `program`？还是模板收下了却拒绝了？
   *   三种情况的**外在表现完全一样**（都停在空壳），不记录就只能猜。
   *   所以把消息往来**显示在界面上** —— 用户截一张图就能定位，不必懂协议。
   *   正常工作时它只占一行，不干扰界面。
   */
  const [log, setLog] = useState<string[]>([])
  const pushLog = useCallback((s: string) => {
    setLog((prev) => [...prev.slice(-9), `${new Date().toLocaleTimeString()} ${s}`])
  }, [])

  /* ── 收模板消息（协议 §2 的方向判据） ── */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // 诊断优先：先记下"收到任何消息"这件事，再判断它是不是给宿主的
      const raw = e.data as { source?: string; type?: string } | null
      if (raw && typeof raw === 'object' && typeof raw.type === 'string') {
        pushLog(`← 收到 ${raw.type}${raw.source ? `（source=${raw.source}）` : '（无 source）'}`)
      }
      // 只接受来自我们那个 iframe 的消息
      if (iframeRef.current && e.source !== iframeRef.current.contentWindow) {
        pushLog('  ⚠ 该消息的 e.source 不是我们的 iframe，已忽略')
        return
      }
      const parsed = parseTemplateMessage(e.data)
      if (!parsed) {
        pushLog('  ⚠ 协议方向判据拒绝（source 不是 od-template）')
        return
      }

      if (parsed.type === 'ready') {
        pushLog(
          `  ✓ 模板已就绪（${parsed.payload.shell ? '空壳主动上报' : '注入了题目'}）· 时长 ${Number(parsed.payload.duration ?? 0).toFixed(2)} s`,
        )
        setReady({
          duration: Number(parsed.payload.duration ?? 0),
          stepCount: Number(parsed.payload.stepCount ?? 0),
        })
      } else if (parsed.type === 'state') {
        const p = parsed.payload as unknown as TemplateState
        /* 心跳仍要落到 store（取消/进度/播放态依赖它），但**不再**渲染成读数表 */
        useApp.getState().setT(Number(p.t ?? 0))
        useApp.getState().setDuration(Number(p.duration ?? 0))
        useApp.getState().setPlaying(Boolean(p.playing))
      } else if (parsed.type === 'error') {
        const code = String(parsed.payload.code ?? 'unknown')
        const message = String(parsed.payload.message ?? '')
        // 空壳模板在拿到 program 之前报告 no-program，这是**预期行为**，不算错误
        if (code === 'no-program') {
          pushLog('  · 模板报 no-program（空壳的预期行为，等待注入）')
          return
        }
        /**
         * ★ `program-already-inlined` 只有在**我们从未成功注入过**时才算错误。
         *
         * 为什么需要这个区分：第 3 期交付后为了摆脱"双向握手"（见下面注入那段），
         * 宿主改成**重试注入 4 次**；而模板有 §13.1 的防覆盖保护，会拒绝第 2～4 条。
         * 于是"第一次成功、后面三条被拒"——动画**正常播放**，
         * 界面上却挂着一条红色错误。**那是自我竞争输掉的正常结果，不是故障。**
         *
         * 判据：注入成功后 `templateReady` 会置为 true。
         *   · 已成功过 ⇒ 记为日志、**不报错**（这正是用户看到的情况）；
         *   · 从未成功 ⇒ 那是真拒绝（例如宿主错误地把成品页当空壳注入），照实报。
         * 两种都是可见的（日志里留痕），只是级别不同 —— 不静默。
         */
        if (code === 'program-already-inlined' && useApp.getState().templateReady) {
          pushLog('  · 模板拒绝了重复注入（首次已成功，属预期）')
          return
        }
        pushLog(`  ✗ 模板报错 ${code}：${message}`)
        useApp.getState().setTemplateError({ code, message })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [pushLog])

  const post = useCallback(
    (type: Parameters<typeof postToTemplate>[1], payload?: Record<string, unknown>) => {
      const ok = postToTemplate(iframeRef.current?.contentWindow, type, payload ?? {})
      pushLog(`→ 发送 ${type}${ok ? '' : '（失败：iframe 未就绪）'}`)
      return ok
    },
    [pushLog],
  )

  /**
   * `program` 注入（协议 §3/§4）。
   *
   * ★ 三处必须留意（前两处是第 3 期交付后修的真缺陷，见 README 13.12）：
   *
   * ① **依赖数组只放决定"要不要重注入"的东西**：就绪、槽位、模式。
   *    早先把 `st.mask` / `st.rate` 也放进去了，而本效果内部又会 `setTemplateReady(true)`
   *    ⇒ 触发自身重跑 ⇒ **重复注入**。开关与倍速改由下面两个独立效果同步。
   *
   * ② **`texSvg` 必须一起发**：模板的公式索引来自 `PROGRAM_DATA.texSvg`。
   *    不发它就退回 ODTex/原文降级链 —— 演示界面里公式变成 `\frac` 原文就是这个原因
   *    （模板内部**早就支持**注入公式，但宿主从来没把预渲染结果发过去）。
   *
   * ③ **`id` / `title` 是可选字段**：不发的话模板页头会一直写着"空壳模板"，
   *    让人分不清"注入成功"还是"注入失败停在空壳"。协议 §3 已补记这两个字段。
   */
  useEffect(() => {
    if (!st.programSlots) return
    const payload = {
      slots: st.programSlots,
      mode: st.programMode,
      texSvg: TEX_SVG,
      id: st.programTitle,
      title: st.programTitle,
      /* C2：标注避让表（Dry-Run 算的）。模板收到后会交给播放器按表挪字 + 画引线 */
      labelAvoid: st.programLabelAvoid,
      /* 第 8 期：本次启动编号（偏好键隔离用） */
      launchId,
    }
    const bad = validateProgramPayload(payload)
    if (bad) {
      useApp.getState().setTemplateError({ code: 'bad-program', message: bad })
      return
    }

    /**
     * ★ 不等 `ready`，直接**重试注入**若干次（第 3 期交付后改）。
     *
     * 为什么改成这样：原先写成"**收到 `ready` 才发 `program`**"，
     * 而空壳的 `ready` 又依赖它在没拿到题目时也主动上报 —— 一条**双向依赖**，
     * 任何一端出问题都表现为"永远停在空壳"，且**外在表现完全一样、极难定位**
     * （我为此连续两轮修错地方）。
     *
     * `postMessage` 对同一个窗口重复投递是幂等的，而模板那边本来就有
     * `program-already-inlined` 拒绝重复注入的保护（§13.1）—— 所以"多发几次"是安全的，
     * 代价只是几条多余消息，换来的是**不依赖握手时序**。
     * 保留 `ready` 分支只为尽早注入（第一条消息到达即可），不再是唯一路径。
     */
    let tries = 0
    const send = () => {
      tries += 1
      const ok = post('program', payload)
      if (tries === 1 && ok) useApp.getState().setTemplateReady(true)
      return ok
    }
    send()
    const timers = [400, 1200, 2500].map((ms) => window.setTimeout(send, ms))
    return () => timers.forEach((t) => window.clearTimeout(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.programSlots, st.programMode, post, launchId])

  /**
   * `ready` 到达后**立刻**再注入一次（不等重试定时器）。
   *
   * 上一个是"多发几次保底"，这个是"握手成功就马上走"。
   * 两条路径都通向同一件事，**互为兜底** —— 这正是上一版缺的：
   * 上一版只有 `ready` 一条路，那条路一断就永远停在空壳。
   */
  useEffect(() => {
    if (!ready || !st.programSlots || st.templateReady) return
    post('program', {
      slots: st.programSlots,
      mode: st.programMode,
      texSvg: TEX_SVG,
      id: st.programTitle,
      title: st.programTitle,
      /* 第 8 期：本次启动编号（两条注入路径都要带，否则先到的那条会写错键） */
      launchId,
    })
    useApp.getState().setTemplateReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, st.programSlots, st.programMode, st.templateReady, post, launchId])

  /* ── 开关与倍速的同步（与注入解耦，避免上面那类自触发循环） ── */
  useEffect(() => {
    if (!st.templateReady) return
    post('setVectorMask', st.mask as unknown as Record<string, unknown>)
  }, [st.templateReady, st.mask, post])

  useEffect(() => {
    if (!st.templateReady) return
    post('setRate', { rate: st.rate })
  }, [st.templateReady, st.rate, post])

  /* ══ 导出（M17）：网页 / GIF ══════════════════════════════════
     用户 2026-10-17 改方案：**不做 WebM**（转码链重、收益低），只产出
       ① 单文件网页（= 模板页另存，双击即播，烧录 Provenance）
       ② GIF（25 fps / 960×540，默认**不录曲线图**——只抓动画画布）
     GIF 帧数口径 = `round(duration×fps) + 1`（末帧必须落在 duration 上，
     否则"首末帧与 t=0 / t=duration 一致"这条验收就不成立），见 frameTimes()。 */
  const [busy, setBusy] = useState<null | { kind: 'page' | 'gif'; done: number; total: number }>(null)
  const [result, setResult] = useState<null | { ok: boolean; text: string; url?: string | undefined; file?: string | undefined }>(null)

  /**
   * 第 9 期：导出文件名要**带题目**（原来 GIF 写死 `animation.gif`，导第二道题就覆盖）。
   * 只保留中英文、数字、连字符，其余压成 '-'，最长 40 字 —— 免得文件名里出现路径分隔符。
   */
  const slug = useCallback((text: string | undefined, fallback: string) => {
    const s = String(text ?? '')
      .trim()
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
    return s || fallback
  }, [])

  const exportHook = useCallback((): TemplateExportHook | null => {
    const win = iframeRef.current?.contentWindow as unknown as { ODExportHook?: TemplateExportHook } | null
    const h = win?.ODExportHook
    return h && h.available() ? h : null
  }, [])

  const exportPage = useCallback(async () => {
    const st0 = useApp.getState()
    if (!st0.programSlots) return
    setBusy({ kind: 'page', done: 0, total: 1 })
    setResult(null)
    try {
      // 演示源是手写的，Provenance 就照实写 handwritten；真实跑题才可能带真哈希
      const handwritten = !st0.run.model
      const res = await fetch('/api/export/page', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slots: st0.programSlots,
          mode: st0.programMode,
          /* 第 9 期：带上 id ⇒ 文件名是「题目-时间戳.html」，不再是一串 export-xxx */
          id: slug(st0.programTitle, 'export'),
          title: st0.programTitle,
          model: st0.run.model ?? 'handwritten',
          promptHash: handwritten ? 'handwritten' : undefined,
          worldbookHash: handwritten ? 'handwritten' : undefined,
          /* C2：把避让表一起烧进导出的网页（没表就是 null ⇒ 与第 7 期一样） */
          labelAvoid: st0.programLabelAvoid ?? null,
          /**
           * 第 8 期：开发模式（不拦截）的痕迹一并烧进导出页的 Provenance。
           * 这个 html 一旦离开本机，就没人知道它没验过 —— 必须写在文件里。
           */
          advisory: st0.run.advisory === true,
          gatesBypassed: st0.run.gatesBypassed,
        }),
      })
      const data = (await res.json()) as {
        ok: boolean
        issues?: Array<{ message: string }>
        name?: string
        bytes?: number
        formulas?: number
        url?: string
        file?: string
      }
      if (!data.ok) throw new Error(data.issues?.[0]?.message ?? '导出失败')
      setResult({
        ok: true,
        text: `网页已导出：${data.name}（${Math.round((data.bytes ?? 0) / 1024)} KB · 公式 ${data.formulas ?? 0} 条）`,
        url: data.url,
        file: data.file,
      })
    } catch (err) {
      setResult({ ok: false, text: `导出网页失败：${(err as Error).message}` })
    } finally {
      setBusy(null)
    }
  }, [slug])

  const exportGif = useCallback(async () => {
    const h = exportHook()
    if (!h) {
      setResult({ ok: false, text: '导出失败：模板页还没就绪（或还没注入题目）' })
      return
    }
    const times = frameTimes(h.duration(), DEFAULT_GIF_FPS)
    if (!times.length) {
      setResult({ ok: false, text: '导出失败：动画时长为 0' })
      return
    }
    setBusy({ kind: 'gif', done: 0, total: times.length })
    setResult(null)
    try {
      if (!h.prepare(DEFAULT_GIF_WIDTH, DEFAULT_GIF_HEIGHT)) throw new Error('画布尺寸准备失败')
      const frames: Uint8ClampedArray[] = []
      for (let i = 0; i < times.length; i += 1) {
        const canvas = h.renderAt(times[i] as number)
        if (!canvas) throw new Error(`第 ${i} 帧渲染失败`)
        frames.push(readScaled(canvas, DEFAULT_GIF_WIDTH, DEFAULT_GIF_HEIGHT))
        setBusy({ kind: 'gif', done: i + 1, total: times.length })
        // 让出主线程：不这么做进度条永远不重绘，几十帧会看起来像卡死
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      const bytes = encodeGif(frames, {
        width: DEFAULT_GIF_WIDTH,
        height: DEFAULT_GIF_HEIGHT,
        fps: DEFAULT_GIF_FPS,
      })
      const res = await fetch(`/api/export/gif?name=${encodeURIComponent(`${slug(useApp.getState().programTitle, 'animation')}.gif`)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes as unknown as BodyInit,
      })
      const data = (await res.json()) as {
        ok: boolean
        issues?: Array<{ message: string }>
        name?: string
        bytes?: number
        url?: string
        file?: string
      }
      if (!data.ok) throw new Error(data.issues?.[0]?.message ?? '落盘失败')
      setResult({
        ok: true,
        text: `GIF 已导出：${data.name}（${times.length} 帧 · ${DEFAULT_GIF_FPS} fps · ${DEFAULT_GIF_WIDTH}×${DEFAULT_GIF_HEIGHT} · ${Math.round(
          (data.bytes ?? 0) / 1024,
        )} KB）`,
        url: data.url,
        file: data.file,
      })
    } catch (err) {
      setResult({ ok: false, text: `导出 GIF 失败：${(err as Error).message}` })
    } finally {
      h.restore()
      setBusy(null)
    }
  }, [exportHook, slug])

  return (
    <div className="space-y-4">
      {/* ── 导出（M17）：网页 / GIF ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <span className="text-xs font-medium text-slate-700">导出</span>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:text-slate-400"
          disabled={!st.programSlots || busy !== null}
          onClick={() => void exportPage()}
        >
          导出网页
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:text-slate-400"
          disabled={!st.programSlots || busy !== null}
          onClick={() => void exportGif()}
        >
          导出 GIF
        </button>
        <span className="text-xs text-slate-500">
          {busy
            ? busy.kind === 'gif'
              ? `正在逐帧渲染… ${busy.done} / ${busy.total}`
              : '正在打包单文件页…'
            : '网页 = 双击即播的单文件；GIF = 25 fps / 960×540（不含曲线图）'}
        </span>
        {result && (
          <span className={result.ok ? 'text-xs text-emerald-700' : 'text-xs text-red-700'}>
            {result.text}
            {/*
              第 9 期：**不再给 `http://127.0.0.1:<端口>` 链接**。
              那个端口每次启动都变（旧链接一关就失效），而且它同源、`will-navigate` 会放行 ——
              万一同窗口导航过去，主窗口就离开了单页应用。现在改走壳子的 `shell.openPath`：
              打开的是**本地文件本身**，不依赖端口，也不会让窗口跑掉。
              浏览器里（演示源）没有 `window.OD_SHELL`，这两个按钮就不出现。
            */}
            {result.file && typeof window.OD_SHELL?.openExportFile === 'function' && (
              <button
                type="button"
                className="ml-2 underline hover:text-emerald-900"
                onClick={() => {
                  void window.OD_SHELL?.openExportFile?.(result.file as string)
                }}
              >
                打开文件
              </button>
            )}
            {typeof window.OD_SHELL?.openExportDir === 'function' && (
              <button
                type="button"
                className="ml-2 underline hover:text-emerald-900"
                onClick={() => {
                  void window.OD_SHELL?.openExportDir?.()
                }}
              >
                打开导出文件夹
              </button>
            )}
          </span>
        )}
      </div>

      {/* ⚠ 第 7 期：这里原来是一条"宿主控制条"（播放 / 上一帧 / 下一帧 / 时间轴 / 倍速 / 五个显示开关）。
          用户 2026-10-17 裁决：「最上面这一栏删掉，控制面板只要下面演示动画里的」——
          播放控制只留模板页自带的那一套（§13.1「播放器就是模板页本身」）。
          这也顺手消掉了 §15 的"不重复主 CTA"违规：屏幕上不再有两套一模一样的控件。
          协议侧不受影响：setRate / setVectorMask 的同步仍在下面对 store 的订阅里。 */}

      {/* ── 状态提示（不能含糊） ── */}
      {/*
        ⚠ 第 4 期：**未通过校验的结果也允许播放**（§14.2 的 B4：三轮不过仍交付可播放动画），
        但**必须在这里再次挂出告警**。只挂在解题页是不够的 —— 用户很可能直接停在动画页，
        而"这个动画没过校验"这件事绝不能因为翻了一页就消失（§21.2 第 8 条）。
      */}
      {st.run.banner && (
        <div role="alert" className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-sm">
          <p className="font-semibold text-amber-900">
            ⚠ {st.run.banner.title}
            {st.run.banner.failedChecks.length > 0 && (
              <span className="ml-2 font-mono text-xs">（{st.run.banner.failedChecks.join(' / ')}）</span>
            )}
          </p>
          <p className="mt-1 text-amber-900">{st.run.banner.message}</p>
        </div>
      )}

      {/*
        ── 第 8 期：开发模式（不拦截）的提示（用户裁决）──
        在动画页也要能看到：这条产物是"被放行的"，不是"验证过的"。
        否则用户看了画面就以为一切都过了。
      */}
      {st.run.advisory && (
        <p
          className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-xs text-amber-900"
          data-od-id="advisory-banner-animation"
        >
          <strong>开发模式</strong>：这条动画**没有通过硬判据**
          {st.run.gatesBypassed.length ? '（' + st.run.gatesBypassed.join(' / ') + '）' : ''}
          。画面可以看、可以导出，但导出文件里会写明“未通过校验”。
        </p>
      )}
      {!st.programSlots && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          还没有可播放的动画：请先到<strong>解题页</strong>点「开始生成动画」。
        </p>
      )}
      {st.templateError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-medium">模板页报告错误：{st.templateError.code}</p>
          <p className="mt-1">{st.templateError.message}</p>
        </div>
      )}
      {st.programSlots && !st.templateReady && !st.templateError && (
        <p className="text-sm text-slate-500">正在等待模板页就绪…</p>
      )}

      {/*
        通信日志：**卡住时自动展开**（这是排查的关键），正常工作时折叠成一行。
        第 3 期交付后"停在空壳模板"两轮没修对，盲点就是看不到消息往来。
      */}
      <details open={Boolean(st.programSlots) && !st.templateReady} className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-xs text-slate-600">
          宿主 ↔ 模板 通信日志（{log.length} 条）
          {!st.templateReady && st.programSlots ? ' —— 尚未就绪，请看下面' : ''}
        </summary>
        <pre className="max-h-40 overflow-auto border-t border-slate-100 px-3 py-2 text-[11px] leading-relaxed text-slate-700">
{log.length ? log.join('\n') : '（还没有任何消息往来）'}
        </pre>
      </details>

      {/* ── iframe：模板页本体（导出 = 另存为它，§13.1） ── */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <iframe
          ref={iframeRef}
          title="动画模板页"
          src={TEMPLATE_URL}
          className="h-[720px] w-full"
          // 模板页需要脚本（播放器就在里面）；同源即可
          sandbox="allow-scripts allow-same-origin"
        />
      </div>

      {/* ── 读数面板已删除（第 7 期，用户裁决：「删了不要」）──
          数值改由模板页里的曲线图游标承担；宿主不再把读数值重复显示一遍。 */}

      <p className="text-xs text-slate-500">
        说明：画布、三栏、播放控制与曲线图全部由<strong>模板页自己</strong>渲染
        （播放器就是模板页本身），宿主只负责把题目注入进去——这样导出的文件
        与屏幕上看到的才是同一个东西。本期 iframe 指向构建产物{' '}
        <code className="rounded bg-slate-100 px-1">{TEMPLATE_URL}</code>。
      </p>
    </div>
  )
}

/** 默认开关（导出给别处复用，避免重复定义） */
export const DEFAULT_VECTOR_MASK = DEFAULT_MASK