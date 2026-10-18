/**
 * 行号级归因（第 2 期 · M26/M27 的核心增量）。
 *
 * C1 的静态诊断本来就有行列号（acorn）。这里补的是**运行时**那几类：
 *   · C3 非有限值（NaN/Infinity）——不是异常，判据只看到"某个数不对"；
 *   · C4/C6 瞬移与边界跳变——判据只看到"坐标/状态对不上"；
 *   · C2 死循环——连异常都没有，只有硬终止后的一行行号。
 *
 * 三种手段，按"证据强度"从高到低标注 `precision`：
 *   `exact`      —— 埋点直接记下来的行（`__odMark` 的当前行、命令记录上的行号戳）；
 *   `replayed`   —— 诊断重放：用快照埋点重跑槽位，定位"第一次算出非有限值的行"
 *                   或"最后一次改写某个绑定的行"；
 *   `candidate`  —— 静态候选（AST 里可能写这个键的行）。只在重放不可用时兜底，
 *                   报告里明确写"候选"，不假装精确。
 *
 * ⚠ 第 4 期：这三档**已写进契约**（`contracts/diagnostic-record.schema.json` +
 *   `contracts/diagnostic-evidence.json`），自愈回灌必须把强度一起发给模型。
 *   因此文案与顺序统一从 `contracts/evidence.mjs` 取，不再在本文件里各写一套。
 *
 * 归因是**诊断**，不参与判据成立与否：判据仍然是 C1–C9 本身（§7.2 冻结项一字未改）。
 */

import { parseSlot, nodeLoc, sourceLines, contextLines } from '../lint/acorn-parser.mjs';
import { SLOT_PARAMS } from '../lint/contract-lint.mjs';
import * as Runtime from '../../sdk/runtime/animation-runtime.mjs';
import { DRY_RUN_BUDGET } from '../../contracts/spec/frozen-keys.mjs';
import { PRECISIONS, labelOf, isPrecision } from '../../contracts/evidence.mjs';

/* ───────────────────────── 静态定位（candidate） ───────────────────────── */

const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range']);
const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) for (const c of child) walk(c, visit, node);
    else if (child && typeof child.type === 'string') walk(child, visit, node);
  }
}

function propName(prop) {
  if (!prop) return null;
  if (prop.type !== 'Property' && prop.type !== 'PropertyDefinition') return null;
  if (prop.computed) return null;
  if (prop.key?.type === 'Identifier') return prop.key.name;
  if (prop.key?.type === 'Literal') return String(prop.key.value);
  return null;
}

/**
 * 槽位里"可能写到某个键"的行（静态候选）。
 * @returns {Array<{line:number,column:number,kind:string,text:string}>}
 */
export function locateSlotKeyWrites(code, slot, key) {
  if (typeof code !== 'string' || !code.trim() || !key) return [];
  const parsed = parseSlot(code, slot, SLOT_PARAMS[slot] ?? []);
  if (!parsed.ast) return [];
  const head = parsed.headLines ?? 1;
  const lines = sourceLines(code);
  const hits = [];
  const push = (node, kind) => {
    const loc = nodeLoc(node, head);
    hits.push({ line: loc.line, column: loc.column, kind, text: (lines[loc.line - 1] ?? '').trim() });
  };

  walk(parsed.ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.id.name === key) push(node, '赋值');
    if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier' && node.left.name === key) push(node, '赋值');
    if (node.type === 'ObjectExpression') {
      for (const p of node.properties) {
        if (p.type !== 'Property') continue;
        if (propName(p) === key && p.shorthand) push(p, '返回分量');
        else if (propName(p) === key && p.value?.type === 'Identifier' && p.value.name === key) push(p, '返回分量');
      }
    }
  });

  const seen = new Set();
  return hits
    .filter((h) => (seen.has(h.line) ? false : seen.add(h.line)))
    .sort((a, b) => a.line - b.line)
    .slice(0, 4);
}

