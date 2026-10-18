/**
 * §19.5 回归题 04 · 两球斜碰（二维动量守恒 + 碰撞自检）
 *
 * 考什么：二维动量分解 + 碰撞自检
 *
 * 生成后自检（逐条在代码中体现）：
 *   1. 碰点时刻由**几何**解出 —— setup 里解 |Δr + v₁t| = r₁+r₂ 的二次方程得 t*，不写死；
 *   2. 碰后速度由**连线方向（法向）分解**给出 —— 法向按 (1+e) 交换动量，切向分量保持不变；
 *   3. 动量自检 —— readouts 同时给出「碰前」与「当前」的 x/y 总动量，两者由代码分别算出；
 *   4. 质心速度碰前碰后相同 —— 质心轨迹画成一条贯穿全程的虚线（动量守恒的可视化）。
 *
 * 绘图注记：Draw.arrow 统一传**几何矢量**（物理量 × 几何缩放）并置 scale=1，
 * 物理量用 opts.mag/unit 记录 —— 因为 §4.6 的命令包络把 vec 原样当长度（不乘 scale），
 * 传物理量会让包络虚胖、AutoView 把画面缩小（见报告）。
 *
 * 跨槽位注记：setup 用 RETURN(key, value) 导出派生量，其余槽位从 context 读取。
 */

