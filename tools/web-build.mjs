/**
 * 第 0 步交付物：前端构建链门禁（typecheck + transpile + bundle + 产物体检）。
 *
 * ⚠ 为什么不用 `npm run build` / `pnpm run build`：
 *   本沙箱**禁止管道捕获子进程输出**（任何 exe 都 EPERM）。包管理器在 `run` 之前
 *   会做一次"依赖状态检查"，那次检查内部用管道 spawn ⇒ 直接 `Error: spawn EPERM`
 *   （pnpm 尤其明显），**根本走不到 tsc / rollup**。这与代码好坏无关，是环境限制。
 *
 *   本脚本的绕法：直接调用各工具自己的入口，一律 `stdio:'inherit'`（沙箱放行 inherit）：
 *     · tsc    → web/node_modules/typescript/bin/tsc
 *     · rollup → web/node_modules/rollup/dist/bin/rollup
 *
 * ⚠ 为什么没有 Vite：见 web/rollup.config.mjs 顶部说明与 README 第十三节的偏差记录。
 *   Vite 5 在本沙箱结构性不可用（两处必须 spawn），已用 7 组实验确认。
 *
 * 用法（从仓库根）：
 *   node tools/web-build.mjs          # 全链
 *   node tools/web-build.mjs --check  # 只做类型检查
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { PROJECT_ROOT } from './paths.mjs';
import { resolveNodeBin, nodeEnv } from './node-bin.mjs';

const WEB_DIR = join(PROJECT_ROOT, 'web');
const NODE = resolveNodeBin().bin;

const TSC = join(WEB_DIR, 'node_modules', 'typescript', 'bin', 'tsc');
const ROLLUP = join(WEB_DIR, 'node_modules', 'rollup', 'dist', 'bin', 'rollup');

/**
 * 演示数据生成器（`tools/build-demo-questions.mjs`）。
 *
 * ⚠ 必须在 `tsc` **之前**跑：`web/src/lib/demo-questions.ts` 是从
 * `tests/regression-15/q*.mjs`（唯一事实来源）生成的，不先生成的话
 * 类型检查会因为文件不存在而失败，或更糟——用上一次的旧数据通过检查。
 */
const DEMO_GEN = join(PROJECT_ROOT, 'tools', 'build-demo-questions.mjs');

/**
 * 世界书前端产物生成器（`tools/build-worldbook-web.mjs`，第 5 期）。
 *
 * 生成两样东西：
 *   · `web/src/lib/worldbook-engine.js` —— `core/worldbook/engine.mjs` 的**逐字节副本**
 *     （设置页的实时试触发预览器用的就是它 ⇒ "预览器与实际请求逐字一致"由**同一份字节**保证）
 *   · `web/src/lib/worldbook-demo.ts`   —— 内置词条 + 覆盖率 + 导出包常量的构建期快照
 *
 * ⚠ 同样必须在 `tsc` **之前**跑：`worldbook-demo.ts` 不存在时类型检查会直接失败。
 */
const WORLDBOOK_GEN = join(PROJECT_ROOT, 'tools', 'build-worldbook-web.mjs');

/** 依赖是否就位（缺了给可操作提示，而不是抛一句 MODULE_NOT_FOUND） */
function ensureInstalled() {
  const missing = [];
  if (!existsSync(TSC)) missing.push('typescript');
  if (!existsSync(ROLLUP)) missing.push('rollup');
  if (missing.length) {
    throw new Error(
      `web/ 的前端依赖缺失（${missing.join(', ')}）。请先安装：\n` +
        `  npm install --prefix web --ignore-scripts\n` +
        `  ⚠ 三条硬约束（都踩过）：\n` +
        `    1. 必须带 --prefix web：让依赖落在 web/ 内，不要污染根 node_modules（后端零新增依赖）；\n` +
        `    2. 必须带 --ignore-scripts：沙箱禁止管道捕获，依赖的 postinstall 会以 spawn EPERM 崩掉整个安装；\n` +
        `    3. 缓存须在项目内：设置 NPM_CONFIG_CACHE=<仓库根>\\.npm-cache，否则默认缓存在可写范围外会 EPERM。`,
    );
  }
}

