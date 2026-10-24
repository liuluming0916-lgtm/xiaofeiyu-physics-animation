#!/usr/bin/env node
/**
 * 编排取证（第 3 期第 5 步）。
 *
 * 覆盖 §2.3 / §21.1 第 3 条的三件本期必须做到的事：
 *   『A』事件序列与阶段链（含"流式"这件事本身）
 *   『B』**每题一份配置快照**——运行中改配置不影响在跑的题
 *   『C』**随时取消、取消后无残留**（模型请求 + Dry-Run Worker 都要停）
 *   『D』不静默交付（模型报错 / 切分失败 / Dry-Run 失败都要如实报出来）
 *   『E』端到端：拿**真题 q01** 的槽位当"模型输出"，跑完整链路并让 Dry-Run 真的判一次
 *
 * 用法：node tests/orchestrator-selftest.mjs
 */

import { runPipeline, collectEvents, deriveTimeAxis, deriveEntryLabel, snapshotConfig } from '../core/orchestrator/pipeline.mjs';
import { encodePng, decodePng } from '../core/images/png-crop.mjs';
import { dryRun } from '../core/dryrun/dry-run.mjs';
import { parseAnalysisTable } from '../core/analysis/parse.mjs';
import { ANALYSIS_EXAMPLE } from '../core/analysis/example.mjs';
import { normalizeDataSlot } from '../sdk/runtime/animation-runtime.mjs';
import { PHASE3_STAGES, PHASE5_STAGES, MODEL_STAGES, PROMPT_STAGES, EVENT_TYPES, makeEvent, toSseFrame, isValidStage } from '../core/orchestrator/events.mjs';
import { ModelError, buildUserMessage } from '../core/gateway/index.mjs';
import { startFakeEndpoint } from './fake-endpoint/server.mjs';
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

/* ────────────────────────────── 辅助 ────────────────────────────── */

const endpoint = (overrides = {}) => ({
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
  ...overrides,
});

/**
 * 一个可控的假 streamImpl：按阶段给出固定文本。
 *
 * ⚠ 它**必须真的调用 `onDelta`**（按片回调），否则"流式"这件事在测试里根本没被覆盖 ——
 * 第一版就漏了这一点，结果"有 stage_delta 携带正文"那条断言是假的通过（见 README 12.16）。
 */
function fakeStream(replies) {
  const calls = [];
  const impl = async (opts) => {
    calls.push(opts);
    const stage = detectStage(opts.messages);
    const r = replies[stage] ?? DEFAULT_REPLIES[stage];
    if (typeof r === 'function') return r(opts);
    const full = r ?? `【${stage} 输出】`;

    // 按 4 个字符一片回吐，模拟真实的逐块到达
    const deltas = [];
    for (let i = 0; i < full.length; i += 4) deltas.push(full.slice(i, i + 4));
    for (const d of deltas) {
      if (opts.signal?.aborted) throw new ModelError({ kind: 'cancelled', message: '已取消' });
      opts.onDelta?.(d);
    }
    return { text: full, reasoning: '', usage: null, model: 'fake', deltas };
  };
  impl.calls = calls;
  return impl;
}

/**
 * 从 messages 里认出这是哪个阶段。
 *
 * ⚠ 第 5 期起阶段指令有了**自己的标签** `【本阶段指令：<label>】` ——
 *   此前它借用世界书的来源标记 `【世界书·解题：<label>】`，真词条进来后两者会撞在一起。
 *   这里保留旧标记作为兜底，但**主判据是新标签**；`tests/prompts-selftest.mjs` 的
 *   『C-3』逐条断言了新标签确实存在（否则这条兜底会把"标签丢了"伪装成"测试仍然通过"）。
 */
function detectStage(messages) {
  const sys = String(messages?.[0]?.content ?? '');
  const labels = ['读题与判定', '读题', '解题', '答案讲解', '物理分析', '动画代码', '自愈修复', '步骤耦合'];
  const label = labels.find((l) => sys.includes(`【本阶段指令：${l}】`)) ?? labels.find((l) => sys.includes(`【世界书·解题：${l}】`));
  if (label === '读题与判定' || label === '读题') return 'read_problem';
  if (label === '解题') return 'solve';
  if (label === '答案讲解') return 'breakdown';
  if (label === '物理分析') return 'analysis';
  if (label === '动画代码') return 'scene_code';
  if (label === '自愈修复') return 'repair';
  if (label === '步骤耦合') return 'couple';
  return 'unknown';
}

let cancelledOnce = false;

/**
 * v6：AI 只写 drawFrame；物理/数据槽位由 analysis 生成。
 * 这个默认值让所有不关心画面的用例都能跑完整条链。
 */
const GOOD_DRAW_FRAME = 'Draw.box([state.block_A.x, state.block_A.y], 0.3, 0.3);';
const DEFAULT_REPLIES = {
  analysis: ANALYSIS_EXAMPLE,
  scene_code: GOOD_DRAW_FRAME,
  repair: GOOD_DRAW_FRAME,
  couple: 'step: 1\nt0: 0\nt1: 1',
};

/** 假 Dry-Run：可控判定，避免每个用例都跑真沙箱。**返回形状必须与真 dryRun 一致**（`{report,run,lint}`） */
function fakeDryRun(verdict = 'pass') {
  const calls = [];
  const impl = async (input) => {
    calls.push(input);
    return {
      report: {
        format: 'od-dry-run-report',
        version: 2,
        verdict,
        cancelled: false,
        meta: { templateVersion: '1.0.0' },
        execution: { termination: 'completed', frameCount: 481, backendId: 'worker' },
        checks: [
          { id: 'C1', status: verdict === 'fail' ? 'fail' : 'pass', blocking: true, message: 'ok', diagnostics: [] },
          { id: 'C5', status: 'pass', blocking: true, message: 'ok', diagnostics: [] },
        ],
        extensions: [{ id: 'C10', status: 'skip', blocking: false, message: '未声明', diagnostics: [] }],
        observations: {},
      },
      run: null,
      lint: null,
    };
  };
  impl.calls = calls;
  return impl;
}

const baseInput = (over = {}) => ({
  problem: { text: '一物块从斜面顶端滑下，求到底端的速度。' },
  config: { endpoint: endpoint(), apiKey: 'sk-test', regexRules: [], knowledgecardVocab: vocab },
  ...over,
});

/* ────────────────────────────── 『A』事件序列 ────────────────────────────── */

console.log('编排取证（第 3 期第 5 步）\n');

