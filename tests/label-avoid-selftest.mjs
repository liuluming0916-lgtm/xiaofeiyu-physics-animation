#!/usr/bin/env node
/**
 * 标注避让取证（第 8 期 · M15 补强：用户要求「文字避让，主体是动画」）
 *
 * 要证明的四件事：
 *
 *   **A 几何口径**：一条注占多大、平移后占哪个盒子、`align`/`baseline` 有没有算对、
 *      图元的盒子与运行时包络同一套字段、两个盒子"贴边"不算相交（负对照）。
 *   **B 身份口径**：同一帧里两条同文字的注，key 必须是 `#0` / `#1` 两个；
 *      跨帧要用同一套规则对齐（这是避让表能与画面挂上钩的唯一依据）。
 *   **C 规划器**：压字的注会被挪开、空地的注**一动不动**（负对照）、
 *      两条注抢同一个位置时后者让位、结果可复现、**永不更糟**（`scoreAfter <= scoreBefore`）、
 *      注太多/没有帧时**降级可见**（`skipped` 说明原因，而不是静默返回空表）。
 *   **D 真题目**：拿一道回归题真的跑一遍 Dry-Run，断言报告里确实带着这张表，
 *      且表里每条注都满足"不更糟"。
 *
 * ⚠ 不写任何文件；真题目只用 `q01`，跑得快。
 *
 * 用法：node tests/label-avoid-selftest.mjs
 */

import { isCliEntry } from '../tools/paths.mjs';
import {
  DEFAULT_VIEWPORT,
  OBSTACLE_OPS,
  deriveLabelKeys,
  emptyLabelAvoid,
  estimateLabelPx,
  isWideChar,
  labelBoxWorld,
  obstacleBoxWorld,
  overlapArea,
} from '../sdk/runtime/label-avoid.mjs';
import { applyLabelAvoid, planLabelLayout } from '../core/dryrun/label-avoid.mjs';
import { dryRun } from '../core/dryrun/dry-run.mjs';
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

/** 合成帧：`[[记录的记录], ...]` → `run.frames` 的形状 */
function framesOf(recordsPerFrame) {
  return recordsPerFrame.map((records, i) => ({ t: i * 0.1, records, commandCount: records.length }));
}

const box = (op, extra) => ({ op, ...extra });
const textAt = (x, y, text, size = 20, extra = {}) => box('text', { x, y, text, size, align: 'center', baseline: 'middle', ...extra });

