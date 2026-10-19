#!/usr/bin/env node
/**
 * sdk:signatures —— 从 SDK 导出面生成**签名摘要**（§4.5 可发现性对策 1）。
 *
 * 摘要进 Prompt 的**固定前缀**（§10.2），因此必须逐字节稳定：
 *   · 不含题目相关信息、不含时间戳、不含随机数；
 *   · 顺序固定（先 Draw.*、再 Phys.*、最后契约与用法约定）。
 *
 * 同时供 C1 预检使用（§6.2 第 5 条：未声明全局要给出"最接近的名字"建议），
 * 因此摘要里的名字必须与 `animation-runtime.mjs` 的实际导出面一致——
 * 本脚本会**核对**这一点，不一致直接失败。
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Draw as DrawClass, Runtime } from '../sdk/runtime/animation-runtime.mjs';
import { SLOT_KEY_NAMES, SDK_VERSION, TEMPLATE_VERSION } from '../contracts/spec/frozen-keys.mjs';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `Draw.*` 的 40+ 函数说明——与 DrawClass.prototype 的方法名逐一核对 */
const DRAW_DOCS = {
  line: [
    'line(a, b, style?)',
    '直线段。a/b 为世界坐标 [x,y] 或 {x,y}；style 可选 {width, dash, stroke}。'
      + '**dash: true = 虚线，false/不写 = 实线**；只有要自定义间距时才写数字数组（如 [4, 3]）。',
  ],
  /**
   * ⚠ 第 8 期改了 `Draw.arrow` 的口径（用户 2026-10-17 拍板）。
   *
   * 这段文字会进 `sdk/signature-summary.md`，而那份摘要就是**模型看到的文档**。
   * 所以"教模型怎么写箭头"这件事，落点在这里 —— 只改渲染器不改这里，
   * 模型仍会按老文档写 `scale`，然后被 C1 判据 8 一条条驳回。
   *
   * 三条口径：`mag` 必填；`scale` 已废弃；`color` 禁止（颜色由 category 决定）。
   */
  arrow: [
    'arrow(from, vec, opts?)',
    '分类矢量箭头。vec 只给**方向**（几何矢量）；长度由 opts.mag 决定：'
      + '长度 = 该类满量程 × (mag ÷ 该类整段最大 mag)，所以**必须给 mag**（真实物理量，如 |v|、|a|、|F|）。'
      + 'opts.category ∈ velocity|acceleration|force|aux 决定颜色（绿=速度/蓝=加速度/红=受力/紫=辅助）；'
      + 'opts.label 标注、opts.unit 单位。**不要给 scale（已废弃）或 color（由 category 决定）**。',
  ],
  polygon: ['polygon(points, style?)', '多边形/路径。style.hatch ∈ null|"below"|"belowBase" 画斜线阴影'],
  circle: ['circle(center, r, style?)', '圆：质点、滚轮、场区边界；style.angleDeg 画半径线'],
  spring: ['spring(a, b, opts?)', '随动弹簧：给定两端锚点自动定形，opts.coils 圈数'],
  pulley: ['pulley(center, r, opts?)', '滑轮：圆心 + 半径 + 轮轴'],
  belt: ['belt(a, b, opts?)', '传送带/履带：两端滚轮 + 上下带面；opts.ticks 表面刻度数'],
  fieldDots: ['fieldDots(rect, opts?)', '均匀场点/叉阵列。rect={x,y,w,h}；opts.symbol ∈ dot|cross，opts.nx/ny 网格数'],
  dimension: ['dimension(from, to, opts?)', '尺寸/角度标注。opts.kind ∈ linear|angle，opts.text 标注文本'],
  arc: ['arc(center, r, a0, a1, opts?)', '弧线：轨迹、圆周、角度弧；角度制，逆时针为正'],
  trace: ['trace(points, opts?)', '轨迹虚线（curve 的实参默认值封装；默认就是虚线，不用再给 dash）'],
  curve: [
    'curve(points, opts?)',
    '折线/路径；opts.closed 闭合，opts.fill 填充；opts.dash: true=虚线、false/不写=实线、[n,m]=自定义间距',
  ],
  ghosts: ['ghosts(positions, opts?)', '残影快照：一组位置画成同形轮廓'],
  ray: ['ray(from, to, opts?)', '光线路，带箭头'],
  lens: ['lens(center, opts?)', '透镜：opts.height 口径、opts.focal 焦距（几何量）'],
  axisBox: ['axisBox(origin, xLen, yLen, opts?)', '坐标轴框（p–V / v–t 等），opts.xLabel/yLabel/xUnit/yUnit'],
  chart: ['chart(samples, opts?)', '联动图表数据编码。samples=[[x,y],…]；opts.fill 填充（面积即物理量），opts.baseline'],
  text: ['text(x, y, text, opts?)', '带上下标的标注。opts.sub/opts.sup 下标/上标，opts.leaderTo 引线'],
  latex: ['latex(x, y, tex, opts?)', '公式标注（MathJax 渲染；渲染不可用时降级为原文 §2.2）'],
  raw: ['raw(fn, opts?)', '逃生门（§5.4）：实时渲染给真 ctx；Dry-Run 只跳过该条指令的包络计算且计入使用率'],
  ground: ['ground(x0, x1, y?, opts?)', '斜线阴影地面（组合原语，仍是几何量）'],
  incline: ['incline(apex, opts?)', '斜面三角形体 + 斜线阴影底面。opts.angleDeg 正=坡脚在右下、负=坡脚在左下；opts.length 为沿面长度（几何量）'],
  box: ['box(center, w, h, opts?)', '方块/滑块：中心 + 宽高 + 可选转角'],
};

