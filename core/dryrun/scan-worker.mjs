#!/usr/bin/env node
/**
 * Worker 执行体（§6.3 第二道门）—— 第 2 期把 Dry-Run 从"主线程合作式超时"升级为**硬终止**。
 *
 * 为什么必须是 Worker：`vm.Script` 的 `timeout` 只能在**语句边界**中断，一段
 * `while (tt < 1e9) { tt += 1e-9; }` 这类循环恰好卡在同一个语句里，合作式超时形同虚设；
 * 只有 `worker.terminate()` 能把 CPU 真正抢回来。再加 `resourceLimits.maxOldGenerationSizeMb`
 * 拿到内存硬上限，于是**超时 / 超内存 / 被 kill 三态可区分**。
 *
 * 硬终止有个天然代价：进程被杀之后内存里什么都没了，连"卡在哪一行"都拿不到。
 * 解法是 `SharedArrayBuffer`：`__odMark` 每执行到一个语句就把行号写进共享内存，
 * Worker 被杀后父进程**照样读得到最后一行**（见 `tools/_worker-probe.mjs` 的取证）。
 *
 * 采样逻辑**一律复用** `sdk/runtime/animation-runtime.mjs` 的
 * `instantiate / sampleFrame / scanAll`——它们同时被浏览器播放器使用，
 * 因此"校验过的 = 屏幕上看到的"（§13.1）不靠约定，靠同一份实现。
 * 本文件只负责：装配埋点、开 vm 上下文、调用上面那三个函数、序列化结果。
 */

import { parentPort, workerData } from 'node:worker_threads';
import { Script } from 'node:vm';

import * as Runtime from '../../sdk/runtime/animation-runtime.mjs';
import { assembleInstrumented, PROBE_SLOTS } from '../lint/slot-instrument.mjs';
import { createSlotContext } from './vm-context.mjs';

const data = workerData ?? {};

/** 把埋点写进共享内存的探针实现（父进程在 terminate 后读回） */
const probe = Runtime.createProbeSink({ shared: data.sab ?? null });

/**
 * 带行号戳的命令缓冲：`Draw.*` 全部经 `buffer.push` 落记录，
 * 因此只覆盖这一个方法就能让**每条绘制命令**回指 drawFrame 的源码行，不必给 19 个 op 各包一层。
 */
function tracedBundle() {
  class TracedCommandBuffer extends Runtime.CommandBuffer {
    push(record) {
      const cur = probe.peek();
      if (cur) {
        record.__slot = cur.slot;
        record.__line = cur.line;
      }
      return super.push(record);
    }
  }
  return {
    CommandBuffer: TracedCommandBuffer,
    Draw: Runtime.Draw,
    PhysRef: Runtime.PhysRef,
    __odMark: (slotIndex, line) => probe.mark(slotIndex, line),
    __odSnap: (slotIndex, line, values) => probe.snap(slotIndex, line, values),
  };
}

/** 当前排点 → `{slot, line}`（`slot` 用槽位名，不是下标） */
function here() {
  const cur = probe.peek();
  if (!cur) return null;
  return { slot: PROBE_SLOTS[cur.slot] ?? null, line: cur.line, slotIndex: cur.slot };
}

function errorOf(err, phase) {
  const message = String(err?.message ?? err);
  return {
    phase,
    kind: /timed? ?out/i.test(message) ? 'timeout' : 'runtime',
    name: err?.name ?? 'Error',
    message,
    where: here(),
    /** 第 8 期：装配期抛的错可能已经有明确归属（例如 VIEW），别让诊断猜成 setup */
    ...(err && err.odSlot ? { odSlot: err.odSlot } : {}),
    ...(err && err.odRule ? { odRule: err.odRule } : {}),
  };
}

function stripRaw(rec) {
  if (!rec || rec.op !== 'raw') return rec;
  const { fn, ...rest } = rec;
  return { ...rest, serializable: false };
}

