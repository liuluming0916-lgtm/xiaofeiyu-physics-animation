/**
 * 应用外壳：三块页面之间切换（§15 的解题页 / 动画页 / 设置页）。
 *
 * 刻意**不引路由库**：三个页面、一个联合类型状态就能表达。
 * 引入 react-router 会为这点需求多带一个依赖与一套概念。
 *
 * ⚠ v1.1.9alpha 起：规则页与蒸馏页删除，设置页合并提示词卡 / 本地规则卡 / 知识卡 / AI 帮写。
 *   导航只剩 解题 / 动画 / 设置 / 导出；端点与 Key 走右上角「⚙ 连接设置」。
 */

import { useCallback, useEffect, useState } from 'react'

import { AnimationPage } from './pages/AnimationPage'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SettingsPage } from './pages/SettingsPage'
import { SolvePage } from './pages/SolvePage'
import { requestExport } from './lib/export-bus'
import { useRun } from './hooks/useRun'
import { useApp } from './state/store'

type Page = 'solve' | 'animation' | 'settings'

/**
 * 第 8 期：**发布构建开关**（用户 2026-10-17 裁决）。
 *
 * `OD_RELEASE=1` 构建 ⇒ 这个常量被替换成 `true` ⇒ 下面所有 `!RELEASE` 分支
 * 变成死代码 ⇒ Rollup 把「设置」「规则」两页的**组件与 import 一起摇掉**。
 * 所以发布产物里**根本没有这两个页面**（不是隐藏；F12 也翻不出来）。
 *
 * 本地开发（不设该环境变量）⇒ `false` ⇒ 两页都在，我们照常调。
 */
const RELEASE = __OD_RELEASE__

