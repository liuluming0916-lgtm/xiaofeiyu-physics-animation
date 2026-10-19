/**
 * 物理解题动画 · 动画内核运行时（Runtime）
 *
 * 一个文件、一份实现，同时被三处使用（§5.2 三个消费者共用一套记录）：
 *   1. 模板页（浏览器，内联进 HTML）；
 *   2. Dry-Run（Node，切分后的 8 键名代码在 vm 里跑，只计数不画）；
 *   3. 导出渲帧（OffscreenCanvas 回放，第 7 期）。
 *
 * 硬性边界（§4.1 / §6 / §21.2）：
 *   · 模型的槽位代码**拿不到 ctx**，只能通过 `Draw.*` 向命令缓冲推记录；
 *   · SDK 函数参数只能是几何量或纯数值，**不得出现物理语义**（物理语义是模型自己的事）；
 *   · 运行时自身不访问 DOM / window / 网络 / 文件；浏览器侧适配在 `createCanvasRenderer` 里，
 *     由模板页在装配时注入 canvas 与 requestAnimationFrame。
 *
 * 世界坐标系约定：右手系，x 向右、y 向上，单位米；屏幕渲染时按 `transform.scale` 翻转到 Canvas 的 y 向下。
 */

/* ───────────────────────────── 基础工具 ───────────────────────────── */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function assertFiniteNumber(v, where) {
  if (!isFiniteNumber(v)) throw new TypeError(`${where} 必须是有限数值，收到 ${String(v)}`);
}

/**
 * 虚线样式（v1.1.5 用户 2026-10-19 定稿）：
 *   · `true`  → 默认虚线 `[4, 3]`（模型最自然的写法）
 *   · `false` / `null` / 不写 → 实线（记录里存 `null`）
 *   · 数字数组 → 自定义虚线间距（只接受有限正数；空数组 = 实线）
 *   · 其它类型（字符串、数字、对象…）→ 抛 TypeError，由 C1 / Dry-Run 报出来。
 *
 * 为什么必须在这里做：真实浏览器的 `setLineDash` 只收 `sequence<number>`，
 * 传 `true` 会抛 TypeError，整帧直接中断（用户实测：页面停在 0.00 / 0.00）。
 * 只靠"模型记住数组写法"是不够的 —— 约定要由 API 兜住，并在门禁里报错。
 */
function parseDash(dash, where) {
  if (dash === undefined || dash === null || dash === false) return null;
  if (dash === true) return [4, 3];
  if (Array.isArray(dash)) {
    if (!dash.length) return null;
    return dash.map((v, i) => {
      if (!isFiniteNumber(v) || v <= 0) {
        throw new TypeError(`${where}.dash[${i}] 必须是有限正数（当前 ${String(v)}）`);
      }
      return v;
    });
  }
  throw new TypeError(
    `${where}.dash 只接受 true（虚线）/ false（实线）/ 数字数组（自定义间距）；当前是 ${typeof dash}: ${String(dash)}`,
  );
}

function toPoint(p, where) {
  if (Array.isArray(p)) {
    assertFiniteNumber(p[0], `${where}[0]`);
    assertFiniteNumber(p[1], `${where}[1]`);
    return { x: p[0], y: p[1] };
  }
  if (p && typeof p === 'object') {
    assertFiniteNumber(p.x, `${where}.x`);
    assertFiniteNumber(p.y, `${where}.y`);
    return { x: p.x, y: p.y };
  }
  throw new TypeError(`${where} 必须是 [x,y] 或 {x,y}`);
}

/** 与 §5.1 记录结构对齐的默认样式（唯一允许出现颜色字面量的地方） */
export const DEFAULT_THEME = Object.freeze({
  bg: '#f7f8f9',
  grid: 'rgba(31,42,52,0.10)',
  gridStrong: 'rgba(31,42,52,0.22)',
  body: '#2b3440',
  bodySoft: 'rgba(43,52,64,0.16)',
  surface: '#ffffff',
  text: '#1d2733',
  textMuted: '#5d6b7a',
  accent: '#2a6f8f',
  accentSoft: 'rgba(42,111,143,0.14)',
  velocity: '#2e7d32',
  acceleration: '#15529e',
  force: '#b3382f',
  aux: '#6b5aa6',
  light: '#c9a227',
  field: '#3a4a5a',
  guide: '#9aa7b4',
  match: '#20794f',
});

export const VECTOR_COLORS = Object.freeze({
  velocity: DEFAULT_THEME.velocity,
  acceleration: DEFAULT_THEME.acceleration,
  force: DEFAULT_THEME.force,
  aux: DEFAULT_THEME.aux,
});

/* ───────────────────────── 命令缓冲（§5.1） ───────────────────────── */

/** 全部 op 种类；渲染器与 Dry-Run 都按这张表分派 */
export const OP_KINDS = Object.freeze([
  'line',
  'arrow',
  'polygon',
  'circle',
  'spring',
  'pulley',
  'belt',
  'fieldDots',
  'dimension',
  'arc',
  'curve',
  'ray',
  'lens',
  'axisBox',
  'chart',
  'text',
  'latex',
  'raw',
]);

/**
 * 参与 AutoView 包络计算的 op（§4.6：包络来自命令缓冲，不是模型声明的轨迹）。
 *
 * ⚠ 有意排除 `axisBox` / `chart`：这两个原语的坐标属于**独立的数据域**（p–V 图、v–t 图），
 * 与主画面的物理世界坐标不同量纲。若把它们计入同一个包络盒，主画面会被压到很小
 * （实测 2.5×1.75 的图框会把几何体缩小到原来的 ~45%）。
 * 因此第 1 期的口径是：**图表/轴框作为"图内嵌板"存在，由模型用 Draw.line / Draw.text
 * 自己压住图区即可进入包络**（§19.5 的 07 / 09 / 10 / 12 / 13 题都是这么写的）。
 * 如需"图框自动参与取景"，属 §22 的模板能力扩展，待用户裁决后再改。
 */
const ENVELOPE_OPS = Object.freeze([
  'line',
  'arrow',
  'polygon',
  'circle',
  'spring',
  'pulley',
  'belt',
  'fieldDots',
  'dimension',
  'arc',
  'curve',
  'ray',
  'lens',
  'text',
  'latex',
]);

/**
 * 画布上的文字字体（第 8 期 · 用户 2026-10-17 定案：
 * 「汉字宋体、英文与数字 Times New Roman」）。
 *
 * `Times New Roman` 在前、`SimSun` 在后 —— canvas 的 `font` 也是**逐字符**回退：
 * 拉丁字母与数字用 Times，汉字回退到宋体。反过来写的话，
 * 宋体自带的拉丁字形会顶掉 Times，用户要的效果就没了。
 *
 * ⚠ 字体名带空格**必须加引号**。不加引号整串无效、静默回退默认字体，
 *   肉眼几乎看不出来（只是"字变宽了一点"）—— 所以门禁 ㊱ 会钉住这串字面量。
 */
export const LABEL_FONT_FAMILY = '"Times New Roman", "SimSun", STSong, serif';

/**
 * ── 方案 A：画布上**不再画任何文字**（用户 2026-10-17 拍板）──
 *
 * 为什么下这个狠手：文字挤在一起不是排版问题，是**信息重复**问题。
 * 实测数据（15 道回归题）：
 *   · 91% 的"文字"是模型每帧画的**数值读数**（`E = 0.217 V`），
 *     而这些数值在图表游标与宿主页的读数表里**本来就有**；
 *   · 矢量标签（`v₁ = 3.71 m/s`）由渲染器自己按箭头中点算位置，
 *     它不经过避让表，所以永远"跟着箭头跑、撞上别的字"；
 *   · 剩下的说明句（`球 1：沿连线方向 + 切向分解`）在左栏解析里**已经写过一遍**。
 *
 * 所以画布只留**物理元件 + 矢量**；矢量靠**颜色 + 长度**区分（见 `DEFAULT_THEME`），
 * 颜色含义由**画布外**的图例说明（`template` 里的 `data-od-id="vector-legend"`）。
 *
 * 这条开关是"一处关掉全部"：`text` / `latex` / 箭头 `label` / 尺寸标注 `text`
 * 四处一起失效 —— 分散在四个地方的开关一定会漏一个。
 *
 * ⚠ 代价（已与用户确认）：`q15` 纯符号题的画面会变"没有字"，
 *   它的考点（符号标注）现在只能靠左栏解析读。
 */
export const HIDE_CANVAS_TEXT = true;

/**
 * 唯一例外：**坐标轴的轴名**（`Draw.axisBox` 的 `xLabel` / `yLabel`）。
 *
 * 为什么不能一起删：`p–V` 图少了 `p` 和 `V` 就**不是一张图**了 ——
 * 那是坐标轴固有的一部分，不是"说明"。而且它没有数字、也不会挤。
 * 要连它也删，把这里改成 `false` 即可（门禁 ㊲ 会跟着改断言）。
 */
export const KEEP_AXIS_LABELS = true;

/**
 * 每一类的**满量程长度（像素）**——即"该类量级最大的那根箭头画多长"。
 *
 * 比例沿用 70 : 60 : 50 : 55（力 : 速度 : 加速度 : 辅助），但**整体放大到约 1.85 倍**：
 * 用户 2026-10-17 实测"60 像素放在 960 像素宽的画布上只有 6%，太小"。
 * 现在速度满量程 = 110px ≈ 画面宽的 11.5%、高的 20%，肉眼看得出量级差别。
 *
 * 像素只在**名义视口 960×540** 下换算成世界单位，实际画布尺寸不同时按相机比例自动缩放。
 */
export const VECTOR_TARGET_PX = Object.freeze({
  force: 130,
  velocity: 110,
  acceleration: 95,
  aux: 105,
});

/**
 * 箭头**最长不超过视口短边的这个比例**（防出画面）。
 *
 * 为什么需要：箭头已经**不再参与取景**（见 `computeFramingPlan`），所以极端情况下
 * （量级很大、画面很小）它可能戳出画布被裁掉。这里给一个上限，
 * 超过就按画面收缩 —— 图例里写明了这一点，不算偷偷撒谎。
 */
export const ARROW_MAX_VIEWPORT_RATIO = 0.45;

/** 名义视口（与导出的 GIF 定案一致，§14） */
export const NOMINAL_VIEWPORT = Object.freeze({ width: 960, height: 540 });

/**
 * 保底口径：极端场景（包络退化、相机算不出来）时退回"画面短边的分数"。
 * 只在 `nominalScale` 不可用时用，正常路径走像素那一套。
 */
export const VECTOR_TARGET_RATIO = Object.freeze({
  force: 0.18,
  velocity: 0.155,
  acceleration: 0.13,
  aux: 0.14,
});

/**
 * 短于这么多像素的箭头**画成一个点**（"此刻为零/极小"是真实信息，不能拉长成假箭头）。
 * 注意这与"过短的放大到可见长度"是两件事：后者会撒谎，已被用户否掉。
 */
export const ARROW_MIN_PX = 4;

/** 箭头的方向（单位向量）。零矢量返回 [0,0]。 */
export function arrowDirection(rec) {
  const vx = rec?.vec?.[0] ?? 0;
  const vy = rec?.vec?.[1] ?? 0;
  const len = Math.hypot(vx, vy);
  if (!(len > 0)) return [0, 0];
  return [vx / len, vy / len];
}

/**
 * 箭头的**量级**：优先 `mag`（真实物理量），没有才退回 `|vec|`。
 *
 * `mag` 是契约要求的（门禁 C1 会检查）；退回 `|vec|` 只是过渡期兜底，
 * 让老代码还能播，但**同类之间不一定可比**（不同题可能把系数乘进 vec 里）。
 */
export function arrowMagnitude(rec) {
  if (typeof rec?.mag === 'number' && Number.isFinite(rec.mag)) return Math.abs(rec.mag);
  const vx = rec?.vec?.[0] ?? 0;
  const vy = rec?.vec?.[1] ?? 0;
  return Math.hypot(vx, vy);
}

/**
 * 箭头在**屏幕上**的长度（像素）—— 第 8 期最终口径。
 *
 *     长度(px) = 该类满量程(px) × (该箭头量级 ÷ 该类整段最大量级)
 *
 * 为什么最后改成"直接算像素"：
 *   之前先换算成世界单位、再乘相机 —— 但**名义视口**（960×540）与**实际画布**的
 *   相机比例并不相同（实测 90 vs 64.7 px/单位），于是"130px"实际只画到 93px，
 *   数字对不上。箭头既然不参与取景，就没有必要经过世界单位，直接按像素算最准。
 *
 * @param {object} rec 箭头记录
 * @param {Record<string, number>} vectorMax 每类的整段最大量级
 * @returns {number} 像素长度（量级为 0 / 没有参考时返回 0）
 */
export function arrowLengthPx(rec, vectorMax) {
  const mag = arrowMagnitude(rec);
  if (!(mag > 0)) return 0;
  const cat = rec?.category ?? 'aux';
  const max = vectorMax?.[cat];
  const target = VECTOR_TARGET_PX[cat] ?? 100;
  if (!(max > 0)) return 0;
  return (target * mag) / max;
}

/**
 * 箭头在**世界坐标**里的长度（保留给包络与旧调用方）。
 *
 * `vectorScale[category]` = "该类 1 单位量级对应多少世界单位"。
 * 没给时退回旧口径 `|vec| × scale`（单帧渲染 / 老调用方），保证不炸。
 */
export function arrowWorldLength(rec, vectorScale) {
  const mag = arrowMagnitude(rec);
  const k = vectorScale?.[rec?.category];
  if (typeof k === 'number' && Number.isFinite(k) && k > 0) return mag * k;
  const vx = rec?.vec?.[0] ?? 0;
  const vy = rec?.vec?.[1] ?? 0;
  return Math.hypot(vx, vy) * (rec?.scale ?? 1);
}

/**
 * 命令缓冲。`drawFrame` 只能经 `Draw.*` 往这里推记录；
 * Dry-Run 只做计数与数值检查，实时播放与导出渲帧把它回放到 Canvas。
 */
export class CommandBuffer {
  constructor() {
    this.reset();
  }

  reset() {
    /** @type {Array<object>} */
    this.records = [];
    this.droppedRaw = 0;
  }

  push(record) {
    this.records.push(record);
    return record;
  }

  get length() {
    return this.records.length;
  }

  /** 按 op 计数（§7.2 C9 每帧命令数有界的输入） */
  countByOp() {
    const counts = Object.create(null);
    for (const r of this.records) counts[r.op] = (counts[r.op] || 0) + 1;
    return counts;
  }

