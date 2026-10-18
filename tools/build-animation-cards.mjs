#!/usr/bin/env node
/**
 * 动画教学卡片：**唯一来源**（第 8 期 · 用户 2026-10-18 裁决）
 *
 * 用户的原话（决定了本文件存在的理由）：
 *   「对 AI 的限制太多而示例太少，导致动画代码经常被打回……用正向的示例、教学和参考，
 *     真正告诉 AI 我们允许什么样的代码通过」；
 *   「以 SDK + 跑一遍为准」；
 *   「已经存在的动画槽卡片内容也需要你去修改，因为旧的动画槽卡片很可能教不会 AI」。
 *
 * 所以这里的每一条**画法**都不是从旧词条抄来的，而是：
 *   ① 从 `sdk/runtime/animation-runtime.mjs` 的真实实现读出来的参数形状；
 *   ② 在 `core/dryrun/dry-run.mjs` 里**真跑一遍**（C1 静态 + C2–C9 实跑，能画出命令）才算数。
 *   `--check` 会把这两步重跑一遍；任何一条过不了就 exit 1。
 *
 * 产出两样东西（都可以重新生成，**不要手改产物**）：
 *   ① `core/worldbook/source/92-animation-core.json` —— 5 条动画教学卡：
 *        · 坐标/正方向/量纲约定
 *        · 30 个元件的最小画法（总览）
 *        · 3 份大类范文（力学 / 场与电 / 波与图线），每份都是 C1–C9 全绿的真程序
 *   ② `core/worldbook/source/93-elements.json` —— **元件一件一卡**（第 9 期）：词表里每个元件一张卡，
 *      卡里的 `state` / `draw` 就是上面那份被逐条 lint + 实跑过的代码，id 与 `elements` 由元件 id 派生。
 *
 * 用法：
 *   node tools/build-animation-cards.mjs          # 生成（写 92 与 93）
 *   node tools/build-animation-cards.mjs --check  # 只校验：每条画法都要过 C1 + 实跑；两份产物都要与生成器一致
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from './paths.mjs';
import { lintSlot } from '../core/lint/contract-lint.mjs';
import { dryRun } from '../core/dryrun/dry-run.mjs';

/**
 * 常驻卡正文的**字数上限**（第 8 期调整：范文改条件触发后，常驻只剩 3 张）。
 *
 * 世界书每个槽位的预算是 `WORLDBOOK_BUDGET.maxChars`（第 8 期从 24000 提到 **32000**）。
 * 常驻卡是"无条件注入"，它们吃掉的额度就是命中词条能用的额度，所以必须设上限：
 *   常驻 ≤ 10000（约定 + 总览 + 力学范文），5 张全算 ≤ 15000。
 * 超出就意味着"讲这道题的那几张"会被挤掉，而那是**静默变差**（链路照跑、规范变少）。
 */
const MAX_CONSTANT_CHARS = 10000;
/**
 * 五张卡合计的粗上限（防膨胀）。
 * 真正约束预算的是上面那条"常驻 ≤ 10000"：非常驻卡只在命中时才进上下文，
 * 所以它们多一点不会直接挤压"讲这道题"的词条 —— 但仍要给一个天花板，避免无节制长大。
 */
const MAX_CARD_CHARS = 16000;

const SOURCE_DIR = join(PROJECT_ROOT, 'core', 'worldbook', 'source');
const CARD_FILE = join(SOURCE_DIR, '92-animation-core.json');

/**
 * 动画元件词表的**单源真相**（`contracts/worldbook-concepts.json`）。
 *
 * 为什么读它而不是抄一份：词表变了（加了新元件），这张总览卡就该跟着被要求补一条画法 ——
 * `--check` 里有一条断言："词表里的每个元件 id 都必须在本表里有一行"。抄一份就漏了这个提醒。
 */
const CONCEPTS = JSON.parse(readFileSync(join(PROJECT_ROOT, 'contracts', 'worldbook-concepts.json'), 'utf8'));
const OFFICIAL_ELEMENT_IDS = (CONCEPTS.elements ?? []).map((e) => e.id);

/* ══════════════════════════════ ① 30 个元件的最小画法 ══════════════════════════════
 *
 * 每条：`state`（stateAt 返回什么）→ `draw`（drawFrame 怎么写）。两段都是**可执行代码**，
 * 由 `verifyElement()` 逐条 lintSlot + 实跑。`pitfall` 是这条元件的历史打回点。
 */
