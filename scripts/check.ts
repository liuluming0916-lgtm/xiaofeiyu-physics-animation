/**
 * 对一个现成的动画文件跑一遍完整的沙盒质检（不调模型）。
 *
 * 用法：node scripts/check.ts examples/two-acts.html [--shots]
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { Engine } from '../packages/agent/src/tools.ts';

const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/check.ts <html> [--shots]');
  process.exit(2);
}

const outDir = path.resolve('开源日志', '_check', path.basename(file, '.html'));
const engine = new Engine(outDir);
await engine.setCode(readFileSync(path.resolve(file), 'utf8'));
const res = await engine.check();
console.log(res.text);

if (process.argv.includes('--shots')) {
  const look = await engine.look([]);
  console.log(`\n截图 ${look.images.length} 张：`);
  for (const f of look.images) console.log('  ' + f);
}

await engine.close();
process.exit(res.ok ? 0 : 1);