console.log('『A』事件序列与阶段链');
{
  // ⚠ scene_code 阶段必须给出**合法的 8 槽位输出**，否则 Dry-Run 会（正确地）判 fail，
  //   本组想验的是"链路结构"，所以这里给合法输出。
  const stream = fakeStream({ scene_code: GOOD_DRAW_FRAME });
  const dry = fakeDryRun('pass');
  const events = await collectEvents(baseInput({ streamImpl: stream, dryRunImpl: dry }));

  const types = events.map((e) => e.type);
  check('第一个事件是 run_start', types[0] === 'run_start', types[0]);
  check('最后一个事件是 run_done', types[types.length - 1] === 'run_done', types[types.length - 1]);

  const started = events.filter((e) => e.type === 'stage_start').map((e) => e.stage);
  if (process.env.S4_DEBUG) {
    console.log('DEBUG start:', started.join(','));
    console.log('DEBUG done :', events.filter((e) => e.type === 'stage_done').map((e) => `${e.stage}${e.skipped ? '(skipped)' : ''}`).join(','));
    console.log('DEBUG types:', [...new Set(types)].join(','));
  }  check(
    '阶段链顺序正确（read_problem→solve→breakdown→analysis→**couple**→scene_code→dry_run）',
    /* 2026-10-24：couple 前置到 scene_code 之前（画图要用步骤边界）。
       `MODEL_STAGES` 现在包含 couple（6 个模型阶段）；主循环用 `PROMPT_STAGES`（5 个），
       couple 由 `runCoupleStage` 单独跑。这里按实际顺序写死一张表。 */
    started.join(',') === 'read_problem,solve,breakdown,analysis,couple,scene_code,dry_run',
    started.join(','),
  );
  check('★ MODEL_STAGES 含 couple（6 个模型阶段）', MODEL_STAGES.length === 6 && MODEL_STAGES.includes('couple'), MODEL_STAGES.join(','));
  check('★ PROMPT_STAGES 不含 couple（主循环 5 个）', PROMPT_STAGES.length === 5 && !PROMPT_STAGES.includes('couple'), PROMPT_STAGES.join(','));
  {
    const starts = events.filter((e) => e.type === 'stage_start');
    const bad = starts.filter((e) => e.total !== PHASE5_STAGES.length);
    check('★ 所有 stage_start.total 都是完整链条长度（不再 5/8 跳变）', bad.length === 0, bad.map((e) => `${e.stage}:${e.total}`).join(','));
    const scene = starts.find((e) => e.stage === 'scene_code');
    check('★ scene_code 的 index 与完整链条一致', scene?.index === PHASE5_STAGES.indexOf('scene_code'), JSON.stringify(scene));
  }
  check('新链路不再有 answers 阶段', !started.includes('answers'), started.join(','));
  /**
   * ⚠ `dry_run` **不发** `stage_done` —— 它是本地沙箱，完成由 `dryrun_done` 单独报
   *   （那个事件带 verdict / checks / diagnostics，信息量比 stage_done 大）。
   *   所以这里比的是"**模型阶段**的 start 与 done 一一配对"，不含 dry_run。
   */
  const modelStarted = started.filter((s) => s !== 'dry_run');
  check(
    '每个模型阶段的 stage_start 都有配对的 stage_done',
    events.filter((e) => e.type === 'stage_done').length === modelStarted.length,
    `start=${modelStarted.length} done=${events.filter((e) => e.type === 'stage_done').length}`,
  );
  check('dry_run 不发 stage_done（它由 dryrun_done 报完成）', events.filter((e) => e.type === 'stage_done' && e.stage === 'dry_run').length === 0);
  check('有 dryrun_done', types.includes('dryrun_done'));
  check('run_done 的判定为 pass', events.at(-1).verdict === 'pass');

  // 第 5.7 期：阶段链**声明**的是完整链条（含 read_problem 与 repair），
  // 且**没有任何阶段被跳过**（纯文字题也跑第 0 步）；repair 通过时不执行。
  const runStart = events.find((e) => e.type === 'run_start');
  check('run_start 发的是完整链条（含 read_problem 与 repair）', runStart.stages.join(',') === PHASE5_STAGES.join(','), runStart.stages.join(','));
  check('通过时不进 repair（repair 只在 Dry-Run 未通过时真跑）', !started.includes('repair'));
  check(
    '⚠ 第 5.7 期：**没有任何阶段 skipped**（纯文字题也不再跳过第 0 步）',
    !events.some((e) => e.type === 'stage_done' && e.skipped === true),
    JSON.stringify(events.filter((e) => e.type === 'stage_done' && e.skipped).map((e) => e.stage)),
  );
  check(
    'dry_run 的进度索引取自完整链条（前端进度条不会写死"最后一步"）',
    events.find((e) => e.type === 'stage_start' && e.stage === 'dry_run')?.index === PHASE5_STAGES.indexOf('dry_run'),
  );
  check(
    'dry_run 的 total = 完整链条长度',
    events.find((e) => e.type === 'stage_start' && e.stage === 'dry_run')?.total === PHASE5_STAGES.length,
  );
  check('通过时 rounds=0 且没有横幅', events.at(-1).rounds === 0 && events.at(-1).banner === null);

  // 序号单调递增且无重复（SSE 靠它发现缺口）
  const seqs = events.map((e) => e.seq);
  check('事件序号严格单调递增', seqs.every((s, i) => i === 0 || s > seqs[i - 1]), seqs.join(','));
  check('阶段枚举合法（§2.3 冻结枚举校验）', started.every((s) => isValidStage(s)));

  // 流式：每个阶段的正文都要通过 stage_delta 逐字给出
  const deltas = events.filter((e) => e.type === 'stage_delta' && e.text);
  check('有 stage_delta 携带正文（"流式出解题过程"的数据面）', deltas.length >= 4, `实际 ${deltas.length}`);
  const solveDelta = deltas.find((d) => d.stage === 'solve');
  check('solve 阶段的正文通过 stage_delta 给出', Boolean(solveDelta?.text));

  // promptHash 只报一次
  const hashEvents = events.filter((e) => e.promptHash);
  check('promptHash 只报一次', hashEvents.length === 1, `实际 ${hashEvents.length}`);
  check('promptHash 是 64 位十六进制', /^[0-9a-f]{64}$/.test(hashEvents[0]?.promptHash ?? ''));

  // 模型调用次数 = 5 个模型阶段（dry_run 不是模型调用；**第 5.7 期起纯文字题也跑 read_problem**）
  check('模型被调用 6 次（5 个主阶段 + couple；dry_run 不是模型调用）', stream.calls.length === 6, `实际 ${stream.calls.length}`);
}