export const ELEMENTS = [
  {
    id: 'block', name: '物块 / 滑块', group: '力学器材',
    state: 'return { x: 0.6 };',
    draw: 'Draw.box([state.x, 0.15], 0.4, 0.3);',
    pitfall: '宽高写成像素；块心算到板外（穿模）',
  },
  {
    id: 'board', name: '长木板 / 小车', group: '力学器材',
    state: 'return { xBoard: 1.0 };',
    draw: 'Draw.box([state.xBoard, 0.05], 3.0, 0.1);',
    pitfall: '板长取"看起来合适"的数，而不是题面给的 L',
  },
  {
    id: 'incline', name: '斜面 / 斜坡', group: '力学器材',
    state: 'return {};',
    draw: "Draw.incline([0, 0.6], { angleDeg: 30, length: 1.2 });",
    pitfall: '`angleDeg` 正负决定坡脚在右下还是左下；顶点是**最高**那端',
  },
  {
    id: 'ground', name: '地面 / 墙面（斜线阴影）', group: '力学器材',
    state: 'return {};',
    draw: 'Draw.ground(-1.5, 2.5);',
    pitfall: '`Draw.incline` 自带阴影底面，再叠一层 ground 会出现双阴影',
  },
  {
    id: 'ball', name: '小球 / 质点', group: '力学器材',
    state: 'return { x: 0.6, y: 0.8 };',
    draw: 'Draw.circle([state.x, state.y], 0.08);',
    pitfall: '用 `Draw.ball`（SDK 里没有这个名字 ⇒ C1 直接判未声明的名字）',
  },
  {
    id: 'arc_track', name: '圆弧轨道 / 拱桥', group: '力学器材',
    state: 'return {};',
    draw: 'Draw.arc([0, 0], 0.8, -90, 90);',
    pitfall: '`Draw.arc` 的角度是**角度制、逆时针为正**，别塞弧度',
  },
  {
    id: 'spring', name: '弹簧', group: '力学器材',
    state: 'return { yTop: 1.6 };',
    draw: 'Draw.spring([0, 2.0], [0, state.yTop], { coils: 12 });',
    pitfall: '两端锚点必须同一个来源；只更新一端，弹簧会"斜穿"物体',
  },
  {
    id: 'pulley', name: '滑轮', group: '力学器材',
    state: 'return {};',
    draw: 'Draw.pulley([0, 2.4], 0.2);',
    pitfall: '过滑轮的绳要画成**两段**，切点离圆心距离 = r',
  },
  {
    id: 'rope', name: '绳 / 细线', group: '力学器材',
    state: 'return { yA: 1.2 };',
    draw: 'Draw.line([-0.2, 2.4], [-0.2, state.yA]);',
    pitfall: '绳松弛时仍画成直线（物理状态被画没了）',
  },
  {
    id: 'rod', name: '导体棒 / 轻杆', group: '力学器材',
    state: 'return { xr: 0.8 };',
    draw: 'Draw.line([state.xr, 0], [state.xr, 0.5], { width: 3 });',
    pitfall: '杆的弹力方向当成"沿杆"（轻杆可以推，方向要解出来）',
  },
  {
    id: 'stand', name: '铁架台 / 支架', group: '力学器材',
    state: 'return {};',
    draw: 'Draw.line([-1.2, 0], [-1.2, 2.2], { width: 2 });\nDraw.ground(-1.6, 2.4);',
    pitfall: '支架每帧重算坐标（静态几何应当在 `setup()` 里算一次）',
  },
  {
    id: 'belt', name: '传送带 / 履带', group: '力学器材',
    state: 'return {};',
    draw: "Draw.belt([0, 0.2], [4, 0.2], { ticks: 16 });",
    pitfall: '刻度数 < 8，看不出带在动；刻度相位不用 `v·t` 取模',
  },
  {
    id: 'circuit', name: '电路 / 导线 / 电表', group: '场与电',
    state: 'return { I: 0.5 };',
    draw:
      'Draw.line([0, 0], [2, 0]);\n' +
      'Draw.line([2, 0], [2, 1]);\n' +
      'Draw.line([2, 1], [0, 1]);\n' +
      'Draw.line([0, 1], [0, 0]);\n' +
      "Draw.arrow([1.0, 0], [1, 0], { category: 'aux', mag: Math.abs(state.I), label: 'I', unit: 'A' });",
    pitfall: '接线柱坐标每帧重算；箭头方向画成电压方向（应为**电流**方向）',
  },
  {
    id: 'plates', name: '平行板 / 极板', group: '场与电',
    state: 'return {};',
    draw: 'Draw.line([-1, 1.6], [3, 1.6], { width: 3 });\nDraw.line([-1, 0.4], [3, 0.4], { width: 3 });',
    pitfall: '板间有场、板外没场：板外那段必须换回直线运动',
  },
  {
    id: 'field_region', name: '匀强场区（× / · 阵列）', group: '场与电',
    state: 'return {};',
    draw: "Draw.fieldDots({ x: 0, y: 0, w: 2, h: 1.5 }, { symbol: 'cross', nx: 10, ny: 8 });",
    pitfall: '`rect` 必须是 `{x,y,w,h}`（写成两个点会直接抛错）；阵列溢出场区',
  },
  {
    id: 'ray', name: '光线', group: '场与电',
    state: 'return {};',
    draw: 'Draw.ray([-1, 0.8], [0, 0.8]);',
    pitfall: '全反射时仍画一条"淡淡的折射光"（超过临界角就没有折射段）',
  },
  {
    id: 'lens', name: '透镜', group: '场与电',
    state: 'return {};',
    draw: 'Draw.lens([1, 0.8], { height: 1.2, focal: 0.5 });',
    pitfall: '`height` 与 `focal` 是必填（都是几何量），缺一个直接抛错',
  },
  {
    id: 'light_spot', name: '光斑 / 照射区域', group: '场与电',
    state: 'return {};',
    draw: "Draw.polygon([[1.4, 0.2], [1.6, 0.26], [1.6, 0.14]], { fill: 'rgba(90,150,255,0.25)' });",
    pitfall: '`polygon` 的 `fill` 是**颜色字符串**（`chart` 的 `fill` 才是开关 `true`）',
  },
  {
    id: 'vector', name: '矢量箭头（速度/力/加速度）', group: '矢量与标注',
    state: 'return { x: 0.6, y: 0.6, vx: 1.2, vy: 0.4 };',
    draw:
      "Draw.arrow([state.x, state.y], [state.vx, state.vy], " +
      "{ category: 'velocity', mag: Math.hypot(state.vx, state.vy), label: 'v', unit: 'm/s' });",
    pitfall: '缺 `mag`；起点不锚在实体中心、还手写偏移；`mag = 0` 就干脆不画（应该画成一个点）',
  },
  {
    id: 'trace_path', name: '轨迹', group: '矢量与标注',
    state: 'return { x: 0.6, y: 0.4 };',
    draw: 'Draw.trace([[0, 0], [state.x, state.y]]);',
    pitfall: '另写一条解析曲线当轨迹（与实体位置不一致）；画"还没发生"的时段',
  },
  {
    id: 'paper_tape', name: '纸带 / 点迹', group: '矢量与标注',
    state: 'return { d1: 0.2 };',
    draw: 'Draw.box([0.5, -0.6], 2.0, 0.12);\nDraw.circle([state.d1, -0.6], 0.01);',
    pitfall: '点间隔不等（相邻时刻差必须是打点周期 T）',
  },
  {
    id: 'ghosts', name: '频闪残影', group: '矢量与标注',
    state: 'return {};',
    draw: 'Draw.ghosts([[0, 0.2], [0.5, 0.2], [1.0, 0.2]]);',
    pitfall: '残影时刻不等距；把残影和纸带点迹混用',
  },
  {
    id: 'measuring_tool', name: '尺寸/角度标注（刻度尺）', group: '矢量与标注',
    state: 'return {};',
    draw: "Draw.dimension([0, 0.4], [1, 0.4], { kind: 'linear', text: 'L = 1.0 m' });",
    pitfall: '`kind` 只能是 `linear` | `angle`；把读数写成答案文本而不是由几何算出',
  },
  {
    id: 'text', name: '文字标注 / 公式', group: '矢量与标注',
    state: 'return {};',
    draw: "Draw.text(0.6, 0.9, 'A');\nDraw.latex(0.6, 1.1, 'v_0');",
    pitfall: '把数值写在箭头上或挂在物体名上（数值只走 readouts / `Phys.format`）',
  },
  {
    id: 'axis_box', name: '坐标轴框（v–t / p–V）', group: '图示',
    state: 'return {};',
    draw: "Draw.axisBox([-0.2, -0.2], 2.4, 4.4, { xLabel: 't', xUnit: 's', yLabel: 'v', yUnit: 'm/s' });",
    pitfall: '只写字母不写单位；量程盖不住数据（点跑出框外）',
  },
  {
    id: 'graph_wave', name: '波形 / 连续曲线', group: '图示',
    state: 'return {};',
    draw: 'Draw.curve([[0, 0], [0.5, 0.3], [1, 0], [1.5, -0.3]]);',
    pitfall: '采样点太少（折线感）；波形平移用重画新线而不是整条平移',
  },
  {
    id: 'chart', name: '图线 + 面积着色', group: '图示',
    state: 'return {};',
    draw: 'Draw.chart([[0, 0], [1, 2], [2, 4]], { fill: true, baseline: 0 });',
    pitfall: '面积全时段都填；符号题（readouts 无数值）就干脆不画图（应当用 setup 的示意值画，并在图注写"示意"）',
  },
  {
    id: 'orbit', name: '卫星 / 天体轨道', group: '图示',
    state: 'return { px: 1.2, py: 0 };',
    draw: 'Draw.arc([0, 0], 1.2, 0, 360);\nDraw.circle([state.px, state.py], 0.05);',
    pitfall: '椭圆轨道用匀角速度（应满足"相同时间扫过相同面积"）',
  },
  {
    id: 'cylinder_piston', name: '气缸 / 活塞', group: '图示',
    state: 'return { xp: 0.5 };',
    draw: 'Draw.box([0, 0.4], 0.24, 0.8);\nDraw.box([0, state.xp], 0.2, 0.04);',
    pitfall: '气体长度与活塞位置两处各算一次（必须同一个变量驱动）',
  },
  {
    id: 'gas_tube', name: '玻璃管 / 水银柱', group: '图示',
    state: 'return { yh: 0.3 };',
    draw: 'Draw.line([0, 0], [0, 1.2]);\nDraw.line([0.1, 0], [0.1, 1.2]);\nDraw.box([0.05, state.yh], 0.1, 0.2);',
    pitfall: '管口开/闭没区分；水银柱长度与气体长度不联动',
  },
  {
    id: 'raw_composite', name: '复合图形（碰撞/爆炸/火柴人）', group: '图示',
    state: 'return {};',
    draw: 'Draw.polygon([[-0.1, 0], [0.1, 0], [0.1, 0.2], [-0.1, 0.2]]);',
    pitfall: '把物理分支塞进 `Draw.raw` 的回调里（逃生门只画形状，Dry-Run 也验不到它）',
  },
];

