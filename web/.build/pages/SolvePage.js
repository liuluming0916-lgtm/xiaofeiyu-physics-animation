import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 解题页（§15 第一页）。
 *
 * 本期的范围（见 README 12.17 / 13.1）：
 *   题面文字输入 · **题目图片输入（选择/拖入 + 缩略图 + 移除）** · **按阶段补充信息** ·
 *   **§11.3 视觉门控禁用态与原因提示** · 阶段进度 · 流式解题过程 · 校验报告面板
 *
 * ⚠ 两处必须显式告知用户、不能含糊的地方：
 *   1. **判定来源**：演示源的判定是 `skipped`（浏览器里没有校验内核），
 *      UI 必须把它显示成"未校验"而不是"通过"。**绝不谎报 pass。**
 *   2. **公式排版**：这里的公式是占位排版；**成品页里的公式是构建期 MathJax 真 SVG**。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionDialog } from '../components/ConnectionDialog';
import { OpenLogNotice } from '../components/OpenLogNotice';
import { StageNotesDialog } from '../components/StageNotesDialog';
import { STAGE_NOTE_META } from '../lib/stage-notes';
import { DEMO_QUESTION_LIST } from '../lib/demo-questions';
import { STAGE_CHAIN, precisionLabel } from '../lib/run-stream';
import { api } from '../lib/rules-api';
import { Markdown, MathBlock, parseRowTable } from '../lib/markdown';
import { selectIsSkipped, useApp, listDevReports, clearDevReports } from '../state/store';
/** §16 的体积与格式限制（与 `core/gateway/model-client.mjs` 保持一致） */
const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp'];
/** 开新题前“会清空旧动画”的提示：勾过“不再提示”后写 localStorage */
const CLEAR_WARN_KEY = 'od-clear-animation-warning-skip';
export function SolvePage({ onOpenAnimation, runStart, runCancel, }) {
    const st = useApp();
    const start = runStart;
    const cancel = runCancel;
    const fileRef = useRef(null);
    /** v1.1.16：解析图片的入口（与题目图片分开） */
    const refFileRef = useRef(null);
    /** 第 8 期 A2：连接设置小窗（发布版没有设置页，只能从这里填地址与 Key） */
    const [connOpen, setConnOpen] = useState(false);
    /** v1.1.18：补充描述改成“按阶段”弹窗 */
    const [notesOpen, setNotesOpen] = useState(false);
    /**
     * §11.3 视觉门控（**第 8 期修正：不再写死**）。
     *
     * 历史：第 3 期这里写的是 `const visionAvailable = false`，理由是"演示模式没有端点，
     * 不假装支持图片"。但后来接上了本机服务与齿轮小窗，这一行就变成了**谎言的源头**：
     * 用户在齿轮里勾了"支持看图"、保存成功，界面仍然说"当前模型不支持图片输入"。
     *
     * 现在的口径：**如实转述服务端配置的 `supportsVision`**。
     *   · 没配端点 → 提示先去配；
     *   · 配了但不支持 → 提示去齿轮里勾上（如果服务商支持）；
     *   · 配了且支持 → 放开入口。
     * 真到模型那一步才发现不支持，也不是我们骗人 —— 界面上会显示模型返回的原话（不做假降级）。
     */
    const [visionAvailable, setVisionAvailable] = useState(false);
    /**
     * 这次运行走哪条路：
     *   `server` = 打本机 `/api/run`，**真实调用模型**（配了端点且有 Key）
     *   `demo`   = 本地真题演示（不调模型，判定为"未校验"）
     * 界面必须**如实显示**当前是哪条路 —— 之前写死 demo，用户装完以为在真跑。
     */
    const [runSource, setRunSource] = useState('demo');
    const [visionNote, setVisionNote] = useState('正在读取连接配置…');
    /**
     * ── v1.1.18 · 开新题前的“清空旧动画”确认（用户裁决 B+1）──
     *
     * 旧动画还挂在 store 里时，开始新题会把它清掉。这里先弹窗，**默认按钮是取消**；
     * 勾选“以后不再提示”（默认勾上）后，下一次不再弹。
     * 没有旧动画时完全不弹。
     */
    const [dontWarnClear, setDontWarnClear] = useState(() => {
        try {
            return localStorage.getItem(CLEAR_WARN_KEY) === '1';
        }
        catch {
            return false;
        }
    });
    const [clearWarnOpen, setClearWarnOpen] = useState(false);
    const [dontAskAgain, setDontAskAgain] = useState(true);
    const beginRun = useCallback(() => {
        void start({ source: runSource });
    }, [start, runSource]);
    const onStartClick = useCallback(() => {
        if (st.programSlots && !dontWarnClear) {
            setDontAskAgain(true);
            setClearWarnOpen(true);
            return;
        }
        beginRun();
    }, [st.programSlots, dontWarnClear, beginRun]);
    const confirmClearAndStart = useCallback(() => {
        if (dontAskAgain) {
            try {
                localStorage.setItem(CLEAR_WARN_KEY, '1');
            }
            catch {
                /* 隐私模式：不记也可以，下次再问 */
            }
            setDontWarnClear(true);
        }
        setClearWarnOpen(false);
        beginRun();
    }, [dontAskAgain, beginRun]);
    const refreshVision = useCallback(() => {
        let alive = true;
        api
            .endpoints()
            .then((data) => {
            if (!alive)
                return;
            const ep = data.endpoints?.[0] ?? null;
            if (!ep) {
                setVisionAvailable(false);
                setVisionNote('还没有配置模型：点右上角「⚙ 连接设置」填接口地址与 Key');
                setRunSource('demo');
                return;
            }
            setVisionAvailable(Boolean(ep.supportsVision));
            setVisionNote(ep.supportsVision
                ? ''
                : '已配置的模型被标记为「不支持看图」。若你的服务商支持多模态，请到「⚙ 连接设置」勾上「这个模型支持看图」并保存');
            /* 有端点但没 Key 时仍然走演示（真跑必然失败），界面会如实说明 */
            setRunSource(data.keyCount > 0 ? 'server' : 'demo');
        })
            .catch(() => {
            if (!alive)
                return;
            setVisionAvailable(false);
            setVisionNote('读不到连接配置（本机服务未就绪）');
            setRunSource('demo');
        });
        return () => {
            alive = false;
        };
    }, []);
    useEffect(() => refreshVision(), [refreshVision]);
    const visionReason = visionNote || '当前模型不支持图片输入';
    const addFiles = useCallback((files) => {
        if (!files)
            return;
        for (const file of Array.from(files)) {
            if (!ALLOWED_MIME.includes(file.type)) {
                useApp.getState().failRun(`不支持的图片格式：${file.type || '(未知)'}（仅支持 PNG / JPEG / WebP / BMP）`);
                continue;
            }
            if (file.size > IMAGE_MAX_BYTES) {
                useApp.getState().failRun(`图片 ${(file.size / 1024 / 1024).toFixed(1)} MB 超过 15 MB 上限`);
                continue;
            }
            const reader = new FileReader();
            reader.onload = () => {
                useApp.getState().addImage({ mime: file.type, dataUrl: String(reader.result), name: file.name });
            };
            reader.readAsDataURL(file);
        }
    }, []);
    /**
     * v1.1.16：解析图片的读取。
     * 与题目图片**同一套校验**（格式/大小），但存到另一处 —— 两者不能互相覆盖。
     */
    const addReferenceFiles = useCallback((files) => {
        if (!files)
            return;
        for (const file of Array.from(files)) {
            if (!ALLOWED_MIME.includes(file.type)) {
                useApp.getState().failRun(`不支持的图片格式：${file.type || '(未知)'}（仅支持 PNG / JPEG / WebP / BMP）`);
                continue;
            }
            if (file.size > IMAGE_MAX_BYTES) {
                useApp.getState().failRun(`图片 ${(file.size / 1024 / 1024).toFixed(1)} MB 超过 15 MB 上限`);
                continue;
            }
            const reader = new FileReader();
            reader.onload = () => {
                useApp.getState().addReferenceImage({ mime: file.type, dataUrl: String(reader.result), name: file.name });
            };
            reader.readAsDataURL(file);
        }
    }, []);
    const steps = useMemo(() => parseRowTable(st.run.stageText.breakdown ?? ''), [st.run.stageText.breakdown]);
    /**
     * ⚠ 第 8 期修掉的 bug（用户实测）：**进页面就自动填入一道演示题**。
     *
     * 这里原本有一段 `useEffect`：`if (!st.problemText) setProblemText('水平传送带…')`，
     * 理由是"避免用户面对空白无从下手"。但实际上它做了两件坏事：
     *   ① 用户以为那是**自己的题**（或以为上一步没清空），点"开始解题"直接跑了别人的题；
     *   ② 想输入新题时得先手动全选删除，纯属添乱。
     * 空题面自带的 `<textarea placeholder="例：图中有倾角 30° 的斜面…">` 已经足够引导，
     * 想跑演示题的人走"演示"入口（下面那排 DEMO_QUESTION_LIST 按钮）——那是**显式**选择，不是偷偷填。
     */
    const running = st.run.running;
    const skipped = selectIsSkipped(st);
    const filledStageNotes = Object.entries(st.stageNotes).filter(([, v]) => v?.trim());
    const filledStageLabels = filledStageNotes.map(([k]) => STAGE_NOTE_META.find((s) => s.key === k)?.label ?? k);
    return (_jsxs("div", { className: "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]", children: [_jsx(OpenLogNotice, {}), _jsx("section", { className: "space-y-4", children: _jsxs("div", { className: "rounded-lg border border-slate-200 bg-white p-5 shadow-sm", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h2", { className: "text-base font-medium text-slate-900", children: "\u9898\u76EE\u8F93\u5165" }), _jsx("button", { type: "button", onClick: () => setConnOpen(true), className: "rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50", title: "\u8FDE\u63A5\u8BBE\u7F6E\uFF08\u6A21\u578B\u5730\u5740\u4E0E Key\uFF09", "aria-label": "\u8FDE\u63A5\u8BBE\u7F6E", "data-od-id": "open-connection", children: "\u2699 \u8FDE\u63A5\u8BBE\u7F6E" })] }), _jsx("label", { className: "mt-3 block text-sm font-medium text-slate-700", htmlFor: "problem", children: "\u9898\u9762\u6587\u5B57" }), _jsx("textarea", { id: "problem", className: "mt-1 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500", rows: 7, value: st.problemText, onChange: (e) => st.setProblemText(e.target.value), placeholder: "\u628A\u9898\u76EE\u7C98\u8D34\u5230\u8FD9\u91CC\uFF08\u652F\u6301 LaTeX\uFF1A$v_0$\u3001$\\frac{1}{2}mv^2$\uFF09" }), _jsxs("div", { className: "mt-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm font-medium text-slate-700", children: "\u9898\u76EE\u56FE\u7247" }), _jsx("span", { className: "text-xs text-slate-500", children: "PNG / JPEG / WebP / BMP \u00B7 \u226415 MB" })] }), _jsxs("div", { className: `mt-2 rounded-md border border-dashed p-3 text-sm ${visionAvailable ? 'border-slate-300 bg-slate-50' : 'border-amber-300 bg-amber-50'}`, onDragOver: (e) => {
                                        if (visionAvailable)
                                            e.preventDefault();
                                    }, onDrop: (e) => {
                                        if (!visionAvailable)
                                            return;
                                        e.preventDefault();
                                        addFiles(e.dataTransfer.files);
                                    }, children: [visionAvailable ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700", onClick: () => fileRef.current?.click(), children: "\u9009\u62E9\u56FE\u7247" }), _jsx("span", { className: "ml-2 text-xs text-slate-600", children: "\u4E5F\u53EF\u4EE5\u628A\u56FE\u7247\u62D6\u5230\u8FD9\u91CC" })] })) : (_jsxs("div", { children: [_jsx("p", { className: "font-medium text-amber-900", children: "\u56FE\u7247\u5165\u53E3\u5DF2\u7981\u7528" }), _jsx("p", { className: "mt-1 text-xs text-amber-800", children: visionReason }), _jsx("p", { className: "mt-1 text-xs text-amber-800", children: "\u53EF\u4EE5\u6539\u7528\u4E0B\u9762\u7684\u300C\u8865\u5145\u4FE1\u606F\uFF08\u6309\u9636\u6BB5\uFF09\u300D\uFF0C\u628A\u56FE\u4E2D\u7684\u5173\u952E\u51E0\u4F55\u5173\u7CFB\u5199\u6E05\u695A\u3002" })] })), _jsx("input", { ref: fileRef, type: "file", accept: ALLOWED_MIME.join(','), multiple: true, className: "hidden", disabled: !visionAvailable, onChange: (e) => addFiles(e.target.files) })] }), st.images.length > 0 && (_jsx("ul", { className: "mt-2 flex flex-wrap gap-2", children: st.images.map((img, i) => (_jsxs("li", { className: "relative", children: [_jsx("img", { src: img.dataUrl, alt: img.name ?? `题目图片 ${i + 1}`, className: "h-20 w-20 rounded border object-cover" }), _jsx("button", { type: "button", "aria-label": `移除图片 ${i + 1}`, className: "absolute -right-1 -top-1 rounded-full bg-slate-800 px-1.5 text-xs text-white", onClick: () => st.removeImage(i), children: "\u00D7" })] }, `${img.name ?? 'img'}-${i}`))) }))] }), _jsxs("div", { className: "mt-4", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-slate-700", children: "\u8865\u5145\u4FE1\u606F\uFF08\u6309\u9636\u6BB5\uFF09" }), _jsx("p", { className: "mt-1 text-xs text-slate-500", children: "\u53EF\u4EE5\u53EA\u7ED9\u8BFB\u9898\u3001\u53EA\u7ED9\u753B\u56FE\uFF0C\u6216\u5404\u6BB5\u5199\u4E0D\u540C\u5185\u5BB9\uFF1B\u7A7A\u7740 = \u4E0D\u6CE8\u5165\u3002" })] }), _jsxs("button", { type: "button", className: filledStageNotes.length
                                                ? 'rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100'
                                                : 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50', onClick: () => setNotesOpen(true), children: ["\u8865\u5145\u4FE1\u606F\uFF08\u6309\u9636\u6BB5\uFF09", filledStageNotes.length > 0 ? ` · 已填 ${filledStageNotes.length} 段` : ''] })] }), filledStageLabels.length > 0 && (_jsxs("p", { className: "mt-2 text-xs text-slate-500", children: ["\u5DF2\u586B\uFF1A", filledStageLabels.join(' / ')] }))] }), _jsx(StageNotesDialog, { open: notesOpen, value: st.stageNotes, legacyDescription: st.description, onClose: () => setNotesOpen(false), onSave: (notes) => {
                                st.setStageNotes(notes);
                                /* 旧版单框内容已经迁移进 stageNotes；清掉旧字段，避免重复注入 */
                                if (st.description)
                                    st.setDescription('');
                            } }), _jsxs("div", { className: "mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3", children: [_jsx("label", { className: "block text-sm font-medium text-slate-700", htmlFor: "reference", children: "\u53C2\u8003\u7B54\u6848 / \u89E3\u6790\uFF08\u53EF\u9009\uFF09" }), _jsxs("p", { className: "mt-1 text-xs text-slate-500", children: ["\u586B\u4E86\u5B83\uFF0C\u6A21\u578B\u5C31", _jsx("strong", { children: "\u4E0D\u518D\u81EA\u5DF1\u89E3\u9898" }), "\uFF0C\u53EA\u6309\u8FD9\u4EFD\u89E3\u6790\u6574\u7406\u8FC7\u7A0B\u4E0E\u7B54\u6848\u3002\u53EF\u4EE5\u7528\u6587\u5B57\uFF0C\u4E5F\u53EF\u4EE5\u8D34\u89E3\u6790\u56FE\u7247\u3002"] }), _jsx("textarea", { id: "reference", rows: 4, className: "mt-2 w-full rounded-md border border-slate-300 p-2 text-sm", value: st.referenceText, onChange: (e) => st.setReferenceText(e.target.value), placeholder: "\u4F8B\uFF1A(1) W_F = \u221210 J\uFF1B(2) m_C = 3 kg\uFF0C\u03BC = 0.5\uFF1B(3) \u7EF3\u5728 x = \u22120.5 m \u5904\u677E\u5F1B\uFF0C\u6700\u5DE6\u7AEF x_min \u2248 \u22121.71 m" }), _jsxs("div", { className: "mt-2 flex flex-wrap items-center gap-2", children: [_jsx("button", { type: "button", className: "rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300", disabled: !visionAvailable, onClick: () => refFileRef.current?.click(), children: "\u9009\u62E9\u89E3\u6790\u56FE\u7247" }), _jsx("span", { className: "text-xs text-slate-500", children: visionAvailable ? '支持 PNG / JPEG / WebP / BMP，单张 ≤ 15 MB；解析图片只用于“解题”这一步' : visionReason }), _jsx("input", { ref: refFileRef, type: "file", accept: ALLOWED_MIME.join(','), multiple: true, className: "hidden", disabled: !visionAvailable, onChange: (e) => addReferenceFiles(e.target.files) })] }), st.referenceImages.length > 0 && (_jsx("ul", { className: "mt-2 flex flex-wrap gap-2", children: st.referenceImages.map((img, i) => (_jsxs("li", { className: "relative", children: [_jsx("img", { src: img.dataUrl, alt: img.name ?? `解析图片 ${i + 1}`, className: "h-20 w-20 rounded border object-cover" }), _jsx("button", { type: "button", "aria-label": `移除解析图片 ${i + 1}`, className: "absolute -right-1 -top-1 rounded-full bg-slate-800 px-1.5 text-xs text-white", onClick: () => st.removeReferenceImage(i), children: "\u00D7" })] }, `ref-${img.name ?? 'img'}-${i}`))) }))] }), !__OD_RELEASE__ && (_jsx("div", { className: "mt-4 rounded-md border border-slate-200 bg-slate-50 p-3", children: _jsxs("label", { className: "flex cursor-pointer items-start gap-2 text-xs text-slate-700", children: [_jsx("input", { type: "checkbox", className: "mt-0.5", checked: st.devMode, onChange: (e) => st.setDevMode(e.target.checked), "data-od-id": "dev-mode-toggle" }), _jsxs("span", { children: [_jsx("span", { className: "font-medium", children: "\u5F00\u53D1\u6A21\u5F0F\uFF08\u4E0D\u62E6\u622A\u6821\u9A8C\uFF09" }), "\uFF1AC1\u2013C9 \u7167\u5E38\u6821\u9A8C\u3001\u7167\u5E38\u5199\u62A5\u544A\uFF0C\u4F46\u4E0D\u518D\u963B\u6B62\u52A8\u753B\u751F\u6210\uFF0C\u4EE3\u7801\u76F4\u63A5\u8FDB\u52A8\u753B\u9875\u64AD\u653E\u3002 \u88AB\u653E\u884C\u7684\u68C0\u67E5\u4F1A\u5728\u62A5\u544A\u4E0E\u5BFC\u51FA\u6587\u4EF6\u91CC\u6807\u660E \u2014\u2014 \u522B\u7528\u5B83\u51FA\u6B63\u5F0F\u4EA7\u7269\u3002"] })] }) })), _jsxs("div", { className: "mt-4 flex items-center gap-3", children: [_jsx("button", { type: "button", 
                                    /**
                                     * ⚠ 门槛是"**题面文字 或 至少一张图**"，不是"题面必须非空"。
                                     *
                                     * 曾经写成 `!st.problemText.trim()`：于是**纯图片题根本点不了**（用户实测反馈），
                                     * 只能在文字框里随便敲两个字才能提交 —— 等于逼用户写假数据。
                                     * 纯图片题是这个产品的正当入口（拍照搜题），不该被这条校验挡住。
                                     */
                                    disabled: running || (!st.problemText.trim() && st.images.length === 0), className: "rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300", onClick: onStartClick, children: running ? '生成中…' : '开始生成动画' }), running && (_jsx("button", { type: "button", className: "text-sm text-slate-600 underline hover:text-slate-900", onClick: cancel, children: "\u53D6\u6D88" }))] }), !running && !st.problemText.trim() && st.images.length === 0 && (_jsx("p", { className: "mt-2 text-xs text-slate-500", children: "\u81F3\u5C11\u7ED9\u4E00\u6837\uFF1A\u9898\u9762\u6587\u5B57\uFF0C\u6216\u4E00\u5F20\u9898\u76EE\u56FE\u7247\uFF08\u7EAF\u56FE\u7247\u9898\u53EF\u4EE5\u76F4\u63A5\u70B9\u4E0A\u9762\u7684\u6309\u94AE\uFF09\u3002" })), runSource === 'server' ? (_jsxs("p", { className: "mt-3 rounded bg-emerald-50 p-2 text-xs text-emerald-900", children: [_jsx("strong", { children: "\u5DF2\u63A5\u672C\u673A\u6A21\u578B" }), "\uFF1A\u70B9\u300C\u5F00\u59CB\u751F\u6210\u52A8\u753B\u300D\u4F1A**\u771F\u5B9E\u8C03\u7528\u4F60\u914D\u7F6E\u7684\u6A21\u578B**\uFF08\u89E3\u9898 \u2192 \u5206\u6B65 \u2192 \u52A8\u753B\u4EE3\u7801\uFF09\uFF0C \u5E76\u5728\u670D\u52A1\u7AEF\u8DD1 C1\u2013C9 \u6821\u9A8C\u3002", _jsx("strong", { children: "\u5224\u5B9A\u6765\u81EA\u771F\u5B9E\u6821\u9A8C\u5185\u6838" }), "\uFF08\u4E0D\u518D\u662F\"\u672A\u6821\u9A8C\"\uFF09\u3002 \u60F3\u770B\u6F14\u793A\uFF08\u4E0D\u82B1 token\uFF09\uFF1A\u5728\u300C\u2699 \u8FDE\u63A5\u8BBE\u7F6E\u300D\u91CC\u5220\u6389 Key \u5373\u53EF\u9000\u56DE\u6F14\u793A\u6E90\u3002"] })) : (_jsxs("p", { className: "mt-3 rounded bg-amber-50 p-2 text-xs text-amber-900", children: [_jsx("strong", { children: "\u5F53\u524D\u662F\u300C\u6F14\u793A\u6E90\u300D" }), "\uFF1A\u4E0D\u8C03\u7528\u6A21\u578B\uFF0C\u7528\u672C\u5730\u771F\u9898\uFF08", DEMO_QUESTION_LIST.map((q) => q.title).join('、'), "\uFF09\u8D70\u5B8C\u6574\u524D\u7AEF\u6D41\u7A0B\uFF0C \u5224\u5B9A\u663E\u793A\u4E3A\u300C\u672A\u6821\u9A8C\u300D\u3002", _jsx("strong", { children: "\u60F3\u771F\u6B63\u89E3\u9898" }), "\uFF1A\u70B9\u53F3\u4E0A\u89D2\u300C\u2699 \u8FDE\u63A5\u8BBE\u7F6E\u300D\u586B\u63A5\u53E3\u5730\u5740\u3001\u6A21\u578B ID \u4E0E Key\uFF0C \u4FDD\u5B58\u540E\u8FD9\u91CC\u4F1A\u53D8\u6210\u300C\u5DF2\u63A5\u672C\u673A\u6A21\u578B\u300D\u3002"] }))] }) }), _jsxs("section", { className: "space-y-4", children: [_jsx(FishStage, { stage: (st.run.stages.length ? st.run.stages : [...STAGE_CHAIN]).find((s) => (st.run.stageStatus[s] ?? 'pending') === 'running'), running: st.run.running, hasError: Boolean(st.run.error), finished: Boolean(st.programSlots) && !st.run.running && st.run.verdict !== 'fail', failed: !st.run.running && st.run.verdict === 'fail' }), st.run.error && (_jsxs("div", { className: "rounded-lg border border-red-300 bg-red-50 p-4", children: [_jsx("p", { className: "font-medium text-red-900", children: st.run.error.kind === 'auth'
                                    ? '模型鉴权失败'
                                    : st.run.error.kind === 'network'
                                        ? '无法连接模型端点'
                                        : '出错了' }), _jsx("p", { className: "mt-1 text-sm text-red-800", children: st.run.error.message }), st.run.error.hint && _jsxs("p", { className: "mt-1 text-xs text-red-700", children: ["\u2192 ", st.run.error.hint] })] })), st.run.banner && _jsx(WarningBanner, { banner: st.run.banner }), _jsxs("details", { className: "rounded-lg border border-slate-200 bg-white shadow-sm", children: [_jsx("summary", { className: "cursor-pointer select-none px-5 py-3 text-sm font-medium text-slate-700", children: "\u89E3\u9898\u8FC7\u7A0B\uFF08\u70B9\u5F00\u67E5\u770B\uFF09" }), _jsx("div", { className: "space-y-4 border-t border-slate-100 p-5 pt-4", children: (st.run.stageText.solve || st.run.stageText.breakdown || st.run.stageText.analysis) && (_jsxs("div", { className: "rounded-lg border border-slate-200 bg-white p-5 shadow-sm", children: [_jsx("h2", { className: "text-base font-medium text-slate-900", children: "\u89E3\u9898\u8FC7\u7A0B" }), st.run.promptHash && (_jsxs("p", { className: "mt-1 font-mono text-[11px] text-slate-400", children: ["promptHash = ", st.run.promptHash] })), _jsxs("div", { className: "mt-3 space-y-4 text-sm text-slate-800", children: [_jsxs("div", { children: [_jsx("h3", { className: "mb-1 text-sm font-semibold text-slate-500", children: "\u89E3\u9898" }), _jsx(Markdown, { text: st.run.stageText.solve ?? '' })] }), steps.length > 0 && (_jsxs("div", { children: [_jsx("h3", { className: "mb-1 text-sm font-semibold text-slate-500", children: "\u5206\u6B65\u89E3\u6790" }), _jsx("ol", { className: "space-y-2", children: steps.map((s, i) => (_jsxs("li", { className: "rounded border border-slate-200 p-3", children: [_jsx("p", { className: "font-medium text-slate-900", children: s.title ?? `第 ${i + 1} 步` }), _jsx("div", { className: "mt-1 text-slate-700", children: _jsx(MathBlock, { tex: s.tex ?? '' }) }), _jsxs("p", { className: "mt-1 font-mono text-xs text-slate-500", children: ["t \u2208 [", s.t0 ?? '?', ", ", s.t1 ?? '?', "] s"] })] }, i))) })] }))] })] })) })] }), _jsxs("details", { className: "rounded-lg border border-slate-200 bg-white shadow-sm", children: [_jsx("summary", { className: "cursor-pointer select-none px-5 py-3 text-sm font-medium text-slate-700", children: "\u5224\u636E \u00B7 \u77E5\u8BC6\u5361\u4F9D\u636E \u00B7 \u81EA\u6108\u8FC7\u7A0B\uFF08\u70B9\u5F00\u67E5\u770B\uFF09" }), _jsxs("div", { className: "space-y-4 border-t border-slate-100 p-5 pt-4", children: [st.run.verdict && _jsx(VerdictPanel, { run: st.run, skipped: skipped }), st.run.knowledgecard && _jsx(KnowledgecardPanel, { run: st.run }), st.run.repairRounds.length > 0 && _jsx(RepairPanel, { run: st.run })] })] }), (st.referenceText.trim() || st.referenceImages.length > 0) && (_jsxs("div", { className: "rounded-lg border border-sky-200 bg-sky-50 p-4", children: [_jsxs("p", { className: "text-sm font-semibold text-sky-900", children: ["\u672C\u6B21\u6309\u4F60\u63D0\u4F9B\u7684\u89E3\u6790\u751F\u6210", _jsx("span", { className: "ml-2 rounded bg-sky-200 px-1.5 py-0.5 text-[11px] font-normal text-sky-900", children: "\u6765\u6E90\uFF1A\u53C2\u8003\u7B54\u6848" })] }), _jsxs("div", { className: "mt-2 grid gap-3 md:grid-cols-2", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-medium text-sky-800", children: "\u4F60\u63D0\u4F9B\u7684\u89E3\u6790" }), _jsx("pre", { className: "mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-[11px] leading-relaxed text-slate-700", children: st.referenceText.trim() || '（只提供了解析图片，没有文字）' })] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-medium text-sky-800", children: "\u5206\u6B65\u8BB2\u89E3" }), _jsx("pre", { className: "mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-[11px] leading-relaxed text-slate-700", children: st.run.stageText.breakdown?.trim() || '（还没有讲解）' })] })] }), st.run.stageText.breakdown?.includes('解析未提供') && (_jsx("p", { className: "mt-2 rounded bg-amber-100 p-2 text-xs text-amber-900", children: "\u6709\u89E3\u6790\u6CA1\u6709\u8986\u76D6\u5230\u7684\u91CF\uFF08\u6587\u4E2D\u6807\u4E86\u201C\u89E3\u6790\u672A\u63D0\u4F9B\u201D\uFF09\u2014\u2014 \u8FD9\u4E9B\u6570\u9700\u8981\u4F60\u4EBA\u5DE5\u786E\u8BA4\uFF0C\u6A21\u578B\u6CA1\u6709\u88AB\u5141\u8BB8\u81EA\u5DF1\u8865\u3002" })), _jsxs("p", { className: "mt-2 text-[11px] text-sky-700", children: ["\u5DE6\u8FB9\u662F\u4F60\u7684\u539F\u6587\uFF0C\u53F3\u8FB9\u662F\u6A21\u578B\u62BD\u53D6\u7684\u7ED3\u679C\uFF1B\u4E24\u8FB9\u4E0D\u4E00\u81F4\u65F6", _jsx("strong", { children: "\u4EE5\u4F60\u7684\u89E3\u6790\u4E3A\u51C6" }), "\u3002"] })] })), st.programSlots && !st.run.running && (_jsxs("div", { className: "rounded-lg border border-green-200 bg-green-50 p-4", children: [_jsx("p", { className: "text-sm text-green-900", children: "\u52A8\u753B\u5DF2\u5C31\u7EEA\u3002" }), _jsx("button", { type: "button", className: "mt-2 rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800", onClick: onOpenAnimation, children: "\u6253\u5F00\u52A8\u753B\u9875 \u2192" })] }))] }), clearWarnOpen && (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4", role: "presentation", onClick: (e) => {
                    if (e.target === e.currentTarget)
                        setClearWarnOpen(false);
                }, children: _jsxs("div", { role: "dialog", "aria-modal": "true", "aria-labelledby": "clear-animation-title", className: "w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl", children: [_jsx("h2", { id: "clear-animation-title", className: "text-base font-semibold text-slate-900", children: "\u5F00\u59CB\u65B0\u9898\u4F1A\u6E05\u7A7A\u5F53\u524D\u52A8\u753B" }), _jsx("p", { className: "mt-2 text-sm leading-relaxed text-slate-600", children: "\u5F53\u524D\u5DF2\u7ECF\u6709\u4E00\u4EFD\u751F\u6210\u597D\u7684\u52A8\u753B\u3002\u5F00\u59CB\u65B0\u9898\u4F1A\u628A\u5B83\u4ECE\u672C\u9875\u6E05\u6389\uFF08\u4E0D\u4F1A\u5220\u9664\u5DF2\u5BFC\u51FA\u7684\u6587\u4EF6\uFF09\u3002 \u5982\u679C\u4F60\u8FD8\u8981\u770B\u5B83\uFF0C\u8BF7\u5148\u70B9\u201C\u53D6\u6D88\u201D\u3002" }), _jsxs("label", { className: "mt-4 flex cursor-pointer items-center gap-2 text-xs text-slate-600", children: [_jsx("input", { type: "checkbox", checked: dontAskAgain, onChange: (e) => setDontAskAgain(e.target.checked), "data-od-id": "clear-animation-dont-ask" }), "\u4EE5\u540E\u4E0D\u518D\u63D0\u793A\uFF08\u9ED8\u8BA4\u52FE\u9009\uFF1B\u53D6\u6D88\u52FE\u9009\u5219\u6BCF\u6B21\u5F00\u59CB\u65B0\u9898\u90FD\u63D0\u9192\uFF09"] }), _jsxs("div", { className: "mt-5 flex justify-end gap-2", children: [_jsx("button", { type: "button", autoFocus: true, className: "rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50", onClick: () => setClearWarnOpen(false), children: "\u53D6\u6D88" }), _jsx("button", { type: "button", className: "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700", onClick: confirmClearAndStart, children: "\u7EE7\u7EED\u5E76\u6E05\u7A7A" })] })] }) })), _jsx(ConnectionDialog, { open: connOpen, onClose: () => setConnOpen(false), onSaved: refreshVision })] }));
}
/* ────────────────────────────── 子组件 ────────────────────────────── */
/** 命中方式的中文标签（与 `core/knowledgecard/engine.mjs` 的 `via` 取值逐一对应） */
const WB_VIA_LABEL = {
    key: '主键命中',
    secondary: '次级键命中',
    constant: '常驻',
    recursive: '递归唤醒',
};
const WB_SLOT_LABEL = { scene_code: '动画' };
/**
 * 知识卡依据面板（§15 解题页 / §9.2 第 6 步）。
 *
 * 老师要看懂三件事：**为什么引用了这条知识**（命中方式）、**它进了哪个槽位**、
 * **有没有因为预算被丢掉**。所以"空槽"与"被截断"必须分开显示 ——
 * 否则"动画槽空"与"该槽卡片全被截断"在界面上长得一模一样（§9.2 的"重要边界"）。
 */
