/**
 * 切分结果 → `AnimationProgram`（§3.6 唯一事实来源）。
 *
 * 职责：把 §3.5 的切分产物落成契约形状，并给出**行号映射**（第 2 期诊断要靠它）。
 *
 * 与 `AnimationProgram` 契约的对应关系（`contracts/animation-program.schema.json`）：
 *   format          = 'od-animation-program'
 *   version         = 1
 *   templateVersion / sdkVersion  ← `contracts/spec/frozen-keys.mjs`（唯一来源）
 *   slots           = 恰好 8 个冻结键名
 *   provenance      ← 生成溯源（第 3 期接模型后由编排填入）
 */

import {
  SLOT_KEY_NAMES,
  ANIMATION_PROGRAM_FORMAT,
  ANIMATION_PROGRAM_VERSION,
  TEMPLATE_VERSION,
  SDK_VERSION,
} from '../../contracts/spec/frozen-keys.mjs';
import { splitSlots, formatSplitDiagnostics } from './marker-split.mjs';
import { applyRegexRules } from './regex-rules.mjs';

/** 切分/装配失败时抛这个：带结构化诊断，便于 UI 与自愈回灌逐条展示 */
export class ProgramBuildError extends Error {
  constructor(message, diagnostics = []) {
    super(diagnostics.length ? `${message}\n${formatSplitDiagnostics(diagnostics)}` : message);
    this.name = 'ProgramBuildError';
    this.diagnostics = diagnostics;
  }
}

/**
 * 校验一个对象是不是合法的 `AnimationProgram` 形状（**只做结构，不做语义**）。
 * 语义校验（C1 等）在 `core/lint/`。
 *
 * @param {unknown} program
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function checkProgramShape(program) {
  const problems = [];
  if (!program || typeof program !== 'object') return { ok: false, problems: ['program 不是对象'] };
  if (program.format !== ANIMATION_PROGRAM_FORMAT) {
    problems.push(`format 必须是 "${ANIMATION_PROGRAM_FORMAT}"，实际 ${JSON.stringify(program.format)}`);
  }
  if (program.version !== ANIMATION_PROGRAM_VERSION) {
    problems.push(`version 必须是 ${ANIMATION_PROGRAM_VERSION}，实际 ${JSON.stringify(program.version)}`);
  }
  const slots = program.slots;
  if (!slots || typeof slots !== 'object') {
    problems.push('slots 缺失或不是对象');
    return { ok: false, problems };
  }
  const keys = Object.keys(slots);
  for (const key of SLOT_KEY_NAMES) {
    if (!(key in slots)) problems.push(`slots 缺少键 ${key}`);
    else if (typeof slots[key] !== 'string') problems.push(`slots.${key} 必须是字符串`);
    else if (slots[key].length === 0) problems.push(`slots.${key} 是空字符串（空串视为缺失，§3.2 审计 2）`);
  }
  for (const key of keys) {
    if (!SLOT_KEY_NAMES.includes(key)) problems.push(`slots 出现多余的键 ${key}（§3.2 不允许第 9 个键）`);
  }
  // 冻结键序：契约要求 required 顺序固定（这里检查"可枚举顺序"是否一致，便于发现拼装错误）
  const orderOk = keys.every((k, i) => k === SLOT_KEY_NAMES[i]);
  if (keys.length === SLOT_KEY_NAMES.length && !orderOk) {
    problems.push(`slots 的键序与冻结键序不一致：实际 [${keys.join(', ')}]`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * 模型输出 → `AnimationProgram`。
 *
 * @param {string} text 模型输出原文
 * @param {object} [opts]
 * @param {object} [opts.provenance] 溯源（model / promptHash / knowledgecardHash / generatedAt）
 * @param {object[]} [opts.regexRules] §12 兜底清洗规则（在切分**之后**做点状修补）
 * @returns {{ program: object, lineMap: object, diagnostics: object[], layout: object }}
 * @throws {ProgramBuildError} 切分出现硬失败时（**不静默产出半成品**）
 */
export function buildProgramFromText(text, opts = {}) {
  const split = splitSlots(text, opts);
  if (!split.ok) {
    throw new ProgramBuildError('模型输出无法切成 8 个槽位：', split.diagnostics);
  }

  // §12 兜底：只在切分成功之后做点状修补，**绝不用正则去"补"缺失的标记**
  const { slots, applied } = applyRegexRules(split.slots, opts.regexRules ?? []);

  const program = {
    format: ANIMATION_PROGRAM_FORMAT,
    version: ANIMATION_PROGRAM_VERSION,
    templateVersion: TEMPLATE_VERSION,
    sdkVersion: SDK_VERSION,
    slots: Object.fromEntries(SLOT_KEY_NAMES.map((k) => [k, slots[k]])),
    ...(opts.provenance ? { provenance: opts.provenance } : {}),
  };

  const shape = checkProgramShape(program);
  if (!shape.ok) {
    throw new ProgramBuildError(
      '切分结果不符合 AnimationProgram 形状：',
      shape.problems.map((p) => ({ code: 'program.shape', message: p })),
    );
  }

  return {
    program,
    /** 行号映射：`lineOffset[slot]` = 槽位内第 1 行在**模型输出**中的行号 − 1 */
    lineMap: buildLineOffsets(split.firstLine),
    diagnostics: split.diagnostics,
    layout: { order: split.order, firstLine: split.firstLine, strayLines: split.strayLines, appliedRules: applied },
  };
}

