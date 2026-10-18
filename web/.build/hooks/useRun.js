/**
 * 驱动一次运行并把事件灌进 store。
 *
 * 单独一个 Hook 的原因：**取消语义要落在组件生命周期上**。
 * 组件卸载时必须 `cancel()`，否则用户切页后会留下一条还在跑的流（§21.1 第 3 条）。
 */
import { useCallback, useEffect, useRef } from 'react';
import { demoEventSource, serverEventSource } from '../lib/run-stream';
import { useApp } from '../state/store';
export function useRun() {
    const handleRef = useRef(null);
    // 卸载即取消：这是"取消后无残留"在 UI 侧的那一半
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
                ...(st.description ? { description: st.description } : {}),
                ...(st.knownConditions ? { knownConditions: st.knownConditions } : {}),
            },
            images: st.images,
            mode: st.mode,
            /** 第 8 期：开发模式（不拦截）—— 勾了就把"别拦我"这句话传到后端 */
            devMode: st.devMode === true,
        };
        const handle = opts.source === 'demo' ? demoEventSource() : serverEventSource(opts.baseURL ?? '', input);
        handleRef.current = handle;
        st.startRun(handle.source, input.problem.text.slice(0, 40) || '(未命名题目)', null, [
            // 第 5.7 期：阶段链最前面是 read_problem（读题与判定，第 0 步；**所有题都跑**，含纯文字题），
            // 末尾是 repair（只在 Dry-Run 未通过时真正执行）。
            // 与 `core/orchestrator/events.mjs` 的 PHASE5_STAGES 一致 —— 构建期有一条判据钉住这一点。
            // **不要写死"某一步一定跑"**。
            'read_problem',
            'solve',
            'answers',
            'steps',
            'scene_code',
            'dry_run',
            'repair',
        ]);
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
