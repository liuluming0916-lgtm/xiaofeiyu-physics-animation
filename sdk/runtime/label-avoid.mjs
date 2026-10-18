/**
 * 标注避让的**几何口径**（M15 补强 · 用户 2026-10-17 追加要求）
 *
 * 用户原话：「动画上附带的说明要注意文字避让，主体是动画，而不是说明」。
 *
 * 这个文件**只做纯计算**，不碰 Canvas、不碰文件、不碰时间：
 *   · 一个文字记录大概占多大（像素）
 *   · 它平移之后在世界坐标里占哪个盒子
 *   · 一条图元（线/圆/多边形/传送带…）占哪个盒子
 *   · 一条文字在**同一帧里的序号身份**（`deriveLabelKeys`）——避让表靠它对齐
 *
 * 为什么单独放在 SDK 而不是 dry-run 里：
 *   ① Dry-Run 用它**规划**（算出每条例注该偏多少）；
 *   ② 模板页将来用它**对齐**（同一帧、同一条注、同一个 key）；
 *   两边必须**逐字同一套规则**，否则"表里有的、画的时候找不到"。
 *   放在 `sdk/runtime/` 就是让两边都能 import 到同一份实现。
 *
 * ⚠ 文字尺寸是**估算**（Node 里没有 Canvas 的 `measureText`）。口径：
 *      全角/汉字 1 个 = 1 em，其余 0.55 em，行高 1.25 em。
 *   真浏览器里会有几个像素的出入，所以避让时按 `margin` 留了余量。
 *   **不要**把这个估算当成排版精度用。
 */

/** 避让表的格式号（表里带它，消费方可以据此拒绝陌生格式） */
export const LABEL_AVOID_FORMAT = 'od-label-avoid';
export const LABEL_AVOID_VERSION = 1;

/** 会"占地方、会挡字"的图元（`Draw.raw` 不算：它不参与任何几何推断，§5.4） */
export const OBSTACLE_OPS = Object.freeze([
  'line',
  'arrow',
  'polygon',
  'circle',
  'arc',
  'curve',
  'ray',
  'lens',
  'spring',
  'pulley',
  'belt',
  'fieldDots',
  'dimension',
]);

/** 算"注"的图元 */
export const LABEL_OPS = Object.freeze(['text', 'latex']);

/**
 * 真正会**挡住字**的图元：**有体积的物体**。
 *
 * ⚠ 这里刻意**不含** `line` / `arrow` / `curve` / `spring` / `arc` / `dimension` 这些"笔画"。
 *   原因很实在：教科书的标注本来就是**贴着笔画写**的 ——
 *   "u"写在传送带上方、"v"顺着速度箭头、"Δs"标在位移线段旁。
 *   如果把笔画也算障碍，那么**几乎每一条注都会被判"压字"**，
 *   规划器就会把所有字都推走 ⇒ 画面比不避让更难看。
 *
 *   （这个坑是 2026-10-17 实测出来的：一开始把 13 种图元都算障碍，
 *     结果 15 道题里 47 条注**全部**被判压字，偏移纯粹是噪声。）
 *
 *   真正毁可读性的是"字压在实体上"：物块、球、滑轮、传送带。
 */
export const LABEL_BLOCKERS = Object.freeze(['polygon', 'circle', 'pulley', 'belt']);

/** 默认视口：与导出的 GIF 一致（§14 定案 960×540） */
export const DEFAULT_VIEWPORT = Object.freeze({ width: 960, height: 540 });

/** 文字尺寸的安全余量（相对行高） */
export const LABEL_MARGIN = 0.12;

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 全角判断（汉字 / 假名 / 谚文 / 全角标点）——决定"占 1 em 还是 0.55 em" */
export function isWideChar(ch) {
  const c = String(ch).codePointAt(0);
  if (!Number.isFinite(c)) return false;
  return (
    (c >= 0x1100 && c <= 0x115f) || // 谚文字母
    (c >= 0x2e80 && c <= 0x303e) || // 部首 ~ 中日韩标点
    (c >= 0x3041 && c <= 0x33ff) || // 假名 ~ 中日韩兼容
    (c >= 0x3400 && c <= 0x4dbf) || // 扩展 A
    (c >= 0x4e00 && c <= 0x9fff) || // 基本区
    (c >= 0xa000 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) || // 谚文音节
    (c >= 0xf900 && c <= 0xfaff) || // 兼容表意
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) || // 全角 ASCII
    (c >= 0xffe0 && c <= 0xffe6)
  );
}

