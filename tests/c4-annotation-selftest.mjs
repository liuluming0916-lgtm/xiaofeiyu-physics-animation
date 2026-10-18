#!/usr/bin/env node
/**
 * C1 白名单与 C4 位移判据的回归取证（第 8 期 · 用户 AEB 真题）。
 *
 * 用户那份程序**完全合法**，却被判了两条红，两条都是我们判据的问题：
 *
 *   ① C1 报「引用未声明的名字 isFinite」——
 *      他的 `if (!isFinite(xm)) xm = 0;` 是正常 JS，Dry-Run 沙箱（`core/dryrun/vm-context.mjs`）
 *      **一直就提供** isFinite / isNaN / parseFloat / parseInt，只是 C1 白名单漏了它们。
 *      顺带：那句"你是否想调用的是 Infinity、BigInt、Date"是编辑距离无边界导致的噪音。
 *
 *   ② C4 报「画面中心位移 1.05 > 阈值 0.88」——
 *      实际只是 `if (L - x1 > 0.1) Draw.dimension(...)` 那条**标注**不再画了。
 *      位移判据用整幅包络 ⇒ 少一条标注就把中心挪了一个世界单位 ⇒ 误判成瞬移。
 *      正确口径：位移只看**实体**（排除 text / latex / dimension 与可出血的阴影参考面）。
 *
 * 这一节同时钉住"不许因此变松"：真的瞬移仍然必须被 C4 抓到。
 *
 * 第 8 期补『C』：**开发模式（不拦截）** —— 校验照做、结论不拦路、放行痕迹必须留在报告与导出里。
 *
 * 用法：node tests/c4-annotation-selftest.mjs
 */

import { isCliEntry } from '../tools/paths.mjs';
import { lintSlot } from '../core/lint/contract-lint.mjs';
import { dryRun } from '../core/dryrun/dry-run.mjs';
import { buildExportPage } from '../core/export/page.mjs';

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

const BASE = {
  PROBLEM: '一件滑块从斜面顶端滑下',
  STEPS: 'title: 第一段\ntex: x\nt0: 0\nt1: 1\ntitle: 第二段\ntex: x\nt0: 1\nt1: 2',
  ANSWERS: 'symbol: x\nvalue: 4\nunit: m\nat_t: 2\nstep: 2',
  VIEW: 'SIM = { duration: 2 };',
  setup: 'const g = 10;',
  readouts: "return [{ label: 'x', value: state.x, unit: 'm' }];",
};

