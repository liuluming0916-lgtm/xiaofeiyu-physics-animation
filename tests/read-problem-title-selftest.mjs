#!/usr/bin/env node
/** 第 6 步：读题标题（只给动画页/导出用，不进入后续 Prompt）。 */

import { collectEvents, parseProblemTitle } from '../core/orchestrator/pipeline.mjs';
import { ANALYSIS_EXAMPLE } from '../core/analysis/example.mjs';
import { getPrompt } from '../core/prompts/index.mjs';

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

const LONG = '水平传送带共速、摩擦生热与物块相对滑动全过程（含多阶段）';
check('解析【题目】', parseProblemTitle(`【题目】${LONG}\n【题面复述】…`) === LONG);
check('长标题不截断', parseProblemTitle(`【题目】${LONG}`) === LONG);
check('缺标题 ⇒ 未命名题目', parseProblemTitle('【题面复述】只有题面') === '未命名题目');
check('空标题 ⇒ 未命名题目', parseProblemTitle('【题目】   ') === '未命名题目');
check('只写“无” ⇒ 未命名题目', parseProblemTitle('【题目】无') === '未命名题目');

for (const id of ['read_problem', 'read_problem_v2']) {
  const p = getPrompt(id);
  check(`${id} 要求【题目】`, p.system.includes('【题目】'));
  check(`${id} 允许长度不限`, p.system.includes('长度不限'));
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
  read_problem: `【题目】${LONG}\n【题面复述】物块放在传送带上。`,
  solve: 'a=2, t*=1, dx=1',
  breakdown: 'title: 第1步\ntex: 加速\n\ntitle: 第2步\ntex: 匀速',
  analysis: ANALYSIS_EXAMPLE,
  scene_code: 'Draw.ground(-0.5, 5.5, 0);\nDraw.box([state.e0.cx, state.e0.cy], 0.2, 0.2);',
  couple: 'step: 1\nt0: 0\nt1: 1\n\nstep: 2\nt0: 1\nt1: 3',
};
const stream = async (opts) => {
  const text = REPLIES[opts.stage] ?? '（占位）';
  opts.onDelta?.(text);
  return { text, reasoning: '', usage: null, model: 'stub', deltas: [text] };
};
const pass = {
  checks: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C8', 'C9'].map((id) => ({
    id,
    status: 'pass',
    blocking: false,
    message: 'ok',
    diagnostics: [],
  })),
  extensions: [],
  verdict: 'pass',
  cancelled: false,
  meta: {},
  execution: { termination: 'completed', frameCount: 10, backendId: 'worker' },
  observations: {},
};
const events = await collectEvents({
  problem: { text: '用户手打的题面' },
  config: { endpoint, apiKey: 'sk-test', regexRules: [], knowledgecardEntries: [], knowledgecardVersion: 1 },
  streamImpl: stream,
  dryRunImpl: async () => ({ report: pass, run: null, lint: null }),
});
const label = events.find((e) => e.type === 'run_label');
check('★ 非空题面也采用模型标题（不被题面首行覆盖）', label?.entry === LONG, JSON.stringify(label));
check('run_start 的初始 entry 仍来自题面（标题到达前）', events.find((e) => e.type === 'run_start')?.entry === '用户手打的题面');

console.log(`\n${failures.length ? '✗' : '✓'} 读题标题取证：通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
  process.exitCode = 1;
}
