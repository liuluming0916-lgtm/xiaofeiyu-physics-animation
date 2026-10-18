/**
 * 把 `JSON.parse` 的原始报错翻成**带位置**的中文（通用小工具）。
 *
 * 单独成文件的原因：规则工作区（`core/rules/kinds.mjs`）与端点配置（`core/gateway/`）
 * 都要用它，而后者不该为了一个错误文案去 import 前者（那会把 cleaner 一并拉进来）。
 *
 * ⚠ 为什么不能直接用原始 message：V8 对"文件没写完"只给一句
 *   `Unexpected end of JSON input`，**没有行列号**——而少写一个 `}` 恰恰是最常见的错法。
 *   用户拿到这句话等于没拿到位置。
 */

/**
 * @param {string} text 原始文件内容
 * @param {unknown} e   JSON.parse 抛出的错误
 * @returns {{ message: string, hint?: string }}
 */
export function describeJsonError(text, e) {
  const raw = String(e?.message ?? e);
  const src = String(text ?? '');

  const lc = /\(line (\d+) column (\d+)\)/.exec(raw);
  if (lc) {
    return { message: `不是合法 JSON：第 ${lc[1]} 行第 ${lc[2]} 列附近（${raw}）` };
  }

  const pos = /position (\d+)/.exec(raw);
  if (pos) {
    const at = Number(pos[1]);
    const before = src.slice(0, at);
    const line = before.split('\n').length;
    const column = at - before.lastIndexOf('\n');
    return { message: `不是合法 JSON：第 ${line} 行第 ${column} 列附近（${raw}）` };
  }

  const totalLines = src.split('\n').length;
  if (/unexpected end of json input/i.test(raw)) {
    return {
      message: `不是合法 JSON：文件在第 ${totalLines} 行附近就结束了（没写完）`,
      hint: '多半是结尾少了 } 或 ]：把括号补齐再保存；也可能整段内容被截断了',
    };
  }

  return { message: `不是合法 JSON：${raw}`, hint: `文件共 ${totalLines} 行，请核对括号与逗号是否配对` };
}
