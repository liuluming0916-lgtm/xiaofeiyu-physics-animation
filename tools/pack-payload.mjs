#!/usr/bin/env node
/**
 * 发行载荷（payload）构建 + ASAR 封装 —— 打包链路唯一的"装什么、怎么装"口径。
 *
 * 为什么把这件事单独抽出来：
 *   `electron-pack`（从 Electron 官方 zip 装绿色版）和 `electron-repack`（复用现成运行时重打包）
 *   以前各写一遍载荷清单，两份清单已经开始漂移（一个带 `template/` 整棵，一个只带几样）。
 *   现在两边都调本文件：**载荷内容只有一处定义**，改打包内容不会只改一半。
 *
 * ── 载荷形状（v1.1.12 起）──
 *
 * ```
 * resources/
 *   app.asar                 ← 全部代码（core / sdk / contracts / electron / tools / web/dist / template/build）
 *   app.asar.unpacked/       ← 只有原生模块（*.node），必须放在外面才能 dlopen
 * ```
 *
 * ⚠ **不再有 `resources/app/` 目录**。散开的目录等于把源码直接送给用户翻，
 *   这正是 v1.1.11 及以前发布包的问题（详见 `docs/打包文档.md`）。
 *
 * ⚠ ASAR 是"打包 + 防随手翻看"，**不是加密**：有工具的人仍能解开。
 *   它的价值是让普通用户看不到、也改不到程序本体，同时保证"程序目录只读"这件事
 *   在代码层面成立（用户数据本来就不写这里）。真正的秘密（模型 Key）从来不进包。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROJECT_ROOT } from './paths.mjs';
import { createAsar, listAsar, readAsarText } from './asar-archive.mjs';

/** 仓库里要进包的目录（运行期代码） */
export const PAYLOAD_DIRS = ['electron', 'core', 'sdk', 'contracts'];

/** 运行期 node_modules（与 v1.0 以来的清单一致：公式渲染 + SQLite + AST） */
export const RUNTIME_DEPS = [
  'acorn',
  'better-sqlite3',
  'mathjax-full',
  'mhchemparser',
  'speech-rule-engine',
  'wicked-good-xpath',
  'mj-context-menu',
  'commander',
  'esm',
  'node-addon-api',
];

/** `template/` 里运行期真正用得到的几样（构建脚本 + 成品页 + 公式渲染器） */
export const TEMPLATE_ITEMS = ['build', 'vendor', 'animation-template.html', 'build-template.mjs', 'tex-inline-renderer.js'];

/** 原生模块必须解包；Electron 的 `process.dlopen` 不能从 asar 里加载 `.node` */
export const ASAR_UNPACK = /\.node$/i;

/** `tools/` 里不进包的东西：开发期取证脚本 + 打包工具自己 */
const TOOLS_SKIP = new Set(['asar-archive.mjs', 'pack-payload.mjs', 'electron-pack.mjs', 'electron-repack.mjs']);

function walkCopy(src, dest, skip) {
  const st = statSync(src);
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const name of readdirSync(src)) {
      if (skip?.(name, join(src, name))) continue;
      walkCopy(join(src, name), join(dest, name), skip);
    }
    return;
  }
  mkdirSync(join(dest, '..'), { recursive: true });
  cpSync(src, dest);
}

/**
 * 载荷里一律不要的东西：source map（第三方包里也有）、VCS 目录、依赖目录。
 * `.map` 只服务调试，运行期没人读；带上它既增加体积，也会让"产物里不许有源码"这条检查失效。
 */
function skipNoise(name) {
  return name === '.git' || name === 'node_modules' || name.endsWith('.map');
}

function sizeOfDir(dir) {
  let total = 0;
  let count = 0;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else {
        total += st.size;
        count += 1;
      }
    }
  };
  walk(dir);
  return { bytes: total, files: count };
}

/**
 * 从仓库构建载荷目录（**不含** `resources/` 这一层，直接就是 app.asar 的内容）。
 *
 * @param {string} destDir 空目录（会先清空）
 * @param {{ log?: (m:string)=>void }} [opts]
 */