/** 用 inherit 起动一个前端工具并返回是否成功 */
function runTool(label, entry, args) {
  console.log(`\n──────── ${label} ────────`);
  const result = spawnSync(NODE, [entry, ...args], {
    stdio: 'inherit',
    cwd: WEB_DIR,
    env: nodeEnv(),
  });
  if (result.error) {
    console.log(`✗ 无法启动：${result.error.code ?? result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    console.log(`✗ ${label} 失败（exit ${result.status}）`);
    return false;
  }
  console.log(`✓ ${label} 通过`);
  return true;
}

/** 产物体检：文件必须在、非空，引用必须都有落点 */
async function checkArtifacts() {
  console.log('\n──────── 产物体检 ────────');
  const problems = [];
  const distDir = join(WEB_DIR, 'dist');

  const htmlPath = join(distDir, 'index.html');
  if (!existsSync(htmlPath)) {
    console.log('  ✗ dist/index.html 不存在（入口页没被拷贝）');
    return false;
  }
  const html = readFileSync(htmlPath, 'utf8');

  // ⚠ 引用检查必须覆盖 **JS 里出现的相对 URL**，不能只看 HTML：
  //   动画页的 iframe 路径写在 `AnimationPage.tsx` 里（构建后进了 app.js），
  //   只看 index.html 会漏掉"iframe 指向一个 dist 里不存在的目录"这类问题。
  const jsPath = join(WEB_DIR, 'dist', 'assets', 'app.js');
  const jsText = existsSync(jsPath) ? readFileSync(jsPath, 'utf8') : '';

  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) refs.add(m[1]);
  // 从 JS 里抠模板页这类站点内相对路径（只认 ./ 开头且带 .html 的，避免误伤普通字符串）
  for (const m of jsText.matchAll(/["'`]\.\/([A-Za-z0-9_\-./]+\.html)["'`]/g)) refs.add(m[1]);

  for (const rel of refs) {
    const abs = join(distDir, rel);
    if (!existsSync(abs)) {
      problems.push(`产物引用了 ${rel}，但 dist/${rel} 不存在（构建后打开会是 404）`);
      continue;
    }
    const size = statSync(abs).size;
    if (size === 0) problems.push(`dist/${rel} 是空文件`);
    else console.log(`  ✓ ${rel}  ${(size / 1024).toFixed(1)} KB`);
  }

  // 单文件自包含要求（§13.1 的"导出 = 另存"精神）：不得引用外部网络资源
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  if (external.length) problems.push(`index.html 含外链资源（必须自包含）：${external.join(', ')}`);

  // 打包产物不得残留裸 import（浏览器直接执行不了 ESM 说明符）
  if (jsText) {
    if (/^\s*import\s/m.test(jsText) || /^\s*export\s/m.test(jsText)) {
      problems.push('dist/assets/app.js 里仍有 import/export（iife 产物不应出现）');
    }

    /**
     * ★★ 浏览器里不存在的 Node 全局 / ESM 语法（第 3 期第 9 步补的判据）。
     *
     * 为什么补：交付时页面**白屏**，根因是产物里有 `process.env.NODE_ENV`
     * ——React 的开发构建靠它判断模式，而浏览器**没有 `process`**，
     * 顶层求值直接抛 `ReferenceError` ⇒ 整个 bundle 一行都不执行。
     *
     * ⚠ 这条判据此前**本该存在却没有**：我先前的扫描用 `\bprocess\.` 传进 PowerShell 时
     *   反斜杠被转义吃掉，于是"0 处"是**假的**，白屏因此溜过了门禁。
     *   教训：扫描用的正则必须能在**同一段代码路径**里复核（这条判据现在就在构建门禁里，
     *   每次构建都会真跑），而不是靠一次性的命令行实验。
     */
    const forbidden = [
      { re: /\bprocess\s*\.\s*env\b/, what: 'process.env（浏览器没有 process）', fix: '在 rollup.config.mjs 的 replace 里替换掉' },
      { re: /\bprocess\s*\.\s*(argv|platform|cwd|exit|version)\b/, what: 'Node 的 process API', fix: '前端不得依赖 Node 运行时' },
      { re: /\brequire\s*\(\s*['"]/, what: 'CommonJS 的 require()', fix: '应被打包器静态解析，不该留在产物里' },
      { re: /\b__dirname\b|\b__filename\b/, what: 'CommonJS 的 __dirname/__filename', fix: '前端不得使用' },
      { re: /\bBuffer\s*\.\s*(from|alloc|concat)\b/, what: 'Node 的 Buffer', fix: '前端用 Uint8Array/TextEncoder 替代' },
      { re: /^\s*(?:import|export)\s/m, what: 'ESM 语法（iife 产物里不可能执行）', fix: '检查打包配置的 output.format' },
    ];
    for (const f of forbidden) {
      const hit = f.re.exec(jsText);
      if (hit) {
        const at = Math.max(0, hit.index - 40);
        const snippet = jsText.slice(at, at + 100).replace(/\s+/g, ' ');
        problems.push(`产物里出现 ${f.what}（会让浏览器里整页白屏）→ ${f.fix}；示例片段：…${snippet}…`);
      }
    }
  } else {
    problems.push('dist/assets/app.js 不存在');
  }

  problems.push(...checkEvidenceLabels());
  // ⚠ 必须 `await`：`checkStageChain()` 是 async（它要 import 编排层拿 PHASE4_STAGES）。
  //   忘了 await 时的报错是 `Spread syntax requires ...iterable[Symbol.iterator]`——
  //   错误信息完全指不到"少了个 await"，第一次跑就是这么被骗过去的。
  problems.push(...(await checkStageChain()));
  // 第 5 期：世界书相关的三条构建期判据
  problems.push(...(await checkWorldbookArtifacts()));

  if (problems.length) {
    for (const p of problems) console.log(`  ✗ ${p}`);
    return false;
  }
  console.log('  ✓ 产物自包含、无外链、无残留 ESM 语句、引用均有落点、证据强度标签与契约一致');
  return true;
}

/**
 * 第 5 期的三条构建期判据（世界书）。
 *
 * 每一条都对应一种"会静默漂移"的写法：
 *   ① 浏览器侧引擎副本被手改 / 忘了重新生成 ⇒ 预览器与真实请求不再逐字节一致（W10 破功）
 *   ② `worldbook-engine.d.ts` 是**抄录**的导出面 ⇒ 少一个名字就少一个能被调用的函数
 *   ③ 演示数据里的导出包常量是**抄录**的 ⇒ 抄错会让 UI 导出错误格式的包
 */
async function checkWorldbookArtifacts() {
  const out = [];
  const projectRoot = PROJECT_ROOT;
  try {
    const gen = await import(pathToFileURL(join(projectRoot, 'tools', 'build-worldbook-web.mjs')).href);
    const engineSrc = join(projectRoot, 'core', 'worldbook', 'engine.mjs');
    const engineOut = join(projectRoot, 'web', 'src', 'lib', 'worldbook-engine.js');
    const dtsOut = join(projectRoot, 'web', 'src', 'lib', 'worldbook-engine.d.ts');
    const demoOut = join(projectRoot, 'web', 'src', 'lib', 'worldbook-demo.ts');
    /** 第 5.7 期：解析器副本与它的类型声明（预览器的"粘贴转写自动解析"用它） */
    const conceptsSrc = join(projectRoot, 'core', 'worldbook', 'concepts.mjs');
    const conceptsOut = join(projectRoot, 'web', 'src', 'lib', 'worldbook-concepts.js');
    const conceptsDtsOut = join(projectRoot, 'web', 'src', 'lib', 'worldbook-concepts.d.ts');

    // ① 副本 == 本源（连文件头一起比：跳过前 N 行再比会漏掉"偷偷加一句 process.env"）
    if (!existsSync(engineOut)) out.push('web/src/lib/worldbook-engine.js 不存在（请跑 node tools/build-worldbook-web.mjs）');
    else if (readFileSync(engineOut, 'utf8') !== gen.expectedEngineCopy()) {
      out.push('web/src/lib/worldbook-engine.js 与 core/worldbook/engine.mjs 不一致 ⇒ **预览器与真实请求会逐字节不同**（W10 破功）。请跑 `node tools/build-worldbook-web.mjs` 重新生成，不要手改。');
    } else {
      console.log('  ✓ 浏览器侧引擎副本与本源逐字节一致（预览器与真实请求共用同一份代码）');
    }

    // ② d.ts 声明的名字集合 == engine.mjs 的导出面
    if (existsSync(dtsOut)) {
      const engineExports = Object.keys(await import(pathToFileURL(engineSrc).href)).sort();
      const dts = readFileSync(dtsOut, 'utf8');
      const declared = [...dts.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]).sort();
      if (declared.join(',') !== engineExports.join(',')) {
        const missInDts = engineExports.filter((x) => !declared.includes(x));
        const missInEngine = declared.filter((x) => !engineExports.includes(x));
        out.push(
          `web/src/lib/worldbook-engine.d.ts 的声明与 engine.mjs 的导出面不一致` +
            `（d.ts 缺 ${missInDts.join('/') || '—'}；engine 里没有 ${missInEngine.join('/') || '—'}）`,
        );
      } else {
        console.log(`  ✓ 世界书引擎的 d.ts 声明与导出面一致（${declared.length} 个）`);
      }
    } else {
      out.push('web/src/lib/worldbook-engine.d.ts 不存在（浏览器侧要类型声明才能 import .js）');
    }

    /* ②′ 第 5.7 期：解析器副本同样要"逐字节一致 + 导出面一致"。
     *
     * 理由与解析器本身一样：预览器的"粘贴模型转写 → 自动解析"必须与真实链路的解析
     * **是同一份代码**，否则"粘贴解析出来的考点"与"真实链路解析出来的考点"会悄悄不一样，
     * 而那种不一致在界面上看不出来（看起来都"解析成功"了）。 */
    if (!existsSync(conceptsOut)) {
      out.push('web/src/lib/worldbook-concepts.js 不存在（请跑 node tools/build-worldbook-web.mjs）');
    } else if (readFileSync(conceptsOut, 'utf8') !== gen.expectedConceptsCopy()) {
      out.push(
        'web/src/lib/worldbook-concepts.js 与 core/worldbook/concepts.mjs 不一致 ⇒ **预览器的粘贴解析会与真实链路不同**。' +
          '请跑 `node tools/build-worldbook-web.mjs` 重新生成，不要手改。',
      );
    } else {
      console.log('  ✓ 浏览器侧解析器副本与本源逐字节一致（粘贴解析与真实链路共用同一份代码）');
    }
    if (existsSync(conceptsDtsOut)) {
      const conceptsExports = Object.keys(await import(pathToFileURL(conceptsSrc).href)).sort();
      const dts = readFileSync(conceptsDtsOut, 'utf8');
      const declared = [...dts.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]).sort();
      if (declared.join(',') !== conceptsExports.join(',')) {
        const missInDts = conceptsExports.filter((x) => !declared.includes(x));
        const missInCopy = declared.filter((x) => !conceptsExports.includes(x));
        out.push(
          `web/src/lib/worldbook-concepts.d.ts 的声明与 concepts.mjs 的导出面不一致` +
            `（d.ts 缺 ${missInDts.join('/') || '—'}；concepts 里没有 ${missInCopy.join('/') || '—'}）`,
        );
      } else {
        console.log(`  ✓ 世界书解析器的 d.ts 声明与导出面一致（${declared.length} 个）`);
      }
    } else {
      out.push('web/src/lib/worldbook-concepts.d.ts 不存在（浏览器侧要类型声明才能 import .js）');
    }

    // ③ 导出包常量 == 契约的 const
    if (existsSync(demoOut)) {
      const schema = JSON.parse(readFileSync(join(projectRoot, 'contracts', 'worldbook-pack.schema.json'), 'utf8'));
      const demo = readFileSync(demoOut, 'utf8');
      const fmt = /export const WORLDBOOK_PACK_FORMAT = ("[^"]*")/.exec(demo)?.[1];
      const ver = /export const WORLDBOOK_PACK_VERSION = (\d+)/.exec(demo)?.[1];
      if (fmt !== JSON.stringify(schema.properties.format.const) || ver !== String(schema.properties.version.const)) {
        out.push(
          `worldbook-demo.ts 的导出包常量与契约不一致：产物 ${fmt}/${ver} vs 契约 ` +
            `${JSON.stringify(schema.properties.format.const)}/${schema.properties.version.const}`,
        );
      } else {
        console.log(`  ✓ 导出包常量与契约一致（${schema.properties.format.const} v${schema.properties.version.const}）`);
      }

      /**
       * ④ 解题页「世界书依据」面板的数据必须**真的来自引擎**。
       *
       * 这一条防的是"面板长得对、其实是空的"：只要生成器在**空词条集合**上跑过，
       * `entries` 就会是 `[]`、`injectedBySlot` 全是 0，而页面上照样能渲染出一个漂亮的面板。
       * 所以这里要求：命中的条目非空、且它们的哈希等于内置库哈希。
       */
      const m = /export const WORLDBOOK_DEMO_EVENT = (\{[\s\S]*?\n\})/.exec(demo);
      const hash = /export const WORLDBOOK_HASH = "([0-9a-f]{64})"/.exec(demo)?.[1];
      if (!m) {
        out.push('worldbook-demo.ts 里找不到 WORLDBOOK_DEMO_EVENT（解题页的世界书依据会没有数据）');
      } else {
        let ev = null;
        try {
          ev = JSON.parse(m[1]);
        } catch (err) {
          out.push(`WORLDBOOK_DEMO_EVENT 不是合法 JSON：${err?.message ?? err}`);
        }
        if (ev) {
          if (!Array.isArray(ev.entries) || ev.entries.length === 0) {
            out.push('WORLDBOOK_DEMO_EVENT 里没有命中任何词条 ⇒ 解题页的「世界书依据」面板会是空的（用空库跑过？）');
          } else if (ev.hash !== hash) {
            out.push(`WORLDBOOK_DEMO_EVENT.hash (${String(ev.hash).slice(0, 12)}…) ≠ WORLDBOOK_HASH (${String(hash).slice(0, 12)}…) ⇒ 面板数据不是用这份库跑出来的`);
          } else if (!ev.entries.every((x) => Array.isArray(x.injectedSlots) && typeof x.via === 'string')) {
            out.push('WORLDBOOK_DEMO_EVENT 的条目缺少 via / injectedSlots（面板要显示"命中方式"与"实际注入槽位"）');
          } else if (!Array.isArray(ev.emptySlots) || !Array.isArray(ev.truncatedSlots)) {
            out.push('WORLDBOOK_DEMO_EVENT 没有把"空槽"与"被截断"分成两个字段（§9.2 的"重要边界"）');
          } else {
            console.log(`  ✓ 世界书依据数据来自真引擎（命中 ${ev.matched} 条 · 空槽 ${ev.emptySlots.join('/') || '—'}）`);
          }
        }
      }
    } else {
      out.push('web/src/lib/worldbook-demo.ts 不存在（请跑 node tools/build-worldbook-web.mjs）');
    }
  } catch (err) {
    out.push(`世界书产物的构建期判据执行失败：${err?.message ?? err}`);
  }
  return out;
}

/**
 * 前端阶段链与编排层**逐字一致**（第 4 期）。
 *
 * 为什么要有这一条：第 4 期把 `repair` 接进执行链，而阶段名是**跨端接口**
 * （§2.3："阶段枚举（清洗与 SSE 共用，定案）"）。前端 `STAGE_CHAIN` 若漏掉 `repair`，
 * 表现是"修了好几轮，进度条上完全看不出来"—— 这正是 §14.2 的 B6（修复过程对用户可见）
 * 会**静默失败**的方式：门禁全绿，用户什么都看不到。
 *
 * 判据：把 `core/orchestrator/events.mjs` 的 `PHASE4_STAGES` **真跑一遍**（import 它），
 * 与 `web/src/lib/run-stream.ts` 里 `STAGE_CHAIN` 的字面量逐项比对。
 * 一边是代码里的真值，一边是前端产物里的字面量 —— 两边都改了才算通过。
 */
async function checkStageChain() {
  const out = [];
  const src = readFileSync(join(WEB_DIR, 'src', 'lib', 'run-stream.ts'), 'utf8');
  const m = /export const STAGE_CHAIN = \[([^\]]*)\] as const/.exec(src);
  if (!m) {
    out.push('web/src/lib/run-stream.ts 里找不到 STAGE_CHAIN');
    return out;
  }
  const got = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const { PHASE5_STAGES } = await import(pathToFileURL(join(PROJECT_ROOT, 'core', 'orchestrator', 'events.mjs')).href);
  if (got.join(',') !== [...PHASE5_STAGES].join(',')) {
    out.push(
      `前端 STAGE_CHAIN 与编排层 PHASE5_STAGES 不一致：前端 [${got.join(', ')}] vs 编排 [${[...PHASE5_STAGES].join(', ')}]` +
        '（阶段名是 §2.3 的跨端接口；漏一个会让该阶段对用户不可见）',
    );
  } else {
    console.log(`  ✓ 前端阶段链与编排层一致（${got.join(' → ')}）`);
  }
  return out;
}

/**
 * 三档证据强度的**前端标签与契约一致**（第 4 期）。
 *
 * 为什么要有这一条：`web/src/lib/run-stream.ts` 的 `PRECISION_LABEL` 是**抄录**
 * （浏览器拿不到 Node 侧的 `contracts/`），而抄录一定会漂移。第 2 期的教训
 * （`tex-svg/manifest.json` 是僵尸产物、`doctor` 读它报过期值）说明：
 * **凡是"派生汇总物"，都必须由构建反向校验**，否则它只是一句会过期的注释。
 *
 * 判据：键集合与顺序必须等于 `contracts/diagnostic-evidence.json` 的 `precisions[].id`，
 * 标签值必须等于 `precisions[].label`。
 */
function checkEvidenceLabels() {
  const out = [];
  try {
    const contract = JSON.parse(readFileSync(join(PROJECT_ROOT, 'contracts', 'diagnostic-evidence.json'), 'utf8'));
    const src = readFileSync(join(WEB_DIR, 'src', 'lib', 'run-stream.ts'), 'utf8');
    const m = /export const PRECISION_LABEL: Record<string, string> = \{([\s\S]*?)\n\}/.exec(src);
    if (!m) {
      out.push('web/src/lib/run-stream.ts 里找不到 PRECISION_LABEL（第 4 期的证据强度标签）');
      return out;
    }
    const got = [...m[1].matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map((x) => ({ id: x[1], label: x[2] }));
    const want = contract.precisions.map((p) => ({ id: p.id, label: p.label }));
    if (want.map((p) => p.id).join('|') !== got.map((p) => p.id).join('|')) {
      out.push(`PRECISION_LABEL 的键与契约不一致：产物 [${got.map((p) => p.id).join(', ')}] vs 契约 [${want.map((p) => p.id).join(', ')}]`);
    }
    for (const w of want) {
      const g = got.find((x) => x.id === w.id);
      if (g && g.label !== w.label) out.push(`PRECISION_LABEL.${w.id} 标签与契约不一致："${g.label}" vs "${w.label}"`);
    }
    if (!out.length) console.log(`  ✓ 证据强度标签与契约一致（${want.map((p) => `${p.id}=${p.label}`).join(' · ')}）`);
  } catch (err) {
    out.push(`证据强度标签校验失败：${err?.message ?? err}`);
  }
  return out;
}

export async function main({ checkOnly = false } = {}) {
  ensureInstalled();
  console.log('前端构建链门禁（web/ · Rollup）');
  console.log(`  运行时：${NODE}`);
  console.log(`  目录：${WEB_DIR}`);

  // ⓪ 先生成演示数据（从真题源；保证产物里的演示数据不是旧的）
  {
    console.log('\n──────── ⓪ 生成演示数据（来自 tests/regression-15/） ────────');
    const result = spawnSync(NODE, [DEMO_GEN], { stdio: 'inherit', cwd: PROJECT_ROOT, env: nodeEnv() });
    if (result.error || result.status !== 0) {
      console.log(`✗ 演示数据生成失败（${result.error?.code ?? result.status}）`);
      return { ok: false, step: 'demo-data' };
    }
  }

  // ⓪-bis 世界书前端产物（引擎副本 + 内置词条快照；第 5 期）
  {
    console.log('\n──────── ⓪ 世界书前端产物（engine 副本 + 内置词条快照） ────────');
    const result = spawnSync(NODE, [WORLDBOOK_GEN], { stdio: 'inherit', cwd: PROJECT_ROOT, env: nodeEnv() });
    if (result.error || result.status !== 0) {
      console.log(`✗ 世界书前端产物生成失败（${result.error?.code ?? result.status}）`);
      return { ok: false, step: 'worldbook-data' };
    }
  }

  if (!runTool('① TypeScript 类型检查（tsc -p tsconfig.app.json）', TSC, ['-p', join(WEB_DIR, 'tsconfig.app.json')])) {
    return { ok: false, step: 'typecheck' };
  }
  if (checkOnly) return { ok: true, step: 'typecheck' };

  if (!runTool('② TypeScript 转译（tsc -p tsconfig.build.json → .build/）', TSC, ['-p', join(WEB_DIR, 'tsconfig.build.json')])) {
    return { ok: false, step: 'transpile' };
  }

  /**
   * ②-bis 公式混排取证（第 8 期 · 用户 2026-10-18 裁决）。
   *
   * 用户的要求："如果是解释+公式+解释+公式，会自动分行吗？我需要实现这个功能。"
   * "自动分行"这件事**只看得见、测不到**，所以这里把 `MathBlock` 的切分函数
   * （`splitTexMix`）从**编译产物**里 import 出来真跑一遍 —— 断言的正是用户那句原话的结构。
   */
  {
    console.log('\n──────── ② 公式混排取证（解释 + 公式 + 解释 + 公式 → 分段） ────────');
    const cases = [
      ['纯 LaTeX（历史写法，整段就是一条公式）', 'k=\\dfrac{\\mu_1 m_2 g}{x}', ['math']],
      ['解释 + 公式 + 解释', '木板向左滑，$f_1=\\mu_1 m_2 g$ 同时作用', ['text', 'math', 'text']],
      ['解释 + 公式 + 解释 + 公式（用户原话）', '先看合力 $F=f_1+f_2$，再看加速度 $a=F/m$', ['text', 'math', 'text', 'math']],
      ['$$…$$ 也认', '$$v=v_0+at$$', ['math']],
      ['只有文字（没有公式定界符）⇒ 当公式，不丢内容', '\\text{示意}', ['math']],
      /**
       * 用户真题踩到的坑：**整句中文被 $ 包住**。这时绝不能送进 MathJax
       * （汉字会被当成数学符号"一字一行"，碰上不配对的右花括号还会渲染出英文报错），
       * 必须还原成文字（相邻文字会合并成一段，让浏览器自动折行）。
       */
      ['整句中文被 $ 包住 ⇒ 当文字（不送 MathJax）', '受力分析：$弹簧被拉长 x，拉力向右$', ['text']],
      ['\\text{…} 里的汉字是合法的 ⇒ 仍然当公式', '\\text{示意取值}\\ k=50', ['math']],
    ];
    let bad = 0;
    try {
      // ⚠ 必须加载**零依赖**的 `tex-mix.js`：`markdown.js` 会 import 'react' 与 './demo-questions'
      //   （TS 转译保留无扩展名 specifier），Node 的 ESM 解析不了。
      const mod = await import(pathToFileURL(join(WEB_DIR, '.build', 'lib', 'tex-mix.js')).href);
      for (const [label, input, want] of cases) {
        const got = mod.splitTexMix(input).map((p) => p.type);
        const ok = JSON.stringify(got) === JSON.stringify(want);
        console.log(`  ${ok ? '✓' : '✗'} ${label} → ${got.join(' / ')}`);
        if (!ok) bad += 1;
      }
      const parts = mod.splitTexMix('先看合力 $F=f_1+f_2$，再看加速度 $a=F/m$');
      const joined = parts.map((p) => p.value).join('');
      console.log(`  ${joined.includes('先看合力') && joined.includes('F=f_1+f_2') ? '✓' : '✗'} 切分不丢字（原文全在）`);
      if (!(joined.includes('先看合力') && joined.includes('F=f_1+f_2'))) bad += 1;
    } catch (err) {
      console.log(`  ✗ 无法从产物里加载 splitTexMix：${err?.message ?? err}`);
      bad += 1;
    }
    if (bad) {
      console.log(`✗ 公式混排取证失败 ${bad} 条`);
      return { ok: false, step: 'tex-mix' };
    }
    console.log('✓ 公式混排：解释与公式交替时会分段（文字自动折行、公式各自内联）');
  }
  if (!runTool('③ 模块打包 + Tailwind（rollup -c）', ROLLUP, ['-c'])) {
    return { ok: false, step: 'bundle' };
  }
  /**
   * ④ 产物**可执行性**探针（第 3 期第 9 步补）。
   *
   * ⚠ 为什么必须在"产物体检"之外再加这一层：
   *   产物体检只查"文件在不在、引用有没有落点、有没有 ESM 语法"——**它不执行产物**。
   *   而真故障是"产物能下载但**跑不起来**"：交付时页面白屏，根因是产物里有 `process.env`
   *   （浏览器没有 `process` ⇒ 顶层 ReferenceError ⇒ 整个 bundle 一行不执行）。
   *   所以这里**真的在 vm 里跑一遍** App 产物，抓顶层异常。
   */
  if (!runTool('④ 产物可执行性探针（vm 里真跑 app.js）', join(PROJECT_ROOT, 'tools', '_run-bundle-probe.mjs'), [])) {
    return { ok: false, step: 'bundle-runnable' };
  }
  if (!(await checkArtifacts())) return { ok: false, step: 'artifacts' };

  return { ok: true, step: 'build' };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  try {
    const { ok, step } = await main({ checkOnly: process.argv.includes('--check') });
    if (ok) console.log(`\n✓ 前端构建链通过（${step}）`);
    else {
      console.log(`\n✗ 前端构建链未通过（${step}）`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`✗ ${err?.message ?? err}`);
    process.exitCode = 1;
  }
}
