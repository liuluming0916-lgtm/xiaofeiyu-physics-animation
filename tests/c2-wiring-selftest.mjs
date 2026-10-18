#!/usr/bin/env node
/**
 * C2 接线与字体取证（第 8 期 · 系统级"线真的接上了吗"）
 *
 * 为什么单独一门：C2（标注避让）和字体这两件事**都能"看起来做完了"**，
 * 而实际上一点没生效 —— 因为它们都是"把一样东西从一端送到另一端"：
 *
 *   字体：CSS 变量 → 模板 → 画布 `ctx.font`
 *   避让：报告 → 事件 → 宿主 → `PROGRAM_DATA` → 播放器 → `replayToCanvas`
 *
 * 任何一环断了，**都不会报错**：字还是字、画还是画，只是没让位、字体没变。
 * 所以这里逐环钉住，尤其是三处**曾经真的断过**的地方：
 *
 *   ① `applyLabelAvoid` 一度写在 `core/dryrun/` 里 ⇒ 模板内联后拿到 `undefined`；
 *   ② 引线一度写成数组 `[x,y]` ⇒ 渲染器读 `.x` 得到 `NaN`，线画不出来；
 *   ③ 画布字体一度是 `ui-monospace` ⇒ 汉字与数字都没换。
 *
 * 用法：node tests/c2-wiring-selftest.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT, isCliEntry } from '../tools/paths.mjs';
import { buildQuestionHtml, toClassicBrowserModule } from '../template/build-template.mjs';
import { LABEL_FONT_FAMILY } from '../sdk/runtime/animation-runtime.mjs';
import { applyLabelAvoid, deriveLabelKeys } from '../sdk/runtime/label-avoid.mjs';

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

/** 一份最小的"表"：一条注挪 (0.1, 0.2)，带引线 */
const TABLE = {
  format: 'od-label-avoid',
  version: 1,
  labels: [{ key: 'text|u|#0', moved: true, leader: true, offset: { dx: 0.1, dy: 0.2 } }],
};

