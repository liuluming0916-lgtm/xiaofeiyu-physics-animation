#!/usr/bin/env node
/**
 * `Draw.arrow` 参数口径取证（第 8 期 · C1 判据 8 · 用户 2026-10-17 拍板）
 *
 * 三条规矩：
 *   · **`mag` 必填** —— 它是"同类可比"的唯一数据来源；
 *   · **`scale` 禁用** —— 长度已由 `mag` 归一决定；
 *   · **`color` 禁用** —— 颜色由 `category` 唯一决定。
 *
 * 为什么必须放在**门禁**里，而不是只靠渲染器：
 *   渲染器对 color/scale 已经是"不理"了，但那是**沉默失败**——
 *   画面照样对、报告照样绿、代码里留着一行看着有用其实没用的东西。
 *   用户管这个叫"屎山"。所以规矩要落在**每道题都要过的闸**上。
 *
 * 为什么 `mag` 缺失尤其危险：渲染器会退回 `|vec|`，而 `|vec|` 里可能被作者乘过系数
 * （q05 曾经是 0.55 与 0.16）⇒ 同类箭头**看起来**按比例、其实比例是假的，
 * 而且肉眼完全看不出来。
 *
 * 用法：node tests/arrow-contract-selftest.mjs
 */

import { PROJECT_ROOT, isCliEntry } from '../tools/paths.mjs';
import { lintSlot } from '../core/lint/contract-lint.mjs';

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

/** 把一段代码丢进 C1，返回诊断里的 rule 列表 */
function rulesOf(code) {
  const r = lintSlot({ code, slot: 'drawFrame', entry: '(selftest)' });
  return r.diagnostics.map((x) => x.rule);
}

function diagOf(code, rule) {
  const r = lintSlot({ code, slot: 'drawFrame', entry: '(selftest)' });
  return r.diagnostics.find((x) => x.rule === rule) ?? null;
}

