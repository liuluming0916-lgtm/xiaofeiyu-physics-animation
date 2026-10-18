/**
 * 诊断重放（第 2 期）：把某个槽位**单独**用快照埋点重跑几次，拿回"每一行的绑定取值"。
 *
 * 用途只有一个——把 C3 / C6 的"某个数不对"翻译成"**哪一行**写出来的"：
 *   · 第一次出现非有限值的那一行（C3）；
 *   · 边界两侧取值不同时，最后一次改写该绑定的那一行（C6）。
 *
 * 三条实现约束：
 *   ① **只重放，不判据**：重放结果不改变任何检查的通过/失败，判据仍是 C1–C9 本身；
 *   ② **只在确有失败时才跑**，且**绝不在超时/超内存之后跑**——那类代码的 `stateAt` 本来就会卡住；
 *   ③ 采样在 `vm` 里跑并通过 `runInContext({timeout})` 兜底，父进程不会被一次诊断拖死。
 */

import { Script } from 'node:vm';

import * as Runtime from '../../sdk/runtime/animation-runtime.mjs';
import { assembleInstrumented } from '../lint/slot-instrument.mjs';
import { createSlotContext } from './vm-context.mjs';

/** 可以在重放里直接调用的槽位（`setup` 只跑一次） */
export const TRACEABLE_SLOTS = Object.freeze(['setup', 'stateAt', 'drawFrame', 'readouts']);

/**
 * @param {object} input
 * @param {object} input.slots 8 键名槽位（原文，未埋点）
 * @param {string} input.slot  要重放的槽位
 * @param {number[]} input.times 采样时刻
 * @param {string} [input.mode]
 * @param {number} [input.timeoutMs]
 * @returns {{ok:boolean, duration?:number, samples?:Array<{t:number,snapshots:Array<{line:number,values:object|null}>,value:any,error:string|null}>, error?:string}}
 */
export function traceSlot(input) {
  const { slots, slot, times = [], mode = 'NUMERIC', timeoutMs = 2000 } = input;
  if (!TRACEABLE_SLOTS.includes(slot)) return { ok: false, error: `槽位 ${slot} 不支持重放` };

  let assembled;
  try {
    assembled = assembleInstrumented(slots, { mode: 'snapshot', programMode: mode, only: [slot] });
  } catch (err) {
    return { ok: false, error: `装配失败：${String(err?.message ?? err)}` };
  }

  let bucket = [];
  const ctx = createSlotContext({
    __src: assembled.source,
    __factory: null,
    __out: null,
    __duration: null,
    __times: times,
    __slot: slot,
    __odMark: () => {},
    __odSnap: (slotIndex, line, values) => {
      let captured = null;
      let error = null;
      try {
        captured = typeof values === 'function' ? values() : values;
      } catch (err) {
        // 块级 TDZ 等：丢这一次快照即可，但把原因留下来（不然诊断会静默降级成"候选行"）
        error = String(err?.message ?? err);
      }
      bucket.push({ line, values: captured, error });
    },
    __odSnapReset: () => {
      bucket = [];
    },
    __odSnapTake: () => bucket.slice(),
    __resolveDuration: Runtime.resolveDuration,
    __normalizeReadouts: Runtime.normalizeReadouts,
  });

  const driver = [
    // 装配源码是**函数声明**：整段求值后取 `buildProgram` 本体（不调用它，避免 VIEW 跑两遍）
    assembled.source,
    '__factory = buildProgram;',
    'var __p = __factory(runtime);',
    '__p.setup();',
    '__duration = __resolveDuration(__p);',
    '__p.context.at = function (tt) { return __p.stateAt(tt); };',
    '__p.context.duration = __duration;',
    '__out = [];',
    'for (var i = 0; i < __times.length; i += 1) {',
    '  var t = __times[i];',
    '  __odSnapReset();',
    '  var value = null, error = null;',
    '  try {',
    "    if (__slot === 'setup') { __p.setup(); }",
    "    else if (__slot === 'stateAt') { value = __p.stateAt(t); }",
    "    else if (__slot === 'drawFrame') { __p.drawFrame(t, __p.stateAt(t)); }",
    "    else if (__slot === 'readouts') { value = __normalizeReadouts(__p.readouts(t, __p.stateAt(t))); }",
    '  } catch (e) { error = String(e && e.message ? e.message : e); }',
    '  __out.push({ t: t, snapshots: __odSnapTake(), value: value, error: error });',
    '}',
  ].join('\n');

  try {
    const script = new Script(driver, { filename: `${slot}.trace.js` });
    // 运行时的形状与沙箱一致：`runnerBundle` 只多两个探针
    ctx.runtime = Runtime.runnerBundle({ __odMark: ctx.__odMark, __odSnap: ctx.__odSnap });
    script.runInContext(ctx, { timeout: timeoutMs, displayErrors: true });
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }

  return { ok: true, duration: ctx.__duration, samples: ctx.__out ?? [] };
}
