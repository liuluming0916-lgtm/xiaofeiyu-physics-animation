/**
 * 知识卡条目 v2 —— 纯函数（无 IO）。
 *
 * v2 只认三种卡：
 *   · anim_rule：constant，无触发字段；
 *   · element：elements 至少 1 个词表元件；
 *   · scene：scenes 恰好 1 个词表场景。
 *
 * v1 的 keys / secondary_keys / concepts / tags / category / insertion_slot / recursive
 * 全部不再进入 v2。迁移时“宁可停用+报告，不静默改触发”。
 */

import { elementIdsOf, sceneIdsOf } from './vocab.mjs';
import { validatePhysical, validateSize } from './size.mjs';

export const ENTRY_FIELD_ORDER_V2 = Object.freeze([
  'id',
  'title',
  'kind',
  'enabled',
  'origin',
  'constant',
  'elements',
  'scenes',
  'size',
  'physical',
  'order',
  'priority',
  'content',
  'code_examples',
]);

export const ENTRY_KINDS_V2 = Object.freeze(['anim_rule', 'element', 'scene']);
export const ENTRY_ORIGINS_V2 = Object.freeze(['builtin', 'user']);
export const ENTRY_PRIORITIES_V2 = Object.freeze(['normal', 'high']);

const ID_RE = /^[A-Za-z0-9._-]+$/;

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function checkStringArray(value, where, problems, { min = 0 } = {}) {
  if (!Array.isArray(value)) {
    problems.push(`${where} 必须是数组`);
    return [];
  }
  if (value.length < min) problems.push(`${where} 至少要有 ${min} 项`);
  if (new Set(value).size !== value.length) problems.push(`${where} 有重复项`);
  for (const v of value) {
    if (typeof v !== 'string' || !ID_RE.test(v)) problems.push(`${where} 含非法 id：${JSON.stringify(v)}`);
  }
  return value;
}

/**
 * 校验一条 v2 知识卡。
 * @param {object} entry
 * @param {{ vocab: object, where?: string }} opts
 * @returns {string[]} 问题清单（空 = 合法）
 */
export function validateEntryV2(entry, { vocab, where = '词条' } = {}) {
  const p = [];
  if (!isObject(entry)) return [`${where} 不是对象`];

  for (const key of Object.keys(entry)) {
    if (!ENTRY_FIELD_ORDER_V2.includes(key)) p.push(`${where} 含 v2 不认识的字段 "${key}"`);
  }

  for (const key of ['id', 'title', 'kind', 'enabled', 'origin', 'content']) {
    if (!(key in entry)) p.push(`${where} 缺少必填字段 "${key}"`);
  }
  if ('id' in entry && (typeof entry.id !== 'string' || !ID_RE.test(entry.id))) {
    p.push(`${where}.id 必须是 [A-Za-z0-9._-]+`);
  }
  if ('title' in entry && (typeof entry.title !== 'string' || !entry.title.trim())) p.push(`${where}.title 必须是非空字符串`);
  if ('kind' in entry && !ENTRY_KINDS_V2.includes(entry.kind)) p.push(`${where}.kind 必须是 ${ENTRY_KINDS_V2.join(' | ')}`);
  if ('enabled' in entry && typeof entry.enabled !== 'boolean') p.push(`${where}.enabled 必须是布尔`);
  if ('origin' in entry && !ENTRY_ORIGINS_V2.includes(entry.origin)) p.push(`${where}.origin 必须是 ${ENTRY_ORIGINS_V2.join(' | ')}`);
  if ('content' in entry && (typeof entry.content !== 'string' || !entry.content.trim())) p.push(`${where}.content 必须是非空字符串`);
  if ('constant' in entry && typeof entry.constant !== 'boolean') p.push(`${where}.constant 必须是布尔`);
  if ('order' in entry && !Number.isInteger(entry.order)) p.push(`${where}.order 必须是整数`);
  if ('priority' in entry && !ENTRY_PRIORITIES_V2.includes(entry.priority)) p.push(`${where}.priority 必须是 ${ENTRY_PRIORITIES_V2.join(' | ')}`);
  if ('code_examples' in entry) {
    if (!Array.isArray(entry.code_examples)) p.push(`${where}.code_examples 必须是数组`);
    else if (entry.code_examples.some((c) => typeof c !== 'string' || !c.trim())) p.push(`${where}.code_examples 含非字符串或空串`);
  }
  if ('size' in entry) {
    if (entry.kind !== 'element') p.push(`${where} 是 ${entry.kind} 卡，不应有 size（场景尺寸由模型按题决定）`);
    const optionalDims = Array.isArray(entry.elements) && entry.elements.includes('board') ? ['w'] : [];
    p.push(...validateSize(entry.size, `${where}.size`, { optionalDims }));
  }
  if ('physical' in entry) {
    if (entry.kind !== 'element') p.push(`${where} 是 ${entry.kind} 卡，不应有 physical`);
    p.push(...validatePhysical(entry.physical, `${where}.physical`));
  }

  const elementIds = elementIdsOf(vocab);
  const sceneIds = sceneIdsOf(vocab);
  const kind = entry.kind;

  if (kind === 'element') {
    if (!Array.isArray(entry.elements) || entry.elements.length === 0) {
      p.push(`${where} 是 element 卡，必须给至少 1 个 elements`);
    } else {
      checkStringArray(entry.elements, `${where}.elements`, p, { min: 1 });
      for (const id of entry.elements) {
        if (!elementIds.has(id)) p.push(`${where}.elements 含词表外元件 "${id}"`);
      }
    }
    if (Array.isArray(entry.scenes) && entry.scenes.length) p.push(`${where} 是 element 卡，不应有 scenes`);
    if (entry.constant === true) p.push(`${where} 是 element 卡，constant 必须为 false/缺省`);
  } else if (kind === 'scene') {
    if (!Array.isArray(entry.scenes) || entry.scenes.length !== 1) {
      p.push(`${where} 是 scene 卡，scenes 必须恰好 1 个`);
    } else {
      checkStringArray(entry.scenes, `${where}.scenes`, p, { min: 1 });
      for (const id of entry.scenes) {
        if (!sceneIds.has(id)) p.push(`${where}.scenes 含词表外场景 "${id}"`);
      }
    }
    if (Array.isArray(entry.elements) && entry.elements.length) p.push(`${where} 是 scene 卡，不应有 elements`);
    if (entry.constant === true) p.push(`${where} 是 scene 卡，constant 必须为 false/缺省`);
  } else if (kind === 'anim_rule') {
    if (entry.constant !== true) p.push(`${where} 是 anim_rule 卡，constant 必须为 true`);
    if (Array.isArray(entry.elements) && entry.elements.length) p.push(`${where} 是 anim_rule 卡，不应有 elements`);
    if (Array.isArray(entry.scenes) && entry.scenes.length) p.push(`${where} 是 anim_rule 卡，不应有 scenes`);
  }

  return p;
}

