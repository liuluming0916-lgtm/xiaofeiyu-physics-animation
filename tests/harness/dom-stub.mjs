/**
 * 测试台：一个**够用且照真实语义实现**的最小 DOM 桩。
 *
 * 为什么要有这个文件（第 3 期交付后抽出来的）：
 * `tests/host-protocol-selftest.mjs` 需要在 `node:vm` 里**真跑一遍模板页的内联脚本**，
 * 于是要喂一个 DOM。第一版的桩是"每个选择器返回一个**空**元素"，
 * 结果**内容级断言全是假的**：
 *   · "注入后页头有没有变成真实题目名"  —— 读到空字符串
 *   · "公式有没有命中预渲染"            —— 树上永远没有节点
 * **桩的能力边界就是判据的能力边界。** 要做内容级断言，桩就必须真的解析 HTML、真的维护元素树。
 *
 * 本模块只实现模板与运行时真正用到的那部分 DOM：
 *   元素/文本节点、属性、children/parentNode、appendChild/replaceChild/removeChild、
 *   选择器（`[attr="v"]` · `.class` · `tag`）、createTreeWalker、classList、canvas 上下文。
 * 是**测试台**而不是浏览器：不追求通用，但必须能真实回答"那个元素现在的文本是什么"。
 */

/** 极简 Canvas 2D 上下文：所有方法都是空操作，量测返回固定值 */
export function makeStubContext() {
  return new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === 'canvas') return { width: 800, height: 450 };
        if (k === 'measureText') return () => ({ width: 10 });
        if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
        return () => {};
      },
      set: () => true,
    },
  );
}

/** 文本节点：同时提供 nodeValue 与 textContent（TeX 渲染器读前者） */
export function makeTextNode(t) {
  const node = { nodeType: 3, textContent: String(t), children: [], parentNode: null, namespaceURI: null };
  Object.defineProperty(node, 'nodeValue', {
    get() {
      return this.textContent;
    },
    set(v) {
      this.textContent = String(v);
    },
  });
  return node;
}