function KnowledgecardPanel({ run }) {
    const wb = run.knowledgecard;
    if (!wb)
        return null;
    if (wb.libraryCount === 0) {
        return (_jsxs("div", { "data-od-region": "knowledgecard-evidence", className: "rounded-lg border border-slate-200 bg-white p-4", children: [_jsx("h2", { className: "text-base font-medium text-slate-900", children: "\u77E5\u8BC6\u5361\u4F9D\u636E" }), _jsx("p", { className: "mt-1 text-sm text-slate-600", children: "\u672C\u6B21\u6CA1\u6709\u6302\u8F7D\u4EFB\u4F55\u5361\u7247\uFF08\u77E5\u8BC6\u5361\u5E93\u4E3A\u7A7A\uFF09\u3002" })] }));
    }
    return (_jsxs("div", { "data-od-region": "knowledgecard-evidence", className: "rounded-lg border border-slate-200 bg-white p-4", children: [_jsxs("div", { className: "flex items-baseline justify-between", children: [_jsx("h2", { className: "text-base font-medium text-slate-900", children: "\u77E5\u8BC6\u5361\u4F9D\u636E" }), _jsxs("span", { className: "text-xs text-slate-500", children: ["\u5E93 ", wb.libraryCount, " \u6761 \u00B7 \u547D\u4E2D ", wb.matched, " \u6761 \u00B7 \u52A8\u753B\u69FD ", wb.injectedBySlot.scene_code ?? 0, " \u6761"] })] }), wb.matched === 0 ? (_jsxs("p", { className: "mt-2 text-sm text-slate-600", children: ["\u672C\u6B21\u6CA1\u6709\u4EFB\u4F55\u5361\u7247\u547D\u4E2D\u3002\u8FD9", _jsx("strong", { children: "\u4E0D\u662F\u9519\u8BEF" }), "\uFF08\u7A7A\u69FD\u662F\u6B63\u5E38\u60C5\u51B5\uFF0C\u9759\u9ED8\u8DF3\u8FC7\uFF09\uFF0C \u4F46\u8BF4\u660E\u8FD9\u9053\u9898\u6CA1\u6709\u53EF\u7528\u7684\u89C4\u8303\u652F\u6491\u3002"] })) : (_jsx("ul", { className: "mt-2 divide-y divide-slate-100", children: wb.entries.map((p) => (_jsxs("li", { className: "py-2", children: [_jsxs("div", { className: "flex flex-wrap items-baseline gap-2", children: [_jsx("span", { className: "text-sm font-medium text-slate-900", children: p.title }), _jsxs("span", { className: "rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600", children: [WB_VIA_LABEL[p.via] ?? p.via, p.from ? ` ← ${p.from}` : ''] }), _jsxs("span", { className: "text-[11px] text-slate-500", children: ["\u6CE8\u5165\uFF1A", p.injectedSlots.filter((s) => s === 'scene_code').map((s) => WB_SLOT_LABEL[s] ?? s).join(' / ') || '（未挂槽位）', p.unmounted ? ' · 未挂槽位' : '', p.truncated ? ' · 被预算截断' : ''] }), _jsx("code", { className: "text-[11px] text-slate-400", children: p.entry_id })] }), _jsx("p", { className: "mt-0.5 text-[11px] text-slate-500", children: Object.entries(p.charsBySlot)
                                .filter(([slot]) => slot === 'scene_code')
                                .map(([slot, n]) => `${WB_SLOT_LABEL[slot] ?? slot} ${n} 字符`)
                                .join(' · ') || '未注入任何槽位' })] }, p.entry_id))) })), _jsxs("div", { className: "mt-2 border-t border-slate-100 pt-2 text-[11px]", children: [_jsxs("p", { className: "text-slate-600", children: ["\u7A7A\u69FD\uFF08\u9759\u9ED8\u8DF3\u8FC7\uFF0C\u5408\u6CD5\uFF09\uFF1A", wb.emptySlots.length ? wb.emptySlots.map((s) => WB_SLOT_LABEL[s] ?? s).join(' / ') : '无'] }), _jsxs("p", { className: "mt-0.5 text-amber-800", children: ["\u56E0\u9884\u7B97\u622A\u65AD\uFF08\u5FC5\u987B\u544A\u8B66\uFF09\uFF1A", wb.truncatedSlots.length
                                ? wb.truncatedSlots.map((t) => `${WB_SLOT_LABEL[t.slot] ?? t.slot} 丢弃 ${t.dropped} 条`).join(' / ')
                                : '无'] }), wb.warnings.map((w) => (_jsxs("p", { className: "mt-0.5 text-amber-800", children: ["\u26A0 ", w.message] }, `${w.code}-${w.entryId ?? ''}-${w.slot ?? ''}`))), _jsxs("p", { className: "mt-1 text-slate-400", children: ["\u77E5\u8BC6\u5361\u96C6\u5408\u54C8\u5E0C ", wb.hash.slice(0, 16), "\u2026"] })] })] }));
}
/**
 * 告警横幅（§21.2 第 8 条 / §14.2 的 B4）。
 *
 * 刻意做成**醒目的琥珀色大块 + 不可折叠**：它出现就意味着"你现在看到的结果没过校验"。
 * 文案由后端给（`banner.message` 里含失败检查号与轮数），前端不自己编。
 */
