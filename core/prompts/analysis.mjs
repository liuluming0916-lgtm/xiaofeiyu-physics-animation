/**
 * `analysis`（物理分析）阶段的提示词 —— v6。
 *
 * 新链路：`read_problem → solve → breakdown → analysis → (程序生成 stateAt) → drawFrame`
 *
 * v6 的范围（用户 2026-10-22 拍板）：
 *   · 只输出 MOTIONS（运动表），不输出 EVENTS、不输出 ANSWERS；
 *   · C7 / C10 删除；最终答案留在 breakdown，不进 analysis；
 *   · `stateAt` 由程序按本表生成，AI 只写 `drawFrame`；
 *   · 输入 = 题面 + 读题几何 + 解题过程；**breakdown 不进 analysis**。
 *
 * 表达式语法必须与 `core/analysis/expr.mjs` 的白名单逐条一致：
 *   提示词里多写一个函数、少写一条禁令，都会让模型产出解析器不认的表。
 */

import { ANALYSIS_EXAMPLE } from '../analysis/example.mjs';

/** 阶段前缀里的“角色与输出纪律”（接线后放进 STAGE_ROLES.analysis） */
export const ANALYSIS_ROLE = [
  '你是一名资深高中物理动力学分析助手：在题目与解题过程的基础上，为每个运动元件推导分阶段运动学方程 x(t)、y(t)，供下游程序生成动画状态。',
  '你不写最终答案，也不写绘图代码。',
  '· 只输出被要求的内容本身，按规定输出，格式干净、可直接解析；',
  '· 单位写在字段里，数值不带千分位与多余小数。表达式系数至少 4 位；给人看的数值保留 2–3 位。',
].join('\n');

/** 本阶段指令（接线后作为 prompt.system 进条件段） */
export const ANALYSIS_INSTRUCTION = [
  '如果题面与解题过程里有“没有数值的符号”，先写一行：',
  'assumption: 为没有数值的符号赋值',
  '（题面给了全部数值就省略这一行）',
  '',
  '赋值规则：',
  '· 优先小整数（1、2、3…），并保持题设的数量关系；',
  '· 物理常数用常规值（g=10 m/s²）；',
  '· 无量纲系数用常见值（μ=0.2、η=0.8），不要取 μ=2、η=2 这类违反物理约束的值；',
  '· 角度取 30°/45°/60° 等特殊角，表达式里用弧度；',
  '· 整表共用这一组数；题面已经给了的数值照抄，不要改。',
  '',
  '示例：',
  'assumption: 取 m_A=1 kg、m_B=2 kg、μ=0.2、g=10 m/s²；m_B=2m_A 符合题意',
  '',
  '=== 元件运动表 (MOTIONS) ===',
  '只为题目中的运动刚体/质点（滑块、小球、木板、运动导体棒等）建立方程；',
  '静止背景（地面、墙面、固定斜面体、定滑轮轴）不要列入。',
  '每个元件按它自己的受力情况变化点分段，每段一条记录，记录之间空一行：',
  '',
  'element: 元件标识（同一元件多段保持一致）',
  'type: 该元件的词表 id（如 block / ball / board / conductor_rod / light_rod / piston / mercury）；',
  '      同一元件多段保持一致；**必须是词表 id，不允许 unknown 或自造名**（对不上会被判失败）',
  'segment: 段序号，从 1 开始的自然数',
  't0: 本段起始时刻，以秒为单位',
  't1: 本段结束时刻，以秒为单位',
  'x0 / y0 / vx0 / vy0 / ax / ay: 本段初态，六个数值',
  'x: 水平位置关于 t 的函数表达',
  'y: 竖直位置关于 t 的函数表达',
  'note: 本段物理过程说明',
  '',
  '【质心口径（硬性要求，B 阶段）】',
  '· `x / y` 写的是该元件的**质心**，不是接触点/参考点。',
  '· 质心高度 = 支撑面高度 + `physical.h/2`；球用 `physical.r`（例如物块 physical.h=0.1，放在 y=0 的带面上，则 y0=0.05）。',
  '· 真实尺寸表在 user 消息里（**只读**）：只用来把质心放对，**不得写进输出**。',
  '· 不要输出 `w / h / r / pointR / size / physical` 字段（出现会被判失败；尺寸只来自元件卡）。',
  '',
  '【更好的标准建模方式，硬性要求】',
  '1. 坐标系：以核心运动起点或题目自然原点为 (0, 0)，x 向右为正，y 向上为正，单位米。',
  '   每段的 x/y 写该段真实的运动轨迹；同一元件相邻段在交界时刻位置连续。',
  '2. 用本段字段名写增量。',
  '   表达式里直接写 `t0`、`x0`、`y0`、`vx0`、`vy0`，',
  '   正确：`x0 + vx0*(t - t0) + 0.5*ax*(t - t0)^2`',
  '   正确：`y0 + vy0*(t - t0) - 0.5*10*(t - t0)^2`',
  '   错误：`-0.75 + 3.5*t - t^2`',
  '   错误：`2.5 - 1.5*cos(...) + 2.4495*sin(...)`',
  '   匀速段就写 `x0 + vx0*(t - t0)`；静止段直接写 `x0`。',
  '   只有一种情况要自己写常数：该段起点不在本段字段里（例如题面相坐标原点），那就把 `x0/y0` 填成那个值。',
  '3. 连续性：同一元件相邻两段在交界时刻（上一段 t1 = 下一段 t0），位置 (x, y) 必须相等；',
  '   速度除非发生瞬时碰撞冲量，否则也必须连续。程序会拿 `x0/y0` 校验表达式在 `t0` 处的取值。',
  '4. 表达式语法：变量仅限 `t` 与本段锚点 `t0 / x0 / y0 / vx0 / vy0`；只允许 + - * /、幂 ^（也接受 **）、括号，',
  '   以及 sin/cos/tan/sqrt/exp/abs 和常量 pi；系数必须是具体数值，禁止带单位，',
  '   禁止函数定义、属性访问、数组/对象/字符串、其他变量。',
  '5. 变力/非初等函数逃生门：若某段无法写出精确初等函数 x(t)，不要编假闭式。',
  '   把该段写成 `kind: ode`，x/y 写 `ODE`，并给出：',
  '   x0 / y0 / vx0 / vy0（本段初态）与 ax / ay（微分方程右端，可用 t,x,y,vx,vy）；',
  '   note 写清物理过程。本版程序会明确报“不支持数值积分”，由人工决定是否升级。',
  '6. 不同元件的阶段是独立的，无需对齐。',
  '7. 题面没给的数不要编。题面符号无数值时用 assumption 声明示意值，整表共用同一组数。',
  '',
  '【示例】',
  ANALYSIS_EXAMPLE,
  '',
  '【本版限制】只接受闭式表达式（kind: closed）。如果某段确实无法用初等函数表达（变力、阻尼、非线性微分方程），',
  '不要编一个假闭式；把该段写成 `kind: ode` 并给出 ax/ay 微分方程，程序会明确报“本版不支持数值积分”，',
  '由人工决定是否升级 —— 宁可失败，也不要交一条假曲线。',
].join('\n');

