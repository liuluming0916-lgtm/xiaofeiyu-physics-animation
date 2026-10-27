/**
 * 把"只有舞台"的动画包成"舞台 + 宿主播放器"，并截图。
 *
 * 用法：node scripts/build-player-demo.ts <源html> <输出png> <物理时刻s>
 */
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { wrapWithPlayer, inspectContract } from '../packages/player/src/export.ts';
import { Sandbox } from '../packages/sandbox/src/runner.ts';

const [srcArg, outArg, tArg] = process.argv.slice(2);
const src = path.resolve(srcArg ?? 'examples/incline-ball.html');
const png = path.resolve(outArg ?? '开源日志/player/player-demo.png');
const tPhys = Number(tArg ?? 1.2);

mkdirSync(path.dirname(png), { recursive: true });
const html = readFileSync(src, 'utf8');
console.log('契约检查：', inspectContract(html));

const wrapped = wrapWithPlayer(html);
const file = png.replace(/\.png$/, '.html');
writeFileSync(file, wrapped, 'utf8');
console.log(`已生成 ${file}（${(wrapped.length / 1024).toFixed(1)} KB）`);

const sb = await Sandbox.open(file, { height: 900, scale: 2 });
const acts = await sb.acts();
const physical = acts[0]?.physical ?? 4;
await sb.evaluate(
  `(() => { const s = document.querySelector('.xfy-seek'); s.value = '${Math.round(
    Math.min(1, Math.max(0, tPhys / physical)) * 1000,
  )}'; s.dispatchEvent(new Event('input')); })()`,
);
await sb.screenshot(png, 0.5);
console.log(`截图 ${png}（共 ${acts.length} 幕，物理 ${tPhys}s / ${physical.toFixed(2)}s）`);
await sb.close();
