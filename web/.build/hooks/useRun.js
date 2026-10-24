/**
 * 驱动一次运行并把事件灌进 store。
 *
 * v1.1.18：运行器挂在 `App` 级（不是解题页），所以**切页不会取消**；
 * 只有整个应用卸载（关窗口）时才 `cancel()`。
 * 旧实现放在 `SolvePage` 里，切到设置页会卸载组件 → cancel → 服务端事件没人收，
 * 回来时按钮一直卡在“生成中”。
 */
import { useCallback, useEffect, useRef } from 'react';
import { demoEventSource, serverEventSource } from '../lib/run-stream';
import { useApp } from '../state/store';
export function useRun() {
    const handleRef = useRef(null);
    // App 卸载（关窗口）即取消；解题页/设置页切换不会触发这里
    useEffect(() => {
        return () => {
            handleRef.current?.cancel();
            handleRef.current = null;
        };
    }, []);
    const start = useCallback(async (opts) => {
        const st = useApp.getState();
        if (st.run.running)
            return;
        const input = {
            problem: {
                text: st.problemText,
                ...(Object.keys(st.stageNotes).length
                    ? { stageNotes: st.stageNotes }
                    : st.description
                        ? { description: st.description }
                        : {}),
                ...(st.knownConditions ? { knownConditions: st.knownConditions } : {}),
            },
            images: st.images,
            /**
             * v1.1.16：老师填了「参考答案 / 解析」才带这个字段。
             * 不带 ⇒ 后端走原来那套提示词（与旧版逐字一致）。
             */
            ...(st.referenceText.trim() || st.referenceImages.length
                ? { reference: { text: st.referenceText.trim(), images: st.referenceImages } }
                : {}),
            mode: st.mode,
            /** 第 8 期：开发模式（不拦截）—— 勾了就把"别拦我"这句话传到后端 */
            devMode: st.devMode === true,
            ...(opts.startAt ? { startAt: opts.startAt } : {}),
            ...(opts.startAt === 'solve' ? { baseReadProblem: opts.baseReadProblem ?? st.run.readProblemText ?? null } : {}),
            ...(opts.startAt === 'draw'
                ? {
                    baseReadProblem: opts.baseReadProblem ?? st.run.readProblemText ?? null,
                    analysisText: opts.baseAnalysisText ?? st.run.analysisText ?? null,
                    slots: opts.baseSlots ?? st.programSlots ?? null,
                }
                : {}),
        };
        const handle = opts.source === 'demo' ? demoEventSource() : serverEventSource(opts.baseURL ?? '', input);
        handleRef.current = handle;
        st.startRun(handle.source, input.problem.text.trim().slice(0, 40) || '(题目见图片)', null, [
            // 第 5.7 期：阶段链最前面是 read_problem（读题与判定，第 0 步；**所有题都跑**，含纯文字题），
            // 末尾是 repair（只在 Dry-Run 未通过时真正执行）。
            // 与 `core/orchestrator/events.mjs` 的 PHASE5_STAGES 一致 —— 构建期有一条判据钉住这一点。
            // **不要写死"某一步一定跑"**。
            'read_problem',
            'solve',
            'breakdown',
            'analysis',
            'scene_code',
            'dry_run',
            'repair',
            'couple',
        ], Boolean(opts.startAt), opts.startAt === 'draw');
        try {
            for await (const ev of handle.events) {
                useApp.getState().applyEvent(ev);
            }
        }
        catch (err) {
            useApp.getState().failRun(err instanceof Error ? err.message : String(err));
        }
        finally {
            handleRef.current = null;
        }
    }, []);
    const cancel = useCallback(() => {
        handleRef.current?.cancel();
        handleRef.current = null;
    }, []);
    return { start, cancel };
}
