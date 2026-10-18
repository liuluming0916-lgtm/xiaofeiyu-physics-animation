#!/usr/bin/env node
/**
 * 一次性取证工具：Worker 沙箱在本环境到底能不能用。
 *
 * 第 2 期的头号交付是 `worker_threads + resourceLimits + 硬 kill`（§6.3）。
 * 第 1 期曾误判"沙箱禁止子进程"（当时归因于 `OD_NODE_BIN` 指向 Electron 壳；
 * 实际根因是**宿主沙箱禁止管道捕获子进程输出**，真 Node 下同样会 EPERM），
 * 因此这里**先探针后实现**，把四个能力点分别取证：
 *   ① 能不能 new Worker（ESM 入口）；
 *   ② worker 里能不能跑 `node:vm`；
 *   ③ `resourceLimits.maxOldGenerationSizeMb` 能不能真的把内存顶死并报错；
 *   ④ 死循环能不能被 `terminate()` 硬终止，且 `SharedArrayBuffer` 里的"当前行"能读回来。
 */

import { Worker } from 'node:worker_threads';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'od-worker-probe-'));
const workerFile = join(dir, 'probe-worker.mjs');

writeFileSync(
  workerFile,
  `
import { parentPort, workerData } from 'node:worker_threads';
import { createContext, Script } from 'node:vm';

const sab = workerData.sab;
const view = new Int32Array(sab);

if (workerData.mode === 'vm') {
  const ctx = createContext({ Math, out: null }, { name: 'probe' });
  new Script('out = Math.sqrt(16) + 1;').runInContext(ctx, { timeout: 1000 });
  parentPort.postMessage({ ok: true, value: ctx.out });
}

if (workerData.mode === 'oom') {
  const hog = [];
  for (let i = 0; i < 1e9; i += 1) hog.push(new Array(1000).fill(i));
  parentPort.postMessage({ ok: true, leaked: hog.length });
}

if (workerData.mode === 'spin') {
  // 模拟"模型写出了跑不完的循环"：只有 vm 里的代码在转，宿主线程无法插入任何检查
  const ctx = createContext({ mark: (line) => { view[0] = line; Atomics.add(view, 1, 1); }, i: 0, x: 0 }, { name: 'spin' });
  new Script('mark(7); for (i = 0; i < 1e12; i += 1) { x = x + i; mark(8); }').runInContext(ctx);
  parentPort.postMessage({ ok: true, i: ctx.i });
}
`,
  'utf8',
);

function run(label, mode, { resourceLimits, killAfterMs } = {}) {
  return new Promise((resolve) => {
    const sab = new SharedArrayBuffer(8);
    const view = new Int32Array(sab);
    const worker = new Worker(workerFile, { workerData: { mode, sab }, resourceLimits });
    const started = Date.now();
    let settled = false;
    const finish = (out) => {
      if (settled) return;
      settled = true;
      resolve({ label, ...out, wallClockMs: Date.now() - started, lastLine: view[0], ticks: view[1] });
    };
    worker.on('message', (msg) => finish({ status: 'message', msg }));
    worker.on('error', (err) => finish({ status: 'error', name: err?.name, message: String(err?.message ?? err).slice(0, 120) }));
    worker.on('exit', (code) => finish({ status: 'exit', code }));
    if (killAfterMs) {
      setTimeout(() => {
        worker.terminate().then(() => finish({ status: 'terminated-by-parent' }));
      }, killAfterMs);
    }
  });
}

const results = [];
results.push(await run('① new Worker + postMessage', 'vm'));
results.push(await run('② worker 内 node:vm', 'vm'));
results.push(await run('③ resourceLimits 内存上限', 'oom', { resourceLimits: { maxOldGenerationSizeMb: 32 } }));
results.push(await run('④ 死循环硬终止 + SharedArrayBuffer 行号', 'spin', { killAfterMs: 800 }));

for (const r of results) {
  console.log(
    `${r.label}：${r.status}` +
      (r.value !== undefined ? ` · 值=${r.value}` : '') +
      (r.code !== undefined ? ` · code=${r.code}` : '') +
      (r.name ? ` · ${r.name}: ${r.message}` : '') +
      ` · ${r.wallClockMs} ms` +
      (r.ticks !== undefined ? ` · 最后执行行=${r.lastLine}（标记 ${r.ticks} 次）` : ''),
  );
}

rmSync(dir, { recursive: true, force: true });
