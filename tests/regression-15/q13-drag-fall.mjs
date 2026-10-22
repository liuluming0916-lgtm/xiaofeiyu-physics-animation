/**
 * §19.5 回归题 13 · 空气阻力落体（Phys.integrate 查表）
 *
 * 考什么：`Phys.integrate` 只在 setup 里跑一次 → 采样表 → stateAt 只做插值（O(log n)）
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 运动方程 m·dv/dt = mg − kv 由 Phys.integrate 在 **setup()** 内积分一次，
 *      采样表经 RETURN('table', samples) 导出（stateAt 里绝不出现 integrate，C1 强制）；
 *   2. stateAt 只调 Phys.interp(context.table, t, 'v') / ('x')，是插值不是每帧积分；
 *   3. 末端速度 v_t = mg/k 由代码算出并与数值解对照（readouts 里同时给出 v 与 v_t）；
 *   4. 加速度 a = g − (k/m)v：t=0 时为 g，趋于末端速度时趋于 0，由代码逐帧算出。
 *
 * 坐标约定（C6 口径）：世界坐标 x 向右、y 向上，小球竖直下落。
 *   · state.x / state.y = 小球的**世界坐标位置**（米）—— continuityKeys 只放这两个：
 *     y 随时递减、x 恒为 xBall，都是"位置"分量，阶段边界上不会跳变；
 *   · state.h = **下落距离**（米，向下为正）= 路程类量，只用于读数与标注，
 *     **不放进 continuityKeys**（路程在阶段边界上未必连续，C6 不该拿它当位置）。
 *   查表里的 ODE 状态键仍按约定写作 { v, x }（x 即下落距离），interp 时取 'x' 再改名 h。
 *
 * 绘图注记：Draw.arrow 统一传**几何矢量**（物理量 × 几何缩放）并置 scale=1，
 * 物理量用 opts.mag/unit 记录 —— 因为 §4.6 的命令包络把 vec 原样当长度（不乘 scale），
 * 传物理量会让包络虚胖、AutoView 把画面缩小（见报告）。
 *
 * 跨槽位注记：setup 用 RETURN(key, value) 导出派生量与查表，其余槽位从 context 读取。
 */

