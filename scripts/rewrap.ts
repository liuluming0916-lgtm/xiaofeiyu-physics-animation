/**
 * 把已经生成的动画重新包一层外壳（不调用模型，几秒钟一个）。
 * 用途：播放器外壳改了（例如加了自适应缩放、全屏按钮），旧产物可以原地升级。
 *
 * 用法：node scripts/rewrap.ts [目录...]    默认重打 开源日志/batch 下所有题目
 */
import path from 'node:path';
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { wrapWithPlayer } from '../packages/player/src/export.ts';

const roots = process.argv.slice(2).map((p) => path.resolve(p));
const targets = roots.length ? roots : [path.resolve('开源日志/batch')];

let done = 0;
for (const root of targets) {
  if (!existsSync(root)) continue;
  const dirs = statSync(root).isDirectory() ? readdirSync(root) : [];
  const list = [root, ...dirs.map((d) => path.join(root, d))].filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch (_) {
      return false;
    }
  });
  for (const dir of list) {
    const raw = path.join(dir, 'current.html');
    if (!existsSync(raw)) continue;
    const html = wrapWithPlayer(readFileSync(raw, 'utf8'));
    writeFileSync(path.join(dir, 'animation.html'), html, 'utf8');
    done++;
    console.log(`已重包 ${path.basename(dir)}  ${(html.length / 1024).toFixed(1)} KB`);
  }
}
console.log(`共 ${done} 个`);