  /** `Draw.raw` 使用率（§5.4 / §19.1：<10% 说明 SDK 够用，>10% 说明该扩编） */
  rawUsage() {
    if (!this.records.length) return 0;
    const raw = this.records.filter((r) => r.op === 'raw').length;
    return raw / this.records.length;
  }

  /**
   * 世界坐标包络盒。§5.4：`Draw.raw` 不参与包络计算，但不放弃整帧门禁。
   *
   * 第 8 期加了两个**可选**参数（默认行为与之前逐字一致）：
   *   · `excludeOps`：算包络时跳过这些 op。`computeFramingPlan` 的第一遍用它
   *     把 `arrow` 排除掉 —— 否则"箭头长度 ← 相机 ← 包络 ← 箭头长度"会形成死循环。
   *   · `vectorScale`：按类归一的换算比（`arrowWorldLength` 用它），
   *     保证**包络里的箭头长度 == 画出来的箭头长度**（两份口径不一致会让相机跳）。
   *
   * @param {{ excludeOps?: Set<string>|string[], vectorScale?: Record<string, number>|null }} [opts]
   * @returns {{minX:number,minY:number,maxX:number,maxY:number}|null}
   */
  envelope(opts = {}) {
    const exclude = opts.excludeOps instanceof Set ? opts.excludeOps : new Set(opts.excludeOps ?? []);
    /** 第 8 期：可选的"逐条跳过"谓词（取景要排除参考面/标注，见 `computeFramingPlan`） */
    const skip = typeof opts.skip === 'function' ? opts.skip : null;
    const vectorScale = opts.vectorScale ?? null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (x, y) => {
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) return;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };

