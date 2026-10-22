import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 本地规则卡编辑器（原 `RulesPage` 的 `CleaningPanel`，只搬家、不改行为）。
 *
 * 口径不变：
 *   · 锁定集是**数据**（`core/cleaner/policy.mjs`），不可禁用、不可改、不可删，永远先跑；
 *   · 非法正则 / 动 @slot 标记的用户规则保存不上；
 *   · 顺序只允许在用户规则之间调整。
 *
 * 顺手修正的旧文案：内置锁定是 **4 条**，不是 3 条
 * （`strip-code-fence` / `strip-function-wrapper` / `drop-console-log` / `trim-edges`）。
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/rules-api';
import { Button, Field, IssueList, toIssues } from './shared';
const EMPTY_RULE = { id: '', name: '', stage: 'scene_code', pattern: '', flags: 'g', replacement: '', enabled: true };
export function CleaningPanel() {
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
    }, '已加入（排在用户规则最后；它在内置 4 条之后执行）');
    const userRows = (table?.effective ?? []).filter((r) => r.source === 'user');
    const userIndex = (id) => userRows.findIndex((r) => r.id === id);
    return (_jsxs("div", { className: "grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]", children: [_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "rounded border border-slate-200 bg-white", children: [_jsxs("header", { className: "border-b border-slate-100 px-3 py-2", children: [_jsx("div", { className: "text-sm font-medium text-slate-900", children: "\u751F\u6548\u987A\u5E8F\uFF08\u4ECE\u4E0A\u5230\u4E0B\u6267\u884C\uFF09" }), _jsx("div", { className: "text-[11px] text-slate-500", children: "\u524D 4 \u6761\u662F**\u9501\u5B9A**\u7684\u5185\u7F6E\u89C4\u5219\uFF1A\u4E0D\u53EF\u7981\u7528\u3001\u4E0D\u53EF\u6539\u3001\u4E0D\u53EF\u5220\uFF0C\u6C38\u8FDC\u5148\u8DD1\u3002\u4F60\u7684\u89C4\u5219\u5728\u5B83\u4EEC\u4E4B\u540E\u3002" })] }), _jsx("ol", { className: "divide-y divide-slate-100", children: (table?.effective ?? []).map((row) => (_jsxs("li", { className: "px-3 py-2", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2 text-xs", children: [_jsx("span", { className: "w-6 shrink-0 text-right font-mono text-slate-400", children: row.order }), _jsx("span", { className: `shrink-0 rounded px-1.5 py-0.5 text-[11px] ${row.source === 'locked' ? 'bg-slate-900 text-white' : row.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`, children: row.source === 'locked' ? '锁定' : row.enabled ? '启用' : '停用' }), _jsx("span", { className: "font-mono text-slate-800", children: row.id }), _jsx("span", { className: "text-slate-500", children: row.name }), _jsxs("span", { className: "text-[11px] text-slate-400", children: ["stage=", row.stage] }), row.source === 'user' ? (_jsxs("span", { className: "ml-auto flex gap-1", children: [_jsx(Button, { onClick: () => void run(async () => {
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
                                }, '已恢复默认（删掉了你的规则表，只剩内置 4 条）'), children: "\u6062\u590D\u9ED8\u8BA4\uFF08\u5220\u6389\u6211\u7684\u5168\u90E8\u89C4\u5219\uFF09" }), _jsx(Button, { disabled: busy, onClick: () => void refresh(), children: "\u91CD\u65B0\u8F7D\u5165" })] })] }), _jsxs("div", { className: "space-y-2 rounded border border-slate-200 bg-white p-3", children: [_jsx("div", { className: "text-sm font-medium text-slate-900", children: "\u52A0\u4E00\u6761\u89C4\u5219" }), _jsxs("p", { className: "text-[11px] leading-snug text-slate-500", children: ["id / name / stage / pattern / flags / replacement\u3002\u6B63\u5219\u4F1A\u5148\u8BD5\u7F16\u8BD1\uFF1A**\u975E\u6CD5\u6B63\u5219\u4FDD\u5B58\u4E0D\u4E0A**\uFF1B\u52A8", _jsx("code", { className: "mx-1 rounded bg-slate-100 px-1", children: "@slot" }), "\u6807\u8BB0\u7684\u89C4\u5219\u4E5F\u4F1A\u88AB\u62D2\uFF08\u00A73.5 \u96F6\u731C\u6D4B\uFF09\u3002"] }), _jsx(Field, { label: "id\uFF08\u5B57\u6BCD\u6570\u5B57._-\uFF09", children: _jsx("input", { value: draft.id, onChange: (e) => setDraft({ ...draft, id: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs", placeholder: "pow-rewrite" }) }), _jsx(Field, { label: "\u540D\u79F0", children: _jsx("input", { value: draft.name, onChange: (e) => setDraft({ ...draft, name: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 text-xs", placeholder: "Math.pow \u6539\u5199\u6210\u4E58\u6CD5" }) }), _jsx(Field, { label: "\u9636\u6BB5", children: _jsx("select", { value: draft.stage, onChange: (e) => setDraft({ ...draft, stage: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 text-xs", children: ['read_problem', 'solve', 'breakdown', 'answers', 'scene_code', 'knowledgecard'].map((s) => (_jsx("option", { value: s, children: s }, s))) }) }), _jsx(Field, { label: "\u6B63\u5219 pattern", children: _jsx("input", { value: draft.pattern, onChange: (e) => setDraft({ ...draft, pattern: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs", placeholder: "Math\\\\.pow\\\\(([^,]+),\\\\s*2\\\\)" }) }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx(Field, { label: "flags", children: _jsx("input", { value: draft.flags, onChange: (e) => setDraft({ ...draft, flags: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs", placeholder: "g" }) }), _jsx(Field, { label: "\u66FF\u6362\u4E3A", children: _jsx("input", { value: draft.replacement, onChange: (e) => setDraft({ ...draft, replacement: e.target.value }), className: "w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs", placeholder: "($1)*($1)" }) })] }), _jsxs("div", { className: "flex items-center gap-2 pt-1", children: [_jsx(Button, { tone: "primary", disabled: busy || !draft.id || !draft.pattern, onClick: add, children: "\u52A0\u5165" }), _jsx("span", { className: "text-[11px] text-slate-400", children: "\u52A0\u5165\u540E\u9ED8\u8BA4\u542F\u7528\u3001\u6392\u5728\u6700\u540E" })] })] })] }));
}
