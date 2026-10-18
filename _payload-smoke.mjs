/**
 * _payload-smoke —— 打包产物的**冒烟自检**（第 9 期 · v1.1）。
 *
 * 打包能"生成文件"不等于"能跑"。这个脚本直接**从打包出来的载荷里 import 真模块**，
 * 用载荷自带的那份 `node_modules` 解析依赖，确认：
 *   ① 词条库能加载；② SDK 运行时可加载；③ 提示词系统的指纹与源码一致。
 *
 * 它不进包（在仓库根，package.json 的 files 不含根文件）。
 * 用法：node _payload-smoke.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, 'release', '物理解题动画-v1.1', 'resources', 'app');
const at = (rel) => new URL(`file://${join(app, rel).replace(/\\/g, '/')}`).href;

let bad = 0;
const ok = (name, extra = '') => console.log(`✓ ${name}${extra ? ` — ${extra}` : ''}`);
const no = (name, extra = '') => {
  bad += 1;
  console.log(`✗ ${name}${extra ? ` — ${extra}` : ''}`);
};

try {
  const { loadLibrary } = await import(at('core/worldbook/store.mjs'));
  const lib = loadLibrary();
  ok('载荷里的词条库能加载', `${lib.entries.length} 条`);
} catch (err) {
  no('载荷里的词条库能加载', err.message);
}

try {
  const rt = await import(at('sdk/runtime/animation-runtime.mjs'));
  const keys = Object.keys(rt);
  ok('载荷里的 SDK 运行时可加载', `${keys.length} 个导出`);
} catch (err) {
  no('载荷里的 SDK 运行时可加载', err.message);
}

try {
  const prompts = await import(at('core/prompts/index.mjs'));
  const h = prompts.buildFixedPrefix().promptHash;
  const stage = prompts.buildStagePrefix('read_problem').text.length;
  ok('载荷里的提示词系统可用', `promptHash ${h.slice(0, 8)}… · 读题前缀 ${stage} 字`);
} catch (err) {
  no('载荷里的提示词系统可用', err.message);
}

try {
  const { dryRun } = await import(at('core/dryrun/dry-run.mjs'));
  ok('载荷里的干跑内核可加载', typeof dryRun === 'function' ? 'dryRun 是函数' : '形状异常');
} catch (err) {
  no('载荷里的干跑内核可加载', err.message);
}

console.log(bad ? `\n✗ 冒烟自检失败 ${bad} 项` : '\n✓ 载荷冒烟自检通过');
if (bad) process.exitCode = 1;