    for (const r of this.records) {
      if (!ENVELOPE_OPS.includes(r.op)) continue;
      if (exclude.has(r.op)) continue;
      if (skip && skip(r)) continue;
      switch (r.op) {
        case 'line':
        case 'dimension':
        case 'arc':
        case 'ray':
        case 'lens':
          add(r.x1, r.y1);
          add(r.x2, r.y2);
          break;
        case 'arrow': {
          /**
           * 第 8 期：包络里的箭头长度必须与**画出来的**一致，所以走同一个换算函数
           * （`arrowWorldLength`）。不一致的后果很隐蔽：相机按"箭头很长"取景，
           * 而实际画得很短 ⇒ 整幅画面被缩小一圈，谁也说不出为什么。
           */
          add(r.from[0], r.from[1]);
          const [adx, ady] = arrowDirection(r);
          const alen = arrowWorldLength(r, vectorScale);
          add(r.from[0] + adx * alen, r.from[1] + ady * alen);
          break;
        }
        case 'polygon':
        case 'curve':
          for (const [x, y] of r.points) add(x, y);
          break;
        case 'circle':
          add(r.cx - r.r, r.cy - r.r);
          add(r.cx + r.r, r.cy + r.r);
          break;
        case 'spring':
        case 'belt':
          add(r.a[0], r.a[1]);
          add(r.b[0], r.b[1]);
          break;
        case 'pulley':
          add(r.c[0] - r.r, r.c[1] - r.r);
          add(r.c[0] + r.r, r.c[1] + r.r);
          break;
        case 'fieldDots':
          add(r.x, r.y);
          add(r.x + r.w, r.y + r.h);
          break;
        case 'text':
        case 'latex':
          add(r.x, r.y);
          if (isFiniteNumber(r.leaderTo?.[0])) add(r.leaderTo[0], r.leaderTo[1]);
          break;
        default:
          break;
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return { minX, minY, maxX, maxY };
  }
}

/* ────────────────────────────── 物理计算辅助 ────────────────────────────── */

/** 通用 RK45 积分（§4.3）。放在 setup() 内使用——§7.6 架构不变量。 */
export function integrate(state0, deriv, t0, t1, opts = {}) {
  const dt = opts.dt ?? (t1 - t0) / 400;
  const samples = [];
  let t = t0;
  let y = Array.isArray(state0) ? state0.slice() : { ...state0 };
  const step = (tn, yn, h) => rk45Step(tn, yn, h, deriv);

  while (t < t1 - 1e-12) {
    const h = Math.min(dt, t1 - t);
    if (opts.record !== false) samples.push({ t, y: Array.isArray(y) ? y.slice() : { ...y } });
    const next = step(t, y, h);
    t += h;
    y = next;
  }
  if (opts.record !== false) samples.push({ t: t1, y: Array.isArray(y) ? y.slice() : { ...y } });
  return { samples, stateAt: () => y };
}

function rk45Step(t, y, h, deriv) {
  const add = (a, b, k) =>
    Array.isArray(a) ? a.map((v, i) => v + k * b[i]) : Object.fromEntries(Object.keys(a).map((key) => [key, a[key] + k * b[key]]));
  const k1 = deriv(t, y);
  const k2 = deriv(t + h / 2, add(y, k1, h / 2));
  const k3 = deriv(t + h / 2, add(y, k2, h / 2));
  const k4 = deriv(t + h, add(y, k3, h));
  const w = [1 / 6, 1 / 3, 1 / 3, 1 / 6];
  const ks = [k1, k2, k3, k4];
  if (Array.isArray(y)) {
    return y.map((v, i) => v + h * ks.reduce((acc, k, j) => acc + w[j] * k[i], 0));
  }
  return Object.fromEntries(
    Object.keys(y).map((key) => [key, y[key] + h * ks.reduce((acc, k, j) => acc + w[j] * k[key], 0)]),
  );
}

/** 采样表线性/单调插值（§4.3）。O(log n)，可在 stateAt 内安全使用。 */
export function interp(samples, t, key) {
  if (!samples.length) return NaN;
  if (t <= samples[0].t) return pick(samples[0], key);
  const last = samples[samples.length - 1];
  if (t >= last.t) return pick(last, key);

  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const va = pick(a, key);
  const vb = pick(b, key);
  const span = b.t - a.t;
  if (span <= 0) return vb;
  const u = (t - a.t) / span;
  return va + (vb - va) * u;
}

function pick(sample, key) {
  if (key === undefined) return sample.y;
  return Array.isArray(sample.y) ? sample.y[key] : sample.y[key];
}

/** 单调区间求根（二分）。O(log(1/eps))，可在 stateAt 内使用。 */
export function roots(fn, a, b, opts = {}) {
  const eps = opts.eps ?? 1e-9;
  const maxIter = opts.maxIter ?? 80;
  let fa = fn(a);
  let fb = fn(b);
  const out = [];
  if (Math.abs(fa) < eps) out.push(a);
  if (fa * fb > 0) return out;
  let lo = a;
  let hi = b;
  for (let i = 0; i < maxIter && hi - lo > eps; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = fn(mid);
    if (Math.abs(fm) < eps) {
      lo = mid;
      hi = mid;
      break;
    }
    if (fa * fm <= 0) {
      hi = mid;
      fb = fm;
    } else {
      lo = mid;
      fa = fm;
    }
  }
  out.push((lo + hi) / 2);
  return out;
}

/** 有效数字格式化（§4.3），固定 3 位有效数字，避免读出栏跳位 */
export function format(value, unit = '', sigFig = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const av = Math.abs(value);
  let text;
  if (av !== 0 && (av >= 1e6 || av < 1e-3)) {
    text = value.toExponential(Math.max(0, sigFig - 1));
  } else {
    const digits = Math.max(0, sigFig - 1 - Math.floor(Math.log10(av === 0 ? 1 : av)));
    text = value.toFixed(Math.min(6, digits));
    if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  }
  return unit ? `${text} ${unit}` : text;
}

/* ───────────────────────── AutoView（§4.6 两遍法） ───────────────────────── */

function niceStep(raw) {
  const exp = Math.floor(Math.log10(raw));
  const base = raw / 10 ** exp;
  const nice = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

export const AutoView = {
  /**
   * 从命令缓冲包络算安全边距 + Nice Numbers 缩放，得到最终世界→屏幕变换。
   * 模型零负担：包络来自命令缓冲，不是模型声明的轨迹。
   */
  fit(envelope, viewport, opts = {}) {
    const padding = opts.padding ?? 0.14;
    const minSpan = opts.minSpan ?? 1e-3;
    const vw = Math.max(1, viewport.width);
    const vh = Math.max(1, viewport.height);

    let { minX, minY, maxX, maxY } = envelope ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    let spanX = Math.max(maxX - minX, minSpan);
    let spanY = Math.max(maxY - minY, minSpan);

    // 等比缩放，两侧都留边距
    const usableW = vw * (1 - 2 * padding);
    const usableH = vh * (1 - 2 * padding);
    const scale = Math.min(usableW / spanX, usableH / spanY);

    /**
     * ── 第 8 期修正：Nice Numbers **只用于网格步长，不许决定画幅** ──
     *
     * 旧实现把世界跨度向上吸附到 1/2/5×10ⁿ，再用吸附后的跨度重算比例。
     * 因为 `niceSpan ≥ 真实跨度` **恒成立**，所以这个比例**只会更小**，等于系统性缩小画面：
     *
     *   实测（用户真题 export-20261018-020114-067，视口 960×540）
     *     理想 150.9 px/m → 吸附后 90.0 px/m ⇒ 白扔 40%；2 m 的木板从 302 px 掉到 180 px
     *   另一视口（1240×280）更糟：145.0 → 77.5，扔 47%
     *
     * 于是"为了让画面更规整"，把学生要看的实物缩小了一半 —— 这是**主次颠倒**：
     * 网格整不整齐是次要的，物体看不清是致命的。
     * 现在：`finalScale` 直接取理想 fit；`niceX/niceY` 只作为**网格步长提示**返回
     * （渲染层自己的 `niceStep` 负责画网格，见 `template/animation-template.html`）。
     */
    const worldSpanX = vw / scale;
    const worldSpanY = vh / scale;
    const niceX = niceStep(worldSpanX / 8) * 8;
    const niceY = niceStep(worldSpanY / 6) * 6;
    /** 旧口径（吸附后的比例）。保留只为让"我们扔了多少"可被测到，**不再参与变换** */
    const niceFit = Math.min(vw / niceX, vh / niceY);
    const finalScale = scale;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    return {
      scale: finalScale,
      /** 网格步长提示（世界单位）；渲染层可据此画规整网格，不影响画幅 */
      gridX: niceX,
      gridY: niceY,
      niceFit,
      centerX: cx,
      centerY: cy,
      minX,
      minY,
      maxX,
      maxY,
      padding,
      width: vw,
      height: vh,
      /** 世界坐标 → 屏幕像素 */
      worldToScreen(x, y) {
        return {
          x: vw / 2 + (x - cx) * finalScale,
          y: vh / 2 - (y - cy) * finalScale,
        };
      },
    };
  },
};

/* ──────────────────────────── Draw（§4.2 Layer 1） ──────────────────────────── */

/**
 * 教具原语。参数一律是几何量或纯数值；**不允许出现物理量名**（§4.1）。
 * 每个方法返回推入的命令记录，便于 Dry-Run 与单测断言。
 */
export class Draw {
  constructor(buffer, opts = {}) {
    this.buffer = buffer;
    this.theme = opts.theme ?? DEFAULT_THEME;
    this.by = opts.by ?? '模型';
  }

  _push(record) {
    return this.buffer.push(record);
  }

  _color(style, fallback = this.theme.body) {
    if (!style) return fallback;
    if (typeof style === 'string') return style;
    if (style.stroke) return style.stroke;
    if (style.fill) return style.fill;
    return fallback;
  }

  /* —— 基本几何 —— */

  line(a, b, style) {
    const p = toPoint(a, 'Draw.line(a)');
    const q = toPoint(b, 'Draw.line(b)');
    return this._push({
      op: 'line',
      x1: p.x,
      y1: p.y,
      x2: q.x,
      y2: q.y,
      dash: parseDash(style?.dash, 'Draw.line(style)'),
      width: style?.width ?? 1.6,
      color: this._color(style),
      layer: 0,
    });
  }

  /**
   * 分类矢量箭头（§5.3）。`category` 决定颜色与前端分组开关。
   *
   * ── 第 8 期契约收紧（用户 2026-10-17 拍板）──
   *   · **不再接受 `color`**：颜色由 `category` 唯一决定（绿=速度/蓝=加速度/红=受力）。
   *     写死的颜色会让同一类量在不同题里颜色不同，学生形成不了稳定认知；
   *     所以这里**根本不把 color 放进记录** —— 渲染器没有"覆盖调用方参数"这回事。
   *   · **长度不再看 `scale`**：长度由 `mag` 与该类的整段最大值归一（见 `computeFramingPlan`）。
   *     `scale` 仍然记下来，只为单帧渲染（没算过归一比例时）的兜底，**正常播放不会用到它**。
   *   · `mag` 是**必填**的语义（真实量级）。缺了会退回 `|vec|` 兜底，但那样同类之间不一定可比；
   *     C1 静态预检负责把"没给 mag"报出来。
   */
  arrow(from, vec, opts = {}) {
    const p = toPoint(from, 'Draw.arrow(from)');
    const v = toPoint(vec, 'Draw.arrow(vec)');
    const category = opts.category ?? 'aux';
    if (!(category in VECTOR_COLORS)) {
      throw new RangeError(`Draw.arrow(category) 未登记：${category}（§5.3 至少覆盖 velocity/acceleration/force）`);
    }
    return this._push({
      op: 'arrow',
      from: [p.x, p.y],
      vec: [v.x, v.y],
      mag: opts.mag ?? null,
      unit: opts.unit ?? null,
      scale: opts.scale ?? 1,
      category,
      subtype: opts.subtype ?? null,
      label: opts.label ?? null,
      /**
       * §3.4 / §18 期 3：`SYMBOLIC` 模式下画布标注要**用符号**。
       * `latex` 给的是**画布可直接绘制的符号文本**（如 `v₀`、`F_A`），不是完整 LaTeX 源码 ——
       * canvas 的 `fillText` 不认识 `\frac` 这类命令。
       * 未提供时回落到 `label` + 数值（NUMERIC 模式的原有行为，一字未改）。
       */
      latex: opts.latex ?? null,
      color: opts.color ?? VECTOR_COLORS[category],
      headAt: opts.headAt ?? null,
      layer: opts.layer ?? 1,
    });
  }

  polygon(points, style = {}) {
    const pts = points.map((p, i) => {
      const q = toPoint(p, `Draw.polygon(points[${i}])`);
      return [q.x, q.y];
    });
    return this._push({
      op: 'polygon',
      points: pts,
      fill: style.fill ?? null,
      hatch: style.hatch ?? null,
      stroke: style.stroke ?? null,
      width: style.width ?? 1.4,
      closed: style.closed !== false,
      layer: style.layer ?? 0,
    });
  }

  circle(center, r, style = {}) {
    const c = toPoint(center, 'Draw.circle(center)');
    assertFiniteNumber(r, 'Draw.circle(r)');
    return this._push({
      op: 'circle',
      cx: c.x,
      cy: c.y,
      r,
      fill: style.fill ?? null,
      stroke: style.stroke ?? null,
      width: style.width ?? 1.4,
      dash: parseDash(style.dash, 'Draw.circle(style)'),
      angleDeg: style.angleDeg ?? null,
      layer: style.layer ?? 0,
    });
  }

  /** 随动弹簧：跟随两端锚点自动定形（§4.2） */
  spring(a, b, opts = {}) {
    const p = toPoint(a, 'Draw.spring(a)');
    const q = toPoint(b, 'Draw.spring(b)');
    return this._push({
      op: 'spring',
      a: [p.x, p.y],
      b: [q.x, q.y],
      coils: opts.coils ?? 12,
      amplitude: opts.amplitude ?? 0.12,
      restLength: opts.restLength ?? null,
      length: opts.length ?? null,
      color: opts.color ?? this.theme.body,
      layer: opts.layer ?? 1,
    });
  }

  /** 滑轮：圆心 + 半径 + 可选轮轴 */
  pulley(center, r, opts = {}) {
    const c = toPoint(center, 'Draw.pulley(center)');
    assertFiniteNumber(r, 'Draw.pulley(r)');
    return this._push({
      op: 'pulley',
      c: [c.x, c.y],
      r,
      hub: opts.hub ?? true,
      color: opts.color ?? this.theme.body,
      layer: opts.layer ?? 1,
    });
  }

  /** 传送带 / 履带：两端滚轮 + 上下带面 + 可选表面刻度（表达"随带运动"） */
  belt(a, b, opts = {}) {
    const p = toPoint(a, 'Draw.belt(a)');
    const q = toPoint(b, 'Draw.belt(b)');
    return this._push({
      op: 'belt',
      a: [p.x, p.y],
      b: [q.x, q.y],
      r: opts.r ?? 0.12,
      ticks: opts.ticks ?? 0,
      tickPhase: opts.tickPhase ?? 0,
      arrowDir: opts.arrowDir ?? 1,
      color: opts.color ?? this.theme.body,
      layer: opts.layer ?? 1,
    });
  }

  /** 均匀场点/叉阵列（§4.2 特殊渲染需求：磁场区必须铺满 ×/·） */
  fieldDots(rect, opts = {}) {
    const o = toPoint(rect, 'Draw.fieldDots(rect)');
    assertFiniteNumber(rect.w, 'Draw.fieldDots(rect.w)');
    assertFiniteNumber(rect.h, 'Draw.fieldDots(rect.h)');
    const symbol = opts.symbol ?? 'dot';
    if (!['dot', 'cross'].includes(symbol)) {
      throw new RangeError(`Draw.fieldDots(symbol) 只能是 dot | cross，收到 ${symbol}`);
    }
    const nx = opts.nx ?? 8;
    const ny = opts.ny ?? 5;
    if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 1 || ny < 1) {
      throw new RangeError('Draw.fieldDots(nx/ny) 必须是 ≥1 的整数（网格数是几何量，不是物理量）');
    }
    return this._push({
      op: 'fieldDots',
      x: o.x,
      y: o.y,
      w: rect.w,
      h: rect.h,
      nx,
      ny,
      symbol,
      spacing: opts.spacing ?? 0.3,
      color: opts.color ?? this.theme.field,
      layer: opts.layer ?? 0,
    });
  }

  /** 尺寸/角度标注弧（§4.2） */
  dimension(from, to, opts = {}) {
    const p = toPoint(from, 'Draw.dimension(from)');
    const q = toPoint(to, 'Draw.dimension(to)');
    const kind = opts.kind ?? 'linear';
    if (!['linear', 'angle'].includes(kind)) {
      throw new RangeError(`Draw.dimension(kind) 只能是 linear | angle，收到 ${kind}`);
    }
    return this._push({
      op: 'dimension',
      x1: p.x,
      y1: p.y,
      x2: q.x,
      y2: q.y,
      kind,
      radius: opts.radius ?? null,
      text: opts.text ?? null,
      offset: opts.offset ?? 0.18,
      color: opts.color ?? this.theme.textMuted,
      layer: opts.layer ?? 2,
    });
  }

  /** 弧线：轨迹、圆周、角度弧都用它 */
  arc(center, r, a0, a1, opts = {}) {
    const c = toPoint(center, 'Draw.arc(center)');
    assertFiniteNumber(r, 'Draw.arc(r)');
    assertFiniteNumber(a0, 'Draw.arc(a0)');
    assertFiniteNumber(a1, 'Draw.arc(a1)');
    return this._push({
      op: 'arc',
      cx: c.x,
      cy: c.y,
      x1: c.x,
      y1: c.y,
      x2: c.x,
      y2: c.y,
      r,
      a0Deg: a0,
      a1Deg: a1,
      dash: parseDash(opts.dash, 'Draw.arc(opts)'),
      width: opts.width ?? 1.4,
      color: opts.color ?? this.theme.guide,
      samples: opts.samples ?? 96,
      layer: opts.layer ?? 0,
    });
  }

  /** 轨迹虚线（§4.2） */
  trace(points, opts = {}) {
    return this.curve(points, { dash: opts.dash ?? [6, 4], color: opts.color ?? this.theme.guide, ...opts });
  }

  /** 折线/路径（可闭合、可填充） */
  curve(points, opts = {}) {
    const pts = points.map((p, i) => {
      const q = toPoint(p, `Draw.curve(points[${i}])`);
      return [q.x, q.y];
    });
    return this._push({
      op: 'curve',
      points: pts,
      closed: opts.closed ?? false,
      fill: opts.fill ?? null,
      dash: parseDash(opts.dash, 'Draw.curve(opts)'),
      width: opts.width ?? 1.5,
      color: opts.color ?? this.theme.body,
      layer: opts.layer ?? 0,
    });
  }

  /** 残影快照：把一组位置画成淡淡的同形轮廓 */
  ghosts(positions, opts = {}) {
    const out = [];
    for (const p of positions) {
      out.push(
        this.circle(p, opts.r ?? 0.12, {
          stroke: opts.color ?? this.theme.guide,
          dash: opts.dash ?? [3, 3],
          width: opts.width ?? 1,
          layer: opts.layer ?? 0,
        }),
      );
    }
    return out;
  }

  /** 光线路 */
  ray(from, to, opts = {}) {
    const p = toPoint(from, 'Draw.ray(from)');
    const q = toPoint(to, 'Draw.ray(to)');
    return this._push({
      op: 'ray',
      x1: p.x,
      y1: p.y,
      x2: q.x,
      y2: q.y,
      arrowHead: opts.arrowHead ?? true,
      dash: parseDash(opts.dash, 'Draw.ray(opts)'),
      color: opts.color ?? this.theme.light,
      width: opts.width ?? 1.5,
      layer: opts.layer ?? 1,
    });
  }

  /** 透镜 */
  lens(center, opts = {}) {
    const c = toPoint(center, 'Draw.lens(center)');
    assertFiniteNumber(opts.height, 'Draw.lens(height)');
    assertFiniteNumber(opts.focal, 'Draw.lens(focal)');
    return this._push({
      op: 'lens',
      x1: c.x,
      y1: c.y - opts.height / 2,
      x2: c.x,
      y2: c.y + opts.height / 2,
      cx: c.x,
      cy: c.y,
      height: opts.height,
      focal: opts.focal,
      curved: opts.curved ?? true,
      color: opts.color ?? this.theme.body,
      layer: opts.layer ?? 1,
    });
  }

  /** 坐标轴框（p–V / v–t 等任意二维图，§4.2） */
  axisBox(origin, xLen, yLen, opts = {}) {
    const o = toPoint(origin, 'Draw.axisBox(origin)');
    assertFiniteNumber(xLen, 'Draw.axisBox(xLen)');
    assertFiniteNumber(yLen, 'Draw.axisBox(yLen)');
    return this._push({
      op: 'axisBox',
      x: o.x,
      y: o.y,
      xLen,
      yLen,
      xLabel: opts.xLabel ?? '',
      yLabel: opts.yLabel ?? '',
      xUnit: opts.xUnit ?? '',
      yUnit: opts.yUnit ?? '',
      xTicks: opts.xTicks ?? 5,
      yTicks: opts.yTicks ?? 5,
      color: opts.color ?? this.theme.body,
      layer: opts.layer ?? 0,
    });
  }

  /**
   * 联动图表：采样序列 + 填充数据编码（§13.4 数据源 = Dry-Run 的 readouts 采样）。
   * `fill` 打开后按基线填充，用于 p–V 做功面积这类"面积即物理量"的表达。
   */
  chart(samples, opts = {}) {
    const data = samples.map((s, i) => {
      const q = toPoint(s, `Draw.chart(samples[${i}])`);
      return [q.x, q.y];
    });
    return this._push({
      op: 'chart',
      data,
      baseline: opts.baseline ?? 0,
      fill: opts.fill ?? null,
      stroke: opts.stroke ?? this.theme.accent,
      dash: parseDash(opts.dash, 'Draw.chart(opts)'),
      cursor: opts.cursor ?? null,
      color: opts.color ?? this.theme.accent,
      layer: opts.layer ?? 1,
    });
  }

  /** 带上下标的标注（§4.2）；`latex` 槽位优先渲染符号（§3.4） */
  text(x, y, text, opts = {}) {
    assertFiniteNumber(x, 'Draw.text(x)');
    assertFiniteNumber(y, 'Draw.text(y)');
    if (typeof text !== 'string' || !text.length) throw new TypeError('Draw.text(text) 必须是非空字符串');
    return this._push({
      op: 'text',
      x,
      y,
      text,
      align: opts.align ?? 'center',
      baseline: opts.baseline ?? 'middle',
      size: opts.size ?? 14,
      color: opts.color ?? this.theme.text,
      sub: opts.sub ?? null,
      sup: opts.sup ?? null,
      leaderTo: opts.leaderTo ? toPoint(opts.leaderTo, 'Draw.text(leaderTo)') : null,
      layer: opts.layer ?? 3,
    });
  }

  /** 公式标注（§3.4：有 latex 时优先渲染符号） */
  latex(x, y, tex, opts = {}) {
    assertFiniteNumber(x, 'Draw.latex(x)');
    assertFiniteNumber(y, 'Draw.latex(y)');
    if (typeof tex !== 'string' || !tex.length) throw new TypeError('Draw.latex(tex) 必须是非空字符串');
    return this._push({
      op: 'latex',
      x,
      y,
      tex,
      align: opts.align ?? 'center',
      baseline: opts.baseline ?? 'middle',
      size: opts.size ?? 15,
      color: opts.color ?? this.theme.text,
      leaderTo: opts.leaderTo ? toPoint(opts.leaderTo, 'Draw.latex(leaderTo)') : null,
      layer: opts.layer ?? 3,
    });
  }

  /**
   * 逃生门（§5.4）。
   * 实时渲染时给真 ctx；Dry-Run 时只跳过该条指令的坐标包络计算，**不放弃整帧门禁**，
   * 并在校验报告中标注、计入观测日志。使用率 >10% 说明 SDK 该扩编。
   */
  raw(fn, opts = {}) {
    if (typeof fn !== 'function') throw new TypeError('Draw.raw(fn) 需要一个函数');
    const id = `raw_${this.buffer.records.length}`;
    return this._push({
      op: 'raw',
      ref: id,
      fn,
      note: opts.note ?? '',
      layer: opts.layer ?? 4,
      colored: false,
    });
  }

  /* —— 常用组合（仍是几何+纯数值，不是题目级助手 §4.4） —— */

  /** 斜线阴影地面：从 (x0,y) 到 (x1,y)，下方画短斜线，表达"固定地面" */
  ground(x0, x1, y = 0, opts = {}) {
    return this.polygon(
      [
        [x0, y],
        [x1, y],
      ],
      { hatch: opts.hatch ?? 'below', stroke: opts.color ?? this.theme.body, closed: false, layer: opts.layer ?? 0 },
    );
  }

  /**
   * 斜面：顶点 + 角度 + 沿面长度，自动画三角形体与斜线阴影底面。
   *
   * `angleDeg` 的符号表示坡面**朝哪边下坡**（q06 的坡脚在左下，必须靠负号才能画对）：
   *   · 正 → 坡脚在顶点的右下（坡面向右下，如 q02）；
   *   · 负 → 坡脚在顶点的左下（坡面向左下，如 q06 的"斜面顶端装滑轮"）。
   * 顶点始终是斜面**最高**的那一端；`base` 缺省取坡脚正下方（直角角点）。
   */
  incline(apex, opts = {}) {
    const a = toPoint(apex, 'Draw.incline(apex)');
    assertFiniteNumber(opts.length, 'Draw.incline(length)');
    assertFiniteNumber(opts.angleDeg, 'Draw.incline(angleDeg)');
    const L = opts.length;
    const th = Math.abs(opts.angleDeg) * DEG;
    const side = opts.angleDeg < 0 ? -1 : 1;
    const footY = a.y - L * Math.sin(th);
    const footX = a.x + side * L * Math.cos(th);
    const base = toPoint(opts.base ?? [footX, footY], 'Draw.incline(base)');
    return this.polygon(
      [
        [a.x, a.y],
        [footX, footY],
        [base.x, base.y],
      ],
      { fill: opts.fill ?? this.theme.surface, stroke: opts.stroke ?? this.theme.body, hatch: opts.hatch ?? 'belowBase', layer: opts.layer ?? 0 },
    );
  }

  /** 方块/滑块：中心 + 宽高 + 可选转角 */
  box(center, w, h, opts = {}) {
    const c = toPoint(center, 'Draw.box(center)');
    assertFiniteNumber(w, 'Draw.box(w)');
    assertFiniteNumber(h, 'Draw.box(h)');
    const th = (opts.angleDeg ?? 0) * DEG;
    const hw = w / 2;
    const hh = h / 2;
    const corners = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ].map(([dx, dy]) => [c.x + dx * Math.cos(th) - dy * Math.sin(th), c.y + dx * Math.sin(th) + dy * Math.cos(th)]);
    return this.polygon(corners, {
      fill: opts.fill ?? this.theme.surface,
      stroke: opts.stroke ?? this.theme.body,
      layer: opts.layer ?? 1,
    });
  }
}

/* ───────────────────── 槽位装配 + 程序执行（§3.5 / §7.1） ───────────────────── */

/**
 * 按 §3.5 标记切分协议把源码切成 8 个槽位。
 * **不用正则做结构切割**（§21.2 第 4 条）；缺标记 / 重复标记 / 未知标记名都报错。
 */