console.log('\n『A-3』第 5.7 期：读题与判定（read_problem）—— 总是跑 / 判定注入世界书 / 视觉门控');
{
  /** 一条“只在图片题里才该命中”的词条（自带夹具，不依赖知识卡真实内容） */
  const wbEntries = [
    {
      id: 'wb_test_conveyor',
      title: '传送带（测试夹具）',
      origin: 'user',
      category: 'solution_skill',
      kind: 'scene',
      scenes: ['belt'],
      enabled: true,
      constant: false,
      recursive: false,
      keys: ['传送带'],
      secondary_keys: { logic: 'AND_ANY', list: ['物块'] },
      insertion_slot: ['scene_code'],
      order: 100,
      priority: 'normal',
      content: '传送带规范正文',
      code_examples: ['/* x */'],
    },
  ];
  const img = { mime: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) };
  const withWb = (over) =>
    baseInput({
      config: { endpoint: endpoint(), apiKey: 'sk-test', regexRules: [], knowledgecardEntries: wbEntries, knowledgecardVocab: vocab },
      ...over,
    });

  /* ① 纯文字题：**不再跳过**（这是第 5.7 期的口径变更），而且模型真的判了东西 */
  {
    const stream = fakeStream({
      scene_code: GOOD_DRAW_FRAME,
      read_problem: '【题目】水平面匀加速\n【物体】物块\n【姿态】水平\n【动画元件】block\n【场景】无\n【判定依据】题干给了加速度与时间求位移。',
    });
    const events = await collectEvents(baseInput({ streamImpl: stream, dryRunImpl: fakeDryRun('pass') }));
    const rpDone = events.find((e) => e.type === 'stage_done' && e.stage === 'read_problem');
    check('纯文字题：read_problem **真的跑了**（有 stage_start 与正文）', events.some((e) => e.type === 'stage_start' && e.stage === 'read_problem') && !rpDone?.skipped);
    check('纯文字题：read_problem 的正文非空（转写 + 判定都产出了）', (rpDone?.chars ?? 0) > 0, String(rpDone?.chars));
    check('纯文字题：模型调用 6 次（第 0 步不再被跳过 + couple）', stream.calls.length === 6, String(stream.calls.length));

    const jd = events.find((e) => e.type === 'judgement_done');
    check('★ 判定留痕：发出 judgement_done 事件（计划 §5 S4 第 4 项）', Boolean(jd));
    check('★ 判定留痕：考点表已退役 ⇒ concepts 为空数组（v2 不再判考点）', Array.isArray(jd?.concepts) && jd.concepts.length === 0, JSON.stringify(jd?.concepts));
    check('★ 判定留痕：题型标签已退役 ⇒ 解析结果为空数组（不再产出第三方题型名）', Array.isArray(jd?.tags) && jd.tags.length === 0, JSON.stringify(jd?.tags));
    check('★ 判定留痕：动画元件被解析出来', jd?.elements?.join(',') === 'block', JSON.stringify(jd?.elements));
    check('★ 判定留痕：带上【判定依据】（可复核）', String(jd?.why ?? '').includes('加速度'));
    check('★ 判定留痕：判定非空（empty=false）', jd?.empty === false);
  }

  /* ①′ 反例：判定为空 / 表外词 ⇒ 照样留痕，且不抛异常 */
  {
    const stream = fakeStream({
      scene_code: GOOD_DRAW_FRAME,
      read_problem: '【题目】瞎判\n【动画元件】航天飞机\n【场景】不存在的题型\n【判定依据】瞎判',
    });
    const events = await collectEvents(baseInput({ streamImpl: stream, dryRunImpl: fakeDryRun('pass') }));
    const jd = events.find((e) => e.type === 'judgement_done');
    check('反例：三个字段全是表外词 ⇒ 判定为空但**事件照样发**', jd?.empty === true && jd.concepts.length === 0 && jd.elements.length === 0 && (jd.scenes ?? []).length === 0);
    check(
      '反例：表外词被**如实报出**（不许静默丢弃）',
      JSON.stringify(jd?.unknowns ?? {}).includes('航天飞机') && JSON.stringify(jd?.unknowns ?? {}).includes('不存在的题型'),
      JSON.stringify(jd?.unknowns),
    );
    check('反例：结构问题被报出（unknown-element / unknown-scene）', (jd?.problems ?? []).some((p) => p.code === 'unknown-element') && (jd?.problems ?? []).some((p) => p.code === 'unknown-scene'));
    check('反例：整条链**没被打崩**（仍然 run_done=pass）', events.at(-1)?.verdict === 'pass');
  }

  /* ①″ 负对照：判定为空时，触发**退化为纯字面 keys**（灰度期口径），不报错 */
  {
    const stream = fakeStream({ scene_code: GOOD_DRAW_FRAME, read_problem: '【判定依据】什么都没判出来' });
    const events = await collectEvents(withWb({ streamImpl: stream, dryRunImpl: fakeDryRun('pass') }));
    const jd = events.find((e) => e.type === 'judgement_done');
    check('负对照：一个字段都没判 ⇒ empty=true 且 problems 里有 missing-section', jd?.empty === true && (jd?.problems ?? []).some((p) => p.code === 'missing-section'));
    check('负对照：仍然跑完全程（退化不等于失败）', events.at(-1)?.verdict === 'pass');
  }

  /* ② 图片题：真的跑，而且**转写文字进入知识卡的扫描文本** */
  {
    // 反例：读题没判 belt 场景 ⇒ v2 卡不该命中
    const streamNo = fakeStream({ scene_code: GOOD_DRAW_FRAME, read_problem: '【题目】水平面\n【动画元件】无\n【场景】无' });
    const evNo = await collectEvents(withWb({ images: [img], streamImpl: streamNo, dryRunImpl: fakeDryRun('pass') }));
    const wbNo = evNo.find((e) => e.type === 'knowledgecard_done');
    check('反例：读题没判 belt 场景 ⇒ 该词条不命中', !(wbNo?.entries ?? []).some((p) => p.entry_id === 'wb_test_conveyor'));

    // 正例：读题判了 belt 场景 ⇒ v2 卡命中（v2 不再扫题面/转写字面量）
    const streamYes = fakeStream({ scene_code: GOOD_DRAW_FRAME, read_problem: '【题目】传送带\n【动画元件】无\n【场景】belt' });
    const evYes = await collectEvents(withWb({ images: [img], streamImpl: streamYes, dryRunImpl: fakeDryRun('pass') }));
    const wbYes = evYes.find((e) => e.type === 'knowledgecard_done');
    check(
      '正例：读题判出 belt 场景 ⇒ v2 场景卡命中',
      (wbYes?.entries ?? []).some((p) => p.entry_id === 'wb_test_conveyor'),
      JSON.stringify((wbYes?.entries ?? []).map((p) => p.entry_id)),
    );
    check('读题与判定真的跑了（有 stage_start 与正文）', evYes.some((e) => e.type === 'stage_start' && e.stage === 'read_problem'));
    check('图片题里模型被调用 6 次（读题判定 + 解题 + 分步 + 分析 + 动画 + couple）', streamYes.calls.length === 6, String(streamYes.calls.length));
    const rpCall = streamYes.calls.find((c) => detectStage(c.messages) === 'read_problem');
    check('读题阶段的请求里**确实带了图片**', Boolean(rpCall) && Array.isArray(rpCall.messages.find((m) => m.role === 'user')?.content));
    check('读题阶段只抄明确标注的数值（没标注不写、不猜）', String(rpCall?.messages?.[0]?.content ?? '').includes('只抄题面或图中') && String(rpCall?.messages?.[0]?.content ?? '').includes('没标注的不要写'));
    check('读题阶段明确"不要解题"（它只转写与判定）', String(rpCall?.messages?.[0]?.content ?? '').includes('不要解题'));
    check(
      '★ 第 9 期：读题阶段的**用户消息里只注入元件词表**（考点表 / 题型表已下线，它们没有消费者）',
      (() => {
        const userText = String(rpCall?.messages?.find((m) => m.role === 'user')?.content?.[0]?.text ?? '');
        return userText.includes('【动画元件词表】') && !userText.includes('【考点词表】') && !userText.includes('【题型标签词表】');
      })(),
    );
  }

  /* ③ 视觉门控（§11.3）：带图但模型不看图 ⇒ 明确报错停下，绝不把图发给它 */
  {
    const stream = fakeStream({});
    const events = await collectEvents(
      baseInput({
        images: [img],
        config: { endpoint: endpoint({ supportsVision: false }), apiKey: 'sk-test', regexRules: [] },
        streamImpl: stream,
        dryRunImpl: fakeDryRun('pass'),
      }),
    );
    const err = events.find((e) => e.type === 'stage_error');
    check('视觉门控：带图但 supportsVision=false ⇒ 报错停下', err?.error?.kind === 'vision-unsupported', String(err?.error?.kind));
    check('视觉门控：给出可操作建议（换模型 / 手打描述）', String(err?.error?.hint ?? '').includes('配图补充描述'));
    check('视觉门控：**一次模型调用都没发**（不做假多模态降级）', stream.calls.length === 0, String(stream.calls.length));
    check('视觉门控：run_done 判定为 error（不静默）', events.at(-1).verdict === 'error');
  }
}

