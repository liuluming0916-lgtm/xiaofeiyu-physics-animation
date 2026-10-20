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
import { PHASE3_STAGES, PHASE5_STAGES, MODEL_STAGES, EVENT_TYPES, makeEvent, toSseFrame, isValidStage } from '../core/orchestrator/events.mjs';
import { SLOT_KEY_NAMES } from '../contracts/spec/frozen-keys.mjs';
import { ModelError, buildUserMessage } from '../core/gateway/index.mjs';
import { startFakeEndpoint } from './fake-endpoint/server.mjs';

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
    const r = replies[stage];
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
  const labels = ['读题与判定', '解题', '答案抽取', '分步解析', '动画代码'];
  const label = labels.find((l) => sys.includes(`【本阶段指令：${l}】`)) ?? labels.find((l) => sys.includes(`【世界书·解题：${l}】`));
  if (label === '读题与判定') return 'read_problem';
  if (label === '解题') return 'solve';
  if (label === '答案抽取') return 'answers';
  if (label === '分步解析') return 'steps';
  if (label === '动画代码') return 'scene_code';
  return 'unknown';
}

let cancelledOnce = false;

/** 一份合法的 8 槽位模型输出 */
function goodSceneCode() {
  const body = {
    PROBLEM: '题干。',
    STEPS: 'title: 一步\ntex: x\nt0: 0\nt1: 1',
    ANSWERS: 'symbol: a\nvalue: 1\nunit: m\ntol: 0.01\nat_t: 1\nstep: 1',
    VIEW: 'SIM.duration = 1;',
    setup: 'const g = 10;',
    stateAt: 'return { x: t };',
    drawFrame: 'Draw.dot(0, 0);',
    readouts: 'return [{ label: "x", value: t, unit: "m" }];',
  };
  return SLOT_KEY_NAMES.map((k) => `/* @slot:${k} */\n${body[k]}\n/* @end */`).join('\n');
}

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
  config: { endpoint: endpoint(), apiKey: 'sk-test', regexRules: [] },
  ...over,
});

/* ────────────────────────────── 『A』事件序列 ────────────────────────────── */

console.log('编排取证（第 3 期第 5 步）\n');

console.log('『A』事件序列与阶段链');
{
  // ⚠ scene_code 阶段必须给出**合法的 8 槽位输出**，否则 Dry-Run 会（正确地）判 fail，
  //   本组想验的是"链路结构"，所以这里给合法输出。
  const stream = fakeStream({ scene_code: goodSceneCode() });
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
    '阶段链顺序正确（read_problem→solve→answers→steps→scene_code→dry_run）',
    started.join(',') === [...MODEL_STAGES, 'dry_run'].join(','),
    started.join(','),
  );
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
  check('模型被调用 5 次（纯文字题也跑第 0 步 read_problem；dry_run 不是模型调用）', stream.calls.length === 5, `实际 ${stream.calls.length}`);
}