/**
 * 组装 analysis 阶段的 user 消息（**不含** `════ 题目 ════` 横幅；
 * 横幅由 `assemblePrompt()` 统一加，保证与其它阶段一致）。
 *
 * ⚠ 用户 2026-10-22 裁决：`breakdown` **不进** analysis。
 *   只给题面、读题几何、解题过程；避免把“教学步骤”误当运动阶段。
 *
 * B2：再加一段**只读** `physical` 表（物理米），让模型把质心放到支撑面上方。
 *
 * @param {{ problem: string, readProblem?: string, solution: string, physicalTable?: Record<string, {w?:number,h?:number,r?:number}>|null }} input
 */
export function buildAnalysisUser({ problem, readProblem, solution, physicalTable } = {}) {
  const dims = (p) => {
    const parts = [];
    if (Number.isFinite(p?.w)) parts.push(`w=${p.w}`);
    if (Number.isFinite(p?.h)) parts.push(`h=${p.h}`);
    if (Number.isFinite(p?.r)) parts.push(`r=${p.r}`);
    return parts.join('、');
  };
  const rows = Object.entries(physicalTable ?? {}).filter(([, p]) => dims(p));
  return [
    '【题目】',
    problem ?? '',
    '',
    ...(readProblem && String(readProblem).trim()
      ? [
          '【题目图与几何（读题转写的结构）】',
          String(readProblem).trim(),
          '',
          '坐标与摆放以这段几何为准：谁在左/右、哪一端高、绳/杆怎么走。',
          '',
        ]
      : []),
    ...(rows.length
      ? [
          '【元件真实尺寸（只读；单位米；只用来把质心放到支撑面上方，不能写进输出）】',
          ...rows.map(([type, p]) => `- ${type}：${dims(p)}`),
          '',
        ]
      : []),
    '【解题过程】',
    solution ?? '',
  ].join('\n');
}

/** 接线时直接展开进 `PROMPTS.analysis` */
export const ANALYSIS_PROMPT = Object.freeze({
  id: 'analysis',
  label: '物理分析',
  duty: '把题目与解题过程翻译成逐元件的分段 x(t)/y(t)（供程序生成 stateAt；不写答案/事件）',
  system: ANALYSIS_INSTRUCTION,
  buildUser: buildAnalysisUser,
});