const PHYS_DOCS = {
  integrate: ['Phys.integrate(state0, deriv, t0, t1, opts?)', '通用 RK 积分，返回 {samples,stateAt}。**只允许在 setup() 内调用**（§7.6）'],
  interp: ['Phys.interp(samples, t, key?)', '采样表插值（二分查找，O(log n)），可在 stateAt 内安全使用'],
  roots: ['Phys.roots(fn, a, b, opts?)', '区间求根（二分），O(log(1/eps))，可在 stateAt 内使用'],
  format: ['Phys.format(value, unit, sigFig?)', '有效数字格式化（缺省 3 位），用于 readouts 与标注'],
};

const CONVENTION_DOCS = [
  ['/* @slot:… */ … /* @end */', '8 个槽位必须逐个用标记包裹；缺标记/重复标记/未知标记名一律 C1 失败（§3.5）'],
  ['SIM = { duration }', 'VIEW 槽位必须定义 SIM.duration（秒）。不得写像素尺寸、相机比例或轨迹表达式'],
  ['STEPS = [{title, tex, t0, t1}]', 't0/t1 必须无缝、有序、不重叠；末步 t1 = SIM.duration（C5）'],
  ['ANSWERS = [{symbol, value, unit, tol, at_t, step, latex?}]', 'C7 用 at_t 时刻的 readouts 复现 value；纯符号题 value=null 且 latex 必填（§3.3）'],
  ['stateAt(t) → 状态对象', '必须 O(1)：查表或解析式。禁止 Phys.integrate、禁止 O(n) 重算（§7.6）'],
  ['drawFrame(t, state) → 只调 Draw.*', '拿不到 ctx。每一帧从空缓冲开始重推命令'],
  ['readouts(t, state) → Readout[]', 'Readout = {label, value, unit, latex?}；键集合与单位全时段不变（C8）'],
  ['RETURN(key, value)', '在 setup() 内显式导出派生量/查表，供 stateAt 读取（可选）'],
  ['世界坐标', 'x 向右、y 向上、单位米。不要考虑像素'],
];

