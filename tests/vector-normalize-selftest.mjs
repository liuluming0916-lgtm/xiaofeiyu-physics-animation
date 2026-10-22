#!/usr/bin/env node
/**
 * 「矢量长度按类归一」取证（第 8 期 · 用户 2026-10-17 拍板）
 *
 * 用户原话：「箭头长度 = 真实量级 × 比例我很满意，但不能是三个不同的矢量
 * （速度、加速度、力）放在一起，而是**分别比较**。」
 *
 * 落地公式（`computeFramingPlan` + `arrowWorldLength`）：
 *
 *     长度 = (该箭头量级 ÷ 该类整段最大量级) × 该类满量程（画面短边的固定比例）
 *
 * 这一门要证明五件事：
 *   **A 同类可比**：同类两条箭头，长度之比 == 量级之比（精确到浮点误差）。
 *   **B 跨类不混**：三类的比例各自独立（拿力的量级去算速度的箭头必然拿到另一个数）。
 *   **C 满量程按类不同**：力最长、速度次之、加速度最短（70:60:50 的初衷）。
 *   **D 极小画点**：量级为 0 ⇒ 世界长度为 0（渲染器据此画点，**不放大**）。
 *   **E 包络一致**：包络里用的箭头长度与画出来的一致（不一致会让相机莫名缩放）。
 *   **F 真题目**：15 道题都能算出比例，且满量程不会把画面撑爆。
 *
 * 用法：node tests/vector-normalize-selftest.mjs
 */

import { PROJECT_ROOT, isCliEntry } from '../tools/paths.mjs';
import {
  ARROW_MAX_VIEWPORT_RATIO,
  ARROW_MIN_PX,
  CommandBuffer,
  VECTOR_TARGET_PX,
  arrowLengthPx,
  computeFramingPlan,
} from '../sdk/runtime/animation-runtime.mjs';
import { loadQuestions } from '../core/dryrun/run-suite.mjs';
import { renderQuestion } from './harness/canvas-harness.mjs';

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

/**
 * 造一个**最小的假 program**：`computeFramingPlan` 只用
 * `SIM.duration` / `stateAt` / `drawFrame` / `buffer` 四样东西，
 * 所以不需要真的走沙箱装配（那样会因为槽位契约把用例写得很脆）。
 */
function fakeProgram(drawFrame) {
  const buffer = new CommandBuffer();
  return {
    SIM: { duration: 1 },
    buffer,
    stateAt: () => ({}),
    drawFrame: (t) => {
      buffer.reset();
      drawFrame(t, (rec) => buffer.push(rec));
    },
    readouts: () => [],
  };
}

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

