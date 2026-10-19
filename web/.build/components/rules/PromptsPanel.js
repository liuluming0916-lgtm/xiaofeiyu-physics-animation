import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 提示词卡编辑器（原 `RulesPage` 的 `PromptsPanel`，只搬家、不改行为）。
 *
 * 口径不变：
 *   · 内置正文与我的覆盖并排；
 *   · 能不能保存、哪些记号不能删，全部由服务端回答，前端只显示 `issues`；
 *   · 分组写明"会不会跑"。
 */
import { useCallback, useEffect, useState } from 'react';
import { api, } from '../../lib/rules-api';
import { Button, IssueList, toIssues } from './shared';
const STATUS_TEXT = {
    builtin: '内置',
    ok: '已覆盖',
    stale: '⚠ 内置变过',
    'unknown-base': '⚠ 基线未知',
};
export function PromptsPanel() {
    const [cat, setCat] = useState(null);
    const [sel, setSel] = useState('read_problem');
    const [open, setOpen] = useState(null);
    const [text, setText] = useState('');
    const [issues, setIssues] = useState([]);
    const [warnings, setWarnings] = useState([]);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const refreshCat = useCallback(async () => {
        try {
            setCat(await api.promptCatalog());
        }
        catch (e) {
            const r = toIssues(e);
            setIssues(r.issues);
        }
    }, []);
    const loadOpen = useCallback(async (id) => {
        try {
            const o = await api.prompt(id);
            setOpen(o);
            setText(o.overrideText ?? o.builtinText);
            setIssues([]);
            setWarnings([]);
            setNote('');
        }
        catch (e) {
            const r = toIssues(e);
            setIssues(r.issues);
        }
    }, []);
    useEffect(() => {
        void refreshCat();
    }, [refreshCat]);
    useEffect(() => {
        void loadOpen(sel);
    }, [sel, loadOpen]);
    const run = async (fn) => {
        setBusy(true);
        setNote('');
        setIssues([]);
        setWarnings([]);
        try {
            await fn();
            await refreshCat();
            await loadOpen(sel);
        }
        catch (e) {
            const r = toIssues(e);
            setIssues(r.issues);
            setWarnings(r.warnings);
            setNote(r.message);
        }
        finally {
            setBusy(false);
        }
    };
    const save = () => run(async () => {
        const r = await api.savePrompt(sel, text, open?.expectedHash ?? null);
        setWarnings(r.warnings);
        setNote(`已保存（revision ${r.revision}）。下一题生效；正在跑的题仍用它开始时那份。`);
    });
    const reset = () => run(async () => {
        await api.resetPrompt(sel, open?.expectedHash ?? null);
        setNote('已恢复默认（删掉了覆盖副本）。下一题用内置。');
    });
    const rebase = () => run(async () => {
        await api.rebasePrompt(sel);
        setNote('已换基线：正文没动，只是把"我基于哪版内置"更新成现在这版。');
    });
    const groups = ['always', 'conditional', 'not-wired', 'embedded'];
    const itemsOf = (g) => (cat?.items ?? []).filter((it) => it.group === g);
    return (_jsxs("div", { className: "grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]", children: [_jsxs("div", { className: "space-y-3", children: [cat?.problems?.length ? _jsx(IssueList, { issues: cat.problems }) : null, groups.map((g) => {
                        const items = itemsOf(g);
                        if (!items.length)
                            return null;
                        const first = items[0];
                        return (_jsxs("section", { className: "rounded border border-slate-200 bg-white", children: [_jsxs("header", { className: "border-b border-slate-100 px-2 py-1.5", children: [_jsx("div", { className: "text-xs font-medium text-slate-800", children: first.groupTitle }), _jsx("div", { className: "text-[11px] leading-snug text-slate-500", children: first.groupHint })] }), _jsx("ul", { className: "divide-y divide-slate-100", children: items.map((it) => {
                                        const badge = it.override ? STATUS_TEXT[it.override.status] ?? it.override.status : STATUS_TEXT.builtin;
                                        return (_jsx("li", { children: _jsxs("button", { type: "button", onClick: () => setSel(it.id), className: `flex w-full items-center justify-between px-2 py-1.5 text-left text-xs ${sel === it.id ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`, children: [_jsxs("span", { className: "truncate", children: [_jsx("span", { className: "font-mono", children: it.id }), _jsx("span", { className: sel === it.id ? 'ml-1 text-slate-300' : 'ml-1 text-slate-400', children: it.label })] }), _jsx("span", { className: `ml-2 shrink-0 text-[11px] ${sel === it.id ? 'text-slate-200' : it.override ? 'text-amber-700' : 'text-slate-400'}`, children: badge })] }) }, it.id));
                                    }) })] }, g));
                    }), cat?.unknownFiles?.length ? (_jsxs("div", { className: "rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900", children: [_jsx("p", { className: "font-medium", children: "\u5DE5\u4F5C\u533A\u91CC\u6709\u3001\u4F46\u7A0B\u5E8F\u4E0D\u8BA4\u8BC6\u7684\u6587\u4EF6\uFF1A" }), cat.unknownFiles.map((u) => (_jsx("p", { className: "mt-1 font-mono", children: u.rel }, u.rel))), _jsx("p", { className: "mt-1", children: "\u8FD9\u4E9B\u4E0D\u4F1A\u88AB\u4EFB\u4F55\u9636\u6BB5\u7528\u5230\uFF08\u8981\u4E48\u6539\u540D\uFF0C\u8981\u4E48\u5220\u6389\uFF09\u3002" })] })) : null] }), _jsx("div", { className: "space-y-3", children: open ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2", children: [_jsxs("div", { children: [_jsxs("div", { className: "text-sm font-medium text-slate-900", children: [open.label, " ", _jsx("span", { className: "ml-1 font-mono text-xs text-slate-400", children: open.rel })] }), _jsxs("div", { className: "text-[11px] text-slate-500", children: ["\u72B6\u6001\uFF1A", STATUS_TEXT[open.status] ?? open.status, open.status === 'stale' ? ' —— 内置这套正文变了，你那份还是老的（下方有差异）' : '', open.status === 'unknown-base' ? ' —— 不知道它基于哪版内置（外部改过）' : ''] })] }), _jsxs("div", { className: "flex flex-wrap gap-1", children: [_jsx(Button, { onClick: save, disabled: busy, tone: "primary", children: "\u4FDD\u5B58" }), _jsx(Button, { onClick: rebase, disabled: busy || !open.overrideText, children: "\u6362\u57FA\u7EBF" }), _jsx(Button, { onClick: reset, disabled: busy || !open.overrideText, tone: "danger", children: "\u6062\u590D\u9ED8\u8BA4" })] })] }), (open.requirements?.errors ?? []).length ? (_jsxs("div", { className: "rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-900", children: [_jsx("p", { className: "font-medium", children: "\u8FD9\u4EFD\u6B63\u6587\u91CC**\u4E0D\u80FD\u5220**\u7684\u8BB0\u53F7\uFF08\u5220\u4E86\u4FDD\u5B58\u4E0D\u4E0A\uFF09\uFF1A" }), (open.requirements?.errors ?? []).map((r) => (_jsxs("p", { className: "mt-1", children: [_jsx("span", { className: "font-mono", children: r.token }), " \u2014\u2014 ", r.why] }, r.token)))] })) : null, _jsx(IssueList, { issues: issues, warnings: warnings }), note ? _jsx("p", { className: "text-xs text-slate-600", children: note }) : null, _jsxs("div", { className: "grid grid-cols-1 gap-3 xl:grid-cols-2", children: [_jsxs("div", { children: [_jsxs("div", { className: "mb-1 flex items-center justify-between", children: [_jsx("span", { className: "text-xs font-medium text-slate-700", children: "\u6211\u7684\u8986\u76D6\uFF08\u5B9E\u9645\u53D1\u51FA\u53BB\u7684\u5C31\u662F\u8FD9\u6BB5\uFF09" }), _jsxs("span", { className: "text-[11px] text-slate-400", children: [text.length, " \u5B57\u7B26"] })] }), _jsx("textarea", { value: text, onChange: (e) => setText(e.target.value), spellCheck: false, className: "h-[26rem] w-full resize-y rounded border border-slate-300 p-2 font-mono text-[12px] leading-relaxed text-slate-800" }), !open.overrideText ? (_jsx("p", { className: "mt-1 text-[11px] text-slate-500", children: "\u73B0\u5728\u663E\u793A\u7684\u662F**\u5185\u7F6E\u6B63\u6587**\u3002\u76F4\u63A5\u6539\u4E86\u4FDD\u5B58 = \u751F\u6210\u4E00\u4EFD\u8986\u76D6\u526F\u672C\uFF1B\u4E0D\u4FDD\u5B58\u5C31\u79BB\u5F00\u4E0D\u4F1A\u6539\u4EFB\u4F55\u4E1C\u897F\u3002" })) : null] }), _jsxs("div", { children: [_jsx("div", { className: "mb-1 text-xs font-medium text-slate-700", children: "\u5185\u7F6E\u6B63\u6587\uFF08\u7A0B\u5E8F\u81EA\u5E26\u7684\u90A3\u4EFD\uFF09" }), _jsx("pre", { className: "h-[26rem] overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[12px] leading-relaxed text-slate-600", children: open.builtinText })] })] }), open.status === 'stale' && open.diff ? (_jsxs("div", { className: "rounded border border-amber-300 bg-amber-50 p-2", children: [_jsx("div", { className: "text-xs font-medium text-amber-900", children: "\u5185\u7F6E\u53D8\u4E86\uFF1A+ \u662F\u5185\u7F6E\u65B0\u52A0\u7684\uFF08\u4E5F\u8BB8\u503C\u5F97\u6284\u8FDB\u4F60\u90A3\u4EFD\uFF09\uFF0C- \u662F\u5185\u7F6E\u5220\u6389\u7684" }), _jsx("pre", { className: "mt-1 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-amber-900", children: open.diff.lines
                                        .filter((l) => l.type !== 'same')
                                        .map((l) => `${l.type === 'add' ? '+' : '-'} ${l.text}`)
                                        .join('\n') || '（只有空白/顺序的差别）' }), open.baseSavedAt ? _jsxs("p", { className: "mt-1 text-[11px] text-amber-700", children: ["\u4F60\u8FD9\u4EFD\u7684\u57FA\u7EBF\u4FDD\u5B58\u4E8E ", open.baseSavedAt] }) : null] })) : null] })) : (_jsx("p", { className: "text-sm text-slate-500", children: "\u9009\u4E2D\u5DE6\u8FB9\u4E00\u4EFD Prompt \u67E5\u770B\u3002" })) })] }));
}
