/**
 * `_trace-toggle-check` —— 取证：**"轨迹"开关在每一题里都必须真的改变画面**。
 *
 * 用户反馈"大部分题目的轨迹虚线功能仍未实装"。这条判据把"有没有实装"变成数字：
 * 同一时刻渲染两次，只切 `mask.trace`，比较真正回放到画布的命令数。
 * 差值 ≥ 1 说明该题确实画了轨迹，且开关能控制它。
 *
 * 用法：node tools/_trace-toggle-check.mjs
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assembleProgramSource, sandboxBundle, createPlayerFromFactory } from '../sdk/runtime/animation-runtime.mjs';
import { makeMockCanvas } from '../tests/harness/canvas-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'tests', 'regression-15');

let bad = 0;
const rows = [];
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.mjs')).sort()) {
  const program = (await import(pathToFileURL(join(DIR, file)).href)).default;
  const canvas = makeMockCanvas();
  const assembly = assembleProgramSource(program.slots, { mode: program.mode ?? 'NUMERIC' });
  // eslint-disable-next-line no-new-func
  const factory = new Function('runtime', `${assembly}\nreturn buildProgram;`)(sandboxBundle());
  const player = createPlayerFromFactory(factory, { canvas, dpr: 1 });

  const countWith = (traceOn) => {
    player.state.mask.trace = traceOn;
    player.state.t = player.duration * 0.6;
    const frame = player.render();
    const dashedCurves = frame.records.filter((r) => r.op === 'curve' && r.dash).length;
    return { painted: frame.painted, dashedCurves };
  };
  const on = countWith(true);
  const off = countWith(false);
  const delta = on.painted - off.painted;
  if (delta < 1) bad += 1;
  rows.push({ index: program.index, title: program.title, delta, onDashed: on.dashedCurves, on: on.painted, off: off.painted });
}

console.log('轨迹开关取证 · 只切 mask.trace，比较真正回放（painted）的命令数');
for (const r of rows) {
  console.log(
    `  ${r.delta >= 1 ? '✓' : '✗'} ${String(r.index).padStart(2, '0')} ${r.title.padEnd(18, '　')} ` +
      `开 ${String(r.on).padStart(3)} 条 / 关 ${String(r.off).padStart(3)} 条 ⇒ 差 ${r.delta}（其中虚线曲线 ${r.onDashed} 条）`,
  );
}
console.log(bad ? `\n✗ ${bad} 道题的"轨迹"开关不起作用` : `\n✓ 15 道题的"轨迹"开关都能改变画面`);
if (bad) process.exitCode = 1;
