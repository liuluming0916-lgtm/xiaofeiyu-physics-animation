/**
 * 解题页（§15 第一页）。
 *
 * 本期的范围（见 README 12.17 / 13.1）：
 *   题面文字输入 · **题目图片输入（选择/拖入 + 缩略图 + 移除）** · **配图补充描述** ·
 *   **§11.3 视觉门控禁用态与原因提示** · 阶段进度 · 流式解题过程 · 校验报告面板
 *
 * ⚠ 两处必须显式告知用户、不能含糊的地方：
 *   1. **判定来源**：演示源的判定是 `skipped`（浏览器里没有校验内核），
 *      UI 必须把它显示成"未校验"而不是"通过"。**绝不谎报 pass。**
 *   2. **公式排版**：这里的公式是占位排版；**成品页里的公式是构建期 MathJax 真 SVG**。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ConnectionDialog } from '../components/ConnectionDialog'
import { DEMO_QUESTION_LIST } from '../lib/demo-questions'
import { STAGE_CHAIN, STAGE_LABEL, precisionLabel, type RepairBanner } from '../lib/run-stream'
import { api } from '../lib/rules-api'
import { Markdown, MathBlock, parseRowTable } from '../lib/markdown'
import { useRun } from '../hooks/useRun'
import { selectIsSkipped, useApp, listDevReports, clearDevReports } from '../state/store'

/** §16 的体积与格式限制（与 `core/gateway/model-client.mjs` 保持一致） */
const IMAGE_MAX_BYTES = 15 * 1024 * 1024
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp']

