import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { STAGE_NOTE_META } from '../lib/stage-notes';
const emptyNotes = () => ({});
export function StageNotesDialog({ open, value, legacyDescription = '', onClose, onSave }) {
    const [draft, setDraft] = useState(emptyNotes);
    useEffect(() => {
        if (!open)
            return;
        if (Object.keys(value).length) {
            setDraft({ ...value });
            return;
        }
        if (legacyDescription.trim()) {
            const text = legacyDescription.trim();
            setDraft({ read_problem: text, solve: text, analysis: text });
            return;
        }
        setDraft({});
    }, [open, value, legacyDescription]);
    if (!open)
        return null;
    const filled = STAGE_NOTE_META.filter((s) => (draft[s.key] ?? '').trim()).length;
    const toggle = (key, on) => {
        setDraft((prev) => {
            const next = { ...prev };
            if (on)
                next[key] = '';
            else
                delete next[key];
            return next;
        });
    };
    const save = () => {
        const next = {};
        for (const s of STAGE_NOTE_META) {
            const text = (draft[s.key] ?? '').trim();
            if (text)
                next[s.key] = text;
        }
        onSave(next);
        onClose();
    };
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4", role: "dialog", "aria-modal": "true", children: _jsxs("div", { className: "max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl", children: [_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-lg font-semibold text-slate-900", children: "\u8865\u5145\u4FE1\u606F\uFF08\u6309\u9636\u6BB5\uFF09" }), _jsx("p", { className: "mt-1 text-xs leading-5 text-slate-500", children: "\u52FE\u9009\u8981\u6CE8\u5165\u7684\u9636\u6BB5\uFF0C\u518D\u5199\u8BE5\u9636\u6BB5\u7684\u8865\u5145\u3002\u7A7A\u7740 = \u4E0D\u6CE8\u5165\uFF1B\u5404\u9636\u6BB5\u4E92\u4E0D\u5F71\u54CD\u3002" })] }), _jsx("button", { type: "button", className: "rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100", onClick: onClose, children: "\u5173\u95ED" })] }), _jsx("div", { className: "mt-4 space-y-4", children: STAGE_NOTE_META.map((s) => {
                        const on = draft[s.key] !== undefined;
                        return (_jsxs("div", { className: "rounded-lg border border-slate-200 p-3", children: [_jsxs("label", { className: "flex items-center gap-2 text-sm font-medium text-slate-800", children: [_jsx("input", { type: "checkbox", checked: on, onChange: (e) => toggle(s.key, e.target.checked) }), s.label] }), _jsx("p", { className: "ml-6 mt-1 text-xs text-slate-500", children: s.hint }), _jsx("textarea", { rows: 2, disabled: !on, className: "mt-2 w-full rounded-md border border-slate-300 p-2 text-sm disabled:bg-slate-50 disabled:text-slate-400", value: draft[s.key] ?? '', onChange: (e) => setDraft((prev) => ({ ...prev, [s.key]: e.target.value })), placeholder: on ? '写这一阶段需要补充的信息…' : '勾选后才能填写' })] }, s.key));
                    }) }), _jsxs("div", { className: "mt-5 flex items-center justify-between", children: [_jsx("span", { className: "text-xs text-slate-500", children: filled ? `已填 ${filled} 个阶段` : '未填任何阶段' }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", className: "rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50", onClick: onClose, children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: "rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700", onClick: save, children: "\u4FDD\u5B58" })] })] })] }) }));
}