console.log('\n『A-2』SSE 线上格式');
{
  const e = makeEvent('stage_delta', { stage: 'solve', text: '你好' }, 3);
  const frame = toSseFrame(e);
  check('帧含 id 行（断线重连用 Last-Event-ID）', frame.startsWith('id: 3\n'));
  check('帧含 event 行', frame.includes('event: stage_delta\n'));
  check('帧含 data 行且是 JSON', frame.includes('data: {'));
  check('帧以空行结束', frame.endsWith('\n\n'));
  let threw = false;
  try {
    makeEvent('not_an_event', {}, 1);
  } catch {
    threw = true;
  }
  check('未知事件类型被拒', threw);
  check('事件类型清单非空', EVENT_TYPES.length >= 8);
}

/* ────────────────────────────── 『B』配置快照 ────────────────────────────── */

console.log('\n『B』每题一份配置快照（§2.3）');
{
  const liveEndpoint = endpoint({ defaultModel: 'model-A' });
  const config = { endpoint: liveEndpoint, apiKey: 'sk-a', regexRules: [] };

  const snap = snapshotConfig(config);
  check('快照被冻结（运行中改不动）', Object.isFrozen(snap));
  check('端点快照被冻结', Object.isFrozen(snap.endpoint));

  // 运行中改"活配置"
  const stream = fakeStream({});
  const dry = fakeDryRun('pass');
  const events = await collectEvents(baseInput({ config, streamImpl: stream, dryRunImpl: dry }));
  liveEndpoint.defaultModel = 'model-B'; // 运行后改，不影响本次
  const used = stream.calls.map((c) => c.endpoint.defaultModel);
  check('本次运行全程都用快照里的 model-A', used.every((m) => m === 'model-A'), used.join(','));

  // run_start 里报告的就是快照里的模型
  const startEvt = events.find((e) => e.type === 'run_start');
  check('run_start 报告快照模型', startEvt.model === 'model-A', startEvt.model);

  let threw = false;
  try {
    snapshotConfig(config);
    Object.assign(snap, { apiKey: 'sk-hacked' });
  } catch {
    threw = true;
  }
  check('对冻结快照赋值在严格模式下抛错（防止静默改配置）', threw);
}

/* ────────────────────────────── 『C』取消语义 ────────────────────────────── */

