/**
 * §3.5 标记切分（零猜测）—— 把模型输出的文本切成 8 个槽位。
 *
 * 这是**模型文本变成 AnimationProgram 的唯一入口**。它的正确性直接决定：
 *   · 门禁能不能看到真实的槽位代码（切错 = 校验了一个不存在的程序）；
 *   · 第 2 期做的**行号级诊断**是不是真话（行号错位 = 诊断指错地方，而判据照样通过）。
 *
 * ── 两条硬约束（§3.5 / §21.2 第 4 条）
 *
 * ① **禁止用正则做 JS 结构切割**。
 *    本实现因此**只做"整行精确匹配"**，不做任何跨行贪婪匹配：
 *    每一行要么**恰好等于**某个标记（允许两侧空白），要么就是普通内容。
 *    于是 `const s = "/* @slot:setup *​/"` 这种**字符串里的假标记不会被误识别**
 *    —— 因为它那一行并不等于标记本身。代价是"标记必须独占一行"，
 *    这本来就是 §3.5 的书写协议。
 *
 * ② **缺标记 / 重复标记 / 未知标记名，一律判失败，不允许按顺序猜测槽位**。
 *    四种情形必须区分开（提示语与修复建议完全不同）：
 *      · 标记名不认识            → 未知标记
 *      · 同一个键出现两次        → 重复标记
 *      · 有 @slot 没有 @end      → 未闭合
 *      · 该出现的键没出现        → 缺标记
 *
 * ── 行号保真
 *
 * 切出来的槽位正文**保留原始行号**：非槽位行用空行占位，槽位起始行之前补空行。
 * 这样"槽位正文第 N 行"与"模型输出第 N 行"**逐字对应**，第 2 期的埋点与
 * `buildLineMap` 可以直接沿用，不需要第二套坐标系统。
 * 同时给出 `firstLine`（槽位正文在原文中的起始行号，1 基），供只做行偏移的场景使用。
 */

import { SLOT_KEY_NAMES, SLOT_MARKER_PREFIX, SLOT_MARKER_END } from '../../contracts/spec/frozen-keys.mjs';

/** 标记行必须**恰好**长这样（两侧可有空白）；不做任何模糊匹配 */
const MARKER_RE = /^\s*\/\*\s*@slot:([^\s*]+)\s*\*\/\s*$/;
const END_RE = /^\s*\/\*\s*@end\s*\*\/\s*$/;

/**
 * @typedef {object} SplitDiagnostic
 * @property {string} code   机器可读规则号
 * @property {string} message 面向人的中文说明
 * @property {number} [line]  1 基行号（在**模型输出**中的位置）
 * @property {string} [slot]  相关槽位
 */

/** 把某一行判定成标记行、结束行或普通行 */
function classifyLine(line) {
  const m = MARKER_RE.exec(line);
  if (m) return { kind: 'marker', name: m[1] };
  if (END_RE.test(line)) return { kind: 'end' };
  return { kind: 'text' };
}

/**
 * 切分模型输出。
 *
 * @param {string} text 模型输出原文（含标记）
 * @param {{ required?: readonly string[] }} [opts] 要求必须出现的键，默认 §3.2 的 8 个冻结键名
 * @returns {{
 *   ok: boolean,
 *   slots: Record<string, string>,
 *   firstLine: Record<string, number>,
 *   diagnostics: SplitDiagnostic[],
 *   order: string[],
 *   strayLines: number[],
 * }}
 */
