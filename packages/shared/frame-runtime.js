/*
 * iframe 内运行时（2.1 起启用）：只负责"接收时间 + 调用模型 render"。
 *
 * 模型页面被整页塞进 iframe 后，它看不到外面的控制条，也碰不到外面的任何元素；
 * 外面通过 postMessage 告诉它"第几幕、第几秒、显示哪些图层"。
 */
(function () {
  'use strict';
  if (window.__XFY_FRAME) return;
  window.__XFY_FRAME = true;

  function collect() {
    const p = window.XFY;
    if (!p) return { acts: [], slots: [] };
    const norm = (a, i) => ({
      title: String((a && a.title) || '第 ' + (i + 1) + ' 幕'),
      physical: Number(a && a.physical) > 0 ? Number(a.physical) : 4,
    });
    if (Array.isArray(p.acts) && p.acts.length) {
      return { acts: p.acts.map(norm), slots: p.acts };
    }
    if (typeof p.render === 'function') {
      return { acts: [norm(p, 0)], slots: [p] };
    }
    return { acts: [], slots: [] };
  }

  const got = collect();
  const slots = got.slots;

  function callRender(i, t, opts) {
    const a = slots[Math.max(0, Math.min(slots.length - 1, i | 0))];
    if (a && typeof a.render === 'function') {
      a.render(t, opts);
      return true;
    }
    return false;
  }

  window.addEventListener('message', function (e) {
    const d = e.data || {};
    if (d.xfy !== 'render') return;
    try {
      const ok = callRender(d.act, d.t, d.opts || {});
      if (!ok) parent.postMessage({ xfy: 'error', message: '没有找到 render 函数' }, '*');
    } catch (err) {
      parent.postMessage({ xfy: 'error', message: String((err && err.message) || err) }, '*');
    }
  });

  // 告诉外层：我准备好了，这是我的幕信息
  parent.postMessage({ xfy: 'hello', acts: got.acts }, '*');

  /*
   * 关键补丁：模型通常自己写一个 fit()，按 window 尺寸算画布大小。
   * 这个 fit() 往往在 iframe 还没完成布局时就跑了一次，读到 0，于是把画布设成 0×0；
   * 之后 iframe 里不会自己触发 resize，画面就永远是空白。
   * （加 sandbox 之后更容易踩到，因为文档加载得更早。）
   * 这里在文档就绪后主动派发两次 resize，让模型自己把尺寸算回来。
   */
  function kick() {
    try {
      window.dispatchEvent(new Event('resize'));
    } catch (_) {}
  }
  [0, 60, 250].forEach((ms) => setTimeout(kick, ms));

  // 先画一帧，避免出现空白
  try {
    callRender(0, 0, { vel: true, acc: true, force: true, trail: true, grid: true, panel: true });
  } catch (_) {}
})();
