/**
 * 一次性脚本：把 15 道题的**状态量实测范围**打成一张表（写 C10 的 SIM.regions 时抄）。
 * 用法：node tools/_ranges.mjs
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { probe } from './probe-question.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'tests', 'regression-15');

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.mjs')).sort()) {
  const program = (await import(pathToFileURL(join(DIR, file)).href)).default;
  const r = probe(program, { dt: 0.004 });
  const rng = (seg) => {
    const parts = [];
    for (const key of ['x', 'y', 'x2', 'y2', 'carA', 'carB', 's', 'v', 'phase']) {
      const box = seg.keys[key];
      if (box) parts.push(`${key}=[${box.min.toFixed(4)}, ${box.max.toFixed(4)}]`);
    }
    return parts.join(' ');
  };
  console.log(`\n${String(program.index).padStart(2, '0')} ${program.id}  时长 ${r.duration}`);
  for (const seg of r.segments) {
    console.log(`   phase ${String(seg.phase).padEnd(4)} t∈[${seg.t0.toFixed(3)}, ${seg.t1.toFixed(3)}]  ${rng(seg)}`);
  }
  console.log(`   键：${Object.keys(r.series[0].st).join(', ')}`);
}