function WarningBanner({ banner }) {
    return (_jsx("div", { role: "alert", className: "rounded-lg border-2 border-amber-400 bg-amber-50 p-4", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("span", { "aria-hidden": true, className: "mt-0.5 text-lg leading-none", children: "\u26A0" }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "font-semibold text-amber-900", children: banner.title }), _jsx("p", { className: "mt-1 text-sm text-amber-900", children: banner.message }), _jsxs("p", { className: "mt-2 flex flex-wrap gap-2 text-xs", children: [banner.failedChecks.map((id) => (_jsxs("span", { className: "rounded border border-amber-400 bg-white px-1.5 py-0.5 font-mono text-amber-900", children: [id, " \u672A\u901A\u8FC7"] }, id))), _jsxs("span", { className: "rounded border border-amber-300 bg-white px-1.5 py-0.5 text-amber-800", children: ["\u5DF2\u81EA\u52A8\u4FEE\u590D ", banner.rounds, " \u8F6E"] }), _jsx("span", { className: "rounded border border-amber-300 bg-white px-1.5 py-0.5 text-amber-800", children: banner.playable ? '仍可播放（8 槽位齐全）' : `缺槽位：${banner.missing.join(' / ')}` })] })] })] }) }));
}
/**
 * 自愈过程面板（B6）。
 *
 * 显示每一轮：**为什么修**（触发的检查号 + 诊断，带证据强度）、**改了什么**（updated）、
 * **没动什么**（unchanged 的数量）。第三条是 §14.5 风险表第 1 条（"修复把对的槽位改坏"）
 * 在 UI 上的落点 —— 让用户看得见"其余槽位一个字节都没动"。
 */
