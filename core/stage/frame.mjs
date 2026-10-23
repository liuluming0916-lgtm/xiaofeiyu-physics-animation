/**
 * 舞台框（`auto_stage` 的最小切片）：把任意尺度的题折进一张 **10 × 6** 的布局纸。
 *
 * 为什么需要它（2026-10-23 用户裁决 A 方案）：
 *   旧方案用"全时段实体包络"决定相机 —— 它保证**不出画**，但框多大由题目世界决定，
 *   于是 0.4 m 的物块在 11 m 宽的题里只剩 19 px，在 1.2×10⁶ m 的题里直接 0 px。
 *   新方案反过来：相机永远拍同一张 10×6 的纸，题目世界只用来**折算位置**；
 *   元件尺寸改用布局单位（几何表里那套 0.4×0.3），从此与题目的量级无关。
 *
 * 这一版只做"位置折算"：物理 `x/y` 保留原值（读数、C10 用），
 * 视觉中心 `cu/cv`（= 卡片里的 `cx/cy`）改成布局单位。
 */

export const STAGE_WIDTH = 10;
export const STAGE_HEIGHT = 6;
export const STAGE_PADDING = 0.06;

/**
 * 从**物理分析表**（不是从 drawFrame 的命令）估一个世界包围盒。
 *
 * 为什么用 analysis：`scene_code` 需要先知道舞台多大才能画，而 drawFrame 还没发生；
 * 物理分析表里已经有每段的 x(t)/y(t)，足够算"物体活动到哪"。
 * 每段采 33 个点；再向外放一点余量，避免元件贴边被裁。
 */
export function envelopeFromAnalysis(analysis, opts = {}) {
  const samplesPerSegment = Math.max(4, Math.floor(opts.samples ?? 33));
  const margin = Number(opts.margin ?? 0.35);
  const sizes = opts.sizes ?? null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of analysis?.elements ?? []) {
    /*
     * C 方案：包络必须含**元件自身的尺寸**，否则大板/大球会从纸上伸出去。
     * 用物理米；没有 physical 的元件（符号件）按 0 处理。
     */
    const size = sizes?.[el.type] ?? null;
    const halfW = Number.isFinite(size?.w) ? size.w / 2 : Number.isFinite(size?.r) ? size.r : 0;
    const halfH = Number.isFinite(size?.h) ? size.h / 2 : Number.isFinite(size?.r) ? size.r : 0;
    for (const seg of el.segments ?? []) {
      for (let i = 0; i <= samplesPerSegment; i += 1) {
        const t = seg.t0 + ((seg.t1 - seg.t0) * i) / samplesPerSegment;
        const x = seg.x?.fn?.(t);
        const y = seg.y?.fn?.(t);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x - halfW);
        maxX = Math.max(maxX, x + halfW);
        minY = Math.min(minY, y - halfH);
        maxY = Math.max(maxY, y + halfH);
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  /* 单点/单线退化（纯水平运动）也要有厚度，否则比例尺会爆掉 */
  if (maxX - minX < margin * 2) {
    const c = (maxX + minX) / 2;
    minX = c - margin;
    maxX = c + margin;
  }
  if (maxY - minY < margin * 2) {
    const c = (maxY + minY) / 2;
    minY = c - margin;
    maxY = c + margin;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * 算舞台：世界框 → 10×6 布局纸（**保比例 contain + 居中**，不拉伸）。
 *
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} env
 * @param {{width?:number,height?:number,padding?:number}} [opts]
 * @returns {{s:number,cx:number,cy:number,frame:{u0:number,u1:number,v0:number,v1:number},env:object}}
 *   `s` = 布局单位 / 米；`cx/cy` = 世界中心
 */
export function computeStageFrame(env, opts = {}) {
  const W = Number(opts.width ?? STAGE_WIDTH);
  const H = Number(opts.height ?? STAGE_HEIGHT);
  const pad = Number(opts.padding ?? STAGE_PADDING);
  const usableW = W * (1 - 2 * pad);
  const usableH = H * (1 - 2 * pad);
  const spanX = Math.max(env.maxX - env.minX, 1e-9);
  const spanY = Math.max(env.maxY - env.minY, 1e-9);
  const s = Math.min(usableW / spanX, usableH / spanY);
  const cx = (env.minX + env.maxX) / 2;
  const cy = (env.minY + env.maxY) / 2;
  return {
    s,
    cx,
    cy,
    frame: { u0: 0, u1: W, v0: 0, v1: H },
    env: { ...env },
  };
}

/** 世界坐标 → 布局坐标 */
export function toLayout(frame, x, y) {
  return [frame.frame.u1 / 2 + (x - frame.cx) * frame.s, frame.frame.v1 / 2 + (y - frame.cy) * frame.s];
}

/**
 * 元件在布局纸上的活动范围（含几何半宽）。
 *
 * 用途：`scene_code` 需要把导轨/地面/容器画得**比这个范围更宽**，
 * 否则会出现"棒从电容里长出来"这类压线（q06 实测：模型把导轨从 1.0 起画，
 * 而棒的活动范围是 0.93–9.1）。
 */
export function layoutRange(analysis, frame, opts = {}) {
  const env = envelopeFromAnalysis(analysis, opts);
  if (!env) return null;
  const [u0, v0] = toLayout(frame, env.minX, env.minY);
  const [u1, v1] = toLayout(frame, env.maxX, env.maxY);
  return {
    uMin: Math.min(u0, u1),
    uMax: Math.max(u0, u1),
    vMin: Math.min(v0, v1),
    vMax: Math.max(v0, v1),
  };
}

/** 一次算好"纸 + 活动范围"，给生成器与 scene_code 提示词共用 */
export function stageOfAnalysis(analysis, opts = {}) {
  const env = envelopeFromAnalysis(analysis, opts);
  if (!env) return null;
  const frame = computeStageFrame(env);
  return { frame, range: layoutRange(analysis, frame, opts), env };
}
