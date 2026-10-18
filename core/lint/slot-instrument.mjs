/**
 * 槽位埋点与行号映射（第 2 期 · M26/M27 的地基）。
 *
 * 为什么需要它：§18 期 2 的验收是"注入 NaN / 瞬移 / 时间断裂 / 死循环 / require，
 * 全部被拦下并给出**行号级**诊断"。C1 靠 acorn 已经能给静态的行列号，但
 *   · C3（非有限值）——NaN 不是异常，是**悄悄流出去的数**；
 *   · C4/C6（瞬移 / 边界跳变）——判据只看到"坐标/状态对不上"，看不到是哪一行写的；
 *   · C2（死循环）——代码卡在循环里，连异常都没有；
 * 这三种情况原实现只能报"t = 0.42 时刻 state.x = NaN"，指不到源码行。
 *
 * 本模块的解法是**在槽位源码里插探针，且不改变行号**：
 *   · 只在 `{…}` / `case` 的语句表里插（`if (c) stmt;` 这种无花括号的单语句体不插，
 *     否则 `else __odMark(1); b();` 会变成两个语句、直接语法错误）；
 *   · 插入文本**不含换行**，插在语句起始位置 ⇒ 行数与列布局之外的偏移都不变，
 *     因此"槽位第 N 行"始终等于"作者看到的第 N 行"，诊断可以逐字回指源码；
 *   · 两种模式：
 *       `mark`     —— `__odMark(槽位号, 行号)`：极廉价，记录"当前正在执行哪一行"。
 *                     死循环被 Worker 硬终止后，这个值就是**卡住的那一行**。
 *       `snapshot` —— `__odSnap(槽位号, 行号, {所有函数级绑定})`：诊断专用，
 *                     只在归因重放时用，能定位"哪一行第一次算出非有限值 / 哪一行写的值跳变"。
 *
 * 埋点只在 Dry-Run 里开：成品页（浏览器播放）走的是未埋点的装配，§13.1「屏幕上看到的 = 校验过的」
 * 指的是**同一份采样逻辑**，不是同一份字符串——两者都由 `animation-runtime.mjs` 的
 * `instantiate / sampleFrame / scanAll` 驱动，不存在第二套采样实现。
 */

import { parseSlot, nodeLoc } from './acorn-parser.mjs';
import { SLOT_PARAMS } from './contract-lint.mjs';
import * as Runtime from '../../sdk/runtime/animation-runtime.mjs';

/** 会被埋点的槽位（`VIEW` 只在装配期跑一次，不参与逐帧诊断） */
export const PROBE_SLOTS = Object.freeze(['setup', 'stateAt', 'drawFrame', 'readouts']);

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'sourceType']);

export function slotIndexOf(slot) {
  return PROBE_SLOTS.indexOf(slot);
}

/** 收集模式绑定名（`var` 在函数级可见，因此函数体内所有 `var` 都算；不进入嵌套函数） */
function collectBindings(ast) {
  const root = ast.body.find((n) => FUNCTION_TYPES.has(n.type));
  if (!root) return [];
  const names = new Set();

  const declarePattern = (node) => {
    if (!node) return;
    switch (node.type) {
      case 'Identifier':
        names.add(node.name);
        break;
      case 'ObjectPattern':
        for (const p of node.properties) declarePattern(p.type === 'RestElement' ? p.argument : p.value ?? p.key);
        break;
      case 'ArrayPattern':
        for (const el of node.elements) declarePattern(el);
        break;
      case 'AssignmentPattern':
        declarePattern(node.left);
        break;
      case 'RestElement':
        declarePattern(node.argument);
        break;
      default:
        break;
    }
  };

  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (FUNCTION_TYPES.has(node.type) && node !== root) return; // 嵌套函数有自己的作用域
    if (node.type === 'VariableDeclaration') for (const d of node.declarations) declarePattern(d.id);
    // ⚠ 不要把合成壳自己的名字（`__slot__`）算进来：埋点后的代码要重新装配进
    // `buildProgram`，那时外壳早已不存在，引用它会直接 ReferenceError、把整次快照打成 null。
    if (node.type === 'FunctionDeclaration' && node.id && node !== root) names.add(node.id.name);
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) for (const c of child) visit(c);
      else if (child && typeof child.type === 'string') visit(child);
    }
  };

  visit(root);
  names.delete('undefined');
  return [...names].sort();
}

