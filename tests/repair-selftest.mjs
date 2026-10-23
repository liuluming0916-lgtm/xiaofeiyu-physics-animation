#!/usr/bin/env node
/**
 * v6 自愈取证：**只重画 drawFrame** 的那条路径。
 *
 * 物理错误修复在 `analysis-physical-repair-selftest.mjs`；
 * 这里只钉住：
 *   · 画图错误 → 只重画 drawFrame；
 *   · 物理/数据槽位逐字节不变；
 *   · 3 轮上限与未收敛横幅；
 *   · 修复请求只带 drawFrame 语境。
 *
 * 用法：node tests/repair-selftest.mjs
 */

import { collectEvents } from '../core/orchestrator/pipeline.mjs';
import { ANALYSIS_EXAMPLE } from '../core/analysis/example.mjs';
import { SLOT_KEY_NAMES } from '../contracts/spec/frozen-keys.mjs';
import { pathToFileURL } from 'node:url';

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
  id: 'ep_fake',
  displayName: '假端点',
  baseURL: 'http://127.0.0.1:1/v1',
  defaultModel: 'text-model',
  visionModel: 'vision-model',
  apiKeyModelId: null,
  supportsJsonMode: true,
  supportsVision: true,
  enableThinking: false,
  preserveThinking: false,
  timeoutMs: 5000,
};

const GOOD_DRAW = 'Draw.box([state.e0.x, state.e0.y], 0.3, 0.3);';
const FIXED_DRAW = '/*FIXED*/ Draw.line([state.e0.x - 0.2, 0], [state.e0.x + 0.2, 0]);';

function fakeReport({ verdict = 'pass', failed = [] } = {}) {
  const ids = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C8', 'C9'];
  return {
    format: 'od-dry-run-report',
    version: 2,
    verdict,
    cancelled: false,
    meta: {},
    execution: { termination: 'completed', frameCount: 48, backendId: 'worker' },
    checks: ids.map((id) => ({
      id,
      severity: id === 'C8' || id === 'C9' ? 'warning' : 'blocking',
      status: failed.includes(id) ? 'fail' : 'pass',
      blocking: id !== 'C8' && id !== 'C9',
      message: failed.includes(id) ? `${id} failed` : 'ok',
      detail: failed.includes(id) ? `${id} failed` : 'ok',
      diagnostics: [],
    })),
    extensions: [],
    observations: {},
  };
}

function fakeDryRun(spec) {
  const calls = [];
  let i = 0;
  const impl = async (input) => {
    calls.push(input);
    const report = Array.isArray(spec) ? spec[Math.min(i, spec.length - 1)] : spec;
    i += 1;
    return { report, run: null, lint: null };
  };
  impl.calls = calls;
  return impl;
}

function routeStream({ repair = FIXED_DRAW } = {}) {
  const calls = [];
  const impl = async (opts) => {
    calls.push(opts);
    let text;
    if (opts.round) {
      text = repair;
    } else if (opts.stage === 'couple') {
      text = 'step: 1\nt0: 0\nt1: 1\n\nstep: 2\nt0: 1\nt1: 3';
    } else if (opts.stage === 'analysis') {
      text = ANALYSIS_EXAMPLE;
    } else if (opts.stage === 'scene_code') {
      text = GOOD_DRAW;
    } else if (opts.stage === 'read_problem') {
      text = '【物体】物块、传送带\n【相对位置】左端\n【姿态】水平\n【运动方向】向右';
    } else if (opts.stage === 'solve') {
      text = 'a=2, t*=1, dx=1';
    } else if (opts.stage === 'breakdown') {
      text = 'title: 第1步\ntex: 加速\n\ntitle: 第2步\ntex: 匀速';
    } else {
      text = `【${opts.stage} 输出】`;
    }
    opts.onDelta?.(text);
    return { text, reasoning: '', usage: null, model: 'stub', deltas: [text] };
  };
  impl.calls = calls;
  return impl;
}

function input(stream, dry) {
  return {
    problem: { text: '水平传送带题。' },
    config: { endpoint, apiKey: 'sk-test', regexRules: [], knowledgecardEntries: [], knowledgecardVersion: 2 },
    streamImpl: stream,
    dryRunImpl: dry,
  };
}

