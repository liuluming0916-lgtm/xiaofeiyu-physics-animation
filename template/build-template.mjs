#!/usr/bin/env node
/**
 * template:build —— 把「模板页骨架 + 运行时 + AnimationProgram」打成单文件 HTML。
 *
 * 产物（每个都可双击离线播放，无任何外部请求）：
 *   template/build/animation-template.html      空壳模板（无题目，供第 3 期宿主注入）
 *   template/build/<question-id>.html           15 道题的成品页
 *   tests/regression-15/gallery.html            15 道题的播放列表（回归目视入口）
 *
 * 注入的三段：
 *   /*__OD_RUNTIME__*​/    浏览器版运行时（去掉 ESM export 的同一份源码）
 *   /*__OD_TEX_RENDERER__*​/ ODTex 行内公式兜底渲染器
 *   /*__OD_PROGRAM__*​/     AnimationProgram 的 slots（数据型槽位是 JSON，代码型原样）
 *
 * 关键不变量：模板页与 Dry-Run 用的是**同一份** `assembleProgramSource`，
 * 所以"屏幕上看到的 = 校验过的"（§13.1 导出即另存为）。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SLOT_KEY_NAMES, TEMPLATE_VERSION, SDK_VERSION } from '../contracts/spec/frozen-keys.mjs';
import { parseStepsSlot } from '../sdk/runtime/animation-runtime.mjs';
import { buildDisplayTiming } from '../core/timing/display-time.mjs';

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_PATH = join(PROJECT_ROOT, 'template', 'animation-template.html');
const TEX_PATH = join(PROJECT_ROOT, 'template', 'tex-inline-renderer.js');
const RUNTIME_PATH = join(PROJECT_ROOT, 'sdk', 'runtime', 'animation-runtime.mjs');
const LABEL_AVOID_PATH = join(PROJECT_ROOT, 'sdk', 'runtime', 'label-avoid.mjs');
const QUESTION_DIR = join(PROJECT_ROOT, 'tests', 'regression-15');
const BUILD_DIR = join(PROJECT_ROOT, 'template', 'build');

/**
 * 把 ESM 源码转成可直接 `<script>` 执行的经典脚本。
 * 只做**确定性**的文本变换，并且对结果做**严格校验**：
 *   · 不得残留 `export`；
 *   · 不得残留 `import` —— 经典脚本里 `import` 是**语法错误**，整个脚本不会执行，
 *     页面会退化成白屏 + "运行时未注入"。历史上 q02 的反向 import（program-runner）
 *     就是这么让 16 个成品页全部白屏的，所以这里必须**构建期就报错**，不能等到浏览器里才发现。
 */
export function toClassicScript(source) {
  let out = source;
  out = out.replace(/^export\s+default\s+/gm, 'var __odDefault = ');
  out = out.replace(/^export\s+(async\s+)?function\s/gm, (m, a) => `${a ? 'async ' : ''}function `);
  out = out.replace(/^export\s+class\s/gm, 'class ');
  out = out.replace(/^export\s+(const|let|var)\s/gm, '$1 ');
  out = out.replace(/^export\s*\{[\s\S]*?\};?\s*$/gm, '');
  if (/^\s*export\s/m.test(out)) {
    throw new Error('运行时源码里仍有未处理的 export 语句——构建链需要更新 toClassicScript');
  }
  if (/^\s*import\s/m.test(out)) {
    const lines = out
      .split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /^\s*import\s/.test(l))
      .slice(0, 3);
    throw new Error(
      '运行时源码里出现了 import 语句，经典脚本无法执行（浏览器会白屏）：\n' +
        lines.map(([n, l]) => `  第 ${n} 行：${l.trim()}`).join('\n') +
        '\n  ⇒ 请把被 import 的实现**内联**进动画运行时（见 sdk/runtime/program-runner.mjs 顶部说明），' +
        '或扩展 toClassicScript 做真正的打包。',
    );
  }
  return `${out}\nwindow.ODRuntime = Runtime;\nwindow.ODRuntime.__default = typeof __odDefault !== 'undefined' ? __odDefault : Runtime;\n`;
}

