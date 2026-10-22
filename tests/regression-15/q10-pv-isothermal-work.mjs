/**
 * §19.5 回归题 10 · p–V 等温膨胀做功面积
 *
 * 考什么：热学 + 面积着色（"面积即物理量"）
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 等温过程做功必须用积分而不是 p·ΔV —— `readouts` 里 W = nRT·ln(V/V₁)，不是 p(V−V₁)；
 *   2. 内能变化为零 —— `readouts` 给出 ΔU = 0，且 Q = W（热力学第一定律自检）；
 *   3. 着色面积必须与数值一致 —— `Draw.chart` 的 fill 区域就是 p–V 图下面（括号内）的面积，
 *      同时把数值 W 标在面积旁，避免"图对了数错了"；
 *   4. 状态方程自检 —— `readouts` 里实时给出 pV 乘积，全时段应恒等于 nRT（理想气体）。
 */

export default {
  id: 'q10-pv-isothermal-work',
  index: 10,
  title: 'p–V 等温膨胀做功面积',
  examPoint: '热学 + 面积着色',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`一定质量的理想气体，物质的量 $n=0.02\ \mathrm{mol}$，温度恒为 $T=300\ \mathrm{K}$，从体积 $V_1=2.0\times10^{-3}\ \mathrm{m^3}$ 缓慢等温膨胀到 $V_2=4.0\times10^{-3}\ \mathrm{m^3}$。已知普适气体常量 $R=8.31\ \mathrm{J/(mol\cdot K)}$。

求：(1) 气体对外做的功 $W$；(2) 该过程中气体吸收的热量 $Q$。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔
title: 第 1 步 · 等温过程的状态方程
tex: p(V)=\frac{nRT}{V},\quad 且\ pV\ 在全过程恒等于\ nRT=49.9\ \mathrm{J}
t0: 0
t1: 1.0

title: 第 2 步 · 做功是 p–V 图下的面积，必须积分
tex: W=\int_{V_1}^{V_2} p\,dV=\int_{V_1}^{V_2}\frac{nRT}{V}dV=nRT\ln\frac{V_2}{V_1}
t0: 1.0
t1: 2.0

title: 第 3 步 · 代入数值：不能用 p\cdot\Delta V 近似
tex: W=0.02\times8.31\times300\times\ln 2=49.9\times0.693=34.6\ \mathrm{J}
t0: 2.0
t1: 3.0

title: 第 4 步 · 热力学第一定律：等温则内能不变
tex: \Delta U=0\ \Rightarrow\ Q=W+\Delta U=34.6\ \mathrm{J}
t0: 3.0
t1: 4.0`,

    ANSWERS: String.raw`symbol: W
value: 34.6
unit: J
tol: 0.02
at_t: 4.0
step: 3

symbol: Q
value: 34.6
unit: J
tol: 0.02
at_t: 4.0
step: 4

symbol: dU
value: 0.0
unit: J
tol: 0.01
at_t: 4.0
step: 4`,

    VIEW: String.raw`SIM = {
  duration: 4.0,
  continuityKeys: ['V'],
  axes: [
    { key: 'V', label: 'V', unit: '10⁻³ m³' },
    { key: 'p', label: 'p', unit: 'kPa' },
    { key: 'W', label: 'W', unit: 'J' }
  ]
};`,

    setup: String.raw`var n = 0.02, T = 300, R = 8.31;
var V1 = 0.002, V2 = 0.004;
var p1 = n * R * T / V1;
var p2 = n * R * T / V2;
var Wtotal = n * R * T * Math.log(V2 / V1);
var pMax = p1 * 1.18;
var Vmax = V2 * 1.22;
RETURN('n', n);
RETURN('T', T);
RETURN('R', R);
RETURN('V1', V1);
RETURN('V2', V2);
RETURN('p1', p1);
RETURN('p2', p2);
RETURN('Wtotal', Wtotal);
RETURN('pMax', pMax);
RETURN('Vmax', Vmax);`,

    stateAt: String.raw`var u = Math.min(Math.max(t / SIM.duration, 0), 1);
var V = context.V1 * Math.pow(context.V2 / context.V1, u);
var p = context.n * context.R * context.T / V;
var W = context.n * context.R * context.T * Math.log(V / context.V1);
return {
  t: t,
  V: V,
  p: p,
  W: W,
  pV: p * V,
  dU: 0,
  done: u
};`,

    drawFrame: String.raw`var ox = 0.6, oy = 0.42;
var ax = 2.5, ay = 1.75;
var sx = function (V) { return ox + ax * V / context.Vmax; };
var sy = function (p) { return oy + ay * p / context.pMax; };

Draw.ground(ox - 0.25, ox + ax + 0.15, oy, { color: '#2b3440' });
Draw.axisBox([ox, oy], ax, ay, { xLabel: 'V / 10⁻³m³', yLabel: 'p / kPa', xTicks: 4, yTicks: 4 });

var samples = [];
var vol = context.V1;
var step = (context.V2 - context.V1) / 40;
for (var i = 0; i <= 40; i = i + 1) {
  samples.push([sx(vol), sy(context.n * context.R * context.T / vol)]);
  vol = vol + step;
}
Draw.chart(samples, {
  baseline: oy,
  fill: 'rgba(42,111,143,0.20)',
  stroke: '#2a6f8f'
});

Draw.line([sx(context.V1), oy], [sx(context.V1), sy(context.p1)], { dash: true, color: '#9aa7b4' });
Draw.line([sx(context.V2), oy], [sx(context.V2), sy(context.p2)], { dash: true, color: '#9aa7b4' });
Draw.circle([sx(context.V1), sy(context.p1)], 0.035, { fill: '#1d2733', stroke: '#1d2733' });
Draw.circle([sx(context.V2), sy(context.p2)], 0.035, { fill: '#b3382f', stroke: '#b3382f' });

var cursorX = sx(state.V);
var cursorY = sy(state.p);
/* 全程轨迹（浅灰虚线）：这条等温线的完整范围。V₁…V₂ 段已经用实线 + 面积填充画过，
   所以虚线只补两侧的延伸（左侧到 p 触及坐标区顶端、右侧到 Vmax），避免与实线重叠。 */
var extL = [];
var extR = [];
for (var tq = 0; tq <= 6; tq = tq + 1) {
  var vL = context.V1 * (0.85 + 0.15 * tq / 6);
  extL.push([sx(vL), sy(context.n * context.R * context.T / vL)]);
}
for (var tq2 = 0; tq2 <= 14; tq2 = tq2 + 1) {
  var vR = context.V2 + (context.Vmax - context.V2) * tq2 / 14;
  extR.push([sx(vR), sy(context.n * context.R * context.T / vR)]);
}
Draw.trace(extL, { color: '#c8d0d8', dash: true, width: 1.2, layer: 0 });
Draw.trace(extR, { color: '#c8d0d8', dash: true, width: 1.2, layer: 0 });
Draw.line([cursorX, oy], [cursorX, cursorY], { dash: true, color: '#a4610d', width: 1.3 });
Draw.circle([cursorX, cursorY], 0.055, { fill: '#a4610d', stroke: '#a4610d' });

Draw.arrow([sx(context.V1) - 0.05, oy + 0.12], [state.W * 0.030, 0], {
  category: 'aux', label: 'W(t)', mag: Math.abs(state.W), unit: 'J'
});
`,

    readouts: String.raw`return [
  { key: 'V', label: '体积', value: state.V * 1000, unit: '10⁻³ m³', latex: 'V' },
  { key: 'p', label: '压强', value: state.p / 1000, unit: 'kPa', latex: 'p' },
  { key: 'pV', label: 'pV 乘积', value: state.pV, unit: 'J', latex: 'pV' },
  { key: 'W', label: '累计做功', value: state.W, unit: 'J', latex: 'W' },
  { key: 'dU', label: '内能变化', value: state.dU, unit: 'J', latex: '\\Delta U' },
  { key: 'Q', label: '吸热累计', value: state.W + state.dU, unit: 'J', latex: 'Q' }
];`,
  },
};
