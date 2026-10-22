#!/usr/bin/env node
/**
 * 新链路（v6）端到端取证：
 *   read_problem → solve → breakdown → analysis → scene_code(drawFrame) → dry_run
 *
 * 用真 `runPipeline()` + 真 Dry-Run；只把模型网关换成桩。
 * 验：
 *   · 阶段顺序里没有 answers；
 *   · analysis 的 MOTIONS 被解析，并生成了 stateAt/VIEW/readouts；
 *   · AI 只提供 drawFrame；
 *   · 程序能真正跑过 C1–C9（C7 已删）。
 *
 * 用法：node tests/analysis-pipeline-selftest.mjs
 */

import { runPipeline, collectEvents } from '../core/orchestrator/pipeline.mjs';
import { ANALYSIS_EXAMPLE } from '../core/analysis/index.mjs';
import { PHASE5_STAGES } from '../core/orchestrator/events.mjs';
import { loadV2Library } from '../core/knowledgecard/v2/store.mjs';
import vocab from '../contracts/knowledgecard-vocab-v2.json' with { type: 'json' };

/** 用内置 v2 卡跑生产路径：v6 起知识卡走 v2 引擎，不再经过 v1 适配器 */
const kcLib = loadV2Library();

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

const REPLIES = {
  read_problem: [
    '【题目】传送带共速',
    '【物体】物块、传送带',
    '【相对位置】物块在传送带上，左端',
    '【姿态】水平传送带',
    '【运动方向】向右为正',
    '【动画元件】block',
    '【场景】conveyor_block, belt',
    '【判定依据】题面出现物块与传送带',
  ].join('\n'),
  solve: ['取向右为正方向。', 'a = μg = 2 m/s²，t* = u/a = 1.0 s，Δx = 1.0 m。', '共速后匀速 v = 2 m/s。'].join('\n'),
  breakdown: ['title: 第 1 步 · 加速', 'tex: 物块受摩擦力加速', '', 'title: 第 2 步 · 匀速', 'tex: 共速后随带匀速'].join('\n'),
  analysis: ANALYSIS_EXAMPLE,
  scene_code: [
    'Draw.ground(-0.5, 5.5, 0);',
    'Draw.box([state.e0.cx, state.e0.cy], state.e0.w, state.e0.h);',
  ].join('\n'),
  couple: ['step: 1', 't0: 0', 't1: 1', '', 'step: 2', 't0: 1', 't1: 3'].join('\n'),
};

const calls = [];
const timings = {};
const captured = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const streamImpl = async (opts) => {
  const t0 = Date.now();
  calls.push(opts.stage);
  captured.push({ stage: opts.stage, system: String(opts.messages?.[0]?.content ?? '') });
  // 故意让 analysis 比 breakdown 慢：如果串行，总时长 >= 两者之和
  if (opts.stage === 'breakdown') await sleep(80);
  if (opts.stage === 'analysis') await sleep(140);
  const text = REPLIES[opts.stage] ?? '（占位）';
  opts.onDelta?.(text);
  timings[opts.stage] = { start: t0, end: Date.now() };
  return { text, reasoning: '', usage: null, model: 'stub', deltas: [text] };
};

const events = [];
for await (const e of runPipeline({
  problem: { text: '水平传送带以 u=2 m/s 向右匀速运行。把质量 m=1 kg 的物块从静止轻放在带面左端，μ=0.2，g=10。求 t* 与 Δx。' },
  config: {
    endpoint: {
      id: 'stub',
      displayName: 'stub',
      baseURL: 'http://127.0.0.1:1/v1',
      defaultModel: 'stub-model',
      visionModel: 'stub-vision',
      supportsVision: true,
      supportsJsonMode: true,
      enableThinking: false,
      timeoutMs: 1000,
    },
    apiKey: 'sk-test',
    regexRules: [],
    knowledgecardEntries: kcLib.builtin,
    knowledgecardVersion: 2,
    knowledgecardVocab: vocab,
  },
  streamImpl,
})) events.push(e);

console.log('新链路端到端取证（v6）\n');

check('阶段链里没有 answers', !PHASE5_STAGES.includes('answers'), PHASE5_STAGES.join(','));
check('阶段链里有 analysis', PHASE5_STAGES.includes('analysis'));
check(
  '模型调用顺序 = read_problem → solve → breakdown → analysis → scene_code → couple',
  calls.join(',') === 'read_problem,solve,breakdown,analysis,scene_code,couple',
  calls.join(','),
);

const tb = timings.breakdown;
const ta = timings.analysis;
check(
  '★ breakdown 与 analysis 的调用时间真正重叠（不是串行）',
  Boolean(tb && ta) && Math.max(tb.start, ta.start) < Math.min(tb.end, ta.end),
  JSON.stringify({ breakdown: tb, analysis: ta }),
);
check(
  '★ breakdown/analysis 都结束之后才调用 scene_code',
  Boolean(ta && timings.scene_code) && timings.scene_code.start >= Math.max(tb.end, ta.end),
  JSON.stringify({ breakdown: tb, analysis: ta, scene_code: timings.scene_code }),
);