function baseOf(entry) {
  const out = {
    id: entry.id,
    title: entry.title,
    origin: entry.origin ?? 'user',
    enabled: entry.enabled !== false,
    content: entry.content,
    order: Number.isInteger(entry.order) ? entry.order : 100,
    priority: ENTRY_PRIORITIES_V2.includes(entry.priority) ? entry.priority : 'normal',
    code_examples: Array.isArray(entry.code_examples) ? [...entry.code_examples] : [],
    ...(entry.size && typeof entry.size === 'object' && !Array.isArray(entry.size) ? { size: { ...entry.size } } : {}),
    ...(entry.physical && typeof entry.physical === 'object' && !Array.isArray(entry.physical)
      ? { physical: { ...entry.physical } }
      : {}),
  };
  return out;
}

/**
 * v1 → v2 迁移。
 *
 * 规则：
 *   · 有 elements 的卡 → element 卡；keys/concepts/tags 丢弃并记 warning；
 *   · 只有 keys / 只有 concepts/tags 的卡 → **停用**（不猜映射）；
 *   · anim_rule → constant；
 *   · v1 的 scene 卡目前没有 scenes 字段 → 停用，等场景词表重绑；
 *   · insertion_slot 一律忽略（v2 只进 scene_code）。
 *
 * @returns {{ ok: boolean, action: 'convert'|'disable', entry?: object, warnings: string[], reasons: string[] }}
 */
export function migrateEntryV1toV2(entry, { vocab } = {}) {
  const warnings = [];
  const reasons = [];
  if (!isObject(entry)) return { ok: false, action: 'disable', warnings, reasons: ['不是对象'] };

  const kind = entry.kind ?? 'element';
  const hasElements = Array.isArray(entry.elements) && entry.elements.length > 0;
  const hasKeys = Array.isArray(entry.keys) && entry.keys.length > 0;
  const hasOldConceptFields =
    (Array.isArray(entry.concepts) && entry.concepts.length > 0) ||
    (Array.isArray(entry.tags) && entry.tags.length > 0);

  if (hasKeys) warnings.push('丢弃 keys：v2 不再用字面触发');
  if (hasOldConceptFields) warnings.push('丢弃 concepts/tags：v2 不再用考点/题型');
  if (Array.isArray(entry.insertion_slot) && entry.insertion_slot.includes('solve')) {
    warnings.push('insertion_slot 含 solve：v2 只进 scene_code，已忽略');
  }

  if (kind === 'anim_rule') {
    const out = { ...baseOf(entry), kind: 'anim_rule', constant: true };
    return { ok: true, action: 'convert', entry: out, warnings, reasons };
  }

  if (kind === 'scene') {
    const hasScenes = Array.isArray(entry.scenes) && entry.scenes.length === 1;
    if (!hasScenes) {
      reasons.push('v1 场景卡没有 v2 的 scenes 字段；等场景词表建立后重绑');
      return { ok: false, action: 'disable', warnings, reasons };
    }
    const out = { ...baseOf(entry), kind: 'scene', constant: false, scenes: [...entry.scenes] };
    return { ok: true, action: 'convert', entry: out, warnings, reasons };
  }

  // element（默认）
  if (!hasElements) {
    reasons.push(hasKeys ? '只有 keys，没有词表元件；v2 无法触发' : '没有 elements，v2 无法触发');
    return { ok: false, action: 'disable', warnings, reasons };
  }

  const elementIds = elementIdsOf(vocab);
  const bad = entry.elements.filter((id) => !elementIds.has(id));
  if (bad.length) {
    reasons.push(`elements 含词表外元件：${bad.join(', ')}；先补词表再迁移`);
    return { ok: false, action: 'disable', warnings, reasons };
  }

  const out = { ...baseOf(entry), kind: 'element', constant: false, elements: [...entry.elements] };
  return { ok: true, action: 'convert', entry: out, warnings, reasons };
}
