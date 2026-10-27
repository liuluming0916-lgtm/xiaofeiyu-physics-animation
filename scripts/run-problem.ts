/**
 * 跑一道题：出题 → 模型写码 → 沙盒试跑 → 看关键帧 → 自修 → 交付。
 *
 * 用法：
 *   node scripts/run-problem.ts --text "题目文字"
 *   node scripts/run-problem.ts --file 题目.txt
 *   node scripts/run-problem.ts            # 用内置示例题
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { loadEnv } from '../packages/agent/src/config.ts';
import { runProblem } from '../packages/agent/src/loop.ts';

loadEnv();

const DEFAULT_PROBLEM = `如图，倾角为 30° 的光滑斜面固定在水平面上，斜面长 L = 6 m。
一个质量 m = 1 kg 的小球从斜面顶端由静止释放，g 取 9.8 m/s²。
求：(1) 小球滑到斜面底端所用的时间；(2) 小球到达底端时的速度大小。`;

const args = process.argv.slice(2);
let problem = '';
const ti = args.indexOf('--text');
const fi = args.indexOf('--file');
if (ti >= 0) problem = args[ti + 1] ?? '';
else if (fi >= 0) problem = readFileSync(args[fi + 1] ?? '', 'utf8');
else problem = args.find((a) => !a.startsWith('--') && !a.endsWith('.png') && !a.endsWith('.jpg')) ?? '';

// 题目图片（可重复 --image）
const images: string[] = [];
for (let i = 0; i < args.length - 1; i++) {
  if (args[i] === '--image') images.push(path.resolve(args[i + 1]));
}

if (!problem.trim() && !images.length) problem = DEFAULT_PROBLEM;

const d = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
const slug = problem.replace(/\s+/g, '').slice(0, 12).replace(/[\\/:*?"<>|]/g, '');
const outDir = path.resolve('开源日志', `${stamp}-${slug}`);

console.log(`题目：${problem.replace(/\n/g, ' ').slice(0, 80)}…`);
console.log(`输出：${outDir}\n`);

const started = Date.now();
const res = await runProblem(problem, {
  outDir,
  images,
  onEvent: (e) => {
    const s = ((Date.now() - started) / 1000).toFixed(1).padStart(5);
    console.log(`[${s}s] ${e.type.padEnd(6)} ${e.text}`);
  },
});

console.log('\n===== 结果 =====');
console.log(`交付：${res.ok ? '是' : '否'}（${res.reason}）`);
console.log(`写了 ${res.writes} 版代码，${res.failedChecks} 次质检未通过`);
console.log(`耗时 ${(res.elapsedMs / 1000).toFixed(1)} 秒`);
console.log(`tokens：输入 ${res.usage.prompt}，输出 ${res.usage.completion}（其中思考 ${res.usage.reasoning}）`);
console.log(`动画：${res.htmlPath}`);
process.exit(res.ok ? 0 : 1);
