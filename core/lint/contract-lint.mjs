/**
 * C1 静态预检（§6.2 全表）—— **acorn 单后端**
 *
 * 用户决议：只保留 acorn，不再保留自写 tokenizer 兜底；项目从此强依赖 node_modules。
 *
 * 判据逐条对应 §6.2：
 *   1. 语法错误 → 拒绝，返回行号 + 列号 + 上下文（不是 stack trace）
 *   2. `import` / `require` / `eval` / `Function` / `globalThis` / `process` / `window` / `self` → 拒绝并指名标识符
 *   3. `constructor` / `__proto__` / `prototype` → 拒绝（原型链逃逸的唯一常规入口）
 *   4. `while(true)` / `for(;;)` / 无上界递归 → 拒绝
 *   5. 引用未声明的全局 → 拒绝，并从 SDK 签名清单给出最接近的名字
 *   6. `stateAt` 内出现 `Phys.integrate` → 拒绝（架构不变量 §7.6）
 *   7. 单槽位超长 → 按阈值拒绝（总代码 ≤400 行；`stateAt`+`drawFrame` ≤150 行）
 *
 * 换 AST 后的实质提升（不是换汤不换药）：
 *   · 语法错误由 acorn 给**真实行列号**，模块级/块级语法问题不再只能报"括号不配平"；
 *   · 作用域是**真的作用域链**（程序 / 函数 / 块 / for 头 / catch 各一层），
 *     "未声明全局"不再依赖启发式声明收集，模型代码的误报显著减少；
 *   · `Phys.integrate` 与 `require(...)` 直接看 `CallExpression.callee` 结构，
 *     不再靠 token 邻接猜测（上一版正是在这里漏判过）。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from '../../tools/paths.mjs';
import { CODE_LENGTH_LIMITS } from '../../contracts/spec/frozen-keys.mjs';
import { PARSER_BACKEND, parseSlot, nodeLoc, contextLines, sourceLines } from './acorn-parser.mjs';

const SIGNATURE_PATH = join(PROJECT_ROOT, 'sdk', 'signature-summary.json');

/* ─────────────────────── 禁项表（§6.2 第 2、3 条） ─────────────────────── */

/** 出现即拒绝的标识符 */
export const BANNED_IDENTIFIERS = Object.freeze([
  'require', 'eval', 'Function', 'globalThis', 'process', 'window', 'self',
  'document', 'XMLHttpRequest', 'fetch', 'WebSocket', 'Worker', 'importScripts',
  'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'location', 'history',
  'setTimeout', 'setInterval', 'alert', 'postMessage', 'Deno', 'Bun',
]);

/** 原型链逃逸入口（§6.2 第 3 条） */
export const BANNED_PROPERTIES = Object.freeze(['constructor', '__proto__', 'prototype']);

/** 语法层禁项（§6.2 第 2 条） */
export const BANNED_KEYWORDS = Object.freeze(['import', 'export']);

/**
 * ── 第 9 期「判据分级」（用户裁决，见交接单 §8）──
 *
 * C1 **不降级**，但它被拆成两类：
 *   · 语法错误、箭头契约、禁用标识符、原型链逃逸、`stateAt` 内积分、死循环/自递归
 *     —— **硬拦**（`blocking: true`）；
 *   · **只**报出 `unknown-global`（引用了未声明的名字）—— **降告警**（`blocking: false`）。
 *
 * 为什么这样拆是安全的：真正的"沙箱逃逸"不会被放过 —— `require` / `eval` / `process.x`
 * 这些名字还会**另外**命中 `banned-identifier`（见下方判据 2/3），那条仍是硬拦。
 * 所以降为告警的只剩"拼错一个名字"这一类：它更可能是笔误，而且**运行时自然会说真话**
 * （真被调用就会抛 ReferenceError ⇒ C2 硬拦）。这正是"降告警但不放松"的分寸。
 */
export const C1_ADVISORY_RULES = Object.freeze(['unknown-global']);

