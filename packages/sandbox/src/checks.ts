import type { Capture, CanvasInfo, Issue, Rect, TextBox } from './types.ts';

/* ---------------- 工具 ---------------- */

function area(r: Rect): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

function intersect(a: Rect, b: Rect): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, x2 - x) * Math.max(0, y2 - y);
}

const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));

/** 同一段文字被 strokeText + fillText 画了两遍，去重后再判重叠 */
export function dedupeTexts(texts: TextBox[]): TextBox[] {
  const out: TextBox[] = [];
  for (const t of texts) {
    const dup = out.some(
      (o) => o.text === t.text && Math.abs(o.x - t.x) < 1.5 && Math.abs(o.y - t.y) < 1.5,
    );
    if (!dup) out.push(t);
  }
  return out;
}

/* ---------------- 单帧检查 ---------------- */

export function checkCapture(cap: Capture, label: string): Issue[] {
  const issues: Issue[] = [];
  const canvas = cap.canvas;

  if (!canvas) {
    issues.push({
      id: 'no-canvas',
      level: 'error',
      message: `${label}：页面上找不到 <canvas> 元素，动画没有画布。`,
      hint: '需要一个 canvas 元素，并在它上面 2D 绘制。',
    });
    return issues;
  }

  for (const e of cap.errors) {
    issues.push({
      id: 'page-error',
      level: 'error',
      message: `${label}：运行报错「${e.message}」`,
      hint: e.stack ? `出错位置：${e.stack.split('\n')[1]?.trim() ?? ''}` : undefined,
    });
  }

  const nb = cap.nonBlank;
  if (nb && typeof nb.nonBlankRatio === 'number' && nb.nonBlankRatio < 0.002) {
    issues.push({
      id: 'blank',
      level: 'error',
      message: `${label}：画布几乎全空（非空白像素仅 ${(nb.nonBlankRatio * 100).toFixed(2)}%），东西没画出来。`,
      hint: '检查绘制代码是否真的执行到，或者颜色是否和背景一样。',
    });
  }

  // 越界：内容跑到画布外面
  const W = canvas.w;
  const H = canvas.h;
  const oob: string[] = [];
  for (const t of dedupeTexts(cap.texts)) {
    if (t.x < -2 || t.y < -2 || t.x + t.w > W + 2 || t.y + t.h > H + 2) {
      oob.push(`文字「${t.text}」在 (${fmt(t.x)}, ${fmt(t.y)}) 处越出画布`);
    }
  }
  for (const s of cap.shapes) {
    if (s.w * s.h > W * H * 0.9) continue;
    if (s.x < -2 || s.y < -2 || s.x + s.w > W + 2 || s.y + s.h > H + 2) {
      oob.push(`图形在 (${fmt(s.x)}, ${fmt(s.y)}) 尺寸 ${fmt(s.w)}×${fmt(s.h)} 越出画布`);
    }
  }
  for (const msg of oob.slice(0, 4)) {
    issues.push({ id: 'out-of-bounds', level: 'error', message: `${label}：${msg}` });
  }

  // 文字重叠
  const texts = dedupeTexts(cap.texts);
  let overlaps = 0;
  for (let i = 0; i < texts.length && overlaps < 3; i++) {
    for (let j = i + 1; j < texts.length && overlaps < 3; j++) {
      const a = texts[i];
      const b = texts[j];
      const inter = intersect(a, b);
      if (inter <= 1) continue;
      const ratio = inter / Math.min(area(a), area(b));
      if (ratio > 0.35) {
        overlaps++;
        issues.push({
          id: 'text-overlap',
          level: 'error',
          message: `${label}：文字重叠 ${(ratio * 100).toFixed(0)}%——「${a.text}」与「${b.text}」`,
          hint: '把其中一个标签移到空处，或缩短/错开显示。',
        });
      }
    }
  }

  // 字号过小
  const tiny = texts.filter((t) => t.size > 0 && t.size < 12).slice(0, 3);
  for (const t of tiny) {
    issues.push({
      id: 'text-small',
      level: 'warn',
      message: `${label}：文字「${t.text}」字号 ${t.size}px 偏小，投影上会看不清。`,
      hint: '正文字号不小于 14px。',
    });
  }

  if (!texts.length) {
    issues.push({
      id: 'no-labels',
      level: 'warn',
      message: `${label}：画面里没有任何文字标注（角度、数值、物体名都没有）。`,
    });
  }

  return issues;
}

/* ---------------- 采样序列检查 ---------------- */