/** 创建一个桩元素 */
export function makeStubElement(tag = 'div') {
  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    children: [],
    listeners: {},
    attributes: {},
    style: {},
    dataset: {},
    /**
     * ⚠ `classList` 与 `className` **必须双向同步**（真实 DOM 就是镜像的）。
     *
     *   模板写样式有两种方式：`el.className = 'tex tex-svg'`（赋值）与
     *   `el.classList.add('x')`（方法）。第一版桩里两者是**互不相干的独立字段**，
     *   于是"按类名查元素"（`querySelectorAll('.tex-svg')`）**永远查不到** ——
     *   判据因此永远失败（假红）。这是本桩第三版的 bug：
     *   结构对了、文字对了，**类名丢了**。
     *   三条一脉相承：**桩少实现一点语义，判据就少一分可信**。
     */
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      get _owner() { return el; },
    },
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    hidden: false,
    max: '',
    step: '',
    width: 800,
    height: 450,
    clientWidth: 800,
    clientHeight: 450,
    scrollWidth: 800,
    clientLeft: 0,
    ownerDocument: null,
    getContext: () => makeStubContext(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 450, width: 800, height: 450 }),
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    },
    getAttribute(k) {
      return k in this.attributes ? this.attributes[k] : null;
    },
    removeAttribute(k) {
      delete this.attributes[k];
    },
    hasAttribute(k) {
      return k in this.attributes;
    },
    getElementsByTagName: () => [],
    /**
     * 内部选择器引擎。支持本测试真正用到的形态：
     *   `[attr]` · `[attr="v"]`（模板的取元素方式）· `.class` · `tag`，
     *   以及它们的**后代组合**（如 `.tex-svg`、`[data-od-id]`）。
     */
    _query(selRaw) {
      const out = [];
      // 组合器（空格分隔）拆成"从右往左"的逐级匹配；本测试只用到后代组合
      const parts = String(selRaw).trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return out;

      const matchSimple = (node, sel) => {
        if (!node || node.nodeType !== 1) return false;
        // [attr] 或 [attr="v"]（属性名可含 - 与 :）
        const attr = /^\[([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?\]$/.exec(sel);
        if (attr) {
          const v = node.attributes?.[attr[1]];
          if (v === undefined) return false;
          return attr[2] === undefined ? true : v === attr[2];
        }
        if (sel.startsWith('.')) return node.classList.contains(sel.slice(1));
        return String(node.tagName).toLowerCase() === sel.toLowerCase();
      };

      /** 在整棵子树里收集元素 */
      const all = (node, acc = []) => {
        for (const c of node.children ?? []) {
          if (c.nodeType === 1) acc.push(c);
          all(c, acc);
        }
        return acc;
      };
      /** 节点是否有一个满足简单选择器的祖先 */
      const hasAncestor = (node, sel) => {
        let p = node.parentNode;
        while (p) {
          if (matchSimple(p, sel)) return true;
          p = p.parentNode;
        }
        return false;
      };

      const last = parts[parts.length - 1];
      for (const node of all(this)) {
        if (!matchSimple(node, last)) continue;
        // 其余部分作祖先约束（从右往左依次向上找）
        let ok = true;
        const ancestorsToSatisfy = parts.slice(0, -1).reverse();
        let cursor = node;
        for (const sel of ancestorsToSatisfy) {
          let p = cursor.parentNode;
          let found = false;
          while (p) {
            if (matchSimple(p, sel)) { found = true; break; }
            p = p.parentNode;
          }
          if (!found) { ok = false; break; }
          cursor = p;
        }
        if (ok) out.push(node);
      }
      void hasAncestor;
      return out;
    },
    querySelector(sel) {
      return this._query(sel)[0] ?? makeStubElement();
    },
    querySelectorAll(sel) {
      return this._query(sel);
    },
    appendChild(c) {
      c.parentNode = this;
      this.children.push(c);
      return c;
    },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
      c.parentNode = null;
      return c;
    },
    /** `replaceChild(frag, old)`：frag 的子节点接管 old 的位置 */
    replaceChild(newNode, oldNode) {
      const at = this.children.indexOf(oldNode);
      if (at === -1) return oldNode;
      const incoming =
        newNode?.nodeType === 11 || newNode?.tagName === '#FRAGMENT' ? [...(newNode.children ?? [])] : [newNode];
      for (const c of incoming) c.parentNode = this;
      this.children.splice(at, 1, ...incoming);
      oldNode.parentNode = null;
      return oldNode;
    },
    insertBefore(c) {
      this.children.push(c);
      return c;
    },
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    removeEventListener() {},
    dispatch(type, ev = {}) {
      (this.listeners[type] ?? []).forEach((fn) => fn({ target: this, preventDefault() {}, ...ev }));
    },
    focus() {},
    blur() {},
    click() {
      this.dispatch('click');
    },
    contains: () => false,
  };

  /**
   * ★ `textContent` 必须是**派生值**（读 children），不能是一个静态空串。
   *
   *   模板把文字写进元素有两种方式：`el.textContent = '…'`（赋值）
   *   和 `el.appendChild(document.createTextNode('…'))`（追加子文本节点）。
   *   如果 `textContent` 只是普通属性，第二种方式写进去的文字在桩里**永远读不到** ——
   *   于是"页头变成了什么"这种内容级断言**必然读到空字符串**。
   *   （这正是本桩第二版的 bug：结构对了，文字丢了。）
   */
  const collectText = (n) => {
    if (!n) return '';
    if (n.nodeType === 3) return String(n.textContent ?? '');
    return (n.children ?? []).map(collectText).join('');
  };
  let ownText = '';
  Object.defineProperty(el, 'textContent', {
    get() {
      return ownText + (el.children ?? []).map(collectText).join('');
    },
    set(v) {
      ownText = String(v ?? '');
      // 真实 DOM 里赋值 textContent 会清掉所有子节点
      for (const c of el.children ?? []) c.parentNode = null;
      el.children = [];
    },
  });

  /**
   * `className` ↔ `classList` 双向同步（真实 DOM 的语义）。
   * 写 `className` 会重建 `classList`；用 `classList.add/remove` 会回写 `className`。
   */
  let className = '';
  Object.defineProperty(el, 'className', {
    get() {
      return className;
    },
    set(v) {
      className = String(v ?? '');
      el.classList._s = new Set(className.split(/\s+/).filter(Boolean));
    },
  });
  for (const m of ['add', 'remove', 'toggle']) {
    const orig = el.classList[m].bind(el.classList);
    el.classList[m] = (c, ...rest) => {
      const r = orig(c, ...rest);
      className = [...el.classList._s].join(' ');
      return r;
    };
  }

  return el;
}

/**
 * TeX 行内渲染器会用 `document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)`
 * 遍历文本节点（给变量名加斜体）。
 *
 * ⚠ 必须照**真实 DOM 语义**实现：`nextNode()` 既**返回**节点、也把 `walker.currentNode`
 *   置为它；调用方的写法是 `while (walker.nextNode()) { var node = walker.currentNode; … }`。
 *   只返回节点而不设 currentNode，调用方会读到 undefined —— 这是本文件第一版踩的坑。
 */
export function makeTextWalker(root) {
  const textNodes = [];
  const collect = (node) => {
    if (!node) return;
    if (node.nodeType === 3) textNodes.push(node);
    for (const c of node.children ?? []) collect(c);
  };
  collect(root);
  let i = -1;
  return {
    currentNode: root,
    nextNode() {
      i += 1;
      if (i >= textNodes.length) return null; // 必须是 null（不是 undefined）
      this.currentNode = textNodes[i];
      return this.currentNode;
    },
  };
}

