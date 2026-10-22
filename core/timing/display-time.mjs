/**
 * 时长归一化（2026-10-23 用户裁决）：**每小问固定 4 秒**。
 *
 * 为什么要做：物理时长由题目决定 —— 碰撞 0.3 s、下落 3 s、传送带 40 s 都有；
 * 直接按物理秒播，短的"一闪而过"、长的"看半天不动"。归一化以后每种小问都是 4 秒，
 * 讲课节奏稳定；极端题目（0.3 s / 40 s）靠倍速控件调。
 *
 * 边界从哪来：`couple` 阶段给每个讲解步骤标 `sub`（第几小问）。同一小问的所有步骤
 * 取 `[min t0, max t1]` 作为这一问的物理区间，映射到显示区间 `[4(k-1), 4k]`。
 *
 * 只做**映射**，不改物理：`stateAt / drawFrame / 读数 / 图表` 仍然吃物理秒。
 */

export const DISPLAY_SECONDS_PER_SUB = 4;

const EPS = 1e-9;

/**
 * @param {Array<{step:number,t0:number,t1:number,sub?:number}>} stepTimes
 * @param {{ perSub?: number }} [opts]
 * @returns {{
 *   timeMap: Array<{sub:number,p0:number,p1:number,d0:number,d1:number}>|null,
 *   displayDuration: number|null,
 *   stepTimes: Array<{step:number,sub:number,t0:number,t1:number}>|null,
 * }}
 */
export function buildDisplayTiming(stepTimes, opts = {}) {
  const perSub = Number(opts.perSub ?? DISPLAY_SECONDS_PER_SUB);
  const list = (Array.isArray(stepTimes) ? stepTimes : []).filter(
    (s) => s && Number.isFinite(s.t0) && Number.isFinite(s.t1) && s.t1 > s.t0,
  );
  if (!list.length || !(perSub > 0)) {
    return { timeMap: null, displayDuration: null, stepTimes: Array.isArray(stepTimes) ? stepTimes : null };
  }

  /* 每个小问的物理区间 = 它那些步骤的 [最小 t0, 最大 t1] */
  const bySub = new Map();
  for (const s of list) {
    const sub = Number.isInteger(s.sub) && s.sub >= 1 ? s.sub : 1;
    const cur = bySub.get(sub);
    if (!cur) bySub.set(sub, { sub, p0: s.t0, p1: s.t1 });
    else {
      cur.p0 = Math.min(cur.p0, s.t0);
      cur.p1 = Math.max(cur.p1, s.t1);
    }
  }

  const spans = [...bySub.values()].filter((s) => s.p1 - s.p0 > EPS).sort((a, b) => a.p0 - b.p0 || a.sub - b.sub);
  if (!spans.length) {
    return { timeMap: null, displayDuration: null, stepTimes: list };
  }

  const timeMap = spans.map((s, i) => ({
    sub: s.sub,
    p0: s.p0,
    p1: s.p1,
    d0: i * perSub,
    d1: (i + 1) * perSub,
  }));

  const disp = (t) => {
    for (let i = 0; i < timeMap.length; i += 1) {
      const s = timeMap[i];
      if (t <= s.p1 || i === timeMap.length - 1) {
        if (t <= s.p0) return s.d0;
        return s.d0 + ((t - s.p0) / (s.p1 - s.p0)) * (s.d1 - s.d0);
      }
    }
    return t;
  };

  const round = (v) => Math.round(v * 1e6) / 1e6;
  const displayStepTimes = list
    .map((s) => ({ step: s.step, sub: Number.isInteger(s.sub) && s.sub >= 1 ? s.sub : 1, t0: round(disp(s.t0)), t1: round(disp(s.t1)) }))
    .sort((a, b) => a.step - b.step);

  return { timeMap, displayDuration: round(spans.length * perSub), stepTimes: displayStepTimes };
}
