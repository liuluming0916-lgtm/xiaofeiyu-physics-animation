/**
 * §19.5 回归题 08 · 带电粒子在匀强磁场中做圆周运动
 *
 * 考什么：微观时间放慢（演示时间与真实周期的比例必须写在明面上）
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 洛伦兹力永远垂直速度 ⇒ 速率恒定、轨迹是圆 —— 用解析参数方程而不是数值积分，
 *      `readouts` 实时给出 `v/v₀`，全时段应恒为 1；
 *   2. 半径与周期用解析式 —— `r = mv/(qB)`、`T = 2πm/(qB)`，不靠"量图"得出；
 *   3. 磁场区必须铺满整条轨迹 —— `Draw.fieldDots({symbol:'cross'})` 覆盖从入射点到半圆结束；
 *   4. 时间放慢写在明面上 —— 画面与读数同时给出"演示时间 t / 真实周期 T / 已走过周期数"。
 */

export default {
  id: 'q08-charged-in-b-field',
  index: 8,
  title: '带电粒子在磁场中的圆周',
  examPoint: '微观时间放慢',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`质量 $m=0.020\ \mathrm{kg}$、电荷量 $q=+0.10\ \mathrm{C}$ 的带电微粒，以速率 $v_0=20\ \mathrm{m/s}$ 从原点沿 $+x$ 方向射入垂直纸面向里的匀强磁场区域，磁感应强度 $B=0.50\ \mathrm{T}$，重力不计。

求：(1) 粒子做圆周运动的半径 $r$；(2) 周期 $T$；(3) $t=1.0\ \mathrm{s}$ 时粒子的位置坐标。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔
title: 第 1 步 · 洛伦兹力垂直于速度 ⇒ 速率不变、轨迹为圆
tex: F=qvB=\frac{mv^{2}}{r}\ \Rightarrow\ r=\frac{mv_0}{qB},\qquad T=\frac{2\pi m}{qB}
t0: 0
t1: 0.6

title: 第 2 步 · 代入数值求半径
tex: r=\frac{0.020\times20}{0.10\times0.50}=8.00\ \mathrm{m}
t0: 0.6
t1: 1.2

title: 第 3 步 · 周期与速率无关（回旋加速器的原理）
tex: T=\frac{2\pi m}{qB}=\frac{2\pi\times0.020}{0.10\times0.50}=2.513\ \mathrm{s},\qquad \omega=\frac{2\pi}{T}=2.5\ \mathrm{rad/s}
t0: 1.2
t1: 1.8

title: 第 4 步 · 由初速度方向定圆心：圆心在 (0, r)
tex: \vec{F}=q\vec{v}\times\vec{B}\ \text{指向}\ +y\ \Rightarrow\ \text{圆心}\ (0,\ 8.00)\ \mathrm{m},\quad \text{逆时针转动}
t0: 1.8
t1: 2.4

title: 第 5 步 · 代入 t = 1.0 s
tex: \varphi=\omega t=2.5\ \mathrm{rad},\quad x=r\sin\varphi=4.79\ \mathrm{m},\quad y=r(1-\cos\varphi)=14.41\ \mathrm{m}
t0: 2.4
t1: 3.0`,

    ANSWERS: String.raw`symbol: r
value: 8.0
unit: m
tol: 0.01
at_t: 1.0
step: 2

symbol: T
value: 2.5133
unit: s
tol: 0.01
at_t: 1.5
step: 3

symbol: x
value: 4.7875
unit: m
tol: 0.01
at_t: 1.0
step: 5

symbol: y
value: 14.4091
unit: m
tol: 0.01
at_t: 1.0
step: 5

symbol: speedRatio
value: 1.0
unit: ''
tol: 0.01
at_t: 2.0
step: 1`,

    VIEW: String.raw`SIM = {
  duration: 3.0,
  continuityKeys: ['x', 'y'],
  /* C10 扩展：本题的解就是"半径 r = mv/(qB) 的圆周"，于是直接把圆写进门禁：
     粒子到 (0, r) 的距离必须恒等于 r（解析构造，容差取 1e-6 足够） */
  regions: [
    { label: '粒子始终在半径 r 的圆周上', insideCircle: [0, 8, 8], tol: 1e-6 },
    { label: '粒子不越出画幅', x: [-8.1, 8.1], y: [-0.1, 16.1] }
  ],
  axes: [
    { key: 'x', label: 'x', unit: 'm' },
    { key: 'y', label: 'y', unit: 'm' },
    { key: 'speed', label: 'v', unit: 'm/s' }
  ]
};`,

    setup: String.raw`var m = 0.020;
var q = 0.10;
var B = 0.50;
var v0 = 20.0;
var w = q * B / m;
var T = 2 * Math.PI / w;
var r = m * v0 / (q * B);
RETURN('m', m);
RETURN('q', q);
RETURN('B', B);
RETURN('v0', v0);
RETURN('w', w);
RETURN('T', T);
RETURN('r', r);`,

    stateAt: String.raw`var tt = Math.min(Math.max(t, 0), SIM.duration);
var phi = context.w * tt;
var x = context.r * Math.sin(phi);
var y = context.r * (1 - Math.cos(phi));
var vx = context.v0 * Math.cos(phi);
var vy = context.v0 * Math.sin(phi);
var speed = Math.sqrt(vx * vx + vy * vy);
/* 向心加速度矢量：大小 v²/r，方向始终指向圆心 (0, r) */
var aMag = (speed * speed) / context.r;
var cx0 = 0, cy0 = context.r;
var dxc = cx0 - x, dyc = cy0 - y;
var dl = Math.sqrt(dxc * dxc + dyc * dyc) || 1;
return {
  t: tt,
  x: x,
  y: y,
  vx: vx,
  vy: vy,
  speed: speed,
  fx: -context.q * vy * context.B,
  fy: context.q * vx * context.B,
  ax: (dxc / dl) * aMag,
  ay: (dyc / dl) * aMag,
  aMag: aMag,
  rpm: tt / context.T
};`,

    drawFrame: String.raw`var r = context.r;
Draw.fieldDots({ x: -1.2, y: -1.2, w: r + 2.4, h: 2 * r + 2.4 }, { symbol: 'cross', nx: 11, ny: 12, color: '#3a4a5a' });

var ring = [];
for (var i = 0; i <= 96; i = i + 1) {
  var ph = 2 * Math.PI * i / 96;
  ring.push([r * Math.sin(ph), r * (1 - Math.cos(ph))]);
}
Draw.trace(ring, { color: '#9aa7b4', dash: [5, 4], width: 1.0 });
Draw.circle([0, r], r, { stroke: '#ccd4dc', width: 1.0, dash: [3, 4] });
Draw.circle([0, r], 0.16, { fill: '#1d2733', stroke: '#1d2733' });
Draw.text(-0.45, r, '圆心 (0, r)', { size: 11, color: '#5d6b7a', align: 'right' });

var trail = [];
var steps = 72;
for (var j = 0; j <= steps; j = j + 1) {
  var t0 = state.t * j / steps;
  var ph2 = context.w * t0;
  trail.push([r * Math.sin(ph2), r * (1 - Math.cos(ph2))]);
}
Draw.curve(trail, { color: '#1f6fb2', width: 2.4 });

Draw.line([0, r], [state.x, state.y], { dash: [3, 3], color: '#5d6b7a', width: 1.1 });
Draw.dimension([0, r], [state.x, state.y], { kind: 'linear', text: 'r = ' + Phys.format(r, 'm', 3) });

Draw.circle([state.x, state.y], 0.20, { fill: '#2a6f8f', stroke: '#2a6f8f' });
Draw.arrow([state.x, state.y], [state.vx, state.vy], { category: 'velocity', label: 'v', mag: Math.hypot(state.vx, state.vy) });
Draw.arrow([state.x, state.y], [state.fx, state.fy], { category: 'force', subtype: 'lorentz', label: 'F = qvB', mag: Math.hypot(state.fx, state.fy) });
/* 向心加速度 a = v²/r，方向始终指向圆心——本题的核心物理量，之前漏画 */
Draw.arrow([state.x, state.y], [state.ax, state.ay], { category: 'acceleration', label: 'a = v²/r', mag: Math.hypot(state.ax, state.ay) });

Draw.line([-1.1, 0], [r + 1.1, 0], { dash: [4, 4], color: '#ccd4dc', width: 1.0 });
Draw.line([0, -1.1], [0, 2 * r + 1.1], { dash: [4, 4], color: '#ccd4dc', width: 1.0 });
Draw.text(0.22, -0.60, '入射点 (0,0) 沿 +x', { size: 11, color: '#1d2733', align: 'left' });
Draw.text(0.22, 1.15, '磁场垂直纸面向里（×）', { size: 11, color: '#3a4a5a', align: 'left' });

Draw.text(3.30, 1.15, 'B = 0.50 T　q = +0.10 C　m = 0.020 kg', { size: 11, color: '#5d6b7a', align: 'left' });
Draw.text(3.30, 1.55, '演示 t = ' + Phys.format(state.t, 's', 3) + '　真实周期 T = ' + Phys.format(context.T, 's', 3), { size: 11, color: '#5d6b7a', align: 'left' });
Draw.text(3.30, 1.95, '已走过 ' + Phys.format(state.rpm, '个周期', 3) + '（时间已放慢到看得清）', { size: 11, color: '#5d6b7a', align: 'left' });
Draw.text(3.30, 2.35, '速率恒为 ' + Phys.format(state.speed, 'm/s', 4) + '（洛伦兹力不做功）', { size: 11, color: '#2a6f8f', align: 'left' });
Draw.text(3.30, 2.75, 'ω = ' + Phys.format(context.w, 'rad/s', 3) + '　φ = ' + Phys.format(context.w * state.t, 'rad', 3), { size: 11, color: '#5d6b7a', align: 'left' });`,

    readouts: String.raw`return [
  { key: 'x', label: 'x 坐标', value: state.x, unit: 'm', latex: 'x' },
  { key: 'y', label: 'y 坐标', value: state.y, unit: 'm', latex: 'y' },
  { key: 'speed', label: '速率', value: state.speed, unit: 'm/s', latex: 'v' },
  { key: 'r', label: '圆周半径', value: context.r, unit: 'm', latex: 'r=\\frac{mv}{qB}' },
  { key: 'T', label: '周期', value: context.T, unit: 's', latex: 'T=\\frac{2\\pi m}{qB}' },
  { key: 'w', label: '角速度', value: context.w, unit: 'rad/s', latex: '\\omega' },
  { key: 'phi', label: '已转过角度', value: context.w * state.t, unit: 'rad', latex: '\\varphi' },
  { key: 'rpm', label: '已走过周期数', value: state.rpm, unit: '个', latex: 't/T' },
  { key: 'speedRatio', label: '速率/初速率', value: state.speed / context.v0, unit: '', latex: 'v/v_0' }
];`,
  },
};
