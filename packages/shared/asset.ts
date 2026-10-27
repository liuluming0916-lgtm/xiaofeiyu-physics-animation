/**
 * 读取"需要随程序一起走"的静态资源（播放器脚本、探针脚本、文本清洗器）。
 *
 * 开发态：文件就在各自包的 src 目录里。
 * 打包态：所有资源被复制到 dist/assets/ 下，bundle 文件和它们同层。
 * 所以这里按几个候选路径依次找，两套环境都能用。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function assetPath(name: string): string {
  const candidates = [
    path.join(here, name),
    path.join(here, 'assets', name),
    path.join(here, '..', 'assets', name),
    path.join(here, '..', '..', 'shared', name),
    path.join(process.cwd(), 'assets', name),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`找不到内置资源「${name}」，试过：\n${candidates.join('\n')}`);
}

export function readAsset(name: string): string {
  return readFileSync(assetPath(name), 'utf8');
}
