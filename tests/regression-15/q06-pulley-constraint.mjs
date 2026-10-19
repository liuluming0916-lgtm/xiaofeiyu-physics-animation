/**
 * §19.5 回归题 06 · 绳-滑轮连接体
 *
 * 考什么：几何约束（绳长不变 ⇒ 两端加速度大小相同）
 *
 * ── 方向（这一题最容易画错，先把结论写死） ────────────────────────────────────
 * m₂ = 1.5 kg 竖直悬挂、m₁ = 1.0 kg 在 30° 斜面上：m₂g = 15 N > m₁g·sin30° = 5 N，
 * 所以 **m₂ 向下加速、m₁ 沿斜面向上（朝滑轮）加速**，a = (15 − 5)/2.5 = 4.0 m/s²。
 * 位移、速度箭头、加速度箭头三者的方向必须全部由这个结论推出来，不能各自写死：
 *   · m₁ 的位移沿面向上 ⇒ 世界位移 (+s·cosθ, +s·sinθ)；
 *   · m₂ 的位移竖直向下 ⇒ y₂ = apexY − hangLen − 0.15 随 s 减小。
 * （旧版本把两处位移都写成了反向：m₁ 滑离滑轮、m₂ 往上升——画面上就是"绳拉反了"。）
 *
 * ── 绳长约束（用弦长而不是近似） ────────────────────────────────────────────
 * 绳的斜面段不是"物块中心到滑轮圆心"，而是到**滑轮切点**：切点 P = 圆心 − r·n̂（n̂ 为斜面外法向）。
 * 于是斜面段绳长 = |P − 物块中心| = √((d − s)² + r²)，其中 d 是物块中心到"圆心在斜面上的投影"的距离。
 * 悬挂段 = L₀ − √((d − s)² + r²)。取 d = √(1.00² − r²)、悬挂初值 0.60 ⇒ L₀ = 1.60 m 恒定，
 * readouts 直接给出漂移量（应恒为 0），C10 也用 `ropeDrift` 把"绳长不变"钉在门禁里。
 *
 * ── 时长与尺度 ─────────────────────────────────────────────────────────────
 * a = 4 m/s² 时 s(0.5 s) = 0.50 m，动画正好在提问时刻收束。旧版本 duration = 2.5 s ⇒ s 末值 12.5 m，
 * 物块滑出斜面、悬挂物穿过滑轮（画面上"绳穿过轮子、物体飞上天"）。
 * 现在 duration = 0.5 s，全程都在场景里：m₁ 距滑轮 0.99 → 0.49 m，
 * m₂ 从 0.60 m 降到 1.09 m，既不越过滑轮也不穿地。
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 绳长不变：两个物块共用同一个 `a`，readouts 给出 L₁+L₂ 与漂移量（应为 0）；
 *   2. 同一 T：readouts 同时给出 m₂g − T 与 T − m₁g·sinθ，两式都等于 m·a；
 *   3. 方向由符号算出：位移/速度/加速度箭头全部沿"m₁ 向上、m₂ 向下"；
 *   4. 斜面几何约束体现在运动学上：沿面位移与悬挂位移相等（同一个 `s`）。
 */

