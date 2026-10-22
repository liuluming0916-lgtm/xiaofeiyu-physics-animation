/**
 * §19.5 回归题 01 · 传送带共速与摩擦生热
 *
 * 考什么：阶段切分 + 自检条款落实位置
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 受力方向由**相对运动**决定，不写死 —— drawFrame 只画 state.f，stateAt 里 f 由滑动状态给出；
 *   2. 共速判据是"v 追上传送带速度"，不是"时间到" —— t* 由 u/a1 解出，两段以 t < t* 切分；
 *   3. 摩擦生热用**相对位移**，不是物块位移 —— readouts 里 Q = μmg·Δs，Δs = u·t − x；
 *   4. 共速后摩擦力为零 —— t ≥ t* 时 f = 0，drawFrame 据此不再画摩擦箭头。
 *
 * 跨槽位注记：setup 用 RETURN(key, value) 导出派生量，其余槽位从 context 读取。
 */

export default {
  id: 'q01-conveyor-heat',
  index: 1,
  title: '传送带共速与摩擦生热',
  examPoint: '阶段切分 + 自检条款',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`水平传送带以恒定速率 $u=2\ \mathrm{m/s}$ 向右运行。将质量 $m=1\ \mathrm{kg}$ 的物块无初速轻放在传送带左端，物块与传送带之间的动摩擦因数 $\mu=0.2$，取 $g=10\ \mathrm{m/s^2}$。

求：(1) 物块从放上传送带到与传送带共速所用的时间 $t^{*}$ 与位移 $\Delta x$；(2) 该过程中因摩擦产生的热量 $Q$。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔；tex 若很长可用 """ 包裹多行
title: 第 1 步 · 由相对运动定摩擦力方向
tex: v_0=0<u \Rightarrow 物块相对带向左滑 \Rightarrow f=\mu mg 向右,\ a_1=\mu g=2\ \mathrm{m/s^2}
t0: 0
t1: 0.6

title: 第 2 步 · 加速段：v 追上 u 即为共速时刻
tex: t^{*}=\frac{u}{\mu g}=1.0\ \mathrm{s},\quad \Delta x=\frac{u^{2}}{2\mu g}=1.0\ \mathrm{m}
t0: 0.6
t1: 1.0

title: 第 3 步 · 共速段：摩擦力消失，随带匀速
tex: t>t^{*}:\ v=u,\ f=0,\ v\text{-}t\ 图线由斜线转为水平线
t0: 1.0
t1: 1.5

title: 第 4 步 · 摩擦生热：用相对位移
tex: \Delta s=ut^{*}-\Delta x=1.0\ \mathrm{m},\quad Q=\mu mg\,\Delta s=2.0\ \mathrm{J}
t0: 1.5
t1: 2.0`,

    ANSWERS: String.raw`symbol: t*
value: 1.0
unit: s
tol: 0.01
at_t: 1.0
step: 2

symbol: dx
value: 1.0
unit: m
tol: 0.01
at_t: 1.0
step: 2

symbol: ds
value: 1.0
unit: m
tol: 0.01
at_t: 1.5
step: 4

symbol: Q
value: 2.0
unit: J
tol: 0.01
at_t: 1.5
step: 4`,

    VIEW: `SIM = {
  duration: 2.0,
  /* v1.1.9：v/a 由运行时对刚体位置求导绘制。物块中心 = [x, 0.34]（y0 + r + 0.24）。 */
  bodies: [
    { id: 'block', at: (s) => [s.x, 0.34] }
  ],
  /* C10 扩展：物块必须始终留在带面上（本题带面长 3 m、物块恰好走到带端共速） */
  regions: [
    { label: '物块不滑出带面', x: [-0.01, 3.01] }
  ],
  axes: [
    { key: 'v', label: 'v', unit: 'm/s' },
    { key: 'x', label: 'Δx', unit: 'm' },
    { key: 'ds', label: 'Δs', unit: 'm' },
    { key: 'Q', label: 'Q', unit: 'J' }
  ]
};`,

    setup: `var g = 10, mu = 0.2, m = 1.0;
var u = 2.0;
var a1 = mu * g;
var tStar = u / a1;
var xStar = u * u / (2 * a1);
RETURN('g', g);
RETURN('mu', mu);
RETURN('m', m);
RETURN('u', u);
RETURN('a1', a1);
RETURN('tStar', tStar);
RETURN('xStar', xStar);`,

    stateAt: `var tt = Math.min(Math.max(t, 0), SIM.duration);
var sliding = tt < context.tStar;
var v = sliding ? context.a1 * tt : context.u;
var x = sliding ? 0.5 * context.a1 * tt * tt : context.xStar + context.u * (tt - context.tStar);
var beltX = context.u * tt;
return {
  t: tt,
  sliding: sliding,
  v: v,
  a: sliding ? context.a1 : 0,
  x: x,
  beltX: beltX,
  ds: beltX - x,
  f: sliding ? context.mu * context.m * context.g : 0
};`,

    drawFrame: `var y0 = 0;
var r = 0.10;
var runLen = context.u * SIM.duration;
var trackEnd = runLen + 0.7;

Draw.belt([-0.15, y0], [trackEnd, y0], {
  r: r, ticks: 18, tickPhase: (state.beltX * 3) % 1, color: '#2b3440'
});
Draw.ground(-0.6, trackEnd + 0.25, y0 - r, { color: '#2b3440' });

/* 全程轨迹（浅灰虚线）：物块中心的路径。只读探针 context.at(t) 采样全时段——
   at() 只允许在 drawFrame 里用，放进 stateAt 会变成"每帧重算全时段"，C1 会拦。 */
var tracePts = [];
for (var tq = 0; tq <= 32; tq = tq + 1) { tracePts.push([context.at(SIM.duration * tq / 32).x, y0 + r + 0.24]); }
Draw.trace(tracePts, { color: '#c8d0d8', dash: true, width: 1.2, layer: 0 });

Draw.box([state.x, y0 + r + 0.24], 0.34, 0.34, { angleDeg: 0 });

if (state.f > 1e-9) {
  Draw.arrow([state.x, y0 + r + 0.02], [state.f, 0], {
    category: 'force', subtype: 'friction', label: 'f = μmg', mag: state.f
  });
}
/* v/a 不在这里画：VIEW 的 bodies 已声明刚体，运行时自动画 v（绿）与 a（蓝）。 */
/* 传送带速度是"别人的速度"，不是刚体的运动学量 —— 留在 aux（紫）。 */
Draw.arrow([runLen * 0.72, y0 + r * 3.0], [context.u, 0], {
  category: 'aux', label: 'u', mag: context.u
});

if (state.ds > 1e-6) {
  Draw.line([state.x, y0 + r + 0.42], [state.x, y0 + r * 4.0], { dash: true, color: '#9aa7b4' });
  Draw.line([state.beltX, y0 + r + 0.42], [state.beltX, y0 + r * 4.0], { dash: true, color: '#9aa7b4' });
}

/* 曲线图已移交模板页的图表面板（§13.4：横轴 t、游标与画布同一个 t、可切量/可隐藏）。
   原手绘代码留档在「软件自研v1开发历史.md 附录 B（原快照已清理）」，第 7.1 期按新方式重画。 */`,

    readouts: `return [
  { key: 'v', label: '物块速度', value: state.v, unit: 'm/s', latex: 'v' },
  { key: 'u', label: '传送带速度', value: context.u, unit: 'm/s', latex: 'u' },
  { key: 'dx', label: '物块位移', value: state.x, unit: 'm', latex: '\\Delta x' },
  { key: 'ds', label: '相对位移', value: state.ds, unit: 'm', latex: '\\Delta s' },
  { key: 'f', label: '摩擦力', value: state.f, unit: 'N', latex: 'f' },
  { key: 'Q', label: '摩擦生热', value: context.mu * context.m * context.g * state.ds, unit: 'J', latex: 'Q' },
  { key: 't*', label: '共速时刻', value: context.tStar, unit: 's', latex: 't^{*}' }
];`,
  },
};
