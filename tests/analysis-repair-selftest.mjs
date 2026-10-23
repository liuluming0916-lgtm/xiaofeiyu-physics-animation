#!/usr/bin/env node
/**
 * 新链路自愈取证：drawFrame 写错 → 只重画 drawFrame → Dry-Run 收敛。
 *
 * 用法：node tests/analysis-repair-selftest.mjs
 */

import { runPipeline } from '../core/orchestrator/pipeline.mjs';
import { runManualDraw } from '../core/orchestrator/manual-draw.mjs';
import { ANALYSIS_EXAMPLE, parseAnalysisTable } from '../core/analysis/index.mjs';
import { generateProgramSlots } from '../core/analysis/generate.mjs';
import vocab from '../contracts/knowledgecard-vocab-v2.json' with { type: 'json' };

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

let sceneCalls = 0;
const REPLIES = {
  read_problem: '【物体】物块、传送带\n【相对位置】左端\n【姿态】水平\n【运动方向】向右',
  solve: 'a=2, t*=1, dx=1',
  breakdown: 'title: 第1步\ntex: 加速\n\ntitle: 第2步\ntex: 匀速',
  analysis: ANALYSIS_EXAMPLE,
};
const streamImpl = async (opts) => {
  let text = REPLIES[opts.stage] ?? '';
  if (opts.stage === 'scene_code') {
    sceneCalls += 1;
    text =
      sceneCalls === 1
        ? 'Draw.nopeThisFunctionDoesNotExist();'
        : 'Draw.ground(-0.5, 5.5, 0);\nDraw.box([state.block_A.x, state.block_A.y], 0.2, 0.2);';
  }
  opts.onDelta?.(text);
  return { text, reasoning: '', usage: null, model: 'stub', deltas: [text] };
};

const events = [];
for await (const e of runPipeline({
  problem: { text: '水平传送带 u=2，物块从静止放上，μ=0.2，g=10。求 t* 与 Δx。' },
  config: {
    endpoint: { id: 'stub', displayName: 'stub', baseURL: 'http://127.0.0.1:1/v1', defaultModel: 'm', visionModel: 'v', supportsVision: true, supportsJsonMode: true, enableThinking: false, timeoutMs: 1000 },
    apiKey: 'sk-test',
    regexRules: [],
    knowledgecardEntries: [],
    knowledgecardVersion: 2,
    knowledgecardVocab: vocab,
  },
  streamImpl,
})) events.push(e);

console.log('新链路自愈取证\n');
const repairRounds = events.filter((e) => e.type === 'repair_round');
const dry = events.find((e) => e.type === 'dryrun_done' && e.round === 1);
const done = events.find((e) => e.type === 'run_done');

check('drawFrame 被调用了 2 次（首画 + 修复）', sceneCalls === 2, String(sceneCalls));
check('只跑了一轮修复且通过', repairRounds.length === 1 && repairRounds[0].verdict === 'pass', JSON.stringify(repairRounds));
check('修复后 Dry-Run 通过', dry?.verdict === 'pass', dry?.verdict);
check('最终 run_done 通过', done?.verdict === 'pass', done?.verdict);
check('修复只动 drawFrame', repairRounds[0]?.updated?.length === 1 && repairRounds[0].updated[0] === 'drawFrame', JSON.stringify(repairRounds[0]?.updated));

