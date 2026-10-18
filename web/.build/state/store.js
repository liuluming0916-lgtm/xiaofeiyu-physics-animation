/**
 * 应用状态（zustand）。
 *
 * 管理三件事：
 *   1. 解题页的运行状态（题面、阶段进度、流式文本、判定、取消）；
 *   2. 动画页要用的程序载荷与宿主控制状态（时间轴、倍速、矢量开关）；
 *   3. 端点配置（第 3 期从 `ai-rules/endpoints.json` 读，UI 留第 6 期设置页）。
 */
import { create } from 'zustand';
import { DEFAULT_MASK } from '../lib/host-protocol';
const EMPTY_RUN = {
    running: false,
    source: null,
    entry: '',
    model: null,
    stages: [],
    stageText: {},
    stageStatus: {},
    stageMs: {},
    stageSkipReason: {},
    promptHash: null,
    verdict: null,
    gatesBypassed: [],
    advisory: false,
    verdictNote: null,
    checks: [],
    extensions: [],
    diagnostics: [],
    repairRounds: [],
    repairConverged: null,
    banner: null,
    delivery: null,
    worldbook: null,
    error: null,
    elapsedMs: 0,
};
export const useApp = create((set) => ({
    problemText: '',
    description: '',
    knownConditions: '',
    images: [],
    mode: 'BOTH',
    /** 第 8 期：开发模式（不拦截）—— 记住上次的选择 */
    devMode: readDevMode(),
    run: { ...EMPTY_RUN },
    programSlots: null,
    programMode: 'BOTH',
    programTitle: '',
    programLabelAvoid: null,
    templateReady: false,
    playing: false,
    t: 0,
    duration: 0,
    rate: 1,
    mask: { ...DEFAULT_MASK },
    templateError: null,
    setProblemText: (s) => set({ problemText: s }),
    setDescription: (s) => set({ description: s }),
    setKnownConditions: (s) => set({ knownConditions: s }),
    addImage: (i) => set((st) => ({ images: [...st.images, i] })),
    removeImage: (index) => set((st) => ({ images: st.images.filter((_, i) => i !== index) })),
    setDevMode: (on) => {
        try {
            localStorage.setItem('od-dev-mode', on ? '1' : '0');
        }
        catch {
            /* 隐私模式 / 禁用存储：只影响"记住上次选择"，不影响本次开关 */
        }
        set({ devMode: on });
    },
    /** ⚠ 第 8 期：没有 setMode 了（数值/符号按条目走，界面上不再有开关） */
    startRun: (source, entry, model, stages) => set({
        run: {
            ...EMPTY_RUN,
            running: true,
            source,
            entry,
            model,
            stages,
            stageStatus: Object.fromEntries(stages.map((s) => [s, 'pending'])),
        },
        // 新一轮开始就清掉上一轮的动画（避免把旧动画当新结果看）
        programSlots: null,
        templateReady: false,
        templateError: null,
    }),
    applyEvent: (e) => set((st) => {
        const run = {
            ...st.run,
            stageText: { ...st.run.stageText },
            stageStatus: { ...st.run.stageStatus },
            stageMs: { ...st.run.stageMs },
            stageSkipReason: { ...st.run.stageSkipReason },
            repairRounds: [...st.run.repairRounds],
        };
        switch (e.type) {
            case 'run_start':
                run.entry = e.entry;
                run.model = e.model;
                run.stages = e.stages;
                break;
            case 'run_label':
                // 第 5 期追加：纯图片题开跑时标题是"(未命名题目)"，读图转写跑完后回填成转写的第一句
                run.entry = e.entry;
                break;
            case 'stage_start':
                run.stageStatus[e.stage] = 'running';
                break;
            case 'stage_delta':
                run.stageText[e.stage] = (run.stageText[e.stage] ?? '') + e.text;
                if (e.promptHash)
                    run.promptHash = e.promptHash;
                break;
            case 'stage_done':
                // 第 5 期：`skipped:true` 表示"这一步本次不适用"（纯文字题的读图转写）。
                // 它**必须**与 `done` 分开显示 —— 否则界面上会把"跳过了"看成"做完了"。
                if (e.skipped) {
                    run.stageStatus[e.stage] = 'skipped';
                    run.stageSkipReason[e.stage] = e.reason ?? '本次不适用，已跳过';
                }
                else {
                    run.stageStatus[e.stage] = 'done';
                }
                run.stageMs[e.stage] = e.ms;
                break;
            case 'stage_error':
                run.stageStatus[e.stage] = 'error';
                run.error = { stage: e.stage, kind: e.error.kind, message: e.error.message, ...(e.error.hint ? { hint: e.error.hint } : {}) };
                break;
            case 'repair_round':
                // 第 4 期：每轮修复都留档，UI 上要能看出"改了什么、为什么改"
                run.repairRounds.push({
                    round: e.round,
                    requested: e.requested,
                    updated: e.updated,
                    unchanged: e.unchanged,
                    triggeringChecks: e.triggeringChecks,
                    diagnostics: e.diagnostics,
                    verdict: e.verdict,
                    ms: e.ms,
                });
                break;
            case 'repair_done':
                run.repairConverged = e.converged;
                run.banner = e.banner ?? null;
                break;
            case 'worldbook_done':
                // 第 5 期：世界书依据（§15）。**整条载荷留着**：面板要显示命中方式、
                // 实际注入槽位、字符数与"空槽 / 被截断"这两个**必须分开**的状态。
                run.worldbook = {
                    hash: e.hash,
                    libraryCount: e.libraryCount,
                    matched: e.matched,
                    entries: e.entries,
                    emptySlots: e.emptySlots,
                    truncatedSlots: e.truncatedSlots,
                    warnings: e.warnings,
                    charsBySlot: e.charsBySlot,
                    injectedBySlot: e.injectedBySlot,
                };
                break;
            case 'dryrun_done':
                // ⚠ 自愈会**多次**推 `dryrun_done`（首轮 + 每轮修复后）。
                //   最终判定必须取**最后一次**，否则 UI 会把中间那轮的 fail 当成结论。
                run.verdict = e.verdict;
                run.verdictNote = e.note ?? null;
                run.checks = e.checks;
                run.extensions = e.extensions;
                run.diagnostics = e.diagnostics;
                /**
                 * 第 8 期：**开发模式（不拦截）**。
                 * 这里只记"放行了哪几条"；界面必须显著提示（否则就成了看不见的绿灯）。
                 * 同时把整份报告存进 localStorage（用户要求："在本地网页中保存它认为错误的部分"）。
                 */
                run.advisory = e.advisory === true;
                run.gatesBypassed = e.gatesBypassed ?? [];
                if (e.advisory === true) {
                    saveDevReport({
                        at: new Date().toISOString(),
                        entry: run.entry,
                        verdict: e.verdict,
                        gatesBypassed: run.gatesBypassed,
                        checks: e.checks,
                        diagnostics: e.diagnostics,
                        /**
                         * ★ 把 8 个槽位一起存下来（第 8 期补）。
                         * 用户第一次发来的留档 JSON 里**没有代码**，于是"播放键不动""曲线图没生成"
                         * 这类问题只能靠看画面猜 —— 存下来才可能复现。
                         */
                        slots: (e.program?.slots ?? e.programs?.slots ?? null),
                    });
                }
                {
                    // 真实链路发 `program`（单数）；演示源历史上发 `programs`。两个都认，
                    // 否则接上服务端后这里会静默拿不到载荷。
                    const payload = e.program ?? e.programs;
                    if (payload?.slots) {
                        const slots = payload.slots;
                        // 清掉行偏移补出来的前导空行会让槽位看起来"缩进很深"，模板页能容忍，
                        // 但为了观感这里做一次最小归一化（只去首尾空行，不动行内内容）。
                        const trimmed = {};
                        for (const [k, v] of Object.entries(slots)) {
                            trimmed[k] = String(v).replace(/^\n+/, '').replace(/\n+$/, '');
                        }
                        set({
                            programSlots: trimmed,
                            programMode: payload.mode,
                            programTitle: run.entry,
                            /* C2：避让表随 program 一起走；没有就是 null（播放器照常工作） */
                            programLabelAvoid: e.labelAvoid ?? null,
                            templateReady: false,
                            templateError: null,
                        });
                    }
                }
                break;
            case 'cancelled':
                run.verdict = 'skipped';
                run.verdictNote = '已被用户取消';
                break;
            case 'run_done':
                run.running = false;
                run.elapsedMs = e.ms;
                if (e.banner !== undefined)
                    run.banner = e.banner ?? null;
                if (Number.isFinite(e.rounds))
                    run.repairConverged = e.converged ?? run.repairConverged;
                if (e.delivery)
                    run.delivery = e.delivery;
                if (!run.verdict)
                    run.verdict = e.verdict ?? null;
                break;
        }
        return { run };
    }),
    failRun: (message) => set((st) => ({ run: { ...st.run, running: false, error: { stage: 'client', kind: 'client', message } } })),
    loadProgram: (slots, mode, title) => set({ programSlots: slots, programMode: mode, programTitle: title, templateReady: false, templateError: null }),
    setTemplateReady: (v) => set({ templateReady: v }),
    setTemplateError: (e) => set({ templateError: e }),
    setPlaying: (v) => set({ playing: v }),
    setT: (t) => set({ t }),
    setDuration: (d) => set({ duration: d }),
    setRate: (r) => set({ rate: r }),
    setMask: (patch) => set((st) => ({ mask: { ...st.mask, ...patch } })),
}));
/* ══════════════════ 第 8 期：开发模式（不拦截）的本地留档 ══════════════════
 *
 * 用户的诉求原话："勾选开发模式之后，C1–C9 只校验并在本地网页中保存它认为错误的部分，
 * 而动画代码则正常流入到动画页面播放。"
 *
 * 所以这里做两件事：
 *   ① 记住开关（localStorage: od-dev-mode）；
 *   ② 每次"放行"都把**整份报告**（含每条检查的 diagnostics / offenders）追加进
 *      localStorage: od-dev-reports（只留最近 20 条）。
 * 为什么放 localStorage 而不是服务端：这是"开发期的本地草稿"，不需要进历史库；
 * 也避免把"未经验证"的产物混进正式归档。
 */
