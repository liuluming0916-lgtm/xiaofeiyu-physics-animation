/**
 * 前端的事件流接口（**唯一入口**）。
 *
 * ── 为什么要有这一层（诚实说明架构边界）
 *
 * 第 3 期的**真正链路**住在 `core/`（Node ESM）：网关、Prompt、切分、Dry-Run 沙箱。
 * 它是**后端代码** —— 读文件、用 `node:vm`、用 `worker_threads`，
 * **浏览器里跑不了**（这和第 1 期"成品页必须自包含、不能有 Node 依赖"是同一个约束）。
 *
 * 因此前端只能从**本机服务**拿事件流（方案 §2.1：Node 服务 + 浏览器，回环 `127.0.0.1:随机端口`）。
 * 但沙箱允许的工作方式限制了两件事：
 *   · 起 HTTP 服务 / 绑定端口不在当前沙箱许可内；
 *   · `pnpm run` 前的依赖检查会因管道限制而崩。
 * ⇒ **第 3 期把"服务端事件流"留到第 9 步**（那时再定它跑在服务里还是 Worker 里）。
 *
 * ── 本期前端怎么可测、可见
 *
 * 本文件定义两个实现，**共用同一个接口与同一个事件形状**（与
 * `core/orchestrator/events.mjs` 逐字段一致）：
 *
 *   1. `demoEventSource()` —— **演示源**：不调模型，用本地真题槽位走完整的前端流程。
 *      它的 `dryrun_done` 判定是 **`skipped`**，**绝不谎报 pass**
 *      （因为浏览器里没有校验内核，无法真的判 C1–C9）。
 *   2. `serverEventSource()` —— **服务端源**（SSE）：接口已就位，接上第 9 步的本地服务即可用。
 *
 * 这样做的价值：**前端的一切接线（三段渲染、阶段进度、事件流、iframe 注入、取消、门控禁用态）
 * 现在就能被真实驱动与肉眼验证**，而"判定"这件事仍然只由后端说 —— 不会被前端伪装。
 */
import { SLOT_KEYS } from './host-protocol';
import { KNOWLEDGECARD_DEMO_EVENT } from './knowledgecard-demo';
/**
 * 三档证据强度的中文标签（**与契约同源**）。
 *
 * 来源：`contracts/diagnostic-evidence.json`（由 `contracts/spec/diagnostic.mjs` 生成）。
 * 前端不直接读那份 JSON（它在 Node 侧的 contracts 目录里，浏览器里拿不到），
 * 因此这里是一份**抄录**——由 `tools/web-build.mjs` 的产物体检断言它与契约一致，
 * 抄错会让构建失败，而不是让 UI 悄悄显示错的强度。
 */
export const PRECISION_LABEL = {
    exact: '精确',
    replayed: '重放定位',
    candidate: '候选',
};
/** 取证据强度的展示标签；未知值**如实标注**，不默认成"精确" */
export function precisionLabel(p) {
    if (!p)
        return '未标注';
    return PRECISION_LABEL[p] ?? '未知强度';
}
/**
 * 阶段链（与 §2.3 / `core/orchestrator/events.mjs` 的 `PHASE5_STAGES` 一致）。
 *
 * ⚠ 最前面是 `read_problem`（**读题与判定**，"第 0 步"）。第 5 期叫 `read_image`（读图转写），
 *   第 5.7 期按用户裁决改名并**取消了"纯文字题跳过"**：考点不可能写在题面里，必须由模型判，
 *   所以**所有题都跑它**。`repair` 仍只在 Dry-Run 未通过时真正执行。
 *   ⇒ **链条按完整形态排布，不要在别处写死"某一步一定跑"（`skipped` 机制保留，通用）。**
 */
