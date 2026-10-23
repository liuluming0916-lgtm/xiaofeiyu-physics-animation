import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 应用外壳：三块页面之间切换（§15 的解题页 / 动画页 / 设置页）。
 *
 * 刻意**不引路由库**：三个页面、一个联合类型状态就能表达。
 * 引入 react-router 会为这点需求多带一个依赖与一套概念。
 *
 * ⚠ v1.1.9alpha 起：规则页与蒸馏页删除，设置页合并提示词卡 / 本地规则卡 / 知识卡 / AI 帮写。
 *   导航只剩 解题 / 动画 / 设置 / 导出；端点与 Key 走右上角「⚙ 连接设置」。
 */
import { useCallback, useEffect, useState } from 'react';
import { AnimationPage } from './pages/AnimationPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsPage } from './pages/SettingsPage';
import { SolvePage } from './pages/SolvePage';
import { requestExport } from './lib/export-bus';
import { useRun } from './hooks/useRun';
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
    /**
     * ── v1.1.18：运行器挂在 App 级，而不是解题页 ──
     *
     * 用户裁决（B+1）：跑到一半切到设置页/动画页，解题应该**继续跑**。
     * 旧实现把 `useRun` 放在 `SolvePage` 里，页面一卸载就 `cancel()`；
     * 服务端随后发的 `cancelled/run_done` 没人接收，回来时按钮还卡在“生成中”。
     *
     * 挂到 App 级后，只有整个应用卸载（关窗口）才会取消；页面切换不影响流。
     */
    const { start, cancel } = useRun();
    /**
     * 动画页“手动打回”：
     *   · 当前只开放“从 solve 重跑”（沿用上一版读题/判定）；
     *   · 先 acknowledge，避免旧警告弹窗在新一轮里又弹；
     *   · 运行器在 App 级，所以页面不用卸载。
     */
    const manualRetry = useCallback((mode) => {
        const st = useApp.getState();
        if (!st.programSlots)
            return;
        if (mode === 'draw' && !st.run.analysisText)
            return;
        st.acknowledgeWarning();
        void start({
            source: 'server',
            startAt: mode,
            baseReadProblem: st.run.readProblemText,
            ...(mode === 'draw'
                ? { baseSlots: st.programSlots, baseAnalysisText: st.run.analysisText }
                : {}),
        });
    }, [start]);
    const programSlots = useApp((s) => s.programSlots);
    const running = useApp((s) => s.run.running);
    const verdict = useApp((s) => s.run.verdict);
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
        if (programSlots && !running)
            setPage((prev) => (prev === 'solve' ? 'animation' : prev));
    }, [programSlots, running]);
    /**
     * v1.1.16：跑动中（或还没有程序）时，导出入口一律禁用。
     * 理由同自动跳页：那时 `programSlots` 可能是自愈的半成品，
     * 导出去等于把"没收敛的代码"烧进一个看起来正式的 html。
     */
    const canExport = Boolean(programSlots) && !running;
    return (_jsxs("div", { className: "min-h-screen", children: [_jsx("header", { className: "border-b border-slate-200 bg-white", children: _jsxs("div", { className: "mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3", children: [_jsxs("div", { className: "flex items-baseline gap-3", children: [_jsx("h1", { className: "text-lg font-semibold text-slate-900", children: "\u7269\u7406\u89E3\u9898\u52A8\u753B" }), _jsxs("span", { className: "text-xs text-slate-500", children: ["v", __OD_APP_VERSION__] }), _jsx("span", { className: "text-xs font-medium text-slate-600", children: "\u5F00\u6E90\u7684\u7269\u7406\u52A8\u753B\u5E73\u53F0" })] }), _jsxs("nav", { className: "flex items-center gap-1", "aria-label": "\u4E3B\u5BFC\u822A", children: [_jsxs(NavButton, { active: page === 'solve', onClick: () => setPage('solve'), children: ["\u89E3\u9898", running && _jsx("span", { className: "ml-1 text-blue-600", children: "\u25CF" })] }), _jsx(NavButton, { active: page === 'animation', onClick: () => setPage('animation'), disabled: !programSlots || running, children: "\u52A8\u753B" }), _jsx(NavButton, { active: page === 'settings', onClick: () => setPage('settings'), children: "\u8BBE\u7F6E" }), _jsxs("details", { className: "relative", children: [_jsx("summary", { className: `inline-flex list-none select-none items-center rounded-md px-3 py-1.5 font-sans text-sm font-normal ${running || !programSlots
                                                ? 'cursor-not-allowed text-slate-300'
                                                : 'cursor-pointer text-slate-700 hover:bg-slate-100'}`, title: running ? '还在跑，跑完再导出（自愈会改写动画代码）' : '导出网页 / GIF（需先在动画页生成）', children: "\u5BFC\u51FA" }), _jsxs("div", { className: "absolute right-0 z-30 mt-1 w-60 rounded-md border border-slate-200 bg-white p-1 shadow-lg", children: [_jsxs("button", { type: "button", disabled: !canExport, className: "block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent", onClick: () => {
                                                        if (!canExport)
                                                            return;
                                                        setPage('animation');
                                                        requestExport('page');
                                                    }, children: ["\u5BFC\u51FA\u7F51\u9875", _jsx("span", { className: "block text-[11px] text-slate-500", children: "\u53CC\u51FB\u5373\u64AD\u7684\u5355\u6587\u4EF6\uFF0C\u70E7\u5F55\u51FA\u5904\u4FE1\u606F" })] }), _jsxs("button", { type: "button", disabled: !canExport, className: "block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent", onClick: () => {
                                                        if (!canExport)
                                                            return;
                                                        setPage('animation');
                                                        requestExport('gif');
                                                    }, children: ["\u5BFC\u51FA GIF", _jsx("span", { className: "block text-[11px] text-slate-500", children: "25 fps / 960\u00D7540\uFF0C\u4E0D\u542B\u66F2\u7EBF\u56FE" })] })] })] })] })] }) }), !RELEASE && (_jsx("div", { className: "border-b border-amber-200 bg-amber-50", children: _jsxs("div", { className: "mx-auto max-w-[1400px] px-6 py-2 text-xs text-amber-900", children: ["\u89E3\u9898/\u52A8\u753B\u4E24\u9875\u4ECD\u7136\u8DD1\u7684\u662F", _jsx("strong", { children: "\u6F14\u793A\u6E90" }), "\uFF08\u4E0D\u8C03\u6A21\u578B\u3001\u7528\u672C\u5730\u771F\u9898\u9A71\u52A8\u754C\u9762\uFF09\uFF0C\u5224\u5B9A\u663E\u793A\u4E3A", _jsx("strong", { children: "\u300C\u672A\u6821\u9A8C\u300D" }), "\u3002\u771F\u6B63\u80FD", _jsx("strong", { children: "\u6539\u914D\u7F6E" }), "\u7684\u662F", _jsx("strong", { children: "\u300C\u8BBE\u7F6E\u300D" }), "\u9875 \u2014\u2014 \u5B83\u9700\u8981\u4E00\u4E2A\u672C\u673A\u670D\u52A1\uFF08\u7528 ", _jsx("code", { className: "rounded bg-amber-100 px-1", children: "3-OpenRules.bat" }), " \u6253\u5F00\u624D\u53EF\u7528\uFF09\u3002", verdict === 'skipped' && _jsx("span", { className: "ml-1 font-medium", children: "\uFF08\u5F53\u524D\u8FD9\u4EFD\u7ED3\u679C\u5C31\u672A\u7ECF\u8FC7\u6821\u9A8C\uFF09" })] }) })), _jsx("main", { className: "mx-auto max-w-[1400px] px-6 py-6", children: _jsx(ErrorBoundary, { label: page === 'solve' ? '解题' : page === 'animation' ? '动画' : '设置', children: page === 'solve' ? (_jsx(SolvePage, { onOpenAnimation: () => setPage('animation'), runStart: start, runCancel: cancel })) : page === 'animation' ? (_jsx(AnimationPage, { onManualRetry: manualRetry })) : page === 'settings' ? (_jsx(SettingsPage, {})) : (
                    /* 未知页码（理论上到不了）也退回解题页，不白屏 */
                    _jsx(SolvePage, { onOpenAnimation: () => setPage('animation'), runStart: start, runCancel: cancel })) }, page) }), !RELEASE && (_jsx("footer", { className: "mx-auto max-w-[1400px] px-6 pb-8 text-xs text-slate-400", children: "\u5F00\u53D1\u6784\u5EFA \u00B7 \u4F9D\u636E\u300A\u7269\u7406\u89E3\u9898\u52A8\u753B\u8F6F\u4EF6\u81EA\u7814\u65B9\u6848\u300B\u00A715 / \u00A713 / \u00A79\uFF1B\u534F\u8BAE\u89C1 contracts/host-protocol.md\u3002" }))] }));
}
function NavButton({ active, disabled, onClick, children, title, }) {
    return (_jsx("button", { type: "button", disabled: disabled, onClick: onClick, title: title, "aria-current": active ? 'page' : undefined, className: `rounded-md px-3 py-1.5 font-sans text-sm font-normal ${active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'} ${disabled ? 'cursor-not-allowed text-slate-300 hover:bg-transparent' : ''}`, children: children }));
}
