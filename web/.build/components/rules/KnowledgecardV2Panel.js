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
    const [newCardOpen, setNewCardOpen] = useState(false);
    const [newKind, setNewKind] = useState('element');
    const [newTrigger, setNewTrigger] = useState('');
    const [vocabFormOpen, setVocabFormOpen] = useState(false);
    const [vocabKind, setVocabKind] = useState('element');
    const [vocabForm, setVocabForm] = useState({ id: '', name: '', aliases: '', primitive: 'Draw.box' });
    const [vocabBusy, setVocabBusy] = useState(false);
    const [ioBusy, setIoBusy] = useState(false);
    const [testElements, setTestElements] = useState(() => new Set());
    const [testScenes, setTestScenes] = useState(() => new Set());
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
    const createCard = () => {
        if (!lib)
            return;
        const firstElement = lib.vocab.elements.find((e) => e.enabled !== false)?.id ?? '';
        const firstScene = lib.vocab.scenes.find((s) => s.enabled !== false)?.id ?? '';
        const trigger = newTrigger || (newKind === 'element' ? firstElement : newKind === 'scene' ? firstScene : '');
        if (newKind === 'element' && !trigger) {
            setError('没有可用元件；先在右侧新增/启用一个元件词条。');
            return;
        }
        if (newKind === 'scene' && !trigger) {
            setError('没有可用场景；先在右侧新增/启用一个场景词条。');
            return;
        }
        const entry = {
            id: `local-${Date.now().toString(36)}`,
            title: '新建卡片',
            kind: newKind,
            origin: 'user',
            enabled: true,
            ...(newKind === 'anim_rule' ? { constant: true } : {}),
            ...(newKind === 'element' ? { elements: [trigger] } : {}),
            ...(newKind === 'scene' ? { scenes: [trigger] } : {}),
            order: 1000,
            priority: 'normal',
            content: '# 新建卡片\n\n## 判据\n（什么时候用这张卡）\n\n## 生成后自检（必须逐条在代码中体现）\n- [ ] ',
            code_examples: [],
        };
        setLib((prev) => (prev ? { ...prev, entries: [...prev.entries, entry], userCount: prev.userCount + 1 } : prev));
        setSelectedId(entry.id);
        setDraft(entry);
        setNewCardOpen(false);
        setNotice('新卡已建（未保存）；改完点“保存到本机”。');
    };
    const applyVocabEnabled = async (keys, enabled) => {
        if (!lib || keys.length === 0)
            return;
        setVocabBusy(true);
        setError(null);
        try {
            const de = new Set(lib.vocab.elements.filter((e) => e.enabled === false).map((e) => e.id));
            const ds = new Set(lib.vocab.scenes.filter((s) => s.enabled === false).map((s) => s.id));
            for (const key of keys) {
                const [kind, id = ''] = key.split(':');
                if (!id)
                    continue;
                if (kind === 'e') {
                    if (enabled)
                        de.delete(id);
                    else
                        de.add(id);
                }
                else if (kind === 's') {
                    if (enabled)
                        ds.delete(id);
                    else
                        ds.add(id);
                }
            }
            await api.saveKnowledgecardV2VocabState([...de], [...ds]);
            await load();
            setNotice(enabled ? `已启用 ${keys.length} 个词条` : `已关闭 ${keys.length} 个词条（不会从词表删除）`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setVocabBusy(false);
        }
    };
    const addVocab = async () => {
        if (!vocabForm.id.trim() || !vocabForm.name.trim()) {
            setError('词表项 id / 名字不能为空。');
            return;
        }
        setVocabBusy(true);
        setError(null);
        try {
            await api.addKnowledgecardV2VocabEntry(vocabKind, {
                id: vocabForm.id.trim(),
                name: vocabForm.name.trim(),
                aliases: vocabForm.aliases.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
                ...(vocabKind === 'element' ? { primitive: vocabForm.primitive.trim() } : {}),
            });
            setVocabForm({ id: '', name: '', aliases: '', primitive: 'Draw.box' });
            setVocabFormOpen(false);
            await load();
            setNotice(`已新增${vocabKind === 'element' ? '元件' : '场景'}词条`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setVocabBusy(false);
        }
    };
    const deleteCard = async () => {
        if (!draft)
            return;
        if (draft.origin === 'builtin') {
            setError('内置卡不能删除；只能停用，或编辑后保存成覆盖副本。');
            return;
        }
        if (!window.confirm(`删除用户卡「${draft.title}」？\n会先备份，再删 ${draft.id}.json。`))
            return;
        setIoBusy(true);
        setError(null);
        try {
            await api.deleteKnowledgecardV2Entry(draft.id);
            setSelectedId(null);
            setDraft(null);
            await load();
            setNotice(`已删除 ${draft.id}（删前已备份）`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setIoBusy(false);
        }
    };
    const exportBundle = async () => {
        setIoBusy(true);
        setError(null);
        try {
            const r = await api.exportKnowledgecardV2();
            const blob = new Blob([r.text], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = r.name;
            a.click();
            URL.revokeObjectURL(url);
            setNotice(`已导出 ${r.entries} 张用户卡 + 用户词表（${r.elements} 元件 / ${r.scenes} 场景）`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setIoBusy(false);
        }
    };
    const importBundle = async (file) => {
        if (!window.confirm(`导入「${file.name}」？\n会先把包里的用户词表合并进来，再写卡；任何一张不合法就整包拒绝。`))
            return;
        setIoBusy(true);
        setError(null);
        try {
            const text = await file.text();
            const r = await api.importKnowledgecardV2(text);
            await load();
            setNotice(`已导入 ${r.entries} 张卡；新增词表 ${r.vocabAdded.elements} 元件 / ${r.vocabAdded.scenes} 场景`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setIoBusy(false);
        }
    };
    const restoreBuiltin = async () => {
        if (!window.confirm('恢复内置：会删除所有“内置卡的覆盖副本”，不删你自己新建的卡。继续？'))
            return;
        setIoBusy(true);
        setError(null);
        try {
            const r = await api.restoreKnowledgecardV2Builtin();
            await load();
            setNotice(`已恢复内置：撤销覆盖 ${r.removed} 条`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setIoBusy(false);
        }
    };
    const removeVocab = async (kind, id) => {
        if (!window.confirm(`删除用户词表项「${id}」？\n内置项不能删；删除后引用它的卡会变成“触发已关闭”。`))
            return;
        setVocabBusy(true);
        setError(null);
        try {
            await api.removeKnowledgecardV2VocabEntry(kind, id);
            await load();
            setNotice(`已删除用户词表项 ${id}`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setVocabBusy(false);
        }
    };
    const disabledKeys = useMemo(() => {
        const s = new Set();
        for (const e of lib?.vocab.elements ?? [])
            if (e.enabled === false)
                s.add(`e:${e.id}`);
        for (const x of lib?.vocab.scenes ?? [])
            if (x.enabled === false)
                s.add(`s:${x.id}`);
        return s;
    }, [lib]);
    const isTriggerDisabled = (entry) => {
        if (!entry)
            return false;
        return [...(entry.elements ?? []).map((id) => `e:${id}`), ...(entry.scenes ?? []).map((id) => `s:${id}`)].some((k) => disabledKeys.has(k));
    };
    const previewHits = useMemo(() => {
        const rank = { anim_rule: 0, element: 1, scene: 2 };
        const entries = (lib?.entries ?? []).map((e) => (e.id === draft?.id ? draft : e)).filter((e) => e.enabled !== false);
        const list = entries
            .map((e) => {
            let via = null;
            if (e.constant)
                via = '常驻';
            else if (e.kind === 'element' && (e.elements ?? []).some((id) => testElements.has(id)))
                via = '元件命中';
            else if (e.kind === 'scene' && (e.scenes ?? []).some((id) => testScenes.has(id)))
                via = '场景命中';
            if (!via)
                return null;
            const chars = (e.content ?? '').length + (e.code_examples ?? []).join('').length;
            return { entry: e, via, chars };
        })
            .filter(Boolean);
        list.sort((a, b) => rank[a.entry.kind] - rank[b.entry.kind] || (a.entry.order ?? 100) - (b.entry.order ?? 100));
        return { list, chars: list.reduce((n, x) => n + x.chars, 0) };
    }, [lib, draft, testElements, testScenes]);
    if (loading)
        return _jsx("p", { className: "rounded border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500", children: "\u6B63\u5728\u8BFB\u53D6\u77E5\u8BC6\u5361\u5E93\u2026" });
    if (error && !lib) {
        return (_jsxs("div", { className: "rounded border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900", children: [_jsx("p", { className: "font-medium", children: "\u8FDE\u4E0D\u4E0A\u672C\u673A\u77E5\u8BC6\u5361\u670D\u52A1" }), _jsx("p", { className: "mt-1 text-xs", children: error }), _jsxs("p", { className: "mt-2 text-xs", children: ["\u5F00\u53D1\u671F\u8BF7\u7528 ", _jsx("code", { className: "rounded bg-white px-1", children: "3-OpenRules.bat" }), " \u8D77\u670D\u52A1\uFF1B\u53D1\u5E03\u7248\u8BF7\u4ECE\u684C\u9762\u5FEB\u6377\u65B9\u5F0F\u542F\u52A8\u3002"] }), _jsx("button", { type: "button", className: "mt-3 rounded border border-rose-300 px-3 py-1 text-xs", onClick: () => void load(), children: "\u91CD\u8BD5" })] }));
    }
    return (_jsxs("div", { className: "space-y-3", "data-od-region": "knowledgecard-v2", children: [_jsxs("section", { className: "flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-4 py-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold text-slate-900", children: "\u77E5\u8BC6\u5361" }), _jsxs("p", { className: "mt-0.5 text-[11px] text-slate-500", children: ["\u89E6\u53D1\u53EA\u6765\u81EA\u8BCD\u8868\uFF1A\u5143\u4EF6\u5361\u6309 ", _jsx("code", { children: "elements" }), "\uFF0C\u573A\u666F\u5361\u6309 ", _jsx("code", { children: "scenes" }), "\uFF0C\u52A8\u753B\u89C4\u8303\u5361\u5E38\u9A7B\u3002"] })] }), _jsxs("div", { className: "text-right text-[11px] text-slate-500", children: [_jsxs("div", { children: ["\u5185\u7F6E ", lib?.builtinCount ?? 0, " \u00B7 \u7528\u6237 ", lib?.userCount ?? 0, " \u00B7 \u5143\u4EF6 ", lib?.vocab.elements.length ?? 0, " \u00B7 \u573A\u666F", ' ', lib?.vocab.scenes.length ?? 0] }), _jsxs("div", { className: "mt-1 flex flex-wrap justify-end gap-2", children: [_jsx("button", { type: "button", className: "rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700", onClick: () => setNewCardOpen((v) => !v), children: "\u65B0\u5EFA\u5361" }), _jsx("button", { type: "button", className: "rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 disabled:opacity-40", disabled: ioBusy, onClick: () => void exportBundle(), children: "\u5BFC\u51FA\u77E5\u8BC6\u5361\u5305" }), _jsxs("label", { className: `cursor-pointer rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 ${ioBusy ? 'opacity-40' : ''}`, children: ["\u5BFC\u5165\u77E5\u8BC6\u5361\u5305", _jsx("input", { type: "file", accept: ".json,application/json", className: "hidden", disabled: ioBusy, onChange: (e) => {
                                                    const f = e.target.files?.[0];
                                                    e.currentTarget.value = '';
                                                    if (f)
                                                        void importBundle(f);
                                                } })] }), _jsx("button", { type: "button", "data-od-action": "knowledgecard-restore-builtin", className: "rounded border border-rose-300 px-2 py-0.5 text-[11px] text-rose-700 disabled:opacity-40", disabled: ioBusy, onClick: () => void restoreBuiltin(), children: "\u6062\u590D\u672C\u7248\u5185\u7F6E" }), _jsx("button", { type: "button", className: "underline", onClick: () => void load(), children: "\u91CD\u65B0\u8BFB\u53D6" })] })] })] }), newCardOpen && (_jsx("section", { className: "rounded border border-slate-200 bg-white px-4 py-3", children: _jsxs("div", { className: "flex flex-wrap items-end gap-3", children: [_jsxs("label", { className: "text-[11px] text-slate-600", children: ["\u7C7B\u578B", _jsxs("select", { className: "ml-1 rounded border border-slate-300 px-2 py-1 text-[11px]", value: newKind, onChange: (e) => {
                                        const k = e.target.value;
                                        setNewKind(k);
                                        setNewTrigger(k === 'element' ? lib?.vocab.elements.find((x) => x.enabled !== false)?.id ?? '' : k === 'scene' ? lib?.vocab.scenes.find((x) => x.enabled !== false)?.id ?? '' : '');
                                    }, children: [_jsx("option", { value: "element", children: "\u5143\u4EF6\u5361" }), _jsx("option", { value: "scene", children: "\u573A\u666F\u5361" }), _jsx("option", { value: "anim_rule", children: "\u52A8\u753B\u89C4\u8303\u5361" })] })] }), newKind !== 'anim_rule' && (_jsxs("label", { className: "text-[11px] text-slate-600", children: ["\u89E6\u53D1", _jsxs("select", { className: "ml-1 rounded border border-slate-300 px-2 py-1 text-[11px]", value: newTrigger, onChange: (e) => setNewTrigger(e.target.value), children: [_jsx("option", { value: "", children: "\uFF08\u5148\u9009\uFF09" }), (newKind === 'element' ? (lib?.vocab.elements ?? []) : (lib?.vocab.scenes ?? []))
                                            .filter((x) => x.enabled !== false)
                                            .map((x) => (_jsxs("option", { value: x.id, children: [x.id, "\uFF5C", x.name] }, x.id)))] })] })), _jsx("button", { type: "button", className: "rounded bg-slate-900 px-3 py-1 text-[11px] text-white", onClick: createCard, children: "\u5EFA\u4E00\u5F20" }), _jsx("span", { className: "text-[10px] text-slate-500", children: "\u5EFA\u5B8C\u5728\u4E2D\u95F4\u6539\u5185\u5BB9\uFF0C\u518D\u70B9\u201C\u4FDD\u5B58\u5230\u672C\u673A\u201D\u3002" })] }) })), error && _jsx("div", { className: "rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800", children: error }), notice && _jsx("div", { className: "rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800", children: notice }), lib?.problems?.length ? (_jsxs("div", { className: "rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900", children: [_jsxs("div", { className: "font-medium", children: ["\u5E93\u91CC\u6709 ", lib.problems.length, " \u6761\u95EE\u9898\uFF08\u4E0D\u963B\u65AD\u663E\u793A\uFF09\uFF1A"] }), _jsx("ul", { className: "mt-1 list-disc pl-5", children: lib.problems.slice(0, 5).map((p) => (_jsx("li", { children: p }, p))) })] })) : null, lib?.migration?.length ? (_jsxs("div", { className: "rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700", children: ["\u65E7\u5361\u8FC1\u79FB\uFF1A", lib.migration.filter((m) => m.action === 'convert').length, " \u5F20\u5DF2\u8F6C\u6362\uFF0C", lib.migration.filter((m) => m.action === 'disable').length, " \u5F20\u505C\u7528\uFF08\u53EA\u6709 keys/\u8003\u70B9\u3001\u65E0 elements\uFF09\u3002"] })) : null, _jsxs("div", { className: "grid grid-cols-1 gap-3 lg:grid-cols-12", children: [_jsxs("section", { className: "lg:col-span-3 rounded border border-slate-200 bg-white", children: [_jsxs("div", { className: "border-b border-slate-100 p-3", children: [_jsx("input", { className: "input w-full text-xs", placeholder: "\u641C\u7D22 id / \u6807\u9898 / \u6B63\u6587", value: search, onChange: (e) => setSearch(e.target.value) }), _jsx("div", { className: "mt-2 flex flex-wrap gap-1", children: ['all', 'anim_rule', 'element', 'scene'].map((k) => (_jsx("button", { type: "button", className: `rounded border px-2 py-0.5 text-[10px] ${kindFilter === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'}`, onClick: () => setKindFilter(k), children: k === 'all' ? '全部' : KIND_LABEL[k] }, k))) })] }), _jsxs("div", { className: "max-h-[620px] overflow-y-auto", children: [grouped.length === 0 && _jsx("p", { className: "px-3 py-4 text-xs text-slate-500", children: "\u6CA1\u6709\u5339\u914D\u7684\u5361\u3002" }), grouped.map((g) => (_jsxs("div", { children: [_jsxs("div", { className: "bg-slate-50 px-3 py-1 text-[10px] font-medium text-slate-500", children: [KIND_LABEL[g.kind], "\uFF08", g.list.length, "\uFF09"] }), _jsx("ul", { children: g.list.map((e) => (_jsx("li", { children: _jsxs("button", { type: "button", className: `w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50 ${e.id === selectedId ? 'bg-blue-50' : ''}`, onClick: () => select(e), children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsx("span", { className: `text-xs font-medium ${e.enabled ? 'text-slate-900' : 'text-slate-400 line-through'}`, children: e.title }), _jsx("span", { className: `shrink-0 rounded px-1 py-0.5 text-[9px] ${KIND_TONE[e.kind]}`, children: KIND_LABEL[e.kind] })] }), _jsxs("div", { className: "mt-0.5 flex flex-wrap items-center gap-1 text-[9px] text-slate-500", children: [_jsx("code", { children: e.id }), _jsx("span", { className: "rounded bg-slate-100 px-1", children: e.origin === 'builtin' ? '内置' : '用户' }), e.constant && _jsx("span", { className: "rounded bg-rose-100 px-1 text-rose-700", children: "\u5E38\u9A7B" }), !e.enabled && _jsx("span", { className: "rounded bg-slate-200 px-1", children: "\u505C\u7528" }), isTriggerDisabled(e) && _jsx("span", { className: "rounded bg-amber-100 px-1 text-amber-800", children: "\u89E6\u53D1\u5173\u95ED" })] })] }) }, e.id))) })] }, g.kind)))] })] }), _jsx("section", { className: "lg:col-span-6 rounded border border-slate-200 bg-white p-4", children: draft ? (_jsxs(_Fragment, { children: [_jsxs("header", { className: "mb-3 flex flex-wrap items-start justify-between gap-2", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: `rounded px-1.5 py-0.5 text-[10px] ${KIND_TONE[draft.kind]}`, children: KIND_LABEL[draft.kind] }), _jsx("code", { className: "text-[11px] text-slate-500", children: draft.id }), _jsx("span", { className: "rounded bg-slate-100 px-1 text-[10px] text-slate-600", children: draft.origin === 'builtin' ? '内置（保存=生成用户覆盖副本）' : '用户卡' })] }), _jsx("input", { className: "input mt-2 w-full text-sm font-medium", value: draft.title, onChange: (e) => setDraft({ ...draft, title: e.target.value }) })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("label", { className: "flex items-center gap-1 text-[11px] text-slate-600", children: [_jsx("input", { type: "checkbox", checked: draft.enabled, onChange: (e) => setDraft({ ...draft, enabled: e.target.checked }) }), "\u542F\u7528"] }), _jsx("button", { type: "button", className: "rounded border border-rose-300 px-2 py-1.5 text-xs text-rose-700 disabled:opacity-40", disabled: ioBusy || draft.origin === 'builtin', title: draft.origin === 'builtin' ? '内置卡不能删除；只能停用或保存成覆盖副本' : '删除用户卡', onClick: () => void deleteCard(), children: "\u5220\u9664" }), _jsx("button", { type: "button", "data-od-action": "knowledgecard-save", className: "rounded bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-40", disabled: !dirty || saving, onClick: () => void save(), children: saving ? '保存中…' : '保存到本机' })] })] }), isTriggerDisabled(draft) && (_jsx("div", { className: "mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900", children: "\u26A0 \u8FD9\u5F20\u5361\u7684\u89E6\u53D1\u8BCD\u6761\u5728\u201C\u8BCD\u8868\u5F00\u5173\u201D\u91CC\u88AB\u5173\u95ED\u4E86\uFF1A\u5B83\u73B0\u5728\u4E0D\u4F1A\u547D\u4E2D\u3002\u9700\u8981\u65F6\u5728\u53F3\u680F\u91CD\u65B0\u542F\u7528\uFF0C\u6216\u6539\u89E6\u53D1\u5BF9\u8C61\u3002" })), _jsxs("div", { className: "mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700", children: [draft.kind === 'anim_rule' && _jsx("p", { children: "\u5E38\u9A7B\u5361\uFF1A\u6BCF\u9053\u9898\u90FD\u4F1A\u6CE8\u5165\uFF0C\u4E0D\u9700\u8981\u89E6\u53D1\u6761\u4EF6\u3002" }), draft.kind === 'element' && (_jsxs("div", { children: [_jsx("p", { className: "font-medium", children: "\u89E6\u53D1\uFF1A\u6A21\u578B\u5224\u51FA\u4E0B\u5217\u4EFB\u4E00\u5143\u4EF6\u65F6\u6CE8\u5165" }), _jsx("select", { multiple: true, size: Math.min(6, Math.max(3, lib?.vocab.elements.length ?? 3)), className: "mt-1 w-full rounded border border-slate-300 bg-white text-[11px]", value: draft.elements ?? [], onChange: (e) => setDraft({ ...draft, elements: Array.from(e.target.selectedOptions).map((o) => o.value) }), children: (lib?.vocab.elements ?? []).map((e) => (_jsxs("option", { value: e.id, children: [e.id, "\uFF5C", e.name] }, e.id))) }), _jsx("p", { className: "mt-1 text-[10px] text-slate-500", children: "Ctrl / Cmd \u591A\u9009\uFF1B\u81F3\u5C11 1 \u4E2A\u3002" })] })), draft.kind === 'scene' && (_jsxs("div", { children: [_jsx("p", { className: "font-medium", children: "\u89E6\u53D1\uFF1A\u6A21\u578B\u5224\u51FA\u8FD9\u4E2A\u573A\u666F\u65F6\u6CE8\u5165" }), _jsxs("select", { className: "mt-1 w-full rounded border border-slate-300 bg-white text-[11px]", value: draft.scenes?.[0] ?? '', onChange: (e) => setDraft({ ...draft, scenes: e.target.value ? [e.target.value] : [] }), children: [_jsx("option", { value: "", children: "\uFF08\u672A\u9009\uFF09" }), (lib?.vocab.scenes ?? []).map((s) => (_jsxs("option", { value: s.id, children: [s.id, "\uFF5C", s.name] }, s.id)))] })] }))] }), _jsx("label", { className: "mb-1 block text-[11px] font-medium text-slate-700", children: "\u6B63\u6587\uFF08Markdown\uFF09" }), _jsx("textarea", { className: "input h-56 w-full font-mono text-[11px]", value: draft.content, onChange: (e) => setDraft({ ...draft, content: e.target.value }) }), _jsxs("label", { className: "mb-1 mt-3 block text-[11px] font-medium text-slate-700", children: ["\u793A\u4F8B\uFF08\u591A\u6BB5\u7528\u5355\u72EC\u4E00\u884C ", _jsx("code", { children: "---" }), " \u5206\u9694\uFF1B\u4F1A\u539F\u6837\u7ED9\u6A21\u578B\u770B\uFF09"] }), _jsx("textarea", { className: "input h-28 w-full font-mono text-[10px]", value: examplesToText(draft.code_examples), onChange: (e) => setDraft({ ...draft, code_examples: textToExamples(e.target.value) }) }), _jsxs("details", { className: "mt-3 rounded border border-slate-200 px-3 py-2", children: [_jsx("summary", { className: "cursor-pointer text-[11px] text-slate-600", children: "\u9AD8\u7EA7\uFF08order / priority\uFF09" }), _jsxs("div", { className: "mt-2 grid grid-cols-2 gap-2", children: [_jsxs("label", { className: "text-[10px] text-slate-500", children: ["order", _jsx("input", { type: "number", className: "input mt-0.5 w-full text-[11px]", value: draft.order ?? 100, onChange: (e) => setDraft({ ...draft, order: Number(e.target.value) }) })] }), _jsxs("label", { className: "text-[10px] text-slate-500", children: ["priority", _jsxs("select", { className: "input mt-0.5 w-full text-[11px]", value: draft.priority ?? 'normal', onChange: (e) => setDraft({ ...draft, priority: e.target.value }), children: [_jsx("option", { value: "normal", children: "normal" }), _jsx("option", { value: "high", children: "high" })] })] })] })] })] })) : (_jsx("p", { className: "text-sm text-slate-500", children: "\u5DE6\u4FA7\u9009\u4E00\u5F20\u5361\u3002" })) }), _jsxs("section", { className: "lg:col-span-3 rounded border border-slate-200 bg-white p-3", children: [_jsx("div", { className: "flex flex-wrap items-start justify-between gap-1", children: _jsxs("div", { children: [_jsx("h3", { className: "text-xs font-semibold text-slate-800", children: "\u5B9E\u65F6\u8BD5\u89E6\u53D1" }), _jsx("p", { className: "mt-0.5 text-[10px] leading-relaxed text-slate-500", children: "\u4E0D\u8C03\u6A21\u578B\u3001\u4E0D\u6539\u78C1\u76D8\uFF1A\u52FE\u9009\u5143\u4EF6/\u573A\u666F\uFF0C\u770B\u5F53\u524D\u5E93\uFF08\u542B\u6B63\u5728\u7F16\u8F91\u7684\u8FD9\u5F20\uFF09\u547D\u4E2D\u8C01\u3001\u6B63\u6587\u591A\u5C11\u5B57\u3002" })] }) }), draft && (_jsxs("div", { className: `mt-2 rounded px-2 py-1 text-[10px] ${previewHits.list.some((x) => x.entry.id === draft.id) ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`, children: ["\u5F53\u524D\u7F16\u8F91\u5361\uFF1A", previewHits.list.some((x) => x.entry.id === draft.id) ? '会命中' : '不会命中'] })), _jsxs("div", { className: "mt-2 grid grid-cols-1 gap-2", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[10px] font-medium text-slate-600", children: "\u2460 \u52A8\u753B\u5143\u4EF6\uFF08\u53EF\u591A\u9009\uFF09" }), _jsx("button", { type: "button", className: "text-[10px] text-slate-500 underline", onClick: () => setTestElements(new Set()), children: "\u6E05\u7A7A" })] }), _jsx("div", { className: "mt-1 grid max-h-36 grid-cols-1 gap-x-2 overflow-y-auto rounded border border-slate-100 p-1", children: (lib?.vocab.elements ?? []).filter((e) => e.enabled !== false).map((e) => (_jsxs("label", { className: "flex items-center gap-1 py-0.5 text-[10px] text-slate-700", children: [_jsx("input", { type: "checkbox", checked: testElements.has(e.id), onChange: (ev) => setTestElements((prev) => {
                                                                const next = new Set(prev);
                                                                if (ev.target.checked)
                                                                    next.add(e.id);
                                                                else
                                                                    next.delete(e.id);
                                                                return next;
                                                            }) }), _jsx("code", { children: e.id })] }, e.id))) })] }), _jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[10px] font-medium text-slate-600", children: "\u2461 \u573A\u666F\uFF08\u6700\u591A 1 \u4E2A\uFF09" }), _jsx("button", { type: "button", className: "text-[10px] text-slate-500 underline", onClick: () => setTestScenes(new Set()), children: "\u6E05\u7A7A" })] }), _jsx("div", { className: "mt-1 max-h-36 overflow-y-auto rounded border border-slate-100 p-1", children: (lib?.vocab.scenes ?? []).filter((s) => s.enabled !== false).map((s) => (_jsxs("label", { className: "flex items-center gap-1 py-0.5 text-[10px] text-slate-700", children: [_jsx("input", { type: "checkbox", checked: testScenes.has(s.id), onChange: (ev) => setTestScenes(ev.target.checked ? new Set([s.id]) : new Set()) }), _jsx("code", { children: s.id }), _jsx("span", { className: "text-slate-400", children: s.name })] }, s.id))) })] })] }), _jsxs("div", { className: "mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-600", children: [_jsxs("span", { children: ["\u547D\u4E2D ", _jsx("strong", { children: previewHits.list.length }), " \u5F20 \u00B7 \u6B63\u6587\u7EA6 ", _jsx("strong", { children: previewHits.chars }), " \u5B57"] }), isTriggerDisabled(draft) && _jsx("span", { className: "rounded bg-amber-100 px-1 text-amber-800", children: "\u5F53\u524D\u5361\u89E6\u53D1\u5DF2\u5173\u95ED" })] }), _jsxs("ul", { className: "mt-1 max-h-32 space-y-0.5 overflow-y-auto rounded border border-slate-100 p-2 text-[10px]", children: [previewHits.list.length === 0 && _jsx("li", { className: "text-slate-400", children: "\uFF08\u65E0\u547D\u4E2D\uFF1B\u81F3\u5C11\u4F1A\u547D\u4E2D 3 \u5F20\u5E38\u9A7B\u89C4\u8303\u5361\uFF09" }), previewHits.list.map((x) => (_jsxs("li", { className: "flex items-center gap-2", children: [_jsx("span", { className: "w-16 shrink-0 text-slate-400", children: x.via }), _jsx("span", { className: "truncate text-slate-700", children: x.entry.title }), _jsxs("span", { className: "ml-auto shrink-0 text-slate-400", children: [x.chars, " \u5B57"] })] }, x.entry.id)))] })] }), _jsxs("aside", { className: "lg:col-span-12 rounded border border-slate-200 bg-white p-3", children: [_jsx("h3", { className: "text-xs font-semibold text-slate-800", children: "\u8BCD\u8868\u4E0E\u5F00\u5173" }), _jsx("p", { className: "mt-0.5 text-[10px] text-slate-500", children: "\u5173\u95ED = \u53EA\u4ECE Prompt/\u89E6\u53D1\u91CC\u62FF\u6389\uFF0C\u4E0D\u5220\u8BCD\u6761\uFF1B\u6309\u5F53\u524D\u7AE0\u8282/\u6559\u5B66\u8FDB\u5EA6\u81EA\u7531\u5F00\u5173\u3002" }), _jsx("div", { className: "mt-2 flex flex-wrap gap-1 text-[10px] text-slate-500", children: "\u9010\u4E2A\u70B9\u53F3\u4FA7\u52FE\u9009\u6846\u5373\u53EF\u542F\u7528/\u5173\u95ED\uFF1B\u4E0D\u4F1A\u5220\u9664\u8BCD\u6761\u3002" }), _jsxs("div", { className: "mt-3 grid gap-3 md:grid-cols-2", children: [_jsxs("div", { children: [_jsxs("div", { className: "text-[10px] font-medium text-slate-600", children: ["\u52A8\u753B\u5143\u4EF6\uFF08", lib?.vocab.elements.length ?? 0, "\uFF09"] }), _jsx("div", { className: "mt-1 max-h-56 overflow-y-auto rounded border border-slate-100", children: (lib?.vocab.elements ?? []).map((e) => {
                                                    const key = `e:${e.id}`;
                                                    const enabled = e.enabled !== false;
                                                    return (_jsxs("div", { className: `border-b border-slate-50 px-2 py-1 text-[10px] ${enabled ? '' : 'bg-slate-50 opacity-60'}`, children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("input", { type: "checkbox", title: enabled ? '关闭（不删词条）' : '启用', checked: enabled, disabled: vocabBusy, onChange: (ev) => void applyVocabEnabled([key], ev.target.checked) }), _jsx("code", { className: "text-slate-800", children: e.id }), _jsxs("span", { className: "ml-auto text-slate-400", children: ["\u00D7", usedBy.get(key) ?? 0] }), e.origin === 'user' && (_jsx("button", { type: "button", className: "text-[9px] text-rose-600 underline", onClick: () => void removeVocab('element', e.id), children: "\u5220" }))] }), _jsx("div", { className: "ml-10 text-slate-500", children: e.name }), _jsx("div", { className: "ml-10 text-[9px] text-slate-400", children: e.primitive })] }, e.id));
                                                }) })] }), _jsxs("div", { className: "mt-3", children: [_jsxs("div", { className: "text-[10px] font-medium text-slate-600", children: ["\u573A\u666F\uFF08", lib?.vocab.scenes.length ?? 0, "\uFF09"] }), _jsx("div", { className: "mt-1 max-h-44 overflow-y-auto rounded border border-slate-100", children: (lib?.vocab.scenes ?? []).map((s) => {
                                                    const key = `s:${s.id}`;
                                                    const enabled = s.enabled !== false;
                                                    return (_jsxs("div", { className: `border-b border-slate-50 px-2 py-1 text-[10px] ${enabled ? '' : 'bg-slate-50 opacity-60'}`, children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("input", { type: "checkbox", title: enabled ? '关闭（不删词条）' : '启用', checked: enabled, disabled: vocabBusy, onChange: (ev) => void applyVocabEnabled([key], ev.target.checked) }), _jsx("code", { className: "text-slate-800", children: s.id }), _jsxs("span", { className: "ml-auto text-slate-400", children: ["\u00D7", usedBy.get(key) ?? 0] }), s.origin === 'user' && (_jsx("button", { type: "button", className: "text-[9px] text-rose-600 underline", onClick: () => void removeVocab('scene', s.id), children: "\u5220" }))] }), _jsx("div", { className: "ml-10 text-slate-500", children: s.name })] }, s.id));
                                                }) })] })] }), _jsxs("details", { className: "mt-3 rounded border border-slate-200 px-2 py-1.5", open: vocabFormOpen, onToggle: (e) => setVocabFormOpen(e.target.open), children: [_jsx("summary", { className: "cursor-pointer text-[10px] font-medium text-slate-700", children: "\u65B0\u589E\u8BCD\u8868\u9879" }), _jsxs("div", { className: "mt-2 space-y-1", children: [_jsxs("select", { className: "w-full rounded border border-slate-300 px-1 py-0.5 text-[10px]", value: vocabKind, onChange: (e) => setVocabKind(e.target.value), children: [_jsx("option", { value: "element", children: "\u5143\u4EF6" }), _jsx("option", { value: "scene", children: "\u573A\u666F" })] }), _jsx("input", { className: "w-full rounded border border-slate-300 px-1 py-0.5 text-[10px]", placeholder: "id\uFF08\u82F1\u6587/\u6570\u5B57/._-\uFF09", value: vocabForm.id, onChange: (e) => setVocabForm({ ...vocabForm, id: e.target.value }) }), _jsx("input", { className: "w-full rounded border border-slate-300 px-1 py-0.5 text-[10px]", placeholder: "\u4E2D\u6587\u540D", value: vocabForm.name, onChange: (e) => setVocabForm({ ...vocabForm, name: e.target.value }) }), _jsx("input", { className: "w-full rounded border border-slate-300 px-1 py-0.5 text-[10px]", placeholder: "\u522B\u540D\uFF08\u9017\u53F7\u5206\u9694\uFF0C\u53EF\u7A7A\uFF09", value: vocabForm.aliases, onChange: (e) => setVocabForm({ ...vocabForm, aliases: e.target.value }) }), vocabKind === 'element' && (_jsx("input", { className: "w-full rounded border border-slate-300 px-1 py-0.5 text-[10px]", placeholder: "\u753B\u6CD5\uFF0C\u5982 Draw.box", value: vocabForm.primitive, onChange: (e) => setVocabForm({ ...vocabForm, primitive: e.target.value }) })), _jsx("button", { type: "button", className: "w-full rounded bg-slate-900 px-2 py-1 text-[10px] text-white disabled:opacity-40", disabled: vocabBusy, onClick: () => void addVocab(), children: "\u65B0\u589E" }), _jsx("p", { className: "text-[9px] text-slate-500", children: "\u5185\u7F6E\u9879\u4E0D\u80FD\u5220\u9664\uFF0C\u53EA\u80FD\u5728\u4E0A\u9762\u7684\u5F00\u5173\u91CC\u5173\u95ED\uFF1B\u8FD9\u91CC\u53EA\u65B0\u589E\u3002" })] })] })] })] })] }));
}
