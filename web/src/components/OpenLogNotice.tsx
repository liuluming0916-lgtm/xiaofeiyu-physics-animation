/**
 * 公测日志提示（v1.1.7）
 *
 * ── 为什么必须"第一次进解题页就说清楚" ──
 *
 * 从 1.1.7 起，软件会**自动把每次运行的现场导出成本机文件**（门禁 / 对话 / 动画代码 / 解题过程）。
 * 这件事如果不告知，公测用户会在别人电脑上发现一堆"开源日志"文件夹，产生两种误解：
 *   ① 以为软件在偷偷上传（**并没有**，只落在本机）；
 *   ② 以为是垃圾文件随手删掉 —— 而它恰恰是出问题时唯一能自查/求助的东西。
 *
 * 所以口径写死三句：**自动导出、只在本机、不含 Key**。
 *
 * ── "不再弹出"为什么存在 ──
 *
 * 这个提示对开发者有用、对每天用的老师是噪音。用户勾一次就永久关掉，
 * 判断写在 localStorage（与 `od-dev-mode` 同一套做法：这类界面偏好不值得进服务端配置）。
 *
 * ⚠ 键名带版本号：将来改成"每次启动提示"或改文案，换一个键就是新的一轮告知，
 *   **不能**复用旧键 —— 否则老用户永远看不到新口径。
 */

import { useCallback, useEffect, useState } from 'react'

/** localStorage 键（带版本，改口径就换键） */
export const NOTICE_KEY = 'od-open-log-notice-v1.1.7'

/**
 * 本次启动是否已经提示过（**模块级**，刷新页面即重置）。
 *
 * 为什么还要这一层：解题页每次切回来都会重新挂载，只靠 localStorage 的话，
 * 没勾「不再弹出」的用户会在"解题 ↔ 动画"之间来回时**反复**看到这个框 ——
 * 那就不是"第一次打开时提示"，而是骚扰。所以：
 *   · 同一次启动内最多一次（这个变量）；
 *   · 跨启动是否再提，由用户的勾选决定（localStorage）。
 */
let shownThisSession = false

/** 日志落点：与主进程 `OD_OPEN_LOG_DIR` 同一口径（程序目录/开源日志） */
const LOG_DIR_HINT = '软件所在文件夹\\开源日志'

export function OpenLogNotice() {
  /**
   * 初始不显示、挂载后读 localStorage 再决定。
   *
   * 为什么不在 `useState` 初始化里直接读：那是**渲染期副作用**，
   * 在 SSR/严格模式下会读两次；`useEffect` 更稳，而且"闪一下"的代价可以忽略
   * （这层遮罩出现时页面本来就刚加载）。
   */
  const [open, setOpen] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)

  useEffect(() => {
    let seen = false
    try {
      seen = localStorage.getItem(NOTICE_KEY) === '1'
    } catch {
      /* 隐私模式/存储被禁：当作没看过 —— 宁可多提示一次，也不要静默什么都不说 */
      seen = false
    }
    if (!seen && !shownThisSession) {
      shownThisSession = true
      setOpen(true)
    }
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    try {
      if (dontShowAgain) localStorage.setItem(NOTICE_KEY, '1')
    } catch {
      /* 存不下就下次再提示一次，不影响本次使用 */
    }
  }, [dontShowAgain])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-6 pt-20"
      role="dialog"
      aria-modal="true"
      aria-labelledby="open-log-title"
      data-od-id="open-log-notice"
    >
      <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="open-log-title" className="text-base font-medium text-slate-900">
            公测版会自动导出运行日志
          </h2>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">v1.2 · 公测</span>
        </div>

        <p className="mt-2 text-sm text-slate-700">
          从这一版开始，<strong>每跑完一道题都会自动留存一份现场</strong>（成功、报错、取消都留），
          导出到 <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px]">{LOG_DIR_HINT}</code> 文件夹。
          内容只有这四样：
        </p>

        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          <li>
            · <strong>门禁拦在哪</strong>：C1–C9 里是哪一条没过、原话是什么
          </li>
          <li>
            · <strong>你与大模型的对话</strong>：发出去的提示词 + 模型的完整回答
          </li>
          <li>
            · <strong>动画代码</strong>：这次生成的 8 个槽位
          </li>
          <li>
            · <strong>解题过程</strong>：读题 / 解题 / 分步 / 答案的文字
          </li>
        </ul>

        <p className="mt-3 rounded bg-emerald-50 p-2 text-xs text-emerald-900">
          <strong>只在本机</strong>：软件不会上传任何东西。
          <strong>不含 Key</strong>：API Key 与绝对路径都会先抹掉再写文件。
          每次是一对文件：<code>.html</code>（双击就能看）+ <code>.json</code>（给开发者排查用）。
          遇到问题时，把整个「开源日志」文件夹打包发给开发者即可。
        </p>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            data-od-id="open-log-dont-show"
          />
          不再弹出（下次直接开工，日志照常导出）
        </label>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={close}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800"
            data-od-id="open-log-ok"
          >
            我知道了
          </button>
          <span className="text-xs text-slate-500">这个提示只关乎本机文件，不影响解题。</span>
        </div>
      </div>
    </div>
  )
}
