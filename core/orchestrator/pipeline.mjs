/**
 * 编排：把网关、Prompt、清洗切分、Dry-Run、自愈修复串成一条链路（§2.3 / M3 / M30）。
 *
 * ── 阶段链（第 4 期）
 *
 *   solve ─▶ answers ─▶ steps ─▶ scene_code ─▶ dry_run ─▶ [repair × ≤3]
 *                                                             │
 *                                       未通过校验才进；每轮跑完 C1–C9，pass 即停
 *
 * ── 四条必须做到的事
 *
 * ① **每题一份配置快照**：题目开始时把 Prompt 集合 / 端点 / 清洗规则快照下来，
 *    运行中改配置**不影响在跑的题**（第 6 期"下一题生效"语义的地基）。
 * ② **随时取消、取消后无残留**（§21.1 第 3 条）：取消会 abort 进行中的模型请求
 *    **并且**终止 Dry-Run 的 Worker；**修复途中取消同样适用**。
 * ③ **不静默交付**（§21.2 第 8 条）：门禁未通过必须如实带 `fail` 判定出来，
 *    绝不把失败包装成成功；修复 3 轮仍不过 ⇒ **带告警横幅交付**（B4）。
 * ④ **槽位级重生成**（§8.1 / B3）：修复只重发出错的槽位，**未涉及的槽位逐字节不变**。
 *
 * ── 设计选择：事件流而不是返回值
 *
 * `runPipeline()` 返回一个 **async generator**。理由：
 *   · 验收要求是"**流式**出解题过程"——返回值形态天然做不到逐字上屏；
 *   · 取消语义变简单：generator 的 `return()` 就是"停止拉取"，配合 AbortController 收尾；
 *   · 消费端既能做 SSE 直推（`for await`），也能在测试里收集成数组。
 */

import {
  streamChatCompletion,
  ModelError,
  classifyFetchError,
  describeModelError,
  redactText,
  buildUserMessage,
} from '../gateway/index.mjs';
import { getPrompt, assemblePrompt, buildJudgementVocab } from '../prompts/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knowledgecardHashOf } from '../knowledgecard/hash.mjs';
import { triggerKnowledgecardV2, knowledgecardV2Evidence } from '../knowledgecard/v2/runtime.mjs';
import { parseJudgement, buildVocabIndex, summarizeUnknowns } from '../knowledgecard/concepts.mjs';
import { buildJudgementVocabV2, parseJudgementV2 } from '../knowledgecard/v2/prompt.mjs';
import { KNOWLEDGECARD_CONCEPTS, SLOT_KEY_NAMES } from '../../contracts/spec/frozen-keys.mjs';
import { parseAnswersSlot, parseStepsSlot } from '../../sdk/runtime/animation-runtime.mjs';
import { parseAnalysisTable, formatAnalysis, generateProgramSlots, stateKeyMap, buildStepsText, parseBreakdownSteps, physicalTableFromEntries } from '../analysis/index.mjs';
import { parseStepTimes, fallbackStepTimes } from '../couple/index.mjs';
import { buildDisplayTiming } from '../timing/display-time.mjs';
import { buildProgramFromText, mergeRepairOutput, ProgramBuildError, formatSplitDiagnostics } from '../cleaner/index.mjs';
import { dryRun } from '../dryrun/dry-run.mjs';
import {
  planRepair,
  buildRepairTask,
  buildBanner,
  deliveryShape,
  shouldContinue,
  involvesCodeSlots,
  planC7Alias,
  REPAIR_MAX_ROUNDS,
  CODE_SLOTS,
  classifyRepair,
  orderSlots,
  repairModeOf,
} from '../repair/index.mjs';
import { PHASE5_STAGES, PROMPT_STAGES, makeEvent } from './events.mjs';
import { parseDiagramBox, cropPngNormalized } from '../images/png-crop.mjs';

/**
 * 每题一份的**配置快照**（§2.3）。
 *
 * 快照在 `runPipeline()` 一开始就冻结，之后无论外部怎么改配置都不影响本次运行。
 * 用 `Object.freeze` 是刻意的：让"运行中改配置"在**开发期就直接报错**，
 * 而不是变成一类难查的偶发问题。
 */
export function snapshotConfig(config) {
  // ⚠ 第 8 期：`mode` 不再从 config 取（数值/符号按条目走，见下面快照里的注释）
  // `devMode` = 用户的「开发模式（不拦截）」，也进快照（跑一半改它不该影响这一题）
  const { prompts, endpoint, apiKey, regexRules, wallClockMs, stagedOverrides, maxRepairRounds, knowledgecardEntries, knowledgecardBudget, knowledgecardVersion, knowledgecardVocab, rulesSnapshot, devMode } = config;

  /**
   * 世界书集合进快照（第 5 期 · 16.4 第 2 条）。
   *
   * 为什么要**深拷贝 + 冻结**：§16 的热重载语义是"**下一题生效，正在跑的题保持原快照**"。
   * 若只存引用，调用方在解题途中改了词条（或那条 `keys` 数组），这一题的结果就会变 ——
   * 而 `provenance.knowledgecardHash` 已经烧进了这一题的产物 ⇒ 哈希与实际注入对不上。
   * 第 3 期的 『B』用例正是为了钉住这条语义，这里把世界书也纳进来。
   */
  const cloneEntry = (e) =>
    Object.freeze({
      ...e,
      keys: Object.freeze([...(e?.keys ?? [])]),
      insertion_slot: Object.freeze([...(e?.insertion_slot ?? [])]),
      code_examples: Object.freeze([...(e?.code_examples ?? [])]),
      ...(e?.secondary_keys
        ? { secondary_keys: Object.freeze({ logic: e.secondary_keys.logic, list: Object.freeze([...(e.secondary_keys.list ?? [])]) }) }
        : {}),
    });
  const knowledgecardList = Array.isArray(knowledgecardEntries) ? knowledgecardEntries.map(cloneEntry) : [];

  /**
   * 第 6 期第 2 项：**规则快照里的 Prompt 覆盖**也进本题快照。
   *
   * §16 的热重载语义"下一题生效、正在跑的题保持原快照"靠的就是这里：
   * 题目一开始就把覆盖正文**拷进快照**，之后用户在编辑器里怎么改都不影响这一题。
   * 若只存引用，跑到第 3 步时用户保存了新正文，这一题的 promptHash 与实际发出的指令就对不上了
   * ——与世界书快照（见上）同一条理由。
   *
   * 不传 ⇒ `promptTexts: null` ⇒ `getPrompt(id, rules)` 原样返回内置对象（第 6 期之前的行为）。
   */
  const rulesIn = rulesSnapshot ?? null;
  const promptTextsIn = rulesIn?.promptTexts && typeof rulesIn.promptTexts === 'object' ? rulesIn.promptTexts : null;
  /**
   * 第 6 期第 3 项：清洗规则也来自**同一份规则快照**。
   *
   * 优先级：`rulesSnapshot.cleaningRules` > `config.regexRules` > `[]`。
   * 为什么不直接用 `config.regexRules`：热重载语义要求"下一题生效、跑着的题保持原快照"，
   * 而 `config.regexRules` 是调用方手里随时可改的数组。快照里有就用快照里的。
   *
   * ⚠ 锁定内置集**不在这里合并**：它由 `applyRegexRules` 从 `policy.mjs` 取，永远先跑、不可关。
   *   把两件事混在一起，就会出现"某个调用方忘了合并 ⇒ 内置规则没跑"的静默降级。
   */
  const rulesCleaning = Array.isArray(rulesIn?.cleaningRules) ? rulesIn.cleaningRules : null;

  return Object.freeze({
    // Prompt 集合：只快照 id 列表与版本信息，正文从模块读（正文是代码，不是运行时数据）
    // ⚠ 第 5.7 期起默认链条含 `read_problem`（第 0 步，读题与判定）；**所有题都跑它**（含纯文字题，见 runPipeline）
    promptIds: Object.freeze([...(config.promptIds ?? PROMPT_STAGES)]),
    endpoint: Object.freeze({ ...endpoint }),
    apiKey: apiKey ?? null,
    regexRules: Object.freeze([...(rulesCleaning ?? regexRules ?? [])]),
    /**
     * 第 8 期：**数值/符号不再是全局开关**（用户 2026-10-18 裁决「合并」）。
     * 判据（C7）本来就按条目走：`value` 是数字就数值比对、是 `null` 就要 `latex`。
     * 这里恒写 'BOTH'，只为让报告/历史/导出的既有形状不漂（不再接受调用方覆盖）。
     */
    mode: 'BOTH',
    wallClockMs: wallClockMs ?? null,
    stagedOverrides: Object.freeze({ ...(stagedOverrides ?? {}) }),
    // 第 4 期：修复轮数上限。**属于"每题配置快照"的一部分**——
    // 跑到一半改上限不该影响这一题（与 §16 的热重载语义一致）。
    maxRepairRounds: Number.isFinite(maxRepairRounds) ? maxRepairRounds : REPAIR_MAX_ROUNDS,
    /**
     * ── 第 8 期：**开发模式（不拦截）**（用户 2026-10-18 裁决）──
     *
     * 用户的判断：模型产出的代码已经足够好，而 C1–C9 里确实存在会冤枉人的判据
     * （这一轮实测抓到 C1 的 isFinite、C4 的标注位移、C6 的速度跳变三处误报）。
     * 硬拦一个错判据，比放过一个瑕疵更伤：连画面都看不到。
     *
     * 开关打开后：校验照做、报告照写，每条检查的 status/blocking/诊断全都不变，
     * 但**不触发自愈、不阻止交付**（verdict 降为 pass-with-warnings），
     * 并且 `gatesBypassed` 会烧进导出产物与历史记录 —— 永远能查出"这条没验过"。
     */
    advisory: devMode === true,
    /**
     * 第 5 期：世界书快照。
     *
     * ⚠ `source: 'empty'` 与"命中了 0 条"是两件不同的事：前者是调用方**根本没提供**词条集合
     *   （第 5 期之前的行为），后者是提供了但本题一条都没命中。二者在 UI 上必须可区分，
     *   否则"世界书没接上"会被显示成"这道题没有可用规范"。
     */
    knowledgecard: Object.freeze({
      entries: Object.freeze(knowledgecardList),
      hash: knowledgecardHashOf(knowledgecardList),
      budget: knowledgecardBudget ? Object.freeze({ ...knowledgecardBudget }) : null,
      source: Array.isArray(knowledgecardEntries) ? 'provided' : 'empty',
      /**
       * v1.1.18：v1 读题/知识卡已退役，生产链路**恒为 2**。
       * 旧配置里的 `knowledgecardVersion: 1` 不再能改变读题口径。
       */
      version: 2,
      /** Phase 3：v2 合并词表（内置 + 用户） */
      vocab: knowledgecardVocab ? Object.freeze(structuredClone(knowledgecardVocab)) : null,
    }),
    snapshotAt: new Date().toISOString(),
    // 记下调用方传进来的 prompts 字段（第 6 期可编辑 Prompt 时会用到），本期恒为 undefined
    prompts: prompts ?? null,
    /**
     * 第 6 期第 2 项：本題使用的**规则快照**（只留溯源需要的两样）。
     * `revision` 是 `.workspace.json` 的版本号，`promptTexts` 是覆盖正文（没有覆盖时为 null）。
     */
    rules: Object.freeze({
      revision: Number.isInteger(rulesIn?.revision) ? rulesIn.revision : null,
      promptTexts: promptTextsIn ? Object.freeze({ ...promptTextsIn }) : null,
    }),
  });
}

/**
 * 跑一次完整链路。
 *
 * @param {object} input
 * @param {{ text: string, description?: string, knownConditions?: string }} input.problem 题面（+可选描述）
 * @param {Array<{mime:string, data:Buffer, name?:string}>} [input.images] 题目图片（§11.3 门控在调用前判定）
 * @param {object} input.config 端点等配置（会被 `snapshotConfig` 冻结）
 * @param {object[]} [input.config.knowledgecardEntries] 世界书词条集合（第 5 期）。
 *   由调用方用 `loadKnowledgecardOrThrow()` 从 `core/knowledgecard/data` + `ai-rules/knowledgecard/` 载入后传入；
 *   **不传 = `source:'empty'`**（第 5 期之前的行为），与"提供了但 0 条命中"是两件不同的事。
 * @param {object} [input.config.knowledgecardBudget] 覆盖 §9.2 的三重预算（测试用微型预算；生产用默认值）
 * @param {AbortSignal} [input.signal] 外部取消
 * @param {Function} [input.dryRunImpl] 可注入（测试用假 Dry-Run 时传）
 * @param {Function} [input.streamImpl] 可注入（测试用假网关时传）
 * @param {Function} [input.mergeImpl] 可注入（测试用假合并时传；默认 `mergeRepairOutput`）
 * @param {boolean} [input.disableRepair] 关掉自愈（只在**诊断性测试**里用；生产路径恒为开启）
 * @yields {object} 事件（形状见 `events.mjs`）
 * @returns {Promise<void>} generator 结束时无返回值；结果通过事件给出
 */
