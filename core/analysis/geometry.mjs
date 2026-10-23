/**
 * 元件尺寸（B1'：**唯一来源是 v2 知识卡**，两层尺寸）。
 *
 *   · `size`     —— 10×6 纸面单位，跨题一样大，渲染不乘 s；
 *   · `physical` —— 物理米，只给 analysis 算“质心离支撑面多高”。
 *
 * 场景卡（belt / incline）不写尺寸：由模型按题面/轨迹自主调配。
 * 旧实现读 `contracts/element-geometry-v2.json`（隐藏第二尺寸表）已删除；本模块只从卡派生。
 *
 * 校验策略：
 *   · 内置卡表启动时构建并硬校验（缺 `size` / 缺 `physical` / 冲突 ⇒ 明确抛错）；
 *   · 运行期用「本题快照的卡」叠加；用户卡漏写尺寸时**告警并沿用内置类型尺寸**（不静默造表）；
 *   · 未知类型退化为“点”，不阻断旧数据。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePhysical, validateSize } from '../knowledgecard/v2/size.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILTIN_CARDS_PATH = join(ROOT, 'core', 'knowledgecard', 'data-v2', '93-elements.json');

const UNKNOWN = Object.freeze({
  anchor: 'center',
  shape: 'point',
  minPx: 0,
  rotatable: false,
});

let builtinCache = null;
let builtinPhysicalCache = null;
let builtinEntriesCache = null;

/**
 * 这 7 类会进 `analysis` 的 MOTIONS 表，必须给 `physical`（否则质心高度算不出来）。
 * 只列**类型 id**，不含任何数字；数值只在卡里。
 */
export const PHYSICAL_REQUIRED_TYPES = Object.freeze([
  'block',
  'board',
  'ball',
  'conductor_rod',
  'light_rod',
  'piston',
  'mercury',
]);

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** element 卡才带尺寸；场景卡的尺寸由模型决定。 */
function elementTypesOf(entry) {
  if (entry?.kind !== 'element') return [];
  return (Array.isArray(entry.elements) ? entry.elements : []).filter((t) => typeof t === 'string' && t);
}

function sizeProblemsOf(entry) {
  const optionalDims = elementTypesOf(entry).includes('board') ? ['w'] : [];
  return validateSize(entry.size, `${entry.id}.size`, { optionalDims });
}

/**
 * 由**一组卡**构建纸面尺寸表（不叠加任何其它来源）。
 *
 * @param {object[]} entries
 * @returns {{ sizes: Record<string, object>, owners: Record<string, string>, problems: string[] }}
 */
export function sizeTableFromCards(entries) {
  const sizes = {};
  const owners = {};
  const problems = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.enabled === false) continue;
    const id = String(entry.id ?? '(无 id)');
    if (entry.kind !== 'element') {
      if (entry.size) problems.push(`场景卡 ${id} 不应有 size（场景尺寸由模型按题决定）`);
      continue;
    }
    if (!entry.size) {
      problems.push(`元件卡 ${id} 缺 size（纸面尺寸必须来自卡）`);
      continue;
    }
    problems.push(...sizeProblemsOf(entry));
    for (const type of elementTypesOf(entry)) {
      if (sizes[type] && !sameJson(sizes[type], entry.size)) {
        problems.push(`类型 ${type} 有两张卡给了不同 size：${owners[type]} / ${id}`);
      }
      sizes[type] = entry.size;
      owners[type] = id;
    }
  }
  return { sizes, owners, problems };
}

/**
 * 由**一组卡**构建物理尺寸表（物理米）。
 *
 * @param {object[]} entries
 * @returns {{ physical: Record<string, object>, owners: Record<string, string>, problems: string[], warnings: string[] }}
 */
export function physicalTableFromCards(entries) {
  const physical = {};
  const owners = {};
  const problems = [];
  const warnings = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.enabled === false) continue;
    if (entry.kind !== 'element') {
      if (entry.physical) problems.push(`场景卡 ${entry.id} 不应有 physical（场景没有固定物理尺寸）`);
      continue;
    }
    const id = String(entry.id ?? '(无 id)');
    const types = elementTypesOf(entry);
    const required = types.some((t) => PHYSICAL_REQUIRED_TYPES.includes(t));
    if (!entry.physical) {
      if (required) problems.push(`元件卡 ${id} 缺 physical（${types.join(', ')} 要用来算质心高度）`);
      continue;
    }
    problems.push(...validatePhysical(entry.physical, `${id}.physical`));
    for (const type of types) {
      if (physical[type] && !sameJson(physical[type], entry.physical)) {
        problems.push(`类型 ${type} 有两张卡给了不同 physical：${owners[type]} / ${id}`);
      }
      physical[type] = entry.physical;
      owners[type] = id;
    }
  }
  for (const type of PHYSICAL_REQUIRED_TYPES) {
    if (!physical[type]) problems.push(`物理尺寸表缺类型 ${type}`);
  }
  return { physical, owners, problems, warnings };
}