export function splitSlots(text, opts = {}) {
  const required = opts.required ?? SLOT_KEY_NAMES;
  const known = new Set(SLOT_KEY_NAMES);
  const src = String(text ?? '');
  const lines = src.split('\n');

  /** @type {Array<{ name: string, markerLine: number, endLine: number|null }>} */
  const found = [];
  /** @type {SplitDiagnostic[]} */
  const diagnostics = [];
  /** @type {number[]} 标记之外的散落文本行（去掉纯空白行） */
  const strayLines = [];

  let current = null; // 正在收集的标记
  const seen = new Map(); // 键名 → 首次出现的行号

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const cls = classifyLine(lines[i]);

    if (cls.kind === 'marker') {
      if (current) {
        // 上一个标记还没结束就遇到了新标记
        diagnostics.push({
          code: 'marker.unclosed',
          slot: current.name,
          line: current.markerLine,
          message: `槽位 ${current.name} 的标记没有以 /* @end */ 结束（第 ${lineNo} 行又出现了新的 @slot）`,
        });
        current = null;
      }
      if (!known.has(cls.name)) {
        diagnostics.push({
          code: 'marker.unknown',
          line: lineNo,
          message: `未知槽位名 "${cls.name}"`,
          // 特别提示 v2 旧名：它在导入路径可以被归一化，但**切分路径不归一化**（§9.1）
          ...(cls.name === 'scene_spec' ? { hint: 'scene_spec 是 v2 旧名，§3.5 的标记名必须与 §3.2 的 8 个键名逐字一致' } : {}),
        });
        continue;
      }
      if (seen.has(cls.name)) {
        diagnostics.push({
          code: 'marker.duplicate',
          slot: cls.name,
          line: lineNo,
          message: `槽位 ${cls.name} 出现了第二次（首次在第 ${seen.get(cls.name)} 行）`,
        });
        continue;
      }
      seen.set(cls.name, lineNo);
      current = { name: cls.name, markerLine: lineNo, endLine: null };
      found.push(current);
      continue;
    }

    if (cls.kind === 'end') {
      if (!current) {
        diagnostics.push({ code: 'marker.stray-end', line: lineNo, message: '出现了没有对应 @slot 的 /* @end */' });
        continue;
      }
      current.endLine = lineNo;
      current = null;
      continue;
    }

    if (!current && lines[i].trim() !== '') strayLines.push(lineNo);
  }

  if (current) {
    diagnostics.push({
      code: 'marker.unclosed',
      slot: current.name,
      line: current.markerLine,
      message: `槽位 ${current.name} 的标记没有以 /* @end */ 结束（文件到末尾仍未闭合）`,
    });
  }

  /* ── 组装每个槽位的正文（保留原始行号） ── */

  /** @type {Record<string, string>} */
  const slots = {};
  /** @type {Record<string, number>} */
  const firstLine = {};
  /** @type {string[]} */
  const order = [];

  for (const item of found) {
    if (item.endLine === null) continue; // 未闭合的不要产出半截内容
    order.push(item.name);

    // 正文行号区间：markerLine+1 … endLine-1（1 基）
    const bodyStart = item.markerLine + 1;
    const bodyEnd = item.endLine - 1;
    const bodyLines = bodyEnd >= bodyStart ? lines.slice(bodyStart - 1, bodyEnd) : [];

    // 去掉首尾**纯空行**（不 trim 每行内容，逐字保留缩进与行内空白）
    let from = 0;
    let to = bodyLines.length;
    while (from < to && bodyLines[from].trim() === '') from += 1;
    while (to > from && bodyLines[to - 1].trim() === '') to -= 1;
    const kept = bodyLines.slice(from, to);

    // ⚠ 用空行占位把行号补齐到原始位置：这样"槽位内第 N 行"== "模型输出第 N 行"
    //   不变式：`firstLine - 1 === pad 的行数`（首行之前必须正好有 firstLine-1 个空行）。
    //   `from` 是被吃掉的首部空行数，它们**本来就在** bodyLines 的空行区间里，
    //   因此 pad 只需补到 `bodyStart - 1`，不能再加 `from`（加了会整体错一行）。
    const padCount = bodyStart - 1;
    const pad = new Array(padCount).fill('');
    slots[item.name] = [...pad, ...kept].join('\n');
    firstLine[item.name] = bodyStart + from; // 第一个非空行的原始行号
  }

  /* ── 缺失与空槽位 ── */

  for (const key of required) {
    const raw = slots[key];
    if (raw === undefined) {
      diagnostics.push({
        code: 'marker.missing',
        slot: key,
        message: `缺少槽位 ${key} 的标记`,
        hint: `每个槽位都要写成 /* @slot:${key} */ … /* @end */（§3.5）`,
      });
    } else if (raw.trim() === '' && key !== 'ANSWERS') {
      // §3.2 审计 2：空字符串视为该槽位缺失，按对应检查报错，**不得静默通过**
      // ⚠ 例外：C7 已删（2026-10-22），ANSWERS 允许为空；程序形状仍保留这个键。
      diagnostics.push({
        code: 'slot.empty',
        slot: key,
        message: `槽位 ${key} 的正文是空的`,
        hint: '空槽位按"缺失"处理，不会被静默接受（§3.2 审计 2）',
      });
    }
  }

  if (strayLines.length) {
    diagnostics.push({
      code: 'text.outside-markers',
      line: strayLines[0],
      message: `标记之外还有 ${strayLines.length} 行非空文本（首个在第 ${strayLines[0]} 行）`,
      hint: '通常是模型多写的解释；这些内容不会进入任何槽位',
    });
  }

  // 只有"硬失败"才让 ok=false；散落文本属于告警
  const hardCodes = new Set([
    'marker.unknown',
    'marker.duplicate',
    'marker.unclosed',
    'marker.missing',
    'marker.stray-end',
    'slot.empty',
  ]);
  const ok = !diagnostics.some((d) => hardCodes.has(d.code));

  return { ok, slots, firstLine, diagnostics, order, strayLines };
}

/** 诊断 → 面向人的多行文本 */
export function formatSplitDiagnostics(diagnostics) {
  return diagnostics
    .map((d) => {
      const where = d.line ? `第 ${d.line} 行` : d.slot ? `槽位 ${d.slot}` : '—';
      const head = `  ✗ [${d.code}] ${where}：${d.message}`;
      return d.hint ? `${head}\n      → ${d.hint}` : head;
    })
    .join('\n');
}