/**
 * 调试出口：`DSH_DUMP_PROMPT=<stage>`（或 `all`）时，把这一阶段**真正发出去**的消息
 * 落到 `tests/reports/<stage>-prompt.txt`。
 *
 * 为什么需要它：调提示词时唯一可靠的依据是"模型看到的原文"——
 * 前缀、注入的卡片、user 里的本题数据，任何一处猜错都会得出错误结论。
 */
function dumpPrompt(stage, messages) {
  const want = process.env.DSH_DUMP_PROMPT;
  if (!want || (want !== 'all' && want !== stage)) return;
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const dir = join(root, 'tests', 'reports');
    mkdirSync(dir, { recursive: true });
    const blocks = messages.map((m, i) => {
      const body = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '', null, 2);
      return `======== #${i + 1} ${m?.role ?? '?'} · ${body.length} 字 ========\n${body}`;
    });
    writeFileSync(join(dir, `${stage}-prompt.txt`), blocks.join('\n\n'), 'utf8');
  } catch {
    /* 调试出口失败不影响主链路 */
  }
}

export async function* runPipeline(input) {
  const {
    problem,
    images = [],
    /**
     * v1.1.16：**老师提供的参考答案 / 解析**（可选）。
     *
     * 有它 ⇒ `solve` 阶段换一套指令：不自己重算，按解析整理过程与结论；
     * 没有 ⇒ 与上一版**逐字一致**（这是"不勾选 = 行为不变"的保证）。
     * 形状：`{ text?: string, images?: [{ mime, data, name }] }`（图片是已解码的 Buffer）
     */
    reference = null,
    /**
     * v1.1.18：手动打回时从哪一步开始。
     *   · `read_problem`（默认）：完整链路；
     *   · `solve`：沿用上一版 `baseReadProblem`，从解题重跑（跳过读题）。
     */
    startAt = 'read_problem',
    baseReadProblem = null,
    config,
    signal,
    dryRunImpl = dryRun,
    streamImpl = streamChatCompletion,
    mergeImpl = mergeRepairOutput,
    disableRepair = false,
  } = input;

  const snapshot = snapshotConfig(config);
  const started = Date.now();

  /**
   * B2：analysis 的 type 必须命中元件词表（决定 A：不允许 unknown / 自造名）。
   * 没接词表（少数离线测试）时不校验，避免把“没配置”误判成“模型写错”。
   */
  const allowedAnalysisTypes = () => {
    const els = snapshot.knowledgecard.vocab?.elements;
    if (!Array.isArray(els)) return null;
    return els
      .filter((e) => typeof e === 'string' || e?.enabled !== false)
      .map((e) => (typeof e === 'string' ? e : e?.id))
      .filter(Boolean);
  };
  const parseAnalysis = (text) => parseAnalysisTable(text, { allowedTypes: allowedAnalysisTypes() });

  /** C 方案：尺寸只来自卡的 physical（物理米）。本题快照派生一次，三处生成共用。 */
  let physicalTableCache = null;
  const physicalOfSnapshot = () => {
    if (!physicalTableCache) {
      physicalTableCache = physicalTableFromEntries(snapshot.knowledgecard.entries);
      if (physicalTableCache.problems.length) {
        throw new Error(`元件卡 physical 不可用（卡是唯一来源）：${physicalTableCache.problems.join('；')}`);
      }
    }
    return physicalTableCache.physical;
  };
  let seq = 0;
  const emit = (type, payload) => makeEvent(type, payload, (seq += 1));
  /**
   * 把某个桶里缓存的 `stage_error` 转发给前端，然后清空桶。
   *
   * 自愈的物理修复会静默调用 read_problem / solve / breakdown / analysis / scene_code；
   * 这些子阶段如果失败，错误事件以前只被 `silent.push()` 收着、从不发给前端，
   * 用户只能看到最后一条“run_done(error)”，不知道是哪一步、为什么。
   *
   * 只转发 `stage_error`：如果把 stage_start 也转发，前端会把“修复中的读题”
   * 误显示成当前阶段（小肥鱼会跳回“看题”）；错误才是必须可见的。
   */
  function* takeStageErrors(bucket) {
    const out = [];
    for (const ev of bucket) if (ev?.type === 'stage_error') out.push(ev);
    bucket.length = 0;
    for (const ev of out) yield ev;
  }

  // ⚠ 内部取消与外部取消合并：链路自己需要在中途停止时（例如某一阶段失败）
  //   也要能终止已经在跑的 Dry-Run Worker。
  const ac = new AbortController();
  const onExternalAbort = () => ac.abort();
  if (signal) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const cancelled = () => ac.signal.aborted;

  const entry = (problem?.text ?? '').slice(0, 40).replace(/\s+/g, ' ') || '未命名题目';
  /** @type {Record<string,string>} 阶段产物（后续阶段要引用前面的结果） */
  const outputs = {};

  /* ── 第 5 期：世界书（§9.2） ──
   *
   * 只有两个世界书槽位（= 阶段名，§9.1）：`solve` 与 `scene_code`。
   * 其余阶段（answers / steps / dry_run / repair）**不注入词条** ——
   * 它们在 §9.2 的分槽组装里没有任何候选集。
   */
  /* 知识卡：v6 只注入动画槽（scene_code）；solve 槽已从运行链路删除 */
  const STAGE_SLOT = { scene_code: 'scene_code' };
  /** @type {Record<string, object>} 阶段 → 该阶段的触发结果（逐阶段触发，理由见 knowledgecard/index.mjs） */
  const knowledgecardResults = {};
  const knowledgecardSegments = {};
  /** 组装过的 promptHash（固定前缀的属性；供 provenance 回填） */
  let promptHashSeen = null;
  /**
   * ⚠ 别用"第 0 个阶段"来报 promptHash（第 5 期踩过，第 5.7 期起第 0 步不再跳过）。
   *   第 0 步现在是 `read_problem`，**总是跑**；但这条口径仍然保留：
   *   "第一个真正组装了提示词的阶段报一次" —— 它对任何阶段链都成立，
   *   不会因为将来某步被跳过而失效。
   */
  let promptHashReported = false;

  /**
   * 第 5.7 期：**判定词表的单源真相**。
   *
   * 词表来自 `contracts/spec/frozen-keys.mjs`（它从 `contracts/knowledgecard-concepts.json` 派生，
   * 并有 `contracts/_compile.mjs` 的三条派生断言守着）—— 编排层**不持有第二份副本**。
   */
  const judgementVocab = buildJudgementVocab(KNOWLEDGECARD_CONCEPTS);
  const vocabIndex = buildVocabIndex(KNOWLEDGECARD_CONCEPTS);
  /**
   * 第 5.7 期：**本次的判定**（两侧分发的输入）。
   *
   * 初值是三个空数组 ⇒ 万一第 0 步没判出任何东西，
   * 触发会**退化为纯字面 keys**（灰度期口径），而不是报错。
   */
  let judgement = { concepts: [], tags: [], elements: [], scenes: [] };
  let judgementProblems = [];
  let judgementUnknowns = { concept: [], tag: [], element: [] };
  /**
   * v1.1.16：从原题图里裁出的**示意图**（`{ mime, data, name }`）。没有就是 null。
   * 只在 `scene_code` 这一步随消息附上，让写动画的模型能"看到图"。
   */
  let diagram = null;

  /**
   * ── 手动打回：从 solve 开始 ──
   *
   * 用户裁决：老师可以在动画页“手动打回 → 全链路从 solve 重跑”。
   * 读题结果 `baseReadProblem` 由上一版带上来；这里先把它放回 `outputs`，
   * 并重新解析判定（否则 scene_code 的知识卡会一条都不命中）。
   * 读题正文为空时退回完整链路，不拿空上下文去解题。
   */
  let resumeAt = startAt === 'solve' ? 'solve' : 'read_problem';
  if (resumeAt === 'solve') {
    const baseText = typeof baseReadProblem === 'string' ? baseReadProblem : '';
    if (!baseText.trim()) {
      resumeAt = 'read_problem';
    } else {
      outputs.read_problem = baseText;
      if (snapshot.knowledgecard.version === 2) {
        const parsed = parseJudgementV2(baseText, {
          vocab: snapshot.knowledgecard.vocab ?? { elements: [], scenes: [] },
        });
        judgement = { concepts: [], tags: [], elements: parsed.elements, scenes: parsed.scenes };
        judgementProblems = parsed.problems;
        judgementUnknowns = {
          concept: [],
          tag: [],
          element: parsed.unknowns.elements,
          scene: parsed.unknowns.scenes,
        };
      } else {
        const parsed = parseJudgement(baseText, { vocab: KNOWLEDGECARD_CONCEPTS, index: vocabIndex });
        judgement = { concepts: parsed.concepts, tags: parsed.tags, elements: parsed.elements, scenes: [] };
        judgementProblems = parsed.problems;
        judgementUnknowns = summarizeUnknowns(parsed);
      }
    }
  }

  const knowledgecardForStage = (stage) => {
    const slot = STAGE_SLOT[stage];
    if (!slot || snapshot.knowledgecard.entries.length === 0) return { slot: slot ?? 'scene_code', text: '', result: null };
    if (knowledgecardResults[stage]) return { slot, text: knowledgecardSegments[stage] ?? '', result: knowledgecardResults[stage] };

    /**
     * ── v6：生产链路只走 **v2 引擎**（v1.1.18 起 v1 已退役）──
     *
     * v2 卡没有 `keys / concepts / tags / insertion_slot`；触发只认：
     *   · `constant: true`；
     *   · `kind: 'element'` 且 `elements` 与读题判定相交；
     *   · `kind: 'scene'` 且 `scenes` 与读题判定相交。
     *
     * 不再扫题面字面量。这是刻意的：v2 卡的分发条件是"模型判出的元件/场景"，
     * 不是"题面里碰巧出现了某个词"。少扫一次文本，也不会把卡片抽错。
     */
    const result = triggerKnowledgecardV2({
      entries: snapshot.knowledgecard.entries,
      elements: judgement.elements,
      scenes: judgement.scenes,
      ...(snapshot.knowledgecard.budget ? { budget: snapshot.knowledgecard.budget } : {}),
    });

    knowledgecardResults[stage] = result;
    knowledgecardSegments[stage] = result.text[slot] ?? '';
    return { slot, text: knowledgecardSegments[stage], result };
  };

  yield emit('run_start', {
    entry,
    // 第 5.7 期起发**完整链条**（含 read_problem 与 repair）。前端不要写死任何一步是否一定执行（skipped 机制保留）。
    stages: [...PHASE5_STAGES],
    model: snapshot.endpoint?.defaultModel ?? null,
    mode: snapshot.mode,
    promptHash: null, // 组装后回填（见下）
    imageCount: images.length,
    maxRepairRounds: snapshot.maxRepairRounds,
  });

  try {
    /* ── 逐阶段：read_problem → solve → breakdown ∥ analysis → couple → scene_code（drawFrame）── */
    /** @type {ReturnType<typeof parseAnalysisTable>|null} */
    let analysisParsed = null;
    /**
     * `couple` 现在跑在 `scene_code` **之前**（2026-10-24 用户裁决）：
     * 画图要按"第几步、这一步对应哪段时间"来画，所以步骤表必须先定下来。
     * 这两个变量在 scene_code 之前赋值，后面的交付段只负责把它们挂到程序上。
     */
    let stepTimes = null;
    /** 时间表是否**通过校验**（兜底均分不算）—— 只有通过的才喂给 scene_code。 */
    let stepTimesValid = false;
    let coupling = null;
    /**
     * v1.1.18：补充描述可以**按阶段**注入。
     * `problem.stageNotes[stage]` 优先；没有该阶段的条目时退回旧的全局 `description`。
     * 旧字段继续保留，老调用方/旧页面不受影响。
     */
    const stageNoteFor = (stage) => {
      const notes = problem.stageNotes;
      if (notes && typeof notes === 'object') {
        const v = notes[stage];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return '';
    };
    const descriptionFor = (stage) => stageNoteFor(stage) || problem.description || '';
    const stageInputs = {
      // 第 0 步：题面文字 + 用户手打的描述/已知条件 + **判定词表**（图片由 `withImages` 附在消息里）
      read_problem: {
        problem: problem.text,
        ...(descriptionFor('read_problem') ? { description: descriptionFor('read_problem') } : {}),
        ...(problem.knownConditions ? { knownConditions: problem.knownConditions } : {}),
        vocab:
          snapshot.knowledgecard.version === 2 && snapshot.knowledgecard.vocab
            ? buildJudgementVocabV2(snapshot.knowledgecard.vocab)
            : judgementVocab,
      },
      solve: {
        problem: problem.text,
        /* v1.1.18：老师手打的补充描述/已知条件必须进解题；以前只进过读题 */
        ...(descriptionFor('solve') ? { description: descriptionFor('solve') } : {}),
        ...(problem.knownConditions ? { knownConditions: problem.knownConditions } : {}),
        ...(reference ? { reference } : {}),
      },
      breakdown: { problem: problem.text, solution: () => outputs.solve },
      /**
       * 新链路第 4 段：analysis 只吃题面、读题几何、solve（**不吃 breakdown**）。
       * 题图由 `withImages` 附在消息里（用户 2026-10-22 允许）。
       */
      analysis: {
        problem: problem.text,
        solution: () => outputs.solve,
        readProblem: () => outputs.read_problem,
        /* v1.1.18：补充描述/已知条件也进分析；参考答案文本是数值的最高权威 */
        ...(descriptionFor('analysis') ? { description: descriptionFor('analysis') } : {}),
        ...(problem.knownConditions ? { knownConditions: problem.knownConditions } : {}),
        ...(reference?.text ? { referenceText: reference.text } : {}),
        /* B2：只读 physical 表（物理米），让模型把质心放到支撑面上方。 */
        physicalTable: () => physicalOfSnapshot(),
      },
      /**
       * 新链路第 5 段：AI 只写 drawFrame。
       * 物理由 analysis 生成，drawFrame 只负责“怎么画”。
       *
       * 2026-10-24 方案二：state 只给物理 `x/y`；不再给 `cx/cy`、`anchor`、`t0States`。
       * 画多大、布景怎么摆由 `drawFrame` 自己定；步骤时间仍只喂**通过校验**的表。
       */
      scene_code: {
        problem: problem.text,
        analysisText: () => (analysisParsed ? formatAnalysis(analysisParsed) : ''),
        branchTimes: () =>
          analysisParsed?.elements
            ? [
                ...new Set(
                  analysisParsed.elements.flatMap((el) =>
                    el.segments.filter((s) => s.branch === true).map((s) => s.t0),
                  ),
                ),
              ]
                .filter((v) => Number.isFinite(v) && v >= 0)
                .sort((a, b) => a - b)
            : [],
        readProblem: () => outputs.read_problem,
        ...(descriptionFor('scene_code') ? { description: descriptionFor('scene_code') } : {}),
        ...(problem.knownConditions ? { knownConditions: problem.knownConditions } : {}),
        stateMap: () => (analysisParsed ? stateKeyMap(analysisParsed) : []),
        /* couple 的表：只有**通过校验**的表才喂给画图；兜底均分不进提示词。 */
        steps: () =>
          stepTimesValid && Array.isArray(stepTimes)
            ? parseStepsSlot(buildStepsText(outputs.breakdown ?? '', analysisParsed, analysisParsed?.tPhys)).map(
                (s, i) => ({ title: s.title, t0: stepTimes[i]?.t0, t1: stepTimes[i]?.t1 }),
              )
            : [],
      },
    };
    async function executeStage(stage, index, enqueue) {
      if (cancelled()) return { ok: false, cancelled: true };
      const promptId =
        stage === 'read_problem' && snapshot.knowledgecard.version === 2 ? 'read_problem_v2' : stage;
      const prompt = getPrompt(promptId, snapshot.rules);
      const rawInput = stageInputs[stage] ?? {};
      const resolved = {};
      for (const [k, v] of Object.entries(rawInput)) resolved[k] = typeof v === 'function' ? v() : v;

      const withImages =
        stage === 'solve'
          ? [...images, ...((reference?.images ?? []))]
          : stage === 'read_problem'
            ? images
            : stage === 'analysis'
              ? images
              : stage === 'scene_code'
                ? diagram
                  ? [diagram]
                  : []
                : [];

      const stageInstructions =
        stage === 'solve' && reference && prompt.origin !== 'user' && typeof prompt.systemWithReference === 'string'
          ? prompt.systemWithReference
          : prompt.system;

      if (stage === 'read_problem' && images.length > 0 && snapshot.endpoint?.supportsVision !== true) {
        enqueue(
          emit('stage_error', {
            stage,
            error: {
              kind: 'vision-unsupported',
              message: '当前模型不支持图片输入，无法执行读题与判定（§11.3：不做假多模态降级）',
              hint: '请更换支持视觉的模型，或改为文字输入／手打【配图补充描述】后重试',
            },
          }),
        );
        return { ok: false, fatal: true };
      }

      enqueue(emit('stage_start', { stage, index, total: PHASE5_STAGES.length }));
      const stageStarted = Date.now();
      let text = '';
      const chunks = [];
      try {
        const wb = knowledgecardForStage(stage);
        const assembled = assemblePrompt({
          problem: {
            text: prompt.buildUser(resolved),
            ...(resolved.problem && resolved.problem !== problem.text
              ? { knownConditions: `原题：${resolved.problem}` }
              : {}),
          },
          instructions: stageInstructions,
          instructionLabel: prompt.label,
          stageSlot: wb.slot,
          knowledgecardSegment: wb.text,
          /**
           * v6：前缀按 **promptId** 取，不是按阶段名。
           * `read_problem` 在 v2 配置下用的是 `read_problem_v2` —— 若这里传 `stage`，
           * 模型会收到 v1 角色（"转写成结构化文字"），与 v2 指令（"不要复述题文"）打架。
           * 其余阶段 promptId === stage，行为不变。
           */
          stage: promptId,
        });
        const userMessage = withImages.length
          ? buildUserMessage({ text: assembled.messages[1].content, images: withImages })
          : assembled.messages[1];
        const messages = [assembled.messages[0], userMessage];
        dumpPrompt(stage, messages);
        if (!promptHashReported) {
          promptHashReported = true;
          promptHashSeen = assembled.promptHash;
          enqueue(emit('stage_delta', { stage, text: '', note: 'promptHash', promptHash: assembled.promptHash }));
        }
        const result = await streamImpl({
          endpoint: snapshot.endpoint,
          apiKey: snapshot.apiKey,
          stage,
          messages,
          signal: ac.signal,
          vision: withImages.length > 0,
          onDelta: (d) => {
            if (typeof d === 'string' && d.length) chunks.push(d);
          },
        });
        text = result.text ?? (chunks.length ? chunks.join('') : '');
      } catch (err) {
        const modelErr =
          err instanceof ModelError
            ? err
            : (() => {
                const kind = classifyFetchError(err, { timedOut: false });
                return new ModelError({
                  kind,
                  message: describeModelError(kind, kind === 'cancelled' ? '' : String(err?.message ?? err)),
                  raw: redactText(String(err?.message ?? ''), []),
                });
              })();
        if (modelErr.kind === 'cancelled') return { ok: false, cancelled: true };
        enqueue(emit('stage_error', { stage, error: modelErr.toJSON() }));
        return { ok: false, error: modelErr };
      }

      outputs[stage] = text;
      for (const c of chunks) enqueue(emit('stage_delta', { stage, text: c }));
      if (chunks.length === 0 && text) enqueue(emit('stage_delta', { stage, text }));
      enqueue(emit('stage_done', { stage, chars: text.length, ms: Date.now() - stageStarted, chunks: chunks.length }));
      return { ok: true, text };
    }

    /** 并发跑 breakdown + analysis，边到边 yield。 */
    async function* runConcurrent(specs, results) {
      const queue = [];
      const waiters = [];
      let pending = specs.length;
      const wake = () => {
        while (waiters.length) waiters.shift()();
      };
      const push = (ev) => {
        queue.push(ev);
        wake();
      };
      const tasks = specs.map((spec, k) =>
        executeStage(spec.stage, spec.index, push)
          .then((r) => {
            results[k] = r;
            pending -= 1;
            wake();
          })
          .catch((err) => {
            results[k] = { ok: false, error: err };
            pending -= 1;
            wake();
          }),
      );
      while (pending > 0 || queue.length) {
        if (queue.length) {
          yield queue.shift();
          continue;
        }
        await new Promise((resolve) => waiters.push(resolve));
      }
      await Promise.all(tasks);
    }

    /**
     * ── couple：把讲解步骤挂到动画时间轴上（2026-10-24 起跑在 scene_code **之前**）──
     *
     * 为什么前置：画图的人得知道"这一步在讲什么、对应哪段时间"，否则只能在
     * drawFrame 里按 `t` 硬编码猜边界。它本来只吃 `analysis` + `breakdown`，
     * 这两样在 scene_code 之前就齐了 —— 挪过去**不增加任何一次模型调用**。
     *
     * 这也是"第一轮校验"：时间表本身（重叠 / 越界 [0, T_phys] / 步数）必须先过。
     * 过不了就重试一次；再不过就走均分兜底，但**兜底表不喂给 scene_code**
     * （否则模型会按假边界画），只用来让页面还有时间轴可点。
     */
    async function* runCoupleStage() {
      if (!analysisParsed?.ok) return;
      const coupleIndex = PHASE5_STAGES.indexOf('couple');
      yield emit('stage_start', { stage: 'couple', index: coupleIndex, total: PHASE5_STAGES.length });
      const coupleStarted = Date.now();
      const couplePrompt = getPrompt('couple', snapshot.rules);
      /*
       * 步骤从 breakdown **现算**（此刻还没有 `program`）：
       * 先用 `buildStepsText` 归一，再用 `parseStepsSlot` 取回，
       * 这样与最终 `STEPS` 槽位是同一份数据，不会出现"couple 按 A 编号、页面按 B 编号"。
       */
      const steps = parseStepsSlot(buildStepsText(outputs.breakdown ?? '', analysisParsed, analysisParsed.tPhys));
      const tPhys = analysisParsed.tPhys;
      const coupleBranchTimes = analysisParsed?.elements
        ? [
            ...new Set(
              analysisParsed.elements.flatMap((el) =>
                el.segments.filter((s) => s.branch === true).map((s) => s.t0),
              ),
            ),
          ]
            .filter((v) => Number.isFinite(v) && v >= 0)
            .sort((a, b) => a - b)
        : [];
      let feedback = [];
      let lastText = '';
      let parsedOk = false;
      let attempts = 0;
      let warning = null;
      let fallback = false;
      for (let attempt = 0; attempt < 2 && !parsedOk; attempt += 1) {
        attempts += 1;
        const assembled = assemblePrompt({
          problem: {
            text: couplePrompt.buildUser({
              problem: problem.text,
              analysisText: formatAnalysis(analysisParsed),
              readProblem: outputs.read_problem,
              branchTimes: coupleBranchTimes,
              steps,
              tPhys,
              feedback,
            }),
          },
          instructions: couplePrompt.system,
          instructionLabel: couplePrompt.label,
          stage: 'couple',
        });
        try {
          const result = await streamImpl({
            endpoint: snapshot.endpoint,
            apiKey: snapshot.apiKey,
            stage: 'couple',
            messages: assembled.messages,
            signal: ac.signal,
            vision: false,
            onDelta: () => {},
          });
          lastText = result.text ?? '';
        } catch (err) {
          if (err instanceof ModelError && err.kind === 'cancelled') {
            yield emit('cancelled', { stage: 'couple' });
            yield emit('run_done', { verdict: 'cancelled', ms: Date.now() - started, cancelled: true });
            return;
          }
          feedback = [String(err?.message ?? err)];
          warning = String(err?.message ?? err);
          continue;
        }
        const parsed = parseStepTimes(lastText, { stepCount: steps.length, tPhys });
        if (parsed.ok) {
          stepTimes = parsed.stepTimes;
          parsedOk = true;
          break;
        }
        feedback = parsed.problems;
        warning = parsed.problems.join('；');
      }
      stepTimesValid = parsedOk;
      if (!parsedOk) {
        stepTimes = fallbackStepTimes(steps.length, tPhys);
        fallback = true;
        warning = warning ? `${warning}；已按步骤均分回退` : '步骤时间解析失败；已按步骤均分回退';
      }
      /**
       * 时长归一化：每小问 4 秒。**在服务端算一次**，随事件一起下发给宿主。
       * 宿主/模板自己算会与导出页（build-template）产生第二套口径。
       */
      const displayTiming = buildDisplayTiming(stepTimes);
      if (lastText) yield emit('stage_delta', { stage: 'couple', text: lastText });
      yield emit('stage_done', {
        stage: 'couple',
        chars: lastText.length,
        ms: Date.now() - coupleStarted,
        attempts,
        fallback,
        warning,
        beforeDraw: true,
        valid: stepTimesValid,
      });
      coupling = {
        stepTimes,
        displayStepTimes: displayTiming.stepTimes,
        timeMap: displayTiming.timeMap,
        displayDuration: displayTiming.displayDuration,
        fallback,
        warning,
        attempts,
      };
      yield emit('coupling_done', {
        stepTimes,
        displayStepTimes: displayTiming.stepTimes,
        timeMap: displayTiming.timeMap,
        displayDuration: displayTiming.displayDuration,
        fallback,
        warning,
        attempts,
      });
    }

    let parallelDone = false;
    for (let i = 0; i < snapshot.promptIds.length; i += 1) {
      const stage = snapshot.promptIds[i];

      /* 手动打回：从 solve 重跑时，读题/判定沿用上一版，不重新调模型 */
      if (stage === 'read_problem' && resumeAt === 'solve') {
        yield emit('stage_done', {
          stage: 'read_problem',
          skipped: true,
          chars: String(outputs.read_problem ?? '').length,
          ms: 0,
          reason: '手动打回：沿用上一版读题与判定',
        });
        continue;
      }

      if (stage === 'breakdown' && !parallelDone) {
        const results = [];
        for await (const ev of runConcurrent(
          [
            { stage: 'breakdown', index: PHASE5_STAGES.indexOf('breakdown') },
            { stage: 'analysis', index: PHASE5_STAGES.indexOf('analysis') },
          ],
          results,
        )) {
          yield ev;
        }
        parallelDone = true;
        if (!results[0]?.ok || !results[1]?.ok) {
          yield emit('run_done', { verdict: 'error', ms: Date.now() - started, stage: 'breakdown/analysis' });
          return;
        }
        analysisParsed = parseAnalysis(outputs.analysis ?? '');
        if (!analysisParsed.ok) {
          yield emit('stage_error', {
            stage: 'analysis',
            error: {
              kind: 'analysis.invalid',
              message: `物理分析表解析失败：${analysisParsed.problems.map((p) => p.message).join('；')}`,
              hint: '按【元件运动表 (MOTIONS)】格式重写：element/segment/t0/t1/x0/y0/vx0/vy0/ax/ay/x/y。',
            },
          });
          yield emit('run_done', { verdict: 'error', ms: Date.now() - started, stage: 'analysis', analysisProblems: analysisParsed.problems });
          return;
        }
        /**
         * v1.1.19：**不再用题面关键词猜“条件变更”**。
         * 题面不一定写“再加 / 若…”，关键词硬拦会误伤；分支由 analysis 的
         * `branch: true` 显式表达，再由 Dry-Run C6（分支边界放行）和人工验收兜底。
         */
        /* 第一轮校验（在画图之前）：步骤时间表必须先成立。 */
        yield* runCoupleStage();
        continue;
      }
      if (stage === 'analysis' && parallelDone) continue;

      if (cancelled()) {
        yield emit('cancelled', { stage });
        yield emit('run_done', { verdict: 'cancelled', ms: Date.now() - started, cancelled: true });
        return;
      }

      const promptId =
        stage === 'read_problem' && snapshot.knowledgecard.version === 2
          ? 'read_problem_v2'
          : stage;
      const prompt = getPrompt(promptId, snapshot.rules);
      const rawInput = stageInputs[stage] ?? {};
      // 把"惰性取值"解开：这样阶段之间不必关心依赖顺序，缺依赖会在这里明确报错
      const resolved = {};
      for (const [k, v] of Object.entries(rawInput)) resolved[k] = typeof v === 'function' ? v() : v;

      // 图片只进 solve 阶段（后面几步都是纯文本推理；这也避免了把图片重复发多遍）
      // 图片进 `read_problem`（第 0 步：读题与判定）与 `solve`（解题复查）两个阶段。
      // 其余阶段都是纯文本推理 —— 这也避免了把同一张图重复发多遍。
      // v1.1.16：`solve` 额外带上**解析图片**（老师给的答案截图），只在这一步用。
      const withImages = stage === 'solve'
        ? [...images, ...((reference?.images ?? []))]
        : stage === 'read_problem'
          ? images
          : stage === 'analysis'
            ? images
            : stage === 'scene_code'
              ? (diagram ? [diagram] : [])
              : [];

      /**
       * v1.1.16：带参考解析时，`solve` 换成**另一套 system**（"按解析整理"），
       * 而不是只在 user 里补一句 —— 否则 system（"写出完整解题过程"）与 user 打架，
       * 模型会两边讨好。没有解析时仍用原来的 system，逐字不变。
       */
      const stageInstructions =
        stage === 'solve' && reference && prompt.origin !== 'user' && typeof prompt.systemWithReference === 'string'
          ? prompt.systemWithReference
          : prompt.system;

      /**
       * ── 第 0 步的前置判定（第 5 期引入；**第 5.7 期删掉了"纯文字题跳过"**）
       *
       * ⚠ **纯文字题不再跳过**（用户 2026-10 裁决，计划 §2 决定 1）：
       *   考点不可能写在题面里（"这题考动能定理"是读出来的，不是字面里有的），
       *   所以这一步必须由模型判，哪怕一图都没有。代价是纯文字题的模型调用 4 → 5 次（已知并接受）。
       *
       * ⚠ **视觉门控保留**（§11.3）：带图但当前端点 `supportsVision !== true` 时，
       *   **直接报错停下**，绝不把图片发给一个不看图的模型（那是"假多模态降级"）。
       *   纯文字题（`images.length === 0`）**不触发**这条门控 —— 它不需要视觉。
       */
      if (stage === 'read_problem' && images.length > 0 && snapshot.endpoint?.supportsVision !== true) {
        yield emit('stage_error', {
          stage,
          error: {
            kind: 'vision-unsupported',
            message: '当前模型不支持图片输入，无法执行读题与判定（§11.3：不做假多模态降级）',
            hint: '请更换支持视觉的模型，或改为文字输入／手打【配图补充描述】后重试',
          },
        });
        yield emit('run_done', { verdict: 'error', ms: Date.now() - started, stage });
        return;
      }

      yield emit('stage_start', { stage, index: PHASE5_STAGES.indexOf(stage), total: PHASE5_STAGES.length });

      const stageStarted = Date.now();
      let text = '';
      /** 逐块收集：网关每吐一块就推一个 `stage_delta`，这就是"流式出解题过程"的数据面 */
      const chunks = [];
      try {
        /**
         * ⚠ 提示词的分工必须守住 §10.2：
         *   · **固定前缀**（角色 + 模板骨架 + SDK 摘要）→ system 段，**逐字节不变**（prompt cache 靠它）；
         *   · **本阶段的指令**（`prompt.system`）→ 条件段里的 `【本阶段指令：…】` 块
         *     （第 5 期起它有了**自己的标签**：此前它与世界书词条共用同一个标记，
         *      导致溯源分不清"这条是词条还是阶段指令"）；
         *   · **命中的世界书词条**（§9.2）→ 条件段里的 `【世界书·…：<title>】` 块，
         *     文本由引擎渲染好（`knowledgecardSegment`），编排层**不再自己拼**；
         *   · **本阶段的输入**（题面 / 前序阶段产物）→ 任务段。
         *
         * 这里刻意**不新写一套组装逻辑**：复用 `assemblePrompt()`，
         * 这样"图片只进任务段""前缀不含题目"这两条不变式由同一个函数保证，
         * 不会出现"编排里另有一套组装、绕过了前缀约束"的漏洞。
         */
        const wb = knowledgecardForStage(stage);
        const assembled = assemblePrompt({
          problem: {
            text: prompt.buildUser(resolved),
            ...(resolved.problem && resolved.problem !== problem.text
              ? { knownConditions: `原题：${resolved.problem}` }
              : {}),
          },
          instructions: stageInstructions,
          instructionLabel: prompt.label,
          stageSlot: wb.slot,
          knowledgecardSegment: wb.text,
          // 第 9 期：前缀按阶段取 —— 只有写代码的阶段才带模板骨架与 SDK 摘要
          // v6：用 `promptId` 而不是 `stage`，让 v2 读题拿到自己的角色前缀
          stage: promptId,
        });

        // ⚠ **必须在这里把图片编码进 user 消息**。
        //   `assemblePrompt()` 只负责三段文本拼接与 imageCount 统计，
        //   它**不做**多模态编码 —— 第一版漏了这一步，图片被静默丢弃
        //   （而 promptHash 仍然正确，所以只有"图片真的送达了吗"这类用例能发现）。
        //   编码走网关的 `buildUserMessage()`，保证与假端点用例里用的是同一套编码。
        const userMessage = withImages.length
          ? buildUserMessage({ text: assembled.messages[1].content, images: withImages })
          : assembled.messages[1];
        const messages = [assembled.messages[0], userMessage];
        dumpPrompt(stage, messages);

        // 首次组装时把 promptHash 报给前端（它是固定前缀的属性，与阶段无关）
        if (!promptHashReported) {
          promptHashReported = true;
          promptHashSeen = assembled.promptHash;
          yield emit('stage_delta', { stage, text: '', note: 'promptHash', promptHash: assembled.promptHash });
        }

        const result = await streamImpl({
          endpoint: snapshot.endpoint,
          apiKey: snapshot.apiKey,
          /* 阶段名一路传到网关：思考模式按阶段开关（读图转写不思考，其余全开） */
          stage,
          messages,
          signal: ac.signal,
          vision: withImages.length > 0,
          onDelta: (d) => {
            if (typeof d === 'string' && d.length) chunks.push(d);
          },
        });
        // 网关返回的 `text` 是权威全文；若它为空而回调里有内容，用回调的拼接兜底
        text = result.text ?? (chunks.length ? chunks.join('') : '');
      } catch (err) {
        /**
         * ⚠ 这里**必须复用网关的错误分类**，不能把非 `ModelError` 一律当 `unknown`。
         *   原因：取消会让 `fetch` 抛 `AbortError`；若走 `unknown` 分支，
         *   一次正常的"用户取消"就会被报成 `stage_error` → UI 报红。
         *   这正是本步自检第一次跑就逮到的缺陷（见 README 12.16）。
         */
        const modelErr =
          err instanceof ModelError
            ? err
            : (() => {
                const kind = classifyFetchError(err, { timedOut: false });
                return new ModelError({
                  kind,
                  message: describeModelError(kind, kind === 'cancelled' ? '' : String(err?.message ?? err)),
                  raw: redactText(String(err?.message ?? ''), []),
                });
              })();
        // 取消导致的失败**不当错误报**（UI 不该为此报红）
        if (modelErr.kind === 'cancelled') {
          yield emit('cancelled', { stage });
          yield emit('run_done', { verdict: 'cancelled', ms: Date.now() - started, cancelled: true });
          return;
        }
        yield emit('stage_error', { stage, error: modelErr.toJSON() });
        yield emit('run_done', { verdict: 'error', ms: Date.now() - started, stage });
        return;
      }

      outputs[stage] = text;
      // 逐块推 stage_delta（真正流式：客户端能一边收一边渲染）
      for (const c of chunks) yield emit('stage_delta', { stage, text: c });
      // 若实现没有回调（例如某些注入的假实现），至少把全文推一次，保证消费端拿得到内容
      if (chunks.length === 0 && text) yield emit('stage_delta', { stage, text });
      yield emit('stage_done', {
        stage,
        chars: text.length,
        ms: Date.now() - stageStarted,
        chunks: chunks.length,
      });

      /**
       * ── 新链路：analysis 的产出必须能解析，否则后面生成不了 stateAt ──
       * 解析失败就如实停下，不拿半张表去生成动画。
       */
      if (stage === 'analysis') {
        analysisParsed = parseAnalysis(text);
        if (!analysisParsed.ok) {
          yield emit('stage_error', {
            stage,
            error: {
              kind: 'analysis.invalid',
              message: `物理分析表解析失败：${analysisParsed.problems.map((p) => p.message).join('；')}`,
              hint: '按【元件运动表 (MOTIONS)】格式重写：element/segment/t0/t1/x0/y0/vx0/vy0/ax/ay/x/y。',
            },
          });
          yield emit('run_done', { verdict: 'error', ms: Date.now() - started, stage, analysisProblems: analysisParsed.problems });
          return;
        }
      }

      /**
       * ── v1.1.16：**参考答案与题目对不上就立刻停** ──
       *
       * 提示词要求模型在这种情况下只输出 `【解析与题目不一致】` 并说明原因；
       * 这里再兜一层：宁可少跑后面三步，也不要把"另一道题"画成动画。
       * 只在**这次真的带了参考解析**时生效（没带 ⇒ 与旧版完全一致）。
       */
      if (stage === 'solve' && reference && text.includes('【解析与题目不一致】')) {
        yield emit('stage_error', {
          stage,
          error: {
            kind: 'reference.mismatch',
            message: '模型判断：你填的参考解析与这道题不是同一道（或关键数据对不上），已停止后续步骤。',
            hint: '核对一下解析是不是这道题的；改正后重新运行。',
          },
        });
        yield emit('run_done', { verdict: 'error', ms: Date.now() - started, stage, referenceMismatch: true });
        return;
      }

      /**
       * 第 5 期追加：**纯图片题**开跑时没有标题（题面是空的），转写出来后回填一次。
       *
       * 只在"题面本来就空"时回填 —— 用户手打了题面就用他的话，别拿模型的转写去顶替。
       * 放在这里（`read_problem` 的 `stage_done` 之后）而不是别处，是因为这是**唯一**
       * 一个"文字从无到有"的时点。
       */
      if (stage === 'read_problem') {
        /**
         * v1.1.19：模型有时不写【题目】，但会写出一整段可读的转写正文。
         * 标题取不到时用 `deriveEntryLabel()` 从正文第一句有内容的话兜底，
         * 避免纯图片题一路显示“未命名题目”。
         */
        const parsedTitle = parseProblemTitle(text);
        const title = parsedTitle === '未命名题目' ? deriveEntryLabel(text) ?? parsedTitle : parsedTitle;
        if (title && title !== entry) yield emit('run_label', { entry: title, source: 'read_problem' });
      }

      /**
       * ── 第 5.7 期：把判定解析出来，交给世界书（两侧分发的输入） ──
       *
       * 三条口径（计划 §5 S3 的硬性要求，逐条有断言）：
       *   ① **表外词丢弃 + 如实报出**：进 `unknowns`，**不许静默**（那条事件就是词表该扩编的信号）；
       *   ② **格式坏掉不抛异常**：进 `problems`，判定退化为空 ⇒ 触发退化为纯字面 keys，其余流程照常；
       *   ③ **空判定合法**：一个考点都没判出来不算错。
       *
       * ⚠ 留痕是**硬要求**（计划 §5 S4 第 4 项）：`knowledgecard_done` 要带上"判了哪些考点/题型/元件 + 表外词"。
       *   没有这条，"模型判错了什么"在 UI 上完全看不见，S1 那种人工复核就没法在真实运行里做。
       */
      if (stage === 'read_problem') {
        /**
         * ── v1.1.16：**拆图** ──
         *
         * 读题阶段会让模型给出【示意图范围】（归一化矩形）。这里按它**真裁一张图**，
         * 供后面写动画时参考 —— 这样"滑轮在哪、绳怎么走、哪端高"不必只靠文字猜。
         *
         * 三条边界：
         *   ① 只有"有题目图 + 端点支持看图"才做（不支持视觉的模型给图也没用）；
         *   ② 只支持 PNG（零依赖裁剪，见 `core/images/png-crop.mjs`）；
         *      JPEG / 框歪 / 裁失败 ⇒ **退回整幅原题图**，并如实说明原因；
         *   ③ 纯文字题（没有图）⇒ 什么都不加。
         */
        if (images.length > 0 && snapshot.endpoint?.supportsVision === true) {
          const box = parseDiagramBox(text);
          let info = { ok: false, reason: 'no-box' };
          if (box && Buffer.isBuffer(images[0]?.data)) {
            const cropped = cropPngNormalized(images[0].data, box);
            if (cropped) {
              diagram = { mime: 'image/png', data: cropped.buffer, name: 'diagram.png' };
              info = { ok: true, bbox: box, width: cropped.width, height: cropped.height };
            } else {
              info = { ok: false, reason: 'crop-failed', bbox: box };
            }
          }
          if (!diagram) {
            /* 退回整图：给一个"地点不明但至少看得见"的参考，比什么都没有强 */
            diagram = { mime: images[0].mime ?? 'image/png', data: images[0].data, name: 'problem-full.png' };
            info = { ...info, fallbackWhole: true };
          }
          yield emit('diagram_done', info);
        }

        if (snapshot.knowledgecard.version === 2) {
          const parsed = parseJudgementV2(text, {
            vocab: snapshot.knowledgecard.vocab ?? { elements: [], scenes: [] },
          });
          judgement = { concepts: [], tags: [], elements: parsed.elements, scenes: parsed.scenes };
          judgementProblems = parsed.problems;
          judgementUnknowns = {
            concept: [],
            tag: [],
            element: parsed.unknowns.elements,
            scene: parsed.unknowns.scenes,
          };
          yield emit('judgement_done', {
            stage,
            concepts: [],
            tags: [],
            elements: parsed.elements,
            scenes: parsed.scenes,
            unknowns: judgementUnknowns,
            problems: judgementProblems,
            why: parsed.why,
            empty: !(parsed.elements.length || parsed.scenes.length),
          });
        } else {
          const parsed = parseJudgement(text, { vocab: KNOWLEDGECARD_CONCEPTS, index: vocabIndex });
          judgement = { concepts: parsed.concepts, tags: parsed.tags, elements: parsed.elements, scenes: [] };
          judgementProblems = parsed.problems;
          judgementUnknowns = summarizeUnknowns(parsed);
          /**
           * 解析结果单独发一条事件（而不是塞进 `stage_done`）：
           *   · `stage_done` 的字段是"每阶段都一样"的形状，塞进去会让消费者要按阶段分支；
           *   · 判定是**可复核的判定结果**，与"这一步跑了多久/多少字"是两类信息。
           */
          yield emit('judgement_done', {
            stage,
            concepts: judgement.concepts,
            tags: judgement.tags,
            elements: judgement.elements,
            unknowns: judgementUnknowns,
            problems: judgementProblems,
            why: parsed.why,
            /** 判定是否为空 —— 前端据此提示"这次退化为字面匹配" */
            empty: !(judgement.concepts.length || judgement.tags.length || judgement.elements.length),
          });
        }
      }
    }

    /* ── 世界书溯源（§9.2 第 6 步 / §15 的"世界书依据"面板） ──
     *
     * 只在**确实提供了词条集合**时发（`source:'provided'`）。不提供时发一条空事件没有信息量，
     * 反而会让前端把"世界书没接上"显示成"这道题没有可用规范"。
     *
     * ⚠ 事件里**不带**词条正文（每条槽最多 30000 字符正文 + 10000 字符示例，那是给模型的，不是给 UI 的）：
     *   带上标题、命中方式、实际注入槽位、字符数与截断标记就够 §15 的面板用。
     */
    if (snapshot.knowledgecard.source === 'provided') {
      const sceneRes = knowledgecardResults.scene_code ?? null;
      /**
       * v2 引擎的事件形状由 `knowledgecardV2Evidence()` 补齐（前端仍按 v1 的
       * `KnowledgecardProvenance` 读：from/depth/key/origin/declaredSlots/charsBySlot…）。
       */
      const mergedWb = {
        ...knowledgecardV2Evidence(sceneRes, snapshot.knowledgecard.entries),
        hash: knowledgecardHashOf(snapshot.knowledgecard.entries),
        entries: snapshot.knowledgecard.entries.length,
      };
      yield emit('knowledgecard_done', {
        hash: mergedWb.hash,
        libraryCount: mergedWb.entries,
        matched: mergedWb.matched,
        entries: mergedWb.provenance,
        emptySlots: mergedWb.emptySlots,
        truncatedSlots: mergedWb.truncatedSlots,
        warnings: mergedWb.warnings,
        charsBySlot: mergedWb.charsBySlot,
        injectedBySlot: mergedWb.injectedBySlot,
        /**
         * ── 第 5.7 期：把"模型判了什么"与"世界书据此抽了什么"接在一起 ──
         *
         * 没有这三样，"世界书依据"面板只能显示"抽到了哪几条"，
         * 却回答不了**最该回答的问题**：为什么抽它？（判定错了？还是词条配错了？）
         *   · `judgement` —— 模型判的考点/题型/元件（两侧分发的输入）；
         *   · `judgementUnknowns` —— 表外词（**词表该扩编的信号**，不许静默）；
         *   · `judgementProblems` —— 结构问题（缺段 / 替身写法 / 细考点挂不上考点）。
         * 每条 `entries[].via` 已经能区分 `concept+tag / concept / element+concept / element / key（灰度）`。
         */
        judgement: { ...judgement },
        judgementUnknowns,
        judgementProblems,
        judgementEmpty: !(judgement.concepts.length || judgement.tags.length || judgement.elements.length || judgement.scenes.length),
      });
    }

    /* ── 清洗切分（不在 promptIds 里：它不是模型调用，而是对模型输出的加工） ── */

    if (cancelled()) {
      yield emit('cancelled', { stage: 'scene_code' });
      yield emit('run_done', { verdict: 'cancelled', ms: Date.now() - started, cancelled: true });
      return;
    }

    yield emit('stage_start', { stage: 'dry_run', index: PHASE5_STAGES.indexOf('dry_run'), total: PHASE5_STAGES.length });

    let program = null;
    let lineMap = null;
    let buildDiagnostics = [];
    try {
      if (!analysisParsed?.ok) throw new Error('analysis 没有可用的运动表，无法生成动画程序');
      const generated = generateProgramSlots({
        analysis: analysisParsed,
        problem: problemTextForSlots(problem.text, outputs.read_problem),
        breakdownText: outputs.breakdown,
        drawFrame: outputs.scene_code,
      });
      const programText = SLOT_KEY_NAMES.map((k) => `/* @slot:${k} */\n${generated[k]}\n/* @end */`).join('\n\n');
      const built = buildProgramFromText(programText, {
        regexRules: snapshot.regexRules,
        provenance: {
          model: snapshot.endpoint?.defaultModel ?? 'unknown',
          // 第 5 期：不再恒为 null —— 第 0 个阶段组装时就拿到了（它是固定前缀的属性）
          promptHash: promptHashSeen,
          // 第 5 期：不再写 'empty-phase3' 这个**假值**。空集合也算出一个真哈希，
          //   这样"世界书没接上"与"世界书是空的"在产物里可区分（README 的 B2 挂账在此收口）。
          knowledgecardHash: snapshot.knowledgecard.hash,
          generatedAt: new Date().toISOString(),
        },
      });
      program = built.program;
      lineMap = built.lineMap;
      buildDiagnostics = built.diagnostics;
    } catch (err) {
      if (err instanceof ProgramBuildError) {
        /**
         * 切分失败 = C1 层面的失败。**如实报出来**，不要拿半成品去跑 Dry-Run。
         * v1.1.19：必须同时发 `stage_error`，否则前端 `dry_run` 永远停在 running
         * （旧 UI 的阶段条/小肥鱼会一直显示“校验中”，看起来像卡死）。
         */
        const detail = formatSplitDiagnostics(err.diagnostics);
        yield emit('stage_error', {
          stage: 'dry_run',
          error: { kind: 'build', message: '模型输出无法切成 8 个槽位', hint: detail },
        });
        yield emit('dryrun_done', {
          verdict: 'fail',
          cancelled: false,
          stage: 'cleaner',
          checks: [
            {
              id: 'C1',
              status: 'fail',
              blocking: true,
              message: '模型输出无法切成 8 个槽位',
              diagnostics: err.diagnostics,
            },
          ],
          extensions: [],
          diagnostics: err.diagnostics,
          detail,
        });
        yield emit('run_done', { verdict: 'fail', ms: Date.now() - started, stage: 'cleaner' });
        return;
      }
      throw err;
    }

    /* ── Dry-Run（第 2 期的校验内核，一行都不用改） ── */

    /**
     * ⚠ `dryRun()` 的返回形状是 `{ report, run, lint }`（不是 report 本身）。
     *   这里只解出 `report`：编排层不需要 `run`（逐帧数据）与 `lint`（原始静态诊断），
     *   它们很大且已经通过 report 里的 checks/diagnostics 暴露了要点。
     *   第 4 期起这个闭包被"首次 Dry-Run"与"每一轮修复之后"共用。
     */
    const runDryRun = (slots, { advisory = null } = {}) => {
      const analysisBoundaries = analysisParsed?.elements
        ? [...new Set(analysisParsed.elements.flatMap((el) => el.segments.flatMap((s) => [s.t0, s.t1])))]
            .filter((v) => Number.isFinite(v) && v >= 0)
            .sort((a, b) => a - b)
        : [];
      const branchBoundaries = analysisParsed?.elements
        ? [
            ...new Set(
              analysisParsed.elements.flatMap((el) =>
                el.segments.filter((s) => s.branch === true).map((s) => s.t0),
              ),
            ),
          ]
            .filter((v) => Number.isFinite(v) && v >= 0)
            .sort((a, b) => a - b)
        : [];
      return dryRunImpl({
        slots,
        entry,
        meta: {
          mode: snapshot.mode,
          ...(analysisParsed?.tPhys != null ? { tPhys: analysisParsed.tPhys } : {}),
          ...(analysisBoundaries.length ? { boundaries: analysisBoundaries } : {}),
          ...(branchBoundaries.length ? { branchBoundaries } : {}),
          /**
           * ── 第 8 期：开发模式（不拦截）──
           * 用户勾了"开发模式"后，校验器**照常逐条判**，但结论不拦路：
           * `report.advisory = true`、`gatesBypassed` 列出被放行的检查号，
           * 而 verdict 降为 `pass-with-warnings` ⇒ 程序照常流进动画页。
           */
          advisory: advisory ?? snapshot.advisory === true,
          ...(snapshot.wallClockMs ? { wallClockMs: snapshot.wallClockMs } : {}),
          ...(snapshot.stagedOverrides ?? {}),
        },
        ...(ac.signal ? { signal: ac.signal } : {}),
      });
    };

    let { report } = await runDryRun(program.slots);

    /** 自愈轮次的留档（B6：修复过程对用户可见，也要能事后复盘） */
    const repairRounds = [];
    let cancelledDuringRepair = false;
    let repairStoppedReason = null;
    /**
     * 失败签名（v1.1.5）：连续两轮"同一个错误"就不再做第三轮盲改。
     * 每轮都是独立请求、没有记忆；同一个错误重复出现，说明模型没抓到根因，
     * 再发一轮大概率还是同一改法 —— 省下这一轮，走确定性修复或带告警交付。
     */
    const failureSignature = (r) =>
      (r?.checks ?? [])
        .filter((c) => c.blocking && c.status === 'fail')
        .map((c) => `${c.id}:${c.detail ?? c.message ?? ''}`)
        .sort()
        .join('|');
    let lastFailSignature = failureSignature(report);
    let sameFailRounds = 0;
    /** `repair_done` 只推一次：要么在"找不到可重发槽位"的分支里推过，要么在循环之后推 */
    let repairEmittedDone = false;

    if (report.cancelled) cancelledDuringRepair = true;
    const repairStageIndex = PHASE5_STAGES.indexOf('repair');
    const repairTotal = PHASE5_STAGES.length;

    /**
     * ── 新链路 v6 自愈：只重画 drawFrame ──
     * 物理槽位（stateAt/VIEW/readouts/STEPS）由 analysis 生成，AI 不许碰；
     * 失败时只把“上一轮为什么没过 + 上一轮 drawFrame”发回，产出新的 drawFrame，再重新生成程序。
     */
    let physicalRounds = 0;
    const physicalMax = disableRepair || snapshot.advisory === true ? 0 : 2;
    for (let p = 0; p < physicalMax && report.verdict !== 'pass'; p += 1) {
      const cls = classifyRepair(report);
      if (cls.mode !== 'physical') break;
      physicalRounds += 1;
      const roundNo = physicalRounds;
      const physicalSlots = ['read_problem', 'solve', 'breakdown', 'analysis', 'scene_code'];
      yield emit('stage_start', {
        stage: 'repair',
        index: repairStageIndex,
        total: repairTotal,
        round: roundNo,
        maxRounds: physicalMax,
        slots: physicalSlots,
        mode: 'physical',
      });
      const startedRound = Date.now();
      const previousReport = report;
      const silent = [];
      const enq = (ev) => silent.push(ev);
      const stageIndex = (s) => PHASE5_STAGES.indexOf(s);

      const rp = await executeStage('read_problem', stageIndex('read_problem'), enq);
      yield* takeStageErrors(silent);
      if (!rp.ok) {
        yield emit('run_done', { verdict: 'error', ms: Date.now() - started, stage: 'read_problem' });
        return;
      }
      const sv = await executeStage('solve', stageIndex('solve'), enq);
      yield* takeStageErrors(silent);
      if (!sv.ok) {
        yield emit('run_done', { verdict: 'error', ms: Date.now() - started, stage: 'solve' });
        return;
      }
      if (reference && String(sv.text ?? '').includes('【解析与题目不一致】')) {
        yield emit('stage_error', {
          stage: 'repair',
          error: { kind: 'reference.mismatch', message: '参考答案与题目不一致，物理修复无法继续' },
        });
        repairStoppedReason = '参考解析与题目不一致';
        break;
      }
      const group = [];
      const groupEvents = [];
      for await (const ev of runConcurrent(
        [
          { stage: 'breakdown', index: stageIndex('breakdown') },
          { stage: 'analysis', index: stageIndex('analysis') },
        ],
        group,
      )) {
        groupEvents.push(ev);
      }
      yield* takeStageErrors(groupEvents);
      if (!group[0]?.ok || !group[1]?.ok) {
        yield emit('run_done', { verdict: 'error', ms: Date.now() - started, stage: 'breakdown/analysis' });
        return;
      }
      analysisParsed = parseAnalysis(outputs.analysis ?? '');
      if (!analysisParsed.ok) {
        yield emit('stage_error', {
          stage: 'analysis',
          error: {
            kind: 'analysis.invalid',
            message: `物理分析表解析失败：${analysisParsed.problems.map((p) => p.message).join('；')}`,
            hint: '按【元件运动表 (MOTIONS)】格式重写：element/segment/t0/t1/x0/y0/vx0/vy0/ax/ay/x/y。',
          },
        });
        yield emit('run_done', { verdict: 'error', ms: Date.now() - started, stage: 'analysis' });
        return;
      }
      /* couple 已在主链路里、scene_code 之前跑过（见 runCoupleStage）；修复轮不重跑，
         否则同一题会出现两个版本的步骤边界。 */
      const sc = await executeStage('scene_code', stageIndex('scene_code'), enq);
      yield* takeStageErrors(silent);
      if (!sc.ok) {
        yield emit('run_done', { verdict: 'error', ms: Date.now() - started, stage: 'scene_code' });
        return;
      }

      let built;
      try {
        const generated = generateProgramSlots({
          analysis: analysisParsed,
          problem: problemTextForSlots(problem.text, outputs.read_problem),
          breakdownText: outputs.breakdown,
          drawFrame: outputs.scene_code,
        });
        const programText = SLOT_KEY_NAMES.map((k) => `/* @slot:${k} */\n${generated[k]}\n/* @end */`).join('\n\n');
        built = buildProgramFromText(programText, {
          regexRules: snapshot.regexRules,
          provenance: program.provenance,
        });
      } catch (err) {
        if (err instanceof ProgramBuildError) {
          /**
           * 物理修复轮返回空/坏内容时，**不能把异常抛出流水线**：
           * 那会变成 run.crashed，用户只看到“运行出错”，不知道是修复输出拼不齐。
           * 保留上一版程序、如实报一条 repair 阶段的 build 错误，然后带告警交付。
           */
          yield emit('stage_error', {
            stage: 'repair',
            round: roundNo,
            error: {
              kind: 'build',
              message: '物理修复的输出无法拼成 8 个槽位；已保留上一版程序，带告警交付',
              hint: formatSplitDiagnostics(err.diagnostics),
              diagnostics: err.diagnostics,
            },
          });
          const record = {
            round: roundNo,
            mode: 'physical',
            requested: physicalSlots,
            updated: [],
            kept: Object.keys(program.slots),
            unchanged: [],
            triggeringChecks: cls.physical,
            diagnostics: collectRoundDiagnostics(previousReport),
            verdict: 'build-error',
            ms: Date.now() - startedRound,
          };
          repairRounds.push(record);
          yield emit('repair_round', record);
          repairStoppedReason = '物理修复输出无法拼成程序；已保留上一版';
          break;
        }
        throw err;
      }
      program = built.program;
      lineMap = built.lineMap;
      buildDiagnostics = built.diagnostics;
      report = (await runDryRun(program.slots)).report;

      const record = {
        round: roundNo,
        mode: 'physical',
        requested: physicalSlots,
        updated: physicalSlots,
        kept: [],
        unchanged: [],
        triggeringChecks: cls.physical,
        diagnostics: collectRoundDiagnostics(previousReport),
        verdict: report.verdict,
        ms: Date.now() - startedRound,
      };
      repairRounds.push(record);
      yield emit('stage_done', {
        stage: 'repair',
        round: roundNo,
        chars: 0,
        ms: record.ms,
        chunks: 0,
        merged: true,
        mode: 'physical',
        updated: physicalSlots,
      });
      yield emit('repair_round', record);
      yield emitDryRunDone(emit, { report, program, lineMap, buildDiagnostics, round: roundNo });
      if (report.verdict === 'pass') break;
    }
    /**
     * 只有“画图类硬拦”才进 drawFrame 自愈。
     *
     * 旧写法 `mode !== 'physical'` 会把 `pass-with-warnings`（没有硬拦、只有 C4/C6/C8/C9
     * 这类告警）也送进重画循环：白跑 3 次模型、还可能把本来能看的画面改坏。
     */
    let drawAllowed = report.verdict !== 'pass' && classifyRepair(report).mode === 'draw';

    const drawRepairMax = disableRepair || snapshot.advisory === true ? 0 : snapshot.maxRepairRounds;
    for (let drawRound = 0; drawAllowed && drawRound < drawRepairMax; drawRound += 1) {
      if (report.verdict === 'pass' || cancelled()) break;
      const roundNo = physicalRounds + drawRound + 1;
      const failures = (report.checks ?? [])
        .filter((c) => c.blocking && c.status === 'fail')
        .map((c) => `${c.id}：${c.detail ?? c.message ?? ''}`);
      const triggeringChecks = (report.checks ?? []).filter((c) => c.blocking && c.status === 'fail').map((c) => c.id);
      yield emit('stage_start', {
        stage: 'repair',
        index: repairStageIndex,
        total: repairTotal,
        round: roundNo,
        maxRounds: drawRepairMax,
        slots: ['drawFrame'],
        mode: 'draw',
      });
      const stageStarted = Date.now();
      const repairPrompt = getPrompt('repair', snapshot.rules);
      const assembled = assemblePrompt({
        problem: {
          text: repairPrompt.buildUser({
            problem: problem.text,
            analysisText: formatAnalysis(analysisParsed),
            readProblem: outputs.read_problem,
            ...(descriptionFor('repair') ? { description: descriptionFor('repair') } : {}),
            ...(problem.knownConditions ? { knownConditions: problem.knownConditions } : {}),
            stateMap: stateKeyMap(analysisParsed),
            failures,
            previousDrawFrame: program.slots.drawFrame,
          }),
        },
        instructions: repairPrompt.system,
        instructionLabel: repairPrompt.label,
        stageSlot: 'scene_code',
        knowledgecardSegment: knowledgecardForStage('scene_code').text,
        stage: 'repair',
      });
      if (diagram) {
        assembled.messages[1] = buildUserMessage({ text: assembled.messages[1].content, images: [diagram] });
      }
      const result = await streamImpl({
        endpoint: snapshot.endpoint,
        apiKey: snapshot.apiKey,
        stage: 'scene_code',
        round: roundNo,
        messages: assembled.messages,
        signal: ac.signal,
        vision: Boolean(diagram),
        onDelta: () => {},
      });
      const newDraw = result.text ?? '';
      const beforeReport = report;
      let built;
      try {
        const generated = generateProgramSlots({
          analysis: analysisParsed,
          problem: problemTextForSlots(problem.text, outputs.read_problem),
          breakdownText: outputs.breakdown,
          drawFrame: newDraw,
        });
        const programText = SLOT_KEY_NAMES.map((k) => `/* @slot:${k} */\n${generated[k]}\n/* @end */`).join('\n\n');
        built = buildProgramFromText(programText, {
          regexRules: snapshot.regexRules,
          provenance: program.provenance,
        });
      } catch (err) {
        if (err instanceof ProgramBuildError) {
          /**
           * 修复轮返回空/坏内容：不要抛成 run.crashed。
           * 保留上一版可播放程序，如实报 repair 阶段的 build 错误，然后带告警交付。
           */
          yield emit('stage_error', {
            stage: 'repair',
            round: roundNo,
            error: {
              kind: 'build',
              message: '修复输出无法拼成 8 个槽位；已保留上一版程序，带告警交付',
              hint: formatSplitDiagnostics(err.diagnostics),
              diagnostics: err.diagnostics,
            },
          });
          const record = {
            round: roundNo,
            mode: 'draw',
            requested: ['drawFrame'],
            updated: [],
            kept: Object.keys(program.slots),
            unchanged: [],
            triggeringChecks,
            diagnostics: collectRoundDiagnostics(beforeReport),
            verdict: 'build-error',
            ms: Date.now() - stageStarted,
          };
          repairRounds.push(record);
          yield emit('repair_round', record);
          repairStoppedReason = '修复输出无法拼成程序；已保留上一版';
          break;
        }
        throw err;
      }
      program = built.program;
      lineMap = built.lineMap;
      buildDiagnostics = built.diagnostics;
      outputs.scene_code = newDraw;
      const next = await runDryRun(program.slots);
      report = next.report;
      const record = {
        round: roundNo,
        mode: 'draw',
        requested: ['drawFrame'],
        updated: ['drawFrame'],
        kept: SLOT_KEY_NAMES.filter((k) => k !== 'drawFrame'),
        unchanged: [],
        triggeringChecks,
        diagnostics: collectRoundDiagnostics(beforeReport),
        verdict: report.verdict,
        ms: Date.now() - stageStarted,
      };
      repairRounds.push(record);
      yield emit('stage_done', { stage: 'repair', round: roundNo, chars: newDraw.length, ms: record.ms, chunks: 0, merged: false });
      yield emit('repair_round', record);
      yield emitDryRunDone(emit, { report, program, lineMap, buildDiagnostics, round: roundNo });
      if (report.verdict === 'pass') {
        repairStoppedReason = null;
        break;
      }
      if (drawRound + 1 >= drawRepairMax) repairStoppedReason = `达到自愈上限 ${drawRepairMax} 轮`;
    }

    /* ── 自愈循环（M30 · §8 / §14.5） ──
     *
     * 只做四件事：
     *   ① `planRepair()` 决定重发哪些槽位（纯函数，§8.1 的表）；
     *   ② 只把**出错槽位的代码 + 诊断（带证据强度）**发回模型；
     *   ③ 合并回来（未涉及的槽位逐字节不变）→ 重跑 C1–C9；
     *   ④ `pass` 即停；上限 3 轮；仍不过 ⇒ 带告警横幅交付（绝不静默）。
     */
    /**
     * ⚠ 开发模式（不拦截）时**不跑自愈**：用户的诉求是"别拦我，直接给我看画面"。
     * 自愈本身要再调模型、还会改写槽位 —— 在"我怀疑判据本身"的前提下，它没有意义。
     * `gatesBypassed` 已经记下哪几条没过，事后想修可以手动再跑。
     */
    /**
     * ⚠ 新链路 v6：自愈已改为“只重画 drawFrame”（见上面的 drawRepairMax 循环）。
     *   下面这段旧循环保留为 0 轮，不再执行。
     */
    const maxRounds = 0;

    /**
     * ── 确定性快修（v1.1.5 · 用户 2026-10-19 拍板）──
     *
     * 纯符号答案的 C7 失败，绝大多数只是"答案名和读数名没对上"：
     * 把**答案自己的符号**原样加成一条读数（value: 0），再跑一遍 C7 就能过。
     * 这一步不调模型、不写死任何物理名对照表；只有"全部阻塞失败都是 C7"时才尝试。
     */
    let aliasApplied = false;
    if (maxRounds > 0 && report.verdict !== 'pass') {
      let answers = [];
      try {
        answers = parseAnswersSlot(program.slots.ANSWERS ?? '');
      } catch {
        answers = [];
      }
      const alias = planC7Alias({ slots: program.slots, report, answers });
      if (alias.ok) {
        const next = await runDryRun(alias.slots);
        if (next.report.verdict === 'pass') {
          try {
            const source = SLOT_KEY_NAMES.map((k) => `/* @slot:${k} */\n${alias.slots[k] ?? ''}\n/* @end */`).join('\n');
            const rebuilt = buildProgramFromText(source, {
              regexRules: snapshot.regexRules,
              provenance: program.provenance,
            });
            const beforeSlots = program.slots;
            program = rebuilt.program;
            lineMap = rebuilt.lineMap;
            buildDiagnostics = rebuilt.diagnostics;
            report = next.report;
            const updated = ['readouts'];
            const roundRecord = {
              round: 1,
              requested: ['readouts'],
              updated,
              kept: Object.keys(beforeSlots).filter((k) => !updated.includes(k)),
              unchanged: Object.keys(beforeSlots).filter((k) => beforeSlots[k] === program.slots[k]),
              triggeringChecks: ['C7'],
              diagnostics: [],
              verdict: 'pass',
              ms: 0,
              note: '确定性修复：把答案符号原样加成读数（未调用模型）',
            };
            repairRounds.push(roundRecord);
            aliasApplied = true;
            yield emit('stage_start', {
              stage: 'repair',
              index: repairStageIndex,
              total: repairTotal,
              round: 1,
              maxRounds,
              slots: updated,
              note: '确定性修复',
            });
            yield emit('stage_done', { stage: 'repair', round: 1, chars: 0, ms: 0, chunks: 0, merged: true, updated });
            yield emit('repair_round', roundRecord);
            yield emitDryRunDone(emit, { report, program, lineMap, buildDiagnostics, round: 1 });
            repairStoppedReason = '确定性修复通过（未调用模型）';
          } catch {
            /* 重建失败：保持原程序，退回到正常的模型修复 */
          }
        }
      }
    }

    for (let round = 0; !aliasApplied && round < maxRounds; round += 1) {
      const decision = shouldContinue({
        verdict: report.verdict,
        round,
        maxRounds,
        cancelled: cancelled() || Boolean(report.cancelled),
      });
      if (decision.stop) {
        // 记录"为什么停"：`pass` 是收敛，其余是上限/取消
        if (report.verdict !== 'pass') repairStoppedReason = decision.reason;
        break;
      }

      const plan = planRepair({ report, round, slots: program.slots });
      /**
       * ── v1.1.16：自愈分模式 ──
       *
       * 判据只看"要改的是哪类槽位"，不看画面长什么样：
       *   · 只要动到代码槽位（VIEW/setup/stateAt/drawFrame/readouts）⇒ **整段重画** `scene_code`；
       *   · 只有数据槽位（STEPS/ANSWERS）⇒ 才允许局部补丁。
       *
       * 为什么：几何是全局的。第 2 次实测里，自愈为了补一个 `state.yB` 把滑轮抬到 3.0，
       * 结果是"检查绿了、绳断了、B 沉到地下"。局部补丁必然按倒葫芦起了瓢。
       */
      const repairMode = repairModeOf(plan.slots);
      if (!plan.slots.length) {
        // 阻塞失败但没有任何槽位可归因 —— 如实说明并停止（不假装修过）
        repairStoppedReason = `第 ${round + 1} 轮找不到可重发的槽位（失败检查：${plan.failingChecks.join(' / ') || '—'}）`;
        yield emit('repair_done', {
          rounds: round,
          verdict: report.verdict,
          converged: false,
          banner: null,
          reason: repairStoppedReason,
          updates: [],
        });
        repairEmittedDone = true;
        break;
      }

      if (cancelled()) {
        cancelledDuringRepair = true;
        break;
      }

      const roundNo = round + 1;
      yield emit('stage_start', { stage: 'repair', index: repairStageIndex, total: repairTotal, round: roundNo, maxRounds, slots: plan.slots, mode: repairMode });

      const stageStarted = Date.now();
      const previousReport = report;
      const chunks = [];
      let text = '';
      try {
        let assembled;
        let vision = false;
        if (repairMode === 'regenerate') {
          /**
           * ── 代码槽位：**整段重画** ──
           *
           * 不是"修复任务"，而是拿**首次生成 scene_code 的那套提示词**重发一遍，
           * 只在末尾加两段：上一轮为什么没过 + 上一轮代码（可整体重排）。
           * 输出要求只给 5 个代码槽位 —— 数据槽位（PROBLEM/STEPS/ANSWERS）冻结，不让重画碰。
           */
          const scenePrompt = getPrompt('scene_code', snapshot.rules);
          const sceneSeg = knowledgecardForStage('scene_code');
          const failures = (report.checks ?? [])
            .filter((c) => c.blocking && c.status === 'fail')
            .map((c) => `· ${c.id}：${c.detail ?? c.message ?? ''}`);
          const prevCode = CODE_SLOTS.map((k) => ['```js', `/* ${k} */`, program.slots[k] ?? '', '```'].join('\n')).join('\n\n');
          const baseUser = scenePrompt.buildUser({
            problem: problem.text,
            solution: outputs.solve,
            steps: outputs.steps,
            answers: outputs.answers,
            timeAxis: deriveTimeAxis(outputs.steps),
            readProblem: outputs.read_problem,
            hasDiagram: Boolean(diagram),
          });
          const userText = [
            baseUser,
            '',
            '【上一轮为什么没过（这一轮允许整体重排，不要求保留原来的写法或结构）】',
            ...(failures.length ? failures : ['· （报告没有给出可定位的失败项）']),
            '',
            '【上一轮代码（仅作参考：哪里别扭就整段换掉，不要只改一两行）】',
            prevCode,
            '',
            '【本轮输出要求】',
            '· 只输出这 5 个代码槽位：VIEW / setup / stateAt / drawFrame / readouts；',
            '· PROBLEM / STEPS / ANSWERS 已被冻结，**不要重复输出**，也不要去改它们；',
            '· 允许推翻上一版的做法：优先保证几何自洽（绳、滑轮、地面、物体位置），再谈细节。',
          ].join('\n');
          assembled = assemblePrompt({
            problem: { text: userText },
            instructions: scenePrompt.system,
            instructionLabel: scenePrompt.label,
            stageSlot: 'scene_code',
            knowledgecardSegment: sceneSeg.text,
            stage: 'scene_code',
          });
          if (diagram) {
            assembled.messages[1] = buildUserMessage({ text: assembled.messages[1].content, images: [diagram] });
            vision = true;
          }
        } else {
          const prompt = getPrompt('repair', snapshot.rules);
          const repairTask = buildRepairTask({
            problem: problem.text,
            plan,
            report,
            slots: program.slots,
            previousRounds: repairRounds,
            codeSlot: involvesCodeSlots(plan.slots),
          });
          const resolved = { repairTask };
          assembled = assemblePrompt({
            problem: { text: prompt.buildUser(resolved) },
            knowledgecardEntries: [{ title: prompt.label, content: prompt.system }],
            // 自愈要重写槽位代码 ⇒ 必须拿**完整前缀**（角色 + 模板骨架 + SDK 摘要）
            stage: 'repair',
          });
        }

        const result = await streamImpl({
          endpoint: snapshot.endpoint,
          apiKey: snapshot.apiKey,
          /* 自愈时重写的是动画代码 ⇒ 属于 scene_code 阶段，思考要开 */
          stage: 'scene_code',
          /**
           * v1.1.7：把"第几轮修复"传下去。
           *
           * 为什么加这一个字段：开源日志要分清"首次生成代码"与"第 2 轮修复重写" ——
           * 否则同一道题里会出现五六条一模一样的 `scene_code` 对话，读日志的人分不出哪条是修出来的。
           * 纯上下文信息，不改变任何行为（不传也没有任何实现依赖它）。
           */
          round: roundNo,
          messages: assembled.messages,
          signal: ac.signal,
          vision,
          onDelta: (d) => {
            if (typeof d === 'string' && d.length) chunks.push(d);
          },
        });
        text = result.text ?? (chunks.length ? chunks.join('') : '');
      } catch (err) {
        const modelErr =
          err instanceof ModelError
            ? err
            : (() => {
                const kind = classifyFetchError(err, { timedOut: false });
                return new ModelError({
                  kind,
                  message: describeModelError(kind, kind === 'cancelled' ? '' : String(err?.message ?? err)),
                  raw: redactText(String(err?.message ?? ''), []),
                });
              })();
        // 取消导致的失败**不当错误报**（与主阶段同一条口径）
        if (modelErr.kind === 'cancelled') {
          cancelledDuringRepair = true;
          break;
        }
        // 修复调用失败 ⇒ **不静默**：如实报出来，然后按"没修好"交付（带横幅）
        yield emit('stage_error', { stage: 'repair', round: roundNo, error: modelErr.toJSON() });
        repairRounds.push({ round: roundNo, slots: plan.slots, verdict: 'error', error: modelErr.toJSON() });
        break;
      }

      for (const c of chunks) yield emit('stage_delta', { stage: 'repair', round: roundNo, text: c });
      if (chunks.length === 0 && text) yield emit('stage_delta', { stage: 'repair', round: roundNo, text });

      // 合并：未涉及的槽位**逐字节不变**（B3 的断言对象）
      let merged;
      try {
        merged = mergeImpl(text, program.slots, {
          regexRules: snapshot.regexRules,
          provenance: program.provenance,
        });
      } catch (err) {
        if (err instanceof ProgramBuildError) {
          yield emit('stage_error', {
            stage: 'repair',
            round: roundNo,
            error: { kind: 'contract', message: '修复输出无法切分合并（未通过 §3.5 标记协议）', diagnostics: err.diagnostics },
          });
          yield emit('stage_done', { stage: 'repair', round: roundNo, chars: text.length, ms: Date.now() - stageStarted, chunks: chunks.length, merged: false });
          repairRounds.push({ round: roundNo, slots: plan.slots, verdict: 'unmergeable', diagnostics: err.diagnostics });
          continue; // 用上一版程序继续下一轮（不拿半成品去跑 Dry-Run）
        }
        throw err;
      }

      const before = program.slots;
      program = merged.program;
      // 只覆盖本轮真正被改写的槽位：`mergeImpl` 返回的 `updated` 是权威口径
      const updated = merged.updated ?? plan.slots;

      const next = await runDryRun(program.slots);
      report = next.report;

      const roundRecord = {
        round: roundNo,
        /** v1.1.16：这一轮是"补丁"还是"整段重画"（日志与界面都要能区分） */
        mode: repairMode,
        requested: plan.slots,
        updated,
        // 未涉及的槽位 —— 断言"逐字节不变"时用它们做证据
        kept: merged.kept ?? Object.keys(before).filter((k) => !updated.includes(k)),
        unchanged: Object.keys(before).filter((k) => !updated.includes(k) && before[k] === program.slots[k]),
        // ⚠ 存的是**这一轮开始前**那条报告的诊断（`plan` 是照它算出来的）。
        //   修复成功后再取报告里的诊断会是空的 —— 那样"这一轮为什么被触发"就丢了。
        triggeringChecks: plan.failingChecks,
        diagnostics: collectRoundDiagnostics(previousReport),
        verdict: report.cancelled ? 'cancelled' : report.verdict,
        ms: Date.now() - stageStarted,
      };
      repairRounds.push(roundRecord);

      yield emit('stage_done', { stage: 'repair', round: roundNo, chars: text.length, ms: roundRecord.ms, chunks: chunks.length, merged: true, updated });
      // B6：每轮的诊断快照一起推给前端
      yield emit('repair_round', roundRecord);
      yield emitDryRunDone(emit, { report, program, lineMap, buildDiagnostics, round: roundNo });

      const sig = failureSignature(report);
      if (sig === lastFailSignature) sameFailRounds += 1;
      else {
        sameFailRounds = 0;
        lastFailSignature = sig;
      }
      if (report.verdict !== 'pass' && sameFailRounds >= 2) {
        repairStoppedReason = `连续 ${sameFailRounds} 轮同一错误，停止盲改（避免重复同样的改动）`;
        break;
      }

      if (report.cancelled) {
        cancelledDuringRepair = true;
        break;
      }
    }

    /* ── 交付形态与告警横幅（§21.2 第 8 条 / B4） ── */

    const rounds = repairRounds.length;
    const converged = report.verdict === 'pass';
    const shape = deliveryShape(program.slots);
    const banner = buildBanner({
      verdict: report.verdict,
      rounds,
      report,
      slots: program.slots,
      reason:
        report.verdict !== 'pass'
          ? (repairStoppedReason ?? (rounds >= 1 ? `已自动修复 ${rounds} 轮仍未通过` : null))
          : null,
    });

    if (rounds && !repairEmittedDone) {
      yield emit('repair_done', {
        rounds,
        verdict: report.verdict,
        converged,
        banner,
        stoppedReason: repairStoppedReason,
        // 供前端"修了什么"面板直接用，避免它自己再算一遍
        updates: repairRounds.map((r) => ({ round: r.round, updated: r.updated, verdict: r.verdict })),
      });
    }

    // 最后一轮的 Dry-Run 事件（如果修复过程里已经推过，就不再重复推一次）
    if (!repairRounds.length) {
      yield emitDryRunDone(emit, { report, program, lineMap, buildDiagnostics });
    }

    /*
     * couple 已在 scene_code **之前**跑完（见上面那个前置块），这里只把结果挂到程序上：
     *   · `program.stepTimes` 让模板/导出页能按步骤跳转；
     *   · `coupling`（含归一化后的显示秒与 timeMap）随后随 `run_done` 下发。
     *
     * ⚠ **不重跑 couple**：跑两次会让同一题的步骤边界出现两个版本，
     *   而且第二次的结果会覆盖第一次，scene_code 用过的边界就对不上了。
     */
    if (Array.isArray(stepTimes)) program.stepTimes = stepTimes;
    if (!shape.playable || !analysisParsed?.ok) {
      yield emit('stage_done', {
        stage: 'couple',
        skipped: true,
        chars: 0,
        ms: 0,
        reason: shape.playable ? '缺少可用的 analysis，跳过步骤耦合' : '没有可播放程序，跳过步骤耦合',
      });
    }

    yield emit('run_done', {
      verdict: report.cancelled ? 'cancelled' : report.verdict,
      ms: Date.now() - started,
      cancelled: Boolean(report.cancelled) || cancelledDuringRepair,
      rounds,
      converged,
      banner,
      delivery: shape,
      stepTimes: stepTimes ?? null,
      displayStepTimes: coupling?.displayStepTimes ?? null,
      timeMap: coupling?.timeMap ?? null,
      displayDuration: coupling?.displayDuration ?? null,
      coupling: coupling ?? null,
      /** v1.1.18：手动打回/对比要用的原始上下文（不是 8 槽位的一部分） */
      readProblemText: outputs.read_problem ?? null,
      analysisText: analysisParsed?.ok ? formatAnalysis(analysisParsed) : null,
      /**
       * 第 8 期：**开发模式（不拦截）**的可见痕迹。
       * `advisory: true` 说明这条产物没经过硬判据；`gatesBypassed` 列出被放行的检查号。
       * 前端要把它显示出来（不能让人以为"绿了"），导出也要烧进 Provenance。
       */
      advisory: report.advisory === true,
      gatesBypassed: report.gatesBypassed ?? [],
    });
  } finally {
    if (signal) signal.removeEventListener('abort', onExternalAbort);
    // 收尾：确保没有遗留在跑的 Worker（取消路径也会走到这里）
    if (!ac.signal.aborted) ac.abort();
  }
}

/** 从报告里取"这一轮要回灌给用户的诊断要点"（不含逐帧数据） */
function collectRoundDiagnostics(report) {
  return (report?.checks ?? [])
    .filter((c) => c.status === 'fail')
    .map((c) => ({
      check: c.id,
      status: c.status,
      blocking: Boolean(c.blocking),
      message: c.detail ?? c.message ?? '',
      diagnostics: (c.diagnostics ?? []).map((d) => ({
        check: d.check ?? c.id,
        slot: d.slot,
        line: d.line ?? null,
        column: d.column ?? null,
        precision: d.precision ?? null,
        rule: d.rule ?? null,
        message: d.message ?? '',
      })),
    }));
}

/** `dryrun_done` 的组装（第 4 期起被"首次 Dry-Run"与"每一轮修复"共用） */
function emitDryRunDone(emit, { report, program, lineMap, buildDiagnostics, round = null }) {
  const checks = report.checks ?? [];
  const extensions = report.extensions ?? [];
  const diagnostics = checks.flatMap((c) => (c.diagnostics ?? []).map((d) => ({ check: c.id, ...d })));

  return emit('dryrun_done', {
    ...(round ? { round } : {}),
    verdict: report.cancelled ? 'cancelled' : report.verdict,
    cancelled: Boolean(report.cancelled),
    /**
     * 第 8 期：**开发模式（不拦截）**的两个字段。
     * 校验报告面板必须能看到"这条产物其实没过 C1/C4"，否则"开发模式"会变成"看不见的绿灯"。
     */
    advisory: report.advisory === true,
    gatesBypassed: report.gatesBypassed ?? [],
    checks: checks.map((c) => ({
      id: c.id,
      status: c.status,
      blocking: c.blocking,
      message: c.message,
      /**
       * 第 8 期（用户真题）：**"现场"必须送到界面上**。
       *
       * C6 之前只发 message（"位置跳变"四个字）+ 诊断（候选行），
       * 而真正有用的 { t, key, before, after, delta } 留在 report 里没人看 ——
       * 用户看到四条候选行，完全无法判断"到底哪个量在什么时刻跳了多少"。
       * 这里按"最多 8 条、只留数值/字符串"的瘦身口径透传。
       */
      offenders: Array.isArray(c.offenders)
        ? c.offenders.slice(0, 8).map((o) => {
            const out = {};
            for (const [k, v] of Object.entries(o ?? {})) {
              if (v === null || ['number', 'string', 'boolean'].includes(typeof v)) out[k] = v;
            }
            return out;
          })
        : [],
    })),
    extensions: extensions.map((e) => ({ id: e.id, status: e.status, blocking: false, message: e.message })),
    diagnostics,
    termination: report.execution?.termination ?? null,
    frameCount: report.execution?.frameCount ?? 0,
    /**
     * ── 第 8 期（M22 观测）新增，**纯增量字段** ──
     *
     * 方案 §17 M22 点名要「`Draw.raw` 使用率」，而这个值只有 Dry-Run 知道
     * （它在 `report.observations` 里，`run-suite` 与 `budget-check` 早就用它了）。
     * 观测层只消费事件，拿不到 `report` 本体，所以把这两个数**透传**出去。
     *
     * 为什么是"加字段"而不是"改形状"：既有字段一个没动，消费者只用 `.find()` 取事件
     * 再读自己关心的键，多一个键不会影响任何断言（门禁 ㉝ 会钉住这一点）。
     */
    observations: {
      drawRawCount: report.observations?.drawRawCount ?? 0,
      drawRawUsage: report.observations?.drawRawUsage ?? 0,
    },
    // 交给前端装配 iframe 的载荷（第 3 期的宿主协议用它）
    program: {
      slots: program.slots,
      mode: report.execution?.mode ?? 'BOTH',
      templateVersion: report.meta?.templateVersion ?? null,
      // 第 5 期：**把 Provenance 一起发出去**。§14 要求导出 HTML 必须烧录它
      // （模板/SDK 版本 + 模型 + promptHash + knowledgecardHash），而导出用的正是这份载荷。
      // 少了它，导出产物就无法回答"它是用哪套规则生成的"。
      provenance: program.provenance ?? null,
    },
    lineMap,
    buildDiagnostics,
    /**
     * ── 第 8 期（C2 标注避让）新增，**纯增量字段** ──
     *
     * Dry-Run 顺手算出的"每条例注该偏多少"（整段唯一偏移）。
     * 宿主拿到后随 program 一起发给模板页，模板把它交给播放器，
     * 播放时按表挪字 + 画引线。没有这张表时播放器行为与第 7 期完全一致。
     */
    labelAvoid: report.labelAvoid ?? null,
  });
}

/**
 * 从 `STEPS` 行式表里推导时间轴要求，交给 `scene_code` 阶段。
 *
 * 为什么要推导而不是原样透传：`scene_code` 阶段必须写出与 STEPS 完全一致的
 * `SIM.duration` 与时间锚点，否则 C5 会失败。把"要求"显式写成一句话，
 * 比让模型自己去 STEPS 文本里找要可靠得多。
 */
export function deriveTimeAxis(stepsText) {
  if (typeof stepsText !== 'string' || !stepsText.trim()) {
    return '未能从分步解析里读出时间锚点；请自行选取 0.5–6 秒的总时长，并保证各步 t0/t1 无缝相接。';
  }
  const t1s = [...stepsText.matchAll(/^t1:\s*([0-9.]+)\s*$/gm)].map((m) => Number(m[1]));
  const t0s = [...stepsText.matchAll(/^t0:\s*([0-9.]+)\s*$/gm)].map((m) => Number(m[1]));
  const duration = t1s.length ? Math.max(...t1s) : null;
  return [
    duration !== null ? `动画总时长 SIM.duration 必须等于 ${duration}（= 分步解析里最后一步的 t1）。` : '',
    t0s.length
      ? `分步解析里的时间锚点为：${t0s.map((t, i) => `第${i + 1}步 t0=${t}`).join('、')}。`
      : '',
    'VIEW 里的 SIM.duration 与 STEPS 的最后一步 t1 必须一致（C5 会逐点比对）。',
    'stateAt(t) 必须覆盖 [0, SIM.duration] 全程，不得返回 undefined。',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 收集事件流为数组（测试与"非流式"调用方用） */
export async function collectEvents(input) {
  const events = [];
  for await (const e of runPipeline(input)) events.push(e);
  return events;
}

/**
 * 从读题输出里取【题目】字段（v6 第 6 步）。
 *
 * 口径：
 *   · 模型写多长就收多长，**不截断**；
 *   · 没写 / 空 / 只写“无” ⇒ `未命名题目`；
 *   · 这个标题只给动画页与导出文件名用，不进入后续 Prompt。
 */
export function parseProblemTitle(text) {
  const src = String(text ?? '');
  /**
   * 模型实际写法比提示词松：常见 `【题目】xxx`、`【题目】\nxxx`、
   * `标题\nxxx`、`标题：xxx` 四种。v1.1.17 的纯图片题实测中模型写的是
   * `标题\n斜面弹簧连接物块`，旧正则只认 `【题目】` ⇒ 标题变成“未命名题目”，
   * 纯图片题的 PROBLEM 槽也跟着空掉。这里四种都认，仍然只取第一行标题。
   */
  const patterns = [
    /^【题目(?:标题)?】[ \t]*([^\n]+)$/m,
    /^【题目(?:标题)?】[ \t]*\n+([^\n]+)$/m,
    /^标题[ \t]*[:：]?[ \t]*([^\n]+)$/m,
    /^标题[ \t]*[:：]?[ \t]*\n+([^\n]+)$/m,
  ];
  for (const re of patterns) {
    const m = src.match(re);
    const raw = m?.[1]?.trim() ?? '';
    if (!raw || raw === '无' || raw === '（无）' || raw === '(无)') continue;
    return raw;
  }
  return '未命名题目';
}

/**
 * 动画程序 `PROBLEM` 槽的正文（v1.1.19 修）：
 *   · 有题面文字：原样用；
 *   · **纯图片题**（题面为空）：用读题输出里的标题；
 *   · 标题也取不到：用占位文案，**绝不让 PROBLEM 空着**。
 *
 * 为什么必须在这里兜底：v6 起 PROBLEM 不再由模型写，而是程序生成；旧实现直接
 * 把 `problem.text` 塞进去，纯图片题就是空串 ⇒ 清洗器按 `slot.empty` 硬拒，
 * 整题连 Dry-Run 都进不去（用户实测：只发图片 + 10 分钟无响应）。
 */
export function problemTextForSlots(problemText, readProblemText) {
  const direct = String(problemText ?? '').trim();
  if (direct) return direct;
  const title = parseProblemTitle(readProblemText);
  if (title !== '未命名题目') return title;
  /**
   * v1.1.19：模型没写【题目】时，标题也可以从转写正文里取第一句有内容的话。
   * 这和 `run_label` 的兜底是同一套规则；两处必须同源，否则动画页标题和
   * PROBLEM 槽会各说各话。
   */
  const derived = deriveEntryLabel(readProblemText);
  return derived ?? '（题目见图片）';
}

/**
 * 从一段文本里取一个**能当运行标题**的短标签（第 5 期追加）。
 *
 * 用途只有一个：**纯图片题**在开跑时题面是空的，标题只能显示"(未命名题目)"；
 * 读图转写跑完后，用转写的第一句有内容的话回填一次。
 *
 * 为什么要剥一层：读图转写的输出是**分节**的（`【题面复述】` / `【物体与姿态】`…），
 * 直接取第一行很可能只拿到一个小标题，那样标题会变成"【题面复述】"这种没信息量的东西。
 *
 * @param {string} text
 * @param {number} [max] 最长字符数（超出截断并加省略号）
 * @returns {string|null} 取不到就返回 null（调用方不要拿它当标题）
 */
export function deriveEntryLabel(text, max = 40) {
  const lines = String(text ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const raw of lines) {
    // 纯小标题行（整行只有一个【…】）跳过：它不是内容
    if (/^【[^】]{0,16}】$/.test(raw)) continue;
    const stripped = raw
      .replace(/^【[^】]{0,16}】/, '') // 行首的分节小标题
      .replace(/^[#>*\-\s]+/, '') // Markdown 装饰
      .replace(/\*\*/g, '')
      .trim();
    if (!stripped) continue;
    return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped;
  }
  return null;
}