/**
 * 允许的全局白名单（纯函数与常量）。
 *
 * ⚠ 第 8 期补：`isFinite` / `isNaN` / `parseFloat` / `parseInt` 四个标准纯函数。
 *
 * 用户真题里写了 `if (!isFinite(xm)) xm = 0;` 这种"防 NaN"守卫 —— 完全正常的 JS，
 * 而且 Dry-Run 的沙箱（`core/dryrun/vm-context.mjs` 的 `slotGlobals()`）**一直就提供它们**。
 * 但白名单漏了这四条 ⇒ 运行时能跑、静态检查却判死；用户看到的还是
 * "引用未声明的名字 isFinite" + 一句毫无意义的"你是否想调用 Infinity/BigInt/Date"。
 *
 * 判据本意是"只放行纯函数与常量"，这四个正是纯函数，漏了属**实现不同步**，不是放宽口径。
 * **这份白名单必须与沙箱提供的全局一致**（勿再漂）。
 */
export const ALLOWED_GLOBALS = Object.freeze([
  'Math', 'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Date', 'RegExp',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'Error', 'TypeError', 'RangeError',
  'Infinity', 'NaN', 'undefined', 'null', 'true', 'false', 'arguments',
  'isFinite', 'isNaN', 'parseFloat', 'parseInt',
]);

/** 各槽位在装配后的函数形参（由 `buildProgramSource` 注入） */
export const SLOT_PARAMS = Object.freeze({
  VIEW: [],
  setup: [],
  stateAt: ['t'],
  drawFrame: ['t', 'state'],
  readouts: ['t', 'state'],
});

/** 槽位作用域内由运行时装配注入的名字（与 buildProgramSource 一一对应） */
export const RUNTIME_INJECTED = Object.freeze([
  'Draw', 'Phys', 'context', 'RETURN', 'SIM', 'STEPS', 'ANSWERS', 'PROBLEM', 'PROGRAM', 'runtime', 'buffer',
  'PROBLEM_TEXT', 'STEPS_DATA', 'ANSWERS_DATA',
]);

/** `stateAt` 内静态禁用的调用（§7.6 架构不变量） */
export const STATE_AT_FORBIDDEN_CALLS = Object.freeze(['Phys.integrate', 'integrate']);

/* ────────────── 第 8 期：`Draw.arrow` 的参数口径（用户 2026-10-17 拍板） ──────────────
 *
 * 为什么这三条要放在**静态预检**里，而不是只靠渲染器：
 *   渲染器已经"不理" color 和 scale 了，但那是**沉默失败** ——
 *   模型写了 `color:'#a4610d'`，画面照样对，校验报告照样绿，
 *   于是代码里留着一行"看起来有用、其实没用"的东西，半年后没人敢删。
 *   用户对这类东西的原话是"屎山代码"。
 *
 *   所以规矩落在**每道题都要过的那道闸**上：写了就报，让它显性失败。
 *
 *   至于 `mag`：它是"同类可比"的唯一数据来源。没有它，渲染器会退回 `|vec|`，
 *   而 `|vec|` 里可能被作者乘过系数（q05 曾经是 0.55 与 0.16）⇒
 *   同类箭头**看起来**按比例，其实比例是假的。这种失效肉眼看不出来，只能靠闸门拦。
 */
export const ARROW_MAG_REQUIRED =
  '箭头必须给 `mag`（真实量级）。长度 = 该类满量程 × (mag ÷ 该类整段最大 mag)；' +
  '缺了它就只能退回 |vec|，同类箭头之间将**不再可比**。';

export const ARROW_SCALE_BANNED =
  '别再给 `scale`：第 8 期起箭头长度由 `mag` 归一决定，`scale` 已被忽略 —— ' +
  '写了不生效，只会让后来的人以为它有作用。';

export const ARROW_COLOR_BANNED =
  '别再给 `color`：箭头颜色由 `category` 唯一决定（绿=速度 / 蓝=加速度 / 红=受力 / 紫=辅助）。' +
  '写死颜色会让同一类量在不同题里颜色不同，学生形成不了稳定认知。';