console.log('\n『C』取消语义（§21.1 第 3 条）');
{
  // C-1：开始前就取消 → 一个模型都不该调
  {
    const ac = new AbortController();
    ac.abort();
    const stream = fakeStream({});
    const events = await collectEvents(baseInput({ streamImpl: stream, dryRunImpl: fakeDryRun(), signal: ac.signal }));
    check('已取消时不发起任何模型调用', stream.calls.length === 0, `实际 ${stream.calls.length}`);
    check('给出 cancelled 事件', events.some((e) => e.type === 'cancelled'));
    check('run_done 判定为 cancelled', events.at(-1).verdict === 'cancelled');
  }

  // C-2：中途取消 → 后续阶段不再调用，且 Dry-Run 不执行
  {
    const ac = new AbortController();
    const stream = fakeStream({});
    const dry = fakeDryRun('pass');
    const events = [];
    for await (const e of runPipeline(baseInput({ streamImpl: stream, dryRunImpl: dry, signal: ac.signal }))) {
      events.push(e);
      if (e.type === 'stage_done' && e.stage === 'breakdown') ac.abort(); // v6：analysis 已并行启动，取消发生在 breakdown 完成后
    }
    check(
      '取消后不再调用后续模型（analysis 已启动；couple 可能已发起但不会画出动画）',
      !stream.calls.some((c) => c.stage === 'scene_code') && stream.calls.length <= 5,
      `实际 ${stream.calls.length}`,
    );
    check('取消后不执行 Dry-Run', dry.calls.length === 0, `实际 ${dry.calls.length}`);
    check('给出 cancelled 事件', events.some((e) => e.type === 'cancelled'));
    check('run_done 判定为 cancelled', events.at(-1).verdict === 'cancelled');
    check('取消后仍有 run_done 收尾（不是静默中断）', events.at(-1).type === 'run_done');
  }

  // C-3：模型流在等的时候取消 → 归类 cancelled，且**不当错误报**
  {
    const ac = new AbortController();
    const stream = async (opts) => {
      // 模拟"请求悬挂中"，直到被 abort
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 5000);
        opts.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
      return { text: 'x' };
    };
    const events = [];
    const p = (async () => {
      for await (const e of runPipeline(baseInput({ streamImpl: stream, dryRunImpl: fakeDryRun(), signal: ac.signal }))) {
        events.push(e);
      }
    })();
    setTimeout(() => ac.abort(), 40);
    await p;
    check('悬挂请求被取消 → 归类 cancelled（不报 stage_error）', !events.some((e) => e.type === 'stage_error'), JSON.stringify(events.map((e) => e.type)));
    check('取消后给出 cancelled 事件', events.some((e) => e.type === 'cancelled'));
    check('run_done 判定 cancelled', events.at(-1).verdict === 'cancelled');
  }
}

/* ────────────────────────────── 『D』不静默交付 ────────────────────────────── */

console.log('\n『D』不静默交付（§21.2 第 8 条）');
{
  // D-1：模型 401 → stage_error，且 run_done 为 error
  {
    const stream = async () => {
      throw new ModelError({ kind: 'auth', message: '鉴权失败', status: 401 });
    };
    const dry = fakeDryRun('pass');
    const events = await collectEvents(baseInput({ streamImpl: stream, dryRunImpl: dry }));
    const err = events.find((e) => e.type === 'stage_error');
    check('模型报错产生 stage_error', Boolean(err));
    check('stage_error 带 kind 与可操作建议', err?.error?.kind === 'auth' && Boolean(err.error.hint));
    check('模型报错后不再往下跑', dry.calls.length === 0);
    check('run_done 判定为 error（不是 pass）', events.at(-1).verdict === 'error');
  }

  // D-2：analysis 表解析失败 → 当场报 analysis.invalid，不拿半张表去生成程序
  {
    const stream = fakeStream({ analysis: '=== 元件运动表 (MOTIONS) ===\nelement: block_A\nsegment: 1\nt0: 0\nt1: 1' });
    const dry = fakeDryRun('pass');
    const events = await collectEvents(baseInput({ streamImpl: stream, dryRunImpl: dry }));
    const err = events.find((e) => e.type === 'stage_error' && e.stage === 'analysis');
    check('analysis 解析失败时给出 stage_error', Boolean(err));
    check('错误类型是 analysis.invalid', err?.error?.kind === 'analysis.invalid', String(err?.error?.kind));
    check('给出可操作的重写提示', String(err?.error?.hint ?? '').includes('MOTIONS'));
    check('解析失败时不调用 Dry-Run', dry.calls.length === 0);
    check('run_done 判定为 error', events.at(-1).verdict === 'error');
    check('没有生成 dryrun_done（不拿半成品去跑）', !events.some((e) => e.type === 'dryrun_done'));
  }

  // D-3：Dry-Run 判定 fail → 如实透传
  //
  // ⚠ 这里刻意 `disableRepair: true`：本组验的是"**不静默**"这条口径（fail 必须原样透传），
  //   而第 4 期起 fail 会自动进自愈循环，透传路径会被再跑一遍 Dry-Run 覆盖掉。
  //   自愈本身的行为由 `tests/repair-selftest.mjs` 逐条取证（B1–B6），不在这里重复。
  {
    const stream = fakeStream({ scene_code: GOOD_DRAW_FRAME });
    const dry = fakeDryRun('fail');
    const events = await collectEvents(baseInput({ streamImpl: stream, dryRunImpl: dry, disableRepair: true }));
    const dd = events.find((e) => e.type === 'dryrun_done');
    check('Dry-Run 的 fail 被如实透传', dd?.verdict === 'fail');
    check('run_done 也是 fail（不包装成成功）', events.at(-1).verdict === 'fail');
    check('Dry-Run 真的被调用了一次', dry.calls.length === 1);
    check('透传了 checks 与 extensions', dd.checks.length > 0 && dd.extensions.length > 0);
    check('extensions 标注 blocking=false', dd.extensions.every((e) => e.blocking === false));
    check('关掉自愈时不挂横幅字段也不假装修过（rounds=0）', events.at(-1).rounds === 0, String(events.at(-1).rounds));
  }

  // D-4：判定为 pass 时也不假装"没人告警"
  {
    const stream = fakeStream({ scene_code: GOOD_DRAW_FRAME });
    const dry = fakeDryRun('pass-with-warnings');
    const events = await collectEvents(baseInput({ streamImpl: stream, dryRunImpl: dry, disableRepair: true }));
    check('pass-with-warnings 被如实透传', events.at(-1).verdict === 'pass-with-warnings');
  }
}

/* ────────────────────────────── 『E』端到端（analysis 生成 → drawFrame → 真 Dry-Run） ────────────────────────────── */

