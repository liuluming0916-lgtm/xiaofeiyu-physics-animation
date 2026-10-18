/**
 * §19.5 回归题 09 · 电容充电暂态（非力学 stateAt）
 *
 * 考什么：非力学 stateAt —— 状态量不是位置/速度，而是电路暂态量（RC 充电）
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 时间常数 τ=RC 由代码算出，不写死 —— setup 里 tau = R*C，readouts 直接给出 τ；
 *   2. 非力学量走解析式：u_C(t)=U(1-e^{-t/τ})、i(t)=(U/R)e^{-t/τ}，stateAt 为 O(1) 纯解析；
 *   3. 状态里的 x/y 是**电路上"电流指示点"沿回路走过的弧长**对应的几何位置（米），
 *      使 C6 的位置连续性有承载分量；弧长 s = 充电进度 × 回路周长，也是 O(1) 分段解析；
 *   4. 电流方向由 state.cur 的符号算出，回路四个边的箭头方向都随它翻转，不写死。
 *
 * 绘图注记：Draw.arrow 统一传**几何矢量**（物理量 × 几何缩放）并置 scale=1，
 * 物理量用 opts.mag/unit 记录 —— 因为 §4.6 的命令包络把 vec 原样当长度（不乘 scale），
 * 传物理量会让包络虚胖、AutoView 把画面缩小（见报告）。
 *
 * 跨槽位注记：setup 用 RETURN(key, value) 导出派生量，其余槽位从 context 读取。
 */

