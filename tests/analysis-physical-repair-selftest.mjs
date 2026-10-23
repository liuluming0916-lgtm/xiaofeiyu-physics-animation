#!/usr/bin/env node
/**
 * 物理错误修复取证（4b）：
 *   C3/C5/C6 失败 → 重跑 read_problem + solve + breakdown/analysis + scene_code，
 *   而不是只重画 drawFrame。
 *
 * 用法：node tests/analysis-physical-repair-selftest.mjs
 */

import { collectEvents } from '../core/orchestrator/pipeline.mjs';
import { ANALYSIS_EXAMPLE } from '../core/analysis/example.mjs';

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const endpoint = {
  id: 'stub',
  displayName: 'stub',
  baseURL: 'http://127.0.0.1:1/v1',
  defaultModel: 'stub-model',
  visionModel: 'stub-vision',
  supportsVision: true,
  supportsJsonMode: true,
  enableThinking: false,
  timeoutMs: 1000,
};

const REPLIES = {
  read_problem: '【物体】物块、传送带\n【相对位置】左端\n【姿态】水平\n【运动方向】向右',
  solve: 'a=2, t*=1, dx=1',
  breakdown: 'title: 第1步\ntex: 加速\n\ntitle: 第2步\ntex: 匀速',
  analysis: ANALYSIS_EXAMPLE,
  scene_code: 'Draw.ground(-0.5, 5.5, 0);\nDraw.box([state.e0.x, state.e0.y], 0.2, 0.2);',
  couple: 'step: 1\nt0: 0\nt1: 1\n\nstep: 2\nt0: 1\nt1: 3',
};

function fakeReport({ verdict = 'pass', failed = [] } = {}) {
  const ids = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C8', 'C9'];
  return {
    format: 'od-dry-run-report',
    version: 2,
    verdict,
    cancelled: false,
    meta: {},
    execution: { termination: 'completed', frameCount: 10, backendId: 'worker' },
    checks: ids.map((id) => ({
      id,
      status: failed.includes(id) ? 'fail' : 'pass',
      blocking: id === 'C3' || id === 'C5' || id === 'C6',
      message: failed.includes(id) ? `${id} failed` : 'ok',
      diagnostics: failed.includes(id) && id === 'C3'
        ? [{ check: 'C3', slot: 'stateAt', line: 1, message: 'stateAt 产生了 NaN' }]
        : [],
    })),
    extensions: [],
    observations: {},
  };
}

function runInput(stream, dryRun) {
  return {
    problem: { text: '水平传送带题。' },
    config: { endpoint, apiKey: 'sk-test', regexRules: [], knowledgecardEntries: [], knowledgecardVersion: 2 },
    streamImpl: stream,
    dryRunImpl: dryRun,
  };
}

/* ── 1. 物理错误 → 重跑物理链路 → 收敛 ── */
{
  const calls = [];
  const stream = async (opts) => {
    calls.push(opts.stage);
    const text = REPLIES[opts.stage] ?? '（占位）';
    opts.onDelta?.(text);
    return { text, reasoning: '', usage: null, model: 'stub', deltas: [text] };
  };
  let dryCalls = 0;
  const dry = async () => {
    dryCalls += 1;
    return { report: dryCalls === 1 ? fakeReport({ verdict: 'fail', failed: ['C3'] }) : fakeReport({ verdict: 'pass' }), run: null, lint: null };
  };
  const events = await collectEvents(runInput(stream, dry));
  const repairStarts = events.filter((e) => e.type === 'stage_start' && e.stage === 'repair');
  const round = events.find((e) => e.type === 'repair_round');
  const done = events.find((e) => e.type === 'run_done');

  check('物理错误触发了 repair', repairStarts.length === 1, String(repairStarts.length));
  check('repair 的模式是 physical', repairStarts[0]?.mode === 'physical', JSON.stringify(repairStarts[0]));
  check('physical 修一轮后 pass', done?.verdict === 'pass', done?.verdict);
  check('repair_round 标记 physical', round?.mode === 'physical', JSON.stringify(round?.mode));
  check('read_problem 被重跑（2 次）', calls.filter((s) => s === 'read_problem').length === 2, calls.join(','));
  check('solve 被重跑（2 次）', calls.filter((s) => s === 'solve').length === 2, calls.join(','));
  check('analysis 被重跑（2 次）', calls.filter((s) => s === 'analysis').length === 2, calls.join(','));
  check('scene_code 被重跑（2 次）', calls.filter((s) => s === 'scene_code').length === 2, calls.join(','));
  check('Dry-Run 首轮 + 物理修复后 = 2 次', dryCalls === 2, String(dryCalls));
  check('没有走 drawFrame-only 修复', !events.some((e) => e.type === 'repair_round' && e.mode === 'draw'), JSON.stringify(events.filter((e) => e.type === 'repair_round')));
}

/* ── 2. 物理错误修 2 轮仍失败 → 不再空转重画 drawFrame ── */
{
  const calls = [];
  const stream = async (opts) => {
    calls.push(opts.stage);
    const text = REPLIES[opts.stage] ?? '（占位）';
    opts.onDelta?.(text);
    return { text, reasoning: '', usage: null, model: 'stub', deltas: [text] };
  };
  let dryCalls = 0;
  const dry = async () => {
    dryCalls += 1;
    return { report: fakeReport({ verdict: 'fail', failed: ['C3'] }), run: null, lint: null };
  };
  const events = await collectEvents(runInput(stream, dry));
  const rounds = events.filter((e) => e.type === 'repair_round');
  const done = events.find((e) => e.type === 'run_done');
  const repairDone = events.find((e) => e.type === 'repair_done');

  check('物理修复上限 2 轮', rounds.length === 2, String(rounds.length));
  check('Dry-Run = 首轮 + 2 轮 = 3 次', dryCalls === 3, String(dryCalls));
  check('最终仍是 fail（不包装）', done?.verdict === 'fail', done?.verdict);
  check('没有 drawFrame-only 轮（不空转）', !rounds.some((r) => r.mode === 'draw'), JSON.stringify(rounds.map((r) => r.mode)));
  check('repair_done 如实报未收敛', repairDone?.converged === false && repairDone?.rounds === 2, JSON.stringify(repairDone));
  check('仍带 warning 横幅', done?.banner?.level === 'warning', JSON.stringify(done?.banner));
}

console.log(`\n${failures.length ? '✗' : '✓'} 物理修复取证：通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
  process.exitCode = 1;
}
