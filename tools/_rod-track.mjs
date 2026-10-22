/**
 * _rod-track —— 从 `_shot` 录下来的帧里，量"画出来的棒"每帧的屏幕横坐标。
 *
 * 为什么：`drawFrame` 里只要有一处 `state.e0.x` 被乘了系数（或相机被重设），
 * 画面上的位移就和物理位移对不上 —— 而 Dry-Run 只比对 state，看不见画面。
 * 这里把"画面位移 / 物理位移"算成比值，1.000 才算画对了。
 *
 * 用法：node tools/_rod-track.mjs tests/reports/shot-q06-model
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('用法：node tools/_rod-track.mjs <shot 目录>');
  process.exit(2);
}
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const rows = [];
for (const f of meta.frames) {
  const frame = JSON.parse(readFileSync(join(dir, `frame-${String(f.index).padStart(2, '0')}.json`), 'utf8'));
  let best = null;
  for (const op of frame.ops) {
    if (op.kind !== 'stroke' || Math.abs(Number(op.width) - 4) > 1e-6) continue;
    for (const sub of op.subpaths ?? []) {
      const ys = sub.map((p) => p[1]);
      if (sub.length >= 2 && Math.max(...ys) - Math.min(...ys) > 100) {
        best = (sub[0][0] + sub[sub.length - 1][0]) / 2;
      }
    }
  }
  rows.push({ t: f.t, x: best });
}
const first = rows[0];
const last = rows[rows.length - 1];
console.log('t\t屏幕x');
for (const r of rows) console.log(`${r.t.toFixed(3)}\t${r.x === null ? '—' : r.x.toFixed(1)}`);
if (first.x !== null && last.x !== null) {
  console.log(`\n屏幕位移 ${(last.x - first.x).toFixed(1)} px（t ${first.t} → ${last.t}）`);
}