const doneStages = events.filter((e) => e.type === 'stage_done').map((e) => e.stage);
check('六个模型阶段都完成（含 couple）', doneStages.join(',') === 'read_problem,solve,breakdown,analysis,scene_code,couple', doneStages.join(','));

const dry = events.find((e) => e.type === 'dryrun_done');
check('Dry-Run 通过', dry?.verdict === 'pass', dry?.verdict);
check('C7 不再出现', !(dry?.checks ?? []).some((c) => c.id === 'C7'));
check(
  'C1–C9 全绿（C7 已删）',
  (dry?.checks ?? []).every((c) => c.status === 'pass'),
  (dry?.checks ?? []).map((c) => `${c.id}:${c.status}`).join(' '),
);

const runDone = events.find((e) => e.type === 'run_done');
check('交付可播放（ANSWERS 空不算缺槽）', runDone?.delivery?.playable === true, JSON.stringify(runDone?.delivery));
const coupling = events.find((e) => e.type === 'coupling_done');
check('★ 发出 coupling_done', Boolean(coupling), JSON.stringify(coupling));
check('★ coupling_done 带 stepTimes（两步）', coupling?.stepTimes?.length === 2, JSON.stringify(coupling?.stepTimes));
const stripSub = (arr) => (arr ?? []).map(({ step, t0, t1 }) => ({ step, t0, t1 }));
check('★ stepTimes 覆盖第 1/2 步且时间正确', JSON.stringify(stripSub(coupling?.stepTimes)) === JSON.stringify([{ step: 1, t0: 0, t1: 1 }, { step: 2, t0: 1, t1: 3 }]), JSON.stringify(coupling?.stepTimes));
check(
  '★ stepTimes 带 sub（时长归一化按小问分组用）',
  (coupling?.stepTimes ?? []).length > 0 && coupling.stepTimes.every((s) => Number.isInteger(s.sub) && s.sub >= 1),
  JSON.stringify(coupling?.stepTimes),
);
check('★ run_done 也带 stepTimes', JSON.stringify(runDone?.stepTimes) === JSON.stringify(coupling?.stepTimes), JSON.stringify(runDone?.stepTimes));
check('没有 stage_error', !events.some((e) => e.type === 'stage_error'), JSON.stringify(events.find((e) => e.type === 'stage_error') ?? null).slice(0, 400));

/* ── v6 知识卡：生产路径必须走 v2 引擎，而不是原样 v2 卡喂 v1 引擎 ── */
const kcDone = events.find((e) => e.type === 'knowledgecard_done');
check('★ knowledgecard_done 存在', Boolean(kcDone));
check('★ v2 引擎命中 4 条（2 常驻 + block + belt 场景）', kcDone?.matched === 4, JSON.stringify(kcDone?.entries?.map((x) => `${x.entry_id}:${x.via}`)));
check('★ 动画槽真的注入了 4 条', kcDone?.injectedBySlot?.scene_code === 4, JSON.stringify(kcDone?.injectedBySlot));
check('★ 动画槽注入字数 > 0', (kcDone?.charsBySlot?.scene_code ?? 0) > 0, String(kcDone?.charsBySlot?.scene_code));
check('★ 命中集合里有传送带卡（scene 触发）', (kcDone?.entries ?? []).some((x) => x.entry_id === 'wb_sc_belt' && x.via === 'scene'));
const sceneSystem = captured.find((c) => c.stage === 'scene_code')?.system ?? '';
check('★ scene_code 的 system 末尾真的有知识卡块', sceneSystem.includes('【世界书·动画建模：'), sceneSystem.slice(-400));
check('★ 知识卡块在「本阶段指令」之后', sceneSystem.indexOf('【世界书·动画建模：') > sceneSystem.indexOf('【本阶段指令：动画代码】'));
check('★ 证据形状仍是前端可读的（from/depth/origin/charsBySlot 都在）', (kcDone?.entries ?? []).every((x) => 'from' in x && 'depth' in x && 'origin' in x && x.charsBySlot?.scene_code > 0));

/* 生成器的产物：stateAt/VIEW/readouts 都在，且 drawFrame 是 AI 那段 */
const programEvent = events.find((e) => e.type === 'dryrun_done')?.program;
if (programEvent) {
  const slots = programEvent.slots ?? {};
  check('stateAt 由 analysis 生成（含 state.e0）', String(slots.stateAt ?? '').includes('state.e0'));
  check('★ stateAt 带 type 与视觉中心 cx/cy', /type:\s*"block"/.test(String(slots.stateAt)) && /\bcx:/.test(String(slots.stateAt)) && /\bcy:/.test(String(slots.stateAt)), String(slots.stateAt).slice(-160));
  check('VIEW 由 analysis 生成（duration=3）', String(slots.VIEW ?? '').includes('duration: 3'));
  check('★ VIEW 的 body 用视觉中心 cx/cy', String(slots.VIEW ?? '').includes('.cx') && String(slots.VIEW ?? '').includes('.cy'), String(slots.VIEW));
  check('readouts 由 analysis 生成', String(slots.readouts ?? '').includes('block_A.x'));
  check('drawFrame 是 AI 那段', String(slots.drawFrame ?? '').includes('Draw.ground(-0.5, 5.5, 0);'));
  check('ANSWERS 为空', String(slots.ANSWERS ?? '') === '');
} else {
  check('dryrun_done 带 program', false, '没有 program');
}