export const ARROW_OPTS_NOT_LITERAL =
  '`Draw.arrow` 的第三个参数必须是**对象字面量**（不能是变量）—— 否则静态预检看不到你有没有给 `mag`，' +
  '"同类可比"就失去了保障。';

/* ────────────── v1.1.9：v/a 箭头改由运行时本地绘制（用户 2026-10-19 拍板） ──────────────
 *
 * 用户压力测试结论：模型手写的速度/加速度箭头**错到不可接受**（方向、符号、缩放、
 * 与画面里物体的实际运动对不上）。所以这两类不再让模型画：
 *   · 速度/加速度由 `SIM.bodies` 声明刚体位置，运行时对轨迹求导后统一绘制；
 *   · 模型只保留 `aux`（传送带速度、电流、分量…）与 `force`。
 *
 * 为什么必须硬拦而不是"运行时过滤掉就行"：
 *   过滤是**沉默修复** —— 模型写错了、画面却对，它永远学不会；换一道题忘了过滤，
 *   错箭头就又出来了。所以静态闸门报错、自愈轮定向改，和 v1.1.9 的失效模式对齐。
 */
export const ARROW_KINEMATIC_FORBIDDEN =
  '速度/加速度箭头不再由模型绘制：请删掉这支 `Draw.arrow`，改在 `VIEW` 里声明 `SIM.bodies`' +
  '（`[{ id, at: (state) => [x, y] }]`），运行时会自动画出 v 与 a。' +
  '`category: "aux"`（传送带速度、电流、分量…）与 `force` 仍然可以画。';

/* ────────────── 第 9 期：`dash` 的参数口径（用户 2026-10-19 拍板） ──────────────
 *
 * 约定：
 *   · `true`  → 默认虚线（运行时存成 [4, 3]）
 *   · `false` / 不写 → 实线
 *   · 数字数组 → 自定义间距
 *
 * 为什么这条要进 C1：真实浏览器的 `setLineDash` 只收 `sequence<number>`。
 * 模型曾写 `dash: true` 以外的值（或这里写错类型），旧运行时原样塞给浏览器，
 * 抛 TypeError、整帧中断，页面停在 0.00 / 0.00 且只有半张图 —— 静默得可怕。
 * 运行时已按上面的约定归一化；C1 再把**字面量里的明显错误类型**提前拦下。
 */
export const DASH_TYPE_INVALID =
  '`dash` 只接受 `true`（虚线）/ `false`（实线）/ 数字数组（自定义间距），例如 ' +
  '`Draw.line(a, b, { dash: true })`；不要写字符串、数字或其它对象。';


/* ───────────────────────── 签名清单与名字建议 ───────────────────────── */

let signatureCache = null;

export function loadSignatureSummary() {
  if (signatureCache) return signatureCache;
  try {
    signatureCache = JSON.parse(readFileSync(SIGNATURE_PATH, 'utf8'));
  } catch {
    signatureCache = { functions: [], names: [], builtinMembers: [] };
  }
  return signatureCache;
}

function buildNameIndex(sig) {
  const names = new Set([...RUNTIME_INJECTED, ...ALLOWED_GLOBALS]);
  for (const fn of sig.functions ?? []) names.add(String(fn.name).split('.')[0]);
  for (const n of sig.names ?? []) names.add(n);
  return names;
}

/** 最近邻建议（编辑距离） */
export function nearestName(input, candidates, limit = 3) {
  const scored = candidates.map((c) => ({ c, d: editDistance(String(input).toLowerCase(), String(c).toLowerCase()) }));
  scored.sort((a, b) => a.d - b.d || a.c.localeCompare(b.c));
  return scored.slice(0, limit).map((s) => s.c);
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/* ───────────────────────────── AST 工具 ───────────────────────────── */

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** `a.b.c` → "a.b.c"；非静态成员路径返回 null */
function memberPath(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    const base = memberPath(node.object);
    return base ? `${base}.${node.property.name}` : node.property.name;
  }
  return null;
}

