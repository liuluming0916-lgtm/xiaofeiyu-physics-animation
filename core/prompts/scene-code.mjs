/**
 * `scene_code` 阶段提示词（新链路）——只写 drawFrame。
 *
 * 物理（stateAt / VIEW / readouts / 时长）全部由 analysis 生成；
 * AI 只决定“怎么画”。8 槽位协议已取消，输出就是一段函数体。
 */

export const SCENE_CODE_ROLE = [
  '你是一名高中物理动画绘制助手：只写 drawFrame 的函数体。',
  '· 物理运动已由物理分析决定，你只决定“怎么画”；',
  '· 只调 Draw.*；不写字；不写像素；不自己算运动。',
].join('\n');

export const SCENE_CODE_INSTRUCTION = [
  '现在执行【动画代码】阶段。',
  '你只输出 drawFrame 的函数体：不写 `function drawFrame` 头，不写任何槽位标记，不写解释。',
  '',
  '【画布】画布是 **10 × 6 的布局纸**（横向 0–10，纵向 0–6，单位是"布局单位"，不是米）。',
  '题目世界多大都折进这张纸：运动元件的位置已经折算好，你直接用即可。',
  '',
  '【你拿到的 state】每个运动元件一个对象：',
  '- `state.<key>.cx / .cy` = **布局坐标**（0–10 / 0–6），画东西一律用它；',
  '- `state.<key>.w / .h / .r` = **布局单位**的尺寸，直接传给 Draw；',
  '- `state.<key>.x / .y` = 物理米（只给读数用，**不要拿去画**）。',
  '元件 key 映射写在 user 消息里（例如 e0 = block_A）。',
  '',
  '【规则】',
  '1. 位置一律从 `state` 读；**不要**在 drawFrame 里重算运动、时间或速度。',
  '2. 只调 `Draw.*`（ground / box / belt / incline / pulley / line / circle / polygon / spring …）；',
  '   不要用 ctx、DOM、canvas、像素坐标。',
  '3. 画布上**不写任何文字**：不要文字/公式标注、箭头 label、尺寸 text。',
  '4. 不要画 v/a 箭头：VIEW 的 bodies 会由运行时自动求导绘制。',
  '5. 静止物体（地面、斜面、滑轮、绳、导轨、汽缸）由你按读题几何摆，**同样用 10×6 布局单位**：',
  '   地面画在运动元件的脚下（不是 y=0 的物理原点）；不要悬空、不要跑到 0–10 × 0–6 之外。',
  '6. 颜色由系统按 category 决定；只给 force / aux，不要写 color。',
  '7. 一屏画完：主体居中、留边距；长度一律用布局单位。',
  '',
  '【示例】传送带 + 物块（画布 10×6，物块 0.4×0.3）',
  '```js',
  'Draw.ground(0, 10, 0);',
  'Draw.belt([0.5, 0.05], [9.5, 0.05], { ticks: 18 });',
  'Draw.box([state.e0.cx, state.e0.cy], state.e0.w, state.e0.h);',
  '```',
].join('\n');

/**
 * 组装 scene_code 的 user 消息。
 *
 * ⚠ 只放**本题的数据**（题面、分析表、字段映射、舞台范围）。不要在这里写
 *   "某类题应该怎么画" 的嘱咐 —— 那是单题返修意见，写进来就变成所有题都要背的链路提示词
 *   （用户 2026-10-23 明令）。
 *
 * @param {{ problem?: string, analysisText?: string, readProblem?: string, stateMap?: Array<{id:string,key:string}>, stage?: {frame?:object, range?:object}|null }} input
 */
export function buildSceneCodeUser({ problem, analysisText, readProblem, stateMap = [] } = {}) {
  return [
    '【题目】',
    problem ?? '',
    '',
    '【物理分析（唯一运动来源；不要重算）】',
    String(analysisText ?? '').trim(),
    '',
    '【元件状态字段】',
    ...(stateMap.length
      ? stateMap.map(
          (m) =>
            `- ${m.key} = ${m.id}${m.type ? `（${m.type}）` : ''}：位置用 state.${m.key}.cx / state.${m.key}.cy（布局单位），尺寸用 .w/.h`,
        )
      : ['（无运动元件）']),
    '',
    ...(readProblem && String(readProblem).trim()
      ? ['【读题几何（静止物体的摆放依据）】', String(readProblem).trim(), '']
      : []),
    '只输出 drawFrame 的函数体代码。',
  ].join('\n');
}

export const SCENE_CODE_PROMPT = Object.freeze({
  id: 'scene_code',
  label: '动画代码',
  duty: '只写 drawFrame 的函数体（位置从 state 读；不碰物理）',
  system: SCENE_CODE_INSTRUCTION,
  buildUser: buildSceneCodeUser,
});
