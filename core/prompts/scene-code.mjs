/**
 * `scene_code` 阶段提示词（只写 drawFrame）。
 *
 * 口径（2026-10-24 用户裁决，回滚到 1.1.17 的"少约束"版）：
 *   · 物理（位置、时长、v/a 箭头、读数）全部由 analysis 生成，你只决定"怎么画"；
 *   · 画布是 10×6 布局纸，**位置用布局坐标 `cx/cy`**，**尺寸自己定**；
 *   · 不写字、不写像素、不画 v/a 箭头；
 *   · 正向引导：按元件卡/场景卡里"可照抄的写法"画，别去碰门禁会拦的写法。
 *
 * 为什么删掉了"物理米"那一版：尺寸跟着题目量级走，长行程的题物块只剩 4 px。
 * 尺寸是"怎么画"的一部分，属于模型。
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
  '【画布】一张 **10 × 6 的布局纸**：横向 0–10，纵向 0–6，单位是"布局单位"（不是米）。',
  '题目世界多大都折进这张纸，位置已经折算好，你直接用。',
  '',
  '【你拿到的 state】每个运动元件一个对象：',
  '- `state.<key>.cx / .cy` = **布局坐标**（0–10 / 0–6），画东西一律用它；',
  '- `state.<key>.anchor` = 这个点是元件的哪个部位：',
  '  `bottom` = 底面中心（物块坐在支撑面上）、`top` = 顶端中心（绳吊着）、`center` = 中心（杆、弹簧）；',
  '  画的时候要按它把元件摆到点的正确一侧，不要一律用"中心对中心"。',
  '- `state.<key>.x / .y` = 物理米，**只给读数用，不要拿去画**（拿它画会跑到纸外，页面上会出现一次「画面超出」告警）。',
  '',
  '【尺寸由你定】',
  '元件画多大、多长、多粗，全由你按画面需要决定（布局单位）。',
  '元件卡里每条画法都写了它默认的尺寸（例如物块 0.4×0.3），照那个量级画就合适；',
  '题面给了长度（板长 3 m、带长 5 m）时，按"这张纸上看起来协调"折成布局单位，不要照抄米数。',
  '',
  '【规则】',
  '1. 位置一律从 `state` 读；**不要**在 drawFrame 里重算运动、时间或速度。',
  '2. 只调 `Draw.*`；不要用 ctx、DOM、canvas、像素坐标。',
  '3. 画布上**不写任何文字**：不要文字/公式标注、箭头 label、尺寸 text。',
  '4. 不要画 v/a 箭头：运行时按 `SIM.bodies` 自动求导绘制；`force` / `aux` 箭头可以用，必须给 `category` 与 `mag`。',
  '5. 静止物体（地面、斜面、传送带、滑轮、绳、导轨、容器）按读题几何自己摆，**也用布局单位**：',
  '   地面画在运动元件的脚下；带面/板面要穿过元件在 t=0 的接触点；绳连到真实锚点；不要悬空。',
  '6. 颜色由系统按 category 决定；不要写 `color`。',
  '7. 一屏画完：主体居中、留边距；不要画到 0–10 × 0–6 之外太远。',
  '',
  '【示例】传送带 + 物块（画布 10×6；物块 anchor 是 bottom，所以中心要抬半个高度）',
  '```js',
  'Draw.ground(-0.4, 10.4, 0);',
  'Draw.belt([0.4, 1.9], [9.6, 1.9], { ticks: 18 });',
  'Draw.box([state.block_A.cx, state.block_A.cy + 0.15], 0.4, 0.3);',
  '```',
].join('\n');

const ANCHOR_LABEL = Object.freeze({
  bottom: '底面中心（元件在它上方）',
  top: '顶端中心（元件在它下方）',
  center: '中心',
});

const num = (n) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '?');

/**
 * 组装 scene_code 的 user 消息。
 *
 * ⚠ 只放**本题的数据**（题面、分析表、字段映射、步骤、t=0 位置）。不要在这里写
 *   "某类题应该怎么画" 的嘱咐 —— 那是单题返修意见，写进来就变成所有题都要背的链路提示词
 *   （用户 2026-10-23 明令）。
 *
 * @param {{
 *   problem?: string,
 *   analysisText?: string,
 *   readProblem?: string,
 *   stateMap?: Array<{id:string,key:string,type?:string,anchor?:string}>,
 *   steps?: Array<{title?:string, t0?:number, t1?:number}>,
 *   t0States?: Record<string, {cx?:number, cy?:number, anchor?:string}>,
 * }} input
 */
export function buildSceneCodeUser({
  problem,
  analysisText,
  readProblem,
  stateMap = [],
  steps = [],
  t0States = null,
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
            `- ${m.key} = ${m.id}${m.type ? `（${m.type}）` : ''}：位置用 state.${m.key}.cx / .cy；这一条是它的 ${
              m.anchor ? ANCHOR_LABEL[m.anchor] ?? m.anchor : '中心'
            }`,
        )
      : ['（无运动元件）']),
    '',
    ...(t0States
      ? [
          '【t = 0 时各元件在这张纸上的位置（摆静止件的依据）】',
          ...stateMap
            .filter((m) => t0States[m.key])
            .map(
              (m) =>
                `- ${m.key}：cx ${num(t0States[m.key].cx)}，cy ${num(t0States[m.key].cy)}（${
                  ANCHOR_LABEL[m.anchor] ?? '中心'
                }）`,
            ),
          '',
        ]
      : []),
    ...(readProblem && String(readProblem).trim()
      ? ['【读题几何（静止物体的摆放依据）】', String(readProblem).trim(), '']
      : []),
    '只输出 drawFrame 的函数体代码。',
  ].join('\n');
}

export const SCENE_CODE_PROMPT = Object.freeze({
  id: 'scene_code',
  label: '动画代码',
  duty: '只写 drawFrame 的函数体（位置从 state 的 cx/cy 读；尺寸自己定；不碰物理）',
  system: SCENE_CODE_INSTRUCTION,
  buildUser: buildSceneCodeUser,
});