console.log('\n『A-3』第 5.7 期：读题与判定（read_problem）—— 总是跑 / 判定注入世界书 / 视觉门控');
{
  /** 一条"只在图片题里才该命中"的词条（自带夹具，不依赖世界书的真实内容） */
  const wbEntries = [
    {
      id: 'wb_test_conveyor',
      title: '传送带（测试夹具）',
      origin: 'user',
      category: 'solution_skill',
      enabled: true,
      constant: false,
      recursive: false,
      keys: ['传送带'],
      secondary_keys: { logic: 'AND_ANY', list: ['物块'] },
      insertion_slot: ['solve'],
      order: 100,
      priority: 'normal',
      content: '传送带规范正文',
      code_examples: ['/* x */'],
    },
  ];
  const img = { mime: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) };
  const withWb = (over) =>
    baseInput({
      config: { endpoint: endpoint(), apiKey: 'sk-test', regexRules: [], knowledgecardEntries: wbEntries },
      ...over,
    });

  /* ① 纯文字题：**不再跳过**（这是第 5.7 期的口径变更），而且模型真的判了东西 */
  {
    const stream = fakeStream({
      scene_code: goodSceneCode(),
      read_problem: '【题面复述】物块在水平面上匀加速。\n【考点】uniform_acceleration\n【题型】速度公式与位移公式\n【动画元件】block\n【判定依据】题干给了加速度与时间求位移。',
    });
    const events = await collectEvents(baseInput({ streamImpl: stream, dryRunImpl: fakeDryRun('pass') }));
    const rpDone = events.find((e) => e.type === 'stage_done' && e.stage === 'read_problem');
    check('纯文字题：read_problem **真的跑了**（有 stage_start 与正文）', events.some((e) => e.type === 'stage_start' && e.stage === 'read_problem') && !rpDone?.skipped);
    check('纯文字题：read_problem 的正文非空（转写 + 判定都产出了）', (rpDone?.chars ?? 0) > 0, String(rpDone?.chars));
    check('纯文字题：模型调用 5 次（第 0 步不再被跳过）', stream.calls.length === 5, String(stream.calls.length));

    const jd = events.find((e) => e.type === 'judgement_done');
    check('★ 判定留痕：发出 judgement_done 事件（计划 §5 S4 第 4 项）', Boolean(jd));
    check('★ 判定留痕：考点被解析成表内 id（不是模型写的原文）', jd?.concepts?.join(',') === 'uniform_acceleration', JSON.stringify(jd?.concepts));
    check('★ 判定留痕：题型标签已退役 ⇒ 解析结果为空数组（不再产出第三方题型名）', Array.isArray(jd?.tags) && jd.tags.length === 0, JSON.stringify(jd?.tags));
    check('★ 判定留痕：动画元件被解析出来', jd?.elements?.join(',') === 'block', JSON.stringify(jd?.elements));
    check('★ 判定留痕：带上【判定依据】（可复核）', String(jd?.why ?? '').includes('加速度'));
    check('★ 判定留痕：判定非空（empty=false）', jd?.empty === false);
  }

  /* ①′ 反例：判定为空 / 表外词 ⇒ 照样留痕，且不抛异常 */
  {
    const stream = fakeStream({
      scene_code: goodSceneCode(),
      read_problem: '【考点】量子纠缠\n【题型】不存在的题型\n【动画元件】航天飞机\n【判定依据】瞎判',
    });
    const events = await collectEvents(baseInput({ streamImpl: stream, dryRunImpl: fakeDryRun('pass') }));
    const jd = events.find((e) => e.type === 'judgement_done');
    check('反例：三个字段全是表外词 ⇒ 判定为空但**事件照样发**', jd?.empty === true && jd.concepts.length === 0 && jd.elements.length === 0);
    check(
      '反例：表外词被**如实报出**（不许静默丢弃）',
      JSON.stringify(jd?.unknowns ?? {}).includes('量子纠缠') && JSON.stringify(jd?.unknowns ?? {}).includes('航天飞机'),
      JSON.stringify(jd?.unknowns),
    );
    check('反例：结构问题被报出（unknown-concept / unknown-element）', (jd?.problems ?? []).some((p) => p.code === 'unknown-concept') && (jd?.problems ?? []).some((p) => p.code === 'unknown-element'));
    check('反例：整条链**没被打崩**（仍然 run_done=pass）', events.at(-1)?.verdict === 'pass');
  }

  /* ①″ 负对照：判定为空时，触发**退化为纯字面 keys**（灰度期口径），不报错 */
  {
    const stream = fakeStream({ scene_code: goodSceneCode(), read_problem: '【判定依据】什么都没判出来' });
    const events = await collectEvents(withWb({ streamImpl: stream, dryRunImpl: fakeDryRun('pass') }));
    const jd = events.find((e) => e.type === 'judgement_done');
    check('负对照：一个字段都没判 ⇒ empty=true 且 problems 里有 missing-section', jd?.empty === true && (jd?.problems ?? []).some((p) => p.code === 'missing-section'));
    check('负对照：仍然跑完全程（退化不等于失败）', events.at(-1)?.verdict === 'pass');
  }

  /* ② 图片题：真的跑，而且**转写文字进入世界书的扫描文本**（第 0 步的意义就在这里） */
  {
    // 反例：转写里**没有**"传送带" ⇒ 该词条不该命中
    const streamNo = fakeStream({ scene_code: goodSceneCode(), read_problem: '【物体与姿态】水平面；【物体】物块。' });
    const evNo = await collectEvents(withWb({ images: [img], streamImpl: streamNo, dryRunImpl: fakeDryRun('pass') }));
    const wbNo = evNo.find((e) => e.type === 'knowledgecard_done');
    check('反例：转写里没有"传送带"⇒ 该词条不命中', !(wbNo?.entries ?? []).some((p) => p.entry_id === 'wb_test_conveyor'));

    // 正例：转写里有"传送带"与"物块" ⇒ 命中（题面本身没有"传送带"三个字）
    const transcript = '【题面复述】水平传送带以速率 u 运行。【物体与姿态】水平传送带；物块轻放其上。';
    const streamYes = fakeStream({ scene_code: goodSceneCode(), read_problem: transcript });
    const evYes = await collectEvents(withWb({ images: [img], streamImpl: streamYes, dryRunImpl: fakeDryRun('pass') }));
    const wbYes = evYes.find((e) => e.type === 'knowledgecard_done');
    check(
      '正例：**图片题的图只以转写文字的形式存在**，转写里出现"传送带"⇒ 该词条命中',
      (wbYes?.entries ?? []).some((p) => p.entry_id === 'wb_test_conveyor'),
      JSON.stringify((wbYes?.entries ?? []).map((p) => p.entry_id)),
    );
    check('读题与判定真的跑了（有 stage_start 与正文）', evYes.some((e) => e.type === 'stage_start' && e.stage === 'read_problem'));
    check('图片题里模型被调用 5 次（读题判定 + 解题 + 抽答案 + 分步 + 动画）', streamYes.calls.length === 5, String(streamYes.calls.length));
    const rpCall = streamYes.calls.find((c) => detectStage(c.messages) === 'read_problem');
    check('读题阶段的请求里**确实带了图片**', Boolean(rpCall) && Array.isArray(rpCall.messages.find((m) => m.role === 'user')?.content));
    check('读题阶段要求"沿用原词"（否则后面的检索会找不到规范）', String(rpCall?.messages?.[0]?.content ?? '').includes('沿用题面与图片里的原词'));
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
      if (e.type === 'stage_done' && e.stage === 'steps') ac.abort(); // 第 3 阶段（第 9 期调序后 steps 在第 3）结束后取消
    }
    check('取消后不再调用模型（中止在 steps = 第 3 次之后，于是 < 4 次）', stream.calls.length < 4, `实际 ${stream.calls.length}`);
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

  // D-2：切分失败 → dryrun_done 直接判 fail（不拿半成品去跑 Dry-Run）
  {
    const stream = fakeStream({ scene_code: '这不是槽位代码，只是普通文字。' });
    const dry = fakeDryRun('pass');
    const events = await collectEvents(baseInput({ streamImpl: stream, dryRunImpl: dry }));
    const dd = events.find((e) => e.type === 'dryrun_done');
    check('切分失败时给出 dryrun_done', Boolean(dd));
    check('判定为 fail', dd?.verdict === 'fail');
    check('C1 被判失败并带诊断', dd?.checks?.[0]?.id === 'C1' && dd.checks[0].diagnostics.length > 0);
    check('切分失败时不调用 Dry-Run', dry.calls.length === 0);
    check('run_done 判定为 fail', events.at(-1).verdict === 'fail');
  }

  // D-3：Dry-Run 判定 fail → 如实透传
  //
  // ⚠ 这里刻意 `disableRepair: true`：本组验的是"**不静默**"这条口径（fail 必须原样透传），
  //   而第 4 期起 fail 会自动进自愈循环，透传路径会被再跑一遍 Dry-Run 覆盖掉。
  //   自愈本身的行为由 `tests/repair-selftest.mjs` 逐条取证（B1–B6），不在这里重复。
  {
    const stream = fakeStream({ scene_code: goodSceneCode() });
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
    const stream = fakeStream({ scene_code: goodSceneCode() });
    const dry = fakeDryRun('pass-with-warnings');
    const events = await collectEvents(baseInput({ streamImpl: stream, dryRunImpl: dry, disableRepair: true }));
    check('pass-with-warnings 被如实透传', events.at(-1).verdict === 'pass-with-warnings');
  }
}

