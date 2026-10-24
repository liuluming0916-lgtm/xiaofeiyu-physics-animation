import { parseAnalysisTable, ANALYSIS_EXAMPLE } from '../core/analysis/index.mjs';
import { generateProgramSlots, toJsExpr, parseBreakdownSteps } from '../core/analysis/generate.mjs';
import { buildProgramFromText } from '../core/cleaner/index.mjs';
import { dryRun } from '../core/dryrun/dry-run.mjs';
import { SLOT_KEY_NAMES } from '../contracts/spec/frozen-keys.mjs';
import { parseStepsSlot, collectKinematicBoundaries, resolveDuration } from '../sdk/runtime/animation-runtime.mjs';

const analysis = parseAnalysisTable(ANALYSIS_EXAMPLE);
if (!analysis.ok) {
  console.log('analysis parse failed', analysis.problems);
  process.exit(1);
}

const drawFrame = [
  'Draw.ground(-2, 8, 0);',
  'Draw.box([state.block_A.x, state.block_A.y], 0.6, 0.4);',
].join('\n');

const slots = generateProgramSlots({
  analysis,
  problem: '水平传送带上放一个物块。',
  breakdownText: 'title: 第 1 步 · 加速\ntex: 物块加速\n\ntitle: 第 2 步 · 匀速\ntex: 物块匀速',
  drawFrame,
});

for (const [k, v] of Object.entries(slots)) {
  console.log(`--- ${k} (${String(v).length}) ---`);
  console.log(String(v).slice(0, 300));
}

const text = SLOT_KEY_NAMES.map((k) => `/* @slot:${k} */\n${slots[k]}\n/* @end */`).join('\n\n');
const built = buildProgramFromText(text, {});
console.log('built ok; stateAt:', built.program.slots.stateAt.split('\n').slice(0, 6).join(' | '));

const parsedSteps = parseStepsSlot(slots.STEPS);
if (parsedSteps.some((s) => s.t0 !== null || s.t1 !== null)) {
  console.log('FAIL STEPS 解析后仍带 t0/t1');
  process.exitCode = 1;
}
const runtimeProg = {
  STEPS: parsedSteps,
  SIM: { duration: analysis.tPhys, phases: analysis.elements[0].segments.map((s) => ({ t0: s.t0, t1: s.t1 })) },
};
const kinBoundaries = collectKinematicBoundaries(runtimeProg);
const dur = resolveDuration(runtimeProg);
if (!kinBoundaries.includes(1) || dur !== analysis.tPhys) {
  console.log('FAIL 新 STEPS 下边界/时长不可用', JSON.stringify({ kinBoundaries, dur }));
  process.exitCode = 1;
}

const boundaries = [...new Set(analysis.elements.flatMap((el) => el.segments.flatMap((s) => [s.t0, s.t1])))].sort((a, b) => a - b);
const { report } = await dryRun({
  slots: built.program.slots,
  entry: 'analysis-generate-test',
  meta: { mode: 'BOTH', tPhys: analysis.tPhys, boundaries },
});
console.log('verdict:', report?.verdict);
console.log('checks:', (report?.checks ?? []).map((c) => `${c.id}:${c.status}`).join(' '));
for (const c of report?.checks ?? []) {
  if (c.status === 'fail') console.log('FAIL', c.id, c.message, JSON.stringify(c.offenders ?? []).slice(0, 500));
}

let failed = 0;
if (/\bt0\s*:/.test(slots.STEPS) || /\bt1\s*:/.test(slots.STEPS)) {
  console.log('FAIL STEPS 仍带 t0/t1');
  failed += 1;
}
for (const id of ['C5', 'C6']) {
  if (report?.checks?.find((c) => c.id === id)?.status !== 'pass') failed += 1;
}
if (report?.verdict !== 'pass') failed += 1;

/* C5：VIEW.duration 与 analysis.T_phys 不一致时必须失败 */
const badC5 = await dryRun({
  slots: { ...built.program.slots, VIEW: built.program.slots.VIEW.replace('duration: 3', 'duration: 4') },
  entry: 'analysis-generate-bad-c5',
  meta: { mode: 'BOTH', tPhys: analysis.tPhys, boundaries },
});
const c5 = badC5.report?.checks?.find((c) => c.id === 'C5');
if (c5?.status !== 'fail') {
  console.log('FAIL C5 没有拦住 duration 与 T_phys 不一致');
  failed += 1;
}

/* C6：analysis 边界处 position 跳变时必须失败 */
const badC6 = await dryRun({
  slots: { ...built.program.slots, stateAt: 'return { block_A: { x: t < 1 ? t : t + 0.4, y: 0 } };' },
  entry: 'analysis-generate-bad-c6',
  meta: { mode: 'BOTH', tPhys: analysis.tPhys, boundaries },
});
const c6 = badC6.report?.checks?.find((c) => c.id === 'C6');
if (c6?.status !== 'fail') {
  console.log('FAIL C6 没有拦住 analysis 边界跳变', JSON.stringify(c6));
  failed += 1;
}