export default {
  id: 'q06-pulley-constraint',
  index: 6,
  title: '绳-滑轮连接体',
  examPoint: '几何约束',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`如图，光滑固定斜面的倾角 $\theta=30^\circ$，质量 $m_1=1.0\ \mathrm{kg}$ 的物块置于斜面上，用不可伸长的轻绳跨过斜面顶端的光滑定滑轮与质量 $m_2=1.5\ \mathrm{kg}$ 的物块相连，$m_2$ 竖直悬挂。系统从静止释放，取 $g=10\ \mathrm{m/s^2}$。

求：(1) 系统的加速度大小 $a$；(2) 绳中张力 $T$；(3) $t=0.5\ \mathrm{s}$ 时两物块的速度 $v$ 与各自的位移 $s$。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔
title: 第 1 步 · 绳不可伸长 ⇒ 两端加速度大小相同
tex: \text{绳长恒定}\ \Rightarrow\ |a_1|=|a_2|=a,\quad |s_1|=|s_2|=s
t0: 0
t1: 0.1

title: 第 2 步 · 先判方向：m₂g = 15 N > m₁g·sin30° = 5 N
tex: m_2g>m_1g\sin\theta\ \Rightarrow\ m_2\ \text{向下、}\ m_1\ \text{沿斜面向上}
t0: 0.1
t1: 0.2

title: 第 3 步 · 分别对两个物块列牛顿第二定律，联立消去张力
tex: m_2g-T=m_2a,\quad T-m_1g\sin\theta=m_1a\ \Rightarrow\ a=\frac{15-5}{2.5}=4.0\ \mathrm{m/s^2}
t0: 0.2
t1: 0.3

title: 第 4 步 · 回代求张力（两个方程必须给出同一个 T）
tex: T=m_2(g-a)=1.5\times6=9.0\ \mathrm{N},\qquad T=m_1(g\sin\theta+a)=1\times9=9.0\ \mathrm{N}
t0: 0.3
t1: 0.4

title: 第 5 步 · 从静止匀加速：运动学量
tex: v=at=4.0\times0.5=2.0\ \mathrm{m/s},\qquad s=\frac{1}{2}at^{2}=0.5\times4.0\times0.25=0.50\ \mathrm{m}
t0: 0.4
t1: 0.5`,

    ANSWERS: String.raw`symbol: a
value: 4.0
unit: m/s^2
tol: 0.01
at_t: 0.25
step: 3

symbol: T
value: 9.0
unit: N
tol: 0.01
at_t: 0.35
step: 4

symbol: v
value: 2.0
unit: m/s
tol: 0.01
at_t: 0.5
step: 5

symbol: s
value: 0.5
unit: m
tol: 0.01
at_t: 0.5
step: 5

symbol: ropeSum
value: 1.6
unit: m
tol: 0.001
at_t: 0.05
step: 1`,

    VIEW: String.raw`SIM = {
  duration: 0.5,
  continuityKeys: ['x', 'y', 'y2'],
  /* C10 扩展：把"绳长不变"和"不撞滑轮/不滑出斜面"写进门禁（未声明的题不检查） */
  regions: [
    { label: 'm₁ 始终留在斜面段上', x: [-0.88, -0.42], y: [1.39, 1.67] },
    { label: '沿面位移不越过滑轮', keys: ['s'], maxAbs: 0.51 },
    { label: '悬挂段不超过绳长', keys: ['hangLen'], maxAbs: 1.1 },
    { label: '绳长恒定（漂移量为 0）', keys: ['ropeDrift'], maxAbs: 1e-9 }
  ],
  axes: [
    { key: 'v', label: 'v', unit: 'm/s' },
    { key: 'T', label: 'T', unit: 'N' },
    { key: 's', label: 's', unit: 'm' }
  ]
};`,

    setup: String.raw`var g = 10.0;
var m1 = 1.0;
var m2 = 1.5;
var theta = 30.0;
var th = theta * Math.PI / 180;
var sinT = Math.sin(th);
var cosT = Math.cos(th);
/* 整体牛顿第二定律：m₂g − m₁g·sinθ = (m₁+m₂)a ⇒ a > 0 表示 m₂ 下降、m₁ 沿斜面上升 */
var a = (m2 * g - m1 * g * sinT) / (m1 + m2);
var T = m2 * (g - a);
var eqErr2 = Math.abs(m2 * (g - a) - T);
var eqErr1 = Math.abs(m1 * (g * sinT + a) - T);

/* 场景常量（stateAt 与 drawFrame 共用；stateAt 之所以需要，是为了直接给出世界坐标） */
var apexX = 0.0;
var apexY = 1.90;                 /* 滑轮圆心 = 斜面顶端高度 */
var rampLen = apexY / sinT;       /* 3.80 m：斜面正好从顶端落到地面 y = 0 */
var footX = apexX - rampLen * cosT;   /* 坡脚 (−3.29, 0) */
var rPulley = 0.11;
var d = Math.sqrt(1.0 - rPulley * rPulley);  /* 取 d 使"物块中心→切点"的初始弦长恰为 1.000 m */
var ropeHang0 = 0.60;
var ropeLen0 = 1.0 + ropeHang0;   /* = 1.60 m，全程不变（本题的几何约束） */
var blockH = 0.30;                /* 悬挂物边长（占位，画面上也用它） */

RETURN('g', g);
RETURN('m1', m1);
RETURN('m2', m2);
RETURN('theta', theta);
RETURN('th', th);
RETURN('sinT', sinT);
RETURN('cosT', cosT);
RETURN('a', a);
RETURN('T', T);
RETURN('eqErr1', eqErr1);
RETURN('eqErr2', eqErr2);
RETURN('apexX', apexX);
RETURN('apexY', apexY);
RETURN('rampLen', rampLen);
RETURN('footX', footX);
RETURN('rPulley', rPulley);
RETURN('d', d);
RETURN('ropeHang0', ropeHang0);
RETURN('ropeLen0', ropeLen0);
RETURN('blockH', blockH);
RETURN('vAt05', a * 0.5);
RETURN('sAt05', 0.5 * a * 0.25);`,

    stateAt: String.raw`var tt = Math.min(Math.max(t, 0), SIM.duration);
var s = 0.5 * context.a * tt * tt;       /* 沿面位移 = 悬挂位移（绳不可伸长） */
var v = context.a * tt;
var ux = context.cosT;
var uy = context.sinT;

/* 绳的斜面段：物块中心 → 滑轮切点，弦长（不是到圆心） */
var arm = context.d - s;                 /* 圆心在斜面上的投影到物块中心的距离 */
var ropeUp = Math.sqrt(arm * arm + context.rPulley * context.rPulley);
var hangLen = context.ropeLen0 - ropeUp; /* 悬挂段：滑轮圆心 → 悬挂物顶面 */
var ropeSum = ropeUp + hangLen;          /* 恒等于 ropeLen0（漂移量应恒为 0） */

return {
  t: tt,
  s: s,
  v: v,
  a: context.a,
  T: context.T,
  /* m₁ 的世界坐标：顶点沿斜面方向退回 arm（s 增大 ⇒ 朝滑轮移动） */
  x: context.apexX - arm * ux,
  y: context.apexY - arm * uy,
  /* m₂ 的世界坐标：在滑轮右侧竖直悬挂，s 增大 ⇒ 向下降 */
  x2: context.apexX + context.rPulley,
  y2: context.apexY - hangLen - context.blockH / 2,
  /* 位移分量（供 C6 检查位置连续、供 readouts 展示） */
  xA: s * ux,
  yA: s * uy,
  yB: -s,
  ropeUp: ropeUp,
  hangLen: hangLen,
  ropeSum: ropeSum,
  ropeDrift: ropeSum - context.ropeLen0,
  eq1: context.m1 * (context.g * context.sinT + context.a),
  eq2: context.m2 * (context.g - context.a),
  fN: context.m1 * context.g * context.cosT
};`,

    drawFrame: String.raw`var apexX = context.apexX;
var apexY = context.apexY;
var ux = context.cosT;
var uy = context.sinT;
var nxu = -context.sinT;          /* 斜面外法向（物块所在的一侧，朝左上） */
var nyu = context.cosT;
var rP = context.rPulley;
/* 滑轮切点：圆心沿外法向退 r（该点在斜面上的投影恰与圆心同高 ⇒ 绳与斜面严格平行） */
var tangent = [apexX - rP * nxu, apexY - rP * nyu];
var rightTangent = [apexX + rP, apexY];
/* 物块 m₁ 的**画出来**的中心：质心沿斜面外法向抬起半个厚度，否则半个方块会陷进斜面里。
   绳、箭头、标注全部锚在这一点上。 */
var blockC = [state.x + nxu * 0.13, state.y + nyu * 0.13];

/* 场景：斜面（顶部在右，坡脚在左下 ⇒ angleDeg 取负）+ 地面 */
Draw.incline([apexX, apexY], { angleDeg: -context.theta, length: context.rampLen, base: [apexX, 0] });
Draw.ground(context.footX - 0.50, apexX + 1.35, 0, { color: '#2b3440' });

/* 绳：物块 → 切点 → 绕过滑轮（包角 90°−θ = 60°，径向角从 −60° 扫到 0°）→ 右侧竖直向下 → 悬挂物顶面 */
Draw.line(blockC, tangent, { color: '#1d2733', width: 1.4 });
var wrapPts = [];
for (var i = 0; i <= 16; i = i + 1) {
  var phi = (context.theta - 90) * (1 - i / 16) * Math.PI / 180;
  wrapPts.push([apexX + rP * Math.cos(phi), apexY + rP * Math.sin(phi)]);
}
Draw.curve(wrapPts, { color: '#1d2733', width: 1.4 });
Draw.line(rightTangent, [state.x2, state.y2 + context.blockH / 2], { color: '#1d2733', width: 1.4 });
Draw.pulley([apexX, apexY], rP, { color: '#2b3440', hub: true });

/* 物块 m₁ 与悬挂物 m₂ */
/* 全程轨迹（浅灰虚线）：m₁ 沿斜面（按外法向抬起半个厚度，与画出来的方块一致）与 m₂ 的竖直下落路径。
   只读探针 context.at(t) 采样全时段；at() 只能在 drawFrame 里用（stateAt 里用 C1 会拦）。 */
var traceA = [];
var traceB = [];
for (var tq = 0; tq <= 32; tq = tq + 1) {
  var sq = context.at(SIM.duration * tq / 32);
  traceA.push([sq.x + nxu * 0.13, sq.y + nyu * 0.13]);
  traceB.push([sq.x2, sq.y2]);
}
Draw.trace(traceA, { color: '#c8d0d8', dash: true, width: 1.2, layer: 0 });
Draw.trace(traceB, { color: '#c8d0d8', dash: true, width: 1.2, layer: 0 });

Draw.box(blockC, 0.34, 0.24, { angleDeg: context.theta, fill: '#ffffff', stroke: '#1d2733' });
Draw.text(blockC[0] + nxu * 0.30, blockC[1] + nyu * 0.30, 'm₁', { size: 12, color: '#1d2733' });
Draw.box([state.x2, state.y2], context.blockH, context.blockH, { angleDeg: 0, fill: '#ffffff', stroke: '#2a6f8f' });
Draw.text(state.x2 + 0.26, state.y2, 'm₂', { size: 12, color: '#2a6f8f', align: 'left' });

/* 矢量：方向一律由 m₁ 向上、m₂ 向下这一结论给出（速度、加速度各自的比例尺分开取） */
var VS = 0.14;
var AS = 0.060;
Draw.arrow(blockC, [state.v * ux * VS, state.v * uy * VS], { category: 'velocity', label: 'v', mag: Math.abs(state.v) });
Draw.arrow(blockC, [state.a * ux * AS, state.a * uy * AS], { category: 'acceleration', label: 'a', mag: Math.abs(state.a) });
/* 绳约束：两物块速度大小相等 —— 补 mag 之后这两根箭头**必然一样长**（这正是"同类可比"的用武之处） */
Draw.arrow([state.x2, state.y2], [0, -state.v * VS], { category: 'velocity', label: 'v', mag: Math.abs(state.v) });
Draw.arrow([state.x2, state.y2], [0, -state.a * AS], { category: 'acceleration', label: 'a', mag: Math.abs(state.a) });

/* 受力：同一比例尺 FS（T = 9 N、F_N = 8.7 N、m₁g = 10 N、m₂g = 15 N），都从质心出发 */
var FS = 0.030;
var Tlen = context.T * FS;
Draw.arrow(blockC, [Tlen * ux, Tlen * uy], { category: 'force', subtype: 'tension', label: 'T', mag: context.T });
Draw.arrow(blockC, [0, -context.m1 * context.g * FS], { category: 'force', subtype: 'gravity', label: 'm₁g', mag: context.m1 * context.g, labelInset: -13 });
Draw.arrow(blockC, [state.fN * FS * nxu, state.fN * FS * nyu], { category: 'force', subtype: 'normal', label: 'F_N', mag: state.fN });
Draw.arrow([state.x2, state.y2], [0, Tlen], { category: 'force', subtype: 'tension', label: 'T', mag: context.T });
Draw.arrow([state.x2, state.y2], [0, -context.m2 * context.g * FS], { category: 'force', subtype: 'gravity', label: 'm₂g', mag: context.m2 * context.g, labelInset: -13 });

/* θ 角标注（世界坐标折线，不用 Draw.arc 以免角度约定歧义）：180° → 210° */
var wedge = [];
for (var wi = 0; wi <= 12; wi = wi + 1) {
  var wphi = (180 + context.theta * wi / 12) * Math.PI / 180;
  wedge.push([apexX + 0.40 * Math.cos(wphi), apexY + 0.40 * Math.sin(wphi)]);
}
Draw.curve(wedge, { color: '#a4610d', width: 1.2 });
Draw.line([apexX - 0.60, apexY], [apexX + 0.28, apexY], { dash: true, color: '#9aa7b4', width: 1.0 });
Draw.text(apexX - 0.62, apexY + 0.14, 'θ = 30°', { size: 11, color: '#a4610d', align: 'right' });

/* 说明文字放在左上空白区（斜坡上方），不压住任何图元 */
var infoX = context.footX - 0.10;
Draw.text(infoX, 1.98, '绳长 L₁ + L₂ = ' + Phys.format(state.ropeSum, 'm', 3) + '（漂移 ' + Phys.format(state.ropeDrift, 'm', 1) + '）', { size: 11, color: '#5d6b7a', align: 'left' });
Draw.text(infoX, 1.70, '沿面位移 = 悬挂位移 = ' + Phys.format(state.s, 'm', 3), { size: 11, color: '#5d6b7a', align: 'left' });
Draw.text(infoX, 1.42, 'm₂g − T = ' + Phys.format(state.eq2, 'N', 3) + '　T − m₁g·sinθ = ' + Phys.format(state.eq1, 'N', 3), { size: 11, color: '#5d6b7a', align: 'left' });
Draw.text(infoX, 1.14, '自检：两式张力差 ' + Phys.format(context.eqErr1 + context.eqErr2, 'N', 1) + '（应为 0）', { size: 11, color: '#5d6b7a', align: 'left' });`,

    readouts: String.raw`return [
  { key: 'a', label: '加速度', value: state.a, unit: 'm/s^2', latex: 'a' },
  { key: 'T', label: '绳张力', value: state.T, unit: 'N', latex: 'T' },
  { key: 'v', label: '速度', value: state.v, unit: 'm/s', latex: 'v' },
  { key: 's', label: '位移', value: state.s, unit: 'm', latex: 's' },
  { key: 'eq1', label: 'T − m₁g·sinθ', value: state.eq1, unit: 'N', latex: 'm_1a' },
  { key: 'eq2', label: 'm₂g − T', value: state.eq2, unit: 'N', latex: 'm_2a' },
  { key: 'ropeSum', label: '绳长 L₁+L₂', value: state.ropeSum, unit: 'm', latex: 'L_1+L_2' },
  { key: 'ropeDrift', label: '绳长变化量', value: state.ropeDrift, unit: 'm', latex: '\\Delta L' }
];`,
  },
};
