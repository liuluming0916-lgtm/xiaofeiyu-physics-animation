/**
 * 分析表的**一页示例**（传送带 + 物块）—— v6（只有 MOTIONS）。
 *
 * 这份文本既进提示词，又被自检真解析一遍：
 * 不存在“提示词里那份”和“验过的那份”两份漂移。
 *
 * 数值上刻意让两段在 t=1.0 处位置连续：
 *   第 1 段：x = x0 + 0.5*ax*(t-t0)²，t=1 → 1.0
 *   第 2 段：x = x0 + vx0*(t - t0)，t=1 → 1.0
 *
 * ⚠ 2026-10-23 用户裁决：示例统一用**段锚点**写（`x0 / vx0 / t0`），
 *   与规则 2 一致；不再出现 `0.5*2*t^2` 这种把起点/初速度揉进系数的写法。
 */
export const ANALYSIS_EXAMPLE = String.raw`assumption: 无

=== 元件运动表 (MOTIONS) ===

element: block_A
type: block
segment: 1
t0: 0
t1: 1.0
x0: 0
y0: 0.05
vx0: 0
vy0: 0
ax: 2
ay: 0
x: x0 + vx0*(t - t0) + 0.5*ax*(t - t0)^2
y: y0
note: 受滑动摩擦力向右匀加速

element: block_A
type: block
segment: 2
t0: 1.0
t1: 3.0
x0: 1.0
y0: 0.05
vx0: 2.0
vy0: 0
ax: 0
ay: 0
x: x0 + vx0*(t - t0)
y: y0
note: 共速后随带匀速`;