/** 作用域：按"最小作用域优先"查找声明；声明在引用之后则视为不可见（贴近 TDZ） */
class Scope {
  constructor(parent) {
    /** @type {Map<string, number>} 名字 → 声明起始偏移 */
    this.names = new Map();
    this.parent = parent;
  }

  declare(name, start) {
    if (!this.names.has(name)) this.names.set(name, start);
  }

  resolve(name, refStart) {
    let scope = this;
    while (scope) {
      const start = scope.names.get(name);
      if (start !== undefined) return { found: true, visible: start <= refStart };
      scope = scope.parent;
    }
    return { found: false, visible: false };
  }
}

function declarePattern(node, scope, start) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier':
      scope.declare(node.name, start);
      break;
    case 'ObjectPattern':
      for (const prop of node.properties) {
        declarePattern(prop.type === 'RestElement' ? prop.argument : prop.value ?? prop.key, scope, start);
      }
      break;
    case 'ArrayPattern':
      for (const el of node.elements) declarePattern(el, scope, start);
      break;
    case 'AssignmentPattern':
      declarePattern(node.left, scope, start);
      break;
    case 'RestElement':
      declarePattern(node.argument, scope, start);
      break;
    default:
      break;
  }
}

/**
 * 单次遍历：建立父子索引 + 作用域链 + 声明表。
 * 父子索引与作用域在同一趟里拿到，因此"这个 Identifier 是引用还是声明名"可以就地判断。
 */
function buildIndex(ast, extraParams = []) {
  const parents = new WeakMap();
  const scopes = new WeakMap();
  const root = new Scope(null);
  for (const p of extraParams) root.declare(p, -1);

  const visit = (node, scope) => {
    if (!node || typeof node.type !== 'string') return;
    scopes.set(node, scope);

    // ⚠ 函数/类**声明名登记在外层作用域**（不是它们自己那层）：
    //   否则 `function seg(){…}` 之后再调用 `seg(...)` 会被误判成"未声明全局"。
    if (node.type === 'FunctionDeclaration' && node.id) scope.declare(node.id.name, node.start);
    if (node.type === 'ClassDeclaration' && node.id) scope.declare(node.id.name, node.start);

    let childScope = scope;
    if (FUNCTION_TYPES.has(node.type)) {
      childScope = new Scope(scope);
      for (const param of node.params ?? []) declarePattern(param, childScope, -1);
      // 具名函数表达式：名字只在自身内部可见
      if (node.type === 'FunctionExpression' && node.id) childScope.declare(node.id.name, -1);
    } else if (node.type === 'BlockStatement') {
      childScope = new Scope(scope);
    } else if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      childScope = new Scope(scope);
    } else if (node.type === 'CatchClause') {
      childScope = new Scope(scope);
      if (node.param) declarePattern(node.param, childScope, node.start);
    }

    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) declarePattern(decl.id, childScope, node.start);
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
      const value = node[key];
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (child && typeof child.type === 'string') {
          parents.set(child, node);
          visit(child, childScope);
        }
      }
    }
  };

  visit(ast, root);
  return { parents, scopes, root };
}

/** Identifier 是否处于"引用位置"（而非声明名 / 属性名 / 标签） */
function isReference(node, parents) {
  const parent = parents.get(node);
  if (!parent) return true;
  switch (parent.type) {
    case 'MemberExpression':
      return parent.object === node;
    case 'Property':
      return parent.computed ? true : parent.value === node;
    case 'MethodDefinition':
    case 'PropertyDefinition':
      return parent.computed ? true : parent.value === node;
    case 'VariableDeclarator':
      return parent.id !== node;
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return parent.id !== node && !(parent.params ?? []).includes(node);
    case 'ClassDeclaration':
    case 'ClassExpression':
      return parent.id !== node;
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return false;
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ExportSpecifier':
      return false;
    case 'CatchClause':
      return parent.param !== node;
    case 'RestElement':
    case 'AssignmentPattern':
      return parent.left !== node && parent.argument !== node;
    default:
      return true;
  }
}

