/**
 * §19.5 回归题 02 · 斜面 → 圆弧 → 平抛（多阶段连续）
 *
 * 考什么：多阶段连续（C6 的边界位置连续性 / C10 的物理合理性）
 *
 * ── 圆弧的相切条件（本文件的核心推导，其余题目不需要） ─────────────────────────
 * 设坡角 θ、半径 R。要求：(a) 入口与斜面**严格相切**；(b) 出口切线**水平**（衔接平抛）；
 * (c) 全程不穿地。取 ψ 为「圆心 → 滑块」的方向角，位置 P(ψ) = C + R(sinψ, cosψ)，
 * 滑块沿 ψ **递减**方向运动，故速度方向为 −(cosψ, −sinψ) = (−cosψ, +sinψ)。
 *   入口相切：(−cosψ_in, sinψ_in) = (cosθ, −sinθ) ⇒ ψ_in = 180° + θ；
 *   出口水平：(−cosψ_out, sinψ_out) = (1, 0)      ⇒ ψ_out = 180°（弧底）。
 * 圆心由「入口半径 ⊥ 斜面、且落在运动的**左侧**」唯一确定：
 *   C = B + R·(cos(90°−θ), sin(90°−θ)) = (x_B + R·sinθ, y_B + R·cosθ)。
 * 于是出口 x_E = x_B + R·sinθ、出口高度 h = y_E = y_B − R·(1 − cosθ)、圆弧落差 = R(1 − cosθ)
 * （这正是能量式 v₂² = v₁² + 2g·R(1 − cosθ) 的几何含义）。
 * 代 θ = 60°、R = 0.60 m、y_B = 1.20 m ⇒ C = (2.0196, 1.5000)、h = 0.9000 m、v₂ = 7.6132 m/s。
 * 注意：弧底比坡脚**必然**低 R(1 − cosθ)，这是「相切 + 水平出口」的几何结论，不是画错；
 * 只要 h > 0 就不穿地（本题 0.9 > 0）。θ = 30° 时该落差为 R(1 − cos30°) = 0.080 m，同样成立。
 *
 * 几何（地面 y = 0；滑块按质点做物理，画成 0.30×0.20 的小方框、沿轨道法向抬起半个厚度）：
 *   · 斜面段：A = (0, 3.798) → B = (1.500, 1.200)，θ = 60°、L = 3.0 m，a₁ = g·sinθ；
 *   · 圆弧段：C = (2.0196, 1.5000)，R = 0.60，ψ: 240° → 180°（弧长 0.628 m）；
 *   · 平抛段：从出口 (2.0196, 0.9000) 以 (v₂, 0) 水平抛出，落到 y = 0（射程 3.230 m）。
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 相切、半径、水平出口、落差、能量各由**方程**给出并自检为 0：
 *      `tangentErr`、`radiusErr`、`exitTangentErr`、`exitHeightErr`、`energyErr`；
 *   2. 圆弧段用角度参数化，ds = R·dψ、v(ψ) 由能量式给出，时间积分成**查表**，
 *      stateAt 只做二分查找 + 线性插值（O(log n)，n 固定）；
 *   3. 速度按切线方向分解 vx = −v·cosψ、vy = +v·sinψ（ψ 递减），加速度分解为切向 + 法向；
 *   4. 平抛段是抛物线，落地时刻由 y=0 解出，落地后位置冻结（不再下坠）。
 *
 * 跨槽位注记：setup 用 RETURN 导出派生量；导出键名不得与 STEPS 字段同名（t0/t1/title/tex）。
 * 只读探针 `context.at(t)` 仅允许在 drawFrame 里用（画全程轨迹），C1 会拦 stateAt 里的调用。
 */

