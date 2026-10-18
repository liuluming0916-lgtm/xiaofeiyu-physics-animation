import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
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
import { Component } from 'react';
export class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null, info: '' };
    }
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        // 控制台留一份（真浏览器里能展开看组件栈）；界面上只显示摘要
        console.error(`[${this.props.label}] 渲染失败`, error, info.componentStack);
        this.setState({ info: info.componentStack ?? '' });
    }
    reset = () => {
        this.setState({ error: null, info: '' });
    };
    render() {
        const { error, info } = this.state;
        if (!error)
            return this.props.children;
        return (_jsxs("div", { className: "space-y-3 rounded border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900", children: [_jsxs("p", { className: "font-medium", children: ["\u300C", this.props.label, "\u300D\u8FD9\u5757\u754C\u9762\u51FA\u9519\uFF0C\u5DF2\u7ECF\u505C\u4E0B\uFF08\u5176\u4F59\u9875\u9762\u4ECD\u53EF\u7528\uFF09"] }), _jsxs("p", { className: "font-mono text-xs", children: [error.name, ": ", error.message] }), _jsxs("details", { className: "text-[11px] text-rose-800", children: [_jsx("summary", { className: "cursor-pointer", children: "\u7EC4\u4EF6\u6808\uFF08\u7ED9\u5F00\u53D1\u8005\u770B\uFF09" }), _jsx("pre", { className: "mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono", children: info || '（无）' })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", onClick: this.reset, className: "rounded border border-rose-400 bg-white px-2.5 py-1 text-xs text-rose-800 hover:bg-rose-100", children: "\u91CD\u8BD5" }), _jsx("button", { type: "button", onClick: () => window.location.reload(), className: "rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50", children: "\u6574\u9875\u5237\u65B0" })] }), _jsx("p", { className: "text-[11px] text-rose-700", children: "\u5982\u679C\u8FD9\u4E00\u6B65\u662F\u5728\u6D4F\u89C8\u5668\u91CC\u6539\u89C4\u5219\u65F6\u53D1\u751F\u7684\uFF1A\u8BF7\u628A\u5B83\u8FDE\u540C\u4E0A\u9762\u90A3\u884C\u9519\u8BEF\u4FE1\u606F\u4E00\u8D77\u62A5\u51FA\u6765 \u2014\u2014 \u754C\u9762\u5185\u90E8\u7684\u8FD9\u7C7B\u9519\uFF08\u6570\u636E\u5F62\u72B6\u5BF9\u4E0D\u4E0A\uFF09\u5728\u547D\u4EE4\u884C\u91CC\u590D\u73B0\u4E0D\u4E86\u3002" })] }));
    }
}