/** 语句是不是指令序言（`"use strict";`）——插在它前面会破坏指令语义 */
function isDirective(node) {
  return node?.type === 'ExpressionStatement' && node.expression?.type === 'Literal' && typeof node.expression.value === 'string';
}

/**
 * 槽位源码 → 埋点后的源码。
 *
 * @param {string} code          槽位原文
 * @param {object} opts
 * @param {string} opts.slot     槽位名（仅用于诊断与参数表）
 * @param {'mark'|'snapshot'} [opts.mode='mark']
 * @returns {{code:string, marks:number, bindings:string[], skipped:string|null}}
 */
export function instrumentSlot(code, opts = {}) {
  const { slot, mode = 'mark' } = opts;
  const params = opts.params ?? SLOT_PARAMS[slot] ?? [];
  const slotIndex = opts.slotIndex ?? slotIndexOf(slot);
  const parsed = parseSlot(code, slot, params);
  if (!parsed.ast) return { code, marks: 0, bindings: [], skipped: 'syntax-error' };

  const headLines = parsed.headLines ?? 1;
  const headOffset = parsed.headOffset ?? 0;
  const bindings = mode === 'snapshot' ? collectBindings(parsed.ast) : [];
  const insertions = [];

  const addFromList = (list) => {
    for (const stmt of list ?? []) {
      if (!stmt || typeof stmt.type !== 'string' || isDirective(stmt)) continue;
      // ⚠ 必须减掉合成函数壳的偏移：AST 的 `start` 是相对"包装后源码"的坐标
      insertions.push({ offset: stmt.start - headOffset, line: nodeLoc(stmt, headLines).line });
    }
  };

  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    // snapshot 模式只在槽位自身函数作用域内插点：跨函数引用的绑定名不一定在作用域里
    if (mode === 'snapshot' && FUNCTION_TYPES.has(node.type) && node !== parsed.ast.body[0]) return;
    if (node.type === 'BlockStatement') addFromList(node.body);
    else if (node.type === 'SwitchCase') addFromList(node.consequent);
    // 槽位正文本身就是函数体，`Program` 层（合成壳那一层）不插点
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) for (const c of child) visit(c);
      else if (child && typeof child.type === 'string') visit(child);
    }
  };
  visit(parsed.ast);

  // 同一偏移只插一次（嵌套遍历可能重复命中同一个语句表）
  const uniq = new Map();
  for (const ins of insertions) if (!uniq.has(ins.offset)) uniq.set(ins.offset, ins);
  const list = [...uniq.values()].sort((a, b) => b.offset - a.offset);

  let out = code;
  for (const ins of list) {
    // snapshot 的绑定表包在函数里求值：块级 `let` 遮蔽同名 `var` 时会踩 TDZ，
    // 包一层就能让 `__odSnap` 自己 catch 掉，不至于把一次诊断重放变成崩溃。
    const probe =
      mode === 'snapshot'
        ? `__odSnap(${slotIndex},${ins.line},function(){return {${bindings.map((b) => `${b}:${b}`).join(',')}};});`
        : `__odMark(${slotIndex},${ins.line});`;
    out = out.slice(0, ins.offset) + probe + out.slice(ins.offset);
  }

  // 行数必须逐字不变：诊断里的"第 N 行"就是作者看到的第 N 行
  if (out.split('\n').length !== code.split('\n').length) {
    throw new Error(`[${slot}] 埋点改变了行数，诊断会指错行——这属于本模块的实现缺陷`);
  }
  return { code: out, marks: list.length, bindings, skipped: null };
}