export async function main() {
  console.log('v6 画图自愈取证（只重画 drawFrame）\n');

  let b1 = null;
  console.log('『B1』首轮画图失败 → 只重画 drawFrame → 收敛');
  {
    const dry = fakeDryRun([fakeReport({ verdict: 'fail', failed: ['C4'] }), fakeReport({ verdict: 'pass' })]);
    const stream = routeStream();
    const events = await collectEvents(input(stream, dry));
    b1 = { events, stream, dry };

    const runDone = events.find((e) => e.type === 'run_done');
    const firstDry = events.find((e) => e.type === 'dryrun_done' && e.round == null);
    const round = events.find((e) => e.type === 'repair_round');
    const starts = events.filter((e) => e.type === 'stage_start' && e.stage === 'repair');

    check('repair 被触发', starts.length === 1, String(starts.length));
    check('repair 模式是 draw', starts[0]?.mode === 'draw', JSON.stringify(starts[0]));
    check('最终 pass', runDone?.verdict === 'pass', runDone?.verdict);
    check('1 轮收敛', runDone?.rounds === 1, String(runDone?.rounds));
    check('收敛无横幅', runDone?.banner === null, JSON.stringify(runDone?.banner));
    check('Dry-Run 2 次', dry.calls.length === 2, String(dry.calls.length));
    check('repair_round 只改 drawFrame', round?.updated?.join(',') === 'drawFrame', JSON.stringify(round?.updated));
    check('repair_round 的 kept 含所有其它槽位', SLOT_KEY_NAMES.filter((k) => k !== 'drawFrame').every((k) => round?.kept?.includes(k)), JSON.stringify(round?.kept));

    const after = events.filter((e) => e.type === 'dryrun_done').at(-1)?.program?.slots ?? {};
    check('drawFrame 换成修复版', String(after.drawFrame ?? '').includes('FIXED'), after.drawFrame);
  }

  console.log('\n『B2』画图错误 3 轮上限 + 不静默交付');
  {
    const dry = fakeDryRun(fakeReport({ verdict: 'fail', failed: ['C4'] }));
    const stream = routeStream();
    const events = await collectEvents(input(stream, dry));
    const runDone = events.find((e) => e.type === 'run_done');
    const repairDone = events.find((e) => e.type === 'repair_done');

    check('修复 3 轮', stream.calls.filter((c) => c.round).length === 3, String(stream.calls.filter((c) => c.round).length));
    check('Dry-Run 4 次', dry.calls.length === 4, String(dry.calls.length));
    check('最终 fail', runDone?.verdict === 'fail', runDone?.verdict);
    check('rounds = 3', runDone?.rounds === 3, String(runDone?.rounds));
    check('repair_done 未收敛', repairDone?.converged === false && repairDone?.rounds === 3);
    check('带 warning 横幅', runDone?.banner?.level === 'warning', JSON.stringify(runDone?.banner));
    check('横幅含 C4', runDone?.banner?.failedChecks?.includes('C4'), JSON.stringify(runDone?.banner?.failedChecks));
  }

  console.log('\n『B3』修复请求只带 drawFrame 语境');
  {
    const repairCall = b1.stream.calls.find((c) => c.round);
    const user = String(repairCall?.messages?.find((m) => m.role === 'user')?.content ?? '');
    const sys = String(repairCall?.messages?.[0]?.content ?? '');
    check('系统段是「自愈修复」', sys.includes('【本阶段指令：自愈修复】'), sys.slice(0, 80));
    check('带失败检查 C4', user.includes('C4'), user.slice(0, 160));
    check('带上一轮 drawFrame', user.includes('Draw.box'), user.slice(0, 200));
    check('带 analysis 表与 state 映射', user.includes('block_A') && user.includes('e0'));
    check('不要求 8 槽位标记', !user.includes('@slot:'));
  }

  console.log('\n『B6』修复过程可见');
  {
    const events = b1.events;
    const repairStart = events.findIndex((e) => e.type === 'stage_start' && e.stage === 'repair');
    const firstDry = events.findIndex((e) => e.type === 'dryrun_done' && e.round == null);
    const round = events.findIndex((e) => e.type === 'repair_round');
    const roundDry = events.findIndex((e) => e.type === 'dryrun_done' && e.round === 1);
    check('repair 在首次 Dry-Run 之后', repairStart > firstDry, `${repairStart}/${firstDry}`);
    check('repair_round 在 repair stage_done 之后', round > events.findIndex((e) => e.type === 'stage_done' && e.stage === 'repair'));
    check('修复后的 dryrun_done 带 round=1', roundDry > round);
    check('事件序号单调递增', events.every((e, i) => i === 0 || e.seq > events[i - 1].seq));
  }

  console.log('\n『B7』只有告警（pass-with-warnings）不进自愈');
  {
    /* C8 是 warning：verdict=pass-with-warnings，没有硬拦；不应调用任何修复轮 */
    const dry = fakeDryRun(fakeReport({ verdict: 'pass-with-warnings', failed: ['C8'] }));
    const stream = routeStream();
    const events = await collectEvents(input(stream, dry));
    const runDone = events.find((e) => e.type === 'run_done');
    const repairStarts = events.filter((e) => e.type === 'stage_start' && e.stage === 'repair');
    const rounds = events.filter((e) => e.type === 'repair_round');
    check('★ 告警-only 不触发 repair', repairStarts.length === 0 && stream.calls.filter((c) => c.round).length === 0, `${repairStarts.length}/${stream.calls.filter((c) => c.round).length}`);
    check('★ 不产生 repair_round（不白跑 3 轮）', rounds.length === 0, String(rounds.length));
    check('★ Dry-Run 只跑 1 次（首轮）', dry.calls.length === 1, String(dry.calls.length));
    check('★ 结论仍是 pass-with-warnings，照常交付', runDone?.verdict === 'pass-with-warnings', String(runDone?.verdict));
  }

  console.log(`\n${failures.length ? '✗' : '✓'} v6 画图自愈取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
  return { passed, failed: failures.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
