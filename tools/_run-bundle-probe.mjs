/**
 * 一次性探针：在 Node 的 vm 里**真跑一遍** `web/dist/assets/app.js`，看它有没有顶层报错。
 *
 * 为什么要这一步：产物"能下载"不等于"能执行"。
 * 第 3 期第 9 步交付时页面白屏，根因就是产物顶层抛 `ReferenceError: process is not defined`
 * —— 而当时所有门禁都是绿的（它们只查文件在不在、引用有没有落点，**不执行产物**）。
 *
 * 本探针喂一个够用的 DOM 桩，只断言一件事：**顶层不抛错**。
 * 它不能替代真浏览器（React 的渲染是异步的、后续 DOM 操作我们桩不了），
 * 但能钉住"bundle 能不能跑起来"这一层 —— 也就是白屏的直接原因。
 *
 * 用法：node tools/_run-bundle-probe.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { PROJECT_ROOT } from './paths.mjs';

const JS = join(PROJECT_ROOT, 'web', 'dist', 'assets', 'app.js');
const code = readFileSync(JS, 'utf8');

/* ── 先做静态扫描（这一层最可靠，不依赖桩的完整度） ── */
const FORBIDDEN = [
  ['process.env', /\bprocess\s*\.\s*env\b/],
  ['require(', /\brequire\s*\(\s*['"]/],
  ['__dirname', /\b__dirname\b/],
  ['Buffer.from/alloc', /\bBuffer\s*\.\s*(from|alloc|concat)\b/],
  ['顶层 import/export', /^\s*(?:import|export)\s/m],
];

let staticFail = 0;
console.log('app.js 静态扫描');
for (const [name, re] of FORBIDDEN) {
  const n = (code.match(new RegExp(re.source, 'g')) || []).length;
  if (n) {
    staticFail += 1;
    console.log(`  ✗ 出现 ${name} × ${n}（浏览器里会抛错并整页白屏）`);
  }
}
if (!staticFail) console.log('  ✓ 未出现浏览器不认识的 Node 全局 / ESM 语法');

/* ── 再在 vm 里真执行（顶层抛错会被抓到） ── */
/**
 * ⚠ 桩必须补全到 React 真正会碰的那几个属性。
 *   第一版漏了 `ownerDocument`，React 的 `attachEventListeners` 在
 *   `9 === node.nodeType ? node : node.ownerDocument` 之后立刻 `.getElementsByTagName(...)`，
 *   于是桩里抛 `Cannot read properties of undefined (reading '_reactListening…')`。
 *   那**不是**页面的真故障（真实 DOM 一定有 ownerDocument），属于**桩的假阳性** ——
 *   假阳性会掩盖真问题，所以桩要补到"不再因为桩本身而失败"为止。
 */
function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    hidden: false,
    nodeType: 1,
    ownerDocument: null, // 下面统一指到 documentStub
    parentNode: null,
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k) { return k in this.attributes; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    replaceChild(n, o) { const i = this.children.indexOf(o); if (i >= 0) this.children[i] = n; return o; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    querySelector: () => makeEl(), querySelectorAll: () => [],
    getElementsByTagName: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    focus() {}, blur() {}, click() {}, contains: () => false,
    get firstChild() { return this.children[0] ?? null; },
  };
  return el;
}

const documentStub = {
  readyState: 'complete',
  title: 'probe',
  documentElement: makeEl('html'),
  body: makeEl('body'),
  head: makeEl('head'),
  createElement: (t) => makeEl(t),
  createTextNode: (t) => { const n = { nodeType: 3, textContent: String(t), children: [], parentNode: null }; Object.defineProperty(n, 'nodeValue', { get() { return this.textContent; } }); return n; },
  createDocumentFragment: () => makeEl('#fragment'),
  createTreeWalker: () => ({ currentNode: null, nextNode: () => null }),
  getElementById: (id) => (id === 'root' ? documentStub._root : makeEl()),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  _root: null,
};
documentStub._root = makeEl('div');

/* 把所有元素的 ownerDocument 指到 documentStub（React 会沿着它找 document） */
const seen = new Set();
const fixOwner = (el) => {
  if (!el || seen.has(el)) return;
  seen.add(el);
  try {
    el.ownerDocument = documentStub;
  } catch {
    /* 只读属性，跳过 */
  }
};
[documentStub.documentElement, documentStub.body, documentStub.head, documentStub._root].forEach(fixOwner);

/* createElement 造出来的元素也要补 ownerDocument：包一层 */
const rawCreate = documentStub.createElement;
documentStub.createElement = (t) => {
  const el = rawCreate(t);
  el.ownerDocument = documentStub;
  return el;
};

const windowStub = {
  document: documentStub,
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 800,
  location: { href: 'http://127.0.0.1:8080/', protocol: 'http:', host: '127.0.0.1:8080' },
  navigator: { userAgent: 'probe' },
  addEventListener() {}, removeEventListener() {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  setTimeout: () => 0, clearTimeout: () => {},
  setInterval: () => 0, clearInterval: () => {},
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  parent: null,
  postMessage() {},
  fetch: () => Promise.reject(new Error('probe: 不真的联网')),
};
windowStub.parent = windowStub; // 不在 iframe 里
windowStub.window = windowStub;

const sandbox = {
  window: windowStub,
  document: documentStub,
  navigator: windowStub.navigator,
  location: windowStub.location,
  localStorage: windowStub.localStorage,
  console,
  Math, JSON, Date, Number, String, Boolean, Array, Object, RegExp, Error, TypeError, Symbol, Map, Set, WeakMap, WeakSet,
  Promise, Proxy, Reflect, Intl, isNaN, isFinite, parseFloat, parseInt,
  setTimeout: windowStub.setTimeout, clearTimeout: windowStub.clearTimeout,
  setInterval: windowStub.setInterval, clearInterval: windowStub.clearInterval,
  requestAnimationFrame: windowStub.requestAnimationFrame,
  queueMicrotask,
  TextEncoder, TextDecoder,
  URL, URLSearchParams, AbortController, AbortSignal, Event, EventTarget, ReadableStream, Blob, FormData, Headers, Request, Response, fetch: windowStub.fetch,
  getComputedStyle: windowStub.getComputedStyle,
  NodeFilter: { SHOW_TEXT: 4 },
  /**
   * ⚠ 必须**自己提供** MessageChannel，不能用 Node 内建的那个。
   *   原因：React 18 的调度器优先用 `MessageChannel` 派发任务；Node 内建的 MessagePort
   *   会把事件对象**跨 vm 边界**传进来，`instanceof MessagePort` 之类的判断在
   *   `vm.createContext` 的沙箱里会拿到不同 realm 的构造函数 ⇒
   *   `TypeError: Right-hand side of 'instanceof' is not an object`。
   *   那是**探针环境的假阳性**，浏览器里不存在这个问题（同 realm）。
   *   这里给一个同步派发的等价实现，语义够用且不会伪造失败。
   */
  MessageChannel: class MessageChannel {
    constructor() {
      const self = this;
      this.port1 = {
        onmessage: null,
        postMessage(data) {
          // 浏览器里是宏任务；这里直接排队，避免递归爆栈
          windowStub.setTimeout(() => {
            if (typeof self.port2.onmessage === 'function') self.port2.onmessage({ data });
          }, 0);
        },
        start() {},
        close() {},
        addEventListener() {},
        removeEventListener() {},
      };
      this.port2 = {
        onmessage: null,
        postMessage(data) {
          windowStub.setTimeout(() => {
            if (typeof self.port1.onmessage === 'function') self.port1.onmessage({ data });
          }, 0);
        },
        start() {},
        close() {},
        addEventListener() {},
        removeEventListener() {},
      };
    }
  },
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

const context = vm.createContext(sandbox);
let thrown = null;
try {
  vm.runInContext(code, context, { filename: 'app.js' });
} catch (err) {
  thrown = err;
}

console.log('\nvm 里真实执行 app.js');
if (thrown) {
  console.log(`  ✗ 顶层抛出：${thrown.name}: ${thrown.message}`);
  console.log(`      ${String(thrown.stack).split('\n').slice(1, 4).join('\n      ')}`);
} else {
  console.log('  ✓ 顶层未抛错（bundle 能被浏览器执行到 React 挂载这一步）');
}

const bad = staticFail > 0 || Boolean(thrown);
if (bad) {
  console.log('\n✗ 产物在本判据下不合格（这就是"页面空白"的直接原因）');
  process.exitCode = 1;
} else {
  console.log('\n✓ 产物通过"能否在浏览器里跑起来"的最低判据');
}
