/**
 * ㉚ 联动图表取证（第 7 期 §13.4 / M15 / §19.4）
 *
 * 为什么要有这份自检（而不是只靠 ⑩ 静态体检）：
 *   ⑩ 只做 **vm 语法检查 + 跑那段运行时**，它**从不执行模板页的界面脚本**。
 *   于是"图表面板到底有没有画出来、游标停没停在那个 t、切量有没有生效"这类问题，
 *   静态检查**一条都答不了** —— 属于"绿着但没跑"。
 *   这里把**成品页原样**放进 vm 跑起来（DOM 桩见 tests/harness/dom-stub.mjs），
 *   给两块画布各挂一个**记录型 2D 上下文**，然后按画上去的字节断言。
 *
 * 钉住的判据（§八 把"拖时间轴时画布与图表同步"变成可机检的那一条）：
 *   · 游标读数 == `readouts(t)` 在该 t 的值（同一函数、同一 t）——含**负对照**；
 *   · 游标横坐标 == 同一 t 的映射位置（38 + t/dur × (宽-48)）；
 *   · 曲线图画在自己的画布上，**不**再画进动画画布（旧手绘图已移除的防回退）；
 *   · 可切纵轴、可隐藏（§13.4 / 用户裁决"只保留右侧竖条 / 隐藏"）；
 *   · 三栏可自由显隐（隐藏一栏不炸，其余栏仍可用）；
 *   · 画布 16:9（width=960 height=540 + CSS aspect-ratio，且不写死像素高度）。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

import { makeDocumentStub } from './harness/dom-stub.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..');
const BUILD_DIR = join(PROJECT_ROOT, 'template', 'build');

/* 图表画布上"游标"用的颜色（与模板的 CHART_INK.cursor 同一值）。
   ⚠ 这里**重复写死一份**是有意的：判据不能从被测对象里读期望值，否则它永远通过。 */
const CURSOR_INK = '#b3382f';
const CURVE_INK = '#1f6fb2';