console.log('\n『E』端到端：analysis 当模型输出，生成 8 槽位后跑真 Dry-Run');
{
  const stream = fakeStream({
    solve: '物块先加速后匀速……',
    breakdown: 'title: 第 1 步\ntex: 受滑动摩擦力\n\ntitle: 第 2 步\ntex: 共速后匀速',
  });

  // 这一条**用真的 dryRun**（不注入假实现），让校验内核真的跑一次
  const events = await collectEvents(baseInput({ streamImpl: stream }));

  const dd = events.find((e) => e.type === 'dryrun_done');
  const last = events.at(-1);
  check('端到端跑完（有 dryrun_done）', Boolean(dd));
  check('判定为 pass（analysis 示例 + 合法 drawFrame）', dd?.verdict === 'pass', `实际 ${dd?.verdict}；checks=${JSON.stringify(dd?.checks?.filter((c) => c.status !== 'pass'))}`);
  check('Dry-Run 真的执行了（termination=completed）', dd?.termination === 'completed', String(dd?.termination));
  check('Dry-Run 产出了帧数', (dd?.frameCount ?? 0) > 0, String(dd?.frameCount));
  check('run_done 判定 pass', last.verdict === 'pass');
  check('给出了可装配的程序载荷', Boolean(dd?.program?.slots) && Object.keys(dd.program.slots).length === 8);
  check('载荷带 mode（第 8 期起恒为 BOTH：数值/符号按条目走）', dd.program.mode === 'BOTH', String(dd.program.mode));
  check('给出了行偏移表（诊断用）', typeof dd?.lineMap?.stateAt === 'number', JSON.stringify(dd?.lineMap));

  /* ── v6 的核心：物理/数据槽位由 analysis 生成，AI 只写 drawFrame ── */
  check('ANSWERS 为空（C7 已删）', dd.program.slots.ANSWERS.trim() === '', JSON.stringify(dd.program.slots.ANSWERS));
  check('VIEW 的 duration 取自 analysis 的 T_phys=3', dd.program.slots.VIEW.includes('duration: 3'), dd.program.slots.VIEW);
  check('stateAt 由 analysis 生成（含分段变量 tt0）', dd.program.slots.stateAt.includes('tt0') && dd.program.slots.stateAt.includes('block_A'), dd.program.slots.stateAt);
  check('setup 只生成 T_PHYS 常量', dd.program.slots.setup.includes('T_PHYS = 3'), dd.program.slots.setup);
  check('drawFrame 逐字来自 AI', dd.program.slots.drawFrame.trim() === GOOD_DRAW_FRAME, dd.program.slots.drawFrame);
  check('STEPS 来自 breakdown（标题保留）', dd.program.slots.STEPS.includes('title: 第 1 步'), dd.program.slots.STEPS);

  // 端到端还要确认"模型收到的题面是真的题目"
  const solveCall = stream.calls.find((c) => detectStage(c.messages) === 'solve');
  const userMsg = solveCall.messages.find((m) => m.role === 'user');
  check('任务段包含题面', String(userMsg.content).includes('传送带') || String(userMsg.content).includes('物块'));

  // scene_code 只拿到 analysis 的物理表与状态键映射，不再拿 8 槽位模板
  const sceneCall = stream.calls.find((c) => detectStage(c.messages) === 'scene_code');
  const sceneUser = String(sceneCall?.messages?.find((m) => m.role === 'user')?.content ?? '');
  check('scene_code 的输入含 analysis 运动表', sceneUser.includes('元件运动表') && sceneUser.includes('block_A'), sceneUser.slice(0, 120));
  check('scene_code 的输入含状态键映射（block_A → block_A）', sceneUser.includes('block_A'), sceneUser.slice(0, 200));
}

console.log('\n『E-2』deriveTimeAxis 从 STEPS 里推导总时长');
{
  const axis = deriveTimeAxis('title: a\ntex: x\nt0: 0\nt1: 0.6\n\ntitle: b\ntex: y\nt0: 0.6\nt1: 2.0');
  check('推导出总时长 2.0', axis.includes('2'), axis.slice(0, 60));
  check('提醒 SIM.duration 必须与末步 t1 一致', axis.includes('SIM.duration'));
  check('提醒 stateAt 要覆盖全程', axis.includes('stateAt'));
  const empty = deriveTimeAxis('');
  check('没有 STEPS 时给兜底说明（不抛错）', empty.includes('0.5–6 秒'));
}

console.log('\n『E-3』图片只进 read_problem / solve / analysis，且不改 promptHash');
{
  const stream = fakeStream({});
  const img = { mime: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) };
  const events = await collectEvents(baseInput({ problem: { text: '看图解题' }, images: [img], streamImpl: stream, dryRunImpl: fakeDryRun() }));

  const withImage = stream.calls.filter((c) => {
    const u = c.messages.find((m) => m.role === 'user');
    return Array.isArray(u.content) && u.content.some((p) => p.type === 'image_url');
  });
  // v6：analysis 也吃题图（用户允许）；scene_code 吃拆出来的示意图，
  // 没有【示意图范围】时按 v1.1.16 退回整幅原题图，所以这里也是 4 个阶段。
  check('带图的阶段是 read_problem / solve / analysis / scene_code', withImage.length === 4, `实际 ${withImage.length} 个阶段带图`);
  check(
    '带图的阶段恰好是 read_problem、solve、analysis、scene_code',
    withImage.map((c) => detectStage(c.messages)).sort().join(',') === 'analysis,read_problem,scene_code,solve',
    withImage.map((c) => detectStage(c.messages)).join(','),
  );
  check('带图时用了 vision（endpoint 的视觉开关生效）', withImage.every((c) => c.vision === true));

  const hashes = new Set(events.filter((e) => e.promptHash).map((e) => e.promptHash));
  const eventsNoImg = await collectEvents(baseInput({ streamImpl: fakeStream({}), dryRunImpl: fakeDryRun() }));
  const hashNoImg = new Set(eventsNoImg.filter((e) => e.promptHash).map((e) => e.promptHash));
  check('带图与不带图的 promptHash 相同（图片不进固定前缀）', [...hashes][0] === [...hashNoImg][0]);
}

console.log('\n『A-4』第 5.7 期延续：纯图片题的运行标题回填（run_label）');
{
  /* 先单测取标签的规则本身（它最容易出"标题变成一个小标题"这种低级错） */
  check('取第一句有内容的话', deriveEntryLabel('【题面复述】\n水平传送带以速率 u 运行。\n【物体与姿态】…') === '水平传送带以速率 u 运行。');
  check('整行只有【小标题】时跳过它', deriveEntryLabel('【题面复述】\n甲物体下滑') === '甲物体下滑');
  check('行首小标题与内容同一行时剥掉小标题', deriveEntryLabel('【题面复述】水平传送带') === '水平传送带');
  check('剥掉 Markdown 装饰', deriveEntryLabel('## **斜面题**\n正文') === '斜面题');
  check('超长截断并加省略号', (() => { const s = deriveEntryLabel('甲'.repeat(60)); return s.length === 41 && s.endsWith('…'); })());
  check('取不到内容时返回 null（不许拿空串当标题）', deriveEntryLabel('') === null && deriveEntryLabel('【只有标题】') === null);

  /* 再验真实链路：纯图片题回填，纯文字题不回填（负对照） */
  const img = { mime: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) };
  const transcript = '【题目】传送带共速\n【题面复述】\n水平传送带以恒定速率 u 运行，物块轻放其上。\n【物体与姿态】水平传送带；物块。';

  const streamImg = fakeStream({ scene_code: GOOD_DRAW_FRAME, read_problem: transcript });
  const evImg = await collectEvents(
    baseInput({ problem: { text: '' }, images: [img], streamImpl: streamImg, dryRunImpl: fakeDryRun('pass') }),
  );
  const start = evImg.find((e) => e.type === 'run_start');
  const relabel = evImg.find((e) => e.type === 'run_label');
  check('纯图片题：开跑时标题是“未命名题目”（题面为空）', start.entry === '未命名题目', String(start.entry));
  check('纯图片题：读题与判定跑完后发 run_label 回填标题', Boolean(relabel));
  check('回填的标题取自模型【题目】字段', relabel?.entry === '传送带共速', String(relabel?.entry));
  check('run_label 标出来源，便于排查', relabel?.source === 'read_problem');
  check('run_label 在 read_problem 之后（不是开跑前乱改标题）', evImg.indexOf(relabel) > evImg.findIndex((e) => e.type === 'stage_done' && e.stage === 'read_problem'));

  const streamTxt = fakeStream({ scene_code: GOOD_DRAW_FRAME, read_problem: '【题目】斜面下滑\n【题面复述】一物块从斜面顶端滑下' });
  const evTxt = await collectEvents(baseInput({ streamImpl: streamTxt, dryRunImpl: fakeDryRun('pass') }));
  check('纯文字题也采用模型标题', evTxt.find((e) => e.type === 'run_label')?.entry === '斜面下滑');
  check('纯文字题标题来自题面（模型标题到达前）', String(evTxt.find((e) => e.type === 'run_start')?.entry).startsWith('一物块从斜面顶端滑下'));
}