async function main() {
  console.log('Draw.arrow 参数口径取证（C1 判据 8）\n');

  console.log('『A』三条规矩各自生效');
  {
    check('缺 mag ⇒ arrow-missing-mag', rulesOf("Draw.arrow([0,0],[1,0],{category:'velocity'});").includes('arrow-missing-mag'));
    check('给了 scale ⇒ arrow-deprecated-scale', rulesOf("Draw.arrow([0,0],[1,0],{category:'velocity',mag:state.v,scale:0.3});").includes('arrow-deprecated-scale'));
    check('给了 color ⇒ arrow-forbidden-color', rulesOf("Draw.arrow([0,0],[1,0],{category:'velocity',mag:state.v,color:'#a4610d'});").includes('arrow-forbidden-color'));
    check('第三个参数不是对象字面量 ⇒ arrow-options-not-literal', rulesOf("var o={category:'velocity'};Draw.arrow([0,0],[1,0],o);").includes('arrow-options-not-literal'));
  }

  console.log('\n『B』负对照：合规写法**一条诊断都不该有**');
  {
    check('★ 合规箭头（category + mag + unit）零诊断', rulesOf("Draw.arrow([0,0],[1,0],{category:'force',mag:state.f,unit:'N'});").length === 0);
    check('★ `Draw.line` 带 color/scale 不受这条规则影响（规则只管 arrow）', !rulesOf("Draw.line([0,0],[1,0],{color:'#000',scale:0.3});").some((r) => r.startsWith('arrow-')));
    check('`label` / `latex` / `subtype` / `labelInset` 都仍然合法', rulesOf("Draw.arrow([0,0],[1,0],{category:'force',subtype:'gravity',label:'mg',latex:'mg',labelInset:-13,mag:10});").length === 0);
    check('`mag` 写成常数也允许（例如静摩擦恒为 1 N）', rulesOf("Draw.arrow([0,0],[-1,0],{category:'force',mag:1});").length === 0);
  }

  console.log('\n『C』报出来的诊断要**能定位、能照做**');
  {
    const d = diagOf("Draw.arrow([0,0],[1,0],{category:'velocity'});", 'arrow-missing-mag');
    check('诊断带行号（模型能据此改）', d && Number.isInteger(d.line) && d.line >= 1, JSON.stringify(d && { line: d.line, column: d.column }));
    check('诊断信息里写明"必须给 mag"', Boolean(d && /mag/.test(d.message)));
    check('诊断信息解释了后果（同类不可比）', Boolean(d && /不可比|可比/.test(d.message)));

    const s = diagOf("Draw.arrow([0,0],[1,0],{category:'velocity',mag:state.v,scale:1});", 'arrow-deprecated-scale');
    check('scale 的诊断说明"已被忽略"', Boolean(s && /忽略/.test(s.message)));

    const c = diagOf("Draw.arrow([0,0],[1,0],{category:'velocity',mag:state.v,color:'#123456'});", 'arrow-forbidden-color');
    check('color 的诊断指出颜色由 category 决定', Boolean(c && /category/.test(c.message)));
  }

  console.log('\n『D』v1.1.9：v/a 不再允许手写（交给 SIM.bodies 求导）');
  {
    check('velocity 字面量 ⇒ arrow-kinematic-forbidden', rulesOf("Draw.arrow([0,0],[1,0],{category:'velocity',mag:1});").includes('arrow-kinematic-forbidden'));
    check('acceleration 字面量 ⇒ arrow-kinematic-forbidden', rulesOf("Draw.arrow([0,0],[1,0],{category:'acceleration',mag:1});").includes('arrow-kinematic-forbidden'));
    check('★ aux 不受影响（传送带速度/电流/分量仍然合法）', rulesOf("Draw.arrow([0,0],[1,0],{category:'aux',mag:1});").length === 0);
    check('★ force 不受影响', rulesOf("Draw.arrow([0,0],[1,0],{category:'force',mag:1});").length === 0);
    check('诊断文案指向 SIM.bodies（模型能照做）', /SIM\.bodies/.test(diagOf("Draw.arrow([0,0],[1,0],{category:'velocity',mag:1});", 'arrow-kinematic-forbidden')?.message ?? ''));
  }

  console.log('\n『E』仓库自身 15 道题必须**全部干净**（否则规则一上线就红一片）');
  {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = `${PROJECT_ROOT}/tests/regression-15`;
    const files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();

    let arrowCalls = 0;
    const offenders = [];
    for (const f of files) {
      const text = readFileSync(`${dir}/${f}`, 'utf8');
      arrowCalls += (text.match(/Draw\.arrow\(/g) ?? []).length;

      /**
       * 真实题目是**模块文件**（导出 8 个槽位字符串），不能整份丢给 `lintSlot`。
       * 这里只取证 drawFrame 槽位：把文件里 `drawFrame: String.raw\`…\`` 的内容抽出来。
       */
      const m = /drawFrame:\s*(?:String\.raw)?`([\s\S]*?)`,\s*\n/.exec(text);
      if (!m) {
        offenders.push(`${f}: 没抽到 drawFrame 槽位`);
        continue;
      }
      const rules = rulesOf(m[1]);
      const bad = rules.filter((r) => r.startsWith('arrow-'));
      if (bad.length) offenders.push(`${f}: ${bad.join(', ')}`);
    }

    console.log(`      检查 ${files.length} 个文件 · ${arrowCalls} 处 Draw.arrow`);
    check('★ 15 道题的 drawFrame 里**没有一处**违反箭头口径', offenders.length === 0, offenders.join(' | '));
    /*
     * v1.1.9：v/a 改由运行时求导绘制，模型手画的箭头只剩 force/aux。
     * 第 8 期是 62 根（含 28 根 v/a）；现在 35 根，**且 v/a 一根不剩**。
     * 这两个断言一起看才守得住口径：数量掉到 35 是因为迁移，不是有人漏画。
     */
    check('模型手画箭头 = 35（force/aux；v/a 已移交运行时）', arrowCalls === 35, String(arrowCalls));
  }

  console.log(`\n${failures.length ? '✗' : '✓'} 箭头参数口径取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