/**
 * `readouts` 里某个读数键的位置：读数是 `{key:'v', value:…}` 形态，
 * 键名是**字符串字面量**，因此按属性名找是找不到的（这是第 1 期诊断看不见行号的原因之一）。
 */
export function locateReadoutEntry(code, readoutKey) {
  if (typeof code !== 'string' || !code.trim() || !readoutKey) return null;
  const parsed = parseSlot(code, 'readouts', SLOT_PARAMS.readouts);
  if (!parsed.ast) return null;
  const head = parsed.headLines ?? 1;
  const lines = sourceLines(code);
  let found = null;
  walk(parsed.ast, (node) => {
    if (found) return;
    if (node.type !== 'ObjectExpression') return;
    const props = node.properties.filter((p) => p.type === 'Property');
    const keyProp = props.find((p) => propName(p) === 'key' && p.value?.type === 'Literal' && String(p.value.value) === String(readoutKey));
    if (!keyProp) return;
    const valueProp = props.find((p) => propName(p) === 'value');
    const target = valueProp ?? keyProp;
    const loc = nodeLoc(target, head);
    found = { line: loc.line, column: loc.column, kind: '读数条目', text: (lines[loc.line - 1] ?? '').trim() };
  });
  return found;
}

/* ───────────────────── 快照重放的读法（replayed） ───────────────────── */

/**
 * 快照序列的读法。
 *
 * ⚠ 关键细节：探针是插在**每条语句之前**的，所以第 i 条快照记录的是"第 i 条语句执行**前**"的取值。
 * 于是"某个绑定在第 i 条快照里第一次变成 NaN"其实意味着**第 i-1 条语句**算出了它。
 * 归因要指到作者能改的那一行，所以返回的是 `line`（上一条语句）+ `observedAt`（看到变化的那次探针）。
 */

/** 第一次出现"某个绑定由有限变非有限"的位置 */
export function firstNonFinite(snapshots) {
  const prev = new Map();
  for (let i = 0; i < snapshots.length; i += 1) {
    const snap = snapshots[i];
    const values = snap.values;
    if (!values) continue;
    for (const [name, value] of Object.entries(values)) {
      const isNum = typeof value === 'number';
      if (isNum && !Number.isFinite(value)) {
        const before = prev.get(name);
        if (before === undefined || (typeof before === 'number' && Number.isFinite(before)) || before === null) {
          // 上一条语句算出的它；没有更早的快照时退回本次探针所在行
          const culprit = snapshots[i - 1]?.line ?? snap.line;
          return { line: culprit, observedAt: snap.line, binding: name, value: String(value) };
        }
      }
      prev.set(name, value);
    }
  }
  return null;
}

/** 快照序列里"最后一次改写某个绑定"的位置（用于 C6 边界跳变） */
export function lastWriteOf(snapshots, binding) {
  let out = null;
  /**
   * ⚠ 用哨兵而不是 `prev !== undefined`（第 8 期修正）。
   *
   * 旧写法把"**首次赋值**"整条漏掉了：`let x;` 之后的第一个探针里 x 是 `undefined`，
   * 于是 `prev === undefined`，后面 `x = 32.571` 也被跳过 ⇒ 一个写入都记不到
   * ⇒ C6 永远只能给"候选行"（用户真题里 4 条候选行的根因）。
   * 现在区分"没见过这个绑定"与"见过、值是 undefined"：`undefined → 数值` 也算一次写入。
   */
  const UNSEEN = Symbol('unseen');
  let prev = UNSEEN;
  for (let i = 0; i < snapshots.length; i += 1) {
    const snap = snapshots[i];
    if (!snap.values || !(binding in snap.values)) continue;
    const v = snap.values[binding];
    if (prev !== UNSEEN && !Object.is(prev, v)) {
      // 与 `firstNonFinite` 同理：看到变化的是第 i 条探针，真正写它的是第 i-1 条语句
      out = { line: snapshots[i - 1]?.line ?? snap.line, observedAt: snap.line, value: String(v) };
    }
    prev = v;
  }
  return out;
}

