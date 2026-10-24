/**
 * `scene_code` 阶段提示词（只写 drawFrame）—— 方案二（2026-10-24）。
 *
 * 口径：
 *   · 物理（位置、时长、v/a 箭头、读数）全部由 analysis 生成，你只决定"怎么画"；
 *   · **物理世界坐标**：x 向右、y 向上、单位米；没有 10×6 纸，没有 `cx/cy`；
 *   · `state.<key>.x/y` 是**质心**（米）；没有 anchor、没有尺寸；
 *   · 尺寸 / 比例 / 构图由模型定，允许“示意”（物块画 1 m 也可以）；
 *   · 不写字、不画 v/a；只调 `Draw.*`，不重算运动。
 */

export const SCENE_CODE_ROLE = [
  '你是一名高中物理动画绘制助手：只写 drawFrame 的函数体。',
  '· 物理运动已由物理分析决定，你只决定“怎么画”；',
  '· 画面用物理世界坐标（米）；不写字、不写像素、不自己算运动；',
  '· 每个有位移的运动元件都要画已走过的轨迹。',
].join('\n');

export const SCENE_CODE_INSTRUCTION = [
  '现在执行【动画代码】阶段。',
  '你只输出 drawFrame 的函数体：不写 `function drawFrame` 头，不写任何槽位标记，不写解释。',
  '',
  '【画布】',
  '物理世界坐标：x 向右、y 向上，单位米。',
  '相机自动取景，你画到哪里，画面就框到哪里。',
  '主体别太小、别太偏；静态件不要把世界撑得太大。',
  '',
  '【你拿到的 state】',
  '每个运动元件一个对象：',
  '- `state.<key>.x / .y` = 这个元件**质心**的物理位置（米），画东西一律用它；',
  '- `state.<key>.type` = 元件类型（block / ball / board / conductor_rod …）；',
  '- **没有** `cx/cy`、`anchor`、`w/h/r`。',
  '',
  '【尺寸与比例由你定】',
  '元件画多大、地面/带/斜面画多长、弹簧自然长度、斜面角度，全由你按画面需要决定（米）。',
  '允许**为教学演示牺牲实际比例**：物块可以画 1 m，即使题面是 0.2 m；只要画面看得清、位置关系对。',
  '同类元件尽量用同一量级。',
  '',
  '【规则】',
  '1. 位置一律从 `state` 读。',
  '2. 只调 `Draw.*`；不要用 ctx、DOM、canvas、像素坐标。',
  '3. 画布上**不写任何文字**：不要文字/公式标注、箭头 label、尺寸数字、坐标轴标签/单位；说明放画布外。',
  '4. 不要画 v/a 箭头：运行时按 `SIM.bodies` 自动求导绘制；`aux` 箭头可以用，必须给 `category` 与 `mag`。',
  '5. 静止物体（地面、斜面、传送带、滑轮、绳、导轨、容器）按读题几何或题图自己摆，也用米：',
  '   · 地面/支撑面 y 用静态常量，按题图或初态给；',
  '   · 带面/板面尽量穿过元件在 t=0 附近的位置；绳连到实际端点；不要悬空。',
  '   这是“示意”，不要求和题面尺寸逐字一致。',
  '6. 颜色由系统按 category 决定。',
  '7. 一屏画完：主体居中、留边距。',
  '8. **轨迹**：',
  '   · 每个有位移的运动元件都要用 `Draw.trace` 画已走过的轨迹；',
  '   · 用 `context.at(tt)` 从 0 采样到当前 `t`，只画已走过的时段，**不要画未来**；',
  '   · 采样步长用 0.02–0.05 s；没有位移的元件不要画空轨迹；',
  '   · 轨迹用 `Draw.trace(pts)`，默认就是虚线，不用再给 dash。',
  '9. **分支**：',
  '   · 如果 user 的【分支时刻】不是“无”，在 drawFrame 里写成局部常量，例如 `const BRANCH_1 = 3.82645;`；',
  '   · 分支前和分支后的轨迹**分开画**，不要把两段用一条线连起来；',
  '   · 粒子在分支时刻回到分叉点，这是 `stateAt` 已经处理好的，drawFrame 直接按 `state` 画即可；',
  '   · 没有【分支时刻】就完全不要写分支逻辑；',
  '   · 不要写 `T_BRANCH` / `T_BRANCH_1`，直接用 user 给的数字。',
  '',
  '【示例：地面 + 轨迹 + 分支】',
  '```js',
  'const groundY = -0.4; // 按题图/初态/其他元件的运动给',
  'Draw.ground(-2, 8, groundY);',
  '',
  '// 没有分支时：画一条主过程轨迹',
  'const pts = [];',
  'for (let tt = 0; tt <= t; tt += 0.03) {',
  '  const s = context.at(tt);',
  '  pts.push([s.block_A.x, s.block_A.y]);',
  '}',
  'if (pts.length > 1) Draw.trace(pts);',
  '',
  'Draw.box([state.block_A.x, state.block_A.y], 0.6, 0.4);',
  '```',
].join('\n');

