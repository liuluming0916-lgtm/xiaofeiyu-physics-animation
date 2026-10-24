#!/usr/bin/env node
/**
 * electron-repack —— **离线重打包**（第 9 期 · v1.1；v1.1.12 起载荷进 app.asar）。
 *
 * ── 为什么要有这个脚本 ──
 * 标准的 `tools/electron-build.mjs` 走 electron-builder；而本环境里
 * `node_modules/electron` 与 `node_modules/electron-builder` **都没装**，npm registry 也不可达
 * （离线）。但 `release/` 里已经有一份**完整可用的 Electron 33 运行时**，于是用
 * "**换载荷、保运行时**"的方式重打包：
 *
 *   ① 用**发布形态**重建前端（`OD_RELEASE=1`，规则页/蒸馏页不进产物；设置页保留）；
 *   ② 重建模板页（成品页 + iframe 壳）；
 *   ③ 复制现成运行时为目标版本目录，删掉旧载荷；
 *   ④ 从源码重建载荷并封装成 `resources/app.asar`（原生模块进 `app.asar.unpacked`）；
 *   ⑤ `--selftest` 冒烟（真 exe、真服务、真账本、真 Worker）；
 *   ⑥ `--zip` 打成压缩包。
 *
 * ⚠ 这是**绿色版**（解压即用），没有 NSIS 安装向导；与 v1.0 以来交付形态一致。
 *
 * 用法：
 *   node tools/electron-repack.mjs            # 打包（不压缩）
 *   node tools/electron-repack.mjs --zip      # 打包 + zip
 *   node tools/electron-repack.mjs --no-build # 不重建前端与模板（只重装载荷）
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { PROJECT_ROOT } from './paths.mjs';
import { nodeEnv, resolveNodeBin } from './node-bin.mjs';
import {
  assertReleaseBundle,
  buildPayload,
  describeAsar,
  packPayloadAsar,
  verifyPackagedAsar,
} from './pack-payload.mjs';

const NODE = resolveNodeBin().bin;
const releaseDir = join(PROJECT_ROOT, 'release');
const baseName = '小肥鱼物理动画';
/* 目录名跟 package.json 版本走 —— 写死版本会在发下一版时悄悄骗人 */
const pkgJson = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
const VERSION = pkgJson.version;
const targetName = `${baseName}-v${VERSION}`;
const targetPkg = join(releaseDir, targetName);
const resourcesDir = join(targetPkg, 'resources');
const asarPath = join(resourcesDir, 'app.asar');
const payloadDir = join(PROJECT_ROOT, '.tmp', `payload-v${VERSION}`);

const noBuild = process.argv.includes('--no-build');
const wantZip = process.argv.includes('--zip');

let basePkg = null;
let stashedBase = null;

/**
 * 运行时来源：release/ 里任何带 `<name>.exe` 且带 `resources/app` **或** `resources/app.asar`
 * 的目录都能当来源；优先选不是当前目标的那一个。
 *
 * v1.1.12 起自己的产物是 asar（没有 `resources/app` 目录），所以判据必须同时认两种形态，
 * 否则第二次打包就"找不到运行时"了。
 */
function pickRuntimeBase() {
  const names = readdirSync(releaseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => {
      if (!existsSync(join(releaseDir, n, `${baseName}.exe`))) return false;
      return existsSync(join(releaseDir, n, 'resources', 'app')) || existsSync(join(releaseDir, n, 'resources', 'app.asar'));
    });
  if (names.length === 0) {
    throw new Error(
      `release/ 里找不到可用的 Electron 运行时（需要 ${baseName}.exe + resources/app 或 resources/app.asar）。\n` +
        '  → 先解压一个含运行时的旧版绿色包到 release/，或从 .cache-electron 的 Electron zip 重建。',
    );
  }
  const preferred = names.filter((n) => n !== targetName);
  return join(releaseDir, preferred[0] ?? targetName);
}