export function App() {
  const [page, setPage] = useState<Page>('solve')
  /**
   * ── v1.1.18：运行器挂在 App 级，而不是解题页 ──
   *
   * 用户裁决（B+1）：跑到一半切到设置页/动画页，解题应该**继续跑**。
   * 旧实现把 `useRun` 放在 `SolvePage` 里，页面一卸载就 `cancel()`；
   * 服务端随后发的 `cancelled/run_done` 没人接收，回来时按钮还卡在“生成中”。
   *
   * 挂到 App 级后，只有整个应用卸载（关窗口）才会取消；页面切换不影响流。
   */
  const { start, cancel } = useRun()
  /**
   * 动画页“手动打回”：
   *   · 当前只开放“从 solve 重跑”（沿用上一版读题/判定）；
   *   · 先 acknowledge，避免旧警告弹窗在新一轮里又弹；
   *   · 运行器在 App 级，所以页面不用卸载。
   */
  const manualRetry = useCallback(
    (mode: 'solve' | 'draw') => {
      const st = useApp.getState()
      if (!st.programSlots) return
      if (mode === 'draw' && !st.run.analysisText) return
      st.acknowledgeWarning()
      void start({
        source: 'server',
        startAt: mode,
        baseReadProblem: st.run.readProblemText,
        ...(mode === 'draw'
          ? { baseSlots: st.programSlots as unknown as Record<string, string>, baseAnalysisText: st.run.analysisText }
          : {}),
      })
    },
    [start],
  )
  const programSlots = useApp((s) => s.programSlots)
  const running = useApp((s) => s.run.running)
  const verdict = useApp((s) => s.run.verdict)

  /**
   * 动画就绪后自动切到动画页（用户的下一步意图是确定的，省一次点击）。
   *
   * ⚠ v1.1.16：**必须等这一轮跑完再跳**，不能只看 `programSlots`。
   *
   * 自愈会多次推 `dryrun_done`（首轮 + 每轮修复后），而每一次都会写 `programSlots`。
   * 旧写法只看 `programSlots`，于是第一次 dryrun（往往正是失败的那一版）就把用户送进动画页：
   *   · iframe 装进的是半成品；
   *   · 模板的 `applyProgram()` **第一次注入即锁死**（`program-already-inlined`），
   *     之后自愈修好的版本再也进不来 —— 用户看到的是白屏 + 第一次的报错。
   * 实测（2026-10-20，M1 传送带题）：需要自愈的题必白屏，一次过的题正常。
   *
   * 判据用 `run.running`：`run_done` 与 `failRun` 都会把它置 false。
   */
  useEffect(() => {
    // 只在"用户正停在解题页"时自动跳：正在设置页改东西的人不该被拽走
    if (programSlots && !running) setPage((prev) => (prev === 'solve' ? 'animation' : prev))
  }, [programSlots, running])

  /**
   * v1.1.16：跑动中（或还没有程序）时，导出入口一律禁用。
   * 理由同自动跳页：那时 `programSlots` 可能是自愈的半成品，
   * 导出去等于把"没收敛的代码"烧进一个看起来正式的 html。
   */
  const canExport = Boolean(programSlots) && !running

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold text-slate-900">小肥鱼物理动画</h1>
            {/* 第 9 期：版本号**不再写死** —— 构建期从 package.json 注入（见 rollup replace） */}
            <span className="text-xs text-slate-500">v{__OD_APP_VERSION__}</span>
            <span className="text-xs font-medium text-slate-600">开源的物理动画平台</span>
          </div>

          <nav className="flex items-center gap-1" aria-label="主导航">
            <NavButton active={page === 'solve'} onClick={() => setPage('solve')}>
              解题
              {running && <span className="ml-1 text-blue-600">●</span>}
            </NavButton>
            {/* ⚠ v1.1.16：跑的过程中**不许**进动画页 —— 那时 store 里放的可能是自愈的半成品，
                模板一旦收下就锁死（见上面自动跳页那段注释）。 */}
            <NavButton active={page === 'animation'} onClick={() => setPage('animation')} disabled={!programSlots || running}>
              动画
            </NavButton>
            {/* v1.1.9alpha：设置页是**唯一**的规则/知识入口（知识卡 / 提示词卡 / 本地规则卡 / AI 帮写）。 */}
            <NavButton active={page === 'settings'} onClick={() => setPage('settings')}>
              设置
            </NavButton>
            {/*
              ⚠ 第 9 期 v1.1.5（用户 2026-10-19）：**导出变成导航栏的一个键**，排在「设置」右边。
              这样动画页顶部那一整行工具栏可以彻底删掉，把高度让给画布。
              它只发请求（export-bus），真正的导出仍在动画页里做 —— 那里才有 iframe 的画布句柄。
            */}
            <details className="relative">
              <summary
                className={`inline-flex list-none select-none items-center rounded-md px-3 py-1.5 font-sans text-sm font-normal ${
                  running || !programSlots
                    ? 'cursor-not-allowed text-slate-300'
                    : 'cursor-pointer text-slate-700 hover:bg-slate-100'
                }`}
                title={running ? '还在跑，跑完再导出（自愈会改写动画代码）' : '导出网页 / GIF（需先在动画页生成）'}
              >
                导出
              </summary>
              <div className="absolute right-0 z-30 mt-1 w-60 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                <button
                  type="button"
                  disabled={!canExport}
                  className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                  onClick={() => {
                    if (!canExport) return
                    setPage('animation')
                    requestExport('page')
                  }}
                >
                  导出网页
                  <span className="block text-[11px] text-slate-500">双击即播的单文件，烧录出处信息</span>
                </button>
                <button
                  type="button"
                  disabled={!canExport}
                  className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                  onClick={() => {
                    if (!canExport) return
                    setPage('animation')
                    requestExport('gif')
                  }}
                >
                  导出 GIF
                  <span className="block text-[11px] text-slate-500">25 fps / 960×540，不含曲线图</span>
                </button>
              </div>
            </details>
          </nav>
        </div>
      </header>

      {/*
        ⚠ 第 9 期（用户裁决）：这条横幅**只在开发构建里出现**，发布版不显示。
        理由：它是给我们自己做验收用的交代（"这一版界面跑的是演示源"），
        而装到用户机器上的那一份**根本没有演示源**——它连的是真实链路。
        对外念"演示源 / 未校验 / 3-OpenRules.bat"，只会让人以为软件是半成品。
        用户真正需要知道的那件事（这次结果有没有过校验）由解题页的校验报告面板负责，那里是准的。
      */}
      {!RELEASE && (
        <div className="border-b border-amber-200 bg-amber-50">
          <div className="mx-auto max-w-[1400px] px-6 py-2 text-xs text-amber-900">
            解题/动画两页仍然跑的是<strong>演示源</strong>（不调模型、用本地真题驱动界面），判定显示为
            <strong>「未校验」</strong>。真正能<strong>改配置</strong>的是<strong>「设置」</strong>页 ——
            它需要一个本机服务（用 <code className="rounded bg-amber-100 px-1">3-OpenRules.bat</code> 打开才可用）。
            {verdict === 'skipped' && <span className="ml-1 font-medium">（当前这份结果就未经过校验）</span>}
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        {/* 每页一个错误边界：一块界面坏掉不该把整个应用变成白屏（第 6 期第 5 项的真实教训） */}
        <ErrorBoundary
          key={page}
          label={page === 'solve' ? '解题' : page === 'animation' ? '动画' : '设置'}
        >
          {page === 'solve' ? (
            <SolvePage onOpenAnimation={() => setPage('animation')} runStart={start} runCancel={cancel} />
          ) : page === 'animation' ? (
            <AnimationPage onManualRetry={manualRetry} />          ) : page === 'settings' ? (
            <SettingsPage />
          ) : (
            /* 未知页码（理论上到不了）也退回解题页，不白屏 */
            <SolvePage onOpenAnimation={() => setPage('animation')} runStart={start} runCancel={cancel} />
          )}
        </ErrorBoundary>
      </main>

      {/*
        第 9 期：页脚只在开发构建里出现。原来发布版也在念"《…自研方案》§15 / §13 / §9；
        协议见 contracts/host-protocol.md"——那是给写代码的人看的，用户不需要，
        而且会把内部文档路径暴露在界面上。
      */}
      {!RELEASE && (
        <footer className="mx-auto max-w-[1400px] px-6 pb-8 text-xs text-slate-400">
          开发构建 · 依据《物理解题动画软件自研方案》§15 / §13 / §9；协议见 contracts/host-protocol.md。
        </footer>
      )}
    </div>
  )
}

function NavButton({
  active,
  disabled,
  onClick,
  children,
  title,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-current={active ? 'page' : undefined}
      className={`rounded-md px-3 py-1.5 font-sans text-sm font-normal ${
        active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
      } ${disabled ? 'cursor-not-allowed text-slate-300 hover:bg-transparent' : ''}`}
    >
      {children}
    </button>
  )
}
