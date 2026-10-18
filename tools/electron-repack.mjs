#!/usr/bin/env node
/**
 * electron-repack —— **离线重打包**（第 9 期 · v1.1）。
 *
 * ── 为什么要有这个脚本 ──
 * 标准的 `tools/electron-build.mjs` 走 electron-builder；而本期环境里
 * `node_modules/electron` 与 `node_modules/electron-builder` **都没装**，npm registry 也不可达
 * （离线）。但 `release/物理解题动画`（v1.0 的绿色版）里已经有一份**完整可用的 Electron 33 运行时**
 * 与 `resources/app` 载荷 —— 于是用"**换载荷、保运行时**"的方式重打包：
 *
 *   ① 用**发布形态**重建前端（`OD_RELEASE=1`，设置页/规则页不进产物）；
 *   ② 重建模板页（成品页 + iframe 壳）；
 *   ③ 复制 v1.0 绿色版为 v1.1，**只替换 `resources/app`**（运行时一个字节不动）；
 *   ④ 打成 zip。
 *
 * ⚠ 这与"electron-builder 出的安装包"**不是同一个东西**：这里是**绿色版**（解压即用），
 *   没有 NSIS 安装向导。v1.0 交付的也正是绿色版 + zip，所以形态一致。
 *
 * 用法：
 *   node tools/electron-repack.mjs            # 打包
 *   node tools/electron-repack.mjs --no-build # 不重建前端与模板（只重组载荷）
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { PROJECT_ROOT } from './paths.mjs';
import { nodeEnv, resolveNodeBin } from './node-bin.mjs';

const NODE = resolveNodeBin().bin;
const releaseDir = join(PROJECT_ROOT, 'release');
const baseName = '物理解题动画';
const basePkg = join(releaseDir, baseName); // v1.0 绿色版：Electron 运行时的来源
/* 目录名跟 package.json 版本走 —— 写死 v1.1 会在发 1.1.2 时悄悄骗人 */
const PKG_VERSION = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8')).version;
const targetName = `${baseName}-v${PKG_VERSION}`;
const targetPkg = join(releaseDir, targetName);
const payload = join(targetPkg, 'resources', 'app');

const noBuild = process.argv.includes('--no-build');

const pkgJson = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
const VERSION = pkgJson.version;

