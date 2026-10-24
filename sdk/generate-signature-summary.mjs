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
   * ⚠ 第 8 期定了 `mag` / 禁 `scale` / 禁 `color`；v1.1.9 又收了一层（用户 2026-10-19 拍板）。
   *
   * 这段文字会进 `sdk/signature-summary.md`，而那份摘要就是**模型看到的文档**。
   * 所以"教模型怎么写箭头"这件事，落点在这里 —— 只改渲染器不改这里，
   * 模型仍会按老文档写 v/a 箭头，然后被 C1 的新判据一条条驳回。
   */
  arrow: [
    'arrow(from, vec, opts?)',
    '**v/a 不再由模型画**：运行时按程序里的刚体声明自动求导绘制（绿=v / 蓝=a，间断点取碰后、冲量处画点）。'
      + '`Draw.arrow` 只用于 `category: "force"`（受力，红）与 `"aux"`（传送带速度、电流、分量…，紫）。'
      + '长度由 opts.mag 决定：长度 = 该类满量程 × (mag ÷ 该类整段最大 mag)，所以**必须给 mag**（真实量级）。'
      + '**不要给 scale（已废弃）或 color（由 category 决定）**。',
  ],
  polygon: ['polygon(points, style?)', '多边形/路径。style.hatch ∈ null|"below"|"belowBase" 画斜线阴影'],
  circle: ['circle(center, r, style?)', '圆：质点、滚轮、场区边界；style.angleDeg 画半径线'],
  spring: ['spring(a, b, opts?)', '随动弹簧：给定两端锚点自动定形，opts.coils 圈数'],
  pulley: ['pulley(center, r, opts?)', '滑轮：圆心 + 半径 + 轮轴'],
  belt: ['belt(a, b, opts?)', '传送带/履带：两端滚轮 + 上下带面；opts.ticks 表面刻度数'],
  fieldDots: ['fieldDots(rect, opts?)', '均匀场点/叉阵列。rect={x,y,w,h}；opts.symbol ∈ dot|cross，opts.nx/ny 网格数'],
  dimension: ['dimension(from, to, opts?)', '尺寸/角度标记。opts.kind ∈ linear|angle；**不写文字/数字**（画布上不写字）'],
  arc: ['arc(center, r, a0, a1, opts?)', '弧线：轨迹、圆周、角度弧；角度制，逆时针为正'],
  ellipse: ['ellipse(center, rx, ry, opts?)', '椭圆：天体轨道、示意椭圆；rx/ry 是半轴（几何量）'],
  trace: ['trace(points, opts?)', '轨迹虚线（curve 的实参默认值封装；默认就是虚线，不用再给 dash）'],
  curve: [
    'curve(points, opts?)',
    '折线/路径；opts.closed 闭合，opts.fill 填充；opts.dash: true=虚线、false/不写=实线、[n,m]=自定义间距',
  ],
  ghosts: ['ghosts(positions, opts?)', '残影快照：一组位置画成同形轮廓'],
  ray: ['ray(from, to, opts?)', '光线路，带箭头'],
  lens: ['lens(center, opts?)', '透镜：opts.height 口径、opts.focal 焦距（几何量）'],
  axisBox: ['axisBox(origin, xLen, yLen, opts?)', '坐标轴框（p–V / v–t 等）；**不写轴标签/单位**（说明放画布外）'],
  chart: ['chart(samples, opts?)', '联动图表数据编码。samples=[[x,y],…]；opts.fill 填充（面积即物理量），opts.baseline'],
  raw: ['raw(fn, opts?)', '逃生门（§5.4）：实时渲染给真 ctx；Dry-Run 只跳过该条指令的包络计算且计入使用率'],
  ground: ['ground(x0, x1, y?, opts?)', '斜线阴影地面（组合原语，仍是几何量）'],
  incline: ['incline(apex, opts?)', '斜面三角形体 + 斜线阴影底面。opts.angleDeg 正=坡脚在右下、负=坡脚在左下；opts.length 为沿面长度（几何量）'],
  box: ['box(center, w, h, opts?)', '方块/滑块：中心 + 宽高 + 可选转角'],
};

const PHYS_DOCS = {
  integrate: ['Phys.integrate(state0, deriv, t0, t1, opts?)', '通用 RK 积分，返回 {samples,stateAt}。**只允许在 setup() 内调用**（§7.6）'],
};

const CONVENTION_DOCS = [
  ['只写 drawFrame 的函数体', '位置只从 `state.<key>.x / .y` 读；不要重算运动、时间、速度。不要写函数头、槽位标记或解释。'],
  ['不要写这些槽位', '`stateAt / VIEW / setup / readouts / STEPS / ANSWERS` 由程序生成；你只负责“怎么画”。'],
  ['世界坐标', 'x 向右、y 向上、单位米；不要写像素、相机比例或 canvas 尺寸。'],
  ['画布上不写字', '文字/公式标注、箭头 label、尺寸 text、坐标轴标签/单位都不显示；说明放画布外图例。'],
  ['颜色与箭头', '颜色由 `category` 决定，不要写 `color`。不要画 v/a 箭头；`force / aux` 箭头必须给 `category` 与 `mag`。'],
  ['静止几何', '地面/支撑面按读题几何或题图摆；尽量穿过运动元件在 t=0 附近的位置；绳/杆连到实际端点；允许示意，不要悬空。'],
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

  const physNames = ['integrate'];
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

/**
 * 模型可见摘要里**故意隐藏**的历史/非 drawFrame 原语。
 * API 仍保留给旧程序与运行时；只是不再教模型用它们。
 */
const PROMPT_HIDDEN = new Set([
  'Draw.text',
  'Draw.latex',
  'Phys.integrate',
  'Phys.interp',
  'Phys.roots',
  'Phys.format',
]);

function renderPromptPrefix(drawNames, physNames) {
  const lines = [];
  lines.push(`【SDK 签名摘要 · v${SDK_VERSION}】按名字精确调用；未登记的函数会被静态预检拒绝。`);
  lines.push('— 绘图原语（只推命令，不接触 ctx）—');
  for (const n of drawNames) {
    if (PROMPT_HIDDEN.has(`Draw.${n}`)) continue;
    lines.push(`· Draw.${DRAW_DOCS[n][0]} — ${DRAW_DOCS[n][1]}`);
  }
  const visiblePhys = physNames.filter((n) => !PROMPT_HIDDEN.has(`Phys.${n}`));
  if (visiblePhys.length) {
    lines.push('— 计算辅助 —');
    for (const n of visiblePhys) lines.push(`· ${PHYS_DOCS[n][0]} — ${PHYS_DOCS[n][1]}`);
  }
  lines.push('— 绘制约定（你只写 drawFrame 的函数体）—');
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
