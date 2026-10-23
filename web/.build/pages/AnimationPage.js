import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
/**
 * 动画页（§15 第二页 / M14 宿主侧）。
 *
 * 职责：**宿主控制条 + iframe 模板页**。
 * 协议实现依据 `contracts/host-protocol.md`（第 3 期定稿）：
 *   · 等模板发 `ready` 再发控制（协议 §4 的时序）；
 *   · 然后发 `program` 注入 8 槽位（协议 §3 的路径 B）；
 *   · 持续收 `state` 更新自己的进度条与读数；
 *   · `error` 如实显示（协议 §6 的错误码）。
 *
 * ⚠ 模板页的来源：
 *   本期宿主 iframe 装载的是 `template/build/animation-template.html`（空壳模板）的**副本**，
 *   它必须与宿主**同源或可被 postMessage 触达**。为了让"离线自包含"这条约束不被破坏，
 *   第 9 步的本地服务会把它挂到 `/template`；第 3 期先在 repo 内直接引用构建产物。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_MASK, SLOT_KEYS, postToTemplate, parseTemplateMessage, validateProgramPayload, } from '../lib/host-protocol';
import { TEX_SVG } from '../lib/demo-questions';
import { api } from '../lib/rules-api';
import { DEFAULT_GIF_FPS, DEFAULT_GIF_HEIGHT, DEFAULT_GIF_WIDTH, encodeGif, frameTimes, readScaled, } from '../lib/gif-encode.js';
import { onExportRequest } from '../lib/export-bus';
import { useApp } from '../state/store';
/**
 * 模板页路径。
 *
 * ⚠ 必须是**相对 `dist/` 的落点**：`web/rollup.config.mjs` 的 `copyStaticAssets()`
 * 会把空壳模板拷到 `dist/template/animation-template.html`。
 * 若这里写成 `../../template/build/...`，构建后 `dist/` 里没有那个目录 ⇒ iframe 404 ⇒ 动画页永远空白。
 * 这正是产物体检（`tools/web-build.mjs`）会拦的一类问题。
 */
