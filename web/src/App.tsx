/**
 * 应用外壳：三块页面之间切换（§15 的解题页 / 动画页 / 设置页；蒸馏页留第 7 期）。
 *
 * 刻意**不引路由库**：三个页面、一个联合类型状态就能表达。
 * 引入 react-router 会为这点需求多带一个依赖与一套概念。
 *
 * ⚠ 第 5 期起多了"设置页"：本期它只落**世界书管理器 + 预览器**（M7/M20）；
 *   Prompt 编辑器 / 清洗规则 / 端点与分阶段模型排在**第 6 期**（§18 期 6）。
 */

import { useEffect, useState } from 'react'

import { AnimationPage } from './pages/AnimationPage'
import { DistillPage } from './pages/DistillPage'
import { ErrorBoundary } from './components/ErrorBoundary'
import { RulesPage } from './pages/RulesPage'
import { SettingsPage } from './pages/SettingsPage'
import { SolvePage } from './pages/SolvePage'
import { useApp } from './state/store'

type Page = 'solve' | 'animation' | 'settings' | 'rules' | 'distill'

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
  const programSlots = useApp((s) => s.programSlots)
  const running = useApp((s) => s.run.running)
  const verdict = useApp((s) => s.run.verdict)

  // 动画就绪后自动切到动画页（用户的下一步意图是确定的，省一次点击）
  useEffect(() => {
    if (programSlots) setPage('animation')
  }, [programSlots])

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold text-slate-900">物理解题动画</h1>
            {/* 第 9 期：版本号**不再写死** —— 构建期从 package.json 注入（见 rollup replace） */}
            <span className="text-xs text-slate-500">v{__OD_APP_VERSION__} · 解题 → 动画 → 教辅蒸馏</span>
          </div>

          <nav className="flex items-center gap-1" aria-label="主导航">
            <NavButton active={page === 'solve'} onClick={() => setPage('solve')}>
              解题
              {running && <span className="ml-1 text-blue-600">●</span>}
            </NavButton>
            <NavButton active={page === 'animation'} onClick={() => setPage('animation')} disabled={!programSlots}>
              动画
            </NavButton>
            {/* 第 9 期 v1.1.2：**设置页回到发布包**（里面有世界书管理器 / 词条编辑 / 导入导出）。
                规则页仍然只有开发期有——它需要单独起本机规则服务，不是给用户用的。 */}
            <NavButton active={page === 'settings'} onClick={() => setPage('settings')}>
              设置
            </NavButton>
            {!RELEASE && (
              <NavButton active={page === 'rules'} onClick={() => setPage('rules')}>
                规则
              </NavButton>
            )}
            <NavButton active={page === 'distill'} onClick={() => setPage('distill')}>
              蒸馏
            </NavButton>
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
            <strong>「未校验」</strong>。真正能<strong>改配置</strong>的是<strong>「规则」</strong>页 ——
            它需要一个本机服务（用 <code className="rounded bg-amber-100 px-1">3-OpenRules.bat</code> 打开才可用）。
            {verdict === 'skipped' && <span className="ml-1 font-medium">（当前这份结果就未经过校验）</span>}
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        {/* 每页一个错误边界：一块界面坏掉不该把整个应用变成白屏（第 6 期第 5 项的真实教训） */}
        <ErrorBoundary
          key={page}
          label={
            page === 'rules'
              ? '规则'
              : page === 'solve'
                ? '解题'
                : page === 'animation'
                  ? '动画'
                  : page === 'distill'
                    ? '蒸馏'
                    : '设置'
          }
        >
          {page === 'solve' ? (
            <SolvePage onOpenAnimation={() => setPage('animation')} />
          ) : page === 'animation' ? (
            <AnimationPage />
          ) : page === 'distill' ? (
            <DistillPage />
          ) : !RELEASE && page === 'rules' ? (
            <RulesPage />
          ) : page === 'settings' ? (
            <SettingsPage />
          ) : (
            /* 发布版：未知页码（理论上到不了）也退回解题页，不白屏 */
            <SolvePage onOpenAnimation={() => setPage('animation')} />
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
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`rounded-md px-3 py-1.5 text-sm ${
        active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
      } ${disabled ? 'cursor-not-allowed text-slate-300 hover:bg-transparent' : ''}`}
    >
      {children}
    </button>
  )
}
