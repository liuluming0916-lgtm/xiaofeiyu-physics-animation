/**
 * 系统提示从 prompts/system.md 读入。
 *
 * 为什么不写在代码里：这份文档是"能读、能改、能对比"的资产。
 * 每次改完都要跑题库回归，避免"改好一个、弄坏三个"。
 */
import { readAsset } from '../../shared/asset.ts';

export const SYSTEM_PROMPT = readAsset('system.md').trim();

export function userPrompt(problem: string): string {
  return `题目：

${problem.trim()}

请开始。第一步只调用 write_animation，把完整代码交出来。`;
}
