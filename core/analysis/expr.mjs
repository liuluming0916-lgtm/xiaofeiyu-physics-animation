/**
 * 物理分析表的**表达式内核**（纯函数，无 eval）。
 *
 * 为什么不用 `new Function()`：
 *   分析表来自模型输出，最终会进主进程。用 AST 白名单 + 自己求值，
 *   才能保证"只有算术、只有 t、没有属性/赋值/全局对象"是**结构上**成立的，
 *   而不是靠事后正则过滤（那类过滤永远漏）。
 *
 * 语法白名单（与 `core/prompts/analysis.mjs` 的提示词逐条对应）：
 *   · 数字、t、常量 PI/E；
 *   · + - * / % **、比较、&& || !、?:
 *   · sin cos tan asin acos atan atan2 exp log sqrt abs pow min max floor ceil round sign
 * 不允许：^、Math.*、成员访问、赋值、箭头函数、数组/对象/字符串、其他标识符。
 */

import { parseExpressionAt } from 'acorn';

/** 允许的函数（名字 → 实现 + 参数个数） */
export const ANALYSIS_FUNCTIONS = Object.freeze({
  sin: { fn: Math.sin, arity: 1 },
  cos: { fn: Math.cos, arity: 1 },
  tan: { fn: Math.tan, arity: 1 },
  asin: { fn: Math.asin, arity: 1 },
  acos: { fn: Math.acos, arity: 1 },
  atan: { fn: Math.atan, arity: 1 },
  atan2: { fn: Math.atan2, arity: 2 },
  exp: { fn: Math.exp, arity: 1 },
  log: { fn: Math.log, arity: 1 },
  sqrt: { fn: Math.sqrt, arity: 1 },
  abs: { fn: Math.abs, arity: 1 },
  pow: { fn: Math.pow, arity: 2 },
  min: { fn: Math.min, arity: [1, Infinity] },
  max: { fn: Math.max, arity: [1, Infinity] },
  floor: { fn: Math.floor, arity: 1 },
  ceil: { fn: Math.ceil, arity: 1 },
  round: { fn: Math.round, arity: 1 },
  sign: { fn: Math.sign, arity: 1 },
});

/** 允许的常量 */
export const ANALYSIS_CONSTANTS = Object.freeze({
  PI: Math.PI,
  pi: Math.PI,
  E: Math.E,
});

const BINARY_OPS = new Set(['+', '-', '*', '/', '**']);
const UNARY_OPS = new Set(['+', '-']);

const MAX_NODES = 200;
const MAX_DEPTH = 40;
const MAX_SOURCE = 600;

/**
 * 解析并校验一个表达式。
 *
 * @param {string} src
 * @param {{ variables?: string[] }} [opts] 允许的自变量（闭式只有 t；ODE 后续会加 x/y/vx/vy）
 * @returns {{ ok: true, ast: object } | { ok: false, error: string }}
 */
export function parseExpression(src, opts = {}) {
  const variables = Array.isArray(opts.variables) && opts.variables.length ? opts.variables : ['t'];
  const raw = typeof src === 'string' ? src.trim() : '';
  if (!raw) return { ok: false, error: '表达式为空' };
  if (raw.length > MAX_SOURCE) return { ok: false, error: `表达式过长（${raw.length} > ${MAX_SOURCE} 字符）` };

  /**
   * 允许物理写法 `^`：在进 acorn 之前归一化成 JS 的 `**`。
   * `^` 在 JS 里是按位异或，不在本白名单内；这里做糖化，不改变“只有 t”的约束。
   */
  const text = raw.replace(/\^/g, '**');

  let ast;
  try {
    ast = parseExpressionAt(text, 0, { ecmaVersion: 2022 });
  } catch (e) {
    return { ok: false, error: `语法错误：${e?.message ?? e}` };
  }
  const rest = text.slice(ast.end).trim();
  if (rest) return { ok: false, error: `表达式末尾有多余内容：${rest.slice(0, 24)}` };

  const problems = [];
  let nodes = 0;

  const walk = (node, depth) => {
    if (problems.length) return;
    if (!node || typeof node.type !== 'string') {
      problems.push('表达式结构异常');
      return;
    }
    nodes += 1;
    if (nodes > MAX_NODES) {
      problems.push(`表达式节点过多（> ${MAX_NODES}）`);
      return;
    }
    if (depth > MAX_DEPTH) {
      problems.push(`表达式嵌套过深（> ${MAX_DEPTH}）`);
      return;
    }

    switch (node.type) {
      case 'Literal':
        if (typeof node.value !== 'number' || !Number.isFinite(node.value)) {
          problems.push(`只允许有限数字字面量，收到 ${JSON.stringify(node.value)}`);
        }
        return;
      case 'Identifier':
        if (variables.includes(node.name) || Object.hasOwn(ANALYSIS_CONSTANTS, node.name)) return;
        problems.push(`不允许的标识符 "${node.name}"（只允许 ${[...variables, ...Object.keys(ANALYSIS_CONSTANTS)].join(' / ')}）`);
        return;
      case 'BinaryExpression':
        if (!BINARY_OPS.has(node.operator)) {
          problems.push(`不允许的运算符 "${node.operator}"`);
          return;
        }
        walk(node.left, depth + 1);
        walk(node.right, depth + 1);
        return;
      case 'UnaryExpression':
        if (!UNARY_OPS.has(node.operator)) {
          problems.push(`不允许的一元运算符 "${node.operator}"`);
          return;
        }
        walk(node.argument, depth + 1);
        return;
      case 'CallExpression': {
        if (node.callee?.type !== 'Identifier') {
          problems.push('只允许直接调用白名单函数（如 sin(t)），不允许方法调用');
          return;
        }
        const spec = ANALYSIS_FUNCTIONS[node.callee.name];
        if (!spec) {
          problems.push(`不允许的函数 "${node.callee.name}"`);
          return;
        }
        const args = node.arguments ?? [];
        if (args.some((a) => a.type === 'SpreadElement')) {
          problems.push('函数参数不允许展开');
          return;
        }
        const [min, max] = Array.isArray(spec.arity) ? spec.arity : [spec.arity, spec.arity];
        if (args.length < min || args.length > max) {
          problems.push(`${node.callee.name} 需要 ${min}${max === min ? '' : `–${max}`} 个参数，收到 ${args.length}`);
          return;
        }
        for (const a of args) walk(a, depth + 1);
        return;
      }
      default:
        problems.push(`不允许的语法 "${node.type}"`);
    }
  };

  walk(ast, 1);
  if (problems.length) return { ok: false, error: problems[0] };
  return { ok: true, ast };
}

