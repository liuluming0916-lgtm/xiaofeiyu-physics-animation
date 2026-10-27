/**
 * M0 演示：把一个手写的单文件动画丢进沙盒，快进、截图、出指标。
 * 目标不是"好看"，而是证明三件事：
 *   1. 时间可以被沙盒任意拨动（不用真等 4 秒）
 *   2. 不用模型配合，也能读出画面里有什么（文字块、图形、空白率）
 *   3. 数值可以被独立核对（v、s 与解析解对账）
 */
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Sandbox } from '../packages/sandbox/src/runner.ts';
import { checkCapture, checkSweep, digest } from '../packages/sandbox/src/checks.ts';
import type { Issue } from '../packages/sandbox/src/types.ts';

const HTML = path.resolve('examples/incline-ball.html');
const OUT = path.resolve('开源日志', 'm0');

const G = 9.8;
const THETA = Math.PI / 6;
const A = G * Math.sin(THETA); // 4.9 m/s²
const LEN = 6;

const started = Date.now();
const sb = await Sandbox.open(HTML, {});
const acts = await sb.acts();
const physical = acts[0]?.physical ?? Math.sqrt((2 * LEN) / A);

const issues: Issue[] = [];
const captures: { ms: number; text: string }[] = [];

// ---- 1. 五个关键时刻截图 + 单帧检查（按物理时间取帧）----
const shots = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(physical * 1000 * f));
for (let i = 0; i < shots.length; i++) {
  const file = path.join(OUT, `incline-${String(i).padStart(2, '0')}.png`);
  const { capture } = await sb.shoot(shots[i], file);
  const label = `第 ${i + 1} 帧（物理 ${(shots[i] / 1000).toFixed(2)} s）`;
  const found = checkCapture(capture, label);
  issues.push(...found);
  captures.push({ ms: shots[i], text: digest(capture) });
  console.log(`\n[${label}]`);
  console.log(digest(capture));
  if (found.length) for (const f of found) console.log(`  ✗ ${f.level.toUpperCase()} ${f.message}`);
}

// ---- 2. 数值对账：解析解 vs 探针读数 ----
console.log('\n[数值对账]');
const checkpoints = [0.5, 1.0, 1.5].map((t) => ({ t, expect: { v: A * t, s: 0.5 * A * t * t } }));
const rows: string[] = [];
for (const cp of checkpoints) {
  const v = await sb.sample(cp.t);
  if (!v) {
    console.log('  探针缺失，跳过');
    break;
  }
  const okV = Math.abs(v.v - cp.expect.v) < 1e-6;
  const okS = Math.abs(v.s - cp.expect.s) < 1e-6;
  rows.push(
    `  t=${cp.t.toFixed(1)}s  v 期望 ${cp.expect.v.toFixed(3)} 实测 ${Number(v.v).toFixed(3)} ${okV ? '✓' : '✗'}` +
      `   s 期望 ${cp.expect.s.toFixed(3)} 实测 ${Number(v.s).toFixed(3)} ${okS ? '✓' : '✗'}`,
  );
  if (!okV) issues.push({ id: 'value-mismatch', level: 'error', message: `t=${cp.t}s 速度与解析解不符：期望 ${cp.expect.v}，实际 ${v.v}` });
  if (!okS) issues.push({ id: 'value-mismatch', level: 'error', message: `t=${cp.t}s 位移与解析解不符：期望 ${cp.expect.s}，实际 ${v.s}` });
}
console.log(rows.join('\n'));

// ---- 3. 密集采样：查 NaN 与位置断层 ----
const sweep = await sb.sweep(90);
const sweepIssues = checkSweep(sweep, null);
issues.push(...sweepIssues);
console.log(`\n[密集采样] ${sweep.length} 个点，异常 ${sweepIssues.length} 条`);
for (const f of sweepIssues) console.log(`  ✗ ${f.message}`);

// ---- 4. 收尾 ----
const elapsed = Date.now() - started;
const errors = issues.filter((i) => i.level === 'error');
console.log(`\n===== 结论 =====`);
console.log(`快进并检查了 ${shots.length} 帧 + ${sweep.length} 个采样点，实际耗时 ${(elapsed / 1000).toFixed(2)} 秒`);
console.log(`错误 ${errors.length} 条，警告 ${issues.filter((i) => i.level === 'warn').length} 条`);
if (sb.violations.length) console.log(`外网请求 ${sb.violations.length} 个（应为 0）：${sb.violations.slice(0, 3).join(', ')}`);

mkdirSync(OUT, { recursive: true });
writeFileSync(
  path.join(OUT, 'report.json'),
  JSON.stringify({ html: HTML, physical, acts, elapsedMs: elapsed, violations: sb.violations, issues, captures }, null, 2),
  'utf8',
);

await sb.close();
process.exit(errors.length ? 1 : 0);
