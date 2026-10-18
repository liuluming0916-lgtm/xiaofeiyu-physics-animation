/**
 * 一次性探针：在 Node 里跑浏览器版 `template/tex-inline-renderer.js`，
 * 用它逐个渲染**真实题面里的公式**，看有没有掉到"原文降级"（第三层）。
 *
 * 为什么需要它：演示界面里公式变成了一堆 `\mathrm`、`\frac` 原文，
 * 而模板页（15 题）没有这个问题 —— 差别在于实测页面有构建期 MathJax 预渲染，
 * 演示界面走的是**行内渲染器兜底**。所以必须单独验证兜底渲染器到底行不行。
 *
 * 用法：node tools/_tex-fallback-probe.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { PROJECT_ROOT } from './paths.mjs';

const SRC = join(PROJECT_ROOT, 'template', 'tex-inline-renderer.js');
const code = readFileSync(SRC, 'utf8');

/* ── 极简 DOM：够渲染器用，并提供一个把节点树序列化成 HTML 的函数 ── */
function makeEl(tag) {
  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    className: '',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    parentNode: null,
    setAttribute() {},
    getAttribute: () => null,
    appendChild(c) {
      c.parentNode = el;
      el.children.push(c);
      return c;
    },
    removeChild(c) {
      el.children = el.children.filter((x) => x !== c);
      return c;
    },
    replaceChild(n, o) {
      const i = el.children.indexOf(o);
      if (i >= 0) el.children[i] = n;
      return o;
    },
    get firstChild() {
      return el.children[0] ?? null;
    },
  };
  Object.defineProperty(el, 'textContent', {
    get() {
      return el.children.map((c) => (c.nodeType === 3 ? c.textContent : c.textContent)).join('');
    },
    set(v) {
      el.children = [{ nodeType: 3, textContent: String(v), children: [] }];
    },
  });
  return el;
}

function makeText(t) {
  const n = { nodeType: 3, textContent: String(t), children: [], parentNode: null, namespaceURI: null };
  Object.defineProperty(n, 'nodeValue', {
    get() {
      return n.textContent;
    },
    set(v) {
      n.textContent = String(v);
    },
  });
  return n;
}

/** 节点树 → HTML（用来判断"有没有真的生成结构"，而不是只看文字） */
function serialize(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent;
  const cls = node.className ? ` class="${node.className}"` : '';
  const inner = (node.children ?? []).map(serialize).join('');
  return `<${node.tagName.toLowerCase()}${cls}>${inner}</${node.tagName.toLowerCase()}>`;
}

const documentStub = {
  createElement: (t) => makeEl(t),
  createTextNode: (t) => makeText(t),
  createDocumentFragment: () => makeEl('#fragment'),
  createTreeWalker: (root) => {
    const texts = [];
    const collect = (n) => {
      if (!n) return;
      if (n.nodeType === 3) texts.push(n);
      for (const c of n.children ?? []) collect(c);
    };
    collect(root);
    let i = -1;
    return {
      currentNode: root,
      nextNode() {
        i += 1;
        if (i >= texts.length) return null;
        this.currentNode = texts[i];
        return this.currentNode;
      },
    };
  },
};

const sandbox = {
  window: {},
  document: documentStub,
  console,
  Math,
  String,
  Number,
  Array,
  Object,
  RegExp,
  Boolean,
  isNaN,
  NodeFilter: { SHOW_TEXT: 4 },
};
sandbox.window.document = documentStub;
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
vm.runInContext(code, context, { filename: 'tex-inline-renderer.js' });

const ODTex = sandbox.window.ODTex;
console.log(`渲染器：${ODTex ? ODTex.renderer : '（未挂上 window.ODTex！）'}\n`);

/* ── 真实公式：从 q01 的题面与 STEPS 里取 ── */
const q01 = (await import(`file://${join(PROJECT_ROOT, 'tests', 'regression-15', 'q01-conveyor-heat.mjs').replace(/\\/g, '/')}`)).default;

function extractInlineTex(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\$([^$\n]+)\$/g)) out.add(m[1]);
  return [...out];
}

const fromProblem = extractInlineTex(q01.slots.PROBLEM);
const fromSteps = [...q01.slots.STEPS.matchAll(/^tex:\s*(.+)$/gm)].map((m) => m[1].trim());
const formulas = [...new Set([...fromProblem, ...fromSteps])];

console.log(`取自 q01：题面 ${fromProblem.length} 条 + 步骤 ${fromSteps.length} 条（去重后 ${formulas.length} 条）\n`);

let rawFallback = 0;
let structured = 0;
const problems = [];

for (const tex of formulas) {
  const out = ODTex ? ODTex.toHtml(tex) : null;
  const html = out ? serialize(out) : '(null)';
  // "掉到原文"的特征：整棵树里没有任何结构性标签（i / sup / sub / span.frac / span.op）
  const hasStructure = /<(i|sup|sub|span class="frac"|span class="op")/.test(html);
  if (!out) {
    rawFallback += 1;
    problems.push({ tex, why: 'toHtml 返回 null' });
  } else if (!hasStructure && /\\[A-Za-z]/.test(tex)) {
    rawFallback += 1;
    problems.push({ tex, why: `无结构（可能被当纯文本）→ ${html.slice(0, 90)}` });
  } else {
    structured += 1;
  }
  const mark = hasStructure ? '✓' : '✗';
  console.log(`  ${mark} ${JSON.stringify(tex).slice(0, 74)}`);
  if (!hasStructure) console.log(`      → ${html.slice(0, 120)}`);
}

console.log(`\n有结构 ${structured} 条 · 掉到原文 ${rawFallback} 条`);
if (problems.length) {
  console.log('\n掉到原文的公式：');
  for (const p of problems) console.log(`  · ${JSON.stringify(p.tex)}\n      ${p.why}`);
  process.exitCode = 1;
}