/* ── 数学函数前缀（2026-10-23 事故回归）─────────────────────────────
 *
 * `expr.mjs` 规定物理分析里只写**裸函数名**（`exp(-t/τ)`），而 `stateAt` 要在真沙箱里跑，
 * 裸 `exp` 不存在。q06 就死在这里：C1 `unknown-global` + C2 运行期崩溃，frames=0，
 * 而且确定性复现 —— 自愈重跑两轮也修不掉。这里钉住三条：
 *   ① 裸函数名 → `Math.xxx`；
 *   ② 已经写了 `Math.` 的不会被加成 `Math.Math.`；
 *   ③ 生成出来的 stateAt 真的能跑（不是"看起来像"）。
 */
{
  const cases = [
    ['exp(-t)', 'Math.exp(-tt0)'],
    ['1 - exp(-t/0.65)', '1 - Math.exp(-tt0/0.65)'],
    ['Math.cos(1.5*t)', 'Math.cos(1.5*tt0)'],
    ['0.5*sin(t)+pow(t,2)', '0.5*Math.sin(tt0)+Math.pow(tt0,2)'],
    ['t^2/2', 'tt0**2/2'],
    /* P1-3：解析器认 `pi`，生成器也必须认；大小写两种都收敛到 Math.PI */
    ['2*pi*t', '2*Math.PI*tt0'],
    ['sin(pi*t)', 'Math.sin(Math.PI*tt0)'],
    ['2*PI*t', '2*Math.PI*tt0'],
  ];
  for (const [src, want] of cases) {
    const got = toJsExpr(src, 'tt0');
    if (got !== want) {
      console.log(`FAIL toJsExpr(${JSON.stringify(src)}) = ${JSON.stringify(got)}，应为 ${JSON.stringify(want)}`);
      failed += 1;
    }
  }
  const expAnalysis = {
    tPhys: 2,
    elements: [
      {
        id: 'rod',
        type: 'conductor_rod',
        segments: [{ t0: 0, t1: 2, x: { src: '1 - exp(-t)' }, y: { src: '0' }, extra: {} }],
      },
    ],
  };
  const expSlots = generateProgramSlots({
    analysis: expAnalysis,
    problem: 'p',
    breakdownText: '',
    drawFrame: 'Draw.line([0,0],[1,0]);',
  });
  if (/(?<![.\w])exp\(/.test(expSlots.stateAt)) {
    console.log('FAIL 生成的 stateAt 里仍有裸 exp：', expSlots.stateAt.split('\n').find((l) => /(?<![.\w])exp\(/.test(l)));
    failed += 1;
  }
  try {
    // eslint-disable-next-line no-new-func
    const f = new Function('t', `${expSlots.stateAt}`);
    const st = f(1);
    if (!(Number.isFinite(st?.rod?.x) && st.rod.x > 0)) {
      console.log('FAIL 生成的 stateAt 跑不出有限位置', JSON.stringify(st));
      failed += 1;
    }
  } catch (err) {
    console.log('FAIL 生成的 stateAt 无法执行：', err.message);
    failed += 1;
  }

  /* P1-3 端到端：`2*pi*t` 生成出来的 stateAt 必须能跑，且不能留裸 pi */
  const piAnalysis = {
    tPhys: 2,
    elements: [
      {
        id: 'ball_A',
        type: 'ball',
        segments: [{ t0: 0, t1: 2, x: { src: '2*pi*t' }, y: { src: '0' }, extra: {} }],
      },
    ],
  };
  const piSlots = generateProgramSlots({
    analysis: piAnalysis,
    problem: 'p',
    breakdownText: '',
    drawFrame: 'Draw.line([0,0],[1,0]);',
  });
  if (/(?<![.\w])pi\b/.test(piSlots.stateAt)) {
    console.log('FAIL 生成的 stateAt 里仍有裸 pi：', piSlots.stateAt.split('\n').find((l) => /(?<![.\w])pi\b/.test(l)));
    failed += 1;
  }
  try {
    // eslint-disable-next-line no-new-func
    const f = new Function('t', `${piSlots.stateAt}`);
    const st = f(1);
    if (!(Number.isFinite(st?.ball_A?.x) && Math.abs(st.ball_A.x - 2 * Math.PI) < 1e-9)) {
      console.log('FAIL 2*pi*t 生成的 stateAt 跑不出 2π：', JSON.stringify(st));
      failed += 1;
    }
  } catch (err) {
    console.log('FAIL 2*pi*t 生成的 stateAt 无法执行：', err.message);
    failed += 1;
  }
}

/* ── breakdown 切步（2026-10-23 事故回归）──────────────────────────
 *
 * q06 的 breakdown 里，模型在 `title:` 与 `tex: """` 之间空了一行，而且**忘了收尾的 `"""`**。
 * 旧实现按空行切块 ⇒ 4 步被切成 8 块，页面上多出"第 2 步 / 第 4 步"这种空步骤，
 * couple 也跟着按 8 步编号。这里钉住四种形态。
 */
{
  const cases = [
    {
      name: 'title 与 tex 之间有空行',
      input: 'title: 甲\n\ntex: 正文甲',
      want: [{ title: '甲', tex: '正文甲' }],
    },
    {
      name: '未闭合的 """ 不能吞掉下一个 title',
      input: 'title: 甲\ntex: """\n正文甲\n\ntitle: 乙\ntex: """\n正文乙\n"""',
      want: [
        { title: '甲', tex: '正文甲' },
        { title: '乙', tex: '正文乙' },
      ],
    },
    {
      name: 'inline """…"""',
      input: 'title: 甲\ntex: """一句话"""',
      want: [{ title: '甲', tex: '一句话' }],
    },
    {
      name: 'tex 内的空行要保住',
      input: 'title: 甲\ntex: """\n第一段\n\n第二段\n"""',
      want: [{ title: '甲', tex: '第一段\n\n第二段' }],
    },
  ];
  for (const c of cases) {
    const got = parseBreakdownSteps(c.input);
    if (got.length !== c.want.length) {
      console.log(`FAIL 切步「${c.name}」得到 ${got.length} 步，应为 ${c.want.length}`, JSON.stringify(got));
      failed += 1;
      continue;
    }
    for (let i = 0; i < got.length; i += 1) {
      if (got[i].title !== c.want[i].title || got[i].tex !== c.want[i].tex) {
        console.log(`FAIL 切步「${c.name}」第 ${i + 1} 步不符`, JSON.stringify(got[i]), '应为', JSON.stringify(c.want[i]));
        failed += 1;
      }
    }
  }
}

/* ── 段起点增量写法（2026-10-23 用户要求）───────────────────────────
 *
 * 模型写 `x0 + vx0*(t - t0)` 这类"相对本段起点"的式子，由生成器把锚点代入；
 * 不许它自己展开常数（每展开一次就多两处算术错误的机会）。
 */
{
  const cases = [
    ['x0 + vx0*(t - t0)', '1 + 2*(tt0 - 1)'],
    ['y0 + vy0*(t - t0) - 5*(t - t0)^2', '1 + 0*(tt0 - 1) - 5*(tt0 - 1)**2'],
    ['x0', '1'],
  ];
  const anchor = { t0: 1, x0: 1, y0: 1, vx0: 2, vy0: 0 };
  for (const [src, want] of cases) {
    const got = toJsExpr(src, 'tt0', anchor);
    if (got !== want) {
      console.log(`FAIL 锚点代入 toJsExpr(${JSON.stringify(src)}) = ${JSON.stringify(got)}，应为 ${JSON.stringify(want)}`);
      failed += 1;
    }
  }
  /* parser 也得认这些名字，并且拿 anchor 做一致性校验 */
  const table = [
    'element: block_A',
    'type: block',
    'segment: 1',
    't0: 0',
    't1: 1',
    'x0: 0',
    'y0: 1',
    'vx0: 2',
    'vy0: 0',
    'ax: 0',
    'ay: 0',
    'x: x0 + vx0*(t - t0)',
    'y: y0',
    'note: 从 (0,1) 出发水平匀速',
  ].join('\n');
  const parsedAnchor = parseAnalysisTable(table);
  if (!parsedAnchor.ok) {
    console.log('FAIL 表达式引用 x0/vx0/t0 时解析失败：', JSON.stringify(parsedAnchor.problems).slice(0, 400));
    failed += 1;
  } else {
    const seg = parsedAnchor.elements[0].segments[0];
    const v = seg.x.fn(0.5);
    if (Math.abs(v - 1) > 1e-9) {
      console.log('FAIL 锚点名参与求值结果不对：x(0.5) =', v, '应为 1');
      failed += 1;
    }
    const gen = generateProgramSlots({ analysis: parsedAnchor, problem: 'p', breakdownText: '', drawFrame: 'Draw.line([0,0],[1,0]);' });
    if (!/x0 = 0 \+ 2\*\(tt0 - 0\)/.test(gen.stateAt)) {
      console.log('FAIL 生成的 stateAt 没把锚点代入：', gen.stateAt.split('\n').find((l) => l.includes('x0 =')));
      failed += 1;
    }
  }
}

if (failed) process.exitCode = 1;