async function main() {
  console.log('标注避让取证（第 8 期 · 文字给主体让位）\n');

  /* ══ A 几何口径 ══════════════════════════════════════ */
  console.log('『A』几何：一条注占多大、图元占哪个盒子');

  check('汉字判为全角', isWideChar('物') === true && isWideChar('a') === false);
  check('★ 汉字比同 size 的字母宽（1 em vs 0.55 em）', estimateLabelPx(textAt(0, 0, '物块')).width > estimateLabelPx(textAt(0, 0, 'ab')).width);
  check('尺寸随 size 线性变化', estimateLabelPx(textAt(0, 0, '物', 40)).width > estimateLabelPx(textAt(0, 0, '物', 20)).width * 1.9);
  check('上下标会额外占宽', estimateLabelPx(textAt(0, 0, 'v', 20, { sub: 'x' })).width > estimateLabelPx(textAt(0, 0, 'v', 20)).width);

  {
    const SCALE = 100; // 1 世界单位 = 100 px，便于手算
    const r = textAt(10, 5, '物块', 20);
    const b = labelBoxWorld(r, SCALE);
    check('★ 包围盒中心 = 锚点（align/baseline 都是 center/middle）', Math.abs(b.cx - 10) < 1e-9 && Math.abs(b.cy - 5) < 1e-9);

    const left = labelBoxWorld({ ...r, align: 'left' }, SCALE);
    const right = labelBoxWorld({ ...r, align: 'right' }, SCALE);
    check('★ align=left 时文字从锚点向右展开（左边缘贴在锚点上）', Math.abs(left.minX - r.x) < 1e-9 && left.cx > b.cx);
    check('★ align=right 时文字从锚点向左展开（右边缘贴在锚点上）', Math.abs(right.maxX - r.x) < 1e-9 && right.cx < b.cx);

    const top = labelBoxWorld({ ...r, baseline: 'top' }, SCALE);
    check('baseline=top 时盒子往下展开', top.cy < b.cy);

    const moved = labelBoxWorld(r, SCALE, { dx: 1, dy: 2 });
    check('★ 偏移量直接体现在盒子上（整段恒定的那个偏移）', Math.abs(moved.cx - (b.cx + 1)) < 1e-9 && Math.abs(moved.cy - (b.cy + 2)) < 1e-9);
  }

  {
    const a = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const touching = { minX: 1, minY: 0, maxX: 2, maxY: 1 };
    const crossing = { minX: 0.5, minY: 0.5, maxX: 1.5, maxY: 1.5 };
    check('★ 负对照：**贴边**不算相交（否则整条传送带都会被判成压字）', overlapArea(a, touching) === 0);
    check('真相交时面积正确', Math.abs(overlapArea(a, crossing) - 0.25) < 1e-9);
  }

  {
    check('线段盒子取两端点', JSON.stringify(obstacleBoxWorld(box('line', { x1: 0, y1: 0, x2: 2, y2: 3 }))) === JSON.stringify({ minX: 0, minY: 0, maxX: 2, maxY: 3 }));
    check('圆按 cx/cy/r 展开', JSON.stringify(obstacleBoxWorld(box('circle', { cx: 1, cy: 1, r: 0.5 }))) === JSON.stringify({ minX: 0.5, minY: 0.5, maxX: 1.5, maxY: 1.5 }));
    check('传送带按 a→b（与运行时包络同口径）', JSON.stringify(obstacleBoxWorld(box('belt', { a: [0, 1], b: [4, 1] }))) === JSON.stringify({ minX: 0, minY: 1, maxX: 4, maxY: 1 }));
    check('多边形取所有顶点', JSON.stringify(obstacleBoxWorld(box('polygon', { points: [[0, 0], [2, 0], [1, 3]] }))) === JSON.stringify({ minX: 0, minY: 0, maxX: 2, maxY: 3 }));
    check('★ `Draw.raw` 不参与（§5.4：不推断它的几何）', obstacleBoxWorld(box('raw', { code: 'x' })) === null);
    check('文字不作为"障碍图元"（它由注自己的盒子处理）', OBSTACLE_OPS.includes('text') === false);
  }

  /* ══ B 身份口径 ══════════════════════════════════════ */
  console.log('\n『B』身份：同帧两条同名注必须是两个 key');

  {
    const records = [textAt(0, 0, 'u'), textAt(1, 0, 'u'), box('line', { x1: 0, y1: 0, x2: 1, y2: 1 }), textAt(2, 0, '物块')];
    const keys = deriveLabelKeys(records).map((e) => e.key);
    check('★ 同文字按出现顺序编号', keys[0] === 'text|u|#0' && keys[1] === 'text|u|#1');
    check('非注图元被跳过', keys.length === 3 && keys[2] === 'text|物块|#0');
    check('key 里带 op（text 与 latex 不会串）', deriveLabelKeys([box('latex', { x: 0, y: 0, tex: 'v' })])[0].key === 'latex|v|#0');
  }

  /* ══ C 规划器 ════════════════════════════════════════ */
  console.log('\n『C』规划器：压字的挪开、空地的别动');

  const SCALE = 100;
  const block = box('polygon', { points: [[0, 0], [1, 0], [1, 0.4], [0, 0.4]] });

  {
    // 注正好压在小物块上 ⇒ 必须挪开，而且挪完不压了
    const frames = framesOf([[block, textAt(0.5, 0.2, '物块', 20)]]);
    const table = planLabelLayout(frames, { scale: SCALE });
    const one = table.labels[0];
    check('★ 压字的注被挪开', one.moved === true && one.overlapFramesBefore > 0);
    check('★ 挪完之后不再压', one.overlapFramesAfter === 0);
    check('★ 不更糟（这是它的立身之本）', one.scoreAfter <= one.scoreBefore + 1e-9);
    check('挪动幅度不超过两个行高', Math.abs(one.offset.dx) <= one.stepWorld * 1.8 + 1e-9 && Math.abs(one.offset.dy) <= one.stepWorld * 1.8 + 1e-9);
    check('挪了就给一条引线（指回原位）', one.leader === true);
  }

  {
    // 负对照：空地上的一条注，一格都不许动
    const frames = framesOf([[block, textAt(5, 5, '空地', 20)]]);
    const table = planLabelLayout(frames, { scale: SCALE });
    const one = table.labels[0];
    check('★ 负对照：空地的注**一动不动**', one.moved === false && one.offset.dx === 0 && one.offset.dy === 0);
    check('没挪就不画引线', one.leader === false);
    check('汇总里"挪了几条"是对的', table.summary.moved === 0 && table.summary.total === 1);
  }

  {
    // 两条注**都压在同一个物块上**：先的挑一个方向走，后的必须让开它
    const frames = framesOf([[block, textAt(0.5, 0.2, 'A', 20), textAt(0.5, 0.2, 'B', 20)]]);
    const table = planLabelLayout(frames, { scale: SCALE });
    const [a, b] = table.labels;
    check('两条压字的注都被规划', table.summary.planned === 2);
    check('★ 两条都必须挪（它们本来就压在物块上）', a.moved === true && b.moved === true);
    check('★ 挪的位置不同（注与注之间也避让）', a.offset.dx !== b.offset.dx || a.offset.dy !== b.offset.dy);
  }

  {
    // 跨帧：物块在动、注跟着物块动 —— 偏移量必须**全程同一个**
    const frames = framesOf([
      [box('polygon', { points: [[0, 0], [1, 0], [1, 0.4], [0, 0.4]] }), textAt(0.5, 0.2, '物块', 20)],
      [box('polygon', { points: [[1, 0], [2, 0], [2, 0.4], [1, 0.4]] }), textAt(1.5, 0.2, '物块', 20)],
      [box('polygon', { points: [[2, 0], [3, 0], [3, 0.4], [2, 0.4]] }), textAt(2.5, 0.2, '物块', 20)],
    ]);
    const table = planLabelLayout(frames, { scale: SCALE });
    check('★ 跨帧只认一个 key（不按位置分裂成三条）', table.labels.length === 1);
    check('★ 整段只给一个偏移量（否则文字会跟着跳）', table.labels[0].frames === 3 && table.labels[0].moved === true);
    check('三帧都算进了评分', table.labels[0].overlapFramesBefore === 3);
  }

  {
    const frames = framesOf([[block, textAt(0.5, 0.2, '物块', 20)], [block, textAt(0.5, 0.2, '物块', 20)]]);
    const one = JSON.stringify(planLabelLayout(frames, { scale: SCALE }));
    const two = JSON.stringify(planLabelLayout(frames, { scale: SCALE }));
    check('★ 结果可复现（同一输入 ⇒ 逐字节同一张表）', one === two);
  }

  {
    // 名额有限：压住实体的注超过上限时，只规划最狠的几条，其余**可见地**标 deferred。
    // 场景要"像真的"：每个物块只装一条字（物块比字大 8 倍左右，不是"容器"）
    const scene = [box('line', { x1: -5, y1: -3, x2: 20, y2: 6 })];
    for (let i = 0; i < 6; i += 1) {
      const x = i * 2;
      scene.push(box('polygon', { points: [[x, 0], [x + 1, 0], [x + 1, 0.5], [x, 0.5]] }));
      scene.push(textAt(x + 0.5, 0.25, `L${i}`, 20));
    }
    const table = planLabelLayout(framesOf([scene]), { scale: SCALE, maxPlanned: 2 });
    check('★ 名额上限生效（只规划 2 条）', table.summary.planned === 2);
    check('★ 其余标 deferred（降级可见，不假装规划过）', table.summary.deferred === 4 && table.skipped === null);
    check('deferred 的注偏移是 0（不动的就说不动）', table.labels.filter((l) => l.deferred).every((l) => l.offset.dx === 0 && l.offset.dy === 0));
  }

  {
    const many = [];
    for (let i = 0; i < 20; i += 1) many.push(textAt(i, i, `L${i}`, 14));
    const table = planLabelLayout(framesOf([many]), { scale: SCALE });
    check('★ 大量不压字的注不会被规划、也照常列出（含坐标轴刻度那种场景）', table.summary.total === 20 && table.summary.planned === 0);
    check('不压字时一格都不动', table.labels.every((l) => l.moved === false));
  }

  {
    const table = planLabelLayout([], { scale: SCALE });
    check('没有帧 ⇒ 降级可见', table.skipped === 'no-frames' && table.summary.total === 0);
    check('空表也带格式号（消费方可以据此拒绝陌生格式）', table.format === 'od-label-avoid' && table.version === 1);
  }

  {
    // 应用：把表套回记录 —— 这是模板页将来要做的事，先在 Node 里钉住
    const frames = framesOf([[block, textAt(0.5, 0.2, '物块', 20)]]);
    const table = planLabelLayout(frames, { scale: SCALE });
    const { records, applied } = applyLabelAvoid(frames[0].records, table);
    const moved = records.find((r) => r.op === 'text');
    check('★ 套用后坐标确实挪了', Math.abs(moved.x - 0.5) > 1e-6 || Math.abs(moved.y - 0.2) > 1e-6);
    // ⚠ 形状必须与渲染器一致：`replayToCanvas` 读的是 `rec.leaderTo.x`（不是 `[0]`）。
    //   第一版写成了数组，而当时的断言也按数组写 —— 两边一起错，等于没测。
    check(
      '★ 引线指回**原来**的锚点，且形状是 {x,y}（渲染器读 .x/.y）',
      moved.leaderTo && moved.leaderTo.x === 0.5 && moved.leaderTo.y === 0.2 && !Array.isArray(moved.leaderTo),
    );
    check('套用计数与实际一致', applied === table.summary.moved);
    check('不挪的记录原样保留（连对象都没换）', records.find((r) => r.op === 'polygon') === frames[0].records.find((r) => r.op === 'polygon'));
  }

  {
    const empty = emptyLabelAvoid('disabled');
    check('`emptyLabelAvoid` 给出可读的降级原因', empty.skipped === 'disabled' && empty.labels.length === 0);
  }

  /* ══ D 真题目集成 ════════════════════════════════════ */
  console.log('\n『D』真题目：15 道回归题全跑一遍（不做抽样自欺）');

  {
    const questions = await loadQuestions();
    check('拿到 15 道回归题', questions.length === 15);

    const rows = [];
    for (const { file, program } of questions) {
      const { report } = await dryRun({
        slots: program.slots,
        entry: program.id,
        meta: { mode: program.mode ?? 'NUMERIC', index: program.index, title: program.title, sourceFile: file },
      });
      rows.push({ file, table: report.labelAvoid });
    }

    const planned = rows.filter((r) => r.table && !r.table.skipped);
    const skipped = rows.filter((r) => r.table?.skipped);
    const all = planned.flatMap((r) => r.table.labels);
    const moved = all.filter((l) => l.moved);
    const before = all.reduce((n, l) => n + l.overlapFramesBefore, 0);
    const after = all.reduce((n, l) => n + l.overlapFramesAfter, 0);
    const worstRatio = all.reduce((m, l) => Math.max(m, l.stepWorld > 0 ? Math.max(Math.abs(l.offset.dx), Math.abs(l.offset.dy)) / l.stepWorld : 0), 0);

    console.log(
      `      实测：${planned.length} 道题出表（${skipped.length} 道降级）· 注 ${all.length} 条 · 规划 ${all.filter((l) => !l.deferred).length} 条 · ` +
        `挪了 ${moved.length} 条 · deferred ${all.filter((l) => l.deferred).length} 条 · ` +
        `压字帧数 ${before} → ${after} · 最大挪动 ${worstRatio.toFixed(2)} 行高`,
    );
    if (skipped.length) console.log(`      降级原因：${[...new Set(skipped.map((r) => r.table.skipped))].join(' / ')}`);
    for (const r of rows) {
      const t = r.table;
      if (!t || t.skipped) continue;
      if (t.summary.overlappingBefore === 0) continue;
      console.log(
        `      ${r.file.replace('.mjs', '')}：注 ${t.summary.total} · 规划 ${t.summary.planned} · 挪 ${t.summary.moved} · ` +
          `deferred ${t.summary.deferred} · 压字 ${t.summary.overlappingBefore} → ${t.summary.overlappingAfter}`,
      );
    }

    check('★ 每道题的报告里都有 `labelAvoid`', rows.every((r) => Boolean(r.table) && r.table.format === 'od-label-avoid'));
    check('★ 15 道题全部出表（没有整题降级）', planned.length === questions.length);
    check('★ 被压住的注超出名额时，deferred 数如实记在 summary 里', rows.every((r) => r.table.labels.filter((l) => l.deferred).length === r.table.summary.deferred));
    check('★ 没有一道题"跳过得不明不白"（降级的都写了原因）', skipped.every((r) => typeof r.table.skipped === 'string' && r.table.skipped.length > 0));
    check('★ 每条注都满足"不更糟"（全语料）', all.every((l) => l.scoreAfter <= l.scoreBefore + 1e-9));
    check('★ 每条注的偏移都在 1.8 个行高内（不会把字甩出画面）', worstRatio <= 1.8 + 1e-6);
    check('★ 真的挪动了一些（否则等于没做）', moved.length > 0);
    check('★ 但不是全都挪（否则说明判定条件过宽）', moved.length < all.length);
    check('★ 挪完之后压字的总帧数确实下降', after < before);
    check('每条注都有 key（模板页靠它对齐）', all.every((l) => typeof l.key === 'string' && l.key.length > 0));
    check('summary 与 labels 逐题对得上', planned.every((r) => r.table.summary.total === r.table.labels.length));

    const q01 = questions.find((q) => q.file.startsWith('q01')) ?? questions[0];
    const { report: off } = await dryRun({
      slots: q01.program.slots,
      entry: q01.program.id,
      meta: { mode: 'NUMERIC', skipLabelAvoid: true },
    });
    check('★ 能一键关掉（自检省时间用），并且降级原因可见', off.labelAvoid?.skipped === 'disabled');
  }

  console.log(`\n${failures.length ? '✗' : '✓'} 标注避让取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