/* ══════════════════════════════ ② 三份大类范文 ══════════════════════════════
 *
 * 每份都是**完整 8 槽位程序**，`verifyWorked()` 会真的跑 `dryRun()`，要求 verdict === 'pass'。
 * 数字都是算出来的（不是凑的）：注释里写了算法，改常量时 `SIM.duration` 与末步 `t1` 一起改。
 */
/**
 * ── 第 9 期：**三份范文下线**（用户 2026-10-18 裁决）──
 *
 * 原话：「不用留，相信大模型的能力」。
 *
 * 下线理由（不是"省字数"，是"职责已经被别人接走"）：
 *   ① 提示词里已有一份**验过的 8 槽位完整范例**（`core/prompts/golden-example.mjs`，
 *      由 `tools/_golden-probe.mjs` 用真判据跑过 C1–C9）——结构、槽位分工、RETURN/context、箭头 mag 全在里面；
 *   ② 元件已**一件一卡**（`93-elements.json`，每张写着"stateAt 里给什么、drawFrame 里写哪一行"）
 *      ——单个元件怎么画也已经被接走；
 *   ③ 剩下的"多段过程怎么切"由约定卡 `wb_scene_stages` 承担。
 *
 * ⇒ 动画槽的常驻卡从 3 张降为 **2 张**（坐标约定 + 元件总览）。
 *
 * ⚠ 原件（三个 C1–C9 全绿的程序）留在
 *   `_retired-worldbook/source-2026-10-18/build-animation-cards.mjs`，要恢复搬回来即可。
 *   下面的 `verifyWorked` / `renderProgram` / `WORKED_EXAMPLES` **刻意没删**：
 *   它们是校验工具，以后要加新范文时直接用。
 */