export function splitSlots(source, keyNames) {
  const keys = keyNames ?? SLOT_FROZEN_KEYS;
  const found = new Map();
  const unknown = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf('/* @slot:', cursor);
    if (start < 0) break;
    const nameStart = start + '/* @slot:'.length;
    const nameEnd = source.indexOf('*/', nameStart);
    if (nameEnd < 0) throw new Error(`槽位标记未闭合（偏移 ${start}）`);
    const rawName = source.slice(nameStart, nameEnd).trim();
    const bodyStart = nameEnd + 2;
    const end = source.indexOf('/* @end */', bodyStart);
    if (end < 0) throw new Error(`槽位 ${rawName} 缺少 /* @end */（§3.5）`);
    if (!keys.includes(rawName)) unknown.push(rawName);
    if (found.has(rawName)) throw new Error(`槽位 ${rawName} 重复出现（§3.5 不允许重复标记）`);
    found.set(rawName, source.slice(bodyStart, end));
    cursor = end + '/* @end */'.length;
  }

  const missing = keys.filter((k) => !found.has(k));
  return { slots: Object.fromEntries(found), missing, unknown };
}

export const SLOT_FROZEN_KEYS = Object.freeze([
  'PROBLEM',
  'STEPS',
  'ANSWERS',
  'VIEW',
  'setup',
  'stateAt',
  'drawFrame',
  'readouts',
]);

/**
 * 把 8 个槽位文本装配成可执行的工厂源码。
 *
 * 装配口径（与 §3.2 的 8 键名逐字对应）：
 *   · 槽位各自的局部变量写在独立 IIFE 作用域里，返回值赋给槽位名对应的变量；
 *   · `setup` / `stateAt` / `drawFrame` / `readouts` 是函数体片段，**共享同一闭包**，
 *     因此 `setup` 里算出的查表可以被 `stateAt` 直接读到（§8.3 的"setup 与 stateAt 互为依赖"）；
 *   · `stateAt` 与 `drawFrame` 始终是两个独立函数（§8.1 的"只重发 stateAt"依赖这一点）。
 *
 * 槽位代码的约定（与 §19.5 手写题一起固化为 SDK 用法）：
 *   PROBLEM          表达式 → 题面字符串
 *   STEPS            表达式 → [{ title, tex, t0, t1 }]
 *   ANSWERS          表达式 → [{ symbol, value, unit, tol, at_t, step, latex? }]
 *   VIEW             语句   → 定义 `SIM = { duration, axes? }`
 *   setup            函数体 → `RETURN(key, value)` 显式导出派生量（可选）
 *   stateAt          函数体 → `return {…}`，必须 O(1)
 *   drawFrame        函数体 → 只调 `Draw.*`
 *   readouts         函数体 → `return [{ label, value, unit, latex? }]`
 */
export function buildProgramSource(slots, opts = {}) {
  const missing = SLOT_FROZEN_KEYS.filter((k) => typeof slots?.[k] !== 'string' || !slots[k].trim().length);
  if (missing.length) {
    const err = new Error(`槽位缺失或为空：${missing.join(', ')}（§3.2 审计 2：空串视为该槽位缺失，不得静默通过）`);
    // 只有一个槽位缺时，归属就是它（诊断里"第 0 行 setup"那类误导就是这么来的）
    if (missing.length === 1) {
      err.odSlot = missing[0];
      err.odRule = 'slot-missing-or-empty';
    }
    throw err;
  }
  const mode = opts.mode ?? 'NUMERIC';
  const L = [];
  const TOKEN_PROBLEM = '/*__OD_SLOT_PROBLEM__*/';
  const TOKEN_STEPS = '/*__OD_SLOT_STEPS__*/';
  const TOKEN_ANSWERS = '/*__OD_SLOT_ANSWERS__*/';

  // 数据型槽位（PROBLEM / STEPS / ANSWERS）以 JSON 字面量注入，避免正文里的
  // LaTeX 反斜杠、引号、换行被当成 JS 源码转义；代码型槽位（其余 5 个）原样注入。
  // 占位符由调用方（dry-run / 模板构建）在装配后替换——见 `replaceDataSlotTokens`。
  const inject = (text, token) => text;

  L.push('"use strict";');
  L.push('function buildProgram(runtime){');
  L.push(`  var PROGRAM = ${JSON.stringify({ mode })};`);
  L.push('  var buffer = new runtime.CommandBuffer();');
  L.push('  var Draw = new runtime.Draw(buffer, {});');
  L.push('  var Phys = runtime.PhysRef;');
  L.push('  var context = { SIM: null, STEPS: null, ANSWERS: null, MODE: PROGRAM.mode, Draw: Draw, Phys: Phys };');
  L.push('  function RETURN(key, value){ context[key] = value; return value; }');
  // 诊断探针（第 2 期）：Dry-Run 经 runnerBundle 注入实现，**浏览器里是空操作**。
  // 这两个名字不会出现在作者写的槽位源码里——它们只由 `core/lint/slot-instrument.mjs`
  // 埋点后产生，因此 C1 的"未声明全局"判据不受影响（C1 检的是原文，不是埋点后的文本）。
  L.push('  var __odMark = (runtime && runtime.__odMark) || function () {};');
  L.push('  var __odSnap = (runtime && runtime.__odSnap) || function () {};');
  L.push('');

  // —— 数据型槽位：JSON 值 ——
  L.push('  /* @slot:PROBLEM · ① 原题（题面文本；Markdown + LaTeX，不得含代码） */');
  L.push('  var PROBLEM_TEXT = ' + TOKEN_PROBLEM + ';');
  L.push('  var STEPS_DATA = ' + TOKEN_STEPS + ';');
  L.push('  var ANSWERS_DATA = ' + TOKEN_ANSWERS + ';');
  L.push('');

  // —— VIEW ——
  /**
   * ── 第 8 期：VIEW 的两种合法写法都要能吃 ──
   *
   * 实测（用户真题）模型写了 `const SIM = { duration: 4.0 };`：
   * 它被塞进下面那个 IIFE，`const` 只在块内可见 ⇒ 外层 `SIM` 还是 `null`
   * ⇒ 抛"VIEW 槽位必须定义 SIM" ⇒ C2/C3–C9 全红，而**程序其实只错了一个关键字**。
   *
   * 三种声明式（`const` / `let` / `var`）在这里一律归一成**裸赋值**：
   * 语义与作者意图完全一致（都是给外层的 `SIM` 赋值），所以这是**归一化，不是放宽判据**。
   */
  const viewSource = String(slots.VIEW).replace(/\b(const|let|var)(\s+)SIM\b/g, 'SIM');
  L.push('  /* @slot:VIEW · ④ 视图：SIM.duration 等；不得写像素尺寸与相机比例，不得写轨迹表达式 */');
  L.push('  var SIM = null;');
  L.push('  (function(){');
  L.push(`  ${viewSource}`);
  L.push('  })();');
  L.push('  context.SIM = SIM;');
  L.push('  if (!SIM || typeof SIM.duration !== "number") {');
  /**
   * 错误信息要**指名下一步怎么做**（这是本仓"可回灌诊断"的口径）：
   *   · 写了 `SIM` 但没生效  → 十有八九是 `const SIM = …`（已被归一化，走到这里说明还有别的问题）
   *   · 完全没有 `SIM`        → 直接给出该写什么
   *   · VIEW 是空的           → 说清是空槽
   * 并且把 `odSlot` 标成 `VIEW` —— 否则诊断会把它算到 `setup` 头上（用户就是这么被误导的）。
   */
  const viewText = String(slots.VIEW);
  const viewMsg = !viewText.trim()
    ? 'VIEW 槽位是空的：必须写 `SIM = { duration: <秒> };`'
    : /SIM/.test(viewText)
      ? 'VIEW 里出现了 SIM，但没有生效：请写成裸赋值 `SIM = { duration: <秒> };`（不要 `const SIM = …`、也不要把 duration 放进别的对象）'
      : 'VIEW 里没有 SIM：必须写 `SIM = { duration: <秒> };`（§3.2）';
  L.push(`    var __viewErr = new Error(${JSON.stringify(viewMsg)});`);
  L.push("    __viewErr.odSlot = 'VIEW';");
  L.push("    __viewErr.odRule = 'view-missing-duration';");
  L.push('    throw __viewErr;');
  L.push('  }');
  L.push('');

  L.push('  var STEPS = STEPS_DATA;');
  L.push('  context.STEPS = STEPS;');
  L.push('  var ANSWERS = ANSWERS_DATA;');
  L.push('  context.ANSWERS = ANSWERS;');
  L.push('');

/**
 * ── 第 8 期：**运行时也要容忍"多写的函数外壳"**（防御纵深）──
 *
 * 清洗层（`core/cleaner` 的 `strip-function-wrapper`）已经把新产出修好了；
 * 但**已经导出的旧 html**（用户真题 export-20261018-115238-713）里仍然是
 *   function readouts(t, state) { … }
 * 播放器再包一层就什么都没了。这里做同一件事，代价只有几行：
 * 只在"整段以 `function <槽位名>(` 开头、以 `}` 结尾"时动手（两个条件同时成立才剥）。
 */
function stripSlotFunctionWrapper(text, key) {
  const src = String(text ?? '');
  const trimmed = src.trim();
  if (!trimmed) return src;
  const head = new RegExp('^function\\s+' + key + '\\s*\\([^)]*\\)\\s*\\{');
  if (!head.test(trimmed)) return src;
  if (!trimmed.endsWith('}')) return src;
  const open = trimmed.indexOf('{');
  const body = trimmed.slice(open + 1, trimmed.length - 1);
  const lines = body.split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => (l.match(/^[ \\t]*/) ?? [''])[0].length);
  const minIndent = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(Math.min(minIndent, (l.match(/^[ \\t]*/) ?? [''])[0].length))).join('\n');
}

  // —— setup ——
  L.push('  /* @slot:setup · ⑤ 初始化：允许 Phys.integrate；禁止访问 DOM/网络（§7.6） */');
  L.push('  function setup(){');
  L.push(`  ${stripSlotFunctionWrapper(slots.setup, 'setup')}`);
  L.push('  }');
  L.push('');

  // —— stateAt ——
  L.push('  /* @slot:stateAt · ⑥ 状态：必须 O(1)，静态禁止 Phys.integrate（C1 强制） */');
  L.push('  function stateAt(t){');
  L.push(`  ${stripSlotFunctionWrapper(slots.stateAt, 'stateAt')}`);
  L.push('  }');
  L.push('');

  // —— drawFrame ——
  L.push('  /* @slot:drawFrame · ⑥ 绘制：拿不到 ctx，只能调 Draw.* 推命令（§5.1） */');
  L.push('  function drawFrame(t, state){');
  L.push(`  ${stripSlotFunctionWrapper(slots.drawFrame, 'drawFrame')}`);
  L.push('  }');
  L.push('');

  // —— readouts ——
  L.push('  /* @slot:readouts · ⑦ 读数：返回 [{label, value, unit, latex?}]；键集合与单位全时段不变（C8） */');
  L.push('  function readouts(t, state){');
  L.push(`  ${stripSlotFunctionWrapper(slots.readouts, 'readouts')}`);
  L.push('  }');
  L.push('');

  L.push('  return {');
  L.push('    PROBLEM: PROBLEM_TEXT, SIM: SIM, STEPS: STEPS, ANSWERS: ANSWERS, MODE: PROGRAM.mode,');
  L.push('    setup: setup, stateAt: stateAt, drawFrame: drawFrame, readouts: readouts,');
  L.push('    context: context, buffer: buffer, Draw: Draw');
  L.push('  };');
  L.push('}');

  let out = L.join('\n');
  out = inject(out, TOKEN_PROBLEM);
  out = inject(out, TOKEN_STEPS);
  out = inject(out, TOKEN_ANSWERS);
  return out;
}

/** 数据型槽位的内部占位符（装配后由 `replaceDataSlotTokens` 替换） */
export const DATA_SLOT_TOKENS = Object.freeze({
  PROBLEM: '/*__OD_SLOT_PROBLEM__*/',
  STEPS: '/*__OD_SLOT_STEPS__*/',
  ANSWERS: '/*__OD_SLOT_ANSWERS__*/',
});

/**
 * 把装配源码里的数据型槽位占位符替换成实际值。
 *
 * 用 `split/join`（不是 `String.replace` 的字符串形式）替换，
 * 避免 `$&` / `$1` 这类替换模式被 LaTeX 正文误触发。
 */
export function replaceDataSlotTokens(source, slots) {
  let out = source;
  for (const key of ['PROBLEM', 'STEPS', 'ANSWERS']) {
    out = out.split(DATA_SLOT_TOKENS[key]).join(JSON.stringify(normalizeDataSlot(slots[key], key)));
  }
  return out;
}

/**
 * 一步到位的装配：装配 + 数据槽位替换。模板页与 Dry-Run 都用它，
 * 保证"屏幕上看到的 = 校验过的"（§13.1 所见即所导）。
 */
export function assembleProgramSource(slots, opts = {}) {
  return replaceDataSlotTokens(buildProgramSource(slots, opts), slots);
}

/**
 * 数据型槽位解析。
 *
 * 为什么不要求 STEPS / ANSWERS 写 JSON：这两个槽位里全是 LaTeX，JSON 会把反斜杠变成转义序列，
 * 模型（与人）都会写错。这里采用**行式表**：`key: value` 一行一项，`"""` 起止的多行值不解释任何转义。
 * 这样 `\frac` / `\mu` 原样保留，§3.5 的"零猜测"原则不受影响（解析失败必须报错，不猜）。
 *
 * 容错：**行式表为主，JSON 数组为兼容入口**（历史产物与手工粘贴的 JSON 仍可用）。
 */
export function parseStepsSlot(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) return parseJsonArray(trimmed, 'STEPS').map((s) => normalizeStep(s));
  const blocks = splitBlocks(trimmed);
  return blocks.map((block, i) => {
    const fields = parseKeyValues(block, 'STEPS', i);
    return normalizeStep(fields);
  });
}

export function parseAnswersSlot(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) return parseJsonArray(trimmed, 'ANSWERS');
  const blocks = splitBlocks(trimmed);
  return blocks.map((block, i) => {
    const fields = parseKeyValues(block, 'ANSWERS', i);
    const out = {
      symbol: fields.symbol,
      value: parseNullableNumber(fields.value, 'ANSWERS', i, 'value'),
      unit: fields.unit ?? '',
      // tol 可省略或写 null（用全局默认容差）；at_t 必填（C7 靠它定位复现时刻）
      tol: parseNullableNumber(fields.tol, 'ANSWERS', i, 'tol'),
      at_t: parseNullableNumber(fields.at_t, 'ANSWERS', i, 'at_t'),
      step: parseNullableNumber(fields.step, 'ANSWERS', i, 'step'),
    };
    if (!out.symbol) throw new Error(`ANSWERS 第 ${i + 1} 条缺少 symbol`);
    if (out.at_t === null) throw new Error(`ANSWERS 第 ${i + 1} 条缺少 at_t（§3.3：C7 靠它定位复现时刻）`);
    // §3.3：纯符号题（SYMBOLIC）value 允许为 null，但必须给 latex
    if (out.value === null && (typeof fields.latex !== 'string' || !fields.latex.trim())) {
      throw new Error(`ANSWERS 第 ${i + 1} 条的 value 为 null（纯符号结论），必须提供 latex（§3.3）`);
    }
    if (fields.latex !== undefined) out.latex = fields.latex;
    return out;
  });
}