/**
 * 把一段 HTML 解析成桩元素树。
 *
 * 覆盖面是**够用**的子集：带引号的属性、自闭合标签、`script`/`style` 内容跳过。
 *
 * ⚠ 属性区必须写成 `(?:"[^"]*"|[^>"])*?` 而**不是** `[^>]*?`：
 *   后者会跨过 `>` 把**闭合标签**一起吃进来 ——
 *   `<h1 a="b">x</h1>` 会被整体当成一个开始标签，于是 h1 永远不闭合、树是错的。
 *   这是本解析器第一版的 bug（"看起来在工作，其实结构全错"）。
 */
export function parseHtml(html) {
  const root = makeStubElement('#document');
  const stack = [root];
  const skipContent = new Set(['script', 'style']);
  let skipUntil = null;
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+(?:"[^"]*"|[^>"])*?)?)(\/?)>/g;
  let m;
  let lastIndex = 0;
  while ((m = tagRe.exec(html)) !== null) {
    if (skipUntil) {
      if (m[1] === '/' && m[2].toLowerCase() === skipUntil) skipUntil = null;
      lastIndex = tagRe.lastIndex;
      continue;
    }
    const text = html.slice(lastIndex, m.index);
    if (text.trim()) {
      const tn = makeTextNode(text);
      tn.parentNode = stack[stack.length - 1];
      stack[stack.length - 1].children.push(tn);
    }
    lastIndex = tagRe.lastIndex;
    const [, closing, rawTag, rawAttrs, selfClose] = m;
    const tag = rawTag.toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (String(stack[i].tagName).toLowerCase() === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const el = makeStubElement(tag);
    /* ⚠ 属性解析必须同时认**无值属性**（`checked` / `hidden` 这种合法写法）。
       第一版只匹配 `name="value"`，于是 `<input type="checkbox" checked />` 里的
       `checked` **整个被丢掉** —— 桩里复选框永远 false，第 7 期的"三栏显隐"启动就少读两栏。
       有值属性保留原值，无值属性记为 ""（与浏览器一致）。 */
    for (const a of rawAttrs.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g)) {
      el.setAttribute(a[1], a[2] ?? '');
    }
    /* ⚠ 布尔属性必须**落到属性上**（真实 DOM 的语义）：
       `checked` / `hidden` / `selected` / `disabled` / `open` 这些是"有属性即为真"的布尔属性，
       浏览器会把 `checked="checked"` 反映成 `el.checked === true`。
       第一版桩只写进 attributes，属性上的 `el.checked` 一直是默认 false ——
       于是第 7 期的"三栏显隐"在桩里读到三个 false、启动就把三栏全隐藏了（假绿/假红都踩过）。
       桩少实现一点语义，判据就少一分可信。 */
    const BOOLEAN_ATTRS = ['checked', 'hidden', 'selected', 'disabled', 'open', 'readonly', 'required'];
    for (const name of BOOLEAN_ATTRS) {
      if (el.hasAttribute(name)) {
        const raw = String(el.getAttribute(name)).trim().toLowerCase();
        /* ⚠ 无值（""）与同义反复（"checked"）都表示**真**；只有显式的 false/0 才是假。
           写成 `!(raw === '' || …)` 会把 `<aside hidden>` 读成"不隐藏"——这正是本次踩的坑。 */
        el[name] = !(raw === 'false' || raw === '0');
      }
    }
    el.parentNode = stack[stack.length - 1];
    stack[stack.length - 1].children.push(el);
    if (skipContent.has(tag)) skipUntil = tag;
    if (!selfClose) stack.push(el);
  }
  return root;
}

/**
 * 用一个 HTML 字符串建一个"文档桩"。
 * 选择器查的是**真实解析出来的那棵树**，所以内容级断言是真的。
 */
export function makeDocumentStub(html) {
  const doc = {
    readyState: 'complete',
    title: 'stub',
    _html: html,
    _tree: null,
    documentElement: makeStubElement('html'),
    body: makeStubElement('body'),
    addEventListener() {},
    _ensure() {
      doc._tree ??= parseHtml(html);
      return doc._tree;
    },
    createElement: (tag) => makeStubElement(tag),
    createTextNode: (t) => makeTextNode(t),
    createDocumentFragment: () => makeStubElement('#fragment'),
    createTreeWalker: (root) => makeTextWalker(root),
    querySelector(sel) {
      return doc._ensure()._query(sel)[0] ?? makeStubElement();
    },
    querySelectorAll(sel) {
      return doc._ensure()._query(sel);
    },
    getElementById(id) {
      return doc._ensure()._query(`[id="${id}"]`)[0] ?? makeStubElement();
    },
  };
  doc.documentElement.ownerDocument = doc;
  doc.body.ownerDocument = doc;
  return doc;
}