/**
 * 把 ESM 源码转成"经典脚本 + 一个挂在 window 上的命名空间"。
 *
 * 为什么需要它：`sdk/runtime/label-avoid.mjs` 必须**只有一份实现**
 * （Dry-Run 规划与模板渲染共用同一套"注的身份"规则 —— 否则"表里有的、画的时候找不到"），
 * 而模板页要求经典脚本（不许 `import`）。所以这里把 export 剥掉，
 * 再把导出的名字**从源码自动收集**挂到 `window.<globalName>`。
 *
 * ⚠ 名字必须自动收集，不能手抄名单：漏一个就是运行期 `undefined`，
 *   而门禁 ⑨⑩ 只检查"页面能装起来"，不一定当场撞到那一处。
 */
export function toClassicBrowserModule(source, globalName) {
  const names = [...String(source).matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map(
    (m) => m[1],
  );

  let out = String(source);
  out = out.replace(/^export\s+default\s+/gm, 'var __odDefault = ');
  out = out.replace(/^export\s+(async\s+)?function\s/gm, (m, a) => `${a ? 'async ' : ''}function `);
  out = out.replace(/^export\s+class\s/gm, 'class ');
  out = out.replace(/^export\s+(const|let|var)\s/gm, '$1 ');
  out = out.replace(/^export\s*\{[\s\S]*?\};?\s*$/gm, '');

  if (/^\s*export\s/m.test(out)) throw new Error(`${globalName}：仍有未处理的 export（构建链需要更新）`);
  if (/^\s*import\s/m.test(out)) {
    throw new Error(`${globalName}：含 import，经典脚本无法执行（浏览器会白屏）`);
  }
  if (!names.length) throw new Error(`${globalName}：没有收集到任何导出名（正则与源码写法不匹配？）`);

  return `${out}\nwindow[${JSON.stringify(globalName)}] = { ${names.join(', ')} };\n`;
}

function safeJson(value) {
  // 防止 `</script>` 提前闭合脚本块（对 SVG 与 JSON 载荷都安全）
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

/** 读取构建期预渲染的公式 SVG（tools/build-tex-svg.mjs 产出） */
function loadTexSvg(questionId) {
  try {
    const raw = readFileSync(join(PROJECT_ROOT, 'template', 'vendor', 'tex-svg', `${questionId}.json`), 'utf8');
    const parsed = JSON.parse(raw);
    return { renderer: parsed.renderer ?? 'mathjax-full', glyphs: parsed.glyphs ?? '', formulas: parsed.formulas ?? {} };
  } catch {
    return { renderer: null, glyphs: '', formulas: {} };
  }
}

/** 生成一个题目的成品 HTML */
export function buildQuestionHtml(program, templateText, runtimeText, texText, provenance, opts = {}) {
  const texSvg = opts.texSvg ?? loadTexSvg(program.id);
  const labelAvoidText = opts.labelAvoidText ?? '';
  /* 时长归一化：每小问 4 s。stepTimes 里的 `sub` 决定分组；没有 sub 就当一整题一问。 */
  const timing = buildDisplayTiming(opts.stepTimes ?? program.stepTimes ?? null);
  const payload = {
    id: program.id,
    index: program.index,
    title: program.title,
    examPoint: program.examPoint,
    mode: program.mode ?? 'NUMERIC',
    slots: Object.fromEntries(SLOT_KEY_NAMES.map((k) => [k, program.slots[k]])),
    /** 构建期 MathJax 预渲染结果：`tex → <mjx-container…>…</mjx-container>` */
    texSvg: { renderer: texSvg.renderer, formulas: texSvg.formulas },
    /* C2：标注避让表（由调用方按需算好传进来；不传就是 null ⇒ 字不挪） */
    labelAvoid: opts.labelAvoid ?? null,
    /* v6：步骤时间（couple 产出；已换算到**显示秒**；没有就不联动） */
    stepTimes: timing.stepTimes,
    /* 时长归一化：显示秒 ↔ 物理秒的分段映射；null ⇒ 恒等（老产物行为不变） */
    timeMap: timing.timeMap,
    displayDuration: timing.displayDuration,
  };

  let html = templateText;
  // 顺序很重要：先替换 __OD_TITLE__ / __OD_PROVENANCE__，最后才注入运行时与程序载荷。
  // 否则载荷里的字符串（例如槽位名 `__OD_TITLE__`）会被后续的文本替换误伤。
  html = html.replace(/__OD_TITLE__/g, () => `${program.index}. ${program.title}`);
  html = html.replace(/__OD_PROVENANCE__/g, () => provenance);
  html = html.replace(/\/\*__OD_RUNTIME__\*\//g, () => runtimeText);
  html = html.replace(/\/\*__OD_LABEL_AVOID__\*\//g, () => labelAvoidText);
  html = html.replace(/\/\*__OD_TEX_RENDERER__\*\//g, () => texText);
  // 字形 defs：MathJax 的 path 由字形决定，同一 id 全局唯一；放在 body 开头供文档内引用
  html = html.replace(
    /<!--__OD_TEX_GLYPHS__-->/g,
    () =>
      texSvg.glyphs
        ? `<svg id="od-mathjax-glyphs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${texSvg.glyphs}</defs></svg>`
        : '',
  );
  html = html.replace(/\/\*__OD_PROGRAM__\*\//g, () => safeJson(payload));
  const leftover = html.match(/__OD_(TITLE|PROVENANCE|RUNTIME|LABEL_AVOID|TEX_RENDERER|PROGRAM|TEX_GLYPHS)__/);
  if (leftover) throw new Error(`模板里仍有未替换的占位符：${leftover[0]}`);
  // 占位符若出现在 HTML **注释**里，会被整段替换：运行时 60 KB + 公式 SVG 全被复制一遍塞进注释，
  // 每个成品页白背 110 KB，而且注入物里一旦出现注释结束标记就会把注释提前闭合（真实踩过）。
  // 这里做构建期断言，逼着模板文档区不要写完整占位符。
  // ⚠ 必须逐段检查注释**体**（`<!--` 到最近的 `-->`），不能用一个跨注释的正则 —— 第一版就是那样写的，
  //    结果把"注释之后的脚本区"也算进去，自己误报了。
  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g)) {
    const hit = /window\.ODRuntime = Runtime|<mjx-container/.exec(m[1]);
    if (hit) {
      throw new Error(
        `注入内容落进了 HTML 注释（"${hit[0]}"）：模板顶部的说明文字里不要写完整占位符，` +
          '否则运行时代码与公式 SVG 会被复制一份进注释 —— 体积翻倍且可能提前闭合注释。',
      );
    }
  }
  return html;
}

export function provenanceLine(program, contractHash, texSvg) {
  const p = program?.provenance ?? {};
  const hashLabel = (v, fallback) => (typeof v === 'string' && v && v !== 'handwritten' ? v.slice(0, 12) : fallback);
  return [
    `模板 v${TEMPLATE_VERSION}`,
    `SDK v${SDK_VERSION}`,
    `model: ${typeof p.model === 'string' && p.model ? p.model : 'handwritten'}`,
    `prompt: ${hashLabel(p.promptHash, 'handwritten')}`,
    `knowledgecard: ${hashLabel(p.knowledgecardHash, 'handwritten')}`,
    texSvg?.renderer ? `math: ${texSvg.renderer}` : 'math: odtex-fallback',
    `contract: ${contractHash.slice(0, 12)}`,
    program.id,
  ].join(' · ');
}

function readContractHash() {
  try {
    const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, 'contracts', 'manifest.json'), 'utf8'));
    return manifest.contractHash ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function galleryHtml(items, meta) {
  // ⚠ 本文件写在 tests/regression-15/gallery.html，到成品页要退**两级**：
  //   tests/regression-15/ → 项目根 → template/build/。写成 `../template/build/` 会指向
  //   tests/template/build/（不存在），15 个链接全失效 —— 门禁现在会查相对链接（layout-lint）。
  const cards = items
    .map(
      (item) => `      <li class="card" data-od-id="gallery-${item.id}">
        <a class="card-link" href="../../template/build/${item.id}.html">
          <span class="idx">${String(item.index).padStart(2, '0')}</span>
          <span class="body">
            <span class="title">${item.title}</span>
            <span class="point">${item.examPoint}</span>
          </span>
          <span class="verdict ${item.verdict}">${item.verdict === 'pass' ? 'C1–C9 全通过' : item.verdict === 'pass-with-warnings' ? '通过（有告警）' : '未通过'}</span>
        </a>
      </li>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>小肥鱼物理解题动画 · 第 1 期回归题集（15 道）</title>
<style>
  :root {
    --bg: oklch(98.2% 0.004 250); --surface: oklch(100% 0 0); --fg: oklch(25.5% 0.021 250);
    --muted: oklch(52% 0.017 250); --border: oklch(90.5% 0.008 250); --accent: oklch(47% 0.088 235);
    --font-display: 'Songti SC', 'Source Han Serif SC', 'Noto Serif SC', STSong, Georgia, serif;
    --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
    --font-mono: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font-body); line-height: 1.6; }
  header { border-bottom: 1px solid var(--border); background: color-mix(in oklch, var(--bg) 94%, transparent); position: sticky; top: 0; }
  .wrap { max-width: 1040px; margin-inline: auto; padding: 18px 22px; }
  h1 { font-family: var(--font-display); font-size: 21px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 13px; margin: 0; }
  ul { list-style: none; margin: 0; padding: 0; }
  .card { border-bottom: 1px solid var(--border); }
  .card-link { display: grid; grid-template-columns: 44px 1fr auto; gap: 16px; align-items: center; padding: 14px 0; color: inherit; text-decoration: none; }
  .card-link:hover .title { text-decoration: underline; text-underline-offset: 3px; }
  .card-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .idx { font-family: var(--font-mono); color: var(--muted); font-size: 13px; }
  .title { font-family: var(--font-display); font-size: 16px; display: block; }
  .point { color: var(--muted); font-size: 12.5px; display: block; margin-top: 2px; }
  .verdict { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); white-space: nowrap; }
  .verdict.pass { color: oklch(45% 0.1 155); }
  .verdict.fail { color: oklch(47% 0.16 28); }
  .verdict.pass-with-warnings { color: oklch(50% 0.12 70); }
  footer { color: var(--muted); font-size: 12px; padding: 22px 0 40px; }
  code { font-family: var(--font-mono); font-size: 11.5px; }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>小肥鱼物理解题动画 · 第 1 期回归题集</h1>
    <p class="sub">§19.5 手写 15 道题 · 模板 v${meta.templateVersion} · SDK v${meta.sdkVersion} · 契约 ${meta.contractHash.slice(0, 12)} · Dry-Run 判定：${meta.passCount}/${meta.total} 全通过</p>
  </div>
</header>
<main class="wrap">
  <ul>
${cards}
  </ul>
  <footer>
    每题页均为<strong>单文件自包含 HTML</strong>：双击即可离线播放，无外部请求。
    时间轴可拖拽、倍速可切、三类矢量分别开关；开关状态写入 <code>localStorage</code>。
    公式由内置 <code>ODTex</code> 行内渲染器渲染（离线兜底；MathJax 3.2.2 SVG 内联件落盘后，一处替换即可切换）。
  </footer>
</main>
</body>
</html>
`;
}

function templateShellHtml(templateText, runtimeText, texText, labelAvoidText) {
  let html = templateText;
  html = html.replace(/__OD_TITLE__/g, '空壳模板（等待宿主注入 slots）');
  html = html.replace(/__OD_PROVENANCE__/g, `模板 v${TEMPLATE_VERSION} · SDK v${SDK_VERSION} · 未注入题目`);
  html = html.replace(/\/\*__OD_RUNTIME__\*\//g, () => runtimeText);
  html = html.replace(/\/\*__OD_LABEL_AVOID__\*\//g, () => labelAvoidText);
  html = html.replace(/\/\*__OD_TEX_RENDERER__\*\//g, () => texText);
  html = html.replace(/<!--__OD_TEX_GLYPHS__-->/g, '');
  html = html.replace(
    /\/\*__OD_PROGRAM__\*\//g,
    () => '{"id":"__EMPTY__","index":0,"title":"空壳模板","mode":"NUMERIC","slots":null}',
  );
  html = html.replace(/__EMPTY__/g, 'od-empty-template-shell');
  return html;
}

export async function main() {
  const templateText = readFileSync(TEMPLATE_PATH, 'utf8');
  const texText = readFileSync(TEX_PATH, 'utf8');
  const runtimeRaw = readFileSync(RUNTIME_PATH, 'utf8');
  const runtimeText = toClassicScript(runtimeRaw);
  const labelAvoidText = toClassicBrowserModule(readFileSync(LABEL_AVOID_PATH, 'utf8'), 'ODLabelAvoid');
  const contractHash = readContractHash();

  const files = [
    'q01-conveyor-heat.mjs', 'q02-incline-arc-projectile.mjs', 'q03-pursuit.mjs',
    'q04-oblique-collision.mjs', 'q05-spring-pendulum.mjs', 'q06-pulley-constraint.mjs',
    'q07-rod-emf.mjs', 'q08-charged-in-b-field.mjs', 'q09-capacitor-rod-transient.mjs',
    'q10-pv-isothermal-work.mjs', 'q11-refraction-snell.mjs', 'q12-standing-wave.mjs',
    'q13-drag-fall.mjs', 'q14-blocks-relative-slide.mjs', 'q15-symbolic.mjs',
  ];

  mkdirSync(BUILD_DIR, { recursive: true });
  writeFileSync(join(BUILD_DIR, 'animation-template.html'), templateShellHtml(templateText, runtimeText, texText, labelAvoidText), 'utf8');

  let reportIndex = new Map();
  try {
    const report = JSON.parse(readFileSync(join(PROJECT_ROOT, 'tests', 'reports', 'dry-run-report.json'), 'utf8'));
    reportIndex = new Map(report.map((r) => [r.entry, r]));
  } catch {
    /* 还没跑过 Dry-Run：默认按未通过展示 */
  }

  const built = [];
  for (const file of files) {
    let program;
    try {
      program = (await import(new URL(`../tests/regression-15/${file}`, import.meta.url).href)).default;
    } catch {
      continue; // 尚未手写的题目跳过（构建链允许增量）
    }
    const texSvg = loadTexSvg(program.id);
    // 演示题仍带 STEPS 时间；这里生成 stepTimes，仅用于回归页的联动演示。
    const demoSteps = parseStepsSlot(program.slots.STEPS ?? '');
    const stepTimes = demoSteps
      .map((s, i) => ({ step: i + 1, t0: s.t0, t1: s.t1 }))
      .filter((s) => Number.isFinite(s.t0) && Number.isFinite(s.t1) && s.t1 > s.t0);
    const html = buildQuestionHtml(
      program,
      templateText,
      runtimeText,
      texText,
      provenanceLine(program, contractHash, texSvg),
      { texSvg, labelAvoidText, stepTimes: stepTimes.length ? stepTimes : null },
    );
    writeFileSync(join(BUILD_DIR, `${program.id}.html`), html, 'utf8');
    const report = reportIndex.get(program.id);
    built.push({
      id: program.id,
      index: program.index,
      title: program.title,
      examPoint: program.examPoint,
      verdict: report?.verdict ?? 'fail',
      file: basename(file),
      formulas: Object.keys(texSvg.formulas).length,
      mathRenderer: texSvg.renderer,
    });
  }

  const passCount = built.filter((b) => b.verdict === 'pass').length;
  writeFileSync(
    join(PROJECT_ROOT, 'tests', 'regression-15', 'gallery.html'),
    galleryHtml(built, { templateVersion: TEMPLATE_VERSION, sdkVersion: SDK_VERSION, contractHash, passCount, total: built.length }),
    'utf8',
  );

  console.log(`✓ 模板构建完成：${built.length} 个题目页 + 1 个空壳模板`);
  console.log(`  运行时代码 ${(runtimeText.length / 1024).toFixed(1)} KB · 公式渲染器 ${(texText.length / 1024).toFixed(1)} KB`);
  console.log(`  → template/build/ · tests/regression-15/gallery.html`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`✗ ${err?.message ?? err}`);
    process.exit(1);
  });
}