export const WORKED = [];

/* ══════════════════════════════ ③ 常驻风格约定卡 ══════════════════════════════ */

export const CONVENTIONS = `# 动画基本约定（常驻 · 任何题都适用）

这段代码由机器播放、机器量、机器对答案，所以"坐标、正方向、单位"必须**全片一套**。

## 坐标与尺寸
- **世界坐标**：x 向右、y 向上、单位米；视口由系统算，**不许写像素**（\`pixels_per_meter\`、\`canvas.width\`、\`getContext\` 一律判失败）。
- 长度就是题面的米数（板长 3 m 就画 3 m）；天文/微观用示意比例，并在图注写"示意图，未按比例"。
- 位置一律由物理量算出来（\`Draw.box([state.x, 0.15], …)\`），不要写死一屏坐标。

## 正方向（最容易翻车）
- 解析里定了哪个方向为正，代码里就同一个：向右为正 ⇒ 向左的速度写负值，\`state.v\` 可以是负数。
- 矢量的 \`vec\` 只表示**方向**（可带负号），**长度由 \`mag\` 决定**（真实量级）：
  \`state.v = -2\` 时写 \`vec: [state.v, 0]\` + \`mag: Math.abs(state.v)\` —— 箭头朝左、长度 ∝ 2。
- 角度：代码里用**弧度**；但 \`Draw.incline\` 的 \`angleDeg\`、\`Draw.arc\` 的 \`a0/a1\` 是**角度制**，两套别混。

## 单位、常量与时间
- 一律 SI（m、s、kg、N、J、A、V、T）；cm、km/h、eV、cmHg 在 \`setup()\` 里换算一次并写注释。
- 题面给的数（\`g\`、\`mu\`、\`L\`、\`R\`）在 \`setup()\` 里以**同名常量**出现；没给 \`g\` 就取 10 并写注释。**不许中途换值**（C7 要拿读数对答案）。
- \`t\` 单位秒，范围 \`[0, SIM.duration]\`；\`stateAt(t)\` 全程有定义、且 O(1)（解析式或查表，不在里面积分）。
- \`STEPS\` 的 \`t0/t1\` 首尾相接、不重叠，**末步 t1 = SIM.duration**（C5）；这个数写成一个字面量，注释给出算法。
- **槽位正文从第一行代码开始**：\`setup\` 的第一行就是 \`const …\`、\`readouts\` 的第一行就是 \`return [\`（函数头与收尾括号由装配器提供）。

## 读数（readouts）
- 每项 \`{ label, value, unit }\`；\`label\` 与 \`ANSWERS.symbol\` **逐字一致**（C7 就靠它）。
- 键集合与单位**全时段不变**（C8）；数值必须有限（C3：NaN / Infinity 直接判失败）。
- 画面上显示数值用 \`Phys.format(value, unit)\`；中文说明放数据面板，不挂在箭头上。
- **符号题（\`value: null\`）照样要画图**：图表数据取 \`setup()\` 里的示意取值，并在图注写"示意"；不要因为没有数值就把图省掉。

## 生成后自检（必须逐条在代码中体现）
- [ ] 全片没有像素量；每个 \`Draw.arrow\` 都有 \`category\` 与 \`mag\`，且没有 \`color\` / \`scale\`。
- [ ] \`SIM.duration\` 与 \`STEPS\` 末步 \`t1\` 是同一个数（C5）。
- [ ] \`readouts\` 的每个 \`label\` 都能在 \`ANSWERS.symbol\` 里找到（C7）。
- [ ] 角度在代码里是弧度；\`incline\` / \`arc\` 的角度制参数单独换算，两套单位没有混用。`;

/** 约定卡的示例：正方向取负值时，vec 给方向、mag 给量级 */
const CONVENTIONS_EXAMPLE = `// 正方向的正确写法：state.v 为负 ⇒ 箭头朝左，长度仍 ∝ |v|
setup: \`
  const v0 = 2;
  RETURN('v0', v0);
\`
stateAt: \`
  const v0 = context.v0;
  return { x: -v0 * t, v: -v0 };            // 向左运动 ⇒ 速度与位移都为负
\`
drawFrame: \`
  const p = [state.x, 0.15];
  Draw.ground(-2.4, 0.6);
  Draw.box(p, 0.4, 0.3);
  Draw.arrow(p, [state.v, 0], { category: 'velocity', mag: Math.abs(state.v), label: 'v', unit: 'm/s' });
\``;

/* ══════════════════════════════ ⑤ 生成 ══════════════════════════════ */

/** 把 slots 渲染成一份可粘贴的 8 槽位程序文本 */
export function renderProgram(slots) {
  return Object.entries(slots)
    .map(([k, v]) => `/* @slot:${k} */\n${v}\n/* @end */`)
    .join('\n\n');
}