/**
 * **自愈修复**的合并入口（第 4 期 · §8.1 / §14.5）。
 *
 * 与 `buildProgramFromText()` 的区别只有一条，但很关键：**不要求 8 个槽位齐全**。
 *
 * 为什么必须有这个入口：自愈的整个意义就是"只重发出错的槽位"（§8.1）。
 * 若沿用 `buildProgramFromText()`，模型只输出 1 个槽位时切分会判 `marker.missing`，
 * 于是"只改 drawFrame"这件事在**接口层就做不到** —— 那就退化成了整块重生成，
 * §3.2 冻结 8 键名所换来的粒度也就白费了。
 *
 * 合并规则：
 *   · 模型这一轮输出的槽位 → **覆盖**旧值（并记进 `updated`）；
 *   · 没输出的槽位 → 原样保留（并记进 `kept`）；
 *   · 出现了**未知标记名**、或输出里一个合法槽位都没有 → 抛 `ProgramBuildError`
 *     （这两种都是"模型没照协议做"，静默接受会让报告与代码对不上）。
 *
 * ⚠ `lineMap` 只覆盖**本轮更新的**槽位：旧槽位保持原值，它们的行号在上一轮就已经算过了。
 *
 * @param {string} text 模型这一轮的输出
 * @param {Record<string,string>} previousSlots 上一轮的 8 个槽位
 * @param {object} [opts] `regexRules`（§12 兜底）/ `provenance`
 * @returns {{ program: object, lineMap: object, diagnostics: object[], updated: string[], kept: string[] }}
 * @throws {ProgramBuildError}
 */
export function mergeRepairOutput(text, previousSlots, opts = {}) {
  // `required: []` ⇒ 只做"标记结构正确性"的检查，不因为缺其它槽位而报错
  const split = splitSlots(text, { required: [] });

  const unknown = split.diagnostics.filter((d) => d.code === 'marker.unknown');
  if (unknown.length) {
    throw new ProgramBuildError('修复输出里出现了未知槽位名：', unknown);
  }

  const updated = split.order.filter((name) => SLOT_KEY_NAMES.includes(name));
  if (!updated.length) {
    throw new ProgramBuildError('修复输出里没有出现任何合法槽位标记：', [
      { code: 'repair.no-slots', message: '这一轮没有产出可用内容（既没有 @slot 标记，也没有任何合法槽位）' },
      ...split.diagnostics,
    ]);
  }

  const merged = {};
  for (const key of SLOT_KEY_NAMES) {
    const fresh = updated.includes(key) ? split.slots[key] : undefined;
    merged[key] = typeof fresh === 'string' && fresh.trim() !== '' ? fresh : (previousSlots?.[key] ?? '');
  }

  // §12 兜底只作用于**本轮更新**的槽位：对保留槽位重复跑一遍规则没有意义，
  // 而且万一规则不是幂等的，会静默改掉上一轮已经通过校验的代码。
  const toPatch = Object.fromEntries(updated.map((k) => [k, merged[k]]));
  const { slots: patched, applied } = applyRegexRules(toPatch, opts.regexRules ?? []);
  for (const k of updated) merged[k] = patched[k];

  const program = {
    format: ANIMATION_PROGRAM_FORMAT,
    version: ANIMATION_PROGRAM_VERSION,
    templateVersion: TEMPLATE_VERSION,
    sdkVersion: SDK_VERSION,
    slots: merged,
    ...(opts.provenance ? { provenance: opts.provenance } : {}),
  };

  // 只检查"形状"里与本轮有关的部分：8 键齐全 + 无第 9 键
  const shape = checkProgramShape(program);
  if (!shape.ok) {
    throw new ProgramBuildError(
      '修复后的程序不符合 AnimationProgram 形状：',
      shape.problems.map((p) => ({ code: 'program.shape', message: p })),
    );
  }

  const freshFirstLine = Object.fromEntries(updated.filter((k) => split.firstLine[k] !== undefined).map((k) => [k, split.firstLine[k]]));

  return {
    program,
    lineMap: buildLineOffsets(freshFirstLine),
    diagnostics: split.diagnostics,
    updated,
    kept: SLOT_KEY_NAMES.filter((k) => !updated.includes(k)),
    layout: { order: split.order, firstLine: split.firstLine, strayLines: split.strayLines, appliedRules: applied },
  };
}

/**
 * 由"槽位首个非空行的原始行号"推出每个槽位的**行偏移**。
 *
 * 诊断层把它加到槽位内行号上，就得到模型输出里的真实行号。
 * 例如 `q01` 的 `stateAt` 正文从原文第 40 行开始 ⇒ `lineOffset.stateAt = 39`，
 * 槽位内第 6 行的问题就报"第 45 行"。
 *
 * @param {Record<string, number>} firstLine
 * @returns {Record<string, number>}
 */
export function buildLineOffsets(firstLine) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [slot, line] of Object.entries(firstLine ?? {})) {
    if (typeof line === 'number' && line > 0) out[slot] = line - 1;
  }
  return out;
}

/**
 * 把槽位内行号翻译成原始输出的行号。
 * @param {Record<string, number>} lineOffsets
 * @param {string} slot
 * @param {number} lineInSlot 1 基
 */
export function toSourceLine(lineOffsets, slot, lineInSlot) {
  const offset = lineOffsets?.[slot];
  return typeof offset === 'number' ? lineInSlot + offset : lineInSlot;
}