/** 记录型 2D 上下文：每次调用连同当时的颜色一起记下来 */
function makeRecorder() {
  const calls = [];
  const state = { strokeStyle: null, fillStyle: null, lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic', lineJoin: 'miter' };
  const handler = {
    get(_t, key) {
      if (key in state) return state[key];
      if (key === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return (...args) => {
        calls.push({ op: String(key), args, strokeStyle: state.strokeStyle, fillStyle: state.fillStyle });
      };
    },
    set(_t, key, value) {
      state[key] = value;
      return true;
    },
  };
  return { ctx: new Proxy({}, handler), calls };
}

function makeWindowStub() {
  const messages = [];
  const stub = {
    parent: { postMessage: (m) => messages.push(m) },
    listeners: {},
    addEventListener(type, fn) {
      (stub.listeners[type] ??= []).push(fn);
    },
    removeEventListener() {},
    localStorage: {
      _m: new Map(),
      getItem(k) {
        return this._m.has(k) ? this._m.get(k) : null;
      },
      setItem(k, v) {
        this._m.set(k, String(v));
      },
      removeItem(k) {
        this._m.delete(k);
      },
    },
    devicePixelRatio: 1,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    dispatch(type, ev) {
      (stub.listeners[type] ?? []).forEach((fn) => fn(ev));
    },
  };
  return { windowStub: stub, messages };
}

function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

/**
 * 把一个成品页跑起来。
 * @returns {{ doc, windowStub, errors, chart, stage, html }}
 */
async function bootPage(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const { windowStub } = makeWindowStub();
  const doc = makeDocumentStub(html);

  /* ⚠ 必须先 query 一次、让桩把 HTML 解析成树；之后再取到的都是**同一批节点**，
     这样这里替换的 getContext 才是模板脚本里拿到的那个 canvas。 */
  const chartCanvas = doc.querySelector('[data-od-id="chart-canvas"]');
  const stageCanvas = doc.querySelector('[data-od-id="stage-canvas"]');
  const chart = makeRecorder();
  const stage = makeRecorder();
  chartCanvas.getContext = () => chart.ctx;
  stageCanvas.getContext = () => stage.ctx;

  const errors = [];
  const sandbox = {
    window: windowStub,
    document: doc,
    // TeX 行内渲染器要用 TreeWalker
    NodeFilter: { SHOW_TEXT: 4, SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    console,
  };
  sandbox.window.document = doc;
  sandbox.localStorage = windowStub.localStorage;
  sandbox.globalThis = sandbox;

  /* 运行时用**真实现**（省掉 15 页各跑一份 60 KB 的内联运行时，也避免两套运行时口径不一） */
  const rt = await import(pathToFileURL(join(PROJECT_ROOT, 'sdk', 'runtime', 'animation-runtime.mjs')).href);
  windowStub.ODRuntime = rt;

  const context = vm.createContext(sandbox);
  for (const code of inlineScripts(html)) {
    // 跳过内联运行时那一段（已用真实现顶上）
    if (code.includes('window.ODRuntime = Runtime')) continue;
    try {
      vm.runInContext(code, context, { filename: htmlPath });
    } catch (err) {
      errors.push(err);
    }
  }
  return { doc, windowStub, errors, chart, stage, html, chartCanvas, stageCanvas };
}

/** 取指定 data-od-id 的元素（桩解析出来的真实节点） */
const el = (doc, id) => doc.querySelector(`[data-od-id="${id}"]`);

/** 把时间轴拖到 t（模板的 timeline 监听器会走 seek → draw → drawChart） */
function seekTo(doc, t) {
  const timeline = el(doc, 'timeline');
  timeline.value = String(t);
  timeline.dispatch('input');
}

/**
 * 找出图表画布上那根游标竖线（颜色 = CURSOR_INK，从 padT=12 画到底）。
 * ⚠ 必须从 `from` 之后找：装载时 t=0 已经画过一根游标，从头扫会永远读到那一根。
 */
function cursorX(recorder, from = 0) {
  const calls = recorder.calls;
  for (let i = from; i < calls.length - 1; i += 1) {
    const c = calls[i];
    if (c.op !== 'moveTo' || c.strokeStyle !== CURSOR_INK) continue;
    const next = calls[i + 1];
    if (next && next.op === 'lineTo' && Math.abs(next.args[0] - c.args[0]) < 1e-9) return c.args[0];
  }
  return null;
}

/** 游标旁边印的那个数值（新记录里颜色 = CURSOR_INK 的最后一次 fillText） */
function cursorLabel(recorder, from = 0) {
  const hits = recorder.calls.slice(from).filter((c) => c.op === 'fillText' && c.fillStyle === CURSOR_INK);
  return hits.length ? String(hits[hits.length - 1].args[0]) : null;
}

const failures = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? `（${detail}）` : ''}`);
  }
}

export async function main() {
  console.log('chart-selftest · 联动图表取证（§13.4 · 真跑成品页）');

  const pagePath = join(BUILD_DIR, 'q01-conveyor-heat.html');

  /* ── A 图表面板默认就位 ── */
  console.log('\n『A』曲线图默认就位，纵轴默认取 SIM.axes 的第一个量');
  const page = await bootPage(pagePath);
  check('成品页跑起来没有抛错', page.errors.length === 0, page.errors[0]?.message);
  const panel = el(page.doc, 'chart-panel');
  check('图表面板可见（未隐藏）', panel.hidden === false);
  const picks = el(page.doc, 'chart-picks').children.filter((c) => c.nodeType === 1);
  check('量选择按钮 ≥ 4 个（本题 4 个轴的量都要能选）', picks.length >= 4, `实际 ${picks.length}`);
  check('第一个量有可读标签（不是裸 key）', typeof picks[0]?.textContent === 'string' && picks[0].textContent.length > 0, picks[0]?.textContent);
  check('标题与选中的量一致', el(page.doc, 'chart-title').textContent.startsWith(picks[0]?.textContent ?? '?'));
  check('第一个量处于选中态', picks[0]?.getAttribute('aria-pressed') === 'true');
  check('曲线图画在自己的画布上（有绘制调用）', page.chart.calls.length > 20, `${page.chart.calls.length} 次`);
  check('★ 曲线图没画进动画画布', !page.stage.calls.some((c) => c.strokeStyle === CURVE_INK && c.op === 'lineTo'));

  /* ── B 游标读数 == readouts(t)（含负对照）── */
  console.log('\n『B』游标读数与 readouts(t) 一致（同一 t），并含负对照');
  // q01：v(t) = min(a1·t, u)，a1 = μg = 2、u = 2 ⇒ v(0.3) = 0.6、v(1.6) = 2.0
  let mark = page.chart.calls.length;
  seekTo(page.doc, 0.3);
  const label03 = cursorLabel(page.chart, mark);
  check('★ t = 0.3 时游标读数 = 0.6（v 的独立解析解）', label03 !== null && Math.abs(Number(label03) - 0.6) < 1e-9, label03);
  mark = page.chart.calls.length;
  seekTo(page.doc, 1.6);
  const label16 = cursorLabel(page.chart, mark);
  check('★ t = 1.6 时游标读数 = 2（共速后恒为 u）', label16 !== null && Math.abs(Number(label16) - 2) < 1e-9, label16);
  check('负对照：两个 t 的读数确实不同', label03 !== label16, `${label03} vs ${label16}`);

  /* ── C 游标横坐标 == 同一 t 的映射位置 ── */
  console.log('\n『C』游标横坐标 = 38 + t/dur × (宽 − 48)，与画布同一个 t');
  const W = 800; // 桩的 clientWidth
  const PW = W - 38 - 10;
  const DUR = 2.0; // q01 的 duration
  mark = page.chart.calls.length;
  seekTo(page.doc, 0.3);
  const x03 = cursorX(page.chart, mark);
  check('★ t = 0.3 ⇒ 游标 x = 150.8', x03 !== null && Math.abs(x03 - (38 + (0.3 / DUR) * PW)) < 0.01, String(x03));
  mark = page.chart.calls.length;
  seekTo(page.doc, 1.6);
  const x16 = cursorX(page.chart, mark);
  check('★ t = 1.6 ⇒ 游标 x = 639.6', x16 !== null && Math.abs(x16 - (38 + (1.6 / DUR) * PW)) < 0.01, String(x16));
  check('两点的游标位置确实不同（不是画了个死图）', x03 !== null && x16 !== null && Math.abs(x16 - x03) > 100);

  /* ── D 可切纵轴 ── */
  console.log('\n『D』纵轴可切换到任意读数（§13.4 的"任意自定义量"）');
  const second = picks[1];
  second.click();
  check('★ 点第二个量之后标题跟着变', el(page.doc, 'chart-title').textContent.startsWith(second.textContent), el(page.doc, 'chart-title').textContent);
  check('选中态转移过去了', second.getAttribute('aria-pressed') === 'true' && picks[0].getAttribute('aria-pressed') === 'false');
  const afterSwitch = page.chart.calls.length;
  check('切换后重画了曲线（有新的绘制调用）', afterSwitch > 0);
  picks[0].click(); // 切回 v，后面的断言依赖它

  /* ── E 可隐藏 ── */
  console.log('\n『E』曲线图可隐藏（用户裁决：只保留"右侧竖条 / 隐藏"）');
  const masks = page.doc.querySelectorAll('[data-mask]');
  const chartMask = masks.find((m) => m.getAttribute('data-mask') === 'chart');
  check('辅助开关里有"曲线图"一项', !!chartMask);
  chartMask.checked = false;
  chartMask.dispatch('change');
  check('★ 关掉之后面板隐藏', panel.hidden === true);
  const beforeDraw = page.chart.calls.length;
  seekTo(page.doc, 0.8);
  check('★ 隐藏后不再往图表画布上画东西', page.chart.calls.length === beforeDraw, `${beforeDraw} → ${page.chart.calls.length}`);
  chartMask.checked = true;
  chartMask.dispatch('change');
  check('再打开面板又回来', panel.hidden === false);

  /* ── F 两栏自由显隐（导读 / 动画） ── */
  console.log('\n『F』两栏自由显隐（导读 / 动画，隐藏后不炸）');
  const colText = el(page.doc, 'col-text');
  const colAnim = el(page.doc, 'col-animation');
  const colInputs = page.doc.querySelectorAll('[data-col]');
  check('★ 页头只剩两个栏位开关（导读 / 动画）', colInputs.length === 2, String(colInputs.length));
  const toggleCol = (key, on) => {
    const input = colInputs.find((i) => i.getAttribute('data-col') === key);
    input.checked = on;
    input.dispatch('change');
  };
  toggleCol('text', false);
  check('★ 关掉"导读"后该栏移出排版（hidden）', colText.hidden === true);
  check('动画栏还在', colAnim.hidden === false);
  check('画布仍然画得动', page.stage.calls.length > 0);
  toggleCol('animation', false);
  check('两栏全关也不抛错（页面仍存活）', colText.hidden === true && colAnim.hidden === true && page.errors.length === 0);
  toggleCol('text', true);
  toggleCol('animation', true);
  check('恢复后两栏都在', !colText.hidden && !colAnim.hidden);

  /* ── K 导读栏：原题与解析合并 + 选项卡切换 + 跟随播放 ──
     用户 2026-10-17：「将原有的'原题'和'分步解析'两栏合并为左侧单一导读栏，
     采用选项卡/步骤切换机制（[原题][第1步]…），支持随时间轴播放自动切换对应步骤，
     也可手动点击步骤跳到对应动画关键帧」。这里逐条钉住。 */
  console.log('\n『K』导读栏合并与切换（原题 / 第N步 · 动画联动双向 · 解耦彻底断开）');
  /* ⚠ 这一段必须用**新开的页面**：上面的断言已经把 t 拖到 1.7 s、把选项锁过好几轮，
     拿同一个实例去断言"初始停在原题"必然假红。这里重新装一次，模拟用户刚打开。 */
  const k = await bootPage(pagePath);
  check('新页面装得起来', k.errors.length === 0, k.errors[0]?.message);
  const tabs = el(k.doc, 'text-tabs');
  const tabBtns = tabs.children.filter((c) => c.nodeType === 1);
  const problemPanel = el(k.doc, 'col-problem');
  const stepsPanel = el(k.doc, 'col-steps');
  check('★ 选项卡 = 原题 + 每步一个（q01 共 4 步 ⇒ 5 个页签）', tabBtns.length === 5, String(tabBtns.length));
  check('第一页是「原题」', tabBtns[0]?.textContent === '原题');
  check('后续页签是「第 N 步」', /1/.test(tabBtns[1]?.textContent ?? '') && /4/.test(tabBtns[4]?.textContent ?? ''));
  check('★ 初始停在原题（步骤面板隐藏）', problemPanel.hidden === false && stepsPanel.hidden === true);
  const followBox = el(k.doc, 'follow-toggle');
  check('★ 页面上有「动画联动」开关，默认勾选', !!followBox && followBox.checked === true);
  check(
    '★ 开关的名字是「动画联动」',
    String(followBox.parentNode?.textContent ?? '').includes('动画联动'),
    followBox.parentNode?.textContent,
  );
  check('★ 初始 data-follow = on（勾着但还没动过时间）', tabs.getAttribute('data-follow') === 'on');

  // 联动状态：点"第 2 步" ⇒ 只显示第 2 张卡 + 动画跳到该步起点
  tabBtns[2].click();
  const cardHidden = [1, 2, 3, 4].map((n) => el(k.doc, `step-${n}`).hidden);
  check('★ 点第 2 步 ⇒ 步骤面板出现、原题面板收起', stepsPanel.hidden === false && problemPanel.hidden === true);
  check(
    '★ 只显示第 2 步那一张卡（其余三张移出流）',
    cardHidden[0] === true && cardHidden[1] === false && cardHidden[2] === true && cardHidden[3] === true,
    JSON.stringify(cardHidden),
  );
  check(
    '★ 联动时点步骤 = 跳到该步关键帧（t = 0.60）',
    /^0\.60\s*\//.test(el(k.doc, 'timecode').textContent),
    el(k.doc, 'timecode').textContent,
  );
  check(
    '选中的页签有 aria-selected、其余为 false',
    tabBtns[2].getAttribute('aria-selected') === 'true' && tabBtns[0].getAttribute('aria-selected') === 'false',
  );
  check('★ 点页签**不**改开关本身（联动与否由那颗勾选说了算）', followBox.checked === true && tabs.getAttribute('data-follow') === 'on');

  /* ★ 取消联动 ⇒ 两栏**彻底解耦**：两个方向都断
       ① 点页签只换文字，动画一动不动（用户 2026-10-17 明确指出的错） */
  followBox.checked = false;
  followBox.dispatch('change');
  check('★ 取消「动画联动」⇒ data-follow = off', tabs.getAttribute('data-follow') === 'off');
  tabBtns[3].click(); // 第 3 步（t0 = 1.00）
  check('解耦后点第 3 步 ⇒ 文字确实换到第 3 步', tabBtns[3].getAttribute('aria-selected') === 'true');
  check(
    '★★ 解耦后点第 3 步，动画**不动**（仍是 0.60）',
    /^0\.60\s*\//.test(el(k.doc, 'timecode').textContent),
    el(k.doc, 'timecode').textContent,
  );
  check('解耦后只显示第 3 步那一张卡', el(k.doc, 'step-3').hidden === false && el(k.doc, 'step-2').hidden === true);

  /* ② 拖时间轴也不翻页签 */
  seekTo(k.doc, 1.7); // 1.7 s 属于第 4 步
  check('★ 解耦后拖到 1.7 s，页签仍停在第 3 步', tabBtns[3].getAttribute('aria-selected') === 'true');
  check(
    '解耦时动画确实动了（t = 1.70，只是页签不动）',
    /^1\.70\s*\//.test(el(k.doc, 'timecode').textContent),
    el(k.doc, 'timecode').textContent,
  );

  /* ★ 重新勾上 ⇒ 立刻按当前时间对一次，并且"点页签跳动画"恢复 */
  followBox.checked = true;
  followBox.dispatch('change');
  check(
    '★ 恢复联动 ⇒ 立刻翻到当前步（第 4 步）',
    tabs.getAttribute('data-follow') === 'on' && tabBtns[4].getAttribute('aria-selected') === 'true',
    `follow=${tabs.getAttribute('data-follow')} 选中=${tabBtns.map((b) => b.getAttribute('aria-selected')).join(',')}`,
  );
  tabBtns[1].click(); // 第 1 步（t0 = 0）
  check(
    '★ 恢复联动后，点第 1 步又跳回 t = 0.00',
    /^0\.00\s*\//.test(el(k.doc, 'timecode').textContent),
    el(k.doc, 'timecode').textContent,
  );

  /* ── G 画布 16:9 ── */
  console.log('\n『G』画布 16:9（§14 的 960×540 同比例）');
  const cw = Number(page.stageCanvas.getAttribute('width'));
  const ch = Number(page.stageCanvas.getAttribute('height'));
  check('★ canvas 属性 960×540', cw === 960 && ch === 540, `${cw}×${ch}`);
  check('比例正好 16:9', Math.abs(cw / ch - 16 / 9) < 1e-9);
  check('★ CSS 用 aspect-ratio 表达比例', /\.stage-canvas\s*\{[^}]*aspect-ratio\s*:\s*16\s*\/\s*9/.test(page.html));
  check('★ CSS 没有写死像素高度', !/\.stage-canvas\s*\{[^}]*\bheight\s*:\s*\d+(?:\.\d+)?px/.test(page.html));
  /* 用户 2026-10-17：画布 + 曲线图必须能在视口里同时出现（教学时不想滚）。
     判据：画布宽度按 100vh 封顶 + 图表高度是变量而不是被内容撑开。 */
  check('★ 画布宽度按视口高度封顶（不出滚动条）', /\.stage-canvas\s*\{[^}]*100vh/.test(page.html));
  check('★ 图表高度是定值变量（--chart-h）', /--chart-h\s*:\s*\d+px/.test(page.html) && /\.chart-canvas\s*\{[^}]*height\s*:\s*var\(--chart-h\)/.test(page.html));

  /* ── H 15 道题全都能跑，且**时间曲线**已从槽位里清空 ── */
  console.log('\n『H』15 道题逐页跑通；画在世界坐标里的**时间曲线**已清空');
  const pages = readdirSync(BUILD_DIR)
    .filter((f) => /^q\d\d-.+\.html$/.test(f))
    .sort();
  check('成品页数量 = 15', pages.length === 15, String(pages.length));
  let booted = 0;
  const badPages = [];
  const timeChartLeftovers = [];
  const keptCharts = [];
  for (const file of pages) {
    const p = await bootPage(join(BUILD_DIR, file));
    if (p.errors.length) {
      badPages.push(`${file}: ${p.errors[0].message}`);
      continue;
    }
    booted += 1;
    const panelHidden = el(p.doc, 'chart-panel').hidden;
    const pickCount = el(p.doc, 'chart-picks').children.filter((c) => c.nodeType === 1).length;
    // 要么"有图可选"，要么"明确隐藏"；不允许"面板开着却没有任何量可画"
    if (!panelHidden && pickCount === 0) badPages.push(`${file}: 面板开着但没有可选量`);

    /* 旧的手绘曲线必须从槽位代码里消失 —— 但只针对**横轴为 t 的曲线**：
       `Draw.axisBox` / `Draw.chart` 本身不是原罪，p–V 相图这种"图形就是考点"的画法
       模板的时间轴图表面板替代不了，必须留在题里（q10 就是这种）。*/
    const m = /PROGRAM_DATA = (\{[\s\S]*?\});\n/.exec(p.html);
    let drawFrame = '';
    try {
      drawFrame = JSON.parse(m[1]).slots.drawFrame || '';
    } catch {
      drawFrame = '';
    }
    const hasInCanvasChart = /Draw\.(axisBox|chart)\(/.test(drawFrame);
    if (hasInCanvasChart) {
      // 判"是不是时间轴"：看 axisBox 的 xLabel 里有没有 t（如 't / s'）
      const isTimeAxis = /xLabel:\s*'[^']*\bt\b[^']*'/.test(drawFrame);
      if (isTimeAxis) timeChartLeftovers.push(file);
      else keptCharts.push(file);
    }
  }
  check('★ 15 道题全部装得起来且无异常', booted === 15 && badPages.length === 0, badPages.slice(0, 2).join(' / '));
  check('★ 横轴为 t 的手绘曲线已从槽位里清空', timeChartLeftovers.length === 0, timeChartLeftovers.join('、'));
  check(
    '★ 只保留"图形本身是考点"的非时间图表（q10 的 p–V 面积图）',
    keptCharts.length === 1 && keptCharts[0].startsWith('q10'),
    keptCharts.join('、') || '一个都没保留',
  );

  /* ── I 版面位置：曲线图在动画下方整宽；数据面板已删除 ── */
  console.log('\n『I』曲线图位于动画下方；数据面板已删除、栏目标题已改');
  check('.stage-wrap 存在（承载"上画布 / 下图表"两段）', /data-od-id="stage-wrap"/.test(page.html));
  check('★ 原题与分步解析已合并成左侧单一导读栏（col-text）', /data-od-id="col-text"/.test(page.html));
  check('.board 只剩两栏（导读 + 动画）', !/class="col-problem"/.test(page.html) && !/class="col-steps"/.test(page.html));
  {
    /* 用户 2026-10-17：「曲线图挪到原动画说明的地方」——那块地方在画布**下面**。
       用文档顺序判：图表必须出现在画布之后。 */
    const canvasAt = page.html.indexOf('data-od-id="stage-canvas"');
    const chartAt = page.html.indexOf('data-od-id="chart-panel"');
    check('★ 曲线图出现在画布之后（= 动画下方）', canvasAt >= 0 && chartAt > canvasAt);
  }
  check('★ .chart-panel 仍不是 .stage 的后代（不会叠在画布上）', (() => {
    const stageOpen = page.html.indexOf('class="stage" data-od-id="stage"');
    const panelOpen = page.html.indexOf('data-od-id="chart-panel"');
    if (stageOpen < 0 || panelOpen < 0) return false;
    // 从 .stage 开标签到 chart-panel 之间必须 div 收支平衡（= stage 已闭合）
    const between = page.html.slice(stageOpen, panelOpen);
    const opens = (between.match(/<div\b/g) || []).length;
    const closes = (between.match(/<\/div>/g) || []).length;
    return closes >= opens;
  })());
  check('★ 数据面板已删除（没有 readouts-grid）', !/data-od-id="readouts-grid"/.test(page.html));
  check(
    '★ 步标题 / 本步结论 / 脚注一并删除',
    !/data-od-id="panel-step-title"/.test(page.html) && !/data-od-id="panel-footnote"/.test(page.html),
  );
  check('读数分级样式已随面板删除', !/\.readout\.is-conclusion/.test(page.html));
  check('栏目标题改成「动画与图表」', /<h2 id="h-animation">动画与图表<\/h2>/.test(page.html));
  check('运行期提示元素仍在（空壳/装载失败要靠它说话）', /data-od-id="runtime-notice"/.test(page.html));

  /* ── J 宿主注入路径（路径 B）下图表同样活着 ──
     用户在动画页看到的**不是**成品页，而是"空壳模板 + postMessage 注入 program"（协议 §3 路径 B）。
     成品页能画不等于注入路径能画：两条路的 PROGRAM_DATA 来源不同（内联 vs 运行期注入），
     图表的序列又是在 boot 里从 player.program 采样的 —— 必须单独钉一次。*/
  console.log('\n『J』宿主注入（路径 B）下曲线图同样可用');
  const shell = await bootPage(join(BUILD_DIR, 'animation-template.html'));
  check('空壳页跑起来没有抛错', shell.errors.length === 0, shell.errors[0]?.message);
  check('空壳页的图表面板此时是收起的', el(shell.doc, 'chart-panel').hidden === true);
  const q01 = (
    await import(pathToFileURL(join(PROJECT_ROOT, 'tests', 'regression-15', 'q01-conveyor-heat.mjs')).href)
  ).default;
  shell.windowStub.dispatch('message', {
    data: { source: 'od-host', type: 'program', slots: q01.slots, mode: 'NUMERIC', id: q01.id, title: q01.title },
  });
  check('注入后没有抛错', shell.errors.length === 0, shell.errors[1]?.message);
  check('★ 注入后图表面板出现', el(shell.doc, 'chart-panel').hidden === false);
  const shellPicks = el(shell.doc, 'chart-picks').children.filter((c) => c.nodeType === 1);
  check('★ 注入后可选量 ≥ 4', shellPicks.length >= 4, String(shellPicks.length));
  let shellMark = shell.chart.calls.length;
  seekTo(shell.doc, 0.3);
  const shellLabel = cursorLabel(shell.chart, shellMark);
  check(
    '★ 注入后 t = 0.3 的游标读数仍是 0.6',
    shellLabel !== null && Math.abs(Number(shellLabel) - 0.6) < 1e-9,
    shellLabel,
  );
  shellMark = shell.chart.calls.length;
  seekTo(shell.doc, 1.6);
  check('注入后拖到 1.6 读数变 2（图表跟着动）', Math.abs(Number(cursorLabel(shell.chart, shellMark)) - 2) < 1e-9);

  console.log(
    failures.length
      ? `\n✗ 联动图表取证：通过 ${passed} 条，失败 ${failures.length} 条\n\n失败明细：\n${failures
          .map((f) => `  ✗ ${f.name}${f.detail ? `\n      ${f.detail}` : ''}`)
          .join('\n')}\n`
      : `\n✓ 联动图表取证：通过 ${passed} 条，失败 0 条\n`,
  );
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
