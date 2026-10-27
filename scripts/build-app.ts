/**
 * 构建桌面版运行时：把服务端打成一个 .mjs，并带上需要的静态资源。
 *
 * 产物结构：
 *   dist/app/server.mjs      服务端（含全部依赖）
 *   dist/app/assets/*.js     探针 / 文本清洗 / 播放器（运行时读文件注入页面）
 *   dist/app/web/**          教师界面
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('dist/app');
const ASSETS = path.join(OUT, 'assets');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(ASSETS, { recursive: true });

await build({
  entryPoints: [path.resolve('apps/server/src/server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(OUT, 'server.mjs'),
  external: ['electron'],
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __xfyRequire } from 'node:module';\nconst require = __xfyRequire(import.meta.url);",
  },
});

const ASSET_FILES = [
  ['packages/sandbox/src/page-runtime.js', 'page-runtime.js'],
  ['packages/shared/text-clean.js', 'text-clean.js'],
  ['packages/player/src/player.js', 'player.js'],
  ['packages/agent/prompts/system.md', 'system.md'],
];
for (const [src, name] of ASSET_FILES) {
  copyFileSync(path.resolve(src), path.join(ASSETS, name));
  console.log(`asset: ${name}`);
}

cpSync(path.resolve('apps/web'), path.join(OUT, 'web'), { recursive: true });
console.log('asset: web/');

// 把许可文件也带上（打包产物要随身携带）
for (const f of ['LICENSE', 'NOTICE', 'LICENSE-DOCS', 'COMMERCIAL.md', 'TRADEMARK.md']) {
  if (existsSync(path.resolve(f))) {
    copyFileSync(path.resolve(f), path.join(OUT, f));
    console.log(`asset: ${f}`);
  }
}

console.log(`\n构建完成：${OUT}`);
