/**
 * §19.5 回归题 05 · 弹簧振子与单摆
 *
 * 考什么：周期性 + 循环截断
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 周期用解析式给出，不是"数出一圈" —— `T_弹 = 2π√(m/k)`、`T_摆 = 2π√(L/g)`；
 *   2. 简谐量的相位必须由 `ωt` 给出 —— `stateAt` 里 `x = A·cos(ωt)`、`θ = θ₀·cos(ωt)`，
 *      不使用任何近似展开；
 *   3. "循环截断"体现在时间轴上 —— `SIM.duration` 取 2 个弹簧周期（≈2.0 s），
 *      单摆只走完约 1 个周期；`readouts` 给出"已走过的周期数"，学生能看出谁快谁慢；
 *   4. 弹簧画法必须随动 —— `Draw.spring` 的两端锚点每帧由 `state.x` 给出，
 *      不是画一条固定的波浪线。
 */

export default {
  id: 'q05-spring-pendulum',
  index: 5,
  title: '弹簧振子与单摆',
  examPoint: '周期性 + 循环截断',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`如图，水平光滑面上的弹簧振子：质量 $m=0.5\ \mathrm{kg}$，弹簧劲度系数 $k=20\ \mathrm{N/m}$，振幅 $A=0.10\ \mathrm{m}$，$t=0$ 时在最大位移处释放。

同一时刻，长 $L=1.0\ \mathrm{m}$ 的单摆从最大摆角 $\theta_0=0.10\ \mathrm{rad}$ 处释放，取 $g=10\ \mathrm{m/s^2}$。

求：(1) 弹簧振子的周期 $T_1$ 与最大速度 $v_{\max}$；(2) 单摆的周期 $T_2$；(3) $t=0.25\ \mathrm{s}$ 时弹簧振子的位移 $x$ 与速度 $v$。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔
title: 第 1 步 · 两部分都是简谐运动，各有自己的角频率
tex: \omega_1=\sqrt{\frac{k}{m}}=6.325\ \mathrm{rad/s},\quad \omega_2=\sqrt{\frac{g}{L}}=3.162\ \mathrm{rad/s}
t0: 0
t1: 0.4

title: 第 2 步 · 弹簧振子的周期与最大速度
tex: T_1=\frac{2\pi}{\omega_1}=2\pi\sqrt{\frac{m}{k}}=0.993\ \mathrm{s},\quad v_{\max}=A\omega_1=0.632\ \mathrm{m/s}
t0: 0.4
t1: 0.8

title: 第 3 步 · 单摆周期（小角度）
tex: T_2=2\pi\sqrt{\frac{L}{g}}=1.987\ \mathrm{s}
t0: 0.8
t1: 1.2

title: 第 4 步 · 位移与速度都按余弦/正弦给出
tex: x(t)=A\cos\omega_1t,\quad v(t)=-A\omega_1\sin\omega_1t
t0: 1.2
t1: 1.6

title: 第 5 步 · 代入 t = 0.25 s：此时已走过约 1/4 个周期
tex: x=0.10\cos(1.581)=-1.03\times10^{-3}\ \mathrm{m},\quad v=-0.632\sin(1.581)=-0.632\ \mathrm{m/s}
t0: 1.6
t1: 2.0`,

    ANSWERS: String.raw`symbol: T1
value: 0.9935
unit: s
tol: 0.01
at_t: 0.5
step: 2

symbol: vmax
value: 0.6325
unit: m/s
tol: 0.01
at_t: 0.5
step: 2

symbol: T2
value: 1.9869
unit: s
tol: 0.01
at_t: 1.0
step: 3

symbol: x
value: -0.00103
unit: m
tol: 0.05
at_t: 0.25
step: 5

symbol: v
value: -0.6325
unit: m/s
tol: 0.03
at_t: 0.25
step: 5`,

    VIEW: String.raw`SIM = {
  duration: 2.0,
  /* v1.1.9：两个刚体（弹簧振子 + 单摆摆球），位置与 drawFrame 画出来的完全一致。 */
  bodies: [
    { id: 'block', at: (s) => [s.wallX + 0.77 + s.x, context.y0] },
    { id: 'bob', at: (s) => [2.85 + context.L * Math.sin(s.theta), 1.62 - context.L * Math.cos(s.theta)] }
  ],
  axes: [
    { key: 'x', label: 'x 弹簧', unit: 'm' },
    { key: 'v', label: 'v 弹簧', unit: 'm/s' },
    { key: 'theta', label: 'θ 单摆', unit: 'rad' }
  ]
};`,

    setup: String.raw`var m = 0.5;
var k = 20.0;
var A = 0.10;
var L = 1.0;
var g = 10.0;
var theta0 = 0.10;
var w1 = Math.sqrt(k / m);
var w2 = Math.sqrt(g / L);
var T1 = 2 * Math.PI / w1;
var T2 = 2 * Math.PI / w2;
var vmax = A * w1;
var y0 = 1.05;
RETURN('m', m);
RETURN('k', k);
RETURN('A', A);
RETURN('L', L);
RETURN('g', g);
RETURN('theta0', theta0);
RETURN('w1', w1);
RETURN('w2', w2);
RETURN('T1', T1);
RETURN('T2', T2);
RETURN('vmax', vmax);
RETURN('y0', y0);`,

    stateAt: String.raw`var tt = Math.min(Math.max(t, 0), SIM.duration);
var x = context.A * Math.cos(context.w1 * tt);
var v = -context.A * context.w1 * Math.sin(context.w1 * tt);
var aSpring = -context.w1 * context.w1 * x;                 /* 简谐运动 a = −ω₁²x */
var theta = context.theta0 * Math.cos(context.w2 * tt);
var thd = -context.theta0 * context.w2 * Math.sin(context.w2 * tt);   /* 摆的角速度 */
var vBob = context.L * thd;                                /* 摆球线速度（沿切向） */
var aBob = -context.g * Math.sin(theta);                   /* 摆的切向加速度（回复加速度） */
var tx = Math.cos(theta);                                  /* 切向单位向量 */
var ty = Math.sin(theta);
var wall = 0.42;
return {
  t: tt,
  x: x,
  v: v,
  aSpring: aSpring,
  theta: theta,
  thd: thd,
  vBob: vBob,
  aBob: aBob,
  tx: tx,
  ty: ty,
  wallX: wall,
  cycles1: tt / context.T1,
  cycles2: tt / context.T2
};`,

    drawFrame: String.raw`var y0 = context.y0;
var wallX = state.wallX;
var natLen = 0.55;

Draw.ground(-0.35, 4.05, y0 - 0.30, { color: '#2b3440' });
Draw.polygon(
  [[wallX - 0.14, y0 - 0.30], [wallX - 0.14, y0 + 0.60], [wallX, y0 + 0.60], [wallX, y0 - 0.30]],
  { fill: '#e9edf1', stroke: '#2b3440', hatch: 'belowBase', layer: 0 }
);

var blockCenter = wallX + natLen + 0.22 + state.x;
Draw.spring([wallX, y0], [blockCenter - 0.16, y0], { coils: 14, amplitude: 0.075, color: '#2b3440' });
Draw.box([blockCenter, y0], 0.32, 0.30, { angleDeg: 0 });
Draw.arrow([blockCenter, y0 - 0.24], [-context.k * state.x, 0], {
  category: 'force', subtype: 'elastic', label: 'F = −kx', mag: Math.abs(context.k * state.x)
});
/* 弹簧振子的 a = −ω₁²x 由 bodies 求导自动画出（不必手写）。 */
Draw.line([wallX + natLen + 0.22, y0 - 0.46], [wallX + natLen + 0.22, y0 + 0.46], { dash: true, color: '#9aa7b4' });

var pivotX = 2.85;
var pivotY = 1.62;
var L = context.L;
var th = state.theta;
var bobX = pivotX + L * Math.sin(th);
var bobY = pivotY - L * Math.cos(th);
Draw.line([pivotX - 0.22, pivotY], [pivotX + 0.22, pivotY], { color: '#2b3440', width: 2 });
for (var d = -2; d <= 2; d = d + 1) {
  Draw.line([pivotX + d * 0.10 - 0.05, pivotY], [pivotX + d * 0.10 + 0.05, pivotY + 0.09], { color: '#2b3440', width: 1.1 });
}
Draw.line([pivotX, pivotY], [bobX, bobY], { color: '#1d2733', width: 1.5 });
Draw.circle([bobX, bobY], 0.085, { fill: '#ffffff', stroke: '#1d2733', width: 1.5 });
Draw.line([pivotX, pivotY], [pivotX, pivotY - L - 0.22], { dash: true, color: '#9aa7b4' });
Draw.arc([pivotX, pivotY], 0.42, -90, -90 + th * 180 / Math.PI, { color: '#a4610d', width: 1.2, samples: 40 });

/* 单摆圆弧轨迹（虚线）——用只读探针采全时段的摆球位置，而不是画一段装饰弧 */
var swingTrace = [];
for (var si = 0; si <= 48; si = si + 1) {
  var st = SIM.duration * si / 48;
  var sTheta = context.theta0 * Math.cos(context.w2 * st);
  swingTrace.push([pivotX - context.L * Math.sin(sTheta), pivotY - context.L * Math.cos(sTheta)]);
}
Draw.trace(swingTrace, { color: '#c8d0d8', dash: true, width: 1.2, layer: 0 });

/* 单摆的速度与切向加速度都由 bodies 求导自动画出（沿圆弧切向，方向由真实运动决定）。 */
/* 绳张力 T = mg·cosθ + m·v²/L（单摆的径向力平衡）—— 用真实量级，不再用固定长度示意 */
Draw.arrow([bobX, bobY], [-0.30 * Math.sin(th), 0.30 * Math.cos(th)], {
  category: 'force', subtype: 'tension', label: 'T',
  mag: context.m * (context.g * Math.cos(th) + (state.vBob * state.vBob) / context.L)
});
Draw.arrow([bobX - 0.03, bobY - 0.04], [0, -0.30], {
  category: 'force', subtype: 'gravity', label: 'mg', mag: context.m * context.g, labelInset: -13
});

/* 曲线图已移交模板页的图表面板（§13.4：横轴 t、游标与画布同一个 t、可切量/可隐藏）。
   原手绘代码留档在「软件自研v1开发历史.md 附录 B（原快照已清理）」，第 7.1 期按新方式重画。 */`,

    readouts: String.raw`return [
  { key: 'x', label: '弹簧位移', value: state.x, unit: 'm', latex: 'x' },
  { key: 'v', label: '弹簧速度', value: state.v, unit: 'm/s', latex: 'v' },
  { key: 'T1', label: '弹簧周期', value: context.T1, unit: 's', latex: 'T_1' },
  { key: 'vmax', label: '最大速度', value: context.vmax, unit: 'm/s', latex: 'v_{max}' },
  { key: 'theta', label: '摆角', value: state.theta, unit: 'rad', latex: '\\theta' },
  { key: 'T2', label: '单摆周期', value: context.T2, unit: 's', latex: 'T_2' },
  { key: 'n1', label: '弹簧已走周期数', value: state.cycles1, unit: '个', latex: 't/T_1' },
  { key: 'n2', label: '单摆已走周期数', value: state.cycles2, unit: '个', latex: 't/T_2' }
];`,
  },
};