function overviewContent() {
  /**
   * ⚠ 第 9 期：**总览里不再列 `text`**（用户裁决）。
   *
   * 方案 A 已经 `HIDE_CANVAS_TEXT = true` —— 画布上一律不写文字（`Draw.text` / `Draw.latex` /
   * 箭头标签 / 尺寸文字四处一起失效）。总览里还教 `Draw.text`，等于教一个**画不出任何东西**的调用；
   * 而画面只是"少了标注"，看起来像模型没画 —— 比报错更难查。
   *
   * `ELEMENTS` 里保留 `text` 这一条（它仍是 SDK 的合法原语），只是不进总览。
   */
  const listed = ELEMENTS.filter((e) => e.id !== 'text');
  const groups = [...new Set(listed.map((e) => e.group))];
  const L = [];
  L.push('# 动画元件总览（常驻）：每个元件怎么画');
  L.push('');
  L.push('用法：认出元件（题面有传送带就是 `belt`），位置来自 `state.*` 或 `setup` 算好的量。');
  L.push('下面每行都在校验器里真跑过（C1 + 实跑）。`state` 是 `stateAt(t)` 的返回值；读别的时刻用 `context.at(tt)`，');
  L.push('但它只能在 `drawFrame` / `readouts` 里用（写在 `stateAt` 里会无限递归）。');
  L.push('');
  L.push('> 每个元件的「最常错的地方」在它自己的那张卡里（一行一个元件，按需注入）——这里只留画法，不重复。');
  L.push('> ⚠ 方案 A 起**画布上不写任何文字**（`Draw.text` / `Draw.latex` / 箭头标签 / 尺寸文字都不显示），标注由画布外的图例承担。');
  L.push('');
  for (const g of groups) {
    L.push(`## ${g}`);
    for (const e of listed.filter((x) => x.group === g)) {
      const drawOne = e.draw.split('\n').map((s) => s.trim().replace(/;$/, '')).join('  ');
      L.push(`- \`${e.id}\` ${e.name}：\`${drawOne}\``);
    }
    L.push('');
  }
  L.push('## 生成后自检（必须逐条在代码中体现）');
  L.push('- [ ] 每个元件的位置都来自 `state.*` 或 `setup` 导出的量，没有写死一屏坐标。');
  L.push('- [ ] `Draw.arrow` 全部带 `mag`（真实量级），`vec` 只给方向；没有 `color` / `scale`。');
  L.push('- [ ] 跨槽位取值只用 `RETURN` + `context.X`，没有裸引用别的槽位的局部变量。');
  L.push('');
  return L.join('\n');
}

function workedContent(w) {
  const L = [];
  L.push(`# ${w.title}`);
  L.push('');
  L.push('> ⚠ 这是**别的题**的范文：只抄写法（结构、调用形状、槽位分工），不抄它的题面/数据/答案。');
  L.push('');
  L.push(w.intro);
  L.push('');
  L.push('## 完整程序（8 个槽位都在，已跑过 C1–C9 全绿）');
  L.push('```js');
  L.push(renderProgram(w.slots));
  L.push('```');
  L.push('');
  L.push('## 这份范文在教你什么');
  for (const t of w.teaches) L.push(`- ${t}`);
  L.push('');
  L.push('## 生成后自检（必须逐条在代码中体现）');
  L.push('- [ ] `SIM.duration` 与 `STEPS` 末步 `t1` 是**同一个字面量**（C5 逐点比对）。');
  L.push('- [ ] `stateAt(t)` 在 `[0, duration]` 全程有定义、且是 O(1)（没有在它里面积分）。');
  L.push('- [ ] `readouts` 的 `label` 与 `ANSWERS.symbol` 逐字一致，并在 `at_t` 时刻被复现（C7）；箭头都带 `mag`。');
  L.push('');
  return L.join('\n');
}

function cardEntry({ id, title, content, order, elements = [], keys = [], examples = [], constant = true }) {
  return {
    id,
    title,
    origin: 'builtin',
    category: 'scene_modeling',
    enabled: true,
    constant,
    recursive: false,
    keys,
    secondary_keys: { logic: 'AND_ANY', list: [] },
    concepts: [],
    tags: [],
    elements,
    insertion_slot: ['scene_code'],
    order,
    priority: 'high',
    content,
    code_examples: examples,
  };
}

/** 总览卡的示例：三个最常用元件的最小画法 */
const OVERVIEW_EXAMPLE = `// 三个最常用元件的最小画法（完整清单见正文）
stateAt: \`
  return { x: 0.6, yTop: 1.6 };
\`
drawFrame: \`
  Draw.incline([0, 0.6], { angleDeg: 30, length: 1.2 });
  Draw.box([state.x, 0.15], 0.4, 0.3);
  Draw.spring([0, 2.0], [0, state.yTop], { coils: 12 });
\``;