/** 内置卡条目（只读一次）。 */
export function builtinCardEntries() {
  if (builtinEntriesCache) return builtinEntriesCache;
  const raw = JSON.parse(readFileSync(BUILTIN_CARDS_PATH, 'utf8'));
  builtinEntriesCache = Object.freeze(Array.isArray(raw?.entries) ? raw.entries.map((e) => Object.freeze(e)) : []);
  return builtinEntriesCache;
}

/** 内置卡纸面尺寸表（进程内缓存 + 硬校验）。 */
export function builtinSizeTable() {
  if (builtinCache) return builtinCache;
  const table = sizeTableFromCards(builtinCardEntries());
  if (table.problems.length) {
    throw new Error(`内置元件卡尺寸不可用（卡是尺寸唯一来源，不回退隐藏表）：\n- ${table.problems.join('\n- ')}`);
  }
  const out = Object.freeze({ sizes: Object.freeze({ ...table.sizes }), owners: Object.freeze({ ...table.owners }) });
  builtinCache = out;
  return out;
}

/** 内置卡物理尺寸表（进程内缓存 + 硬校验）。 */
export function builtinPhysicalTable() {
  if (builtinPhysicalCache) return builtinPhysicalCache;
  const table = physicalTableFromCards(builtinCardEntries());
  if (table.problems.length) {
    throw new Error(`内置元件卡 physical 不可用（卡是唯一来源）：\n- ${table.problems.join('\n- ')}`);
  }
  const out = Object.freeze({
    physical: Object.freeze({ ...table.physical }),
    owners: Object.freeze({ ...table.owners }),
  });
  builtinPhysicalCache = out;
  return out;
}

/**
 * 运行期：本题快照卡 → 纸面尺寸表。
 *
 * 先取内置表（保证总有尺寸），再用传入卡的 `size` 覆盖同类型；
 * 用户卡漏写 `size` ⇒ warning（沿用内置类型尺寸，不静默造表）。
 *
 * @param {object[]|null|undefined} entries
 * @returns {{ sizes: Record<string, object>, owners: Record<string, string>, problems: string[], warnings: string[] }}
 */
export function sizeTableFromEntries(entries) {
  const base = builtinSizeTable();
  const sizes = { ...base.sizes };
  const owners = { ...base.owners };
  const problems = [];
  const warnings = [];
  /** @type {Map<string, { id: string, size: object }>} */
  const fromEntries = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.enabled === false) continue;
    const id = String(entry.id ?? '(无 id)');
    const types = elementTypesOf(entry);
    if (!entry.size) {
      if (types.length) warnings.push(`元件卡 ${id} 没写 size；沿用内置类型尺寸（${types.join(', ')}）`);
      continue;
    }
    for (const p of sizeProblemsOf(entry)) problems.push(p);
    for (const type of types) {
      const prev = fromEntries.get(type);
      if (prev && !sameJson(prev.size, entry.size)) {
        problems.push(`类型 ${type} 在用户卡里有两份不同 size：${prev.id} / ${id}`);
      }
      fromEntries.set(type, { id, size: entry.size });
      sizes[type] = entry.size;
      owners[type] = id;
    }
  }
  return { sizes, owners, problems, warnings };
}

/**
 * 运行期：本题快照卡 → 物理尺寸表（给 analysis 提示词用，B2 接线）。
 *
 * @param {object[]|null|undefined} entries
 * @returns {{ physical: Record<string, object>, owners: Record<string, string>, problems: string[], warnings: string[] }}
 */
export function physicalTableFromEntries(entries) {
  const base = builtinPhysicalTable();
  const physical = { ...base.physical };
  const owners = { ...base.owners };
  const problems = [];
  const warnings = [];
  /** @type {Map<string, { id: string, physical: object }>} */
  const fromEntries = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.enabled === false) continue;
    if (entry.kind !== 'element') continue;
    const id = String(entry.id ?? '(无 id)');
    const types = elementTypesOf(entry);
    if (!entry.physical) {
      if (types.length) warnings.push(`元件卡 ${id} 没写 physical；沿用内置类型尺寸（${types.join(', ')}）`);
      continue;
    }
    for (const p of validatePhysical(entry.physical, `${id}.physical`)) problems.push(p);
    for (const type of types) {
      const prev = fromEntries.get(type);
      if (prev && !sameJson(prev.physical, entry.physical)) {
        problems.push(`类型 ${type} 在用户卡里有两份不同 physical：${prev.id} / ${id}`);
      }
      fromEntries.set(type, { id, physical: entry.physical });
      physical[type] = entry.physical;
      owners[type] = id;
    }
  }
  return { physical, owners, problems, warnings };
}

/** 某类型的纸面尺寸；未知类型退化为“中心锚点 / 点”，不硬失败。 */
export function geometryFor(sizes, type) {
  return sizes?.[type] ?? UNKNOWN;
}

/** 只把尺寸表里实际给出的字段带进 state，避免 undefined 字段。 */
export function geometryFields(sizes, type) {
  const g = geometryFor(sizes, type);
  const out = {};
  for (const key of ['w', 'h', 'r', 'pointR']) {
    if (typeof g[key] === 'number' && Number.isFinite(g[key])) out[key] = g[key];
  }
  return out;
}
