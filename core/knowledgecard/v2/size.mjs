/**
 * v2 知识卡的尺寸字段（C 方案：**physical 是唯一尺寸来源**）。
 *
 * 口径见 `docs/plans/v1.1.18-B契约.md`：
 *   · `physical`：**物理米**（w/h/r），渲染时乘舞台比例 `s`；题面没给尺寸时用卡里的默认值；
 *   · `size`：只剩**形状与是否可转**（教学用），不再存任何数字尺寸；
 *   · 场景卡（belt/incline/ground …）不写尺寸，由模型按题面几何画；
 *   · 可见性由渲染层的 `MIN_PX`（像素下限）兜底，与卡无关。
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

const SIZE_KEYS = Object.freeze(['shape', 'rotatable']);
export const PHYSICAL_KEYS = Object.freeze(['w', 'h', 'r']);

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 校验一条卡上的 `size`（现在只表达形状，不再有数字）。
 *
 * @param {unknown} size
 * @param {string} [where]
 * @returns {string[]}
 */
export function validateSize(size, where = 'size') {
  const p = [];
  if (!isObject(size)) return [`${where} 必须是对象`];
  for (const key of Object.keys(size)) {
    if (!SIZE_KEYS.includes(key)) p.push(`${where} 含不认识的字段 "${key}"（尺寸数字请写在 physical）`);
  }
  if (!('shape' in size)) p.push(`${where} 缺少 shape`);
  else if (!SIZE_SHAPES.includes(size.shape)) p.push(`${where}.shape 必须是 ${SIZE_SHAPES.join(' | ')}`);
  if ('rotatable' in size && typeof size.rotatable !== 'boolean') p.push(`${where}.rotatable 必须是布尔`);
  return p;
}

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
