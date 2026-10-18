/* eslint-disable */
/**
 * ODTex · 行内公式兜底渲染器（离线可用，零外部资源）
 *
 * 为什么需要它（§2.2 的 MathJax 决策与本期的现实约束）：
 *   方案定案 MathJax 3.2.2 SVG 完全内联。但本机运行时**无法访问 npm registry / CDN**，
 *   拿不到 `tex-mml-svg.js` 的字节。因此本期采用方案自己写明的降级链——
 *   「MathJax 不可用则降级为原文」——并把降级实现做成**可读的行内公式渲染**，
 *   而不是把 `\frac{a}{b}` 原样丢给老师看。
 *
 * 何时替换成 MathJax：第 3 期把 `tex-mml-svg.js` 落盘到 `template/vendor/` 后，
 * 模板只改一处——`ODTex.toHtml()` 改为调用 MathJax.tex2svg。上层调用点与 CSS 不变。
 *
 * 覆盖范围：高中物理题面/解析会用到的子集——分式、上下标、希腊字母、
 * 常见运算符与关系符、向量箭头、`\text{}` / `\mathrm{}`、间距、矩阵不涉及。
 * 未识别的命令按原文输出（不猜、不吞）。
 */
(function () {
  'use strict';

  var GREEK = {
    alpha: 'α', beta: 'β', gamma: 'γ', Gamma: 'Γ', delta: 'δ', Delta: 'Δ',
    epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', Theta: 'Θ',
    iota: 'ι', kappa: 'κ', lambda: 'λ', Lambda: 'Λ', mu: 'μ', nu: 'ν', xi: 'ξ',
    Xi: 'Ξ', pi: 'π', Pi: 'Π', rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ',
    upsilon: 'υ', phi: 'φ', varphi: 'φ', Phi: 'Φ', chi: 'χ', psi: 'ψ', Psi: 'Ψ',
    omega: 'ω', Omega: 'Ω',
  };

  var SYMBOLS = {
    cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡',
    propto: '∝', sim: '∼', simeq: '≃', ll: '≪', gg: '≫',
    rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒',
    Leftarrow: '⇐', Leftrightarrow: '⇔', uparrow: '↑', downarrow: '↓', mapsto: '↦',
    in: '∈', notin: '∉', subset: '⊂', supset: '⊃', cup: '∪', cap: '∩', emptyset: '∅',
    infty: '∞', partial: '∂', nabla: '∇', sum: 'Σ', prod: 'Π', int: '∫', oint: '∮',
    sqrt: '√', angle: '∠', perp: '⊥', parallel: '∥', circ: '∘', degree: '°',
    ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', dotsb: '⋯',
    therefore: '∴', because: '∵', prime: '′', square: '□', triangle: '△',
    hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', forall: '∀', exists: '∃',
  };

  /** 间距类命令：渲染成不可见宽度，避免出现 `\ ` 原文 */
  var SPACES = { ',': '0.17em', ':': '0.22em', ';': '0.28em', '!': '-0.17em', ' ': '0.28em', quad: '1em', qquad: '2em' };

  /** 无参、无输出的命令 */
  var DROPPED = { displaystyle: 1, textstyle: 1, scriptstyle: 1, limits: 1, nolimits: 1, left: 1, right: 1, big: 1, Big: 1, bigg: 1, Bigg: 1 };

  var ACCENTS = { vec: '\u20d7', bar: '\u0304', hat: '\u0302', dot: '\u0307', tilde: '\u0303', overline: '\u0304' };

  var UPRIGHT = { text: 1, mathrm: 1, mathbf: 1, mathit: 1, mathsf: 1, mathtt: 1, operatorname: 1 };

  /* ── 解析：把 TeX 源切成节点树 ───────────────────────────── */

  function parse(src, pos, stopAtBrace) {
    var nodes = [];
    var text = '';
    var i = pos;
    var flush = function () {
      if (text) {
        nodes.push({ type: 'text', value: text });
        text = '';
      }
    };

    while (i < src.length) {
      var ch = src[i];

      if (ch === '}') {
        if (stopAtBrace) {
          flush();
          return { nodes: nodes, pos: i + 1 };
        }
        text += ch;
        i += 1;
        continue;
      }

      if (ch === '{') {
        flush();
        var group = parse(src, i + 1, true);
        nodes.push({ type: 'group', children: group.nodes });
        i = group.pos;
        continue;
      }

      if (ch === '^' || ch === '_') {
        flush();
        var next = src[i + 1] === '{' ? parse(src, i + 2, true) : parse(src, i + 1, false);
        var payload = src[i + 1] === '{' ? next.nodes : [{ type: 'text', value: src[i + 1] || '' }];
        nodes.push({ type: ch === '^' ? 'sup' : 'sub', children: payload });
        i = src[i + 1] === '{' ? next.pos : i + 2;
        continue;
      }

      if (ch === '\\') {
        var m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
        if (!m) {
          text += ch;
          i += 1;
          continue;
        }
        var name = m[1];
        i += m[0].length;

        if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
          flush();
          var num = readArg(src, i);
          var den = readArg(src, num.pos);
          nodes.push({ type: 'frac', num: num.nodes, den: den.nodes });
          i = den.pos;
          continue;
        }
        if (name === 'sqrt') {
          flush();
          var body = readArg(src, i);
          nodes.push({ type: 'sqrt', children: body.nodes });
          i = body.pos;
          continue;
        }
        if (UPRIGHT[name]) {
          flush();
          var arg = readArg(src, i);
          nodes.push({ type: 'upright', children: arg.nodes });
          i = arg.pos;
          continue;
        }
        if (ACCENTS[name]) {
          flush();
          var accArg = readArg(src, i);
          nodes.push({ type: 'accent', mark: ACCENTS[name], children: accArg.nodes });
          i = accArg.pos;
          continue;
        }
        if (name in SPACES) {
          flush();
          nodes.push({ type: 'space', width: SPACES[name] });
          continue;
        }
        if (DROPPED[name]) continue;
        if (GREEK[name]) {
          text += GREEK[name];
          continue;
        }
        if (SYMBOLS[name]) {
          text += SYMBOLS[name];
          continue;
        }
        // 未识别命令：原文保留（不猜、不吞）
        text += '\\' + name;
        continue;
      }

      if (ch === '~') {
        text += '\u00a0';
        i += 1;
        continue;
      }

      text += ch;
      i += 1;
    }

    flush();
    return { nodes: nodes, pos: i };
  }

  function readArg(src, pos) {
    if (src[pos] === '{') return parse(src, pos + 1, true);
    // 单 token 参数
    var m = /^\s*(\\[A-Za-z]+|\S)/.exec(src.slice(pos));
    if (!m) return { nodes: [], pos: pos };
    var inner = parse(m[1], 0, false);
    return { nodes: inner.nodes, pos: pos + m[0].length };
  }

  /* ── 渲染：节点树 → DOM ─────────────────────────────────── */

  function renderNodes(nodes, parent) {
    nodes.forEach(function (node) {
      switch (node.type) {
        case 'text': {
          parent.appendChild(document.createTextNode(node.value));
          break;
        }
        case 'group': {
          var span = document.createElement('span');
          renderNodes(node.children, span);
          parent.appendChild(span);
          break;
        }
        case 'sup':
        case 'sub': {
          var tag = node.type === 'sup' ? 'sup' : 'sub';
          var holder = document.createElement(tag);
          renderNodes(node.children, holder);
          parent.appendChild(holder);
          break;
        }
        case 'frac': {
          var frac = document.createElement('span');
          frac.className = 'frac';
          var num = document.createElement('span');
          renderNodes(node.num, num);
          var den = document.createElement('span');
          renderNodes(node.den, den);
          frac.appendChild(num);
          frac.appendChild(den);
          parent.appendChild(frac);
          break;
        }
        case 'sqrt': {
          var root = document.createElement('span');
          root.appendChild(document.createTextNode('√'));
          var over = document.createElement('span');
          over.style.borderTop = '1px solid currentColor';
          over.style.paddingInline = '0.1em';
          renderNodes(node.children, over);
          root.appendChild(over);
          parent.appendChild(root);
          break;
        }
        case 'upright': {
          var up = document.createElement('span');
          up.style.fontStyle = 'normal';
          renderNodes(node.children, up);
          parent.appendChild(up);
          break;
        }
        case 'accent': {
          var acc = document.createElement('span');
          renderNodes(node.children, acc);
          acc.appendChild(document.createTextNode(node.mark));
          parent.appendChild(acc);
          break;
        }
        case 'space': {
          var gap = document.createElement('span');
          gap.style.display = 'inline-block';
          gap.style.width = node.width;
          parent.appendChild(gap);
          break;
        }
        default:
          break;
      }
    });
  }

  /** 变量斜体：单个拉丁字母（非 \text 内）按数学惯例斜体 */
  function italicizeVariables(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var targets = [];
    while (walker.nextNode()) {
      var node = walker.currentNode;
      if (node.parentNode && node.parentNode.namespaceURI && node.parentNode.tagName === 'SPAN') {
        // \text / \mathrm 内容保持正体
        var p = node.parentNode;
        if (p.style && p.style.fontStyle === 'normal') continue;
      }
      if (/[A-Za-z]/.test(node.nodeValue)) targets.push(node);
    }
    targets.forEach(function (node) {
      var frag = document.createDocumentFragment();
      node.nodeValue.split(/([A-Za-z])/).forEach(function (piece) {
        if (!piece) return;
        if (/^[A-Za-z]$/.test(piece)) {
          var em = document.createElement('i');
          em.textContent = piece;
          frag.appendChild(em);
        } else {
          frag.appendChild(document.createTextNode(piece));
        }
      });
      node.parentNode.replaceChild(frag, node);
    });
  }

  function toHtml(tex) {
    if (typeof tex !== 'string' || !tex) return null;
    var tree = parse(tex, 0, false);
    var root = document.createElement('span');
    renderNodes(tree.nodes, root);
    italicizeVariables(root);
    return root;
  }

  window.ODTex = { toHtml: toHtml, renderer: 'odtex-inline-fallback' };
})();
