/**
 * 错误边界：**让一块界面坏掉，而不是整页白屏**。
 *
 * 为什么这个项目需要它（不是通用样板代码）：第 6 期第 5 项的界面第一版就栽在这上面 ——
 * `read_problem` 的 `requirements` 有 `errors`，而 `solve` 只有 `warnings`，
 * 于是读 `requirements.errors.length` 抛了 TypeError，React 直接把**整棵树**卸载，
 * 用户看到的是纯白页面、控制台里才有堆栈。那是最坏的一种失败：**没有任何可读信息**。
 *
 * 现在：任何渲染期异常都会被这里接住，显示"哪一块坏了 + 错误信息 + 重试"，
 * 其余页面照常可用。注意它**只接渲染期**的异常（事件处理器里的异步错误仍走各自 try/catch）。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 出问题时显示的标题，用于区分"哪一块"坏了 */
  label: string
}

interface State {
  error: Error | null
  info: string
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null, info: '' }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 控制台留一份（真浏览器里能展开看组件栈）；界面上只显示摘要
    console.error(`[${this.props.label}] 渲染失败`, error, info.componentStack)
    this.setState({ info: info.componentStack ?? '' })
  }

  private reset = (): void => {
    this.setState({ error: null, info: '' })
  }

  render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="space-y-3 rounded border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        <p className="font-medium">「{this.props.label}」这块界面出错，已经停下（其余页面仍可用）</p>
        <p className="font-mono text-xs">{error.name}: {error.message}</p>
        <details className="text-[11px] text-rose-800">
          <summary className="cursor-pointer">组件栈（给开发者看）</summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono">{info || '（无）'}</pre>
        </details>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={this.reset}
            className="rounded border border-rose-400 bg-white px-2.5 py-1 text-xs text-rose-800 hover:bg-rose-100"
          >
            重试
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            整页刷新
          </button>
        </div>
        <p className="text-[11px] text-rose-700">
          如果这一步是在浏览器里改规则时发生的：请把它连同上面那行错误信息一起报出来 ——
          界面内部的这类错（数据形状对不上）在命令行里复现不了。
        </p>
      </div>
    )
  }
}
