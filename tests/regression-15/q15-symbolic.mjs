/**
 * §19.5 回归题 15 · 纯符号题（无 canonical_value）
 *
 * 考什么：`SYMBOLIC` 模式 —— 数值只用来驱动运动与绘图，标注一律用符号
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 结论必须是符号式 —— `ANSWERS` 的 `value = null` 且 `latex` 必填（§3.3）；
 *   2. 运动仍需数值基准实例 —— 本轮取无量纲基准组（v₀=4 m/s、B=0.5 T、L=0.5 m、
 *      R=0.2 Ω、m=0.2 kg）驱动 stateAt，避免"纯符号 ⇒ 画不出来"；
 *   3. 基准值必须显式列出，不能藏进代码 —— `drawFrame` 画出参数卡，
 *      `readouts` 同时给出符号与数值，学生能核对"符号式 ↔ 基准数值"；
 *   4. 时间常数 τ 由符号式 τ = mR/(B²L²) 算出，`readouts` 给出，并用它标出衰减特征点。
 */

export default {
  id: 'q15-symbolic',
  index: 15,
  title: '纯符号题（导体棒指数衰减）',
  examPoint: 'SYMBOLIC 模式',
  mode: 'SYMBOLIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`质量 $m$、电阻 $r$ 的导体棒，置于间距 $L$ 的水平光滑导轨上（导轨电阻不计），整个区域有竖直向下的匀强磁场 $B$。导轨一端接阻值为 $R$ 的定值电阻。$t=0$ 时给棒一个水平初速度 $v_0$，此后不再施加外力。

请用题给字母表示：(1) $t=0$ 时回路中的电动势 $E_0$；(2) 棒的速度随时间的变化关系 $v(t)$。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔
title: 第 1 步 · 切割磁感线产生的电动势
tex: E=BLv\ \Rightarrow\ E_0=BLv_0
t0: 0
t1: 0.5

title: 第 2 步 · 回路电流与安培力（方向必与速度相反）
tex: I=\frac{E}{R+r}=\frac{BLv}{R+r},\quad F=BIL=\frac{B^{2}L^{2}v}{R+r}\ (\text{与}\ v\ \text{反向})
t0: 0.5
t1: 1.0

title: 第 3 步 · 牛顿第二定律给出指数衰减
tex: m\frac{dv}{dt}=-\frac{B^{2}L^{2}}{R+r}v\ \Rightarrow\ v(t)=v_0e^{-\frac{B^{2}L^{2}}{(R+r)m}t}
t0: 1.0
t1: 1.5

title: 第 4 步 · 时间常数与全体移（用于标定衰减快慢）
tex: \tau=\frac{(R+r)m}{B^{2}L^{2}},\quad x(t)=\frac{v_0\tau}{}\left(1-e^{-t/\tau}\right)=\frac{(R+r)mv_0}{B^{2}L^{2}}\left(1-e^{-t/\tau}\right)
t0: 1.5
t1: 2.0`,

    ANSWERS: String.raw`symbol: E0
value: null
unit: V
tol: null
at_t: 0.0
step: 1
latex: BLv_0

symbol: vt
value: null
unit: m/s
tol: null
at_t: 1.0
step: 3
latex: v_0e^{-\frac{B^{2}L^{2}}{(R+r)m}t}

symbol: tau
value: null
unit: s
tol: null
at_t: 0.5
step: 4
latex: \frac{(R+r)m}{B^{2}L^{2}}`,

    VIEW: String.raw`SIM = {
  duration: 2.0,
  continuityKeys: ['x'],
  axes: [
    { key: 'v', label: 'v（基准）', unit: 'm/s' },
    { key: 'E', label: 'E（基准）', unit: 'V' },
    { key: 'I', label: 'I（基准）', unit: 'A' }
  ]
};`,

    setup: String.raw`var B = 0.5, L = 0.5, R = 0.2, r = 0.2, m = 0.2, v0 = 4.0;
var Rtot = R + r;
var k = B * B * L * L / (Rtot * m);
var tau = 1 / k;
var E0 = B * L * v0;
var I0 = E0 / Rtot;
var F0 = B * I0 * L;
RETURN('B', B);
RETURN('L', L);
RETURN('R', R);
RETURN('r', r);
RETURN('m', m);
RETURN('v0', v0);
RETURN('Rtot', Rtot);
RETURN('k', k);
RETURN('tau', tau);
RETURN('E0', E0);
RETURN('I0', I0);
RETURN('F0', F0);`,

    stateAt: String.raw`var tt = Math.min(Math.max(t, 0), SIM.duration);
var decay = Math.exp(-context.k * tt);
var v = context.v0 * decay;
var E = context.B * context.L * v;
var I = E / context.Rtot;
var F = context.B * I * context.L;
var x = (context.v0 / context.k) * (1 - decay);
return {
  t: tt,
  x: x,
  v: v,
  E: E,
  I: I,
  F: F,
  decay: decay
};`,

    drawFrame: String.raw`var y0 = 0.30;
var railL = 2.4;
Draw.ground(-0.4, 3.4, y0 - 0.16, { color: '#2b3440' });
Draw.fieldDots({ x: -0.3, y: y0 - 0.10, w: 3.2, h: 0.95 }, { symbol: 'cross', nx: 9, ny: 4, color: '#3a4a5a' });
Draw.line([-0.25, y0 + 0.02], [3.0, y0 + 0.02], { color: '#2b3440', width: 1.6 });
Draw.line([-0.25, y0 + 0.34], [3.0, y0 + 0.34], { color: '#2b3440', width: 1.6 });
Draw.box([-0.25, y0 + 0.18], 0.12, 0.32, { fill: '#ffffff', stroke: '#2b3440' });
Draw.text(-0.42, y0 + 0.18, 'R', { size: 12, color: '#1d2733', align: 'right' });

var rodX = -0.10 + state.x * 0.62;
/* 全程轨迹（浅灰虚线）：金属棒沿导轨的移动路径。只读探针 context.at(t) 采样全时段，
   at() 只能在 drawFrame 里用（放进 stateAt 会被 C1 拦）。 */
var tracePts = [];
for (var tq = 0; tq <= 24; tq = tq + 1) { tracePts.push([-0.10 + context.at(SIM.duration * tq / 24).x * 0.62, y0 + 0.18]); }
Draw.trace(tracePts, { color: '#c8d0d8', dash: [5, 5], width: 1.2, layer: 0 });
Draw.box([rodX, y0 + 0.18], 0.10, 0.32, { fill: '#ffffff', stroke: '#1d2733' });
Draw.text(rodX, y0 + 0.60, 'm, r', { size: 11, color: '#1d2733' });
// §18 期 3 的验收条件「纯符号题能播且标注全为符号」落在下面两行的 latex 上：
// （⚠ 本注释位于 String.raw 模板字面量内部，因此**不能出现反引号**，否则会提前闭合模板。）
// latex 是画布可直接绘制的符号文本（canvas 的 fillText 不认 \frac 这类命令），
// 给了它就只画符号、不缀数值。门禁 render-check 会断言「SYMBOLIC 题的箭头全都带 latex」。
// 纯符号题也要给 mag：**按基准实例的相对量级**（已知量取 1、倍数关系如实填）。
// 本题 v 与 F 都随 t 衰减，用它们各自的实时值当量级，同一条尺子上就能看出"谁衰减得更快"。
Draw.arrow([rodX, y0 + 0.18], [state.v, 0], { category: 'velocity', label: 'v(t)', latex: 'v(t)', mag: Math.abs(state.v) });
Draw.arrow([rodX, y0 + 0.18], [-state.F, 0], { category: 'force', subtype: 'ampere', label: 'F = BIL', latex: 'F = BIL', mag: Math.abs(state.F) });
Draw.text(rodX + 0.10, y0 + 0.96, '磁场 B 垂直纸面向里（×）', { size: 11, color: '#3a4a5a', align: 'left' });

var px = 1.95, py = 0.28;
Draw.polygon([[px, py], [px + 1.55, py], [px + 1.55, py + 1.05], [px, py + 1.05]], {
  fill: 'rgba(43,52,64,0.045)', stroke: '#e4e7ea', layer: -1
});
Draw.text(px + 0.10, py + 0.95, '无量纲基准实例（驱动运动与绘图）', { size: 11, color: '#5d6b7a', align: 'left' });
var rows = [
  'v₀ = ' + context.v0 + ' m/s　B = ' + context.B + ' T',
  'L = ' + context.L + ' m　R = ' + context.R + ' Ω　r = ' + context.r + ' Ω',
  'm = ' + context.m + ' kg　τ = ' + Phys.format(context.tau, 's', 3),
  'E₀ = ' + Phys.format(context.E0, 'V', 3) + '　I₀ = ' + Phys.format(context.I0, 'A', 3)
];
for (var i = 0; i < rows.length; i = i + 1) {
  Draw.text(px + 0.10, py + 0.74 - 0.22 * i, rows[i], { size: 11, color: '#1d2733', align: 'left' });
}

/* 曲线图已移交模板页的图表面板（§13.4：横轴 t、游标与画布同一个 t、可切量/可隐藏）。
   原手绘代码留档在「软件自研v1开发历史.md 附录 B（原快照已清理）」，第 7.1 期按新方式重画。 */`,

    readouts: String.raw`return [
  { key: 'vt', label: '棒速度（基准）', value: state.v, unit: 'm/s', latex: 'v_0e^{-t/\\tau}' },
  { key: 'E', label: '电动势', value: state.E, unit: 'V', latex: 'BLv' },
  { key: 'I', label: '电流', value: state.I, unit: 'A', latex: '\\frac{BLv}{R+r}' },
  { key: 'F', label: '安培力', value: state.F, unit: 'N', latex: '\\frac{B^{2}L^{2}v}{R+r}' },
  { key: 'E0', label: '初电动势', value: context.E0, unit: 'V', latex: 'BLv_0' },
  { key: 'tau', label: '时间常数', value: context.tau, unit: 's', latex: '\\frac{(R+r)m}{B^{2}L^{2}}' }
];`,
  },
};
