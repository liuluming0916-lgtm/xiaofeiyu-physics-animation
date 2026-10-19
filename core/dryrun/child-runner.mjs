#!/usr/bin/env node
/**
 * Dry-Run 子进程执行体。
 *
 * 为什么是子进程而不是 `vm.Script`：第 1 期要拿到**硬终止**。
 * 父进程 (`core/dryrun/dry-run.mjs`) 用 `spawnSync(timeout)` 起它，
 * 超时/内存爆炸时直接 kill；槽位作用域里没有 require / process / DOM / 网络。
 * 第 2 期把它换成 `worker_threads` + `node:vm` + `resourceLimits`（§6.3），本文件即是升级位。
 *
 * 协议：stdin 收 JSON 载荷；stdout 末行输出 `__OD_SCAN__<json>`。
 * 逐帧数据以 NDJSON 流式写 stdout（先写完全部扫描数据，再写结果行），
 * 这样即使扫描中途崩溃，父进程也已经拿到崩溃前的帧（用于 C3/C4 的诊断）。
 */

import {
  buildProgramSource,
  resolveDuration,
  normalizeReadouts,
  emitKinematicArrows,
  PhysRef,
  CommandBuffer,
  Draw,
} from '../../sdk/runtime/animation-runtime.mjs';

const MARKER = '__OD_SCAN__';

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function errorOf(err, phase) {
  const message = String(err?.message ?? err);
  const isTimeout = /timed? ?out/i.test(message);
  return {
    phase,
    kind: isTimeout ? 'timeout' : 'runtime',
    name: err?.name ?? 'Error',
    message,
    line: null,
    column: null,
    /** 第 8 期：装配期抛的错自带归属（例如 VIEW），别让诊断去猜 */
    ...(err && err.odSlot ? { odSlot: err.odSlot } : {}),
    ...(err && err.odRule ? { odRule: err.odRule } : {}),
  };
}

function summarize(program, duration) {
  const sim = program.SIM;
  return {
    MODE: program.MODE,
    SIM: sim
      ? {
          duration: sim.duration,
          axes: sim.axes ?? null,
          /* v1.1.9：bodies 的 `at` 是函数，JSON 化会把它丢掉；报告里只留 id，判据在 VM 内跑。 */
          bodies: Array.isArray(sim.bodies) ? sim.bodies.map((b) => ({ id: b?.id ?? null, label: b?.label ?? null })) : null,
          phases: Array.isArray(sim.phases) ? sim.phases : null,
        }
      : null,
    PROBLEM: typeof program.PROBLEM === 'string' ? program.PROBLEM.slice(0, 2000) : '',
    STEPS: program.STEPS ?? null,
    ANSWERS: program.ANSWERS ?? null,
    contextKeys: Object.keys(program.context ?? {}),
  };
}

async function main() {
  const started = Date.now();
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    process.stdout.write(`\n${MARKER}${JSON.stringify({ error: errorOf(err, 'payload'), frameCount: 0 })}\n`);
    return;
  }

  const { slots, mode = 'NUMERIC', dt = 1 / 240, timeoutMs = 4000, maxFrames = 200000 } = payload;
  const budgetMs = Date.now() + timeoutMs;

  const emit = (obj) => {
    process.stdout.write(`${MARKER}${JSON.stringify(obj)}\n`);
  };

  let program;
  try {
    const assembly = buildProgramSource(slots, { mode });
    const factory = new Function(`return (${assembly});`)();
    program = factory({ CommandBuffer, Draw, PhysRef });
  } catch (err) {
    emit({ error: errorOf(err, 'assembly'), frameCount: 0, wallClockMs: Date.now() - started });
    return;
  }

  try {
    program.setup(program.buffer, program.Draw, { CommandBuffer, Draw, PhysRef });
  } catch (err) {
    emit({ error: errorOf(err, 'setup'), frameCount: 0, wallClockMs: Date.now() - started, program: summarize(program, null) });
    return;
  }

  let duration;
  try {
    duration = resolveDuration(program);
  } catch (err) {
    emit({ error: errorOf(err, 'duration'), frameCount: 0, wallClockMs: Date.now() - started, program: summarize(program, null) });
    return;
  }

  const frames = [];
  const readoutSeries = [];
  let count = 0;
  const rt = { CommandBuffer, Draw, PhysRef };

  for (let t = 0; t <= duration + 1e-9; t += dt) {
    count += 1;
    if (count > maxFrames || Date.now() > budgetMs) {
      emit({
        error: {
          phase: 'scan',
          kind: count > maxFrames ? 'step-budget' : 'timeout',
          message: count > maxFrames ? `步数超过预算 ${maxFrames}（C2）` : `固定步长扫描超过墙钟预算 ${timeoutMs} ms（C2），已跑 ${count - 1} 步`,
        },
        frameCount: count - 1,
        wallClockMs: Date.now() - started,
        frames,
        readoutSeries,
        duration,
        steps: program.STEPS ?? [],
        answers: program.ANSWERS ?? [],
        program: summarize(program, duration),
      });
      return;
    }

    const time = Math.min(t, duration);
    try {
      const state = program.stateAt(time, program.buffer, program.Draw, rt);
      program.buffer.reset();
      program.drawFrame(time, state, program.buffer, program.Draw, rt);
      /* v1.1.9：与 sampleFrame / render 共用同一个注入函数（Worker 后端也必须画本地 v/a）。 */
      emitKinematicArrows(program, time);
      const records = program.buffer.records.map(stripFns);
      const readouts = normalizeReadouts(program.readouts(time, state, program.buffer, program.Draw, rt));
      frames.push({ t: time, state: stripState(state), records, envelope: program.buffer.envelope(), commandCount: records.length });
      readoutSeries.push({ t: time, readouts });
    } catch (err) {
      emit({
        error: errorOf(err, `scan@t=${time.toFixed(4)}`),
        frameCount: count,
        wallClockMs: Date.now() - started,
        frames,
        readoutSeries,
        duration,
        steps: program.STEPS ?? [],
        answers: program.ANSWERS ?? [],
        program: summarize(program, duration),
      });
      return;
    }
  }

  emit({
    error: null,
    frameCount: count,
    wallClockMs: Date.now() - started,
    frames,
    readoutSeries,
    duration,
    steps: program.STEPS ?? [],
    answers: program.ANSWERS ?? [],
    program: summarize(program, duration),
  });
}

/** 命令记录里的 `raw.fn` 不可序列化，只保留可检查的字段 */
function stripFns(rec) {
  if (rec.op !== 'raw') return rec;
  const { fn, ...rest } = rec;
  return { ...rest, serializable: false };
}

function stripState(state) {
  if (!state || typeof state !== 'object') return state;
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (typeof v === 'function') continue;
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'number');
    else if (v && typeof v === 'object') {
      const nested = {};
      for (const [kk, vv] of Object.entries(v)) if (typeof vv === 'number' || typeof vv === 'boolean' || vv === null) nested[kk] = vv;
      out[k] = nested;
    }
  }
  return out;
}

main().catch((err) => {
  process.stdout.write(`\n${MARKER}${JSON.stringify({ error: errorOf(err, 'child'), frameCount: 0 })}\n`);
});
