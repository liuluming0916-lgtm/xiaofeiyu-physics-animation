#!/usr/bin/env node
/**
 * 宿主协议取证（第 3 期第 6 步 · §13.2 定稿 / §22 第 11 条）。
 *
 * 为什么需要它：第 3 期给协议**新增了 `program` 注入消息**（`contracts/host-protocol.md` §3），
 * 它让"空壳模板 + 宿主注入"这条路径可用。但这条路径：
 *   · 成品页（`template/build/*.html`）**用不到**（它们走构建期内联）；
 *   · 静态体检（`layout-lint`）**看不到**（它只查占位符与语法）；
 * ⇒ 不专门取证的话，它是**门禁盲区**。
 *
 * 本文件不去"模拟浏览器"，而是**在 vm 里真跑一遍模板页的内联脚本**，喂一个够用的 DOM 桩，
 * 然后断言它对各种宿主消息的反应。判据是**它回给宿主的消息**（即协议的可观察面）。
 *
 * 用法：node tests/host-protocol-selftest.mjs
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

import { makeDocumentStub, makeStubElement } from './harness/dom-stub.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..');
const TEMPLATE = join(PROJECT_ROOT, 'template', 'build', 'animation-template.html');
const Q01 = join(PROJECT_ROOT, 'template', 'build', 'q01-conveyor-heat.html');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ────────────────────────────── DOM 桩 ────────────────────────────── */

/* ────────────────────────────── DOM 桩 ──────────────────────────────

 * 桩已抽到 `tests/harness/dom-stub.mjs`（第 3 期交付后）。
 *
 * 为什么抽出去：第一版的桩在这里"每个选择器返回一个空元素"，
 * 于是**内容级断言全是假的**（页头文本永远读到空串、公式节点永远查不到）。
 * 桩的能力边界就是判据的能力边界 —— 它值得有自己的文件、自己的注释与自己的坑记录。
 */

