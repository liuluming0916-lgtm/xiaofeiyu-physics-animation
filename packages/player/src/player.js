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

  // 2.1：模型页面跑在 iframe 里，幕信息由它通过 postMessage 发过来
  let acts = [];
  let ready = false;
  const frame = document.getElementById('xfy-frame');

  let multi = false;
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
    '<button class="xfy-btn xfy-ghost" data-act="prev" title="上一幕">‹</button>' +
    '<button class="xfy-btn" data-act="play">播放</button>' +
    '<button class="xfy-btn xfy-ghost" data-act="replay">重播</button>' +
    '<button class="xfy-btn xfy-ghost" data-act="next" title="下一幕">›</button>' +
    '<input class="xfy-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="时间轴">' +
    '<span class="xfy-time">0.00 / 4.00 s</span>' +
    '<span class="xfy-speeds">' +
    '<button class="xfy-btn xfy-speed" data-speed="0.5">0.5×</button>' +
    '<button class="xfy-btn xfy-speed is-on" data-speed="1">1×</button>' +
    '<button class="xfy-btn xfy-speed" data-speed="2">2×</button>' +
    '</span>' +
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
  const $prev = bar.querySelector('[data-act="prev"]');
  const $next = bar.querySelector('[data-act="next"]');
  const $speeds = [...bar.querySelectorAll('.xfy-speed')];
  const $flags = [...bar.querySelectorAll('[data-flag]')];
  if (!frame) {
    $time.textContent = '缺少画框';
    console.warn('[xfy] 找不到 #xfy-frame，播放器无法工作。');
    return;
  }
  $play.disabled = true;
  $replay.disabled = true;
  $seek.disabled = true;

  const fmt = (x) => x.toFixed(2);
  const current = () => acts[Math.min(idx, acts.length - 1)] || { title: '', physical: 4 };
  const physTime = () => (tau / ACT_SECONDS) * current().physical;

  function post(msg) {
    try {
      frame.contentWindow.postMessage(msg, '*');
    } catch (_) {}
  }

  function paint() {
    if (!ready) return;
    post({ xfy: 'render', act: idx, t: physTime(), opts: { ...opts } });
    $time.textContent = `${fmt(tau)} / 4.00 s`;
    $phys.textContent = `物理 t = ${fmt(physTime())} s`;
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
      // 换幕要清掉上一幕的板书（和 gotoAct 保持一致）
      if (window.__xfyClearInk) window.__xfyClearInk();
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
  const ink = {
    canvas: null,
    ctx: null,
    on: false,
    color: COLORS[0],
    width: WIDTHS[1],
    erase: false,
    eraseSize: 44, // 橡皮：一块 44×44 的逻辑像素，比笔粗一个数量级
    strokes: [],
    cur: null,
    ghost: null,
  };

  if (INK_ON && stageEl) {
    // 工具面板：贴在屏幕左侧，竖着排。老师上课手在左边，够得着；
    // 放下面一排容易点不到，也占掉控制条的地方。
    const inkRow = document.createElement('div');
    inkRow.id = 'xfy-panel';
    inkRow.innerHTML =
      '<button data-ink="pen" class="is-on" title="画笔">笔</button>' +
      '<button data-ink="erase" title="橡皮（44 像素方块）">橡皮</button>' +
      '<div class="xfy-row2">' +
      COLORS.map((c, i) => `<button class="xfy-dot${i === 0 ? ' is-on' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('') +
      '</div>' +
      '<div class="xfy-row2">' +
      WIDTHS.map((w, i) => `<button class="xfy-dot xfy-w${i === 1 ? ' is-on' : ''}" data-width="${w}" title="笔宽 ${w}"><i style="width:${w + 2}px;height:${w + 2}px"></i></button>`).join('') +
      '</div>' +
      '<button data-ink="undo" title="撤销（Ctrl+Z）">撤销</button>' +
      '<button data-ink="clear" title="清除全部">清除</button>' +
      '<button data-ink="exit" title="退出标注（Esc）">退出</button>';
    document.body.appendChild(inkRow);

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

    // 橡皮的方块光标：看到多大，就擦多大
    ink.ghost = document.createElement('div');
    ink.ghost.id = 'xfy-ink-ghost';
    ink.ghost.style.cssText = 'display:none;';
    stageEl.appendChild(ink.ghost);

    function showGhost(show, e) {
      const g = ink.ghost;
      if (!g) return;
      if (!show) {
        g.style.display = 'none';
        return;
      }
      const r = ink.canvas.getBoundingClientRect();
      const scale = r.width / 1280; // 屏幕像素 / 逻辑像素
      const s = ink.eraseSize; // 逻辑像素，方块光标在舞台坐标系里就是这个大小
      g.style.display = 'block';
      g.style.width = `${s}px`;
      g.style.height = `${s}px`;
      if (e) {
        // 指针位置换算回舞台坐标（舞台整体被 transform 缩放过，不能直接用屏幕像素）
        const x = (e.clientX - r.left) / scale;
        const y = (e.clientY - r.top) / scale;
        g.style.left = `${x - s / 2}px`;
        g.style.top = `${y - s / 2}px`;
      }
    }

    function applyTool() {
      ink.canvas.style.cursor = !ink.on ? 'default' : ink.erase ? 'none' : 'crosshair';
      if (!ink.erase) showGhost(false);
    }

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
        if (s.erase) {
          // 橡皮擦：沿路径连续盖方块，而不是把笔画涂成透明
          const size = s.size;
          const half = size / 2;
          for (let i = 0; i < s.pts.length; i++) {
            const p = s.pts[i];
            c.clearRect(p[0] - half, p[1] - half, size, size);
            if (i > 0) {
              const q = s.pts[i - 1];
              const dist = Math.hypot(p[0] - q[0], p[1] - q[1]);
              const n = Math.ceil(dist / (size / 3));
              for (let k = 1; k < n; k++) {
                const t = k / n;
                c.clearRect(q[0] + (p[0] - q[0]) * t - half, q[1] + (p[1] - q[1]) * t - half, size, size);
              }
            }
          }
          continue;
        }
        c.globalCompositeOperation = 'source-over';
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
      ink.cur = ink.erase
        ? { erase: true, size: ink.eraseSize, pts: [toLogical(e)] }
        : { color: ink.color, width: ink.width, erase: false, pts: [toLogical(e)] };
      ink.strokes.push(ink.cur);
      redrawInk();
    });
    ink.canvas.addEventListener('pointermove', (e) => {
      if (!ink.on) return;
      if (ink.erase) showGhost(true, e);
      if (!ink.cur) return;
      const p = toLogical(e);
      const last = ink.cur.pts[ink.cur.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.2) return; // 去掉抖动，点太密没意义
      ink.cur.pts.push(p);
      redrawInk();
    });
    ink.canvas.addEventListener('pointerenter', (e) => {
      if (ink.on && ink.erase) showGhost(true, e);
    });
    ink.canvas.addEventListener('pointerleave', () => showGhost(false));
    const stop = () => {
      ink.cur = null;
    };
    ink.canvas.addEventListener('pointerup', stop);
    ink.canvas.addEventListener('pointercancel', stop);
    ink.canvas.addEventListener('pointerleave', stop);

    function setInk(on) {
      ink.on = on;
      inkRow.classList.toggle('on', on);
      toggle.classList.toggle('is-on', on);
      ink.canvas.style.pointerEvents = on ? 'auto' : 'none';
      applyTool();
      document.body.classList.toggle('xfy-inking', on);
      fit();
      if (on) pause();
      if (!on) showGhost(false);
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
        applyTool();
        return;
      }
      if (b.dataset.width) {
        ink.width = Number(b.dataset.width);
        for (const o of inkRow.querySelectorAll('[data-width]')) o.classList.toggle('is-on', o === b);
        return;
      }
      if (b.dataset.ink === 'exit') {
        setInk(false);
        return;
      }
      if (b.dataset.ink === 'pen' || b.dataset.ink === 'erase') {
        ink.erase = b.dataset.ink === 'erase';
        for (const o of inkRow.querySelectorAll('[data-ink="pen"],[data-ink="erase"]')) o.classList.toggle('is-on', o === b);
        applyTool();
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
  // 底部水印占位：留一条，别让控制条压到「powered by」上
  const MARK_H = 34;
  function fit() {
    if (!app) return;
    // 标注面板占左侧 96px：开着的时候整体右移并略微缩小，别挡住画面
    const reserve = document.body.classList.contains('xfy-inking') ? 96 : 0;
    const w = document.documentElement.clientWidth - reserve;
    const h = document.documentElement.clientHeight - MARK_H;
    const s = Math.min(w / app.offsetWidth, h / app.offsetHeight);
    app.style.transform = `translate(calc(-50% + ${reserve / 2}px), calc(-50% - ${MARK_H / 2}px)) scale(${Math.min(s, 1.6)})`;
  }
  window.addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', fit);
  /* 等 iframe 里的模型报告"我准备好了" */
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.xfy === 'hello') {
      acts = Array.isArray(d.acts) ? d.acts : [];
      multi = acts.length > 1;
      ready = acts.length > 0;
      if (!ready) {
        $time.textContent = '动画没有可播放的内容';
        return;
      }
      $play.disabled = false;
      $replay.disabled = false;
      $seek.disabled = false;
      if ($prev) $prev.style.display = multi ? '' : 'none';
      if ($next) $next.style.display = multi ? '' : 'none';
      paint();
      play();
    } else if (d.xfy === 'error') {
      console.error('[xfy] 模型渲染出错：', d.message);
    }
  });

  setTimeout(() => {
    if (!ready) {
      $time.textContent = '动画没有响应';
      $seek.disabled = true;
      console.warn('[xfy] iframe 5 秒内没有发来 hello，可能是模型页面自身报错。');
    }
  }, 5000);

  // 监听器装好之后再放 srcdoc，否则 iframe 的 hello 可能先到、被丢掉
  if (window.__XFY_MODEL_HTML) frame.srcdoc = window.__XFY_MODEL_HTML;

  // 页脚水印：只在导出的独立页面显示；被应用内 iframe 嵌着预览时藏起来
  const mark = document.getElementById('xfy-mark');
  const about = document.getElementById('xfy-about');
  if (mark) {
    if (window.self !== window.top) mark.style.display = 'none';
    if (about) {
      const closeAbout = () => about.classList.remove('on');
      mark.addEventListener('click', () => about.classList.add('on'));
      about.addEventListener('click', (e) => {
        if (e.target === about) closeAbout();
      });
      const closeBtn = about.querySelector('[data-xfy-close]');
      if (closeBtn) closeBtn.addEventListener('click', closeAbout);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAbout();
      });
      // 方便截图 / 分享时直接打开：#about
      if (location.hash === '#about') about.classList.add('on');
    }
  }

  fit();
  setTimeout(fit, 60);
})();
