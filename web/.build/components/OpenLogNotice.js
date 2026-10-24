import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 公测日志提示（v1.1.7 起；v1.2 改口径）
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
 * ── v1.2 改了两处 ──
 *   ① 补上"联系方式在关于里"：日志再全，找不到人也是白搭（公测版最要命的一条）；
 *   ② 文案口径与日志实际内容对齐（四样，不是三样）——**告知不能少于实收**。
 *
 * ── "不再弹出"为什么存在 ──
 *
 * 这个提示对开发者有用、对每天用的老师是噪音。用户勾一次就永久关掉，
 * 判断写在 localStorage（与 `od-dev-mode` 同一套做法：这类界面偏好不值得进服务端配置）。
 *
 * ⚠ 键名带版本号：将来改成"每次启动提示"或改文案，换一个键就是新的一轮告知，
 *   **不能**复用旧键 —— 否则老用户永远看不到新口径。
 */
import { useCallback, useEffect, useState } from 'react';
/** localStorage 键（带版本，改口径就换键） */
export const NOTICE_KEY = 'od-open-log-notice-v1.2.0';
/**
 * 本次启动是否已经提示过（**模块级**，刷新页面即重置）。
 *
 * 为什么还要这一层：解题页每次切回来都会重新挂载，只靠 localStorage 的话，
 * 没勾「不再弹出」的用户会在"解题 ↔ 动画"之间来回时**反复**看到这个框 ——
 * 那就不是"第一次打开时提示"，而是骚扰。所以：
 *   · 同一次启动内最多一次（这个变量）；
 *   · 跨启动是否再提，由用户的勾选决定（localStorage）。
 */
