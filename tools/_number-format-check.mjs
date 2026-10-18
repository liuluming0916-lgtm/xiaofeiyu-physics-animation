/**
 * `_number-format-check` —— 取证：**画布文字与读数里不得出现"十几位小数"**。
 *
 * 用户反馈"数值题把小数点后十几位数直接放在动画中即时生成"。
 * 这条判据把整段动画里**真正画出去的字符串**全部收集起来，找 ≥5 位小数的数字。
 * 它测的是渲染结果，不是源码长相 —— 所以多行拼接、模板字符串、变量间接传入都能抓到。
 *
 * 用法：node tools/_number-format-check.mjs
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assembleProgramSource, sandboxBundle, createPlayerFromFactory } from '../sdk/runtime/animation-runtime.mjs';
import { makeMockCanvas } from '../tests/harness/canvas-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'tests', 'regression-15');

/**
 * 判断字符串里是否出现了"有效数字超过 4 位"的数字。
 *
 * ⚠ 不能简单按"小数点后 ≥5 位"判：`0.00347` 是 3 位有效数字的**正确**输出（小数点多不代表精度高）。
 * 这里按**有效数字**算：去掉小数点与前导零后还剩几位。
 */
function hasLongNumber(s) {
  const nums = String(s).match(/\d+\.\d+/g);
  if (!nums) return false;
  return nums.some((n) => n.replace('.', '').replace(/^0+/, '').length > 4);
}

let bad = 0;
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.mjs')).sort()) {
  const program = (await import(pathToFileURL(join(DIR, file)).href)).default;
  const canvas = makeMockCanvas();
  const assembly = assembleProgramSource(program.slots, { mode: program.mode ?? 'NUMERIC' });
  // eslint-disable-next-line no-new-func
  const factory = new Function('runtime', `${assembly}\nreturn buildProgram;`)(sandboxBundle());
  const player = createPlayerFromFactory(factory, { canvas, dpr: 1 });

  const offenders = new Map();
  for (let k = 0; k <= 12; k += 1) {
    player.state.t = (player.duration * k) / 12;
    const frame = player.render();
    // ① 命令记录里的文字（题目自己交给渲染器的）
    for (const rec of frame.records) {
      const s = rec.op === 'text' ? rec.text : rec.op === 'latex' ? rec.tex : rec.op === 'dimension' ? rec.text : null;
      if (typeof s === 'string' && hasLongNumber(s)) offenders.set(s, (offenders.get(s) || 0) + 1);
    }
    // ② 真正画到画布上的每一个字符串 —— 这一层才能抓到**渲染器内部拼出来**的文字
    //    （箭头标签 `label = mag unit` 就是在这里露出的：`v = 3.385926899562456 m/s`）
    for (const call of canvas.__calls) {
      if (call.op !== 'fillText' && call.op !== 'strokeText') continue;
      for (const s of call.texts || []) {
        if (hasLongNumber(s)) offenders.set(s, (offenders.get(s) || 0) + 1);
      }
    }
    // ③ 读数面板的显示串（原始值保持全精度，这里查的是显示文本）
    for (const r of frame.readouts) {
      const s = `${r.label || r.key} = ${player.runtime.format(r.value, r.unit || '', 3)}`;
      if (hasLongNumber(s)) offenders.set(s, (offenders.get(s) || 0) + 1);
    }
  }
  if (offenders.size) bad += 1;
  console.log(
    `  ${offenders.size ? '✗' : '✓'} ${String(program.index).padStart(2, '0')} ${program.title.padEnd(18, '　')} ` +
      (offenders.size ? `发现 ${offenders.size} 条长小数文本：${[...offenders.keys()].slice(0, 3).map((s) => JSON.stringify(s.slice(0, 60))).join(' , ')}` : '画布与读数里都没有 ≥5 位小数的数字'),
  );
}
console.log(bad ? `\n✗ ${bad} 道题在画面上直接显示了长小数` : '\n✓ 15 道题的画布文字与读数都没有 ≥5 位小数的数字');
if (bad) process.exitCode = 1;
