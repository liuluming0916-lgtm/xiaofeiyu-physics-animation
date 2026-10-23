#!/usr/bin/env node
/**
 * _check-real-exam —— 真题清单（`tests/real-exam/index.json`）自检的 **CLI 入口**。
 *
 * 判据本身在 `core/dryrun/question-sources.mjs` 的 `auditManifest()` 里，与门禁 ③ 共用一份：
 * 这里只负责把结论打印出来，不重复实现一遍规则（两处实现必然漂移）。
 *
 * 用法：
 *   node tools/_check-real-exam.mjs          # 体检 + 负对照
 */
import { readFileSync } from 'node:fs';

import { auditManifest, auditSelfControlFailures, defaultIo, REAL_EXAM_DIR } from '../core/dryrun/question-sources.mjs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync(join(REAL_EXAM_DIR, 'index.json'), 'utf8'));
const { errors, counts, runnable } = auditManifest(manifest, defaultIo(REAL_EXAM_DIR));

console.log(`real-exam 清单自检 · ${manifest.items?.length ?? 0} 条（format=${manifest.format} version=${manifest.version}）`);
console.log(
  `  可跑 ${runnable.length} 道（${runnable.map((x) => x.id).join(' ')}） · 待做 ${counts.todo} · 占位 ${counts.placeholder} · ` +
    `candidate ${counts.candidate} · accepted ${counts.accepted}`,
);
for (const e of errors) console.log(`  ✗ [${e.code}] ${e.item ?? ''} ${e.detail}`);

const missed = auditSelfControlFailures();
console.log(
  missed.length
    ? `  ✗ 负对照没被点名（${missed.length} 条）：\n${missed.map((m) => `      ${m}`).join('\n')}`
    : '  ✓ 负对照：5 份故意写坏的清单全部被点名',
);
console.log(`\n${errors.length || missed.length ? '✗ 未通过' : '✓ 通过'}`);
if (errors.length || missed.length) process.exitCode = 1;