export default {
  id: 'q09-capacitor-rod-transient',
  index: 9,
  title: '电容充电暂态',
  examPoint: '非力学 stateAt（RC 暂态）',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`如图电路：电源电动势 $U=12\ \mathrm{V}$（内阻不计），定值电阻 $R=1000\ \Omega$，电容 $C=1000\ \mu\mathrm{F}$，电容初始不带电。$t=0$ 时接通电源，电容由零开始充电。

求：(1) 该电路的时间常数 $\tau=RC$；(2) 充电电流 $i(t)$ 与电容电压 $u_C(t)$ 的表达式；(3) $t=1.0\ \mathrm{s}$ 时的电容电压 $u_C$ 与充电电流 $i$；(4) $t=3.0\ \mathrm{s}$ 时电容已充到多少伏。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔；字段 title / tex / t0 / t1
title: 第 1 步 · 时间常数由元件参数算出
tex: \tau=RC=1000\ \Omega\times 1000\ \mu\mathrm{F}=1.0\ \mathrm{s}
t0: 0
t1: 1.0

title: 第 2 步 · 充电电流：由 U/R 按指数衰减
tex: i(t)=\frac{U}{R}e^{-t/\tau},\qquad i(0)=\frac{12}{1000}=12\ \mathrm{mA}
t0: 1.0
t1: 2.0

title: 第 3 步 · 电容电压：按指数上升趋于 U
tex: u_C(t)=U\left(1-e^{-t/\tau}\right),\qquad u_R(t)=U-u_C(t)=Ue^{-t/\tau}
t0: 2.0
t1: 3.0

title: 第 4 步 · 代入求值
tex: u_C(1.0)=7.585\ \mathrm{V},\ i(1.0)=4.415\ \mathrm{mA};\qquad u_C(3.0)=0.9502U=11.403\ \mathrm{V}
t0: 3.0
t1: 4.0`,

    ANSWERS: String.raw`symbol: tau
value: 1.0
unit: s
tol: 0.01
at_t: 1.0
step: 1

symbol: uC
value: 7.5854
unit: V
tol: 0.01
at_t: 1.0
step: 4

symbol: i
value: 4.4146
unit: mA
tol: 0.01
at_t: 1.0
step: 4

symbol: uC
value: 11.4026
unit: V
tol: 0.01
at_t: 3.0
step: 4`,

    VIEW: `SIM = {
  duration: 4.0,
  axes: [
    { key: 'uC', label: 'u_C', unit: 'V' },
    { key: 'i', label: 'i', unit: 'mA' },
    { key: 'q', label: 'q', unit: 'mC' },
    { key: 'uR', label: 'u_R', unit: 'V' }
  ],
  continuityKeys: ['x', 'y']
};`,

    setup: `var U = 12.0;        // 电源电动势（V）
var R = 1000.0;      // 定值电阻（Ω）
var C = 1.0e-3;      // 电容 1000 μF = 1e-3 F
var w = 2.4;         // 回路矩形宽（几何量，米）
var h = 1.2;         // 回路矩形高（几何量，米）

var tau = R * C;                 // 时间常数 τ = RC = 1.0 s
var i0 = U / R;                  // 初始充电电流 = 12 mA（A）
var perim = 2 * (w + h);         // 回路周长（米）：电流指示点的行程总长
var uTau = U * (1 - Math.exp(-1)); // t = τ 时刻的电容电压（曲线的 63.2% 点）

RETURN('U', U);
RETURN('R', R);
RETURN('C', C);
RETURN('w', w);
RETURN('h', h);
RETURN('tau', tau);
RETURN('i0', i0);
RETURN('perim', perim);
RETURN('uTau', uTau);`,

    stateAt: `var tt = Math.min(Math.max(t, 0), SIM.duration);
var decay = Math.exp(-tt / context.tau);
var prog = 1 - decay;                          // 充电进度 = u_C / U
var uC = context.U * prog;                     // u_C(t) = U(1 - e^{-t/τ})
var cur = (context.U / context.R) * decay;     // i(t) = (U/R) e^{-t/τ}

// 电流指示点沿回路走过的弧长 → 回路上的坐标（分段解析，O(1)）
var s = prog * context.perim;
var x, y;
if (s <= context.w) {
  x = s;
  y = context.h;
} else if (s <= context.w + context.h) {
  x = context.w;
  y = context.h - (s - context.w);
} else if (s <= 2 * context.w + context.h) {
  x = 2 * context.w + context.h - s;
  y = 0;
} else {
  x = 0;
  y = s - (2 * context.w + context.h);
}

return {
  t: tt,
  x: x,
  y: y,
  s: s,
  uC: uC,
  cur: cur,
  q: context.C * uC,
  uR: context.U - uC,
  prog: prog
};`,

    drawFrame: `var w = context.w, h = context.h;
var yM = h / 2;

// —— 回路导线（矩形）——
Draw.line([0, 0], [w, 0], { width: 2 });
Draw.line([0, h], [w, h], { width: 2 });
Draw.line([0, 0], [0, h], { width: 2 });
Draw.line([w, 0], [w, h], { width: 2 });

// —— 电池 U（左边）——
Draw.box([0, yM], 0.22, 0.46, { fill: '#ffffff' });
Draw.text(0, yM, 'U', { size: 13 });
Draw.text(-0.16, h - 0.16, '＋', { size: 12, color: '#b3382f', align: 'right' });

// —— 电阻 R（上边）——
Draw.box([w * 0.5, h], 0.52, 0.20, { fill: '#ffffff' });
Draw.text(w * 0.5, h, 'R', { size: 13 });

// —— 电容 C（右边）——
Draw.box([w, yM], 0.24, 0.42, { fill: '#ffffff' });
Draw.text(w, yM, 'C', { size: 13 });

// —— 电流方向：由 state.cur 的符号算出，回路四边一起翻转 ——
var sgn = state.cur > 1e-12 ? 1 : (state.cur < -1e-12 ? -1 : 0);
if (sgn !== 0) {
  // 回路的四条边都是"同一个电流"，所以 mag 用同一个表达式 ⇒ 四根箭头**必然一样长**
  Draw.arrow([w * 0.28, h + 0.20], [sgn * 0.5, 0], { category: 'aux', mag: Math.abs(state.cur) * 1000, unit: 'mA' });
  Draw.arrow([w + 0.20, h * 0.26], [0, -sgn * 0.5], { category: 'aux', mag: Math.abs(state.cur) * 1000, unit: 'mA' });
  Draw.arrow([w * 0.64, -0.20], [-sgn * 0.5, 0], { category: 'aux', mag: Math.abs(state.cur) * 1000, unit: 'mA' });
  Draw.arrow([-0.20, h * 0.74], [0, sgn * 0.5], { category: 'aux', mag: Math.abs(state.cur) * 1000, unit: 'mA' });
}

// —— 全程轨迹（点划虚线）：电流指示点沿回路的行进路线。它与回路导线完全重合，
//    所以用点线（dash [2,6]）画在导线**之上**，既能看见又不像重复描边。——
Draw.trace([[0, 0], [w, 0], [w, h], [0, h], [0, 0]], { color: '#c8d0d8', dash: [2, 6], width: 2.0, layer: 0 });

// —— 电流指示点：沿回路走过的弧长就是充电进度 ——
Draw.circle([state.x, state.y], 0.075, { fill: '#1f6fb2', stroke: '#ffffff', width: 1.2 });
Draw.text(state.x + 0.14, state.y + 0.20, '指示点', { size: 11, color: '#1f6fb2', align: 'left' });

// —— 元件上的实时读数 ——
Draw.text(w * 0.5, h + 0.58, 'u_C = ' + Phys.format(state.uC, 'V', 3), { size: 12 });
Draw.text(w * 0.5, h + 0.36, 'i = ' + Phys.format(state.cur * 1000, 'mA', 3), { size: 12 });

/* 曲线图已移交模板页的图表面板（§13.4：横轴 t、游标与画布同一个 t、可切量/可隐藏）。
   原手绘代码留档在「软件自研v1开发历史.md 附录 B（原快照已清理）」，第 7.1 期按新方式重画。 */`,

    readouts: `return [
  { key: 'uC', label: '电容电压', value: state.uC, unit: 'V', latex: 'u_C' },
  { key: 'i', label: '充电电流', value: state.cur * 1000, unit: 'mA', latex: 'i' },
  { key: 'q', label: '电容电荷量', value: state.q * 1000, unit: 'mC', latex: 'q' },
  { key: 'uR', label: '电阻电压', value: state.uR, unit: 'V', latex: 'u_R' },
  { key: 'tau', label: '时间常数', value: context.tau, unit: 's', latex: '\\tau' },
  { key: 'prog', label: '充电进度', value: 100 * state.prog, unit: '%', latex: 'u_C/U' },
  { key: 's', label: '指示点行程', value: state.s, unit: 'm', latex: 's' }
];`,
  },
};
