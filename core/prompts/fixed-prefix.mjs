/**
 * Prompt 的**固定前缀**（§10.2）—— prompt cache 命中率 = 真实成本。
 *
 * §10.2 的注入顺序：
 *
 *   [固定前缀]  角色与输出规约 → 模板骨架 → SDK 签名摘要
 *   [条件段]    命中的世界书词条（按 order；分槽）      ← **第 3 期为空槽**（第 5 期接入）
 *   [任务段]    题目 + 图片 + 已知条件
 *
 * ⚠ **前缀必须逐字节稳定**：不得插入任何题目相关信息。
 *   一旦前缀里出现了题面/图片，prompt cache 每次都会失效，真实成本成倍上升。
 *   因此本模块把"前缀"与"任务段"在**类型与函数上就分开**：
 *   `buildFixedPrefix()` **不接受**题目参数，从签名上就杜绝误用。
 *
 * ⚠ 但**图片尤其危险**：`buildTaskSegment()` 才收图片，且 `promptHash` 只覆盖前缀与配置，
 *   **不覆盖任务段** —— 所以换一张图不会改变 `promptHash`。门禁用例就钉这一条。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sha256 } from '../../contracts/generate-contracts.mjs';
import { PROJECT_ROOT } from '../../tools/paths.mjs';
import {
  SLOT_KEY_NAMES,
  TEMPLATE_VERSION,
  SDK_VERSION,
} from '../../contracts/spec/frozen-keys.mjs';
import { buildSlotConditional, renderEntryBlock } from '../knowledgecard/engine.mjs';
import { ROLE_AND_OUTPUT_RULES, STAGE_ROLES } from './templates.mjs';

/** 会写代码、需要 SDK 清单的阶段 */
const CODE_STAGES = new Set(['scene_code', 'repair']);

/** 有自己前缀的阶段（顺序固定 ⇒ 哈希可复现） */
export const PREFIX_STAGES = Object.freeze(['read_problem', 'read_problem_v2', 'solve', 'breakdown', 'analysis', 'scene_code', 'repair', 'couple']);

/** SDK 签名摘要的落点（由 `sdk/generate-signature-summary.mjs` 生成；门禁 ② 保证它与 SDK 导出面一致） */
const SIGNATURE_SUMMARY_PATH = join(PROJECT_ROOT, 'sdk', 'signature-summary.md');

let cachedSignature = null;

/** 读取 SDK 签名摘要（去掉文件头部的说明行，只保留 ``` 内的正文） */
export function loadSignatureSummary() {
  if (cachedSignature !== null) return cachedSignature;
  const raw = readFileSync(SIGNATURE_SUMMARY_PATH, 'utf8');
  const m = /```\n([\s\S]*?)\n```/.exec(raw);
  if (!m) {
    throw new Error(`SDK 签名摘要格式异常（找不到代码块）：${SIGNATURE_SUMMARY_PATH}`);
  }
  cachedSignature = m[1];
  return cachedSignature;
}

/**
 * 模板骨架：8 个冻结键名 + §3.5 标记协议 + 冻结键序说明。
 *
 * 这段内容是**契约的可读投影**，随 `SLOT_KEY_NAMES` 一起生成，
 * 因此键名/键序不可能和契约漂移（改了契约，这里跟着变，前缀哈希也就跟着变——这是对的）。
 */
export function buildTemplateSkeleton() {
  const list = SLOT_KEY_NAMES.map((k, i) => `  ${i + 1}. ${k}`).join('\n');
  return [
    `【模板骨架 · templateVersion ${TEMPLATE_VERSION} · sdkVersion ${SDK_VERSION}】`,
    '你要填充恰好下面这 8 个槽位（键名大小写敏感，键序照此排列）：',
    list,
    '',
    '每个槽位用标记包住，标记**独占一行**：',
    '  /* @slot:KEY */',
    '  …槽位正文…',
    '  /* @end */',
    '',
    '规则：',
    '· 8 个槽位全部给齐、各出现一次；标记名逐字照抄（程序按标记取槽位，不会按顺序猜测槽位）；',
    '· 每个槽位的正文非空；',
    '· 标记之外只留空行，其余文字不进任何槽位。',
  ].join('\n');
}

/**
 * 某一阶段前缀的**各块**（角色 / 骨架 / SDK 摘要）。
 *
 * ⚠ 未知阶段一律回落成**完整前缀**（`scene_code` 那一套）—— 宁可多发，也不让某段缺东西。
 */
