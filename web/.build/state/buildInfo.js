/**
 * 构建链自检用的最小 zustand store。
 *
 * 之所以单独放一个文件：**证明 zustand 的 TS 类型与 React 18 的组合是可用的**
 * （第 3 步之后的题面输入、阶段进度、播放状态都会走 store）。
 * 第 6 步会用真正的 store 替换它。
 */
import { create } from 'zustand';
export const useBuildInfo = create((set) => ({
    phase: '第 0 步 · 构建链验证',
    moduleCount: 0,
    setModuleCount: (next) => set({ moduleCount: next }),
}));