function walkNumbers(v: any, path: string, out: { path: string; value: any }[]): void {
  if (v == null) return;
  if (typeof v === 'number') {
    out.push({ path, value: v });
    return;
  }
  if (typeof v === 'string') {
    if (/^(NaN|Infinity|-Infinity)$/.test(v)) out.push({ path, value: v });
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => walkNumbers(x, `${path}[${i}]`, out));
    return;
  }
  if (typeof v === 'object') {
    for (const k of Object.keys(v)) walkNumbers(v[k], path ? `${path}.${k}` : k, out);
  }
}

const PLAYBACK_RATIO = (pts: any[]) => {
  let ratio = 0;
  for (const p of pts) {
    const t = p?.value?.t;
    if (typeof t === 'number' && p.playback > 0) ratio = t / p.playback;
  }
  return ratio; // 物理时间 / 播放时间
};

export function checkSweep(pts: any[], canvas: CanvasInfo | null): Issue[] {
  const issues: Issue[] = [];
  if (!pts || !pts.length) return issues;

  // 1) NaN / Infinity
  let nanCount = 0;
  for (const p of pts) {
    const nums: { path: string; value: any }[] = [];
    walkNumbers(p.value, '', nums);
    for (const n of nums) {
      if (typeof n.value === 'string') {
        nanCount++;
        if (nanCount <= 3) {
          issues.push({
            id: 'nan',
            level: 'error',
            message: `播放到 ${p.playback.toFixed(2)} s 时，${n.path} 变成了 ${n.value}。`,
            hint: '多半是除以 0、开负数平方根、或者没初始化。',
          });
        }
      }
    }
  }

  // 2) 位置断层：相邻采样之间的位移突然变大
  const ratio = PLAYBACK_RATIO(pts);
  const group = new Map<string, { t: number; x: number; y: number }[]>();
  for (const p of pts) {
    const v = p.value;
    if (!v || typeof v !== 'object') continue;
    for (const key of Object.keys(v)) {
      const item = v[key];
      if (item && typeof item === 'object' && typeof item.x === 'number' && typeof item.y === 'number' && Number.isFinite(item.x) && Number.isFinite(item.y)) {
        const phys = typeof v.t === 'number' ? v.t : p.playback * ratio;
        if (!group.has(key)) group.set(key, []);
        group.get(key)!.push({ t: phys, x: item.x, y: item.y });
      }
    }
  }

  const cssW = canvas?.cssW || 1280;
  for (const [key, arr] of group) {
    if (arr.length < 4) continue;
    const steps: number[] = [];
    for (let i = 1; i < arr.length; i++) steps.push(Math.hypot(arr[i].x - arr[i - 1].x, arr[i].y - arr[i - 1].y));
    const sorted = [...steps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    let worst = { i: 0, d: 0 };
    steps.forEach((d, i) => {
      if (d > worst.d) worst = { i: i + 1, d };
    });
    const limit = Math.max(median * 6, cssW * 0.08);
    if (median > 0.2 && worst.d > limit) {
      issues.push({
        id: 'jump',
        level: 'error',
        message:
          `物体「${key}」在 t≈${arr[worst.i].t.toFixed(2)} s 处位置突然跳变 ${worst.d.toFixed(0)} px` +
          `（相邻时刻一般只走 ${median.toFixed(1)} px）。`,
        hint: '检查时间步长、变量是否被重置，或者边界条件（比如到底端后被弹回）。',
      });
    }
  }

  return issues;
}

/* ---------------- 给人看 / 给模型看的摘要 ---------------- */

export function digest(cap: Capture): string {
  const c = cap.canvas;
  const lines: string[] = [];
  if (!c) return '画布：缺失';
  const nb = cap.nonBlank;
  lines.push(
    `画布 ${c.w}×${c.h}（显示 ${c.cssW}×${c.cssH}）` +
      (nb && typeof nb.nonBlankRatio === 'number'
        ? `，非空白像素 ${(nb.nonBlankRatio * 100).toFixed(1)}%，颜色 ${nb.colors} 种`
        : ''),
  );
  const texts = dedupeTexts(cap.texts);
  if (texts.length) {
    lines.push(`文字 ${texts.length} 块：` + texts.map((t) => `「${t.text}」`).join(' '));
  } else {
    lines.push('文字 0 块');
  }
  if (cap.shapes.length) {
    const xs = cap.shapes.map((s) => s.x);
    const ys = cap.shapes.map((s) => s.y);
    const xe = cap.shapes.map((s) => s.x + s.w);
    const ye = cap.shapes.map((s) => s.y + s.h);
    lines.push(
      `图形 ${cap.shapes.length} 个，整体范围 x[${fmt(Math.min(...xs))}..${fmt(Math.max(...xe))}] y[${fmt(Math.min(...ys))}..${fmt(Math.max(...ye))}]`,
    );
  }
  if (cap.errors.length) lines.push(`报错 ${cap.errors.length} 条：` + cap.errors.map((e) => e.message).join(' / '));
  return lines.join('\n');
}