/* ────────────────────────────── 『E』端到端（真题 q01） ────────────────────────────── */

console.log('\n『E』端到端：用**真题 q01** 的槽位当模型输出，跑完整链路');
{
  const q01 = (await import('./regression-15/q01-conveyor-heat.mjs')).default;
  const sceneCodeText = SLOT_KEY_NAMES.map((k) => `/* @slot:${k} */\n${q01.slots[k]}\n/* @end */`).join('\n');

  const stream = fakeStream({
    solve: '物块先加速后匀速……',
    answers: q01.slots.ANSWERS,
    steps: q01.slots.STEPS,
    scene_code: sceneCodeText,
  });

  // 这一条**用真的 dryRun**（不注入假实现），让第 2 期的校验内核真的跑一次
  const events = await collectEvents(baseInput({ streamImpl: stream }));

  const dd = events.find((e) => e.type === 'dryrun_done');
  const last = events.at(-1);
  check('端到端跑完（有 dryrun_done）', Boolean(dd));
  check('判定为 pass（真题 q01 是通过 C1–C9 的）', dd?.verdict === 'pass', `实际 ${dd?.verdict}；checks=${JSON.stringify(dd?.checks?.filter((c) => c.status !== 'pass'))}`);
  check('Dry-Run 真的执行了（termination=completed）', dd?.termination === 'completed', String(dd?.termination));
  check('Dry-Run 产出了帧数', (dd?.frameCount ?? 0) > 0, String(dd?.frameCount));
  check('run_done 判定 pass', last.verdict === 'pass');
  check('给出了可装配的程序载荷', Boolean(dd?.program?.slots) && Object.keys(dd.program.slots).length === 8);
  check('载荷带 mode（第 8 期起恒为 BOTH：数值/符号按条目走）', dd.program.mode === 'BOTH', String(dd.program.mode));
  check('给出了行偏移表（诊断用）', typeof dd?.lineMap?.stateAt === 'number', JSON.stringify(dd?.lineMap));

  // 端到端还要确认"模型收到的题面是真的题目"
  const solveCall = stream.calls.find((c) => detectStage(c.messages) === 'solve');
  const userMsg = solveCall.messages.find((m) => m.role === 'user');
  check('任务段包含题面', String(userMsg.content).includes('传送带') || String(userMsg.content).includes('物块'));
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

console.log('\n『E-3』图片只进 read_problem 与 solve 两个阶段，且不改 promptHash');
{
  const stream = fakeStream({});
  const img = { mime: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) };
  const events = await collectEvents(baseInput({ problem: { text: '看图解题' }, images: [img], streamImpl: stream, dryRunImpl: fakeDryRun() }));

  const withImage = stream.calls.filter((c) => {
    const u = c.messages.find((m) => m.role === 'user');
    return Array.isArray(u.content) && u.content.some((p) => p.type === 'image_url');
  });
  // ⚠ v1.1.16：带图的阶段从 2 个变成 3 个 —— `scene_code` 也要图了（拆出来的示意图，
  //   裁不了时退回整幅原题图）。理由：写动画时看不到图，是"滑轮摆歪/绳不平行"的直接原因。
  check('带图的阶段是 read_problem / solve / scene_code', withImage.length === 3, `实际 ${withImage.length} 个阶段带图`);
  check(
    '带图的阶段恰好是 read_problem、solve、scene_code',
    withImage.map((c) => detectStage(c.messages)).sort().join(',') === 'read_problem,scene_code,solve',
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
  const transcript = '【题面复述】\n水平传送带以恒定速率 u 运行，物块轻放其上。\n【物体与姿态】水平传送带；物块。';

  const streamImg = fakeStream({ scene_code: goodSceneCode(), read_problem: transcript });
  const evImg = await collectEvents(
    baseInput({ problem: { text: '' }, images: [img], streamImpl: streamImg, dryRunImpl: fakeDryRun('pass') }),
  );
  const start = evImg.find((e) => e.type === 'run_start');
  const relabel = evImg.find((e) => e.type === 'run_label');
  check('纯图片题：开跑时标题是"(未命名题目)"（题面为空）', start.entry === '(未命名题目)', String(start.entry));
  check('纯图片题：读题与判定跑完后发 run_label 回填标题', Boolean(relabel));
  check('回填的标题取自转写的第一句内容（不是小标题）', relabel?.entry === '水平传送带以恒定速率 u 运行，物块轻放其上。', String(relabel?.entry));
  check('run_label 标出来源，便于排查', relabel?.source === 'read_problem');
  check('run_label 在 read_problem 之后（不是开跑前乱改标题）', evImg.indexOf(relabel) > evImg.findIndex((e) => e.type === 'stage_done' && e.stage === 'read_problem'));

  const streamTxt = fakeStream({ scene_code: goodSceneCode() });
  const evTxt = await collectEvents(baseInput({ streamImpl: streamTxt, dryRunImpl: fakeDryRun('pass') }));
  check('负对照：纯文字题**不**发 run_label（用户打了题面就用他的话）', !evTxt.some((e) => e.type === 'run_label'));
  check('负对照：纯文字题的标题就是题面开头', String(evTxt.find((e) => e.type === 'run_start')?.entry).startsWith('一物块从斜面顶端滑下'));
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
  check('停止时不产生 stage_done(answers/steps/scene_code)', !events.some((e) => e.type === 'stage_done' && ['answers', 'steps', 'scene_code'].includes(e.stage)));
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
    steps: 'title: 第 1 步\ntex: x\nt0: 0\nt1: 1',
    answers: 'symbol: x\nvalue: 1\nunit: m\nat_t: 1\nstep: 1',
    scene_code: goodSceneCode(),
  });
  const events = await collectEvents(
    baseInput({ images: [{ mime: 'image/png', data: png, name: 'problem.png' }], streamImpl: stream, dryRunImpl: fakeDryRun('pass') }),
  );

  const dd = events.find((e) => e.type === 'diagram_done');
  check('出了 diagram_done 事件', Boolean(dd), JSON.stringify(dd));
  check('★ 按框裁出了 20×20（原图 40×40 的中间一半）', dd?.ok === true && dd?.width === 20 && dd?.height === 20, JSON.stringify(dd));

  const sceneCall = stream.calls.find((c) => detectStage(c.messages) === 'scene_code');
  const sceneUser = sceneCall?.messages?.find((m) => m.role === 'user');
  check('★ 写动画那一步的请求**带了图**', Array.isArray(sceneUser?.content), typeof sceneUser?.content);
  check(
    '写动画那一步的 user 文本里含**读题的几何转写**（之前它只用来触发知识卡）',
    JSON.stringify(sceneUser?.content ?? '').includes('水平传送带上的物块 A'),
  );
  check(
    '写动画那一步的 user 文本里说明了"附了示意图"',
    JSON.stringify(sceneUser?.content ?? '').includes('【示意图】'),
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
    const slots = { ...base, stateAt: 'return { x: context.k };' };
    const { report } = await dryRun({ slots, entry: 'wiring-missing-context' });
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

/* ────────────────────────────── 汇总 ────────────────────────────── */

console.log(`\n${failures.length ? '✗' : '✓'} 编排取证：通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
  process.exitCode = 1;
}
