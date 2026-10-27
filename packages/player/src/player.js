/*
 * 宿主播放器（导出时自动注入，模型不需要写这个）
 *
 * 契约：window.XFY.acts[i].render(t, opts)
 *   t    = 真实物理时间（秒）
 *   opts = { vel, acc, force, trail, grid, panel }，默认全 true
 *
 * 时间归一化在这里完成：无论这一幕真实多长，播放一律 4.000 秒。
 * 所以模型完全不用关心"播多久"，它只管物理。
 */
(() => {
  'use strict';
  if (window.__XFY_PLAYER) return;
  window.__XFY_PLAYER = true;

  const ACT_SECONDS = 4;
  const FLAGS = [
    ['vel', '速度', '#12a594'],
    ['acc', '加速度', '#2f6feb'],
    ['force', '受力', '#e5484d'],
    ['trail', '轨迹', '#64748b'],
    ['grid', '网格', '#94a3b8'],
    ['panel', '数据', '#8e4ec6'],
  ];

  function readActs() {
    const p = window.XFY;
    if (!p) return [];
    const norm = (a, i) => ({
      title: String((a && a.title) || `第 ${i + 1} 幕`),
      physical: Number(a && a.physical) > 0 ? Number(a.physical) : 4,
      render: a && typeof a.render === 'function' ? a.render.bind(a) : null,
    });
    if (Array.isArray(p.acts) && p.acts.length) return p.acts.map(norm);
    if (typeof p.render === 'function') return [norm(p, 0)];
    return [];
  }

  const acts = readActs();
  const multi = acts.length > 1;
  const opts = { vel: true, acc: true, force: true, trail: true, grid: true, panel: true };

  let idx = 0;
  let tau = 0; // 0..ACT_SECONDS 的播放进度
  let playing = false;
  let speed = 1;
  let lastTs = 0;
  let rafId = 0;

  const bar = document.createElement('div');
  bar.id = 'xfy-bar';
  bar.innerHTML =
    '<div class="xfy-row">' +
    (multi ? '<button class="xfy-btn xfy-ghost" data-act="prev" title="上一幕">‹</button>' : '') +
    '<button class="xfy-btn" data-act="play">播放</button>' +
    '<button class="xfy-btn xfy-ghost" data-act="replay">重播</button>' +
    (multi ? '<button class="xfy-btn xfy-ghost" data-act="next" title="下一幕">›</button>' : '') +
    '<input class="xfy-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="时间轴">' +
    '<span class="xfy-time">0.00 / 4.00 s</span>' +
    '<span class="xfy-speeds">' +
    '<button class="xfy-btn xfy-speed" data-speed="0.5">0.5×</button>' +
    '<button class="xfy-btn xfy-speed is-on" data-speed="1">1×</button>' +
    '<button class="xfy-btn xfy-speed" data-speed="2">2×</button>' +
    '</span>' +
    '<button class="xfy-btn xfy-ghost" data-act="full" title="全屏（Esc 退出）">全屏</button>' +
    (multi ? '<span class="xfy-act"></span>' : '') +
    '<span class="xfy-phys"></span>' +
    '</div>' +
    '<div class="xfy-row xfy-toggles">' +
    FLAGS.map(
      ([k, label, color]) =>
        `<label class="xfy-tg"><input type="checkbox" data-flag="${k}" checked><i style="background:${color}"></i>${label}</label>`,
    ).join('') +
    '<span class="xfy-tip">取消勾选可以隐藏对应图层</span>' +
    '</div>';
  (document.getElementById('xfy-app') || document.body).appendChild(bar);

  const $play = bar.querySelector('[data-act="play"]');
  const $replay = bar.querySelector('[data-act="replay"]');
  const $seek = bar.querySelector('.xfy-seek');
  const $time = bar.querySelector('.xfy-time');
  const $phys = bar.querySelector('.xfy-phys');
  const $act = bar.querySelector('.xfy-act');
  const $prev = bar.querySelector('[data-act="prev"]');
  const $next = bar.querySelector('[data-act="next"]');
  const $speeds = [...bar.querySelectorAll('.xfy-speed')];
  const $flags = [...bar.querySelectorAll('[data-flag]')];
  if (!acts.length) {
    $play.disabled = true;
    $replay.disabled = true;
    $seek.disabled = true;
    $time.textContent = '缺少 XFY 契约';
    console.warn('[xfy] 没有找到 window.XFY.render(t) 或 XFY.acts，播放器无法控制画面。');
    return;
  }

  const fmt = (x) => x.toFixed(2);
  const current = () => acts[Math.min(idx, acts.length - 1)];
  const physTime = () => (tau / ACT_SECONDS) * current().physical;

  function paint() {
    const act = current();
    if (act.render) {
      try {
        act.render(physTime(), { ...opts });
      } catch (e) {
        console.error('[xfy] render 出错：', e);
      }
    }
    $time.textContent = `${fmt(tau)} / 4.00 s`;
    $phys.textContent = `物理 t = ${fmt(physTime())} s`;
    if ($act) $act.textContent = `第 ${idx + 1}/${acts.length} 幕 · ${act.title}`;
    if (!seeking) $seek.value = String(Math.round((tau / ACT_SECONDS) * 1000));
  }

  function loop(ts) {
    if (!playing) return;
    const dt = Math.min(0.05, (ts - lastTs) / 1000) * speed;
    lastTs = ts;
    tau += dt;
    if (tau >= ACT_SECONDS) {
      if (idx < acts.length - 1) {
        idx += 1;
        tau = 0;
        if (window.__xfyClearInk) window.__xfyClearInk();
      } else {
        tau = ACT_SECONDS;
        playing = false;
        $play.textContent = '播放';
      }
    }
    paint();
    if (playing) rafId = requestAnimationFrame(loop);
  }

  function play() {
    if (playing) return;
    if (tau >= ACT_SECONDS) {
      if (idx < acts.length - 1) {
        idx += 1;
        tau = 0;
      } else {
        tau = 0;
      }
    }
    playing = true;
    $play.textContent = '暂停';
    lastTs = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function pause() {
    playing = false;
    $play.textContent = '播放';
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function gotoAct(i) {
    idx = Math.max(0, Math.min(acts.length - 1, i));
    tau = 0;
    paint();
  }

  $play.addEventListener('click', () => (playing ? pause() : play()));
  $replay.addEventListener('click', () => {
    pause();
    idx = 0;
    tau = 0;
    paint();
    play();
  });
  $seek.addEventListener('input', () => {
    tau = (Number($seek.value) / 1000) * ACT_SECONDS;
    paint();
  });

  /*
   * 拖拽时间轴：先把播放停住，松手再继续。
   * 不停的话播放循环每帧都在改 tau，用户的手和循环会互相抢，看起来就是"拖不动、自己播到完"。
   */
  let resumeAfterSeek = false;
  let seeking = false;
  const beginSeek = () => {
    seeking = true;
    resumeAfterSeek = playing;
    if (playing) pause();
  };
  const endSeek = () => {
    seeking = false;
    if (resumeAfterSeek) {
      resumeAfterSeek = false;
      if (tau < ACT_SECONDS) play();
    }
  };
  $seek.addEventListener('pointerdown', beginSeek);
  $seek.addEventListener('keydown', beginSeek);
  $seek.addEventListener('pointerup', endSeek);
  $seek.addEventListener('keyup', endSeek);
  $seek.addEventListener('change', endSeek);
  window.addEventListener('pointerup', endSeek);
  $prev?.addEventListener('click', () => gotoAct(idx - 1));
  $next?.addEventListener('click', () => gotoAct(idx + 1));
  bar.querySelector('[data-act="full"]')?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  for (const b of $speeds) {
    b.addEventListener('click', () => {
      speed = Number(b.dataset.speed) || 1;
      for (const o of $speeds) o.classList.toggle('is-on', o === b);
    });
  }
  for (const f of $flags) {
    f.addEventListener('change', () => {
      opts[f.dataset.flag] = f.checked;
      paint();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      playing ? pause() : play();
    } else if (e.code === 'ArrowRight') {
      pause();
      tau = Math.min(ACT_SECONDS, tau + 0.1);
      paint();
    } else if (e.code === 'ArrowLeft') {
      pause();
      tau = Math.max(0, tau - 0.1);
      paint();
    }
  });

  // 外层页面（动画页左侧的"分幕"列表）可以喊它跳转
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.xfy !== 'goto') return;
    pause();
    if (typeof d.act === 'number') {
      idx = Math.max(0, Math.min(acts.length - 1, d.act));
      tau = 0;
    }
    if (typeof d.t === 'number') {
      tau = Math.max(0, Math.min(ACT_SECONDS, (d.t / current().physical) * ACT_SECONDS));
    }
    paint();
    if (d.play) play();
  });

  /* ================= 标注层（导出文件里才有；预览用 ?ink=0 关掉） ================= */
  const INK_ON = new URLSearchParams(location.search).get('ink') !== '0';
  const stageEl = document.getElementById('xfy-stage');
  const COLORS = ['#e5484d', '#2f6feb', '#111827'];
  const WIDTHS = [2, 4, 7];
  const ink = { canvas: null, ctx: null, on: false, color: COLORS[0], width: WIDTHS[1], erase: false, strokes: [], cur: null };

  if (INK_ON && stageEl) {
    // 工具条：只在标注模式下出现
    const inkRow = document.createElement('div');
    inkRow.className = 'xfy-row xfy-inkbar';
    inkRow.hidden = true;
    inkRow.innerHTML =
      '<button class="xfy-btn xfy-ghost is-on" data-ink="pen">笔</button>' +
      '<button class="xfy-btn xfy-ghost" data-ink="erase">橡皮</button>' +
      '<span class="xfy-sw">' +
      COLORS.map((c, i) => `<button class="xfy-dot${i === 0 ? ' is-on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('') +
      '</span>' +
      '<span class="xfy-sw">' +
      WIDTHS.map((w, i) => `<button class="xfy-dot xfy-w${i === 1 ? ' is-on' : ''}" data-width="${w}"><i style="width:${w + 2}px;height:${w + 2}px"></i></button>`).join('') +
      '</span>' +
      '<button class="xfy-btn xfy-ghost" data-ink="undo">撤销</button>' +
      '<button class="xfy-btn xfy-ghost" data-ink="clear">清除</button>' +
      '<span class="xfy-tip">按 Esc 退出标注</span>';
    bar.appendChild(inkRow);

    const toggle = document.createElement('button');
    toggle.className = 'xfy-btn xfy-ghost';
    toggle.dataset.act = 'ink';
    toggle.textContent = '标注';
    toggle.title = '在画面上写画（不影响播放条）';
    bar.querySelector('.xfy-row').insertBefore(toggle, $seek);

    ink.canvas = document.createElement('canvas');
    ink.canvas.id = 'xfy-ink';
    ink.canvas.style.cssText =
      'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;touch-action:none;z-index:5;';
    stageEl.appendChild(ink.canvas);

    const resizeInk = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      ink.canvas.width = Math.round(1280 * dpr);
      ink.canvas.height = Math.round(720 * dpr);
      ink.ctx = ink.canvas.getContext('2d');
      ink.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawInk();
    };

    function redrawInk() {
      const c = ink.ctx;
      if (!c) return;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, ink.canvas.width, ink.canvas.height);
      const dpr = ink.canvas.width / 1280;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      for (const s of ink.strokes) {
        c.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
        c.strokeStyle = s.color;
        c.lineWidth = s.width;
        c.beginPath();
        s.pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
        if (s.pts.length === 1) c.lineTo(s.pts[0][0] + 0.01, s.pts[0][1]);
        c.stroke();
      }
      c.globalCompositeOperation = 'source-over';
    }

    function toLogical(e) {
      const r = ink.canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 1280, ((e.clientY - r.top) / r.height) * 720];
    }

    ink.canvas.addEventListener('pointerdown', (e) => {
      if (!ink.on) return;
      e.preventDefault();
      ink.canvas.setPointerCapture(e.pointerId);
      ink.cur = { color: ink.color, width: ink.width, erase: ink.erase, pts: [toLogical(e)] };
      ink.strokes.push(ink.cur);
      redrawInk();
    });
    ink.canvas.addEventListener('pointermove', (e) => {
      if (!ink.cur) return;
      const p = toLogical(e);
      const last = ink.cur.pts[ink.cur.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.2) return; // 去掉抖动，点太密没意义
      ink.cur.pts.push(p);
      redrawInk();
    });
    const stop = () => {
      ink.cur = null;
    };
    ink.canvas.addEventListener('pointerup', stop);
    ink.canvas.addEventListener('pointercancel', stop);
    ink.canvas.addEventListener('pointerleave', stop);

    function setInk(on) {
      ink.on = on;
      inkRow.hidden = !on;
      toggle.classList.toggle('is-on', on);
      ink.canvas.style.pointerEvents = on ? 'auto' : 'none';
      ink.canvas.style.cursor = on ? 'crosshair' : 'default';
      if (on) pause();
    }
    const clearInk = () => {
      ink.strokes.length = 0;
      ink.cur = null;
      redrawInk();
    };
    window.__xfyClearInk = clearInk;

    toggle.addEventListener('click', () => setInk(!ink.on));
    inkRow.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.ink === 'undo') {
        ink.strokes.pop();
        redrawInk();
        return;
      }
      if (b.dataset.ink === 'clear') {
        clearInk();
        return;
      }
      if (b.dataset.color) {
        ink.color = b.dataset.color;
        ink.erase = false;
        for (const o of inkRow.querySelectorAll('[data-color]')) o.classList.toggle('is-on', o === b);
        for (const o of inkRow.querySelectorAll('[data-ink="pen"],[data-ink="erase"]'))
          o.classList.toggle('is-on', o.dataset.ink === 'pen');
        return;
      }
      if (b.dataset.width) {
        ink.width = Number(b.dataset.width);
        for (const o of inkRow.querySelectorAll('[data-width]')) o.classList.toggle('is-on', o === b);
        return;
      }
      if (b.dataset.ink === 'pen' || b.dataset.ink === 'erase') {
        ink.erase = b.dataset.ink === 'erase';
        for (const o of inkRow.querySelectorAll('[data-ink="pen"],[data-ink="erase"]')) o.classList.toggle('is-on', o === b);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && ink.on) setInk(false);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && ink.on) {
        e.preventDefault();
        ink.strokes.pop();
        redrawInk();
      }
    });

    resizeInk();
    window.addEventListener('resize', resizeInk);
    // 换幕就清空：每一幕是一张新板书
    const origGoto = gotoAct;
    gotoAct = function (i) {
      clearInk();
      origGoto(i);
      resizeInk();
    };
  }

  // 整页等比缩放到窗口：窗口再小（或系统缩放再大），控制条也不会被挤出屏幕
  const app = document.getElementById('xfy-app');
  function fit() {
    if (!app) return;
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    const s = Math.min(w / app.offsetWidth, h / app.offsetHeight);
    app.style.transform = `translate(-50%, -50%) scale(${Math.min(s, 1.6)})`;
  }
  window.addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', fit);
  fit();
  setTimeout(fit, 60);

  paint();
  play();
})();
