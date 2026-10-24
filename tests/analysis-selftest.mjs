#!/usr/bin/env node
/**
 * 物理分析（analysis）产出格式自检 —— v6（只有 MOTIONS）。
 *
 * 验三件事：
 *   『A』一页示例能被真解析器解析，且数值/连续性/初态都对；
 *   『B』解析器拒绝它该拒绝的（坏语法、未知变量、ODE、段间隙、段跳变、旧 EVENTS/ANSWERS…）；
 *   『C』提示词与解析器口径一致（只有 MOTIONS、没有 EVENTS/ANSWERS、6 个初态字段、breakdown 不进）。
 *
 * 用法：node tests/analysis-selftest.mjs
 */

import {
  parseAnalysisTable,
  formatAnalysis,
  positionAt,
  compileT,
  ANALYSIS_EXAMPLE,
} from '../core/analysis/index.mjs';
import { ANALYSIS_INSTRUCTION, ANALYSIS_ROLE, buildAnalysisUser } from '../core/prompts/analysis.mjs';

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

const codes = (r) => (r.problems ?? []).map((p) => p.code);

/** 造一条运动记录；`omit` 用来故意缺字段 */
const segText = (o = {}) => {
  const rows = [
    `element: ${o.element ?? 'block_A'}`,
    ...(o.type ? [`type: ${o.type}`] : []),
    `segment: ${o.segment ?? 1}`,
    `t0: ${o.t0 ?? 0}`,
    `t1: ${o.t1 ?? 1}`,
    `x0: ${o.x0 ?? 0}`,
    `y0: ${o.y0 ?? 0}`,
    `vx0: ${o.vx0 ?? 0}`,
    `vy0: ${o.vy0 ?? 0}`,
    `ax: ${o.ax ?? 0}`,
    `ay: ${o.ay ?? 0}`,
    `x: ${o.x ?? 't'}`,
    `y: ${o.y ?? '0'}`,
    ...(o.note ? [`note: ${o.note}`] : []),
    ...(o.extra ? [o.extra] : []),
  ];
  const omit = new Set(o.omit ?? []);
  return rows.filter((r) => !omit.has(r.split(':')[0].trim())).join('\n');
};

console.log('物理分析产出格式自检（v6 · MOTIONS）\n');

/* ────────────────────────────── 『A』示例 ────────────────────────────── */
console.log('『A』一页示例');
{
  const r = parseAnalysisTable(ANALYSIS_EXAMPLE);
  check('示例解析通过', r.ok, r.problems.map((p) => p.message).join(' / '));
  check('只有一个元件 block_A', r.elements.length === 1 && r.elements[0].id === 'block_A', JSON.stringify(r.elements.map((e) => e.id)));
  check('★ 元件带 type=block', r.elements[0]?.type === 'block', String(r.elements[0]?.type));
  check('有两段', r.elements[0]?.segments.length === 2);
  check('tPhys = 3.0', r.tPhys === 3, String(r.tPhys));
  check('没有 assumption 警告（示例写的是“无”）', r.warnings.length === 0, JSON.stringify(r.warnings));

  const s1 = r.elements[0].segments[0];
  const s2 = r.elements[0].segments[1];
  check('第 1 段 6 个初态字段齐全', ['x0', 'y0', 'vx0', 'vy0', 'ax', 'ay'].every((k) => typeof s1.anchor[k] === 'number'));
  check('第 1 段 t=0.5 时 x=0.25', Math.abs(s1.x.fn(0.5) - 0.25) < 1e-12, String(s1.x.fn(0.5)));
  check('第 2 段 t=2.0 时 x=3.0', Math.abs(s2.x.fn(2) - 3) < 1e-12, String(s2.x.fn(2)));
  check('段端 x 连续（t=1 都是 1.0）', Math.abs(s1.x.fn(1) - s2.x.fn(1)) < 1e-12);
  check('y 是常数 0.05（质心高度）', s1.y.fn(0.2) === 0.05 && s2.y.fn(2.9) === 0.05);
  check('第 2 段 anchor.x0=1.0、vx0=2.0', s2.anchor.x0 === 1 && s2.anchor.vx0 === 2);

  const p = positionAt(r, 'block_A', 2);
  check('positionAt(block_A, 2) = (3, 0.05)', p && Math.abs(p.x - 3) < 1e-12 && Math.abs(p.y - 0.05) < 1e-12, JSON.stringify(p));
  const before = positionAt(r, 'block_A', -1);
  check('t 早于首段时取首段 t0（x=0）', before && Math.abs(before.x) < 1e-12, JSON.stringify(before));
  const after = positionAt(r, 'block_A', 10);
  check('t 晚于末段时保持末位置（x=5）', after && Math.abs(after.x - 5) < 1e-12, JSON.stringify(after));

  const round = parseAnalysisTable(formatAnalysis(r));
  check('formatAnalysis 往返后仍通过', round.ok, round.problems.map((p2) => p2.message).join(' / '));
  check('往返后 tPhys 不变', round.tPhys === r.tPhys);
  check('往返后仍是 2 段', round.elements[0]?.segments.length === 2);
  check('★ formatAnalysis 保留 type', formatAnalysis(r).includes('type: block'));
}