async function main() {
  console.log('C1 白名单 / C4 位移判据取证（第 8 期）\n');

  /* ───── A · C1：标准纯函数必须放行，危险名字必须拦住 ───── */
  console.log('『A』C1 全局白名单：与沙箱同口径');
  {
    const okCode = [
      'const a = isFinite(t) ? t : 0;',
      'const b = isNaN(a) ? 0 : a;',
      'const c = parseFloat("1.5") + parseInt("2", 10);',
      'return { a: a, b: b, c: c };',
    ].join('\n');
    const ok = lintSlot({ code: okCode, slot: 'stateAt', entry: 'pos' });
    check(
      '★ isFinite / isNaN / parseFloat / parseInt 都放行（沙箱本来就提供，白名单不许再漂）',
      (ok.diagnostics ?? []).length === 0,
      JSON.stringify((ok.diagnostics ?? []).slice(0, 2)),
    );

    for (const [label, code] of [
      ['eval', 'eval("1+1");\nreturn {};'],
      ['require', 'const fs = require("fs");\nreturn {};'],
      ['process', 'return { p: process.env };'],
    ]) {
      const r = lintSlot({ code, slot: 'stateAt', entry: 'neg' });
      check(`负对照：${label} 仍被 C1 拦下`, (r.diagnostics ?? []).some((d) => d.rule === 'unknown-global'));
    }

    const typo = lintSlot({ code: 'const a = Matn.sqrt(2);\nreturn { a: a };', slot: 'stateAt', entry: 'typo' });
    const d = (typo.diagnostics ?? []).find((x) => x.rule === 'unknown-global');
    check('拼错 Math ⇒ 建议里能出现 Math（近邻才提）', /Math/.test(String(d?.message ?? '')), String(d?.message ?? ''));

    const far = lintSlot({ code: 'const a = zzqqxx(t);\nreturn { a: a };', slot: 'stateAt', entry: 'far' });
    const dfar = (far.diagnostics ?? []).find((x) => x.rule === 'unknown-global');
    check(
      '★ 差得太远 ⇒ **不给建议**（旧实现会硬凑 Infinity / BigInt / Date 这种噪音）',
      !/你是否想写的是/.test(String(dfar?.message ?? '')),
      String(dfar?.message ?? ''),
    );
  }

  /* ───── B · C4：标注增减不算位移；真瞬移仍要抓 ───── */
  console.log('\n『B』C4 位移：只看实体');
  {
    // 每帧都在动的一辆车 + 一条"距离太短就消失"的标注（用户 AEB 的结构）
    const stateAtLabel = ['const x = 2 * t;', 'return { x: x, d: Math.max(0, 10 - x) };'].join('\n');
    const drawWithLabel = [
      'Draw.ground(-2, 14, 0);',
      'Draw.box([state.x, 0.3], 1, 0.6);',
      'if (state.d > 0.2) {',
      '  Draw.dimension([state.x, 1.6], [10, 1.6], { kind: "linear", text: "d" });',
      '}',
      'Draw.text(0.2, 2.4, "t = " + Phys.format(t, "s"));',
    ].join('\n');
    const r1 = await dryRun({
      slots: { ...BASE, stateAt: stateAtLabel, drawFrame: drawWithLabel },
      entry: 'c4-label',
      meta: { forceBackend: 'vm-fallback' },
    });
    const c4 = r1.report.checks.find((c) => c.id === 'C4');
    check('★ 标注在动画中途消失 ⇒ C4 **不**判位移（只看实体）', c4.status === 'pass', String(c4.detail).slice(0, 120));

    // 真瞬移：位置在 t=1 处跳 5 m
    const teleport = 'const x = t < 1 ? 0 : 5;\nreturn { x: x };';
    const r2 = await dryRun({
      slots: {
        ...BASE,
        ANSWERS: 'symbol: x\nvalue: 5\nunit: m\nat_t: 2\nstep: 2',
        stateAt: teleport,
        drawFrame: 'Draw.ground(-2, 12, 0); Draw.box([state.x, 0.3], 1, 0.6);',
      },
      entry: 'c4-jump',
      meta: { forceBackend: 'vm-fallback' },
    });
    const c4b = r2.report.checks.find((c) => c.id === 'C4');
    check(
      '★ 负对照：实体真的瞬移 5 m ⇒ C4 仍然红（判据没被放松）',
      c4b.status === 'fail',
      `${c4b.status} / ${String(c4b.detail).slice(0, 90)}`,
    );
  }

  /* ───── C · 开发模式（不拦截）：校验照做，结论不拦路，痕迹必须留下 ───── */
  console.log('\n『C』开发模式（不拦截）');
  {
    const broken = {
      ...BASE,
      /**
       * 故意用**沙箱逃逸**让 C1 硬红。
       *
       * ⚠ 第 9 期「判据分级」后，光写一个未声明的名字（笔误）已经**不拦路**了
       *   （`unknown-global` 降为告警，见下面那条新断言）。所以这里必须用一个
       *   真·硬拦的 C1 错误，才能测到"开发模式把硬拦的检查号记进 gatesBypassed"。
       */
      stateAt: 'const fs = require("fs");\nreturn { x: t };',
    };

    const strict = await dryRun({ slots: broken, entry: 'adv-strict', meta: { forceBackend: 'vm-fallback' } });
    check('未开开发模式 ⇒ 仍按硬判据判 fail（默认行为不许变）', strict.report.verdict === 'fail', strict.report.verdict);

    const loose = await dryRun({
      slots: broken,
      entry: 'adv-loose',
      meta: { forceBackend: 'vm-fallback', advisory: true },
    });
    const lr = loose.report;
    const c1 = lr.checks.find((c) => c.id === 'C1');
    check('开开发模式 ⇒ verdict 降为 pass-with-warnings（不拦路）', lr.verdict === 'pass-with-warnings', lr.verdict);
    check('★ 但 C1 **仍然报 fail**（校验照做，不是关掉）', c1.status === 'fail', c1.status);
    check('★ 放行的检查号被记下来（gatesBypassed 非空）', Array.isArray(lr.gatesBypassed) && lr.gatesBypassed.includes('C1'), JSON.stringify(lr.gatesBypassed));
    check('报告里留 advisory 标记', lr.advisory === true, String(lr.advisory));

    /**
     * ── 第 9 期「判据分级」：两条都钉住（降级不放松、也不误伤）──
     *
     * ① 孤立的 `unknown-global`（一个**没被调用到**的函数里拼错名字）⇒ C1 仍报 fail，
     *    但 `blocking` 为假、verdict 不再是 fail，且 **C3–C9 必须照常执行**。
     * ② 同一个拼错**被执行到** ⇒ 运行期抛 ReferenceError ⇒ C2 硬拦 ⇒ verdict 仍是 fail。
     * 这两条一起才说明"降的是拦路方式，不是检查本身"。
     */
    const typoSlots = {
      ...BASE,
      drawFrame: 'Draw.box([state.x, 0.1], 0.2, 0.2);',
      stateAt: 'function unusedHelper() { return Matn.PI; }\nreturn { x: t };',
    };
    const typo = await dryRun({ slots: typoSlots, entry: 'grade-unused-typo', meta: { forceBackend: 'vm-fallback' } });
    const c1t = typo.report.checks.find((c) => c.id === 'C1');
    check(
      '★ 灰区不误伤：未被执行到的名字笔误 ⇒ C1 报 fail 但 blocking 为假（降告警）',
      c1t.status === 'fail' && c1t.blocking === false,
      `${c1t.status}/${c1t.blocking}`,
    );
    check(
      '★ 灰区不误伤：此时 C3–C9 **照常执行**（不再一票否决成"未执行"）',
      typo.report.checks.filter((c) => c.id !== 'C1' && c.skipped).length === 0,
      typo.report.checks.filter((c) => c.skipped).map((c) => c.id).join(','),
    );
    const executed = await dryRun({
      slots: { ...typoSlots, stateAt: 'const a = Matn.PI;\nreturn { x: t };' },
      entry: 'grade-executed-typo',
      meta: { forceBackend: 'vm-fallback' },
    });
    const c2x = executed.report.checks.find((c) => c.id === 'C2');
    check(
      '★ 降级不放松：同一个笔误**被执行到** ⇒ C2 硬拦、verdict 仍是 fail',
      executed.report.verdict === 'fail' && c2x.status === 'fail' && c2x.blocking === true,
      `${executed.report.verdict} / C2 ${c2x.status}/${c2x.blocking}`,
    );

    // 导出：放行痕迹必须烧进 Provenance（离开本机就没人知道它没验过）
    const page = await buildExportPage({
      // ⚠ 8 个槽位缺一不可（BASE 里没有 drawFrame，这里补上；缺槽位会 ok:false）
      slots: { ...BASE, stateAt: 'return { x: t };', drawFrame: 'Draw.box([state.x, 0.1], 0.2, 0.2);' },
      id: 'adv-export',
      advisory: true,
      gatesBypassed: ['C1', 'C4'],
      model: 'test',
    });
    const html = page.html ?? '';
    check('导出页 Provenance 写明“开发模式放行”', /开发模式放行/.test(html));
    check('导出页 Provenance 列出被放行的检查号', /C1\/C4/.test(html));
  }

  console.log(`\n${failures.length ? '✗' : '✓'} C1/C4 回归取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