/** 两侧快照的最终取值差异（哪些绑定在边界两侧不一样） */
export function differingBindings(before, after) {
  const out = [];
  const last = (snaps) => {
    const acc = {};
    for (const s of snaps) if (s.values) Object.assign(acc, s.values);
    return acc;
  };
  const a = last(before);
  const b = last(after);
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!Object.is(a[key], b[key])) out.push({ binding: key, before: a[key], after: b[key] });
  }
  return out;
}

/* ───────────────────────── 诊断条目组装 ───────────────────────── */

/**
 * 统一诊断条目形状（与 C1 的诊断字段对齐，另外多两个字段）：
 * `precision` ∈ {exact, replayed, candidate} · `context` 前后各一行。
 *
 * ⚠ 第 4 期起，`precision` **不再是"内部约定"**：它是 `contracts/diagnostic-record.schema.json`
 *   冻结的字段（三档证据强度，自愈回灌必须带上它，否则模型会照着"候选行"改代码）。
 *   因此这里缺省值不再是"随便写一个"，而是**显式取自契约**，并新增了 `diagWithPrecision()`
 *   这个要求调用方**必须给强度**的入口 —— 新写的诊断代码应该用它。
 */
export function diag({ check, rule, slot, line, column = null, message, source, precision = PRECISIONS[0] }) {
  const lines = source ? sourceLines(source) : [];
  const ctx = Number.isFinite(line) && lines.length ? contextLines(lines, line) : [];
  return { check, rule, slot, line: Number.isFinite(line) ? line : null, column, message, precision, context: ctx };
}

/**
 * 与 `diag()` 同形，但**强度必须由调用方给出**（无缺省值）。
 *
 * 存在的理由：第 2 期的诊断散落着 `precision: 'exact' | 'replayed' | 'candidate'` 字面量，
 * 一处写错（例如把候选行标成精确行）不会有任何检查发现。自愈回灌依赖这个字段，
 * 所以新代码走这个入口，字面量只允许出现在**已经取证过的**那几处。
 */
export function diagWithPrecision(precision, fields) {
  if (!isPrecision(precision)) {
    throw new Error(`诊断的证据强度非法："${precision}"；只允许 ${PRECISIONS.join(' / ')}（见 contracts/diagnostic-record.schema.json）`);
  }
  return diag({ ...fields, precision });
}

/** 把诊断渲染成报告里的可读单行（summary.md / 控制台共用） */
export function formatDiag(d) {
  const where = d.line ? `${d.slot} 第 ${d.line} 行` : `${d.slot}`;
  const col = d.column ? `第 ${d.column} 列` : '';
  return `${where}${col ? ` ${col}` : ''}（${labelOf(d.precision)}）：${d.message}`;
}

/* ─────────────────── 扩展检查 X1 / X2（不阻塞，报告单列） ─────────────────── */

/**
 * X1 · 跨槽位导出键与 `STEPS` 字段同名。
 *
 * 第 1 期踩过的坑（交付说明第七节第 3 条）：`setup` 里 `RETURN('t1', …)` 之后，
 * 槽位侧 `context.t1` 与"某一步的 t1"语义重名，一旦将来有消费者按步展开上下文就会**静默覆盖**。
 * §7.2 的 C1–C9 是冻结项，不动它；这里按 C10 的同款做法放进 `extensions[]`，
 * 只提醒、不阻塞（`blocking:false`），但**给出精确行号**。
 */