/** 一条 `text` / `latex` 记录的**原始文字**（latex 用 tex） */
export function rawTextOf(record) {
  if (!record || typeof record !== 'object') return '';
  if (record.op === 'latex') return String(record.tex ?? '');
  return String(record.text ?? '');
}

/**
 * 估算一条注在**屏幕像素**里占多大。
 *
 * @param {object} record `Draw.text` / `Draw.latex` 推入的命令缓冲记录
 * @returns {{ width: number, height: number, em: number }}
 */
export function estimateLabelPx(record) {
  const size = isFiniteNum(record?.size) && record.size > 0 ? record.size : 14;
  const text = rawTextOf(record);
  let em = 0;
  for (const ch of text) em += isWideChar(ch) ? 1 : 0.55;
  // 上下标会额外占宽（§4.2 的 `sub` / `sup`）
  if (record?.sub) em += 0.35 * String(record.sub).length;
  if (record?.sup) em += 0.35 * String(record.sup).length;

  const width = Math.max(size * 0.6, em * size) * (1 + LABEL_MARGIN);
  const height = size * 1.25 * (1 + LABEL_MARGIN);
  return { width, height, em };
}

/**
 * 一条图元在世界坐标里的包围盒（**不含文字**；文字由 `labelBoxWorld` 单独算）。
 *
 * 字段口径与 `CommandBuffer.envelope()` 逐条对齐（同一份运行时，
 * 唯一区别是这里返回"盒"而不是"并集"）。
 *
 * @param {object} r
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}|null}
 */
