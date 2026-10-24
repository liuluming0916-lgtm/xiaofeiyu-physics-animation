#!/usr/bin/env node
/**
 * 组装绿色版（第 8 期 · M24；v1.1.12 起载荷进 `app.asar`）。
 *
 * ── 为什么不用 electron-builder ──
 *
 * electron-builder 会调外部二进制（`app-builder.exe`）去下 NSIS / winCodeSign 组件，
 * 本沙箱禁止"捕获子进程输出"（EPERM），那条路走不通。
 * 而**绿色版根本不需要它**：Electron 运行时的布局是固定的 ——
 *
 *     小肥鱼物理解题动画/
 *       小肥鱼物理解题动画.exe            ← 就是 electron.exe，改名
 *       resources/app.asar         ← 我们的代码（package.json 的 main 指 electron/main.cjs）
 *       resources/app.asar.unpacked/  ← 原生模块（*.node）
 *
 * 双击 exe 即可运行，功能与安装版**完全一致**，只是没有"下一步下一步"的安装向导。
 *
 * ⚠ 与 `electron-repack` 的分工：
 *   本脚本从 Electron 官方 zip 起一套**全新**运行时，要求 `.cache-electron/electron-*.zip` 在；
 *   `electron-repack` 复用 `release/` 里现成的运行时（离线环境更常用）。
 *   两者共用 `tools/pack-payload.mjs` 的载荷清单与 asar 封装 —— 不再各写一份。
 *
 * 用法：node tools/electron-pack.mjs [--zip]
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { PROJECT_ROOT } from './paths.mjs';
import { nodeEnv, resolveNodeBin } from './node-bin.mjs';
import {
  assertReleaseBundle,
  buildPayload,
  describeAsar,
  packPayloadAsar,
  verifyPackagedAsar,
} from './pack-payload.mjs';

const ELECTRON_VERSION = process.env.OD_ELECTRON_VERSION ?? '35.7.5';
const ZIP = join(PROJECT_ROOT, '.cache-electron', `electron-v${ELECTRON_VERSION}-win32-x64.zip`);
const OUT_ROOT = join(PROJECT_ROOT, 'release');
const APP_DIR = join(OUT_ROOT, '小肥鱼物理解题动画');
const RES = join(APP_DIR, 'resources');
const payloadDir = join(PROJECT_ROOT, '.tmp', 'payload-pack');

const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

function runScript(label, scriptPath, env = {}) {
  console.log(`\n──────── ${label} ────────`);
  const r = spawnSync(resolveNodeBin().bin, [scriptPath], {
    cwd: PROJECT_ROOT,
    env: nodeEnv(env),
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`${label} 失败（exit ${r.status}）`);
}

function dirSize(dir) {
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
  if (!existsSync(ZIP)) {
    throw new Error(`没有 Electron 运行时：${ZIP}\n先跑：node tools/_fetch-electron.mjs ${ELECTRON_VERSION}`);
  }

  /* ① 发布形态前端。打包脚本不能假设调用者刚刚好构建过正确形态（v1.0 实测教训）。 */
  runScript('① 发布形态前端构建（OD_RELEASE=1）', join(PROJECT_ROOT, 'tools', 'web-build.mjs'), { OD_RELEASE: '1' });
  runScript('② 模板页重建', join(PROJECT_ROOT, 'template', 'build-template.mjs'));
  const dist = assertReleaseBundle();
  console.log(`  ✓ dist 是发布版（app.js ${(dist.bytes / 1024).toFixed(0)} KB）`);

  /* ② 解压运行时 */
  console.log('\n解压 Electron 运行时…');
  rmSync(APP_DIR, { recursive: true, force: true });
  mkdirSync(APP_DIR, { recursive: true });
  const tar = spawnSync('tar', ['-xf', ZIP, '-C', APP_DIR], { stdio: 'inherit' });
  if (tar.status !== 0) throw new Error(`解压失败（exit ${tar.status}）`);

  /* ③ 载荷 → app.asar */
  console.log('\n──────── ③ 重建载荷并封装 asar ────────');
  const payload = buildPayload(payloadDir, { log: console.log });
  packPayloadAsar(payloadDir, RES, { log: console.log });
  rmSync(payloadDir, { recursive: true, force: true });
  const stats = verifyPackagedAsar(RES, { expectVersion: VERSION });
  console.log(`  ✓ ${describeAsar(stats)}`);

  /* ④ 诊断脚本 + 可执行文件改名（Electron 支持改名；resources 按 exe 所在目录找） */
  try {
    copyFileSync(join(PROJECT_ROOT, 'electron', 'diagnose.bat'), join(APP_DIR, '启动并诊断.bat'));
    console.log('  ✓ 已放入 启动并诊断.bat');
  } catch (e) {
    console.warn(`  ⚠ 诊断脚本没放进去：${e.message}`);
  }
  const srcExe = join(APP_DIR, 'electron.exe');
  const dstExe = join(APP_DIR, '小肥鱼物理解题动画.exe');
  if (existsSync(srcExe)) {
    rmSync(dstExe, { force: true });
    renameSync(srcExe, dstExe);
  }

  /* ⑤ 冒烟：先 `--version`，再真跑一遍自检（服务 / 首页 / 账本 / Worker） */
  console.log('\n──────── ④ 冒烟 ────────');
  const ver = spawnSync(dstExe, ['--version'], { stdio: 'inherit', timeout: 60_000 });
  console.log(ver.status === 0 ? '  ✓ exe 能启动并报版本' : `  ✗ exe 报版本失败（exit ${ver.status}）`);
  if (ver.status !== 0) throw new Error('exe 起不来，停止打包');

  const selftestOut = join(APP_DIR, 'od-selftest.txt');
  rmSync(selftestOut, { force: true });
  const smokeRoot = join(APP_DIR, '.selftest');
  rmSync(smokeRoot, { recursive: true, force: true });
  mkdirSync(join(smokeRoot, 'temp'), { recursive: true });
  /* ⚠ 清 ELECTRON_RUN_AS_NODE：否则 exe 按 Node 跑、直接 exit 0，冒烟是假绿 */
  const selfEnv = {
    ...process.env,
    OD_SELFTEST: '1',
    OD_SELFTEST_OUT: selftestOut,
    OD_USER_DATA_DIR: join(smokeRoot, 'userdata'),
    OD_DOCUMENTS_DIR: join(smokeRoot, 'documents'),
    OD_CRASH_DIR: join(smokeRoot, 'crash'),
    OD_DISABLE_CRASH_REPORTER: '1',
    TEMP: join(smokeRoot, 'temp'),
    TMP: join(smokeRoot, 'temp'),
  };
  delete selfEnv.ELECTRON_RUN_AS_NODE;
  const self = spawnSync(dstExe, ['--no-sandbox', '--disable-gpu'], {
    cwd: APP_DIR,
    env: selfEnv,
    stdio: 'inherit',
    timeout: 180_000,
  });
  if (self.status !== 0) throw new Error(`自检失败（exit ${self.status}）`);
  let selfTxt;
  try {
    selfTxt = readFileSync(selftestOut, 'utf8');
  } catch {
    throw new Error(`自检没有产出结果（${selftestOut}）—— exe 没真正跑起来`);
  }
  for (const line of selfTxt.trim().split(/\r?\n/)) console.log(`    ${line}`);
  if (!/worker=true/.test(selfTxt)) throw new Error('自检失败：Worker 沙箱不可用（worker=false）');
  if (!/payload=app\.asar/.test(selfTxt)) throw new Error('自检失败：载荷形态不是 app.asar');
  rmSync(selftestOut, { force: true });
  rmSync(smokeRoot, { recursive: true, force: true });
  console.log('  ✓ 自检通过（服务 / 首页 / 账本 / Worker）');

  /**
   * ⑤ 程序目录里的「开源日志」（用户点名要求）。
   * 空目录在 zip 里会被丢掉，所以放一个隐藏的 0 字节占位文件；对用户不可见。
   */
  const logDir = join(APP_DIR, '开源日志');
  mkdirSync(logDir, { recursive: true });
  const keep = join(logDir, '.keep');
  if (!existsSync(keep)) {
    writeFileSync(keep, '');
    spawnSync('attrib', ['+h', keep], { stdio: 'ignore' });
  } else {
    spawnSync('attrib', ['+h', keep], { stdio: 'ignore' });
  }
  console.log('  ✓ 开源日志/ 已就位');

  /* ⑥ 关键文件点检（asar 内 + unpacked 外的原生模块） */
  console.log('\n关键文件点检：');
  const must = [
    'resources/app.asar',
    'resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node',
    '小肥鱼物理解题动画.exe',
    '启动并诊断.bat',
  ];
  let missing = 0;
  for (const rel of must) {
    const ok = existsSync(join(APP_DIR, rel));
    if (!ok) missing += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${rel}`);
  }
  if (missing > 0) throw new Error(`关键文件缺 ${missing} 个`);

  const mb = (dirSize(APP_DIR) / 1024 / 1024).toFixed(1);
  console.log(`\n绿色版目录：${APP_DIR}`);
  console.log(`体积：${mb} MB`);

  if (process.argv.includes('--zip')) {
    console.log('\n打包成 zip（便于拷贝给别人）…');
    const zipOut = join(OUT_ROOT, `小肥鱼物理解题动画-v${VERSION}-win-x64.zip`);
    rmSync(zipOut, { force: true });
    const r = spawnSync('tar', ['-a', '-c', '-f', zipOut, '-C', OUT_ROOT, '小肥鱼物理解题动画'], { stdio: 'inherit' });
    console.log(r.status === 0 ? `  ✓ ${zipOut}` : `  ✗ 压缩失败（exit ${r.status}）`);
    if (r.status !== 0) process.exitCode = 1;
  }
}

try {
  main();
} catch (err) {
  console.error(`\n✗ 组装失败：${err?.message ?? err}`);
  process.exitCode = 1;
}
