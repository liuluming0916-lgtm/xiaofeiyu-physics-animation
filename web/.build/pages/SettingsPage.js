import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 设置页（v2 收口版）。
 *
 * 旧的 v1 知识卡页面已在 Phase 3C-3 前替换为 KnowledgecardV2Panel；
 * 这里只保留四个 tab 的壳：知识卡 v2 / 提示词卡 / 本地规则卡 / AI 帮写（占位）。
 */
import { useState } from 'react';
import { CleaningPanel } from '../components/rules/CleaningPanel';
import { KnowledgecardV2Panel } from '../components/rules/KnowledgecardV2Panel';
import { PromptsPanel } from '../components/rules/PromptsPanel';
const SETTINGS_TABS = [
    { id: 'cardsV2', label: '知识卡', hint: '元件 / 场景 / 动画规范；词表开关' },
    { id: 'prompts', label: '提示词卡', hint: '按阶段改模型指令；下一题生效' },
    { id: 'cleaning', label: '本地规则卡', hint: '模型输出后处理；内置 4 条锁定' },
    { id: 'ai', label: 'AI 帮写', hint: '生成卡片草稿；本轮只做占位' },
];
export function SettingsPage() {
    const [tab, setTab] = useState('cardsV2');
    return (_jsxs("div", { className: "mx-auto max-w-7xl space-y-3 p-4", children: [_jsxs("header", { className: "flex flex-wrap items-end justify-between gap-2", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-base font-semibold text-slate-900", children: "\u8BBE\u7F6E" }), _jsxs("p", { className: "mt-1 text-xs text-slate-500", children: ["\u77E5\u8BC6\u5361\u3001\u63D0\u793A\u8BCD\u5361\u4E0E\u672C\u5730\u89C4\u5219\u5361\u90FD\u5728\u8FD9\u91CC\u3002\u6539\u7684\u662F ", _jsx("code", { className: "rounded bg-slate-100 px-1", children: "ai-rules/" }), ' ', "\u4E0B\u7684\u771F\u5B9E\u6587\u4EF6\uFF1A\u539F\u5B50\u5199\u5165\u3001\u6574\u6279\u6821\u9A8C\u3001\u6574\u6279\u751F\u6548\u6216\u6574\u6279\u5931\u8D25\u3002"] })] }), _jsx("p", { className: "text-[11px] text-slate-500", children: "\u7AEF\u70B9\u4E0E Key \u5728\u53F3\u4E0A\u89D2\u300C\u2699 \u8FDE\u63A5\u8BBE\u7F6E\u300D\u3002" })] }), _jsx("nav", { "data-od-region": "settings-tabs", className: "flex flex-wrap gap-1", "aria-label": "\u8BBE\u7F6E\u5206\u7C7B", children: SETTINGS_TABS.map((t) => (_jsxs("button", { type: "button", onClick: () => setTab(t.id), "aria-current": tab === t.id ? 'page' : undefined, className: `rounded-md border px-3 py-1.5 text-left text-xs ${tab === t.id
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`, children: [_jsx("span", { className: "block font-medium", children: t.label }), _jsx("span", { className: tab === t.id ? 'text-slate-200' : 'text-slate-400', children: t.hint })] }, t.id))) }), tab === 'cardsV2' ? (_jsx(KnowledgecardV2Panel, {})) : tab === 'prompts' ? (_jsx(PromptsPanel, {})) : tab === 'cleaning' ? (_jsx(CleaningPanel, {})) : (_jsx(AiDraftPlaceholder, {}))] }));
}
function AiDraftPlaceholder() {
    return (_jsxs("section", { "data-od-region": "settings-ai-draft", className: "rounded-md border border-slate-200 bg-white p-5", children: [_jsxs("div", { className: "flex flex-wrap items-start justify-between gap-3", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-semibold text-slate-900", children: "AI \u5E2E\u5199" }), _jsxs("p", { className: "mt-1 max-w-2xl text-xs leading-relaxed text-slate-600", children: ["\u76EE\u6807\u6D41\u7A0B\uFF1A\u63CF\u8FF0\u4F60\u8981\u7684\u5361\u7247 \u2192 \u751F\u6210\u8349\u7A3F \u2192 \u5728\u8BBE\u7F6E\u9875\u7F16\u8F91 \u2192 \u5BFC\u5165 / \u5BFC\u51FA\u3002", _jsx("strong", { children: "\u4E0D\u81EA\u52A8\u4FDD\u5B58\u3001\u4E0D\u81EA\u52A8\u53D1\u5E03" }), "\uFF1B\u8349\u7A3F\u4ECD\u7136\u8981\u8D70\u672C\u673A\u6821\u9A8C\uFF0C\u4FDD\u5B58\u52A8\u4F5C\u6C38\u8FDC\u7531\u4F60\u70B9\u3002"] })] }), _jsx("button", { type: "button", disabled: true, title: "\u672C\u8F6E\u53EA\u505A\u5165\u53E3\u5360\u4F4D\uFF0C\u6682\u4E0D\u8C03\u7528\u6A21\u578B", className: "cursor-not-allowed rounded border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-slate-400", children: "AI \u5E2E\u5199\uFF08\u6682\u672A\u5F00\u653E\uFF09" })] }), _jsxs("div", { className: "mt-4 rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600", children: [_jsx("p", { className: "font-medium text-slate-700", children: "\u8FD9\u4E00\u7248\u4E3A\u4EC0\u4E48\u5148\u5360\u4F4D" }), _jsx("p", { className: "mt-1", children: "\u751F\u6210\u8349\u7A3F\u9700\u8981\u6A21\u578B\u8C03\u7528\u3001JSON \u5BB9\u9519\u3001C1 \u6821\u9A8C\u4E0E\u5931\u8D25\u4FEE\u590D\uFF1B\u8FD9\u4E9B\u4E0D\u5728\u672C\u671F\u77E5\u8BC6\u5361\u6536\u53E3\u8303\u56F4\u5185\u3002 \u5148\u628A\u5165\u53E3\u56FA\u5B9A\u5728\u8FD9\u91CC\uFF0C\u907F\u514D\u4E0B\u4E2A\u7248\u672C\u53C8\u5728\u5BFC\u822A\u680F\u91CC\u591A\u4E00\u4E2A\u5165\u53E3\u3002" }), _jsx("p", { className: "mt-2", children: "\u73B0\u5728\u53EF\u7528\uFF1A\u300C\u77E5\u8BC6\u5361 v2\u300D\u91CC\u65B0\u5EFA / \u7F16\u8F91 / \u4FDD\u5B58 / \u5BFC\u5165\u5BFC\u51FA\uFF1B\u300C\u63D0\u793A\u8BCD\u5361\u300D\u4E0E\u300C\u672C\u5730\u89C4\u5219\u5361\u300D\u5404\u81EA\u6709\u4FDD\u5B58\u6309\u94AE\u3002" })] })] }));
}