export const STAGE_CHAIN = ['read_problem', 'solve', 'breakdown', 'analysis', 'couple', 'scene_code', 'dry_run', 'repair'];
export const STAGE_LABEL = {
    read_problem: '读题',
    solve: '解题',
    breakdown: '答案讲解',
    analysis: '物理分析',
    scene_code: '动画代码',
    dry_run: '校验',
    repair: '自愈修复',
    couple: '步骤耦合',
};
/* ────────────────────────────── 演示源 ────────────────────────────── */
/**
 * 演示源：**不调模型**，用本地真题走完整前端流程。
 *
 * ⚠ 它**不做校验**：浏览器里没有 `node:vm` / `worker_threads`，跑不了第 2 期的校验内核。
 *   因此 `dryrun_done.verdict` 被诚实标成 `'skipped'`，并在 `note` 里写明原因。
 *   **绝不谎报 pass。**
 */
export function demoEventSource() {
    const ac = new AbortController();
    const questionId = 'q01-conveyor-heat';
    async function* gen() {
        let seq = 0;
        const at = () => new Date().toISOString();
        const started = Date.now();
        yield {
            seq: ++seq,
            type: 'run_start',
            at: at(),
            entry: '演示：传送带共速与摩擦生热',
            stages: [...STAGE_CHAIN],
            model: '(演示源：未调用模型)',
            mode: 'BOTH',
            imageCount: 0,
            source: 'demo',
        };
        // 演示用的"模型输出"：直接取真题 q01 的槽位（前端只读题目文件，不跑 core/）
        const q = await loadDemoQuestion(questionId);
        const stageTexts = {
            solve: '物块无初速放到传送带上时相对传送带向左滑，摩擦力方向向右，大小 f = μmg。\n' +
                '由牛顿第二定律 a₁ = μg = 2 m/s²，物块加速到与带同速需要 t* = u/a₁ = 1.0 s。\n' +
                '此间位移 Δx = u²/(2μg) = 1.0 m；相对位移 Δs = u·t* − Δx = 1.0 m；\n' +
                '摩擦生热 Q = μmg·Δs = 2.0 J。共速后摩擦力为零，物块随带匀速。',
            answers: q.slots.ANSWERS,
            steps: q.slots.STEPS,
            scene_code: q.slots
                ? SLOT_KEYS.map((k) => `/* @slot:${k} */\n${q.slots[k]}\n/* @end */`).join('\n')
                : '',
        };
        /**
         * 第 0 步 `read_problem`（读题与判定）：演示源没有图片，也不会调模型，
         * 所以**不伪造转写正文**；但按真实口径发一条 `judgement_done`，
         * 让"两侧分发"这条链路在演示里也走得通（面板上能看到判了什么、命中路径是哪一条）。
         *
         * ⚠ 判定值取自**夹具词表里的真实 id**（`uniform_acceleration` 等）—— 编一个表外的词
         *   会让前端拿不到它要显示的那条路径，等于把演示做成假的。
         */
        const demoJudgement = {
            concepts: ['work_energy_relation', 'conveyor_belt'],
            tags: ['摩擦生热（相对位移）'],
            elements: ['belt', 'block_board', 'vector', 'chart'],
        };
        yield {
            seq: ++seq,
            type: 'stage_done',
            at: at(),
            stage: 'read_problem',
            chars: 0,
            ms: 0,
            note: '(演示源：不调模型，故无转写正文；判定见 judgement_done)',
        };
        yield {
            seq: ++seq,
            type: 'judgement_done',
            at: at(),
            stage: 'read_problem',
            concepts: demoJudgement.concepts,
            tags: demoJudgement.tags,
            elements: demoJudgement.elements,
            unknowns: { concept: [], tag: [], element: [] },
            problems: [],
            why: '(演示源：这几个判定是构建期按真题 q01 的人工口径写死的，不是模型输出)',
            empty: false,
        };
        // `noUncheckedIndexedAccess` 下 `STAGE_CHAIN[i]` 是 `string | undefined`；
        // 用 `slice` + `entries` 拿到既有下标又有确定字符串的遍历，避免到处写非空断言。
        // `read_problem` 已在上面单独处理，所以从 `solve` 开始，到 `dry_run` 前结束
        //（`dry_run` 与 `repair` 由下面单独推）。
        const modelStages = STAGE_CHAIN.slice(STAGE_CHAIN.indexOf('solve'), STAGE_CHAIN.indexOf('dry_run'));
        for (const [i, stage] of modelStages.entries()) {
            if (ac.signal.aborted) {
                yield { seq: ++seq, type: 'cancelled', at: at(), stage };
                break;
            }
            yield { seq: ++seq, type: 'stage_start', at: at(), stage, index: i, total: STAGE_CHAIN.length };
            const t0 = Date.now();
            const full = stageTexts[stage] ?? '';
            // 逐片吐，模拟流式（前端必须能一边收一边渲染）
            const chunk = 24;
            for (let p = 0; p < full.length; p += chunk) {
                if (ac.signal.aborted)
                    break;
                await sleep(12);
                yield {
                    seq: ++seq,
                    type: 'stage_delta',
                    at: at(),
                    stage,
                    text: full.slice(p, p + chunk),
                    ...(i === 0 && p === 0 ? { note: 'promptHash', promptHash: '(演示源：不计算 promptHash)' } : {}),
                };
            }
            yield { seq: ++seq, type: 'stage_done', at: at(), stage, chars: full.length, ms: Date.now() - t0 };
            if (ac.signal.aborted) {
                yield { seq: ++seq, type: 'cancelled', at: at(), stage };
                break;
            }
        }
        /**
         * 第 5 期：世界书依据（§15）。
         *
         * ⚠ 这份数据的**触发与组装是真的**（构建期用 `core/knowledgecard/engine.mjs` 在真题题面上跑出来，
         *   见 `tools/build-knowledgecard-web.mjs`）—— 世界书的命中只取决于题面与词条集合，与模型无关。
         *   所以演示源显示它不是"编一个好看的依据"，而是"用构建期的输入跑真引擎"。
         *   演示源里的**具体词条**仍是构建期快照（用户区在 `ai-rules/knowledgecard/`，浏览器读不到）。
         */
        yield { seq: ++seq, type: 'knowledgecard_done', at: at(), ...KNOWLEDGECARD_DEMO_EVENT };
        if (!ac.signal.aborted) {
            yield {
                seq: ++seq,
                type: 'stage_start',
                at: at(),
                stage: 'dry_run',
                index: STAGE_CHAIN.indexOf('dry_run'),
                total: STAGE_CHAIN.length,
            };
            yield {
                seq: ++seq,
                type: 'dryrun_done',
                at: at(),
                verdict: 'skipped',
                cancelled: false,
                checks: [],
                extensions: [],
                diagnostics: [],
                // ⚠ 第 8 期：**渲染符号还是数值不再由 mode 决定** —— 看每条 readout 有没有 `latex`。
                //   漏掉它会让 SYMBOLIC 题在动画页里退回数值显示，直接违反 §18 期 3 的验收条件。
                //
                // ⚠ 字段名：真实链路（`core/orchestrator`）发的是 `program`（单数）。
                //   这里跟着改过来 —— 以前叫 `programs`，两处不一致会让前端只认演示源、
                //   而接上服务端（第 9 步）后**静默拿不到程序载荷**。
                program: { slots: q.slots, mode: q.mode },
                note: '演示源不执行校验：校验内核（C1–C9 + Worker 沙箱）是 Node 侧代码，浏览器里无法运行。' +
                    '要得到真实判定，请走服务端事件流（第 9 步接入）。',
            };
            // 演示源不调模型，couple 如实标 skipped（界面不能一直 pending）
            yield {
                seq: ++seq,
                type: 'stage_done',
                at: at(),
                stage: 'couple',
                skipped: true,
                chars: 0,
                ms: 0,
                reason: '演示源不调用模型，跳过步骤耦合',
            };
        }
        yield {
            seq: ++seq,
            type: 'run_done',
            at: at(),
            verdict: ac.signal.aborted ? 'cancelled' : 'skipped',
            ms: Date.now() - started,
            cancelled: ac.signal.aborted,
            rounds: 0,
            // 演示源不跑自愈，因此**没有**横幅；真实链路的横幅由 core 侧生成
            banner: null,
        };
    }
    return { source: 'demo', events: gen(), cancel: () => ac.abort() };
}
/* ────────────────────────────── 服务端源 ────────────────────────────── */
/**
 * 服务端源（SSE）：接第 9 步的本地服务。
 *
 * **现在就能用**：只要有一个按 `core/orchestrator/events.mjs` 发事件的 `/api/run` 端点
 * （把 `toSseFrame()` 的输出直接写进响应体即可）。
 */
