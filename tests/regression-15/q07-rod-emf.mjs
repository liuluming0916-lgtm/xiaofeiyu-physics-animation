/**
 * §19.5 回归题 07 · 导体棒切割磁感线（电磁 + 电路量）
 *
 * 考什么：电磁 + 电路量（动生电动势 → 电流 → 安培力 → 反作用于运动）
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 电动势 E=BLv 由代码算出，不是抄来的数 —— stateAt 里 emf = B*L*v；
 *   2. 电流 I=E/(R+r) 由代码算出，且棒内电流方向由电动势符号决定（state.cur 的符号）；
 *   3. 安培力 F=BIL 的**方向由代码算出**：f = -B·|I|·L·sign(v)，drawFrame 直接画 state.f，
 *      不写死箭头朝向；v>0 时箭头必指向 -x（与速度相反）；
 *   4. 减速律用解析式 v(t)=v0·exp(-B²L²t/(m(R+r)))，drawFrame 只读 state，不重算积分。
 *
 * 绘图注记：Draw.arrow 统一传**几何矢量**（物理量 × 几何缩放）并置 scale=1，
 * 物理量用 opts.mag/unit 记录 —— 因为 §4.6 的命令包络把 vec 原样当长度（不乘 scale），
 * 传物理量会让包络虚胖、AutoView 把画面缩小（见报告）。
 *
 * 跨槽位注记：setup 用 RETURN(key, value) 导出派生量，其余槽位从 context 读取。
 */