/** 在白名单 AST 上求值（不经过 eval） */
function evalNode(node, env) {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'Identifier':
      if (Object.hasOwn(env, node.name)) return env[node.name];
      if (Object.hasOwn(ANALYSIS_CONSTANTS, node.name)) return ANALYSIS_CONSTANTS[node.name];
      throw new Error(`未知标识符 ${node.name}`);
    case 'BinaryExpression': {
      const a = evalNode(node.left, env);
      const b = evalNode(node.right, env);
      switch (node.operator) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '%': return a % b;
        case '**': return a ** b;
        case '<': return a < b;
        case '>': return a > b;
        case '<=': return a <= b;
        case '>=': return a >= b;
        case '==': return a == b; // eslint-disable-line eqeqeq
        case '===': return a === b;
        case '!=': return a != b; // eslint-disable-line eqeqeq
        case '!==': return a !== b;
        default: throw new Error(`未知运算符 ${node.operator}`);
      }
    }
    case 'LogicalExpression': {
      const a = evalNode(node.left, env);
      if (node.operator === '&&') return a && evalNode(node.right, env);
      return a || evalNode(node.right, env);
    }
    case 'UnaryExpression': {
      const v = evalNode(node.argument, env);
      if (node.operator === '+') return +v;
      if (node.operator === '-') return -v;
      return !v;
    }
    case 'ConditionalExpression':
      return evalNode(node.test, env) ? evalNode(node.consequent, env) : evalNode(node.alternate, env);
    case 'CallExpression': {
      const spec = ANALYSIS_FUNCTIONS[node.callee.name];
      const args = node.arguments.map((a) => evalNode(a, env));
      return spec.fn(...args);
    }
    default:
      throw new Error(`未实现的语法 ${node.type}`);
  }
}

/**
 * 编译成 `(env) => number|boolean`；闭式场景用 `compileT()` 包一层。
 * @param {string} src
 * @param {{ variables?: string[] }} [opts]
 */
export function compileExpression(src, opts = {}) {
  const parsed = parseExpression(src, opts);
  if (!parsed.ok) return parsed;
  const variables = Array.isArray(opts.variables) && opts.variables.length ? opts.variables : ['t'];
  const evalWith = (env) => evalNode(parsed.ast, env);
  return {
    ok: true,
    variables,
    ast: parsed.ast,
    eval: evalWith,
  };
}

/**
 * 闭式专用：`(t) => number`。
 * @param {string} src
 * @returns {{ ok: true, fn: (t:number)=>number, src: string } | { ok: false, error: string }}
 */
/**
 * 编译一条 `x(t)` / `y(t)` 表达式。
 *
 * `vars` 是**本段的初态锚点**（`t0 / x0 / y0 / vx0 / vy0`），允许模型直接把它们写进表达式，
 * 例如 `y0 + vx0*0 + ...`、`x0 + vx0*(t - t0)`。
 *
 * 为什么要这么做（用户 2026-10-23）：让模型写"相对本段起点"的增量式，
 * 而不是自己把常数项算出来铺开。模型一旦自己展开（把上一段末值 + 本段初速度代入求截距），
 * 就会引入两处算术错误的机会 —— q04 的 `2.5 - 1.5*cos + 2.4495*sin` 就是展开后的产物。
 * 用字段名以后，常数项是**抄**来的（parser 还会拿 anchor 做一致性校验），不是算来的。
 */
export function compileT(src, vars = null) {
  const names = vars && typeof vars === 'object' ? ['t', ...Object.keys(vars)] : ['t'];
  const c = compileExpression(src, { variables: names });
  if (!c.ok) return c;
  const bound = vars && typeof vars === 'object' ? { ...vars } : {};
  return {
    ok: true,
    src,
    fn: (t) => c.eval({ ...bound, t }),
  };
}
