/**
 * 连接设置小窗（第 8 期 · `A2`）
 *
 * 为什么需要它：发布构建里**「设置」「规则」两页在产物中不存在**（门禁 ㊳），
 * 那老师装完软件**没有地方填模型地址与 Key** —— 软件就是死的。
 * 所以留这**一扇最小的窗**：地址 / 模型 / Key / 保存 / 测试连接。
 *
 * 三条口径：
 *   ① **Key 只进不出**：输入框 `type=password`，保存后立刻清空，
 *      界面上永远不回显（服务端也永远不返回明文）。要换就整条重填。
 *   ② **保存 = 一次写清**：端点 + 分阶段模型（所有阶段都指向它，本产品只有一个模型）
 *      + Key 三件事一次做完，避免"改了地址没保存 Key"这种半吊子状态。
 *   ③ 只做**一件事**：不提供增删端点、不提供 Prompt / 清洗规则 ——
 *      那些在开发构建里有「设置」「规则」页；发布版不面向用户开放。
 */

import { useEffect, useState } from 'react'

import { api, type EndpointConfig, type EndpointsPayload } from '../lib/rules-api'

const DEFAULT_ENDPOINT: EndpointConfig = {
  id: 'default',
  displayName: '我的模型',
  baseURL: 'https://api.openai.com/v1',
  defaultModel: '',
  visionModel: '',
  apiKeyModelId: null,
  supportsJsonMode: true,
  supportsVision: false,
  enableThinking: false,
  preserveThinking: false,
  timeoutMs: 120000,
}

type Msg = { kind: 'ok' | 'err' | 'info'; text: string } | null

/**
 * `onSaved`：保存成功后回调 —— 让「解题页」立刻重新读一次 `supportsVision`。
 *
 * 不这么做的话：用户在齿轮里勾上"支持看图"并保存，图片入口要刷新页面才放开，
 * 看起来就像"没生效"（第 8 期实测反馈）。
 */
