/**
 * C1 判据的负向自测（第 1 期能覆盖的部分）。
 *
 * 第 2 期的验收要求是"故意注入 NaN / 瞬移 / 时间断裂 / 死循环 / require，全部被准确拦下"——
 * 那属 C2–C6。本期先对 **C1 的静态判据**做等价的自测：每条规则各给一个正例与一个反例。
 * 用第 1 期的自写 tokenizer 后端跑（acorn 落地后本自测同样适用）。
 */

import { lintSlot } from '../core/lint/contract-lint.mjs';
import { parseAnswersSlot } from '../sdk/runtime/animation-runtime.mjs';

const cases = [
  // [说明, 槽位, 代码, 期望是否通过]
  ['正常代码', 'stateAt', 'var s = t * 2;\nreturn { x: s };', true],
  ['require 逃逸', 'stateAt', "var fs = require('fs');\nreturn { x: 1 };", false],
  ['import 语句', 'stateAt', "import fs from 'fs';\nreturn { x: 1 };", false],
  ['eval', 'stateAt', 'var r = eval("1+1");\nreturn { x: r };', false],
  ['Function 构造器', 'stateAt', 'var f = Function("return 1");\nreturn { x: f() };', false],
  ['原型链逃逸 constructor', 'stateAt', 'var c = x.constructor;\nreturn { x: 1 };', false],
  ['原型链逃逸 __proto__', 'stateAt', 'var p = obj.__proto__;\nreturn { x: 1 };', false],
  ['原型链逃逸 prototype', 'stateAt', 'var p = fn.prototype;\nreturn { x: 1 };', false],
  ['while(true) 无上界循环', 'stateAt', 'while (true) { i = i + 1; }\nreturn { x: 1 };', false],
  ['for(;;) 无上界循环', 'stateAt', 'for (;;) { i = i + 1; }\nreturn { x: 1 };', false],
  ['无上界递归', 'stateAt', 'function f(n) { return f(n + 1); }\nreturn { x: f(0) };', false],
  ['stateAt 内 Phys.integrate（成员调用）', 'stateAt', 'var s = Phys.integrate(a, b, 0, 1);\nreturn { x: s };', false],
  ['stateAt 内裸 integrate', 'stateAt', 'var s = integrate(a, b, 0, 1);\nreturn { x: s };', false],
  ['setup 内 Phys.integrate（合法）', 'setup', 'var a = 0, b = { v: 0 };\nvar s = Phys.integrate(b, function () { return { v: 1 }; }, a, 1);\nRETURN("table", s);', true],
  ['未声明的全局', 'stateAt', 'var s = fooBar(t);\nreturn { x: s };', false],
  ['跨槽位未走 context', 'stateAt', 'return { x: tStar * 2 };', false],
  ['跨槽位走 context（合法）', 'stateAt', 'return { x: context.tStar * 2 };', true],
  ['括号不配平', 'stateAt', 'var s = (t * 2;\nreturn { x: s };', false],
  ['槽位过长（单槽位 400 行上限：410 行应拒）', 'stateAt', Array.from({ length: 410 }, () => 'var a = 1;').join('\n'), false],
  /** 第 8 期用户裁决：stateAt+drawFrame ≤150 取消 ⇒ 160 行**必须放行**（这条是防回退的守门员） */
  ['160 行不再算超长（150 行上限已取消）', 'stateAt', Array.from({ length: 160 }, () => 'var a = 1;').join('\n'), true],
  ['正常工具函数组合', 'drawFrame', 'function seg(from, to) {\n  Draw.line(from, to);\n}\nseg([0, 0], [1, 1]);', true],
  ['window 引用', 'drawFrame', 'window.alert(1);', false],
  ['document 引用', 'drawFrame', 'document.title = "x";', false],
  ['网络请求', 'drawFrame', 'fetch("https://example.com");', false],
  // 下面两条专门取证 acorn 后端的新能力：**中段语法错误也能给出行列号**
  // （自写 tokenizer 只能报"括号未配平"这类结构问题，报不出具体位置）
  ['中段语法错误（漏右括号）', 'stateAt', 'var y = 1;\nvar z = Math.min(x, y;\nreturn { x: z };', false],
  ['中段语法错误（多余右括号）', 'drawFrame', 'Draw.line([0, 0], [1, 1]);\n);\nDraw.line([0, 0], [2, 2]);', false],
];

let failed = 0;
console.log('lint-selftest · C1 静态判据逐条取证');
for (const [label, slot, code, expectPass] of cases) {
  // 第 8 期：`stateAt + drawFrame ≤ 150 行` 已取消 ⇒ 所有槽位统一按"单槽位 400 行"
  const r = lintSlot({ code, slot, entry: 'selftest' });
  const ok = r.ok === expectPass;
  if (!ok) failed += 1;
  const first = r.diagnostics[0];
  console.log(
    `  ${ok ? '✓' : '✗'} ${label.padEnd(34, '　')} 期望${expectPass ? '通过' : '拒绝'} → 实际${r.ok ? '通过' : '拒绝'}` +
      (r.ok ? '' : `（${first?.rule} @ ${first?.line}:${first?.column}）`),
  );
}

console.log(failed ? `\n✗ ${failed}/${cases.length} 条判据取证失败` : `\n✓ ${cases.length} 条 C1 判据全部取证通过（每条含正例或反例）`);

/* ── 数据型槽位结构取证（§3.3 / §3.5 的结构性要求） ── */
const answerCases = [
  ['ANSWERS 正常（含数值结论）', 'symbol: v\nvalue: 2.4\nunit: m/s\ntol: 0.01\nat_t: 1.8\nstep: 3', true],
  ['ANSWERS 纯符号且给了 latex', 'symbol: E0\nvalue: null\nunit: V\ntol: null\nat_t: 0\nstep: 1\nlatex: BLv_0', true],
  ['ANSWERS 纯符号但缺 latex（§3.3 要求必填）', 'symbol: E0\nvalue: null\nunit: V\nat_t: 0\nstep: 1', false],
  ['ANSWERS 缺 at_t（C7 无法定位）', 'symbol: v\nvalue: 2.4\nunit: m/s\nstep: 1', false],
  ['ANSWERS 缺 symbol', 'value: 2.4\nunit: m/s\nat_t: 1\nstep: 1', false],
  ['ANSWERS 值不是数值', 'symbol: v\nvalue: abc\nunit: m/s\nat_t: 1\nstep: 1', false],
];

let answerFailed = 0;
console.log('\nlint-selftest · ANSWERS 结构取证（§3.3）');
for (const [label, text, expectOk] of answerCases) {
  let ok = true;
  let message = '';
  try {
    parseAnswersSlot(text);
  } catch (err) {
    ok = false;
    message = err.message;
  }
  const good = ok === expectOk;
  if (!good) answerFailed += 1;
  console.log(
    `  ${good ? '✓' : '✗'} ${label.padEnd(38, '　')} 期望${expectOk ? '接受' : '拒绝'} → 实际${ok ? '接受' : '拒绝'}${ok ? '' : `（${message.slice(0, 60)}）`}`,
  );
}

const totalFailed = failed + answerFailed;
if (totalFailed) process.exitCode = 1;
console.log(
  totalFailed
    ? `\n✗ 共 ${totalFailed} 条取证失败`
    : `\n✓ 全部取证通过：C1 判据 ${cases.length} 条 + ANSWERS 结构 ${answerCases.length} 条`,
);
