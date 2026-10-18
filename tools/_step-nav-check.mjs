/**
 * `_step-nav-check` —— 取证：**"上一步/下一步"在每一题里都能逐级走完，并且走得到结尾**。
 *
 * 做法：从**打包后的成品页**里把 `indexOfStep` 的真实源码抠出来（测的是出厂字节，不是另抄一份），
 * 再用每一题真实的 STEPS 模拟连点：起点 → 下一步 ×N → 结尾 → 上一步 ×N → 回到 0。
 *
 * 用户反馈"下一步键点击无效果"的根因就是 indexOfStep 的边界判定（t 恰在 t1 时返回上一步），
 * 所以这条判据专门盯"每一步都必须真的前进"。
 *
 * 用法：node tools/_step-nav-check.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseStepsSlot } from '../sdk/runtime/animation-runtime.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'tests', 'regression-15');
const BUILT = join(ROOT, 'template', 'build', 'animation-template.html');

/** 从 build 产物里抠出 indexOfStep 的函数源码（按大括号配对，避免正则截断） */
function extractIndexOfStep(html) {
  const start = html.indexOf('function indexOfStep(');
  if (start < 0) throw new Error('成品页里找不到 indexOfStep');
  let depth = 0;
  let i = html.indexOf('{', start);
  const bodyStart = i;
  for (; i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return html.slice(start, i + 1);
}

const src = extractIndexOfStep(readFileSync(BUILT, 'utf8'));
console.log('从成品页取到的 indexOfStep：');
console.log(
  src
    .split('\n')
    .slice(0, 6)
    .map((l) => '  ' + l.trim())
    .join('\n'),
);
console.log('');

let bad = 0;
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.mjs')).sort()) {
  const program = (await import(pathToFileURL(join(DIR, file)).href)).default;
  const STEPS = parseStepsSlot(program.slots.STEPS);
  const duration = (program.slots.VIEW.match(/duration:\s*([\d.]+)/) || [])[1];
  const dur = Number(duration);
  // eslint-disable-next-line no-new-func
  const indexOfStep = new Function('STEPS', `${src}\nreturn indexOfStep;`)(STEPS);

  // 模拟：起点 → 连点"下一步" → 结尾；再连点"上一步" → 回到 0
  const forward = [0];
  let t = 0;
  for (let k = 0; k < STEPS.length + 1; k += 1) {
    const i = indexOfStep(t);
    t = i >= STEPS.length - 1 ? dur : STEPS[i + 1].t0;
    forward.push(t);
  }
  const visitedAll = STEPS.slice(1).every((s) => forward.some((x) => Math.abs(x - s.t0) < 1e-9));
  const reachedEnd = Math.abs(forward[forward.length - 1] - dur) < 1e-9;
  const monotone = forward.every((v, i) => i === 0 || v > forward[i - 1] - 1e-9);

  const backward = [dur];
  t = dur;
  for (let k = 0; k < STEPS.length + 1; k += 1) {
    const i = indexOfStep(t);
    const target = i > 0 && Math.abs(t - STEPS[i].t0) < 1e-6 ? i - 1 : i;
    t = Math.max(0, STEPS[target].t0);
    backward.push(t);
  }
  const backToZero = backward.some((x) => Math.abs(x) < 1e-9);

  const ok = visitedAll && reachedEnd && monotone && backToZero;
  if (!ok) bad += 1;
  console.log(
    `  ${ok ? '✓' : '✗'} ${String(program.index).padStart(2, '0')} ${program.title.padEnd(18, '　')} ` +
      `${STEPS.length} 步 ⇒ 前进序列 [${forward.map((v) => v.toFixed(2)).join(' → ')}]` +
      `${ok ? '' : `（逐级到位 ${visitedAll} / 到达结尾 ${reachedEnd} / 单调 ${monotone} / 能退回起点 ${backToZero}）`}`,
  );
}
console.log(bad ? `\n✗ ${bad} 道题的步进导航有问题` : `\n✓ 15 道题的"下一步/上一步"都能逐级走完并到达结尾/回到起点`);
if (bad) process.exitCode = 1;
