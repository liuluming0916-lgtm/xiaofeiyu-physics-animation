/**
 * ㊻ 虚线参数口径取证（第 9 期 · 用户 2026-10-19 定稿）
 *
 * 约定：
 *   · `dash: true`  → 默认虚线（记录里是 [4, 3]）
 *   · `dash: false` / 不写 → 实线（记录里是 null）
 *   · `dash: [n, m]` → 自定义间距（只接受有限正数）
 *   · 其它类型 → Draw 当场抛 TypeError（C1 也会静态拦字面量里的明显错误）
 *
 * 为什么这条必须单独钉：
 *   真实浏览器的 `setLineDash` 只收 `sequence<number>`。模型曾写 `dash: true`，
 *   旧运行时原样塞给浏览器 ⇒ TypeError ⇒ 整帧中断，页面停在 0.00 / 0.00。
 *   这里用一个**严格**的假 ctx（setLineDash 非数组就抛）跑真实的 `replayToCanvas`，
 *   保证"记录 → 浏览器绘制"这条链路不再有同类静默崩。
 */

import {
  AutoView,
  CommandBuffer,
  Draw,
  replayToCanvas,
} from '../sdk/runtime/animation-runtime.mjs';

let failed = 0;
let total = 0;

function check(label, fn) {
  total += 1;
  try {
    const detail = fn();
    console.log(`  ✓ ${label}${detail ? `（${detail}）` : ''}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${label}：${err?.message ?? err}`);
  }
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}：期望 ${e}，实际 ${a}`);
}

function makeDraw() {
  const buffer = new CommandBuffer();
  return { buffer, draw: new Draw(buffer) };
}

/** 严格假 ctx：setLineDash 只接受有限数字数组（与真实浏览器同口径） */
function strictCtx() {
  const seen = [];
  const state = {};
  const ctx = new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'setLineDash') {
          return (arg) => {
            if (!Array.isArray(arg) || arg.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
              throw new TypeError(`setLineDash 只接受有限数字数组，收到 ${String(arg)}`);
            }
            seen.push(arg);
          };
        }
        if (key === 'measureText') return () => ({ width: 10 });
        if (key in state) return state[key];
        return () => {};
      },
      set(_t, key, value) {
        state[key] = value;
        return true;
      },
    },
  );
  return { ctx, seen };
}

function replay(records) {
  const { ctx, seen } = strictCtx();
  const transform = AutoView.fit({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { width: 400, height: 300 });
  replayToCanvas(ctx, records, transform, { grid: false });
  return seen;
}

console.log('dash-selftest · 虚线参数口径');

console.log('\n『A』记录层：true / false / 数组 → 规范化');
check('dash: true → [4, 3]', () => {
  const { buffer, draw } = makeDraw();
  const rec = draw.line([0, 0], [1, 1], { dash: true });
  eq(rec.dash, [4, 3], 'line.dash');
  return 'line';
});
check('dash: false → null（实线）', () => {
  const { buffer, draw } = makeDraw();
  eq(draw.line([0, 0], [1, 1], { dash: false }).dash, null, 'line.dash');
});
check('不写 dash → null（实线）', () => {
  const { buffer, draw } = makeDraw();
  eq(draw.line([0, 0], [1, 1]).dash, null, 'line.dash');
});
check('dash: [2, 5] → 原样保留', () => {
  const { buffer, draw } = makeDraw();
  eq(draw.line([0, 0], [1, 1], { dash: [2, 5] }).dash, [2, 5], 'line.dash');
});
check('curve / arc / ray / chart 同样认 dash: true', () => {
  const { buffer, draw } = makeDraw();
  eq(draw.curve([[0, 0], [1, 1]], { dash: true }).dash, [4, 3], 'curve.dash');
  eq(draw.arc([0, 0], 0.5, 0, 90, { dash: true }).dash, [4, 3], 'arc.dash');
  eq(draw.ray([0, 0], [1, 1], { dash: true }).dash, [4, 3], 'ray.dash');
  eq(draw.chart([[0, 0], [1, 1]], { dash: true }).dash, [4, 3], 'chart.dash');
});
check('Draw.trace 默认仍是虚线（数组）', () => {
  const { buffer, draw } = makeDraw();
  eq(draw.trace([[0, 0], [1, 1]]).dash, [6, 4], 'trace.dash');
});

console.log('\n『B』非法类型：当场抛错（C1 静态层也会拦字面量）');
for (const bad of ['dashed', 3, {}, [0, 3], [3, -1], [3, NaN]]) {
  check(`dash: ${JSON.stringify(bad)} → 抛错`, () => {
    const { buffer, draw } = makeDraw();
    try {
      draw.line([0, 0], [1, 1], { dash: bad });
    } catch (err) {
      if (!/dash/.test(String(err.message))) throw new Error(`错误信息没点名 dash：${err.message}`);
      return err.message.slice(0, 40);
    }
    throw new Error('没有抛错');
  });
}

console.log('\n『C』真实绘制链路：setLineDash 永远收到数字数组');
check('dash: true 的 line → replay 收到 [4, 3]', () => {
  const { buffer, draw } = makeDraw();
  draw.line([0, 0], [1, 1], { dash: true });
  const seen = replay(buffer.records);
  if (!seen.some((a) => JSON.stringify(a) === '[4,3]')) throw new Error(`没看到 [4,3]：${JSON.stringify(seen)}`);
  return JSON.stringify(seen);
});
check('老记录里的 dash: true（绕过 Draw）→ 保险按实线，绝不崩', () => {
  const seen = replay([{ op: 'line', x1: 0, y1: 0, x2: 1, y2: 1, dash: true, width: 1, color: '#000' }]);
  if (!seen.every((a) => Array.isArray(a))) throw new Error('出现非数组');
  return '已降级为实线';
});

if (failed) {
  console.log(`\n✗ 虚线口径取证失败 ${failed}/${total} 条`);
  process.exitCode = 1;
} else {
  console.log(`\n✓ 虚线口径取证通过 ${total} 条（true=虚线 / false=实线 / 数组=自定义 / 非法类型抛错）`);
}

export async function main() {
  // CLI 入口已经在模块顶层跑完；这里保留 main 以兼容 verify-all 的同进程回退模式
}
