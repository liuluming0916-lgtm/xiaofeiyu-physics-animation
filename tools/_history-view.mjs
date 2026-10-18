#!/usr/bin/env node
/**
 * 看账本（**一次性小工具**，不是门禁）
 *
 * 为什么有它：`history.db` 是 SQLite 的**二进制**文件，双击打不开（记事本里是乱码）。
 * 正经的看法是装 DB Browser for SQLite，但那要下载；这台机器上 GitHub 连不通，
 * 所以这条命令让你**零安装**也能把账本看一遍。
 *
 * 用法：
 *   node tools/_history-view.mjs              # 最近 10 条
 *   node tools/_history-view.mjs --limit 50
 *   node tools/_history-view.mjs --audit      # 连审计记录一起列
 *
 * 只读：不写、不改、不删。文件名以 `_` 开头 ⇒ 不进 ⓪ 覆盖自检。
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from './paths.mjs';
import { summarize } from '../core/observability/index.mjs';
import { driverStatus, historyStats, historyPath, listRuns, openHistory, recordRun } from '../core/history/index.mjs';

const argv = process.argv.slice(2);
const limitIdx = argv.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) || 10 : 10;
const withAudit = argv.includes('--audit');
const sample = argv.includes('--sample');

/**
 * `--sample`：造一个**样例库**（放在 `_preview-history/`，不是你真正的账本）。
 *
 * 为什么要有：账本只有在"真跑过一次解题"之后才会有行，而现在流水线还没接到
 * 服务端（那是第 9 步）。所以首次打开看到空表是**正常**的 —— 但空表看不出
 * "表结构长什么样"。样例库就是为了让你**装好阅读器之后有东西可翻**。
 */
const SAMPLE_DIR = join(PROJECT_ROOT, '_preview-history');
const SAMPLE_DB = join(SAMPLE_DIR, 'sample.db');

function seedSample() {
  mkdirSync(SAMPLE_DIR, { recursive: true });
  if (historyStats({ path: SAMPLE_DB }).runs > 0) return;

  const cases = [
    { id: 'sample-001', at: '2026-10-17T08:12:00.000Z', entry: '传送带共速与摩擦生热', verdict: 'pass', failed: [], ms: 8200, model: 'model-a' },
    { id: 'sample-002', at: '2026-10-17T08:31:00.000Z', entry: '斜面→圆弧→平抛', verdict: 'pass-with-warnings', failed: ['C10'], ms: 12400, model: 'model-a' },
    { id: 'sample-003', at: '2026-10-17T09:05:00.000Z', entry: '带电粒子在磁场中的圆周运动', verdict: 'fail', failed: ['C3', 'C6'], ms: 15600, model: 'model-b' },
  ];

  for (const c of cases) {
    const events = [
      {
        seq: 1,
        type: 'run_start',
        at: c.at,
        entry: c.entry,
        model: c.model,
        mode: 'NUMERIC',
        imageCount: 0,
        maxRepairRounds: 3,
      },
      { seq: 2, type: 'stage_start', at: '2026-10-17T08:00:01.000Z', stage: 'solve' },
      { seq: 3, type: 'stage_delta', at: '2026-10-17T08:00:02.000Z', stage: 'solve', text: '解题过程正文'.repeat(8) },
      { seq: 4, type: 'stage_done', at: '2026-10-17T08:00:03.000Z', stage: 'solve', chars: 48, ms: 3100 },
      {
        seq: 5,
        type: 'dryrun_done',
        at: '2026-10-17T08:00:04.000Z',
        verdict: c.verdict === 'pass' ? 'pass' : 'fail',
        checks: [
          { id: 'C1', status: 'pass', blocking: true },
          { id: 'C2', status: 'pass', blocking: true },
          ...(c.failed.includes('C3') ? [{ id: 'C3', status: 'fail', blocking: true }] : []),
          ...(c.failed.includes('C6') ? [{ id: 'C6', status: 'fail', blocking: true }] : []),
          ...(c.failed.includes('C10') ? [{ id: 'C10', status: 'warn', blocking: false }] : []),
        ],
        observations: { drawRawCount: 0, drawRawUsage: 0 },
        frameCount: 240,
        program: { slots: {}, provenance: { model: c.model, promptHash: 'sample-ph', worldbookHash: 'sample-wh' } },
      },
      { seq: 6, type: 'run_done', at: '2026-10-17T08:00:05.000Z', verdict: c.verdict, ms: c.ms },
    ];
    recordRun(summarize(events, { runId: c.id }), { path: SAMPLE_DB });
  }
}