export default {
  id: 'q07-rod-emf',
  index: 7,
  title: '导体棒切割磁感线',
  examPoint: '电磁 + 电路量',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`俯视图：两条水平放置的平行长直导轨间距 $L=0.4\ \mathrm{m}$，左端接阻值 $R=0.6\ \Omega$ 的定值电阻。质量 $m=0.2\ \mathrm{kg}$、电阻 $r=0.2\ \Omega$ 的金属棒垂直横跨在导轨上，与导轨接触良好，可在导轨上无摩擦滑动。

整个装置处在磁感应强度 $B=1.0\ \mathrm{T}$ 的匀强磁场中，磁场方向垂直纸面向里。$t=0$ 时给金属棒一个沿导轨向右的初速度 $v_0=4.0\ \mathrm{m/s}$，此后金属棒只在安培力作用下运动。

求：(1) 棒的速率 $v(t)$ 的表达式与"衰减时间常数" $\tau$；(2) $t=1.0\ \mathrm{s}$ 时的动生电动势 $E$、电流 $I$ 与安培力 $F$（并说明 $F$ 的方向）；(3) $t=2.0\ \mathrm{s}$ 时棒的速率。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔；字段 title / tex / t0 / t1
title: 第 1 步 · 动生电动势与回路电流
tex: E=BLv,\qquad I=\frac{E}{R+r}=\frac{BLv}{R+r}=2.0\ \mathrm{A}\ (t=0)
t0: 0
t1: 0.5

title: 第 2 步 · 安培力反向于速度
tex: F=BIL=\frac{B^{2}L^{2}v}{R+r},\qquad \vec{F}\ \text{恒与}\ \vec{v}\ \text{反向}\ \Rightarrow a=-\frac{B^{2}L^{2}}{m(R+r)}v
t0: 0.5
t1: 1.0

title: 第 3 步 · 指数减速律与时间常数
tex: \frac{\mathrm{d}v}{\mathrm{d}t}=-\frac{v}{\tau},\quad \tau=\frac{m(R+r)}{B^{2}L^{2}}=\frac{0.2\times 0.8}{1.0^{2}\times 0.4^{2}}=1.0\ \mathrm{s},\quad v(t)=v_0e^{-t/\tau}
t0: 1.0
t1: 1.5

title: 第 4 步 · 代入求值
tex: v(1.0)=4.0e^{-1}=1.47\ \mathrm{m/s},\ E=0.59\ \mathrm{V},\ I=0.74\ \mathrm{A},\ F=0.29\ \mathrm{N};\quad v(2.0)=4.0e^{-2}=0.54\ \mathrm{m/s}
t0: 1.5
t1: 2.0`,

    ANSWERS: String.raw`symbol: tau
value: 1.0
unit: s
tol: 0.01
at_t: 1.0
step: 3

symbol: E
value: 0.5886
unit: V
tol: 0.01
at_t: 1.0
step: 4

symbol: I
value: 0.7358
unit: A
tol: 0.01
at_t: 1.0
step: 4

symbol: F
value: 0.2943
unit: N
tol: 0.01
at_t: 1.0
step: 4

symbol: v
value: 0.5413
unit: m/s
tol: 0.01
at_t: 2.0
step: 4`,

    VIEW: `SIM = {
  duration: 2.0,
  /* v1.1.9：导体棒中心（yM = L/2，与 drawFrame 的 yM 一致）。 */
  bodies: [
    { id: 'rod', at: (s) => [s.x, context.L / 2] }
  ],
  /* C10 扩展：导体棒必须始终横跨在两导轨之间（导轨画到 x = 5.4，棒高恒为 y = 0.2） */
  regions: [
    { label: '导体棒不滑出导轨', x: [-0.45, 5.35], y: [0.19, 0.21] }
  ],
  axes: [
    { key: 'v', label: 'v', unit: 'm/s' },
    { key: 'E', label: 'E', unit: 'V' },
    { key: 'I', label: 'I', unit: 'A' },
    { key: 'F', label: 'F', unit: 'N' }
  ],
  continuityKeys: ['x', 'y']
};`,

    setup: `var B = 1.0;
var L = 0.4;
var m = 0.2;
var R = 0.6;
var r = 0.2;
var v0 = 4.0;

var Rt = R + r;                       // 回路总电阻 0.8 Ω
var tau = m * Rt / (B * B * L * L);   // 衰减时间常数 m(R+r)/(B²L²) = 1.0 s
var xEnd = v0 * tau;                  // 位移的渐近值 4.0 m

RETURN('B', B);
RETURN('L', L);
RETURN('m', m);
RETURN('R', R);
RETURN('r', r);
RETURN('Rt', Rt);
RETURN('v0', v0);
RETURN('tau', tau);
RETURN('xEnd', xEnd);`,

    stateAt: `var tt = Math.min(Math.max(t, 0), SIM.duration);
var decay = Math.exp(-tt / context.tau);

var v = context.v0 * decay;                                   // 指数减速律
var x = context.v0 * context.tau * (1 - decay);               // 位移解析式
var emf = context.B * context.L * v;                          // 动生电动势 E = BLv（有向）
var cur = emf / (context.R + context.r);                      // 回路电流 I = E/(R+r)（有向）
var dir = v > 0 ? 1 : (v < 0 ? -1 : 0);
var f = -context.B * Math.abs(cur) * context.L * dir;         // 安培力 F = BIL，方向恒与 v 相反
var power = Math.abs(emf * cur);                              // 电功率 P = EI

return {
  t: tt,
  x: x,
  y: context.L / 2,
  v: v,
  a: f / context.m,
  emf: emf,
  cur: cur,
  f: f,
  p: power
};`,

    drawFrame: `var L = context.L;
var yB = 0, yT = L, yM = L / 2;
var xEnd = 5.4;

// —— 磁场区：垂直纸面向里（叉号阵列）——
Draw.fieldDots({ x: -0.5, y: yB - 0.3, w: 6.0, h: L + 0.6 }, { symbol: 'cross', nx: 14, ny: 4 });
Draw.text(3.9, yT + 0.52, '磁场 B 垂直纸面向里', { size: 12, color: '#3a4a5a' });

// —— 导轨 ——
Draw.line([-0.5, yB], [xEnd, yB], { width: 2.6, color: '#2b3440' });
Draw.line([-0.5, yT], [xEnd, yT], { width: 2.6, color: '#2b3440' });

// —— 左端定值电阻 R ——
Draw.box([-0.5, yM], 0.20, 0.56, { fill: '#ffffff' });
Draw.text(-0.5, yM, 'R', { size: 13 });

// —— 全程轨迹（浅灰虚线）：导体棒沿导轨的移动路径，画在两导轨之间，不与导轨重合 ——
// 只读探针 context.at(t) 采样全时段；at() 只能在 drawFrame 里用（stateAt 里用 C1 会拦）
var tracePts = [];
for (var tq = 0; tq <= 32; tq = tq + 1) { tracePts.push([context.at(SIM.duration * tq / 32).x, yM]); }
Draw.trace(tracePts, { color: '#c8d0d8', dash: true, width: 1.2, layer: 0 });

// —— 金属棒（长 L，横跨两导轨，自身电阻 r）——
Draw.box([state.x, yM], 0.07, L, { fill: '#dfe6ec' });
Draw.text(state.x, yM, 'r', { size: 12 });

// —— 安培力矢量（v 由 bodies 自动生成）——
// 箭头只吃几何矢量（物理量 × 几何缩放，scale=1），物理量记在 mag/unit
Draw.arrow([state.x, yM + 0.04], [state.f * 2.2, 0], { category: 'force', subtype: 'ampere', label: 'F', mag: Math.abs(state.f), unit: 'N' });

// —— 回路电流方向：由代码算出的 state.cur 的符号决定 ——
var sgn = state.cur > 1e-12 ? 1 : (state.cur < -1e-12 ? -1 : 0);
if (sgn !== 0) {
  Draw.arrow([state.x + 0.10, yM - 0.13], [0, sgn * 0.26], { category: 'aux', label: 'I', mag: Math.abs(state.cur), unit: 'A' });
  /**
   * 这两根是**磁场方向示意**（沿磁场走），不是"某时刻的大小"。
   * 但它们仍然是矢量，必须给 mag —— 取磁场强度 B（本题恒为 1.0 T），
   * 于是它们与"电流"那根在同一把尺子上：B 恒定 ⇒ 长度恒定，学生不会被它们的抖动误导。
   */
  Draw.arrow([state.x - 1.7, yT + 0.17], [-sgn, 0], { category: 'aux', label: 'B', mag: context.B, unit: 'T' });
  Draw.arrow([1.1, yB - 0.17], [sgn, 0], { category: 'aux', label: 'B', mag: context.B, unit: 'T' });
}

// —— 实时读数（都由 state 得到）——
Draw.text(0.05, yT + 0.95, 'v = ' + Phys.format(state.v, 'm/s', 3), { size: 12, align: 'left' });
Draw.text(0.05, yT + 0.74, 'E = ' + Phys.format(state.emf, 'V', 3) + '   I = ' + Phys.format(state.cur, 'A', 3) + '   F = ' + Phys.format(state.f, 'N', 3),
  { size: 12, align: 'left' });

// —— v–t 曲线：指数衰减，面积即位移 ——
var ox = 0.15, oy = -2.05, ax = 2.6, ay = 1.25;
/* 曲线图已移交模板页的图表面板（§13.4：横轴 t、游标与画布同一个 t、可切量/可隐藏）。
   原手绘代码留档在「软件自研v1开发历史.md 附录 B（原快照已清理）」，第 7.1 期按新方式重画。 */`,

    readouts: `return [
  { key: 'v', label: '棒的速度', value: state.v, unit: 'm/s', latex: 'v' },
  { key: 'x', label: '棒的位移', value: state.x, unit: 'm', latex: 'x' },
  { key: 'E', label: '动生电动势', value: state.emf, unit: 'V', latex: 'E' },
  { key: 'I', label: '回路电流', value: state.cur, unit: 'A', latex: 'I' },
  { key: 'F', label: '安培力大小（方向与 v 相反）', value: Math.abs(state.f), unit: 'N', latex: 'F' },
  { key: 'a', label: '加速度', value: state.a, unit: 'm/s²', latex: 'a' },
  { key: 'P', label: '电功率', value: state.p, unit: 'W', latex: 'P' },
  { key: 'tau', label: '衰减时间常数', value: context.tau, unit: 's', latex: '\\tau' }
];`,
  },
};