export function ConnectionDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved?: () => void
}) {
  const [payload, setPayload] = useState<EndpointsPayload | null>(null)
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [vision, setVision] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  /**
   * 超时（秒）—— 语义是"**多久没收到新内容**就算超时"，不是"总时长"。
   *
   * 为什么必须能改：推理型模型首字延迟动辄几十秒，固定 60 秒会把正常生成砍掉
   * （第 8 期实测：答案抽取花了 47.8 秒，"分步解析"直接被判超时）。
   */
  const [timeoutSec, setTimeoutSec] = useState('120')

  const current = payload?.endpoints?.[0] ?? null
  const endpointId = current?.id ?? DEFAULT_ENDPOINT.id

  useEffect(() => {
    if (!open) return
    let alive = true
    setMsg(null)
    setKey('')
    api
      .endpoints()
      .then((data) => {
        if (!alive) return
        setPayload(data)
        const ep = data.endpoints?.[0] ?? null
        setBaseURL(ep?.baseURL ?? DEFAULT_ENDPOINT.baseURL)
        setModel(ep?.defaultModel ?? '')
        setVision(Boolean(ep?.supportsVision))
        setTimeoutSec(String(Math.round((ep?.timeoutMs ?? DEFAULT_ENDPOINT.timeoutMs) / 1000)));
        if (!ep) setMsg({ kind: 'info', text: '还没有配置过模型。填好地址与 Key，点「保存并测试」。' })
      })
      .catch((e: unknown) => {
        if (!alive) return
        setMsg({
          kind: 'err',
          text: `连不上本机服务：${e instanceof Error ? e.message : String(e)}（请重开一次软件；仍不行就看「启动并诊断.bat」的输出）`,
        })
      })
    return () => {
      alive = false
    }
  }, [open])

  if (!open) return null

  /** 保存：端点 + 分阶段模型 + Key 一次写清 */
  const save = async (): Promise<boolean> => {
    const ep: EndpointConfig = {
      ...(current ?? DEFAULT_ENDPOINT),
      baseURL: baseURL.trim(),
      defaultModel: model.trim(),
      supportsVision: vision,
      /* 秒 → 毫秒；下限 10 秒，防止手滑填 0 把每次请求当场掐死 */
      timeoutMs: Math.max(10, Number(timeoutSec) || 120) * 1000,
    }
    const stages = payload?.stages ?? []
    const stageModels = { ...(payload?.stageModels ?? {}), ...Object.fromEntries(stages.map((s) => [s, ep.id])) }
    const others = (payload?.endpoints ?? []).filter((x) => x.id !== ep.id)

    const r = await api.saveEndpoints([...others, ep], stageModels, payload?.hash ?? null, false)
    if (key.trim()) await api.setKey(ep.id, key.trim())
    setKey('') // 不回显、也不留在内存里
    const next = await api.endpoints()
    setPayload({ ...next, hash: r.hash ?? next.hash })
    return true
  }

  const onSave = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await save()
      setMsg({ kind: 'ok', text: key.trim() ? '已保存（含 Key）。Key 不会回显。' : '已保存。' })
      onSaved?.()
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: `保存失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
    }
  }

  const onTest = async () => {
    setBusy(true)
    setMsg(null)
    try {
      // 先保存再测：测试读的是磁盘上的配置，不保存就等于测旧的
      await save()
      const r = await api.testEndpoint(endpointId)
      /**
       * 看图能力用**实测**结果回填复选框（第 8 期）。
       *
       * 为什么要自动回填：这件事不该让用户猜。很多"OpenAI 兼容"网关收不收图
       * 与型号名无关、而且在变；勾错了要么传图报错、要么明明能传却按钮是灰的。
       * 探针真实发一张 1×1 PNG，成败就写在结果里。
       * ⚠ 回填后还要用户**再点一次保存**才落盘 —— 我们不替用户做配置决定。
       */
      if (r.result?.vision) {
        setVision(Boolean(r.result.vision.ok))
        setMsg({
          kind: r.result.vision.ok ? 'ok' : 'err',
          text: `${r.text || r.result?.notice || ''}\n\n（已按实测结果${r.result.vision.ok ? '勾上' : '取消'}「支持看图」，请再点一次「保存」让它生效）`,
        })
      } else {
        setMsg({ kind: r.result?.ok ? 'ok' : 'err', text: r.text || r.result?.notice || '（没有返回信息）' })
      }
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: `测试失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
    }
  }

  const tone = msg?.kind === 'ok' ? 'text-emerald-700' : msg?.kind === 'err' ? 'text-red-700' : 'text-slate-600'

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-6 pt-24"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conn-title"
      data-od-id="connection-dialog"
    >
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="conn-title" className="text-base font-medium text-slate-900">
            连接设置
          </h2>
          <button type="button" className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>
            关闭
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          这里只填「模型地址」与「Key」。其余设置属开发用途，发布版不提供入口。
        </p>

        <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="conn-baseurl">
          接口地址
        </label>
        <input
          id="conn-baseurl"
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          placeholder="https://api.openai.com/v1"
          spellCheck={false}
        />

        <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="conn-model">
          模型 ID
        </label>
        <input
          id="conn-model"
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="gpt-4o-mini（或你服务商的模型名）"
          spellCheck={false}
        />

        <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="conn-key">
          Key
        </label>
        <input
          id="conn-key"
          type="password"
          autoComplete="off"
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={payload?.keyCount ? '已保存（不回显）· 留空表示不改' : '粘贴你的 API Key'}
          spellCheck={false}
        />

        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} />
          这个模型支持看图（教辅蒸馏要用）
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="conn-timeout">
          超时（秒）
        </label>
        <input
          id="conn-timeout"
          type="number"
          min={10}
          step={10}
          className="mt-1 w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={timeoutSec}
          onChange={(e) => setTimeoutSec(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          含义是「**多久没收到新内容**就算超时」，不是总时长。推理型模型首字慢，建议 120 秒以上；
          长题目生成到一半被掐断，就把这个数调大。
        </p>

        {msg && <p className={`mt-3 text-sm ${tone}`}>{msg.text}</p>}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            保存
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onTest}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50"
          >
            保存并测试连接
          </button>
          {busy && <span className="text-xs text-slate-500">处理中…</span>}
        </div>
      </div>
    </div>
  )
}