/**
 * 埋点 + 装配一次到位。
 *
 * 与 `Runtime.assembleProgramSource` 的差别只有一处：槽位源码先过 `instrumentSlot`。
 * 数据型槽位（PROBLEM / STEPS / ANSWERS）与 `VIEW` 原样不动。
 *
 * @param {Record<string,string>} slots
 * @param {{mode?:'mark'|'snapshot', programMode?:string, only?:string[]}} [opts]
 * @returns {{source:string, lineMap:ReturnType<typeof buildLineMap>, marks:Record<string,number>}}
 */
export function assembleInstrumented(slots, opts = {}) {
  const { mode = 'mark', programMode = 'NUMERIC', only = PROBE_SLOTS } = opts;
  const patched = { ...slots };
  const marks = {};
  for (const key of only) {
    const r = instrumentSlot(slots[key] ?? '', { slot: key, mode });
    patched[key] = r.code;
    marks[key] = r.marks;
  }
  const source = Runtime.replaceDataSlotTokens(Runtime.buildProgramSource(patched, { mode: programMode }), patched);
  return { source, lineMap: buildLineMap(source, patched), marks };
}

/**
 * 生成源码的行表：`第 N 行属于哪个槽位的第几行`。
 *
 * 装配器（`buildProgramSource`）的输出是固定版式：每个槽位前面有一行 `/* @slot:KEY …*​/`，
 * 紧接一行函数头，槽位正文从**再下一行**开始。这里按这个版式反查，
 * 用来把运行时异常栈里的"生成文件第 N 行"翻译回槽位坐标。
 *
 * 正文结束位置**不能**靠"下一个 marker 前推"来算：最后一个槽位后面没有 marker，
 * 一推就会把收尾的 `}`、空行、`return {…}` 全算进正文
 * （第 2 期的埋点自检第一次跑就逮到了这个错——`readouts` 的区间被判成 17 行，实际 9 行）。
 * 因此：**给了槽位原文就按行数精确算，并顺手校验下一行确实是收尾的 `}`**；
 * 没给才退回"下一个 marker 前推"的近似。
 */
export function buildLineMap(source, slots = null) {
  const lines = source.split('\n');
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /\/\* @slot:([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[i]);
    if (!m) continue;
    // 版式：第 M 行 marker、第 M+1 行函数头、第 M+2 行起是槽位正文
    entries.push({ slot: m[1], markerLine: i + 1, bodyStart: i + 3 });
  }
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const next = entries[i + 1];
    const code = slots?.[e.slot];
    if (typeof code === 'string' && code.length) {
      e.bodyEnd = e.bodyStart + code.split('\n').length - 1;
    } else {
      // 正文之后固定两行收尾：`  }` 与空行
      e.bodyEnd = next ? next.markerLine - 3 : lines.length;
    }
    e.verified = /^\s*\}\s*$/.test(lines[e.bodyEnd] ?? ''); // 下一行应当是函数收尾
  }
  return {
    entries,
    /** 生成文件行号 → `{slot, line}`（不在任何槽位正文里就返回 null） */
    locate(genLine) {
      for (const e of entries) {
        if (genLine >= e.bodyStart && genLine <= e.bodyEnd) return { slot: e.slot, line: genLine - e.bodyStart + 1 };
      }
      return null;
    },
  };
}

/** 从异常栈里取"生成文件行号"（`…:行:列`），取第一帧 */
export function generatedLineOf(err) {
  const stack = String(err?.stack ?? '');
  for (const line of stack.split('\n')) {
    const m = /:(\d+):(\d+)\)?\s*$/.exec(line.trim());
    if (m) return { line: Number(m[1]), column: Number(m[2]) };
  }
  return null;
}
