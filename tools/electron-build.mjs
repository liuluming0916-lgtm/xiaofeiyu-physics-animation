#!/usr/bin/env node
/**
 * 打包脚本（第 8 期 · M24 · v1.1）
 *
 * 三件事，顺序不能换：
 *   ① 用 **发布形态** 构建前端（`OD_RELEASE=1`）—— 规则页与蒸馏页在产物里根本不存在，设置页保留；
 *   ② 重建模板页（成品页与 iframe 壳都在 `template/build/`，前端会把它拷进 `dist/`）；
 *   ③ 交给 electron-builder 生成安装包。
 *
 * 为什么必须"先发布构建再打包"：
 *   如果拿开发构建去打，装出来的软件里会带着规则页 / 蒸馏页（第 8 期 A1 的成果就白费了），
 *   而且体积更大。**打包脚本自己负责这件事**，不指望人记得。
 *
 * 用法：
 *   node tools/electron-build.mjs          # 出安装包（失败自动退回绿色版文件夹）
 *   node tools/electron-build.mjs --dir    # 只出绿色版文件夹（不生成安装器）
 *   node tools/electron-build.mjs --dev    # 不起包，直接跑起来看（调试用）
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { PROJECT_ROOT } from './paths.mjs';
import { nodeEnv, resolveNodeBin } from './node-bin.mjs';

const NODE = resolveNodeBin().bin;
const args = process.argv.slice(2);
const mode = args.includes('--dev') ? 'dev' : args.includes('--dir') ? 'dir' : 'installer';

function run(label, scriptPath, extraArgs = [], env = {}) {
  console.log(`\n──────── ${label} ────────`);
  const r = spawnSync(NODE, [scriptPath, ...extraArgs], {
    cwd: PROJECT_ROOT,
    env: nodeEnv(env),
    /* 不用管道：本沙箱禁止捕获子进程输出（EPERM）；inherit 放行 */
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`${label} 失败（exit ${r.status}）`);
}

function electronBin() {
  const local = join(PROJECT_ROOT, 'node_modules', 'electron');
  if (!existsSync(local)) {
    throw new Error('没装 electron。先跑：npm install --save-dev electron electron-builder');
  }
  return join(local, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
}

function builderCli() {
  const cli = join(PROJECT_ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
  if (!existsSync(cli)) throw new Error('没装 electron-builder。先跑：npm install --save-dev electron-builder');
  return cli;
}

function main() {
  console.log('小肥鱼物理动画 · 打包（v1.1）');
  console.log(`模式：${mode === 'dev' ? '直接运行（开发）' : mode === 'dir' ? '绿色版文件夹' : '安装包（NSIS）'}`);

  if (mode === 'dev') {
    /* 开发运行：不需要发布构建，直接用当前 dist 跑起来 */
    const r = spawnSync(electronBin(), ['.'], { cwd: PROJECT_ROOT, env: nodeEnv(), stdio: 'inherit' });
    process.exitCode = r.status ?? 0;
    return;
  }

  /* ① 发布形态前端（构建开关生效：产物里没有规则页/蒸馏页；设置页保留） */
  run('① 发布形态前端构建（OD_RELEASE=1）', join(PROJECT_ROOT, 'tools', 'web-build.mjs'), [], { OD_RELEASE: '1' });

  /* ② 模板页重建（成品页 + iframe 壳） */
  run('② 模板页重建', join(PROJECT_ROOT, 'template', 'build-template.mjs'));

  /* ③ 打包 */
  const cli = builderCli();
  const common = ['--win', 'x64', '--config', join(PROJECT_ROOT, 'package.json')];

  if (mode === 'dir') {
    run('③ 生成绿色版文件夹', cli, [...common, '--dir']);
  } else {
    console.log('\n──────── ③ 生成安装包（NSIS）────────');
    const r = spawnSync(NODE, [cli, ...common, '--publish', 'never'], {
      cwd: PROJECT_ROOT,
      env: nodeEnv(),
      stdio: 'inherit',
    });

    if (r.status !== 0) {
      /**
       * 安装器要额外下载 NSIS 组件（另一个 ~100 MB）。某些网络下拉不下来。
       * 那就**退回绿色版文件夹**：解压即用，双击 exe 就能开 —— 功能一模一样，
       * 只是没有"下一步下一步"的安装向导。**不能让用户什么都拿不到。**
       */
      console.warn('\n⚠ 安装包生成失败（常见原因：NSIS 组件下载不下来）。退回生成绿色版文件夹…');
      run('③b 生成绿色版文件夹（兜底）', cli, [...common, '--dir']);
    }
  }

  report();
}

function report() {
  const out = join(PROJECT_ROOT, 'release');
  console.log('\n──────── 产物 ────────');
  if (!existsSync(out)) {
    console.log('⚠ 没找到 release/ 目录，请检查上面的日志');
    return;
  }
  const walk = (dir, depth = 0) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        if (depth < 3) walk(abs, depth + 1);
      } else if (/\.(exe|zip|msi|blockmap)$/i.test(name) && st.size > 1e6) {
        console.log(`  · ${abs.replace(PROJECT_ROOT + '\\', '')}  ${(st.size / 1024 / 1024).toFixed(1)} MB`);
      }
    }
  };
  walk(out);
  console.log('\n双击上面 .exe：安装包（或绿色版里的 小肥鱼物理动画.exe）即可运行。');
  console.log('首次运行若被 Windows 拦截：点「更多信息 → 仍要运行」（未做代码签名，属于正常提示）。');
}


try {
  main();
} catch (err) {
  console.error(`\n✗ 打包失败：${err?.message ?? err}`);
  process.exitCode = 1;
}
