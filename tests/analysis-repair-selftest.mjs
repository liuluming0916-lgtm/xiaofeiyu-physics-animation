#!/usr/bin/env node
/**
 * 新链路自愈取证：drawFrame 写错 → 只重画 drawFrame → Dry-Run 收敛。
 *
 * 用法：node tests/analysis-repair-selftest.mjs
 */

import { runPipeline } from '../core/orchestrator/pipeline.mjs';
import { ANALYSIS_EXAMPLE } from '../core/analysis/index.mjs';
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
        : 'Draw.ground(-0.5, 5.5, 0);\nDraw.box([state.e0.cx, state.e0.cy], 0.2, 0.2);';
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

console.log(`\n通过 ${passed}，失败 ${failures.length}`);
if (failures.length) process.exit(1);
