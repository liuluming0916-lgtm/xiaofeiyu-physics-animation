/**
 * §19.5 回归题 03 · 追及相遇
 *
 * 考什么：双对象同时间轴（两条图线、两组读数、同一 `t`）
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 相遇时刻由方程解出，不是"看着差不多就填" —— `t1` 由 s甲 = s乙 的解析解给出；
 *   2. 两对象共用同一个 `t` —— `stateAt(t)` 一次返回甲、乙两组量，`drawFrame` 同时画两个对象；
 *   3. 追上前后的相对位移符号会变 —— `readouts` 给出 Δs = s甲 − s乙，相遇前为正、相遇后为负；
 *   4. 相遇后甲的速度更大，乙再也追不上 —— 结论靠"速度比较"给出，代码里显式比较 v甲 与 v乙。
 */

export default {
  id: 'q03-pursuit',
  index: 3,
  title: '追及相遇',
  examPoint: '双对象同时间轴',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`在平直公路上，甲车以 $v_1=10\ \mathrm{m/s}$ 匀速行驶，经过路边标志牌时，正后方 $s_0=4\ \mathrm{m}$ 处的乙车由静止开始以 $a=2\ \mathrm{m/s^2}$ 同向匀加速启动。

求：(1) 乙车追上甲车所用的时间 $t_1$；(2) 追上时乙车的速度 $v_2$；(3) 从启动到相遇前，两车之间的最大距离 $\Delta s_{\max}$。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔
title: 第 1 步 · 两个对象各自的运动学方程
tex: s_甲=v_1t=10t,\quad s_乙=\frac{1}{2}at^{2}=t^{2}\ \ (\text{乙从甲后方}4\ \mathrm{m}\ \text{处出发})
t0: 0
t1: 2.2

title: 第 2 步 · 相遇前间距先变大：此时乙还比甲慢
tex: v_乙=at<v_甲\ \Longleftrightarrow\ t<\frac{v_1}{a}=5\ \mathrm{s}\ \Rightarrow\ \Delta s=s_0+v_1t-\frac{1}{2}at^{2}\ \text{在增大}
t0: 2.2
t1: 4.4

title: 第 3 步 · 速度相等的瞬间：两车距离最大
tex: t^{\prime}=\frac{v_1}{a}=5\ \mathrm{s},\qquad \Delta s_{\max}=s_0+\frac{v_1^{2}}{2a}=4+25=29\ \mathrm{m}
t0: 4.4
t1: 6.6

title: 第 4 步 · 相遇条件与相遇时刻
tex: s_乙-s_甲=s_0\ \Rightarrow\ \frac{1}{2}at^{2}-v_1t-s_0=0\ \Rightarrow\ t_1=\frac{v_1+\sqrt{v_1^{2}+2as_0}}{a}=10.39\ \mathrm{s}
t0: 6.6
t1: 8.8

title: 第 5 步 · 追上时乙已更快：此后乙在前，不会二次相遇
tex: v_2=at_1=2\times10.39=20.77\ \mathrm{m/s}\ >v_1=10\ \mathrm{m/s}
t0: 8.8
t1: 11.2`,

    ANSWERS: String.raw`symbol: t1
value: 10.3852
unit: s
tol: 0.01
at_t: 11.2
step: 4

symbol: v2
value: 20.7703
unit: m/s
tol: 0.01
at_t: 11.2
step: 5

symbol: dsmax
value: 29.0
unit: m
tol: 0.01
at_t: 5.0
step: 3

symbol: dt*
value: 5.0
unit: s
tol: 0.01
at_t: 5.0
step: 3`,

    VIEW: String.raw`SIM = {
  duration: 11.2,
  continuityKeys: ['xA', 'xB'],
  /* C10 扩展：两车都不得越出画幅所覆盖的公路范围（相遇点 103.85 m、乙最远 121.4 m） */
  regions: [
    { label: '甲不越出公路', keys: ['xA'], maxAbs: 112.1 },
    { label: '乙不越出公路', keys: ['xB'], maxAbs: 121.5 }
  ],
  axes: [
    { key: 'vA', label: 'v 甲', unit: 'm/s' },
    { key: 'vB', label: 'v 乙', unit: 'm/s' },
    { key: 'gap', label: 'Δs', unit: 'm' }
  ]
};`,

    setup: String.raw`var v1 = 10.0;
var a = 2.0;
var s0 = 4.0;
var disc = v1 * v1 + 2 * a * s0;
/* ⚠ 命名坑（第 3 期第 8 步已修）：STEPS 的字段名是 t1/t0，而装配时 context.STEPS = STEPS 会写进 context。
   所以跨槽位导出的键**不得与 STEPS 字段同名**（t0/t1/title/tex），否则会被静默覆盖。
   这里导出的相遇时刻因此叫 tMeet —— 原先写作 't1'，那正是 X1 一直在报警的隐患。 */
RETURN('tMeet', (v1 + Math.sqrt(disc)) / a);
RETURN('v2', a * context.tMeet);
RETURN('tStar', v1 / a);
RETURN('gapMax', s0 + 0.5 * v1 * (v1 / a));
RETURN('v1', v1);
RETURN('a', a);
RETURN('s0', s0);`,

    stateAt: String.raw`var tt = Math.min(Math.max(t, 0), SIM.duration);
var sA = context.v1 * tt;
var sB = 0.5 * context.a * tt * tt;
var vB = context.a * tt;
return {
  t: tt,
  xA: sA,
  xB: -context.s0 + sB,
  sA: sA,
  sB: sB,
  vA: context.v1,
  vB: vB,
  gap: (-context.s0 + sB) - sA,
  caught: sB - sA >= context.s0
};`,

    drawFrame: String.raw`var yA = 0.88;                 /* 甲车道中心线 */
var yB = 0.28;                 /* 乙车道中心线 */
/* 全程 121 m：比例尺 0.055 世界单位/米。两车按"示意图大小"画（0.34 世界单位 ≈ 6 m 路长），
   不做等比缩小，否则 121 m 的公路上车只有几个像素。 */
var sx = function (s) { return -1.10 + 0.055 * s; };

Draw.line([-1.62, yA - 0.18], [6.20, yA - 0.18], { color: '#9aa7b4', width: 1.0, dash: [6, 4] });
Draw.line([-1.62, yB - 0.18], [6.20, yB - 0.18], { color: '#9aa7b4', width: 1.0, dash: [6, 4] });
Draw.text(-1.55, yA + 0.30, '甲车道', { size: 11, color: '#5d6b7a', align: 'left' });
Draw.text(-1.55, yB + 0.30, '乙车道', { size: 11, color: '#5d6b7a', align: 'left' });

/* 全程轨迹（浅灰虚线）：两车各自走过的路径。用只读探针 context.at(t) 采样全时段，
   注意 at() 只允许在 drawFrame 里用 —— 放进 stateAt 会变成"每帧重算全时段"，C1 会拦。 */
var traceA = [];
var traceB = [];
for (var ti = 0; ti <= 40; ti = ti + 1) {
  var ts = SIM.duration * ti / 40;
  var tp = context.at(ts);
  traceA.push([sx(tp.sA), yA]);
  traceB.push([sx(tp.xB), yB]);
}
Draw.trace(traceA, { color: '#c8d0d8', dash: [5, 5], width: 1.2, layer: 0 });
Draw.trace(traceB, { color: '#c8d0d8', dash: [5, 5], width: 1.2, layer: 0 });

var marker = sx(0);
Draw.line([marker, yA - 0.36], [marker, yA + 0.36], { color: '#1d2733', width: 1.4 });
Draw.text(marker, yA + 0.54, '标志牌（t = 0 甲在此）', { size: 11, color: '#1d2733' });

var carA = sx(state.sA);
var carB = sx(state.xB);
Draw.box([carA, yA], 0.34, 0.22, { angleDeg: 0, fill: '#ffffff', stroke: '#1d2733' });
Draw.text(carA, yA - 0.30, '甲', { size: 11, color: '#1d2733' });
Draw.box([carB, yB], 0.34, 0.22, { angleDeg: 0, fill: '#ffffff', stroke: '#2a6f8f' });
Draw.text(carB, yB - 0.30, '乙', { size: 11, color: '#2a6f8f' });

Draw.arrow([carA, yA + 0.18], [state.vA, 0], { category: 'velocity', label: 'v 甲', mag: state.vA });
Draw.arrow([carB, yB + 0.18], [state.vB, 0], { category: 'velocity', label: 'v 乙', mag: state.vB });
if (state.vB > 0) {
  Draw.arrow([carB, yB - 0.14], [context.a, 0], { category: 'acceleration', label: 'a', mag: Math.abs(context.a) });
}

/* 相遇事件：t ≥ t₁ 后在相遇点留下标记 */
if (state.caught) {
  Draw.circle([sx(state.sA), yB], 0.075, { fill: '#b3382f', stroke: '#b3382f' });
  Draw.text(sx(state.sA), yB - 0.36, 't₁ 相遇', { size: 12, color: '#b3382f' });
}

/* 间距标注：相遇前 Δs > 0；相遇后变号（乙已在前） */
var mx = sx(state.sA);
var nx = sx(state.xB);
Draw.dimension([mx, 1.50], [nx, 1.50], { kind: 'linear', text: 'Δs = ' + Phys.format(state.gap, 'm', 2) });
Draw.text(-1.55, 1.24, state.caught
  ? 't > t₁：乙已超过甲且仍在加速，间距反向增大（不会二次相遇）'
  : '相遇前：Δs 先变大（t′ = 5 s 时最大 29 m）后变小', { size: 11, color: '#5d6b7a', align: 'left' });

/* s–t 图：两条图线的交点就是相遇时刻 */
/* 曲线图已移交模板页的图表面板（§13.4：横轴 t、游标与画布同一个 t、可切量/可隐藏）。
   原手绘代码留档在「软件自研v1开发历史.md 附录 B（原快照已清理）」，第 7.1 期按新方式重画。 */`,

    readouts: String.raw`return [
  { key: 'vA', label: '甲速度', value: state.vA, unit: 'm/s', latex: 'v_甲' },
  { key: 'vB', label: '乙速度', value: state.vB, unit: 'm/s', latex: 'v_乙' },
  { key: 'sA', label: '甲位移', value: state.sA, unit: 'm', latex: 's_甲' },
  { key: 'sB', label: '乙位移', value: state.sB, unit: 'm', latex: 's_乙' },
  { key: 'gap', label: '两车间距 Δs', value: state.gap, unit: 'm', latex: '\\Delta s' },
  { key: 't1', label: '相遇时刻', value: context.tMeet, unit: 's', latex: 't_1' },
  { key: 'v2', label: '相遇时乙速度', value: context.v2, unit: 'm/s', latex: 'v_2' },
  { key: 'dt*', label: '距离最大时刻', value: context.tStar, unit: 's', latex: 't^{\\prime}' },
  { key: 'dsmax', label: '最大距离', value: context.gapMax, unit: 'm', latex: '\\Delta s_{max}' }
];`,
  },
};
