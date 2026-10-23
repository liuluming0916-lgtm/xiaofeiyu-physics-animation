/**
 * v2 知识卡的尺寸字段（B1'：两层尺寸，都来自卡）。
 *
 * 口径见 `docs/plans/v1.1.18-B契约.md`：
 *   · `size`：**纸面单位**（10×6 纸），跨题一样大，渲染时**不乘 s**；
 *   · `physical`：**物理米**，只给 `analysis` 算“质心离支撑面多高”；
 *   · 场景卡（belt/incline）**不写**这两个字段，尺寸由模型按题自主调配；
 *   · `board` 特例：厚度必填，长度可缺省（由模型在 drawFrame 里给）。
 *
 * 这里只做“一条字段自身是否合法”，不做跨卡覆盖（那是 `core/analysis/geometry.mjs` 的事）。
 */

export const SIZE_SHAPES = Object.freeze([
  'box',
  'circle',
  'belt',
  'incline',
  'line',
  'point',
  'trace',
  'curve',
  'polygon',
  'spring',
]);

export const SIZE_ANCHORS = Object.freeze(['bottom', 'center', 'top']);

/** 每种形状必须给的尺寸字段。`point`/`trace`/`curve`/`polygon`/`spring` 允许只有锚点。 */
export const SIZE_REQUIRED_DIMS = Object.freeze({
  box: ['w', 'h'],
  belt: ['w', 'h'],
  incline: ['w', 'h'],
  line: ['w', 'h'],
  circle: ['r'],
});

const NUMERIC_KEYS = Object.freeze(['w', 'h', 'r', 'pointR', 'minPx']);
const ALL_KEYS = Object.freeze(['anchor', 'shape', 'w', 'h', 'r', 'pointR', 'minPx', 'rotatable']);

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 校验一条卡上的 `size`（纸面单位）。
 *
 * @param {unknown} size
 * @param {string} [where]
 * @param {{ optionalDims?: string[] }} [opts] `board` 的 `w` 可缺省
 * @returns {string[]} 问题清单（空 = 合法）
 */
export function validateSize(size, where = 'size', opts = {}) {
  const optionalDims = Array.isArray(opts.optionalDims) ? opts.optionalDims : [];
  const p = [];
  if (!isObject(size)) return [`${where} 必须是对象`];

  for (const key of Object.keys(size)) {
    if (!ALL_KEYS.includes(key)) p.push(`${where} 含不认识的字段 "${key}"`);
  }
  if (!('anchor' in size)) {
    p.push(`${where} 缺少 anchor（bottom | center | top）`);
  } else if (!SIZE_ANCHORS.includes(size.anchor)) {
    p.push(`${where}.anchor 必须是 ${SIZE_ANCHORS.join(' | ')}`);
  }
  if (!('shape' in size)) {
    p.push(`${where} 缺少 shape`);
  } else if (!SIZE_SHAPES.includes(size.shape)) {
    p.push(`${where}.shape 必须是 ${SIZE_SHAPES.join(' | ')}`);
  }

  for (const key of NUMERIC_KEYS) {
    if (!(key in size)) continue;
    const v = size[key];
    if (key === 'pointR' || key === 'minPx') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) p.push(`${where}.${key} 必须是非负有限数`);
    } else if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      p.push(`${where}.${key} 必须是正有限数`);
    }
  }
  if ('rotatable' in size && typeof size.rotatable !== 'boolean') p.push(`${where}.rotatable 必须是布尔`);

  const required = SIZE_REQUIRED_DIMS[size.shape];
  if (required) {
    for (const key of required) {
      if (!(key in size) && !optionalDims.includes(key)) p.push(`${where} 的 shape=${size.shape} 必须给 ${key}`);
    }
  }
  if (size.shape === 'circle' && !('r' in size)) p.push(`${where} 的 shape=circle 必须给 r`);

  return p;
}

export const PHYSICAL_KEYS = Object.freeze(['w', 'h', 'r']);

/**
 * 校验一条卡上的 `physical`（物理米）。
 *
 * 只约束“数值合法 + 至少给竖直向的尺寸（h 或 r）”——
 * analysis 靠它算“质心离支撑面多高”，没有 h/r 就放不对质心。
 *
 * @param {unknown} physical
 * @param {string} [where]
 * @returns {string[]}
 */
export function validatePhysical(physical, where = 'physical') {
  const p = [];
  if (!isObject(physical)) return [`${where} 必须是对象`];
  for (const key of Object.keys(physical)) {
    if (!PHYSICAL_KEYS.includes(key)) p.push(`${where} 含不认识的字段 "${key}"`);
  }
  for (const key of PHYSICAL_KEYS) {
    if (!(key in physical)) continue;
    const v = physical[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) p.push(`${where}.${key} 必须是正有限数`);
  }
  if (!('h' in physical) && !('r' in physical)) p.push(`${where} 至少要给 h 或 r（analysis 要用它算质心高度）`);
  return p;
}

/** 尺寸对象里真正会进 `state` 的字段（与 `core/analysis/geometry.mjs` 保持一致）。 */
export function sizeDimKeys(size) {
  const out = [];
  for (const key of ['w', 'h', 'r', 'pointR']) {
    if (typeof size?.[key] === 'number' && Number.isFinite(size[key])) out.push(key);
  }
  return out;
}
