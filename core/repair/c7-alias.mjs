/**
 * C7 确定性快修（v1.1.5 · 用户 2026-10-19 拍板）
 *
 * 场景：答案里写的是**纯符号结论**（`value: null`），但 `ANSWERS.symbol` 没在
 * `readouts` 里逐字出现 —— 例如答案写 `\vec E+\vec v\times\vec B`，读数却叫 `E-vB`。
 *
 * 这类"纯粹名字对不上"的错，不值得再调一次模型：
 * 直接把**答案自己的符号**原样加成一条读数（`value: 0`），再跑一遍 C7 即可。
 *
 * 三条边界（避免把确定性修复变成瞎改）：
 *   ① 只处理**所有阻塞失败都是 C7** 的报告；还有别的失败就不碰。
 *   ② 只处理诊断明确写着 `ANSWERS[i] … 在 t=… 的 readouts 中不存在` 的条目。
 *   ③ 只处理 `value: null` 的纯符号答案；数值结论的名字不匹配不在这里修。
 *
 * ⚠ 这不是"物理名对照表"：新增读数的 key/label 就是答案自己的 symbol，没有任何硬编码映射。
 */

/** 从 readouts 源码里找出主 `return [ … ]` 并插到末尾 */
export function appendReadoutRows(code, rows) {
  if (typeof code !== 'string' || !rows.length) return null;
  const span = findReturnArray(code);
  if (!span) return null;
  const head = code.slice(0, span.close);
  const tail = code.slice(span.close);
  const trimmed = head.replace(/\s+$/, '');
  const last = trimmed[trimmed.length - 1] ?? '';
  const needsComma = trimmed !== '' && last !== '[' && last !== ',';
  const body = rows
    .map((r) => {
      const fields = [
        `key: ${JSON.stringify(r.symbol)}`,
        `label: ${JSON.stringify(r.symbol)}`,
        'value: 0',
        `unit: ${JSON.stringify(r.unit || '')}`,
      ];
      if (r.latex) fields.push(`latex: ${JSON.stringify(r.latex)}`);
      return `  { ${fields.join(', ')} }`;
    })
    .join(',\n');
  return `${trimmed}${needsComma ? ',' : ''}\n${body}\n${tail}`;
}

function findReturnArray(code) {
  let i = 0;
  let quote = null;
  while (i < code.length) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '/' && code[i + 1] === '/') {
      i += 2;
      while (i < code.length && code[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }
    if (
      code.startsWith('return', i) &&
      !/[A-Za-z0-9_$]/.test(code[i - 1] ?? '') &&
      !/[A-Za-z0-9_$]/.test(code[i + 6] ?? '')
    ) {
      let j = i + 6;
      while (j < code.length && /\s/.test(code[j])) j += 1;
      if (code[j] === '[') {
        const close = matchBracket(code, j);
        if (close >= 0) return { open: j, close };
      }
    }
    i += 1;
  }
  return null;
}

function matchBracket(code, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && code[i + 1] === '/') {
      i += 2;
      while (i < code.length && code[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * @param {{ slots: Record<string,string>, report: object, answers: Array<object> }} input
 * @returns {{ ok: boolean, reason: string, slots?: Record<string,string>, rows?: Array<object> }}
 */
export function planC7Alias({ slots, report, answers }) {
  if (!slots || typeof slots.readouts !== 'string') return { ok: false, reason: '没有可改的 readouts 代码' };
  if (!Array.isArray(answers) || !answers.length) return { ok: false, reason: '没有 ANSWERS' };

  const blocking = (report?.checks ?? []).filter((c) => c.blocking && c.status === 'fail');
  if (!blocking.length) return { ok: false, reason: '没有阻塞失败' };
  if (blocking.some((c) => c.id !== 'C7')) return { ok: false, reason: '还有 C7 之外的阻塞失败' };

  const rows = [];
  for (const check of blocking) {
    for (const d of check.diagnostics ?? []) {
      const m = /^ANSWERS\[(\d+)\].*在 t=.*的 readouts 中不存在/.exec(String(d?.reason ?? ''));
      if (!m) continue;
      const ans = answers[Number(m[1])];
      if (!ans || ans.value !== null || typeof ans.symbol !== 'string' || !ans.symbol) continue;
      if (rows.some((r) => r.symbol === ans.symbol)) continue;
      rows.push({ symbol: ans.symbol, unit: ans.unit ?? '', latex: ans.latex ?? null });
    }
  }
  if (!rows.length) return { ok: false, reason: '没有可确定性修复的纯符号 C7' };

  const readouts = appendReadoutRows(slots.readouts, rows);
  if (!readouts) return { ok: false, reason: 'readouts 不是可识别的 return [ … ] 结构' };
  return { ok: true, reason: `把 ${rows.length} 条答案符号原样加成读数`, slots: { ...slots, readouts }, rows };
}