/** 深度优先遍历（跳过 loc/start/end 之类非节点字段） */
function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item.type === 'string') walk(item, fn);
    } else if (value && typeof value.type === 'string') {
      walk(value, fn);
    }
  }
}

function diag(rule, node, lines, message, headLines = 0) {
  const loc = nodeLoc(node, headLines);
  return { check: 'C1', rule, line: loc.line, column: loc.column, message, context: contextLines(lines, loc.line) };
}

/* ───────────────────── 判据 4：无上界循环与自递归 ───────────────────── */

function isTrueLiteral(node) {
  return (
    node &&
    ((node.type === 'Literal' && (node.value === true || node.value === 1)) ||
      (node.type === 'Identifier' && node.name === 'true'))
  );
}

function hasBreakStatement(body) {
  let found = false;
  walk(body, (n) => {
    if (found) return;
    if (FUNCTION_TYPES.has(n.type) && n !== body) return;
    if (n.type === 'BreakStatement') found = true;
  });
  return found;
}

function detectUnboundedLoops(ast, lines, headLines = 0) {
  const out = [];
  walk(ast, (node) => {
    if (node.type === 'WhileStatement' && isTrueLiteral(node.test) && !hasBreakStatement(node.body)) {
      out.push(diag('unbounded-loop', node, lines, 'while(true) 是无上界循环（§6.2），Dry-Run 会直接拒绝', headLines));
    }
    if (node.type === 'ForStatement' && !node.test && !hasBreakStatement(node.body)) {
      out.push(diag('unbounded-loop', node, lines, 'for(;;) 是无上界循环（§6.2），Dry-Run 会直接拒绝', headLines));
    }
  });
  return out;
}

function detectSelfRecursion(ast, lines, headLines = 0) {
  const out = [];
  const checkFunction = (node, name) => {
    if (!name || !node.body) return;
    let selfCall = null;
    walk(node.body, (n) => {
      if (selfCall) return;
      if (FUNCTION_TYPES.has(n.type) && n !== node) return; // 不跨越嵌套函数
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === name) selfCall = n.callee;
    });
    if (selfCall) {
      out.push(
        diag(
          'unbounded-recursion',
          selfCall,
          lines,
          `局部函数 ${name} 在自身函数体内直接调用自己——无上界递归（§6.2）。请改为有界循环或 setup() 内预计算查表`,
          headLines,
        ),
      );
    }
  };

  walk(ast, (node) => {
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') && node.id) {
      checkFunction(node, node.id.name);
    }
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init && FUNCTION_TYPES.has(node.init.type)) {
      checkFunction(node.init, node.id.name);
    }
  });
  return out;
}

/* ───────────────────────────── 主入口 ───────────────────────────── */

/**
 * 对单个槽位做 C1 静态预检（acorn 单后端）。
 *
 * @param {object} opts
 * @param {string} opts.code 槽位文本
 * @param {string} opts.slot 槽位键名（§3.2 的 8 个之一）
 * @param {string} [opts.entry] 文件名/题目标识，仅用于诊断
 * @param {number} [opts.linesBudget] 该槽位的行数上限（缺省按 §6.2 总 400 行）
 */
