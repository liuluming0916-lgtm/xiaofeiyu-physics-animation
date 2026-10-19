#!/usr/bin/env node
/**
 * 组装绿色版（第 8 期 · M24 · 沙箱友好路径）
 *
 * ── 为什么不用 electron-builder ──
 *
 * electron-builder 会调外部二进制（`app-builder.exe`）去下 NSIS / winCodeSign 组件，
 * 本沙箱禁止"捕获子进程输出"（EPERM），那条路走不通。
 * 而**绿色版根本不需要它**：Electron 运行时的布局是固定的 ——
 *
 *     物理解题动画/
 *       物理解题动画.exe            ← 就是 electron.exe，改名
 *       resources/app/             ← 我们的代码（package.json 的 main 指 electron/main.cjs）
 *
 * 双击 exe 即可运行，功能与安装版**完全一致**，只是没有"下一步下一步"的安装向导。
 *
 * 用法：node tools/electron-pack.mjs [--zip]
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

import { PROJECT_ROOT } from './paths.mjs';
import { resolveNodeBin } from './node-bin.mjs';

const ZIP = join(PROJECT_ROOT, '.cache-electron', 'electron-v33.0.0-win32-x64.zip');
const OUT_ROOT = join(PROJECT_ROOT, 'release');
const APP_DIR = join(OUT_ROOT, '物理解题动画');
const RES = join(APP_DIR, 'resources');
const APP = join(RES, 'app');

/** 要打进 app/ 的仓库目录（只带运行期需要的东西） */
const INCLUDE = ['electron', 'core', 'sdk', 'contracts', 'tools', 'template', 'web/dist'];

/** node_modules 里只带运行期依赖（数学公式渲染 + SQLite + AST 检查） */
const RUNTIME_DEPS = ['acorn', 'better-sqlite3', 'mathjax-full', 'mhchemparser', 'speech-rule-engine', 'wicked-good-xpath', 'mj-context-menu', 'commander', 'esm', 'node-addon-api'];

function walkCopy(src, dest, skip = () => false) {
  const st = statSync(src);
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const name of readdirSync(src)) {
      if (skip(name, join(src, name))) continue;
      walkCopy(join(src, name), join(dest, name), skip);
    }
  } else {
    mkdirSync(join(dest, '..'), { recursive: true });
    cpSync(src, dest);
  }
}

function sizeOf(dir) {
  let total = 0;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else total += st.size;
    }
  };
  walk(dir);
  return total;
}

