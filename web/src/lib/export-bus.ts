/**
 * 导出请求总线（第 9 期 v1.1.5）。
 *
 * 为什么需要它：用户要求把「导出」变成**导航栏上的一个键**（在「蒸馏」右边），
 * 这样动画页顶部那一整行工具栏就能彻底消失、把高度让给画布。
 * 但导出的**实现**留在动画页里 —— 它要用 iframe 的 `ODExportHook` 逐帧取画布。
 *
 * 所以导航栏只负责"发一个请求"，动画页收下并执行。
 * 刻意不放进 zustand store：这是一次性事件，不是状态，放 store 反而要额外清理。
 */
export type ExportKind = 'page' | 'gif'

const listeners = new Set<(kind: ExportKind) => void>()

export function requestExport(kind: ExportKind): void {
  for (const fn of listeners) fn(kind)
}

export function onExportRequest(fn: (kind: ExportKind) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