function stripState(state) {
  if (!state || typeof state !== 'object') return state;
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'number');
    else if (v && typeof v === 'object') {
      const nested = {};
      for (const [kk, vv] of Object.entries(v)) {
        if (typeof vv === 'number' || typeof vv === 'boolean' || typeof vv === 'string' || vv === null) nested[kk] = vv;
      }
      out[k] = nested;
    }
  }
  return out;
}

function summarize(program) {
  const sim = program?.SIM;
  let serializedSim = null;
  if (sim && typeof sim === 'object') {
    serializedSim = {};
    for (const [k, v] of Object.entries(sim)) {
      if (v === null || ['number', 'string', 'boolean'].includes(typeof v)) serializedSim[k] = v;
      else {
        try {
          serializedSim[k] = JSON.parse(JSON.stringify(v));
        } catch {
          /* 不可序列化的键跳过 */
        }
      }
    }
  }
  return {
    MODE: program?.MODE,
    SIM: serializedSim,
    PROBLEM: typeof program?.PROBLEM === 'string' ? program.PROBLEM.slice(0, 2000) : '',
    STEPS: program?.STEPS ?? null,
    ANSWERS: program?.ANSWERS ?? null,
    contextKeys: Object.keys(program?.context ?? {}),
  };
}

function main() {
  const started = Date.now();
  const { slots, mode = 'NUMERIC', dt = 1 / 240, maxFrames = 200000, entry = 'program' } = data;
  let phase = 'assembly';
  let duration = NaN;
  let program = null;

  const fail = (err) => {
    parentPort.postMessage({
      ok: false,
      error: errorOf(err, phase),
      wallClockMs: Date.now() - started,
      frameCount: 0,
      frames: [],
      readoutSeries: [],
      duration: Number.isFinite(duration) ? duration : null,
      steps: program?.STEPS ?? [],
      answers: program?.ANSWERS ?? [],
      program: program ? summarize(program) : null,
      lineMapEntries: lineMap?.entries ?? null,
      truncated: null,
    });
  };

  let lineMap = null;
  try {
    // ① 装配 + 埋点（行数逐字不变，因此"第 N 行"就是作者看到的第 N 行）
    const assembled = assembleInstrumented(slots, { mode, programMode: mode });
    lineMap = assembled.lineMap;

    // ② vm 新上下文里取出工厂函数（槽位作用域只有纯函数全局）
    //    装配源码是**函数声明**：在 vm 里求值后直接取 `buildProgram` 本体，
    //    不调用它——否则 VIEW/setup 会被执行两遍（第 1 期用 `new Function` 包了一层，
    //    拿到的是"制造工厂的工厂"，两层调用很容易写错）。
    phase = 'compile';
    const ctx = createSlotContext({ __src: assembled.source, __factory: null });
    new Script(`${assembled.source}\n__factory = buildProgram;`, { filename: `${entry}.factory.js` }).runInContext(ctx, {
      timeout: 5000,
    });
    const factory = ctx.__factory;

    // ③ 复用**唯一**的执行器：instantiate（setup + 只读探针）→ scanAll（固定步长全时段）
    phase = 'setup';
    const inst = Runtime.instantiate(factory, { runner: tracedBundle() });
    program = inst.program;
    duration = inst.duration;

    phase = 'scan';
    const scan = Runtime.scanAll(program, { dt, maxFrames, budgetMs: Infinity });

    const frames = [];
    const readoutSeries = [];
    for (const frame of scan.frames) {
      frames.push({
        t: frame.t,
        state: stripState(frame.state),
        records: frame.records.map(stripRaw),
        envelope: frame.envelope,
        commandCount: frame.commandCount,
      });
      readoutSeries.push({ t: frame.t, readouts: frame.readouts ?? [] });
    }

    parentPort.postMessage({
      ok: true,
      error: null,
      wallClockMs: Date.now() - started,
      frameCount: frames.length,
      frames,
      readoutSeries,
      duration,
      steps: program.STEPS ?? [],
      answers: program.ANSWERS ?? [],
      program: summarize(program),
      lineMapEntries: lineMap.entries,
      truncated: scan.truncated ?? null,
    });
  } catch (err) {
    fail(err);
  }
}

main();