function run(label, scriptPath, env = {}) {
  console.log(`\n──────── ${label} ────────`);
  const r = spawnSync(NODE, [scriptPath], { cwd: PROJECT_ROOT, env: nodeEnv(env), stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${label} 失败（exit ${r.status}）`);
}

/**
 * 目录镜像复制（用 **robocopy**，不用 `fs.cpSync`）。
 *
 * ⚠ 实测：`cpSync` 复制这份 180 MB 的运行时树会让 Node 直接崩掉（exit 0xC0000409，
 *   STATUS_STACK_BUFFER_OVERRUN），连目标目录都没建出来。robocopy 是 Windows 原生工具，
 *   大目录、长路径、海量小文件都稳。它的退出码 0–7 都算成功（1 = 复制了文件），≥8 才是失败。
 */
function mirror(src, dst) {
  const r = spawnSync('robocopy', [src, dst, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { stdio: 'inherit' });
  const code = r.status ?? 1;
  if (code >= 8) throw new Error(`robocopy 失败（exit ${code}）：${src} → ${dst}`);
}

function dirSize(p) {
  let total = 0;
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const abs = join(d, n);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else total += st.size;
    }
  };
  walk(p);
  return total;
}

function assertBase() {
  const exe = join(basePkg, `${baseName}.exe`);
  if (!existsSync(exe)) {
    throw new Error(`找不到 v1.0 绿色版运行时：${exe}\n  → 这条离线路线要求 release/ 里留着上一版的 Electron 运行时。`);
  }
  if (!existsSync(join(basePkg, 'resources', 'app'))) {
    throw new Error('v1.0 绿色版里没有 resources/app，无法从它取载荷骨架');
  }
}

/** 把 v1.0 的绿色版整份复制成 v1.1（运行时 + 旧载荷骨架） */
function cloneRuntime() {
  if (existsSync(targetPkg)) {
    console.log(`\n清理旧目录：${targetName}`);
    rmSync(targetPkg, { recursive: true, force: true });
  }
  console.log(`复制 Electron 运行时 → ${targetName}`);
  mirror(basePkg, targetPkg);
}

/** 用当前源码覆盖载荷里的对应部分（node_modules 保持旧包里的那份：依赖版本没变） */
function overlayPayload() {
  const oldTools = new Set(
    readdirSync(join(basePkg, 'resources', 'app', 'tools')).filter((f) => statSync(join(basePkg, 'resources', 'app', 'tools', f)).isFile()),
  );

  /* 整目录替换：契约 / 引擎 / 主进程 / SDK */
  for (const dir of ['contracts', 'core', 'electron', 'sdk']) {
    const dst = join(payload, dir);
    mirror(join(PROJECT_ROOT, dir), dst);
    console.log(`  ✓ ${dir}/`);
  }

  /* template：只带运行时要的那几样（build 产物 + vendor 公式 + 页面与构建脚本） */
  const tpl = join(payload, 'template');
  rmSync(tpl, { recursive: true, force: true });
  mkdirSync(tpl, { recursive: true });
  for (const name of ['build', 'vendor', 'animation-template.html', 'build-template.mjs', 'tex-inline-renderer.js']) {
    const src = join(PROJECT_ROOT, 'template', name);
    if (!existsSync(src)) continue;
    /* ⚠ robocopy 只能复制**目录** —— 单个文件仍用 cpSync */
    if (statSync(src).isDirectory()) mirror(src, join(tpl, name));
    else cpSync(src, join(tpl, name));
  }
  console.log('  ✓ template/（build + vendor + 页面/构建脚本）');

  /* web：只带 dist（源码不进包） */
  const web = join(payload, 'web');
  rmSync(web, { recursive: true, force: true });
  mkdirSync(web, { recursive: true });
  mirror(join(PROJECT_ROOT, 'web', 'dist'), join(web, 'dist'));
  console.log('  ✓ web/dist/（发布形态）');

  /* tools：非下划线前缀的运行时工具（`_` 开头是开发期一次性取证工具，不进包） */
  const tools = join(payload, 'tools');
  rmSync(tools, { recursive: true, force: true });
  mkdirSync(tools, { recursive: true });
  let copied = 0;
  for (const f of readdirSync(join(PROJECT_ROOT, 'tools'))) {
    /**
     * ⚠ **整份 tools 都带**（含 `_` 前缀的开发期工具），与 v1.0 交付一致。
     *
     * 一开始我按"`_` 是开发期一次性工具、不进包"过滤，结果差点踩坑：
     * `tools/web-build.mjs` 会调用 `tools/_run-bundle-probe.mjs`（产物可执行性探针）。
     * 既然非下划线工具会依赖下划线工具，"跳过 `_`"就不是一条能站得住的规则。
     * 这些文件加起来只有几百 KB，带上比缺件安全。
     */
    const abs = join(PROJECT_ROOT, 'tools', f);
    if (!statSync(abs).isFile()) continue;
    cpSync(abs, join(tools, f));
    copied += 1;
  }
  console.log(`  ✓ tools/（${copied} 个文件；v1.0 时是 ${oldTools.size} 个）`);

  /* package.json：裁剪成运行时需要的最小面（与 v1.0 包内那份同形） */
  const trimmed = {
    name: pkgJson.name,
    version: VERSION,
    private: pkgJson.private,
    type: pkgJson.type,
    main: pkgJson.main,
    description: pkgJson.description,
  };
  writeFileSync(join(payload, 'package.json'), `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
  console.log(`  ✓ package.json（version ${VERSION}）`);

  /* 旧包里的 asar 若存在必须删掉：Electron 优先加载 app.asar，会把新载荷盖回旧代码 */
  const asar = join(targetPkg, 'resources', 'app.asar');
  if (existsSync(asar)) {
    rmSync(asar, { force: true });
    console.log('  ✓ 删除 resources/app.asar（否则 Electron 会优先加载旧载荷）');
  }
  void oldTools;
}

function checkPayload() {
  const need = [
    'package.json',
    'electron/main.cjs',
    'electron/preload.cjs',
    'core/orchestrator/pipeline.mjs',
    'core/prompts/index.mjs',
    'core/worldbook/data',
    'contracts/manifest.json',
    'sdk/runtime/animation-runtime.mjs',
    'web/dist/index.html',
    'template/build',
    'node_modules/better-sqlite3',
  ];
  const missing = need.filter((p) => !existsSync(join(payload, p)));
  if (missing.length) throw new Error(`载荷缺件：${missing.join(', ')}`);

  const v = JSON.parse(readFileSync(join(payload, 'package.json'), 'utf8')).version;
  const n = (() => {
    let c = 0;
    const walk = (d) => {
      for (const x of readdirSync(d)) {
        const abs = join(d, x);
        if (statSync(abs).isDirectory()) walk(abs);
        else c += 1;
      }
    };
    walk(payload);
    return c;
  })();
  console.log(`\n载荷校验：${n} 个文件 · ${(dirSize(payload) / 1024 / 1024).toFixed(1)} MB · package.json version=${v}`);
  if (v !== VERSION) throw new Error(`载荷版本 ${v} ≠ 源码版本 ${VERSION}`);
}

function main() {
  console.log(`${baseName} · 离线重打包（${VERSION}）`);
  assertBase();

  if (!noBuild) {
    run('① 发布形态前端构建（OD_RELEASE=1）', join(PROJECT_ROOT, 'tools', 'web-build.mjs'), { OD_RELEASE: '1' });
    run('② 模板页重建', join(PROJECT_ROOT, 'template', 'build-template.mjs'));
  } else {
    console.log('\n（--no-build：跳过前端与模板重建）');
  }

  cloneRuntime();
  console.log('\n替换载荷：');
  overlayPayload();
  checkPayload();

  console.log(`\n✓ 绿色版已生成：release\\${targetName}`);
  console.log('  下一步压缩成 zip（体积约 130 MB，需要一点时间）。');
}

try {
  main();
} catch (err) {
  console.error(`\n✗ 重打包失败：${err?.message ?? err}`);
  process.exitCode = 1;
}