function normalizeStep(raw) {
  const out = {
    title: raw.title ?? '',
    tex: raw.tex ?? '',
    t0: Number(raw.t0),
    t1: Number(raw.t1),
  };
  if (!out.title) throw new Error('STEPS 有一步缺少 title');
  if (!out.tex) throw new Error(`STEPS 的「${out.title}」缺少 tex`);
  if (Number.isNaN(out.t0) || Number.isNaN(out.t1)) throw new Error(`STEPS 的「${out.title}」t0/t1 不是数值`);
  if (raw.note) out.note = raw.note;
  return out;
}

function parseNullableNumber(v, slot, index, key) {
  if (v === undefined || v === null || v === '' || v === 'null') return null;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`${slot} 第 ${index + 1} 条的 ${key} 不是数值：${v}`);
  return n;
}

function parseJsonArray(text, slot) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`槽位 ${slot} 不是合法行式表，也不是合法 JSON：${err.message}（§3.2 不允许静默通过）`);
  }
  if (!Array.isArray(parsed)) throw new Error(`槽位 ${slot} 解析结果必须是数组`);
  return parsed;
}

/**
 * 空行切块；整行 `#` 注释在切块前剥掉（注释行不参与块结构）。
 *
 * `splitBlocksWithLines` 是同一份切块逻辑的**带行号**版本（第 2 期行号级诊断用）：
 * 注释行与空行被丢掉，但保留下来的每一行都带着它在**原文**里的真实行号，
 * 因此"STEPS 第 3 步的 t0 在第 12 行"这种诊断不会因为注释/空行而错位。
 */
function splitBlocksWithLines(text) {
  const raw = String(text ?? '').split(/\r?\n/);
  const blocks = [];
  let current = { lines: [], lineNos: [] };
  const flush = () => {
    if (current.lines.length) blocks.push(current);
    current = { lines: [], lineNos: [] };
  };
  for (let n = 0; n < raw.length; n += 1) {
    const line = raw[n];
    if (line.trim().startsWith('#')) continue;
    if (!line.trim()) {
      flush();
      continue;
    }
    current.lines.push(line);
    current.lineNos.push(n + 1);
  }
  flush();
  return blocks;
}

function splitBlocks(text) {
  return splitBlocksWithLines(text).map((b) => b.lines);
}

const VALUE_SENTINEL = '\u0000';

/**
 * 把一个块解析成 `{ key: value }`。
 * · `key: value` 单行值；
 * · `key: """` … `"""` 多行值（原样保留，不解释转义）。
 *
 * `lineNos`（第 2 期）：与该块逐行对应的原文行号。给了它就把"每个字段第一次出现的行号"
 * 记进 `out.__line`，供 `dataSlotLineIndex` 做行号级诊断；不给则输出与第 1 期逐字一致。
 */
function parseKeyValues(block, slot, index, lineNos = null) {
  const out = {};
  const at = (i) => (lineNos && lineNos[i] !== undefined ? lineNos[i] : null);
  const mark = (key, i) => {
    if (!lineNos) return;
    out.__line = out.__line ?? {};
    if (out.__line[key] === undefined) out.__line[key] = at(i);
  };
  let i = 0;
  while (i < block.length) {
    const line = block[i];
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/.exec(line);
    if (!m) throw new Error(`${slot} 第 ${index + 1} 条无法解析这一行：${line}`);
    const key = m[1];
    mark(key, i);
    let rest = m[2].trim();
    if (rest === '"""') {
      const collected = [];
      i += 1;
      let closed = false;
      while (i < block.length) {
        if (block[i].trim() === '"""') {
          closed = true;
          i += 1;
          break;
        }
        collected.push(block[i]);
        i += 1;
      }
      if (!closed) throw new Error(`${slot} 第 ${index + 1} 条的 ${key} 多行值（"""）未闭合`);
      out[key] = collected.join('\n');
      continue;
    }
    if (!rest) {
      // 值可能被拆到下一行（长 LaTeX 手工换行）；把直到下一个 `key:` 的行都收进来
      const collected = [];
      i += 1;
      while (i < block.length && !/^([A-Za-z_][A-Za-z0-9_]*)\s*:/.test(block[i])) {
        collected.push(block[i]);
        i += 1;
      }
      out[key] = collected.join(' ').trim();
      continue;
    }
    out[key] = rest;
    i += 1;
  }
  if (Object.values(out).some((v) => String(v).includes(VALUE_SENTINEL))) {
    throw new Error(`${slot} 第 ${index + 1} 条包含非法控制字符`);
  }
  return out;
}

/**
 * 数据型槽位统一入口。PROBLEM 是自由文本（原样保留），
 * STEPS / ANSWERS 解析为结构化数组。
 */
export function normalizeDataSlot(text, key) {
  if (typeof text !== 'string' || !text.trim()) throw new Error(`槽位 ${key} 为空（§3.2 审计 2）`);
  if (key === 'PROBLEM') {
    const trimmed = text.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) return arr.join('\n\n');
      } catch {
        /* 落回纯文本 */
      }
    }
    return text.replace(/^\n+|\n+$/g, '');
  }
  if (key === 'STEPS') return parseStepsSlot(text);
  if (key === 'ANSWERS') return parseAnswersSlot(text);
  throw new Error(`未知数据型槽位 ${key}`);
}

/** 数据型槽位（不需要 C1 代码预检）与代码型槽位（需要） */
export const DATA_SLOTS = Object.freeze(['PROBLEM', 'STEPS', 'ANSWERS']);
export const CODE_SLOTS = Object.freeze(['VIEW', 'setup', 'stateAt', 'drawFrame', 'readouts']);

/**
 * 行式表槽位的**行号索引**（第 2 期）：
 * `STEPS` / `ANSWERS` 的每一条、每个字段，在槽位正文里是第几行。
 *
 * 为什么单独出一个函数而不是把 `__line` 塞进解析结果：`STEPS` 是 §3.2 冻结键之一，
 * 它的记录形状不允许被诊断信息污染。这里复用**同一个** `parseKeyValues` 走一遍
 * （传入行号），因此不可能与正式解析结果错位；`\\` JSON 入口没有行式表坐标，返回 `null`。
 *
 * @returns {{slot:string, entries:Array<{index:number,startLine:number,fields:Record<string,number>}>}|null}
 */
export function dataSlotLineIndex(text, key) {
  if (typeof text !== 'string' || !text.trim()) return null;
  if (text.trim().startsWith('[')) return null; // JSON 兼容入口：没有行式表坐标
  const blocks = splitBlocksWithLines(text);
  const entries = [];
  blocks.forEach((block, index) => {
    let fields = {};
    try {
      fields = parseKeyValues(block.lines, key, index, block.lineNos).__line ?? {};
    } catch {
      fields = {};
    }
    entries.push({ index, startLine: block.lineNos[0], fields });
  });
  return { slot: key, entries };
}

/* ─────────────────────── 诊断探针（第 2 期 · Dry-Run 专用） ─────────────────────── */

/**
 * 把 `{ 槽位号: 槽位名 }` 之外的探针实现收在一处。
 * 槽位源码里只会出现 `__odMark(槽位号, 行号)` 与 `__odSnap(槽位号, 行号, 取值函数)`，
 * 由 `core/lint/slot-instrument.mjs` 插入；这里给出两个可注入的实现。
 *
 * `mark` 写进 SharedArrayBuffer：Worker 被硬终止后**父进程仍能读到最后一行的行号**
 * —— 这是"死循环也能给出行号"的唯一办法（卡住的循环里插不进任何回调）。
 */
export function createProbeSink({ slotNames = [], shared = null } = {}) {
  const view = shared ? new Int32Array(shared) : null;
  let current = null;
  return {
    /** @type {Array<{slot:number,line:number,values:Record<string,unknown>|null}>} */
    snapshots: [],
    mark(slotIndex, line) {
      current = { slot: slotIndex, line };
      if (view) {
        Atomics.store(view, 0, slotIndex);
        Atomics.store(view, 1, line);
        Atomics.add(view, 2, 1);
      }
    },
    snap(slotIndex, line, values) {
      let captured = null;
      try {
        captured = typeof values === 'function' ? values() : values;
      } catch {
        captured = null; // 块级 TDZ 等：只丢这一次快照，不能让诊断本身崩掉
      }
      this.snapshots.push({ slot: slotIndex, line, values: captured });
    },
    /** 最近一次执行的排点（父进程侧用它把 `mark` 翻译成槽位名） */
    peek() {
      return current;
    },
    slotName(index) {
      return slotNames?.[index] ?? null;
    },
  };
}

/* ──────────────────────── 渲染器（§5.2 消费者之二/之三） ──────────────────────── */

/**
 * 斜线阴影填充（地面 / 斜面底面）。
 *
 * 两种模式的**基准线不同**，之前两个分支代码完全一样、参数等于没生效：
 *   · `'below'`      —— 单条地面线（多边形退化成一条水平线段）：从这条线往下打斜线；
 *   · `'belowBase'`  —— 实心块（斜面三角形、板、方块）：从**最长的那条边**往下打斜线，
 *                       这才是教科书里"固定支撑面"的记号，也能正确处理斜置的地面。
 * 斜线相位统一锚定在基准线上，因此相邻多边形（如地面与斜坡）的纹理会连成一片。
 */
function hatchPolygon(ctx, pts, pattern) {
  if (!pts.length) return;
  ctx.save();
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = DEFAULT_THEME.bodySoft;
  ctx.lineWidth = 1;

  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const maxY = Math.max(...pts.map((p) => p.y));
  const step = 9;
  const span = maxX - minX + step * 2;
  const slots = Math.ceil(span / step) + 2;

  let baseA;
  let baseB;
  if (pattern === 'below') {
    // 地面线自身作为基准；被斜置的地面（q06）也能得到平行纹理
    baseA = pts[0];
    baseB = pts[pts.length - 1];
  } else {
    // 最长边 = 支撑底边
    let bestLen = -1;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > bestLen) {
        bestLen = len;
        baseA = a;
        baseB = b;
      }
    }
  }

  const baseSlope = Math.abs(baseB.x - baseA.x) > 1e-9 ? (baseB.y - baseA.y) / (baseB.x - baseA.x) : 0;
  const kStart = Math.floor((minX - step - baseA.x) / step);

  ctx.beginPath();
  for (let k = kStart; k <= kStart + slots; k += 1) {
    // 每条斜线从"基准线"出发往下画；相位锚定在 baseA，保证相邻块纹理连续
    const bx = baseA.x + k * step;
    const by = baseA.y + (bx - baseA.x) * baseSlope;
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + step, by + step);
    // 向上补一段，使斜置基准线（如地面被切掉一角）也能盖满被裁剪区域
    ctx.moveTo(bx - maxY * 0.6, by - maxY * 0.6);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSpringPath(ctx, rec, T) {
  const p = T(rec.a[0], rec.a[1]);
  const q = T(rec.b[0], rec.b[1]);
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const coils = Math.max(2, rec.coils | 0);
  const amp = rec.amplitude * T.unit;
  const lead = Math.min(len * 0.16, amp * 1.6);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + ux * lead, p.y + uy * lead);
  const bodyLen = len - lead * 2;
  const seg = bodyLen / (coils * 2);
  for (let i = 0; i < coils * 2; i += 1) {
    const s = i % 2 === 0 ? 1 : -1;
    const baseX = p.x + ux * (lead + seg * (i + 0.5));
    const baseY = p.y + uy * (lead + seg * (i + 0.5));
    ctx.lineTo(baseX + px * amp * s, baseY + py * amp * s);
  }
  ctx.lineTo(q.x - ux * lead, q.y - uy * lead);
  ctx.lineTo(q.x, q.y);
  ctx.stroke();
}

/**
 * @deprecated 第 8 期已废弃：曾用于"过短的箭头放大到可见长度"。
 *
 * 为什么废弃：那个补丁会让**长度不再等于量级**（小箭头被抬到同一个下限），
 * 而用户明确要的是"长度 = 量级 × 比例，且按类分别比较"。
 * 归一化之后"力太小看不见"的问题从根上消失（力按力自己的最大值归一），
 * 所以改为"短于 `ARROW_MIN_PX` 就画一个点"，不再放大。
 *
 * 常量留着只为兼容外部引用（`Runtime.MIN_ARROW_PX`），不要在新代码里用它。
 */
export const MIN_ARROW_PX = 16;

/**
 * 同点同类箭头之间的**错开步长**（像素）。
 *
 * 8 px 是"看得出是两支、又不至于让人以为它们挂在两个不同物体上"的量级：
 * 箭头杆本身 2.2 px 宽、箭头头 6–11 px，8 px 的间距刚好让两支平行箭头的杆不重叠。
 */
export const ARROW_STACK_PX = 8;

/**
 * 算出一帧里**需要错开的箭头** → 像素偏移（`{dx, dy}`）。
 *
 * 分组口径：起点相同（容差 1e-6）**且** `category` 相同。
 * 为什么必须分 `category`：速度（绿）与力（红）本来就靠颜色区分，把它们错开反而让读者以为
 * 它们挂在两个点；同一颜色的两支力箭头（例如支持力与摩擦力）叠在一点才是真看不清。
 *
 * 错开方向：**垂直于自身方向**（左手侧为正），组内居中对称 ——
 * 两支时各偏 ±4 px，三支时 -8/0/+8。
 *
 * @param {Array<object>} records 一帧的命令记录
 * @returns {Map<object, {dx:number, dy:number}>} 只含需要偏移的记录
 */
