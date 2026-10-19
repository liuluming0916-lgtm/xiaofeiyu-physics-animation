#!/usr/bin/env node
/**
 * 标记切分清洗取证（第 3 期第 3 步）。
 *
 * 方案把这一步标为"**本期最关键**"，理由是：
 *   切分一旦破坏行号，第 2 期辛苦做出来的**行号级诊断全部变成假话**，
 *   而且**别的门禁一条都发现不了**（判据照样通过，只是诊断指错地方）。
 * 因此本文件的重点是『C』组：行号保真。
 *
 * 用法：node tests/cleaner-selftest.mjs
 */

import { splitSlots, formatSplitDiagnostics } from '../core/cleaner/marker-split.mjs';
import {
  buildProgramFromText,
  checkProgramShape,
  buildLineOffsets,
  toSourceLine,
  ProgramBuildError,
} from '../core/cleaner/to-program.mjs';
import {
  applyRegexRules,
  detectCatastrophicPattern,
  assertNoMarkerPatches,
  BUILTIN_RULES,
  listBuiltinRules,
} from '../core/cleaner/regex-rules.mjs';
import { SLOT_KEY_NAMES } from '../contracts/spec/frozen-keys.mjs';

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

/** 断言切分被拒且命中某规则号 */
function expectRejected(name, result, code) {
  const codes = result.diagnostics.map((d) => d.code);
  check(`${name} → 命中 ${code}`, !result.ok && codes.includes(code), `实际：${codes.join(', ') || '（未报错）'}`);
}

/* ────────────────────────────── 构造样例 ────────────────────────────── */

/**
 * 生成一份"模型输出"：8 个槽位，每个槽位正文的首行带一个**已知行内容**，
 * 便于后面检查行号有没有跑偏。
 */
function makeModelOutput({ slots = {}, preamble = [], sep = [] } = {}) {
  const defaults = {
    PROBLEM: '题干：一带电粒子以 v0 进入匀强磁场。',
    STEPS: 'title: 第 1 步\ntex: v=\\frac{F}{Bq}\nt0: 0\nt1: 1',
    ANSWERS: 'symbol: r\nvalue: 0.1\nunit: m\ntol: 0.01\nat_t: 1\nstep: 1',
    VIEW: 'SIM.duration = 1;',
    setup: 'const B = 1;',
    stateAt: 'return { x: t };',
    drawFrame: 'Draw.dot(0, 0);',
    readouts: 'return [{ label: "r", value: 0.1, unit: "m" }];',
  };
  const body = { ...defaults, ...slots };
  const lines = [...preamble];
  for (const key of SLOT_KEY_NAMES) {
    lines.push(`/* @slot:${key} */`);
    lines.push(...String(body[key]).split('\n'));
    lines.push('/* @end */');
    lines.push(...sep);
  }
  return lines.join('\n');
}

/* ────────────────────────────── 『A』正例 ────────────────────────────── */

console.log('标记切分清洗取证（第 3 期第 3 步）\n');

console.log('『A』正例：结构完整的模型输出');
{
  const text = makeModelOutput();
  const r = splitSlots(text);
  check('切分成功（ok=true）', r.ok, formatSplitDiagnostics(r.diagnostics));
  check('8 个槽位全部产出', SLOT_KEY_NAMES.every((k) => typeof r.slots[k] === 'string'));
  check('槽位顺序与冻结键序一致', r.order.join(',') === SLOT_KEY_NAMES.join(','), r.order.join(','));
  check('无散落文本', r.strayLines.length === 0, `实际 ${r.strayLines.join(',')}`);
}

console.log('\n『A-2』程序形状（§3.6）');
{
  const { program, lineMap, layout } = buildProgramFromText(makeModelOutput());
  check('program.format 正确', program.format === 'od-animation-program');
  check('program.version = 1', program.version === 1);
  check('slots 恰好 8 个键', Object.keys(program.slots).length === 8);
  check('键序与冻结键序一致', Object.keys(program.slots).join(',') === SLOT_KEY_NAMES.join(','));
  check('shape 自检通过', checkProgramShape(program).ok);
  check('给出了行偏移表', typeof lineMap.stateAt === 'number', JSON.stringify(lineMap));
  check('layout 记录了 appliedRules', Array.isArray(layout.appliedRules));
}

/* ────────────────────────────── 『B』反例：四种硬失败 ────────────────────────────── */

