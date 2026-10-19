#!/usr/bin/env node
/**
 * layout-lint —— 对"打包后的成品页"做静态体检。
 *
 * 覆盖 §3.1 / §15 / 技术契约里**能用静态检查判定**的硬性要求：
 *   · 三栏顺序（.col-problem → .col-steps → .col-animation）且不可调换；
 *   · 解析栏禁止内部滚动（不出现 overflow-y: auto/scroll）；整页滚动；
 *   · 公式容器不得依赖裁切（用 overflow-x: clip，不用 hidden 掩盖溢出）；
 *   · 每个可聚焦元素类都有 :focus-visible；
 *   · 模板页自包含：不得出现 http(s):// 外链、不得有 <script src>、<link href>、@import；
 *   · data-od-id 覆盖所有区域、标题、CTA、控件与重复卡片；
 *   · 无残留占位符、无未闭合的 script/style；
 *   · **内联脚本能当经典脚本执行**（语法 + 真跑一遍运行时，必须产出 `window.ODRuntime`）。
 * 最后一条是白屏事故的防线：占位符替换得再干净，只要运行时脚本里混进一句 `import`，
 * 浏览器就是"空白页 + 运行时未注入"，而前面的静态检查全都看不出来。
 * 像素级结果仍需真实浏览器（用户双击 HTML）；本检查只保证"结构上不可能违反"。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { parseStepsSlot } from '../sdk/runtime/animation-runtime.mjs';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = join(PROJECT_ROOT, 'template', 'build');

const REQUIRED_SECTIONS = [
  'col-problem',
  'col-steps',
  'col-animation',
  'problem-body',
  'steps-list',
  'stage-canvas',
  'transport',
  'timeline',
  'rate-select',
  'btn-play',
  /* 第 7 期：画布外层、联动图表面板与画布、量选择按钮。
     ⚠ `readouts-grid` / `panel-step-title` 已从清单里**删掉**：用户 2026-10-17 裁决
       "这部分'动画说明'删掉不要"，数据面板整块（步标题 / 本步结论 / 逐步读数卡片 / 脚注）
       已从模板移除，位置让给曲线图。这是对方案 §15 的一处有意偏离，记在第 7 期交付说明里。 */
  'stage-wrap',
  'chart-panel',
  'chart-canvas',
  'chart-picks',
  /* 第 7 期（版式升级）：原题 + 分步解析合并成左侧单一导读栏，
     两页以上靠选项卡切换。`col-text` 是那一栏本身；
     `col-problem` / `col-steps` 仍在（变成导读栏里的两个面板），
     所以上面的"三栏顺序"判据继续有效，不用改。 */
  'col-text',
];

const REQUIRED_CONTROLS = [
  'btn-prev-step',
  'btn-next-step',
  'btn-reset',
  'vector-tools',
  /* 第 7 期新增：图表关闭按钮、栏位显隐开关、导读栏选项卡、"跟随"开关 */
  'btn-chart-close',
  'col-toggles',
  'text-tabs',
  'follow-toggle',
];

/**
 * @param {string} file 被检查的 HTML
 * @param {'app'|'entry'} kind app = 模板/题目成品页（全部规则）；entry = 入口页（总览 / gallery，只查通用规则）
 */