export default {
  id: 'q02-incline-arc-projectile',
  index: 2,
  title: '斜面→圆弧→平抛',
  examPoint: '多阶段连续（C6）',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`如图，光滑斜面倾角 $\theta=60^\circ$、斜边长 $L=3.0\ \mathrm{m}$，其下端与一小段半径 $R=0.60\ \mathrm{m}$ 的**圆弧**在 $B$ 点平滑相切，圆弧末端切线水平，滑块从该处开始做平抛运动落到水平地面上，出口距地面的高度为 $h$。质量 $m$ 的滑块自斜面顶端由静止下滑，取 $g=10\ \mathrm{m/s^2}$，不计一切阻力。

求：(1) 滑块到达圆弧末端（即将开始平抛）时的速度大小 $v_2$；(2) 出口高度 $h$；(3) 平抛的水平射程 $\Delta x$。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔
title: 第 1 步 · 斜面段：光滑斜面，由静止匀加速下滑
tex: a_1=g\sin\theta=8.660\ \mathrm{m/s^2},\quad v_1=\sqrt{2a_1L}=7.208\ \mathrm{m/s},\quad \tau_1=\frac{v_1}{a_1}=0.832\ \mathrm{s}
t0: 0
t1: 0.4

title: 第 2 步 · 相切定圆心：入口半径 ⟂ 斜面，出口切线水平
tex: \psi_{in}=180^\circ+\theta,\qquad \psi_{out}=180^\circ,\qquad C=\left(x_B+R\sin\theta,\ y_B+R\cos\theta\right)=(2.020,\ 1.500)\ \mathrm{m}
t0: 0.4
t1: 0.7

title: 第 3 步 · 圆弧段：能量式给出 v(ψ)，再对 ds/v 积分求时间
tex: v(\psi)=\sqrt{v_1^{2}+2g\,(y_B-y(\psi))},\quad \tau_{arc}=\int_{180^\circ}^{240^\circ}\frac{R\,d\psi}{v(\psi)}=0.084\ \mathrm{s}
t0: 0.7
t1: 0.9

title: 第 4 步 · 圆弧末端：速度恰好水平，出口高度由几何给出
tex: v_2=\sqrt{v_1^{2}+2gR(1-\cos\theta)}=7.613\ \mathrm{m/s},\quad h=y_B-R(1-\cos\theta)=0.900\ \mathrm{m}
t0: 0.9
t1: 0.95

title: 第 5 步 · 平抛段：抛物线落地
tex: h=\frac{1}{2}g\tau^{2}\ \Rightarrow\ \tau=\sqrt{\frac{2h}{g}}=0.424\ \mathrm{s},\qquad \Delta x=v_2\tau=3.230\ \mathrm{m}
t0: 0.95
t1: 1.341`,

    ANSWERS: String.raw`symbol: v2
value: 7.6132
unit: m/s
tol: 0.01
at_t: 0.92
step: 4

symbol: h
value: 0.9
unit: m
tol: 0.01
at_t: 0.92
step: 4

symbol: dx
value: 3.23
unit: m
tol: 0.01
at_t: 1.341
step: 5

symbol: v1
value: 7.2084
unit: m/s
tol: 0.01
at_t: 0.3
step: 1

symbol: tau1
value: 0.8324
unit: s
tol: 0.01
at_t: 0.3
step: 1`,

    VIEW: String.raw`SIM = {
  duration: 1.341,
  /* v1.1.9：滑块质心（沿轨道法向偏移半个厚度，与 drawFrame 的 ball 同一处） */
  bodies: [
    { id: 'block', at: (s) => [s.x + s.nx * s.rOff, s.y + s.ny * s.rOff] }
  ],
  /* 圆弧→平抛 的真实切换在 tArc≈0.916，**不在** STEPS 边界（0.9/0.95）上。
     写成函数：VIEW 先于 setup 执行，引用 context 的表达式要到调用时才求值。 */
  phases: () => [
    { t0: 0, t1: context.tau1 },
    { t0: context.tau1, t1: context.tau1 + context.tauArc },
    { t0: context.tau1 + context.tauArc, t1: SIM.duration }
  ],
  continuityKeys: ['x', 'y'],
  /* C10 扩展：各阶段的物理合法区域（q02 的三段边界最容易写错）
     圆弧段由「圆心 C=(2.0196, 1.5)、R=0.6、ψ∈[180°,240°]」定界：
       x = 2.0196 + 0.6·sinψ ∈ [1.500, 2.0196]；y = 1.5 + 0.6·cosψ ∈ [0.900, 1.200] */
  regions: [
    { phase: 1, label: '斜面段', y: [1.199, 3.799], x: [-0.001, 1.501] },
    { phase: 2, label: '圆弧段', y: [0.899, 1.201], x: [1.499, 2.021], insideCircle: [2.0196152423, 1.5, 0.6] },
    { phase: 3, label: '平抛段', y: [0.0, 0.901], x: [2.019, 5.251] }
  ],
  axes: [
    { key: 'v', label: 'v', unit: 'm/s' },
    { key: 'h', label: 'h', unit: 'm' },
    { key: 'sProj', label: 'Δx 平抛', unit: 'm' }
  ]
};`,

    setup: String.raw`var g = 10.0;
var thDeg = 60.0;
var th = thDeg * Math.PI / 180;
var sinT = Math.sin(th);
var cosT = Math.cos(th);
var L = 3.0;
var R = 0.60;
var mBall = 1.0;   /* 题面为"质量 m 的滑块"未给定数值；取 1 kg 只为把受力箭头画成有比例的示意 */

/* ① 斜面：顶端 A(0, yA) 由静止下滑到 B */
var a1 = g * sinT;
var v1 = Math.sqrt(2 * a1 * L);
var tau1 = v1 / a1;
var bx = L * cosT;
var yB = 1.20;                      /* 坡底抬高 1.2 m，给圆弧与平抛留出高度 */
var ayA = yB + L * sinT;            /* 斜面顶端高度 */

/* ② 圆弧：入口相切 + 出口切线水平 ⇒ 圆心唯一
    位置 P(ψ) = C + R(sinψ, cosψ)，滑块沿 ψ **递减**方向走，速度方向 = (−cosψ, +sinψ)。
     (1) 入口相切 ⇒ (−cosψ_in, sinψ_in) = (cosθ, −sinθ) ⇒ ψ_in = 180° + θ = 240°；
     (2) 出口水平 ⇒ (−cosψ_out, sinψ_out) = (1, 0)      ⇒ ψ_out = 180°（弧底）；
     (3) 圆心 = 入口沿运动左侧偏 R：C = (x_B + R·sinθ, y_B + R·cosθ) = (2.0196, 1.5000)。
    出口高度 h = y_B − R(1 − cosθ) = 0.900 m（弧底必然比坡脚低 R(1 − cosθ)，h > 0 即不穿地）。 */
var psiIn = Math.PI + th;
var psiOut = Math.PI;
var cx = bx + R * sinT;
var cy = yB + R * cosT;
var xExit = cx + R * Math.sin(psiOut);
var yExit = cy + R * Math.cos(psiOut);
var h = yExit;                      /* 出口距地面（y = 0）的高度 = yB − R(1 − cosθ) */

/* 能量式：B → 出口的落差为 R(1 − cosθ)（θ=60° 时恰为 R/2 = 0.3 m） */
var v2 = Math.sqrt(v1 * v1 + 2 * g * R * (1 - cosT));
var tau2 = Math.sqrt(2 * h / g);
var dx = v2 * tau2;

/* 圆弧段时间 τ(ψ) = ∫ R dψ / v(ψ)（ψ 从 ψ_in = 240° 减到 ψ_out = 180°，与运动方向一致），
   按固定步数积成查表；stateAt 只做二分查找 + 线性插值。 */
var arcSteps = 256;
var psiTable = { psi: [], tau: [] };
var acc = 0;
psiTable.psi.push(psiIn);
psiTable.tau.push(0);
for (var i = 0; i < arcSteps; i += 1) {
  var pA = psiIn + (psiOut - psiIn) * i / arcSteps;
  var pB = psiIn + (psiOut - psiIn) * (i + 1) / arcSteps;
  var pM = 0.5 * (pA + pB);
  var yM = cy + R * Math.cos(pM);
  var vM = Math.sqrt(v1 * v1 + 2 * g * (yB - yM));
  acc = acc + R * Math.abs(pB - pA) / vM;
  psiTable.psi.push(pB);
  psiTable.tau.push(acc);
}
var tauArc = acc;

/* ③ 自检（应全部为 0）：入口切向与斜面方向一致、|CB| = R、出口切向水平、出口高度与能量守恒 */
var tangentErr = Math.abs(-Math.cos(psiIn) - cosT) + Math.abs(Math.sin(psiIn) + sinT);
var radiusErr = Math.abs(Math.hypot(cx - bx, cy - yB) - R);
var exitTangentErr = Math.abs(-Math.cos(psiOut) - 1.0);
var exitHeightErr = Math.abs((yB - yExit) - R * (1 - cosT));
var energyErr = Math.abs(v2 * v2 - (v1 * v1 + 2 * g * (yB - yExit)));

RETURN('g', g);
RETURN('thDeg', thDeg);
RETURN('th', th);
RETURN('sinT', sinT);
RETURN('cosT', cosT);
RETURN('L', L);
RETURN('R', R);
RETURN('mBall', mBall);
RETURN('a1', a1);
RETURN('v1', v1);
RETURN('tau1', tau1);
RETURN('bx', bx);
RETURN('yB', yB);
RETURN('ayA', ayA);
RETURN('psiIn', psiIn);
RETURN('psiOut', psiOut);
RETURN('cx', cx);
RETURN('cy', cy);
RETURN('xExit', xExit);
RETURN('yExit', yExit);
RETURN('v2', v2);
RETURN('h', h);
RETURN('tau2', tau2);
RETURN('tauArc', tauArc);
RETURN('psiTable', psiTable);
RETURN('dx', dx);
RETURN('tangentErr', tangentErr);
RETURN('radiusErr', radiusErr);
RETURN('exitTangentErr', exitTangentErr);
RETURN('exitHeightErr', exitHeightErr);
RETURN('energyErr', energyErr);`,

    stateAt: String.raw`var tt = Math.min(Math.max(t, 0), SIM.duration);
var tRamp = context.tau1;
var tArc = tRamp + context.tauArc;

var phase = 1;
var x = 0, y = context.ayA, vx = 0, vy = 0, v = 0, sProj = 0;
var ax = 0, ay = 0, psi = 0;
/* 斜面外侧法向 = (sinθ, cosθ)：斜面**向右下**倾斜，故朝上的一侧偏右（不是 (−sinθ, cosθ)，
   那个方向指向楔形内部，画出来滑块会陷进斜面里）。它同时是圆弧入口处的法向，两端连续。 */
var nx = context.sinT, ny = context.cosT;
var fN = context.mBall * context.g * context.cosT;

if (tt <= tRamp) {
  /* ① 斜面：自左上向右下滑动 */
  var s = 0.5 * context.a1 * tt * tt;
  x = s * context.cosT;
  y = context.ayA - s * context.sinT;
  v = context.a1 * tt;
  vx = v * context.cosT;
  vy = -v * context.sinT;
  ax = context.a1 * context.cosT;
  ay = -context.a1 * context.sinT;
} else if (tt <= tArc) {
  /* ② 圆弧：ψ 由 240° **减到** 180°（弧底）。查表取 ψ（O(log n)，n 固定） */
  phase = 2;
  var tab = context.psiTable;
  var n = tab.psi.length - 1;
  var tau = tt - tRamp;
  var lo = 0, hi = n;
  if (tau >= tab.tau[n]) lo = n - 1; else while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (tab.tau[mid] <= tau) lo = mid; else hi = mid; }
  var span = tab.tau[lo + 1] - tab.tau[lo];
  psi = tab.psi[lo] + (tab.psi[lo + 1] - tab.psi[lo]) * (span > 0 ? Math.min(1, (tau - tab.tau[lo]) / span) : 1);
  x = context.cx + context.R * Math.sin(psi);
  y = context.cy + context.R * Math.cos(psi);
  v = Math.sqrt(context.v1 * context.v1 + 2 * context.g * (context.yB - y));
  /* ψ 递减 ⇒ ê = (−cosψ, +sinψ)：ψ=240° 时 = (0.5, −0.866) 与斜面出口一致，ψ=180° 时 = (1, 0) 水平 */
  vx = -v * Math.cos(psi);
  vy = v * Math.sin(psi);
  /* 分解 a = a_t·ê + a_n·n̂，n̂ = (−sinψ, −cosψ) 指向圆心（凹侧 = 滑块所在侧）；a_t = ê·ĝ = −g·sinψ */
  var ex2 = -Math.cos(psi), ey2 = Math.sin(psi);
  var nxc = -Math.sin(psi), nyc = -Math.cos(psi);
  var aTan = -context.g * ey2;
  var aNorm = (v * v) / context.R;
  ax = aTan * ex2 + aNorm * nxc;
  ay = aTan * ey2 + aNorm * nyc;
  nx = nxc; ny = nyc;
  /* 沿 n̂ 投影：N − m·g·cosψ = m·v²/R ⇒ N = m(v²/R − g·cosψ)（θ=60° 时 cosψ<0，N 很大） */
  fN = context.mBall * (aNorm - context.g * Math.cos(psi));
} else {
  /* ③ 平抛：水平初速 v₂；落地后位置冻结 */
  phase = 3;
  var tp = Math.min(tt - tArc, context.tau2);
  sProj = context.v2 * tp;
  x = context.xExit + sProj;
  y = context.yExit - 0.5 * context.g * tp * tp;
  vx = context.v2;
  vy = -context.g * tp;
  v = Math.sqrt(vx * vx + vy * vy);
  ay = -context.g;
  nx = 0;
  ny = 1;
  fN = 0;
  if (y <= 0) { y = 0; sProj = context.dx; x = context.xExit + context.dx; vy = 0; v = context.v2; }
}

return {
  t: tt, x: x, y: y, vx: vx, vy: vy, v: v, ax: ax, ay: ay, psi: psi,
  /* 轨道切向角（弧度）：画"滑块"方框时按它转正。t=0 时 v=0，atan2 无意义，故按阶段给出：
     斜面段取 −θ，圆弧段取 180°−ψ（ψ 递减 ⇒ 由 −60° 到 0°），平抛段取 atan2(vy, vx) */
  tAng: phase === 1 ? -context.th : (phase === 2 ? Math.PI - psi : Math.atan2(vy, vx)),
  h: y, phase: phase, sProj: sProj, nx: nx, ny: ny, rOff: 0.10, fNormal: fN,
  vFloor: context.v2, hExit: context.h, v1: context.v1, tau1: context.tau1, dx: context.dx
};`,

    drawFrame: String.raw`var axA = 0.0;
var ayA = context.ayA;
var bx = context.bx;

Draw.ground(-0.4, context.xExit + context.dx + 1.1, 0, { color: '#2b3440' });
/* 斜面三角形体自带 "belowBase" 阴影线（最长边 = 坡面，向体内打线）；地面阴影来自 Draw.ground */
Draw.incline([axA, ayA], { angleDeg: context.thDeg, length: context.L, base: [bx, 0] });

/* 圆弧：ψ 由 240°（与斜面在 B 点相切）减到 180°（弧底，切向水平） */
var arcPts = [];
for (var i = 0; i <= 56; i = i + 1) { var pp = context.psiIn + (context.psiOut - context.psiIn) * i / 56; arcPts.push([context.cx + context.R * Math.sin(pp), context.cy + context.R * Math.cos(pp)]); }
Draw.curve(arcPts, { color: '#2b3440', width: 1.8 });
Draw.circle([context.cx, context.cy], 0.045, { fill: '#5d6b7a', stroke: '#5d6b7a' });
Draw.line([context.cx, context.cy], [context.cx + context.R * Math.sin(context.psiIn), context.cy + context.R * Math.cos(context.psiIn)], { dash: true, color: '#9aa7b4', width: 1.0 });
/* 半径虚线（C → 弧上入口点）+ 标注：放在圆心右上方，避免压到斜面与轨迹 */

/* 全程轨迹（虚线）：用只读探针 context.at(t) 采样，不是模型声明的轨迹。
   注意 at() 只允许在 drawFrame 里用——stateAt 里用会变成"每帧重算全时段"，C1 会拦。 */
var tracePts = [];
for (var ti = 0; ti <= 72; ti = ti + 1) { var ts = SIM.duration * ti / 72; var ss = context.at(ts); tracePts.push([ss.x + ss.nx * ss.rOff, ss.y + ss.ny * ss.rOff]); }
Draw.trace(tracePts, { color: '#c8d0d8', dash: true, width: 1.2, layer: 0 });

/* 滑块（题面为"质量 m 的滑块"，所以画方框而不是小球）：沿**法向**偏移半个厚度贴合轨道，
   方框按轨道切向角转正。三类箭头都以滑块质心为起点（§A.2）。 */
var ball = [state.x + state.nx * state.rOff, state.y + state.ny * state.rOff];
Draw.box(ball, 0.30, 0.20, { angleDeg: state.tAng * 180 / Math.PI, fill: '#2a6f8f', stroke: '#1d2733' });

/* 速度：切向分解，虚线补齐矩形。
   v 箭头本身由 bodies 自动生成；这里只画两个**分量**（aux，紫）。 */
Draw.arrow(ball, [state.vx * 0.16, 0], { category: 'aux', subtype: 'component', label: 'vx', mag: Math.abs(state.vx), labelInset: -13 });
Draw.arrow(ball, [0, state.vy * 0.16], { category: 'aux', subtype: 'component', label: 'vy', mag: Math.abs(state.vy) });
Draw.line([ball[0] + state.vx * 0.16, ball[1]], [ball[0] + state.vx * 0.16, ball[1] + state.vy * 0.16], { dash: true, color: '#c8d0d8', width: 1.0 });
Draw.line([ball[0], ball[1] + state.vy * 0.16], [ball[0] + state.vx * 0.16, ball[1] + state.vy * 0.16], { dash: true, color: '#c8d0d8', width: 1.0 });

/* 加速度不在这里画：圆弧段的向心项 v²/R ≈ 87 m/s² 由运行时求导得到，比例尺也交给系统归一。 */

/* 受力：重力（竖直向下）+ 支持力（沿法向，斜面段与圆弧段都存在；平抛段为 0）——都从质心出发 */
Draw.arrow(ball, [0, -0.30], { category: 'force', subtype: 'gravity', label: 'mg', mag: context.mBall * context.g, labelInset: -13 });
if (state.phase < 3 && state.fNormal > 0) {
  var fScale = state.phase === 1 ? 0.022 : 0.0032;
  Draw.arrow(ball, [state.nx * state.fNormal * fScale, state.ny * state.fNormal * fScale], {
    category: 'force', subtype: 'normal', label: 'F_N', mag: state.fNormal
  });
}

Draw.line([bx, 0], [bx, context.ayA], { dash: true, color: '#c8d0d8', width: 1.0 });
/* θ 角标：在 B 点用世界坐标折线画 120°→180° 的扇形（不用 Draw.arc，避免角度约定歧义） */
var wedge = [];
for (var wi = 0; wi <= 12; wi = wi + 1) {
  var wphi = ((180 - context.thDeg) + context.thDeg * wi / 12) * Math.PI / 180;
  wedge.push([bx + 0.34 * Math.cos(wphi), context.yB + 0.34 * Math.sin(wphi)]);
}
Draw.curve(wedge, { color: '#a4610d', width: 1.2 });

if (state.phase === 3) {
  Draw.line([context.xExit, 0.03], [state.x, 0.03], { color: '#a4610d', width: 1.4 });
}
Draw.line([context.xExit, 0], [context.xExit, context.yExit], { dash: true, color: '#9aa7b4', width: 1.0 });

var labels = ['斜面段', '圆弧段', '平抛段'];
/* 说明文字放在右下方空区（弹道下方、地面上方），避免与左侧斜面/圆弧和右侧射程标注重叠 */
var tx0 = 3.30;
`,

    readouts: String.raw`return [
  { key: 'v', label: '速率', value: state.v, unit: 'm/s', latex: 'v' },
  { key: 'x', label: '水平位置', value: state.x, unit: 'm', latex: 'x' },
  { key: 'y', label: '高度', value: state.y, unit: 'm', latex: 'y' },
  { key: 'h', label: '出口高度 h', value: context.h, unit: 'm', latex: 'h' },
  { key: 'v2', label: '圆弧出口速度', value: context.v2, unit: 'm/s', latex: 'v_2' },
  { key: 'v1', label: '斜面底端速度', value: context.v1, unit: 'm/s', latex: 'v_1' },
  { key: 'tau1', label: '斜面段时间', value: context.tau1, unit: 's', latex: '\\tau_1' },
  { key: 'sProj', label: '平抛水平射程', value: state.sProj, unit: 'm', latex: '\\Delta x' },
  { key: 'dx', label: '落地射程（终值）', value: context.dx, unit: 'm', latex: '\\Delta x_{max}' }
];`,
  },
};
