#!/usr/bin/env node
/**
 * 一次性迁移：从 regression fixture 里删掉 Draw.text / Draw.latex 调用，
 * 以及 Draw.dimension 的 `text:` 属性（这些文字本来就不显示）。
 *
 * 只处理显式传入的文件；不扫描仓库，避免误伤。
 */
import { readFileSync, writeFileSync } from 'node:fs';

function findClose(src, openIdx) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripCalls(src, name) {
  let out = src;
  for (;;) {
    const at = out.indexOf(`${name}(`);
    if (at < 0) break;
    const open = at + name.length;
    const close = findClose(out, open);
    if (close < 0) throw new Error(`unbalanced ${name}`);
    let end = close + 1;
    if (out[end] === ';') end += 1;
    // 吃掉本行剩余空白；若整行只有这个调用，连换行一起删。
    let lineStart = out.lastIndexOf('\n', at) + 1;
    let lineEnd = out.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = out.length;
    const before = out.slice(lineStart, at);
    const after = out.slice(end, lineEnd);
    if (!before.trim() && !after.trim()) {
      out = out.slice(0, lineStart) + out.slice(Math.min(lineEnd + 1, out.length));
    } else {
      out = out.slice(0, at) + out.slice(end);
    }
  }
  return out;
}

function stripDimensionText(src) {
  let out = src;
  for (;;) {
    const at = out.indexOf('Draw.dimension(');
    if (at < 0) break;
    const open = at + 'Draw.dimension'.length;
    const close = findClose(out, open);
    if (close < 0) throw new Error('unbalanced Draw.dimension');
    const inner = out.slice(open + 1, close);
    let depth = 0;
    let quote = null;
    let escaped = false;
    let removeFrom = -1;
    let removeTo = -1;
    for (let i = 0; i < inner.length; i += 1) {
      const ch = inner[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
      if (depth === 0 && inner.startsWith('text:', i)) {
        removeFrom = i;
        // 找同层逗号或结尾
        let d = 0;
        let q = null;
        let esc = false;
        let j = i + 5;
        for (; j < inner.length; j += 1) {
          const c = inner[j];
          if (q) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === q) q = null;
            continue;
          }
          if (c === '"' || c === "'" || c === '`') { q = c; continue; }
          if (c === '(' || c === '[' || c === '{') d += 1;
          else if (c === ')' || c === ']' || c === '}') d -= 1;
          else if (c === ',' && d === 0) break;
        }
        removeTo = j;
        break;
      }
    }
    if (removeFrom >= 0) {
      let rest = inner.slice(removeTo);
      let head = inner.slice(0, removeFrom).replace(/,\s*$/, '');
      if (!rest.trim()) {
        out = out.slice(0, open + 1) + head + out.slice(close);
      } else {
        rest = rest.replace(/^\s*,\s*/, '');
        out = out.slice(0, open + 1) + head + (head.trim() ? ', ' : '') + rest + out.slice(close);
      }
      continue;
    }
    // 没有 text 属性：跳过后继续找下一个
    const next = out.indexOf('Draw.dimension(', close + 1);
    if (next < 0) break;
    // 用一个临时占位避免死循环：直接切片处理
    const prefix = out.slice(0, close + 1);
    const suffix = out.slice(close + 1);
    out = prefix + suffix.replace('Draw.dimension(', 'Draw.dimension_(');
  }
  return out.replaceAll('Draw.dimension_(', 'Draw.dimension(');
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/_strip-legacy-draw.mjs <files...>');
  process.exit(2);
}
for (const file of files) {
  let src = readFileSync(file, 'utf8');
  src = stripCalls(src, 'Draw.text');
  src = stripCalls(src, 'Draw.latex');
  src = stripCalls(src, 'Draw.dimension');
  writeFileSync(file, src, 'utf8');
  console.log('stripped', file);
}