/* ────────────────────────────── 『Z』参考答案与题目对不上（v1.1.16） ────────────────────────────── */

console.log('\n『Z』参考答案：与题目对不上时**停在解题之后**，不继续拆步骤/画动画');
{
  const stream = fakeStream({
    read_problem: '【题面复述】一物块从斜面顶端滑下……',
    solve: '【解析与题目不一致】这份解析讲的是传送带，而题面是斜面。',
  });
  const events = await collectEvents(
    baseInput({ streamImpl: stream, dryRunImpl: fakeDryRun('pass'), reference: { text: '解析：传送带共速……', images: [] } }),
  );
  const done = events.find((e) => e.type === 'run_done');
  const err = events.find((e) => e.type === 'stage_error');
  const stages = events.filter((e) => e.type === 'stage_start').map((e) => e.stage);

  check('run_done 是 error，并标记 referenceMismatch', done?.verdict === 'error' && done?.referenceMismatch === true, JSON.stringify(done));
  check('只跑了 read_problem + solve（没有继续后面的阶段）', stages.join(',') === 'read_problem,solve', stages.join(','));
  check('stage_error 的 kind 是 reference.mismatch', err?.error?.kind === 'reference.mismatch', JSON.stringify(err));
  check('停止时不产生 stage_done(analysis/scene_code)', !events.some((e) => e.type === 'stage_done' && ['analysis', 'scene_code'].includes(e.stage)));
}

/* ────────────────────────────── 『Y』v1.1.16 拆图：读题给框 → 裁出示意图 → 写动画时附上 ────────────────────────────── */

console.log('\n『Y』拆图：读题给【示意图范围】→ 程序真裁 → 写动画那一步能看到图');
{
  /* 造一张 40×40 的真 PNG（渐变），框住中间一半 ⇒ 应裁出 20×20 */
  const W = 40;
  const H = 40;
  const px = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      px[i] = x * 6;
      px[i + 1] = y * 6;
      px[i + 2] = 128;
      px[i + 3] = 255;
    }
  }
  const png = encodePng({ width: W, height: H, colorType: 6, pixels: px });
  check('（前置）合成 PNG 可被自己解码', Boolean(decodePng(png)));

  const transcript = '【题面复述】水平传送带上的物块 A。\n【示意图范围】0.25,0.25,0.75,0.75';
  const stream = fakeStream({
    read_problem: transcript,
    solve: '解题：……',
    breakdown: 'title: 第 1 步\ntex: x',
    scene_code: GOOD_DRAW_FRAME,
  });
  const events = await collectEvents(
    baseInput({ images: [{ mime: 'image/png', data: png, name: 'problem.png' }], streamImpl: stream, dryRunImpl: fakeDryRun('pass') }),
  );

  const dd = events.find((e) => e.type === 'diagram_done');
  check('出了 diagram_done 事件', Boolean(dd), JSON.stringify(dd));
  check('★ 按框裁出了 20×20（原图 40×40 的中间一半）', dd?.ok === true && dd?.width === 20 && dd?.height === 20, JSON.stringify(dd));

  const sceneCall = stream.calls.find((c) => detectStage(c.messages) === 'scene_code');
  const sceneUser = sceneCall?.messages?.find((m) => m.role === 'user');
  check('★ 写动画那一步的请求**带了图**', Array.isArray(sceneUser?.content) && sceneUser.content.some((p) => p.type === 'image_url'), typeof sceneUser?.content);
  check(
    '写动画那一步的 user 文本里含**读题的几何转写**（之前它只用来触发知识卡）',
    JSON.stringify(sceneUser?.content ?? '').includes('水平传送带上的物块 A'),
  );
}

/* ────────────────────────────── 『Z』v1.1.16 接线对账：读了但没提供 ⇒ C1 指对槽位 ────────────────────────────── */