const DEV_MODE_KEY = 'od-dev-mode';
const DEV_REPORTS_KEY = 'od-dev-reports';
const DEV_REPORTS_MAX = 20;
function readDevMode() {
    try {
        return localStorage.getItem(DEV_MODE_KEY) === '1';
    }
    catch {
        return false;
    }
}
function readDevReports() {
    try {
        const raw = localStorage.getItem(DEV_REPORTS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    }
    catch {
        return [];
    }
}
/** 追加一条"开发模式放行"的报告（只留最近 DEV_REPORTS_MAX 条；存储满了就丢掉最旧的） */
export function saveDevReport(report) {
    try {
        const list = readDevReports();
        list.push(report);
        localStorage.setItem(DEV_REPORTS_KEY, JSON.stringify(list.slice(-DEV_REPORTS_MAX)));
    }
    catch {
        /* 隐私模式 / 配额满：留档失败不影响播放，但也不假装成功 */
    }
}
/** 读出全部本地留档（校验报告面板的"开发模式留档"用它） */
export function listDevReports() {
    return readDevReports();
}
/** 清空留档（面板上的按钮） */
export function clearDevReports() {
    try {
        localStorage.removeItem(DEV_REPORTS_KEY);
    }
    catch {
        /* 同上 */
    }
}
/** 便利选择器：当前是否有可播放的程序 */
export const selectHasProgram = (st) => Boolean(st.programSlots);
/** 便利选择器：判定是否"未校验"（UI 必须显著区分它和 pass） */
export const selectIsSkipped = (st) => st.run.verdict === 'skipped';
/** 供其它模块读快照（非 React 环境，例如事件循环里） */
export const getState = () => useApp.getState();