function RepairPanel({ run }) {
    return (_jsxs("div", { className: "rounded-lg border border-violet-200 bg-violet-50 p-4", children: [_jsxs("div", { className: "flex items-baseline justify-between", children: [_jsx("h2", { className: "text-base font-medium text-slate-900", children: "\u81EA\u6108\u4FEE\u590D\u8FC7\u7A0B" }), _jsxs("span", { className: "text-xs text-slate-600", children: [run.repairRounds.length, " \u8F6E \u00B7 ", run.repairConverged ? '已收敛' : '未收敛（上限 3 轮）'] })] }), _jsx("p", { className: "mt-1 text-xs text-slate-700", children: "\u53EA\u91CD\u53D1**\u672A\u901A\u8FC7\u6821\u9A8C\u7684\u69FD\u4F4D**\uFF1B\u5176\u4F59\u69FD\u4F4D\u9010\u5B57\u8282\u4FDD\u7559\u3002" }), _jsx("ol", { className: "mt-3 space-y-3", children: run.repairRounds.map((r) => (_jsxs("li", { className: "rounded border border-violet-200 bg-white p-3", children: [_jsxs("div", { className: "flex flex-wrap items-baseline gap-2 text-sm", children: [_jsxs("span", { className: "font-medium text-slate-900", children: ["\u7B2C ", r.round, " \u8F6E"] }), _jsxs("span", { className: "text-xs text-slate-500", children: [r.ms, " ms"] }), _jsxs("span", { className: `text-xs ${r.verdict === 'pass' ? 'text-green-700' : 'text-amber-700'}`, children: ["\u4FEE\u590D\u540E\u5224\u5B9A\uFF1A", r.verdict] })] }), _jsxs("p", { className: "mt-1 text-xs text-slate-700", children: ["\u89E6\u53D1\uFF1A", r.triggeringChecks.length ? r.triggeringChecks.map((c) => _jsx("code", { className: "mr-1 font-mono", children: c }, c)) : '—'] }), _jsxs("p", { className: "mt-1 text-xs text-slate-700", children: ["\u91CD\u53D1\u4E86\uFF1A", r.requested.map((s) => _jsx("code", { className: "mr-1 font-mono", children: s }, s)), r.updated.length !== r.requested.length && (_jsxs(_Fragment, { children: [" \u00B7 \u5B9E\u9645\u6539\u5199\uFF1A", r.updated.map((s) => _jsx("code", { className: "mr-1 font-mono", children: s }, s))] }))] }), _jsxs("p", { className: "mt-1 text-xs text-slate-500", children: ["\u672A\u6539\u52A8 ", r.unchanged.length, " \u4E2A\u69FD\u4F4D\uFF08\u9010\u5B57\u8282\u4FDD\u7559\uFF09"] }), r.diagnostics.length > 0 && (_jsx("ul", { className: "mt-2 space-y-1 text-xs", children: r.diagnostics.flatMap((d) => (d.diagnostics.length ? d.diagnostics : [{ check: d.check, message: d.message, precision: null, slot: undefined, line: null }]).map((x, i) => (_jsxs("li", { className: "flex flex-wrap items-baseline gap-1", children: [_jsx("span", { className: "font-mono text-slate-500", children: x.check }), x.slot && _jsx("span", { className: "font-mono text-slate-700", children: x.slot }), x.line ? _jsxs("span", { className: "text-slate-500", children: ["\u7B2C ", x.line, " \u884C"] }) : null, _jsx("span", { className: "rounded border border-slate-300 px-1 text-[10px] text-slate-600", children: precisionLabel(x.precision) }), _jsx("span", { className: "text-slate-700", children: x.message })] }, `${d.check}-${i}`)))) }))] }, r.round))) })] }));
}
/** 第 9 期 v1.1.5：每个阶段一句话，**只在跑的时候出现**（用户 2026-10-19 定的文案） */
const STAGE_SAY = {
    read_problem: '小肥鱼正在看题…',
    solve: '小肥鱼正在解题…',
    breakdown: '小肥鱼正在努力思考…',
    analysis: '小肥鱼正在努力思考…',
    scene_code: '小肥鱼正在努力画画…',
    dry_run: '小肥鱼正在检查…',
    repair: '小肥鱼正在完善…',
    couple: '小肥鱼正在做最后对齐…',
};
/** 阶段 → 漫画分镜（图来自「表情包」3×3 拼图，已裁成 512×512 webp） */
const STAGE_FISH = {
    read_problem: 'read',
    solve: 'solve',
    breakdown: 'think',
    analysis: 'think',
    scene_code: 'draw',
    dry_run: 'check',
    repair: 'repair',
    couple: 'done',
};
/**
 * 表情包主视觉：**只有小肥鱼 + 大标题**（v1.1.18 用户裁决）。
 *
 * 为什么删掉阶段进度条：8 个阶段的小方块把注意力全抢走了，老师真正想看的是
 * "小肥鱼现在在干什么"。所以这一版把阶段条整个拿掉，只留：
 *   · 按阶段切换的小肥鱼动作图；
 *   · 一行大号渐变标题（`aria-live`，阶段一变就读出来）。
 * 过程/判据/自愈仍在下方的折叠面板里，需要证据时再展开。
 */