const TEMPLATE_URL = './template/animation-template.html';
export function AnimationPage({ onManualRetry }) {
    const st = useApp();
    const iframeRef = useRef(null);
    const [ready, setReady] = useState(null);
    /** v1.1.18：警告弹窗 + 版本对比 */
    const [retryOpen, setRetryOpen] = useState(false);
    const [compareIndex, setCompareIndex] = useState(null);
    /** iframe 每次 onLoad 递增，用来重发 program（切页回来 / 模板重载都走这里） */
    const [reloadSeq, setReloadSeq] = useState(0);
    /**
     * ── 第 8 期：**本次启动编号**（用户裁决"每次打开都要干净"）──
     *
     * 从 `/api/health` 拿一次，随 `program` 消息下发给模板；
     * 模板用它拼 localStorage 的键 ⇒ 重开服务必然干净，同一次启动内刷新仍保留开关。
     * 拿不到（离线/异常）就退化成 `standalone`：宁可不记忆，也不要"错记"。
     */
    const [launchId, setLaunchId] = useState('standalone');
    useEffect(() => {
        let alive = true;
        api
            .health()
            .then((h) => {
            if (alive && typeof h.launchId === 'string' && h.launchId)
                setLaunchId(h.launchId);
        })
            .catch(() => {
            /* 拿不到就用 standalone：不记忆比错记好 */
        });
        return () => {
            alive = false;
        };
    }, []);
    /**
     * ⚠ 第 7 期：`live`（模板 state 心跳的镜像）与页面上的"实时读数"表一起删掉了。
     *
     * 为什么删：用户 2026-10-17 看效果后裁决——动画页上只要**动画 + 曲线图**，
     * 两处重复的数值堆料（模板数据面板 / 宿主读数表）全部砍掉。
     * 心跳本身仍然照收（下面 state 分支的 setT / setDuration / setPlaying 还在用），
     * 只是不再在界面上重复一遍。
     */
    /**
     * 通信日志（诊断用）。
     *
     * ★ 为什么要有它：第 3 期交付后，"动画页停在空壳模板"这个问题我**两轮都没修对**，
     *   盲点在于**看不见宿主与模板之间到底交换了什么**：
     *     是模板没发 `ready`？宿主没发 `program`？还是模板收下了却拒绝了？
     *   三种情况的**外在表现完全一样**（都停在空壳），不记录就只能猜。
     *   所以把消息往来**显示在界面上** —— 用户截一张图就能定位，不必懂协议。
     *   正常工作时它只占一行，不干扰界面。
     */
    const [log, setLog] = useState([]);
    const pushLog = useCallback((s) => {
        setLog((prev) => [...prev.slice(-9), `${new Date().toLocaleTimeString()} ${s}`]);
    }, []);
    /**
     * v1.1.17 修：切页回来动画页空壳。
     *
     * `App` 切页会卸载本页、销毁 iframe；但 `templateReady` 是 **store 全局**，
     * 旧值 true 会带进新 iframe，导致 `ready` 分支直接 return、不再注入。
     * 这里在 mount / unmount 都把“模板已就绪”复位；真正的注入由下面的
     * `programPayload` 效果 + iframe `onLoad` 重新完成。
     */
    useEffect(() => {
        useApp.getState().setTemplateReady(false);
        setReady(null);
        setLog([]);
        return () => useApp.getState().setTemplateReady(false);
    }, []);
    /**
     * v1.1.18：带警告/失败的结果进入动画页时**弹一次**。
     * “我知道了”或“手动打回”都会 acknowledge，之后只留常驻告警横幅，不反复骚扰。
     */
    useEffect(() => {
        if (st.run.running)
            return;
        if (!st.programSlots)
            return;
        if (st.run.warningAcknowledged)
            return;
        if (st.run.verdict === 'pass-with-warnings' || st.run.verdict === 'fail') {
            setRetryOpen(true);
        }
    }, [st.run.running, st.run.verdict, st.run.warningAcknowledged, st.programSlots, st.programEpoch]);
    /* ── 收模板消息（协议 §2 的方向判据） ── */
    useEffect(() => {
        const onMessage = (e) => {
            // 诊断优先：先记下"收到任何消息"这件事，再判断它是不是给宿主的
            const raw = e.data;
            if (raw && typeof raw === 'object' && typeof raw.type === 'string') {
                pushLog(`← 收到 ${raw.type}${raw.source ? `（source=${raw.source}）` : '（无 source）'}`);
            }
            // 只接受来自我们那个 iframe 的消息
            if (iframeRef.current && e.source !== iframeRef.current.contentWindow) {
                pushLog('  ⚠ 该消息的 e.source 不是我们的 iframe，已忽略');
                return;
            }
            const parsed = parseTemplateMessage(e.data);
            if (!parsed) {
                pushLog('  ⚠ 协议方向判据拒绝（source 不是 od-template）');
                return;
            }
            if (parsed.type === 'ready') {
                pushLog(`  ✓ 模板已就绪（${parsed.payload.shell ? '空壳主动上报' : '注入了题目'}）· 时长 ${Number(parsed.payload.duration ?? 0).toFixed(2)} s`);
                setReady({
                    duration: Number(parsed.payload.duration ?? 0),
                    stepCount: Number(parsed.payload.stepCount ?? 0),
                });
            }
            else if (parsed.type === 'state') {
                const p = parsed.payload;
                /* 心跳仍要落到 store（取消/进度/播放态依赖它），但**不再**渲染成读数表 */
                useApp.getState().setT(Number(p.t ?? 0));
                useApp.getState().setDuration(Number(p.duration ?? 0));
                useApp.getState().setPlaying(Boolean(p.playing));
            }
            else if (parsed.type === 'error') {
                const code = String(parsed.payload.code ?? 'unknown');
                const message = String(parsed.payload.message ?? '');
                // 空壳模板在拿到 program 之前报告 no-program，这是**预期行为**，不算错误
                if (code === 'no-program') {
                    pushLog('  · 模板报 no-program（空壳的预期行为，等待注入）');
                    return;
                }
                /**
                 * ★ `program-already-inlined` 只有在**我们从未成功注入过**时才算错误。
                 *
                 * 为什么需要这个区分：第 3 期交付后为了摆脱"双向握手"（见下面注入那段），
                 * 宿主改成**重试注入 4 次**；而模板有 §13.1 的防覆盖保护，会拒绝第 2～4 条。
                 * 于是"第一次成功、后面三条被拒"——动画**正常播放**，
                 * 界面上却挂着一条红色错误。**那是自我竞争输掉的正常结果，不是故障。**
                 *
                 * 判据：注入成功后 `templateReady` 会置为 true。
                 *   · 已成功过 ⇒ 记为日志、**不报错**（这正是用户看到的情况）；
                 *   · 从未成功 ⇒ 那是真拒绝（例如宿主错误地把成品页当空壳注入），照实报。
                 * 两种都是可见的（日志里留痕），只是级别不同 —— 不静默。
                 */
                if (code === 'program-already-inlined' && useApp.getState().templateReady) {
                    pushLog('  · 模板拒绝了重复注入（首次已成功，属预期）');
                    return;
                }
                pushLog(`  ✗ 模板报错 ${code}：${message}`);
                useApp.getState().setTemplateError({ code, message });
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [pushLog]);
    const post = useCallback((type, payload) => {
        const ok = postToTemplate(iframeRef.current?.contentWindow, type, payload ?? {});
        pushLog(`→ 发送 ${type}${ok ? '' : '（失败：iframe 未就绪）'}`);
        return ok;
    }, [pushLog]);
    /**
     * `program` 注入载荷。
     *
     * ★ 两条注入路径（立即重试 + ready）必须发**同一份**载荷；抽成 memo 是为了
     *   让 timing / labelAvoid 这类“晚到字段”也进入依赖数组，不在两处手抄漏字段。
     *
     * v1.1.17：`stepTimes` 发**显示秒**（couple 已按每小问 4 s 换算），
     * 同时带 `timeMap / displayDuration`；模板只按表换算，不再自己推。
     */
    const programPayload = useMemo(() => {
        if (!st.programSlots)
            return null;
        /**
         * 只有 timeMap + displayDuration 都在，才把 stepTimes 换成显示秒；
         * 否则退回原始物理秒（旧服务端/老产物），避免“显示秒 stepTimes + 物理 T_DISPLAY”
         * 这种半套数据导致步骤跳转错位。
         */
        const hasDisplayTiming = Array.isArray(st.programTimeMap) &&
            st.programTimeMap.length > 0 &&
            typeof st.programDisplayDuration === 'number' &&
            Number.isFinite(st.programDisplayDuration) &&
            st.programDisplayDuration > 0;
        return {
            slots: st.programSlots,
            mode: st.programMode,
            texSvg: TEX_SVG,
            id: st.programTitle,
            title: st.programTitle,
            /* C2：标注避让表（Dry-Run 算的）。模板收到后会交给播放器按表挪字 + 画引线 */
            labelAvoid: st.programLabelAvoid,
            /* v6：步骤 ↔ 动画时间。优先用显示秒版本；没有就退回原始物理秒（老行为） */
            stepTimes: hasDisplayTiming
                ? (st.programDisplayStepTimes ?? st.programStepTimes)
                : st.programStepTimes,
            timeMap: hasDisplayTiming ? st.programTimeMap : null,
            displayDuration: hasDisplayTiming ? st.programDisplayDuration : null,
            /* 第 8 期：本次启动编号（偏好键隔离用） */
            launchId,
        };
    }, [
        st.programSlots,
        st.programMode,
        st.programTitle,
        st.programLabelAvoid,
        st.programDisplayStepTimes,
        st.programStepTimes,
        st.programTimeMap,
        st.programDisplayDuration,
        launchId,
    ]);
    useEffect(() => {
        if (!programPayload)
            return;
        const bad = validateProgramPayload(programPayload);
        if (bad) {
            useApp.getState().setTemplateError({ code: 'bad-program', message: bad });
            return;
        }
        /**
         * ★ 不等 `ready`，直接**重试注入**若干次。
         *
         * `postMessage` 对同一个窗口重复投递是幂等的，模板有
         * `program-already-inlined` 拒绝重复注入的保护 —— 多发几次只多几条消息，
         * 换来的是不依赖握手时序。`reloadSeq` 由 iframe `onLoad` 递增：
         * 切页回来 / 模板重载后，不需要猜“2.5 秒够不够”，加载完一定再发一次。
         */
        const send = () => {
            const ok = post('program', programPayload);
            if (ok)
                useApp.getState().setTemplateReady(true);
            return ok;
        };
        send();
        const timers = [400, 1200, 2500, 5000].map((ms) => window.setTimeout(send, ms));
        return () => timers.forEach((t) => window.clearTimeout(t));
    }, [programPayload, reloadSeq, post]);
    /**
     * `ready` 到达后**立刻**再注入一次（不等重试定时器）。
     *
     * ⚠ v1.1.17 修：这里**不能再判断 `st.templateReady`**。
     * 切页回来时它是上一轮 iframe 留下的 true；新 iframe 的 ready 一到就被
     * 这个 guard 挡掉，页面停在空壳。复位由本页 mount/unmount 与 iframe onLoad 负责。
     */
    useEffect(() => {
        if (!ready || !programPayload)
            return;
        post('program', programPayload);
        useApp.getState().setTemplateReady(true);
    }, [ready, programPayload, post]);
    /* ── 开关与倍速的同步（与注入解耦，避免上面那类自触发循环） ── */
    useEffect(() => {
        if (!st.templateReady)
            return;
        post('setVectorMask', st.mask);
    }, [st.templateReady, st.mask, post]);
    useEffect(() => {
        if (!st.templateReady)
            return;
        post('setRate', { rate: st.rate });
    }, [st.templateReady, st.rate, post]);
    /* ══ 导出（M17）：网页 / GIF ══════════════════════════════════
       用户 2026-10-17 改方案：**不做 WebM**（转码链重、收益低），只产出
         ① 单文件网页（= 模板页另存，双击即播，烧录 Provenance）
         ② GIF（25 fps / 960×540，默认**不录曲线图**——只抓动画画布）
       GIF 帧数口径 = `round(duration×fps) + 1`（末帧必须落在 duration 上，
       否则"首末帧与 t=0 / t=duration 一致"这条验收就不成立），见 frameTimes()。 */
    const [busy, setBusy] = useState(null);
    const [result, setResult] = useState(null);
    /**
     * 第 9 期：导出文件名要**带题目**（原来 GIF 写死 `animation.gif`，导第二道题就覆盖）。
     * 只保留中英文、数字、连字符，其余压成 '-'，最长 40 字 —— 免得文件名里出现路径分隔符。
     */
    const slug = useCallback((text, fallback) => {
        const s = String(text ?? '')
            .trim()
            .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40);
        return s || fallback;
    }, []);
    const exportHook = useCallback(() => {
        const win = iframeRef.current?.contentWindow;
        const h = win?.ODExportHook;
        return h && h.available() ? h : null;
    }, []);
    /**
     * 第 9 期 v1.1.5：画布**不再固定 16:9**（用户 2026-10-19 · 方案 B：比例尺优先，GIF 让步）。
     * 所以抓帧不能直接拉伸到 960×540 —— 那会把画面**拉变形**。
     * 这里等比缩放 + 留白边合到目标尺寸，再交给 readScaled 取像素。
     */
    const letterboxTo = useCallback((src, w, h) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        if (!g)
            return c;
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, h);
        const scale = Math.min(w / src.width, h / src.height);
        const dw = src.width * scale;
        const dh = src.height * scale;
        g.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
        return c;
    }, []);
    const exportPage = useCallback(async () => {
        const st0 = useApp.getState();
        if (!st0.programSlots)
            return;
        setBusy({ kind: 'page', done: 0, total: 1 });
        setResult(null);
        try {
            // 演示源是手写的，Provenance 就照实写 handwritten；真实跑题才可能带真哈希
            const handwritten = !st0.run.model;
            const res = await fetch('/api/export/page', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    slots: st0.programSlots,
                    mode: st0.programMode,
                    /* 第 9 期：带上 id ⇒ 文件名是「题目-时间戳.html」，不再是一串 export-xxx */
                    id: slug(st0.programTitle, 'export'),
                    title: st0.programTitle,
                    model: st0.run.model ?? 'handwritten',
                    promptHash: handwritten ? 'handwritten' : undefined,
                    knowledgecardHash: handwritten ? 'handwritten' : undefined,
                    /* C2：把避让表一起烧进导出的网页（没表就是 null ⇒ 与第 7 期一样） */
                    labelAvoid: st0.programLabelAvoid ?? null,
                    /* v6：步骤时间一起烧进导出页，联动不依赖宿主 */
                    stepTimes: st0.programStepTimes ?? null,
                    /**
                     * 第 8 期：开发模式（不拦截）的痕迹一并烧进导出页的 Provenance。
                     * 这个 html 一旦离开本机，就没人知道它没验过 —— 必须写在文件里。
                     */
                    advisory: st0.run.advisory === true,
                    gatesBypassed: st0.run.gatesBypassed,
                }),
            });
            const data = (await res.json());
            if (!data.ok)
                throw new Error(data.issues?.[0]?.message ?? '导出失败');
            setResult({
                ok: true,
                text: `网页已导出：${data.name}（${Math.round((data.bytes ?? 0) / 1024)} KB · 公式 ${data.formulas ?? 0} 条）`,
                url: data.url,
                file: data.file,
            });
        }
        catch (err) {
            setResult({ ok: false, text: `导出网页失败：${err.message}` });
        }
        finally {
            setBusy(null);
        }
    }, [slug]);
    const exportGif = useCallback(async () => {
        const h = exportHook();
        if (!h) {
            setResult({ ok: false, text: '导出失败：模板页还没就绪（或还没注入题目）' });
            return;
        }
        const times = frameTimes(h.duration(), DEFAULT_GIF_FPS);
        if (!times.length) {
            setResult({ ok: false, text: '导出失败：动画时长为 0' });
            return;
        }
        setBusy({ kind: 'gif', done: 0, total: times.length });
        setResult(null);
        try {
            if (!h.prepare(DEFAULT_GIF_WIDTH, DEFAULT_GIF_HEIGHT))
                throw new Error('画布尺寸准备失败');
            const frames = [];
            for (let i = 0; i < times.length; i += 1) {
                const canvas = h.renderAt(times[i]);
                if (!canvas)
                    throw new Error(`第 ${i} 帧渲染失败`);
                frames.push(readScaled(letterboxTo(canvas, DEFAULT_GIF_WIDTH, DEFAULT_GIF_HEIGHT), DEFAULT_GIF_WIDTH, DEFAULT_GIF_HEIGHT));
                setBusy({ kind: 'gif', done: i + 1, total: times.length });
                // 让出主线程：不这么做进度条永远不重绘，几十帧会看起来像卡死
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            const bytes = encodeGif(frames, {
                width: DEFAULT_GIF_WIDTH,
                height: DEFAULT_GIF_HEIGHT,
                fps: DEFAULT_GIF_FPS,
            });
            const res = await fetch(`/api/export/gif?name=${encodeURIComponent(`${slug(useApp.getState().programTitle, 'animation')}.gif`)}`, {
                method: 'POST',
                headers: { 'content-type': 'application/octet-stream' },
                body: bytes,
            });
            const data = (await res.json());
            if (!data.ok)
                throw new Error(data.issues?.[0]?.message ?? '落盘失败');
            setResult({
                ok: true,
                text: `GIF 已导出：${data.name}（${times.length} 帧 · ${DEFAULT_GIF_FPS} fps · ${DEFAULT_GIF_WIDTH}×${DEFAULT_GIF_HEIGHT} · ${Math.round((data.bytes ?? 0) / 1024)} KB）`,
                url: data.url,
                file: data.file,
            });
        }
        catch (err) {
            setResult({ ok: false, text: `导出 GIF 失败：${err.message}` });
        }
        finally {
            h.restore();
            setBusy(null);
        }
    }, [exportHook, slug]);
    /**
     * 第 9 期 v1.1.5：导出请求来自**导航栏**（见 lib/export-bus.ts）。
     * 导航栏只发请求，画布句柄在这里，所以导出动作也留在这里做。
     */
    useEffect(() => onExportRequest((kind) => {
        if (kind === 'page')
            void exportPage();
        else
            void exportGif();
    }), [exportPage, exportGif]);
    const currentVersion = st.programVersions[st.programVersionIndex] ?? null;
    const compareVersion = compareIndex == null ? null : st.programVersions[compareIndex] ?? null;
    const changedSlots = currentVersion && compareVersion
        ? SLOT_KEYS.filter((k) => String(currentVersion.slots[k] ?? '') !== String(compareVersion.slots[k] ?? ''))
        : [];
    return (_jsxs("div", { className: "space-y-4", children: [st.run.banner && (_jsxs("div", { role: "alert", className: "rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-sm", children: [_jsxs("p", { className: "font-semibold text-amber-900", children: ["\u26A0 ", st.run.banner.title, st.run.banner.failedChecks.length > 0 && (_jsxs("span", { className: "ml-2 font-mono text-xs", children: ["\uFF08", st.run.banner.failedChecks.join(' / '), "\uFF09"] }))] }), _jsx("p", { className: "mt-1 text-amber-900", children: st.run.banner.message })] })), st.run.advisory && (_jsxs("p", { className: "rounded-lg border border-amber-400 bg-amber-50 p-3 text-xs text-amber-900", "data-od-id": "advisory-banner-animation", children: [_jsx("strong", { children: "\u5F00\u53D1\u6A21\u5F0F" }), "\uFF1A\u8FD9\u6761\u52A8\u753B**\u6CA1\u6709\u901A\u8FC7\u786C\u5224\u636E**", st.run.gatesBypassed.length ? '（' + st.run.gatesBypassed.join(' / ') + '）' : '', "\u3002\u753B\u9762\u53EF\u4EE5\u770B\u3001\u53EF\u4EE5\u5BFC\u51FA\uFF0C\u4F46\u5BFC\u51FA\u6587\u4EF6\u91CC\u4F1A\u5199\u660E\u201C\u672A\u901A\u8FC7\u6821\u9A8C\u201D\u3002"] })), !st.programSlots && (_jsxs("p", { className: "rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900", children: ["\u8FD8\u6CA1\u6709\u53EF\u64AD\u653E\u7684\u52A8\u753B\uFF1A\u8BF7\u5148\u5230", _jsx("strong", { children: "\u89E3\u9898\u9875" }), "\u70B9\u300C\u5F00\u59CB\u751F\u6210\u52A8\u753B\u300D\u3002"] })), st.templateError && (_jsxs("div", { className: "rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900", children: [_jsxs("p", { className: "font-medium", children: ["\u6A21\u677F\u9875\u62A5\u544A\u9519\u8BEF\uFF1A", st.templateError.code] }), _jsx("p", { className: "mt-1", children: st.templateError.message })] })), st.programSlots && !st.templateReady && !st.templateError && (_jsx("p", { className: "text-sm text-slate-500", children: "\u6B63\u5728\u7B49\u5F85\u6A21\u677F\u9875\u5C31\u7EEA\u2026" })), st.run.running ? (_jsxs("div", { className: "rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600", children: ["\u6B63\u5728", st.run.repairRounds.length ? '按上一版重跑' : '生成', "\u2026\uFF08\u5B8C\u6210\u540E\u4F1A\u81EA\u52A8\u88C5\u8F7D\u65B0\u52A8\u753B\uFF09"] })) : st.programSlots ? (_jsx("div", { className: "overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm", children: _jsx("iframe", { ref: iframeRef, title: "\u52A8\u753B\u6A21\u677F\u9875", src: TEMPLATE_URL, className: "h-[720px] w-full", onLoad: () => {
                        /* 新 iframe 一定是“未就绪”：复位后由注入 effect 重发 program。
                           切页回来 / 模板重载都走这里，不再依赖固定重试窗口。 */
                        setReady(null);
                        useApp.getState().setTemplateReady(false);
                        setReloadSeq((n) => n + 1);
                    }, 
                    // 模板页需要脚本（播放器就在里面）；同源即可
                    sandbox: "allow-scripts allow-same-origin" }, `od-frame-${st.programEpoch}`) })) : null, _jsxs("p", { className: "text-xs text-slate-500", children: ["\u8BF4\u660E\uFF1A\u753B\u5E03\u3001\u4E09\u680F\u3001\u64AD\u653E\u63A7\u5236\u4E0E\u66F2\u7EBF\u56FE\u5168\u90E8\u7531", _jsx("strong", { children: "\u6A21\u677F\u9875\u81EA\u5DF1" }), "\u6E32\u67D3 \uFF08\u64AD\u653E\u5668\u5C31\u662F\u6A21\u677F\u9875\u672C\u8EAB\uFF09\uFF0C\u5BBF\u4E3B\u53EA\u8D1F\u8D23\u628A\u9898\u76EE\u6CE8\u5165\u8FDB\u53BB\u2014\u2014\u8FD9\u6837\u5BFC\u51FA\u7684\u6587\u4EF6 \u4E0E\u5C4F\u5E55\u4E0A\u770B\u5230\u7684\u624D\u662F\u540C\u4E00\u4E2A\u4E1C\u897F\u3002\u672C\u671F iframe \u6307\u5411\u6784\u5EFA\u4EA7\u7269", ' ', _jsx("code", { className: "rounded bg-slate-100 px-1", children: TEMPLATE_URL }), "\u3002"] }), _jsxs("details", { open: Boolean(st.programSlots) && !st.templateReady, className: "rounded-lg border border-slate-200 bg-white", children: [_jsxs("summary", { className: "cursor-pointer px-3 py-2 text-xs text-slate-600", children: ["\u5BBF\u4E3B \u2194 \u6A21\u677F \u901A\u4FE1\u65E5\u5FD7\uFF08", log.length, " \u6761\uFF09", !st.templateReady && st.programSlots ? ' —— 尚未就绪，请看下面' : ''] }), _jsx("pre", { className: "max-h-40 overflow-auto border-t border-slate-100 px-3 py-2 text-[11px] leading-relaxed text-slate-700", children: log.length ? log.join('\n') : '（还没有任何消息往来）' })] }), (busy || result) && (_jsx("p", { className: result && !result.ok ? 'text-xs text-red-700' : 'text-xs text-slate-500', children: busy
                    ? busy.kind === 'gif'
                        ? `正在逐帧渲染… ${busy.done} / ${busy.total}`
                        : '正在打包单文件页…'
                    : result?.text })), st.programVersions.length > 1 && (_jsxs("details", { className: "rounded-lg border border-slate-200 bg-white", children: [_jsxs("summary", { className: "cursor-pointer px-3 py-2 text-xs text-slate-600", children: ["\u7248\u672C\u5386\u53F2\uFF08", st.programVersions.length, " \u4E2A\uFF1B\u53EF\u5BF9\u6BD4 / \u56DE\u9000\uFF09"] }), _jsx("div", { className: "space-y-2 border-t border-slate-100 px-3 py-2", children: st.programVersions.map((v, i) => (_jsxs("div", { className: "flex flex-wrap items-center gap-2 text-xs", children: [_jsxs("span", { className: "font-mono text-slate-500", children: ["v", v.id] }), _jsx("span", { className: "text-slate-600", children: v.source === 'run' ? '初次' : v.source === 'repair' ? `修复·${v.verdict ?? ''}` : '手动' }), _jsx("span", { className: "text-slate-400", children: new Date(v.at).toLocaleTimeString() }), i === st.programVersionIndex && _jsx("span", { className: "rounded bg-slate-100 px-1.5 py-0.5 text-slate-600", children: "\u5F53\u524D" }), _jsx("button", { type: "button", className: "rounded border border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-slate-50", onClick: () => setCompareIndex(i), children: "\u5BF9\u6BD4" }), _jsx("button", { type: "button", className: "rounded border border-amber-300 px-2 py-0.5 text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40", disabled: i === st.programVersionIndex, onClick: () => {
                                        useApp.getState().rollbackProgram(i);
                                        pushLog(`↩ 回退到 v${v.id}`);
                                    }, children: "\u56DE\u9000" })] }, v.id))) })] })), retryOpen && (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4", role: "presentation", onClick: (e) => {
                    if (e.target === e.currentTarget) {
                        useApp.getState().acknowledgeWarning();
                        setRetryOpen(false);
                    }
                }, children: _jsxs("div", { role: "dialog", "aria-modal": "true", "aria-labelledby": "retry-title", className: "w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl", children: [_jsx("h2", { id: "retry-title", className: "text-base font-semibold text-slate-900", children: st.run.verdict === 'fail' ? '这一版没有通过校验' : '这一版有小警告' }), _jsxs("p", { className: "mt-2 text-sm leading-relaxed text-slate-600", children: ["\u52A8\u753B\u5DF2\u7ECF\u53EF\u4EE5\u64AD\u653E\uFF0C\u4F46", st.run.verdict === 'fail' ? '有硬拦项没过' : '有告警项', "\u3002 \u4F60\u53EF\u4EE5\u5148\u7528\u7740\uFF0C\u4E5F\u53EF\u4EE5\u624B\u52A8\u6253\u56DE\u8BA9\u6A21\u578B\u91CD\u8DD1\u3002", st.programVersions.length > 1 ? '旧版本已保留在“版本历史”里，可对比/回退。' : ''] }), st.run.banner && (_jsxs("p", { className: "mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900", children: [st.run.banner.title, st.run.banner.failedChecks?.length ? `（${st.run.banner.failedChecks.join(' / ')}）` : ''] })), _jsxs("div", { className: "mt-5 flex flex-wrap justify-end gap-2", children: [_jsx("button", { type: "button", autoFocus: true, className: "rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50", onClick: () => {
                                        useApp.getState().acknowledgeWarning();
                                        setRetryOpen(false);
                                    }, children: "\u6211\u77E5\u9053\u4E86" }), _jsx("button", { type: "button", className: "rounded-md border border-blue-300 px-3 py-1.5 text-sm text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40", disabled: !st.run.analysisText, title: st.run.analysisText ? '保留 analysis/stateAt/VIEW/STEPS，只让模型重画 drawFrame' : '缺少上一版 analysis，只能用“从解题重跑”', onClick: () => {
                                        setRetryOpen(false);
                                        onManualRetry('draw');
                                    }, children: "\u53EA\u91CD\u753B\u52A8\u753B" }), _jsx("button", { type: "button", className: "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700", onClick: () => {
                                        setRetryOpen(false);
                                        onManualRetry('solve');
                                    }, children: "\u4ECE\u89E3\u9898\u91CD\u8DD1" })] })] }) })), compareVersion && currentVersion && (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4", role: "presentation", onClick: (e) => {
                    if (e.target === e.currentTarget)
                        setCompareIndex(null);
                }, children: _jsxs("div", { role: "dialog", "aria-modal": "true", "aria-labelledby": "compare-title", className: "flex max-h-[85vh] w-full max-w-5xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-slate-100 px-5 py-3", children: [_jsxs("h2", { id: "compare-title", className: "text-base font-semibold text-slate-900", children: ["\u7248\u672C\u5BF9\u6BD4\uFF1Av", compareVersion.id, " \u2192 v", currentVersion.id] }), _jsx("button", { type: "button", className: "text-sm text-slate-500 hover:text-slate-900", onClick: () => setCompareIndex(null), children: "\u5173\u95ED" })] }), _jsx("div", { className: "min-h-0 flex-1 space-y-3 overflow-auto p-5", children: changedSlots.length === 0 ? (_jsx("p", { className: "text-sm text-slate-500", children: "\u4E24\u4EFD\u7A0B\u5E8F\u7684 8 \u4E2A\u69FD\u4F4D\u5B8C\u5168\u76F8\u540C\u3002" })) : (changedSlots.map((k) => (_jsxs("details", { className: "rounded border border-slate-200", open: k === 'drawFrame', children: [_jsxs("summary", { className: "cursor-pointer px-3 py-2 text-xs font-medium text-slate-700", children: [k, " ", _jsx("span", { className: "text-slate-400", children: "\uFF08\u6709\u5DEE\u5F02\uFF09" })] }), _jsxs("div", { className: "grid gap-2 border-t border-slate-100 p-2 md:grid-cols-2", children: [_jsxs("div", { children: [_jsxs("p", { className: "mb-1 text-[11px] text-slate-500", children: ["v", compareVersion.id] }), _jsx("pre", { className: "max-h-72 overflow-auto rounded bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-800", children: compareVersion.slots[k] ?? '' })] }), _jsxs("div", { children: [_jsxs("p", { className: "mb-1 text-[11px] text-slate-500", children: ["v", currentVersion.id] }), _jsx("pre", { className: "max-h-72 overflow-auto rounded bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-800", children: currentVersion.slots[k] ?? '' })] })] })] }, k)))) }), _jsx("div", { className: "flex justify-end gap-2 border-t border-slate-100 px-5 py-3", children: _jsxs("button", { type: "button", className: "rounded-md border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50", onClick: () => {
                                    useApp.getState().rollbackProgram(compareIndex ?? 0);
                                    setCompareIndex(null);
                                    pushLog(`↩ 回退到 v${compareVersion.id}`);
                                }, children: ["\u56DE\u9000\u5230 v", compareVersion.id] }) })] }) }))] }));
}
/** 默认开关（导出给别处复用，避免重复定义） */
export const DEFAULT_VECTOR_MASK = DEFAULT_MASK;