export function computeArrowStackOffsets(records) {
  const groups = new Map();
  for (const rec of records) {
    if (rec?.op !== 'arrow') continue;
    const x = Number(rec.from?.[0]);
    const y = Number(rec.from?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = `${rec.category ?? 'aux'}|${x.toFixed(6)}|${y.toFixed(6)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }
  const out = new Map();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const n = list.length;
    list.forEach((rec, i) => {
      const t = i - (n - 1) / 2; // 居中对称：n=2 → -0.5, +0.5
      const [ux, uy] = arrowDirection(rec);
      // 垂直于方向的方向向量（顺时针转 90°）
      out.set(rec, { dx: -uy * t * ARROW_STACK_PX, dy: ux * t * ARROW_STACK_PX });
    });
  }
  return out;
}

function drawArrow(ctx, T, rec, vectorMax = null, offset = null) {
  const base = T(rec.from[0], rec.from[1]);
  const p = offset ? { x: base.x + offset.dx, y: base.y + offset.dy } : base;

  /**
   * ── 第 8 期：长度**按类归一**（直算像素）──
   *
   * 方向取 `vec` 的单位向量；长度 = 该类满量程(px) × 该箭头量级 ÷ 该类最大量级。
   * 因为箭头**不参与取景**，这里不需要经过世界单位，也就没有"名义相机 vs 实际相机"
   * 的偏差（实测过：绕世界单位会少画 28%）。
   */
  const [uxDir, uyDir] = arrowDirection(rec);
  let lenPx = arrowLengthPx(rec, vectorMax);

  /* 防出画面：箭头不参与取景，极端情况下可能戳出画布被裁掉（图例写明了会收缩） */
  const maxPx = Math.min(T.viewport?.width ?? 0, T.viewport?.height ?? 0) * ARROW_MAX_VIEWPORT_RATIO;
  if (maxPx > 0 && lenPx > maxPx) lenPx = maxPx;

  /**
   * ⚠⚠ 单位！`p` 已经是**屏幕像素**（`T()` 转换过），所以把长度加上去时
   * 用的也必须是**像素**（`lenPx`），不能是世界单位。
   *
   * 这一行踩过真坑：第一版写的是 `p.x + uxDir * lenWorld`（世界单位加在屏幕坐标上），
   * 于是"130 像素"的箭头实际只画了 130/64.67 ≈ **2 像素** —— 看着就是一个点，
   * 而且**调满量程怎么调都没用**（用户连问三次"还是很小"）。
   * 这类错误不报错、不越界，只是"看起来不对"，所以只能靠单位口径钉死。
   */
  const q = { x: p.x + uxDir * lenPx, y: p.y + uyDir * lenPx };

  /**
   * 颜色**只由 `category` 决定**。
   *
   * 第 8 期先把 `color` 参数从 `Draw.arrow` 里删掉了（契约层），
   * 所以这里没有"覆盖调用方参数"这回事 —— 记录里压根没有 color 可覆盖。
   * 颜色的含义是产品口径（绿=速度 / 蓝=加速度 / 红=受力），不是模型能自由发挥的样式。
   */
  const color = VECTOR_COLORS[rec.category] ?? rec.color ?? DEFAULT_THEME.text;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.2;

  // 近零（或量级为 0）：画一个点。"此刻为零"是真实信息，不能拉长成假箭头。
  if (!(lenPx >= ARROW_MIN_PX)) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.4, 0, TAU);
    ctx.fill();
    return;
  }

  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0.5)) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.4, 0, TAU);
    ctx.fill();
    return;
  }

  const head = Math.min(11, Math.max(6, len * 0.3));
  const ux = dx / len;
  const uy = dy / len;
  const sx = q.x - ux * head;
  const sy = q.y - uy * head;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(sx, sy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(q.x, q.y);
  ctx.lineTo(sx - uy * head * 0.36, sy + ux * head * 0.36);
  ctx.lineTo(sx + uy * head * 0.36, sy - ux * head * 0.36);
  ctx.closePath();
  ctx.fill();

  // 矢量标签。之前只画了线段与箭头三角，`rec.label` 一直被丢掉，
  // 于是 15 题里 60 处带 label 的箭头全是"无名箭头"。
  //
  // 第 8 期（方案 A）：**又不画了**，但这次是**故意**的 ——
  // 它的位置由渲染器按箭头中点算，不经过避让表，所以永远"跟着箭头跑、撞上别的字"。
  // 矢量的含义改由「颜色 + 长度」表达（绿=速度 / 蓝=加速度 / 红=受力），
  // 图例在**画布外**（模板页的 `data-od-id="vector-legend"`）。
  if (rec.label && !HIDE_CANVAS_TEXT) {
    // 标签放在箭头中点沿法向偏移处，并按象限选对齐方式，避免压住箭头本体
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const inset = rec.labelInset ?? 13;
    const lx = mx + -uy * inset;
    const ly = my + ux * inset;
    ctx.font = `600 12px ${LABEL_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 物理量标签必须走**同一个 3 位有效数字格式化**（`format`，与读数栏、题目里的 Phys.format 是同一套）。
    // 之前直接 `${rec.mag}` 拼原始浮点数，画布上会印出 `v = 3.385926899562456 m/s` 这种十几位小数
    // （q04/q07/q13 的矢量标注当场中招 —— 用户审计第 6 条指的就是它；它出现在**渲染器内部**，
    // 只扫命令记录里的 text/latex 是抓不到的，必须扫真正画到画布上的字符串）。
    //
    // §18 期 3 的验收条件"纯符号题能播且标注全为符号"落在下面这一行：
    // 给了 `latex`（画布可绘制的符号文本）就**只用符号**，不缀数值。
    const text =
      typeof rec.latex === 'string' && rec.latex.length
        ? rec.latex
        : rec.mag === null || rec.mag === undefined
          ? rec.label
          : `${rec.label} = ${format(rec.mag, rec.unit || '', 3)}`;
    // 白描边保证在网格线/图形上也读得清
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeText(text, lx, ly);
    ctx.fillStyle = rec.color;
    ctx.fillText(text, lx, ly);
  }
}

/**
 * Canvas 2D 回放器。Dry-Run **不**使用本函数（§7.1：不需要 mock canvas）。
 * @param {CanvasRenderingContext2D} ctx
 */
export function replayToCanvas(ctx, records, transform, opts = {}) {
  const theme = opts.theme ?? DEFAULT_THEME;
  const unit = transform.scale;
  const T = (x, y) => transform.worldToScreen(x, y);
  T.unit = unit;
  /** 第 8 期：箭头"防出画面"的收缩上限要用视口尺寸（`drawArrow` 里读它） */
  T.viewport = { width: transform.width ?? 0, height: transform.height ?? 0 };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 网格（世界 1 单位格；过密时自动跳格）
  const gridStep = unit >= 26 ? 1 : unit >= 12 ? 2 : 5;
  if (opts.grid !== false) {
    const left = transform.worldToScreen(transform.minX, 0).x;
    const right = transform.worldToScreen(transform.maxX, 0).x;
    const bottom = transform.worldToScreen(0, transform.minY).y;
    const top = transform.worldToScreen(0, transform.maxY).y;
    const x0 = Math.ceil(transform.minX / gridStep) * gridStep;
    const y0 = Math.ceil(transform.minY / gridStep) * gridStep;
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= transform.maxX; x += gridStep) {
      const sx = Math.round(T(x, 0).x) + 0.5;
      ctx.moveTo(sx, Math.min(top, bottom) - 40);
      ctx.lineTo(sx, Math.max(top, bottom) + 40);
    }
    for (let y = y0; y <= transform.maxY; y += gridStep) {
      const sy = Math.round(T(0, y).y) + 0.5;
      ctx.moveTo(Math.min(left, right) - 40, sy);
      ctx.lineTo(Math.max(left, right) + 40, sy);
    }
    ctx.stroke();
    // 坐标轴
    ctx.strokeStyle = theme.gridStrong;
    ctx.beginPath();
    const ax = Math.round(T(0, 0).x) + 0.5;
    const ay = Math.round(T(0, 0).y) + 0.5;
    ctx.moveTo(ax, Math.min(top, bottom) - 40);
    ctx.lineTo(ax, Math.max(top, bottom) + 40);
    ctx.moveTo(Math.min(left, right) - 40, ay);
    ctx.lineTo(Math.max(left, right) + 40, ay);
    ctx.stroke();
  }

  ctx.lineWidth = 1.5;

  /**
   * ── 第 8 期：**箭头自动错开**（用户 2026-10-18 裁决）──
   *
   * 背景（用户真题）：`drawFrame` 里的箭头是**手写偏移**的 —— 速度箭头被挪到离质心 0.71 m
   * 的地方，只因为要避开另一支箭头。裁判口语："箭头没有跟物体的质心绑定"。
   *
   * 之所以只能手写偏移，是因为卡片里写着"交给 `Draw.arrow` 的自动偏移"，而 SDK **根本没有**这个功能
   * （那是我们的错，卡片已改）。现在把它做出来：
   *   · 同一帧里**起点相同**（同一世界坐标、容差 1e-6）且 **`category` 相同**的箭头算一组；
   *   · 组内按出现顺序**沿垂直于自身方向**错开 `ARROW_STACK_PX` 像素（居中对称）；
   *   · 这样模型可以放心地把所有箭头都锚在质心，不会叠成一坨。
   *
   * ⚠ 只在**渲染**里错开，不改命令记录：包络/取景按 `from` 算，箭头本来就不参与取景（互不干扰）。
   */
  const arrowOffsets = computeArrowStackOffsets(records);
  for (const rec of records) {
    /* 保险：真实浏览器只接受数字数组；老记录/异常记录一律按实线画，绝不让 setLineDash 崩整帧 */
    ctx.setLineDash(Array.isArray(rec.dash) ? rec.dash : []);
    switch (rec.op) {
      case 'line': {
        const a = T(rec.x1, rec.y1);
        const b = T(rec.x2, rec.y2);
        ctx.strokeStyle = rec.color;
        ctx.lineWidth = rec.width;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        break;
      }
      case 'arrow':
        drawArrow(ctx, T, rec, opts.vectorMax ?? null, arrowOffsets.get(rec) ?? null);
        break;
      case 'polygon': {
        const pts = rec.points.map(([x, y]) => T(x, y));
        if (rec.fill) {
          ctx.fillStyle = rec.fill;
          ctx.beginPath();
          pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          if (rec.closed) ctx.closePath();
          ctx.fill();
        }
        if (rec.hatch && pts.length >= 2) hatchPolygon(ctx, pts, rec.hatch);
        if (rec.stroke) {
          ctx.strokeStyle = rec.stroke;
          ctx.lineWidth = rec.width;
          ctx.beginPath();
          pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          if (rec.closed) ctx.closePath();
          ctx.stroke();
        }
        break;
      }
      case 'circle': {
        const c = T(rec.cx, rec.cy);
        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(0.5, rec.r * unit), 0, TAU);
        if (rec.fill) {
          ctx.fillStyle = rec.fill;
          ctx.fill();
        }
        if (rec.stroke) {
          ctx.strokeStyle = rec.stroke;
          ctx.lineWidth = rec.width;
          ctx.stroke();
        }
        if (isFiniteNumber(rec.angleDeg)) {
          const rad = ((rec.angleDeg - 90) * Math.PI) / 180;
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(c.x + Math.cos(rad) * rec.r * unit, c.y + Math.sin(rad) * rec.r * unit);
          ctx.stroke();
        }
        break;
      }
      case 'spring':
        ctx.strokeStyle = rec.color;
        ctx.lineWidth = 1.6;
        drawSpringPath(ctx, rec, T);
        break;
      case 'pulley': {
        const c = T(rec.c[0], rec.c[1]);
        const r = rec.r * unit;
        ctx.strokeStyle = rec.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, TAU);
        ctx.stroke();
        if (rec.hub) {
          ctx.beginPath();
          ctx.arc(c.x, c.y, Math.max(1.5, r * 0.12), 0, TAU);
          ctx.fillStyle = rec.color;
          ctx.fill();
        }
        break;
      }
      case 'belt': {
        const a = T(rec.a[0], rec.a[1]);
        const b = T(rec.b[0], rec.b[1]);
        const r = rec.r * unit;
        ctx.strokeStyle = rec.color;
        ctx.lineWidth = 1.6;
        for (const c of [a, b]) {
          ctx.beginPath();
          ctx.arc(c.x, c.y, r, 0, TAU);
          ctx.stroke();
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * r;
        const ny = (dx / len) * r;
        ctx.beginPath();
        ctx.moveTo(a.x + nx, a.y + ny);
        ctx.lineTo(b.x + nx, b.y + ny);
        ctx.moveTo(a.x - nx, a.y - ny);
        ctx.lineTo(b.x - nx, b.y - ny);
        ctx.stroke();
        if (rec.ticks > 0) {
          ctx.strokeStyle = theme.guide;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 0; i < rec.ticks; i += 1) {
            const u = ((i + rec.tickPhase) % rec.ticks) / rec.ticks;
            const bx = a.x + nx + (b.x - a.x + 0) * u;
            const by = a.y + ny + (b.y - a.y) * u;
            ctx.moveTo(bx, by);
            ctx.lineTo(bx - nx * 0.6, by - ny * 0.6);
          }
          ctx.stroke();
        }
        break;
      }
      case 'fieldDots': {
        const o = T(rec.x, rec.y);
        const w = rec.w * unit;
        const h = rec.h * unit;
        ctx.strokeStyle = rec.color;
        ctx.fillStyle = rec.color;
        ctx.lineWidth = 1.4;
        for (let i = 0; i < rec.nx; i += 1) {
          for (let j = 0; j < rec.ny; j += 1) {
            const px = o.x + ((i + 0.5) / rec.nx) * w;
            const py = o.y - ((j + 0.5) / rec.ny) * h;
            if (rec.symbol === 'dot') {
              ctx.beginPath();
              ctx.arc(px, py, 2, 0, TAU);
              ctx.fill();
            } else {
              const s = 3.2;
              ctx.beginPath();
              ctx.moveTo(px - s, py - s);
              ctx.lineTo(px + s, py + s);
              ctx.moveTo(px + s, py - s);
              ctx.lineTo(px - s, py + s);
              ctx.stroke();
            }
          }
        }
        break;
      }
      case 'dimension': {
        const a = T(rec.x1, rec.y1);
        const b = T(rec.x2, rec.y2);
        ctx.strokeStyle = rec.color;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(a.x, a.y, 3, 0, TAU);
        ctx.arc(b.x, b.y, 3, 0, TAU);
        ctx.stroke();
        /* 方案 A：尺寸标注的数字也属于"数值"，一并删。标注线与端点保留（那是几何指示）。 */
        if (rec.text && !HIDE_CANVAS_TEXT) {
          ctx.fillStyle = rec.color;
          ctx.font = `12px ${LABEL_FONT_FAMILY}`;
          ctx.textAlign = 'center';
          ctx.fillText(rec.text, (a.x + b.x) / 2, (a.y + b.y) / 2 - 6);
        }
        break;
      }
      case 'arc': {
        const c = T(rec.cx, rec.cy);
        ctx.strokeStyle = rec.color;
        ctx.lineWidth = rec.width;
        ctx.beginPath();
        ctx.arc(c.x, c.y, rec.r * unit, (-rec.a0Deg * Math.PI) / 180, (-rec.a1Deg * Math.PI) / 180, false);
        ctx.stroke();
        break;
      }
      case 'curve': {
        const pts = rec.points.map(([x, y]) => T(x, y));
        if (rec.fill) {
          ctx.fillStyle = rec.fill;
          ctx.beginPath();
          pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          if (rec.closed) ctx.closePath();
          ctx.fill();
        }
        ctx.strokeStyle = rec.color;
        ctx.lineWidth = rec.width;
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        if (rec.closed) ctx.closePath();
        ctx.stroke();
        break;
      }
      case 'ray': {
        const a = T(rec.x1, rec.y1);
        const b = T(rec.x2, rec.y2);
        ctx.strokeStyle = rec.color;
        ctx.lineWidth = rec.width;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (rec.arrowHead) {
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          const s = 9;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - Math.cos(ang - 0.4) * s, b.y - Math.sin(ang - 0.4) * s);
          ctx.lineTo(b.x - Math.cos(ang + 0.4) * s, b.y - Math.sin(ang + 0.4) * s);
          ctx.closePath();
          ctx.fillStyle = rec.color;
          ctx.fill();
        }
        break;
      }
      case 'lens': {
        const a = T(rec.cx, rec.cy + rec.height / 2);
        const b = T(rec.cx, rec.cy - rec.height / 2);
        const bulge = Math.max(6, Math.min(18, rec.focal * unit * 0.1));
        ctx.strokeStyle = rec.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.quadraticCurveTo(b.x + bulge, (a.y + b.y) / 2, a.x, a.y);
        ctx.moveTo(b.x, b.y);
        ctx.quadraticCurveTo(b.x - bulge, (a.y + b.y) / 2, a.x, a.y);
        ctx.stroke();
        break;
      }
      case 'axisBox': {
        const o = T(rec.x, rec.y);
        const xLen = rec.xLen * unit;
        const yLen = rec.yLen * unit;
        ctx.strokeStyle = rec.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(o.x + xLen, o.y);
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(o.x, o.y - yLen);
        ctx.stroke();
        /* 方案 A 的**唯一例外**：坐标轴轴名（`p` / `V`）。
           删了它，`p–V` 图就成了一条没有坐标的曲线 —— 那不是"说明"，是图的组成部分。
           见 `KEEP_AXIS_LABELS`。 */
        if (KEEP_AXIS_LABELS) {
          ctx.fillStyle = rec.color;
          ctx.font = `12px ${LABEL_FONT_FAMILY}`;
          ctx.textAlign = 'right';
          ctx.fillText(rec.xLabel, o.x + xLen, o.y + 16);
          ctx.save();
          ctx.translate(o.x - 10, o.y - yLen);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'right';
          ctx.fillText(rec.yLabel, 0, 0);
          ctx.restore();
        }
        break;
      }
      case 'chart': {
        const pts = rec.data.map(([x, y]) => T(x, y));
        if (!pts.length) break;
        const base = T(rec.data[0][0], rec.baseline).y;
        if (rec.fill) {
          ctx.fillStyle = rec.fill;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, base);
          pts.forEach((p) => ctx.lineTo(p.x, p.y));
          ctx.lineTo(pts[pts.length - 1].x, base);
          ctx.closePath();
          ctx.fill();
        }
        ctx.strokeStyle = rec.stroke;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        if (isFiniteNumber(rec.cursor)) {
          const idx = Math.max(0, Math.min(pts.length - 1, Math.round(rec.cursor)));
          ctx.fillStyle = rec.color;
          ctx.beginPath();
          ctx.arc(pts[idx].x, pts[idx].y, 3.4, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'text':
      case 'latex': {
        /* 方案 A：画布上不再画字（连引线也不画 —— 字都没了，引线指给谁看）。
           见 `HIDE_CANVAS_TEXT` 的说明。 */
        if (HIDE_CANVAS_TEXT) break;
        const p = T(rec.x, rec.y);
        if (rec.leaderTo) {
          const l = T(rec.leaderTo.x, rec.leaderTo.y);
          ctx.strokeStyle = theme.guide;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(l.x, l.y);
          ctx.stroke();
        }
        const label = rec.op === 'text' ? rec.text : rec.tex;
        const rendered = opts.renderLatex ? opts.renderLatex(rec) : null;
        if (rendered) {
          const w = rendered.width ?? 40;
          const h = rendered.height ?? 20;
          const dx = rec.align === 'left' ? 0 : rec.align === 'right' ? -w : -w / 2;
          const dy = rec.baseline === 'top' ? 0 : rec.baseline === 'bottom' ? -h : -h / 2;
          ctx.drawImage(rendered, p.x + dx, p.y + dy, w, h);
        } else {
          ctx.fillStyle = rec.color;
          ctx.font = `${rec.size}px ${LABEL_FONT_FAMILY}`;
          ctx.textAlign = rec.align === 'center' ? 'center' : rec.align;
          ctx.textBaseline = rec.baseline;
          ctx.fillText(label, p.x, p.y);
        }
        break;
      }
      case 'raw': {
        if (rec.fn) rec.fn(ctx, transform);
        break;
      }
      default:
        break;
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
  return records.length;
}

/* ─────────────────────── 程序执行（Dry-Run 与播放共用） ─────────────────────── */

/**
 * 在给定上下文里执行一次 AnimationProgram：setup 一次，然后按固定步长扫全时段。
 * 这个函数**不渲染**——渲染是调用方拿到命令缓冲之后的事（§5.2）。
 * 每一帧都用 `buffer.reset()` 清空后重推，因此"每帧命令数"就是 C9 的观测量。
 */
export function runProgram(program, opts = {}) {
  const dt = opts.dt ?? 1 / 240;
  const buffer = new CommandBuffer();
  const draw = new Draw(buffer, { theme: opts.theme });
  const runtime = { CommandBuffer, Draw, PhysRef: { integrate, interp, roots, format } };
  program.setup(buffer, draw, runtime);

  const duration = resolveDuration(program);
  const frames = [];
  const readoutSeries = [];

  for (let t = 0; t <= duration + 1e-9; t += dt) {
    const time = Math.min(t, duration);
    const state = program.stateAt(time, buffer, draw, runtime);
    buffer.reset();
    program.drawFrame(time, state, buffer, draw, runtime);
    const frameRecords = buffer.records.slice();
    const envelope = buffer.envelope();
    const readouts = normalizeReadouts(program.readouts(time, state, buffer, draw, runtime));
    frames.push({ t: time, state, records: frameRecords, envelope, commandCount: frameRecords.length });
    readoutSeries.push({ t: time, readouts });
  }

  return { duration, dt, frames, readoutSeries, draw, buffer };
}

/** `SIM.duration` 是 §3.2 VIEW 的必填项；缺失时回落到 STEPS 末步 t1 */
export function resolveDuration(program) {
  const fromSim = program?.SIM?.duration;
  if (isFiniteNumber(fromSim) && fromSim > 0) return fromSim;
  const steps = program?.STEPS;
  if (Array.isArray(steps) && steps.length) {
    const last = steps[steps.length - 1];
    if (isFiniteNumber(last?.t1)) return last.t1;
  }
  throw new Error('无法确定 duration：SIM.duration 缺失且 STEPS 末步 t1 不可用（§3.2 VIEW / STEPS 契约）');
}

/** §3.4 readouts 返回结构归一化：数组或 {key: Readout} 映射都接受，键顺序稳定 */
export function normalizeReadouts(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((r) => ({
      key: r.key ?? r.label ?? '',
      label: r.label ?? r.key ?? '',
      value: r.value === undefined ? null : r.value,
      unit: r.unit ?? '',
      latex: r.latex ?? null,
    }));
  }
  if (typeof value === 'object') {
    return Object.entries(value).map(([key, r]) => ({
      key,
      label: r?.label ?? key,
      value: r?.value === undefined ? null : r.value,
      unit: r?.unit ?? '',
      latex: r?.latex ?? null,
    }));
  }
  throw new TypeError('readouts(t) 必须返回 Readout[] 或 {key: Readout} 映射（§3.4）');
}

/* ──────────────────── 浏览器宿主（模板页装配时注入依赖） ──────────────────── */

/** 沙箱/浏览器可见的 SDK 集合（与 Dry-Run 的 makeRuntimeBundle 同口径） */
export function sandboxBundle() {
  return {
    CommandBuffer,
    Draw,
    PhysRef,
    AutoView,
    interp,
    roots,
    integrate,
    format,
    replayToCanvas,
    resolveDuration,
    normalizeReadouts,
    buildProgramSource,
    replaceDataSlotTokens,
    assembleProgramSource,
    normalizeDataSlot,
  };
}

/** 由装配好的工厂函数创建播放器（模板页在浏览器里走这条路） */
export function createPlayerFromFactory(factory, opts) {
  return createPlayer(factory(sandboxBundle()), opts);
}

/* ─────────────────── 程序执行器（**单一实现**，被两处复用） ───────────────────
 *   · `core/dryrun/dry-run.mjs` —— 校验时用（无头、不渲染，只计数与看数值）
 *   · 本文件的 `createPlayer` —— 播放时用（同一份采样逻辑）
 * 为什么必须共用：q02 需要"全程轨迹"（`context.at(t)` 只读探针）与全时段包络，
 * 两条路径各自实现就会出现"播放器能跑、Dry-Run 报 context.at is not a function"这类分叉，
 * 而 §13.1 的承诺是"屏幕上看到的 = 校验过的"。
 *
 * ⚠ 这些函数**必须留在本文件里**（不能再拆回 `program-runner.mjs` 反向 import）：
 * 运行时会被 `template/build-template.mjs` 转成**经典脚本**直接塞进单文件 HTML，
 * 经典脚本里不允许出现 `import`。历史上正是这条反向 import 让 16 个成品页全部白屏
 * （浏览器报 "Cannot use import statement outside a module"，RT 未定义 ⇒ 只有"运行时未注入"提示）。
 * `program-runner.mjs` 现在只是**转发本文件**的薄壳，保持 Dry-Run 的导入路径不变。
 */

/**
 * 槽位代码可见的 SDK 集合。
 *
 * `extra`（第 2 期新增）：Dry-Run 用它在**不改采样逻辑**的前提下换上
 *   · `__odMark` / `__odSnap` —— 行号探针；
 *   · 带行号戳的 `CommandBuffer` / `Draw` —— 让每条绘制命令都能回指 drawFrame 的源码行。
 * 浏览器播放不传 `extra`，行为与第 1 期逐字一致。
 */
export function runnerBundle(extra = {}) {
  return { CommandBuffer, Draw, PhysRef, ...extra };
}

/**
 * 装配后的工厂函数 → 可执行实例。
 * 这里**注入只读探针与时长**，保证 stateAt / drawFrame / readouts 拿到同一个 context。
 * @param {object} [opts.runner] 第 2 期：注入行号探针/带戳缓冲（见 `runnerBundle`）
 */
export function instantiate(factory, opts = {}) {
  const program = factory(runnerBundle(opts.runner));
  program.setup();
  const duration = resolveDuration(program);
  // 只读探针：drawFrame 可用（画全程轨迹），stateAt 里禁用（C1 有判据拦截）
  program.context.at = (t) => program.stateAt(t);
  program.context.duration = duration;
  return { program, duration };
}

/**
 * 采样一帧：跑一次 stateAt + drawFrame，返回命令记录与可选读数。
 * 每次都 `buffer.reset()`，因此"每帧命令数"就是 C9 的观测量。
 */
export function sampleFrame(program, t, opts = {}) {
  const buffer = program.buffer;
  buffer.reset();
  const state = program.stateAt(t);
  program.drawFrame(t, state);
  const records = buffer.records.slice();
  const frame = {
    t,
    state,
    records,
    commandCount: records.length,
    envelope: buffer.envelope(),
  };
  if (opts.readouts) {
    frame.readouts = normalizeReadouts(program.readouts(t, state));
  }
  return frame;
}

/**
 * §4.6 第一遍：全时段总包络（供 AutoView 锁相机）。
 * @param {object} program 已 setup（含 context.at）的程序
 */
export function fullEnvelope(program, opts = {}) {
  const samples = Math.max(8, Math.floor(opts.samples ?? 240));
  const duration = resolveDuration(program);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i <= samples; i += 1) {
    const frame = sampleFrame(program, (duration * i) / samples);
    if (!frame.envelope) continue;
    minX = Math.min(minX, frame.envelope.minX);
    minY = Math.min(minY, frame.envelope.minY);
    maxX = Math.max(maxX, frame.envelope.maxX);
    maxY = Math.max(maxY, frame.envelope.maxY);
  }
  program.buffer.reset();
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * ── 第 8 期：**取景只看实体**（用户 2026-10-18 裁决）──
 *
 * 用户的原话："动画里面的东西太小，学生很难看清"。
 * 我们不去限制模型怎么画（那是硬规矩），而是把**取景口径**修对：
 *
 *   · 箭头 —— 早就排除了（箭头画大→包络变大→相机拉远→一切更小，是自我打架）；
 *   · `text` / `latex` / `dimension` —— 它们是**标注**，不是内容。
 *     一个停在 `x=-3.25` 的公式标签能把画幅撑宽 2 m，而它本身是零尺寸的点；
 *   · `hatch` 填充的 `polygon`（地面 / 阴面）—— 它们本来就"该延伸出画面"，
 *     让一条比物体长 2 倍的阴面线决定取景，等于让背景决定主体大小。
 *
 * 实测（用户真题 export-20261018-020114-067）：
 *   旧口径包络 4.58 × 1.39 m（物体只占 2.2 × 0.46）⇒ 木板 180 px；
 *   新口径包络 2.34 × 1.39 m ⇒ 木板 560 px（同一份代码，画面大 3 倍）。
 *
 * ⚠ 兜底：若"只算实体"后包络为空或退化（例如整题只画了一个标注），
 *   退回旧口径 —— 宁可小一点，也不能没有画幅。
 */
const FRAME_EXCLUDE_OPS = Object.freeze(['arrow', 'text', 'latex', 'dimension']);

/** 参考面：`hatch` 填充的多边形（地面 / 斜线阴影），取景时不算内容（照画，只是不参与定框） */
function isReferenceSurface(record) {
  return record?.op === 'polygon' && Boolean(record.hatch);
}

/**
 * ── 第 8 期：**取景计划**（两遍法）──
 *
 * 用户要求「三类矢量分别比较长度」。要满足它，箭头长度必须由"该类整段最大值"
 * 归一，而长度又进入包络、包络决定相机 —— 于是需要两遍：
 *
 *   第一遍：只算**不含箭头**的包络（箭头是装饰，不该撑大画面），
 *          同时统计每类箭头的最大量级；
 *   第二遍：用归一后的长度把箭头算进包络，得到最终的取景框。
 *
 * 为什么满量程用"画面短边的比例"而不是像素：像素要换算得先知道相机，
 * 而相机正是第二遍才算出来的 —— 用像素就成环了。
 *
 * @param {object} program
 * @param {{ samples?: number }} [opts]
 * @returns {{ envelope: object|null, vectorScale: Record<string, number>, maxMag: Record<string, number>, span: number }}
 */
export function computeFramingPlan(program, opts = {}) {
  const samples = Math.max(8, Math.floor(opts.samples ?? 240));
  const duration = resolveDuration(program);
  const union = (a, b) =>
    a && b
      ? {
          minX: Math.min(a.minX, b.minX),
          minY: Math.min(a.minY, b.minY),
          maxX: Math.max(a.maxX, b.maxX),
          maxY: Math.max(a.maxY, b.maxY),
        }
      : a || b || null;

  /* ── 第一遍 ── */
  let bare = null;
  const maxMag = Object.create(null);
  const frameOpts = { excludeOps: FRAME_EXCLUDE_OPS, skip: isReferenceSurface };
  for (let i = 0; i <= samples; i += 1) {
    const frame = sampleFrame(program, (duration * i) / samples);
    bare = union(bare, program.buffer.envelope(frameOpts));
    for (const r of frame.records) {
      if (r?.op !== 'arrow') continue;
      const m = arrowMagnitude(r);
      if (!(m > 0)) continue;
      const cat = r.category ?? 'aux';
      if (!(maxMag[cat] >= m)) maxMag[cat] = m;
    }
  }

  /**
   * 兜底：实体包络退化（整题只有标注 / 只有一条公式）时退回旧口径，
   * 否则相机会因为没有内容而算出荒谬比例。
   */
  if (!bare || bare.maxX - bare.minX < 1e-6 || bare.maxY - bare.minY < 1e-6) {
    let fallback = null;
    for (let i = 0; i <= samples; i += 1) {
      sampleFrame(program, (duration * i) / samples);
      fallback = union(fallback, program.buffer.envelope({ excludeOps: new Set(['arrow']) }));
    }
    if (fallback) bare = fallback;
  }

  const span = bare ? Math.min(bare.maxX - bare.minX, bare.maxY - bare.minY) : 0;

  /* 名义相机：用"不含箭头"的包络在 960×540 下算一次（AutoView 含 Nice Numbers 吸附，
     与实际相机的口径一致）。有了它，满量程就能按"像素"给，而不用受画面宽高比影响。 */
  const nominalScale = bare ? AutoView.fit(bare, NOMINAL_VIEWPORT).scale : 0;

  const vectorScale = Object.create(null);
  for (const [cat, targetPx] of Object.entries(VECTOR_TARGET_PX)) {
    const m = maxMag[cat] ?? 0;
    if (!(m > 0)) continue;
    if (nominalScale > 0) {
      // 主路径：满量程 = targetPx 像素 ⇒ 换算成世界单位后除以该类最大量级
      vectorScale[cat] = targetPx / nominalScale / m;
    } else if (span > 0) {
      // 保底：包络退化到算不出相机时，退回"画面短边的分数"
      vectorScale[cat] = ((VECTOR_TARGET_RATIO[cat] ?? 0.15) * span) / m;
    }
  }

  /**
   * ── 第 8 期（用户 2026-10-17 二次裁决）：**箭头不参与取景** ──
   *
   * 原因：箭头是**标注**，不该决定"照片拍多广"。让它参与取景会自我打架 ——
   * 箭头画大 → 包络变大 → 相机拉远 → 一切又变小（用户实测"很小，非常之小"就是这个）。
   *
   * 所以最终包络**只用实体**（`bare`）。箭头按像素画，过长时由
   * `ARROW_MAX_VIEWPORT_RATIO` 限制在画面内（图例里写明了）。
   */
  const vectorMax = Object.keys(vectorScale).length ? vectorScale : null;
  program.buffer.reset();

  return { envelope: bare, vectorScale: vectorMax ?? {}, maxMag: { ...maxMag }, span, nominalScale };
}

/** `createPlayer` 内部沿用的旧名字（对外以 `Runtime.computeFullEnvelope` 暴露同一个函数） */
export const computeFullEnvelope = fullEnvelope;

/**
 * 固定步长扫描全时段（Dry-Run 用；播放器不需要，它只按当前 t 采一帧）。
 * @returns {{duration:number, dt:number, frames:Array, readoutSeries:Array}}
 */
export function scanAll(program, opts = {}) {
  const baseDt = opts.dt ?? 1 / 240;
  const maxFrames = opts.maxFrames ?? 200000;
  const budget = opts.budgetMs ?? Infinity;
  const started = Date.now();
  const duration = resolveDuration(program);
  const frames = [];
  const readoutSeries = [];

  /**
   * ── 采样归一（第 8 期，用户裁决）──
   *
   * 问题：`dt` 固定 1/240 秒 ⇒ **物理时长越长，采样帧数越多**（60 秒的题就是 14400 帧），
   * 校验耗时随题长线性膨胀，于是"全时段跑不完"变成对长题的不公平惩罚。
   *
   * 现在的口径：**全时段固定最多采样 MAX_SCAN_FRAMES 帧**。
   *   · 短题（≤10 s）：`dt` 仍是 1/240，行为与以前**逐字一致**（15 道真题全在这里）；
   *   · 长题（>10 s）：按 `duration / MAX_SCAN_FRAMES` 等分，计算量封顶。
   *
   * ⚠ 只改**校验的采样密度**，**不改动画时长**：
   *   `SIM.duration` 该多长还是多长，播放器照原样播；C7 也在 `at_t` 处**精确求值**（不依赖采样点）。
   */
  const MAX_SCAN_FRAMES = 2400; // 10 s × 240 Hz
  const natural = Math.ceil(duration / baseDt) + 1;
  const dt = natural > MAX_SCAN_FRAMES ? duration / MAX_SCAN_FRAMES : baseDt;

  for (let t = 0; t <= duration + 1e-9; t += dt) {
    if (frames.length >= maxFrames) {
      return { duration, dt, frames, readoutSeries, truncated: 'step-budget' };
    }
    if (Date.now() - started > budget) {
      return { duration, dt, frames, readoutSeries, truncated: 'wall-clock' };
    }
    const time = Math.min(t, duration);
    const frame = sampleFrame(program, time, { readouts: true });
    frames.push(frame);
    readoutSeries.push({ t: time, readouts: frame.readouts });
  }
  return { duration, dt, frames, readoutSeries, truncated: null };
}

/**
 * 播放器。相机口径（§4.6）：
 *   · 初始化时用 `computeFullEnvelope` 扫一遍全时段，得到**固定变换**；
 *   · 播放期间每帧复用同一变换，绝不因物体移动而重新取景；
 *   · 仅当画布尺寸变化（`setViewport` / resize）时重算一次。
 * 代价是画面按"全程最大范围"取景，剧烈平移的题（如 q03 追及）整体会小一些——
 * 这是为换取"地面不动"，也是 §4.6 的原文要求。
 */
export function createPlayer(program, opts) {
  const canvas = opts.canvas;
  const ctx = canvas.getContext('2d');
  // ⚠ 槽位代码通过**闭包**拿到装配时创建的 buffer 与 Draw（见 buildProgramSource），
  // 因此播放器必须复用 `program.buffer`，不能再 new 一个 CommandBuffer——
  // 否则 drawFrame 推的记录与播放器读的缓冲不是同一个（渲染会得到空帧）。
  const buffer = program.buffer;
  const draw = program.Draw;
  const runtime = sandboxBundle();
  program.setup();
  const duration = resolveDuration(program);
  // 与 Dry-Run 同一份初始化（只读探针 + 时长），保证"屏幕上看到的 = 校验过的"
  program.context.at = (t) => program.stateAt(t);
  program.context.duration = duration;

  const state = {
    t: 0,
    playing: false,
    rate: 1,
    stepIndex: 0,
    mask: { velocity: true, acceleration: true, force: true, aux: true, trace: true, grid: true },
    theme: opts.theme ?? DEFAULT_THEME,
  };

  /**
   * 取景：第 8 期起走**两遍法**（`computeFramingPlan`），顺带拿到每类的归一比例。
   * 调用方仍可传 `opts.envelope` 直接指定取景（测试与老调用方）。
   */
  const framing = opts.framing
    ? opts.framing
    : opts.envelope
      ? { envelope: opts.envelope, vectorScale: opts.vectorScale ?? null }
      : computeFramingPlan(program, { samples: opts.envelopeSamples });
  const fullEnvelope = framing.envelope;
  const vectorScale = framing.vectorScale ?? null;
  const vectorMaxByCat = framing.maxMag ?? null;

  /**
   * 标注避让（C2）：偏移表 + 套表函数，都由调用方注入。
   * 二者缺一 ⇒ 完全不挪（模板页没注入时行为与第 7 期一致）。
   */
  const labelAvoidTable = opts.labelAvoid && typeof opts.labelAvoid === 'object' ? opts.labelAvoid : null;
  const labelAvoidApply = typeof opts.labelAvoidApply === 'function' ? opts.labelAvoidApply : null;

  let viewport = null;
  let transform = null;

  function viewportOf() {
    const dpr = opts.dpr ?? 1;
    const width = Math.max(1, canvas.clientWidth || canvas.width || 640);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 360);
    return { width, height, dpr };
  }

  /** 画布尺寸变化时重算一次相机；播放期间不再调用 */
  function setViewport(next) {
    viewport = { width: Math.max(1, next.width), height: Math.max(1, next.height), dpr: next.dpr ?? opts.dpr ?? 1 };
    transform = AutoView.fit(fullEnvelope, { width: viewport.width, height: viewport.height });
    return transform;
  }

  function render() {
    const vp = viewportOf();
    if (!viewport || viewport.width !== vp.width || viewport.height !== vp.height || viewport.dpr !== vp.dpr) {
      setViewport(vp);
    }
    canvas.width = Math.round(vp.width * vp.dpr);
    canvas.height = Math.round(vp.height * vp.dpr);
    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
    ctx.clearRect(0, 0, vp.width, vp.height);
    ctx.fillStyle = state.theme.bg;
    ctx.fillRect(0, 0, vp.width, vp.height);

    // 单一固定变换：命令缓冲只跑一遍，既取记录又渲帧。
    // 相机由 computeFullEnvelope 预先锁死，这里**不再**逐帧 AutoView.fit。
    buffer.reset();
    const st = program.stateAt(state.t);
    program.drawFrame(state.t, st);

    const visible = buffer.records.filter((r) => {
      if (r.op === 'arrow') return state.mask[r.category] !== false;
      if (r.op === 'curve' && r.dash) return state.mask.trace !== false;
      return true;
    });

    /**
     * ── 标注避让（C2 · 第 8 期）──
     *
     * 把 Dry-Run 算出来的**整段唯一偏移**套到本帧的文字上。
     * 只动 `text` / `latex`；挪过的会带上 `leaderTo`，引线由 `replayToCanvas` 画
     * （那个能力第 3 期就有，`Draw.text({leaderTo})` 一直在用）。
     *
     * 为什么把 `labelAvoidApply` 做成**注入**而不是在这里 import：
     *   运行时必须能当"经典脚本"内联（`toClassicScript` 见到 import 直接报错），
     *   而 key 规则只能有一份实现（`sdk/runtime/label-avoid.mjs`）。
     *   所以模板把那份实现注入进来，这里只负责调用。
     *
     * ⚠ 避让是增强项：它抛错绝不能把播放带崩（宁可字不挪，也不要黑屏）。
     */
    let painted = visible;
    if (labelAvoidTable && labelAvoidApply) {
      try {
        const applied = labelAvoidApply(visible, labelAvoidTable);
        if (applied && Array.isArray(applied.records)) painted = applied.records;
      } catch {
        painted = visible;
      }
    }

    replayToCanvas(ctx, painted, transform, {
      theme: state.theme,
      grid: state.mask.grid !== false,
      renderLatex: opts.renderLatex,
      /* 第 8 期：每类的整段最大量级（箭头长度按它归一） */
      vectorMax: vectorMaxByCat,
    });
    return {
      transform,
      fullEnvelope,
      state: st,
      /** 本帧推入的全部命令（含被开关过滤掉的） */
      records: buffer.records.slice(),
      /** 真正回放到 Canvas 的命令数（矢量开关生效后的数量） */
      painted: painted.length,
      readouts: normalizeReadouts(program.readouts(state.t, st)),
    };
  }

  return {
    state,
    render,
    duration,
    runtime,
    buffer,
    draw,
    program,
    fullEnvelope,
    /* 第 8 期：调试与门禁要能看到"这一题各类箭头的归一比例" */
    framing,
    vectorScale,
    setViewport,
    get transform() {
      return transform;
    },
  };
}