async function main() {
  console.log('C2 接线与字体取证（第 8 期）\n');

  /* ══ A 注入面：模板内联的那份实现里必须有 applyLabelAvoid ══ */
  console.log('『A』注入面：模板能拿到的 `ODLabelAvoid` 里有没有套表函数');

  {
    const sdkSrc = read('sdk/runtime/label-avoid.mjs');
    check('SDK 那份实现导出了 `applyLabelAvoid`', /export\s+function\s+applyLabelAvoid/.test(sdkSrc));
    check('★ 它没有 import（经典脚本内联的前提）', !/^\s*import\s/m.test(sdkSrc));

    const classic = toClassicBrowserModule(sdkSrc, 'ODLabelAvoid');
    check('★ 转换后挂在 window 上', classic.includes('window["ODLabelAvoid"] = {'));
    check('★ 命名空间里含 `applyLabelAvoid`（漏了就是静默失效）', /\bapplyLabelAvoid\b/.test(classic.split('window["ODLabelAvoid"]')[1] ?? ''));
    check('转换后没有残留 export / import', !/^\s*(export|import)\s/m.test(classic));
  }

  /* ══ B 形状：引线必须是 {x,y}，不是数组 ══ */
  console.log('\n『B』形状：引线坐标的写法必须与渲染器的读法一致');

  {
    const runtimeSrc = read('sdk/runtime/animation-runtime.mjs');
    check('★ 渲染器读的是 `rec.leaderTo.x`（所以不能给数组）', runtimeSrc.includes('rec.leaderTo.x'));

    const records = [{ op: 'text', x: 0.5, y: 0.2, text: 'u', size: 20, align: 'center', baseline: 'middle' }];
    const keys = deriveLabelKeys(records);
    check('一条注被识别出来（key 与规划时同一套规则）', keys.length === 1 && keys[0].key === 'text|u|#0');

    const out = applyLabelAvoid(records, TABLE);
    check('套表后挪了 (0.1, 0.2)', Math.abs(out.records[0].x - 0.6) < 1e-9 && Math.abs(out.records[0].y - 0.4) < 1e-9);
    check(
      '★ 引线是 `{x,y}` 且指回原位',
      out.records[0].leaderTo && !Array.isArray(out.records[0].leaderTo) && out.records[0].leaderTo.x === 0.5 && out.records[0].leaderTo.y === 0.2,
    );
    check('表里没有的注原样保留（对象都不换）', applyLabelAvoid([{ op: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }], TABLE).records[0].x1 === 0);
    check('空表/未给表 ⇒ 一条都不挪', applyLabelAvoid(records, null).applied === 0);
  }

  /* ══ C 传递链：模板 → 播放器 → 回放 ══ */
  console.log('\n『C』传递链：从载荷一路到播放器');

  {
    const tpl = read('template/animation-template.html');
    check('★ 模板把表放进 `PROGRAM_DATA.labelAvoid`', tpl.includes('labelAvoid: msg.labelAvoid || null'));
    check('★ 模板创建播放器时把表和套表函数一起传下去', tpl.includes('labelAvoidApply: window.ODLabelAvoid'));
    check('模板有注入位 `/*__OD_LABEL_AVOID__*/`', tpl.includes('/*__OD_LABEL_AVOID__*/'));

    const runtimeSrc = read('sdk/runtime/animation-runtime.mjs');
    check('★ 播放器认这两个选项', runtimeSrc.includes('opts.labelAvoidApply') && runtimeSrc.includes('opts.labelAvoid'));
    check('★ 回放前套表，且**带 try/catch**（避让不许把播放带崩）', /labelAvoidApply\(visible, labelAvoidTable\)/.test(runtimeSrc) && runtimeSrc.includes('painted = visible;'));

    const pipelineSrc = read('core/orchestrator/pipeline.mjs');
    check('★ `dryrun_done` 把表发给宿主', pipelineSrc.includes('labelAvoid: report.labelAvoid ?? null'));

    const storeSrc = read('web/src/state/store.ts');
    check('★ 宿主存下了这张表', storeSrc.includes('programLabelAvoid: e.labelAvoid ?? null'));
    const pageSrc = read('web/src/pages/AnimationPage.tsx');
    check('★ 宿主把它随 load 载荷发给 iframe', pageSrc.includes('labelAvoid: st.programLabelAvoid'));
  }

  /* ══ D 导出页：表要烧进产物 ══ */
  console.log('\n『D』导出页：双击打开也要有让位效果');

  {
    const q01 = (await import(new URL('../tests/regression-15/q01-conveyor-heat.mjs', import.meta.url).href)).default;
    const templateText = read('template/animation-template.html');
    const runtimeText = toClassicBrowserModule(read('sdk/runtime/label-avoid.mjs'), 'ODLabelAvoid');

    const withTable = buildQuestionHtml(q01, templateText, 'var RT={};', 'var TEX={};', 'provenance', {
      texSvg: { renderer: 'test', glyphs: '', formulas: {} },
      labelAvoidText: runtimeText,
      labelAvoid: TABLE,
    });
    check('★ 带表导出：表烧进了载荷', withTable.includes('"labelAvoid":{"format":"od-label-avoid"'));
    check('★ 带表导出：套表实现也进了页面', withTable.includes('window["ODLabelAvoid"]'));

    const withoutTable = buildQuestionHtml(q01, templateText, 'var RT={};', 'var TEX={};', 'provenance', {
      texSvg: { renderer: 'test', glyphs: '', formulas: {} },
      labelAvoidText: runtimeText,
    });
    check('不带表导出：降级为 null（与第 7 期行为一致）', withoutTable.includes('"labelAvoid":null'));
    check('两种情况都没有残留占位符', !/__OD_(RUNTIME|LABEL_AVOID|TEX_RENDERER|PROGRAM)__/.test(withTable));
  }

  /* ══ E 字体：汉字宋体、数字 Times ══ */
  console.log('\n『E』字体：宋体 + Times New Roman（含画布）');

  {
    check('★ 画布字体栈是 Times 在前、SimSun 在后', /^"Times New Roman", "SimSun"/.test(LABEL_FONT_FAMILY));
    check('★ 画布字体名带引号（空格名不加引号会静默失效）', LABEL_FONT_FAMILY.includes('"Times New Roman"') && LABEL_FONT_FAMILY.includes('"SimSun"'));

    const runtimeSrc = read('sdk/runtime/animation-runtime.mjs');
    check('★ 运行时里已经**没有** `ui-monospace` 画标注', !runtimeSrc.includes('ui-monospace'));
    check('画标注用的是那个常量（不是各处各写一份）', (runtimeSrc.match(/\$\{LABEL_FONT_FAMILY\}/g) ?? []).length >= 3);

    const tpl = read('template/animation-template.html');
    check('★ 模板正文用宋体 + Times', /--font-body:\s*'Times New Roman',\s*'SimSun'/.test(tpl));
    check('标题也用同一套', /--font-display:\s*'Times New Roman',\s*'SimSun'/.test(tpl));
    check('★ 控件单独保留黑体（用户选的"更清楚"方案）', /--font-ui:/.test(tpl) && tpl.includes('font-family: var(--font-ui)'));
    check('★ 小字下限 12px（宋体 11px 会发虚）', !/font-size:\s*11(\.5)?px/.test(tpl));

    const css = read('web/src/styles.css');
    check('宿主页正文也是宋体 + Times', css.includes("'Times New Roman', 'SimSun'"));
    check('宿主页控件仍用黑体', /button,\s*\n?\s*input,\s*\n?\s*select,\s*\n?\s*textarea\s*\{/.test(css));
  }

  /* ══════════════ F · VIEW 的写法与诊断归属（第 8 期） ══════════════
   *
   * 用户真题：C1 通过、C2 报"VIEW 槽位必须定义 SIM"，诊断指向 **setup 第 0 行** —— 完全误导。
   * 真因是他写了 `const SIM = { duration: 4.0 };`：它被塞进装配器里那个 IIFE，
   * `const` 只在块内可见 ⇒ 外层 `SIM` 仍是 null。
   *
   * 这一节钉两件事：
   *   ① 四种声明式（const / let / var / 裸赋值）**都要能跑**（归一化，不是放宽判据）；
   *   ② 真写错时，诊断必须**指名 VIEW** 并给出"下一步怎么改"，不能再甩给 setup。
   */
  console.log('\n『F』VIEW 写法归一化 & 写错时的诊断归属');

  {
    const { dryRun } = await import('../core/dryrun/dry-run.mjs');
    const base = {
      PROBLEM: 'p',
      STEPS: 'title: s\ntex: x\nt0: 0\nt1: 2',
      ANSWERS: 'symbol: x\nvalue: 1\nunit: m\nat_t: 2\nstep: 1',
      setup: 'const g = 10;',
      stateAt: 'return { x: t };',
      drawFrame: 'Draw.box([state.x, 0.1], 0.2, 0.2);',
      readouts: "return [{ label: 'x', value: 1, unit: 'm' }];",
    };
    const run = async (VIEW) =>
      (await dryRun({ slots: { ...base, VIEW }, entry: 'view-case', meta: { forceBackend: 'vm-fallback' } })).report;
    const c2diag = (report) => (report.checks.find((c) => c.id === 'C2')?.diagnostics ?? [])[0] ?? null;

    for (const [label, view] of [
      ['const SIM = { duration }（用户写法）', 'const SIM = { duration: 2 };'],
      ['let SIM = { duration }', 'let SIM = { duration: 2 };'],
      ['var SIM = { duration }', 'var SIM = { duration: 2 };'],
      ['裸赋值 SIM = { duration }（标准写法）', 'SIM = { duration: 2 };'],
    ]) {
      const r = await run(view);
      check(`★ ${label} ⇒ 能通过（归一化，不挑写法）`, r.verdict === 'pass', r.verdict);
    }

    {
      const d = c2diag(await run('SIM = { seconds: 2 };'));
      check('写漏 duration ⇒ 诊断指名 **VIEW**（不是 setup）', d?.slot === 'VIEW', String(d?.slot));
      check('规则名可机读：view-missing-duration', d?.rule === 'view-missing-duration', String(d?.rule));
      check('★ 消息里直接给出下一步（裸赋值写法）', /SIM = \{ duration/.test(String(d?.message)));
      check('消息里点名"不要 const SIM"这个坑', /const SIM/.test(String(d?.message)));
    }

    {
      const d = c2diag(await run('   '));
      check('VIEW 为空 ⇒ 诊断也指名 VIEW（不是"第 0 行 setup"）', d?.slot === 'VIEW', String(d?.slot));
    }

    {
      const d = c2diag(await run('const v = { duration: 2 };'));
      check('完全没有 SIM ⇒ 消息说清"必须写 SIM = …"', /VIEW 里没有 SIM/.test(String(d?.message)), String(d?.message).slice(0, 60));
    }
  }

  console.log(`\n${failures.length ? '✗' : '✓'} C2 接线与字体取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
