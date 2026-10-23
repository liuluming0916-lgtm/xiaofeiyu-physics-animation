/**
 * 元件的**物理**尺寸表（`physical`，物理米）—— 只给 `analysis` 用。
 *
 * 用途只有一个：算接触点/质心高度（`y0`）。**不参与绘制**：
 * 画多大由 `drawFrame` 自己定（2026-10-24 用户裁决），
 * 所以这张表不再喂给 `state.w/h/r`。
 *
 * 校验策略：
 *   · 内置卡表启动时构建并硬校验（缺 `physical` / 冲突 ⇒ 明确抛错）；
 *   · 运行期用「本题快照的卡」叠加；用户卡漏写尺寸时**告警并沿用内置类型尺寸**；
 *   · 未知类型退化为“没有尺寸”，不阻断旧数据。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePhysical } from '../knowledgecard/v2/size.mjs';

/**
 * 元件"给定点代表哪个部位"（2026-10-24 回滚动画契约后新增）。
 *
 * 只表达**语义**，不含任何尺寸：`state.<key>.cx / .cy` 是 analysis 给出的那个点，
 * 模型必须知道它是底面、中点还是顶端，否则物块会一半陷进带子里。
 *
 * 尺寸已经交给 `drawFrame` 自己定了，所以这里没有 `w/h/r` ——
 * 原来的 `contracts/element-geometry-v2.json`（"视觉尺寸 + 锚点"表）已随之删除。
 */
export const ANCHOR_BY_TYPE = Object.freeze({
  block: 'bottom',
  board: 'bottom',
  ball: 'bottom',
  incline: 'bottom',
  belt: 'top',
  piston: 'bottom',
  conductor_rod: 'center',
  light_rod: 'center',
  spring: 'center',
  rope: 'center',
  trace_path: 'center',
  mercury: 'center',
});

/** 未知类型退化为"中心"，不让新元件直接报错。 */
export function anchorForType(type) {
  return ANCHOR_BY_TYPE[type] ?? 'center';
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILTIN_CARDS_PATH = join(ROOT, 'core', 'knowledgecard', 'data-v2', '93-elements.json');

let builtinCache = null;
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

/** 内置卡物理尺寸表（进程内缓存 + 硬校验）。 */
export function builtinPhysicalTable() {
  if (builtinCache) return builtinCache;
  const table = physicalTableFromCards(builtinCardEntries());
  if (table.problems.length) {
    throw new Error(`内置元件卡 physical 不可用（卡是唯一来源）：\n- ${table.problems.join('\n- ')}`);
  }
  const out = Object.freeze({
    physical: Object.freeze({ ...table.physical }),
    owners: Object.freeze({ ...table.owners }),
  });
  builtinCache = out;
  return out;
}

/**
 * 运行期：本题快照卡 → 物理尺寸表。
 *
 * 先取内置表（保证总有尺寸），再用传入卡的 `physical` 覆盖同类型；
 * 用户卡漏写 `physical` ⇒ warning（沿用内置类型尺寸，不静默造表）。
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

/** 某类型的物理尺寸；未知类型退化为“没有尺寸”，不硬失败。 */
export function geometryFor(physical, type) {
  return physical?.[type] ?? {};
}

/** 只把尺寸表里实际给出的字段带进 state，避免 undefined 字段。 */
export function geometryFields(physical, type) {
  const g = geometryFor(physical, type);
  const out = {};
  for (const key of ['w', 'h', 'r']) {
    if (typeof g[key] === 'number' && Number.isFinite(g[key])) out[key] = g[key];
  }
  return out;
}
