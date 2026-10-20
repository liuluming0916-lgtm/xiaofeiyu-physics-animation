/**
 * v2 卡 → v1 运行时形状的**过渡适配器**。
 *
 * 为什么需要：Phase 3 只把 `/api/run` 的“卡片集合”换成 v2（无 keys、按 elements 触发），
 * 但编排层/世界书引擎仍是 v1。v1 引擎要求：
 *   · `insertion_slot` 含 scene_code；
 *   · `keys` / `secondary_keys` / `category` / `concepts` / `tags` 字段存在。
 *
 * 所以这里补“空壳字段”，让 v2 卡能在 v1 引擎里按 `elements` 命中。
 * Phase 4 会把引擎本身换成 v2，这个适配器就退役。
 */

const EMPTY_SECONDARY = Object.freeze({ logic: 'AND_ANY', list: Object.freeze([]) });

/**
 * @param {object} entry v2 卡
 * @returns {object} v1 引擎能吃的卡（keys 为空，按 elements 命中）
 */
export function v2ToV1RuntimeEntry(entry) {
  return {
    id: entry.id,
    title: entry.title,
    origin: entry.origin ?? 'user',
    category: 'scene_modeling',
    kind: entry.kind ?? 'element',
    enabled: entry.enabled !== false,
    constant: entry.constant === true,
    recursive: false,
    keys: [],
    secondary_keys: { logic: EMPTY_SECONDARY.logic, list: [...EMPTY_SECONDARY.list] },
    concepts: [],
    tags: [],
    elements: [...(entry.elements ?? [])],
    insertion_slot: ['scene_code'],
    order: Number.isInteger(entry.order) ? entry.order : 100,
    priority: entry.priority === 'high' ? 'high' : 'normal',
    content: entry.content,
    code_examples: [...(entry.code_examples ?? [])],
  };
}
