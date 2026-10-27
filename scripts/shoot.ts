/**
 * 给任意一个导出的动画网页截图（含宿主播放器）。
 *
 * 用法：node scripts/shoot.ts <html> <物理秒数> <输出png> [幕序号，从0开始]
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { Sandbox } from '../packages/sandbox/src/runner.ts';

const [html, tArg, out, actArg] = process.argv.slice(2);
if (!html || !out) {
  console.error('用法：node scripts/shoot.ts <html> <物理秒数> <输出png> [幕序号]');
  process.exit(2);
}
const t = Number(tArg) || 0;
const actIndex = Number(actArg) || 0;

const sb = await Sandbox.open(path.resolve(html), { height: 820, scale: 2 });
const acts = await sb.acts();
const act = acts[Math.min(actIndex, acts.length - 1)] ?? { physical: 4 };
const physical = act.physical || 4;

for (let i = 0; i < Math.min(actIndex, Math.max(0, acts.length - 1)); i++) {
  await sb.evaluate(`document.querySelector('[data-act="next"]')?.click()`);
}

await sb.evaluate(
  `(() => { const s = document.querySelector('.xfy-seek'); if (!s) return; s.value = '${Math.round(
    Math.min(1, Math.max(0, t / physical)) * 1000,
  )}'; s.dispatchEvent(new Event('input')); })()`,
);
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
await sb.screenshot(path.resolve(out), 0.5);
console.log(`已截图 ${out}（第 ${actIndex + 1} 幕，物理 ${t}s / ${physical.toFixed(2)}s）`);
await sb.close();
