/*
 * 页面内注入脚本（在任何页面脚本之前执行）
 *
 * 三件事：
 *   1. 虚拟时钟：接管 performance.now / Date / rAF / setTimeout / setInterval，
 *      让动画以为自己在实时跑，实际上由沙盒决定时间走到哪。
 *   2. 绘图探针：接管 CanvasRenderingContext2D 的绘制方法，记录文字块与图形包围盒
 *      （含变换矩阵），生成代码完全不需要配合。
 *   3. 采样接口：读取可选的 window.XFY.sample()，用于数值对账。
 *
 * 对外只暴露 window.__XFY_SB。
 */
(() => {
  'use strict';
  if (window.__XFY_SB) return;

  const FRAME_MS = 1000 / 60;
  const MAX_FRAMES = 120000;

  /* ================= 1. 虚拟时钟 ================= */

  const RealDate = window.Date;
  let vnow = 0;
  let frames = 0;

  const errors = [];
  function noteError(where, e) {
    if (errors.length >= 40) return;
    const msg = e && e.message ? e.message : String(e);
    errors.push({
      where,
      message: msg,
      stack: e && e.stack ? String(e.stack).split('\n').slice(0, 5).join('\n') : null,
    });
  }

  window.addEventListener('error', (ev) => {
    noteError('window.error', ev.error || ev.message);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    noteError('unhandledrejection', ev.reason);
  });

  const timers = [];
  let timerSeq = 1;
  let rafs = [];
  let rafSeq = 1;

  function schedule(fn, delay, args, period) {
    const id = timerSeq++;
    timers.push({ id, at: vnow + Math.max(0, Number(delay) || 0), fn, args: args || [], period });
    return id;
  }
  function cancel(id) {
    for (let i = 0; i < timers.length; i++) {
      if (timers[i].id === id) {
        timers.splice(i, 1);
        return;
      }
    }
  }

  function runTimers() {
    let guard = 0;
    for (;;) {
      let idx = -1;
      let best = Infinity;
      for (let i = 0; i < timers.length; i++) {
        const t = timers[i];
        if (t.at <= vnow && t.at < best) {
          best = t.at;
          idx = i;
        }
      }
      if (idx < 0 || guard++ > 5000) return;
      const tm = timers[idx];
      if (tm.period == null) timers.splice(idx, 1);
      else tm.at = vnow + Math.max(1, tm.period);
      try {
        if (typeof tm.fn === 'function') tm.fn.apply(window, tm.args);
      } catch (e) {
        noteError('timer', e);
      }
    }
  }

  function step(dt) {
    vnow += dt;
    frames++;
    runTimers();
    const q = rafs;
    rafs = [];
    for (const r of q) {
      if (r.cancelled) continue;
      try {
        r.cb(vnow);
      } catch (e) {
        noteError('requestAnimationFrame', e);
      }
    }
  }

  function seek(target) {
    let n = 0;
    while (vnow < target - 1e-6 && n++ < MAX_FRAMES) {
      step(Math.min(FRAME_MS, target - vnow));
    }
    return vnow;
  }

  const define = (name, value) => {
    try {
      Object.defineProperty(window, name, { value, writable: true, configurable: true });
    } catch (e) {
      try {
        window[name] = value;
      } catch (_) {}
    }
  };

  define('requestAnimationFrame', (cb) => {
    const id = rafSeq++;
    rafs.push({ id, cb });
    return id;
  });
  define('cancelAnimationFrame', (id) => {
    for (const r of rafs) if (r.id === id) r.cancelled = true;
  });
  define('setTimeout', (fn, delay, ...args) => schedule(fn, delay, args, null));
  define('setInterval', (fn, delay, ...args) => schedule(fn, delay, args, Math.max(1, Number(delay) || 0)));
  define('clearTimeout', cancel);
  define('clearInterval', cancel);
  define('requestIdleCallback', (cb) => schedule(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 1, [], null));
  define('cancelIdleCallback', cancel);

  try {
    performance.now = () => vnow;
  } catch (_) {}

  class VirtualDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(vnow);
      else super(...args);
    }
    static now() {
      return vnow;
    }
  }
  define('Date', VirtualDate);

  // 固定随机数种子，保证同一份代码每次跑出同样的画面（便于复现与对比）
  let seed = 0x9e3779b9;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* ================= 2. 绘图探针 ================= */

  const rec = { texts: [], shapes: [] };
  const states = new WeakMap();

  function stateOf(ctx) {
    let s = states.get(ctx);
    if (!s) {
      s = { m: [1, 0, 0, 1, 0, 0], stack: [], pts: [] };
      states.set(ctx, s);
    }
    return s;
  }

  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const point = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  function box(m, x, y, w, h) {
    const p = [point(m, x, y), point(m, x + w, y), point(m, x, y + h), point(m, x + w, y + h)];
    const xs = p.map((q) => q[0]);
    const ys = p.map((q) => q[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  function live(ctx) {
    const c = ctx.canvas;
    return rec && c && c.isConnected;
  }

  function pushText(ctx, text, x, y) {
    const s = stateOf(ctx);
    const size = parseFloat(String(ctx.font).match(/(\d+(?:\.\d+)?)px/)?.[1] || '16');
    let w = size * 4;
    try {
      w = ctx.measureText(String(text)).width || w;
    } catch (_) {}
    const h = size * 1.15;
    let left = x;
    const align = ctx.textAlign;
    if (align === 'center') left = x - w / 2;
    else if (align === 'right' || align === 'end') left = x - w;
    const baseline = ctx.textBaseline;
    let top = y - h * 0.8;
    if (baseline === 'top' || baseline === 'hanging') top = y;
    else if (baseline === 'middle') top = y - h / 2;
    else if (baseline === 'bottom' || baseline === 'ideographic') top = y - h;
    const b = box(s.m, left, top, w, h);
    rec.texts.push({ text: String(text), x: b.x, y: b.y, w: b.w, h: b.h, size: Math.round(size * 10) / 10 });
  }

  function pushShape(ctx, b) {
    rec.shapes.push({ x: b.x, y: b.y, w: b.w, h: b.h });
  }

  const P = CanvasRenderingContext2D.prototype;
  const raw = {};
  const wrap = (name, fn) => {
    raw[name] = P[name];
    P[name] = function (...args) {
      const r = raw[name].apply(this, args);
      try {
        fn(this, args);
      } catch (_) {}
      return r;
    };
  };

  wrap('save', (ctx) => {
    const s = stateOf(ctx);
    s.stack.push(s.m.slice());
  });
  wrap('restore', (ctx) => {
    const s = stateOf(ctx);
    if (s.stack.length) s.m = s.stack.pop();
  });
  wrap('setTransform', (ctx, a) => {
    stateOf(ctx).m = a.length >= 6 ? [a[0], a[1], a[2], a[3], a[4], a[5]] : [1, 0, 0, 1, 0, 0];
  });
  wrap('resetTransform', (ctx) => {
    stateOf(ctx).m = [1, 0, 0, 1, 0, 0];
  });
  wrap('transform', (ctx, a) => {
    const s = stateOf(ctx);
    s.m = mul(s.m, [a[0], a[1], a[2], a[3], a[4], a[5]]);
  });
  wrap('translate', (ctx, a) => {
    const s = stateOf(ctx);
    s.m = mul(s.m, [1, 0, 0, 1, a[0], a[1]]);
  });
  wrap('scale', (ctx, a) => {
    const s = stateOf(ctx);
    s.m = mul(s.m, [a[0], 0, 0, a[1], 0, 0]);
  });
  wrap('rotate', (ctx, a) => {
    const s = stateOf(ctx);
    const c = Math.cos(a[0]);
    const n = Math.sin(a[0]);
    s.m = mul(s.m, [c, n, -n, c, 0, 0]);
  });
  wrap('beginPath', (ctx) => {
    stateOf(ctx).pts = [];
  });
  wrap('moveTo', (ctx, a) => {
    stateOf(ctx).pts.push(point(stateOf(ctx).m, a[0], a[1]));
  });
  wrap('lineTo', (ctx, a) => {
    stateOf(ctx).pts.push(point(stateOf(ctx).m, a[0], a[1]));
  });
  wrap('quadraticCurveTo', (ctx, a) => {
    const s = stateOf(ctx);
    s.pts.push(point(s.m, a[2], a[3]));
  });
  wrap('bezierCurveTo', (ctx, a) => {
    const s = stateOf(ctx);
    s.pts.push(point(s.m, a[4], a[5]));
  });
  const TAU = Math.PI * 2;
  function arcPoints(cx, cy, r, a0, a1, ccw) {
    let s = a0;
    let e = a1;
    if (!ccw) while (e < s) e += TAU;
    else while (e > s) e -= TAU;
    const pts = [
      [cx + r * Math.cos(s), cy + r * Math.sin(s)],
      [cx + r * Math.cos(e), cy + r * Math.sin(e)],
    ];
    for (let k = 0; k < 4; k++) {
      const ang = (k * Math.PI) / 2;
      let a = ang;
      if (!ccw) {
        while (a < s) a += TAU;
        if (a <= e) pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
      } else {
        while (a > s) a -= TAU;
        if (a >= e) pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
      }
    }
    return pts;
  }
  wrap('arc', (ctx, a) => {
    const s = stateOf(ctx);
    const pts = arcPoints(a[0], a[1], a[2], a[3], a[4], !!a[5]);
    for (const p of pts) s.pts.push(point(s.m, p[0], p[1]));
  });
  wrap('rect', (ctx, a) => {
    const s = stateOf(ctx);
    const b = box(s.m, a[0], a[1], a[2], a[3]);
    s.pts.push([b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]);
  });
  const commitPath = (ctx) => {
    const s = stateOf(ctx);
    if (!s.pts.length || !live(ctx)) return;
    const xs = s.pts.map((p) => p[0]);
    const ys = s.pts.map((p) => p[1]);
    pushShape(ctx, {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    });
  };
  wrap('fill', commitPath);
  wrap('stroke', commitPath);
  wrap('fillRect', (ctx, a) => {
    if (!live(ctx)) return;
    pushShape(ctx, box(stateOf(ctx).m, a[0], a[1], a[2], a[3]));
  });
  wrap('strokeRect', (ctx, a) => {
    if (!live(ctx)) return;
    pushShape(ctx, box(stateOf(ctx).m, a[0], a[1], a[2], a[3]));
  });
  wrap('fillText', (ctx, a) => {
    if (!live(ctx)) return;
    pushText(ctx, a[0], a[1], a[2]);
  });
  wrap('strokeText', (ctx, a) => {
    if (!live(ctx)) return;
    pushText(ctx, a[0], a[1], a[2]);
  });
  wrap('drawImage', (ctx, a) => {
    if (!live(ctx)) return;
    const s = stateOf(ctx);
    if (a.length >= 9) pushShape(ctx, box(s.m, a[5], a[6], a[7], a[8]));
    else if (a.length >= 5) pushShape(ctx, box(s.m, a[1], a[2], a[3], a[4]));
    else {
      const img = a[0];
      pushShape(ctx, box(s.m, 0, 0, img.width || 0, img.height || 0));
    }
  });

  /* ================= 3. 画布分析 ================= */

  function mainCanvas() {
    let best = null;
    for (const c of document.querySelectorAll('canvas')) {
      const area = (c.width || 0) * (c.height || 0);
      if (!best || area > best.area) best = { canvas: c, area };
    }
    return best ? best.canvas : null;
  }

  function analyze(canvas) {
    if (!canvas) return null;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const W = canvas.width;
      const H = canvas.height;
      if (!W || !H) return null;
      const data = ctx.getImageData(0, 0, W, H).data;
      const hist = new Map();
      const stepPx = 4;
      const samples = [];
      for (let y = 0; y < H; y += stepPx) {
        for (let x = 0; x < W; x += stepPx) {
          const i = (y * W + x) * 4;
          const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
          hist.set(key, (hist.get(key) || 0) + 1);
          samples.push({ i, key, x, y });
        }
      }
      let bgKey = 0;
      let bgCount = -1;
      for (const [k, v] of hist) if (v > bgCount) ((bgCount = v), (bgKey = k));
      let nonBlank = 0;
      let cx = 0;
      let cy = 0;
      for (const s of samples) {
        const r = data[s.i];
        const g = data[s.i + 1];
        const b = data[s.i + 2];
        const dr = Math.abs(r - (((bgKey >> 8) & 15) << 4));
        const dg = Math.abs(g - (((bgKey >> 4) & 15) << 4));
        const db = Math.abs(b - ((bgKey & 15) << 4));
        if (dr + dg + db > 36) {
          nonBlank++;
          cx += s.x;
          cy += s.y;
        }
      }
      return {
        cssW: canvas.clientWidth,
        cssH: canvas.clientHeight,
        w: W,
        h: H,
        nonBlankRatio: samples.length ? nonBlank / samples.length : 0,
        colors: hist.size,
        centroid: nonBlank ? { x: cx / nonBlank / W, y: cy / nonBlank / H } : null,
      };
    } catch (e) {
      return { error: String(e && e.message ? e.message : e) };
    }
  }

  const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  let renderTimeMs = null;

  function snapshot() {
    const canvas = mainCanvas();
    return {
      t: renderTimeMs != null ? renderTimeMs : vnow,
      frames,
      canvas: canvas ? { w: canvas.width, h: canvas.height, cssW: canvas.clientWidth, cssH: canvas.clientHeight } : null,
      texts: rec.texts.map((t) => ({ text: t.text, x: finite(t.x), y: finite(t.y), w: finite(t.w), h: finite(t.h), size: t.size })),
      shapes: rec.shapes.map((s) => ({ x: finite(s.x), y: finite(s.y), w: finite(s.w), h: finite(s.h) })),
      nonBlank: analyze(canvas),
      errors: errors.slice(),
      xfy: readProbeShape(),
    };
  }

  /**
   * 统一读取"幕"：支持多幕（XFY.acts）和单幕（XFY.render）。
   * 每一幕的 physical 是"真实物理时长"，播放多久由宿主决定（固定 4 秒），跟模型无关。
   */
  function readActs() {
    const p = window.XFY;
    if (!p) return [];
    const norm = (a, i) => ({
      title: String((a && a.title) || `第 ${i + 1} 幕`),
      physical: Number(a && a.physical) > 0 ? Number(a.physical) : 4,
      render: a && a.render,
      sample: a && a.sample,
    });
    if (Array.isArray(p.acts) && p.acts.length) return p.acts.map(norm);
    if (typeof p.render === 'function') return [norm(p, 0)];
    return [];
  }

  function readProbeShape() {
    const acts = readActs();
    if (!acts.length) return null;
    return {
      acts: acts.map((a, i) => ({
        index: i,
        title: a.title,
        physical: a.physical,
        hasRender: typeof a.render === 'function',
        hasSample: typeof a.sample === 'function',
      })),
    };
  }

  function safeSample(fn, t) {
    try {
      const v = fn(t);
      return v == null ? null : JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x)));
    } catch (e) {
      return { __error: String(e && e.message ? e.message : e) };
    }
  }

  /** 老路：没有 XFY 的页面，只能逐帧快进 */
  function legacyCapture(ms) {
    renderTimeMs = null;
    const t = Math.max(1, ms);
    seek(Math.max(0, t - FRAME_MS));
    rec.texts.length = 0;
    rec.shapes.length = 0;
    step(Math.max(0.001, t - vnow));
    return snapshot();
  }

  window.__XFY_SB = {
    version: 2,
    seek: (ms) => seek(ms),
    now: () => vnow,

    /** 读所有幕的元信息 */
    acts: () => readActs().map((a, i) => ({
      index: i,
      title: a.title,
      physical: a.physical,
      hasRender: typeof a.render === 'function',
      hasSample: typeof a.sample === 'function',
    })),

    /** 抓某一幕的 t 秒（物理时间）；opts 是图层开关，交给 render 用 */
    captureAct: (actIndex, tSec, opts) => {
      const acts = readActs();
      if (!acts.length) return legacyCapture(tSec * 1000);
      const i = Math.min(Math.max(0, actIndex | 0), acts.length - 1);
      const a = acts[i];
      vnow = 0;
      frames = 0;
      rafs = [];
      timers.length = 0;
      rec.texts.length = 0;
      rec.shapes.length = 0;
      renderTimeMs = tSec * 1000;
      if (typeof a.render === 'function') {
        try {
          a.render(tSec, opts || undefined);
        } catch (e) {
          noteError('XFY.acts.render', e);
        }
      }
      const s = snapshot();
      s.act = i;
      s.actTitle = a.title;
      s.physical = a.physical;
      return s;
    },

    /** 读某一幕 t 秒的物理量 */
    sampleAct: (actIndex, tSec) => {
      const acts = readActs();
      if (!acts.length) return null;
      const a = acts[Math.min(Math.max(0, actIndex | 0), acts.length - 1)];
      if (typeof a.sample !== 'function') return null;
      return safeSample(a.sample, tSec);
    },

    /** 某一幕的密集采样 */
    sweepAct: (actIndex, n) => {
      const acts = readActs();
      if (!acts.length) return null;
      const a = acts[Math.min(Math.max(0, actIndex | 0), acts.length - 1)];
      if (typeof a.sample !== 'function') return null;
      const count = Math.max(2, Math.min(400, n || 60));
      const out = [];
      for (let k = 0; k < count; k++) {
        const t = (a.physical * k) / (count - 1);
        out.push({ playback: t, value: safeSample(a.sample, t) });
      }
      return out;
    },

    /* ---- 兼容老接口 ---- */
    captureAt: (ms) => {
      const acts = readActs();
      if (acts.length) return window.__XFY_SB.captureAct(0, Math.max(0, ms) / 1000);
      return legacyCapture(Math.max(0, ms));
    },
    sample: (t) => {
      const acts = readActs();
      return acts.length ? window.__XFY_SB.sampleAct(0, t) : null;
    },
    sweep: (n) => {
      const acts = readActs();
      return acts.length ? window.__XFY_SB.sweepAct(0, n) : null;
    },

    errors: () => errors.slice(),
    reset: () => {
      vnow = 0;
      frames = 0;
      rafs = [];
      timers.length = 0;
      errors.length = 0;
      rec.texts.length = 0;
      rec.shapes.length = 0;
    },
  };
})();
