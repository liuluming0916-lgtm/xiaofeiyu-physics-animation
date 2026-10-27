/**
 * 读取"需要随程序一起走"的静态资源（播放器脚本、探针脚本、文本清洗器、提示词）。
 *
 * 开发态：这些文件散在各自的包里（packages/sandbox/src、packages/player/src、
 *         packages/agent/prompts、packages/shared）。
 * 打包态：build-app 把它们统一复制到 dist/app/assets/，和 server.mjs 同层。
 * 这里按固定顺序试几个位置，两套环境都能找到。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function roots(): string[] {
  return [
    path.join(here, 'assets'), // 打包态：dist/app/assets
    here, // 打包态：dist/app
    path.join(here, '..', 'sandbox', 'src'), // 开发态
    path.join(here, '..', 'player', 'src'),
    path.join(here, '..', 'agent', 'prompts'),
    path.join(process.cwd(), 'dist', 'app', 'assets'),
    path.join(process.cwd(), 'assets'),
  ];
}

export function assetPath(name: string): string {
  const tried: string[] = [];
  for (const r of roots()) {
    const p = path.join(r, name);
    tried.push(p);
    if (existsSync(p)) return p;
  }
  throw new Error(`找不到内置资源「${name}」，试过：\n${tried.join('\n')}`);
}

export function readAsset(name: string): string {
  return readFileSync(assetPath(name), 'utf8');
}
