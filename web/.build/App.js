import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 应用外壳：三块页面之间切换（§15 的解题页 / 动画页 / 设置页；蒸馏页留第 7 期）。
 *
 * 刻意**不引路由库**：三个页面、一个联合类型状态就能表达。
 * 引入 react-router 会为这点需求多带一个依赖与一套概念。
 *
 * ⚠ 第 5 期起多了"设置页"：本期它只落**世界书管理器 + 预览器**（M7/M20）；
 *   Prompt 编辑器 / 清洗规则 / 端点与分阶段模型排在**第 6 期**（§18 期 6）。
 */
import { useEffect, useState } from 'react';
import { AnimationPage } from './pages/AnimationPage';
import { DistillPage } from './pages/DistillPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RulesPage } from './pages/RulesPage';
import { SettingsPage } from './pages/SettingsPage';
import { SolvePage } from './pages/SolvePage';
import { useApp } from './state/store';
/**
 * 第 8 期：**发布构建开关**（用户 2026-10-17 裁决）。
 *
 * `OD_RELEASE=1` 构建 ⇒ 这个常量被替换成 `true` ⇒ 下面所有 `!RELEASE` 分支
 * 变成死代码 ⇒ Rollup 把「设置」「规则」两页的**组件与 import 一起摇掉**。
 * 所以发布产物里**根本没有这两个页面**（不是隐藏；F12 也翻不出来）。
 *
 * 本地开发（不设该环境变量）⇒ `false` ⇒ 两页都在，我们照常调。
 */
const RELEASE = __OD_RELEASE__;
export function App() {
    const [page, setPage] = useState('solve');
    const programSlots = useApp((s) => s.programSlots);
    const running = useApp((s) => s.run.running);
    const verdict = useApp((s) => s.run.verdict);
    // 动画就绪后自动切到动画页（用户的下一步意图是确定的，省一次点击）
    useEffect(() => {
        if (programSlots)
            setPage('animation');
    }, [programSlots]);
    return (_jsxs("div", { className: "min-h-screen", children: [_jsx("header", { className: "border-b border-slate-200 bg-white", children: _jsxs("div", { className: "mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3", children: [_jsxs("div", { className: "flex items-baseline gap-3", children: [_jsx("h1", { className: "text-lg font-semibold text-slate-900", children: "\u7269\u7406\u89E3\u9898\u52A8\u753B" }), _jsxs("span", { className: "text-xs text-slate-500", children: ["v", __OD_APP_VERSION__, " \u00B7 \u89E3\u9898 \u2192 \u52A8\u753B \u2192 \u6559\u8F85\u84B8\u998F"] })] }), _jsxs("nav", { className: "flex items-center gap-1", "aria-label": "\u4E3B\u5BFC\u822A", children: [_jsxs(NavButton, { active: page === 'solve', onClick: () => setPage('solve'), children: ["\u89E3\u9898", running && _jsx("span", { className: "ml-1 text-blue-600", children: "\u25CF" })] }), _jsx(NavButton, { active: page === 'animation', onClick: () => setPage('animation'), disabled: !programSlots, children: "\u52A8\u753B" }), _jsx(NavButton, { active: page === 'settings', onClick: () => setPage('settings'), children: "\u8BBE\u7F6E" }), !RELEASE && (_jsx(NavButton, { active: page === 'rules', onClick: () => setPage('rules'), children: "\u89C4\u5219" })), _jsx(NavButton, { active: page === 'distill', onClick: () => setPage('distill'), children: "\u84B8\u998F" })] })] }) }), !RELEASE && (_jsx("div", { className: "border-b border-amber-200 bg-amber-50", children: _jsxs("div", { className: "mx-auto max-w-[1400px] px-6 py-2 text-xs text-amber-900", children: ["\u89E3\u9898/\u52A8\u753B\u4E24\u9875\u4ECD\u7136\u8DD1\u7684\u662F", _jsx("strong", { children: "\u6F14\u793A\u6E90" }), "\uFF08\u4E0D\u8C03\u6A21\u578B\u3001\u7528\u672C\u5730\u771F\u9898\u9A71\u52A8\u754C\u9762\uFF09\uFF0C\u5224\u5B9A\u663E\u793A\u4E3A", _jsx("strong", { children: "\u300C\u672A\u6821\u9A8C\u300D" }), "\u3002\u771F\u6B63\u80FD", _jsx("strong", { children: "\u6539\u914D\u7F6E" }), "\u7684\u662F", _jsx("strong", { children: "\u300C\u89C4\u5219\u300D" }), "\u9875 \u2014\u2014 \u5B83\u9700\u8981\u4E00\u4E2A\u672C\u673A\u670D\u52A1\uFF08\u7528 ", _jsx("code", { className: "rounded bg-amber-100 px-1", children: "3-OpenRules.bat" }), " \u6253\u5F00\u624D\u53EF\u7528\uFF09\u3002", verdict === 'skipped' && _jsx("span", { className: "ml-1 font-medium", children: "\uFF08\u5F53\u524D\u8FD9\u4EFD\u7ED3\u679C\u5C31\u672A\u7ECF\u8FC7\u6821\u9A8C\uFF09" })] }) })), _jsx("main", { className: "mx-auto max-w-[1400px] px-6 py-6", children: _jsx(ErrorBoundary, { label: page === 'rules'
                        ? '规则'
                        : page === 'solve'
                            ? '解题'
                            : page === 'animation'
                                ? '动画'
                                : page === 'distill'
                                    ? '蒸馏'
                                    : '设置', children: page === 'solve' ? (_jsx(SolvePage, { onOpenAnimation: () => setPage('animation') })) : page === 'animation' ? (_jsx(AnimationPage, {})) : page === 'distill' ? (_jsx(DistillPage, {})) : !RELEASE && page === 'rules' ? (_jsx(RulesPage, {})) : page === 'settings' ? (_jsx(SettingsPage, {})) : (
                    /* 发布版：未知页码（理论上到不了）也退回解题页，不白屏 */
                    _jsx(SolvePage, { onOpenAnimation: () => setPage('animation') })) }, page) }), !RELEASE && (_jsx("footer", { className: "mx-auto max-w-[1400px] px-6 pb-8 text-xs text-slate-400", children: "\u5F00\u53D1\u6784\u5EFA \u00B7 \u4F9D\u636E\u300A\u7269\u7406\u89E3\u9898\u52A8\u753B\u8F6F\u4EF6\u81EA\u7814\u65B9\u6848\u300B\u00A715 / \u00A713 / \u00A79\uFF1B\u534F\u8BAE\u89C1 contracts/host-protocol.md\u3002" }))] }));
}
function NavButton({ active, disabled, onClick, children, }) {
    return (_jsx("button", { type: "button", disabled: disabled, onClick: onClick, "aria-current": active ? 'page' : undefined, className: `rounded-md px-3 py-1.5 text-sm ${active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'} ${disabled ? 'cursor-not-allowed text-slate-300 hover:bg-transparent' : ''}`, children: children }));
}