let shownThisSession = false;
/** 日志落点：与主进程 `OD_OPEN_LOG_DIR` 同一口径（程序目录/开源日志） */
const LOG_DIR_HINT = '软件所在文件夹\\开源日志';
export function OpenLogNotice() {
    /**
     * 初始不显示、挂载后读 localStorage 再决定。
     *
     * 为什么不在 `useState` 初始化里直接读：那是**渲染期副作用**，
     * 在 SSR/严格模式下会读两次；`useEffect` 更稳，而且"闪一下"的代价可以忽略
     * （这层遮罩出现时页面本来就刚加载）。
     */
    const [open, setOpen] = useState(false);
    const [dontShowAgain, setDontShowAgain] = useState(false);
    useEffect(() => {
        let seen = false;
        try {
            seen = localStorage.getItem(NOTICE_KEY) === '1';
        }
        catch {
            /* 隐私模式/存储被禁：当作没看过 —— 宁可多提示一次，也不要静默什么都不说 */
            seen = false;
        }
        if (!seen && !shownThisSession) {
            shownThisSession = true;
            setOpen(true);
        }
    }, []);
    const close = useCallback(() => {
        setOpen(false);
        try {
            if (dontShowAgain)
                localStorage.setItem(NOTICE_KEY, '1');
        }
        catch {
            /* 存不下就下次再提示一次，不影响本次使用 */
        }
    }, [dontShowAgain]);
    if (!open)
        return null;
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-6 pt-20", role: "dialog", "aria-modal": "true", "aria-labelledby": "open-log-title", "data-od-id": "open-log-notice", children: _jsxs("div", { className: "w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 shadow-xl", children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsx("h2", { id: "open-log-title", className: "text-base font-medium text-slate-900", children: "\u516C\u6D4B\u7248\u4F1A\u81EA\u52A8\u4FDD\u7559\u8FD0\u884C\u65E5\u5FD7" }), _jsx("span", { className: "rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800", children: "v1.2 \u00B7 \u516C\u6D4B" })] }), _jsxs("p", { className: "mt-2 text-sm text-slate-700", children: [_jsx("strong", { children: "\u6BCF\u6B21\u8DD1\u5B8C\u4E00\u9053\u9898\uFF08\u6210\u529F\u3001\u62A5\u9519\u3001\u53D6\u6D88\u90FD\u4F1A\u7559\uFF09" }), "\uFF0C\u8F6F\u4EF6\u4F1A\u5728", _jsx("code", { className: "rounded bg-slate-100 px-1 py-0.5 text-[12px]", children: LOG_DIR_HINT }), "\u91CC\u7559\u4E00\u4EFD\u73B0\u573A\u3002\u5185\u5BB9\u53EA\u6709\u8FD9\u56DB\u6837\uFF1A"] }), _jsxs("ul", { className: "mt-2 space-y-1 text-sm text-slate-700", children: [_jsxs("li", { children: ["\u00B7 ", _jsx("strong", { children: "\u51FA\u9519\u539F\u56E0" }), "\uFF1AC1\u2013C9 \u91CC\u662F\u54EA\u4E00\u6761\u6CA1\u8FC7\u3001\u539F\u8BDD\u662F\u4EC0\u4E48"] }), _jsxs("li", { children: ["\u00B7 ", _jsx("strong", { children: "\u672C\u6B21\u7684\u63D0\u793A\u8BCD\u4E0E\u6A21\u578B\u56DE\u7B54" }), "\uFF1A\u53D1\u51FA\u53BB\u7684\u539F\u8BDD + \u8FD4\u56DE\u7684\u5B8C\u6574\u5185\u5BB9"] }), _jsxs("li", { children: ["\u00B7 ", _jsx("strong", { children: "\u52A8\u753B\u4EE3\u7801" }), "\uFF1A\u8FD9\u6B21\u751F\u6210\u7684 8 \u4E2A\u69FD\u4F4D"] }), _jsxs("li", { children: ["\u00B7 ", _jsx("strong", { children: "\u89E3\u9898\u8FC7\u7A0B" }), "\uFF1A\u8BFB\u9898 / \u89E3\u9898 / \u5206\u6B65 / \u7B54\u6848\u7684\u6587\u5B57"] })] }), _jsxs("p", { className: "mt-3 rounded bg-emerald-50 p-2 text-xs text-emerald-900", children: [_jsx("strong", { children: "\u53EA\u5728\u672C\u673A" }), "\uFF1A\u8F6F\u4EF6\u4E0D\u4F1A\u4E0A\u4F20\u4EFB\u4F55\u5185\u5BB9\uFF0C\u5305\u62EC\u4F60\u7684 API Key \u4E0E\u7EDD\u5BF9\u8DEF\u5F84\u2014\u2014 \u5199\u6587\u4EF6\u524D\u4F1A\u5148\u62B9\u6389\u3002", _jsx("strong", { children: "\u4E00\u6B21\u8FD0\u884C\u7559\u4E0B\u4E00\u5BF9\u6587\u4EF6" }), "\uFF1A", _jsx("code", { children: ".html" }), "\uFF08\u53CC\u51FB\u5C31\u80FD\u770B\uFF09+", _jsx("code", { children: ".json" }), "\uFF08\u7ED9\u6211\u6392\u67E5\u7528\uFF09\u3002\u9047\u5230\u95EE\u9898\u65F6\uFF0C\u628A\u6574\u4E2A\u300C\u5F00\u6E90\u65E5\u5FD7\u300D\u6587\u4EF6\u5939\u6253\u5305\u53D1\u7ED9\u6211\uFF0C", _jsx("strong", { children: "\u8054\u7CFB\u65B9\u5F0F\u5728\u300C\u5173\u4E8E\u300D\u91CC" }), "\u3002"] }), _jsxs("label", { className: "mt-4 flex cursor-pointer items-center gap-2 text-sm text-slate-700", children: [_jsx("input", { type: "checkbox", checked: dontShowAgain, onChange: (e) => setDontShowAgain(e.target.checked), "data-od-id": "open-log-dont-show" }), "\u4E0D\u518D\u5F39\u51FA\uFF08\u4E0B\u6B21\u76F4\u63A5\u5F00\u5DE5\uFF0C\u65E5\u5FD7\u7167\u5E38\u5BFC\u51FA\uFF09"] }), _jsxs("div", { className: "mt-4 flex items-center gap-3", children: [_jsx("button", { type: "button", onClick: close, className: "rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800", "data-od-id": "open-log-ok", children: "\u6211\u77E5\u9053\u4E86" }), _jsx("span", { className: "text-xs text-slate-500", children: "\u8FD9\u4E2A\u63D0\u793A\u53EA\u5173\u4E4E\u672C\u673A\u6587\u4EF6\uFF0C\u4E0D\u5F71\u54CD\u89E3\u9898\u3002" })] })] }) }));
}