/** 三份范文各自"最值得抄的一段"（自足、能过 C1） */
const WORKED_EXAMPLES = {
  wb_anim_sample_mechanics: `// 最值得抄的一段：两段加速度不同 + 箭头只给方向、长度由 mag 决定
setup: \`
  const g = 10, mu = 0.2, theta = 30 * Math.PI / 180;
  const aUp = g * (Math.sin(theta) + mu * Math.cos(theta));
  const aDn = g * (Math.sin(theta) - mu * Math.cos(theta));
  RETURN('aUp', aUp); RETURN('aDn', aDn);
\`
stateAt: \`
  const aUp = context.aUp, aDn = context.aDn;
  return { v: t <= 0.5 ? -aUp * t : aDn * (t - 0.5) };
\`
drawFrame: \`
  const cT = Math.cos(30 * Math.PI / 180), sT = Math.sin(30 * Math.PI / 180);
  const dir = state.v >= 0 ? 1 : -1;
  Draw.arrow([0.6, 0.25], [dir * cT, -dir * sT], { category: 'velocity', mag: Math.abs(state.v), label: 'v', unit: 'm/s' });
\``,
  wb_anim_sample_fields: `// 最值得抄的一段：场区铺陈 + 洛伦兹力始终垂直于速度
stateAt: \`
  const w = 1, r = 1;
  return { x: r * Math.sin(w * t), y: r * (1 - Math.cos(w * t)), vx: Math.cos(w * t), vy: Math.sin(w * t) };
\`
drawFrame: \`
  Draw.fieldDots({ x: 0, y: 0, w: 1.2, h: 1.0 }, { symbol: 'cross', nx: 8, ny: 6 });
  const p = [state.x, state.y];
  Draw.circle(p, 0.05);
  Draw.arrow(p, [state.vx, state.vy], { category: 'velocity', mag: 1, label: 'v', unit: 'm/s' });
  Draw.arrow(p, [-state.vy, state.vx], { category: 'force', subtype: 'lorentz', mag: 1, label: 'F_L', unit: 'N' });
\``,
  wb_anim_sample_wave: `// 最值得抄的一段：先定坐标框，再用采样点画图线
setup: \`
  const A = 0.3, k = Math.PI, v = 1, xs = 0.5;
  RETURN('A', A); RETURN('k', k); RETURN('v', v); RETURN('xs', xs);
\`
stateAt: \`
  const A = context.A, k = context.k, v = context.v, xs = context.xs;
  return { y: A * Math.sin(k * (xs - v * t)) };
\`
drawFrame: \`
  const A = context.A, k = context.k, v = context.v;
  Draw.axisBox([-1.6, -0.5], 3.2, 1.0, { xLabel: 'x', xUnit: 'm', yLabel: 'y', yUnit: 'm' });
  Draw.curve([[0, A * Math.sin(k * (0 - v * t))], [1, A * Math.sin(k * (1 - v * t))], [2, A * Math.sin(k * (2 - v * t))]]);
\``,
};

/**
 * 三份范文的**触发条件**（第 8 期 · 用户 2026-10-18 裁决「解决预算」）。
 *
 * 为什么不再全部 `constant: true`：常驻卡合计 14950 字，把 24000 的槽位预算吃掉 62%，
 * 于是"这道题真正要用的元件卡"被挤掉、示例一条也进不来（用户真题实测：**正文余量只剩 32 字**，
 * 连"坐标系与图线"那张卡都被丢弃 ⇒ 模型压根不知道要画图）。
 *
 * 所以：**力学范文保持常驻**（最常见，随时要有一份完整范式可抄），
 * 另两份改成**按元件触发** —— 只有题里真出现那些元件/判定时才注入。
 * 这比"按题型关键词触发"可靠：元件是读题阶段从图上判出来的，不依赖措辞。
 */
const SAMPLE_TRIGGERS = {
  wb_anim_sample_fields: {
    elements: ['field_region', 'plates', 'circuit', 'rod', 'ray', 'lens'],
  },
  wb_anim_sample_wave: {
    elements: ['graph_wave', 'axis_box', 'chart', 'trace_path', 'orbit'],
  },
};

export function buildCards() {
  return [
    cardEntry({
      id: 'wb_anim_conventions',
      title: '动画常驻·坐标与正方向（世界坐标 / 单位 / 时间 / 读数口径）',
      content: CONVENTIONS,
      order: 1,
      examples: [CONVENTIONS_EXAMPLE],
    }),
    cardEntry({
      id: 'wb_anim_elements_overview',
      title: '动画常驻·元件总览（30 个元件的最小画法，全部实测过）',
      content: overviewContent(),
      order: 2,
      // ⚠ `elements` 只能写词表里的正式 id（`contracts/worldbook-concepts.json`）。
      //   本表里额外画的 `text` 是**标注原语**、不是动画元件，所以不进这个字段。
      elements: OFFICIAL_ELEMENT_IDS,
      examples: [OVERVIEW_EXAMPLE],
    }),
    ...WORKED.map((w, i) => {
      const trigger = SAMPLE_TRIGGERS[w.id] ?? null;
      return cardEntry({
        id: w.id,
        title: w.title,
        content: workedContent(w),
        order: 3 + i,
        // 力学范文（order 3）没有 trigger ⇒ 常驻；另两份按元件触发
        constant: trigger === null,
        elements: trigger ? trigger.elements : [],
        examples: [WORKED_EXAMPLES[w.id]],
      });
    }),
  ];
}

/** 常驻卡（`constant: true`）的 id —— 测试与文档都引用这一份，避免"哪几张是常驻"靠记 */
export function constantCardIds() {
  return buildCards().filter((c) => c.constant).map((c) => c.id);
}

/* ══════════════════════════════ ⑥ 校验 ══════════════════════════════ */

const BASE_SLOTS = {
  PROBLEM: '（校验占位）',
  STEPS: 'title: s\ntex: x\nt0: 0\nt1: 2',
  ANSWERS: 'symbol: x\nvalue: 1\nunit: m\nat_t: 2\nstep: 1',
  VIEW: 'SIM = { duration: 2 };',
  setup: 'const g = 10;',
  readouts: "return [{ label: 'x', value: 1, unit: 'm' }];",
};