export function buildPayload(destDir, opts = {}) {
  const log = opts.log ?? (() => {});
  const dest = resolve(destDir);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  /* ① 运行期代码目录 */
  for (const dir of PAYLOAD_DIRS) {
    const src = join(PROJECT_ROOT, dir);
    if (!existsSync(src)) throw new Error(`载荷缺源目录：${dir}/`);
    walkCopy(src, join(dest, dir), (name, abs) => {
      if (skipNoise(name)) return true;
      /* `core/knowledgecard/source/` 是**写卡时的源**，运行期只读 `data/`（且发行版读编译常量） */
      if (dir === 'core' && name === 'source' && abs.includes(join('knowledgecard', 'source'))) return true;
      return false;
    });
    log(`  ✓ ${dir}/`);
  }

  /* ② tools：运行期工具（rules-service 由主进程动态 import） */
  const toolsSrc = join(PROJECT_ROOT, 'tools');
  const toolsDest = join(dest, 'tools');
  mkdirSync(toolsDest, { recursive: true });
  let toolsCount = 0;
  for (const name of readdirSync(toolsSrc)) {
    const abs = join(toolsSrc, name);
    if (!statSync(abs).isFile()) continue;
    /* `_` 开头是开发期一次性取证工具；打包工具自己也不该进包 */
    if (name.startsWith('_') || TOOLS_SKIP.has(name)) continue;
    cpSync(abs, join(toolsDest, name));
    toolsCount += 1;
  }
  log(`  ✓ tools/（${toolsCount} 个文件）`);

  /* ③ template：只带运行期需要的几样 */
  const tplDest = join(dest, 'template');
  mkdirSync(tplDest, { recursive: true });
  for (const name of TEMPLATE_ITEMS) {
    const src = join(PROJECT_ROOT, 'template', name);
    if (!existsSync(src)) {
      log(`  ⚠ template/${name} 不存在，跳过`);
      continue;
    }
    if (statSync(src).isDirectory()) walkCopy(src, join(tplDest, name), (n) => skipNoise(n));
    else cpSync(src, join(tplDest, name));
  }
  log('  ✓ template/（build + vendor + 成品页/构建脚本）');

  /* ④ 前端：只要 dist（发布形态由调用方先构建） */
  const webDist = join(PROJECT_ROOT, 'web', 'dist');
  if (!existsSync(join(webDist, 'index.html'))) {
    throw new Error('web/dist 不存在。先跑：OD_RELEASE=1 node tools/web-build.mjs');
  }
  walkCopy(webDist, join(dest, 'web', 'dist'), (n) => skipNoise(n));
  log('  ✓ web/dist/（发布形态）');

  /* ⑤ 运行期依赖（从仓库 node_modules 拷；缺一个就明确报，不带病打包） */
  const nmDest = join(dest, 'node_modules');
  mkdirSync(nmDest, { recursive: true });
  const missing = [];
  for (const dep of RUNTIME_DEPS) {
    const src = join(PROJECT_ROOT, 'node_modules', dep);
    if (!existsSync(src)) {
      missing.push(dep);
      continue;
    }
    walkCopy(src, join(nmDest, dep), (n) => skipNoise(n));
  }
  if (missing.length) {
    throw new Error(`运行期依赖缺失：${missing.join(', ')}\n  → 先在仓库跑 npm install（离线环境从 .npm-cache 还原）`);
  }
  log(`  ✓ node_modules/（${RUNTIME_DEPS.length} 个运行期依赖）`);

  /* ⑥ 载荷自己的 package.json：只留运行期字段，不把 build 配方带进发行版 */
  const rootPkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const appPkg = {
    name: rootPkg.name,
    version: rootPkg.version,
    private: true,
    type: 'module',
    main: 'electron/main.cjs',
    description: rootPkg.description,
  };
  writeFileSync(join(dest, 'package.json'), `${JSON.stringify(appPkg, null, 2)}\n`, 'utf8');
  log(`  ✓ package.json（version ${rootPkg.version}）`);

  const stat = sizeOfDir(dest);
  return { dir: dest, files: stat.files, bytes: stat.bytes, version: rootPkg.version };
}

/**
 * 把载荷目录封装成 `resources/app.asar`（并生成 `app.asar.unpacked`）。
 * 旧的 `resources/app/`、旧 asar 一并清掉 —— **绝不能两种形态同时存在**。
 */
export function packPayloadAsar(payloadDir, resourcesDir, opts = {}) {
  const log = opts.log ?? (() => {});
  const res = resolve(resourcesDir);
  const asarPath = join(res, 'app.asar');

  rmSync(join(res, 'app'), { recursive: true, force: true });
  rmSync(asarPath, { force: true });
  rmSync(`${asarPath}.unpacked`, { recursive: true, force: true });

  const stats = createAsar(payloadDir, asarPath, { unpack: ASAR_UNPACK, log });
  return { asarPath, ...stats };
}

/** 发布形态前端硬校验：产物里不得出现规则页 / 蒸馏页（与门禁 ㊳ 同一口径） */
export function assertReleaseBundle() {
  const bundlePath = join(PROJECT_ROOT, 'web', 'dist', 'assets', 'app.js');
  if (!existsSync(bundlePath)) throw new Error('web/dist/assets/app.js 不存在');
  const bundle = readFileSync(bundlePath, 'utf8');
  for (const marker of ['RulesPage', 'DistillPage']) {
    if (bundle.includes(marker)) {
      throw new Error(
        `dist 仍是开发版（含 ${marker}），拒绝打包。` +
          `请检查 OD_RELEASE=1 是否真的生效（当前 app.js ${(bundle.length / 1024).toFixed(0)} KB）`,
      );
    }
  }
  return { bytes: bundle.length };
}