function FishStage({ stage, running, hasError, finished, failed, }) {
    /**
     * 漫画分镜风：新图自带浅蓝背景与桌面场景，所以不再要求透明底；
     * 用白色内框 + 圆角把每格框成“分镜”。待机/错误态仍是旧透明贴纸，
     * 放在白框里也能融进去。
     */
    const name = hasError || failed ? 'error' : finished ? 'done' : stage ? STAGE_FISH[stage] : undefined;
    const say = hasError
        ? '小肥鱼卡住了…'
        : failed
            ? '小肥鱼没画成…'
            : running
                ? (stage ? STAGE_SAY[stage] : '小肥鱼正在准备…')
                : finished
                    ? '小肥鱼画好啦！'
                    : '小肥鱼在等你出题…';
    return (_jsxs("div", { "data-od-region": "fish-stage", className: "overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-b from-sky-50 via-white to-white px-5 py-6 text-center shadow-sm sm:px-6 sm:py-7", children: [_jsx("p", { role: "status", "aria-live": "polite", className: "bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-500 bg-clip-text font-sans text-3xl font-extrabold leading-tight tracking-wide text-transparent sm:text-4xl", children: say }), _jsx("div", { className: "mx-auto mt-4 w-full max-w-[440px] overflow-hidden rounded-2xl border border-white/80 bg-white shadow-inner", children: _jsx("img", { src: `/fish/${name ?? 'idle'}.webp`, alt: "", draggable: false, className: "aspect-square w-full object-cover" }) })] }));
}
function VerdictPanel({ run, skipped }) {
    const tone = skipped
        ? 'border-amber-300 bg-amber-50'
        : run.verdict === 'pass'
            ? 'border-green-300 bg-green-50'
            : run.verdict === 'fail'
                ? 'border-red-300 bg-red-50'
                : 'border-yellow-300 bg-yellow-50';
    const title = skipped
        ? '未校验（本次没有执行 C1–C9）'
        : run.verdict === 'pass'
            ? '校验通过'
            : run.verdict === 'fail'
                ? '校验未通过'
                : '校验有告警';
    return (_jsxs("div", { className: `rounded-lg border p-4 ${tone}`, children: [_jsxs("div", { className: "flex items-baseline justify-between", children: [_jsx("h2", { className: "text-base font-medium text-slate-900", children: "\u6821\u9A8C\u62A5\u544A" }), _jsxs("span", { className: "text-xs text-slate-600", children: ["\u8017\u65F6 ", run.elapsedMs, " ms"] })] }), _jsx("p", { className: "mt-1 text-sm font-medium text-slate-900", children: title }), run.verdictNote && _jsx("p", { className: "mt-1 text-xs text-slate-700", children: run.verdictNote }), run.advisory && (_jsxs("div", { className: "mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-900", "data-od-id": "advisory-banner", children: [_jsxs("p", { className: "font-medium", children: ["\u5F00\u53D1\u6A21\u5F0F\uFF1A\u672C\u6B21\u6821\u9A8C**\u6CA1\u6709\u62E6\u8DEF**", run.gatesBypassed.length ? `，被放行的检查：${run.gatesBypassed.join(' / ')}` : '（没有任何检查失败）'] }), _jsx("p", { className: "mt-0.5", children: "\u52A8\u753B\u5DF2\u7167\u5E38\u751F\u6210\uFF0C\u53EF\u4EE5\u64AD\u653E\u4E0E\u5BFC\u51FA\uFF1B\u4F46\u4EA7\u7269**\u672A\u901A\u8FC7\u786C\u5224\u636E**\uFF0C\u5BFC\u51FA\u6587\u4EF6\u4E0E\u7559\u6863\u91CC\u90FD\u4F1A\u5199\u660E\u8FD9\u4E00\u70B9\u3002 \u60F3\u56DE\u5230\"\u62E6\u4F4F\"\uFF1A\u53D6\u6D88\u52FE\u9009\u300C\u5F00\u53D1\u6A21\u5F0F\u300D\u91CD\u8DD1\u4E00\u6B21\u3002" })] })), run.checks.length > 0 && (_jsx("ul", { className: "mt-3 space-y-1 text-xs", children: run.checks.map((c) => (_jsxs("li", { className: "flex items-start gap-2", children: [_jsx("span", { className: c.status === 'pass' ? 'text-green-700' : 'text-red-700', children: c.status === 'pass' ? '✓' : '✗' }), _jsx("span", { className: "font-mono", children: c.id }), _jsx("span", { className: "text-slate-700", children: c.message }), c.blocking && _jsx("span", { className: "text-slate-400", children: "\uFF08\u786C\u62D2\uFF09" })] }, c.id))) })), run.checks.some((c) => (c.offenders?.length ?? 0) > 0) && (_jsxs("div", { className: "mt-2 rounded border border-amber-300 bg-amber-50 p-2", children: [_jsx("p", { className: "text-[11px] font-medium text-amber-900", children: "\u73B0\u573A\uFF08\u5224\u5B9A\u6293\u5230\u7684\u4E1C\u897F\uFF09" }), _jsx("ul", { className: "mt-1 space-y-0.5 text-[11px] text-amber-900", children: run.checks.flatMap((c) => (c.offenders ?? []).map((o, i) => {
                            const key = String(o.key ?? o.reason ?? o.snippet ?? '');
                            const t = typeof o.t === 'number' ? ` @ t=${o.t}s` : '';
                            const before = o.before !== undefined ? ` ${String(o.before)}` : '';
                            const after = o.after !== undefined ? ` → ${String(o.after)}` : '';
                            return (_jsxs("li", { className: "font-mono", children: [_jsx("span", { className: "mr-1 text-slate-500", children: c.id }), key, before, after, t] }, `${c.id}-off-${i}`));
                        })) })] })), run.extensions.length > 0 && (_jsxs("p", { className: "mt-2 text-xs text-slate-600", children: ["\u6269\u5C55\u68C0\u67E5\uFF1A", run.extensions.map((e) => `${e.id}=${e.status}`).join(' · ')] })), run.diagnostics.length > 0 && (_jsxs("details", { className: "mt-2", children: [_jsxs("summary", { className: "cursor-pointer text-xs text-slate-700", children: ["\u884C\u53F7\u7EA7\u8BCA\u65AD\uFF08", run.diagnostics.length, " \u6761\uFF09"] }), _jsx("pre", { className: "mt-1 max-h-48 overflow-auto rounded bg-white/70 p-2 text-[11px]", children: JSON.stringify(run.diagnostics, null, 2) })] })), _jsx(ProgramSlotsPanel, { open: run.verdict !== 'pass' }), _jsx(DevReportsPanel, {})] }));
}
/**
 * 开发模式留档（第 8 期 · 用户裁决"在本地网页中保存它认为错误的部分"）。
 *
 * 存在 localStorage：这是**开发期的本地草稿**，不进历史库、也不进正式归档 ——
 * 免得"未经验证的产物"与"验证过的产物"混在一起。
 */