/* ────────────────────────────── 导出面 ────────────────────────────── */

/** 装入沙箱/浏览器时通过 `runtime.PhysRef` 暴露给槽位代码（§4.3） */
export const PhysRef = Object.freeze({ integrate, interp, roots, format });
export const Runtime = {
  TAU,
  DEG,
  DEFAULT_THEME,
  VECTOR_COLORS,
  OP_KINDS,
  CommandBuffer,
  Draw,
  AutoView,
  integrate,
  interp,
  roots,
  format,
  PhysRef,
  splitSlots,
  buildProgramSource,
  replaceDataSlotTokens,
  assembleProgramSource,
  DATA_SLOT_TOKENS,
  DATA_SLOTS,
  CODE_SLOTS,
  runProgram,
  resolveDuration,
  normalizeReadouts,
  normalizeDataSlot,
  parseStepsSlot,
  parseAnswersSlot,
  replayToCanvas,
  createPlayer,
  computeFullEnvelope,
  /* 第 8 期：矢量按类归一（长度 = 量级 ÷ 该类最大值 × 该类满量程） */
  computeFramingPlan,
  VECTOR_TARGET_PX,
  VECTOR_TARGET_RATIO,
  ARROW_MIN_PX,
  ARROW_MAX_VIEWPORT_RATIO,
  /** 第 8 期：同点同类箭头的自动错开（步长 + 分组函数，渲染层与测试共用） */
  ARROW_STACK_PX,
  computeArrowStackOffsets,
  arrowDirection,
  arrowMagnitude,
  arrowLengthPx,
  arrowWorldLength,
  fullEnvelope,
  runnerBundle,
  instantiate,
  sampleFrame,
  scanAll,
  sandboxBundle,
  createPlayerFromFactory,
  SLOT_FROZEN_KEYS,
};

export default Runtime;
