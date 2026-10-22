#!/usr/bin/env node
/**
 * 「方案 A」取证（第 8 期 · 用户 2026-10-17 拍板：画布上不再写任何文字）
 *
 * 方案 A 的原话：「动画中原生的各种说明，包括向量箭头比如速度、加速度的标注，
 * 只保留物理元件就可以了，矢量箭头靠颜色与大小做区分。」
 *
 * 这个方案**最容易假成功**：只要有一个 `fillText` 漏在网络里，画面上就会出现
 * 一条孤零零的字，而**没有任何门禁会红**（字照画、动画照播）。
 * 所以这里不看代码读没读懂，只**数画布上到底印了哪些字符串** ——
 * `tests/harness/canvas-harness.mjs` 的 mock canvas 本来就把 `fillText` 的实参记下来了
 * （它当初就是为了"取证画布上印了什么字"而写的）。
 *
 * 要证明的四件事：
 *   **A 开关唯一**：`text`/`latex`/箭头标签/尺寸文字四处一起失效，不能漏一处。
 *   **B 真题目**：15 道题渲染出来，画布上**一个数字都没有**（数值读数全清）。
 *   **C 唯一例外**：坐标轴轴名（`p`/`V`）必须还在 —— 否则 p–V 图不是图。
 *   **D 颜色与图例**：绿=速度 / 蓝=加速度 / 红=受力，两处色值必须逐字一致。
 *
 * 用法：node tests/plan-a-textless-selftest.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT, isCliEntry } from '../tools/paths.mjs';
import {
  ARROW_MIN_PX,
  DEFAULT_THEME,
  HIDE_CANVAS_TEXT,
  KEEP_AXIS_LABELS,
  VECTOR_COLORS,
} from '../sdk/runtime/animation-runtime.mjs';
import { renderQuestion } from './harness/canvas-harness.mjs';
import { loadQuestions } from '../core/dryrun/run-suite.mjs';

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

const read = (rel) => readFileSync(join(PROJECT_ROOT, rel), 'utf8');

/** 渲染一道题，返回它在画布上**真正印出来的字符串**（去重、保序） */
function drawnTexts(program) {
  const { canvas } = renderQuestion(program);
  const seen = new Set();
  const out = [];
  for (const call of canvas.__calls) {
    for (const s of call.texts ?? []) {
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out;
}

async function main() {
  console.log('「方案 A」取证：画布上不再写任何文字\n');

  /* ══ A 开关唯一：四处入口都要被同一个开关守住 ══ */
  console.log('『A』开关唯一：四处入口不能漏一处');

  check('★ `HIDE_CANVAS_TEXT` 是开着的', HIDE_CANVAS_TEXT === true);
  check('★ 坐标轴轴名的例外也是开着的（删了 p–V 图就没意义）', KEEP_AXIS_LABELS === true);

  {
    const src = read('sdk/runtime/animation-runtime.mjs');
    check('② 箭头标签有守卫', src.includes('if (rec.label && !HIDE_CANVAS_TEXT)'));
    check('③ 尺寸标注的文字有守卫', src.includes('if (rec.text && !HIDE_CANVAS_TEXT)'));
    check('④ 轴名走的是**另一个**开关（它是例外，不是漏网）', src.includes('if (KEEP_AXIS_LABELS)'));
    // 4 处 = 箭头标签 1 + 尺寸文字 1 + 轴名 2；text/latex 已硬删除。
    check('★ fillText 只有这 4 处（加新的一处就会红，逼着重新想清楚）', (src.match(/ctx\.fillText\(/g) ?? []).length === 4);
  }

  /* ══ B/C 真题目：画布上一个数字都没有，但轴名还在 ══ */
  console.log('\n『B』真题目：画布上印了什么字（这是唯一的证据）');

  const questions = await loadQuestions();
  check('拿到 15 道回归题', questions.length === 15);

  const rows = [];
  for (const { file, program } of questions) {
    rows.push({ id: program.id.replace(/-.*/, ''), file, texts: drawnTexts(program) });
  }

  for (const r of rows) {
    if (!r.texts.length) continue;
    console.log(`      ${r.id}：画布上仍有 ${r.texts.length} 段字 —— ${r.texts.map((t) => JSON.stringify(t)).join(' · ')}`);
  }
  const quiet = rows.filter((r) => r.texts.length === 0);
  console.log(`      画布完全无字的题：${quiet.length} / ${rows.length}`);

  {
    // 「唯一例外」= 只有带 `axisBox` 的那道题能印字，而且只能印轴名。
    // ⚠ 轴名里出现数字是**合理**的：`p / kPa`、`V / 10⁻³m³` 是坐标轴的单位标注，
    //   不是"数值读数"。所以下面对"有没有数字"的断言必须把这一处**显式排除**，
    //   否则要么把合法的轴名判成违规，要么就得把断言放宽到查不出任何东西。
    const axisRows = rows.filter((r) => r.texts.length > 0);
    const others = rows.filter((r) => r.texts.length === 0);

    check('★ 只有 1 道题会印字，其余 14 道画布完全无字', axisRows.length === 1 && others.length === 14);
    check(
      '★ 印字的那道是 p–V 图，且只是两个轴名',
      axisRows.every((r) => r.id === 'q10' && r.texts.length === 2),
      JSON.stringify(axisRows.map((r) => [r.id, r.texts])),
    );
    check(
      '★ 轴名确实是坐标轴（`p / …` 与 `V / …`）',
      axisRows.every((r) => r.texts.some((t) => /^p\s*\//.test(t)) && r.texts.some((t) => /^V\s*\//.test(t))),
    );

    const nonAxis = rows.filter((r) => r.id !== 'q10').flatMap((r) => r.texts);
    check('★ 除轴名外，全语料画布上**一个数字都没有**', nonAxis.every((t) => !/[0-9]/.test(t)), nonAxis.join(' / '));
    check('★ 除轴名外，没有等号、没有单位', nonAxis.every((t) => !t.includes('=') && !/m\/s|kPa|mA/.test(t)));
    check('★ 除轴名外，没有"球 1…""碰前匀速"这类说明句', nonAxis.every((t) => !/球|碰|匀速|分解|速度/.test(t)));
  }

  {
    // q01 是用户截图那题：箭头标签 `u`、尺寸 `Δs = 1 m`、说明 `传送带速度 u` 曾同时出现
    const q01 = rows.find((r) => r.id === 'q01');
    check('★ q01（传送带）画布上**完全无字**', q01 && q01.texts.length === 0, q01 ? JSON.stringify(q01.texts) : 'missing');

    const q04 = rows.find((r) => r.id === 'q04');
    check('★ q04（斜碰）画布上**完全无字**', q04 && q04.texts.length === 0, q04 ? JSON.stringify(q04.texts) : 'missing');

    // 反面：q10 是 p–V 图，轴名必须活下来
    const q10 = rows.find((r) => r.id === 'q10');
    check(
      '★ 唯一例外成立：p–V 图的轴名还在（p / … 与 V / …）',
      Boolean(q10) && q10.texts.length === 2 && q10.texts.some((t) => /^p\s*\//.test(t)) && q10.texts.some((t) => /^V\s*\//.test(t)),
      q10 ? JSON.stringify(q10.texts) : 'missing',
    );
  }

  /* ══ D 颜色与图例：两处色值必须逐字一致 ══ */
  console.log('\n『D』颜色：绿=速度 / 蓝=加速度 / 红=受力');

  {
    check('★ 速度改成绿色', DEFAULT_THEME.velocity.toLowerCase() === '#2e7d32');
    check('★ 加速度改成蓝色（深蓝，避开图表墨色）', DEFAULT_THEME.acceleration.toLowerCase() === '#15529e');
    check('受力仍是红色', DEFAULT_THEME.force.toLowerCase() === '#b3382f');

    const tpl = read('template/animation-template.html');
    for (const [name, hex] of [
      ['速度', DEFAULT_THEME.velocity],
      ['加速度', DEFAULT_THEME.acceleration],
      ['受力', DEFAULT_THEME.force],
    ]) {
      check(`模板里 ${name} 的色值与主题一致（${hex}）`, tpl.toLowerCase().includes(hex.toLowerCase()));
    }

    check('★ 图例在**画布外**（DOM 上排在 canvas 之后）', tpl.indexOf('data-od-id="stage-canvas"') < tpl.indexOf('data-od-id="vector-legend"'));
    check('图例说明了"长度 = 大小"', tpl.includes('箭头越长'));
    check('图例说明了"不写数值"', tpl.includes('画面不写数值'));
    check('三个开关本身也带了色块（开关行即图例）', (tpl.match(/class="vsw"/g) ?? []).length >= 6);
  }

  /* ══ F 箭头：颜色由 category 决定；长度按类归一；极小画点 ══ */
  console.log('\n『F』箭头：颜色由类别决定，长度按类归一，极小画点');

  {
    const src = read('sdk/runtime/animation-runtime.mjs');
    check('★ 箭头颜色取 `VECTOR_COLORS[category]`', src.includes('VECTOR_COLORS[rec.category] ?? rec.color'));
    check('★ 旧棕色 #a4610d 已经从运行时里消失（那是写死颜色的残党）', !src.includes('#a4610d'));
    check('箭头线宽加粗到 2.2（细线看不清）', src.includes('ctx.lineWidth = 2.2;'));
    // 第 8 期：不再"放大到可见长度"（那会让长度不再等于量级），改为短于阈值画点
    check('★ 短于阈值改为**画一个点**（不再放大）', Number.isFinite(ARROW_MIN_PX) && ARROW_MIN_PX > 0 && src.includes('lenPx >= ARROW_MIN_PX'));
    check('★ 旧的"放大到可见长度"分支已经删掉', !src.includes('if (len < MIN_ARROW_PX)'));

    const cats = ['velocity', 'acceleration', 'force', 'aux'];
    check('四个类别都有颜色（aux 也是真在用的）', cats.every((c) => typeof VECTOR_COLORS[c] === 'string' && VECTOR_COLORS[c].startsWith('#')));
    check('velocity 绿 / acceleration 蓝 / force 红', VECTOR_COLORS.velocity === '#2e7d32' && VECTOR_COLORS.acceleration === '#15529e' && VECTOR_COLORS.force === '#b3382f');

    /**
     * ★ 矢量颜色不许与**图表墨色**撞车。
     *
     * 为什么专门一条：门禁 ㉚ 靠"某个颜色 + lineTo"来判定"曲线图有没有画错画布"。
     * 把加速度设成图表线色（`#1f6fb2`）之后，画布上的加速度箭头就被 ㉚ 当成了"曲线泄漏"，
     * 于是**门禁红了、而代码其实是对的**。这类"判据靠颜色分辨"的脆弱点要显式钉住，
     * 否则下次换配色还会再踩一次，而两次的表象完全不同。
     */
    const tplForInk = read('template/animation-template.html');
    const inkMatch = /curve:\s*'(#[0-9a-fA-F]{6})'/.exec(tplForInk);
    check('模板里能读出图表墨色', Boolean(inkMatch));
    if (inkMatch) {
      const ink = inkMatch[1].toLowerCase();
      const clash = Object.entries(VECTOR_COLORS).filter(([, v]) => String(v).toLowerCase() === ink);
      check('★ 矢量颜色与图表墨色不撞车（撞了会让 ㉚ 误报）', clash.length === 0, `撞色：${clash.map(([k]) => k).join(', ')} vs ${ink}`);
    }

    const tpl = read('template/animation-template.html');
    check('★ 图例也覆盖了"辅助（分量/位移）"这一类', tpl.includes('辅助（分量/位移）'));
    // 第 8 期改成"按类各自比较"，图例必须跟着改口径，否则说明与实现不符
    check('★ 图例写明"每一类各自比较"', tpl.includes('每一类各自比较'));
    check('★ 图例写明"某一刻极小 ⇒ 画成一个点"（不再假装放大）', tpl.includes('画成一个点'));
    check('图例不再声称"过短的会放大"（那是被否掉的旧口径）', !tpl.includes('过短的会放大到可见长度'));
    for (const [name, hex] of Object.entries(VECTOR_COLORS)) {
      if (name === 'aux') continue;
      check(`图例色块与主题一致：${name} ${hex}`, tpl.toLowerCase().includes(String(hex).toLowerCase()));
    }
  }

  /* ══ E 退化不崩：没有字可画时，渲染路径仍然正常 ══ */
  console.log('\n『E』退化：字全不画了，动画本身不能受影响');

  {
    const q01 = questions.find((q) => q.program.id.startsWith('q01'));
    const { frames, paintCalls } = renderQuestion(q01.program);
    check('★ 帧照样画（画笔调用不该因为删字而变 0）', paintCalls > 1000 && frames.length > 0);
    check('每帧都有绘画调用', frames.every((f) => f.paintCalls > 0));
  }

  console.log(`\n${failures.length ? '✗' : '✓'} 方案 A 取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
