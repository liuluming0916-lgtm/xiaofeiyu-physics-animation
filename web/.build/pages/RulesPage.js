import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 规则工作室（第 6 期第 5 项的界面）。
 *
 * 四个页签对应 §18 第 6 行的"四类改动"，另加一个**状态**页说明这些规则存在哪、有没有坏：
 *   解题 Prompt / 清洗规则 / 端点与 Key / 工作区状态
 *
 * 三条刻意的界面口径（都不是装饰）：
 *   ① **分组并且写明"会不会跑"**：`worldbook` / `distill` 现在主链路不跑，平铺会让人以为改了有效果；
 *   ② **内置正文与我的覆盖并排**：改之前看得见"原来长什么样"，内置变了还能看行级差异；
 *   ③ **Key 只进不出**：输入框是密码型，列表里永远是打码值，导出按钮拿到的文本里没有 Key。
 *
 * 它不自己判任何东西：能不能保存、位置对不对、有没有撞锁定规则，全部由服务端的
 * 那套 Node 代码回答（前端只显示 `issues`）—— 否则就是"两套判据各说各话"。
 */
import { useCallback, useEffect, useState } from 'react';
import { RulesApiError, api, } from '../lib/rules-api';
const TABS = [
    { id: 'prompts', label: '解题 Prompt', hint: '改模型怎么解题、怎么判考点（§10）' },
    { id: 'cleaning', label: '清洗规则', hint: '模型输出的小修补；内置 3 条锁定不可关（§12）' },
    { id: 'endpoints', label: '端点与 Key', hint: '填地址、模型、Key；导出不含 Key（§11）' },
    { id: 'worldbook', label: '世界书', hint: '你自己的词条：能存回 ai-rules/worldbook/（§9）' },
    { id: 'status', label: '工作区状态', hint: '这些规则存在哪、有没有坏（§16）' },
];
export function RulesPage() {
    const [health, setHealth] = useState('checking');
    const [tab, setTab] = useState('prompts');
    useEffect(() => {
        let alive = true;
        api
            .health()
            .then(() => alive && setHealth('up'))
            .catch(() => alive && setHealth('down'));
        return () => {
            alive = false;
        };
    }, []);
    if (health === 'checking') {
        return _jsx("p", { className: "text-sm text-slate-500", children: "\u6B63\u5728\u8FDE\u63A5\u672C\u673A\u89C4\u5219\u670D\u52A1\u2026" });
    }
    if (health === 'down') {
        return _jsx(ServiceDown, {});
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "flex flex-wrap items-start justify-between gap-3", children: _jsxs("div", { children: [_jsx("h2", { className: "text-base font-semibold text-slate-900", children: "\u89C4\u5219\u5DE5\u4F5C\u5BA4" }), _jsxs("p", { className: "mt-1 text-xs text-slate-500", children: ["\u6539\u7684\u662F ", _jsx("code", { className: "rounded bg-slate-100 px-1", children: "ai-rules/" }), " \u4E0B\u7684\u771F\u5B9E\u6587\u4EF6\uFF1A\u539F\u5B50\u5199\u5165\u3001\u9010\u6587\u4EF6\u54C8\u5E0C\u3001\u6574\u6279\u751F\u6548\u6216\u6574\u6279\u5931\u8D25\u3002"] })] }) }), _jsx("nav", { className: "flex flex-wrap gap-1", "aria-label": "\u89C4\u5219\u5206\u7C7B", children: TABS.map((t) => (_jsxs("button", { type: "button", onClick: () => setTab(t.id), "aria-current": tab === t.id ? 'page' : undefined, className: `rounded-md border px-3 py-1.5 text-left text-xs ${tab === t.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`, children: [_jsx("span", { className: "block font-medium", children: t.label }), _jsx("span", { className: tab === t.id ? 'text-slate-200' : 'text-slate-400', children: t.hint })] }, t.id))) }), tab === 'prompts' ? (_jsx(PromptsPanel, {})) : tab === 'cleaning' ? (_jsx(CleaningPanel, {})) : tab === 'endpoints' ? (_jsx(EndpointsPanel, {})) : tab === 'worldbook' ? (_jsx(WorldbookPanel, {})) : (_jsx(StatusPanel, {}))] }));
}
function ServiceDown() {
    return (_jsxs("div", { className: "rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900", children: [_jsx("p", { className: "font-medium", children: "\u8FDE\u4E0D\u4E0A\u672C\u673A\u89C4\u5219\u670D\u52A1" }), _jsxs("p", { className: "mt-2 text-xs leading-relaxed", children: ["\u89C4\u5219\u5728\u78C1\u76D8\u4E0A\uFF08", _jsx("code", { children: "ai-rules/" }), "\uFF09\uFF0C\u6D4F\u89C8\u5668\u81EA\u5DF1\u6539\u4E0D\u4E86\u6587\u4EF6\uFF0C\u6240\u4EE5\u9700\u8981\u4E00\u4E2A\u672C\u673A\u670D\u52A1\u3002 \u8BF7\u7528\u9879\u76EE\u6839\u76EE\u5F55\u7684 ", _jsx("code", { className: "rounded bg-amber-100 px-1", children: "3-OpenRules.bat" }), " \u6253\u5F00\u8FD9\u4E2A\u9875\u9762 \uFF08\u5B83\u4F1A\u5728 127.0.0.1:8080 \u8D77\u4E00\u4E2A\u670D\u52A1\uFF0C\u540C\u65F6\u53D1\u9875\u9762\u548C\u63A5\u53E3\uFF09\u3002"] }), _jsxs("p", { className: "mt-2 text-xs", children: ["\u4F60\u4E5F\u53EF\u4EE5\u5728\u547D\u4EE4\u884C\u91CC\u8DD1\uFF1A", _jsx("code", { className: "rounded bg-amber-100 px-1", children: "node tools/rules-service.mjs" })] }), _jsxs("p", { className: "mt-2 text-xs text-amber-800", children: ["\u5982\u679C\u9875\u9762\u662F\u7528\u65E7\u7684 ", _jsx("code", { children: "2-OpenUI.bat" }), "\uFF08\u7EAF\u9759\u6001\uFF09\u6253\u5F00\u7684\uFF0C\u90A3\u5C31\u6CA1\u6709\u63A5\u53E3\u53EF\u7528 \u2014\u2014 \u90A3\u8FB9\u53EA\u80FD\u770B\uFF0C\u4E0D\u80FD\u6539\u3002"] })] }));
}
/* ────────────────────────────── 通用小件 ────────────────────────────── */
function IssueList({ issues, warnings }) {
    if (!issues.length && !(warnings?.length ?? 0))
        return null;
    return (_jsxs("div", { className: "space-y-2", children: [issues.map((it, i) => (_jsxs("div", { className: "rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900", children: [_jsxs("span", { className: "font-mono text-[11px] text-rose-700", children: ["[", it.code, "]"] }), " ", _jsx("span", { className: "font-mono", children: it.path }), _jsx("div", { className: "mt-0.5", children: it.message }), it.hint ? _jsxs("div", { className: "mt-1 text-rose-700", children: ["\u2192 ", it.hint] }) : null] }, `e-${i}`))), (warnings ?? []).map((it, i) => (_jsxs("div", { className: "rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900", children: [_jsxs("span", { className: "font-mono text-[11px]", children: ["[", it.code, "]"] }), " ", it.message, it.hint ? _jsxs("div", { className: "mt-1 text-amber-700", children: ["\u2192 ", it.hint] }) : null] }, `w-${i}`)))] }));
}
function Button({ children, onClick, disabled, tone = 'default', }) {
    const cls = tone === 'primary'
        ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
        : tone === 'danger'
            ? 'border-rose-300 bg-white text-rose-700 hover:bg-rose-50'
            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50';
    return (_jsx("button", { type: "button", onClick: onClick, disabled: disabled, className: `rounded border px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${cls}`, children: children }));
}
function toIssues(e) {
    if (e instanceof RulesApiError)
        return { issues: e.issues, warnings: e.warnings, message: e.message };
    return { issues: [{ code: 'client.error', path: '.', message: String(e instanceof Error ? e.message : e) }], warnings: [], message: '出错了' };
}
/* ────────────────────────────── 1. Prompt ────────────────────────────── */
const STATUS_TEXT = {
    builtin: '内置',
    ok: '已覆盖',
    stale: '⚠ 内置变过',
    'unknown-base': '⚠ 基线未知',
};
function PromptsPanel() {
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
/* ────────────────────────────── 2. 清洗规则 ────────────────────────────── */
const EMPTY_RULE = { id: '', name: '', stage: 'scene_code', pattern: '', flags: 'g', replacement: '', enabled: true };
function CleaningPanel() {
    const [table, setTable] = useState(null);
    const [draft, setDraft] = useState(EMPTY_RULE);
    const [issues, setIssues] = useState([]);
    const [warnings, setWarnings] = useState([]);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const refresh = useCallback(async () => {
        try {
            const t = await api.cleaning();
            // 兜底：接口少给一个数组时按空数组显示，而不是让整个页面崩掉（第 6 期白屏的教训）
            setTable({
                ...t,
                rules: Array.isArray(t.rules) ? t.rules : [],
                effective: Array.isArray(t.effective) ? t.effective : [],
                locked: Array.isArray(t.locked) ? t.locked : [],
            });
        }
        catch (e) {
            const r = toIssues(e);
            setIssues(r.issues);
        }
    }, []);
    useEffect(() => {
        void refresh();
    }, [refresh]);
    const run = async (fn, success) => {
        setBusy(true);
        setIssues([]);
        setWarnings([]);
        setNote('');
        try {
            await fn();
            await refresh();
            setNote(success);
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
    const add = () => run(async () => {
        const r = await api.addRule(draft);
        setWarnings(r.warnings);
        setDraft(EMPTY_RULE);
    }, '已加入（排在用户规则最后；它在内置 3 条之后执行）');
    const userRows = (table?.effective ?? []).filter((r) => r.source === 'user');
    const userIndex = (id) => userRows.findIndex((r) => r.id === id);
    return (_jsxs("div", { className: "grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]", children: [_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "rounded border border-slate-200 bg-white", children: [_jsxs("header", { className: "border-b border-slate-100 px-3 py-2", children: [_jsx("div", { className: "text-sm font-medium text-slate-900", children: "\u751F\u6548\u987A\u5E8F\uFF08\u4ECE\u4E0A\u5230\u4E0B\u6267\u884C\uFF09" }), _jsx("div", { className: "text-[11px] text-slate-500", children: "\u524D 3 \u6761\u662F**\u9501\u5B9A**\u7684\u5185\u7F6E\u89C4\u5219\uFF1A\u4E0D\u53EF\u7981\u7528\u3001\u4E0D\u53EF\u6539\u3001\u4E0D\u53EF\u5220\uFF0C\u6C38\u8FDC\u5148\u8DD1\u3002\u4F60\u7684\u89C4\u5219\u5728\u5B83\u4EEC\u4E4B\u540E\u3002" })] }), _jsx("ol", { className: "divide-y divide-slate-100", children: (table?.effective ?? []).map((row) => (_jsxs("li", { className: "px-3 py-2", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2 text-xs", children: [_jsx("span", { className: "w-6 shrink-0 text-right font-mono text-slate-400", children: row.order }), _jsx("span", { className: `shrink-0 rounded px-1.5 py-0.5 text-[11px] ${row.source === 'locked' ? 'bg-slate-900 text-white' : row.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`, children: row.source === 'locked' ? '锁定' : row.enabled ? '启用' : '停用' }), _jsx("span", { className: "font-mono text-slate-800", children: row.id }), _jsx("span", { className: "text-slate-500", children: row.name }), _jsxs("span", { className: "text-[11px] text-slate-400", children: ["stage=", row.stage] }), row.source === 'user' ? (_jsxs("span", { className: "ml-auto flex gap-1", children: [_jsx(Button, { onClick: () => void run(async () => {
                                                                await api.enableRule(row.id, !row.enabled);
                                                            }, `已${row.enabled ? '停用' : '启用'} ${row.id}`), disabled: busy, children: row.enabled ? '停用' : '启用' }), _jsx(Button, { onClick: () => {
                                                                const i = userIndex(row.id);
                                                                if (i > 0)
                                                                    void run(async () => {
                                                                        await api.moveRule(row.id, i - 1);
                                                                    }, '已上移');
                                                            }, disabled: busy || userIndex(row.id) <= 0, children: "\u2191" }), _jsx(Button, { onClick: () => {
                                                                const i = userIndex(row.id);
                                                                if (i < userRows.length - 1)
                                                                    void run(async () => {
                                                                        await api.moveRule(row.id, i + 1);
                                                                    }, '已下移');
                                                            }, disabled: busy || userIndex(row.id) >= userRows.length - 1, children: "\u2193" }), _jsx(Button, { tone: "danger", onClick: () => void run(async () => {
                                                                await api.deleteRule(row.id);
                                                            }, `已删除 ${row.id}`), disabled: busy, children: "\u5220\u9664" })] })) : null] }), row.source === 'locked' && row.note ? (_jsxs("div", { className: "mt-1 pl-8 text-[11px] leading-snug text-slate-500", children: ["\u56E0\u4E3A\u5B83\u515C\u4F4F\u7684\u662F\uFF1A", row.note] })) : null, row.source === 'user' && row.pattern ? (_jsxs("div", { className: "mt-1 pl-8 font-mono text-[11px] text-slate-500", children: ["/", row.pattern, "/"] })) : null] }, `${row.source}-${row.id}`))) })] }), _jsx(IssueList, { issues: issues, warnings: warnings }), note ? _jsx("p", { className: "whitespace-pre-wrap text-xs text-slate-600", children: note }) : null, _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { tone: "danger", disabled: busy || !(table?.rules.length ?? 0), onClick: () => void run(async () => {
                                    await api.resetCleaning();
                                }, '已恢复默认（删掉了你的规则表，只剩内置 3 条）'), children: "\u6062\u590D\u9ED8\u8BA4\uFF08\u5220\u6389\u6211\u7684\u5168\u90E8\u89C4\u5219\uFF09" }), _jsx(Button, { disabled: busy, onClick: () => void refresh(), children: "\u91CD\u65B0\u8F7D\u5165" })] })] }), _jsxs("div", { className: "space-y-2 rounded border border-slate-200 bg-white p-3", children: [_jsx("div", { className: "text-sm font-medium text-slate-900", children: "\u52A0\u4E00\u6761\u89C4\u5219" }), _jsxs("p", { className: "text-[11px] leading-snug text-slate-500", children: ["id / name / stage / pattern / flags / replacement\u3002\u6B63\u5219\u4F1A\u5148\u8BD5\u7F16\u8BD1\uFF1A**\u975E\u6CD5\u6B63\u5219\u4FDD\u5B58\u4E0D\u4E0A**\uFF1B\u52A8", _jsx("code", { className: "mx-1 rounded bg-slate-100 px-1", children: "@slot" }), "\u6807\u8BB0\u7684\u89C4\u5219\u4E5F\u4F1A\u88AB\u62D2\uFF08\u00A73.5 \u96F6\u731C\u6D4B\uFF09\u3002"] }), _jsx(Field, { label: "id\uFF08\u5B57\u6BCD\u6570\u5B57._-\uFF09", children: _jsx("input", { value: draft.id, onChange: (e) => setDraft({ ...draft, id: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs", placeholder: "pow-rewrite" }) }), _jsx(Field, { label: "\u540D\u79F0", children: _jsx("input", { value: draft.name, onChange: (e) => setDraft({ ...draft, name: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 text-xs", placeholder: "Math.pow \u6539\u5199\u6210\u4E58\u6CD5" }) }), _jsx(Field, { label: "\u9636\u6BB5", children: _jsx("select", { value: draft.stage, onChange: (e) => setDraft({ ...draft, stage: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 text-xs", children: ['read_problem', 'solve', 'steps', 'answers', 'scene_code', 'worldbook', 'distill'].map((s) => (_jsx("option", { value: s, children: s }, s))) }) }), _jsx(Field, { label: "\u6B63\u5219 pattern", children: _jsx("input", { value: draft.pattern, onChange: (e) => setDraft({ ...draft, pattern: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs", placeholder: "Math\\\\.pow\\\\(([^,]+),\\\\s*2\\\\)" }) }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx(Field, { label: "flags", children: _jsx("input", { value: draft.flags, onChange: (e) => setDraft({ ...draft, flags: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs", placeholder: "g" }) }), _jsx(Field, { label: "\u66FF\u6362\u4E3A", children: _jsx("input", { value: draft.replacement, onChange: (e) => setDraft({ ...draft, replacement: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs", placeholder: "($1)*($1)" }) })] }), _jsxs("div", { className: "flex items-center gap-2 pt-1", children: [_jsx(Button, { tone: "primary", disabled: busy || !draft.id || !draft.pattern, onClick: add, children: "\u52A0\u5165" }), _jsx("span", { className: "text-[11px] text-slate-400", children: "\u52A0\u5165\u540E\u9ED8\u8BA4\u542F\u7528\u3001\u6392\u5728\u6700\u540E" })] })] })] }));
}
function Field({ label, children }) {
    return (_jsxs("label", { className: "block", children: [_jsx("span", { className: "mb-0.5 block text-[11px] text-slate-500", children: label }), children] }));
}
/* ────────────────────────────── 3. 端点与 Key ────────────────────────────── */
function emptyEndpoint() {
    return {
        id: '',
        displayName: '',
        baseURL: 'https://',
        defaultModel: '',
        visionModel: '',
        apiKeyModelId: null,
        supportsJsonMode: true,
        supportsVision: false,
        enableThinking: false,
        preserveThinking: false,
        timeoutMs: 120000,
    };
}
function EndpointsPanel() {
    const [data, setData] = useState(null);
    const [draft, setDraft] = useState(emptyEndpoint());
    const [keyDraft, setKeyDraft] = useState({});
    const [issues, setIssues] = useState([]);
    const [warnings, setWarnings] = useState([]);
    const [note, setNote] = useState('');
    const [testText, setTestText] = useState({});
    const [importText, setImportText] = useState('');
    const [exportText, setExportText] = useState('');
    const [busy, setBusy] = useState(false);
    const refresh = useCallback(async () => {
        try {
            const d = await api.endpoints();
            // 兜底同清洗面板：形状不对就当空，不崩整页
            setData({
                ...d,
                endpoints: Array.isArray(d.endpoints) ? d.endpoints : [],
                stages: Array.isArray(d.stages) ? d.stages : [],
                stageModels: d.stageModels && typeof d.stageModels === 'object' ? d.stageModels : {},
                keysMasked: d.keysMasked && typeof d.keysMasked === 'object' ? d.keysMasked : {},
                warnings: Array.isArray(d.warnings) ? d.warnings : [],
            });
            setIssues([]);
        }
        catch (e) {
            const r = toIssues(e);
            // 409 = 还没配置：这是"空"而不是"坏"，用空列表显示 + 提示
            if (e instanceof RulesApiError && e.status === 409) {
                setData({ endpoints: [], stageModels: {}, stages: [], keysMasked: {}, keyCount: 0, warnings: [], hash: null });
                setIssues(r.issues);
            }
            else {
                setIssues(r.issues);
            }
        }
    }, []);
    useEffect(() => {
        void refresh();
    }, [refresh]);
    const run = async (fn, success) => {
        setBusy(true);
        setIssues([]);
        setWarnings([]);
        setNote('');
        try {
            await fn();
            await refresh();
            setNote(success);
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
    const upsert = () => run(async () => {
        if (!data)
            return;
        const list = [...data.endpoints];
        const i = list.findIndex((e) => e.id === draft.id);
        if (i >= 0)
            list[i] = draft;
        else
            list.push(draft);
        const r = await api.saveEndpoints(list, data.stageModels, data.hash);
        setWarnings(r.warnings);
        setDraft(emptyEndpoint());
    }, '已保存（写盘前已过 §11.2 九条校验）');
    const test = (id) => run(async () => {
        const r = await api.testEndpoint(id);
        setTestText({ ...testText, [id]: r.text });
    }, '');
    return (_jsxs("div", { className: "grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]", children: [_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "rounded border border-slate-200 bg-white", children: [_jsx("header", { className: "border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-900", children: "\u5DF2\u914D\u7F6E\u7684\u7AEF\u70B9" }), !(data?.endpoints.length ?? 0) ? (_jsx("p", { className: "px-3 py-3 text-xs text-slate-500", children: "\u8FD8\u6CA1\u6709\u7AEF\u70B9\u3002\u5728\u53F3\u8FB9\u586B\u4E00\u4E2A\uFF08\u5730\u5740\u5FC5\u987B https\uFF0C\u6216\u672C\u673A http://127.0.0.1\uFF09\u3002" })) : (_jsx("ul", { className: "divide-y divide-slate-100", children: (data?.endpoints ?? []).map((ep) => {
                                    const usedBy = Object.entries(data?.stageModels ?? {})
                                        .filter(([, v]) => v === ep.id)
                                        .map(([k]) => k);
                                    return (_jsxs("li", { className: "space-y-1 px-3 py-2", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2 text-xs", children: [_jsx("span", { className: "font-mono text-slate-900", children: ep.id }), _jsx("span", { className: "text-slate-600", children: ep.displayName }), _jsx("span", { className: "text-slate-400", children: ep.baseURL }), _jsx("span", { className: "rounded bg-slate-100 px-1 text-[11px] text-slate-600", children: ep.defaultModel }), _jsxs("span", { className: "text-[11px] text-slate-500", children: ["Key\uFF1A", data?.keysMasked[ep.id] ?? '（未设置）'] }), _jsxs("span", { className: "ml-auto flex gap-1", children: [_jsx(Button, { disabled: busy, onClick: () => void test(ep.id), children: "\u6D4B\u8BD5\u8FDE\u63A5" }), _jsx(Button, { disabled: busy, onClick: () => setDraft(ep), children: "\u7F16\u8F91" }), _jsx(Button, { tone: "danger", disabled: busy, onClick: () => void run(async () => {
                                                                    const r = await api.deleteEndpoint(ep.id);
                                                                    setWarnings(r.warnings);
                                                                }, `已删除 ${ep.id}（指向它的阶段已置空，Key 也一并删掉）`), children: "\u5220\u9664" })] })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 text-[11px] text-slate-500", children: [_jsxs("span", { children: ["\u88AB\u8FD9\u4E9B\u9636\u6BB5\u4F7F\u7528\uFF1A", usedBy.length ? usedBy.join(' / ') : '（无）'] }), _jsxs("span", { className: "ml-2 flex items-center gap-1", children: [_jsx("input", { type: "password", value: keyDraft[ep.id] ?? '', onChange: (e) => setKeyDraft({ ...keyDraft, [ep.id]: e.target.value }), placeholder: "\u7C98\u8D34 Key\uFF08\u53EA\u5199\u672C\u673A keys.json\uFF09", className: "w-56 rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[11px]" }), _jsx(Button, { disabled: busy || !(keyDraft[ep.id] ?? ''), onClick: () => void run(async () => {
                                                                    await api.setKey(ep.id, keyDraft[ep.id] ?? '');
                                                                    setKeyDraft({ ...keyDraft, [ep.id]: '' });
                                                                }, `已保存 ${ep.id} 的 Key（不会出现在导出包里）`), children: "\u4FDD\u5B58 Key" }), _jsx(Button, { disabled: busy, onClick: () => void run(async () => {
                                                                    await api.clearKey(ep.id);
                                                                }, `已清除 ${ep.id} 的 Key`), children: "\u6E05\u9664" })] })] }), testText[ep.id] ? (_jsx("pre", { className: "whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-700", children: testText[ep.id] })) : null] }, ep.id));
                                }) }))] }), _jsxs("div", { className: "rounded border border-slate-200 bg-white p-3", children: [_jsx("div", { className: "text-sm font-medium text-slate-900", children: "\u5206\u9636\u6BB5\u6307\u5B9A\u7AEF\u70B9" }), _jsx("p", { className: "text-[11px] text-slate-500", children: "\u53EA\u6709\u4E00\u4E2A\u7AEF\u70B9\u65F6\u53EF\u4EE5\u4E0D\u8BBE\uFF1A\u7A0B\u5E8F\u4F1A\u81EA\u52A8\u7528\u5B83\u3002\u591A\u4E2A\u7AEF\u70B9\u65F6\u5FC5\u987B\u6307\u5B9A\uFF0C\u7A0B\u5E8F\u4E0D\u731C\u3002" }), _jsx("div", { className: "mt-2 grid grid-cols-2 gap-2 md:grid-cols-3", children: (data?.stages ?? []).map((stage) => (_jsx(Field, { label: stage, children: _jsxs("select", { value: data?.stageModels[stage] ?? '', onChange: (e) => void run(async () => {
                                            await api.setStage(stage, e.target.value || null);
                                        }, `阶段 ${stage} 已更新`), disabled: busy, className: "w-full rounded border border-slate-300 px-1.5 py-1 text-[11px]", children: [_jsx("option", { value: "", children: "\uFF08\u672A\u6307\u5B9A\uFF09" }), (data?.endpoints ?? []).map((ep) => (_jsx("option", { value: ep.id, children: ep.id }, ep.id)))] }) }, stage))) })] }), _jsx(IssueList, { issues: issues, warnings: warnings }), note ? _jsx("p", { className: "whitespace-pre-wrap text-xs text-slate-600", children: note }) : null] }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "space-y-2 rounded border border-slate-200 bg-white p-3", children: [_jsx("div", { className: "text-sm font-medium text-slate-900", children: draft.id ? `编辑端点 ${draft.id}` : '新增端点' }), _jsx(Field, { label: "id\uFF08\u5B57\u6BCD\u6570\u5B57._-\uFF09", children: _jsx("input", { value: draft.id, onChange: (e) => setDraft({ ...draft, id: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs", placeholder: "ep_main" }) }), _jsx(Field, { label: "\u663E\u793A\u540D", children: _jsx("input", { value: draft.displayName, onChange: (e) => setDraft({ ...draft, displayName: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 text-xs", placeholder: "\u6211\u7684\u4E3B\u529B\u6A21\u578B" }) }), _jsx(Field, { label: "baseURL\uFF08https \u6216 http://127.0.0.1\uFF09", children: _jsx("input", { value: draft.baseURL, onChange: (e) => setDraft({ ...draft, baseURL: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" }) }), _jsx(Field, { label: "\u9ED8\u8BA4\u6A21\u578B", children: _jsx("input", { value: draft.defaultModel, onChange: (e) => setDraft({ ...draft, defaultModel: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs", placeholder: "deepseek-chat" }) }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx(Field, { label: "\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF0C\u22651000\uFF09", children: _jsx("input", { type: "number", value: draft.timeoutMs, onChange: (e) => setDraft({ ...draft, timeoutMs: Number(e.target.value) }), className: "w-full rounded border border-slate-300 px-2 py-1 text-xs" }) }), _jsxs("label", { className: "mt-4 flex items-center gap-1 text-[11px] text-slate-600", children: [_jsx("input", { type: "checkbox", checked: draft.supportsVision, onChange: (e) => setDraft({ ...draft, supportsVision: e.target.checked }) }), "\u652F\u6301\u56FE\u7247\u8F93\u5165"] })] }), _jsxs("div", { className: "flex gap-1 pt-1", children: [_jsx(Button, { tone: "primary", disabled: busy || !draft.id || !draft.defaultModel, onClick: upsert, children: "\u4FDD\u5B58\u7AEF\u70B9" }), _jsx(Button, { disabled: busy, onClick: () => setDraft(emptyEndpoint()), children: "\u6E05\u7A7A\u8868\u5355" })] })] }), _jsxs("div", { className: "space-y-2 rounded border border-slate-200 bg-white p-3", children: [_jsx("div", { className: "text-sm font-medium text-slate-900", children: "\u5BFC\u51FA / \u5BFC\u5165" }), _jsx("p", { className: "text-[11px] leading-snug text-slate-500", children: "\u5BFC\u51FA\u7684\u662F**\u4E0D\u542B Key** \u7684\u90A3\u4EFD\uFF08\u5BFC\u51FA\u51FD\u6570\u6839\u672C\u4E0D\u8BFB keys.json\uFF09\u3002\u5E26 Key \u7684\u6587\u4EF6\u5BFC\u5165\u4F1A\u88AB\u62D2\u3002" }), _jsx("div", { className: "flex gap-1", children: _jsx(Button, { disabled: busy, onClick: () => void run(async () => {
                                        const r = await api.exportEndpoints();
                                        setExportText(r.text);
                                    }, '已生成导出文本（可直接复制去另一台机器）'), children: "\u751F\u6210\u5BFC\u51FA\u6587\u672C" }) }), exportText ? (_jsx("textarea", { readOnly: true, value: exportText, className: "h-40 w-full rounded border border-slate-300 p-2 font-mono text-[11px]" })) : null, _jsx("textarea", { value: importText, onChange: (e) => setImportText(e.target.value), placeholder: "\u628A\u5BFC\u51FA\u6587\u672C\u7C98\u5230\u8FD9\u91CC\u518D\u70B9\u5BFC\u5165", className: "h-24 w-full rounded border border-slate-300 p-2 font-mono text-[11px]" }), _jsx(Button, { disabled: busy || !importText.trim(), onClick: () => void run(async () => {
                                    await api.importEndpoints(importText);
                                    setImportText('');
                                }, '已导入（已有 Key 不受影响；请对每个端点跑一次测试连接）'), children: "\u5BFC\u5165" })] })] })] }));
}
/* ────────────────────────────── 4. 世界书（第 6 期补齐） ────────────────────────────── */
function WorldbookPanel() {
    const [list, setList] = useState(null);
    const [sel, setSel] = useState('');
    const [text, setText] = useState('');
    const [problems, setProblems] = useState([]);
    const [issues, setIssues] = useState([]);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [newName, setNewName] = useState('my-entries.json');
    const [builtinId, setBuiltinId] = useState('');
    const refresh = useCallback(async (keep = '') => {
        try {
            const d = await api.worldbook();
            const packs = Array.isArray(d.packs) ? d.packs : [];
            setList({ ...d, packs, problems: Array.isArray(d.problems) ? d.problems : [], builtinIds: Array.isArray(d.builtinIds) ? d.builtinIds : [] });
            if (keep && packs.some((p) => p.name === keep))
                setSel(keep);
            else if (!packs.some((p) => p.name === sel) && packs.length)
                setSel(packs[0]?.name ?? '');
        }
        catch (e) {
            setIssues(toIssues(e).issues);
        }
    }, [sel]);
    const load = useCallback(async (name) => {
        if (!name)
            return;
        try {
            const p = await api.worldbookPack(name);
            setText(typeof p.text === 'string' ? p.text : '');
            setProblems(Array.isArray(p.problems) ? p.problems : []);
        }
        catch (e) {
            setIssues(toIssues(e).issues);
        }
    }, []);
    useEffect(() => {
        void refresh();
    }, [refresh]);
    useEffect(() => {
        void load(sel);
    }, [sel, load]);
    const run = async (fn, success) => {
        setBusy(true);
        setIssues([]);
        setNote('');
        try {
            await fn();
            await refresh(sel);
            await load(sel);
            setNote(success);
        }
        catch (e) {
            const r = toIssues(e);
            setIssues(r.issues);
            setNote(r.message);
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("div", { className: "grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]", children: [_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "rounded border border-slate-200 bg-white", children: [_jsxs("header", { className: "border-b border-slate-100 px-2 py-1.5", children: [_jsx("div", { className: "text-xs font-medium text-slate-800", children: "\u6211\u7684\u8BCD\u6761\u5305" }), _jsxs("div", { className: "text-[11px] leading-snug text-slate-500", children: ["\u4E00\u4E2A\u6587\u4EF6 = \u4E00\u4E2A\u5BFC\u51FA\u5305\u3002\u5185\u7F6E ", list?.builtinCount ?? '—', " \u6761**\u53EA\u8BFB**\uFF1B\u540C id \u7684\u7528\u6237\u8BCD\u6761\u4F1A\u8986\u76D6\u5185\u7F6E\u3002"] })] }), (list?.packs.length ?? 0) === 0 ? (_jsx("p", { className: "px-2 py-2 text-[11px] text-slate-500", children: "\u8FD8\u6CA1\u6709\u81EA\u5DF1\u7684\u8BCD\u6761\u5305\u3002\u7528\u53F3\u8FB9\"\u4ECE\u5185\u7F6E\u590D\u5236\u4E00\u6761\"\u5F00\u59CB\u6700\u7701\u4E8B\u3002" })) : (_jsx("ul", { className: "divide-y divide-slate-100", children: (list?.packs ?? []).map((p) => (_jsx("li", { children: _jsxs("button", { type: "button", onClick: () => setSel(p.name), className: `flex w-full items-center justify-between px-2 py-1.5 text-left text-xs ${sel === p.name ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`, children: [_jsx("span", { className: "truncate font-mono", children: p.name }), _jsxs("span", { className: sel === p.name ? 'ml-2 text-slate-300' : 'ml-2 text-slate-400', children: [p.count, " \u6761"] })] }) }, p.name))) }))] }), _jsxs("div", { className: "space-y-2 rounded border border-slate-200 bg-white p-2", children: [_jsx("div", { className: "text-xs font-medium text-slate-800", children: "\u4ECE\u5185\u7F6E\u590D\u5236\u4E00\u6761\uFF08\u751F\u6210\u8986\u76D6\u526F\u672C\uFF09" }), _jsxs("select", { value: builtinId, onChange: (e) => setBuiltinId(e.target.value), className: "w-full rounded border border-slate-300 px-1.5 py-1 text-[11px]", children: [_jsx("option", { value: "", children: "\uFF08\u9009\u4E00\u6761\u5185\u7F6E\u8BCD\u6761\uFF09" }), (list?.builtinIds ?? []).map((id) => (_jsx("option", { value: id, children: id }, id)))] }), _jsx(Button, { disabled: busy || !builtinId, onClick: () => void run(async () => {
                                    const r = await api.copyBuiltinWorldbook(builtinId);
                                    setSel(r.name);
                                }, '已生成覆盖副本：改它、保存，就覆盖了同 id 的内置那条'), children: "\u590D\u5236\u6210\u8986\u76D6\u526F\u672C" }), _jsx("div", { className: "pt-2 text-xs font-medium text-slate-800", children: "\u65B0\u5EFA\u7A7A\u5305" }), _jsx("input", { value: newName, onChange: (e) => setNewName(e.target.value), className: "w-full rounded border border-slate-300 px-1.5 py-1 font-mono text-[11px]", placeholder: "my-entries.json" }), _jsx(Button, { disabled: busy || !newName, onClick: () => void run(async () => {
                                    await api.createWorldbookPack(newName);
                                }, '已新建空包'), children: "\u65B0\u5EFA" })] })] }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2", children: [_jsxs("div", { children: [_jsx("div", { className: "text-sm font-medium text-slate-900", children: sel || '（未选中）' }), _jsx("div", { className: "text-[11px] text-slate-500", children: "\u4FDD\u5B58\u524D\u4F1A\u9010\u6761\u6309 \u00A79.1 \u6821\u9A8C\uFF1A**\u4EFB\u4F55\u4E00\u6761\u4E0D\u5408\u6CD5\u5C31\u6574\u6279\u4E0D\u5199**\uFF08\u4E0D\u4F1A\u5199\u8FDB\u53BB\u534A\u5957\uFF09\u3002" })] }), _jsxs("div", { className: "flex gap-1", children: [_jsx(Button, { tone: "primary", disabled: busy || !sel, onClick: () => void run(async () => {
                                            await api.saveWorldbookPack(sel, text);
                                        }, '已保存（原子写 + 整批校验通过）'), children: "\u4FDD\u5B58" }), _jsx(Button, { disabled: busy || !sel, onClick: () => void load(sel), children: "\u91CD\u65B0\u8F7D\u5165" }), _jsx(Button, { tone: "danger", disabled: busy || !sel, onClick: () => void run(async () => {
                                            await api.deleteWorldbookPack(sel);
                                            setSel('');
                                            setText('');
                                        }, '已删除（如果是覆盖副本，内置那条恢复生效）'), children: "\u5220\u9664" })] })] }), _jsx(IssueList, { issues: issues }), problems.length ? (_jsxs("div", { className: "rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900", children: [_jsx("p", { className: "font-medium", children: "\u8FD9\u4EFD\u6587\u4EF6\u672C\u8EAB\u6709\u95EE\u9898\uFF08\u8F7D\u5165\u65F6\u4F1A\u88AB\u6574\u6279\u62D2\u7EDD\uFF09\uFF1A" }), problems.map((p, i) => (_jsx("p", { className: "mt-1 font-mono", children: p }, i)))] })) : null, note ? _jsx("p", { className: "text-xs text-slate-600", children: note }) : null, _jsx("textarea", { value: text, onChange: (e) => setText(e.target.value), spellCheck: false, className: "h-[32rem] w-full resize-y rounded border border-slate-300 p-2 font-mono text-[12px] leading-relaxed text-slate-800", placeholder: '{ "format": "od-worldbook", "version": 1, "entries": [ \u2026 ] }' }), _jsxs("p", { className: "text-[11px] text-slate-500", children: ["\u4E00\u4E2A\u5305 = ", _jsx("code", { children: '{format:"od-worldbook", version:1, entries:[…]}' }), "\u3002\u8BCD\u6761\u5B57\u6BB5\u89C1", ' ', _jsx("code", { children: "contracts/worldbook-entry.schema.json" }), "\uFF1B\u4E24\u4E2A\u69FD\u4F4D\u7684\u6B63\u6587\u7528 ", _jsx("code", { children: "## \u89E3\u9898" }), " / ", _jsx("code", { children: "## \u52A8\u753B\u5EFA\u6A21" }), " \u5206\u5F00\u3002"] })] })] }));
}
/* ────────────────────────────── 5. 状态 ────────────────────────────── */
function StatusPanel() {
    const [status, setStatus] = useState(null);
    const [issues, setIssues] = useState([]);
    useEffect(() => {
        api
            .status()
            .then(setStatus)
            .catch((e) => setIssues(toIssues(e).issues));
    }, []);
    const problems = status?.problems ?? [];
    const files = status?.files ?? {};
    return (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "rounded border border-slate-200 bg-white p-3 text-xs text-slate-700", children: [_jsxs("p", { children: ["\u89C4\u5219\u76EE\u5F55\uFF1A", _jsx("code", { className: "rounded bg-slate-100 px-1", children: String(status?.dir ?? '') })] }), _jsxs("p", { className: "mt-1", children: ["revision\uFF1A", _jsx("span", { className: "font-mono", children: String(status?.revision ?? '—') }), _jsxs("span", { className: "ml-3", children: ["\u5DF2\u767B\u8BB0\u6587\u4EF6\uFF1A", Object.keys(files).length, " \u4E2A"] }), _jsxs("span", { className: "ml-3", children: ["\u53EF\u8F7D\u5165\uFF1A", status?.ok ? '✓ 是' : '✗ 否'] })] }), _jsx("p", { className: "mt-2 text-[11px] leading-relaxed text-slate-500", children: "\u7F3A\u6587\u4EF6 = \u7528\u5185\u7F6E\u9ED8\u8BA4\u3002\u53EA\u6709\u4F60\u4EB2\u624B\u6539\u8FC7\u7684\u90A3\u4E00\u6761\u624D\u4F1A\u51FA\u73B0\u5728\u4E0B\u9762\u7684\u6E05\u5355\u91CC\u3002" })] }), problems.length ? _jsx(IssueList, { issues: problems }) : _jsx("p", { className: "text-xs text-emerald-700", children: "\u2713 \u5DE5\u4F5C\u533A\u662F\u5E72\u51C0\u7684\uFF08\u6BCF\u4E2A\u6587\u4EF6\u90FD\u4E0E\u767B\u8BB0\u7C3F\u4E00\u81F4\uFF09" }), issues.length ? _jsx(IssueList, { issues: issues }) : null, Object.keys(files).length ? (_jsxs("table", { className: "w-full border-collapse text-left text-xs", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-200 text-slate-500", children: [_jsx("th", { className: "py-1", children: "\u6587\u4EF6" }), _jsx("th", { className: "py-1", children: "\u5B57\u8282" }), _jsx("th", { className: "py-1", children: "SHA256\uFF08\u524D 12\uFF09" })] }) }), _jsx("tbody", { children: Object.entries(files).map(([rel, f]) => (_jsxs("tr", { className: "border-b border-slate-100", children: [_jsx("td", { className: "py-1 font-mono", children: rel }), _jsx("td", { className: "py-1 font-mono text-slate-500", children: f.bytes }), _jsxs("td", { className: "py-1 font-mono text-slate-500", children: [f.sha256.slice(0, 12), "\u2026"] })] }, rel))) })] })) : null, _jsxs("div", { className: "rounded border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600", children: [_jsx("p", { className: "font-medium text-slate-700", children: "\u540C\u4E00\u4EF6\u4E8B\u4E5F\u80FD\u5728\u547D\u4EE4\u884C\u505A\uFF08\u754C\u9762\u7684\u80FD\u529B\u4E0E\u5B83\u4E00\u4E00\u5BF9\u5E94\uFF09" }), _jsx("pre", { className: "mt-1 whitespace-pre-wrap font-mono", children: `node core/rules/cli.mjs prompts
node core/rules/cli.mjs cleaning
node core/rules/cli.mjs endpoints
node core/rules/cli.mjs check` }), _jsxs("p", { className: "mt-2", children: ["\u6539\u574F\u4E86\u600E\u4E48\u529E\uFF1A\u754C\u9762\u4F1A\u62D2\u7EDD\u4FDD\u5B58\u5E76\u6307\u51FA\u4F4D\u7F6E\uFF1B\u5982\u679C\u4F60\u662F\u5728\u7F16\u8F91\u5668\u91CC\u624B\u6539\u574F\u7684\uFF0C\u8DD1\u4E00\u6B21 ", _jsx("code", { children: "node core/rules/cli.mjs check" }), "\u5C31\u80FD\u770B\u5230\"\u54EA\u4E2A\u6587\u4EF6\u3001\u54EA\u4E00\u884C\"\u3002"] })] })] }));
}