const bar = '─'.repeat(64);
console.log(`\n════════ 解题账本 ════════`);

const drv = driverStatus();
if (!drv.ok) {
  console.log('✗ 用不了：没有 SQLite 驱动（better-sqlite3 未安装）');
  console.log(`  原因：${drv.error}`);
  process.exit(1);
}

if (sample) {
  seedSample();
  console.log('（这是**样例库**，不是你真正的账本；真账本见下方正常模式）');
}

const path = sample ? SAMPLE_DB : historyPath();
const st = historyStats({ path });
if (!st.ok) {
  console.log(`✗ 打开失败：${st.code}`);
  process.exit(1);
}

console.log(`库文件：${st.path}`);
console.log(`         ${existsSync(st.path) ? `${(statSync(st.path).size / 1024).toFixed(1)} KB` : '（还没建）'}`);
console.log(`结构版本：${st.schemaVersion ?? '（空库）'}`);

if (!st.runs) {
  console.log(`\n没有记录（0 条）。`);
  console.log('这是正常的：账本只在**真正跑过一次解题之后**才会有行。');
  console.log('写库这条路本身已经由门禁 ㉟ 证明可用（47 条断言，含"Key 按字节不入库"）。');
  console.log(`${bar}\n`);
  process.exit(0);
}

const dist = Object.entries(st.byVerdict ?? {})
  .map(([k, v]) => `${k} ${v}`)
  .join(' · ');
console.log(`记录：${st.runs} 条${dist ? `（${dist}）` : ''}`);
console.log(`时间范围：${st.first ?? '—'} ～ ${st.last ?? '—'}`);
console.log(`审计：${st.audits} 条`);

/*
 * 第 8 期 L4b：**一次通过率**。
 *
 *   · 一次通过率 = 第 1 轮 dry_run 就 pass ÷ 全部运行（**失败也进分母**）
 *   · 平均修复轮数 = 用来判断"改提示词/加示例之后是更快收敛还是更慢"
 *
 * 为什么必须看这两个数：改造前只有"15 道真题全过"这一条 —— 那是人手写的验收样本，
 * 不是真实产出。没有这两个数，任何改动都只能靠"感觉变好了"。
 */
if (st.passRate) {
  const p = st.passRate;
  const pct = (v) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
  const hist = Object.entries(p.roundsHistogram ?? {})
    .map(([k, v]) => `${k}轮×${v}`)
    .join(' · ');
  console.log(
    `\n一次通过率：${pct(p.rate)}（${p.firstPass}/${p.total}）· 通过率 ${pct(p.passRate)}（${p.pass}/${p.total}）` +
      `· 平均修复 ${p.avgRounds ?? '—'} 轮` +
      (hist ? `\n轮数分布：${hist}` : ''),
  );
  if (p.unreadable) console.log(`（有 ${p.unreadable} 条记录的 JSON 读不出来，按 0 轮计）`);
}

const { items } = listRuns({ path, limit });
console.log(`\n最近 ${items.length} 条：`);
console.log(`  ${'时间'.padEnd(20)} ${'判定'.padEnd(12)} ${'耗时'.padStart(7)}  ${'失败检查'.padEnd(10)} 题面`);

for (const r of items) {
  const ms = r.ms ? `${(r.ms / 1000).toFixed(1)}s` : '—';
  const failed = Array.isArray(r.failed_ids) && r.failed_ids.length ? r.failed_ids.join(',') : '—';
  const entry = String(r.entry ?? '（无题面）').slice(0, 30);
  console.log(
    `  ${String(r.created_at).slice(0, 19).padEnd(20)} ${String(r.verdict ?? '—').padEnd(12)} ${ms.padStart(7)}  ${failed.padEnd(10)} ${entry}`,
  );
}

if (withAudit) {
  const opened = openHistory();
  if (opened.ok) {
    const rows = opened.db
      .prepare('SELECT at, kind, detail FROM audit_log ORDER BY id DESC LIMIT ?')
      .all(limit);
    console.log(`\n最近 ${rows.length} 条审计：`);
    if (!rows.length) console.log('  （还没有审计记录）');
    for (const a of rows) {
      console.log(`  ${String(a.at).slice(0, 19)}  ${String(a.kind).padEnd(22)} ${String(a.detail ?? '').slice(0, 60)}`);
    }
  }
}

console.log(`${bar}`);
console.log('提示：想要像 Excel 一样翻，装 DB Browser for SQLite（免费），');
console.log(`      然后 File → Open Database → 选上面那个库文件。`);
console.log(`${bar}\n`);
