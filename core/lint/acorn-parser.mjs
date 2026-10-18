/**
 * 槽位代码的解析器：**acorn 单后端**（§2.2 / §6.2）。
 *
 * 用户决议（本轮表单）：只保留 acorn 单后端，不再保留自写 tokenizer 的兜底路径。
 * 因此本模块是唯一的解析入口，输出统一的 { ast, errors, lines, lineAt }。
 *
 * ⚠ 沙箱注意：本机禁止"管道捕获子进程输出"，一切探测都要用 `stdio:'inherit'` 或不探测；
 * acorn 是**进程内**依赖，不涉及子进程，因此完全可用。
 */

import { Parser } from 'acorn';

/** 解析选项：位置信息齐全（行/列都要，§6.2 要求行号级诊断） */
const PARSE_OPTIONS = Object.freeze({
  ecmaVersion: 2022,
  sourceType: 'script',
  locations: true,
  allowReturnOutsideFunction: false,
  allowAwaitOutsideFunction: false,
  allowImportExportEverywhere: false,
});

export const PARSER_BACKEND = `acorn@${acornVersion()}`;

function acornVersion() {
  try {
    // acorn 8 的 dist/acorn.mjs 导出 `version`
    return Parser.version ?? '8';
  } catch {
    return '8';
  }
}

export function sourceLines(source) {
  return String(source ?? '').split(/\r?\n/);
}

/**
 * 槽位文本在装配后是**函数体**（见 `buildProgramSource`），因此允许 `return`。
 * 直接按 Program 解析会把 `return {…}` 判成语法错误、并连带掩盖真正的判据问题。
 * 这里把源码包一层合成函数壳再解析，随后把行号减 1 还原回槽位坐标。
 */
function wrapAsFunctionBody(code, params) {
  const head = `function __slot__(${(params ?? []).join(', ')}) {\n`;
  return { head, src: `${head}${code}\n}` };
}

/**
 * 解析一段槽位代码。
 *
 * @param {string} code
 * @param {string} [filename] 仅用于诊断展示
 * @param {string[]} [params] 该槽位在装配后的形参（如 stateAt 的 `t`）
 * @returns {{ast:object|null, errors:Array<object>, lines:string[]}}
 *   errors 的每项形如 { code, line, column, message }——**与上一版自写后端同形**，
 *   因此下游（自愈回灌、槽位级重生成）不需要知道解析器是谁。
 */
export function parseSlot(code, filename = 'slot.js', params = []) {
  const lines = sourceLines(code);
  const trimmed = String(code ?? '');
  // 已经显式声明了同名合成函数名时不再包装（避免命名冲突）
  const wrap = !/function\s+__slot__/.test(trimmed);
  // `headOffset`：合成函数壳占用的字符数。AST 节点的 `start` 是**相对包装后源码**的偏移，
  // 要在原文里做插入（第 2 期的诊断埋点）就必须减掉它——不减就会插到语句中间去。
  const { src, headLines, headOffset } = wrap
    ? (() => {
        const w = wrapAsFunctionBody(trimmed, params);
        return { src: w.src, headLines: 1, headOffset: w.head.length };
      })()
    : { src: trimmed, headLines: 0, headOffset: 0 };

  try {
    const ast = Parser.parse(src, { ...PARSE_OPTIONS, sourceFile: filename });
    return { ast, errors: [], lines, wrapped: wrap, headLines, headOffset };
  } catch (err) {
    const loc = err.loc ?? { line: 1, column: 0 };
    const rawLine = loc.line ?? 1;
    const line = Math.max(1, rawLine - headLines);
    const col = (loc.column ?? 0) + 1;
    const raw = String(err.message ?? err).replace(/\s*\(\d+:\d+\)\s*$/, '');
    return {
      ast: null,
      errors: [
        {
          code: 'syntax-error',
          line,
          column: col,
          message: `语法错误：${raw}（acorn 报第 ${line} 行第 ${col} 列）`,
          rawLine,
        },
      ],
      lines,
      wrapped: wrap,
      headLines,
      headOffset,
    };
  }
}

/** 取诊断上下文行（前后各一行），§6.2：给上下文，不给 stack trace */
export function contextLines(lines, line, span = 1) {
  const out = [];
  for (let i = Math.max(1, line - span); i <= Math.min(lines.length, line + span); i += 1) {
    out.push({ line: i, text: lines[i - 1], isTarget: i === line });
  }
  return out;
}

/** 节点 → 槽位坐标（1-based 行列），已扣除合成函数壳占用的那一行 */
export function nodeLoc(node, headLines = 0) {
  const loc = node?.loc?.start;
  if (!loc) return { line: 1, column: 1 };
  return { line: Math.max(1, loc.line - headLines), column: loc.column + 1 };
}
