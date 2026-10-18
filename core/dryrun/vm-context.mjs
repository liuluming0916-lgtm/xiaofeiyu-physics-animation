/**
 * Dry-Run 的槽位执行上下文（§6.3 第二道门的"内层"）。
 *
 * 被两个后端共用：
 *   · `worker-sandbox.mjs` 的 Worker 里（第 2 期主路径，硬终止 + resourceLimits）；
 *   · `dry-run.mjs` 的同进程回退路径（Worker 起不来时的降级，判据与结论一致）。
 *
 * 口径：槽位作用域里只有**纯函数全局**——没有 require / process / DOM / 网络 / 定时器。
 * 这不是"安全边界"（§6.1：防范的是有 bug 的代码，不是恶意代码），
 * 与 C1 静态白名单一起构成两道门。
 */

import { createContext } from 'node:vm';

/** 槽位可见的全局（与 `ALLOWED_GLOBALS` 同口径，见 core/lint/contract-lint.mjs） */
export function slotGlobals(extra = {}) {
  return {
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Map,
    Set,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    console: { log() {}, warn() {}, error() {} },
    ...extra,
  };
}

export function createSlotContext(extra = {}, name = 'dry-run') {
  return createContext(slotGlobals(extra), { name });
}
