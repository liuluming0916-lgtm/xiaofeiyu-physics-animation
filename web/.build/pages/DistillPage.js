import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 蒸馏页（§15 第五页 / M19 简版的前端）
 *
 * 用户 2026-10-17 的裁决：**不做 PDF 解析**，所以这一页的输入只有两种：
 *   · 丢图片（扫描页导出成 PNG/JPG 拖进来）
 *   · 粘文字（把教辅正文贴进文本框，按"一页"算）
 *
 * 流程严格照 §15 的四件事，一步不省：
 *   导入 → 建会话（含**成本预估**）→ 逐页跑（**页级进度**，可中断续做）
 *   → 候选卡片 → **人工勾选** → 入库（走世界书编辑器：整批校验 + 备份）
 *
 * ⚠ 纪律：**绝不自动入库**。这一页所有"写规则区"的动作都必须经过用户点"确认入库"。
 *   失败页也**不静默跳过**：卡片上直接显示失败原因与模型原文，方便人判断是重跑还是手工补。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp'];
const readAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.onload = () => {
        const result = String(reader.result ?? '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
});
export function DistillPage() {
    const [pages, setPages] = useState([]);
    const [session, setSession] = useState(null);
    const [picked, setPicked] = useState(new Set());
    const [busy, setBusy] = useState(null);
    const [note, setNote] = useState(null);
    const [pastedText, setPastedText] = useState('');
    const fileRef = useRef(null);
    const estimate = useMemo(() => {
        const imagePages = pages.filter((p) => p.kind === 'image').length;
        const textPages = pages.filter((p) => p.kind === 'text').length;
        return { imagePages, textPages, total: pages.length };
    }, [pages]);
    /* ── 导入：文件与粘贴文字都只是"待处理页"，还没花一分钱 ── */
    const addFiles = useCallback(async (files) => {
        if (!files || !files.length)
            return;
        const next = [];
        for (const file of Array.from(files)) {
            if (!IMAGE_MIME.includes(file.type)) {
                setNote({ ok: false, text: `跳过 ${file.name}：只支持 ${IMAGE_MIME.join(' / ')}` });
                continue;
            }
            if (file.size > 15 * 1024 * 1024) {
                setNote({ ok: false, text: `跳过 ${file.name}：超过 15 MB（本项目不替你静默压缩）` });
                continue;
            }
            next.push({ kind: 'image', name: file.name, mime: file.type, base64: await readAsBase64(file) });
        }
        if (next.length)
            setPages((prev) => [...prev, ...next]);
    }, []);
    const addPastedText = useCallback(() => {
        const text = pastedText.trim();
        if (!text)
            return;
        setPages((prev) => [...prev, { kind: 'text', text }]);
        setPastedText('');
    }, [pastedText]);
    const removePage = useCallback((index) => {
        setPages((prev) => prev.filter((_, i) => i !== index));
        setSession(null);
        setPicked(new Set());
    }, []);
    /* ── 建会话：立刻给出成本预估（页数 × 单页 token） ── */
    const startSession = useCallback(async () => {
        if (!pages.length)
            return;
        setBusy('正在建会话…');
        setNote(null);
        try {
            const res = await fetch('/api/distill/sessions', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    title: `教辅蒸馏 ${new Date().toLocaleString()}`,
                    source: pages.some((p) => p.kind === 'image') ? 'image' : 'text',
                    pages: pages.map((p) => ({ kind: p.kind, chars: p.text?.length ?? 0 })),
                }),
            });
            const data = (await res.json());
            if (!data.ok || !data.session)
                throw new Error(data.issues?.[0]?.message ?? '建会话失败');
            setSession(data.session);
            setPicked(new Set());
            setNote({ ok: true, text: `会话已建：${data.session.estimate.note}` });
        }
        catch (err) {
            setNote({ ok: false, text: `建会话失败：${err.message}` });
        }
        finally {
            setBusy(null);
        }
    }, [pages]);
    /* ── 逐页跑：只跑 pending（这就是"中断续做"） ── */
    const runPending = useCallback(async () => {
        if (!session)
            return;
        const todo = session.pages.filter((p) => p.status === 'pending');
        if (!todo.length) {
            setNote({ ok: true, text: '没有待处理的页了（done / failed 的页不会重跑）' });
            return;
        }
        setNote(null);
        for (const page of todo) {
            const input = pages[page.index];
            if (!input)
                continue;
            setBusy(`正在蒸馏第 ${page.index + 1} / ${session.pages.length} 页…`);
            try {
                const res = await fetch('/api/distill/page', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        sessionId: session.id,
                        pageIndex: page.index,
                        kind: input.kind,
                        text: input.text,
                        image: input.kind === 'image' ? { mime: input.mime, base64: input.base64, name: input.name } : undefined,
                    }),
                });
                const data = (await res.json());
                if (!res.ok || !data.ok) {
                    setNote({ ok: false, text: `第 ${page.index + 1} 页失败：${data.issues?.[0]?.message ?? '未知错误'}` });
                    continue;
                }
                if (data.session)
                    setSession(data.session);
            }
            catch (err) {
                setNote({ ok: false, text: `第 ${page.index + 1} 页请求失败：${err.message}` });
            }
        }
        setBusy(null);
    }, [pages, session]);
    /* ── 人工确认后入库 ── */
    const commit = useCallback(async () => {
        if (!session)
            return;
        const picks = [];
        for (const page of session.pages) {
            page.entries.forEach((entry, i) => {
                if (picked.has(`${page.index}:${i}`))
                    picks.push(entry);
            });
        }
        if (!picks.length) {
            setNote({ ok: false, text: '还没有勾选任何候选词条' });
            return;
        }
        setBusy('正在入库…');
        try {
            const res = await fetch('/api/distill/commit', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sessionId: session.id, picks }),
            });
            const data = (await res.json());
            if (!data.ok)
                throw new Error(data.issues?.[0]?.message ?? '入库失败');
            setNote({ ok: true, text: `已入库 ${data.entries ?? picks.length} 条 → 词条包 ${data.name}（可到「设置 → 世界书」查看）` });
            setPicked(new Set());
        }
        catch (err) {
            setNote({ ok: false, text: `入库失败：${err.message}` });
        }
        finally {
            setBusy(null);
        }
    }, [picked, session]);
    const togglePick = useCallback((key) => {
        setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(key))
                next.delete(key);
            else
                next.add(key);
            return next;
        });
    }, []);
    const doneCount = session?.pages.filter((p) => p.status === 'done').length ?? 0;
    const failedCount = session?.pages.filter((p) => p.status === 'failed').length ?? 0;
    const candidateCount = session?.pages.reduce((n, p) => n + p.entries.length, 0) ?? 0;
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "rounded-lg border border-slate-200 bg-white p-4 shadow-sm", children: [_jsx("h2", { className: "text-sm font-medium text-slate-900", children: "\u6559\u8F85\u84B8\u998F\uFF08\u7B80\u7248\uFF1A\u56FE\u7247 / \u6587\u5B57 \u2192 \u5019\u9009\u8BCD\u6761\uFF09" }), _jsx("p", { className: "mt-1 text-xs text-slate-500", children: "\u4E0D\u505A PDF \u89E3\u6790\uFF1A\u626B\u63CF\u9875\u8BF7\u5728\u9605\u8BFB\u5668\u91CC\u5BFC\u51FA\u6210 PNG/JPG \u518D\u62D6\u8FDB\u6765\uFF0C\u6216\u8005\u76F4\u63A5\u7C98\u6587\u5B57\u3002 \u5019\u9009\u8BCD\u6761**\u5FC5\u987B\u4F60\u70B9\u786E\u8BA4\u624D\u4F1A\u5165\u5E93**\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u5199\u89C4\u5219\u533A\u3002" }), _jsxs("div", { className: "mt-3 flex flex-wrap items-center gap-2", children: [_jsx("input", { ref: fileRef, type: "file", multiple: true, accept: IMAGE_MIME.join(','), className: "hidden", onChange: (e) => void addFiles(e.target.files) }), _jsx("button", { type: "button", className: "rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50", onClick: () => fileRef.current?.click(), disabled: busy !== null, children: "\u9009\u62E9\u9875\u56FE\u2026" }), _jsx("span", { className: "text-xs text-slate-500", children: estimate.total ? `已选 ${estimate.total} 页（图 ${estimate.imagePages} · 文字 ${estimate.textPages}）` : '还没有选页' }), pages.length > 0 && (_jsx("button", { type: "button", className: "rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:bg-slate-300", onClick: () => void startSession(), disabled: busy !== null, children: "\u5EFA\u4F1A\u8BDD\u5E76\u9884\u4F30\u6210\u672C" }))] }), _jsxs("div", { className: "mt-3", children: [_jsx("textarea", { className: "w-full rounded-md border border-slate-300 p-2 text-sm", rows: 3, placeholder: "\u4E5F\u53EF\u4EE5\u76F4\u63A5\u7C98\u4E00\u9875\u6559\u8F85\u6B63\u6587\uFF08\u4F1A\u6309\u201C\u4E00\u9875\u6587\u5B57\u201D\u7B97\uFF09", value: pastedText, onChange: (e) => setPastedText(e.target.value) }), _jsx("button", { type: "button", className: "mt-1 rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50 disabled:text-slate-400", onClick: addPastedText, disabled: !pastedText.trim() || busy !== null, children: "\u6DFB\u52A0\u8FD9\u4E00\u9875\u6587\u5B57" })] }), pages.length > 0 && (_jsx("ol", { className: "mt-3 space-y-1 text-xs text-slate-600", children: pages.map((p, i) => (_jsxs("li", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-mono text-slate-400", children: String(i + 1).padStart(2, '0') }), _jsx("span", { className: "truncate", children: p.kind === 'image' ? p.name ?? '（图片）' : `文字页（${p.text?.length ?? 0} 字）` }), _jsx("button", { type: "button", className: "text-slate-400 hover:text-red-600", onClick: () => removePage(i), disabled: busy !== null, "aria-label": `移除第 ${i + 1} 页`, children: "\u2715" })] }, `${p.name ?? 'text'}-${i}`))) }))] }), note && (_jsx("div", { className: `rounded-lg border p-3 text-sm ${note.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'}`, role: note.ok ? undefined : 'alert', children: note.text })), session && (_jsxs("div", { className: "rounded-lg border border-slate-200 bg-white p-4 shadow-sm", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [_jsx("span", { className: "text-sm font-medium text-slate-900", children: "\u9875\u7EA7\u8FDB\u5EA6" }), _jsxs("span", { className: "text-xs text-slate-500", children: ["\u5171 ", session.pages.length, " \u9875 \u00B7 \u5B8C\u6210 ", doneCount, " \u00B7 \u5931\u8D25 ", failedCount, " \u00B7 \u5019\u9009 ", candidateCount, " \u6761"] }), _jsx("button", { type: "button", className: "rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:text-slate-400", onClick: () => void runPending(), disabled: busy !== null, children: "\u5F00\u59CB / \u7EE7\u7EED\u84B8\u998F" }), _jsxs("button", { type: "button", className: "rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:bg-slate-300", onClick: () => void commit(), disabled: busy !== null || picked.size === 0, children: ["\u786E\u8BA4\u5165\u5E93\uFF08\u5DF2\u52FE ", picked.size, " \u6761\uFF09"] }), busy && _jsx("span", { className: "text-xs text-slate-600", children: busy })] }), _jsx("div", { className: "mt-3 space-y-3", children: session.pages.map((page) => (_jsxs("div", { className: "rounded-md border border-slate-200", children: [_jsxs("div", { className: "flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs", children: [_jsxs("span", { className: "font-mono text-slate-400", children: ["\u7B2C ", page.index + 1, " \u9875"] }), _jsx("span", { className: page.status === 'done'
                                                ? 'text-emerald-700'
                                                : page.status === 'failed'
                                                    ? 'text-red-700'
                                                    : 'text-slate-500', children: page.status === 'done' ? '已完成' : page.status === 'failed' ? '失败' : '待处理' }), _jsxs("span", { className: "text-slate-500", children: [page.entries.length, " \u6761\u5019\u9009"] })] }), page.issues.length > 0 && (_jsx("ul", { className: "border-b border-slate-100 bg-amber-50 px-3 py-2 text-xs text-amber-900", children: page.issues.map((issue, i) => (_jsxs("li", { children: [issue.code, "\uFF1A", issue.message] }, `${issue.code}-${i}`))) })), page.entries.length > 0 && (_jsx("ul", { className: "divide-y divide-slate-100", children: page.entries.map((entry, i) => {
                                        const key = `${page.index}:${i}`;
                                        return (_jsxs("li", { className: "flex gap-2 px-3 py-2", children: [_jsx("input", { type: "checkbox", className: "mt-1", checked: picked.has(key), onChange: () => togglePick(key), "aria-label": `选择候选：${entry.title}` }), _jsxs("div", { className: "min-w-0", children: [_jsxs("p", { className: "text-sm font-medium text-slate-900", children: [entry.title, _jsx("span", { className: "ml-2 font-mono text-xs text-slate-400", children: entry.slot })] }), _jsxs("p", { className: "mt-0.5 text-xs text-slate-500", children: ["\u89E6\u53D1\u8BCD\uFF1A", entry.keys.join(' / ') || '—'] }), _jsx("p", { className: "mt-1 whitespace-pre-wrap text-xs text-slate-700", children: entry.content })] })] }, key));
                                    }) })), page.status === 'failed' && page.raw && (_jsxs("details", { className: "px-3 py-2", children: [_jsx("summary", { className: "cursor-pointer text-xs text-slate-500", children: "\u6A21\u578B\u539F\u6587\uFF08\u6392\u67E5\u7528\uFF09" }), _jsx("pre", { className: "mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-600", children: page.raw })] }))] }, page.index))) }), _jsx("p", { className: "mt-3 text-xs text-slate-500", children: "\u4F1A\u8BDD\u4FDD\u5B58\u5728\u672C\u673A distill-sessions/\uFF0C\u5173\u6389\u9875\u9762\u518D\u56DE\u6765\u53EF\u4EE5\u63A5\u7740\u505A\u3002" })] }))] }));
}