export function serverEventSource(baseURL, input) {
    const ac = new AbortController();
    async function* gen() {
        const res = await fetch(`${baseURL.replace(/\/+$/, '')}/api/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                problem: input.problem,
                images: input.images.map((i) => ({ mime: i.mime, dataUrl: i.dataUrl })),
                /* v1.1.16：参考答案（可选，原样透传；后端没收到就当没有） */
                ...(input.reference
                    ? {
                        reference: {
                            text: input.reference.text,
                            images: input.reference.images.map((i) => ({ mime: i.mime, dataUrl: i.dataUrl })),
                        },
                    }
                    : {}),
                mode: input.mode,
                devMode: input.devMode === true,
                ...(input.startAt ? { startAt: input.startAt } : {}),
                ...(input.startAt ? { baseReadProblem: input.baseReadProblem ?? null } : {}),
                ...(input.startAt === 'draw'
                    ? { analysisText: input.analysisText ?? null, slots: input.slots ?? null }
                    : {}),
            }),
            signal: ac.signal,
        });
        if (!res.ok || !res.body) {
            throw new Error(`本地服务返回 ${res.status}；请确认它已启动（第 9 步接入）`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const sep = /\r?\n\r?\n/;
            let m;
            while ((m = sep.exec(buffer)) !== null) {
                const frame = buffer.slice(0, m.index);
                buffer = buffer.slice(m.index + m[0].length);
                const dataLine = frame
                    .split('\n')
                    .filter((l) => l.startsWith('data:'))
                    .map((l) => l.slice(5).trim())
                    .join('\n');
                if (!dataLine)
                    continue;
                try {
                    yield JSON.parse(dataLine);
                }
                catch {
                    // 单个坏帧不应毁掉整条流
                }
            }
        }
    }
    return { source: 'server', events: gen(), cancel: () => ac.abort() };
}
/* ────────────────────────────── 工具 ────────────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * 读一道本地真题的 8 个槽位与模式。
 *
 * ⚠ 这里用 `import.meta.glob` 是 Vite/Rollup 的静态导入能力吗？不是 ——
 *   Rollup 不认 `import.meta.glob`（那是 Vite 的）。因此改为**构建期生成清单**：
 *   `web/src/lib/demo-questions.ts` 由 `tools/build-demo-questions.mjs` 从
 *   `tests/regression-15/*.mjs`（唯一事实来源）生成，只登记演示需要的那几道题。
 *
 * ⚠ 返回类型必须带 `mode`：它现在只是**显示标签**（数值/符号已合并为按条目），
 *   漏掉它会让纯符号题在动画页里退回数值显示。
 */
async function loadDemoQuestion(id) {
    const mod = await import('./demo-questions');
    const entry = mod.DEMO_QUESTIONS[id];
    if (!entry)
        throw new Error(`演示题目 "${id}" 不在 demo-questions.ts 的清单里`);
    return { slots: entry.slots, mode: entry.mode };
}