function partsFor(stage) {
  const key = STAGE_ROLES[stage] ? stage : 'scene_code';
  const role = STAGE_ROLES[key];
  const withCode = CODE_STAGES.has(key);
  return {
    role,
    // 新链路 scene_code / repair 都只写 drawFrame，不再需要 8 槽位骨架；只保留 SDK 摘要
    skeleton: '',
    sdk: withCode ? loadSignatureSummary() : '',
  };
}

/** 把各块拼成前缀正文（**纯函数**：哈希计算也要走它，避免递归） */
function textOf(parts) {
  return [
    parts.role,
    parts.skeleton ? `════════════════════ 模板骨架 ════════════════════\n${parts.skeleton}` : '',
    parts.sdk ? `════════════════════ SDK 签名摘要 ════════════════════\n${parts.sdk}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

let cachedHash = null;

/**
 * **整版指纹**：覆盖"每个阶段的前缀 + 两个版本号"，顺序固定。
 *
 * 为什么不是"只算一条前缀"：第 9 期起前缀按阶段分了五条（+ repair），
 * 任何一条被改都意味着"这一版的说明书变了"，溯源哈希必须跟着变。
 */
export function promptHashValue() {
  if (cachedHash !== null) return cachedHash;
  const chunks = [...PREFIX_STAGES].map((s) => textOf(partsFor(s)));
  cachedHash = sha256([...chunks, TEMPLATE_VERSION, SDK_VERSION].join('\u0000'));
  return cachedHash;
}

/**
 * **某一阶段的前缀**（不含任何题目信息）。
 *
 * @param {'read_problem'|'read_problem_v2'|'solve'|'breakdown'|'analysis'|'scene_code'|'repair'} [stage] 省略 = 完整前缀（等同 scene_code）
 * @returns {{ stage: string, text: string, parts: { role: string, skeleton: string, sdk: string }, promptHash: string }}
 */
export function buildStagePrefix(stage = 'scene_code') {
  const parts = partsFor(stage);
  return {
    stage: STAGE_ROLES[stage] ? stage : 'scene_code',
    text: textOf(parts),
    parts,
    promptHash: promptHashValue(),
  };
}

/**
 * **完整前缀**（= 要写代码的阶段用的那套：角色 + 模板骨架 + SDK 签名摘要）。
 *
 * ⚠ 保留这个"不接受参数"的入口，是因为门禁 ⑱ 用它从签名上堵死"把题面塞进前缀"。
 *   按阶段取前缀请用 `buildStagePrefix(stage)`。
 *
 * @returns {{ text: string, parts: { role: string, skeleton: string, sdk: string }, promptHash: string }}
 */
export function buildFixedPrefix() {
  const { text, parts, promptHash } = buildStagePrefix('scene_code');
  return { text, parts, promptHash };
}

/**
 * **条件段**：命中的世界书词条（§9.2 / §10.2）+ 本阶段指令。
 *
 * ── 第 5 期的两点变化（都是"加法"，世界书词条的标记格式一字未改）
 *
 * ① **分槽**：词条按自己的槽位渲染来源标记（`【世界书·解题：…】` / `【世界书·动画建模：…】`），
 *    渲染实现落在 `core/knowledgecard/engine.mjs`（浏览器侧的预览器用的是它的逐字节副本 ⇒ W10）。
 * ② **本阶段指令有了自己的标签**：第 3 期起编排层把 `prompt.system` 借这个位置塞进来，
 *    并且**复用了世界书的标记**。第 5 期真词条进来后，两种东西会共用同一个标记 ⇒
 *    溯源分不清"这条是命中词条还是阶段指令"。现在指令走 `【本阶段指令：<label>】`。
 *
 * @param {Array<{ title: string, content: string, slot?: 'solve'|'scene_code' }>} [entries]
 * @param {{ slot?: 'solve'|'scene_code', instruction?: string|null, instructionLabel?: string|null, segment?: string|null }} [opts]
 */
export function buildConditionalSegment(entries = [], opts = {}) {
  const slot = opts.slot ?? 'solve';
  // 优先用调用方直接给出的、**已由引擎渲染好**的段落：编排层就是这么用的，
  // 这样"进 system 消息的那段文本"与预览器算出来的东西是同一份字节。
  const rendered =
    typeof opts.segment === 'string'
      ? opts.segment
      : entries.map((e) => renderEntryBlock(e.slot ?? slot, e.title, e.content)).join('\n\n');

  return {
    ...buildSlotConditional({
      slot,
      instruction: opts.instruction ?? null,
      instructionLabel: opts.instructionLabel ?? null,
      segment: rendered,
    }),
    // `entryCount` 是第 3 期就有的字段（调用方与取证用例都在读它），保留不动
    entryCount: entries.length,
  };
}

/**
 * **任务段**：题目 + 图片 + 已知条件（§10.2）。
 *
 * ⚠ 图片**只能**出现在这里。返回值里的 `imageCount` 供调用方决定是否走多模态。
 *
 * @param {{ text: string, description?: string, knownConditions?: string, images?: unknown[] }} input
 */
export function buildTaskSegment(input) {
  const parts = ['════════════════════ 题目 ════════════════════', input.text ?? ''];
  if (input.knownConditions) {
    parts.push('', '【已知条件】', input.knownConditions);
  }
  if (input.description) {
    // §11.3 的人工兜底入口：图片入口被禁用时，靠这段文字描述补几何关系
    parts.push('', '【配图补充描述（由用户提供，不是模型看图所得）】', input.description);
  }
  const images = Array.isArray(input.images) ? input.images : [];
  if (images.length) {
    parts.push('', `【随附题目图片 ${images.length} 张】请结合图片理解题意。`);
  }
  return { text: parts.join('\n'), imageCount: images.length };
}

/**
 * 组装完整消息：`[固定前缀] + [条件段] + [任务段]` 合成一条 system/user 消息。
 *
 * 图片以 §11.1 的 OpenAI 兼容 `content` 数组形式挂在 **user 消息**上（任务段），
 * 由 `core/gateway/model-client.mjs` 的 `buildUserMessage()` 完成编码。
 *
 * @param {object} input
 * @param {{ text: string, description?: string, knownConditions?: string }} input.problem
 * @param {unknown[]} [input.images]
 * @param {Array<{ title: string, content: string, slot?: string }>} [input.knowledgecardEntries] 命中词条（形状化）
 * @param {string|null} [input.knowledgecardSegment] 引擎**已渲染**的本槽拼接内容（优先于 knowledgecardEntries）
 * @param {string|null} [input.instructions] 本阶段指令正文（`prompt.system`）
 * @param {string|null} [input.instructionLabel] 本阶段指令的标签（`prompt.label`）
 * @param {'solve'|'scene_code'} [input.stageSlot] 本阶段对应哪个世界书槽位
 * @returns {{
 *   messages: Array<object>,
 *   promptHash: string,
 *   prefixBytes: number,
 *   segments: { prefix: string, conditional: string, task: string, instruction: string, knowledgecard: string },
 *   imageCount: number,
 * }}
 */
/**
 * `mode` 恒为 `'BOTH'`：v6 已没有全局“数值/符号”开关，字段保留只为让报告/历史/导出形状不漂。
 */
export function assemblePrompt({
  problem,
  images = [],
  knowledgecardEntries = [],
  knowledgecardSegment = null,
  instructions = null,
  instructionLabel = null,
  stageSlot = 'solve',
  stage = null,
} = {}) {
  /**
   * 第 9 期：前缀**按阶段取**。`stage` 省略时退化为"完整前缀"（向后兼容；
   * 生产链的每个阶段都会显式传自己的 `stage`）。
   */
  const prefix = stage ? buildStagePrefix(stage) : buildFixedPrefix();
  const conditional = buildConditionalSegment(knowledgecardEntries, {
    slot: stageSlot,
    instruction: instructions,
    instructionLabel,
    segment: knowledgecardSegment,
  });
  const task = buildTaskSegment({ ...problem, images });
  const taskText = task.text;

  // system 消息承载固定前缀 + 条件段（都与"这一道题的具体图片"无关的部分放这里）
  const systemText = [prefix.text, conditional.text].filter(Boolean).join('\n\n');

  return {
    messages: [
      { role: 'system', content: systemText },
      { role: 'user', content: taskText },
    ],
    promptHash: prefix.promptHash,
    prefixBytes: Buffer.byteLength(prefix.text, 'utf8'),
    /**
     * v6：恒为 `'BOTH'`（不再有全局数值/符号开关）。
     * 字段保留只为让报告、历史与导出的既有形状不漂。
     */
    mode: 'BOTH',
    segments: {
      prefix: prefix.text,
      conditional: conditional.text,
      task: taskText,
      // 条件段的两个组成部分分开给出：审计"命中了什么"与"指令是什么"要看它们各自的内容
      instruction: conditional.instructionText,
      knowledgecard: conditional.knowledgecardText,
    },
    imageCount: task.imageCount,
  };
}

/** 测试/自检用：清掉签名摘要缓存（改了摘要文件后需要重新读） */
export function _resetSignatureCache() {
  cachedSignature = null;
}