/* ────────────────────────────── 『B』拒绝 ────────────────────────────── */
console.log('\n『B』解析器拒绝非法输入');
{
  const reject = (name, text, code) => {
    const r = parseAnalysisTable(text);
    check(name, !r.ok && (!code || codes(r).includes(code)), codes(r).join(','));
  };

  reject('拒绝 Math.xxx', segText({ x: 'Math.sin(t)' }), 'x-expression');
  reject('拒绝赋值', segText({ x: '(t = 1)' }), 'x-expression');
  reject('拒绝未知变量', segText({ x: 'v*t' }), 'x-expression');
  reject('拒绝字符串字面量', segText({ x: "'a'" }), 'x-expression');
  reject('拒绝成员访问', segText({ x: 't.x' }), 'x-expression');
  reject('拒绝数组', segText({ x: '[1,2]' }), 'x-expression');
  reject('拒绝箭头函数', segText({ x: '((t) => t)(1)' }), 'x-expression');
  reject('拒绝 ODE（本版明确不支持）', segText({ extra: 'kind: ode' }), 'unsupported-kind');
  reject('拒绝带单位的 t1', segText({ t1: '1.0 s' }), 'segment-time');
  reject('拒绝未知字段 event_end', segText({ extra: 'event_end: 共速' }), 'motion-field');
  reject('拒绝缺 x0', segText({ omit: ['x0'] }), 'anchor-value');
  reject('拒绝初态与表达式不一致', segText({ x0: 1, x: 't' }), 'anchor-mismatch');
  reject(
    '拒绝重复字段',
    ['element: block_A', 'segment: 1', 't0: 0', 't1: 1', 'x0: 0', 'y0: 0', 'vx0: 0', 'vy0: 0', 'ax: 0', 'ay: 0', 'x: t', 'x: t', 'y: 0'].join('\n'),
    'bad-record',
  );

  const conflict = parseAnalysisTable(
    [
      segText({ type: 'block', segment: 1, t0: 0, t1: 1, x: 't', x0: 0 }),
      '',
      segText({ type: 'ball', segment: 2, t0: 1, t1: 2, x: 't', x0: 1 }),
    ].join('\n'),
  );
  check('★ 拒绝同一元件多段 type 不一致', !conflict.ok && codes(conflict).includes('element-type-conflict'), codes(conflict).join(','));

  const gap = parseAnalysisTable(
    [segText({ segment: 1, t0: 0, t1: 1, x: 't', x0: 0 }), '', segText({ segment: 2, t0: 2, t1: 3, x: '1', x0: 1 })].join('\n'),
  );
  check('拒绝段间隙', !gap.ok && codes(gap).includes('segment-gap'), codes(gap).join(','));

  const jump = parseAnalysisTable(
    [segText({ segment: 1, t0: 0, t1: 1, x: 't', x0: 0 }), '', segText({ segment: 2, t0: 1, t1: 2, x: 't + 1', x0: 2 })].join('\n'),
  );
  check('拒绝段端位置跳变', !jump.ok && codes(jump).includes('segment-discontinuous'), codes(jump).join(','));

  /* 容差 2026-10-24 调到 max(1 mm, 0.1%)：q04 真题实测模型写 4.001774 vs 4.000000（1.8 mm）应放行，
     但"真跳变"必须仍然报错 —— 两条正反例钉住，避免这次放宽变成"什么都放行"。 */
  const rounding = parseAnalysisTable(
    [segText({ segment: 1, t0: 0, t1: 1, x: 't', x0: 0 }), '', segText({ segment: 2, t0: 1, t1: 2, x: '1.0005 + 0*t', x0: 1.0005 })].join('\n'),
  );
  check('★ 放行 0.5 mm 级的“重新算了一遍”的段端（模型 4 位有效数字的正常误差）', rounding.ok, codes(rounding).join(','));

  const smallJump = parseAnalysisTable(
    [segText({ segment: 1, t0: 0, t1: 1, x: 't', x0: 0 }), '', segText({ segment: 2, t0: 1, t1: 2, x: '1.01 + 0*t', x0: 1.01 })].join('\n'),
  );
  check('★ 仍拒绝 1 cm 的段端跳变（放宽到 1 mm 后不能变成什么都过）', !smallJump.ok && codes(smallJump).includes('segment-discontinuous'), codes(smallJump).join(','));

  const overlap = parseAnalysisTable(
    [segText({ segment: 1, t0: 0, t1: 1, x: 't', x0: 0 }), '', segText({ segment: 2, t0: 0.5, t1: 2, x: 't', x0: 0.5 })].join('\n'),
  );
  check('拒绝段时间重叠', !overlap.ok && codes(overlap).includes('segment-overlap'), codes(overlap).join(','));

  const seq = parseAnalysisTable(segText({ segment: 2 }));
  check('拒绝 segment 不从 1 开始', !seq.ok && codes(seq).includes('segment-sequence'), codes(seq).join(','));

  const ev = parseAnalysisTable(`${segText()}\n\nevent: 共速\nt: 0.5`);
  check('拒绝 event 记录（v6 已无 EVENTS）', !ev.ok && codes(ev).includes('unknown-record'), codes(ev).join(','));

  const ans = parseAnalysisTable(`${segText()}\n\nanswer: t*\nvalue: 1`);
  check('拒绝 answer 记录（v6 已无 ANSWERS）', !ans.ok && codes(ans).includes('unknown-record'), codes(ans).join(','));

  const empty = parseAnalysisTable('');
  check('拒绝空表', !empty.ok && codes(empty).includes('empty'), codes(empty).join(','));
}