function main() {
  const wantZip = process.argv.includes('--zip');

  if (!existsSync(ZIP)) {
    throw new Error(`没有 Electron 运行时：${ZIP}\n先跑：node tools/_fetch-electron.mjs 33.0.0`);
  }

  /**
   * ── 组装前**自己**保证 dist 是"发布形态" ──
   *
   * 为什么必须由本脚本负责（v1.0 第二次打包实测的教训）：
   *   门禁 ⑬⑭ 每次都把 `web/dist` 构建成**开发版**（含规则页/蒸馏页；设置页在两种形态里都有）。
   *   上一版打包只是"把现有 dist 拷进去"，于是装出来的软件里
   *   **导航栏还挂着「设置」「规则」**、横幅还写着"第 6 期"——
   *   用户一眼就看出来"这还是工程版"。
   *
   * 教训的通用形式：**打包脚本不能假设调用者刚刚好构建过正确形态**；
   * 凡是"产物形态"这种关键属性，都要在打包脚本里重新落实一次。
   */
  console.log('① 重跑发布形态构建（OD_RELEASE=1）…');
  const node = resolveNodeBin().bin;
  const web = spawnSync(node, [join(PROJECT_ROOT, 'tools', 'web-build.mjs')], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, OD_RELEASE: '1' },
    stdio: 'inherit',
  });
  if (web.status !== 0) throw new Error(`发布构建失败（exit ${web.status}）`);

  const tpl = spawnSync(node, [join(PROJECT_ROOT, 'template', 'build-template.mjs')], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
  if (tpl.status !== 0) throw new Error(`模板重建失败（exit ${tpl.status}）`);

  /**
   * 硬校验：dist 必须是发布版。
   * 判据用**组件标识符**（`RulesPage` / `DistillPage`）—— 与门禁 ㊳ 同一套口径，
   * 这里提前拦一次，避免"装出来才发现"。
   *
   * ⚠ v1.1.9alpha 起设置页是**必须存在**的（它是唯一的规则/知识入口），不能再把
   *   `SettingsPage` 当成"开发版残留"来拦。
   */
  const bundlePath = join(PROJECT_ROOT, 'web', 'dist', 'assets', 'app.js');
  const bundle = readFileSync(bundlePath, 'utf8');
  for (const marker of ['RulesPage', 'DistillPage']) {
    if (bundle.includes(marker)) {
      throw new Error(
        `dist 仍是开发版（含 ${marker}），拒绝打包。` +
          `请检查 OD_RELEASE=1 是否真的生效（当前 app.js ${(bundle.length / 1024).toFixed(0)} KB）`,
      );
    }
  }
  console.log(`   ✓ dist 是发布版（app.js ${(bundle.length / 1024).toFixed(0)} KB，无规则页/蒸馏页；设置页保留）`);

  if (!existsSync(join(PROJECT_ROOT, 'web', 'dist', 'index.html'))) {
    throw new Error('web/dist 不存在。先跑：OD_RELEASE=1 node tools/web-build.mjs');
  }

  console.log('解压 Electron 运行时…');
  rmSync(APP_DIR, { recursive: true, force: true });
  mkdirSync(APP_DIR, { recursive: true });
  const tar = spawnSync('tar', ['-xf', ZIP, '-C', APP_DIR], { stdio: 'inherit' });
  if (tar.status !== 0) throw new Error(`解压失败（exit ${tar.status}）`);

  console.log('把应用代码放进 resources/app …');
  mkdirSync(APP, { recursive: true });
  for (const rel of INCLUDE) {
    const src = join(PROJECT_ROOT, rel);
    if (!existsSync(src)) {
      console.warn(`  ⚠ 跳过（不存在）：${rel}`);
      continue;
    }
    walkCopy(src, join(APP, rel), (name) => name === 'node_modules' || name === '.git');
  }

  /* 运行时依赖 */
  const nm = join(APP, 'node_modules');
  mkdirSync(nm, { recursive: true });
  for (const dep of RUNTIME_DEPS) {
    const src = join(PROJECT_ROOT, 'node_modules', dep);
    if (existsSync(src)) walkCopy(src, join(nm, dep));
  }

  /**
   * app/package.json：**必须自己写一份**，不能直接拷根目录那份。
   * 原因：根 package.json 里有 devDependencies / electron-builder 的 `build` 段 / 筛查脚本，
   * 打进发行版等于把构建配方也发出去；而且 `type: module` 会让 .cjs 之外的文件按 ESM 解析 ——
   * 这两条都要保留，但其余要精简。
   */
  const rootPkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const appPkg = {
    name: rootPkg.name,
    version: rootPkg.version,
    private: true,
    type: 'module',
    main: 'electron/main.cjs',
    description: rootPkg.description,
  };
  writeFileSync(join(APP, 'package.json'), JSON.stringify(appPkg, null, 2), 'utf8');

  /**
   * 附一个**一键诊断脚本**。
   * 为什么打包时生成而不是手放：重新组装会把整个目录删掉重建（rm -rf），
   * 手放的文件活不过一次重新打包 —— 这种"下次就没了"的东西必须由脚本产出。
   */
  try {
    copyFileSync(join(PROJECT_ROOT, 'electron', 'diagnose.bat'), join(APP_DIR, '启动并诊断.bat'));
    console.log('  ✓ 已放入 启动并诊断.bat');
  } catch (e) {
    console.warn(`  ⚠ 诊断脚本没放进去：${e.message}`);
  }
  /* 可执行文件改名（Electron 支持改名；resources 按 exe 所在目录找） */
  const srcExe = join(APP_DIR, 'electron.exe');
  const dstExe = join(APP_DIR, '物理解题动画.exe');
  if (existsSync(srcExe)) {
    rmSync(dstExe, { force: true });
    renameSync(srcExe, dstExe);
  }

  /* 冒烟：exe 能不能报版本（不需要显示器） */
  console.log('\n冒烟检查…');
  const ver = spawnSync(dstExe, ['--version'], { stdio: 'inherit', timeout: 60_000 });
  const exeOk = ver.status === 0;
  console.log(exeOk ? '  ✓ exe 能启动并报版本' : `  ✗ exe 报版本失败（exit ${ver.status}）`);

  /* 关键文件点检 */
  const must = [
    'resources/app/package.json',
    'resources/app/electron/main.cjs',
    'resources/app/web/dist/index.html',
    'resources/app/tools/rules-service.mjs',
    'resources/app/core/knowledgecard/builtin-bundle.generated.mjs',
    'resources/app/template/build/animation-template.html',
  ];
  let missing = 0;
  for (const rel of must) {
    const ok = existsSync(join(APP_DIR, rel));
    if (!ok) missing += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${rel}`);
  }

  const mb = (sizeOf(APP_DIR) / 1024 / 1024).toFixed(1);
  console.log(`\n绿色版目录：${APP_DIR}`);
  console.log(`体积：${mb} MB`);

  if (wantZip) {
    console.log('\n打包成 zip（便于拷贝给别人）…');
    const zipOut = join(OUT_ROOT, `物理解题动画-v${rootPkg.version}-win-x64.zip`);
    rmSync(zipOut, { force: true });
    const r = spawnSync('tar', ['-a', '-c', '-f', zipOut, '-C', OUT_ROOT, '物理解题动画'], { stdio: 'inherit' });
    console.log(r.status === 0 ? `  ✓ ${zipOut}` : `  ✗ 压缩失败（exit ${r.status}）`);
  }

  if (!exeOk || missing > 0) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error(`\n✗ 组装失败：${err?.message ?? err}`);
  process.exitCode = 1;
}