export function SolvePage({ onOpenAnimation }: { onOpenAnimation: () => void }) {
  const st = useApp()
  const { start, cancel } = useRun()
  const fileRef = useRef<HTMLInputElement>(null)
  /** 第 8 期 A2：连接设置小窗（发布版没有设置页，只能从这里填地址与 Key） */
  const [connOpen, setConnOpen] = useState(false)

  /**
   * §11.3 视觉门控（**第 8 期修正：不再写死**）。
   *
   * 历史：第 3 期这里写的是 `const visionAvailable = false`，理由是"演示模式没有端点，
   * 不假装支持图片"。但后来接上了本机服务与齿轮小窗，这一行就变成了**谎言的源头**：
   * 用户在齿轮里勾了"支持看图"、保存成功，界面仍然说"当前模型不支持图片输入"。
   *
   * 现在的口径：**如实转述服务端配置的 `supportsVision`**。
   *   · 没配端点 → 提示先去配；
   *   · 配了但不支持 → 提示去齿轮里勾上（如果服务商支持）；
   *   · 配了且支持 → 放开入口。
   * 真到模型那一步才发现不支持，也不是我们骗人 —— 界面上会显示模型返回的原话（不做假降级）。
   */
  const [visionAvailable, setVisionAvailable] = useState(false)
  /**
   * 这次运行走哪条路：
   *   `server` = 打本机 `/api/run`，**真实调用模型**（配了端点且有 Key）
   *   `demo`   = 本地真题演示（不调模型，判定为"未校验"）
   * 界面必须**如实显示**当前是哪条路 —— 之前写死 demo，用户装完以为在真跑。
   */
  const [runSource, setRunSource] = useState<'demo' | 'server'>('demo')
  const [visionNote, setVisionNote] = useState('正在读取连接配置…')

  const refreshVision = useCallback(() => {
    let alive = true
    api
      .endpoints()
      .then((data) => {
        if (!alive) return
        const ep = data.endpoints?.[0] ?? null
        if (!ep) {
          setVisionAvailable(false)
          setVisionNote('还没有配置模型：点右上角「⚙ 连接设置」填接口地址与 Key')
          setRunSource('demo')
          return
        }
        setVisionAvailable(Boolean(ep.supportsVision))
        setVisionNote(
          ep.supportsVision
            ? ''
            : '已配置的模型被标记为「不支持看图」。若你的服务商支持多模态，请到「⚙ 连接设置」勾上「这个模型支持看图」并保存',
        )
        /* 有端点但没 Key 时仍然走演示（真跑必然失败），界面会如实说明 */
        setRunSource(data.keyCount > 0 ? 'server' : 'demo')
      })
      .catch(() => {
        if (!alive) return
        setVisionAvailable(false)
        setVisionNote('读不到连接配置（本机服务未就绪）')
        setRunSource('demo')
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => refreshVision(), [refreshVision])

  const visionReason = visionNote || '当前模型不支持图片输入'

  const addFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return
      for (const file of Array.from(files)) {
        if (!ALLOWED_MIME.includes(file.type)) {
          useApp.getState().failRun(`不支持的图片格式：${file.type || '(未知)'}（仅支持 PNG / JPEG / WebP / BMP）`)
          continue
        }
        if (file.size > IMAGE_MAX_BYTES) {
          useApp.getState().failRun(`图片 ${(file.size / 1024 / 1024).toFixed(1)} MB 超过 15 MB 上限`)
          continue
        }
        const reader = new FileReader()
        reader.onload = () => {
          useApp.getState().addImage({ mime: file.type, dataUrl: String(reader.result), name: file.name })
        }
        reader.readAsDataURL(file)
      }
    },
    [],
  )

  const steps = useMemo(() => parseRowTable(st.run.stageText.steps ?? ''), [st.run.stageText.steps])

  /**
   * ⚠ 第 8 期修掉的 bug（用户实测）：**进页面就自动填入一道演示题**。
   *
   * 这里原本有一段 `useEffect`：`if (!st.problemText) setProblemText('水平传送带…')`，
   * 理由是"避免用户面对空白无从下手"。但实际上它做了两件坏事：
   *   ① 用户以为那是**自己的题**（或以为上一步没清空），点"开始解题"直接跑了别人的题；
   *   ② 想输入新题时得先手动全选删除，纯属添乱。
   * 空题面自带的 `<textarea placeholder="例：图中有倾角 30° 的斜面…">` 已经足够引导，
   * 想跑演示题的人走"演示"入口（下面那排 DEMO_QUESTION_LIST 按钮）——那是**显式**选择，不是偷偷填。
   */

  const running = st.run.running
  const skipped = selectIsSkipped(st)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      {/* ───────── 左：输入 ───────── */}
      <section className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium text-slate-900">题目输入</h2>
            {/* 第 8 期 A2：发布版没有「设置」页，模型地址与 Key 只能从这里填 */}
            <button
              type="button"
              onClick={() => setConnOpen(true)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              title="连接设置（模型地址与 Key）"
              aria-label="连接设置"
              data-od-id="open-connection"
            >
              ⚙ 连接设置
            </button>
          </div>

          <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="problem">
            题面文字
          </label>
          <textarea
            id="problem"
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500"
            rows={7}
            value={st.problemText}
            onChange={(e) => st.setProblemText(e.target.value)}
            placeholder="把题目粘贴到这里（支持 LaTeX：$v_0$、$\frac{1}{2}mv^2$）"
          />

          {/* ── 图片输入 + §11.3 门控 ── */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">题目图片</span>
              <span className="text-xs text-slate-500">PNG / JPEG / WebP / BMP · ≤15 MB</span>
            </div>

            <div
              className={`mt-2 rounded-md border border-dashed p-3 text-sm ${
                visionAvailable ? 'border-slate-300 bg-slate-50' : 'border-amber-300 bg-amber-50'
              }`}
              onDragOver={(e) => {
                if (visionAvailable) e.preventDefault()
              }}
              onDrop={(e) => {
                if (!visionAvailable) return
                e.preventDefault()
                addFiles(e.dataTransfer.files)
              }}
            >
              {visionAvailable ? (
                <>
                  <button
                    type="button"
                    className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                    onClick={() => fileRef.current?.click()}
                  >
                    选择图片
                  </button>
                  <span className="ml-2 text-xs text-slate-600">也可以把图片拖到这里</span>
                </>
              ) : (
                <div>
                  <p className="font-medium text-amber-900">图片入口已禁用</p>
                  <p className="mt-1 text-xs text-amber-800">{visionReason}</p>
                  <p className="mt-1 text-xs text-amber-800">
                    可以改用下面的「配图补充描述」，用文字把图中的关键几何关系写清楚。
                  </p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept={ALLOWED_MIME.join(',')}
                multiple
                className="hidden"
                disabled={!visionAvailable}
                onChange={(e) => addFiles(e.target.files)}
              />
            </div>

            {st.images.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {st.images.map((img, i) => (
                  <li key={`${img.name ?? 'img'}-${i}`} className="relative">
                    <img src={img.dataUrl} alt={img.name ?? `题目图片 ${i + 1}`} className="h-20 w-20 rounded border object-cover" />
                    <button
                      type="button"
                      aria-label={`移除图片 ${i + 1}`}
                      className="absolute -right-1 -top-1 rounded-full bg-slate-800 px-1.5 text-xs text-white"
                      onClick={() => st.removeImage(i)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="desc">
            配图补充描述（可选：图看不清时手打一段）
          </label>
          <textarea
            id="desc"
            rows={2}
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
            value={st.description}
            onChange={(e) => st.setDescription(e.target.value)}
            placeholder="例：图中有倾角 30° 的斜面，底端接一段水平面，物块从斜面顶端开始下滑"
          />

          {/*
            ⚠ 第 8 期：**「模式」下拉已删除**（用户 2026-10-18 裁决「合并数值与符号模式」）。
            理由：判据（C7）本来就按条目走 —— `value` 是数字就数值复现、是 `null` 就要求 `latex`；
            全局开关只会逼用户先判对题型（判错就一路错到底），而且"一问数值一问符号"根本没法选。
            现在由模型逐条决定，用户不需要事先声明。
          */}

          {/*
            ── 第 8 期：**开发模式（不拦截）**开关（用户裁决）──
            用户的判断：模型产出的代码已经足够好，而 C1–C9 里有会冤枉人的判据
            （这一轮实测抓到 C1 的 isFinite、C4 的标注位移、C6 的速度跳变三处误报）。
            勾上后：校验照做、报告照写、该红还红，但**不拦交付**（也不跑自愈），代码直接进动画页。
            留档：每次放行都把整份报告存进本机 localStorage（"开发模式留档"面板可下载）。

            ⚠ 第 9 期：**发布构建里不出现**（用户裁决）。它是调试用的逃生门，
            摆在最终用户面前只会被误当成"正式功能"。
          */}
          {!__OD_RELEASE__ && (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
              <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={st.devMode}
                  onChange={(e) => st.setDevMode(e.target.checked)}
                  data-od-id="dev-mode-toggle"
                />
                <span>
                  <span className="font-medium">开发模式（不拦截校验）</span>
                  ：C1–C9 照常校验、照常写报告，但**不再阻止动画生成**，代码直接进动画页播放。
                  被放行的检查会在报告与导出文件里标明 —— 别用它出正式产物。
                </span>
              </label>
            </div>
          )}

          {/* 主按钮只有一个（§15：同一个动作只有一个主按钮，不重复主 CTA） */}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              /**
               * ⚠ 门槛是"**题面文字 或 至少一张图**"，不是"题面必须非空"。
               *
               * 曾经写成 `!st.problemText.trim()`：于是**纯图片题根本点不了**（用户实测反馈），
               * 只能在文字框里随便敲两个字才能提交 —— 等于逼用户写假数据。
               * 纯图片题是这个产品的正当入口（拍照搜题），不该被这条校验挡住。
               */
              disabled={running || (!st.problemText.trim() && st.images.length === 0)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              onClick={() => void start({ source: runSource })}
            >
              {running ? '生成中…' : '开始生成动画'}
            </button>
            {running && (
              <button type="button" className="text-sm text-slate-600 underline hover:text-slate-900" onClick={cancel}>
                取消
              </button>
            )}
          </div>

          {/* 两个都空时**说清楚**差什么，而不是让按钮灰着一个字不解释 */}
          {!running && !st.problemText.trim() && st.images.length === 0 && (
            <p className="mt-2 text-xs text-slate-500">
              至少给一样：**题面文字**，或**一张题目图片**（纯图片题可以直接点上面的按钮）。
            </p>
          )}

          {/* 这一行必须**如实**说清当前走哪条路（第 8 期实测教训：写死 demo 等于骗人） */}
          {runSource === 'server' ? (
            <p className="mt-3 rounded bg-emerald-50 p-2 text-xs text-emerald-900">
              <strong>已接本机模型</strong>：点「开始生成动画」会**真实调用你配置的模型**（解题 → 分步 → 动画代码），
              并在服务端跑 C1–C9 校验。<strong>判定来自真实校验内核</strong>（不再是"未校验"）。
              想看演示（不花 token）：在「⚙ 连接设置」里删掉 Key 即可退回演示源。
            </p>
          ) : (
            <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-900">
              <strong>当前是「演示源」</strong>：不调用模型，用本地真题（
              {DEMO_QUESTION_LIST.map((q) => q.title).join('、')}）走完整前端流程，
              判定显示为「未校验」。<strong>想真正解题</strong>：点右上角「⚙ 连接设置」填接口地址、模型 ID 与 Key，
              保存后这里会变成「已接本机模型」。
            </p>
          )}
        </div>
      </section>

      {/* ───────── 右：进度 + 解题过程 + 校验报告 ───────── */}
      <section className="space-y-4">
        <StageProgress
          stages={st.run.stages.length ? st.run.stages : [...STAGE_CHAIN]}
          status={st.run.stageStatus}
          ms={st.run.stageMs}
          skipReason={st.run.stageSkipReason}
        />

        {st.run.error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4">
            <p className="font-medium text-red-900">
              {st.run.error.kind === 'auth'
                ? '模型鉴权失败'
                : st.run.error.kind === 'network'
                  ? '无法连接模型端点'
                  : '出错了'}
            </p>
            <p className="mt-1 text-sm text-red-800">{st.run.error.message}</p>
            {st.run.error.hint && <p className="mt-1 text-xs text-red-700">→ {st.run.error.hint}</p>}
          </div>
        )}

        {/*
          ⚠ 告警横幅必须**醒目且在报告之前**（§21.2 第 8 条：绝不静默交付可疑结果）。
          它是 `core/repair/plan.mjs` 的 `buildBanner()` 生成的，前端只负责显示，
          **不做任何"要不要显示"的判断** —— 那种判断一旦写错，失败就会被藏起来。
        */}
        {st.run.banner && <WarningBanner banner={st.run.banner} />}

        {(st.run.stageText.solve || st.run.stageText.steps || st.run.stageText.answers) && (
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-medium text-slate-900">解题过程</h2>
            {st.run.promptHash && (
              <p className="mt-1 font-mono text-[11px] text-slate-400">promptHash = {st.run.promptHash}</p>
            )}
            <div className="mt-3 space-y-4 text-sm text-slate-800">
              <div>
                <h3 className="mb-1 text-sm font-semibold text-slate-500">解题</h3>
                <Markdown text={st.run.stageText.solve ?? ''} />
              </div>
              {steps.length > 0 && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-500">分步解析</h3>
                  <ol className="space-y-2">
                    {steps.map((s, i) => (
                      <li key={i} className="rounded border border-slate-200 p-3">
                        <p className="font-medium text-slate-900">{s.title ?? `第 ${i + 1} 步`}</p>
                        <div className="mt-1 text-slate-700">
                          {/*
                            ⚠ 必须用 `MathBlock` 而**不是** `<Markdown>`：
                            行式表的 `tex` 字段是**裸 LaTeX**，没有 `$` 定界符。
                            交给 `Markdown` 会被当成普通文字 ⇒ 屏幕上出现 `\frac` 原文
                            （第 3 期交付后用户当场发现的问题，见 README 13.12）。
                          */}
                          <MathBlock tex={s.tex ?? ''} />
                        </div>
                        <p className="mt-1 font-mono text-xs text-slate-500">
                          t ∈ [{s.t0 ?? '?'}, {s.t1 ?? '?'}] s
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </div>
        )}

        {st.run.verdict && <VerdictPanel run={st.run} skipped={skipped} />}

        {/* 第 5 期：世界书依据（§15）——"为什么引用了这条知识、进了哪个槽位"必须让老师看得懂 */}
        {st.run.worldbook && <WorldbookPanel run={st.run} />}

        {/* 第 4 期：自愈过程对用户可见（B6）——修了几轮、改了哪些槽位、为什么改 */}
        {st.run.repairRounds.length > 0 && <RepairPanel run={st.run} />}

        {st.programSlots && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="text-sm text-green-900">动画已就绪。</p>
            <button
              type="button"
              className="mt-2 rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800"
              onClick={onOpenAnimation}
            >
              打开动画页 →
            </button>
          </div>
        )}
      </section>

      {/* 第 8 期 A2：连接设置小窗（发布版没有设置页，模型的地址与 Key 从这里填） */}
      <ConnectionDialog open={connOpen} onClose={() => setConnOpen(false)} onSaved={refreshVision} />
    </div>
  )
}

/* ────────────────────────────── 子组件 ────────────────────────────── */

/** 命中方式的中文标签（与 `core/worldbook/engine.mjs` 的 `via` 取值逐一对应） */
const WB_VIA_LABEL: Record<string, string> = {
  key: '主键命中',
  secondary: '次级键命中',
  constant: '常驻',
  recursive: '递归唤醒',
}

const WB_SLOT_LABEL: Record<string, string> = { solve: '解题', scene_code: '动画建模' }

/**
 * 世界书依据面板（§15 解题页 / §9.2 第 6 步）。
 *
 * 老师要看懂三件事：**为什么引用了这条知识**（命中方式）、**它进了哪个槽位**、
 * **有没有因为预算被丢掉**。所以"空槽"与"被截断"必须分开显示 ——
 * 否则"动画槽空"与"该槽词条全被截断"在界面上长得一模一样（§9.2 的"重要边界"）。
 */
function WorldbookPanel({ run }: { run: ReturnType<typeof useApp.getState>['run'] }) {
  const wb = run.worldbook
  if (!wb) return null
  if (wb.libraryCount === 0) {
    return (
      <div data-od-region="worldbook-evidence" className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-base font-medium text-slate-900">世界书依据</h2>
        <p className="mt-1 text-sm text-slate-600">本次没有挂载任何词条（词条库为空）。</p>
      </div>
    )
  }
  return (
    <div data-od-region="worldbook-evidence" className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-medium text-slate-900">世界书依据</h2>
        <span className="text-xs text-slate-500">
          库 {wb.libraryCount} 条 · 命中 {wb.matched} 条 · 解题槽 {wb.injectedBySlot.solve ?? 0} 条 / 动画槽{' '}
          {wb.injectedBySlot.scene_code ?? 0} 条
        </span>
      </div>

      {wb.matched === 0 ? (
        <p className="mt-2 text-sm text-slate-600">
          本次没有任何词条命中。这<strong>不是错误</strong>（空槽是正常情况，静默跳过），
          但说明这道题没有可用的规范支撑。
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {wb.entries.map((p) => (
            <li key={p.entry_id} className="py-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-slate-900">{p.title}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                  {WB_VIA_LABEL[p.via] ?? p.via}
                  {p.from ? ` ← ${p.from}` : ''}
                </span>
                <span className="text-[11px] text-slate-500">
                  注入：{p.injectedSlots.map((s) => WB_SLOT_LABEL[s] ?? s).join(' / ') || '（未挂槽位）'}
                  {p.unmounted ? ' · 未挂槽位' : ''}
                  {p.truncated ? ' · 被预算截断' : ''}
                </span>
                <code className="text-[11px] text-slate-400">{p.entry_id}</code>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {Object.entries(p.charsBySlot)
                  .map(([slot, n]) => `${WB_SLOT_LABEL[slot] ?? slot} ${n} 字符`)
                  .join(' · ') || '未注入任何槽位'}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 border-t border-slate-100 pt-2 text-[11px]">
        <p className="text-slate-600">
          空槽（静默跳过，合法）：
          {wb.emptySlots.length ? wb.emptySlots.map((s) => WB_SLOT_LABEL[s] ?? s).join(' / ') : '无'}
        </p>
        <p className="mt-0.5 text-amber-800">
          因预算截断（必须告警）：
          {wb.truncatedSlots.length
            ? wb.truncatedSlots.map((t) => `${WB_SLOT_LABEL[t.slot] ?? t.slot} 丢弃 ${t.dropped} 条`).join(' / ')
            : '无'}
        </p>
        {wb.warnings.map((w) => (
          <p key={`${w.code}-${w.entryId ?? ''}-${w.slot ?? ''}`} className="mt-0.5 text-amber-800">
            ⚠ {w.message}
          </p>
        ))}
        <p className="mt-1 text-slate-400">词条集合哈希 {wb.hash.slice(0, 16)}…</p>
      </div>
    </div>
  )
}

/**
 * 告警横幅（§21.2 第 8 条 / §14.2 的 B4）。
 *
 * 刻意做成**醒目的琥珀色大块 + 不可折叠**：它出现就意味着"你现在看到的结果没过校验"。
 * 文案由后端给（`banner.message` 里含失败检查号与轮数），前端不自己编。
 */
function WarningBanner({ banner }: { banner: RepairBanner }) {
  return (
    <div role="alert" className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 text-lg leading-none">⚠</span>
        <div className="min-w-0">
          <p className="font-semibold text-amber-900">{banner.title}</p>
          <p className="mt-1 text-sm text-amber-900">{banner.message}</p>
          <p className="mt-2 flex flex-wrap gap-2 text-xs">
            {banner.failedChecks.map((id) => (
              <span key={id} className="rounded border border-amber-400 bg-white px-1.5 py-0.5 font-mono text-amber-900">
                {id} 未通过
              </span>
            ))}
            <span className="rounded border border-amber-300 bg-white px-1.5 py-0.5 text-amber-800">
              已自动修复 {banner.rounds} 轮
            </span>
            <span className="rounded border border-amber-300 bg-white px-1.5 py-0.5 text-amber-800">
              {banner.playable ? '仍可播放（8 槽位齐全）' : `缺槽位：${banner.missing.join(' / ')}`}
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * 自愈过程面板（B6）。
 *
 * 显示每一轮：**为什么修**（触发的检查号 + 诊断，带证据强度）、**改了什么**（updated）、
 * **没动什么**（unchanged 的数量）。第三条是 §14.5 风险表第 1 条（"修复把对的槽位改坏"）
 * 在 UI 上的落点 —— 让用户看得见"其余槽位一个字节都没动"。
 */
function RepairPanel({ run }: { run: ReturnType<typeof useApp.getState>['run'] }) {
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-medium text-slate-900">自愈修复过程</h2>
        <span className="text-xs text-slate-600">
          {run.repairRounds.length} 轮 · {run.repairConverged ? '已收敛' : '未收敛（上限 3 轮）'}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-700">
        只重发**未通过校验的槽位**；其余槽位逐字节保留。
      </p>

      <ol className="mt-3 space-y-3">
        {run.repairRounds.map((r) => (
          <li key={r.round} className="rounded border border-violet-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="font-medium text-slate-900">第 {r.round} 轮</span>
              <span className="text-xs text-slate-500">{r.ms} ms</span>
              <span className={`text-xs ${r.verdict === 'pass' ? 'text-green-700' : 'text-amber-700'}`}>
                修复后判定：{r.verdict}
              </span>
            </div>

            <p className="mt-1 text-xs text-slate-700">
              触发：{r.triggeringChecks.length ? r.triggeringChecks.map((c) => <code key={c} className="mr-1 font-mono">{c}</code>) : '—'}
            </p>
            <p className="mt-1 text-xs text-slate-700">
              重发了：{r.requested.map((s) => <code key={s} className="mr-1 font-mono">{s}</code>)}
              {r.updated.length !== r.requested.length && (
                <> · 实际改写：{r.updated.map((s) => <code key={s} className="mr-1 font-mono">{s}</code>)}</>
              )}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              未改动 {r.unchanged.length} 个槽位（逐字节保留）
            </p>

            {r.diagnostics.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {r.diagnostics.flatMap((d) =>
                  (d.diagnostics.length ? d.diagnostics : [{ check: d.check, message: d.message, precision: null, slot: undefined, line: null }]).map(
                    (x, i) => (
                      <li key={`${d.check}-${i}`} className="flex flex-wrap items-baseline gap-1">
                        <span className="font-mono text-slate-500">{x.check}</span>
                        {x.slot && <span className="font-mono text-slate-700">{x.slot}</span>}
                        {x.line ? <span className="text-slate-500">第 {x.line} 行</span> : null}
                        {/* 证据强度必须显示：它告诉读者"这个行号有多可信"（§14.3 ①） */}
                        <span className="rounded border border-slate-300 px-1 text-[10px] text-slate-600">
                          {precisionLabel(x.precision)}
                        </span>
                        <span className="text-slate-700">{x.message}</span>
                      </li>
                    ),
                  ),
                )}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

function StageProgress({
  stages,
  status,
  ms,
  skipReason,
}: {
  stages: string[]
  status: Record<string, string>
  ms: Record<string, number>
  /** 第 5 期：被跳过的原因（纯文字题跳过读图转写时必须说出来，不能默默少一步） */
  skipReason: Record<string, string>
}) {
  return (
    <ol className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-sm">
      {stages.map((s, i) => {
        const st = status[s] ?? 'pending'
        const cls =
          st === 'done'
            ? 'bg-green-100 text-green-800 border-green-300'
            : st === 'running'
              ? 'bg-blue-100 text-blue-800 border-blue-300'
              : st === 'error'
                ? 'bg-red-100 text-red-800 border-red-300'
                : st === 'skipped'
                  ? 'bg-slate-100 text-slate-500 border-dashed border-slate-400'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`rounded border px-2 py-1 ${cls}`}
              title={st === 'skipped' ? (skipReason[s] ?? '本次不适用，已跳过') : undefined}
            >
              {i + 1}. {STAGE_LABEL[s] ?? s}
              {st === 'running' && ' …'}
              {st === 'skipped' && '（已跳过）'}
              {st === 'done' && ms[s] !== undefined && ` ${ms[s]}ms`}
            </span>
            {i < stages.length - 1 && <span className="text-slate-300">→</span>}
          </li>
        )
      })}
    </ol>
  )
}

function VerdictPanel({ run, skipped }: { run: ReturnType<typeof useApp.getState>['run']; skipped: boolean }) {
  const tone = skipped
    ? 'border-amber-300 bg-amber-50'
    : run.verdict === 'pass'
      ? 'border-green-300 bg-green-50'
      : run.verdict === 'fail'
        ? 'border-red-300 bg-red-50'
        : 'border-yellow-300 bg-yellow-50'

  const title = skipped
    ? '未校验（本次没有执行 C1–C9）'
    : run.verdict === 'pass'
      ? '校验通过'
      : run.verdict === 'fail'
        ? '校验未通过'
        : '校验有告警'

  return (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-medium text-slate-900">校验报告</h2>
        <span className="text-xs text-slate-600">耗时 {run.elapsedMs} ms</span>
      </div>
      <p className="mt-1 text-sm font-medium text-slate-900">{title}</p>
      {run.verdictNote && <p className="mt-1 text-xs text-slate-700">{run.verdictNote}</p>}

      {/*
        ── 第 8 期：**开发模式（不拦截）**的显著提示 ──
        用户要的是"别拦我"，但绝不能让"放行"变成**看不见的绿灯**：
        这里用琥珀色横幅点明"这条产物没过 C1–C9 的哪几条"，并且与导出/历史同源（gatesBypassed）。
      */}
      {run.advisory && (
        <div
          className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-900"
          data-od-id="advisory-banner"
        >
          <p className="font-medium">
            开发模式：本次校验**没有拦路**
            {run.gatesBypassed.length ? `，被放行的检查：${run.gatesBypassed.join(' / ')}` : '（没有任何检查失败）'}
          </p>
          <p className="mt-0.5">
            动画已照常生成，可以播放与导出；但产物**未通过硬判据**，导出文件与留档里都会写明这一点。
            想回到"拦住"：取消勾选「开发模式」重跑一次。
          </p>
        </div>
      )}

      {run.checks.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {run.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <span className={c.status === 'pass' ? 'text-green-700' : 'text-red-700'}>
                {c.status === 'pass' ? '✓' : '✗'}
              </span>
              <span className="font-mono">{c.id}</span>
              <span className="text-slate-700">{c.message}</span>
              {c.blocking && <span className="text-slate-400">（硬拒）</span>}
            </li>
          ))}
        </ul>
      )}

      {/*
        ── 第 8 期：把 "offenders"（现场）显示出来 ──
        用户的真题反馈：C6 只显示"位置跳变"四个字 + 四条候选行，看不出**哪个量、什么时刻、跳了多少**。
        真正的现场一直在 report 里，只是没送到界面。现在按"键: 前 → 后 @ t"一行一条列出，
        有任何 offenders 的检查都显示（不止 C6）。
      */}
      {run.checks.some((c) => (c.offenders?.length ?? 0) > 0) && (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2">
          <p className="text-[11px] font-medium text-amber-900">现场（判定抓到的东西）</p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-amber-900">
            {run.checks.flatMap((c) =>
              (c.offenders ?? []).map((o, i) => {
                const key = String(o.key ?? o.reason ?? o.snippet ?? '')
                const t = typeof o.t === 'number' ? ` @ t=${o.t}s` : ''
                const before = o.before !== undefined ? ` ${String(o.before)}` : ''
                const after = o.after !== undefined ? ` → ${String(o.after)}` : ''
                return (
                  <li key={`${c.id}-off-${i}`} className="font-mono">
                    <span className="mr-1 text-slate-500">{c.id}</span>
                    {key}
                    {before}
                    {after}
                    {t}
                  </li>
                )
              }),
            )}
          </ul>
        </div>
      )}

      {run.extensions.length > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          扩展检查：{run.extensions.map((e) => `${e.id}=${e.status}`).join(' · ')}
        </p>
      )}

      {run.diagnostics.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-700">
            行号级诊断（{run.diagnostics.length} 条）
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-white/70 p-2 text-[11px]">
            {JSON.stringify(run.diagnostics, null, 2)}
          </pre>
        </details>
      )}

      {/*
        ── 第 8 期：**把 8 个槽位的源码摆出来**（用户实测缺口）──
        用户两次反馈"我找不到动画代码写在哪里"：动画页只有 iframe + 通信日志，
        源码只存在于**导出的 html** 里。于是像"C7 说 x_1 不存在"这类问题，
        他只能把整个文件导出再贴给我 —— 这一步本该在界面上就能看。
        判定不是 pass 时**默认展开**（那正是最需要看代码的时候）。
      */}
      <ProgramSlotsPanel open={run.verdict !== 'pass'} />
      <DevReportsPanel />
    </div>
  )
}

/**
 * 开发模式留档（第 8 期 · 用户裁决"在本地网页中保存它认为错误的部分"）。
 *
 * 存在 localStorage：这是**开发期的本地草稿**，不进历史库、也不进正式归档 ——
 * 免得"未经验证的产物"与"验证过的产物"混在一起。
 */
function DevReportsPanel() {
  const [rows, setRows] = useState<Array<{ at: string; gatesBypassed: string[]; verdict: string }>>([])
  useEffect(() => {
    setRows(listDevReports().slice(-5).reverse())
  }, [])
  if (!rows.length) return null
  const download = () => {
    const json = JSON.stringify(listDevReports(), null, 2)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `od-dev-reports-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <details className="mt-3 rounded-lg border border-amber-300 bg-amber-50">
      <summary className="cursor-pointer px-3 py-2 text-xs text-amber-900">
        开发模式留档（最近 {rows.length} 次放行；本机浏览器里，共 {listDevReports().length} 条）
      </summary>
      <div className="border-t border-amber-200 px-3 py-2">
        <ul className="space-y-0.5 text-[11px] text-amber-900">
          {rows.map((r, i) => (
            <li key={`${r.at}-${i}`} className="font-mono">
              {r.at.slice(0, 19).replace('T', ' ')} · {r.verdict} · 放行 {r.gatesBypassed.join('/') || '—'}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="rounded border border-amber-400 px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-100"
            onClick={download}
          >
            下载全部 JSON
          </button>
          <button
            type="button"
            className="rounded border border-amber-400 px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-100"
            onClick={() => {
              clearDevReports()
              setRows([])
            }}
          >
            清空留档
          </button>
        </div>
      </div>
    </details>
  )
}

/** 8 个槽位的只读查看器（判定失败时默认展开） */
const SLOT_ORDER = ['PROBLEM', 'STEPS', 'ANSWERS', 'VIEW', 'setup', 'stateAt', 'drawFrame', 'readouts'] as const

function ProgramSlotsPanel({ open }: { open: boolean }) {
  const slots = useApp((s) => s.programSlots)
  if (!slots) return null
  const text = SLOT_ORDER.map((k) => `/* @slot:${k} */\n${slots[k] ?? ''}\n/* @end */`).join('\n\n')
  return (
    <details className="mt-3 rounded-lg border border-slate-200 bg-white" open={open}>
      <summary className="cursor-pointer px-3 py-2 text-xs text-slate-700">
        本次生成的程序（8 槽位）—— 排查 C1/C7 这类问题要对着它看
      </summary>
      <div className="border-t border-slate-100 px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">
            代码型槽位显示的是**函数体**（函数头由装配器提供）；数据型槽位是原始行式表 / JSON 文本。
          </p>
          <button
            type="button"
            className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
            onClick={() => {
              // 复制全部：本机页面，clipboard 可能需要用户手势 —— 上一次点击就是手势，够了
              void navigator.clipboard?.writeText(text)
            }}
          >
            复制全部
          </button>
        </div>
        <div className="space-y-2">
          {SLOT_ORDER.map((k) => (
            <div key={k}>
              <div className="font-mono text-[11px] text-slate-500">{`/* @slot:${k} */`}</div>
              <pre className="mt-0.5 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-800">
{slots[k] || '（缺失）'}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}