export function checkContextKeyCollision(slots) {
  const FIELD_NAMES = ['t0', 't1', 'title', 'tex'];
  const code = slots?.setup;
  const hits = [];
  if (typeof code === 'string' && code.trim()) {
    const parsed = parseSlot(code, 'setup', SLOT_PARAMS.setup);
    if (parsed.ast) {
      const head = parsed.headLines ?? 1;
      walk(parsed.ast, (node) => {
        if (node.type !== 'CallExpression') return;
        const callee = node.callee?.type === 'Identifier' ? node.callee.name : null;
        if (callee !== 'RETURN') return;
        const first = node.arguments?.[0];
        if (first?.type !== 'Literal' || typeof first.value !== 'string') return;
        if (!FIELD_NAMES.includes(first.value)) return;
        const loc = nodeLoc(node, head);
        hits.push({ line: loc.line, column: loc.column, key: first.value });
      });
    }
  }
  return {
    id: 'X1',
    title: '跨槽位导出键与 STEPS 字段同名',
    severity: 'extension',
    blocking: false,
    status: hits.length ? 'fail' : 'pass',
    declared: 0,
    detail: hits.length
      ? `${hits.length} 处 RETURN 导出键与 STEPS 字段重名（潜在静默覆盖）`
      : '未发现与 STEPS 字段（t0/t1/title/tex）重名的导出键',
    offenders: hits.map((h) => ({
      t: null,
      reason: `setup 第 ${h.line} 行 RETURN('${h.key}', …) 与 STEPS 字段同名`,
      snippet: `setup 第 ${h.line} 行第 ${h.column} 列：RETURN('${h.key}', …)`,
    })),
    diagnostics: hits.map((h) =>
      diag({
        check: 'X1',
        rule: 'context-key-collision',
        slot: 'setup',
        line: h.line,
        column: h.column,
        message: `导出键 '${h.key}' 与 STEPS 字段同名，跨槽位读取时可能被静默覆盖`,
        source: code,
      }),
    ),
  };
}

/**
 * X2 · `Draw.raw` 使用率（§19.1 门禁 <10%）。
 *
 * §5.4 的逃生门本身合法，但使用率超标意味着 Layer 1 需要扩编；第 1 期只把它当观测值打印，
 * 第 2 期起作为**扩展检查**参与报告（仍不阻塞），并给出第一条 raw 的调用行。
 */
export function checkDrawRawUsage(run) {
  const rawRecords = [];
  run.frames.forEach((frame, fi) => {
    frame.records.forEach((rec, ri) => {
      if (rec.op === 'raw') rawRecords.push({ fi, ri, rec });
    });
  });
  const total = run.frames.reduce((n, f) => n + f.commandCount, 0);
  const usage = total ? rawRecords.length / total : 0;
  const limit = 0.1;
  const first = rawRecords[0];
  const line = first?.rec?.__line ?? null;
  const slot = first?.rec?.__slot !== undefined ? 'drawFrame' : null;
  return {
    id: 'X2',
    title: 'Draw.raw 使用率（§19.1 <10%）',
    severity: 'extension',
    blocking: false,
    status: rawRecords.length === 0 ? 'pass' : usage > limit ? 'fail' : 'pass',
    declared: 0,
    detail:
      rawRecords.length === 0
        ? '未使用 Draw.raw（Layer 1 覆盖充分）'
        : `Draw.raw 使用率 ${(usage * 100).toFixed(2)}%（${rawRecords.length}/${total} 条命令）${usage > limit ? '，超过 §19.1 的 10% 门禁' : ''}`,
    offenders: usage > limit ? [{ t: null, reason: 'Draw.raw 使用率超阈值', snippet: `${(usage * 100).toFixed(2)}% > 10%` }] : [],
    diagnostics:
      usage > limit && Number.isFinite(line)
        ? [
            diag({
              check: 'X2',
              rule: 'drawraw-overuse',
              slot,
              line,
              message: `第一条 Draw.raw 出现在第 ${line} 行；总使用率 ${(usage * 100).toFixed(2)}% 超过 §19.1 门禁`,
              source: run.slots?.drawFrame,
              precision: 'exact',
            }),
          ]
        : [],
  };
}

/** 数据型槽位的行号索引（STEPS/ANSWERS），失败返回 null 而不是抛错 */
export function dataSlotLines(text, key) {
  try {
    return Runtime.dataSlotLineIndex(text, key);
  } catch {
    return null;
  }
}

export { DRY_RUN_BUDGET };
