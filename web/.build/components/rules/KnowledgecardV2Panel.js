import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 知识卡 v2 面板（Phase 3C-1）。
 *
 * 只做“读整库 + 编辑已有卡 + 保存到本机”。
 * 新建卡 / 新增词表 / 导入导出 / 删除保护放在 3C-2。
 *
 * 为什么单独一个组件：旧 SettingsPage 的知识卡区是 v1 字段（keys/考点/题型/槽位），
 * 直接改它 1,450 行风险太大；先并行一个 v2 面板，旧面板保留但不再挂 tab。
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/rules-api';
const KIND_LABEL = {
    anim_rule: '动画规范',
    element: '元件卡',
    scene: '场景卡',
};
const KIND_TONE = {
    anim_rule: 'bg-rose-100 text-rose-700',
    element: 'bg-blue-100 text-blue-700',
    scene: 'bg-emerald-100 text-emerald-700',
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const examplesToText = (list) => (list ?? []).join('\n\n---\n\n');
const textToExamples = (text) => text
    .split(/\n\s*---\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
export function KnowledgecardV2Panel() {
    const [lib, setLib] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [draft, setDraft] = useState(null);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [kindFilter, setKindFilter] = useState('all');
    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.knowledgecardV2();
            setLib(data);
            const keep = selectedId && data.entries.some((e) => e.id === selectedId) ? selectedId : data.entries[0]?.id ?? null;
            setSelectedId(keep);
            const picked = data.entries.find((e) => e.id === keep) ?? null;
            setDraft(picked ? clone(picked) : null);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setLib(null);
            setDraft(null);
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const original = useMemo(() => lib?.entries.find((e) => e.id === selectedId) ?? null, [lib, selectedId]);
    const dirty = useMemo(() => Boolean(draft && original && JSON.stringify(draft) !== JSON.stringify(original)), [draft, original]);
    const grouped = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = (lib?.entries ?? []).filter((e) => {
            if (kindFilter !== 'all' && e.kind !== kindFilter)
                return false;
            if (!q)
                return true;
            return `${e.id} ${e.title} ${e.content}`.toLowerCase().includes(q);
        });
        const order = ['anim_rule', 'element', 'scene'];
        return order
            .map((kind) => ({ kind, list: list.filter((e) => e.kind === kind) }))
            .filter((g) => g.list.length > 0);
    }, [lib, search, kindFilter]);
    const usedBy = useMemo(() => {
        const m = new Map();
        for (const e of lib?.entries ?? []) {
            for (const id of e.elements ?? [])
                m.set(`e:${id}`, (m.get(`e:${id}`) ?? 0) + 1);
            for (const id of e.scenes ?? [])
                m.set(`s:${id}`, (m.get(`s:${id}`) ?? 0) + 1);
        }
        return m;
    }, [lib]);
    const select = (e) => {
        if (dirty && !window.confirm('当前卡有未保存改动，确定切换？'))
            return;
        setSelectedId(e.id);
        setDraft(clone(e));
        setNotice(null);
    };
    const save = async () => {
        if (!draft)
            return;
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            const r = await api.saveKnowledgecardV2Entry(draft);
            const saved = r.entry;
            setLib((prev) => {
                if (!prev)
                    return prev;
                const exists = prev.entries.some((e) => e.id === saved.id);
                return {
                    ...prev,
                    entries: exists ? prev.entries.map((e) => (e.id === saved.id ? saved : e)) : [...prev.entries, saved],
                    userCount: exists && prev.entries.find((e) => e.id === saved.id)?.origin === 'user' ? prev.userCount : prev.userCount + 1,
                };
            });
            setDraft(clone(saved));
            setNotice(`已保存到 ${r.name}（用户覆盖副本；内置卡原件不动）`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setSaving(false);
        }
    };
    if (loading)
        return _jsx("p", { className: "rounded border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500", children: "\u6B63\u5728\u8BFB\u53D6 v2 \u77E5\u8BC6\u5361\u5E93\u2026" });
    if (error && !lib) {
        return (_jsxs("div", { className: "rounded border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900", children: [_jsx("p", { className: "font-medium", children: "\u8FDE\u4E0D\u4E0A\u672C\u673A\u77E5\u8BC6\u5361\u670D\u52A1" }), _jsx("p", { className: "mt-1 text-xs", children: error }), _jsxs("p", { className: "mt-2 text-xs", children: ["\u5F00\u53D1\u671F\u8BF7\u7528 ", _jsx("code", { className: "rounded bg-white px-1", children: "3-OpenRules.bat" }), " \u8D77\u670D\u52A1\uFF1B\u53D1\u5E03\u7248\u8BF7\u4ECE\u684C\u9762\u5FEB\u6377\u65B9\u5F0F\u542F\u52A8\u3002"] }), _jsx("button", { type: "button", className: "mt-3 rounded border border-rose-300 px-3 py-1 text-xs", onClick: () => void load(), children: "\u91CD\u8BD5" })] }));
    }
    return (_jsxs("div", { className: "space-y-3", "data-od-region": "knowledgecard-v2", children: [_jsxs("section", { className: "flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-4 py-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold text-slate-900", children: "\u77E5\u8BC6\u5361 v2\uFF08\u8BCD\u8868\u9A71\u52A8\uFF09" }), _jsxs("p", { className: "mt-0.5 text-[11px] text-slate-500", children: ["\u89E6\u53D1\u53EA\u6765\u81EA\u8BCD\u8868\uFF1A\u5143\u4EF6\u5361\u6309 ", _jsx("code", { children: "elements" }), "\uFF0C\u573A\u666F\u5361\u6309 ", _jsx("code", { children: "scenes" }), "\uFF0C\u52A8\u753B\u89C4\u8303\u5361\u5E38\u9A7B\uFF1B\u4E0D\u518D\u6709 keys\u3002"] })] }), _jsxs("div", { className: "text-right text-[11px] text-slate-500", children: [_jsxs("div", { children: ["\u5185\u7F6E ", lib?.builtinCount ?? 0, " \u00B7 \u7528\u6237 ", lib?.userCount ?? 0, " \u00B7 \u5143\u4EF6 ", lib?.vocab.elements.length ?? 0, " \u00B7 \u573A\u666F", ' ', lib?.vocab.scenes.length ?? 0] }), _jsx("button", { type: "button", className: "mt-1 underline", onClick: () => void load(), children: "\u91CD\u65B0\u8BFB\u53D6" })] })] }), error && _jsx("div", { className: "rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800", children: error }), notice && _jsx("div", { className: "rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800", children: notice }), lib?.problems?.length ? (_jsxs("div", { className: "rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900", children: [_jsxs("div", { className: "font-medium", children: ["\u5E93\u91CC\u6709 ", lib.problems.length, " \u6761\u95EE\u9898\uFF08\u4E0D\u963B\u65AD\u663E\u793A\uFF09\uFF1A"] }), _jsx("ul", { className: "mt-1 list-disc pl-5", children: lib.problems.slice(0, 5).map((p) => (_jsx("li", { children: p }, p))) })] })) : null, lib?.migration?.length ? (_jsxs("div", { className: "rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700", children: ["\u65E7\u5361\u8FC1\u79FB\uFF1A", lib.migration.filter((m) => m.action === 'convert').length, " \u5F20\u5DF2\u8F6C\u6362\uFF0C", lib.migration.filter((m) => m.action === 'disable').length, " \u5F20\u505C\u7528\uFF08\u53EA\u6709 keys/\u8003\u70B9\u3001\u65E0 elements\uFF09\u3002"] })) : null, _jsxs("div", { className: "grid grid-cols-1 gap-3 lg:grid-cols-12", children: [_jsxs("section", { className: "lg:col-span-3 rounded border border-slate-200 bg-white", children: [_jsxs("div", { className: "border-b border-slate-100 p-3", children: [_jsx("input", { className: "input w-full text-xs", placeholder: "\u641C\u7D22 id / \u6807\u9898 / \u6B63\u6587", value: search, onChange: (e) => setSearch(e.target.value) }), _jsx("div", { className: "mt-2 flex flex-wrap gap-1", children: ['all', 'anim_rule', 'element', 'scene'].map((k) => (_jsx("button", { type: "button", className: `rounded border px-2 py-0.5 text-[10px] ${kindFilter === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'}`, onClick: () => setKindFilter(k), children: k === 'all' ? '全部' : KIND_LABEL[k] }, k))) })] }), _jsxs("div", { className: "max-h-[620px] overflow-y-auto", children: [grouped.length === 0 && _jsx("p", { className: "px-3 py-4 text-xs text-slate-500", children: "\u6CA1\u6709\u5339\u914D\u7684\u5361\u3002" }), grouped.map((g) => (_jsxs("div", { children: [_jsxs("div", { className: "bg-slate-50 px-3 py-1 text-[10px] font-medium text-slate-500", children: [KIND_LABEL[g.kind], "\uFF08", g.list.length, "\uFF09"] }), _jsx("ul", { children: g.list.map((e) => (_jsx("li", { children: _jsxs("button", { type: "button", className: `w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50 ${e.id === selectedId ? 'bg-blue-50' : ''}`, onClick: () => select(e), children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsx("span", { className: `text-xs font-medium ${e.enabled ? 'text-slate-900' : 'text-slate-400 line-through'}`, children: e.title }), _jsx("span", { className: `shrink-0 rounded px-1 py-0.5 text-[9px] ${KIND_TONE[e.kind]}`, children: KIND_LABEL[e.kind] })] }), _jsxs("div", { className: "mt-0.5 flex flex-wrap items-center gap-1 text-[9px] text-slate-500", children: [_jsx("code", { children: e.id }), _jsx("span", { className: "rounded bg-slate-100 px-1", children: e.origin === 'builtin' ? '内置' : '用户' }), e.constant && _jsx("span", { className: "rounded bg-rose-100 px-1 text-rose-700", children: "\u5E38\u9A7B" }), !e.enabled && _jsx("span", { className: "rounded bg-slate-200 px-1", children: "\u505C\u7528" })] })] }) }, e.id))) })] }, g.kind)))] })] }), _jsx("section", { className: "lg:col-span-6 rounded border border-slate-200 bg-white p-4", children: draft ? (_jsxs(_Fragment, { children: [_jsxs("header", { className: "mb-3 flex flex-wrap items-start justify-between gap-2", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: `rounded px-1.5 py-0.5 text-[10px] ${KIND_TONE[draft.kind]}`, children: KIND_LABEL[draft.kind] }), _jsx("code", { className: "text-[11px] text-slate-500", children: draft.id }), _jsx("span", { className: "rounded bg-slate-100 px-1 text-[10px] text-slate-600", children: draft.origin === 'builtin' ? '内置（保存=生成用户覆盖副本）' : '用户卡' })] }), _jsx("input", { className: "input mt-2 w-full text-sm font-medium", value: draft.title, onChange: (e) => setDraft({ ...draft, title: e.target.value }) })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("label", { className: "flex items-center gap-1 text-[11px] text-slate-600", children: [_jsx("input", { type: "checkbox", checked: draft.enabled, onChange: (e) => setDraft({ ...draft, enabled: e.target.checked }) }), "\u542F\u7528"] }), _jsx("button", { type: "button", className: "rounded bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-40", disabled: !dirty || saving, onClick: () => void save(), children: saving ? '保存中…' : '保存到本机' })] })] }), _jsxs("div", { className: "mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700", children: [draft.kind === 'anim_rule' && _jsx("p", { children: "\u5E38\u9A7B\u5361\uFF1A\u6BCF\u9053\u9898\u90FD\u4F1A\u6CE8\u5165\uFF0C\u4E0D\u9700\u8981\u89E6\u53D1\u6761\u4EF6\u3002" }), draft.kind === 'element' && (_jsxs("div", { children: [_jsx("p", { className: "font-medium", children: "\u89E6\u53D1\uFF1A\u6A21\u578B\u5224\u51FA\u4E0B\u5217\u4EFB\u4E00\u5143\u4EF6\u65F6\u6CE8\u5165" }), _jsx("select", { multiple: true, size: Math.min(6, Math.max(3, lib?.vocab.elements.length ?? 3)), className: "mt-1 w-full rounded border border-slate-300 bg-white text-[11px]", value: draft.elements ?? [], onChange: (e) => setDraft({ ...draft, elements: Array.from(e.target.selectedOptions).map((o) => o.value) }), children: (lib?.vocab.elements ?? []).map((e) => (_jsxs("option", { value: e.id, children: [e.id, "\uFF5C", e.name] }, e.id))) }), _jsx("p", { className: "mt-1 text-[10px] text-slate-500", children: "Ctrl / Cmd \u591A\u9009\uFF1B\u81F3\u5C11 1 \u4E2A\u3002" })] })), draft.kind === 'scene' && (_jsxs("div", { children: [_jsx("p", { className: "font-medium", children: "\u89E6\u53D1\uFF1A\u6A21\u578B\u5224\u51FA\u8FD9\u4E2A\u573A\u666F\u65F6\u6CE8\u5165" }), _jsxs("select", { className: "mt-1 w-full rounded border border-slate-300 bg-white text-[11px]", value: draft.scenes?.[0] ?? '', onChange: (e) => setDraft({ ...draft, scenes: e.target.value ? [e.target.value] : [] }), children: [_jsx("option", { value: "", children: "\uFF08\u672A\u9009\uFF09" }), (lib?.vocab.scenes ?? []).map((s) => (_jsxs("option", { value: s.id, children: [s.id, "\uFF5C", s.name] }, s.id)))] })] }))] }), _jsx("label", { className: "mb-1 block text-[11px] font-medium text-slate-700", children: "\u6B63\u6587\uFF08Markdown\uFF09" }), _jsx("textarea", { className: "input h-56 w-full font-mono text-[11px]", value: draft.content, onChange: (e) => setDraft({ ...draft, content: e.target.value }) }), _jsxs("label", { className: "mb-1 mt-3 block text-[11px] font-medium text-slate-700", children: ["\u793A\u4F8B\uFF08\u591A\u6BB5\u7528\u5355\u72EC\u4E00\u884C ", _jsx("code", { children: "---" }), " \u5206\u9694\uFF1B\u4F1A\u539F\u6837\u7ED9\u6A21\u578B\u770B\uFF09"] }), _jsx("textarea", { className: "input h-28 w-full font-mono text-[10px]", value: examplesToText(draft.code_examples), onChange: (e) => setDraft({ ...draft, code_examples: textToExamples(e.target.value) }) }), _jsxs("details", { className: "mt-3 rounded border border-slate-200 px-3 py-2", children: [_jsx("summary", { className: "cursor-pointer text-[11px] text-slate-600", children: "\u9AD8\u7EA7\uFF08order / priority\uFF09" }), _jsxs("div", { className: "mt-2 grid grid-cols-2 gap-2", children: [_jsxs("label", { className: "text-[10px] text-slate-500", children: ["order", _jsx("input", { type: "number", className: "input mt-0.5 w-full text-[11px]", value: draft.order ?? 100, onChange: (e) => setDraft({ ...draft, order: Number(e.target.value) }) })] }), _jsxs("label", { className: "text-[10px] text-slate-500", children: ["priority", _jsxs("select", { className: "input mt-0.5 w-full text-[11px]", value: draft.priority ?? 'normal', onChange: (e) => setDraft({ ...draft, priority: e.target.value }), children: [_jsx("option", { value: "normal", children: "normal" }), _jsx("option", { value: "high", children: "high" })] })] })] })] })] })) : (_jsx("p", { className: "text-sm text-slate-500", children: "\u5DE6\u4FA7\u9009\u4E00\u5F20\u5361\u3002" })) }), _jsxs("aside", { className: "lg:col-span-3 rounded border border-slate-200 bg-white p-3", children: [_jsx("h3", { className: "text-xs font-semibold text-slate-800", children: "\u8BCD\u8868\uFF08\u53EA\u8BFB\uFF09" }), _jsx("p", { className: "mt-0.5 text-[10px] text-slate-500", children: "\u65B0\u589E/\u5220\u9664\u8BCD\u8868\u9879\u5728 3C-2\uFF1B\u8FD9\u91CC\u5148\u770B\u201C\u8C01\u5728\u7528\u201D\u3002" }), _jsxs("div", { className: "mt-3", children: [_jsxs("div", { className: "text-[10px] font-medium text-slate-600", children: ["\u52A8\u753B\u5143\u4EF6\uFF08", lib?.vocab.elements.length ?? 0, "\uFF09"] }), _jsx("div", { className: "mt-1 max-h-52 overflow-y-auto rounded border border-slate-100", children: (lib?.vocab.elements ?? []).map((e) => (_jsxs("div", { className: "border-b border-slate-50 px-2 py-1 text-[10px]", children: [_jsxs("div", { className: "flex items-center justify-between gap-1", children: [_jsx("code", { className: "text-slate-800", children: e.id }), _jsxs("span", { className: "text-slate-400", children: ["\u00D7", usedBy.get(`e:${e.id}`) ?? 0] })] }), _jsx("div", { className: "text-slate-500", children: e.name }), _jsx("div", { className: "text-[9px] text-slate-400", children: e.primitive })] }, e.id))) })] }), _jsxs("div", { className: "mt-3", children: [_jsxs("div", { className: "text-[10px] font-medium text-slate-600", children: ["\u573A\u666F\uFF08", lib?.vocab.scenes.length ?? 0, "\uFF09"] }), _jsx("div", { className: "mt-1 max-h-40 overflow-y-auto rounded border border-slate-100", children: (lib?.vocab.scenes ?? []).map((s) => (_jsxs("div", { className: "border-b border-slate-50 px-2 py-1 text-[10px]", children: [_jsxs("div", { className: "flex items-center justify-between gap-1", children: [_jsx("code", { className: "text-slate-800", children: s.id }), _jsxs("span", { className: "text-slate-400", children: ["\u00D7", usedBy.get(`s:${s.id}`) ?? 0] })] }), _jsx("div", { className: "text-slate-500", children: s.name })] }, s.id))) })] })] })] })] }));
}
