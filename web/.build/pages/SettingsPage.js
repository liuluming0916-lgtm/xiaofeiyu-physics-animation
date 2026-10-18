import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 设置页（§15 第三页）—— 第 5 期先落「**世界书管理器 + 实时试触发预览器**」（M7 / M20 / §9.5）。
 *
 * ── 本期这一页能做什么、不能做什么（**必须显式告知，不能含糊**）
 *
 * 能做：
 *   · 卡片列表（分类分栏 / 搜索 / 启用开关 / 常驻与递归标记 / 槽位标记与按槽位筛选）
 *   · 卡片编辑（§9.1 全字段 + 槽位多选 + 正文 + code_examples）
 *   · **实时试触发预览器**：边打字边给出四个区块（命中清单与命中方式 / 解题槽拼接 /
 *     动画槽拼接 / 空槽与截断提示）——**不调用模型、不保存**
 *   · 冲突提示（同名 id / 正则错误 / 递归环 / 未挂槽位 / 双槽无标题）
 *   · 导出 / 导入 JSON 文本
 *
 * 做不到（诚实声明）：
 *   · **写回 `ai-rules/worldbook/`**：浏览器读不到文件系统，需要一个本地服务（排在第 9 步）。
 *     页面里的编辑只存在内存中，"导出 JSON"能拿到文本。
 *   · 完整校验与旧名归一化（`scene_spec` → `scene_code`）在 Node 侧执行，
 *     由门禁 ㉒ 逐条取证；本页的导入只做**形状提示**。
 *
 * ── 为什么"实时试触发"是真的
 *
 * 它调用的是 `web/src/lib/worldbook-engine.js` —— `core/worldbook/engine.mjs` 的
 * **逐字节副本**（构建期判据钉住）。所以这里的拼接结果与真实请求**必然一致**（W10），
 * 而不是"两处写得一样"。
 */
import { useMemo, useState } from 'react';
import { WORLDBOOK_BUDGET, buildSlotPreview, detectConflicts, } from '../lib/worldbook-engine.js';
/**
 * ⚠ 第 5.7 期：解析器用的是**逐字节副本**（`core/worldbook/concepts.mjs` → 本文件）。
 *   前端绝不另写一份"差不多的解析" —— 那会让"粘贴解析结果"与"真实链路解析结果"
 *   悄悄不一致，而那种不一致看不出来（构建期判据钉住了两份副本的字节）。
 */
