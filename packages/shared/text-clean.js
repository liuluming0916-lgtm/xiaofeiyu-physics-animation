/*
 * 画布文字的本地清洗（不改模型、不改布局）
 *
 * 原理：模型仍然用 fillText 写字，我们只把字符串里的“裸写法”换成正确的 Unicode 符号，
 * 最后仍然是一次 fillText，宽度由浏览器自己算 —— 所以对齐、measureText、文字重叠检测全不受影响。
 *
 * 做法刻意保守：认不出的东西原样输出，最坏情况等于没做。
 */
(() => {
  'use strict';
  if (window.__XFY_TEXT_CLEAN) return;
  window.__XFY_TEXT_CLEAN = true;

  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '⁺' };
  const SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };

  const GREEK = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', Theta: 'Θ', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
    sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Omega: 'Ω',
    times: '×', cdot: '·', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥',
    ne: '≠', neq: '≠', approx: '≈', to: '→', rightarrow: '→', leftarrow: '←',
    infty: '∞', degree: '°', circ: '°', angle: '∠', perp: '⊥', parallel: '∥',
  };

  const toSup = (s) => [...s].map((c) => SUP[c] ?? c).join('');
  const toSub = (s) => [...s].map((c) => SUB[c] ?? c).join('');

  function clean(src) {
    if (typeof src !== 'string' || !src) return src;
    // 快速排除：不含任何可疑符号就不处理
    if (!/[\\^_<>=~*√]/.test(src)) return src;

    let s = src;

    // 1) 反斜杠命令（模型偶尔会写 \theta、\sqrt 这类）
    s = s.replace(/\\([A-Za-z]+)/g, (m, name) => (name in GREEK ? GREEK[name] : m));

    // 2) 根号：\sqrt{x} / sqrt(x) / √(x) 统一成 √(x)
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
    s = s.replace(/\bsqrt\s*\(/g, '√(');

    // 3) 上标：^2、^{2}、^-3
    s = s.replace(/\^\{([0-9+\-]+)\}/g, (m, d) => toSup(d));
    s = s.replace(/\^([0-9+\-]+)/g, (m, d) => toSup(d));

    // 4) 下标：_0、_{0}
    s = s.replace(/_\{([0-9]+)\}/g, (m, d) => toSub(d));
    s = s.replace(/_([0-9]+)/g, (m, d) => toSub(d));

    // 5) 比较与运算符
    s = s.replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/!=/g, '≠').replace(/~=/g, '≈');
    s = s.replace(/\+-/g, '±').replace(/->/g, '→');

    // 6) 数字/字母之间的星号当乘号（"2*3" → "2·3"），其它地方不动
    s = s.replace(/([0-9A-Za-z)])\s*\*\s*([0-9A-Za-z(])/g, '$1·$2');

    return s;
  }

  const cache = new Map();
  function cached(src) {
    if (typeof src !== 'string') return src;
    let v = cache.get(src);
    if (v === undefined) {
      v = clean(src);
      if (cache.size > 2000) cache.clear();
      cache.set(src, v);
    }
    return v;
  }

  const P = CanvasRenderingContext2D.prototype;
  for (const name of ['fillText', 'strokeText']) {
    const orig = P[name];
    P[name] = function (text, ...rest) {
      return orig.call(this, cached(text), ...rest);
    };
  }
  const origMeasure = P.measureText;
  P.measureText = function (text) {
    return origMeasure.call(this, cached(text));
  };
})();