export default {
  id: 'q04-oblique-collision',
  index: 4,
  title: '两球斜碰的动量分解',
  examPoint: '二维动量守恒 + 碰撞自检',
  mode: 'NUMERIC',
  examSelfChecks: 4,

  slots: {
    PROBLEM: String.raw`光滑水平桌面上有两个小球。小球 1 质量 $m_1=1.0\ \mathrm{kg}$，以速率 $v_0=4.0\ \mathrm{m/s}$ 沿与 $x$ 轴成 $\beta=8^\circ$ 的方向运动；小球 2 质量 $m_2=2.0\ \mathrm{kg}$，原来静止。两球半径分别为 $r_1=0.22\ \mathrm{m}$、$r_2=0.30\ \mathrm{m}$。

当两球中心的连线（图中虚线，即"连线方向"）与 $x$ 轴成 $\varphi=30^\circ$ 时两球恰好接触并发生弹性碰撞（恢复系数 $e=1$）。

求：(1) 从图示初位置到碰撞所用的时间 $t^{*}$；(2) 沿连线方向分解后，碰后两球速度的大小 $v_1'$、$v_2'$；(3) 检验碰撞前后系统动量在 $x$、$y$ 两个方向上是否都守恒。`,

    STEPS: String.raw`# 行式表：每步以 title 起始，空行分隔；字段 title / tex / t0 / t1
title: 第 1 步 · 碰点时刻由几何解出
tex: |\Delta\mathbf{r}+\mathbf{v}_1t|=r_1+r_2\ \Rightarrow\ t^{*}=\frac{-\Delta\mathbf{r}\cdot\hat{\mathbf{v}}_1-\sqrt{(\Delta\mathbf{r}\cdot\hat{\mathbf{v}}_1)^{2}-|\Delta\mathbf{r}|^{2}+(r_1+r_2)^{2}}}{v_0}=0.75\ \mathrm{s}
t0: 0
t1: 0.75

title: 第 2 步 · 分解到连线方向（法向）与切向
tex: \hat{n}=(\cos\varphi,\sin\varphi),\quad v_{1n}=\mathbf{v}_1\cdot\hat{n}=v_0\cos(\varphi-\beta)=3.71\ \mathrm{m/s},\quad v_{1t}=\mathbf{v}_1\cdot\hat{t}
t0: 0.75
t1: 1.0

title: 第 3 步 · 碰后速度：法向按 (1+e) 交换，切向不变
tex: \mathbf{v}_1'=\mathbf{v}_1-\frac{(1+e)m_2}{m_1+m_2}v_{1n}\hat{n},\quad \mathbf{v}_2'=\frac{(1+e)m_1}{m_1+m_2}v_{1n}\hat{n}\ \Rightarrow\ v_1'=1.94\ \mathrm{m/s},\ v_2'=2.47\ \mathrm{m/s}
t0: 1.0
t1: 1.15

title: 第 4 步 · 动量自检：x / y 两个方向都守恒
tex: p_x=m_1v_{1x}=3.96\ \mathrm{kg\cdot m/s},\quad p_y=m_1v_{1y}=0.56\ \mathrm{kg\cdot m/s},\quad \text{碰前}=\text{碰后}
t0: 1.15
t1: 1.6`,

    ANSWERS: String.raw`symbol: t*
value: 0.75
unit: s
tol: 0.01
at_t: 0.75
step: 1

symbol: v1
value: 1.9427
unit: m/s
tol: 0.01
at_t: 1.3
step: 3

symbol: v2
value: 2.4726
unit: m/s
tol: 0.01
at_t: 1.3
step: 3

symbol: px
value: 3.9611
unit: kg·m/s
tol: 0.01
at_t: 1.3
step: 4

symbol: py
value: 0.5567
unit: kg·m/s
tol: 0.01
at_t: 1.3
step: 4`,

    VIEW: `SIM = {
  duration: 1.6,
  axes: [
    { key: 'v1', label: 'v₁', unit: 'm/s' },
    { key: 'v2', label: 'v₂', unit: 'm/s' },
    { key: 'px', label: 'p_x', unit: 'kg·m/s' },
    { key: 'py', label: 'p_y', unit: 'kg·m/s' }
  ],
  continuityKeys: ['x', 'y', 'x2', 'y2']
};`,

    setup: `var m1 = 1.0, m2 = 2.0;
var r1 = 0.22, r2 = 0.30;
var rr = r1 + r2;
var beta = 8 * Math.PI / 180;
var phi = 30 * Math.PI / 180;
var v0 = 4.0;
var e = 1.0;

var nx = Math.cos(phi), ny = Math.sin(phi);
var tx = -ny, ty = nx;
var v1x = v0 * Math.cos(beta), v1y = v0 * Math.sin(beta);

// 取碰点（接触点）为坐标原点：碰时球 1 中心在 -r1·n，球 2 中心在 +r2·n
var c1x = -r1 * nx, c1y = -r1 * ny;
var c2x = r2 * nx, c2y = r2 * ny;

// 由几何反推球 1 的初位置：让它走 tGuess 时间后正好到达接触位置
var tGuess = 0.75;
var p1x = c1x - v1x * tGuess, p1y = c1y - v1y * tGuess;

// 碰点时刻由 |Δr + v1 t| = r1 + r2 解出（取先到的那个根）
var dx = p1x - c2x, dy = p1y - c2y;
var qa = v1x * v1x + v1y * v1y;
var qb = 2 * (dx * v1x + dy * v1y);
var qc = dx * dx + dy * dy - rr * rr;
var tStar = (-qb - Math.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa);

// 碰后速度：法向按 (1+e) 交换动量，切向分量不变
var v1n = v1x * nx + v1y * ny;
var v1t = v1x * tx + v1y * ty;
var k1 = (1 + e) * m1 / (m1 + m2);
var k2 = (1 + e) * m2 / (m1 + m2);
var u1x = v1x - k2 * v1n * nx, u1y = v1y - k2 * v1n * ny;
var u2x = k1 * v1n * nx, u2y = k1 * v1n * ny;

// 碰前 / 碰后的总动量（自检用：两者应逐分量相等）
var px0 = m1 * v1x, py0 = m1 * v1y;
var px1 = m1 * u1x + m2 * u2x, py1 = m1 * u1y + m2 * u2y;

// 质心：速度全程不变，轨迹是一条直线
var mt = m1 + m2;
var vcx = m1 * v1x / mt, vcy = m1 * v1y / mt;
var cmx0 = (m1 * p1x + m2 * c2x) / mt;
var cmy0 = (m1 * p1y + m2 * c2y) / mt;

RETURN('m1', m1);
RETURN('m2', m2);
RETURN('r1', r1);
RETURN('r2', r2);
RETURN('nx', nx);
RETURN('ny', ny);
RETURN('tx', tx);
RETURN('ty', ty);
RETURN('v1x', v1x);
RETURN('v1y', v1y);
RETURN('p1x', p1x);
RETURN('p1y', p1y);
RETURN('c1x', c1x);
RETURN('c1y', c1y);
RETURN('c2x', c2x);
RETURN('c2y', c2y);
RETURN('tStar', tStar);
RETURN('u1x', u1x);
RETURN('u1y', u1y);
RETURN('u2x', u2x);
RETURN('u2y', u2y);
RETURN('px0', px0);
RETURN('py0', py0);
RETURN('px1', px1);
RETURN('py1', py1);
RETURN('vcx', vcx);
RETURN('vcy', vcy);
RETURN('cmx0', cmx0);
RETURN('cmy0', cmy0);`,

    stateAt: `var tt = Math.min(Math.max(t, 0), SIM.duration);
var hit = tt >= context.tStar;
var dtp = hit ? tt - context.tStar : 0;

// 分段解析式：碰前各自匀速，碰后各自匀速，碰点由几何解出的 tStar 切分
var x = hit ? context.c1x + context.u1x * dtp : context.p1x + context.v1x * tt;
var y = hit ? context.c1y + context.u1y * dtp : context.p1y + context.v1y * tt;
var x2 = context.c2x + (hit ? context.u2x * dtp : 0);
var y2 = context.c2y + (hit ? context.u2y * dtp : 0);
var vx = hit ? context.u1x : context.v1x;
var vy = hit ? context.u1y : context.v1y;
var vx2 = hit ? context.u2x : 0;
var vy2 = hit ? context.u2y : 0;

return {
  t: tt,
  hit: hit,
  x: x,
  y: y,
  vx: vx,
  vy: vy,
  speed: Math.sqrt(vx * vx + vy * vy),
  vn: vx * context.nx + vy * context.ny,
  vt: vx * context.tx + vy * context.ty,
  x2: x2,
  y2: y2,
  vx2: vx2,
  vy2: vy2,
  speed2: Math.sqrt(vx2 * vx2 + vy2 * vy2),
  vn2: vx2 * context.nx + vy2 * context.ny,
  px: context.m1 * vx + context.m2 * vx2,
  py: context.m1 * vy + context.m2 * vy2,
  xcm: (context.m1 * x + context.m2 * x2) / (context.m1 + context.m2),
  ycm: (context.m1 * y + context.m2 * y2) / (context.m1 + context.m2)
};`,

    drawFrame: `var nx = context.nx, ny = context.ny, tx = context.tx, ty = context.ty;
var sc = 0.16;   // 几何缩放：1 m/s ↔ 0.16 m 图面长度

// —— 质心轨迹：全程一条直线（动量守恒 ⇒ 质心匀速）——
Draw.trace([[context.cmx0, context.cmy0],
  [context.cmx0 + context.vcx * SIM.duration, context.cmy0 + context.vcy * SIM.duration]],
  { color: '#6b5aa6' });
Draw.circle([state.xcm, state.ycm], 0.055, { fill: '#6b5aa6' });
Draw.text(state.xcm + 0.10, state.ycm + 0.20, '质心 C', { size: 11, color: '#6b5aa6', align: 'left' });

// —— 连线方向（法向）参考线：速度分解的基准 ——
Draw.line([state.x2 - 1.15 * nx, state.y2 - 1.15 * ny],
  [state.x2 + 1.15 * nx, state.y2 + 1.15 * ny], { dash: [5, 4], color: '#9aa7b4' });

// —— 碰点标记 ——
Draw.circle([0, 0], 0.055, { stroke: '#b3382f', width: 2 });
Draw.text(0, -0.24, '碰点', { size: 12, color: '#b3382f' });

// —— 两球本体 ——
Draw.circle([state.x, state.y], context.r1, { fill: '#ffffff', stroke: '#2b3440', width: 1.6 });
Draw.circle([state.x2, state.y2], context.r2, { fill: '#ffffff', stroke: '#2b3440', width: 1.6 });
Draw.text(state.x, state.y, '1', { size: 13 });
Draw.text(state.x2, state.y2, '2', { size: 13 });
Draw.text(state.x, state.y + context.r1 + 0.26, state.hit ? '碰后匀速' : '碰前匀速',
  { size: 11, color: state.hit ? '#b3382f' : '#20794f' });

// —— 球 1：速度矢量 + 法向/切向分解（箭头只吃几何矢量，物理量记在 mag/unit）——
Draw.arrow([state.x, state.y], [state.vx * sc, state.vy * sc], { category: 'velocity', label: 'v₁', mag: state.speed, unit: 'm/s' });
var ax = state.x, ay = state.y - 0.66;
Draw.line([ax - 0.45 * nx, ay - 0.45 * ny], [ax + 0.95 * nx, ay + 0.95 * ny], { dash: [4, 3], color: '#c9a227' });
Draw.arrow([ax, ay], [state.vn * nx * sc, state.vn * ny * sc], { category: 'aux', label: 'v₁ₙ', mag: Math.abs(state.vn), unit: 'm/s' });
Draw.arrow([ax, ay], [state.vt * tx * sc, state.vt * ty * sc], { category: 'aux', label: 'v₁ₜ', mag: Math.abs(state.vt), unit: 'm/s' });
Draw.text(ax, ay - 0.32, '球 1：沿连线方向 + 切向分解', { size: 11, color: '#5d6b7a' });

// —— 球 2：碰前静止，碰后只有法向分量 ——
Draw.arrow([state.x2, state.y2], [state.vx2 * sc, state.vy2 * sc], { category: 'velocity', label: 'v₂', mag: state.speed2, unit: 'm/s' });
var bx = state.x2, by = state.y2 + 0.66;
Draw.line([bx - 0.95 * nx, by - 0.95 * ny], [bx + 0.45 * nx, by + 0.45 * ny], { dash: [4, 3], color: '#c9a227' });
Draw.arrow([bx, by], [state.vn2 * nx * sc, state.vn2 * ny * sc], { category: 'aux', label: 'v₂ₙ', mag: Math.abs(state.vn2), unit: 'm/s' });
Draw.text(bx, by + 0.32, '球 2：只有法向分量', { size: 11, color: '#5d6b7a' });`,

    readouts: `return [
  { key: 't*', label: '碰点时刻', value: context.tStar, unit: 's', latex: 't^{*}' },
  { key: 'v1', label: '球 1 速度大小', value: state.speed, unit: 'm/s', latex: 'v_1' },
  { key: 'v2', label: '球 2 速度大小', value: state.speed2, unit: 'm/s', latex: 'v_2' },
  { key: 'px', label: '当前 x 总动量', value: state.px, unit: 'kg·m/s', latex: 'p_x' },
  { key: 'py', label: '当前 y 总动量', value: state.py, unit: 'kg·m/s', latex: 'p_y' },
  { key: 'px0', label: '碰前 x 总动量', value: context.px0, unit: 'kg·m/s', latex: 'p_{x0}' },
  { key: 'py0', label: '碰前 y 总动量', value: context.py0, unit: 'kg·m/s', latex: 'p_{y0}' },
  { key: 'Ek', label: '系统总动能', value: 0.5 * context.m1 * state.speed * state.speed + 0.5 * context.m2 * state.speed2 * state.speed2, unit: 'J', latex: 'E_k' }
];`,
  },
};