async function main() {
  console.log('矢量长度按类归一取证（第 8 期）\n');

  /* ══ A 同类可比 ══ */
  console.log('『A』同一类：长度之比 == 量级之比');

  const program = fakeProgram((t, push) => {
    // 速度：前半段 1、后半段 2（整段最大 = 2）
    push({ op: 'arrow', from: [0, 0], vec: [1, 0], mag: t < 0.5 ? 1 : 2, category: 'velocity', scale: 1 });
    // 力：恒定 4（整段最大 = 4）
    push({ op: 'arrow', from: [0, 1], vec: [0, 1], mag: 4, category: 'force', scale: 1 });
    // 加速度：恒为 0（考"极小画点"）
    push({ op: 'arrow', from: [0, 2], vec: [1, 0], mag: 0, category: 'acceleration', scale: 1 });
    // 一个很小的实体（给"不含箭头的包络"一个尺寸）
    push({ op: 'polygon', points: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] });
  });

  const plan = computeFramingPlan(program, { samples: 20 });

  check('★ 算出了速度与力的归一比例', typeof plan.vectorScale.velocity === 'number' && typeof plan.vectorScale.force === 'number');
  check('加速度整段为 0 ⇒ 没有给比例（不产生 NaN）', plan.vectorScale.acceleration === undefined);

  {
    const small = { op: 'arrow', from: [0, 0], vec: [1, 0], mag: 1, category: 'velocity', scale: 1 };
    const big = { ...small, mag: 2 };
    const l1 = arrowLengthPx(small, plan.maxMag);
    const l2 = arrowLengthPx(big, plan.maxMag);
    check('★ 量级 1 : 2 ⇒ 长度严格 1 : 2', near(l2 / l1, 2, 1e-9), `${l1} vs ${l2}`);
  }

  /* ══ B 跨类不混 ══ */
  console.log('\n『B』跨类：各用各自的比例，互不影响');

  {
    const v = arrowLengthPx({ vec: [1, 0], mag: 2, category: 'velocity' }, plan.maxMag);
    const f = arrowLengthPx({ vec: [1, 0], mag: 4, category: 'force' }, plan.maxMag);
    check('★ 同为"该类最大值"，但两类满量程不同 ⇒ 长度不同', !near(v, f, 1e-6), `velocity=${v.toFixed(4)} force=${f.toFixed(4)}`);

    // 拿速度的比例去算一根"力"的箭头 ⇒ 数字与用力自己的比例不同（证明比例是按类取的）
    const fAsV = arrowLengthPx({ vec: [1, 0], mag: 4, category: 'velocity' }, plan.maxMag);
    check('同一个量级换一类算 ⇒ 结果不同（比例确实是按类取的）', !near(fAsV, f, 1e-9));
  }

  /* ══ C 满量程按类 ══ */
  console.log('\n『C』满量程：力 70px > 速度 60px > 加速度 50px（名义 960×540）');

  {
    check('满量程常量符合"力最长、加速度最短"', VECTOR_TARGET_PX.force > VECTOR_TARGET_PX.velocity && VECTOR_TARGET_PX.velocity > VECTOR_TARGET_PX.acceleration);
    const ns = plan.nominalScale;
    check('算出了名义相机比例（用来把像素换算成世界单位）', Number.isFinite(ns) && ns > 0);

    // 满量程（该类最大量级那根）折算回像素，应当≈该类目标像素
    const fullF = plan.vectorScale.force * plan.maxMag.force * ns;
    const fullV = plan.vectorScale.velocity * plan.maxMag.velocity * ns;
    check('★ 力的满量程 ≈ 70px', near(fullF, VECTOR_TARGET_PX.force, 1e-6), `${fullF.toFixed(3)}px`);
    check('★ 速度的满量程 ≈ 60px', near(fullV, VECTOR_TARGET_PX.velocity, 1e-6), `${fullV.toFixed(3)}px`);
    check('力的满量程确实比速度长', fullF > fullV);
  }

  /* ══ D 极小画点 ══ */
  console.log('\n『D』量级为 0 ⇒ 长度为 0（渲染器据此画点，不放大）');

  {
    const zero = { op: 'arrow', from: [0, 0], vec: [1, 0], mag: 0, category: 'velocity', scale: 1 };
    check('★ 长度为 0', arrowLengthPx(zero, plan.maxMag) === 0);
    check('点阈值是个小常数（不是"放大到可见"那种大数）', ARROW_MIN_PX > 0 && ARROW_MIN_PX <= 8, String(ARROW_MIN_PX));
  }

  /* ══ E 取景：箭头**不参与** ══ */
  console.log('\n『E』取景只由实体决定，箭头再长也不改相机');

  {
    const p2 = fakeProgram((t, push) => {
      push({ op: 'arrow', from: [0, 0], vec: [1, 0], mag: 1, category: 'velocity', scale: 1 });
      push({ op: 'polygon', points: [[-0.05, -0.05], [0.05, -0.05], [0.05, 0.05], [-0.05, 0.05]] });
    });
    const pl2 = computeFramingPlan(p2, { samples: 8 });
    const len = arrowLengthPx({ vec: [1, 0], mag: 1, category: 'velocity' }, pl2.maxMag);

    // 这个用例的实体很小（0.1 见方），相机因此离得很近 ⇒ 110px 折算成的世界长度也小。
    // 所以只断言"算出来了"，重点在下面"取景没有被箭头撑大"。
    check('箭头长度算出来了（正数）', len > 0, String(len));
    check('★ 取景框**没有**被箭头撑大（右边界 = 实体右边界）', near(pl2.envelope.maxX, 0.05, 1e-9), `maxX=${pl2.envelope.maxX}`);
    check('★ 但包络函数本身仍认得箭头（口径没丢，只是取景不用它）', (() => {
      /**
       * ⚠ 第 8 期改了这条的写法。原来比的是"含箭头的右边界 > 实体右边界"，
       * 但箭头长度是**按像素**给的（满量程 110 px）：相机一收紧，同样的像素折算出的世界长度就变小，
       * 于是"箭头伸不出实体"—— 比较会因为比例而假失败。而且单支箭头的长度是由"该类最大值"归一的，
       * 加一支更长的也不会更长（分子分母一起变），所以靠"加长箭头"绕不过去。
       * 正确判据：**只有箭头时，包络函数必须认得出它**（去掉箭头后包络为空）。
       */
      const p3 = fakeProgram((t, push) => {
        push({ op: 'arrow', from: [0, 0], vec: [1, 0], mag: 1, category: 'velocity', scale: 1 });
      });
      p3.drawFrame(0, () => {});
      const onlyArrow = p3.buffer.envelope({ vectorScale: pl2.vectorScale });
      const noArrow = p3.buffer.envelope({ vectorScale: pl2.vectorScale, excludeOps: ['arrow'] });
      return onlyArrow !== null && onlyArrow.maxX > 0 && noArrow === null;
    })());

    check('防出画面有上限常量，且不小于 0.3（不然箭头会被缩得太狠）', ARROW_MAX_VIEWPORT_RATIO >= 0.3 && ARROW_MAX_VIEWPORT_RATIO <= 0.6);
  }

  /* ══ G 端到端：画到画布上的线段长度 == 满量程 − 箭头头 ══ */
  console.log('\n『G』端到端：画布上真的画出了那么长的线段');

  {
    /**
     * ⚠ 这一节是为了钉住一个**只看得见、测不到**的 bug：
     *   第一版把"世界单位的长度"直接加在了"屏幕像素坐标"上，
     *   于是 130px 的箭头实际只画了 ≈2px（看着就是个点），
     *   而**所有只看 `arrowLengthPx()` 的断言都是绿的** —— 它们只验算数，不验画。
     *
     * 所以这里直接量画布：把 mock canvas 的 `moveTo → lineTo` 配对成线段，
     * 断言"确实存在一条 ≈ 满量程 − 箭头头 的线"。
     */
    const questions = await loadQuestions(['q01']);
    const { player, canvas } = renderQuestion(questions[0].program);
    player.state.t = 0.89;
    canvas.__calls.length = 0;
    const out = player.render();

    const segs = [];
    let last = null;
    for (const c of canvas.__calls) {
      if (c.op === 'moveTo') last = c.args;
      else if (c.op === 'lineTo') {
        if (last) segs.push(Math.hypot(c.args[0] - last[0], c.args[1] - last[1]));
        last = null;
      }
    }

    const maxMag = player.framing.maxMag;
    const expects = out.records
      .filter((r) => r.op === 'arrow')
      .map((r) => {
        const len = arrowLengthPx(r, maxMag);
        const head = Math.min(11, Math.max(6, len * 0.3));
        return len - head;
      })
      .filter((n) => n > 0);

    check('本帧有箭头', expects.length > 0);
    check(
      '★ 每根箭头的"杆长"都在画布上出现了（误差 < 1.5px）',
      expects.every((want) => segs.some((got) => Math.abs(got - want) < 1.5)),
      `期望 ${expects.map((n) => n.toFixed(1)).join('/')} · 画布最大线段 ${Math.max(...segs).toFixed(1)}`,
    );
    check('★ 最长的箭头杆 > 60px（不会再"看着像个点"）', Math.max(...expects) > 60, `${Math.max(...expects).toFixed(1)}px`);
  }
  /* ══ H 覆盖率：模型手画的 35 根箭头**全都**给了 mag；v/a 已移交运行时 ══ */
  console.log('\n『H』覆盖率：每一根模型手画箭头都带真实量级');

  {
    /**
     * 为什么单列一条：归一化的分母是"该类最大量级"。如果某根箭头没给 mag，
     * 它就退回 `|vec|` —— 而 `|vec|` 里可能被作者乘过系数（q05 曾经是 0.55 与 0.16），
     * 于是"同类可比"就**悄悄失效**了。这种失效肉眼看不出来，只能靠覆盖率钉住。
     */
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('./regression-15/', import.meta.url);
    let total = 0;
    let withMag = 0;
    let kinematic = 0;
    const missing = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.mjs')).sort()) {
      const text = readFileSync(new URL(f, dir), 'utf8');
      if (/category:\s*'(velocity|acceleration)'/.test(text)) kinematic += 1;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!/Draw\.arrow\(/.test(lines[i])) continue;
        let buf = lines[i];
        let depth = (buf.match(/\(/g) ?? []).length - (buf.match(/\)/g) ?? []).length;
        for (let j = i + 1; depth > 0 && j < lines.length && j - i < 12; j += 1) {
          buf += '\n' + lines[j];
          depth += (lines[j].match(/\(/g) ?? []).length - (lines[j].match(/\)/g) ?? []).length;
        }
        total += 1;
        if (/\bmag\s*:/.test(buf)) withMag += 1;
        else missing.push(`${f}:${i + 1}`);
      }
    }

    console.log(`      箭头 ${total} 根 · 带 mag ${withMag} 根`);
    check('★ 每根箭头都给了 mag（不补的话"同类可比"会悄悄失效）', total > 0 && withMag === total, `缺：${missing.join(', ')}`);
    /* v1.1.9：62 − 28 根 v/a = 35 根（force/aux）。数量变化是迁移，不是漏画。 */
    check('模型手画箭头 = 35（force/aux）', total === 35, String(total));
    check('★ 15 道题里没有一处手写 v/a 箭头（已移交 SIM.bodies）', kinematic === 0, `${kinematic} 个文件仍有`);
  }

  console.log('\n『F』15 道真题：都能算出比例，且不撑爆取景');

  {
    const questions = await loadQuestions();
    check('拿到 15 道回归题', questions.length === 15);

    // ⚠ 回归题文件导出的是**槽位源码**（字符串），不是装配好的 program。
    //   所以必须走一次真装配（`renderQuestion` 内部就是干这个的），
    //   直接把它塞进 `computeFramingPlan` 会因为"没有 SIM/stateAt"当场抛错。
    const rows = [];
    for (const { program: qp } of questions) {
      const { player } = renderQuestion(qp);
      rows.push({ id: qp.id.replace(/-.*/, ''), vs: player.vectorScale ?? {}, framing: player.framing ?? null });
    }

    const withScale = rows.filter((r) => Object.keys(r.vs).length > 0);
    // 没有箭头的那道题本来就拿不到比例（这是对的，不是漏算）
    const noArrows = rows.filter((r) => Object.keys(r.framing?.maxMag ?? {}).length === 0);
    console.log(`      算出比例的题：${withScale.length} / ${rows.length}${noArrows.length ? `（无箭头的题：${noArrows.map((r) => r.id).join(', ')}）` : ''}`);

    check('★ 有箭头的题都拿到了比例', rows.filter((r) => Object.keys(r.framing?.maxMag ?? {}).length > 0).every((r) => Object.keys(r.vs).length > 0));
    check('没有箭头的题确实一道都没有（用来解释上面那条的数量差）', noArrows.length === rows.length - withScale.length);
    check(
      '每类比例都是正的有限数（没有 NaN / 0 / 负数）',
      rows.every((r) => Object.values(r.vs).every((k) => Number.isFinite(k) && k > 0)),
    );
    check('每题都算出了取景框', rows.every((r) => r.framing?.envelope && Number.isFinite(r.framing.envelope.maxX)));
    check(
      '★ 每类的满量程都等于该类目标像素（名义视口下），不会撑爆取景',
      rows.every((r) => {
        const ns = r.framing?.nominalScale ?? 0;
        if (!(ns > 0)) return true;
        return Object.entries(r.vs).every(([cat, k]) => {
          const px = k * (r.framing.maxMag[cat] ?? 0) * ns;
          return Math.abs(px - (VECTOR_TARGET_PX[cat] ?? 0)) <= 1e-6;
        });
      }),
    );
  }

  /* ══ H 取景口径（第 8 期 · 用户 2026-10-18 裁决：只修算法，不改模型规矩） ══ */
  console.log('\n『I』取景：标注与参考面不许决定画幅；Nice Numbers 不许缩小画面');

  {
    const { AutoView } = await import('../sdk/runtime/animation-runtime.mjs');

    // 实体在 [-0.5, 0.5]，但旁边有一条"铺出画面"的地面 + 两条停在远处的公式标注
    const p = fakeProgram((t, push) => {
      push({ op: 'polygon', points: [[-0.5, 0], [0.5, 0], [0.5, 0.3], [-0.5, 0.3]] });
      push({ op: 'polygon', points: [[-40, 0], [40, 0]], hatch: 'below', closed: false }); // 地面（参考面）
      push({ op: 'dimension', x1: -38, y1: 0.5, x2: -37, y2: 0.5, kind: 'linear' });
    });
    const plan = computeFramingPlan(p, { samples: 4 });
    check(
      '★ 取景包络只算实体：地面（hatch）与 dimension 都不参与',
      near(plan.envelope.minX, -0.5, 1e-9) && near(plan.envelope.maxX, 0.5, 1e-9) && near(plan.envelope.maxY, 0.3, 1e-9),
      JSON.stringify(plan.envelope),
    );
    check(
      '★ 但这些命令仍在缓冲里（只是不参与取景，画还是要画）',
      p.drawFrame(0, () => {}) === undefined &&
        p.buffer.records.some((r) => r.op === 'dimension') &&
        p.buffer.records.some((r) => r.op === 'polygon' && r.hatch),
    );

    // Nice Numbers：scale 必须就是"理想 fit"，不许被吸附改小
    const tf = AutoView.fit({ minX: -2, minY: 0, maxX: 1.14, maxY: 1.39 }, { width: 960, height: 540 });
    const padding = 0.14;
    const ideal = Math.min(
      (960 * (1 - 2 * padding)) / 3.14,
      (540 * (1 - 2 * padding)) / 1.39,
    );
    check(
      '★★ scale == 理想 fit（吸附只许给网格步长，不许缩小画面）',
      Math.abs(tf.scale - ideal) < 1e-9,
      `scale=${tf.scale} ideal=${ideal} niceFit=${tf.niceFit}`,
    );
    check(
      '旧口径确实更小（这条钉住"我们扔了多少"，防止有人把吸附偷偷加回来）',
      tf.niceFit > 0 && tf.niceFit < tf.scale - 1e-9,
      `niceFit=${tf.niceFit} scale=${tf.scale}`,
    );
    check('网格步长提示仍然给出（渲染层要用）', tf.gridX > 0 && tf.gridY > 0);

  }

  console.log(`\n${failures.length ? '✗' : '✓'} 矢量按类归一取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
