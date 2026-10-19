/**
 * 【一页范例】—— 提示词里给模型的**唯一**完整程序样本（第 9 期；v1.1.9 改）。
 *
 * 为什么单独一个模块而不是直接写进 `templates.mjs` 的字符串里：
 *   ① **同一份字节**既要给模型看，又要能被门禁真跑一遍。放在这里，提示词 import 它、
 *      探针（`tools/_golden-probe.mjs`）也 import 它 —— 不存在"提示词里那份"和"验过的那份"两份漂移。
 *   ② 它必须**逐字**满足 C1–C9。改动这里之后请跑：
 *        node tools/_golden-probe.mjs
 *      它用**真切分器**（`core/cleaner/marker-split.mjs`）+ **真判据内核**（`core/dryrun/dry-run.mjs`）
 *      跑一遍，红了就不许进提示词。
 *
 * 这份样本刻意做到四件事，每一件都对应一个"会立刻打回"的坑：
 *   1. `VIEW` 用**裸赋值** `SIM = {…}`（写 `const SIM = …` 会让外层拿不到 SIM）；
 *   2. 每个槽位**只写函数体**（`setup` 第一行就是 `const`，`readouts` 第一行就是 `return [`）；
 *   3. `setup` 用 `RETURN` 导出、其余槽位用 `context.x` 读（`setup` 里的 `const` 在别的槽位看不见）；
 *   4. **v/a 不自己画**：`SIM.bodies` 声明刚体位置，运行时求导后自动画（v1.1.9 起）。
 *
 * ⚠ 仍然示范的：受力箭头给 `mag`、不写 `color` / `scale`。
 */
export const GOLDEN_EXAMPLE = String.raw`/* @slot:PROBLEM */
水平传送带以 $u=2\ \mathrm{m/s}$ 向右匀速运行。把质量 $m=1\ \mathrm{kg}$ 的物块从静止轻放在带面左端，物块与带面之间的动摩擦因数 $\mu=0.2$，取 $g=10\ \mathrm{m/s^2}$。

求：(1) 物块与传送带共速所需的时间 $t^{*}$；(2) 加速过程物块的位移 $\Delta x$。
/* @end */

/* @slot:STEPS */
title: 第 1 步 · 相对滑动：摩擦力驱动加速
tex: a=\mu g=2\ \mathrm{m/s^2},\quad t^{*}=\frac{u}{a}=1.0\ \mathrm{s},\quad \Delta x=\frac{u^{2}}{2a}=1.0\ \mathrm{m}
t0: 0
t1: 1.0

title: 第 2 步 · 共速之后：摩擦力消失，随带匀速
tex: t>t^{*}:\ v=u=2\ \mathrm{m/s},\quad f=0
t0: 1.0
t1: 2.0
/* @end */

/* @slot:ANSWERS */
symbol: t*
value: 1.0
unit: s
tol: 0.01
at_t: 1.0
step: 1

symbol: dx
value: 1.0
unit: m
tol: 0.01
at_t: 1.0
step: 1

symbol: v
value: 2.0
unit: m/s
tol: 0.01
at_t: 2.0
step: 2
/* @end */

/* @slot:VIEW */
// 直接对预置变量 SIM 赋值（不写 const/let）
// v1.1.9：速度/加速度箭头由运行时对 bodies 求导绘制，模型**不再自己画**。
// bodies 的 at(state) 返回刚体中心的世界坐标；同一刚体的 v/a 会自动错开画。
SIM = {
  duration: 2.0,
  bodies: [
    { id: 'block', at: function (s) { return [s.x, 0.34]; } }
  ]
};
/* @end */

/* @slot:setup */
// 只写函数体：外层已经是 function setup() { … }
const g = 10, mu = 0.2, m = 1, u = 2;
const a = mu * g;
const tStar = u / a;
const xStar = 0.5 * a * tStar * tStar;
// 跨槽位共享：用 RETURN 导出，别的槽位用 context.xxx 读
RETURN('g', g);
RETURN('mu', mu);
RETURN('m', m);
RETURN('a', a);
RETURN('u', u);
RETURN('tStar', tStar);
RETURN('xStar', xStar);
/* @end */

/* @slot:stateAt */
// 只写函数体：外层已经是 function stateAt(t) { … }
const { a, u, tStar, xStar } = context;
const sliding = t < tStar;
const v = sliding ? a * t : u;
const x = sliding ? 0.5 * a * t * t : xStar + u * (t - tStar);
const f = sliding ? context.mu * context.g * context.m : 0;
return { t, sliding, v, x, f };
/* @end */

/* @slot:drawFrame */
// 只写函数体：拿到的是 (t, state)，没有 ctx，只能推 Draw.* 命令
const y0 = 0, r = 0.1;
const runLen = context.u * SIM.duration;
Draw.belt([-0.15, y0], [runLen + 0.7, y0], { r: r, ticks: 18 });
Draw.ground(-0.6, runLen + 0.95, y0 - r);
Draw.box([state.x, y0 + r + 0.24], 0.34, 0.34);
// 速度/加速度**不在这里画**：VIEW 的 bodies 已经声明了刚体，运行时会自动画 v 与 a。
// 这里只画「推不出来的量」——摩擦力（受力箭头仍归模型）。
if (state.f > 1e-9) {
  Draw.arrow([state.x, y0 + r + 0.02], [state.f, 0], { category: 'force', label: 'f', unit: 'N', mag: state.f });
}
if (state.x > 1e-6) {
  Draw.dimension([0, y0 + r * 4], [state.x, y0 + r * 4], { kind: 'linear', text: 'Δx' });
}
/* @end */

/* @slot:readouts */
// 只写函数体：返回 [{ key, label, value, unit }]，键集合与单位全时段不变
return [
  { key: 'v', label: '物块速度', value: state.v, unit: 'm/s' },
  { key: 'dx', label: '物块位移', value: state.x, unit: 'm' },
  { key: 't*', label: '共速时刻', value: context.tStar, unit: 's' }
];
/* @end */`;