import { parseJudgement } from '../lib/worldbook-concepts.js';
import { WORLDBOOK_BUILTIN, WORLDBOOK_COVERAGE, WORLDBOOK_HASH, WORLDBOOK_PACK_FORMAT, WORLDBOOK_PACK_VERSION, WORLDBOOK_SOURCES, WORLDBOOK_USER, } from '../lib/worldbook-demo';
const CATEGORY_LABEL = {
    solution_skill: '解题规范',
    scene_modeling: '场景建模',
    both_slot: '双槽',
    user_lore: '用户知识',
};
const SLOT_LABEL = { solve: '解题', scene_code: '动画建模' };
const VIA_LABEL = {
    key: '主键命中',
    secondary: '次级键命中',
    constant: '常驻',
    recursive: '递归唤醒',
};
const LOGIC_LIST = ['AND_ANY', 'AND_ALL', 'OR', 'NOT'];
const LOGIC_LABEL = {
    AND_ANY: 'AND_ANY（次级键任一命中）',
    AND_ALL: 'AND_ALL（次级键全部命中）',
    OR: 'OR（主键或次级键任一命中）',
    NOT: 'NOT（主键命中且次级键全部不命中）',
};
const SLOT_FILTER_LABEL = {
    all: '全部',
    solve: '解题槽',
    scene_code: '动画槽',
    dual: '双槽',
    unmounted: '未挂槽位',
};
/** 一条词条的槽位标记（§9.5 的"槽位标记（解题/动画/双槽/未挂槽）"） */
function slotTagOf(entry) {
    const slots = entry.insertion_slot;
    if (slots.length === 0)
        return { text: '未挂槽位', tone: 'bg-slate-100 text-slate-500' };
    if (slots.length >= 2)
        return { text: '双槽', tone: 'bg-violet-100 text-violet-700' };
    const only = slots[0] ?? '';
    return only === 'scene_code'
        ? { text: '动画槽', tone: 'bg-emerald-100 text-emerald-700' }
        : { text: '解题槽', tone: 'bg-blue-100 text-blue-700' };
}
function matchesSlotFilter(entry, filter) {
    const slots = entry.insertion_slot;
    if (filter === 'all')
        return true;
    if (filter === 'unmounted')
        return slots.length === 0;
    if (filter === 'dual')
        return slots.length >= 2;
    return slots.length === 1 && slots[0] === filter;
}
export function SettingsPage() {
    /** 词条库（构建期快照 + 本页的内存编辑） */
    const [entries, setEntries] = useState(() => [
        ...WORLDBOOK_BUILTIN.map((e) => ({ ...e })),
        ...WORLDBOOK_USER.map((e) => ({ ...e })),
    ]);
    const [selectedId, setSelectedId] = useState(() => WORLDBOOK_BUILTIN[0]?.id ?? '');
    const [search, setSearch] = useState('');
    const [slotFilter, setSlotFilter] = useState('all');
    const [testText, setTestText] = useState('水平传送带以恒定速率 $u=2\\ \\mathrm{m/s}$ 向右运行。将质量 $m=1\\ \\mathrm{kg}$ 的物块无初速轻放在传送带左端，物块与传送带之间的动摩擦因数 $\\mu=0.2$，取 $g=10\\ \\mathrm{m/s^2}$。求共速所用时间与因摩擦产生的热量。');
    const [importText, setImportText] = useState('');
    const [notice, setNotice] = useState(null);
    /**
     * ── 第 5.7 期：判定（两侧分发的输入） ──
     *
     * 预览器必须能像真实链路那样带上判定，否则"预览器 = 真实请求"（W10）
     * 会在概念分发这条新路径上破掉（两边抽到的词条不是同一批）。
     * 三个字段都是**表内 id**；粘贴一段模型转写可以直接解析出来（用同一份解析器副本）。
     */
    const [jury, setJury] = useState({
        concepts: [],
        tags: [],
        elements: [],
    });
    const [judgePaste, setJudgePaste] = useState('');
    const [judgeNote, setJudgeNote] = useState(null);
    const selected = entries.find((e) => e.id === selectedId) ?? null;
    /**
     * 词表（供"只能从表里选"的多选与浏览面板用）。
     *
     * ⚠ 来源是**内置词条里出现过的值**（去重）—— 构建期快照里目前没有单独的词表产物。
     *   等 5.9 期写完新库（每条词条都有三栏）时，这里会自然变成全集；
     *   在那之前它只是"当前库里用到的值"，**面板会如实标注这一点**。
     */
    const vocab = useMemo(() => {
        const c = new Set();
        const t = new Set();
        const el = new Set();
        for (const e of entries) {
            for (const x of e.concepts ?? [])
                c.add(x);
            for (const x of e.tags ?? [])
                t.add(x);
            for (const x of e.elements ?? [])
                el.add(x);
        }
        return { concepts: [...c].sort(), tags: [...t].sort(), elements: [...el].sort() };
    }, [entries]);
    const patch = (id, next) => {
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...next } : e)));
    };
    const enabled = useMemo(() => entries.filter((e) => e.enabled), [entries]);
    /** 预览器：两个槽位各跑一次（与真实链路同一份引擎代码，**含判定**） */
    const preview = useMemo(() => ({
        solve: buildSlotPreview({ entries: enabled, slot: 'solve', text: testText, ...jury }),
        scene_code: buildSlotPreview({ entries: enabled, slot: 'scene_code', text: testText, ...jury }),
    }), [enabled, testText, jury]);
    const conflicts = useMemo(() => detectConflicts(entries), [entries]);
    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return entries.filter((e) => {
            if (!matchesSlotFilter(e, slotFilter))
                return false;
            if (!q)
                return true;
            return (e.id.toLowerCase().includes(q) ||
                e.title.toLowerCase().includes(q) ||
                e.keys.some((k) => k.toLowerCase().includes(q)) ||
                e.content.toLowerCase().includes(q));
        });
    }, [entries, search, slotFilter]);
    const grouped = useMemo(() => {
        const map = new Map();
        for (const e of visible) {
            const list = map.get(e.category) ?? [];
            list.push(e);
            map.set(e.category, list);
        }
        return [...map.entries()];
    }, [visible]);
    const exportText = useMemo(() => {
        // ⚠ 这里的导出**只是给用户拿到文本**：完整规范化与旧名归一化由 Node 侧执行
        //   （门禁 ㉒ 的 W11/W12 逐条取证）。格式常量从构建期快照来，并由 web-build 判据钉住。
        const userOnly = entries.filter((e) => e.origin === 'user');
        return JSON.stringify({ format: WORLDBOOK_PACK_FORMAT, version: WORLDBOOK_PACK_VERSION, entries: userOnly }, null, 2);
    }, [entries]);
    return (_jsxs("div", { "data-od-region": "settings-page", className: "space-y-4", children: [_jsxs("section", { "data-od-region": "worldbook-honesty", className: "rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900", children: ["\u8FD9\u4E00\u9875\u662F", _jsx("strong", { children: "\u9884\u89C8\u4E0E\u5206\u6790" }), "\u7528\u7684\uFF1A\u7F16\u8F91\u53EA\u5B58\u5728", _jsx("strong", { children: "\u672C\u9875\u5185\u5B58" }), "\u4E2D\uFF0C\u5237\u65B0\u5373\u4E22\u3002", _jsxs("strong", { children: ["\u8981\u771F\u6B63\u5199\u56DE ", _jsx("code", { children: "ai-rules/worldbook/" }), "\uFF0C\u8BF7\u53BB\u300C\u89C4\u5219\u300D\u9875\u7684\u300C\u4E16\u754C\u4E66\u300D\u9875\u7B7E"] }), "\uFF08\u7B2C 6 \u671F\u5DF2\u63A5\u4E0A\u672C\u673A\u670D\u52A1\uFF1B \u7528 ", _jsx("code", { className: "rounded bg-amber-100 px-1", children: "3-OpenRules.bat" }), " \u6253\u5F00\u624D\u53EF\u7528\uFF09\u3002 \u672C\u9875\u7684\u9884\u89C8\u5668", _jsx("strong", { children: "\u89E6\u53D1\u4E0E\u7EC4\u88C5\u662F\u771F\u7684" }), "\uFF08\u7528\u7684\u662F ", _jsx("code", { children: "core/worldbook/engine.mjs" }), " \u7684\u9010\u5B57\u8282\u526F\u672C\uFF09\u3002"] }), _jsxs("div", { className: "grid grid-cols-1 gap-4 xl:grid-cols-[minmax(240px,300px)_1fr_minmax(320px,420px)]", children: [_jsxs("section", { "data-od-region": "worldbook-list", className: "rounded-md border border-slate-200 bg-white", children: [_jsxs("header", { className: "border-b border-slate-200 px-3 py-2", children: [_jsx("h2", { className: "text-sm font-semibold text-slate-900", children: "\u4E16\u754C\u4E66\u8BCD\u6761" }), _jsxs("p", { className: "mt-0.5 text-[11px] text-slate-500", children: ["\u5171 ", entries.length, " \u6761 \u00B7 \u542F\u7528 ", enabled.length, " \u6761 \u00B7 \u5185\u7F6E ", WORLDBOOK_BUILTIN.length, " \u6761"] })] }), _jsxs("div", { className: "space-y-2 border-b border-slate-200 px-3 py-2", children: [_jsx("input", { "data-od-field": "worldbook-search", "aria-label": "\u641C\u7D22\u8BCD\u6761", className: "w-full rounded border border-slate-300 px-2 py-1 text-xs", placeholder: "\u641C\u7D22 id / \u6807\u9898 / \u5173\u952E\u8BCD / \u6B63\u6587", value: search, onChange: (e) => setSearch(e.target.value) }), _jsx("div", { className: "flex flex-wrap gap-1", role: "group", "aria-label": "\u6309\u69FD\u4F4D\u7B5B\u9009", children: Object.keys(SLOT_FILTER_LABEL).map((f) => (_jsx("button", { type: "button", "data-od-action": `worldbook-filter-${f}`, "aria-pressed": slotFilter === f, className: `rounded px-2 py-0.5 text-[11px] ${slotFilter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`, onClick: () => setSlotFilter(f), children: SLOT_FILTER_LABEL[f] }, f))) })] }), _jsxs("div", { className: "max-h-[560px] overflow-y-auto", children: [grouped.length === 0 && _jsx("p", { className: "px-3 py-4 text-xs text-slate-500", children: "\u6CA1\u6709\u5339\u914D\u7684\u8BCD\u6761\u3002" }), grouped.map(([category, list]) => (_jsxs("div", { children: [_jsxs("div", { className: "bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600", children: [CATEGORY_LABEL[category] ?? category, "\uFF08", list.length, "\uFF09"] }), _jsx("ul", { children: list.map((e) => {
                                                    const tag = slotTagOf(e);
                                                    return (_jsx("li", { children: _jsxs("button", { type: "button", "data-od-entry": e.id, "aria-current": e.id === selectedId ? 'true' : undefined, className: `w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50 ${e.id === selectedId ? 'bg-blue-50' : ''}`, onClick: () => setSelectedId(e.id), children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsx("span", { className: `text-xs font-medium ${e.enabled ? 'text-slate-900' : 'text-slate-400 line-through'}`, children: e.title }), _jsx("span", { className: `shrink-0 rounded px-1 py-0.5 text-[10px] ${tag.tone}`, children: tag.text })] }), _jsxs("div", { className: "mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-500", children: [_jsx("code", { children: e.id }), e.origin === 'builtin' ? (_jsx("span", { className: "rounded bg-slate-100 px-1", children: "\u5185\u7F6E" })) : (_jsx("span", { className: "rounded bg-amber-100 px-1 text-amber-700", children: "\u6211\u7684" })), e.constant && _jsx("span", { className: "rounded bg-rose-100 px-1 text-rose-700", children: "\u5E38\u9A7B" }), e.recursive && _jsx("span", { className: "rounded bg-teal-100 px-1 text-teal-700", children: "\u9012\u5F52" })] })] }) }, e.id));
                                                }) })] }, category)))] })] }), _jsxs("section", { "data-od-region": "worldbook-editor", className: "space-y-4", children: [selected ? (_jsxs("div", { className: "rounded-md border border-slate-200 bg-white p-4", children: [_jsxs("header", { className: "mb-3 flex items-center justify-between", children: [_jsx("h2", { className: "text-sm font-semibold text-slate-900", children: "\u7F16\u8F91\u8BCD\u6761" }), _jsxs("label", { className: "flex items-center gap-1 text-xs text-slate-600", children: [_jsx("input", { type: "checkbox", "data-od-field": "worldbook-enabled", checked: selected.enabled, onChange: (e) => patch(selected.id, { enabled: e.target.checked }) }), "\u542F\u7528"] })] }), _jsxs("div", { className: "grid grid-cols-1 gap-3 md:grid-cols-2", children: [_jsx(Field, { label: "id\uFF08\u5E93\u5185\u552F\u4E00\uFF1B\u5B57\u6BCD/\u6570\u5B57/\u70B9/\u4E0B\u5212\u7EBF/\u8FDE\u5B57\u7B26\uFF09", children: _jsx("input", { className: "input", "data-od-field": "worldbook-id", value: selected.id, onChange: (e) => {
                                                        const next = e.target.value;
                                                        setEntries((prev) => prev.map((x) => (x.id === selected.id ? { ...x, id: next } : x)));
                                                        setSelectedId(next);
                                                    } }) }), _jsx(Field, { label: "\u6807\u9898", children: _jsx("input", { className: "input", "data-od-field": "worldbook-title", value: selected.title, onChange: (e) => patch(selected.id, { title: e.target.value }) }) }), _jsx(Field, { label: "\u5206\u7C7B\uFF08\u4EC5\u5206\u7C7B\u5C55\u793A\u4E0E\u7EDF\u8BA1\uFF09", children: _jsx("select", { className: "input", "data-od-field": "worldbook-category", value: selected.category, onChange: (e) => patch(selected.id, { category: e.target.value }), children: Object.keys(CATEGORY_LABEL).map((c) => (_jsx("option", { value: c, children: CATEGORY_LABEL[c] }, c))) }) }), _jsx(Field, { label: "\u6765\u6E90\uFF08origin\uFF09\uFF1A\u5185\u7F6E\u53EA\u8BFB\uFF0C\u7F16\u8F91\u4F1A\u751F\u6210 user \u8986\u76D6\u526F\u672C", children: _jsx("input", { className: "input bg-slate-50", value: selected.origin, readOnly: true }) }), _jsx(Field, { label: "order\uFF08\u540C\u69FD\u4F4D\u5185\u6392\u5E8F\uFF0C\u5C0F\u5728\u524D\uFF09", children: _jsx("input", { type: "number", className: "input", "data-od-field": "worldbook-order", value: selected.order, onChange: (e) => patch(selected.id, { order: Number(e.target.value) }) }) }), _jsx(Field, { label: "priority\uFF08\u9884\u7B97\u4E0D\u8DB3\u65F6 high \u4F18\u5148\u4FDD\u7559\uFF09", children: _jsxs("select", { className: "input", "data-od-field": "worldbook-priority", value: selected.priority, onChange: (e) => patch(selected.id, { priority: e.target.value }), children: [_jsx("option", { value: "normal", children: "normal" }), _jsx("option", { value: "high", children: "high" })] }) })] }), _jsxs("div", { className: "mt-3 flex flex-wrap gap-4", children: [_jsxs("label", { className: "flex items-center gap-1 text-xs text-slate-700", children: [_jsx("input", { type: "checkbox", "data-od-field": "worldbook-constant", checked: selected.constant, onChange: (e) => patch(selected.id, { constant: e.target.checked }) }), "\u5E38\u9A7B\uFF08\u65E0\u6761\u4EF6\u6CE8\u5165\uFF09"] }), _jsxs("label", { className: "flex items-center gap-1 text-xs text-slate-700", children: [_jsx("input", { type: "checkbox", "data-od-field": "worldbook-recursive", checked: selected.recursive, onChange: (e) => patch(selected.id, { recursive: e.target.checked }) }), "\u9012\u5F52\uFF08\u53EF\u88AB\u7EA7\u8054\u5524\u9192 / \u53EF\u5524\u9192\u522B\u4EBA\uFF09"] })] }), _jsxs("div", { className: "mt-3", children: [_jsxs("p", { className: "label", children: ["insertion_slot\uFF08\u69FD\u4F4D\u540D = \u9636\u6BB5\u540D\uFF1B\u4E24\u4E2A\u90FD\u9009\u65F6\u6B63\u6587\u5FC5\u987B\u7528 ", _jsx("code", { children: "## \u89E3\u9898" }), " / ", _jsx("code", { children: "## \u52A8\u753B\u5EFA\u6A21" }), " \u5206\u5F00\uFF09"] }), _jsx("div", { className: "flex gap-4", children: ['solve', 'scene_code'].map((slot) => (_jsxs("label", { className: "flex items-center gap-1 text-xs text-slate-700", children: [_jsx("input", { type: "checkbox", "data-od-field": `worldbook-slot-${slot}`, checked: selected.insertion_slot.includes(slot), onChange: (e) => {
                                                                const next = e.target.checked
                                                                    ? [...selected.insertion_slot, slot]
                                                                    : selected.insertion_slot.filter((s) => s !== slot);
                                                                patch(selected.id, { insertion_slot: [...new Set(next)].sort() });
                                                            } }), SLOT_LABEL[slot], "\uFF08", _jsx("code", { children: slot }), "\uFF09"] }, slot))) })] }), _jsx("div", { className: "mt-3", children: _jsx(Field, { label: "keys\uFF08\u4E00\u884C\u4E00\u6761\uFF1B`/\u2026/flags` \u89C6\u4E3A\u6B63\u5219\uFF0C\u5176\u4F59\u4E3A\u5B57\u9762\u91CF\u5305\u542B\u3002\u5B57\u9762\u91CF\u4F1A\u505A\u5927\u5C0F\u5199\u4E0E\u5168\u534A\u89D2\u5F52\u4E00\u5316\uFF09", children: _jsx("textarea", { className: "input h-20 font-mono", "data-od-field": "worldbook-keys", value: selected.keys.join('\n'), onChange: (e) => patch(selected.id, { keys: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }) }) }) }), _jsxs("div", { className: "mt-3 border-t border-slate-200 pt-2", children: [_jsxs("p", { className: "text-[11px] text-slate-500", children: ["\u7B2C 5.7 \u671F\u4E09\u680F\uFF1A", _jsx("strong", { children: "\u53EA\u80FD\u4ECE\u8BCD\u8868\u91CC\u9009" }), "\uFF08\u70B9\u4E00\u4E0B\u52A0/\u53BB\uFF09\u3002\u5B83\u4EEC\u4E0E\u65E7\u7684 ", _jsx("code", { children: "keys" }), " \u662F", _jsx("strong", { children: " OR \u5173\u7CFB" }), "\uFF08\u7070\u5EA6\uFF09\uFF1A\u4E09\u680F\u90FD\u7A7A \u21D2 \u8BE5\u8BCD\u6761\u53EA\u8D70\u65E7\u7684\u6BD4\u5B57\u8DEF\u5F84\u3002"] }), [
                                                ['concepts', '考点（词表 A）'],
                                                ['tags', '题型 / 细考点（词表 B）'],
                                                ['elements', '动画元件（原名"器材"）'],
                                            ].map(([field, label]) => {
                                                const chosen = selected[field] ?? [];
                                                const options = vocab[field];
                                                return (_jsxs("div", { className: "mt-2", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[11px] font-medium text-slate-700", children: label }), _jsxs("span", { className: "text-[10px] text-slate-500", children: ["\u5DF2\u9009 ", chosen.length] })] }), options.length === 0 ? (_jsx("p", { className: "mt-0.5 text-[10px] text-slate-400", children: "\uFF08\u5F53\u524D\u5E93\u91CC\u8FD8\u6CA1\u6709\u8BCD\u6761\u7528\u8FC7\u8FD9\u4E00\u680F\uFF0C\u6240\u4EE5\u6CA1\u6709\u53EF\u9009\u9879 \u2014\u2014 \u7B49 5.9 \u671F\u5199\u5B8C\u65B0\u5E93\u81EA\u7136\u8865\u5168\uFF09" })) : (_jsx("div", { className: "mt-0.5 flex max-h-24 flex-wrap gap-1 overflow-auto rounded border border-slate-200 p-1", "data-od-field": `worldbook-${field}`, children: options.map((v) => {
                                                                const on = chosen.includes(v);
                                                                return (_jsx("button", { type: "button", className: 'rounded px-1 text-[10px] ' +
                                                                        (on ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'), onClick: () => patch(selected.id, {
                                                                        [field]: on ? chosen.filter((x) => x !== v) : [...chosen, v],
                                                                    }), children: v }, v));
                                                            }) }))] }, field));
                                            })] }), _jsxs("div", { className: "mt-3 grid grid-cols-1 gap-3 md:grid-cols-2", children: [_jsx(Field, { label: "\u6B21\u7EA7\u952E\u903B\u8F91", children: _jsx("select", { className: "input", "data-od-field": "worldbook-logic", value: selected.secondary_keys.logic, onChange: (e) => patch(selected.id, { secondary_keys: { ...selected.secondary_keys, logic: e.target.value } }), children: LOGIC_LIST.map((l) => (_jsx("option", { value: l, children: LOGIC_LABEL[l] }, l))) }) }), _jsx(Field, { label: "\u6B21\u7EA7\u952E\uFF08\u4E00\u884C\u4E00\u6761\uFF09", children: _jsx("textarea", { className: "input h-20 font-mono", "data-od-field": "worldbook-secondary", value: selected.secondary_keys.list.join('\n'), onChange: (e) => patch(selected.id, {
                                                        secondary_keys: {
                                                            ...selected.secondary_keys,
                                                            list: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                                                        },
                                                    }) }) })] }), _jsx("div", { className: "mt-3", children: _jsx(Field, { label: "\u6B63\u6587 content\uFF08Markdown\uFF09", children: _jsx("textarea", { className: "input h-56 font-mono text-[11px]", "data-od-field": "worldbook-content", value: selected.content, onChange: (e) => patch(selected.id, { content: e.target.value }) }) }) }), _jsx("div", { className: "mt-3", children: _jsx(Field, { label: "code_examples\uFF08\u6BCF\u6BB5\u4E4B\u95F4\u7528\u4E00\u884C --- \u5206\u9694\uFF09", children: _jsx("textarea", { className: "input h-32 font-mono text-[11px]", "data-od-field": "worldbook-examples", value: selected.code_examples.join('\n---\n'), onChange: (e) => patch(selected.id, {
                                                    code_examples: e.target.value.split(/\n---\n/).map((s) => s.trim()).filter(Boolean),
                                                }) }) }) })] })) : (_jsx("p", { className: "rounded-md border border-slate-200 bg-white p-4 text-xs text-slate-500", children: "\u5DE6\u4FA7\u9009\u4E00\u6761\u8BCD\u6761\u5F00\u59CB\u7F16\u8F91\u3002" })), _jsxs("div", { className: "rounded-md border border-slate-200 bg-white p-4", "data-od-region": "worldbook-io", children: [_jsx("h2", { className: "text-sm font-semibold text-slate-900", children: "\u5BFC\u5165 / \u5BFC\u51FA" }), _jsxs("p", { className: "mt-1 text-[11px] text-slate-500", children: ["\u5BFC\u51FA\u9ED8\u8BA4\u53EA\u542B ", _jsx("code", { children: "origin: user" }), " \u7684\u8BCD\u6761\uFF08\u00A79.3 \u2462\uFF09\u3002\u683C\u5F0F\uFF1A", _jsx("code", { children: WORLDBOOK_PACK_FORMAT }), " v", WORLDBOOK_PACK_VERSION, "\u3002", _jsx("strong", { children: "\u5B8C\u6574\u6821\u9A8C\u4E0E\u65E7\u540D\u5F52\u4E00\u5316\uFF08scene_spec \u2192 scene_code\uFF09\u5728 Node \u4FA7\u6267\u884C" }), "\uFF08\u95E8\u7981 \u3252 \u7684 W11/W12 \u53D6\u8BC1\uFF09\uFF0C \u672C\u9875\u5BFC\u5165\u53EA\u505A\u5F62\u72B6\u63D0\u793A\u3002"] }), _jsxs("div", { className: "mt-2 grid grid-cols-1 gap-3 md:grid-cols-2", children: [_jsxs("div", { children: [_jsx("p", { className: "label", children: "\u5BFC\u51FA\u6587\u672C\uFF08\u53EF\u590D\u5236\uFF09" }), _jsx("textarea", { className: "input h-40 font-mono text-[11px]", "data-od-field": "worldbook-export", readOnly: true, value: exportText })] }), _jsxs("div", { children: [_jsx("p", { className: "label", children: "\u5BFC\u5165\u6587\u672C\uFF08\u7C98\u8D34\u540E\u70B9\"\u68C0\u67E5\u5F62\u72B6\"\uFF09" }), _jsx("textarea", { className: "input h-40 font-mono text-[11px]", "data-od-field": "worldbook-import", value: importText, onChange: (e) => setImportText(e.target.value) }), _jsx("button", { type: "button", "data-od-action": "worldbook-import-check", className: "mt-1 rounded bg-slate-900 px-3 py-1 text-xs text-white", onClick: () => setNotice(checkImportShape(importText)), children: "\u68C0\u67E5\u5F62\u72B6" })] })] }), notice && (_jsx("p", { "data-od-region": "worldbook-import-notice", className: "mt-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700", children: notice }))] })] }), _jsxs("section", { "data-od-region": "worldbook-preview", className: "space-y-3", children: [_jsxs("div", { className: "rounded-md border border-slate-200 bg-white p-3", children: [_jsx("h2", { className: "text-sm font-semibold text-slate-900", children: "\u5B9E\u65F6\u8BD5\u89E6\u53D1" }), _jsxs("p", { className: "mt-0.5 text-[11px] text-slate-500", children: ["\u8FB9\u6253\u5B57\u8FB9\u51FA\u7ED3\u679C\uFF0C", _jsx("strong", { children: "\u4E0D\u8C03\u7528\u6A21\u578B\u3001\u4E0D\u4FDD\u5B58" }), "\u3002\u7528\u4E0E\u771F\u5B9E\u8BF7\u6C42\u540C\u4E00\u4EFD\u5F15\u64CE\u4EE3\u7801\uFF0C\u6240\u4EE5\u62FC\u63A5\u7ED3\u679C\u9010\u5B57\u8282\u4E00\u81F4\u3002"] }), _jsx("textarea", { className: "input mt-2 h-24 text-[11px]", "data-od-field": "worldbook-testtext", "aria-label": "\u8BD5\u89E6\u53D1\u9898\u9762\u6587\u672C", value: testText, onChange: (e) => setTestText(e.target.value) }), _jsxs("div", { className: "mt-3 border-t border-slate-200 pt-2", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[11px] font-medium text-slate-700", children: "\u5224\u5B9A\uFF08\u53E6\u4E00\u6761\u89E6\u53D1\u8DEF\u5F84\uFF09" }), _jsx("button", { type: "button", className: "text-[10px] text-slate-500 underline", "data-od-action": "worldbook-clear-jury", onClick: () => {
                                                            setJury({ concepts: [], tags: [], elements: [] });
                                                            setJudgeNote('已清空判定 —— 触发退化为纯字面 keys（灰度口径）');
                                                        }, children: "\u6E05\u7A7A" })] }), _jsxs("p", { className: "mt-0.5 text-[10px] text-slate-500", children: ["\u7B2C 0 \u6B65\uFF08\u8BFB\u9898\u4E0E\u5224\u5B9A\uFF09\u4EA7\u51FA\u8FD9\u4E09\u6837\uFF1B\u547D\u4E2D = \u8003\u70B9\u76F8\u4EA4 \u4E14\uFF08\u9898\u578B\u76F8\u4EA4 \u6216 \u9898\u578B\u4E3A\u7A7A\uFF09", _jsx("strong", { children: " \u6216 " }), "\u52A8\u753B\u5143\u4EF6\u547D\u4E2D\uFF08\u7ECF\u8003\u70B9\u6536\u7A84\uFF09", _jsx("strong", { children: " \u6216 " }), "\u65E7\u7684 keys \u5B57\u9762\u547D\u4E2D\u3002", ' ', "\u4E0B\u9762\u7684\"\u547D\u4E2D\u65B9\u5F0F\"\u4F1A\u5199\u6E05\u6BCF\u6761\u8D70\u4E86\u54EA\u6761\u8DEF\u3002"] }), _jsx("textarea", { className: "input mt-1 h-20 text-[11px]", "data-od-field": "worldbook-judge-paste", "aria-label": "\u7C98\u8D34\u6A21\u578B\u8F6C\u5199\u4EE5\u81EA\u52A8\u89E3\u6790\u5224\u5B9A", placeholder: "\u628A\u6A21\u578B\u5728\u3010\u8BFB\u9898\u4E0E\u5224\u5B9A\u3011\u9636\u6BB5\u7684\u4E00\u6BB5\u8F93\u51FA\u7C98\u5230\u8FD9\u91CC\uFF0C\u4F1A\u81EA\u52A8\u89E3\u6790\u51FA\u8003\u70B9/\u9898\u578B/\u52A8\u753B\u5143\u4EF6", value: judgePaste, onChange: (e) => setJudgePaste(e.target.value) }), _jsxs("div", { className: "mt-1 flex items-center gap-2", children: [_jsx("button", { type: "button", className: "rounded border border-slate-300 px-2 py-0.5 text-[10px]", "data-od-action": "worldbook-parse-judge", onClick: () => {
                                                            if (!judgePaste.trim()) {
                                                                setJudgeNote('粘贴内容为空 —— 没有可解析的东西');
                                                                return;
                                                            }
                                                            const p = parseJudgement(judgePaste);
                                                            setJury({ concepts: p.concepts, tags: p.tags, elements: p.elements });
                                                            const unk = [...p.unknowns.concepts, ...p.unknowns.tags, ...p.unknowns.elements];
                                                            setJudgeNote(`解析：考点 ${p.concepts.length} · 题型 ${p.tags.length} · 动画元件 ${p.elements.length}` +
                                                                (unk.length ? ` · 表外词 ${unk.length} 个（已如实报出，不许静默丢）：${unk.join('、')}` : '') +
                                                                (p.problems.length ? ` · 结构问题 ${p.problems.length} 条` : ''));
                                                        }, children: "\u89E3\u6790\u7C98\u8D34\u5185\u5BB9" }), judgeNote && _jsx("span", { className: "text-[10px] text-slate-600", children: judgeNote })] }), _jsxs("div", { className: "mt-1 space-y-1 text-[10px] text-slate-700", children: [_jsxs("div", { children: [_jsx("span", { className: "text-slate-500", children: "\u8003\u70B9 " }), jury.concepts.length ? jury.concepts.join('、') : _jsx("span", { className: "text-slate-400", children: "\uFF08\u7A7A \u21D2 \u8BE5\u6761\u8DEF\u5F84\u4E0D\u89E6\u53D1\uFF09" })] }), _jsxs("div", { children: [_jsx("span", { className: "text-slate-500", children: "\u9898\u578B " }), jury.tags.length ? jury.tags.join('、') : _jsx("span", { className: "text-slate-400", children: "\uFF08\u7A7A\uFF09" })] }), _jsxs("div", { children: [_jsx("span", { className: "text-slate-500", children: "\u52A8\u753B\u5143\u4EF6 " }), jury.elements.length ? jury.elements.join('、') : _jsx("span", { className: "text-slate-400", children: "\uFF08\u7A7A\uFF09" })] })] })] })] }), _jsxs(Block, { title: "\u2464 \u8BCD\u8868\uFF08\u53EA\u80FD\u4ECE\u8868\u91CC\u9009\uFF1B\u5F53\u524D\u5E93\u7528\u5230\u7684\u503C\uFF09", region: "worldbook-vocab", children: [_jsxs("p", { className: "text-[10px] text-slate-500", children: ["\u5224\u5B9A\u4E0E\u6807\u6CE8**\u53EA\u80FD**\u53D6\u8FD9\u4E09\u5F20\u8868\u91CC\u7684\u503C\u3002\u8868\u7684**\u5355\u6E90\u771F\u76F8**\u662F ", _jsx("code", { children: "contracts/worldbook-concepts.json" }), "\uFF08schema \u679A\u4E3E\u3001Prompt \u6CE8\u5165\u3001\u8FD9\u91CC\u7684\u4E09\u5F20\u6E05\u5355\u90FD\u4ECE\u5B83\u6D3E\u751F\uFF09\u3002 \u672C\u671F 137 \u6761\u8001\u8BCD\u6761\u8FD8\u6CA1\u5E26\u4E09\u680F \u21D2 \u8FD9\u91CC\u663E\u793A\u7684\u662F\"**\u5F53\u524D\u5E93\u91CC\u5DF2\u7ECF\u7528\u5230\u7684\u503C**\"\uFF08\u542B 0 \u6761\u65F6\u4E3A\u7A7A\uFF09\uFF0C \u5168\u96C6\u7B49 5.9 \u671F\u5199\u5B8C\u65B0\u5E93\u81EA\u7136\u8865\u5168\u3002"] }), _jsxs("div", { className: "mt-1 grid grid-cols-1 gap-2 text-[10px] md:grid-cols-3", children: [_jsxs("div", { children: [_jsxs("div", { className: "font-medium text-slate-700", children: ["\u8003\u70B9\uFF08", vocab.concepts.length, " \u4E2A\u5DF2\u7528\uFF09"] }), _jsx("div", { className: "mt-0.5 max-h-32 overflow-auto rounded border border-slate-200 p-1", children: vocab.concepts.length ? vocab.concepts.join('、') : _jsx("span", { className: "text-slate-400", children: "\uFF08\u7A7A\uFF09" }) })] }), _jsxs("div", { children: [_jsxs("div", { className: "font-medium text-slate-700", children: ["\u9898\u578B\u6807\u7B7E\uFF08", vocab.tags.length, " \u6761\u5DF2\u7528\uFF09"] }), _jsx("div", { className: "mt-0.5 max-h-32 overflow-auto rounded border border-slate-200 p-1", children: vocab.tags.length ? vocab.tags.join('、') : _jsx("span", { className: "text-slate-400", children: "\uFF08\u7A7A\uFF09" }) })] }), _jsxs("div", { children: [_jsxs("div", { className: "font-medium text-slate-700", children: ["\u52A8\u753B\u5143\u4EF6\uFF08", vocab.elements.length, " \u4E2A\u5DF2\u7528\uFF09"] }), _jsx("div", { className: "mt-0.5 max-h-32 overflow-auto rounded border border-slate-200 p-1", children: vocab.elements.length ? vocab.elements.join('、') : _jsx("span", { className: "text-slate-400", children: "\uFF08\u7A7A\uFF09" }) })] })] })] }), _jsx(Block, { title: "\u2460 \u547D\u4E2D\u6E05\u5355\u4E0E\u547D\u4E2D\u65B9\u5F0F", region: "worldbook-hits", children: preview.solve.result.provenance.length === 0 ? (_jsx("p", { className: "text-xs text-slate-500", children: "\u672C\u6B21\u6CA1\u6709\u4EFB\u4F55\u8BCD\u6761\u547D\u4E2D\uFF08\u9884\u89C8\u5668\u5FC5\u987B\u663E\u5F0F\u8BF4\u51FA\u6765\uFF09\u3002" })) : (_jsx("ul", { className: "space-y-1", children: preview.solve.result.provenance.map((p) => (_jsxs("li", { className: "text-[11px] text-slate-700", children: [_jsx("span", { className: "font-medium", children: p.title }), _jsx("span", { className: "ml-1 rounded bg-slate-100 px-1 text-[10px]", children: VIA_LABEL[p.via] ?? p.via }), p.from && _jsxs("span", { className: "ml-1 text-[10px] text-slate-500", children: ["\u2190 ", p.from] }), _jsxs("span", { className: "ml-1 text-[10px] text-slate-500", children: ["\u6CE8\u5165 ", p.injectedSlots.map((s) => SLOT_LABEL[s] ?? s).join(' / ') || '（无）', p.truncated ? ' · 被截断' : ''] })] }, p.entry_id))) })) }), _jsx(Block, { title: "\u2461 \u89E3\u9898\u69FD\u6700\u7EC8\u62FC\u63A5\u5185\u5BB9", region: "worldbook-solve", children: _jsx("pre", { className: "max-h-52 overflow-auto whitespace-pre-wrap text-[10px] text-slate-700", children: preview.solve.worldbookText || '（该槽本次未注入任何词条）' }) }), _jsx(Block, { title: "\u2462 \u52A8\u753B\u69FD\u6700\u7EC8\u62FC\u63A5\u5185\u5BB9", region: "worldbook-scene", children: _jsx("pre", { className: "max-h-52 overflow-auto whitespace-pre-wrap text-[10px] text-slate-700", children: preview.scene_code.worldbookText || '（该槽本次未注入任何词条）' }) }), _jsxs(Block, { title: "\u2463 \u7A7A\u69FD\u63D0\u793A\u4E0E\u622A\u65AD\u544A\u8B66", region: "worldbook-slots", children: [_jsxs("p", { className: "text-[11px] text-slate-700", children: ["\u7A7A\u69FD\uFF08\u9759\u9ED8\u8DF3\u8FC7\uFF09\uFF1A", preview.solve.result.emptySlots.length ? preview.solve.result.emptySlots.map((s) => SLOT_LABEL[s] ?? s).join(' / ') : '无'] }), _jsxs("p", { className: "mt-1 text-[11px] text-slate-700", children: ["\u88AB\u622A\u65AD\uFF08\u5FC5\u987B\u544A\u8B66\uFF09\uFF1A", preview.solve.result.truncatedSlots.length === 0
                                                ? '无'
                                                : preview.solve.result.truncatedSlots
                                                    .map((t) => `${SLOT_LABEL[t.slot] ?? t.slot} 丢弃 ${t.dropped} 条`)
                                                    .join(' / ')] }), _jsxs("p", { className: "mt-1 text-[10px] text-slate-500", children: ["\u9884\u7B97\uFF1A\u6DF1\u5EA6 ", WORLDBOOK_BUDGET.maxDepth, " \u00B7 \u6BCF\u69FD ", WORLDBOOK_BUDGET.maxEntries, " \u6761 \u00B7 \u6BCF\u69FD", ' ', WORLDBOOK_BUDGET.maxChars, " \u5B57\u7B26"] }), preview.solve.result.warnings.length > 0 && (_jsx("ul", { className: "mt-2 space-y-0.5", children: preview.solve.result.warnings.map((w) => (_jsxs("li", { className: "text-[10px] text-amber-800", children: ["\u26A0 ", w.message] }, `${w.code}-${w.entryId ?? ''}-${w.slot ?? ''}`))) }))] }), _jsx(Block, { title: "\u51B2\u7A81\u63D0\u793A\uFF08\u63D0\u793A\u4E0D\u963B\u65AD\uFF09", region: "worldbook-conflicts", children: conflicts.length === 0 ? (_jsx("p", { className: "text-xs text-slate-500", children: "\u6CA1\u6709\u53D1\u73B0\u51B2\u7A81\u3002" })) : (_jsx("ul", { className: "space-y-0.5", children: conflicts.map((c, i) => (_jsx("li", { className: `text-[11px] ${toneOfLevel(c)}`, children: c.message }, `${c.code}-${i}`))) })) }), _jsxs(Block, { title: "\u5185\u7F6E\u8BCD\u6761\u8986\u76D6\u7387\uFF08\u00A719.3\uFF09", region: "worldbook-coverage", children: [_jsxs("p", { className: "text-[11px] text-slate-700", children: ["\u5171 ", WORLDBOOK_COVERAGE.total, " \u6761 \u00B7 \u7ED3\u6784\u5408\u89C4", ' ', _jsxs("strong", { children: [(WORLDBOOK_COVERAGE.structuralRate * 100).toFixed(0), "%"] }), "\uFF08\u81EA\u68C0\u6761\u6B3E ", (WORLDBOOK_COVERAGE.selfCheckCoverage * 100).toFixed(0), "% \u00B7 code_examples", ' ', (WORLDBOOK_COVERAGE.exampleCoverage * 100).toFixed(0), "%\uFF09"] }), _jsxs("p", { className: "mt-1 text-[11px] text-amber-800", children: ["\u5185\u5BB9\u8986\u76D6\uFF1A", _jsx("strong", { children: "\u672A\u5B8C\u6210" }), " \u2014\u2014 ", WORLDBOOK_COVERAGE.reason] }), _jsxs("p", { className: "mt-1 text-[10px] text-slate-500", children: ["\u5E93\u54C8\u5E0C ", WORLDBOOK_HASH.slice(0, 16), "\u2026"] }), _jsx("ul", { className: "mt-1 space-y-0.5", children: WORLDBOOK_SOURCES.map((s) => (_jsxs("li", { className: "text-[10px] text-slate-500", children: [s.kind === 'builtin' ? '内置' : '用户', " \u00B7 ", s.name, " \u00B7 ", s.count, " \u6761 \u00B7 ", s.sha256.slice(0, 10), "\u2026"] }, s.name))) })] })] })] })] }));
}
/* ────────────────────────────── 小组件 ────────────────────────────── */
function Field({ label, children }) {
    return (_jsxs("label", { className: "block", children: [_jsx("span", { className: "label", children: label }), children] }));
}
function Block({ title, region, children }) {
    return (_jsxs("div", { "data-od-region": region, className: "rounded-md border border-slate-200 bg-white p-3", children: [_jsx("h3", { className: "mb-1 text-xs font-semibold text-slate-800", children: title }), children] }));
}
function toneOfLevel(c) {
    if (c.level === 'error')
        return 'text-rose-700';
    if (c.level === 'warn')
        return 'text-amber-800';
    return 'text-slate-600';
}
/** 导入的**形状提示**（不做完整校验：那在 Node 侧，见文件头说明） */
function checkImportShape(text) {
    if (!text.trim())
        return '先粘贴导出包文本。';
    let obj;
    try {
        obj = JSON.parse(text);
    }
    catch (err) {
        return `不是合法 JSON：${err.message}`;
    }
    if (typeof obj !== 'object' || obj === null)
        return '顶层必须是对象。';
    const rec = obj;
    const problems = [];
    if (rec.format !== WORLDBOOK_PACK_FORMAT)
        problems.push(`format 必须是 "${WORLDBOOK_PACK_FORMAT}"`);
    if (rec.version !== WORLDBOOK_PACK_VERSION)
        problems.push(`version 必须是 ${WORLDBOOK_PACK_VERSION}`);
    if (!Array.isArray(rec.entries))
        problems.push('entries 必须是数组');
    if (problems.length)
        return `形状有问题：${problems.join('；')}`;
    const list = rec.entries;
    return `形状检查通过：${list.length} 条词条。（完整字段校验与旧名归一化在 Node 侧执行，落盘时再做一次。）`;
}