/** 载荷里必须存在的条目（相对 asar 根） */
const MUST_HAVE = [
  'package.json',
  'electron/main.cjs',
  'electron/preload.cjs',
  'core/orchestrator/pipeline.mjs',
  'core/knowledgecard/v2/builtin-bundle.generated.mjs',
  'contracts/manifest.json',
  'sdk/runtime/animation-runtime.mjs',
  'web/dist/index.html',
  'template/build/animation-template.html',
  'tools/rules-service.mjs',
  'node_modules/better-sqlite3/prebuilds/win32-x64.node',
];

/**
 * 产物校验：逐项点名，缺件/形态不对一律抛错（不能在"看起来打好了"的状态下交付）。
 *
 * @param {string} resourcesDir
 * @param {{ expectVersion?: string }} [opts]
 */
export function verifyPackagedAsar(resourcesDir, opts = {}) {
  const res = resolve(resourcesDir);
  const asarPath = join(res, 'app.asar');
  if (!existsSync(asarPath)) throw new Error(`没有 ${asarPath}（载荷没封装成 asar）`);
  if (existsSync(join(res, 'app'))) throw new Error('resources/app 目录还在：源码会直接暴露，拒绝交付');

  const list = listAsar(asarPath);
  const paths = new Set(list.map((x) => x.path));
  const missing = MUST_HAVE.filter((p) => !paths.has(p));
  if (missing.length) throw new Error(`载荷缺件：${missing.join(', ')}`);

  const version = JSON.parse(readAsarText(asarPath, 'package.json')).version;
  if (opts.expectVersion && version !== opts.expectVersion) {
    throw new Error(`载荷版本 ${version} ≠ 源码版本 ${opts.expectVersion}`);
  }

  /* asar 里不得有 source map / 写卡源 / 开发探针（有就是"把不该发的发出去了"） */
  const leaked = list.filter(
    (f) => f.path.endsWith('.map') || f.path.startsWith('core/knowledgecard/source/') || /^tools\/_/.test(f.path),
  );
  if (leaked.length) throw new Error(`载荷里混进了开发期文件：${leaked.slice(0, 5).map((f) => f.path).join(', ')}`);

  /* 解包目录只允许原生模块 */
  const unpacked = list.filter((f) => f.unpacked);
  if (unpacked.length === 0) throw new Error('没有任何解包文件：better-sqlite3 的 .node 会加载失败');
  const badUnpacked = unpacked.filter((f) => !ASAR_UNPACK.test(f.path));
  if (badUnpacked.length) throw new Error(`解包目录里混进了非原生文件：${badUnpacked.slice(0, 5).map((f) => f.path).join(', ')}`);
  if (!existsSync(join(`${asarPath}.unpacked`, 'node_modules', 'better-sqlite3', 'prebuilds', 'win32-x64.node'))) {
    throw new Error('app.asar.unpacked 里缺 better-sqlite3 的 win32-x64.node');
  }

  const bytes = statSync(asarPath).size;
  return {
    asarPath,
    version,
    files: list.length,
    packed: list.length - unpacked.length,
    unpacked: unpacked.length,
    bytes,
  };
}

/** 供打包脚本打印的一句人话 */
export function describeAsar(stats) {
  return (
    `app.asar：${stats.files} 个文件（打包 ${stats.packed} · 解包 ${stats.unpacked}）` +
    ` · ${(stats.bytes / 1024 / 1024).toFixed(1)} MB · version ${stats.version}`
  );
}

/** 相对路径（日志里少打一长串盘符） */
export function relFromRoot(p) {
  return relative(PROJECT_ROOT, p) || '.';
}

/* ── 命令行：`node tools/pack-payload.mjs verify <resources 目录>` ──
 * 发版后独立复核产物形态（不需要重新打包）。 */
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, dir] = process.argv.slice(2);
  if (cmd !== 'verify') {
    console.error('用法：node tools/pack-payload.mjs verify <release\\小肥鱼物理解题动画-vX.Y.Z\\resources>');
    process.exitCode = 2;
  } else {
    try {
      const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
      const resources =
        dir ?? join(PROJECT_ROOT, 'release', `小肥鱼物理解题动画-v${pkg.version}`, 'resources');
      const stats = verifyPackagedAsar(resources, { expectVersion: pkg.version });
      console.log(`✓ ${describeAsar(stats)}`);
      console.log('✓ 没有 resources/app 目录');
      console.log('✓ 解包目录只含 .node；无 source map / 写卡源 / 开发探针');
    } catch (err) {
      console.error(`✗ 产物校验失败：${err?.message ?? err}`);
      process.exitCode = 1;
    }
  }
}

