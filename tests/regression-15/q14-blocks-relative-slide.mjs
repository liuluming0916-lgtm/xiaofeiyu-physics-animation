/**
 * §19.5 回归题 14 · 板块相对滑动
 *
 * 考什么：摩擦突变 + 几何外包（"相对位移"与"是否滑落"是两道不同的题）
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 上块与板之间的摩擦力方向由上块的**相对滑动方向**决定 —— 代码里 f1 作用在上块向右、
 *      反作用力作用在板上向左，方向不是写死的；
 *   2. 共速时刻是"两块速度相等"，不是"板停下" —— t1 由 v_A(t) = v_B(t) 解出；
 *   3. 需要区分两段：共速前的相对滑动段、共速后的整体减速段（地面摩擦仍在）；
 *   4. 上块是否从板右端滑落，比的是**相对位移**与板的可用长度 —— `readouts` 给出
 *      Δs_rel 与板长，并给出余量；结论由数值比较得出，不是先判定"一定不掉"。
 */

export default {
  id: 'q14-blocks-relative-slide',
  index: 14,
  title: '板块相对滑动',
  examPoint: '摩擦突变 + 几何外包',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`长 $L=12\ \mathrm{m}$ 的木板静置于水平地面，板的质量 $M=2\ \mathrm{kg}$。质量 $m=1\ \mathrm{kg}$ 的小物块轻放在板的左端，同时给板一个向右的初速度 $v_0=6\ \mathrm{m/s}$，物块初速为零。物块与板间的动摩擦因数 $\mu_1=0.2$，板与地面间的动摩擦因数 $\mu_2=0.1$，取 $g=10\ \mathrm{m/s^2}$。

求：(1) 物块与板达到共速所用的时间 $t_1$ 及此时速度 $v_1$；(2) 全过程中物块相对板滑动的距离 $\Delta s$；(3) 判断物块是否会从板的右端滑落。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔
title: 第 1 步 · 分段：先相对滑动，后整体减速
tex: \text{滑动段：}a_m=\mu_1 g=2\ \mathrm{m/s^2}\ (\text{向右}),\quad a_M=-\frac{\mu_1 mg+\mu_2 (M+m)g}{M}=-2.5\ \mathrm{m/s^2}
t0: 0
t1: 1.0

title: 第 2 步 · 共速条件：两者速度相等
tex: a_m t_1=v_0+a_M t_1\ \Rightarrow\ t_1=\frac{v_0}{a_m-a_M}=1.33\ \mathrm{s},\quad v_1=a_m t_1=2.67\ \mathrm{m/s}
t0: 1.0
t1: 1.9

title: 第 3 步 · 相对位移 = 两段位移之差（不是物块位移）
tex: x_M(t_1)=5.78\ \mathrm{m},\quad x_m(t_1)=1.78\ \mathrm{m}\ \Rightarrow\ \Delta s=4.00\ \mathrm{m}
t0: 1.9
t1: 2.7

title: 第 4 步 · 共速后：整体受地面摩擦减速，物块不再相对滑动
tex: a'=\mu_2 g=1\ \mathrm{m/s^2}\ (\text{向左}),\quad \text{需牵引物块的摩擦}\ ma'=1\ \mathrm{N}<\mu_1 mg=2\ \mathrm{N}\ \Rightarrow\ \text{保持共速}
t0: 2.7
t1: 3.6

title: 第 5 步 · 是否滑落：比较相对位移与板的可用长度（t = 4.0 s 时两物体一起停稳）
tex: \Delta s=4.00\ \mathrm{m}<L=12\ \mathrm{m}\ \Rightarrow\ \text{物块停在距板左端}4.00\ \mathrm{m}\ \text{处，不会滑落}
t0: 3.6
t1: 4.06`,

    ANSWERS: String.raw`symbol: t1
value: 1.333
unit: s
tol: 0.02
at_t: 1.333
step: 2

symbol: v1
value: 2.667
unit: m/s
tol: 0.02
at_t: 1.333
step: 2

symbol: ds_rel
value: 4.0
unit: m
tol: 0.02
at_t: 1.333
step: 3

symbol: margin
value: 8.0
unit: m
tol: 0.02
at_t: 3.0
step: 5`,

    VIEW: String.raw`SIM = {
  duration: 4.06,
  continuityKeys: ['xA', 'xB'],
  /* C10 扩展：物块必须始终落在板上（相对位移不得超过板长），且不倒退 */
  regions: [
    { label: '物块在板上', x: [0, 16.4] },
    { label: '相对滑动不超板长', maxAbs: 16.4 }
  ],
  axes: [
    { key: 'vA', label: 'v 物块', unit: 'm/s' },
    { key: 'vB', label: 'v 板', unit: 'm/s' },
    { key: 'ds_rel', label: 'Δs', unit: 'm' }
  ]
};`,

    setup: String.raw`var g = 10, mu1 = 0.2, mu2 = 0.1, m = 1.0, M = 2.0, v0 = 6.0, L = 12.0;
var a1 = mu1 * g;
var a2 = -(mu1 * m * g + mu2 * (M + m) * g) / M;
var t1 = v0 / (a1 - a2);
var v1 = a1 * t1;
var xm1 = 0.5 * a1 * t1 * t1;
var xM1 = v0 * t1 + 0.5 * a2 * t1 * t1;
var dsRel = xM1 - xm1;
var aAfter = -mu2 * g;
var stopExtra = -v1 / aAfter;
var T = t1 + stopExtra;
/* 停止时刻的位移（静止段锁在这里，避免速度越零后"倒车"） */
var xAStop = xm1 + v1 * stopExtra + 0.5 * aAfter * stopExtra * stopExtra;
var xBStop = xM1 + v1 * stopExtra + 0.5 * aAfter * stopExtra * stopExtra;
RETURN('g', g);
RETURN('mu1', mu1);
RETURN('mu2', mu2);
RETURN('m', m);
RETURN('M', M);
RETURN('v0', v0);
RETURN('L', L);
RETURN('a1', a1);
RETURN('a2', a2);
/* ⚠ 第 3 期第 8 步：这个**局部变量**叫 t1 无妨（它不进 context）；
   但**导出键**不能叫 't1' —— STEPS 的字段名就是 t1，装配时 context.STEPS = STEPS 会把它静默覆盖。
   导出键因此改名为 tStar（X1 原先一直在本题报警）。 */
RETURN('tStar', t1);
RETURN('v1', v1);
RETURN('xm1', xm1);
RETURN('xM1', xM1);
RETURN('dsRel', dsRel);
RETURN('aAfter', aAfter);
RETURN('xAStop', xAStop);
RETURN('xBStop', xBStop);
RETURN('T', T);`,

    stateAt: String.raw`var tt = Math.min(Math.max(t, 0), context.T);
var sliding = tt < context.tStar;
var still = tt >= context.T - 1e-9;      /* 两物体都已停止 */
var vA, vB, xA, xB, aShow, aBShow;
if (sliding) {
  vA = context.a1 * tt;
  vB = context.v0 + context.a2 * tt;
  xA = 0.5 * context.a1 * tt * tt;
  xB = context.v0 * tt + 0.5 * context.a2 * tt * tt;
  aShow = context.a1;
  aBShow = context.a2;
} else if (!still) {
  var d = tt - context.tStar;
  vA = context.v1 + context.aAfter * d;
  vB = vA;
  xA = context.xm1 + context.v1 * d + 0.5 * context.aAfter * d * d;
  xB = context.xM1 + context.v1 * d + 0.5 * context.aAfter * d * d;
  aShow = context.aAfter;
  aBShow = context.aAfter;
} else {
  /* 完全静止：速度锁在 0、位移锁在 T 时刻的值，加速度归零 */
  vA = 0;
  vB = 0;
  xA = context.xAStop;
  xB = context.xBStop;
  aShow = 0;
  aBShow = 0;
}
var dsRel = xB - xA;
var state0 = { aShow: 0, aBShow: 0 };
void state0;
return {
  t: tt,
  xA: xA,
  xB: xB,
  vA: vA,
  vB: vB,
  dsRel: dsRel,
  sliding: sliding,
  still: still,
  aShow: aShow,
  aBShow: aBShow,
  contactLeft: xB,
  contactRight: xB + context.L
};`,

    drawFrame: String.raw`var ground = 0;
var H = 0.42;          /* 板厚 */
var blockH = 0.52;
var boardY = ground + H;
/* 相机由 AutoView 全时段锁定（§4.6），这里全部用**世界坐标**绘制。
   之前用 camX = state.xB − 1.6 做人为平移，会让整块板在屏幕上滑动，
   与"地面不动"的要求冲突；现在交给锁死的相机，12 m 的板完整入画。 */

Draw.ground(state.xB - 0.9, state.xB + context.L + 0.9, ground, { color: '#2b3440' });

var boardLeft = state.xB;
var boardRight = state.xB + context.L;
Draw.polygon([[boardLeft, boardY], [boardRight, boardY], [boardRight, boardY + H], [boardLeft, boardY + H]], {
  fill: '#ffffff', stroke: '#2b3440', layer: 1
});
Draw.text(boardLeft + 1.2, boardY + H * 0.5, 'M = 2 kg, L = 12 m', { size: 11, color: '#5d6b7a', align: 'left' });

var blockLeft = state.xB + state.dsRel + 0.08;
var blockRight = blockLeft + 0.85;
/* 全程轨迹（浅灰虚线）：滑块与木板各自走过的水平路径。只读探针 context.at(t) 采样全时段，
   at() 只能在 drawFrame 里用（放进 stateAt 会被 C1 拦）。 */
var tBlk = [], tBrd = [];
for (var tq = 0; tq <= 32; tq = tq + 1) { var sq = context.at(SIM.duration * tq / 32); tBlk.push([sq.xB + sq.dsRel + 0.505, boardY + H + blockH * 0.5]); tBrd.push([sq.xB + context.L * 0.5, boardY + H * 0.5]); }
Draw.trace(tBlk, { color: '#c8d0d8', dash: true, width: 1.2, layer: 0 });
Draw.trace(tBrd, { color: '#c8d0d8', dash: true, width: 1.2, layer: 0 });
Draw.polygon(
  [[blockLeft, boardY + H], [blockRight, boardY + H], [blockRight, boardY + H + blockH], [blockLeft, boardY + H + blockH]],
  { fill: '#ffffff', stroke: '#1d2733', layer: 2 }
);
Draw.text((blockLeft + blockRight) / 2, boardY + H + blockH + 0.14, 'm = 1 kg', { size: 12, color: '#1d2733' });

if (state.sliding) {
  Draw.arrow([blockRight, boardY + H + blockH * 0.5], [1.4, 0], {
    category: 'force', subtype: 'friction', label: 'f₁ = μ₁mg', mag: context.mu1 * context.m * context.g
  });
  /* 作用在板上的反作用力与 f₁ **等大反向** ⇒ mag 完全相同（同一把尺子上必须一样长） */
  Draw.arrow([boardRight - 1.0, boardY + H * 0.5], [-0.9, 0], {
    category: 'force', subtype: 'friction', label: 'f₁′', mag: context.mu1 * context.m * context.g
  });
} else if (state.still) {
  Draw.text(blockLeft, boardY + H + blockH + 0.42, '已停止：摩擦力与加速度均为 0', { size: 11, color: '#5d6b7a', align: 'left' });
} else {
  Draw.arrow([blockRight, boardY + H + blockH * 0.5], [-1.0, 0], {
    category: 'force', subtype: 'friction', label: '静摩擦 1 N', mag: 1
  });
}
if (!state.still) {
  Draw.arrow([boardLeft + 1.0, boardY - 0.22], [-0.9, 0], {
    category: 'force', subtype: 'friction', label: 'f₂ = μ₂(M+m)g', mag: context.mu2 * (context.M + context.m) * context.g
  });
}

/* 加速度：滑动段 a_m = +2、a_M = −2.5；共速段 a = −1；停止后为 0 */
if (!state.still) {
  Draw.arrow([blockRight + 0.15, boardY + H + blockH * 0.5], [state.aShow * 0.30, 0], {
    category: 'acceleration', label: 'a 物块', mag: state.aShow, unit: 'm/s²'
  });
  Draw.arrow([boardRight - 1.0, boardY + H + 0.55], [state.aBShow * 0.30, 0], {
    category: 'acceleration', label: 'a 板', mag: state.aBShow, unit: 'm/s²'
  });
}

Draw.arrow([blockRight + 0.15, boardY + H + blockH + 0.62], [state.vA, 0], {
  category: 'velocity', label: 'v 物块', mag: Math.abs(state.vA)
});
Draw.arrow([boardRight - 2.2, boardY + H + 0.30], [state.vB, 0], {
  category: 'velocity', label: 'v 板', mag: Math.abs(state.vB)
});

var rulerY = 2.20;
Draw.line([state.xB, rulerY], [state.xB + state.dsRel, rulerY], { color: '#a4610d', width: 1.4 });
Draw.dimension([state.xB, rulerY + 0.14], [state.xB + state.dsRel, rulerY + 0.14], {
  kind: 'linear', text: 'Δs = ' + Phys.format(state.dsRel, 'm', 2)
});
Draw.line([state.xB, boardY + H], [state.xB, rulerY], { dash: true, color: '#9aa7b4' });
Draw.line([state.xB + state.dsRel, boardY + H + blockH], [state.xB + state.dsRel, rulerY], { dash: true, color: '#9aa7b4' });
Draw.text(boardLeft, rulerY + 0.38, '板右端余量 = ' + Phys.format(context.L - state.dsRel, 'm', 2) + '（> 0 ⇒ 未滑落）', { size: 11, color: '#5d6b7a', align: 'left' });

/* 曲线图已移交模板页的图表面板（§13.4：横轴 t、游标与画布同一个 t、可切量/可隐藏）。
   原手绘代码留档在「软件自研v1开发历史.md 附录 B（原快照已清理）」，第 7.1 期按新方式重画。 */`,

    readouts: String.raw`return [
  { key: 'vA', label: '物块速度', value: state.vA, unit: 'm/s', latex: 'v_m' },
  { key: 'vB', label: '板速度', value: state.vB, unit: 'm/s', latex: 'v_M' },
  { key: 'v1', label: '共速速度', value: context.v1, unit: 'm/s', latex: 'v_1' },
  { key: 'xA', label: '物块位移', value: state.xA, unit: 'm', latex: 'x_m' },
  { key: 'xB', label: '板位移', value: state.xB, unit: 'm', latex: 'x_M' },
  { key: 'ds_rel', label: '相对滑动距离', value: state.dsRel, unit: 'm', latex: '\\Delta s' },
  { key: 'margin', label: '板右端余量', value: context.L - state.dsRel, unit: 'm', latex: 'L-\\Delta s' },
  { key: 't1', label: '共速时刻', value: context.tStar, unit: 's', latex: 't_1' }
];`,
  },
};