export function lintSlot(opts) {
  const { code, slot, entry = '(inline)' } = opts;
  const diagnostics = [];
  const lines = sourceLines(code);
  const budget = opts.linesBudget ?? CODE_LENGTH_LIMITS.totalLines;
  const sig = loadSignatureSummary();
  const knownNames = buildNameIndex(sig);
  const allSuggestions = [...knownNames, ...(sig.functions ?? []).map((f) => f.name)];
  const params = SLOT_PARAMS[slot] ?? [];

  // 判据 1：语法（acorn 给真实行列号；槽位按"函数体"解析，return 合法）
  const { ast, errors, headLines } = parseSlot(code, `${entry}#${slot}.js`, params);
  for (const err of errors) {
    diagnostics.push({
      check: 'C1',
      rule: err.code,
      slot,
      line: err.line,
      column: err.column,
      message: err.message,
      context: contextLines(lines, err.line),
    });
  }

  // 判据 7：超长
  if (lines.length > budget) {
    diagnostics.push({
      check: 'C1',
      rule: 'slot-too-long',
      slot,
      line: budget + 1,
      column: 1,
      message: `槽位 ${slot} 共 ${lines.length} 行，超过上限 ${budget} 行（§6.2 / §20）`,
      context: [],
    });
  }

  if (ast) {
    const { parents, scopes, root } = buildIndex(ast, params);
    /** 绑定 headLines 的诊断构造器（槽位坐标 = AST 坐标 − 合成函数壳的 1 行） */
    const d = (rule, node, message) => diag(rule, node, lines, message, headLines);

    // 判据 2：import / export 声明
    for (const node of ast.body ?? []) {
      if (
        node.type === 'ImportDeclaration' ||
        node.type === 'ExportNamedDeclaration' ||
        node.type === 'ExportDefaultDeclaration' ||
        node.type === 'ExportAllDeclaration'
      ) {
        const keyword = node.type.startsWith('Import') ? 'import' : 'export';
        diagnostics.push(d('banned-keyword', node, `不得使用 ${keyword} 语句（§6.2）：槽位代码只能是被动的纯计算`));
      }
    }

    walk(ast, (node) => {
      // 判据 3 + 2：成员访问
      if (node.type === 'MemberExpression') {
        const propName = !node.computed && node.property.type === 'Identifier' ? node.property.name : null;
        if (propName && BANNED_PROPERTIES.includes(propName)) {
          diagnostics.push(d('prototype-escape', node.property, `不得访问 ${propName}（§6.2 原型链逃逸的唯一常规入口）`));
        }
        const path = memberPath(node);
        if (path) {
          const [head, ...rest] = path.split('.');
          if (BANNED_IDENTIFIERS.includes(head)) {
            diagnostics.push(
              d(
                'banned-identifier',
                node.object,
                `不得引用 ${[head, ...rest].join('.')}（§6.2）：槽位代码拿不到 DOM / 网络 / 宿主环境`,
              ),
            );
          }
          // 判据 6：stateAt 内 Phys.integrate（看 callee 结构，不靠 token 邻接）
          if (slot === 'stateAt' && path === 'Phys.integrate') {
            diagnostics.push(
              d('stateat-integrate', node, 'stateAt 内禁止调用 Phys.integrate（§7.6 架构不变量）：重算与积分只允许在 setup() 内'),
            );
          }
        }
      }

      // 判据 2：调用 / 构造 / 动态导入
      if (node.type === 'CallExpression') {
        const callee = node.callee;
        const name = callee.type === 'Identifier' ? callee.name : null;
        if (name && BANNED_IDENTIFIERS.includes(name)) {
          diagnostics.push(d('banned-identifier', callee, `不得调用 ${name}（§6.2）：槽位代码拿不到 DOM / 网络 / 宿主环境`));
        }
        if (name === 'integrate' && slot === 'stateAt') {
          diagnostics.push(
            d('stateat-integrate', callee, 'stateAt 内禁止调用 Phys.integrate（§7.6 架构不变量）：重算与积分只允许在 setup() 内'),
          );
        }
      }
      if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && BANNED_IDENTIFIERS.includes(node.callee.name)) {
        diagnostics.push(d('banned-identifier', node.callee, `不得使用 new ${node.callee.name}(…)（§6.2）`));
      }
      if (node.type === 'ImportExpression') {
        diagnostics.push(d('banned-keyword', node, '不得使用动态 import()（§6.2）'));
      }

      /**
       * 判据 8（第 8 期）：`Draw.arrow` 的参数口径 —— `mag` 必填、`scale` 与 `color` 禁用。
       *
       * 只看**对象字面量**：写成变量就没法静态确认（那条单独报 `arrow-options-not-literal`）。
       * 这样规则是**可判定的**，不靠"大概扫一眼源码"。
       */
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        !node.callee.computed &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'Draw' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'arrow'
      ) {
        const opts = node.arguments[2];
        if (!opts || opts.type !== 'ObjectExpression') {
          diagnostics.push(d('arrow-options-not-literal', node, ARROW_OPTS_NOT_LITERAL));
        } else {
          const keys = new Map();
          for (const prop of opts.properties) {
            if (prop.type !== 'Property' || prop.computed) continue;
            const k =
              prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'Literal' ? String(prop.key.value) : null;
            if (k) keys.set(k, prop);
          }
          if (!keys.has('mag')) diagnostics.push(d('arrow-missing-mag', node, ARROW_MAG_REQUIRED));
          if (keys.has('scale')) diagnostics.push(d('arrow-deprecated-scale', keys.get('scale'), ARROW_SCALE_BANNED));
          if (keys.has('color')) diagnostics.push(d('arrow-forbidden-color', keys.get('color'), ARROW_COLOR_BANNED));
          /* v1.1.9：v/a 两类由运行时求导绘制，模型再写就是**重复/错误**的箭头。 */
          const catProp = keys.get('category');
          const catVal = catProp?.value;
          if (
            catVal?.type === 'Literal' &&
            (catVal.value === 'velocity' || catVal.value === 'acceleration')
          ) {
            diagnostics.push(d('arrow-kinematic-forbidden', catProp, ARROW_KINEMATIC_FORBIDDEN));
          }
        }
      }

      /**
       * 判据 9（第 9 期）：`dash` 的类型口径。
       * 只查对象字面量里的**字面量**值：布尔 / null / 数组放行；
       * 字符串、数字、模板字符串、一元表达式等直接报错。
       * 变量/表达式无法静态判定，交给运行时的 parseDash 兜底（会抛清晰错误）。
       */
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        !node.callee.computed &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'Draw' &&
        node.callee.property.type === 'Identifier'
      ) {
        const method = node.callee.property.name;
        const optsIndex = { line: 2, circle: 2, arc: 4, curve: 1, trace: 1, ray: 2, chart: 1, ghosts: 1 }[method];
        if (optsIndex !== undefined) {
          const opts = node.arguments[optsIndex];
          if (opts && opts.type === 'ObjectExpression') {
            for (const prop of opts.properties) {
              if (prop.type !== 'Property' || prop.computed) continue;
              const key =
                prop.key.type === 'Identifier'
                  ? prop.key.name
                  : prop.key.type === 'Literal'
                    ? String(prop.key.value)
                    : null;
              if (key !== 'dash') continue;
              const v = prop.value;
              const ok =
                (v.type === 'Literal' && (typeof v.value === 'boolean' || v.value === null)) ||
                v.type === 'ArrayExpression' ||
                (v.type === 'Identifier' && v.name === 'undefined');
              if (!ok) diagnostics.push(d('dash-invalid-type', v, DASH_TYPE_INVALID));
            }
          }
        }
      }

      // 判据 5：未声明的全局（真作用域链）
      if (node.type === 'Identifier' && isReference(node, parents)) {
        const name = node.name;
        if (knownNames.has(name)) return;
        if (BANNED_PROPERTIES.includes(name)) {
          diagnostics.push(d('prototype-escape', node, `不得引用 ${name}（§6.2）`));
          return;
        }
        const scope = scopes.get(node) ?? root;
        const resolved = scope.resolve(name, node.start);
        if (resolved.found && resolved.visible) return;
        if (resolved.found && !resolved.visible) {
          const loc = nodeLoc(node, headLines);
          diagnostics.push({
            check: 'C1',
            rule: 'used-before-declaration',
            slot,
            line: loc.line,
            column: loc.column,
            message: `名字 ${name} 在本槽位声明过，但此处引用在声明之前（§6.2）。若是想读另一个槽位导出的量，请写成 \`context.${name}\``,
            context: contextLines(lines, loc.line),
          });
          return;
        }

        /**
         * 建议必须有**边界**（第 8 期）。
         *
         * 旧实现永远给"距离最近的 3 个名字"，于是 `isFinite` 得到的是
         * `Infinity` / `BigInt` / `Date` —— 纯噪音，比不给建议更糟（用户原话："这是咋回事"）。
         * 现在只在"编辑距离 ≤ max(1, ⌊长度×0.4⌋)"时才提，最多 2 个；否则一个字都不提。
         */
        const maxDist = Math.max(1, Math.floor(String(name).length * 0.4));
        const suggestions = nearestName(name, allSuggestions, 4)
          .filter((s) => editDistance(String(name).toLowerCase(), String(s).toLowerCase()) <= maxDist)
          .slice(0, 2);
        const loc = nodeLoc(node, headLines);
        const hint = suggestions.length ? `。你是否想写的是 ${suggestions.map((s) => `\`${s}\``).join('、')} ？` : '';
        diagnostics.push({
          check: 'C1',
          rule: 'unknown-global',
          slot,
          line: loc.line,
          column: loc.column,
          message: `引用未声明的名字 ${name}（§6.2）${hint}`,
          suggestion: suggestions[0] ?? null,
          context: contextLines(lines, loc.line),
        });
      }
    });

    // 判据 4
    diagnostics.push(...detectUnboundedLoops(ast, lines, headLines).map((x) => ({ ...x, slot })));
    diagnostics.push(...detectSelfRecursion(ast, lines, headLines).map((x) => ({ ...x, slot })));
  }

  diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);

  /**
   * 第 9 期：把"硬拦 / 告警"分开计数，供 `dryRun()` 决定 C1 这一条的 `blocking`。
   * 判据本身一条不少：`ok` 仍然是"一条诊断都没有"。
   */
  const advisoryDiagnostics = diagnostics.filter((d) => C1_ADVISORY_RULES.includes(d.rule)).length;
  const blockingDiagnostics = diagnostics.length - advisoryDiagnostics;

  return {
    ok: diagnostics.length === 0,
    slot,
    entry,
    backend: PARSER_BACKEND,
    lines: lines.length,
    diagnostics,
    advisoryDiagnostics,
    blockingDiagnostics,
    /** §8.2 回灌内容：失败检查号 + 最小复现（行号级），不发 stack trace */
    minimalRepro: diagnostics.slice(0, 1).map((d) => ({
      slot: d.slot,
      line: d.line,
      column: d.column,
      snippet: lines[d.line - 1] ?? '',
    })),
  };
}

/** 对整份 8 槽位程序做 C1 */
export function lintProgram(slots, opts = {}) {
  const results = [];
  for (const [slot, code] of Object.entries(slots)) {
    /*
     * ⚠ 第 8 期用户裁决：**取消 `stateAt` + `drawFrame` 合计 150 行的上限**。
     *
     * 理由（用户原话："C1 的 150 行限制去掉"）：
     *   · 它是第 1 期拍的"可读性预算"，**不是对错判据**；
     *   · 我们自己的 15 道真题最长已到 147 行 ⇒ 只剩 3 行余量，
     *     一道"两物体 + 弹簧 + 五支箭头 + 墙面纹理"的题必然超；
     *   · 真正要防的是"跑不动/画不动"，那由 C2（10 秒预算）与 C9（每帧命令数）管。
     *
     * 单槽位 400 行总上限**保留**（防止模型写出几千行的巨物）。
     */
    results.push(lintSlot({ code, slot, entry: opts.entry }));
  }
  return {
    ok: results.every((r) => r.ok),
    results,
    totalDiagnostics: results.reduce((n, r) => n + r.diagnostics.length, 0),
    /** 第 9 期「判据分级」：C1 里哪一类算硬拦，由这个计数决定（见 `C1_ADVISORY_RULES`） */
    advisoryDiagnostics: results.reduce((n, r) => n + (r.advisoryDiagnostics ?? 0), 0),
    blockingDiagnostics: results.reduce((n, r) => n + (r.blockingDiagnostics ?? 0), 0),
  };
}