/* ── v1.1.18：修复轮输出为空/坏内容时，不能把整条流水线抛成 run.crashed ──
 *
 * 旧实现：draw 修复把 buildProgramFromText 放在 try/catch 外面，空 drawFrame
 * 会抛 ProgramBuildError → 服务端只能报“运行出错”，而且阶段名还是 solve。
 * 新口径：保留上一版可播放程序，发 stage_error(repair/build) + repair_round(build-error)，
 * 带告警交付；用户至少能看上一版，且知道是“修复输出拼不齐”。
 */
{
  let emptyRepairCalls = 0;
  const emptyRepairStream = async (opts) => {
    let text = REPLIES[opts.stage] ?? '';
    if (opts.stage === 'scene_code') {
      emptyRepairCalls += 1;
      text = emptyRepairCalls === 1 ? 'Draw.nopeThisFunctionDoesNotExist();' : '';
    }
    opts.onDelta?.(text);
    return { text, reasoning: '', usage: null, model: 'stub', deltas: [text] };
  };
  const events2 = [];
  for await (const e of runPipeline({
    problem: { text: '水平传送带 u=2，物块从静止放上，μ=0.2，g=10。求 t* 与 Δx。' },
    config: {
      endpoint: { id: 'stub', displayName: 'stub', baseURL: 'http://127.0.0.1:1/v1', defaultModel: 'm', visionModel: 'v', supportsVision: true, supportsJsonMode: true, enableThinking: false, timeoutMs: 1000 },
      apiKey: 'sk-test',
      regexRules: [],
      knowledgecardEntries: [],
      knowledgecardVersion: 2,
      knowledgecardVocab: vocab,
    },
    streamImpl: emptyRepairStream,
  })) events2.push(e);

  const repairErr = events2.find((e) => e.type === 'stage_error' && e.stage === 'repair');
  const rr2 = events2.find((e) => e.type === 'repair_round');
  const done2 = events2.find((e) => e.type === 'run_done');
  const done2Idx = events2.findIndex((e) => e.type === 'run_done');
  check('★ 修复输出为空 ⇒ 不抛异常，发 stage_error(repair/build)', repairErr?.error?.kind === 'build', JSON.stringify(repairErr ?? null).slice(0, 300));
  check('★ repair_round 如实记 build-error', rr2?.verdict === 'build-error', JSON.stringify(rr2 ?? null).slice(0, 300));
  check('★ 仍交付上一版程序（playable）', done2?.delivery?.playable === true, JSON.stringify(done2?.delivery));
  check('★ 带告警交付（banner 非空）', Boolean(done2?.banner), JSON.stringify(done2?.banner));
  check('★ run_done 是上一版的 fail，而不是 run.crashed', ['fail', 'pass-with-warnings'].includes(done2?.verdict), String(done2?.verdict));
  check('★ run_done 是最后一条事件（没有异常逃逸）', done2Idx === events2.length - 1, String(done2Idx));
}

/* ── v1.1.18 手动“只重画 drawFrame”：给定上一版程序，只改 drawFrame ── */
{
  const analysis = parseAnalysisTable(ANALYSIS_EXAMPLE);
  const baseSlots = generateProgramSlots({
    analysis,
    problem: '水平传送带上放一个物块。',
    breakdownText: 'title: 第 1 步\ntex: 物块加速',
    drawFrame: 'Draw.nopeThisFunctionDoesNotExist();',
  });
  let calls = 0;
  const manualStream = async (opts) => {
    calls += 1;
    const text = 'Draw.ground(-0.5, 5.5, 0);\nDraw.box([state.block_A.x, state.block_A.y], state.block_A.w, state.block_A.h);';
    opts.onDelta?.(text);
    return { text, reasoning: '', usage: null, model: 'stub', deltas: [text] };
  };
  const events = [];
  for await (const e of runManualDraw({
    problem: { text: '水平传送带上放一个物块。' },
    readProblem: '【题目】传送带\n【动画元件】block\n【场景】belt',
    analysisText: ANALYSIS_EXAMPLE,
    slots: baseSlots,
    config: {
      endpoint: { id: 'stub', displayName: 'stub', baseURL: 'http://127.0.0.1:1/v1', defaultModel: 'm', visionModel: 'v', supportsVision: true, supportsJsonMode: true, enableThinking: false, timeoutMs: 1000 },
      apiKey: 'sk-test',
      regexRules: [],
      maxRepairRounds: 3,
    },
    streamImpl: manualStream,
  })) events.push(e);

  const firstDry = events.find((e) => e.type === 'dryrun_done' && e.round == null);
  const lastDry = events.filter((e) => e.type === 'dryrun_done').at(-1);
  const start = events.find((e) => e.type === 'stage_start' && e.stage === 'repair');
  const done = events.find((e) => e.type === 'run_done');
  check('★ 只重画：初始版本是 fail', firstDry?.verdict === 'fail', String(firstDry?.verdict));
  check('★ 只重画：stage_start 标了 mode=draw / manual', start?.mode === 'draw' && start?.manual === true, JSON.stringify(start));
  check('★ 只重画：只调用一次模型就收敛', calls === 1 && lastDry?.verdict === 'pass', `${calls}/${lastDry?.verdict}`);
  check('★ 只重画：run_done pass + 程序可播放', done?.verdict === 'pass' && done?.delivery?.playable === true, JSON.stringify(done?.delivery));
  check('★ 只重画：没有物理类错误 / 没有 run.crashed', !events.some((e) => e.type === 'stage_error'), JSON.stringify(events.filter((e) => e.type === 'stage_error')));
}

console.log(`\n通过 ${passed}，失败 ${failures.length}`);
if (failures.length) process.exit(1);