function check(file, kind = 'app') {
  const html = readFileSync(file, 'utf8');
  const problems = [];
  const isApp = kind === 'app';

  // 三栏顺序（仅成品页）
  if (isApp) {
    const order = REQUIRED_SECTIONS.slice(0, 3).map((id) => html.indexOf(`data-od-id="${id}"`));
    if (order.some((i) => i < 0)) problems.push('缺少三栏之一');
    else if (!(order[0] < order[1] && order[1] < order[2])) problems.push('三栏顺序被调换');
  }

  // 内部滚动（仅成品页）
  if (isApp) {
    if (/\.col-steps[^}]*overflow(-y)?\s*:\s*(auto|scroll)/.test(html)) problems.push('解析栏出现内部滚动');
    if (/\.steps\s*\{[^}]*overflow(-y)?\s*:\s*(auto|scroll)/.test(html)) problems.push('.steps 出现内部滚动');
  }

  /* 第 7 期版式定案（§13.4 / §14 / §15）；第 9 期 v1.1.5 按用户裁决改了口径：
     ① 画布**不再锁 16:9**（用户 2026-10-19 方案 B：比例尺优先，GIF 让步）——
        宽度吃满右栏；高度**吃栏高**（用户同日二次拍板「高度也吃栏高，不写死」），
        由 `.col-animation → .stage-wrap → .stage → canvas` 的 flex 链分配，
        不再写 `100vh − --chrome-h` 这种硬账。GIF 仍按 §14 的 960×540 输出。
     ② 画布**不许写死像素高度**（`min-height` 只允许做窄屏兜底；`height: Npx` 一律不许）。
     ③ 图表是独立面板，必须能被 [hidden] 收起（§13.4"可显隐"）。
     ④ 曲线图 v1.1.5 搬进左栏（用户 2026-10-19 截图裁决），**不再占右栏画布的位置**；
        它必须出现在 col-text 之内、col-animation 之前。
     ⑤ 三栏容器必须是 flex —— grid 的轨道是固定条数，隐藏一栏会留下一条空列，
        "剩余两栏自动变大"就不成立。*/
  if (isApp) {
    if (/\.stage-canvas\s*\{[^}]*\baspect-ratio\b/.test(html)) {
      problems.push('.stage-canvas 又锁了 aspect-ratio（v1.1.5 方案 B 已裁决不锁 16:9）');
    }
    if (!/\.stage-canvas\s*\{[^}]*\bwidth\s*:\s*100%/.test(html)) {
      problems.push('.stage-canvas 没有吃满栏宽（width: 100%，v1.1.5 方案 B）');
    }
    if (!/\.stage-canvas\s*\{[^}]*\bflex\s*:\s*1/.test(html)) {
      problems.push('.stage-canvas 没有用 flex 吃满右栏剩余高度（v1.1.5「高度也吃栏高」）');
    }
    if (
      !/\.col-animation\s*\{[^}]*display\s*:\s*flex[^}]*flex-direction\s*:\s*column/.test(html) ||
      !/\.stage-wrap\s*\{[^}]*flex\s*:\s*1/.test(html) ||
      !/\.stage\s*\{[^}]*flex\s*:\s*1/.test(html)
    ) {
      problems.push('画布高度链断了（.col-animation / .stage-wrap / .stage 必须都是 flex:1 的竖向链）');
    }
    /* ⚠ `min-height: 240px` 是窄屏兜底，不算"写死高度"；只拦精确的 `height: Npx`。 */
    if (/\.stage-canvas\s*\{[^}]*[;{\s]height\s*:\s*\d+(?:\.\d+)?px/.test(html)) {
      problems.push('.stage-canvas 写死了像素高度（高度应交由右栏 flex 链分配）');
    }
    if (!/\.chart-panel\[hidden\]\s*\{\s*display\s*:\s*none/.test(html)) {
      problems.push('.chart-panel 缺少 [hidden] 规则（曲线图无法隐藏）');
    }
    if (!/\.board\s*\{[^}]*display\s*:\s*flex/.test(html)) {
      problems.push('.board 不是 flex（隐藏栏位后剩余栏不会自动变大）');
    }
    /* ⑤ 曲线图在左栏（col-text）里、动画栏（col-animation）之前。
       用户 2026-10-19 截图裁决：放左下空白处，不占右栏画布位置。 */
    {
      const textAt = html.indexOf('data-od-id="col-text"');
      const chartAt = html.indexOf('data-od-id="chart-panel"');
      const animationAt = html.indexOf('data-od-id="col-animation"');
      if (textAt < 0 || chartAt < 0 || animationAt < 0) problems.push('缺少导读栏 / 图表面板 / 动画栏之一');
      else if (!(textAt < chartAt && chartAt < animationAt)) {
        problems.push('曲线图不在左栏底部（应位于 col-text 内、col-animation 之前）');
      }
    }
  }

  // 公式容器不得用裁切掩盖溢出
  if (/\.tex\s*\{[^}]*overflow\s*:\s*hidden/.test(html)) problems.push('公式容器用 overflow:hidden 掩盖溢出');

  // 焦点环（仅成品页：入口页是纯链接列表，规则不同）
  if (isApp) {
    if (!/\.step:focus-visible/.test(html)) problems.push('步骤卡片缺 :focus-visible');
    if (!/\.btn:focus-visible/.test(html)) problems.push('按钮缺 :focus-visible');
    if (!/\.card-link:focus-visible|\.step:focus-visible/.test(html)) problems.push('可点击元素普遍缺焦点环');
  }

  // 自包含
  const external = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/g);
  if (external) problems.push(`出现外部资源：${external.slice(0, 3).join(' , ')}`);
  if (/@import\s+url\(/.test(html)) problems.push('出现 @import 外链');
  if (/<script[^>]+src=/i.test(html)) problems.push('出现 <script src>');

  // data-od-id 覆盖（仅成品页）
  const ids = new Set([...html.matchAll(/data-od-id="([^"]+)"/g)].map((m) => m[1]));
  if (isApp) {
    for (const id of [...REQUIRED_SECTIONS, ...REQUIRED_CONTROLS]) {
      if (!ids.has(id)) problems.push(`缺少 data-od-id="${id}"`);
    }
    const stepIds = [...ids].filter((id) => /^step-\d+$/.test(id));
    const stepIdsRuntime = /setAttribute\(\s*'data-od-id'\s*,\s*'step-/.test(html);
    if (!stepIds.length && !stepIdsRuntime) problems.push('步骤卡片缺少唯一 data-od-id（静态或运行时生成）');
  }

  // 结构完整性：只检查**模板侧**是否残留未替换的构建占位符，
  // 运行时源码里出现 `__OD_SLOT_*` 是数据槽位的内部标记（正常）。
  const placeholder = html.match(/__(?:OD_TITLE|OD_PROVENANCE|OD_RUNTIME|OD_TEX_RENDERER|OD_PROGRAM|OD_TEX_GLYPHS)__/);
  if (placeholder) problems.push(`残留构建占位符：${placeholder[0]}`);
  const scriptOpen = (html.match(/<script\b/g) || []).length;
  const scriptClose = (html.match(/<\/script>/g) || []).length;
  if (scriptOpen !== scriptClose) problems.push(`<script> 未闭合（${scriptOpen} vs ${scriptClose}）`);
  const styleOpen = (html.match(/<style\b/g) || []).length;
  const styleClose = (html.match(/<\/style>/g) || []).length;
  if (styleOpen !== styleClose) problems.push(`<style> 未闭合（${styleOpen} vs ${styleClose}）`);

  // 公式：题目页必须内联构建期 MathJax 预渲染结果（§2.2 的观感要求）
  const isQuestionPage = /"id":"q\d\d-/.test(html);
  const glyphCount = (html.match(/<path id="MJX/g) || []).length;
  const useCount = (html.match(/<use /g) || []).length;
  const mathRenderer = /"renderer":"(mathjax-full[^"]*)"/.exec(html);
  if (isQuestionPage) {
    if (!html.includes('id="od-mathjax-glyphs"')) problems.push('缺少内联字形表（MathJax 预渲染未注入）');
    if (!glyphCount) problems.push('字形表为空');
    if (!useCount) problems.push('未引用任何字形（公式可能未预渲染）');
    if (!mathRenderer) problems.push('Provenance 未记录公式渲染器');
    if (/<mjx-container/.test(html) === false) problems.push('载荷里没有 MathJax 输出（预渲染缺失）');
  }
  // 外链检查要排除 SVG 命名空间（xmlns 是声明，不是请求）
  const externalAllowed = html.replace(/xmlns(:\w+)?="[^"]*"/g, '');
  if (/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/i.test(externalAllowed)) {
    problems.push('出现真正的外部资源引用');
  }

  // 内联脚本必须能当**经典脚本**跑（白屏防线，见文件头注释）
  const bootCheck = checkInlineScripts(html, isApp);
  problems.push(...bootCheck.problems);

  // 相对链接不得失效：入口页 → 成品页、成品页 → 彼此/入口。
  // 之前 gallery.html 写成 `../template/build/…`（少退一级），15 个链接全指向不存在的路径。
  const missingLinks = checkLinks(file, html);
  problems.push(...missingLinks);

  // 步进导航（"下一步/上一步"）必须逐级走得动
  problems.push(...checkStepNav(html));

  return {
    file,
    problems,
    ids: ids.size,
    sizeKb: html.length / 1024,
    glyphCount,
    useCount,
    mathRenderer: mathRenderer?.[1] ?? null,
    scripts: bootCheck.scripts,
    runtimeExports: bootCheck.runtimeExports,
    links: [...html.matchAll(/href="([^"]+)"/g)].length,
  };
}

/** 检查页面内的相对链接目标是否存在（外链、锚点、mailto 跳过） */
function checkLinks(file, html) {
  const out = [];
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|#|data:)/.test(href)) continue;
    const target = resolve(dirname(file), href.split('#')[0]);
    if (!existsSync(target)) out.push(`相对链接失效：${href}`);
  }
  return out;
}

/** 从成品页里抠出 `indexOfStep` 的真实源码（按大括号配对，避免正则截断） */
function extractIndexOfStep(html) {
  const start = html.indexOf('function indexOfStep(');
  if (start < 0) return null;
  let depth = 0;
  let i = html.indexOf('{', start);
  for (; i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return html.slice(start, i + 1);
}

/**
 * "上一步/下一步"必须逐级走得动，且走得到结尾、回得到起点。
 *
 * 用户反馈"下一步点击无效果"：根因是 `indexOfStep` 用 `t0 ≤ t ≤ t1` 的**闭区间**判定，
 * 停在边界（t = 该步 t1 = 下一步 t0）时永远返回上一步 ⇒ 连点无效。
 * 这里用**成品页里的真实函数源码** + 该题的 STEPS 模拟连点，测的是出厂字节。
 */
function checkStepNav(html) {
  const problems = [];
  if (!/"id":"q\d\d-/.test(html)) return problems; // 只对题目页做
  const src = extractIndexOfStep(html);
  if (!src) return ['成品页里找不到 indexOfStep（步进导航未实装）'];
  let payload;
  try {
    const start = html.indexOf('PROGRAM_DATA = ') + 'PROGRAM_DATA = '.length;
    payload = JSON.parse(html.slice(start, html.indexOf(';\n', start)));
  } catch (err) {
    return [`无法解析 PROGRAM_DATA：${err.message}`];
  }
  const steps = parseStepsSlot(payload.slots.STEPS);
  const dur = Number((payload.slots.VIEW.match(/duration:\s*([\d.]+)/) || [])[1]);
  if (!Number.isFinite(dur)) return ['无法从 VIEW 里读出 duration'];
  // eslint-disable-next-line no-new-func
  const indexOfStep = new Function('STEPS', `${src}\nreturn indexOfStep;`)(steps);

  const forward = [0];
  let t = 0;
  for (let k = 0; k <= steps.length; k += 1) {
    const i = indexOfStep(t);
    t = i >= steps.length - 1 ? dur : steps[i + 1].t0;
    forward.push(t);
  }
  const missed = steps.slice(1).filter((s) => !forward.some((x) => Math.abs(x - s.t0) < 1e-9));
  if (missed.length) problems.push(`"下一步"跳不到这些步：${missed.map((s) => s.t0).join('、')}`);
  if (Math.abs(forward[forward.length - 1] - dur) > 1e-9) problems.push(`"下一步"走不到结尾（停在 ${forward[forward.length - 1]}，duration = ${dur}）`);

  let back = dur;
  let backToZero = false;
  for (let k = 0; k <= steps.length; k += 1) {
    const i = indexOfStep(back);
    const target = i > 0 && Math.abs(back - steps[i].t0) < 1e-6 ? i - 1 : i;
    back = Math.max(0, steps[target].t0);
    if (back < 1e-9) backToZero = true;
  }
  if (!backToZero) problems.push('"上一步"回不到起点');
  return problems;
}

/**
 * 逐个内联 `<script>` 做两件事：
 *   1. `new vm.Script(...)` 语法检查（经典脚本口径，`import` 会当场报错）；
 *   2. 把"运行时那段"真正跑一遍（喂一个 `window` 空壳），断言产出 `window.ODRuntime`
 *      且带 `assembleProgramSource` / `createPlayerFromFactory` —— 这正是模板页 boot() 的前置条件。
 * 只跑**第一段长度 > 20 KB 的脚本**（= 注入的运行时），避免需要完整 DOM 的模板脚本。
 */
function checkInlineScripts(html, isApp = true) {
  const problems = [];
  const scripts = [];
  let runtimeExports = null;
  let runtimeCopies = 0;
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  let index = 0;
  while ((m = re.exec(html))) {
    index += 1;
    const attrs = m[1].trim();
    const code = m[2];
    const isModule = /type\s*=\s*["']module["']/.test(attrs);
    let syntax = null;
    if (!isModule) {
      try {
        new vm.Script(code, { filename: `inline-script#${index}` });
      } catch (err) {
        syntax = err.message;
      }
    }
    scripts.push({ index, bytes: code.length, isModule, syntax });
    if (syntax) {
      problems.push(`内联脚本 #${index} 不是合法经典脚本：${syntax}`);
      const suspects = code
        .split('\n')
        .map((l, n) => [n + 1, l])
        .filter(([, l]) => /^\s*(import|export)\b/.test(l))
        .slice(0, 3);
      for (const [n, l] of suspects) problems.push(`  第 ${n} 行：${l.trim().slice(0, 90)}`);
    }
    // 运行时脚本：长度阈值 + 含 Runtime 导出面
    if (!isModule && !syntax && code.length > 20000 && code.includes('window.ODRuntime = Runtime')) {
      runtimeCopies += 1;
      const sandbox = { window: {}, globalThis: undefined, console };
      sandbox.globalThis = sandbox;
      try {
        vm.createContext(sandbox);
        new vm.Script(code, { filename: 'runtime-inline' }).runInContext(sandbox);
        const RT = sandbox.window.ODRuntime;
        if (!RT) problems.push('运行时脚本执行后没有产出 window.ODRuntime（页面会白屏）');
        else {
          const need = ['assembleProgramSource', 'sandboxBundle', 'createPlayerFromFactory'];
          const missing = need.filter((k) => typeof RT[k] !== 'function');
          if (missing.length) problems.push(`window.ODRuntime 缺少模板页必需的方法：${missing.join('、')}`);
          runtimeExports = Object.keys(RT).length;
        }
      } catch (err) {
        problems.push(`运行时脚本执行即抛错：${err.message}`);
      }
    }
  }
  if (isApp && !scripts.length) problems.push('页面里没有任何 <script>（运行时没注入）');
  // 运行时必须**恰好一份**：0 份 = 没注入（白屏）；≥2 份 = 模板注释里的占位符也被替换了，
  // 每页白白多背 60 KB，而且运行时代码一旦出现 `-->` 会把 HTML 注释提前闭合。
  if (isApp) {
    const runtimeMarks = (html.match(/window\.ODRuntime = Runtime/g) || []).length;
    if (runtimeMarks !== 1) {
      problems.push(`运行时注入份数为 ${runtimeMarks}（应为 1）：模板里的占位符可能在注释区被一并替换了`);
    }
  }
  return { problems, scripts, runtimeExports };
}

export function main() {
  const entryPages = [
    join(PROJECT_ROOT, '物理动画原型总览.html'),
    join(PROJECT_ROOT, 'tests', 'regression-15', 'gallery.html'),
  ].filter((p) => existsSync(p));
  const files = [...readdirSync(BUILD_DIR).filter((f) => f.endsWith('.html')).map((f) => join(BUILD_DIR, f)), ...entryPages].sort();
  let bad = 0;
  console.log('layout-lint · 成品页静态体检');
  for (const file of files) {
    const name = file.replace(/\\/g, '/').split('/').slice(-2).join('/');
    const r = check(file, entryPages.includes(file) ? 'entry' : 'app');
    if (r.problems.length) bad += 1;
    console.log(
      `  ${r.problems.length ? '✗' : '✓'} ${name.padEnd(34, ' ')} ${r.sizeKb.toFixed(0).padStart(4)} KB · data-od-id ${String(r.ids).padStart(2)} 个` +
        (r.glyphCount ? ` · MathJax 字形 ${String(r.glyphCount).padStart(3)} 个 / 引用 ${r.useCount}` : '') +
        (r.scripts.length ? ` · 内联脚本 ${r.scripts.length} 段（运行时导出 ${r.runtimeExports ?? '—'} 项）` : '') +
        ` · 链接 ${r.links}` +
        (r.problems.length ? `\n      ${r.problems.join('\n      ')}` : ''),
    );
  }
  console.log(
    bad
      ? `\n✗ ${bad}/${files.length} 个页面未通过静态体检`
      : `\n✓ ${files.length} 个页面全部通过静态体检（自包含 / 三栏 / 焦点环 / 无内部滚动 / 公式内联 / ` +
        `**内联脚本可当经典脚本执行** / **相对链接有效**）`,
  );
  if (bad) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  Promise.resolve(main()).catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