console.log('\n『B』反例：缺标记 / 重复 / 未知 / 未闭合 —— **必须区分开**');
{
  const missing = makeModelOutput().replace(/\/\* @slot:VIEW \*\/[\s\S]*?\/\* @end \*\/\n?/, '');
  expectRejected('缺一个槽位标记', splitSlots(missing), 'marker.missing');
}
{
  const text = `${makeModelOutput()}\n/* @slot:setup */\nconst x = 2;\n/* @end */`;
  expectRejected('同一键出现两次', splitSlots(text), 'marker.duplicate');
}
{
  const text = makeModelOutput().replace('/* @slot:VIEW */', '/* @slot:scene_spec */');
  const r = splitSlots(text);
  expectRejected('v2 旧名 scene_spec（不归一化）', r, 'marker.unknown');
  check('并给出"旧名"提示', r.diagnostics.some((d) => d.code === 'marker.unknown' && d.hint));
}
{
  const text = makeModelOutput().replace('/* @end */\n/* @slot:setup */', '/* @slot:setup */');
  expectRejected('标记未闭合（无 @end）', splitSlots(text), 'marker.unclosed');
}
{
  const text = makeModelOutput().replace(/\/\* @slot:VIEW \*\/\nSIM\.duration = 1;\n\/\* @end \*\//, '/* @slot:VIEW */\n\n/* @end */');
  expectRejected('槽位正文为空（§3.2 审计 2：不得静默通过）', splitSlots(text), 'slot.empty');
}
{
  const text = makeModelOutput().replace('/* @slot:VIEW */', '/* @end */\n/* @slot:VIEW */');
  expectRejected('没有对应 @slot 的孤立 @end', splitSlots(text), 'marker.stray-end');
}

console.log('\n『B-2』散落文本只告警、不硬失败');
{
  const text = makeModelOutput({ preamble: ['下面是这道题的动画代码：', ''] });
  const r = splitSlots(text);
  check('标记外有散落文本时仍判成功', r.ok, formatSplitDiagnostics(r.diagnostics));
  check('但给出 text.outside-markers 告警', r.diagnostics.some((d) => d.code === 'text.outside-markers'));
}

console.log('\n『B-3』标记之外的假标记不会被误识别（§21.2 第 4 条：不用正则做结构切割）');
{
  // 槽位正文里出现"长得像标记"的字符串字面量 ⇒ 必须当普通内容，不当标记
  const text = `/* @slot:PROBLEM */
题干里有一句话："写法是 /* @slot:setup */ 这样"
/* @end */
/* @slot:STEPS */
title: s
/* @end */
/* @slot:ANSWERS */
symbol: a
/* @end */
/* @slot:VIEW */
SIM.duration = 1;
/* @end */
/* @slot:setup */
const s = "/* @slot:drawFrame */"; // 字符串里的假标记
/* @end */
/* @slot:stateAt */
return {};
/* @end */
/* @slot:drawFrame */
Draw.dot(0,0);
/* @end */
/* @slot:readouts */
return [];
/* @end */`;
  const r = splitSlots(text);
  check('字符串里的假标记不制造"重复标记"', r.ok, formatSplitDiagnostics(r.diagnostics));
  check('假标记原样留在正文里', r.slots.setup.includes('@slot:drawFrame'));
  check('真实的 8 个槽位都切出来了', SLOT_KEY_NAMES.every((k) => r.slots[k] !== undefined));
}

/* ────────────────────────────── 『C』行号保真（本文件的核心） ────────────────────────────── */

console.log('\n『C』行号保真 —— 切分不许挪动行号');
{
  const text = makeModelOutput();
  const outLines = text.split('\n');
  const r = splitSlots(text);

  // 对每个槽位：正文里第 1 行（非空）应当**逐字**出现在模型输出的 firstLine 行
  let allMatch = true;
  const detail = [];
  for (const key of SLOT_KEY_NAMES) {
    const slotLines = r.slots[key].split('\n');
    const idx = slotLines.findIndex((l) => l.trim() !== '');
    const inSlot = idx + 1;
    const reported = r.firstLine[key];
    const actualInOutput = outLines[reported - 1];
    const matches = actualInOutput === slotLines[idx];
    if (!matches) {
      allMatch = false;
      detail.push(`${key}: 槽位内第 ${inSlot} 行=${JSON.stringify(slotLines[idx])} 但输出第 ${reported} 行=${JSON.stringify(actualInOutput)}`);
    }
  }
  check('每个槽位的"首个非空行"行号都指向输出里的同一行', allMatch, detail.join(' | '));

  // 关键不变式：**槽位内第 (firstLine) 行** == 输出第 firstLine 行。
  //   `firstLine` 是"首个非空行的**绝对**行号"，因此槽位正文里它在 `firstLine-1` 下标处
  //   （槽位正文前面有 `firstLine-1` 个空行占位）。
  //   ⚠ 不能用 `slotLines[0]` 去对 `firstLine` —— 正文里被保留的空行也在数组里，
  //     两者差一个 `from`（被吃掉的首部空行数）。这正是本用例要钉住的地方。
  let offsetOk = true;
  for (const key of SLOT_KEY_NAMES) {
    const slotLines = r.slots[key].split('\n');
    const first = r.firstLine[key];
    for (let n = first; n <= slotLines.length; n += 1) {
      const outLine = outLines[n - 1];
      if ((outLine ?? '') !== slotLines[n - 1]) {
        offsetOk = false;
        detail.push(`${key} 槽位第 ${n} 行=${JSON.stringify(slotLines[n - 1])} vs 输出第 ${n} 行=${JSON.stringify(outLine)}`);
        break;
      }
    }
  }
  check('槽位正文的行与输出同号行逐字一致（含被保留的空行）', offsetOk, detail.slice(0, 3).join(' | '));

  // 换一个角度再钉一次：槽位长度 + 起始行号必须与原文的行区间吻合
  let spanOk = true;
  for (const key of SLOT_KEY_NAMES) {
    const slotLines = r.slots[key].split('\n');
    const first = r.firstLine[key];
    if (first - 1 !== slotLines.findIndex((l) => l.trim() !== '')) {
      spanOk = false;
      detail.push(`${key}: firstLine-1=${first - 1} ≠ 首个非空行下标`);
    }
  }
  check('不变式 firstLine−1 == 首个非空行的下标', spanOk, detail.slice(0, 3).join(' | '));
}

console.log('\n『C-2』行偏移表能反查回模型输出的真实行号');
{
  const text = makeModelOutput({ preamble: ['这是一段前置说明。', '还有第二行。', ''] });
  const { lineMap } = buildProgramFromText(text);
  const outLines = text.split('\n');

  // 在 stateAt 槽位里"人为植入一个错误"，看诊断能不能指到正确行
  const stateAtStart = outLines.findIndex((l) => l === '/* @slot:stateAt */') + 1; // 1 基 → 正文从 +1 行开始
  const bodyFirstLineNo = stateAtStart + 1;
  const expected = outLines[bodyFirstLineNo - 1];

  const recovered = toSourceLine(lineMap, 'stateAt', 1);
  check(
    `stateAt 的 lineOffset 把槽位内第 1 行还原到输出第 ${bodyFirstLineNo} 行`,
    recovered === bodyFirstLineNo,
    `实际 ${recovered}`,
  );
  check('还原出来的行内容正确', outLines[recovered - 1] === expected, JSON.stringify(outLines[recovered - 1]));
  check('前置文本把偏移整体推后了（确实不是从第 1 行开始）', bodyFirstLineNo > 1);
}

console.log('\n『C-3』槽位正文首尾空行被吃掉时，行号仍然正确');
{
  const text = [
    '/* @slot:PROBLEM */',
    '',
    '',
    '题干第二行才是内容。',
    '/* @end */',
    ...SLOT_KEY_NAMES.slice(1).flatMap((k) => [`/* @slot:${k} */`, 'x', '/* @end */']),
  ].join('\n');
  const r = splitSlots(text);
  const outLines = text.split('\n');
  check('首尾空行不被算进正文', r.slots.PROBLEM.trim() === '题干第二行才是内容。');
  check(
    'firstLine 指向真正的首个非空行（第 4 行）',
    r.firstLine.PROBLEM === 4,
    `实际 ${r.firstLine.PROBLEM}`,
  );
  check('该行内容与输出一致', outLines[r.firstLine.PROBLEM - 1] === '题干第二行才是内容。');
}

/* ────────────────────────────── 『D』§12 正则兜底 ────────────────────────────── */

console.log('\n『D』§12 兜底清洗');
{
  const withFence = {
    PROBLEM: '题目',
    STEPS: 'title: s',
    ANSWERS: 'symbol: a',
    VIEW: 'SIM.duration = 1;',
    setup: '```js\nconst B = 1;\n```',
    stateAt: 'console.log(1);\nreturn { x: t };',
    drawFrame: 'Draw.dot(0,0);',
    readouts: 'return [];',
  };
  const { slots, applied } = applyRegexRules(withFence, []);
  check('剥掉了代码围栏', !slots.setup.includes('```'), JSON.stringify(slots.setup));
  check('保留了围栏内的代码', slots.setup.includes('const B = 1;'));
  check('删掉了 console.log 整行', !slots.stateAt.includes('console.log'));
  check('保留了 console.log 之外的代码', slots.stateAt.includes('return { x: t };'));
  check('记录了应用过的规则', applied.length >= 2, JSON.stringify(applied));
}
{
  /**
   * 『E』**剥掉多写的函数外壳**（第 8 期 · 用户真题 export-20261018-115238-713）。
   *
   * 那份产物的四个代码槽位全都写成 `function readouts(t, state) { … }`；
   * 装配器会再包一层同名函数 ⇒ 外层返回 undefined ⇒ 画面空白、readouts 零项，
   * 而 C3/C6/C8 在"零条目"上会空过，只有 C7/C9 报警 —— 用户会完全不知道发生了什么。
   *
   * 这一节钉住：三种常见写法都要被剥成"函数体"，且**只在整槽就是一个函数时**动手。
   */
  const base = { PROBLEM: '题', STEPS: 'title: s', ANSWERS: 'symbol: x', VIEW: 'SIM = { duration: 1 };' };
  const wrap = (setup, stateAt, drawFrame, readouts) => ({ ...base, setup, stateAt, drawFrame, readouts });

  const fn = applyRegexRules(
    wrap(
      'function setup() {\n  const g = 10;\n  RETURN("g", g);\n}',
      'function stateAt(t) {\n  return { x: t };\n}',
      'function drawFrame(t, state) {\n  Draw.box([state.x, 0.1], 0.2, 0.2);\n}',
      "function readouts(t, state) {\n  return [{ label: 'x', value: state.x, unit: 'm' }];\n}",
    ),
  );
  check('① function 写法 ⇒ 剥掉外壳', !fn.slots.readouts.includes('function readouts'), fn.slots.readouts.slice(0, 40));
  check('① 函数体保留（含 return）', fn.slots.readouts.includes('return [{'), fn.slots.readouts);
  check('① 四个槽位都剥了（不是只管一个）',
    !fn.slots.setup.includes('function setup') &&
      !fn.slots.stateAt.includes('function stateAt') &&
      !fn.slots.drawFrame.includes('function drawFrame'));
  check('① 内层缩进去掉了（不会留下 4 空格缩进）', /^return \[/.test(fn.slots.readouts.trim()), JSON.stringify(fn.slots.readouts.slice(0, 20)));
  check('① 溯源里记了这条规则', fn.applied.some((a) => a.id === 'strip-function-wrapper'), JSON.stringify(fn.applied));

  const assign = applyRegexRules(
    wrap('const g = 1;', 'const stateAt = (t) => {\n  return { x: t };\n}', 'Draw.box([0, 0], 1, 1);', 'const readouts = function (t, state) { return []; }'),
  );
  check('② const + 箭头函数 ⇒ 也剥', !assign.slots.stateAt.includes('const stateAt'), assign.slots.stateAt.slice(0, 40));
  check('② const + function 表达式 ⇒ 也剥', !assign.slots.readouts.includes('const readouts'), assign.slots.readouts.slice(0, 40));

  const mixed = applyRegexRules(wrap('const g = 1;\nconst h = 2;', 'return { x: t };', 'function drawFrame(t, state) { Draw.box([0, 0], 1, 1); }\nDraw.line([0,0],[1,1]);', 'return [];'));
  check('③ 函数后面还有别的语句 ⇒ **不动**（不是整个槽位就是一个函数）', mixed.slots.drawFrame.includes('function drawFrame'), mixed.slots.drawFrame.slice(0, 50));
  check('③ 不是函数体（普通代码）⇒ 一个字不动', mixed.slots.setup.includes('const g = 1;') && mixed.slots.setup.includes('const h = 2;'));

  const otherName = applyRegexRules(wrap('const g = 1;', 'function foo(t) { return { x: t }; }', 'Draw.box([0,0],1,1);', 'return [];'));
  check('④ 名字对不上 ⇒ 不剥（宁可不动，也不猜）', otherName.slots.stateAt.includes('function foo'), otherName.slots.stateAt.slice(0, 40));

  const dataSlot = applyRegexRules({ ...base, PROBLEM: 'function PROBLEM() { 题 }', setup: '', stateAt: '', drawFrame: 'x', readouts: 'y' });
  check('⑤ 数据槽位（PROBLEM）不当代码处理', dataSlot.slots.PROBLEM.includes('function PROBLEM'), dataSlot.slots.PROBLEM);
}

{
  // 用户规则：正常正则生效
  const { slots } = applyRegexRules(
    { PROBLEM: 'x', STEPS: 'y', ANSWERS: 'z', VIEW: 'Math.pow(a,2)', setup: '', stateAt: '', drawFrame: '', readouts: '' },
    [{ id: 'pow', name: 'Math.pow 改写', stage: 'scene_code', pattern: 'Math\\.pow\\(([^,]+),\\s*2\\)', flags: 'g', replacement: '($1)*($1)', enabled: true }],
  );
  check('用户正则规则生效', slots.VIEW === '(a)*(a)', slots.VIEW);
}
{
  // 灾难性形态被拒
  const bad = detectCatastrophicPattern('(a+)+');
  check('检测出嵌套量词 (a+)+', bad.safe === false, bad.reason);
  check('检测出 (a|a)*', detectCatastrophicPattern('(a|a)*').safe === false);
  check('检测出 .*.*', detectCatastrophicPattern('.*.*').safe === false);
  check('正常正则放行', detectCatastrophicPattern('Math\\.pow\\(([^,]+),\\s*2\\)').safe === true);

  let code = '';
  try {
    applyRegexRules(
      { PROBLEM: 'a', STEPS: '', ANSWERS: '', VIEW: '', setup: '', stateAt: '', drawFrame: '', readouts: '' },
      [{ id: 'evil', name: 'e', stage: 'scene_code', pattern: '(a+)+', flags: 'g', replacement: '', enabled: true }],
    );
  } catch (e) {
    code = e.code;
  }
  check('应用时拒绝灾难性形态', code === 'rule.catastrophic-pattern', code);
}
{
  // 不许用正则改标记（§3.5 零猜测不可绕过）
  let code = '';
  try {
    assertNoMarkerPatches([{ id: 'patch', pattern: '/\\* @end \\*/', replacement: '/* @end */' }]);
  } catch (e) {
    code = e.code;
  }
  check('试图改动 @slot/@end 的规则被拒', code === 'rule.touches-marker', code);
  check('内置规则清单可枚举', listBuiltinRules().length === BUILTIN_RULES.length);
}
{
  // 输入规模上限
  let code = '';
  try {
    applyRegexRules(
      { PROBLEM: 'x'.repeat(500_000), STEPS: '', ANSWERS: '', VIEW: '', setup: '', stateAt: '', drawFrame: '', readouts: '' },
      [],
    );
  } catch (e) {
    code = e.code;
  }
  check('超长输入被拒（不硬跑）', code === 'clean.input-too-large', code);
}

/* ────────────────────────────── 『E』端到端：模型输出 → AnimationProgram ────────────────────────────── */

console.log('\n『E』端到端：带围栏与解释文字的模型输出');
{
  const text = [
    '好的，这是动画代码：',
    '```javascript',
    ...makeModelOutput().split('\n'),
    '```',
    '希望对你有帮助！',
  ].join('\n');

  let program = null;
  let diag = null;
  try {
    const r = buildProgramFromText(text, { provenance: { model: 'handwritten', promptHash: 'test', knowledgecardHash: 'test', generatedAt: '2026-10-16T00:00:00Z' } });
    program = r.program;
    diag = r.diagnostics;
  } catch (e) {
    check('端到端切分成功', false, e.message);
  }
  if (program) {
    check('端到端切分成功', true);
    check('provenance 被带上', program.provenance?.model === 'handwritten');
    check('围栏被兜底规则剥掉', !program.slots.setup.includes('```'));
    check('散落文本有告警但不失败', diag.some((d) => d.code === 'text.outside-markers'));
  }
}

console.log('\n『E-2』硬失败时抛 ProgramBuildError（不产出半成品）');
{
  let err = null;
  try {
    buildProgramFromText('/* @slot:PROBLEM */\n题\n/* @end */');
  } catch (e) {
    err = e;
  }
  check('抛的是 ProgramBuildError', err instanceof ProgramBuildError);
  check('带结构化诊断', Array.isArray(err?.diagnostics) && err.diagnostics.length > 0);
  check('诊断里包含 marker.missing', err?.diagnostics?.some((d) => d.code === 'marker.missing'));
}

/* ────────────────────────────── 汇总 ────────────────────────────── */

console.log(`\n${failures.length ? '✗' : '✓'} 标记切分清洗取证：通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
  process.exitCode = 1;
}
