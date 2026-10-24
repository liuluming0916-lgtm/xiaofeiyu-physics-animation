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
  '· 画面用物理世界坐标（米）；不写字；不写像素；不自己算运动。',
].join('\n');

export const SCENE_CODE_INSTRUCTION = [
  '现在执行【动画代码】阶段。',
  '你只输出 drawFrame 的函数体：不写 `function drawFrame` 头，不写任何槽位标记，不写解释。',
  '',
  '【画布】物理世界坐标：x 向右、y 向上，单位米。',
  '没有 10×6 的纸，也没有 `cx/cy`；相机自动取景，你画到哪里，画面就框到哪里。',
  '主体别太小、别太偏；静态件不要把世界撑得太大。',
  '',
  '【你拿到的 state】每个运动元件一个对象：',
  '- `state.<key>.x / .y` = 这个元件**质心**的物理位置（米），画东西一律用它；',
  '- `state.<key>.type` = 元件类型（block / ball / board / conductor_rod …）；',
  '- **没有** `cx/cy`、`anchor`、`w/h/r`。',
  '',
  '【尺寸与比例由你定】',
  '元件画多大、地面/带/斜面画多长、弹簧自然长度、斜面角度，全由你按画面需要决定（米）。',
  '允许**示意**：物块可以画 1 m，即使题面是 0.2 m；只要画面看得清、位置关系对。',
  '同类元件尽量用同一量级，别一个像蚂蚁、一个像房子。',
  '',
  '【规则】',
  '1. 位置一律从 `state` 读；**不要**在 drawFrame 里重算运动、时间或速度。',
  '2. 只调 `Draw.*`；不要用 ctx、DOM、canvas、像素坐标。',
  '3. 画布上**不写任何文字**：不要文字/公式标注、箭头 label、尺寸数字、坐标轴标签/单位；说明放画布外。',
  '4. 不要画 v/a 箭头：运行时按 `SIM.bodies` 自动求导绘制；`force` / `aux` 箭头可以用，必须给 `category` 与 `mag`。',
  '5. 静止物体（地面、斜面、传送带、滑轮、绳、导轨、容器）按读题几何或题图自己摆，也用米：',
  '   地面/支撑面画在运动元件附近（平抛/悬挂时可以离地面很远，不要硬贴 y=0）；带面/板面尽量穿过元件在 t=0 附近的位置；绳连到实际端点；不要悬空。',
  '   这是“示意”，不要求和题面尺寸逐字一致。',
  '6. 颜色由系统按 category 决定；不要写 `color`。',
  '7. 一屏画完：主体居中、留边距。',
  '',
  '【示例】地面 + 物块（物理米；物块按质心画，尺寸示意）',
  '```js',
  'Draw.ground(-2, 8, 0);',
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
  readProblem,
  description,
  knownConditions,
  stateMap = [],
  steps = [],
} = {}) {
  const timed = (Array.isArray(steps) ? steps : []).filter(
    (s) => Number.isFinite(s?.t0) && Number.isFinite(s?.t1),
  );
  return [
    '【题目】',
    problem ?? '',
    '',
    '【物理分析（唯一运动来源；不要重算）】',
    String(analysisText ?? '').trim(),
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
