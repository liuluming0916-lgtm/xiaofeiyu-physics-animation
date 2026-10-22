/**
 * 视觉几何表（P1）——把“元件类型”映射成“视觉尺寸 + 锚点”。
 *
 * 关键口径（见 docs/plans/坐标与元件卡治理-v1.md）：
 *   · `state.x / y` 是物理接触/参考点；
 *   · 本模块只负责把接触点换算成视觉中心 `cx / cy`；
 *   · 尺寸是**视觉尺寸**，默认值不依赖题面；题面尺寸只服务物理比例。
 *
 * 这里只放 P1 的 5 个元件；P3 再补齐 30 个。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEOMETRY_PATH = join(ROOT, 'contracts', 'element-geometry-v2.json');

const UNKNOWN = Object.freeze({
  anchor: 'center',
  shape: 'point',
  minPx: 0,
  rotatable: false,
});

let cached = null;

function assertGeometry(entry, id) {
  if (!entry || typeof entry !== 'object') throw new Error(`视觉几何 ${id} 不是对象`);
  if (!['bottom', 'center', 'top'].includes(entry.anchor)) {
    throw new Error(`视觉几何 ${id}.anchor 只能是 bottom | center | top`);
  }
  for (const key of ['w', 'h', 'r', 'pointR']) {
    if (entry[key] != null && !(typeof entry[key] === 'number' && Number.isFinite(entry[key]) && entry[key] > 0)) {
      throw new Error(`视觉几何 ${id}.${key} 必须是正数`);
    }
  }
  if (entry.minPx != null && !(typeof entry.minPx === 'number' && Number.isFinite(entry.minPx) && entry.minPx >= 0)) {
    throw new Error(`视觉几何 ${id}.minPx 必须是非负数`);
  }
}

/** 读取一次并缓存；文件坏了直接抛，不静默退化。 */
export function loadElementGeometry() {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(GEOMETRY_PATH, 'utf8'));
  if (raw?.format !== 'od-element-geometry') throw new Error('视觉几何表 format 不是 od-element-geometry');
  if (!(raw.version >= 1)) throw new Error('视觉几何表 version 非法');
  if (!raw.elements || typeof raw.elements !== 'object') throw new Error('视觉几何表缺少 elements');
  for (const [id, entry] of Object.entries(raw.elements)) assertGeometry(entry, id);
  cached = raw.elements;
  return cached;
}

/** 未知类型退化为“中心 = 接触点”，不阻断旧数据。 */
export function geometryFor(type) {
  const all = loadElementGeometry();
  return all[type] ?? UNKNOWN;
}

/** 只把视觉表里实际给出的字段带进 state，避免 undefined 字段。 */
export function geometryFields(type) {
  const g = geometryFor(type);
  const out = {};
  for (const key of ['w', 'h', 'r', 'pointR']) {
    if (typeof g[key] === 'number' && Number.isFinite(g[key])) out[key] = g[key];
  }
  return out;
}

/**
 * 接触点 → 视觉中心的偏移。
 * 只处理 P1 需要的 box / circle；belt/incline 目前不进 MOTIONS。
 */
export function centerOffset(type) {
  const g = geometryFor(type);
  const w = Number.isFinite(g.w) ? g.w : 0;
  const h = Number.isFinite(g.h) ? g.h : 0;
  const r = Number.isFinite(g.r) ? g.r : 0;

  if (g.anchor === 'center') return { dx: 0, dy: 0, g };
  if (g.anchor === 'top') {
    if (g.shape === 'circle') return { dx: 0, dy: -r, g };
    return { dx: 0, dy: -h / 2, g };
  }
  // bottom
  if (g.shape === 'circle') return { dx: 0, dy: r, g };
  return { dx: w / 2, dy: h / 2, g };
}

export const ELEMENT_GEOMETRY_PATH = GEOMETRY_PATH;