console.log('\n『Z』接线对账：state / context 的“提供 vs 消费”对不上时，C1 指向正确槽位');
{
  const base = {
    PROBLEM: '测试',
    STEPS: 'title: 第 1 步\ntex: x\nt0: 0\nt1: 1',
    ANSWERS: 'symbol: x\nvalue: 1\nunit: m\nat_t: 1\nstep: 1',
    VIEW: "SIM = { duration: 1, bodies: [{ id: 'A', at: (s) => [s.x, 0] }] };",
    setup: "const y = 0; RETURN('y', y);",
    stateAt: 'return { x: t };',
    drawFrame: 'Draw.box([state.x, 0], 0.3, 0.3);',
    readouts: "return [{ key: 'x', label: 'x', value: state.x, unit: 'm' }];",
  };

  {
    const { report } = await dryRun({ slots: base, entry: 'wiring-ok' });
    check('正常程序：接线对账通过（不误报）', report.checks.find((c) => c.id === 'C1')?.status === 'pass');
  }
  {
    const slots = { ...base, drawFrame: 'Draw.box([state.x, state.yB], 0.3, 0.3);' };
    const { report } = await dryRun({ slots, entry: 'wiring-missing-state' });
    const c1 = report.checks.find((c) => c.id === 'C1');
    const diag = (c1?.diagnostics ?? []).find((d) => d.rule === 'state-key-missing');
    check('★ 读了 state.yB 但 stateAt 没返回 ⇒ C1 失败', c1?.status === 'fail');
    check('★ 诊断指向 stateAt（而不是 drawFrame）', diag?.slot === 'stateAt' && diag?.name === 'yB', JSON.stringify(diag));
    check('诊断里写明“别去改 drawFrame 凑”', String(diag?.message ?? '').includes('不要去改 drawFrame'));
  }
  {
    /* v1.1.18：顶层 key 有、但字段没有 —— 旧实现只看 e0，会放行 */
    const slots = {
      ...base,
      stateAt: 'return { e0: { x: t } };',
      drawFrame: 'Draw.box([state.e0.x, state.e0.y], 0.3, 0.3);',
      readouts: "return [{ key: 'x', label: 'x', value: state.e0.x, unit: 'm' }];",
    };
    const { report } = await dryRun({ slots, entry: 'wiring-missing-field' });
    const c1 = report.checks.find((c) => c.id === 'C1');
    const diag = (c1?.diagnostics ?? []).find((d) => d.rule === 'state-field-missing');
    check('★ state.e0 存在但 state.e0.y 不存在 ⇒ C1 失败', c1?.status === 'fail', JSON.stringify(c1?.diagnostics ?? []).slice(0, 300));
    check('★ 字段级诊断指向 stateAt 的 e0.y', diag?.slot === 'stateAt' && diag?.name === 'e0.y', JSON.stringify(diag));
    check('字段级诊断写明“不要用 drawFrame 去凑”', String(diag?.message ?? '').includes('不要用 drawFrame 去凑'));
  }
  {
    /* v1.1.18 真题实测：`angleDeg` 是运行时注入的（injectBodyAngles），卡片示例就写它。
       bodies 里有 ⇒ 读它不算"作者没给"；bodies 里没有 ⇒ 不注入，仍要报错。 */
    const withBody = {
      ...base,
      VIEW: "SIM = { duration: 1, bodies: [{ id: 'block_A', at: (s) => [s.block_A.x, 0] }] };",
      stateAt: 'return { block_A: { x: t, y: 0 } };',
      drawFrame: 'Draw.box([state.block_A.x, state.block_A.y], 0.3, 0.3, { angleDeg: state.block_A.angleDeg });',
      readouts: "return [{ key: 'x', label: 'x', value: state.block_A.x, unit: 'm' }];",
    };
    const ok = await dryRun({ slots: withBody, entry: 'wiring-angle-injected' });
    check(
      '★ state.<key>.angleDeg 由运行时注入：bodies 里有该 key ⇒ C1 不报缺字段',
      ok.report.checks.find((c) => c.id === 'C1')?.status === 'pass',
      JSON.stringify(ok.report.checks.find((c) => c.id === 'C1')?.diagnostics ?? []).slice(0, 300),
    );

    const noBody = { ...withBody, VIEW: 'SIM = { duration: 1, bodies: [] };' };
    const bad = await dryRun({ slots: noBody, entry: 'wiring-angle-not-injected' });
    const c1 = bad.report.checks.find((c) => c.id === 'C1');
    check(
      '★ 同一个字段，但 key 不在 bodies 里 ⇒ 仍按"缺字段"报错（放行不能扩大）',
      c1?.status === 'fail' && (c1?.diagnostics ?? []).some((d) => d.rule === 'state-field-missing'),
      JSON.stringify(c1?.diagnostics ?? []).slice(0, 300),
    );
  }
  {
    const slots = { ...base, stateAt: 'return { x: context.k };' };    const { report } = await dryRun({ slots, entry: 'wiring-missing-context' });
    const c1 = report.checks.find((c) => c.id === 'C1');
    const diag = (c1?.diagnostics ?? []).find((d) => d.rule === 'context-key-missing');
    check('★ 读了 context.k 但 setup 没导出 ⇒ C1 失败且指向 setup', c1?.status === 'fail' && diag?.slot === 'setup', JSON.stringify(diag));
  }
  {
    const slots = { ...base, drawFrame: 'Draw.box([state.x, state?.z ?? 0], 0.3, 0.3);' };
    const { report } = await dryRun({ slots, entry: 'wiring-optional' });
    check('可选读取 state?.z 不算消费（不误报）', report.checks.find((c) => c.id === 'C1')?.status === 'pass');
  }
}

/* ────────────────────────────── 『AA』v1.1.16 数据槽位容错：`tex: """正文` 同一行 ────────────────────────────── */

console.log('\n『AA』STEPS 多行值：起始 """ 后面直接跟正文也要能解析');
{
  const mk = (texBlock) => `title: 第 1 步\n${texBlock}\nt0: 0\nt1: 1`;
  const inline = 'tex: """第一行\n\\[\nx=v_0t\n\\]\n"""';
  try {
    const rows = normalizeDataSlot(mk(inline), 'STEPS');
    check('★ 起始 """ 后直接跟正文 ⇒ 正常解析（不再报“无法解析这一行：\\[”）', rows[0]?.tex?.includes('x=v_0t'));
    check('多行值保留了换行结构', String(rows[0]?.tex ?? '').split('\n').length === 4, JSON.stringify(rows[0]?.tex));
  } catch (e) {
    check('★ 起始 """ 后直接跟正文 ⇒ 正常解析', false, e.message);
  }
  const sameLine = 'tex: """abc"""';
  try {
    check('同一行 """abc""" 也能解析', normalizeDataSlot(mk(sameLine), 'STEPS')[0]?.tex === 'abc');
  } catch (e) {
    check('同一行 """abc""" 也能解析', false, e.message);
  }
  const oldStyle = 'tex: """\n第一行\n\\[\nx\n\\]\n"""';
  try {
    check('旧写法（""" 独占一行）逐字不变', normalizeDataSlot(mk(oldStyle), 'STEPS')[0]?.tex === '第一行\n\\[\nx\n\\]');
  } catch (e) {
    check('旧写法（""" 独占一行）逐字不变', false, e.message);
  }
  let threw = false;
  try {
    normalizeDataSlot(mk('tex: """未闭合'), 'STEPS');
  } catch {
    threw = true;
  }
  check('未闭合仍然报错（不静默吞掉）', threw);
}

/* ────────────────────────────── 汇总 ────────────────────────────── */

console.log(`\n${failures.length ? '✗' : '✓'} 编排取证：通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
  process.exitCode = 1;
}