const num = (n) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '?');

/**
 * 组装 scene_code 的 user 消息。
 *
 * ⚠ 只放**本题的数据**（题面、分析表、字段映射、步骤）。不要在这里写
 *   "某类题应该怎么画" 的嘱咐 —— 那是单题返修意见，写进来就变成所有题都要背的链路提示词。
 *
 * @param {{
 *   problem?: string,
 *   analysisText?: string,
 *   branchTimes?: number[],
 *   readProblem?: string,
 *   description?: string,
 *   knownConditions?: string,
 *   stateMap?: Array<{id:string,key:string,type?:string}>,
 *   steps?: Array<{title?:string, t0?:number, t1?:number}>,
 * }} input
 */
export function buildSceneCodeUser({
  problem,
  analysisText,
  branchTimes = [],
  readProblem,
  description,
  knownConditions,
  stateMap = [],
  steps = [],
} = {}) {
  const timed = (Array.isArray(steps) ? steps : []).filter(
    (s) => Number.isFinite(s?.t0) && Number.isFinite(s?.t1),
  );
  const branchText = (Array.isArray(branchTimes) ? branchTimes : [])
    .filter((v) => Number.isFinite(v))
    .map((v) => String(Math.round(v * 1e6) / 1e6))
    .join(', ');
  return [
    '【题目】',
    problem ?? '',
    '',
    '【物理分析（唯一运动来源；不要重算）】',
    String(analysisText ?? '').trim(),
    '',
    '【分支时刻（没有就写“无”；有多个按顺序逗号分隔）】',
    branchText || '无',
    '',
    ...(timed.length
      ? [
          '【讲解步骤与时间（画面要与这个节奏对得上；t 是秒）】',
          ...timed.map(
            (s, i) => `${i + 1}. ${num(s.t0)}–${num(s.t1)}  ${String(s.title ?? '').trim() || `第 ${i + 1} 步`}`,
          ),
          '某一段只在特定步骤里才该画的东西（例如某段绳子），可以用 `t` 判断，边界就用上面的数。',
          '',
        ]
      : []),
    '【元件状态字段】',
    ...(stateMap.length
      ? stateMap.map(
          (m) =>
            `- ${m.key} = ${m.id}${m.type ? `（${m.type}）` : ''}：位置用 state.${m.key}.x / .y（物理米，质心）`,
        )
      : ['（无运动元件）']),
    '',
    ...(readProblem && String(readProblem).trim()
      ? ['【读题几何（静止物体的摆放依据）】', String(readProblem).trim(), '']
      : []),
    ...(description && String(description).trim()
      ? ['【补充描述（按阶段注入；初始几何/布景以它为准）】', String(description).trim(), '']
      : []),
    ...(knownConditions && String(knownConditions).trim()
      ? ['【已知条件（按阶段注入）】', String(knownConditions).trim(), '']
      : []),
    '只输出 drawFrame 的函数体代码。',
  ].join('\n');
}

export const SCENE_CODE_PROMPT = Object.freeze({
  id: 'scene_code',
  label: '动画代码',
  duty: '只写 drawFrame 的函数体（物理世界坐标；尺寸/比例自己定，允许示意；不碰物理）',
  system: SCENE_CODE_INSTRUCTION,
  buildUser: buildSceneCodeUser,
});
