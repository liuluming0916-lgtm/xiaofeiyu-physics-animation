/**
 * `repair` 阶段提示词（方案二：只修 drawFrame）。
 *
 * 旧 repair 会重写 VIEW/setup/stateAt/readouts；新链路这些由 analysis 生成，
 * 修它们等于改物理。所以 repair 只允许改 drawFrame。
 *
 * 方案二（2026-10-24）：画面用物理世界坐标（米），尺寸/比例由模型定，允许示意；
 * 不再有 `cx/cy` / `anchor` / 固定 10×6 纸。
 */

export const REPAIR_ROLE = [
  '你是一名高中物理动画修复助手：只修 drawFrame 的函数体。',
  '· 物理/stateAt/VIEW/readouts 由程序生成，**不许改、不许重算**；',
  '· 只改“怎么画”，让校验通过。',
].join('\n');

export const REPAIR_INSTRUCTION = [
  '现在执行【动画修复】阶段。上一轮 drawFrame 没过校验。',
  '你只输出**新的 drawFrame 函数体**：不写 function 头、不写槽位标记、不写解释。',
  '',
  '【硬性边界】',
  '· 不要改 stateAt、VIEW、readouts、setup、STEPS、ANSWERS —— 它们由程序生成；',
  '· **位置只用 `state.<key>.x / .y`（物理米，质心）**；没有 `cx/cy`、没有 `anchor`；',
  '· **尺寸、地面/带/斜面长度、弹簧自然长度都由你定**，用米写数字；允许示意；',
  '· 不要写像素坐标、不要写文字、不要画 v/a 箭头。',
  '',
  '【按失败检查修复】',
  '· C1（语法/白名单）：只修语法，不换画法；',
  '· C6（边界位置跳变）：先查静止物体是否对齐了 state 的轨迹（地面画在脚下、斜面穿过 t=0 位置、绳/杆连到 state）；',
  '· C4（帧间突变）：多半是静态物体位置写死或漏了随 state 更新；',
  '· C8（readouts 键/单位变化）：readouts 不由你写，不要动它；把问题留给程序。',
  '',
  '【示例】只输出这样的函数体：',
  '```js',
  'Draw.ground(-2, 8, 0);',
  'Draw.box([state.block_A.x, state.block_A.y], 0.6, 0.4);',
  '```',
].join('\n');

/**
 * @param {{ problem?: string, analysisText?: string, readProblem?: string, stateMap?: Array<{id:string,key:string}>, failures?: string[], previousDrawFrame?: string }} input
 */
export function buildRepairUser({
  problem,
  analysisText,
  readProblem,
  stateMap = [],
  failures = [],
  previousDrawFrame = '',
} = {}) {
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
          (m) => `- ${m.key} = ${m.id}：位置用 state.${m.key}.x / .y（物理米，质心）；尺寸自己定`,
        )
      : ['（无运动元件）']),
    '',
    ...(readProblem && String(readProblem).trim()
      ? ['【读题几何（静止物体的摆放依据）】', String(readProblem).trim(), '']
      : []),
    '【上一轮为什么没过】',
    ...(failures.length ? failures.map((f) => `· ${f}`) : ['· （报告没有给出可定位的失败项）']),
    '',
    '【上一轮 drawFrame】',
    '```js',
    String(previousDrawFrame ?? '').trim(),
    '```',
    '',
    '只输出新的 drawFrame 函数体。',
  ].join('\n');
}

export const REPAIR_PROMPT = Object.freeze({
  id: 'repair',
  label: '自愈修复',
  since: 'phase4',
  duty: '只重画 drawFrame（物理世界坐标；不碰 analysis 生成的物理）',
  system: REPAIR_INSTRUCTION,
  buildUser: buildRepairUser,
});
