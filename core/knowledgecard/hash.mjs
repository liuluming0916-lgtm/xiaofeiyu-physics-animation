/**
 * 知识卡的稳定哈希（v1.1.18 从 v1 store 里抽出来）。
 *
 * 为什么单独：生产链路只走 v2 卡，但 `provenance.knowledgecardHash` 仍需要
 * 一个稳定哈希。把哈希抽出来后，编排层就不必 import v1 store（否则会连带
 * 加载 v1 的 `builtin-bundle.generated.mjs`，等于“退役了还在启动时读”）。
 */

import { createHash } from 'node:crypto';

const ENTRY_FIELD_ORDER = [
  'id',
  'title',
  'origin',
  'category',
  'kind',
  'enabled',
  'constant',
  'recursive',
  'keys',
  'secondary_keys',
  'concepts',
  'tags',
  'elements',
  'insertion_slot',
  'order',
  'priority',
  'content',
  'code_examples',
];

const ENTRY_DEFAULTS = {
  kind: 'element',
  constant: false,
  recursive: true,
  secondary_keys: { logic: 'AND_ANY', list: [] },
  order: 100,
  priority: 'normal',
  code_examples: [],
  concepts: [],
  tags: [],
  elements: [],
};

function canonicalizeEntry(entry) {
  const out = {};
  for (const key of ENTRY_FIELD_ORDER) {
    if (key in entry) out[key] = entry[key];
    else if (key in ENTRY_DEFAULTS) out[key] = ENTRY_DEFAULTS[key];
  }
  if (out.secondary_keys && typeof out.secondary_keys === 'object') {
    out.secondary_keys = { logic: out.secondary_keys.logic ?? 'AND_ANY', list: [...(out.secondary_keys.list ?? [])] };
  } else {
    out.secondary_keys = { logic: 'AND_ANY', list: [] };
  }
  out.keys = [...(out.keys ?? [])];
  out.insertion_slot = [...(out.insertion_slot ?? [])];
  out.code_examples = [...(out.code_examples ?? [])];
  for (const field of ['concepts', 'tags', 'elements']) {
    out[field] = [...new Set(Array.isArray(out[field]) ? out[field] : [])];
  }
  return out;
}

/** 词条集合的稳定哈希（不含 enabled:false 的词条） */
export function knowledgecardHashOf(entries) {
  const canon = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && e.enabled !== false)
    .map(canonicalizeEntry)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(canon), 'utf8').digest('hex');
}