export default {
  id: 'q13-drag-fall',
  index: 13,
  title: '空气阻力落体',
  examPoint: 'Phys.integrate 预计算查表',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`质量 $m=0.2\ \mathrm{kg}$ 的小球从高 $H=2.05\ \mathrm{m}$ 处由静止下落。下落过程中除重力外还受到与速率成正比的空气阻力 $f=kv$，其中 $k=0.5\ \mathrm{kg/s}$，取 $g=10\ \mathrm{m/s^2}$，小球始终未落地。

求：(1) 小球的运动方程与末端速度 $v_t$；(2) $t=0.5\ \mathrm{s}$ 时小球的速度 $v$ 与加速度 $a$；(3) $t=0.8\ \mathrm{s}$ 时小球下落的距离 $h$。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔；字段 title / tex / t0 / t1
title: 第 1 步 · 运动方程与末端速度
tex: m\frac{\mathrm{d}v}{\mathrm{d}t}=mg-kv\ \Rightarrow\ v_t=\frac{mg}{k}=\frac{0.2\times 10}{0.5}=4.0\ \mathrm{m/s},\quad \tau_v=\frac{m}{k}=0.4\ \mathrm{s}
t0: 0
t1: 0.25

title: 第 2 步 · 解析解：v 按指数趋近 v_t
tex: v(t)=v_t\left(1-e^{-t/\tau_v}\right),\qquad a(t)=g-\frac{k}{m}v
t0: 0.25
t1: 0.5

title: 第 3 步 · 数值解由 setup() 内的 RK 积分给出
tex: \text{setup() 里 Phys.integrate}\left(\{v,x\},\ \mathrm{d}/\mathrm{d}t,\ 0,\ T\right)\ \Rightarrow\ \text{采样表};\quad \text{stateAt 只做插值}
t0: 0.5
t1: 0.65

title: 第 4 步 · 代入求值
tex: v(0.5)=2.854\ \mathrm{m/s},\quad a(0.5)=g-\frac{k}{m}v=2.865\ \mathrm{m/s^{2}};\qquad h(0.8)=1.816\ \mathrm{m}
t0: 0.65
t1: 0.8`,

    ANSWERS: String.raw`symbol: vt
value: 4.0
unit: m/s
tol: 0.01
at_t: 0.8
step: 1

symbol: v
value: 2.854
unit: m/s
tol: 0.01
at_t: 0.5
step: 4

symbol: a
value: 2.865
unit: m/s²
tol: 0.01
at_t: 0.5
step: 4

symbol: h
value: 1.8165
unit: m
tol: 0.01
at_t: 0.8
step: 4`,

    VIEW: `SIM = {
  duration: 0.8,
  /* v1.1.9：小球球心（x 恒定、y 由查表得到）。Phys.integrate 的表带斜率，interp 走 C¹ Hermite。 */
  bodies: [
    { id: 'ball', at: (s) => [s.x, s.y] }
  ],
  axes: [
    { key: 'v', label: 'v', unit: 'm/s' },
    { key: 'a', label: 'a', unit: 'm/s²' },
    { key: 'h', label: 'h', unit: 'm' },
    { key: 'vt', label: 'v_t', unit: 'm/s' }
  ],
  continuityKeys: ['x', 'y'],
  /* C10 扩展：小球始终在初始高度（H=2.05）与地面（y=0）之间 */
  regions: [{ label: '小球高度', y: [-0.001, 2.051] }]
};`,

    setup: `var g = 10.0;      // 重力加速度（m/s²）
var m = 0.2;       // 质量（kg）
var k = 0.5;       // 阻力系数（kg/s）
var H = 2.05;      // 初始高度（m，几何量）
var xBall = 0.2;   // 小球的世界坐标 x（m，几何量；竖直下落，全程不变）

var vt = m * g / k;        // 末端速度 v_t = mg/k = 4.0 m/s
var tauV = m / k;          // 速度的时间常数 τ_v = m/k = 0.4 s

// 运动方程 m dv/dt = mg - kv 在 setup() 内积分一次（架构不变量 §7.6：只允许在这里积分）
// ODE 状态按约定写作 { v, x }，其中 x 就是"下落距离"（向下为正）
var solved = Phys.integrate({ v: 0, x: 0 }, function (tt, s) {
  return { v: g - (k / m) * s.v, x: s.v };
}, 0, SIM.duration, { dt: 1 / 240 });
RETURN('table', solved.samples);       // 采样表 [{ t, y: { v, x } }, …]，stateAt 只做插值

RETURN('g', g);
RETURN('m', m);
RETURN('k', k);
RETURN('H', H);
RETURN('xBall', xBall);
RETURN('vt', vt);
RETURN('tauV', tauV);
RETURN('sampleCount', solved.samples.length);`,

    stateAt: `var tt = Math.min(Math.max(t, 0), SIM.duration);

// 只查表插值（O(log n)），不做任何积分；'v' 与 'x' 是采样表里的 ODE 状态键。
// 本 fixture 自带二分插值，不依赖已删除的 Phys.interp。
function interpAt(samples, time, key) {
  if (!samples.length) return NaN;
  if (time <= samples[0].t) return samples[0].y[key];
  var last = samples[samples.length - 1];
  if (time >= last.t) return last.y[key];
  var lo = 0;
  var hi = samples.length - 1;
  while (lo + 1 < hi) {
    var mid = (lo + hi) >> 1;
    if (samples[mid].t <= time) lo = mid;
    else hi = mid;
  }
  var a = samples[lo];
  var b = samples[hi];
  var u = (time - a.t) / ((b.t - a.t) || 1);
  return a.y[key] + (b.y[key] - a.y[key]) * u;
}
var v = interpAt(context.table, tt, 'v');
var h = interpAt(context.table, tt, 'x');   // 表里的 x 即下落距离，这里改名为 h

return {
  t: tt,
  x: context.xBall,                       // 世界坐标 x（m，恒定）
  y: context.H - h,                       // 世界坐标 y（m，随下落递减）
  h: h,                                   // 下落距离（m，向下为正）
  v: v,
  a: context.g - (context.k / context.m) * v,
  fDrag: context.k * v,                   // 空气阻力大小
  fGrav: context.m * context.g            // 重力大小
};`,

    drawFrame: `var xLine = context.xBall;
var fSc = 0.10;    // 几何缩放：1 N ↔ 0.10 m
var vSc = 0.10;    // 几何缩放：1 m/s ↔ 0.10 m

// —— 地面与下落基准线 ——
Draw.ground(-2.1, 2.5, 0, { color: '#2b3440' });
Draw.line([xLine, 0], [xLine, context.H + 0.12], { dash: true, color: '#9aa7b4' });
Draw.line([xLine - 0.25, context.H], [xLine + 0.55, context.H], { dash: true, color: '#9aa7b4' });

// —— 小球 ——
// 全程轨迹（点划虚线）：小球的下落路径。它与已有的竖直基准线重合，故用点线覆盖以示"轨迹"。
Draw.trace([[xLine, context.H], [xLine, 0]], { color: '#c8d0d8', dash: true, width: 2.2, layer: 0 });
Draw.circle([xLine, state.y], 0.10, { fill: '#ffffff', stroke: '#2b3440', width: 1.6 });

// —— 四个矢量里的两个受力（重力向下、阻力向上）；v 与 a 由 bodies 求导自动生成 ——
Draw.arrow([xLine - 0.24, state.y], [0, -state.fGrav * fSc], { category: 'force', subtype: 'gravity', label: 'mg', mag: state.fGrav, unit: 'N' });
Draw.arrow([xLine + 0.24, state.y], [0, state.fDrag * fSc], { category: 'force', subtype: 'other', label: 'kv', mag: state.fDrag, unit: 'N' });

// —— 下落距离标注（h 是路程类量，只做标注，不进 continuityKeys）——

/* 曲线图已移交模板页的图表面板（§13.4：横轴 t、游标与画布同一个 t、可切量/可隐藏）。
   原手绘代码留档在「软件自研v1开发历史.md 附录 B（原快照已清理）」，第 7.1 期按新方式重画。 */`,

    readouts: `return [
  { key: 'v', label: '下落速度', value: state.v, unit: 'm/s', latex: 'v' },
  { key: 'h', label: '下落距离', value: state.h, unit: 'm', latex: 'h' },
  { key: 'y', label: '离地高度', value: state.y, unit: 'm', latex: 'y' },
  { key: 'a', label: '加速度', value: state.a, unit: 'm/s²', latex: 'a' },
  { key: 'Fd', label: '空气阻力', value: state.fDrag, unit: 'N', latex: 'f=kv' },
  { key: 'Fg', label: '重力', value: state.fGrav, unit: 'N', latex: 'mg' },
  { key: 'vt', label: '末端速度', value: context.vt, unit: 'm/s', latex: 'v_t' },
  { key: 'tau', label: '速度时间常数', value: context.tauV, unit: 's', latex: '\\tau_v' }
];`,
  },
};