function DevReportsPanel() {
    const [rows, setRows] = useState([]);
    useEffect(() => {
        setRows(listDevReports().slice(-5).reverse());
    }, []);
    if (!rows.length)
        return null;
    const download = () => {
        const json = JSON.stringify(listDevReports(), null, 2);
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `od-dev-reports-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };
    return (_jsxs("details", { className: "mt-3 rounded-lg border border-amber-300 bg-amber-50", children: [_jsxs("summary", { className: "cursor-pointer px-3 py-2 text-xs text-amber-900", children: ["\u5F00\u53D1\u6A21\u5F0F\u7559\u6863\uFF08\u6700\u8FD1 ", rows.length, " \u6B21\u653E\u884C\uFF1B\u672C\u673A\u6D4F\u89C8\u5668\u91CC\uFF0C\u5171 ", listDevReports().length, " \u6761\uFF09"] }), _jsxs("div", { className: "border-t border-amber-200 px-3 py-2", children: [_jsx("ul", { className: "space-y-0.5 text-[11px] text-amber-900", children: rows.map((r, i) => (_jsxs("li", { className: "font-mono", children: [r.at.slice(0, 19).replace('T', ' '), " \u00B7 ", r.verdict, " \u00B7 \u653E\u884C ", r.gatesBypassed.join('/') || '—'] }, `${r.at}-${i}`))) }), _jsxs("div", { className: "mt-2 flex gap-2", children: [_jsx("button", { type: "button", className: "rounded border border-amber-400 px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-100", onClick: download, children: "\u4E0B\u8F7D\u5168\u90E8 JSON" }), _jsx("button", { type: "button", className: "rounded border border-amber-400 px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-100", onClick: () => {
                                    clearDevReports();
                                    setRows([]);
                                }, children: "\u6E05\u7A7A\u7559\u6863" })] })] })] }));
}
/** 8 个槽位的只读查看器（判定失败时默认展开） */
const SLOT_ORDER = ['PROBLEM', 'STEPS', 'ANSWERS', 'VIEW', 'setup', 'stateAt', 'drawFrame', 'readouts'];
function ProgramSlotsPanel({ open }) {
    const slots = useApp((s) => s.programSlots);
    if (!slots)
        return null;
    const text = SLOT_ORDER.map((k) => `/* @slot:${k} */\n${slots[k] ?? ''}\n/* @end */`).join('\n\n');
    return (_jsxs("details", { className: "mt-3 rounded-lg border border-slate-200 bg-white", open: open, children: [_jsx("summary", { className: "cursor-pointer px-3 py-2 text-xs text-slate-700", children: "\u672C\u6B21\u751F\u6210\u7684\u7A0B\u5E8F\uFF088 \u69FD\u4F4D\uFF09\u2014\u2014 \u6392\u67E5 C1/C7 \u8FD9\u7C7B\u95EE\u9898\u8981\u5BF9\u7740\u5B83\u770B" }), _jsxs("div", { className: "border-t border-slate-100 px-3 py-2", children: [_jsxs("div", { className: "mb-2 flex items-center justify-between gap-2", children: [_jsx("p", { className: "text-[11px] text-slate-500", children: "\u4EE3\u7801\u578B\u69FD\u4F4D\u663E\u793A\u7684\u662F**\u51FD\u6570\u4F53**\uFF08\u51FD\u6570\u5934\u7531\u88C5\u914D\u5668\u63D0\u4F9B\uFF09\uFF1B\u6570\u636E\u578B\u69FD\u4F4D\u662F\u539F\u59CB\u884C\u5F0F\u8868 / JSON \u6587\u672C\u3002" }), _jsx("button", { type: "button", className: "shrink-0 rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50", onClick: () => {
                                    // 复制全部：本机页面，clipboard 可能需要用户手势 —— 上一次点击就是手势，够了
                                    void navigator.clipboard?.writeText(text);
                                }, children: "\u590D\u5236\u5168\u90E8" })] }), _jsx("div", { className: "space-y-2", children: SLOT_ORDER.map((k) => (_jsxs("div", { children: [_jsx("div", { className: "font-mono text-[11px] text-slate-500", children: `/* @slot:${k} */` }), _jsx("pre", { className: "mt-0.5 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-800", children: slots[k] || '（缺失）' })] }, k))) })] })] }));
}