export function obstacleBoxWorld(r) {
  if (!r || typeof r !== 'object') return null;
  if (!OBSTACLE_OPS.includes(r.op)) return null;

  const pts = [];
  const add = (x, y) => {
    if (isFiniteNum(x) && isFiniteNum(y)) pts.push([x, y]);
  };

  switch (r.op) {
    case 'line':
    case 'dimension':
    case 'arc':
    case 'ray':
    case 'lens':
      add(r.x1, r.y1);
      add(r.x2, r.y2);
      break;
    case 'arrow':
      add(r.from?.[0], r.from?.[1]);
      add(r.from?.[0] + r.vec?.[0] * (r.scale ?? 1), r.from?.[1] + r.vec?.[1] * (r.scale ?? 1));
      break;
    case 'polygon':
    case 'curve':
      for (const p of r.points ?? []) add(p?.[0], p?.[1]);
      break;
    case 'circle':
      add(r.cx - r.r, r.cy - r.r);
      add(r.cx + r.r, r.cy + r.r);
      break;
    case 'spring':
    case 'belt':
      add(r.a?.[0], r.a?.[1]);
      add(r.b?.[0], r.b?.[1]);
      break;
    case 'pulley':
      add(r.c?.[0] - r.r, r.c?.[1] - r.r);
      add(r.c?.[0] + r.r, r.c?.[1] + r.r);
      break;
    case 'fieldDots':
      add(r.x, r.y);
      add(r.x + r.w, r.y + r.h);
      break;
    default:
      return null;
  }

  if (!pts.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * 一条注在世界坐标里的包围盒（考虑 `align` / `baseline` 与偏移量）。
 *
 * @param {object} record
 * @param {number} scale 像素/世界单位（`AutoView.fit().scale`）
 * @param {{dx?: number, dy?: number}} [offset] 世界单位偏移
 * @returns {{minX:number,minY:number,maxX:number,maxY:number,cx:number,cy:number,w:number,h:number}|null}
 */
export function labelBoxWorld(record, scale, offset = {}) {
  if (!isFiniteNum(scale) || scale <= 0) return null;
  const px = estimateLabelPx(record);
  const w = px.width / scale;
  const h = px.height / scale;
  const dx = isFiniteNum(offset.dx) ? offset.dx : 0;
  const dy = isFiniteNum(offset.dy) ? offset.dy : 0;

  let cx = (isFiniteNum(record.x) ? record.x : 0) + dx;
  let cy = (isFiniteNum(record.y) ? record.y : 0) + dy;

  if (record.align === 'left') cx += w / 2;
  else if (record.align === 'right') cx -= w / 2;
  if (record.baseline === 'top') cy -= h / 2;
  else if (record.baseline === 'bottom') cy += h / 2;

  return { minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2, cx, cy, w, h };
}

/** 两个盒子是否相交（接触边不算） */
export function boxesOverlap(a, b) {
  if (!a || !b) return false;
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** 交叠面积（不相交为 0） */
export function overlapArea(a, b) {
  if (!boxesOverlap(a, b)) return 0;
  return (Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * (Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
}

/**
 * 一帧里"注的身份"。**同一个 index 在每一帧代表同一条注。**
 *
 * 规则（刻意简单、可复现）：
 *   · 按命令顺序扫，只认 `text` / `latex`；
 *   · key = `<op>|<原文>|#<同帧内同原文的第几个>`；
 *   · 例：一帧里画了两次 "u"，key 就是 `text|u|#0` 与 `text|u|#1`。
 *
 * 这条规则是 Dry-Run 与模板页**唯一**的对齐依据 —— 两边必须逐字一致，
 * 所以它只能有一份实现（就是这里）。
 *
 * @param {object[]} records 一帧的命令缓冲
 * @returns {{ key: string, record: object }[]}
 */
export function deriveLabelKeys(records) {
  const seen = new Map();
  const out = [];
  for (const r of records ?? []) {
    if (!r || !LABEL_OPS.includes(r.op)) continue;
    const text = rawTextOf(r);
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    out.push({ key: `${r.op}|${text}|#${n}`, record: r });
  }
  return out;
}

/** 空表（降级用：宁可"不动"，也不要动错） */
export function emptyLabelAvoid(reason = null) {
  return {
    format: LABEL_AVOID_FORMAT,
    version: LABEL_AVOID_VERSION,
    skipped: reason,
    scale: null,
    labels: [],
    summary: { total: 0, moved: 0 },
  };
}

/**
 * 把避让表套到一帧的命令上 —— **渲染侧**的那一半。
 *
 * 为什么它必须在这一份文件里（而不是 Dry-Run 那边）：
 *   ① 它和 `deriveLabelKeys()` 是**同一套口径的两面**：规划时按 key 记偏移，
 *      渲染时按同一个 key 找偏移。分开放就会出现"表里有的、画的时候找不到"，
 *      而且**静默**（字不挪而已，没有任何报错）。
 *   ② 模板页要把这份实现当经典脚本内联（`window.ODLabelAvoid`），
 *      内联的正是这一个文件。放在别处就注入不到。
 *
 * @param {object[]} records 一帧的命令缓冲
 * @param {object} table 避让表
 * @returns {{records: object[], applied: number}}
 */
export function applyLabelAvoid(records, table) {
  const list = Array.isArray(records) ? records : [];
  const byKey = new Map((table?.labels ?? []).map((l) => [l.key, l]));
  // key 与规划时**同一套规则**（同一份实现），所以能对上
  const keyByRecord = new Map(deriveLabelKeys(list).map((e) => [e.record, e.key]));

  const out = [];
  let applied = 0;

  for (const r of list) {
    const key = keyByRecord.get(r);
    const hit = key ? byKey.get(key) : null;
    if (!hit || !hit.moved) {
      out.push(r);
      continue;
    }
    applied += 1;
    out.push({
      ...r,
      x: r.x + hit.offset.dx,
      y: r.y + hit.offset.dy,
      /**
       * 引线：从挪走后的位置指回**原来的锚点**。
       *
       * ⚠ 形状必须是 `{ x, y }`、不是 `[x, y]`：
       *   渲染器（`replayToCanvas` 的 text/latex 分支）读 `rec.leaderTo.x`，
       *   给数组会算出 `NaN` ⇒ 引线画不出来，**而且没有任何报错**。
       *   `Draw.text({leaderTo})` 存的也是 `{x,y}`（经 `toPoint`），这里必须一致。
       *   （第一版写成数组，门禁当时也按数组断言 —— 两边一起错，等于没测。）
       */
      leaderTo: hit.leader ? { x: r.x, y: r.y } : (r.leaderTo ?? null),
      avoidLabelKey: key,
    });
  }

  return { records: out, applied };
}
