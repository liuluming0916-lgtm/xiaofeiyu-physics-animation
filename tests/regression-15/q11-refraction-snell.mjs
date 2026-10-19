/**
 * §19.5 回归题 11 · 平面折射（斯涅尔定律）
 *
 * 考什么：光学 + 光线 SDK（光线、法线、角度标注、介质分界面）
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 角度一律从**法线**量起，不是从界面量起 —— 代码里 α₁/α₂ 都是与法线的夹角；
 *   2. 折射定律用正弦之比，不是角度之比 —— `n₁sinα₁ = n₂sinα₂`，代码里用 `Math.sin`/`Math.asin`；
 *   3. 光疏→光密必须偏向法线 —— 自检体现在数值上：α₂ < α₁，且 `readouts` 同时给出两者；
 *   4. 法线是虚线、界面是实线、光线带箭头 —— 三类元素用不同样式区分，不能混画。
 */

export default {
  id: 'q11-refraction-snell',
  index: 11,
  title: '平面折射（斯涅尔定律）',
  examPoint: '光学 + 光线 SDK',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`一束单色光从空气射向某种玻璃的平直表面，入射角 $\alpha_1=45.0^\circ$。已知空气折射率 $n_1=1.00$，玻璃折射率 $n_2=1.50$，真空中的光速 $c=3.00\times10^{8}\ \mathrm{m/s}$。

求：(1) 折射角 $\alpha_2$；(2) 光在玻璃中的传播速度 $v$。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔
title: 第 1 步 · 角度从法线量起，先画法线
tex: \text{入射角}\ \alpha_1=45.0^\circ\ \text{是入射光线与法线的夹角（不是与界面的夹角）}
t0: 0
t1: 0.6

title: 第 2 步 · 斯涅尔定律：正弦之比
tex: n_1\sin\alpha_1=n_2\sin\alpha_2\ \Rightarrow\ \sin\alpha_2=\frac{n_1}{n_2}\sin\alpha_1=\frac{1.00}{1.50}\times0.7071=0.4714
t0: 0.6
t1: 1.2

title: 第 3 步 · 反解折射角（光疏 → 光密，偏向法线）
tex: \alpha_2=\arcsin0.4714=28.1^\circ<45.0^\circ
t0: 1.2
t1: 1.8

title: 第 4 步 · 介质中的光速
tex: v=\frac{c}{n_2}=\frac{3.00\times10^{8}}{1.50}=2.00\times10^{8}\ \mathrm{m/s}
t0: 1.8
t1: 2.4

title: 第 5 步 · 用频率与波长交叉核对（自检：频率不变）
tex: f=\frac{c}{n_1\lambda_1}=\frac{v}{\lambda_2}\ \Rightarrow\ \lambda_2=\frac{\lambda_1}{n_2}\ \text{（频率不变，波长变短）}
t0: 2.4
t1: 3.0`,

    ANSWERS: String.raw`symbol: a2
value: 28.1255
unit: deg
tol: 0.01
at_t: 1.2
step: 3

symbol: v
value: 2.0
unit: 1e8 m/s
tol: 0.01
at_t: 2.0
step: 4

symbol: sinRatio
value: 0.4714
unit: ''
tol: 0.01
at_t: 1.5
step: 2

symbol: a1
value: 45.0
unit: deg
tol: 0.01
at_t: 1.0
step: 1`,

    VIEW: String.raw`SIM = {
  duration: 3.0,
  axes: [
    { key: 'a1', label: 'α₁', unit: '°' },
    { key: 'a2', label: 'α₂', unit: '°' },
    { key: 'v', label: 'v', unit: '1e8 m/s' }
  ]
};`,

    setup: String.raw`var n1 = 1.00;
var n2 = 1.50;
var a1deg = 45.0;
var c = 3.00e8;
var a1 = a1deg * Math.PI / 180;
var sinA2 = n1 * Math.sin(a1) / n2;
var a2 = Math.asin(sinA2);
var a2deg = a2 * 180 / Math.PI;
var v = c / n2;
RETURN('n1', n1);
RETURN('n2', n2);
RETURN('a1deg', a1deg);
RETURN('a1', a1);
RETURN('c', c);
RETURN('sinA2', sinA2);
RETURN('a2', a2);
RETURN('a2deg', a2deg);
RETURN('v', v);`,

    stateAt: String.raw`var u = Math.min(Math.max(t / SIM.duration, 0), 1);
var span = 1.15;
var th1 = context.a1;
var th2 = context.a2;
var px, py, dirx, diry;
if (u <= 0.5) {
  /* ① 入射段：从左上方的光源飞向原点（方向 = 指向原点） */
  var s = span * (2 * u);
  px = -s * Math.sin(th1);
  py = s * Math.cos(th1);
  dirx = -Math.sin(th1);
  diry = -Math.cos(th1);
} else {
  /* ② 折射段：进入下方玻璃（y < 0），方向偏向法线；纵坐标必须为负 */
  var s2 = span * (2 * u - 1);
  px = s2 * Math.sin(th2);
  py = -s2 * Math.cos(th2);
  dirx = Math.sin(th2);
  diry = -Math.cos(th2);
}
return {
  t: t,
  progress: u,
  px: px,
  py: py,
  dirx: dirx,
  diry: diry,
  phase: u <= 0.5 ? 1 : 2,
  a1: context.a1deg,
  a2: context.a2deg,
  v: context.v / 1e8,
  sinRatio: context.sinA2,
  sinLaw: context.n1 * Math.sin(th1) - context.n2 * Math.sin(th2)
};`,

    drawFrame: String.raw`var halfW = 1.55;
var halfH = 1.35;
/* 玻璃介质（下半区，y ∈ [−halfH, 0]）——光子折射后就走在里面 */
Draw.polygon(
  [[-halfW, -halfH], [halfW, -halfH], [halfW, 0], [-halfW, 0]],
  { fill: 'rgba(42,111,143,0.10)', stroke: null, layer: -1 }
);
Draw.line([-halfW, 0], [halfW, 0], { color: '#1d2733', width: 2.2 });
Draw.text(-halfW + 0.10, 0.20, 'n₁ = 1.00（空气）', { size: 11, color: '#5d6b7a', align: 'left' });
Draw.text(-halfW + 0.10, -0.30, 'n₂ = 1.50（玻璃）', { size: 11, color: '#2a6f8f', align: 'left' });

Draw.line([0, -halfH], [0, halfH], { dash: true, color: '#9aa7b4', width: 1.2 });
Draw.text(0.10, halfH - 0.10, '法线', { size: 11, color: '#5d6b7a', align: 'left' });

var span = 1.15;
var inFrom = [-span * Math.sin(context.a1), span * Math.cos(context.a1)];
var refrTo = [span * Math.sin(context.a2), -span * Math.cos(context.a2)];
Draw.ray(inFrom, [0, 0], { color: '#c9a227', width: 1.8 });
Draw.ray([0, 0], refrTo, { color: '#c9a227', width: 1.8 });

var refX = span * Math.sin(context.a1);
var refY = span * Math.cos(context.a1) * 0.9;
Draw.ray([0, 0], [refX, refY], { color: '#c9a227', width: 1.0, dash: true, arrowHead: false });
Draw.text(refX + 0.06, refY + 0.08, '部分反射', { size: 10, color: '#5d6b7a', align: 'left' });

/* 全程轨迹（点划虚线）：光子走过的路径 = 两条光线。用点线覆盖在光线之上，作为"轨迹"的可开关标记。 */
Draw.trace([inFrom, [0, 0], refrTo], { color: '#c8d0d8', dash: true, width: 2.4, layer: 0 });

Draw.arc([0, 0], 0.42, 90, 90 + context.a1deg, { color: '#a4610d', width: 1.3, samples: 40 });
Draw.arc([0, 0], 0.42, -90, -90 + context.a2deg, { color: '#a4610d', width: 1.3, samples: 40 });
Draw.text(-0.30, 0.52, 'α₁ = ' + Phys.format(context.a1deg, '°', 4), { size: 11, color: '#a4610d', align: 'right' });
Draw.text(0.28, -0.52, 'α₂ = ' + Phys.format(context.a2deg, '°', 4), { size: 11, color: '#a4610d', align: 'left' });

Draw.dimension([0, 0], [-span * Math.sin(context.a1), span * Math.cos(context.a1)], {
  kind: 'linear', text: '', color: '#9aa7b4'
});
Draw.circle([0, 0], 0.045, { fill: '#1d2733', stroke: '#1d2733' });
Draw.circle([state.px, state.py], 0.075, { fill: '#c9a227', stroke: '#c9a227' });
Draw.text(state.px, state.py + (state.phase === 1 ? 0.16 : -0.20), '光', { size: 11, color: '#c9a227' });

Draw.text(-halfW, halfH + 0.30, '斯涅尔定律自检：n₁sinα₁ − n₂sinα₂ = ' + Phys.format(state.sinLaw, '', 2) + ' ≈ 0', { size: 11, color: '#5d6b7a', align: 'left' });

/* 曲线图已移交模板页的图表面板（§13.4：横轴 t、游标与画布同一个 t、可切量/可隐藏）。
   原手绘代码留档在「软件自研v1开发历史.md 附录 B（原快照已清理）」，第 7.1 期按新方式重画。 */`,

    readouts: String.raw`return [
  { key: 'a1', label: '入射角', value: state.a1, unit: '°', latex: '\\alpha_1' },
  { key: 'a2', label: '折射角', value: state.a2, unit: '°', latex: '\\alpha_2' },
  { key: 'sinRatio', label: 'sinα₂', value: state.sinRatio, unit: '', latex: '\\frac{n_1}{n_2}\\sin\\alpha_1' },
  { key: 'v', label: '玻璃中光速', value: state.v, unit: '1e8 m/s', latex: 'v=\\frac{c}{n_2}' },
  { key: 'n1', label: 'n₁', value: context.n1, unit: '', latex: 'n_1' },
  { key: 'n2', label: 'n₂', value: context.n2, unit: '', latex: 'n_2' },
  { key: 'sinLaw', label: 'n₁sinα₁ − n₂sinα₂', value: state.sinLaw, unit: '', latex: '0' }
];`,
  },
};