/* ────────────────────────────── 『C』允许与提示词 ────────────────────────────── */
console.log('\n『C』允许的写法与提示词一致性');
{
  const ok = (name, x, { x0 = 0, y = '0', y0 = 0 } = {}) => {
    const r = parseAnalysisTable(segText({ x, x0, y, y0 }));
    check(name, r.ok, r.problems.map((p) => p.message).join(' / '));
  };
  ok('允许 ^ 幂', 't^2');
  ok('允许 ** 幂', 't**2');
  ok('允许 sin/cos/pi', 'sin(pi*t) + cos(t)', { x0: 1 });
  ok('允许 sqrt/abs', 'sqrt(abs(t))');
  ok('允许常量 pi', '2*pi', { x0: 2 * Math.PI });

  const noType = parseAnalysisTable(segText());
  check('★ 缺 type 时退化为 unknown（不硬失败）', noType.ok && noType.elements[0]?.type === 'unknown', noType.elements[0]?.type);

  /* B2：type 必须命中词表（决定 A）；尺寸字段一律拒绝 */
  const allowed = ['block', 'ball', 'board'];
  const noTypeStrict = parseAnalysisTable(segText(), { allowedTypes: allowed });
  check('★ 给定词表时缺 type ⇒ type-unknown', !noTypeStrict.ok && codes(noTypeStrict).includes('type-unknown'), codes(noTypeStrict).join(','));
  const fakeType = parseAnalysisTable(segText({ type: '物块A' }), { allowedTypes: allowed });
  check('★ 自造 type ⇒ type-unknown', !fakeType.ok && codes(fakeType).includes('type-unknown'), codes(fakeType).join(','));
  const unknownType = parseAnalysisTable(segText({ type: 'unknown' }), { allowedTypes: allowed });
  check('★ unknown ⇒ type-unknown', !unknownType.ok && codes(unknownType).includes('type-unknown'), codes(unknownType).join(','));
  const goodType = parseAnalysisTable(segText({ type: 'block' }), { allowedTypes: allowed });
  check('词表内 type 通过', goodType.ok, codes(goodType).join(','));

  const withW = parseAnalysisTable(segText({ extra: 'w: 0.4' }));
  check('★ analysis 输出 w ⇒ size-not-allowed', !withW.ok && codes(withW).includes('size-not-allowed'), codes(withW).join(','));
  const withPhysical = parseAnalysisTable(segText({ extra: 'physical: 0.3' }));
  check('★ analysis 输出 physical ⇒ size-not-allowed', !withPhysical.ok && codes(withPhysical).includes('size-not-allowed'), codes(withPhysical).join(','));

  const fenced = parseAnalysisTable('```text\n' + ANALYSIS_EXAMPLE + '\n```');
  check('允许 ``` 围栏', fenced.ok, fenced.problems.map((p) => p.message).join(' / '));

  const colon = parseAnalysisTable(
    'element：block_A\nsegment：1\nt0：0\nt1：1\nx0：0\ny0：0\nvx0：0\nvy0：0\nax：0\nay：0\nx：t\ny：0',
  );
  check('允许全角冒号', colon.ok, colon.problems.map((p) => p.message).join(' / '));

  const assumed = parseAnalysisTable('assumption: 取 m=1 kg、g=10 m/s² 为示意值\n\n' + segText());
  check(
    'assumption 被记录并给出提示',
    assumed.ok && assumed.assumption?.includes('m=1') && assumed.warnings.some((w) => w.code === 'assumption-used'),
    JSON.stringify(assumed.warnings),
  );

  const math = compileT('sin(pi/2) + 2^3');
  check('compileT 支持 ^ 且求值正确（1 + 8 = 9）', math.ok && Math.abs(math.fn(0) - 9) < 1e-12, String(math.ok ? math.fn(0) : math.error));

  check('角色段不再提“关键事件”', !ANALYSIS_ROLE.includes('关键事件'));
  check('角色段说明“不写最终答案、不写绘图代码”', ANALYSIS_ROLE.includes('不写最终答案') && ANALYSIS_ROLE.includes('不写绘图代码'));
  check('指令里只有 MOTIONS 区块', ANALYSIS_INSTRUCTION.includes('=== 元件运动表 (MOTIONS) ==='));
  check('指令里没有 EVENTS', !ANALYSIS_INSTRUCTION.includes('EVENTS') && !ANALYSIS_INSTRUCTION.includes('关键事件表'));
  check('指令里没有 ANSWERS', !ANALYSIS_INSTRUCTION.includes('ANSWERS') && !ANALYSIS_INSTRUCTION.includes('结论表'));
  check('指令里没有“事件：”规则', !/^\d+\.\s*事件：/m.test(ANALYSIS_INSTRUCTION));
  check('指令里有 6 个初态字段', ANALYSIS_INSTRUCTION.includes('x0 / y0 / vx0 / vy0 / ax / ay'));
  check('指令里有 ^ 与 ** 两种幂', ANALYSIS_INSTRUCTION.includes('幂 ^') && ANALYSIS_INSTRUCTION.includes('**'));
  check('指令里有 assumption 占位行（用户版）', ANALYSIS_INSTRUCTION.includes('assumption: 为没有数值的符号赋值'));
  check('指令里有示例（与 ANALYSIS_EXAMPLE 逐字一致）', ANALYSIS_INSTRUCTION.includes(ANALYSIS_EXAMPLE));
  check('指令里写明段端连续', ANALYSIS_INSTRUCTION.includes('位置 (x, y) 必须相等'));
  /* 2026-10-24：q04 真题里 B 被拉过滑轮、C 自由落体 12 m 把画面撑大 ⇒ 加一条空间约束（硬性） */
  check(
    '指令里写明空间约束（悬挂物不得越过滑轮 / 落地即截断）',
    ANALYSIS_INSTRUCTION.includes('悬挂物不得高于它上方的滑轮') && ANALYSIS_INSTRUCTION.includes('在该时刻截断'),
  );
  check(
    '指令里写明用段锚点写增量',
    ANALYSIS_INSTRUCTION.includes('2. 用本段字段名写增量。') && ANALYSIS_INSTRUCTION.includes('x0 + vx0*(t - t0)'),
  );
  check('指令里写明锚点名字可用', ANALYSIS_INSTRUCTION.includes('`t0`、`x0`、`y0`、`vx0`、`vy0`'));

  const user = buildAnalysisUser({
    problem: '一物块从斜面滑下。',
    readProblem: '【物体】物块、斜面',
    solution: 'a = g sinθ',
  });
  check('user 有题目段', user.includes('【题目】') && user.includes('一物块从斜面滑下。'));
  check('user 有几何段（注入读题）', user.includes('【题目图与几何（读题转写的结构）】') && user.includes('【物体】物块、斜面'));
  check('user 有解题过程', user.includes('【解题过程】') && user.includes('a = g sinθ'));
  check('user 不再包含分步讲解', !user.includes('分步讲解') && !user.includes('breakdown'));
  check('user 不含题目横幅（由 assemblePrompt 统一加）', !user.includes('════ 题目 ════'));

  const noRead = buildAnalysisUser({ problem: 'p', solution: 's' });
  check('没有读题输出时不出现几何段', !noRead.includes('【题目图与几何'));

  /* v1.1.18：补充描述 / 已知条件 / 参考答案必须进 analysis，且参考答案优先 */
  const enriched = buildAnalysisUser({
    problem: 'p',
    readProblem: '【物体】物块',
    solution: 'a = 2 m/s²，t = 1 s',
    description: '图(b)过 (0,0)，x=1 时 F=-20 N',
    knownConditions: 'm_A=2 kg',
    referenceText: '(1) W_F=-10 J；(2) μ=0.75',
  });
  check('★ user 注入用户补充描述', enriched.includes('【用户补充描述') && enriched.includes('F=-20 N'));
  check('★ user 注入用户已知条件', enriched.includes('【用户填写的已知条件') && enriched.includes('m_A=2 kg'));
  check('★ user 注入参考答案原文（最高权威）', enriched.includes('【老师提供的参考答案 / 解析（最高权威') && enriched.includes('W_F=-10 J'));
  check(
    '★ 参考答案排在【解题过程】之前（先对齐解析，再写运动表）',
    enriched.indexOf('【老师提供的参考答案') < enriched.indexOf('【解题过程'),
  );
  check('★ 指令里写明数值权威顺序', ANALYSIS_INSTRUCTION.includes('参考答案 > 解题过程 > 题图'));
  check('★ 指令里禁止从题图重新读数', ANALYSIS_INSTRUCTION.includes('不要从题图重新读数'));
}

console.log(`\n通过 ${passed}，失败 ${failures.length}`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