/** 收集模板发给宿主的消息 */
function makeHostRecorder() {
  const messages = [];
  const windowStub = {
    parent: { postMessage: (msg) => messages.push(msg) },
    addEventListener(type, fn) { (windowStub.listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    listeners: {},
    localStorage: { _m: new Map(), get length() { return this._m.size; }, key(i) { return [...this._m.keys()][i] ?? null; }, getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } },
    devicePixelRatio: 1,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout: (fn) => { try { fn(); } catch { /* 桩里同步跑，忽略时序错误 */ } return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    dispatch(type, ev) { (windowStub.listeners[type] ?? []).forEach((fn) => fn(ev)); },
  };
  // 模板里判断 `window.parent === window` 来决定是否发消息，这里 parent 与 window 不同 ⇒ 会发
  return { windowStub, messages };
}

/** 从 HTML 里抠出全部内联 <script> 体（跳过带 src 的） */
function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

/**
 * 在 vm 里跑一个成品/空壳页面的内联脚本。
 * @returns {{ messages: object[], windowStub: object, errors: Error[] }}
 */
async function runTemplatePage(htmlPath, opts = {}) {
  const html = readFileSync(htmlPath, 'utf8');
  const { windowStub, messages } = makeHostRecorder();
  /* 第 8 期：允许在**跑脚本之前**种一份 localStorage ——
     "启动时清理旧格式偏好"发生在脚本初始化阶段，事后再写就测不到了。 */
  for (const [k, v] of Object.entries(opts.localStorage ?? {})) windowStub.localStorage.setItem(k, v);
  const errors = [];

  /**
   * 文档桩：**真的解析这份 HTML**，选择器查的是真实元素树。
   *
   * ⚠ 第一版这里是"每个选择器返回一个**空**元素"，于是内容级断言全部是假的
   *   （页头文本永远空串、公式节点永远查不到）。实现与踩过的坑见 `tests/harness/dom-stub.mjs`。
   */
  const documentStub = makeDocumentStub(html);
  const sandbox = {
    window: windowStub,
    document: documentStub,
    // TeX 行内渲染器要用 NodeFilter.SHOW_TEXT 做 TreeWalker 遍历
    NodeFilter: { SHOW_TEXT: 4, SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    console,
    Math,
    JSON,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    isNaN,
    parseFloat,
    parseInt,
    Map,
    Set,
    TextDecoder,
    // localStorage 也挂在全局（模板用 window.localStorage，但兜底）
    localStorage: windowStub.localStorage,
  };
  sandbox.window.document = documentStub;
  sandbox.globalThis = sandbox;

  // 运行时（window.ODRuntime）：真实加载 animation-runtime.mjs 并挂到 window 上，
  // 这样 boot() 走的是**真运行时**，能真正装配程序（而不是被桩糊弄过去）。
  const rt = await import(pathToFileURL(join(PROJECT_ROOT, 'sdk', 'runtime', 'animation-runtime.mjs')).href);
  windowStub.ODRuntime = rt;

  const context = vm.createContext(sandbox);
  for (const code of inlineScripts(html)) {
    // 公式预渲染器那段（tex-inline-renderer）依赖 ODTex 全局；缺失时模板有降级链
    try {
      vm.runInContext(code, context, { filename: htmlPath });
    } catch (err) {
      errors.push(err);
    }
  }
  return { messages, windowStub, errors, documentStub };
}

/* ────────────────────────────── 取证 ────────────────────────────── */

console.log('宿主协议取证（第 3 期第 6 步）\n');

const SLOT_KEYS = ['PROBLEM', 'STEPS', 'ANSWERS', 'VIEW', 'setup', 'stateAt', 'drawFrame', 'readouts'];
const q01 = (await import(pathToFileURL(join(PROJECT_ROOT, 'tests', 'regression-15', 'q01-conveyor-heat.mjs')).href)).default;

console.log('『A』路径 A：成品页（构建期内联）');
{
  const { messages, errors } = await runTemplatePage(Q01);
  check('内联脚本无异常抛出', errors.length === 0, errors.map((e) => e.message).join(' | '));
  const ready = messages.find((m) => m.type === 'ready');
  check('boot 后发出 ready', Boolean(ready), JSON.stringify(messages.map((m) => m.type)));
  check('ready 带 duration 与 stepCount', typeof ready?.duration === 'number' && typeof ready?.stepCount === 'number');
  check('所有消息都带 source: "od-template"', messages.every((m) => m.source === 'od-template'));
  check('没有 error 消息（成品页应当健康启动）', !messages.some((m) => m.type === 'error'), JSON.stringify(messages.filter((m) => m.type === 'error')));
}

console.log('\n『B』路径 B：空壳模板 + 宿主注入 program');
{
  const { messages, windowStub, errors } = await runTemplatePage(TEMPLATE);
  check('空壳模板脚本无异常', errors.length === 0, errors.map((e) => e.message).join(' | '));
  check('空壳启动时报告 no-program（不是静默）', messages.some((m) => m.type === 'error' && m.code === 'no-program'), JSON.stringify(messages.map((m) => m.type + (m.code ? ':' + m.code : ''))));

  /**
   * ★ 空壳**必须在无人催的情况下主动报一次 `ready`**（第 3 期交付后补的判据）。
   *
   * 为什么：`ready` 原先只在 `boot()` 成功后才发，而空壳的 `boot()` 会提前 return
   * ⇒ 空壳永不发 `ready`；宿主又规定"收到 `ready` 才发 `program`"
   * ⇒ **两边互相等，死锁**。用户在浏览器里看到的就是
   * "正在等待模板页就绪…" + 空壳模板，永远不动。
   *
   * ⚠ 判据成立的前提：此刻**还没有注入过 program**（上面只发了 no-program 这个 error）。
   */
  const spontaneousReady = messages.find((m) => m.type === 'ready');
  check(
    '空壳在未收到 program 时**主动**报 ready（否则与宿主互相等待 ⇒ 死锁）',
    Boolean(spontaneousReady),
    `实际消息序列 = ${JSON.stringify(messages.map((m) => m.type))}`,
  );
  check('主动 ready 标了 shell: true（与成品页的 ready 可区分）', spontaneousReady?.shell === true, JSON.stringify(spontaneousReady));

  // 清掉启动消息，专注于注入后的反应
  messages.length = 0;

  // 宿主发 program
  windowStub.dispatch('message', {
    data: { source: 'od-host', type: 'program', slots: q01.slots, mode: 'NUMERIC' },
  });

  const ready = messages.find((m) => m.type === 'ready');
  check('注入合法 program 后发出 ready（路径 B 真的通了）', Boolean(ready), JSON.stringify(messages.map((m) => m.type)));
  check('ready 带 duration', typeof ready?.duration === 'number');
  check('注入后没有 error', !messages.some((m) => m.type === 'error'), JSON.stringify(messages.filter((m) => m.type === 'error')));
}

console.log('\n『B-2』第 8 期：偏好"每次打开都干净"（用户裁决）');
{
  /**
   * 用户的原话："用户没有'记忆'需求，每次打开播放器都应该在最初的位置。"
   * 这条钉四件事：
   *   ① 存储键**带本次启动编号**（重开服务即换键 ⇒ 干净）；同一启动内刷新仍保留开关；
   *   ② 时间轴**永不恢复**（不写 `t`、读到也置 0）——它就是"播放键没反应"的元凶；
   *   ③ 旧格式键（`od-animation-prefs:<标题>`）启动时**清掉**（用户允许）；
   *   ④ 曲线图**默认打开**（只认作者显式 `SIM.chart === false`）。
   */
  const templateSrc = readFileSync(TEMPLATE, 'utf8');
  check('存储键用 storeKey()（含版本与启动编号），不再直接拼 document.title',
    /function storeKey\(\)\s*\{[\s\S]{0,200}PREF_VERSION[\s\S]{0,80}LAUNCH_ID/.test(templateSrc));
  check('persist() 不再写 `t`（时间不落盘）', !/JSON\.stringify\(\{\s*rate:[\s\S]{0,160}?\bt: player\.state\.t/.test(templateSrc));
  check('restore() 装完把 t 归零（读到旧 t 也故意忽略）', /player\.state\.t = 0;/.test(templateSrc));
  check('启动时清理旧格式键（只清自己的前缀）', /purgeLegacyPrefs\(\);/.test(templateSrc));
  check('曲线图默认开：只有 SIM.chart === false 才关', /hint === false\) return false;[\s\S]{0,160}return true;/.test(templateSrc));
  check('点播放"差一帧也算到结尾"⇒ 从头重播', /player\.state\.t >= player\.duration - guard\) player\.state\.t = 0;/.test(templateSrc));

  // 行为面：给一份"上次启动"的偏好，本次启动（换编号）不该吃到它
  const legacyKey = 'od-animation-prefs:' + 'stub';
  const { windowStub, errors } = await runTemplatePage(TEMPLATE, {
    localStorage: { [legacyKey]: JSON.stringify({ rate: '4', t: 3.19, mask: { chart: false } }) },
  });
  check('注入前后脚本均无异常（含清理旧键那段）', errors.length === 0, errors.map((e) => e.message).join(' | '));
  windowStub.dispatch('message', {
    data: { source: 'od-host', type: 'program', slots: q01.slots, mode: 'BOTH', launchId: 'L-test' },
  });
  check('注入后清掉了旧格式键（否则旧状态会继续污染）', windowStub.localStorage.getItem(legacyKey) === null);
  const v2Keys = [];
  for (let i = 0; i < (windowStub.localStorage.length ?? 0); i += 1) {
    const k = windowStub.localStorage.key?.(i);
    if (k) v2Keys.push(k);
  }
  check('当前存储里没有残留的旧格式键', v2Keys.every((k) => !/^od-animation-prefs:(?!v2:)/.test(k)), JSON.stringify(v2Keys));
}

console.log('\n『B-3』★ 注入后必须"看起来像真的题目"（第 3 期交付后修的两处，README 13.12）');
{
  /**
   * 这两条是用户验收时当场发现的问题，都必须**可机检**：
   *   ① 页头注入后仍写着"空壳模板/未注入题目" ⇒ 人分不清"注入成功"还是"停在空壳"；
   *   ② 宿主发了 `texSvg` 但公式仍走降级链 ⇒ 屏幕上出现 `\frac` 原文。
   *
   * ⚠ 公式那条**必须用真预渲染表**（`TEX_SVG`）里的公式当探针：
   *   第一版我随手编了个 `u=2` 塞进 texSvg，而题面里并没有 `$u=2$`
   *   ⇒ 模板当然不会用它 ⇒ 得到"失败"这个**假红**。
   *   桩/夹具构造得不对，判据就会说谎 —— 与"桩太弱导致假绿"是同一类错误。
   */
  const { TEX_SVG } = await import('../web/src/lib/demo-questions.ts').catch(() => ({ TEX_SVG: null }));
  // TS 文件 Node 直接 import 不了 ⇒ 从生成它的构建期产物旁路读：
  // 公式表就在这里，取第一条真实预渲染公式当探针
  const texSource =
    TEX_SVG ??
    (await import('../tools/build-demo-questions.mjs')).__TEX_SVG_FOR_TEST__ ??
    null;

  // 用真 q01 题面里确实存在的一条公式
  const realProblem = q01.slots.PROBLEM;
  const firstTex = /([^$\n]+)/.exec(realProblem.split('$')[1] ?? '') ? realProblem.split('$')[1] : null;
  check('能从 q01 题面里取到一条真实行内公式当探针', Boolean(firstTex), String(firstTex));

  const texSvg = {
    renderer: 'mathjax-full@3.2.2 (tex2svg)',
    glyphs: '<path id="MJX-TEST-GLYPH" d="M0 0h10v10H0z"/>',
    formulas: {
      [firstTex]: `<mjx-container class="MathJax" style="vertical-align: -0.2em;"><svg><use xlink:href="#MJX-TEST-GLYPH"></use></svg></mjx-container>`,
    },
  };

  const { messages, windowStub } = await runTemplatePage(TEMPLATE);
  messages.length = 0;
  windowStub.dispatch('message', {
    data: { source: 'od-host', type: 'program', slots: q01.slots, mode: 'NUMERIC', texSvg, id: 'q01-conveyor-heat', title: '传送带共速与摩擦生热' },
  });
  check(
    '带 texSvg / id / title 的注入仍然成功（没有因为多了字段而报错）',
    messages.some((m) => m.type === 'ready'),
    JSON.stringify(messages.filter((m) => m.type === 'error')),
  );

  // ① 页头身份
  const titleEl = windowStub.document.querySelector('[data-od-id="page-title"]');
  const provEl = windowStub.document.querySelector('[data-od-id="meta-provenance"]');
  check(
    '注入后页头 h1 变成真实题目名，不再写"空壳模板"',
    Boolean(titleEl) && titleEl.textContent === '传送带共速与摩擦生热',
    `实际 = ${JSON.stringify(titleEl && titleEl.textContent)}`,
  );
  check(
    '注入后 meta 不再写"未注入题目"',
    Boolean(provEl) && !String(provEl.textContent).includes('未注入'),
    `实际 = ${JSON.stringify(provEl && provEl.textContent)}`,
  );

  // ② 公式确实命中了**宿主发来的**预渲染表
  const svgNodes = windowStub.document.querySelectorAll('.tex-svg');
  check(
    '宿主发的预渲染公式被用上了（题面里出现 .tex-svg 节点）',
    svgNodes.length > 0,
    `找到 ${svgNodes.length} 个 .tex-svg；若为 0 说明 program.texSvg 没被用上`,
  );
  check(
    '该节点带的是我们注入的公式（title 等于探针 LaTeX）',
    svgNodes.some((n) => n.getAttribute('title') === firstTex),
    `页面上的 title = ${JSON.stringify(svgNodes.map((n) => n.getAttribute('title')).slice(0, 4))}`,
  );
  void texSource;
}

console.log('\n『B-2』注入的健壮性');
{
  // 槽位缺一个 ⇒ bad-program，且**不改动现场**
  const { messages, windowStub } = await runTemplatePage(TEMPLATE);
  messages.length = 0;
  const bad = { ...q01.slots };
  delete bad.VIEW;
  windowStub.dispatch('message', { data: { source: 'od-host', type: 'program', slots: bad, mode: 'NUMERIC' } });
  check('缺槽位 ⇒ error code=bad-program', messages.some((m) => m.type === 'error' && m.code === 'bad-program'), JSON.stringify(messages));
  check('缺槽位时不发 ready', !messages.some((m) => m.type === 'ready'));

  // 槽位为空串 ⇒ 同样拒绝（§3.2 审计 2：空串视为缺失）
  messages.length = 0;
  const empty = { ...q01.slots, VIEW: '' };
  windowStub.dispatch('message', { data: { source: 'od-host', type: 'program', slots: empty, mode: 'NUMERIC' } });
  check('空字符串槽位 ⇒ bad-program', messages.some((m) => m.type === 'error' && m.code === 'bad-program'));

  // 多一个键 ⇒ 拒绝（不许偷塞第 9 个键）
  messages.length = 0;
  const extra = { ...q01.slots, EXTRA: 'x' };
  windowStub.dispatch('message', { data: { source: 'od-host', type: 'program', slots: extra, mode: 'NUMERIC' } });
  check('多出第 9 个键 ⇒ bad-program（§3.2）', messages.some((m) => m.type === 'error' && m.code === 'bad-program'));
}

console.log('\n『B-3』成品页拒绝运行时覆盖（§13.1 导出保真）');
{
  const { messages, windowStub } = await runTemplatePage(Q01);
  messages.length = 0;
  windowStub.dispatch('message', {
    data: { source: 'od-host', type: 'program', slots: q01.slots, mode: 'NUMERIC' },
  });
  check(
    '成品页收到 program ⇒ error code=program-already-inlined',
    messages.some((m) => m.type === 'error' && m.code === 'program-already-inlined'),
    JSON.stringify(messages.map((m) => m.type + (m.code ? ':' + m.code : ''))),
  );
  check('成品页不会因为覆盖而再发一次 ready', !messages.some((m) => m.type === 'ready'));
}

console.log('\n『C-2』★ 重试注入产生的"重复拒绝"必须与"真拒绝"区分开（第 3 期交付后补）');
{
  /**
   * 背景：为摆脱"双向握手"（宿主等 ready、空壳等 program），宿主改成**重试注入 4 次**。
   * 而模板有 §13.1 的防覆盖保护 ⇒ 第 2～4 条会被拒。
   *
   * 用户在浏览器里看到的是：**动画正常播放**，但界面上挂着一条红色错误
   * —— 那是自我竞争输掉的正常结果，不是故障。
   *
   * 判据分两半（宿主侧的区分逻辑在 `AnimationPage.tsx`）：
   *   ① 模板**必须**继续拒绝重复注入（§13.1 不能被削弱，否则"导出 = 屏幕所见"会破）；
   *   ② 宿主侧必须**只在从未成功注入过时**才把它当错误显示。
   */
  const pageSource = readFileSync(join(PROJECT_ROOT, 'web', 'src', 'pages', 'AnimationPage.tsx'), 'utf8');
  check(
    '宿主对 program-already-inlined 做了"是否曾成功注入"的区分',
    /code === 'program-already-inlined' && useApp\.getState\(\)\.templateReady/.test(pageSource),
    '若为假：动画能播时仍会挂一条红色错误（用户第 3 期验收遇到的就是它）',
  );
  check(
    '宿主对 program-already-inlined 有明确分支（不是笼统当错误）',
    pageSource.includes("code === 'program-already-inlined'"),
  );
  check(
    '该分支仍然**留痕**（写日志而不是静默丢弃）',
    /program-already-inlined[\s\S]{0,200}pushLog/.test(pageSource),
    '不静默：预期内的拒绝也要在通信日志里能看到',
  );
}

console.log('\n『C』source 字段的方向判据（协议 §2）');
{
  const { messages, windowStub } = await runTemplatePage(TEMPLATE);
  messages.length = 0;
  // 非 od-host 的来源：必须忽略
  windowStub.dispatch('message', { data: { source: 'evil', type: 'program', slots: q01.slots, mode: 'NUMERIC' } });
  check('source 不是 od-host ⇒ 忽略（不 boot）', !messages.some((m) => m.type === 'ready'));

  // 完全没有 source：向后兼容，接受
  windowStub.dispatch('message', { data: { type: 'program', slots: q01.slots, mode: 'NUMERIC' } });
  check('缺 source ⇒ 接受（向后兼容 §13.2 草案）', messages.some((m) => m.type === 'ready'));
}

console.log('\n『D』控制消息（§13.2 原文的 8 条宿主→模板）');
{
  const { messages, windowStub } = await runTemplatePage(Q01);
  const controls = ['play', 'pause', 'toggle', 'seek', 'setRate', 'showStep', 'setVectorMask', 'setTheme'];
  let threw = null;
  for (const type of controls) {
    try {
      windowStub.dispatch('message', { data: { source: 'od-host', type, t: 0.1, rate: 2, index: 0, velocity: true, theme: 'light' } });
    } catch (err) {
      threw = `${type}: ${err.message}`;
      break;
    }
  }
  check('8 条控制消息全部被安全接受（不抛错）', threw === null, String(threw));
  check('未知消息类型被忽略（不抛错、不改变状态）', (() => {
    try {
      windowStub.dispatch('message', { data: { source: 'od-host', type: 'no_such_message' } });
      return true;
    } catch {
      return false;
    }
  })());
}

console.log('\n『F』★ 前端公式接线（第 3 期交付后补：演示界面"公式掉格式"那一类事故）');
{
  /**
   * 这条判据防的是**接线错误**，不是渲染能力错误。
   *
   * 用户看到的现象：分步解析里显示 `\frac{u}{\mu g}` 原文。
   * 根因有两层，**两层都要有判据**：
   *   ① `STEPS` 的 `tex` 字段是**裸 LaTeX**（无 `$` 定界符），交给 `<Markdown>` 会被当普通文字
   *      ⇒ 前端必须用**专用入口**渲染它（`MathBlock`）；
   *   ② 应用产物里必须**真的带上**这些公式的预渲染结果（否则专用入口也查不到，仍降级为原文）。
   *
   * 判据只查"产物/源里是否具备条件"，不去执行 React
   *（浏览器渲染由用户在真浏览器确认 —— 这条边界不能含糊）。
   */
  const buildSource = readFileSync(join(PROJECT_ROOT, 'web', 'src', 'lib', 'markdown.tsx'), 'utf8');
  const pageSource = readFileSync(join(PROJECT_ROOT, 'web', 'src', 'pages', 'SolvePage.tsx'), 'utf8');

  check('公式组件导出了专用入口 MathBlock', /export function MathBlock/.test(buildSource));
  /**
   * ⚠ 第 8 期改了这条的含义：`MathBlock` 原本是"整段即一条公式"，
   * 现在用户要求"解释+公式+解释+公式 要自动分行"，所以它改为**混排**渲染。
   * 判据随之变成"结构对不对"，而不是某个注释词还在不在：
   *   ① `markdown.tsx` 必须走 `splitTexMix`（不再无条件整段当公式）；
   *   ② 切分函数所在模块必须**保住**"裸 LaTeX 不能退化成文字"这条（历史坑，README 13.12）。
   */
  const mixSource = readFileSync(join(PROJECT_ROOT, 'web', 'src', 'lib', 'tex-mix.ts'), 'utf8');
  check('MathBlock 走混排切分（splitTexMix），不再"整段当公式"', buildSource.includes('splitTexMix('));
  check(
    '切分函数保住了"裸 LaTeX 整段即公式"（否则历史坑复发：\frac 变成一堆反斜杠）',
    /没有定界符/.test(mixSource) && /type: 'math'/.test(mixSource),
  );
  check(
    'SolvePage 的分步解析用的是 MathBlock（不是把裸 LaTeX 丢给 Markdown）',
    /<MathBlock tex=\{s\.tex/.test(pageSource),
    '若为假：分步解析的公式会退回 LaTeX 原文',
  );
  check(
    '未预渲染时会显示原文并标注（不静默降级成空白）',
    buildSource.includes('tex-raw') && buildSource.includes('未预渲染'),
  );

  // ② 预渲染表必须**真的覆盖**演示会显示的那些公式
  const demoSource = readFileSync(join(PROJECT_ROOT, 'web', 'src', 'lib', 'demo-questions.ts'), 'utf8');
  const texKeys = new Set(
    [...demoSource.matchAll(/^ {4}"((?:[^"\\]|\\.)*)":/gm)].map((m) => JSON.parse(`"${m[1]}"`)),
  );
  check(`演示数据里带了预渲染公式表（${texKeys.size} 条）`, texKeys.size > 0);

  // 把 q01 的 STEP 公式（真值）与预渲染表比对：**必须全部命中**
  const stepTexes = [...q01.slots.STEPS.matchAll(/^tex:\s*(.+)$/gm)].map((m) => m[1].trim());
  const missedSteps = stepTexes.filter((t) => !texKeys.has(t));
  check(
    `q01 的 ${stepTexes.length} 条步骤公式全部在预渲染表里`,
    missedSteps.length === 0,
    missedSteps.length ? `漏了 ${missedSteps.length} 条，例：${JSON.stringify(missedSteps[0].slice(0, 60))}` : '',
  );

  // 题面的行内公式同样要全部覆盖
  const inlineTexes = [...q01.slots.PROBLEM.matchAll(/\$([^$\n]+)\$/g)].map((m) => m[1].trim());
  const missedInline = inlineTexes.filter((t) => !texKeys.has(t));
  check(
    `q01 题面的 ${inlineTexes.length} 条行内公式全部在预渲染表里`,
    missedInline.length === 0,
    missedInline.length ? `漏了 ${missedInline.length} 条，例：${JSON.stringify(missedInline[0].slice(0, 60))}` : '',
  );
}

/* 『D-2』数据面板删除后的口径（第 7 期）。
   ⚠ 这里原来断言的是"读数分级渲染"：is-conclusion / is-process 两个类名、
     isConclusionReadout 判据函数、与 C7 同一套符号匹配、以及 .num 数字列，
     外加一段"分级不空转"的语义断言。
   用户 2026-10-17 裁决「这部分'动画说明'删掉不要」，数据面板整块删除，
   那几条断言就**失去了被测对象** —— 留着只会变成"把功能删掉门禁就绿"的假门禁。
   所以按纪律换成反向钉子：面板必须确实不在、判据函数不许留死代码、
   保留下来的数字仍走同一套格式化。
   **能力是真删了，门禁跟着删，而且要写明**（见第 7 期交付说明的偏离清单）。*/
console.log('\n『D-2』数据面板删除后的口径（第 7 期：面板已删，数字口径仍须统一）');
{
  const tpl = readFileSync(TEMPLATE, 'utf8');
  check('★ 数据面板已按裁决删除（不再产出 readouts-grid）', !tpl.includes('data-od-id="readouts-grid"'));
  check(
    '★ 读数分级样式与判据函数一并删除（不留死代码）',
    !tpl.includes('is-conclusion') && !tpl.includes('is-process') && !tpl.includes('function isConclusionReadout'),
  );
  check('★ 保留下来的数字仍走统一格式化 RT.format(…, 3)', /RT\.format\([^)]*,\s*3\)/.test(tpl));
  check('图表脚注（当前值）元素在版面上', tpl.includes('data-od-id="chart-foot"'));
}

console.log('\n『E』协议与契约的同源性');{
  const frozen = await import(pathToFileURL(join(PROJECT_ROOT, 'contracts', 'spec', 'frozen-keys.mjs')).href);
  const doc = readFileSync(join(PROJECT_ROOT, 'contracts', 'host-protocol.md'), 'utf8');

  for (const name of frozen.HOST_MESSAGES.hostToTemplate) {
    check(`协议文档写了宿主→模板的 ${name}`, doc.includes(`\`${name}\``));
  }
  for (const name of frozen.HOST_MESSAGES.templateToHost) {
    check(`协议文档写了模板→宿主的 ${name}`, doc.includes(`\`${name}\``));
  }
  check('协议文档包含了新增的 program 消息', doc.includes('`program`'));
  check('协议文档写明了 source 字段', doc.includes("'od-host'") && doc.includes("'od-template'"));
  check(
    '协议文档提到两条装载路径（导出保真的前提）',
    doc.includes('构建期内联') && doc.includes('宿主运行时注入'),
  );

  // 模板侧真的监听了这些消息名
  const tpl = readFileSync(TEMPLATE, 'utf8');
  for (const name of [...frozen.HOST_MESSAGES.hostToTemplate, 'program']) {
    check(`模板侧有 ${name} 的分支`, tpl.includes(`case '${name}'`) || tpl.includes(`'${name}':`));
  }
}

/* ────────────────────────────── 汇总 ────────────────────────────── */

console.log(`\n${failures.length ? '✗' : '✓'} 宿主协议取证：通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
  process.exitCode = 1;
}
