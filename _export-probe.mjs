/**
 * _export-probe —— 复现"点导出就闪退"（只读诊断，不改任何业务代码）。
 *
 * 导出网页走 `POST /api/export/page`，处理它的就是 `tools/rules-service.mjs` 里的同一个服务 ——
 * 也就是说**不起图形界面也能复现服务端那一半**。如果进程在这里就死掉/抛致命错，
 * 那就不是前端的锅，而是导出页构建这条链路在打包形态下有问题。
 *
 * 用法：node _export-probe.mjs
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRulesService } from './tools/rules-service.mjs';

const q = (await import('./tests/regression-15/q01-conveyor-heat.mjs')).default;

const dir = mkdtempSync(join(tmpdir(), 'od-export-probe-'));
process.env.OD_EXPORT_DIR = join(dir, 'exports');

let service = null;
try {
  service = createRulesService({ port: 0, root: join(dir, 'ai-rules'), serveStatic: false });
  const port = await service.listen();
  console.log(`服务端口 ${port}`);

  const body = {
    slots: q.slots,
    id: q.id,
    index: q.index,
    title: q.title,
    examPoint: q.examPoint,
    mode: q.mode ?? 'NUMERIC',
    model: 'probe',
    promptHash: null,
    worldbookHash: null,
    labelAvoid: null,
  };

  console.log('POST /api/export/page …');
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${port}/api/export/page`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`HTTP ${res.status} · ${Date.now() - t0} ms · ${text.length} 字节`);
  console.log(text.slice(0, 600));
} catch (err) {
  console.error('✗ 探针捕获异常：', err?.stack ?? err);
  process.exitCode = 1;
} finally {
  try {
    await service?.close();
  } catch {
    /* ignore */
  }
}
console.log('探针正常结束（进程没有崩）');