function buildSummary() {
  const drawNames = Object.getOwnPropertyNames(DrawClass.prototype).filter(
    (n) => n !== 'constructor' && !n.startsWith('_'),
  );
  const documented = Object.keys(DRAW_DOCS);
  const missingDocs = drawNames.filter((n) => !documented.includes(n));
  const staleDocs = documented.filter((n) => !drawNames.includes(n));
  if (missingDocs.length || staleDocs.length) {
    throw new Error(
      `签名摘要与 SDK 不一致：缺少说明 [${missingDocs.join(', ')}]，说明多余 [${staleDocs.join(', ')}]`,
    );
  }

  const physNames = ['integrate', 'interp', 'roots', 'format'];
  for (const n of physNames) {
    if (typeof Runtime[n] !== 'function') throw new Error(`签名摘要引用了不存在的 Phys.${n}`);
  }

  const functions = [
    ...drawNames.map((n) => ({
      name: `Draw.${n}`,
      params: DRAW_DOCS[n][0],
      summary: DRAW_DOCS[n][1],
      since: '1.0.0',
      layer: 1,
    })),
    ...physNames.map((n) => ({
      name: `Phys.${n}`,
      params: PHYS_DOCS[n][0],
      summary: PHYS_DOCS[n][1],
      since: '1.0.0',
      layer: 2,
    })),
  ];

  return {
    format: 'od-sdk-signature-summary',
    version: 1,
    sdkVersion: SDK_VERSION,
    templateVersion: TEMPLATE_VERSION,
    frozenKeys: [...SLOT_KEY_NAMES],
    functions,
    conventions: CONVENTION_DOCS.map(([name, summary]) => ({ name, summary })),
    builtinMembers: [
      'Math.abs', 'Math.acos', 'Math.asin', 'Math.atan', 'Math.atan2', 'Math.ceil', 'Math.cos',
      'Math.exp', 'Math.floor', 'Math.hypot', 'Math.log', 'Math.log10', 'Math.max', 'Math.min',
      'Math.pow', 'Math.round', 'Math.sign', 'Math.sin', 'Math.sqrt', 'Math.tan', 'Math.trunc',
      'Math.PI', 'Math.E',
      'Array.isArray', 'Array.from', 'Object.keys', 'Object.values', 'Object.entries', 'Object.assign',
      'Object.freeze', 'Number.isFinite', 'Number.parseFloat', 'JSON.stringify',
      'push', 'pop', 'shift', 'slice', 'splice', 'map', 'filter', 'reduce', 'forEach', 'find',
      'findIndex', 'some', 'every', 'sort', 'concat', 'join', 'includes', 'indexOf', 'reverse',
      'fill', 'flat', 'toFixed', 'toPrecision', 'toExponential', 'length', 'min', 'max',
      'keys', 'values', 'entries', 'get', 'set', 'has',
    ],
    names: ['SIM', 'PROBLEM', 'STEPS', 'ANSWERS', 'RETURN', 'Draw', 'Phys', 'context', 'PROGRAM', 'runtime', 'buffer'],
    /** 供文本渲染（Prompt 固定前缀）使用的紧凑清单 */
    promptPrefix: renderPromptPrefix(drawNames, physNames),
  };
}

function renderPromptPrefix(drawNames, physNames) {
  const lines = [];
  lines.push(`【SDK 签名摘要 · v${SDK_VERSION}】按名字精确调用；未登记的函数会被静态预检拒绝。`);
  lines.push('— 绘图原语（只推命令，不接触 ctx）—');
  for (const n of drawNames) lines.push(`· Draw.${DRAW_DOCS[n][0]} — ${DRAW_DOCS[n][1]}`);
  lines.push('— 计算辅助 —');
  for (const n of physNames) lines.push(`· ${PHYS_DOCS[n][0]} — ${PHYS_DOCS[n][1]}`);
  lines.push('— 槽位约定 —');
  for (const [name, summary] of CONVENTION_DOCS) lines.push(`· ${name} — ${summary}`);
  return lines.join('\n');
}

export function main() {
  let summary;
  try {
    summary = buildSummary();
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
  const out = join(PROJECT_ROOT, 'sdk', 'signature-summary.json');
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeFileSync(
    join(PROJECT_ROOT, 'sdk', 'signature-summary.md'),
    `# SDK 签名摘要（自动生成，请勿手改）\n\n\`\`\`\n${summary.promptPrefix}\n\`\`\`\n`,
    'utf8',
  );
  console.log(`✓ 签名摘要：${summary.functions.length} 个函数（Draw ${summary.functions.filter((f) => f.layer === 1).length} · Phys ${summary.functions.filter((f) => f.layer === 2).length}）`);
  console.log(`  冻结键名：${summary.frozenKeys.join(' · ')}`);
  console.log('  → sdk/signature-summary.json · sdk/signature-summary.md');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