/** 单条元件画法：C1 + 真跑一遍（命令必须画出来） */
export async function verifyElement(e) {
  const slots = { ...BASE_SLOTS, stateAt: e.state, drawFrame: e.draw };
  const out = await dryRun({ slots, entry: `element:${e.id}`, meta: { forceBackend: 'vm-fallback' } });
  const r = out.report;
  const ok = r.verdict === 'pass' || r.verdict === 'pass-with-warnings';
  const cmds = r.observations?.maxCommandsPerFrame ?? 0;
  const problems = [];
  if (!ok) {
    for (const c of r.checks) {
      for (const d of c.diagnostics ?? []) problems.push(`${c.id}:${d.rule} ${String(d.message).slice(0, 100)}`);
      if (c.status === 'fail' && !(c.diagnostics ?? []).length) problems.push(`${c.id} ${String(c.detail).slice(0, 100)}`);
    }
  }
  if (ok && !(cmds > 0)) problems.push('一条命令都没画出来（画法没生效）');
  return { ok: problems.length === 0, verdict: r.verdict, commands: cmds, problems };
}

/** 一份范文：必须 verdict === 'pass'（不是 pass-with-warnings） */
export async function verifyWorked(w) {
  const out = await dryRun({ slots: w.slots, entry: `worked:${w.id}`, meta: { forceBackend: 'vm-fallback' } });
  const r = out.report;
  const problems = [];
  if (r.verdict !== 'pass') {
    for (const c of r.checks) {
      for (const d of c.diagnostics ?? []) problems.push(`${c.id}:${d.rule} ${String(d.message).slice(0, 120)}`);
      if (c.status === 'fail' && !(c.diagnostics ?? []).length) problems.push(`${c.id} ${String(c.detail).slice(0, 120)}`);
    }
  }
  return { ok: problems.length === 0, verdict: r.verdict, problems };
}

async function checkAll() {
  let bad = 0;
  for (const e of ELEMENTS) {
    const r = await verifyElement(e);
    if (!r.ok) {
      bad += 1;
      console.log(`✗ 元件 ${e.id}：${r.verdict}｜${r.problems.join(' ｜ ')}`);
    }
  }
  console.log(`元件画法：${ELEMENTS.length - bad}/${ELEMENTS.length} 通过（C1 + 实跑）`);

  // 覆盖率：词表里的每个元件都必须在 ELEMENTS 里有一行（新增元件忘了补画法，这里必须红）
  const have = new Set(ELEMENTS.map((e) => e.id));
  const uncovered = OFFICIAL_ELEMENT_IDS.filter((id) => !have.has(id));
  if (uncovered.length) {
    bad += uncovered.length;
    console.log(`✗ 动画元件词表里有 ${uncovered.length} 个元件没有画法：${uncovered.join(', ')}`);
  }
  const extra = [...have].filter((id) => !OFFICIAL_ELEMENT_IDS.includes(id));
  if (extra.length) console.log(`  （额外画的非元件原语：${extra.join(', ')} —— 不进 elements 字段，只作教学）`);

  let badW = 0;
  for (const w of WORKED) {
    const r = await verifyWorked(w);
    if (!r.ok) {
      badW += 1;
      console.log(`✗ 范文 ${w.id}：${r.verdict}｜${r.problems.join(' ｜ ')}`);
    }
  }
  console.log(`大类范文：${WORKED.length - badW}/${WORKED.length} 通过（C1–C9 全绿）`);

  // 常驻卡与全部卡的字数（决定"命中词条还剩多少额度"）
  const cards = buildCards();
  const chars = cards.reduce((n, c) => n + c.content.length, 0);
  const constantChars = cards.filter((c) => c.constant).reduce((n, c) => n + c.content.length, 0);
  console.log(
    `各卡字数：${cards.map((c) => `${c.id.replace('wb_anim_', '')}=${c.content.length}${c.constant ? '' : '(条件)'}`).join(' · ')}`,
  );
  if (constantChars > MAX_CONSTANT_CHARS) {
    bad += 1;
    console.log(
      `✗ 常驻卡正文合计 ${constantChars} 字，超过上限 ${MAX_CONSTANT_CHARS}：` +
        '无条件注入的部分越多，"讲这道题的那几张"越容易被槽位预算挤掉（静默变差）。',
    );
  } else {
    console.log(`常驻卡正文合计 ${constantChars} 字（上限 ${MAX_CONSTANT_CHARS}；槽位预算 32000）`);
  }
  if (chars > MAX_CARD_CHARS) {
    bad += 1;
    console.log(`✗ 五张卡正文合计 ${chars} 字，超过上限 ${MAX_CARD_CHARS}。`);
  } else {
    console.log(`五张卡正文合计 ${chars} 字（上限 ${MAX_CARD_CHARS}）`);
  }

  return bad + badW === 0;
}

/* ══════════════════════════════ ⑦ main ══════════════════════════════ */