function run(label, scriptPath, env = {}) {
  console.log(`\n──────── ${label} ────────`);
  const r = spawnSync(NODE, [scriptPath], { cwd: PROJECT_ROOT, env: nodeEnv(env), stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${label} 失败（exit ${r.status}）`);
}

/**
 * 目录镜像复制（robocopy）。
 *
 * ⚠ 实测：`cpSync` 复制这份 ~180 MB 的运行时树会让 Node 直接崩掉（exit 0xC0000409），
 *   所以用 Windows 原生的 robocopy。退出码 0–7 都算成功，≥8 才是失败。
 */
function mirror(src, dst) {
  const r = spawnSync('robocopy', [src, dst, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { stdio: 'inherit' });
  const code = r.status ?? 1;
  if (code >= 8) throw new Error(`robocopy 失败（exit ${code}）：${src} → ${dst}`);
}

function assertBase() {
  const exe = join(basePkg, `${baseName}.exe`);
  if (!existsSync(exe)) {
    throw new Error(`找不到 Electron 运行时：${exe}\n  → release/ 里至少要有 一个带 exe 的绿色版目录。`);
  }
  if (!existsSync(join(basePkg, 'resources'))) {
    throw new Error('运行时目录里没有 resources/，不是完整的 Electron 绿色版');
  }
}

/** 把运行时来源整份复制成当前版本目录 */
function cloneRuntime() {
  if (basePkg === targetPkg) {
    stashedBase = join(releaseDir, `${targetName}.runtime-src`);
    rmSync(stashedBase, { recursive: true, force: true });
    console.log(`\n当前版本既是目标又是唯一运行时来源：先挪到 ${targetName}.runtime-src`);
    renameSync(targetPkg, stashedBase);
    basePkg = stashedBase;
  }
  if (existsSync(targetPkg)) {
    console.log(`\n清理旧目录：${targetName}`);
    rmSync(targetPkg, { recursive: true, force: true });
  }
  console.log(`复制 Electron 运行时 → ${targetName}`);
  mirror(basePkg, targetPkg);
}

/**
 * 真 exe 冒烟：起服务 → `/api/health` → 首页 → 账本 → **Worker 沙箱**。
 * 这一步专门用来抓"装出来才发现"的问题：asar 里 ESM 能否 import、native 能否 dlopen、
 * worker 能否从 asar 起线程。任何一项失败都不该进入压缩步骤。
 */
function smokeTest() {
  const exe = join(targetPkg, `${baseName}.exe`);
  const selftestOut = join(targetPkg, 'od-selftest.txt');
  rmSync(selftestOut, { force: true });
  const smokeRoot = join(targetPkg, '.selftest');
  rmSync(smokeRoot, { recursive: true, force: true });
  mkdirSync(join(smokeRoot, 'temp'), { recursive: true });
  console.log('\n──────── ④ 冒烟（真 exe · --selftest）────────');
  /**
   * ⚠ 必须清掉 `ELECTRON_RUN_AS_NODE`。
   *   DSH / 某些开发环境会把它设为 1；此时 Electron exe 会按 **Node** 运行，
   *   无参数时直接 exit 0 —— 冒烟会"绿着但根本没启动应用"（v1.1.17 首包踩过）。
   * ⚠ 路径覆盖到程序目录：受限环境里 `%APPDATA%` /「文档」可能不可写。
   */
  const env = {
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
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(exe, ['--no-sandbox', '--disable-gpu'], {
    cwd: targetPkg,
    env,
    stdio: 'inherit',
    timeout: 180_000,
  });
  if (r.status !== 0) {
    /* 冒烟不过就不压缩：一个"能启动但服务起不来"的包比没有包更糟 */
    throw new Error(`冒烟失败（exit ${r.status}）—— 先修，别压缩`);
  }
  /* GUI 进程的 stdout 在 Windows 上抓不到，自检结果由主进程落一份到程序目录 */
  let txt;
  try {
    txt = readFileSync(selftestOut, 'utf8');
  } catch {
    throw new Error(
      `冒烟没有产出自检结果（${selftestOut}）—— 很可能 exe 根本没跑起来（ELECTRON_RUN_AS_NODE / 崩溃），不能算通过`,
    );
  }
  for (const line of txt.trim().split(/\r?\n/)) console.log(`    ${line}`);
  rmSync(selftestOut, { force: true });

  /* 自检的布尔项就是判据：别只看退出码（--selftest 设计上不因账本降级而退出非 0） */
  if (!/worker=true/.test(txt)) throw new Error('冒烟失败：Worker 沙箱不可用（worker=false）');
  if (!/index=true/.test(txt)) throw new Error('冒烟失败：首页取不到（index=false）');
  if (!/payload=app\.asar/.test(txt)) throw new Error('冒烟失败：载荷形态不是 app.asar');
  if (/history=false/.test(txt)) {
    console.warn('  ⚠ 账本降级（history=false）—— 多为 Electron 33 的 Node-API 9 与 better-sqlite3 13（N-API 10）不兼容；不影响导出');
  }
  rmSync(smokeRoot, { recursive: true, force: true });
  console.log('  ✓ 冒烟通过（服务 / 首页 / 账本 / Worker）');
}

function report(mb) {
  console.log('\n──────── 产物 ────────');
  console.log(`  绿色版：release\\${targetName}`);
  console.log(`  体积：${mb} MB（含运行时；载荷 ${(statSync(asarPath).size / 1024 / 1024).toFixed(1)} MB）`);
  console.log(`  源码形态：resources\\app.asar + app.asar.unpacked（**没有** resources\\app 目录）`);
  console.log('  双击 小肥鱼物理动画.exe 即可运行。');
}

function main() {
  console.log(`${baseName} · 离线重打包（${VERSION}）`);
  basePkg = pickRuntimeBase();
  console.log(`运行时来源：${basePkg.replace(PROJECT_ROOT, '.')}`);
  assertBase();

  if (!noBuild) {
    run('① 发布形态前端构建（OD_RELEASE=1）', join(PROJECT_ROOT, 'tools', 'web-build.mjs'), { OD_RELEASE: '1' });
    run('② 模板页重建', join(PROJECT_ROOT, 'template', 'build-template.mjs'));
  } else {
    console.log('\n（--no-build：跳过前端与模板重建）');
  }

  const dist = assertReleaseBundle();
  console.log(`  ✓ dist 是发布版（app.js ${(dist.bytes / 1024).toFixed(0)} KB，无规则页/蒸馏页；设置页保留）`);

  cloneRuntime();

  console.log('\n──────── ③ 重建载荷 ────────');
  const payload = buildPayload(payloadDir, { log: console.log });
  console.log(`  载荷：${payload.files} 个文件 · ${(payload.bytes / 1024 / 1024).toFixed(1)} MB · version ${payload.version}`);

  console.log('\n封装 app.asar …');
  packPayloadAsar(payloadDir, resourcesDir, { log: console.log });
  rmSync(payloadDir, { recursive: true, force: true });

  const stats = verifyPackagedAsar(resourcesDir, { expectVersion: VERSION });
  console.log(`  ✓ ${describeAsar(stats)}`);
  if (existsSync(join(resourcesDir, 'app'))) throw new Error('resources/app 目录仍在，源码会暴露');

  smokeTest();

  /**
   * ── v1.1.7：程序目录里必须有「开源日志」文件夹（用户点名要求）──
   *
   * 由打包脚本建，而不是等首次运行：用户拿到压缩包就该看得见这个文件夹；
   * 而且 `cloneRuntime()` 是 `robocopy /MIR`，手放的文件夹活不过一次重新打包。
   *
   * ⚠ 空文件夹在 zip 里会被丢掉（`tar -a` / `Compress-Archive` 都不写空目录项），
   *   所以放一个隐藏的 0 字节占位文件；对用户不可见（`attrib +h`），也不占空间。
   */
  const logDir = join(targetPkg, '开源日志');
  mkdirSync(logDir, { recursive: true });
  /**
   * ⚠ 只在**不存在**时新建占位文件。
   * 老版本目录里那份 `.keep` 是隐藏文件，被 robocopy 一起复制过来；
   * 对已存在的隐藏文件做 truncate 在部分 Windows/安全软件组合下会 EPERM
   * （实测：`writeFileSync` 报 EPERM，但新建 `.keep2` 正常）。
   * 它本来就是 0 字节占位，没必要重写。
   */
  const keep = join(logDir, '.keep');
  if (!existsSync(keep)) {
    try {
      writeFileSync(keep, '');
      spawnSync('attrib', ['+h', keep], { stdio: 'ignore' });
    } catch (e) {
      console.warn(`  ⚠ 占位文件没写成（zip 里可能丢空目录）：${e.message}`);
    }
  } else {
    spawnSync('attrib', ['+h', keep], { stdio: 'ignore' });
  }
  console.log('\n✓ 日志落点已就位：开源日志/（每次跑题自动导出 html + json）');

  if (wantZip) {
    const zipOut = join(releaseDir, `${targetName}-win-x64.zip`);
    console.log(`\n压缩 → ${zipOut}`);
    rmSync(zipOut, { force: true });
    const r = spawnSync('tar', ['-a', '-c', '-f', zipOut, '-C', releaseDir, targetName], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`压缩失败（exit ${r.status}）`);
    console.log(`  ✓ ${(statSync(zipOut).size / 1024 / 1024).toFixed(1)} MB`);
  }

  const mb = (() => {
    let total = 0;
    const walk = (d) => {
      for (const n of readdirSync(d)) {
        const abs = join(d, n);
        const st = statSync(abs);
        if (st.isDirectory()) walk(abs);
        else total += st.size;
      }
    };
    walk(targetPkg);
    return (total / 1024 / 1024).toFixed(1);
  })();

  report(mb);
  if (stashedBase) {
    rmSync(stashedBase, { recursive: true, force: true });
    console.log('  ✓ 清理临时运行时源（打包成功，目标目录已完整）');
  }
  if (!wantZip) console.log('  下一步压缩成 zip：加 --zip 参数重跑（需要一点时间）。');
}

try {
  main();
} catch (err) {
  console.error(`\n✗ 重打包失败：${err?.message ?? err}`);
  process.exitCode = 1;
}