/* ── 并发失败语义：breakdown 挂了，analysis 仍应跑完；整题报错，不画动画 ── */
{
  const failStream = async (opts) => {
    if (opts.stage === 'breakdown') throw new Error('breakdown exploded');
    const text = REPLIES[opts.stage] ?? '（占位）';
    opts.onDelta?.(text);
    return { text, reasoning: '', usage: null, model: 'stub', deltas: [text] };
  };
  const failEvents = await collectEvents({
    problem: { text: '水平传送带题。' },
    config: {
      endpoint: {
        id: 'stub',
        displayName: 'stub',
        baseURL: 'http://127.0.0.1:1/v1',
        defaultModel: 'stub-model',
        visionModel: 'stub-vision',
        supportsVision: true,
        supportsJsonMode: true,
        enableThinking: false,
        timeoutMs: 1000,
      },
      apiKey: 'sk-test',
      regexRules: [],
      knowledgecardEntries: [],
      knowledgecardVersion: 2,
      knowledgecardVocab: vocab,
    },
    streamImpl: failStream,
  });
  const done = failEvents.filter((e) => e.type === 'stage_done').map((e) => e.stage);
  const err = failEvents.find((e) => e.type === 'stage_error');
  const doneEvent = failEvents.find((e) => e.type === 'run_done');
  check('★ breakdown 挂了，analysis 仍完成（保留另一边结果）', done.includes('analysis'), done.join(','));
  check('★ 此时 stage_error 指向 breakdown', err?.stage === 'breakdown', JSON.stringify(err));
  check('★ 整题 error，且没有继续画动画', doneEvent?.verdict === 'error' && !done.includes('scene_code'), JSON.stringify({ done, verdict: doneEvent?.verdict }));
}

/* ── couple 重试与回退 ── */
{
  const baseConfig = {
    endpoint: {
      id: 'stub',
      displayName: 'stub',
      baseURL: 'http://127.0.0.1:1/v1',
      defaultModel: 'stub-model',
      visionModel: 'stub-vision',
      supportsVision: true,
      supportsJsonMode: true,
      enableThinking: false,
      timeoutMs: 1000,
    },
    apiKey: 'sk-test',
    regexRules: [],
    knowledgecardEntries: [],
    knowledgecardVersion: 2,
    knowledgecardVocab: vocab,
  };

  let coupleCalls = 0;
  const retryStream = async (opts) => {
    if (opts.stage === 'couple') {
      coupleCalls += 1;
      return {
        text: coupleCalls === 1 ? 'step: 1\nt0: 9\nt1: 9' : REPLIES.couple,
        reasoning: '',
        usage: null,
        model: 'stub',
        deltas: [],
      };
    }
    const text = REPLIES[opts.stage] ?? '（占位）';
    return { text, reasoning: '', usage: null, model: 'stub', deltas: [text] };
  };
  const retryEvents = await collectEvents({
    problem: { text: '水平传送带题。' },
    config: baseConfig,
    streamImpl: retryStream,
  });
  const retryCoupling = retryEvents.find((e) => e.type === 'coupling_done');
  check('★ couple 第一次不合法会重试一次', coupleCalls === 2 && retryCoupling?.attempts === 2, JSON.stringify({ coupleCalls, retryCoupling }));
  check('★ 重试成功后不标记 fallback', retryCoupling?.fallback === false && retryCoupling?.stepTimes?.length === 2, JSON.stringify(retryCoupling));

  const fallbackStream = async (opts) => {
    const text = opts.stage === 'couple' ? '这不是时间表' : (REPLIES[opts.stage] ?? '（占位）');
    return { text, reasoning: '', usage: null, model: 'stub', deltas: [text] };
  };
  const fallbackEvents = await collectEvents({
    problem: { text: '水平传送带题。' },
    config: baseConfig,
    streamImpl: fallbackStream,
  });
  const fallbackCoupling = fallbackEvents.find((e) => e.type === 'coupling_done');
  check('★ couple 两次都失败 ⇒ 按比例回退', fallbackCoupling?.fallback === true && fallbackCoupling?.stepTimes?.length === 2, JSON.stringify(fallbackCoupling));
  check('★ 回退时带 warning（不静默）', typeof fallbackCoupling?.warning === 'string' && fallbackCoupling.warning.length > 0, JSON.stringify(fallbackCoupling?.warning));
  check('★ 回退不把整题打崩（仍然 pass）', fallbackEvents.find((e) => e.type === 'run_done')?.verdict === 'pass');
}

console.log(`\n通过 ${passed}，失败 ${failures.length}`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