function writeCards() {
  const pack = { format: 'od-worldbook', version: 1, entries: buildCards() };
  writeFileSync(CARD_FILE, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  return pack.entries.length;
}

/* ══════════════════════════════ ④′ 元件卡：**一件一卡**（第 9 期） ══════════════════════════════
 *
 * 用户 2026-10-18 裁决的目标状态：动画槽的元件**一件一卡**。
 * 所以本脚本除了 92 的 5 张教学卡，还生成 `93-elements.json` —— **词表里的每个元件一张卡**，
 * 卡片 id 由元件 id 派生（`wb_el_<id>`），`elements` 只放它自己那一个。
 *
 * 为什么由脚本生成而不是手写 30 份 JSON：
 *   ① 卡片里的 `state` / `draw` 两段**就是** `ELEMENTS` 里被 `checkAll()` 逐条 lint + 实跑过的程序，
 *      手抄一遍必然漂移（"卡片里写了一套、验的是另一套"）；
 *   ② "一件一卡"这件事本身因此变成**可机检**：卡数 == 元件数、卡 id 与元件 id 一一对应。
 *
 * ⚠ 词表里加一个元件而 `ELEMENTS` 没补画法 ⇒ `checkAll()` 会红（它按词表逐条要画法）。
 */

export const ELEMENT_CARD_FILE = join(SOURCE_DIR, '93-elements.json');

/** 元件名 → 触发词（去掉括注，按「 / 」切开） */
function elementKeys(el) {
  return String(el.name)
    .replace(/（[^）]*）/g, '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 一张元件卡：判据 → 状态与画法 → 最常错 → 两条铁律 → 生成后自检 */
function elementCardContent(el) {
  const ks = elementKeys(el);
  return [
    `# 元件·${el.name}（${el.group}）`,
    '',
    '## 判据',
    `题面或配图里出现${ks.map((k) => `「${k}」`).join('')}这类东西时画这一件。`,
    '',
    '## 状态与画法',
    `- stateAt 里写：${el.state}`,
    `- drawFrame 里写：${el.draw}`,
    '',
    '## 这条元件最常错的地方',
    el.pitfall,
    '',
    '## 两条铁律（所有元件都适用）',
    '- state.* 的键名必须就是 stateAt(t) 返回的键名（名字不一致读到 undefined，最终 NaN 被 C3 拦下）。',
    '- 跨槽位读常量用 context.X；读别的时刻用 context.at(tt)，且只能在 drawFrame / readouts 里用。',
    '',
    '## 生成后自检（必须逐条在代码中体现）',
    '- [ ] stateAt 返回的键名与 drawFrame 里读的完全一致。',
    '- [ ] 坐标是米，没有像素量与像素比例。',
    '- [ ] 静态几何在 setup() 里算一次，不逐帧重算。',
  ].join('\n');
}

/** 30 张元件卡（id / elements / keys 全部由 `ELEMENTS` 派生，不可能漏项或串项）
 *
 * ⚠ 只取**官方词表里**的元件：`ELEMENTS` 里还有一条 `text`（标注原语，不在 30 个 id 之内），
 *   它的画法只进「元件总览」那张教学卡。若给 `text` 也建卡，`elements: ['text']` 就是表外值，
 *   `validateEntry` 会直接拒绝生成（§9.1 的表外值判据）。
 */
export function buildElementCards() {
  return ELEMENTS.filter((el) => OFFICIAL_ELEMENT_IDS.includes(el.id)).map((el, i) => ({
    id: `wb_el_${el.id}`,
    title: `元件·${el.name}`,
    origin: 'builtin',
    category: 'scene_modeling',
    enabled: true,
    constant: false,
    recursive: false,
    keys: elementKeys(el),
    secondary_keys: { logic: 'AND_ANY', list: [] },
    concepts: [],
    tags: [],
    elements: [el.id],
    insertion_slot: ['scene_code'],
    order: 900 + i,
    priority: 'high',
    content: elementCardContent(el),
    code_examples: [`drawFrame: \`\n  ${el.draw}\n\``],
  }));
}

function writeElementCards() {
  const pack = { format: 'od-worldbook', version: 1, entries: buildElementCards() };
  writeFileSync(ELEMENT_CARD_FILE, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  return pack.entries.length;
}

/** 盘上的卡片文件是否与"现在这份生成器会写出的内容"逐条一致 */
function sameAsGenerator(file, expected) {
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  const want = expected.map((e) => e.id);
  const missing = want.filter((w) => !pack.entries.some((e) => e.id === w));
  if (missing.length) return { ok: false, why: `缺 ${missing.join(', ')}` };
  const onDisk = JSON.stringify(pack.entries.map((e) => [e.id, e.content]));
  const now = JSON.stringify(expected.map((e) => [e.id, e.content]));
  if (onDisk !== now) return { ok: false, why: '正文与生成器不一致' };
  return { ok: true, why: '' };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const ok = await checkAll();
  if (!ok) {
    console.error('\n✗ 有画法/范文没过校验 —— 先修内容，不要生成卡片。');
    process.exitCode = 1;
    return;
  }

  const targets = [
    { file: CARD_FILE, label: '92-animation-core.json', build: buildCards },
    { file: ELEMENT_CARD_FILE, label: '93-elements.json（一件一卡）', build: buildElementCards },
  ];

  if (checkOnly) {
    let bad = false;
    for (const t of targets) {
      const r = sameAsGenerator(t.file, t.build());
      if (!r.ok) {
        bad = true;
        console.error(`✗ ${t.label} ${r.why} ⇒ 请跑 node tools/build-animation-cards.mjs（不要手改产物）`);
      }
    }
    if (bad) {
      process.exitCode = 1;
      return;
    }
    console.log(`✓ 92 的 5 张教学卡与 ${buildElementCards().length} 张元件卡都与生成器一致`);
    return;
  }

  const n = writeCards();
  const m = writeElementCards();
  console.log(`✓ 已写出常驻动画卡片 ${n} 条 → core/worldbook/source/92-animation-core.json`);
  console.log(`✓ 已写出元件卡 ${m} 条（一件一卡）→ core/worldbook/source/93-elements.json`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  try {
    await main();
  } catch (err) {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exitCode = 1;
  }
}