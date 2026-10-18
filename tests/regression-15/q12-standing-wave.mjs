/**
 * §19.5 回归题 12 · 驻波与干涉
 *
 * 考什么：波场快照（整条弦的位移分布必须逐帧重画）
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 驻波不是"整条弦一起上下平移" —— `stateAt` 里每个采样点的相位含 sin(kx)，
 *      波节位置固定不动，波腹振幅最大；
 *   2. 波节间距必须是 λ/2，且 λ = 2L（两端固定）—— `readouts` 实时给出 λ、k、ω 与波节间距；
 *   3. 波速由介质决定，与振幅无关 —— `readouts` 给出 v = ω/k，全时段恒定；
 *   4. 采样点数固定（不在 stateAt 内循环重算波形之外的东西）——整条波形是一次 O(n) 采样
 *      且 n 固定为 49，符合"固定规模采样"，不做自适应加密。
 */

export default {
  id: 'q12-standing-wave',
  index: 12,
  title: '驻波与干涉',
  examPoint: '波场快照',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`一根两端固定的弦，长 $L=1.2\ \mathrm{m}$，弦上横波波速 $v=24\ \mathrm{m/s}$。弦以基频振动，振幅 $A=0.05\ \mathrm{m}$。

求：(1) 基频频率 $f_1$ 与波长 $\lambda$；(2) 波节间距；(3) 弦中点（波腹）在 $t=0.03\ \mathrm{s}$ 时的位移。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔
title: 第 1 步 · 两端固定 ⇒ 波长被弦长锁定
tex: L=\frac{\lambda}{2}\ \Rightarrow\ \lambda=2L=2.4\ \mathrm{m},\quad f_1=\frac{v}{\lambda}=\frac{24}{2.4}=10\ \mathrm{Hz}
t0: 0
t1: 0.5

title: 第 2 步 · 驻波形式：位置项与时间项分离
tex: y(x,t)=A\sin(kx)\cos(\omega t),\quad k=\frac{2\pi}{\lambda},\ \omega=2\pi f_1
t0: 0.5
t1: 1.0

title: 第 3 步 · 波节间距是半波长，波节固定不动
tex: \Delta x_{\text{节}}=\frac{\lambda}{2}=1.2\ \mathrm{m}\ \Rightarrow\ 两端与中点为波节、\frac{L}{4}\ 与\ \frac{3L}{4}\ 处为波腹
t0: 1.0
t1: 1.5

title: 第 4 步 · 中点位移代入（波腹处 |sin| = 1）
tex: y\!\left(\frac{L}{2},1.5333\right)=A\cos(2\pi\times10\times1.5333)=0.05\cos(0.6667\pi)=-0.0250\ \mathrm{m}
t0: 1.5
t1: 2.0`,

    ANSWERS: String.raw`symbol: f1
value: 10.0
unit: Hz
tol: 0.01
at_t: 0.5
step: 1

symbol: lambda
value: 2.4
unit: m
tol: 0.01
at_t: 0.5
step: 1

symbol: nodeGap
value: 1.2
unit: m
tol: 0.01
at_t: 1.0
step: 3

symbol: ymid
value: -0.025
unit: m
tol: 0.02
at_t: 1.5333
step: 4

symbol: vwave
value: 24.0
unit: m/s
tol: 0.01
at_t: 1.5
step: 3`,

    VIEW: String.raw`SIM = {
  duration: 2.0,
  continuityKeys: ['x'],
  axes: [
    { key: 'y', label: 'y', unit: 'm' },
    { key: 'phase', label: '相位', unit: 'rad' }
  ]
};`,

    setup: String.raw`var L = 1.2, v = 24, A = 0.05;
var lambda = 2 * L;
var k = 2 * Math.PI / lambda;
var f1 = v / lambda;
var omega = 2 * Math.PI * f1;
var nodeGap = lambda / 2;
RETURN('L', L);
RETURN('v', v);
RETURN('A', A);
RETURN('lambda', lambda);
RETURN('k', k);
RETURN('f1', f1);
RETURN('omega', omega);
RETURN('nodeGap', nodeGap);`,

    stateAt: String.raw`var tt = Math.min(Math.max(t, 0), SIM.duration);
var cosW = Math.cos(context.omega * tt);
var N = 48;
var xs = [];
var ys = [];
for (var i = 0; i <= N; i = i + 1) {
  var x = context.L * i / N;
  xs.push(x);
  ys.push(context.A * Math.sin(context.k * x) * cosW);
}
var ymid = context.A * Math.sin(context.k * context.L / 2) * cosW;
return {
  t: tt,
  x: tt * context.v,
  cosW: cosW,
  ymid: ymid,
  phase: context.omega * tt,
  envelope: context.A
};`,

    drawFrame: String.raw`var ox = 0.5, oy = 1.05;
var scaleX = 3.4;
var scaleY = 5.4;
var N = 48;

var sx = function (x) { return ox + scaleX * x; };
var sy = function (y) { return oy + scaleY * y; };

Draw.line([ox - 0.1, oy], [ox + scaleX * context.L + 0.15, oy], { color: '#9aa7b4', width: 1.2, dash: [5, 4] });

var nodes = [];
var antinodes = [];
for (var m = 0; m <= 2; m = m + 1) {
  nodes.push(context.L * m / 2);
}
antinodes.push(context.L * 0.25);
antinodes.push(context.L * 0.75);
for (var a = 0; a < antinodes.length; a = a + 1) {
  var axx = sx(antinodes[a]);
  Draw.line([axx, oy - 0.36], [axx, oy + 0.40], { dash: [3, 3], color: '#a4610d', width: 1.1 });
  Draw.text(axx, oy + 0.46, '波腹', { size: 11, color: '#a4610d' });
}
Draw.dimension([sx(nodes[0]), oy + 0.56], [sx(nodes[1]), oy + 0.56], { kind: 'linear', text: 'λ/2 = ' + Phys.format(context.nodeGap, 'm', 2) });
for (var n = 0; n < nodes.length; n = n + 1) {
  var nx = sx(nodes[n]);
  Draw.circle([nx, oy], 0.045, { fill: '#1d2733', stroke: '#1d2733' });
}
Draw.text(sx(nodes[1]), oy - 0.30, '波节（固定不动）', { size: 11, color: '#1d2733' });

/* 包络线（虚线）：A·|sin(kx)| 的上下界，表示每个位置能达到的最大位移。
   之前这里把 trace 与 curve 画在**同一组坐标**上，虚线被粗实线完全压住、等于没画；
   现在虚线改画"波腹包络"，与当前波形错开，两种信息都读得到。 */
var envTop = [];
var envBot = [];
for (var e = 0; e <= N; e = e + 1) {
  var ex = context.L * e / N;
  var ey = context.A * Math.sin(context.k * ex);
  envTop.push([sx(ex), sy(ey)]);
  envBot.push([sx(ex), sy(-ey)]);
}
Draw.trace(envTop, { color: '#9aa7b4', dash: [6, 5], width: 1.1, layer: 0 });
Draw.trace(envBot, { color: '#9aa7b4', dash: [6, 5], width: 1.1, layer: 0 });

var pts = [];
for (var i = 0; i <= N; i = i + 1) {
  var x = context.L * i / N;
  var y = context.A * Math.sin(context.k * x) * state.cosW;
  pts.push([sx(x), sy(y)]);
}
Draw.curve(pts, { color: '#1f6fb2', width: 2.2 });
Draw.text(ox + scaleX * context.L * 0.62, sy(context.A) + 0.22, '虚线 = 波腹包络 ±A|sin kx|', { size: 11, color: '#5d6b7a', align: 'left' });

var mid = sx(context.L / 2);
Draw.circle([mid, sy(state.ymid)], 0.06, { fill: '#b3382f', stroke: '#b3382f' });
Draw.text(mid + 0.12, sy(state.ymid) + 0.18, '中点 y = ' + Phys.format(state.ymid, 'm', 3), { size: 11, color: '#b3382f', align: 'left' });
Draw.arrow([mid, oy - 0.02], [0, state.ymid * 6], { category: 'aux', label: 'y', mag: Math.abs(state.ymid), unit: 'm' });

/* 曲线图已移交模板页的图表面板（§13.4：横轴 t、游标与画布同一个 t、可切量/可隐藏）。
   原手绘代码留档在「软件自研v1开发历史.md 附录 B（原快照已清理）」，第 7.1 期按新方式重画。 */
Draw.text(ox - 0.1, oy + 0.62, 'λ = ' + Phys.format(context.lambda, 'm', 3) + '，波节间距 = λ/2 = ' + Phys.format(context.nodeGap, 'm', 3) + '，波速 v = ' + Phys.format(context.v, 'm/s', 3), { size: 11, color: '#5d6b7a', align: 'left' });`,

    readouts: String.raw`return [
  { key: 'f1', label: '基频', value: context.f1, unit: 'Hz', latex: 'f_1' },
  { key: 'lambda', label: '波长', value: context.lambda, unit: 'm', latex: '\\lambda' },
  { key: 'nodeGap', label: '波节间距', value: context.nodeGap, unit: 'm', latex: '\\Delta x_{节}' },
  { key: 'vwave', label: '波速', value: context.v, unit: 'm/s', latex: 'v' },
  { key: 'ymid', label: '中点位移', value: state.ymid, unit: 'm', latex: 'y_{中}' },
  { key: 'yq', label: 'L/4 处位移', value: context.A * Math.sin(context.k * context.L * 0.25) * state.cosW, unit: 'm', latex: 'y_{L/4}' }
];`,
  },
};
