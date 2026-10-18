/**
 * Dry-Run 校验器（§7.1 / §7.2）。
 *
 * 一次 Dry-Run 产出四件套（§7.5）：
 *   ① 校验报告（C1–C9 + Draw.raw 使用记录）
 *   ② 图表数据序列（readouts 全时段采样）
 *   ③ AutoView 包络（第一遍）
 *   ④ **关键帧**（第 3 期补齐；见报告里的 `keyframes`）
 *
 * ── 关于关键帧的诚实说明（第 3 期）
 *
 * §7.5 给它的用途写的是"步骤边界画面，供'上一步/下一步'秒跳"。
 * 但要如实说明：本项目里**秒跳本来就已经是 O(1)** —— `stateAt(t)` 被 C1 强制为 O(1)
 * （查表或解析式），相机由 AutoView 一次定死，没有任何跨帧缓存。
 * 因此关键帧**不是播放性能的必需品**，它的真实价值有两处：
 *
 *   1. **一份不依赖 `stateAt` 重算的画面存档**：步骤边界那一刻的 `state` / `records` /
 *      `readouts` 被固化下来，后续做导出（GIF/WebM 的关键帧对齐）、
 *      缩略图、"这一帧到底画了什么"的事后排查时不必再跑一遍程序；
 *   2. **让"每一步边界都画得出东西"成为可机检的事**：某个步骤边界若命令数为 0，
 *      通常意味着那一步的 `stateAt` 分支写漏了——这在只看总量的判据里看不出来。
 *
 * 所以本实现**不夸大**：它是"复用同一次 Dry-Run 的产物"（§14 的要求），
 * 而不是"为了秒跳必须先有它"。
 *
 * 执行后端（第 2 期，§6.3 / §18 期 2）：
 *   主路径 = `worker_threads` + `node:vm` + `resourceLimits` + **硬终止**（`worker-sandbox.mjs`）；
 *   回退   = 同进程 `node:vm` + `vm.Script` 墙钟超时（第 1 期口径，Worker 起不来时用）。
 *   两条路径共用 `sdk/runtime` 的 `instantiate / sampleFrame / scanAll`，判据完全一致，
 *   差异只记录在报告的 `execution.backend` 里。
 *
 * 判据本身（C1–C9）是 §7.2 冻结项，第 2 期**一条都没有改**；本期的增量是：
 *   · C2 能区分"超时 / 超内存 / 步数预算 / 崩溃"，并给出**最后执行到的行**；
 *   · C3/C4/C5/C6 的失败项全部挂上 `diagnostics[]`（槽位 + 行号 + 证据强度）；
 *   · 新增两条**扩展检查** X1 / X2（与 C10 同款，`blocking:false`，不动冻结口径）。
 */

import { Script } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as Runtime from '../../sdk/runtime/animation-runtime.mjs';
import { emptyLabelAvoid } from '../../sdk/runtime/label-avoid.mjs';
import { planLabelLayout } from './label-avoid.mjs';
import { lintProgram } from '../lint/contract-lint.mjs';
import { createSlotContext } from './vm-context.mjs';
import { runScanInWorker } from './worker-sandbox.mjs';
import { traceSlot } from './trace.mjs';
import {
  checkContextKeyCollision,
  checkDrawRawUsage,
  dataSlotLines,
  diag,
  differingBindings,
  firstNonFinite,
  lastWriteOf,
  locateReadoutEntry,
  locateSlotKeyWrites,
} from './diagnostics.mjs';
import {
  CHECK_IDS,
  CHECK_SEVERITY,
  DRY_RUN_BUDGET,
  ANSWERS_DEFAULT_TOL,
} from '../../contracts/spec/frozen-keys.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 第 1 期就写好的子进程执行体（保留；Worker 是第 2 期的主路径） */
export const CHILD_RUNNER = join(HERE, 'child-runner.mjs');
const CHILD_RESULT_MARKER = '__OD_SCAN__';
void CHILD_RESULT_MARKER;

/** 第 2 期：Dry-Run 的执行后端，报告里如实标注 */
export const EXECUTION_BACKENDS = Object.freeze(['worker', 'vm-fallback']);

/* ─────────────────────────── 沙箱执行 ─────────────────────────── */

function makeSandbox(runtimeBundle) {
  return createSlotContext({ __odRuntime: runtimeBundle, runtime: runtimeBundle });
}

/** 沙箱内可见的 API 集合（模板页复用同一份，保证"所见即所导"§13.1） */
export function makeRuntimeBundle() {
  return {
    CommandBuffer: Runtime.CommandBuffer,
    Draw: Runtime.Draw,
    PhysRef: Runtime.PhysRef,
    AutoView: Runtime.AutoView,
    interp: Runtime.interp,
    roots: Runtime.roots,
    integrate: Runtime.integrate,
    format: Runtime.format,
    replayToCanvas: Runtime.replayToCanvas,
    resolveDuration: Runtime.resolveDuration,
    normalizeReadouts: Runtime.normalizeReadouts,
    buildProgramSource: Runtime.buildProgramSource,
    normalizeDataSlot: Runtime.normalizeDataSlot,
  };
}

/* ─────────────────── 第 2 期：Worker 后端（主路径） ─────────────────── */

/**
 * 在 Worker 沙箱里执行一次扫描，并把它规整成与 `executeProgram` 同形的结果。
 *
 * 与回退路径的差别只有隔离强度与终止方式；**采样逻辑完全同一份**
 * （`scan-worker.mjs` 调的是 `Runtime.instantiate / scanAll`）。
 *
 * 关键收益：Worker 被硬终止后，父进程仍能从 `SharedArrayBuffer` 读到
 * "最后执行到的槽位与行号"——死循环因此也有行号级诊断（`budget.lastMark`）。
 */
export async function executeProgramInWorker(slots, opts = {}) {
  const started = Date.now();
  const dt = opts.dt ?? DRY_RUN_BUDGET.dt;
  const maxFrames = opts.maxFrames ?? 200000;
  const mode = opts.mode ?? 'NUMERIC';

  const res = await runScanInWorker(
    { slots, mode, dt, maxFrames, entry: opts.entry ?? 'program' },
    {
      wallClockMs: opts.timeoutMs ?? DRY_RUN_BUDGET.wallClockMs,
      maxOldGenerationSizeMb: opts.maxOldGenerationSizeMb,
      // 第 3 期：把外部取消信号透传给 Worker（§21.1 第 3 条"取消后无残留 worker"）
      ...(opts.signal ? { signal: opts.signal } : {}),
    },
  );

  const empty = (extra = {}) => ({
    program: null,
    error: null,
    wallClockMs: res.wallClockMs ?? Date.now() - started,
    frameCount: 0,
    frames: [],
    readoutSeries: [],
    duration: NaN,
    dt,
    steps: [],
    answers: [],
    slots,
    stateAt: () => null,
    backend: 'worker',
    available: res.available !== false,
    budget: res.budget ?? null,
    truncated: res.truncated ?? null,
    ...extra,
  });

  if (res.available === false) return empty({ available: false, error: res.error ?? null });

  // 终止类结果（超时 / 超内存 / 崩溃）没有完整帧数据，但仍要如实带回：
  // 已经跑出来的那部分帧对定位"从第几帧开始不对"很有用（与第 1 期子进程执行体的口径一致）。
  if (res.error) {
    const where = res.error.where ?? res.budget?.lastMark ?? null;
    return empty({
      error: { ...res.error, where, line: where?.line ?? null, slot: where?.slot ?? null },
      frameCount: res.frameCount ?? 0,
      frames: res.frames ?? [],
      readoutSeries: res.readoutSeries ?? [],
      duration: Number.isFinite(res.duration) ? res.duration : NaN,
      steps: res.steps ?? [],
      answers: res.answers ?? [],
      program: res.program ?? null,
    });
  }

  return {
    program: res.program ?? null,
    error: null,
    wallClockMs: res.wallClockMs,
    frameCount: res.frameCount ?? 0,
    frames: res.frames ?? [],
    readoutSeries: res.readoutSeries ?? [],
    duration: Number.isFinite(res.duration) ? res.duration : NaN,
    dt,
    steps: res.program?.STEPS ?? res.steps ?? [],
    answers: res.program?.ANSWERS ?? res.answers ?? [],
    slots,
    simContinuityKeys: res.program?.SIM?.continuityKeys ?? null,
    stateAt: makeStateProbe(slots, mode),
    backend: 'worker',
    available: true,
    budget: res.budget ?? null,
    truncated: res.truncated ?? null,
    lineMapEntries: res.lineMapEntries ?? null,
  };
}

/* ─────────────────────────── 沙箱执行 ─────────────────────────── */

/**
 * 执行一次 AnimationProgram（**回退路径**：同进程 `node:vm` + 墙钟超时）。
 *
 * 第 1 期的口径保留在此，用于 Worker 起不来的环境（例如宿主禁止 `worker_threads`）。
 * 与 Worker 路径的差别只在"谁能把 CPU 抢回来"：这里的超时依赖 `vm.Script` 的
 * 语句边界中断，对"卡在同一语句里的死循环"无能为力——这正是第 2 期把它降为回退的原因。
 *
 * 判据 C1–C9 与执行后端无关：换后端只换本函数。
 * @returns {{program:object|null, error:object|null, wallClockMs:number, frameCount:number, frames:Array, readoutSeries:Array, duration:number, steps:Array, answers:Array}}
 */
export function executeProgram(slots, opts = {}) {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? DRY_RUN_BUDGET.wallClockMs;
  const dt = opts.dt ?? DRY_RUN_BUDGET.dt;
  const maxFrames = opts.maxFrames ?? 200000;
  const mode = opts.mode ?? 'NUMERIC';

  const empty = (extra = {}) => ({
    program: null,
    error: null,
    wallClockMs: Date.now() - started,
    frameCount: 0,
    frames: [],
    readoutSeries: [],
    duration: NaN,
    dt,
    steps: [],
    answers: [],
    stateAt: () => null,
    slots,
    backend: 'vm-fallback',
    available: true,
    budget: null,
    truncated: null,
    ...extra,
  });

  let assembly;
  try {
    // 先装配（此时数据型槽位仍是内部占位符），再在驱动脚本里替换。
    // 注意：不能把带占位符的源码直接塞进模板字面量再替换，否则注入的数据会被再次扫描。
    const raw = Runtime.buildProgramSource(slots, { mode });
    assembly = replaceTokens(raw, slots);
  } catch (err) {
    return empty({ error: normalizeError(err, 'assembly') });
  }

  const sandbox = makeSandbox(makeRuntimeBundle());
  // ⚠ 装配源码含 LaTeX 反斜杠，**绝不能**拼进模板字面量（`\u` 会被当转义）。
  // 一律用 bindings 把字符串传进沙箱，由沙箱里的 new Function 编译。
  const driver = [
    // 装配源码是「函数声明」，不是表达式：用 `return (…)` 包起来会报 "Unexpected token ';'"。
    'var __makeFactory = new Function("runtime", __odAssembly + "\\nreturn buildProgram;");',
    '__odScanResult = (function scan(runtime){',
    'var out = { frames: [], readoutSeries: [] };',
    'try {',
    '  var __factory = __makeFactory(runtime);',
    /* 第 8 期：装配期抛的错（例如 VIEW 写错）要**自带归属**，否则诊断会指到 setup 第 0 行 */
    '  var __odErr = function (e, phase) { var o = { phase: phase, kind: "runtime", message: String(e && e.message ? e.message : e) }; if (e && e.odSlot) o.odSlot = e.odSlot; if (e && e.odRule) o.odRule = e.odRule; return o; };',
    '  var program;',
    '  try { program = __factory(runtime); }',
    "  catch (e) { out.error = __odErr(e, 'view'); return out; }",
    '  try { program.setup(program.buffer, program.Draw, runtime); }',
    "  catch (e) { out.error = __odErr(e, 'setup'); return out; }",
    '  var duration;',
    '  try { duration = runtime.resolveDuration(program); }',
    "  catch (e) { out.error = __odErr(e, 'duration'); return out; }",
    '  out.duration = duration;',
    '  /* 与播放器同一份初始化：注入只读探针与时长（context 是被闭包捕获的那个对象） */',
    '  program.context.at = function (tt) { return program.stateAt(tt); };',
    '  program.context.duration = duration;',
    '  var count = 0;',
    '  for (var t = 0; t <= duration + 1e-9; t += ' + dt + ') {',
    '    count += 1;',
    '    if (count > ' + maxFrames + ') {',
    "      out.error = { phase: 'scan', kind: 'step-budget', message: '步数超过预算 " + maxFrames + "（C2）' };",
    '      break;',
    '    }',
    '    var time = Math.min(t, duration);',
    '    var state, readouts;',
    '    try {',
    '      state = program.stateAt(time);',
    '      program.buffer.reset();',
    '      program.drawFrame(time, state);',
    '      readouts = runtime.normalizeReadouts(program.readouts(time, state));',
    '    } catch (e) {',
    "      out.error = { phase: 'scan@t=' + time.toFixed(4), kind: 'runtime', message: String(e && e.message ? e.message : e) };",
    '      break;',
    '    }',
    '    var records = program.buffer.records.map(stripRaw);',
    '    out.frames.push({ t: time, state: stripState(state), records: records, envelope: program.buffer.envelope(), commandCount: records.length });',
    '    out.readoutSeries.push({ t: time, readouts: readouts });',
    '  }',
    '  out.frameCount = count;',
    '  out.program = summarize(program);',
    '  return out;',
    '} catch (e) {',
    "  out.error = { phase: 'fatal', kind: 'runtime', message: String(e && e.message ? e.message : e) };",
    '  return out;',
    '}',
    '',
    'function stripRaw(rec) {',
    "  if (!rec || rec.op !== 'raw') return rec;",
    '  var copy = {};',
    "  for (var k in rec) { if (k !== 'fn') copy[k] = rec[k]; }",
    '  copy.serializable = false;',
    '  return copy;',
    '}',
    '',
    'function stripState(state) {',
    "  if (!state || typeof state !== 'object') return state;",
    '  var o = {};',
    '  for (var k in state) {',
    '    var v = state[k];',
    "    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v === null) o[k] = v;",
    "    else if (Object.prototype.toString.call(v) === '[object Array]') o[k] = v.filter(function (x) { return typeof x === 'number'; });",
    "    else if (v && typeof v === 'object') {",
    '      var n = {};',
    "      for (var kk in v) { if (typeof v[kk] === 'number' || typeof v[kk] === 'boolean' || v[kk] === null) n[kk] = v[kk]; }",
    '      o[k] = n;',
    '    }',
    '  }',
    '  return o;',
    '}',
    '',
    'function summarize(program) {',
    '  return {',
    '    MODE: program.MODE,',
    '    SIM: serializeSim(program.SIM),',
    "    PROBLEM: typeof program.PROBLEM === 'string' ? program.PROBLEM.slice(0, 2000) : '',",
    '    STEPS: program.STEPS || null,',
    '    ANSWERS: program.ANSWERS || null,',
    '    contextKeys: Object.keys(program.context || {})',
    '  };',
    '}',
    '/* SIM 是模型可扩展的视图配置（duration / axes / continuityKeys / regions / …）。',
    '   这里把其中**可 JSON 序列化**的部分整份带出来，避免每加一个字段就要改一次驱动。 */',
    'function serializeSim(sim) {',
    '  if (!sim || typeof sim !== "object") return null;',
    '  var out = {};',
    '  for (var k in sim) {',
    '    var v = sim[k];',
    '    if (v === null || typeof v === "number" || typeof v === "string" || typeof v === "boolean") { out[k] = v; continue; }',
    '    if (typeof v !== "object") continue;',
    '    try { out[k] = JSON.parse(JSON.stringify(v)); } catch (e) { /* 不可序列化的键跳过 */ }',
    '  }',
    '  return out;',
    '}',
    '})(__odRuntime);',
  ].join('\n');

  sandbox.__odAssembly = assembly;

  let scan;
  try {
    const script = new Script(driver, { filename: `${opts.entry ?? 'program'}.dryrun.js` });
    script.runInContext(sandbox, { timeout: timeoutMs, displayErrors: true });
    scan = sandbox.__odScanResult ?? { frames: [], readoutSeries: [], error: { phase: 'driver', kind: 'crash', message: '驱动脚本未产出结果' } };
  } catch (err) {
    const isTimeout = err?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
    return empty({
      error: {
        phase: 'scan',
        kind: isTimeout ? 'timeout' : 'runtime',
        name: err?.name ?? 'Error',
        message: isTimeout
          ? `Dry-Run 超过墙钟预算 ${timeoutMs} ms，已硬终止（C2）`
          : String(err?.message ?? err),
      },
    });
  }
  sandbox.__odAssembly = null;

  return {
    program: scan.program ?? null,
    error: scan.error ?? null,
    wallClockMs: Date.now() - started,
    frameCount: scan.frameCount ?? 0,
    frames: scan.frames ?? [],
    readoutSeries: scan.readoutSeries ?? [],
    duration: Number.isFinite(scan.duration) ? scan.duration : NaN,
    dt,
    steps: scan.program?.STEPS ?? [],
    answers: scan.program?.ANSWERS ?? [],
    /** VIEW 槽位可选声明：哪些状态分量承载"位置"，供 C6 精确判定（§7.2 C6 比的是位置） */
    simContinuityKeys: scan.program?.SIM?.continuityKeys ?? null,
    /** C6 的边界探测：同一 realm 里重建一份只读程序（setup 会再执行一次，计入 observations） */
    stateAt: makeStateProbe(slots, mode),
    slots,
    backend: 'vm-fallback',
    available: true,
    budget: {
      kind: scan.error?.kind === 'step-budget' ? 'step-budget' : scan.error ? 'crash' : 'completed',
      limitMs: timeoutMs,
      lastMark: null,
    },
    truncated: scan.error?.kind === 'step-budget' ? 'step-budget' : null,
  };
}

/**
 * 把装配源码里的数据型槽位占位符替换成实际值（复用运行时的唯一实现）。
 */
function replaceTokens(source, slots) {
  return Runtime.replaceDataSlotTokens(source, slots);
}

/**
 * C6 需要在任意 t 上取状态，而扫描只有固定步长采样。
 * 这里按同一份槽位代码重建一个只读实例（不推命令、不渲染），只用于 `t0/t1 ± ε` 探测。
 * 重建次数固定为 1，不进入 C2 的扫描预算口径。
 */
function makeStateProbe(slots, mode) {
  let program = null;
  return (t) => {
    if (!program) {
      const assembly = replaceTokens(Runtime.buildProgramSource(slots, { mode }), slots);
      // eslint-disable-next-line no-new-func
      const factory = new Function('runtime', `${assembly}\nreturn buildProgram;`)(makeRuntimeBundle());
      program = factory(makeRuntimeBundle());
      program.setup(program.buffer, program.Draw, makeRuntimeBundle());    }
    return program.stateAt(t, program.buffer, program.Draw, makeRuntimeBundle());
  };
}

function safeDuration(program) {
  try {
    return { value: Runtime.resolveDuration(program) };
  } catch (err) {
    return { error: normalizeError(err, 'duration') };
  }
}

function normalizeError(err, phase) {
  return {
    phase,
    kind: err?.name === 'RangeError' && /timeout/i.test(String(err.message)) ? 'timeout' : 'runtime',
    name: err?.name ?? 'Error',
    message: String(err?.message ?? err),
    line: null,
    column: null,
    /** 第 8 期：装配期抛的错自带归属（VIEW 等），透传出去让诊断指对槽位 */
    ...(err && err.odSlot ? { odSlot: err.odSlot } : {}),
    ...(err && err.odRule ? { odRule: err.odRule } : {}),
  };
}

/* ─────────────────────────── 逐项检查 ─────────────────────────── */

function finiteOrNull(v) {
  return v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v));
}

/** 一条检查的结果骨架 */
function result(id, ok, detail, extra = {}) {
  return {
    id,
    severity: CHECK_SEVERITY[id],
    status: ok ? 'pass' : 'fail',
    blocking: CHECK_SEVERITY[id] === 'blocking',
    detail,
    ...extra,
  };
}

/** C3 数值有限性：所有 readouts 值与所有命令坐标必须有限（§7.2） */
function checkFinite(run) {
  const offenders = [];
  const coordKeys = {
    line: ['x1', 'y1', 'x2', 'y2'],
    polygon: 'points',
    circle: ['cx', 'cy', 'r'],
    spring: ['a', 'b'],
    pulley: ['c', 'r'],
    belt: ['a', 'b', 'r'],
    fieldDots: ['x', 'y', 'w', 'h'],
    dimension: ['x1', 'y1', 'x2', 'y2'],
    arc: ['cx', 'cy', 'r', 'a0Deg', 'a1Deg'],
    curve: 'points',
    ray: ['x1', 'y1', 'x2', 'y2'],
    lens: ['x1', 'y1', 'x2', 'y2', 'height', 'focal'],
    axisBox: ['x', 'y', 'xLen', 'yLen'],
    chart: 'data',
    text: ['x', 'y', 'size'],
    latex: ['x', 'y', 'size'],
    arrow: ['from', 'vec', 'scale'],
  };

  /**
   * ⚠ 第 8 期：**空壳不许通过**（用户真题 export-20261018-115238-713）。
   *
   * 那份产物把四个代码槽位都写成 `function readouts(t, state) { … }`，装配后再套一层 ⇒
   * `stateAt` 返回 undefined ⇒ 帧里没有 state、readouts 没有一项、命令 0 条。
   * 而旧 C3 只逐条判"有限"：**零条目天然有限**，于是 C3 报"所有值均有限"。
   * 这种通过比失败更危险。所以先判"有没有东西可查"。
   */
  const stateHasNumbers = run.frames.some(
    (f) => f.state && typeof f.state === 'object' && Object.values(f.state).some((v) => typeof v === 'number' && Number.isFinite(v)),
  );
  const totalCommands = run.frames.reduce((n, f) => n + (f.records?.length ?? 0), 0);
  const totalReadouts = run.readoutSeries.reduce((n, p) => n + (p.readouts?.length ?? 0), 0);
  /**
   * ⚠ 只判**结构性空壳**：既没有数值 state、又没画一条命令、也没有一条读数。
   * 不判"state 里没有数"这种更弱的情况 —— 静态几何元件（地面/斜面/支架）本来就可以
   * 一个 state 字段都不读（实测：只判这个会让 31 条元件画法里的 6 条被冤枉）。
   */
  const isEmptyShell = run.frames.length > 0 && !stateHasNumbers && totalCommands === 0 && totalReadouts === 0;
  if (isEmptyShell) {
    return result(
      'C3',
      false,
      'stateAt(t) 全程没有返回任何数值分量（state 是 undefined 或空对象）—— 检查 stateAt 是否忘了 return',
      {
        offenders: [
          {
            t: 0,
            slot: 'stateAt',
            reason: 'state 没有任何数值分量（C3）',
            snippet:
              '每帧 state 都是 undefined/空对象：常见原因是槽位里多写了 function 外壳（外层返回 undefined），' +
              '或 return 语句写在了 if 分支里、而分支没命中',
          },
        ],
      },
    );
  }

  // readouts 值与命令坐标都要有限（§7.2 C3）
  for (const point of run.readoutSeries) {
    for (const r of point.readouts) {
      if (!finiteOrNull(r.value)) {
        offenders.push({
          t: Number(point.t.toFixed(4)),
          slot: 'readouts',
          key: r.key,
          where: 'value',
          detail: `${r.label || r.key} = ${String(r.value)}`,
          reason: 'readouts 值非有限（C3）',
          snippet: `readouts(t=${point.t.toFixed(4)}) → ${r.label || r.key} = ${String(r.value)}`,
        });
      }
    }
    if (offenders.length > 8) break;
  }

  for (const [frameIndex, frame] of run.frames.entries()) {
    for (const [recordIndex, rec] of frame.records.entries()) {
      const spec = coordKeys[rec.op];
      if (!spec) continue;
      const stamp = { recordIndex, frameIndex, op: rec.op, line: Number.isFinite(rec.__line) ? rec.__line : null, slot: rec.__slot !== undefined ? 'drawFrame' : null };
      if (spec === 'points' || spec === 'data') {
        const arr = rec[spec] ?? [];
        for (const [x, y] of arr) {
          if (!finiteOrNull(x) || !finiteOrNull(y)) {
            offenders.push({
              t: Number(frame.t.toFixed(4)),
              slot: 'drawFrame',
              key: rec.op,
              where: spec,
              ...stamp,
              detail: `${rec.op} 坐标非有限：[${String(x)}, ${String(y)}]`,
              reason: '命令坐标非有限（C3）',
              snippet: `drawFrame(t=${frame.t.toFixed(4)}) → ${rec.op} ${spec}[…] = [${String(x)}, ${String(y)}]`,
            });
            break;
          }
        }
        continue;
      }
      for (const key of spec) {
        const v = rec[key];
        if (Array.isArray(v)) {
          if (!v.every(finiteOrNull)) {
            offenders.push({
              t: Number(frame.t.toFixed(4)),
              slot: 'drawFrame',
              key,
              where: `${rec.op}.${key}`,
              ...stamp,
              detail: `${rec.op}.${key} 非有限：[${v.map(String).join(', ')}]`,
              reason: '命令坐标非有限（C3）',
              snippet: `drawFrame(t=${frame.t.toFixed(4)}) → ${rec.op}.${key} = [${v.map(String).join(', ')}]`,
            });
          }
        } else if (!finiteOrNull(v)) {
          offenders.push({
            t: Number(frame.t.toFixed(4)),
            slot: 'drawFrame',
            key,
            where: `${rec.op}.${key}`,
            ...stamp,
            detail: `${rec.op}.${key} = ${String(v)}`,
            reason: '命令坐标非有限（C3）',
            snippet: `drawFrame(t=${frame.t.toFixed(4)}) → ${rec.op}.${key} = ${String(v)}`,
          });
        }
      }
    }
    if (offenders.length > 8) break;
  }

  return result(
    'C3',
    offenders.length === 0,
    offenders.length ? `${offenders.length} 处非有限数值（已列前 ${Math.min(8, offenders.length)} 处）` : '所有 readouts 值与命令坐标均有限',
    { offenders: offenders.slice(0, 8) },
  );
}

/**
 * C4 几何合理性：绘制坐标落在世界盒内；相邻帧位移不超阈值（§7.2）。
 *
 * 第 2 期的强化点（判据强度只升不降）：第 1 期的位移阈值是**写死的 1e4 世界单位**——
 * 等于没有判据，任何真实瞬移都拦不住。现在按**实测分布**定阈值：
 *
 *   `阈值 = max(20 × p99(相邻帧画面中心位移), 全程包络跨度的 2%)`
 *
 * 两项各有分工：
 *   · 第一项让"本来就动得快的题"（q03 追及、q08 圆周）不被误伤；
 *   · 第二项给**包络恒定**的题兜底（q10 p–V 图：p99 实测为 0，不能让阈值退化成 0）。
 *
 * ⚠ 阈值定在"整幅画面跨度的 2%/帧"是有意的保守值：C4 判的是"坐标爆炸/瞬移**数量级**"，
 * 阶段边界上那种小尺度位移由 C6 负责（§7.2 的分工）。第 2 期第一版取 0.1%，
 * 结果 q03 在相遇时刻"新增一个标记图元"时被误报——**新元素出现不是位移**，
 * 因此这里同时要求"两帧命令构成一致"才做逐命令归因，阈值也放回 2%。
 */
function checkGeometry(run, opts = {}) {
  const box = opts.worldBox ?? 1e5;
  const offenders = [];

  /**
   * ── 第 8 期：判“位移”必须**只看实体**（用户真题 AEB）──
   *
   * 那份程序在 t≈2.18 被 C4 判红：「画面中心位移 1.05 > 阈值 0.88」。
   * 实际发生了什么？只是 `if (L - x1 > 0.1) Draw.dimension(...)` 这条**标注**不再画了 ——
   * 少一条 dimension，整幅包络的中心就挪了 1 个世界单位，于是被当成“瞬移”。
   *
   * 这与取景那次是同一个教训：**标注与参考面不该参与几何判据**。
   * 现在位移判据用“实体包络”（排除 text / latex / dimension，以及可出血的阴影参考面）；
   * 一条实体都没有时退回原包络（不让判据变成空转）。
   * 世界盒检查仍用**原包络**（坐标越界是真错，与它是不是标注无关）。
   */
  const ANNOTATION_OPS = new Set(['text', 'latex', 'dimension']);
  const geometryEnvelope = (frame) => {
    let acc = null;
    for (const r of frame.records ?? []) {
      if (ANNOTATION_OPS.has(r.op)) continue;
      if (r.op === 'polygon' && r.hatch) continue;
      const b = recordBBox(r);
      if (!b) continue;
      acc = acc
        ? {
            minX: Math.min(acc.minX, b.minX),
            maxX: Math.max(acc.maxX, b.maxX),
            minY: Math.min(acc.minY, b.minY),
            maxY: Math.max(acc.maxY, b.maxY),
          }
        : { ...b };
    }
    return acc ?? frame.envelope ?? null;
  };

  const series = run.frames.filter((f) => f.envelope);
  const geoOf = new Map(run.frames.map((f) => [f, geometryEnvelope(f)]));
  const centroidOf = (env) => ({ x: (env.minX + env.maxX) / 2, y: (env.minY + env.maxY) / 2 });
  const deltas = [];
  for (let i = 1; i < series.length; i += 1) {
    const a = centroidOf(geoOf.get(series[i - 1]) ?? series[i - 1].envelope);
    const b = centroidOf(geoOf.get(series[i]) ?? series[i].envelope);
    deltas.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  const sorted = [...deltas].sort((a, b) => a - b);
  const p99 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : 0;
  const span = unionSpan(series);
  const jump = opts.jumpThreshold ?? Math.max(p99 * 20, span * 0.02, 1e-6);

  let prev = null;
  for (const frame of run.frames) {
    const env = frame.envelope;
    if (env) {
      if (Math.abs(env.minX) > box || Math.abs(env.maxX) > box || Math.abs(env.minY) > box || Math.abs(env.maxY) > box) {
        offenders.push({
          t: Number(frame.t.toFixed(4)),
          frameIndex: run.frames.indexOf(frame),
          reason: '绘制坐标越出世界盒（C4）',
          snippet: `t=${frame.t.toFixed(4)} 包络 minX=${env.minX} maxX=${env.maxX} minY=${env.minY} maxY=${env.maxY}（|·| > ${box}）`,
        });
      }
      const geoEnv = geoOf.get(frame) ?? env;
      const centroid = centroidOf(geoEnv);
      if (prev) {
        const dist = Math.hypot(centroid.x - prev.centroid.x, centroid.y - prev.centroid.y);
        if (dist > jump) {
          const at = attributeJump(prev.frame, frame);
          offenders.push({
            t: Number(frame.t.toFixed(4)),
            frameIndex: run.frames.indexOf(frame),
            ...at,
            reason: '相邻帧画面位移超阈值（C4）',
            snippet:
              `t=${frame.t.toFixed(4)} 画面中心位移 ${dist.toFixed(4)} > 阈值 ${jump.toFixed(4)}（世界单位/帧）` +
              `；逐命令比对：${at.snippet ?? '无可比命令'}`,
          });
        }
      }
      prev = { centroid, frame };
    }
    if (offenders.length > 8) break;
  }

  return result(
    'C4',
    offenders.length === 0,
    offenders.length
      ? `${offenders.length} 处几何异常`
      : `绘制坐标落在世界盒 ±${box} 内，单帧画面位移未超 ${jump.toPrecision(4)}（p99 ${p99.toPrecision(3)} × 20，跨度下限 ${(span * 1e-3).toPrecision(3)}）`,
    { offenders: offenders.slice(0, 8), worldBox: box, jumpThreshold: Number(jump.toPrecision(6)), p99, span },
  );
}

/** 全时段所有帧包络的并集跨度（用来给阈值定一个"这题的世界有多大"的下限） */
function unionSpan(series) {
  if (!series.length) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const f of series) {
    minX = Math.min(minX, f.envelope.minX);
    maxX = Math.max(maxX, f.envelope.maxX);
    minY = Math.min(minY, f.envelope.minY);
    maxY = Math.max(maxY, f.envelope.maxY);
  }
  if (!Number.isFinite(minX)) return 0;
  return Math.max(maxX - minX, maxY - minY, 0);
}

/**
 * 逐命令比对相邻两帧，找出**位移最大的那一条**命令，并带上它的行号戳。
 * 这让 C4 的"画面跳了"能落到"drawFrame 第 N 行的这个 Draw.xxx 跳了"。
 *
 * ⚠ 只在两帧**命令构成一致**时才比对：图元增减（某一步的标注/标记出现）会让同序号
 * 的两条命令根本不是同一个东西，硬比会得出"某个 text 位移了 6.3"这种假结论
 * （第 2 期第一版就是这么在 q03 相遇时刻误报的）。
 */
function attributeJump(prevFrame, frame) {
  if (!prevFrame) return {};
  const a = prevFrame.records;
  const b = frame.records;
  const opsA = a.map((r) => r.op).join(',');
  const opsB = b.map((r) => r.op).join(',');
  if (opsA !== opsB) {
    return {
      layoutChanged: true,
      snippet: `两帧命令构成不同（${a.length} → ${b.length} 条，图元有增减），逐命令比对不成立，判据只依据画面中心位移`,
    };
  }
  let best = null;
  for (let i = 0; i < b.length; i += 1) {
    const pa = firstPointOf(a[i]);
    const pb = firstPointOf(b[i]);
    if (!pa || !pb) continue;
    const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    if (!best || d > best.d) best = { d, i, op: b[i].op, line: Number.isFinite(b[i].__line) ? b[i].__line : null, from: pa, to: pb };
  }
  if (!best) return { snippet: '两帧命令里没有可比的坐标点' };
  return {
    recordIndex: best.i,
    op: best.op,
    line: best.line,
    slot: best.line ? 'drawFrame' : null,
    snippet:
      `记录 #${best.i}（${best.op}${best.line ? `，第 ${best.line} 行` : ''}）由 [${best.from.map((v) => Number(v).toFixed(4)).join(', ')}]` +
      ` 移到 [${best.to.map((v) => Number(v).toFixed(4)).join(', ')}]，位移 ${best.d.toFixed(4)}`,
  };
}

/** 取一条命令记录的第一个坐标点（C4 逐命令比对用） */
function firstPointOf(rec) {
  if (!rec) return null;
  if (Array.isArray(rec.from) && rec.from.length >= 2) return rec.from;
  if (typeof rec.x1 === 'number' && typeof rec.y1 === 'number') return [rec.x1, rec.y1];
  if (Array.isArray(rec.points) && rec.points.length) return rec.points[0];
  if (Array.isArray(rec.a) && rec.a.length >= 2) return rec.a;
  if (Array.isArray(rec.c) && rec.c.length >= 2) return rec.c;
  if (typeof rec.cx === 'number' && typeof rec.cy === 'number') return [rec.cx, rec.cy];
  if (typeof rec.x === 'number' && typeof rec.y === 'number') return [rec.x, rec.y];
  return null;
}

/** C5 时间覆盖：STEPS 的 [t0,t1] 无缝、有序、不重叠；duration = 末段 t1（±容差）（§7.2） */
function checkTimeCoverage(run, opts = {}) {
  const steps = run.steps;
  const tol = opts.durationTol ?? 1e-6;
  const offenders = [];

  if (!Array.isArray(steps) || steps.length === 0) {
    return result('C5', false, 'STEPS 不是非空数组（§3.2 ②）', { offenders: [{ reason: 'STEPS 缺失或类型错误', snippet: `STEPS = ${String(steps)}` }] });
  }

  let prev = null;
  steps.forEach((s, i) => {
    const where = `STEPS[${i}]`;
    for (const key of ['title', 'tex', 't0', 't1']) {
      if (s?.[key] === undefined || s?.[key] === null || s?.[key] === '') {
        offenders.push({ reason: `${where} 缺少字段 ${key}`, snippet: `${where} = ${JSON.stringify(s)}`, stepIndex: i, field: key });
      }
    }
    if (!Number.isFinite(s?.t0) || !Number.isFinite(s?.t1)) {
      offenders.push({
        reason: `${where} 的 t0/t1 不是有限数`,
        snippet: `${where}.t0=${s?.t0} ${where}.t1=${s?.t1}`,
        stepIndex: i,
        field: Number.isFinite(s?.t0) ? 't1' : 't0',
      });
      return;
    }
    if (s.t1 <= s.t0) {
      offenders.push({ reason: `${where} 的 t1 ≤ t0`, snippet: `${where}.t0=${s.t0} t1=${s.t1}`, stepIndex: i, field: 't1' });
    }
    if (prev) {
      if (Math.abs(s.t0 - prev.t1) > tol) {
        // 「有缝/重叠」永远算在**后一步的 t0** 上：它就是那个对不上的边界
        offenders.push({
          reason: `${where} 与上一步不衔接（有缝或重叠）`,
          snippet: `上一步 t1=${prev.t1}，本步 t0=${s.t0}，差 ${(s.t0 - prev.t1).toFixed(9)}`,
          stepIndex: i,
          field: 't0',
          prevStepIndex: i - 1,
        });
      }
      if (s.t0 < prev.t0) {
        offenders.push({ reason: `${where} 顺序倒置`, snippet: `${where}.t0=${s.t0} < 上一步 t0=${prev.t0}`, stepIndex: i, field: 't0' });
      }
    }
    prev = s;
  });

  const last = steps[steps.length - 1];
  const duration = run.duration;
  if (Number.isFinite(last?.t1) && Number.isFinite(duration) && Math.abs(last.t1 - duration) > tol) {
    offenders.push({
      reason: 'duration 与末步 t1 不一致',
      snippet: `SIM.duration=${duration} 末步 t1=${last.t1} 差=${Math.abs(last.t1 - duration).toFixed(9)}（容差 ${tol}）`,
      stepIndex: steps.length - 1,
      field: 't1',
      slot: 'VIEW',
    });
  }

  return result(
    'C5',
    offenders.length === 0,
    offenders.length ? `${offenders.length} 处时间覆盖问题` : `${steps.length} 步无缝、有序、不重叠，末步 t1 = duration = ${duration}s`,
    { offenders: offenders.slice(0, 8), stepCount: steps.length, duration },
  );
}

/** C6 步骤边界连续性：在每个 t0/t1 ± ε 比较位置，不得跳变（§7.2） */
function checkBoundaryContinuity(run, opts = {}) {
  const eps = opts.epsilon ?? DRY_RUN_BUDGET.boundaryEpsilon;
  const steps = run.steps;
  if (!Array.isArray(steps) || !run.frames.length) {
    return result('C6', true, 'STEPS 或采样不可用，跳过边界连续性（由 C5 报错）', { offenders: [] });
  }

  const stateAt = (t) => {
    try {
      return run.stateAt(t);
    } catch (err) {
      return { __error: String(err?.message ?? err) };
    }
  };

  /** 把状态摊平成 { 路径: 数值 }，用于逐分量比较 */
  const flatten = (state, prefix = '') => {
    const out = {};
    if (!state || typeof state !== 'object') return out;
    for (const [k, v] of Object.entries(state)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key));
    }
    return out;
  };

  const boundaries = [...new Set([...steps.map((s) => s.t0), ...steps.map((s) => s.t1)])]
    .filter((tb) => tb > eps && tb < run.duration - eps)
    .sort((a, b) => a - b);

  if (!boundaries.length) {
    return result('C6', true, '没有需要检查的内部边界', { offenders: [], epsilon: eps });
  }

  // ① 基准 span：取边界之间的最短一段，作为"量级"参照
  const midOf = (tb, prevT, nextT) => (tb - prevT) / (nextT - prevT);
  const bounds = [0, ...boundaries, run.duration];
  let minSpan = Infinity;
  for (let i = 1; i < bounds.length; i += 1) minSpan = Math.min(minSpan, bounds[i] - bounds[i - 1]);
  const span = Number.isFinite(minSpan) && minSpan > 0 ? minSpan : run.duration;

  /**
   * ② 连续性分量识别（第 8 期再次修正 —— 用户真题两次踩坑后的定稿）
   *
   * §7.2 C6 的原话是"比较**位置**，不得跳变"。所以判据只覆盖**位置类分量**。
   * 物理量在阶段边界**本来就可能阶跃**：加速度 a→0、摩擦力 μmg→0、**碰撞时速度被冲量打断**。
   *
   * ── 第 8 期修掉的误报（用户真题，已复现）──
   *
   * 之前的自动识别只排除"**分段常值**"的量（`flatRatio > 0.5`）。它能排掉 a 与开关量，
   * 却排不掉**匀变速里的速度** —— `vB` 从 20 线性降到 6，每帧都在变、flatRatio≈0，
   * 于是被判成"位置"。结果任何"撞墙 / 碰撞 / 绳突然绷紧"的题，C6 都会红：
   *   实测：位置连续、速度 6→0 的正确程序 ⇒ C6 fail（`continuityKeys: ['x','v']`）。
   *
   * 现在用**三档**，宁可漏判也不冤枉：
   *   ① `SIM.continuityKeys` 显式声明 ⇒ **完全听它的**（作者最清楚哪个键承载位移）；
   *   ② 自动识别先按**名字**排除速率类（`v/vel/speed/omega/w` 与 `a/acc`），
   *      再按"非分段常值"筛（排掉 a、摩擦力、开关量）；
   *   ③ 一个都筛不出来时**明说"没有可判的位置分量"**（`detection:'none'`），
   *      而不是悄悄判 pass 让人以为"查过了"。
   *
   * ⚠ 为什么不做"白名单"（只认 x/s/θ）：位置键名千奇百怪（`xA`/`distB`/`offset`/`phi`），
   *   白名单一定会漏；而"排除速率类"是**有物理依据的封闭集**（长度对时间的一阶/二阶导数）。
   */
  const declared = Array.isArray(run.simContinuityKeys) ? run.simContinuityKeys : null;
  let continuityKeys = declared;
  let detection = 'declared';
  const skippedRateKeys = [];

  if (!declared || !declared.length) {
    detection = 'auto';
    const flatFrames = run.frames.map((f) => flatten(f.state));
    const allKeys = new Set();
    for (const f of flatFrames) for (const k of Object.keys(f)) allKeys.add(k);
    continuityKeys = [];
    for (const key of allKeys) {
      /* ① 速率类直接排除：碰撞时速度必须跳变，判它等于判错 */
      if (isRateLikeKey(key)) {
        skippedRateKeys.push(key);
        continue;
      }
      /* ①′ 时间轴本身不是"位置"：它永远连续，判它只是噪音（还占诊断篇幅） */
      const leafTime = String(key).split('.').pop();
      if (leafTime === 't' || leafTime === 'tt' || leafTime === 'time' || leafTime === 'now') continue;
      let continuous = true;
      let ran = 0;
      let deltas = 0;
      let flats = 0;
      for (let i = 1; i < flatFrames.length; i += 1) {
        const a = flatFrames[i - 1][key];
        const b = flatFrames[i][key];
        if (a === undefined || b === undefined) {
          continuous = false;
          break;
        }
        const d = Math.abs(b - a);
        ran += d;
        deltas += 1;
        if (d <= 1e-12) flats += 1;
      }
      /* 判据（第 2 期修正）：「**分段常值**的量不是位置」。
       *
       * 第 1 期用的是"最大相邻差分 ≤ 总变化量的 25%"，它有个致命副作用：
       * 一旦某个位置分量真的在边界跳变（正是我们要抓的那种 bug），
       * 它自己就会被这条规则**排除出候选集**，C6 于是永远抓不到它——
       * 本期负向注入用例「瞬移」第一次跑就是这么漏掉的（靠 C10 才拦下）。
       *
       * 现在改成看**平台占比**：摩擦力 `μmg → 0`、开关量 `sliding` 这类过程量在每段内是常数，
       * 相邻采样差分绝大多数为 0；而位置类分量每帧都在动。
       * 这个信号与"是否恰好跳变"无关，因此注入的跳变不会把自己洗白。 */
      const flatRatio = deltas ? flats / deltas : 1;
      if (continuous && ran > 1e-9 && flatRatio <= 0.5) continuityKeys.push(key);
    }
    if (!continuityKeys.length) {
      detection = 'none';
      return result(
        'C6',
        true,
        `没有可判的位置类分量（自动识别已排除速率类：${skippedRateKeys.join('、') || '无'}）。` +
          `若确有位移分量，请在 VIEW 里写 SIM.continuityKeys = ['x', …]`,
        { offenders: [], continuityKeys: [], detection, skippedRateKeys },
      );
    }
  }

  const offenders = [];
  const checkedKeys = new Set();
  const rates = keyRates(run);
  for (const tb of boundaries) {
    // 该边界所在的阶段 [t0,t1]
    const step = steps.find((s) => tb >= s.t0 - 1e-12 && tb <= s.t1 + 1e-12) ?? steps[0];
    const idx = steps.indexOf(step);
    const prevT = idx > 0 ? steps[idx - 1].t0 : 0;
    const nextT = idx < steps.length - 1 ? steps[idx + 1].t1 : run.duration;
    const frac = midOf(tb, prevT, nextT);

    const a = flatten(stateAt(tb - eps));
    const b = flatten(stateAt(tb + eps));

    // ③ 阈值：以"该分量在采样序列里实测的最大单步变化率"为基准，再乘 ε 与安全系数。
    // 为什么不能用首末差值估算变化率：简谐量（如弹簧位移）在整段两端可能几乎相等，
    // 但中途经过平衡位置时速率最大；用首末差值会把阈值算得远小于真实速率，造成误报。
    //
    // ⚠ 第 2 期修掉的缺陷：第 1 期这里写的是 `rate * eps * 6 / dt`。
    // `rate` 的单位已经是"状态量/秒"，再乘 ε 就是这一邻域内的**自然位移**；
    // 那个多余的 `/ dt` 把安全系数从 6 倍放大成 6/dt ≈ **1440 倍**，
    // 于是 C6 对慢变量几乎形同虚设——负向注入用例「瞬移」（0.4 m 的边界跳变）
    // 一开始就是这么漏过去的（靠 C10 才拦下）。现在按"6 倍自然位移"的口径。
    const rateLimit = (key) => {
      const rate = rates[key] ?? 0;
      const natural = rate * eps;
      return Math.max(natural * 6, span * 1e-3, 1e-9);
    };

    for (const key of continuityKeys) {
      checkedKeys.add(key);
      if (a[key] === undefined || b[key] === undefined) continue;
      const delta = Math.abs(a[key] - b[key]);
      const limit = rateLimit(key);
      if (delta > limit) {
        offenders.push({
          t: Number(tb.toFixed(4)),
          key,
          before: a[key],
          after: b[key],
          delta,
          reason: `t=${tb.toFixed(4)} 处位置类分量跳变（C6）`,
          snippet: `${key}: stateAt(${(tb - eps).toFixed(6)})=${a[key]} → stateAt(${(tb + eps).toFixed(6)})=${b[key]}，Δ=${delta.toExponential(3)} > 阈值 ${limit.toExponential(3)}（阶段占比 ${frac.toFixed(2)}，最短阶段 ${span.toFixed(3)}s，实测速率 ${(rates[key] ?? 0).toPrecision(3)}/s）`,
        });
        break;
      }
    }
    if (offenders.length > 8) break;
  }

  return result(
    'C6',
    offenders.length === 0,
    offenders.length
      ? `${offenders.length} 个步骤边界存在位置跳变（${[...new Set(offenders.map((o) => o.key))].join('、')}）；判的是：${[...checkedKeys].join('、') || '无'}（速率类已按名字排除）`
      : `${boundaries.length} 个边界在 ±${eps}s 邻域内位置连续（连续性分量：${[...checkedKeys].join('、') || '无'}；识别方式：${detection}）`,
    { offenders: offenders.slice(0, 8), epsilon: eps, continuityKeys: [...checkedKeys], detection, skippedRateKeys },
  );
}

/**
 * 这个状态键是不是**速率类**（速度 / 加速度 / 角速度）？
 *
 * 为什么要按名字判：C6 只准判"位置"，而**碰撞时速度必须跳变**（冲量）。判速度 = 判错。
 * 运行时拿不到单位（state 里只有数），名字是唯一可用的语义信号，所以用一条**封闭的**速率词表：
 *   · 一阶导（速度）：v / vel / velocity / speed
 *   · 二阶导（加速度）：a / acc / accel / acceleration
 *   · 角速度：w / omega
 * 后缀只允许"大写字母 / 下划线 / 数字 / 结束"，于是：
 *   vB / v_A / v0 / aA / a1 / aMax / omega ⇒ 速率类（排除）
 *   angle / xB / distB / offset / phi      ⇒ 不是（照常判）
 * 嵌套路径（car.v）只看最后一段。
 */
const RATE_KEY_RE = /^(?:v|vel|velocity|speed|omega|w|a|acc|accel|acceleration)(?:[A-Z_0-9]|$)/;

export function isRateLikeKey(key) {
  const leaf = String(key ?? '').split('.').pop() ?? '';
  return RATE_KEY_RE.test(leaf);
}

/**
 * 逐分量实测"最大单步变化率"（单位：状态量/秒）。
 *
 * C6 的阈值必须建立在**实测速率**上：位置、角度、相位的变化快慢差几个数量级，
 * 用统一的绝对阈值一定误报；而用首末差值估速率又会被简谐量（两端几乎相等、中途最快）骗过。
 * 因此直接扫全时段相邻采样，取 99 分位单步差分 ÷ dt，作为该分量的速率上界估计。
 */
function keyRates(run) {
  const dt = run.dt ?? 1 / 240;
  /** @type {Record<string, number[]>} */
  const deltas = {};
  let prev = null;
  for (const frame of run.frames) {
    const flat = frame.state && typeof frame.state === 'object' ? frame.state : {};
    if (prev) {
      for (const key of Object.keys(flat)) {
        const a = prev[key];
        const b = flat[key];
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        const d = Math.abs(b - a);
        if (!Number.isFinite(d)) continue;
        (deltas[key] = deltas[key] ?? []).push(d);
      }
    }
    prev = flat;
  }
  const rates = {};
  for (const [key, list] of Object.entries(deltas)) {
    list.sort((a, b) => a - b);
    const p99 = list[Math.min(list.length - 1, Math.floor(list.length * 0.99))] ?? 0;
    rates[key] = p99 / dt;
  }
  return rates;
}

/** 由采样序列估计"典型单帧状态位移"（保留给观测用） */
function typicalStepDelta(run) {
  const samples = [];
  for (const frame of run.frames) {
    const s = frame.state;
    if (!s || typeof s !== 'object') continue;
    const nums = [];
    for (const v of Object.values(s)) {
      if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
    }
    if (nums.length) samples.push(nums);
  }
  if (samples.length < 3) return 1e-3;
  const deltas = [];
  const n = Math.min(samples[0].length, samples[1].length);
  for (let i = 1; i < samples.length; i += 1) {
    for (let j = 0; j < n; j += 1) deltas.push(Math.abs(samples[i][j] - samples[i - 1][j]));
  }
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length * 0.95)] || 1e-3;
}

/**
 * 把 `STEPS` 行式表里声明的时间锚点与 `ANSWERS` 对齐（C7 强化用，第 4 期）。
 *
 * 为什么需要它：C5 只能保证 `STEPS` 自身无缝，管不到"结论声明在 `t=1.0` 复现，
 * 而画面上根本没有 1.0 这一帧"。把锚点算出来，C7 就能对这个差给一句**可回灌**的诊断。
 */
function stepTimes(run) {
  const t0s = (Array.isArray(run?.steps) ? run.steps : []).map((s) => Number(s?.t0)).filter(Number.isFinite);
  return { t0s, t1: Number.isFinite(run?.duration) ? run.duration : null };
}

/**
 * 一个答案条目声明的复现时刻（支持单值与多时刻）。
 *
 * §3.3 冻结形状里 `at_t` 是单个数值；第 4 期做的是**加法**：
 * `at_t` 也可以给数组（`at_t: [1, 3]` 表示"这条结论在多个时刻都应成立"）。
 * 单值路径的解析结果与第 3 期**逐字相同** —— 这是"15 题判定不许变"的前提。
 *
 * @returns {{ok: true, list: number[]} | {ok: false, reason: string, snippet: string}}
 */
function resolveAtTimes(ans, where) {
  const raw = ans?.at_t;
  if (Array.isArray(raw)) {
    if (!raw.length) {
      return { ok: false, reason: `${where}.at_t 是空数组（多时刻写法至少要给一个时刻）`, snippet: JSON.stringify(ans) };
    }
    const bad = raw.findIndex((t) => !Number.isFinite(t));
    if (bad !== -1) {
      return { ok: false, reason: `${where}.at_t[${bad}] 不是有限数（C7 需要它定位复现时刻 §3.3）`, snippet: JSON.stringify(ans) };
    }
    return { ok: true, list: raw.slice() };
  }
  if (!Number.isFinite(raw)) {
    return { ok: false, reason: `${where}.at_t 不是有限数（C7 需要它定位复现时刻 §3.3）`, snippet: JSON.stringify(ans) };
  }
  return { ok: true, list: [raw] };
}

/**
 * 按量级自适应的容差（第 4 期 C7 强化之一）。
 *
 * §3.3 只规定"`tol` 为相对容差，缺省取全局默认（建议 1e-2）"。
 * 第 3 期的式子是 `max(|v|·tol, 1e-6) + |v|·1e-6`，缺陷是**大数上形同没判**：
 * `|v| = 1e6` 而 `tol = 1e-2` 时容差是 1 万 —— "相对误差 1% 就算通过"，
 * 对一个要求"学生看到的数字 = 解析写出的数字"（§7.3）的判据来说太松。
 *
 * 本函数把"声明的容差"按**量级档位**收紧，档位表就是判据本身：
 *
 *   | 期望值量级 | 生效的相对容差 | 理由 |
 *   |---|---|---|
 *   | `< 1e3` | 用条目声明的 `tol`（缺省 1e-2） | 15 题与新题都在这个区间 —— 与第 3 期**逐值一致** |
 *   | `≥ 1e3` | `min(tol, 1e-4)` | 1% 的绝对误差在这种量级上已经不是"同一个数"了 |
 *
 * 另外两项与档位无关：
 *   · **浮点项** `|v| · 1e-6` —— 双精度累积舍入（大数上它才是真实的噪声底）；
 *   · **绝对下限** `1e-6` —— 期望值为 0 或极小时相对容差会消失，必须有它兜底。
 *
 * 三条关键性质（门禁逐值钉住 —— 不钉的话，这只是"我以为它更合理"）：
 *   ① `|v| < 1e3` 时，本函数**恰好等于**第 3 期的式子
 *      ⇒ 15 题的容差逐值不变，"判定逐题一致"因此是**机制保证**而不是运气；
 *   ② `|v| ≥ 1e3` 时，本函数**严格小于** `|v|·1e-2`（名义固定相对容差）；
 *   ③ 本函数**恒 ≤** 第 3 期的式子（档位只会把 `tol` 调小或持平）⇒ 只会更严，绝不更松。
 *
 * ⚠ 第 4 期的第一版把量级项写成与相对项**取 max**，那等于没有收紧
 *   （`max(|v|·1e-2, |v|·1e-4) = |v|·1e-2`）。是门禁里那条"必须严格小于名义容差"
 *   的断言把它逼出来的 —— 写成 max 的"自适应"只是一句好听的话。
 */
export function adaptiveTolerance(value, declaredTol, defaultTol = ANSWERS_DEFAULT_TOL) {
  const abs = Math.abs(value);
  const tol = Number.isFinite(declaredTol) ? declaredTol : defaultTol;
  // 量级档位：大数上把生效的相对容差收紧到 1e-4（只收不放）
  const effective = abs >= 1e3 ? Math.min(tol, 1e-4) : tol;
  return Math.max(abs * effective, 1e-6) + abs * 1e-6;
}

/** 一条 `ANSWERS` 期望值与该条目匹配到的 readout 是否在容差内 */
function valueMatches(readout, expected, declaredTol, defaultTol) {
  if (typeof readout.value !== 'number' || !Number.isFinite(readout.value)) return false;
  return Math.abs(readout.value - expected) <= adaptiveTolerance(expected, declaredTol, defaultTol);
}

/** C7 答案闭环：ANSWERS 的期望值必须在 at_t 时刻的 readouts 中出现（§7.2 / §7.3） */
export function checkAnswerClosure(run, opts = {}) {
  const answers = run.answers;
  const defaultTol = opts.tol ?? ANSWERS_DEFAULT_TOL;
  const offenders = [];
  const matched = [];
  /** 用于"符号歧义检测"：`符号|时刻` → 期望值集合（同一时刻给出两个不同期望值 = 自相矛盾） */
  const claims = new Map();

  if (!Array.isArray(answers) || answers.length === 0) {
    return result('C7', false, 'ANSWERS 不是非空数组（§3.3）：C7 无法成立', {
      offenders: [{ reason: 'ANSWERS 缺失或类型错误', snippet: `ANSWERS = ${String(answers)}` }],
    });
  }

  /**
   * ── 在**声明时刻精确求值**，而不是"就近取采样点"（第 8 期，用户裁决）──
   *
   * 为什么必须改：采样密度现在会随题长归一（长题 `dt` 变粗）。
   * 若还按"最近采样点"取值，`at_t = 1.5 s` 可能落到 1.42 s 那帧上，
   * 读数自然对不上 ⇒ **长题会被 C7 冤杀**。用户的原话很准：
   * "放缩后极容易触发 C7 导致不通过"。
   *
   * 现在的做法：
   *   ① 先按**精确时刻**调 `readouts(at, stateAt(at))`（这才是"那一刻的读数"）；
   *   ② 取不到（槽位缺 readouts / 抛错）才退回最近的采样点。
   * 这样 C7 与采样密度**解耦**：`dt` 怎么变都不影响它。
   */
  const readoutsAt = (t) => {
    try {
      const program = run.program;
      if (program && typeof program.readouts === 'function' && typeof program.stateAt === 'function') {
        const state = program.stateAt(t);
        const rows = normalizeReadouts(program.readouts(t, state));
        const frame = sampleFrame(program, t, { readouts: true });
        return { t, readouts: rows.length ? rows : frame.readouts, frame };
      }
    } catch {
      /* 精确求值失败 ⇒ 退回采样点（不让 C7 因为我们的取数方式而误判） */
    }
    let best = null;
    for (const point of run.readoutSeries) {
      if (!best || Math.abs(point.t - t) < Math.abs(best.t - t)) best = point;
    }
    return best;
  };

  const { t0s, t1 } = stepTimes(run);
  /** 结论声明的时刻是否落在"声明过的关键时刻"上（只用于诊断措辞） */
  const declaredTimes = new Set([...t0s, ...(t1 !== null ? [t1] : [])].map((x) => Number(x.toFixed(6))));

  answers.forEach((ans, i) => {
    const where = `ANSWERS[${i}]`;
    if (!ans || typeof ans !== 'object') {
      offenders.push({ reason: `${where} 不是对象`, snippet: `${where} = ${JSON.stringify(ans)}` });
      return;
    }
    for (const key of ['symbol', 'unit']) {
      if (typeof ans[key] !== 'string' || !ans[key]) offenders.push({ reason: `${where} 缺少 ${key}`, snippet: JSON.stringify(ans) });
    }
    const times = resolveAtTimes(ans, where);
    if (!times.ok) {
      offenders.push({ reason: times.reason, snippet: times.snippet });
      return;
    }

    // 多时刻：逐时刻校验，任一时刻不成立即算未闭环（并指出是哪个时刻）
    for (const at of times.list) {
      const tag = times.list.length > 1 ? `${where}(at_t=${at})` : where;
      if (at > run.duration + 1e-9) {
        offenders.push({
          reason: `${tag}.at_t=${at} 超出 duration=${run.duration}`,
          snippet: `期望 ${ans.symbol} 在 t=${at} 复现，但动画总时长只有 ${run.duration}；可在 VIEW 的 SIM.duration 或 ANSWERS 的 at_t 上对齐（改哪一处由你判断）`,
        });
        continue;
      }

      const point = readoutsAt(at);
      if (!point) {
        offenders.push({ reason: `${tag} 找不到对应采样时刻`, snippet: JSON.stringify(ans) });
        continue;
      }

      const candidates = point.readouts.filter(
        (r) => r.key === ans.symbol || r.label === ans.symbol || (r.latex && String(r.latex).includes(ans.symbol)),
      );
      if (!candidates.length) {
        // 可回灌诊断（第 4 期 C7 强化之四）：说清"哪个符号、在哪个时刻、画面上实际有什么"
        const atDeclared = declaredTimes.has(Number(at.toFixed(6)));
        offenders.push({
          reason: `${tag} 的 ${ans.symbol} 在 t=${at} 的 readouts 中不存在`,
          slot: 'readouts',
          precisionHint: 'exact',
          // ⚠ 顺序是有意的：最可能的原因（符号名对不上）放第一句，
          //   "采样点偏差"是次要提醒。写反了会把模型引向错误的方向。
          advice:
            '最常见的原因是**符号名对不上**：请核对 ANSWERS 的 symbol 与 readouts 的 key / label 是否逐字一致' +
            '（大小写、下标写法都算），再检查 readouts(t) 是不是漏了这一项。' +
            (atDeclared
              ? '该时刻是 STEPS 声明过的关键时刻，所以这不是采样点偏差造成的。'
              : '另：该时刻不是 STEPS 的任何 t0/t1，采样点与它有不到一个 dt 的偏差；若结论本就该在关键时刻成立，可把 at_t 改成对应的 t0/t1。'),
          snippet: `readouts(t=${point.t.toFixed(4)}) 键 = [${point.readouts.map((r) => `${r.key}${r.unit ? `/${r.unit}` : ''}`).join(', ')}]`,
        });
        continue;
      }

      if (ans.value === null || ans.value === undefined) {
        if (typeof ans.latex !== 'string' || !ans.latex) {
          offenders.push({ reason: `${tag} 是纯符号结论（value=null）但缺少 latex（§3.3）`, snippet: JSON.stringify(ans) });
        } else {
          matched.push({ symbol: ans.symbol, mode: 'symbolic', at_t: at, latex: ans.latex, readout: readoutIdentity(candidates[0]) });
        }
        continue;
      }

      const tol = Number.isFinite(ans.tol) ? ans.tol : defaultTol;
      const hit = candidates.find((r) => valueMatches(r, ans.value, ans.tol, defaultTol));

      /**
       * 符号歧义检测（第 4 期 C7 强化之三）。
       *
       * ⚠ 这一步**必须在 `hit` 判定之外**：第 3 期那种"逐条独立比对"的写法下，
       *   若第二个条目的期望值恰好不匹配读数，代码会先走到"未复现"分支并 `continue`，
       *   于是**永远发现不了**"同一符号在同一时刻被要求等于两个值"这件事 ——
       *   本用例第一次跑就是这么假绿过去的。
       */
      const claimKey = `${ans.symbol}|${at}`;
      const seen = claims.get(claimKey);
      if (seen !== undefined && Math.abs(seen - ans.value) > 1e-12) {
        offenders.push({
          reason: `${tag} 的符号 ${ans.symbol} 在 t=${at} 被要求等于两个不同的值（${seen} 与 ${ans.value}）`,
          slot: 'ANSWERS',
          precisionHint: 'exact',
          advice: '同一符号在同一时刻只能有一个期望值：请确认 ANSWERS 里是不是把同一符号写了两遍，或者两个不同的物理量用了同一个 symbol。',
          snippet: `symbol=${ans.symbol} · at_t=${at} · 先出现 ${seen}，本条 ${ans.value}`,
        });
      } else {
        claims.set(claimKey, ans.value);
      }

      if (!hit) {
        const got = candidates.map((r) => `${r.label || r.key}=${r.value}${r.unit ? ` ${r.unit}` : ''}`).join('；');
        const best = candidates.find((r) => typeof r.value === 'number' && Number.isFinite(r.value));
        // 可回灌诊断：期望 / 实际 / 差多少 / 建议改哪个槽位
        const delta = best ? Number((best.value - ans.value).toFixed(6)) : null;
        const relative = best && ans.value !== 0 ? Math.abs(delta / ans.value) : null;
        offenders.push({
          reason: `${tag} 的 ${ans.symbol} 未在 at_t=${at} 被 readouts 复现`,
          slot: 'readouts',
          precisionHint: 'exact',
          expected: ans.value,
          actual: best ? best.value : null,
          delta,
          relativeError: relative === null ? null : Number(relative.toFixed(6)),
          // 差得远近决定"改 readouts 还是改 ANSWERS"：给模型一句可操作的判断
          advice:
            relative !== null && relative > 0.5
              ? '实际值与期望值相差超过 50%：更可能是 readouts(t) 的表达式或单位写错，也可能是 ANSWERS 的期望值本身取自错误的小问，请先核对量纲与公式。'
              : '实际值与期望值接近但超出容差：更可能是采样时刻落在离 at_t 最近的网格点上造成的偏差，或 readouts 用了与解析式不等价的近似。',
          snippet: `期望 ${ans.symbol} = ${ans.value} ${ans.unit}（容差 ${adaptiveTolerance(ans.value, ans.tol, defaultTol).toExponential(3)}，量级自适应）；t=${point.t.toFixed(4)} 实际 ${got}`,
        });
        continue;
      }
      matched.push({
        symbol: ans.symbol,
        mode: 'numeric',
        at_t: at,
        value: ans.value,
        unit: ans.unit,
        tol,
        effectiveTol: adaptiveTolerance(ans.value, ans.tol, defaultTol),
        readout: readoutIdentity(hit),
      });
    }
  });

  return result(
    'C7',
    offenders.length === 0,
    offenders.length
      ? `${offenders.length} 条结论未闭环`
      : `${matched.length}/${answers.length} 条结论在 at_t 时刻由 readouts 复现`,
    {
      offenders: offenders.slice(0, 8),
      matched,
      // 观测：多时刻条目的数量与量级自适应容差的实际取值（不参与判定）
      observations: {
        multiTimeAnswers: answers.filter((a) => Array.isArray(a?.at_t)).length,
        toleranceMode: 'magnitude-adaptive',
      },
    },
  );
}

/** 匹配到的 readout 的身份（供歧义分析与观测；不含数值，避免报告体积膨胀） */
function readoutIdentity(r) {
  return { key: r.key, label: r.label ?? null, unit: r.unit ?? null, hasLatex: Boolean(r.latex) };
}

/** C8 稳定性：readouts 键集合与单位在全时段不变（告警，§7.2） */
function checkReadoutStability(run) {
  const series = run.readoutSeries;
  if (!series.length) return result('C8', true, '无采样，跳过', { offenders: [] });
  /**
   * ⚠ 第 8 期：**空壳不许通过**。
   *
   * 用户真题（export-20261018-115238-713）里 readouts 被写成 `function readouts(t, state) { … }`，
   * 装配后又套了一层 ⇒ 外层返回 undefined ⇒ **一条读数都没有**。
   * 而旧判据只比"前后是否一致"：0 项 vs 0 项当然一致 ⇒ C8 报"键集合与单位稳定（0 项）"。
   * 那种"通过"比失败更糟：它让人以为查过了。
   */
  if (!series[0]?.readouts?.length) {
    return result(
      'C8',
      false,
      'readouts 全程一条都没返回（键集合为空）—— 检查 readouts 是否忘了 return、或外层多包了一层函数',
      {
        offenders: [
          {
            t: 0,
            reason: 'readouts 返回空（C8）',
            snippet: 'readouts(t) 返回 undefined 或空数组：C7 无法复现答案，数据面板也没有任何一行',
          },
        ],
      },
    );
  }
  const sig = (point) => point.readouts.map((r) => `${r.key}|${r.unit}`).join(',');
  const base = sig(series[0]);
  const offenders = [];
  for (const point of series) {
    const s = sig(point);
    if (s !== base) {
      offenders.push({
        t: Number(point.t.toFixed(4)),
        reason: 'readouts 键集合或单位发生变化（C8）',
        snippet: `t=0：${base}\nt=${point.t.toFixed(4)}：${s}`,
      });
      break;
    }
  }
  return result('C8', offenders.length === 0, offenders.length ? 'readouts 键集合/单位在中途变化' : `键集合与单位稳定（${series[0].readouts.length} 项）`, {
    offenders,
    readoutKeys: series[0].readouts.map((r) => r.key),
  });
}

/**
 * **X3「箭头是否挂在物体上」**（第 8 期 · 扩展检查，**告警不阻塞**）。
 *
 * 用户真题的原话："速度、受力、加速度箭头没有跟物体的质心绑定"。
 * 实测那支速度箭头离木板质心 **0.71 m** —— 它被手写偏移到画面空白处，只为避开另一支箭头。
 *
 * 判据（可判定、不猜意图）：**每支箭头的起点，必须落在某个实体（`circle` / 非阴影 `polygon`）的包围盒内**。
 *   · 树枝状的规定（"必须在质心 ±0.1 m"）会把"力作用在杆端"这类正确画法冤杀；
 *   · 而"你连物体都不在"是**一定错**的 —— 所以只判这一条。
 *
 * 容差取"该帧实体跨度的 2%"：小物体（0.4 m 的物块）容差 ~1 cm，大场景（20 m）容差 ~0.4 m，
 * 这样既不会把"贴在边缘"判错，也抓得住"飘在空白处"。
 *
 * ⚠ 它**不进 verdict**（`blocking: false`）：这是"画得不好"的一类，不是"错了"。
 *   但会进报告与修复诊断（`slot: 'drawFrame'`），所以自愈轮能拿到它。
 */
/**
 * 一条命令记录的**包围盒**（X3 用来判断"箭头起点有没有落在实体上"）。
 *
 * 为什么要覆盖这么多 op：实体不只有方块和小球 —— 杆/导轨/墙是 `line`，绳是 `line`，
 * 弹簧/传送带是 `spring`/`belt`，滑轮是 `pulley`，场区是 `fieldDots`。
 * 第一版只认 `circle`/`polygon`，结果**15 道真题里 9 道被冤杀**（受力箭头本来就常画在接触面上）——
 * 告警要是天天误报，就没人会看它了。
 */
function recordBBox(r) {
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  switch (r.op) {
    case 'line':
    case 'ray':
    case 'lens':
      if (!num(r.x1) || !num(r.y1) || !num(r.x2) || !num(r.y2)) return null;
      return { minX: Math.min(r.x1, r.x2), maxX: Math.max(r.x1, r.x2), minY: Math.min(r.y1, r.y2), maxY: Math.max(r.y1, r.y2) };
    case 'arc':
      if (!num(r.cx) || !num(r.cy) || !num(r.r)) return null;
      return { minX: r.cx - r.r, maxX: r.cx + r.r, minY: r.cy - r.r, maxY: r.cy + r.r };
    case 'circle':
      if (!num(r.cx) || !num(r.cy) || !num(r.r)) return null;
      return { minX: r.cx - r.r, maxX: r.cx + r.r, minY: r.cy - r.r, maxY: r.cy + r.r };
    case 'pulley':
      if (!Array.isArray(r.c) || !num(r.r)) return null;
      return { minX: r.c[0] - r.r, maxX: r.c[0] + r.r, minY: r.c[1] - r.r, maxY: r.c[1] + r.r };
    case 'spring':
    case 'belt': {
      if (!Array.isArray(r.a) || !Array.isArray(r.b)) return null;
      const rr = num(r.r) ? r.r : 0;
      return {
        minX: Math.min(r.a[0], r.b[0]) - rr,
        maxX: Math.max(r.a[0], r.b[0]) + rr,
        minY: Math.min(r.a[1], r.b[1]) - rr,
        maxY: Math.max(r.a[1], r.b[1]) + rr,
      };
    }
    case 'fieldDots':
      if (!num(r.x) || !num(r.y) || !num(r.w) || !num(r.h)) return null;
      return { minX: r.x, maxX: r.x + r.w, minY: r.y, maxY: r.y + r.h };
    case 'polygon':
    case 'curve': {
      const pts = r.points ?? r.data;
      if (!Array.isArray(pts) || !pts.length) return null;
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }
    case 'chart': {
      const pts = r.data;
      if (!Array.isArray(pts) || !pts.length) return null;
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }
    default:
      return null;
  }
}

function checkArrowAnchors(run) {
  const ENTRY_BOX_OPS = new Set(['circle', 'polygon']);
  /**
   * 同一条箭头在每帧都会出现 —— 报告里只列"**不同的**那几支"。
   * 去重键用 `category|label`：同一支箭头的坐标本来就在动（它跟着物体走），
   * 拿坐标当键等于每帧都算一支新的（第一版就是这么写出 2401 条"不同"的）。
   * 同类别同标签的两支箭头会被并成一条 —— 那是同一个问题的同一个修法，可接受。
   */
  const bad = new Map();
  let checked = 0;
  let anchored = 0;

  for (const frame of run.frames) {
    const boxes = [];
    for (const r of frame.records) {
      if (r.op === 'arrow' || r.op === 'text' || r.op === 'latex' || r.op === 'dimension') continue;
      // 阴影面（地面/阴面）是参考物，不能给箭头当"锚点"
      if (r.op === 'polygon' && r.hatch) continue;
      const b = recordBBox(r);
      if (b) boxes.push(b);
    }
    if (!boxes.length) continue;
    const span = Math.max(
      Math.max(...boxes.map((b) => b.maxX)) - Math.min(...boxes.map((b) => b.minX)),
      Math.max(...boxes.map((b) => b.maxY)) - Math.min(...boxes.map((b) => b.minY)),
      1e-6,
    );
    const tol = span * 0.02;

    for (const r of frame.records) {
      if (r.op !== 'arrow') continue;
      checked += 1;
      const [x, y] = r.from;
      const hit = boxes.some((b) => x >= b.minX - tol && x <= b.maxX + tol && y >= b.minY - tol && y <= b.maxY + tol);
      if (hit) {
        anchored += 1;
        continue;
      }
      const nearest = boxes.reduce((best, b) => {
        const cx = Math.max(b.minX, Math.min(x, b.maxX));
        const cy = Math.max(b.minY, Math.min(y, b.maxY));
        const d = Math.hypot(x - cx, y - cy);
        return !best || d < best.d ? { d, box: b } : best;
      }, null);
      const key = `${r.category ?? 'aux'}|${r.label ?? ''}`;
      const distance = nearest ? nearest.d : null;
      const prev = bad.get(key);
      if (prev && (prev.distance ?? 0) >= (distance ?? 0)) continue;
      bad.set(key, {
        t: Number(frame.t.toFixed(4)),
        category: r.category ?? 'aux',
        label: r.label ?? null,
        from: [Number(x.toFixed(3)), Number(y.toFixed(3))],
        distance: distance === null ? null : Number(distance.toFixed(4)),
        tolerance: Number(tol.toFixed(4)),
        frames: (prev?.frames ?? 0) + 1,
      });
    }
  }

  if (!checked) {
    return {
      id: 'X3',
      status: 'skip',
      blocking: false,
      severity: 'warning',
      detail: '画面里没有箭头，跳过',
      offenders: [],
      diagnostics: [],
    };
  }

  const offenders = [...bad.values()]
    .sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0))
    .slice(0, 8)
    .map((o) => ({
      ...o,
      snippet:
        `${o.category} 箭头（${o.label ?? '无标签'}）在 t=${o.t} 时起点 [${o.from[0]}, ${o.from[1]}]，` +
        `离最近的实体还有 ${o.distance ?? '?'} m（容差 ${o.tolerance}）；这种箭头一共 ${o.frames} 帧都这样`,
    }));

  /**
   * ⚠ **明确降级为"信息"**（不是 pass/fail）：实测 15 道真题里有 6 道会被这条几何判据点名，
   * 而那 6 道都是**正确的画法**（支持力画在接触面上方 0.09 m、标注箭头"B"指向场区外 1.1 m…）。
   * 告警天天误报就没人看，所以它只作为**一个比例数字**进报告，供人工与后续调参；
   * 真正治"箭头不跟物体"的是两处：卡片的写法（起点用质心）+ 渲染层的自动错开。
   */
  const rate = checked ? anchored / checked : null;
  return {
    id: 'X3',
    status: 'info',
    blocking: false,
    severity: 'info',
    detail:
      rate === null
        ? '没有可统计的箭头'
        : `箭头起点落在实体上的比例 ${(rate * 100).toFixed(1)}%（${anchored}/${checked} 帧次；` +
          `${bad.size} 支不同的箭头从未落在实体上）`,
    anchorRate: rate === null ? null : Number(rate.toFixed(4)),
    unanchored: bad.size,
    offenders,
    diagnostics: offenders.slice(0, 3).map((o) =>
      diag({
        check: 'X3',
        rule: 'arrow-floating',
        slot: 'drawFrame',
        line: null,
        message: `${o.snippet}。把箭头的起点改成该实体的中心 [state.x, state.y]（同一实体上的多支箭头会自动错开，不必手写偏移）。`,
        precision: 'candidate',
      }),
    ),
    anchored,
    checked,
  };
}

/**
 * C9 活动性（告警）：画面必须随时间变化；每帧命令数有界（§7.2）。
 *
 * 判据口径（第 1 期口径，已在交付说明中列明）：
 *   §7.2 原文写的是"命令缓冲**包络**随时间必须变化"。但有一类题**物理上正确却包络恒定**：
 *   p–V 等温图、驻波快照、电路暂态曲线——画布的世界坐标范围全程不变，动的是曲线上的
 *   数据点与游标。若只看包络，这些题会被误判为"静止画面"。
 *   因此实测信号取两个：① 包络变化；② **任一命令坐标发生变化**（逐帧比对命令记录）。
 *   两者满足其一即判为"有活动"；两者都不满足才是真的静止。判据强度不变（告警），
 *   但误报被消除。若用户要求严格按原文只认包络，改回 `requireEnvelope` 即可。
 */
function checkActivity(run, opts = {}) {
  const maxCommands = opts.maxCommandsPerFrame ?? 800;
  const requireEnvelope = opts.requireEnvelope === true;
  const series = run.frames.filter((f) => f.envelope);
  const offenders = [];

  let envelopeChanged = false;
  if (series.length >= 2) {
    const first = series[0].envelope;
    envelopeChanged = series.some(
      (f) =>
        Math.abs(f.envelope.minX - first.minX) > 1e-9 ||
        Math.abs(f.envelope.maxX - first.maxX) > 1e-9 ||
        Math.abs(f.envelope.minY - first.minY) > 1e-9 ||
        Math.abs(f.envelope.maxY - first.maxY) > 1e-9,
    );
  }

  // 坐标级活动性：逐帧取"命令坐标指纹"，看全时段是否有任何一帧不同
  const coordsChanged = coordinateSignatureChanges(run.frames);

  if (requireEnvelope && series.length >= 2 && !envelopeChanged) {
    offenders.push({
      t: 0,
      reason: '包络全时段不变（严格口径下判为静止画面，C9）',
      snippet: `包络恒为 minX=${series[0].envelope.minX} maxX=${series[0].envelope.maxX} minY=${series[0].envelope.minY} maxY=${series[0].envelope.maxY}`,
    });
  } else if (!series.length && !coordsChanged) {
    offenders.push({ t: 0, reason: '没有任何绘制命令（C9）', snippet: '命令缓冲全时段为空' });
  } else if (!envelopeChanged && !coordsChanged) {
    offenders.push({
      t: 0,
      reason: '画面在包络与命令坐标两个口径下都全时段不变（C9）',
      snippet: '所有帧的命令坐标完全一致——这是真的静止画面',
    });
  }

  const worst = run.frames.reduce((m, f) => Math.max(m, f.commandCount), 0);
  if (worst > maxCommands) {
    offenders.push({ t: 0, reason: `单帧命令数 ${worst} 超过上限 ${maxCommands}（C9）`, snippet: `max commands/frame = ${worst}` });
  }

  const avg = run.frames.length ? run.frames.reduce((n, f) => n + f.commandCount, 0) / run.frames.length : 0;
  const signal = envelopeChanged ? '包络变化' : coordsChanged ? '命令坐标变化（包络恒定，属静态几何题）' : '无变化';
  return result(
    'C9',
    offenders.length === 0,
    offenders.length ? '画面活动性或命令数异常' : `随时间变化：${signal}；单帧命令数峰值 ${worst}、均值 ${avg.toFixed(1)}`,
    { offenders, maxCommandsPerFrame: worst, avgCommandsPerFrame: Number(avg.toFixed(2)), envelopeChanged, coordsChanged },
  );
}

/** 逐帧命令坐标指纹：任一帧的坐标序列与首帧不同即认为"有活动" */
function coordinateSignatureChanges(frames) {
  if (frames.length < 2) return false;
  const fingerprint = (frame) => {
    const parts = [];
    for (const rec of frame.records) {
      for (const key of Object.keys(rec)) {
        const v = rec[key];
        if (typeof v === 'number' && Number.isFinite(v)) parts.push(v.toFixed(6));
        else if (Array.isArray(v)) {
          for (const item of v) {
            if (typeof item === 'number' && Number.isFinite(item)) parts.push(item.toFixed(6));
            else if (Array.isArray(item)) parts.push(item.map((n) => (typeof n === 'number' ? n.toFixed(6) : '')).join(','));
          }
        }
      }
    }
    return parts.join('|');
  };
  const first = fingerprint(frames[0]);
  for (let i = 1; i < frames.length; i += 1) {
    if (fingerprint(frames[i]) !== first) return true;
  }
  return false;
}

/**
 * C10（**扩展检查**，非 §7.2 冻结项）· 物理包络合理性。
 *
 * 动机：C1–C9 只管"自洽"，不管"合物理"。q02 曾出现"落地前飞到地下 −2.10 m"的错误，
 * 九条判据全绿——因为 C3 只查有限性、C4 只查世界盒与数量级、C6 只查位置类分量是否连续、
 * C7 只查答案数字能否复现，**没有任何一条在问"这个坐标在物理上可能吗"**。
 *
 * 口径：由 `VIEW` 槽位**自愿**声明各阶段的合法区域（`SIM.regions`）：
 *   SIM.regions = [
 *     { phase: 1, y: [0.9, 1.6] },                       // 斜面段高度区间
 *     { phase: 2, insideCircle: [cx, cy, R] },           // 圆弧段必须落在圆上
 *     { phase: 3, y: [0, 0.5], x: [1.0, 6.5] }           // 平抛段
 *   ]
 * 未声明 `regions` 的题只记录"未声明"，**不判失败**（不强迫填写）。
 * 声明了就必须逐采样点满足，因此这是作者可选的加严手段。
 */
function checkPhysicalRegions(run) {
  const sim = run.program?.SIM;
  const regions = sim && Array.isArray(sim.regions) ? sim.regions : null;
  if (!regions || !regions.length) {
    return {
      id: 'C10',
      severity: 'extension',
      status: 'skip',
      blocking: false,
      detail: '未声明 SIM.regions（可选）：本次不检查物理包络',
      offenders: [],
      declared: 0,
    };
  }

  const inBound = (v, range) => typeof v !== 'number' || !Number.isFinite(v) || (v >= range[0] - 1e-9 && v <= range[1] + 1e-9);
  const offenders = [];
  let checkedFrames = 0;

  for (const frame of run.frames) {
    const st = frame.state;
    if (!st || typeof st !== 'object') continue;
    const hasPhase = typeof st.phase === 'number';
    // ⚠ 按声明过滤：`{ phase: 2, … }` 只作用于 phase===2 的采样点。
    // 不加这条过滤会把 phase 1 的点拿去比 phase 2 的区间，产生假失败
    // （C10 第一次跑就是这么误报 q02 的）。
    const applicable = regions.filter((rg) => (rg.phase === undefined || rg.phase === null ? true : hasPhase && rg.phase === st.phase));
    if (!applicable.length) continue;
    checkedFrames += 1;

    for (const rg of applicable) {
      const label = rg.label ?? `phase ${rg.phase ?? '*'}`;
      if (rg.x && !inBound(st.x, rg.x)) {
        offenders.push({
          t: Number(frame.t.toFixed(4)),
          reason: `${label} 的 x 越出声明区间（C10 扩展）`,
          snippet: `t=${frame.t.toFixed(4)} x=${st.x}，声明区间 [${rg.x[0]}, ${rg.x[1]}]`,
        });
      }
      if (rg.y && !inBound(st.y, rg.y)) {
        offenders.push({
          t: Number(frame.t.toFixed(4)),
          reason: `${label} 的 y 越出声明区间（C10 扩展）`,
          snippet: `t=${frame.t.toFixed(4)} y=${st.y}，声明区间 [${rg.y[0]}, ${rg.y[1]}]`,
        });
      }
      if (rg.belowY !== undefined && typeof st.y === 'number' && st.y < rg.belowY - 1e-9) {
        offenders.push({
          t: Number(frame.t.toFixed(4)),
          reason: `${label} 落到 ${rg.belowY} 之下（C10 扩展）`,
          snippet: `t=${frame.t.toFixed(4)} y=${st.y} < ${rg.belowY}`,
        });
      }
      if (rg.insideCircle && typeof st.x === 'number' && typeof st.y === 'number') {
        const [ccx, ccy, rr] = rg.insideCircle;
        const d = Math.hypot(st.x - ccx, st.y - ccy);
        if (Math.abs(d - rr) > (rg.tol ?? 5e-3)) {
          offenders.push({
            t: Number(frame.t.toFixed(4)),
            reason: `${label} 偏离声明的圆周（C10 扩展）`,
            snippet: `t=${frame.t.toFixed(4)} 到圆心距离 ${d.toFixed(5)}，声明半径 ${rr}（容差 ${rg.tol ?? 5e-3}）`,
          });
        }
      }
      if (rg.maxAbs !== undefined) {
        for (const key of rg.keys ?? ['x', 'y']) {
          const v = st[key];
          if (typeof v === 'number' && Math.abs(v) > rg.maxAbs + 1e-9) {
            offenders.push({
              t: Number(frame.t.toFixed(4)),
              reason: `${label} 的 ${key} 超出 ±${rg.maxAbs}（C10 扩展）`,
              snippet: `t=${frame.t.toFixed(4)} ${key}=${v}`,
            });
          }
        }
      }
      if (offenders.length > 8) break;
    }
    if (offenders.length > 8) break;
  }

  return {
    id: 'C10',
    severity: 'extension',
    status: offenders.length ? 'fail' : 'pass',
    blocking: false,
    detail: offenders.length
      ? `${offenders.length} 处状态越出声明区域（检查了 ${checkedFrames} 帧）`
      : `${regions.length} 条区域声明全部满足（检查了 ${checkedFrames} 帧）`,
    offenders: offenders.slice(0, 8),
    declared: regions.length,
  };
}

/* ─────────────────────────── 报告组装 ─────────────────────────── */

/** 这次运行留下的证据够不够做重放（超时/超内存的代码本来就会卡住，绝不能再跑一遍） */
function canReplay(run) {
  const kind = run.budget?.kind;
  return run.frames.length > 0 && kind !== 'timeout' && kind !== 'out-of-memory';
}

/**
 * 给失败的检查挂上**行号级**诊断（第 2 期的 M26/M27 增量）。
 *
 * 这里只做归因，不改判定：`checks[].status` 完全由 C1–C9 的判据决定
 * （§7.2 是冻结项，第 2 期一条都没动）。诊断按证据强度标注 `precision`：
 *   · `exact`     —— 埋点/命令戳直接给出的行；
 *   · `replayed`  —— 快照重放定位到的行（"第一次算出非有限值" / "最后一次改写该绑定"）；
 *   · `candidate` —— 静态候选行（重放不可用时的兜底，不假装精确）。
 */
function attachDiagnostics(run, checks, slots, meta = {}) {
  const cache = new Map();
  const trace = (slot, times) => {
    const key = `${slot}|${times.map((t) => Number(t).toFixed(6)).join(',')}`;
    if (cache.has(key)) return cache.get(key);
    const out = canReplay(run)
      ? traceSlot({ slots, slot, times, mode: meta.mode ?? 'NUMERIC' })
      : { ok: false, error: '本次运行未留下可重放的证据（超时/超内存后不再重放）' };
    cache.set(key, out);
    return out;
  };
  const byId = (id) => checks.find((c) => c.id === id);

  /* C2 —— 终止性：把"超时/超内存/步数预算/崩溃"与**最后执行到的行**写进诊断 */
  const c2 = byId('C2');
  if (c2 && c2.status === 'fail') {
    const where = run.error?.where ?? run.budget?.lastMark ?? null;
    const kinds = {
      timeout: '超过墙钟预算，Worker 已被硬终止',
      'out-of-memory': '超过 resourceLimits.maxOldGenerationSizeMb，Worker 被内存上限终止',
      'step-budget': '超过步数预算 maxFrames',
      crash: '槽位代码抛出异常',
      runtime: '执行期错误',
    };
    const kind = run.error?.kind ?? run.budget?.kind ?? 'crash';
    c2.diagnostics = [
      diag({
        check: 'C2',
        rule: `termination:${kind}`,
        /**
         * 第 8 期：装配期抛的错自带归属（`odSlot`）。用户真题里 VIEW 写错被算到 setup 头上，
         * 于是"行号 0、setup 第 0 行"—— 完全误导。这里优先用错误自带的归属。
         */
        slot: run.error?.odSlot ?? where?.slot ?? (run.error?.where?.slot ?? 'stateAt'),
        line: where?.line ?? null,
        rule: run.error?.odRule ?? `termination:${kind}`,
        message: `${kinds[kind] ?? kind}${where?.line ? `；最后执行到 ${where.slot} 第 ${where.line} 行` : ''}${run.error?.message ? `（${run.error.message}）` : ''}`,
        source: (run.error?.odSlot ?? where?.slot) ? slots[run.error?.odSlot ?? where?.slot] : null,
        precision: 'exact',
      }),
    ];
    if (where?.line) {
      c2.offenders = [
        ...(c2.offenders ?? []),
        { t: null, reason: `终止类型 ${kind}`, snippet: `最后执行位置：${where.slot} 第 ${where.line} 行` },
      ];
    }
  }

  /* C3 —— 非有限值：先按命令戳给精确行，再用重放找"第一次算出 NaN 的那一行" */
  const c3 = byId('C3');
  if (c3 && c3.status === 'fail') {
    const diagnostics = [];
    for (const o of c3.offenders ?? []) {
      if (o.slot === 'drawFrame' && Number.isFinite(o.line)) {
        diagnostics.push(
          diag({
            check: 'C3',
            rule: 'non-finite-command',
            slot: 'drawFrame',
            line: o.line,
            message: `t=${o.t} 时 ${o.where} 非有限（${o.detail}）；该命令由这一行推入缓冲`,
            source: slots.drawFrame,
          }),
        );
        const tr = trace('drawFrame', [o.t]);
        if (tr.ok) {
          const hit = firstNonFinite(tr.samples?.[0]?.snapshots ?? []);
          if (hit) {
            diagnostics.push(
              diag({
                check: 'C3',
                rule: 'first-non-finite',
                slot: 'drawFrame',
                line: hit.line,
                message: `重放 t=${o.t}：绑定 ${hit.binding} 在这一行首次变为 ${hit.value}`,
                source: slots.drawFrame,
                precision: 'replayed',
              }),
            );
          }
        }
        continue;
      }
      if (o.slot === 'readouts') {
        const tr = trace('readouts', [o.t]);
        const hit = tr.ok ? firstNonFinite(tr.samples?.[0]?.snapshots ?? []) : null;
        // 读数槽位常常只是 `value: state.ds`——NaN 其实是 stateAt 里算出来的。
        // 因此再重放一次 stateAt，把**根因行**也一并给出（这是最有用的那一条）。
        const trState = trace('stateAt', [o.t]);
        const root = trState.ok ? firstNonFinite(trState.samples?.[0]?.snapshots ?? []) : null;
        if (root) {
          diagnostics.push(
            diag({
              check: 'C3',
              rule: 'root-cause-non-finite',
              slot: 'stateAt',
              line: root.line,
              message: `t=${o.t} 的读数 ${o.key} 非有限；根因在 stateAt——绑定 ${root.binding} 在这一行首次变为 ${root.value}`,
              source: slots.stateAt,
              precision: 'replayed',
            }),
          );
        }
        if (hit) {
          diagnostics.push(
            diag({
              check: 'C3',
              rule: 'first-non-finite',
              slot: 'readouts',
              line: hit.line,
              message: `重放 t=${o.t}：readouts 里的绑定 ${hit.binding} 在这一行首次变为 ${hit.value}`,
              source: slots.readouts,
              precision: 'replayed',
            }),
          );
        }
        const entry = locateReadoutEntry(slots.readouts, o.key);
        if (entry) {
          diagnostics.push(
            diag({
              check: 'C3',
              rule: 'readout-entry',
              slot: 'readouts',
              line: entry.line,
              column: entry.column,
              message: `读数键 '${o.key}' 的条目写在这一行（AST 定位到该读数的 value 属性）`,
              source: slots.readouts,
              precision: 'exact',
            }),
          );
        }
        if (!hit && !entry) {
          diagnostics.push(
            diag({
              check: 'C3',
              rule: 'unattributed',
              slot: 'readouts',
              line: null,
              message: `未能定位到具体行（读数 ${o.key} 的值来自表达式而非绑定）；已给出时刻 t=${o.t}`,
              source: slots.readouts,
              precision: 'candidate',
            }),
          );
        }
      }
    }
    c3.diagnostics = dedupeDiags(diagnostics);
  }

  /* C4 —— 几何：命令戳 + 状态重放 */
  const c4 = byId('C4');
  if (c4 && c4.status === 'fail') {
    const diagnostics = [];
    for (const o of c4.offenders ?? []) {
      if (Number.isFinite(o.line)) {
        diagnostics.push(
          diag({
            check: 'C4',
            rule: 'frame-jump',
            slot: 'drawFrame',
            line: o.line,
            message: `${o.snippet}`,
            source: slots.drawFrame,
          }),
        );
      }
      if (Number.isFinite(o.t)) {
        const tr = trace('stateAt', [o.t]);
        const hit = tr.ok ? firstNonFinite(tr.samples?.[0]?.snapshots ?? []) : null;
        if (hit) {
          diagnostics.push(
            diag({
              check: 'C4',
              rule: 'first-non-finite',
              slot: 'stateAt',
              line: hit.line,
              message: `重放 t=${o.t}：绑定 ${hit.binding} 在这一行首次变为 ${hit.value}（画面因此跳变）`,
              source: slots.stateAt,
              precision: 'replayed',
            }),
          );
        }
      }
    }
    c4.diagnostics = dedupeDiags(diagnostics);
  }

  /* C5 —— 时间覆盖：STEPS 是行式表，直接给到"第几步的哪个字段在第几行" */
  const c5 = byId('C5');
  if (c5 && c5.status === 'fail') {
    const idx = dataSlotLines(slots.STEPS, 'STEPS');
    const diagnostics = [];
    for (const o of c5.offenders ?? []) {
      if (Number.isInteger(o.stepIndex) && idx?.entries?.[o.stepIndex]) {
        const entry = idx.entries[o.stepIndex];
        const line = o.field ? entry.fields?.[o.field] ?? entry.startLine : entry.startLine;
        diagnostics.push(
          diag({
            check: 'C5',
            rule: `steps-${o.field ?? 'entry'}`,
            slot: 'STEPS',
            line,
            message: `STEPS 第 ${o.stepIndex + 1} 步的 ${o.field ?? '条目'} 在这一行：${o.snippet}`,
            source: slots.STEPS,
          }),
        );
      } else {
        diagnostics.push(
          diag({
            check: 'C5',
            rule: 'steps-unlocated',
            slot: o.slot ?? 'STEPS',
            line: null,
            message: `${o.reason}（${o.snippet}）`,
            source: o.slot === 'VIEW' ? slots.VIEW : slots.STEPS,
            precision: 'candidate',
          }),
        );
      }
    }
    c5.diagnostics = dedupeDiags(diagnostics);
  }

  /* C6 —— 边界跳变：重放边界内侧，找"最后一次改写该绑定的行" */
  const c6 = byId('C6');
  if (c6 && c6.status === 'fail') {
    const eps = meta.epsilon ?? DRY_RUN_BUDGET.boundaryEpsilon;
    const diagnostics = [];
    for (const o of c6.offenders ?? []) {
      const binding = String(o.key ?? '').split('.')[0];
      /**
       * ★ 第 8 期：**先报现场，再谈定位**。
       *
       * 之前 C6 只发"候选行"，把 { t, key, before, after, delta } 留在了 offenders 里没进诊断，
       * 于是用户看到 4 条赋值行、却不知道"哪个量、在什么时刻、跳了多少"。
       * 现场的精度是 **exact**（就是实测出来的两个值），跟"能不能定位到源码行"无关。
       */
      if (o.key) {
        diagnostics.push(
          diag({
            check: 'C6',
            rule: 'boundary-jump',
            slot: 'stateAt',
            line: null,
            message:
              `t=${o.t}s 处 ${o.key} 从 ${o.before} 跳到 ${o.after}（Δ=${typeof o.delta === 'number' ? o.delta.toPrecision(4) : o.delta}）。` +
              `位置类分量必须连续：让两个分支在边界两侧先算出同一个值（例如都用同一个碰撞时刻/同一组常量）`,
            source: slots.stateAt,
            precision: 'exact',
          }),
        );
      }
      let located = false;
      if (binding && Number.isFinite(o.t)) {
        const tr = trace('stateAt', [o.t - eps, o.t + eps]);
        if (tr.ok) {
          const after = tr.samples?.[1]?.snapshots ?? [];
          const before = tr.samples?.[0]?.snapshots ?? [];
          const diff = differingBindings(before, after).find((d) => d.binding === binding);
          const write = lastWriteOf(after, binding);
          if (write) {
            diagnostics.push(
              diag({
                check: 'C6',
                rule: 'binding-write',
                slot: 'stateAt',
                line: write.line,
                message:
                  `t=${o.t} 边界处 ${binding} 由 ${o.before} 跳到 ${o.after}；` +
                  `重放显示这一行是最后一次改写 ${binding} 的位置（写入后为 ${write.value}）` +
                  (diff ? '' : ''),
                source: slots.stateAt,
                precision: 'replayed',
              }),
            );
            located = true;
          }
        }
      }
      if (!located) {
        for (const cand of locateSlotKeyWrites(slots.stateAt, 'stateAt', binding)) {
          diagnostics.push(
            diag({
              check: 'C6',
              rule: `candidate-${cand.kind}`,
              slot: 'stateAt',
              line: cand.line,
              column: cand.column,
              message:
                `候选行（${cand.kind}）：${cand.text} —— 没能定位到具体某一行（重放时没观察到对 ${binding} 的写入），` +
                `下面是所有写入 ${binding} 的位置，请逐个核对`,
              source: slots.stateAt,
              precision: 'candidate',
            }),
          );
        }
      }
    }
    c6.diagnostics = dedupeDiags(diagnostics);
  }

  for (const c of checks) {
    if (c.status !== 'fail') continue;
    c.diagnostics = c.diagnostics ?? [];
  }
  return checks;
}

function dedupeDiags(list) {
  const seen = new Set();
  const out = [];
  for (const d of list) {
    const key = `${d.check}|${d.slot}|${d.line}|${d.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/**
 * 对一道题跑完整 Dry-Run 并出报告。
 *
 * 第 2 期起是 **async**：主路径在 Worker 里执行（可硬终止），
 * Worker 起不来才回退到同进程 `node:vm`。
 * @param {object} input
 * @param {object} input.slots 8 键名槽位
 * @param {string} input.entry 题目标识（用于诊断与文件名）
 * @param {object} [input.meta] 题号、标题、模式等
 * @param {AbortSignal} [input.signal] 外部取消（第 3 期）：中止时立刻 terminate Worker，
 *        报告里 `execution.termination = 'cancelled'`，**不抛异常**（取消不是错误）
 */
export async function dryRun(input) {
  const { slots, entry, meta = {}, signal } = input;
  const started = Date.now();

  // C1：静态预检（先于任何执行）。只检代码型槽位；数据型槽位（PROBLEM/STEPS/ANSWERS）
  // 走 JSON 解析校验，不做 JS 白名单（题面与 LaTeX 不是代码）。
  const codeSlots = Object.fromEntries(Runtime.CODE_SLOTS.map((k) => [k, slots[k]]));
  const lint = lintProgram(codeSlots, { entry });
  for (const key of Runtime.DATA_SLOTS) {
    try {
      Runtime.normalizeDataSlot(slots[key], key);
    } catch (err) {
      lint.ok = false;
      lint.totalDiagnostics += 1;
      lint.results.push({
        ok: false,
        slot: key,
        entry,
        backend: 'json-slot',
        lines: String(slots[key]).split('\n').length,
        diagnostics: [{ check: 'C1', rule: 'malformed-data-slot', slot: key, line: 1, column: 1, message: err.message, context: [] }],
        minimalRepro: [],
      });
    }
  }
  const checks = [];

  const execOpts = {
    entry,
    mode: meta.mode ?? 'NUMERIC',
    timeoutMs: meta.wallClockMs ?? DRY_RUN_BUDGET.wallClockMs,
    maxOldGenerationSizeMb: meta.maxOldGenerationSizeMb ?? DRY_RUN_BUDGET.maxOldGenerationSizeMb,
    maxFrames: meta.maxFrames ?? 200000,
    // 第 3 期：取消信号（只在 Worker 路径生效；同进程回退路径无法被硬终止，如实记录）
    ...(signal ? { signal } : {}),
  };

  /**
   * 第 9 期「判据分级」：C1 **只有硬拦类诊断**时才拒绝执行。
   *
   * 旧口径是 `!lint.ok` 就完全跳过执行 —— 于是"某个**未被调用**的辅助函数里拼错一个名字"
   * 会让整份程序 0 帧跑完，接着 C5/C7 因为拿不到数据而判红，用户看到的是一串
   * "STEPS 不是非空数组 / ANSWERS 不是非空数组"，**真问题（那个拼错的名字）反而被淹没**。
   * 新口径：孤立的 `unknown-global` 属告警 ⇒ 照常执行；若那个名字真被调用到，
   * 运行期会抛 ReferenceError ⇒ `run.error` ⇒ C2 硬拦。**一条都漏不掉。**
   */
  const c1Blocks = !lint.ok && (lint.blockingDiagnostics ?? 0) > 0;

  let run;
  if (c1Blocks) {
    run = {
      program: null, error: null, wallClockMs: 0, frameCount: 0, frames: [], readoutSeries: [],
      duration: NaN, steps: [], answers: [], stateAt: () => null, slots,
      backend: 'skipped', available: true, budget: null, truncated: null,
    };
  } else if (meta.forceBackend === 'vm-fallback') {
    // 测试/调试用：强制走回退后端（`tests/negative-injection` 用它做"两条后端结论一致"的对照）
    run = executeProgram(slots, execOpts);
    run.fallbackReason = '按 meta.forceBackend 强制走同进程回退后端';
  } else {
    // ① 主路径：Worker 沙箱（硬终止 + 内存上限）
    run = await executeProgramInWorker(slots, execOpts);
    // ② 回退：本环境起不了 Worker 才用同进程 vm（结论一致，隔离与终止强度不同，如实记录）
    if (run.available === false) {
      const why = run.error?.message ?? '未知原因';
      run = executeProgram(slots, execOpts);
      run.fallbackReason = why;
    }
  }

  // C2：终止性（墙钟 + 步数双预算；第 2 期起由 Worker 硬性执行）
  //
  // ⚠ 第 3 期：**用户主动取消不算 C2 失败**。
  //   取消（§21.1 第 3 条）与"超时/OOM"是两件事：前者是用户意图，后者是预算被击穿。
  //   把取消判成 C2 失败会让 UI 报一个用户自己造成的红错，也会污染观测指标。
  const cancelled = run.budget?.kind === 'cancelled';
  const c2Offenders = [];
  if (run.error) c2Offenders.push({ t: null, reason: run.error.message, snippet: `phase=${run.error.phase}${run.error.kind ? ` kind=${run.error.kind}` : ''}` });
  const walked = run.wallClockMs > (meta.wallClockMs ?? DRY_RUN_BUDGET.wallClockMs);
  if (walked) c2Offenders.push({ t: null, reason: `总耗时 ${run.wallClockMs} ms 超过预算`, snippet: `budget=${meta.wallClockMs ?? DRY_RUN_BUDGET.wallClockMs} ms` });
  const stepBudgetOk = run.frameCount <= (meta.maxFrames ?? 200000);
  if (!stepBudgetOk) c2Offenders.push({ t: null, reason: `步数 ${run.frameCount} 超预算`, snippet: `maxFrames=${meta.maxFrames ?? 200000}` });
  if (run.truncated === 'step-budget') c2Offenders.push({ t: null, reason: '扫描因步数预算提前截断', snippet: `truncated=${run.truncated}` });

  checks.push(
    result(
      'C1',
      lint.ok,
      lint.ok
        ? `8 槽位全部通过（代码型槽位走 §6.2 全表；数据型槽位走行式表/JSON 结构校验）`
        : `${lint.totalDiagnostics} 条静态诊断（其中 ${lint.advisoryDiagnostics ?? 0} 条为告警、` +
          `${lint.blockingDiagnostics ?? 0} 条硬拦）`,
      {
        /**
         * ── 第 9 期「判据分级」（交接单 §8）──
         *
         * C1 只在**有硬拦类诊断**时才 `blocking`。孤立地引用了一个未声明的名字
         * （典型的笔误）降为告警：`status` 仍是 `fail`（判据照跑、痕迹照留），
         * 但它不再把整份程序判死 —— 因为"这个名字真被调用"时，运行期会抛错，
         * C2 会硬拦。**降级的是拦路方式，不是检查本身。**
         *
         * ⚠ 沙箱逃逸类（`require` / `eval` / `process.x`）**不会**因此被放过：
         * 它们还会命中 `banned-identifier`，那条不计入 `advisoryDiagnostics`。
         */
        blocking: lint.ok ? true : (lint.blockingDiagnostics ?? 0) > 0,
        // ⚠ 补上 `slot`：lint 的一部分诊断只给了规则与行列号，
        // 报告里不带槽位名的话，"第 6 行"到底指哪个槽位就得靠猜（第 2 期修）。
        diagnostics: lint.results.flatMap((r) => r.diagnostics.map((d) => ({ slot: r.slot, ...d, entry }))),
        minimalRepro: lint.results.flatMap((r) => r.minimalRepro),
        advisoryDiagnostics: lint.advisoryDiagnostics ?? 0,
        blockingDiagnostics: lint.blockingDiagnostics ?? 0,
      },
    ),
  );
  checks.push(
    cancelled
      ? result('C2', true, '本次运行被用户取消，未进入预算判定', { offenders: [], cancelled: true, termination: 'cancelled' })
      : result('C2', c2Offenders.length === 0, c2Offenders.length ? '执行未在预算内正常结束' : `执行 ${run.wallClockMs} ms / ${run.frameCount} 步，均在预算内`, {
          offenders: c2Offenders,
          wallClockMs: run.wallClockMs,
          frameCount: run.frameCount,
          termination: run.budget?.kind ?? null,
        }),
  );

  /**
   * 第 9 期「判据分级」：C1 **只有硬拦类诊断**时才把 C3–C9 一并判成"未执行"。
   *
   * 孤立的 `unknown-global` 属告警 ⇒ **照常跑 C3–C9**（它们各自有真输入）。
   */
  if (c1Blocks || run.error) {
    for (const id of ['C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9']) {
      checks.push(result(id, false, '因 C1/C2 未通过，本次未执行（判据未变，仅未获得输入）', { offenders: [], skipped: true }));
    }
  } else if (cancelled) {
    // ⚠ 取消时**不能**去跑 C3–C9：帧数据是空的，判据会在"空输入"上真空通过，
    //   那等于给一个没跑完的程序盖了合格的章。如实标成"未执行"。
    for (const id of ['C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9']) {
      checks.push(result(id, false, '本次运行被用户取消，未获得完整输入，判据未执行', { offenders: [], skipped: true, cancelled: true }));
    }
  } else {
    checks.push(checkFinite(run));
    checks.push(checkGeometry(run, meta));
    checks.push(checkTimeCoverage(run, meta));
    checks.push(checkBoundaryContinuity(run, meta));
    checks.push(checkAnswerClosure(run, meta));
    checks.push(checkReadoutStability(run));
    checks.push(checkActivity(run, meta));
  }

  // 行号级归因（只补诊断，不改判定）
  attachDiagnostics(run, checks, slots, meta);

  checks.sort((a, b) => CHECK_IDS.indexOf(a.id) - CHECK_IDS.indexOf(b.id));

  // C10 / X1 / X2 / X3 是**扩展检查**（§7.2 的 C1–C9 是冻结项，不动它），单独放在 extensions 里，
  // 不参与 verdict 的硬拒/告警计算，但会出现在报告、汇总与总览页上。
  const extensions = [
    checkPhysicalRegions(run),
    checkContextKeyCollision(slots),
    checkDrawRawUsage(run),
    checkArrowAnchors(run),
  ];

  const rawRecords = run.frames.flatMap((f) => f.records.filter((r) => r.op === 'raw'));
  const totalRecords = run.frames.reduce((n, f) => n + f.commandCount, 0);
  const envelope = run.frames.length ? envelopeOver(run.frames) : null;

  /**
   * ── 第 8 期：标注避让表（用户要求「文字避让，主体是动画」）──
   *
   * **整段算一次**（不是逐帧），所以文字不会跟着物块跳。
   * 关掉的办法：`meta.skipLabelAvoid === true`（自检里省时间用）。
   * 注太多 / 没有帧时返回空表并在 `skipped` 里说明原因 —— **降级要可见**。
   */
  const labelAvoid = meta?.skipLabelAvoid
    ? emptyLabelAvoid('disabled')
    : planLabelLayout(run.frames, { viewport: meta?.viewport });

  const blocking = checks.filter((c) => c.blocking && c.status === 'fail');
  const warnings = checks.filter((c) => !c.blocking && c.status === 'fail');

  /**
   * ── 第 8 期：**开发模式（不拦截）**（用户 2026-10-18 裁决）──
   *
   * 用户的判断：模型现在产出的代码已经足够好，而 C1–C9 里有相当一部分是**会冤枉人的判据**
   * （这一轮就抓到 C1 的 `isFinite`、C4 的标注位移、C6 的速度跳变三处误报）。
   * 硬拦一个错判据，代价比"放过一个瑕疵"大得多：它让人连画面都看不到。
   *
   * 所以 `meta.advisory === true` 时：
   *   · **判据本身一点不放宽** —— `checks[]` 的 `status` / `blocking` / 诊断 / offenders 全部照旧，
   *     该红的还是红，报告照旧写明"哪几条没过"；
   *   · 只把**结论**从 `fail` 降成 `pass-with-warnings`（即"可以交付，但带着告警"），
   *     让下游（自愈循环、交付形态、播放器）按"能播"处理；
   *   · 报告里留 `advisory: true` 与 `gatesBypassed: ['C1','C4']`，
   *     导出页与历史都要能看出"这条产物是开发模式下放行的"。
   *
   * ⚠ 这不是"关掉校验"，是"校验不再拦路"：用户可以继续迭代，但**永远知道**哪几条没过。
   */
  const advisory = meta?.advisory === true;
  const gatesBypassed = advisory ? blocking.map((c) => c.id) : [];
  const verdict = advisory
    ? warnings.length || blocking.length
      ? 'pass-with-warnings'
      : 'pass'
    : blocking.length
      ? 'fail'
      : warnings.length
        ? 'pass-with-warnings'
        : 'pass';

  const report = {
    format: 'od-dry-run-report',
    version: 2,
    entry,
    meta,
    generatedAt: new Date().toISOString(),
    verdict,
    /** 第 8 期：本次是否走了"开发模式（不拦截）"，以及被放行的检查号 */
    advisory,
    gatesBypassed,
    durationMs: Date.now() - started,
    /** 第 3 期：本次是否为"用户取消"。取消不是失败，但调用方必须能区分它与"真的通过了"。 */
    cancelled,
    execution: {
      backend: run.backend === 'worker' ? 'worker_threads + node:vm + resourceLimits（§6.3）' : 'node:vm（主线程回退，第 1 期口径）',
      backendId: run.backend,
      fallbackReason: run.fallbackReason ?? null,
      termination: run.budget?.kind ?? null,
      cancelled,
      budget: run.budget ?? null,
      dt: meta.dt ?? DRY_RUN_BUDGET.dt,
      wallClockMs: run.wallClockMs,
      frameCount: run.frameCount,
      duration: Number.isFinite(run.duration) ? run.duration : null,
      mode: meta.mode ?? 'NUMERIC',
    },
    checks,
    /** 扩展检查（非 §7.2 冻结项）：C10 物理包络 · X1 导出键重名 · X2 Draw.raw 使用率 */
    extensions,
    observations: {
      drawRawCount: rawRecords.length,
      drawRawUsage: totalRecords ? rawRecords.length / totalRecords : 0,
      totalCommands: totalRecords,
      maxCommandsPerFrame: run.frames.reduce((m, f) => Math.max(m, f.commandCount), 0),
      opHistogram: histogram(run.frames),
      envelope,
      readoutKeys: run.readoutSeries[0]?.readouts.map((r) => ({ key: r.key, unit: r.unit, label: r.label })) ?? [],
      stepCount: Array.isArray(run.steps) ? run.steps.length : 0,
      /** 第 2 期观测：诊断条数与其中"精确/重放/候选"的分布（用于评估行号归因的覆盖率） */
      diagnosticCount: checks.reduce((n, c) => n + (c.diagnostics?.length ?? 0), 0),
    },
    /** 四件套之二：图表数据序列（第 7 期联动图表直接复用） */
    chartSeries: run.readoutSeries.map((p) => ({
      t: Number(p.t.toFixed(6)),
      values: Object.fromEntries(p.readouts.filter((r) => typeof r.value === 'number').map((r) => [r.key, r.value])),
    })),
    /**
     * 四件套之四：**关键帧**（第 3 期补齐）。
     *
     * 每个步骤的 `t0` 取一帧，附上该帧的 `state` / `commands`（绘制命令条数）/
     * `readouts` / 包络。用途与"为什么它不是性能必需品"见文件头说明。
     *
     * ⚠ 刻意**不把整帧的 `records` 塞进报告**：那会让报告体积翻好几倍，
     *   而关键帧的用途（事后排查 / 导出对齐 / 步骤边界体检）只需要**计数与状态**。
     *   真要看某一帧画了什么，用 `core/dryrun/trace.mjs` 的快照重放更合适。
     */
    keyframes: buildKeyframes(run, meta),
    /**
     * 四件套之五（第 8 期）：**标注避让表**。
     *
     * 每条注一项：`key`（跨帧对齐用）、`offset`（世界单位，整段恒定）、
     * `moved`/`leader`、以及"挪之前/之后"的压字帧数（`overlapFramesBefore/After`）。
     * `scoreAfter <= scoreBefore` 恒成立 —— 这个规划器不会把情况弄得更糟。
     */
    labelAvoid,
    error: run.error,
  };

  return { report, run, lint };
}

function histogram(frames) {
  const out = {};
  for (const f of frames) {
    for (const r of f.records) out[r.op] = (out[r.op] || 0) + 1;
  }
  return out;
}

/**
 * 构造关键帧（四件套之四，§7.5）。
 *
 * 取每个步骤的 `t0` 时刻最接近的那个采样帧，附上该帧的状态、命令条数、读数与包络。
 * **不重跑程序**：帧已经在 `run.frames` 里了（§14"复用同一次 Dry-Run 的产物"）。
 *
 * @param {{frames:Array, steps:Array}} run
 * @param {{duration?:number}} [meta]
 * @returns {Array<object>}
 */
function buildKeyframes(run, meta = {}) {
  const frames = run.frames ?? [];
  const steps = Array.isArray(run.steps) ? run.steps : [];
  if (!frames.length) return [];

  // 相邻采样间隔（用于判断"最接近的帧"有多近，并如实记录实际时刻）
  const dt = frames.length >= 2 ? Math.abs(frames[1].t - frames[0].t) : (run.dt ?? 0);

  return steps.map((step, index) => {
    const t0 = Number(step?.t0 ?? 0);
    // 帧按时间递增；线性找最接近的一帧（帧数在千级，不值得上二分）
    let best = frames[0];
    let bestGap = Math.abs(best.t - t0);
    for (const f of frames) {
      const gap = Math.abs(f.t - t0);
      if (gap < bestGap) {
        best = f;
        bestGap = gap;
      }
    }
    return {
      step: index + 1,
      title: step?.title ?? null,
      /** 该步骤在 STEPS 里声明的起点时刻 */
      t0,
      /** 实际取到的那一帧的时刻（采样是离散的，因此可能略有偏差） */
      frameT: Number(best.t.toFixed(6)),
      /** 采样偏差（毫秒）；用来判断"声明的 t0 有没有落在采样点上" */
      offsetMs: Number((bestGap * 1000).toFixed(3)),
      /** 该帧的绘制命令条数——为 0 通常意味着这一步的 stateAt 分支写漏了 */
      commands: best.commands ?? best.commandCount ?? 0,
      /** 该帧的状态对象（已剥掉运行时内部字段） */
      state: best.state ?? null,
      /** 该帧的读数（用于"步骤边界该显示什么"的事后核对） */
      readouts: (best.readouts ?? []).map((r) => ({ key: r.key, label: r.label, value: r.value, unit: r.unit })),
      /** 该帧的绘制包络（世界坐标），供导出裁切与排查 */
      envelope: best.envelope ?? null,
    };
  });
}

function envelopeOver(frames) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of frames) {
    if (!f.envelope) continue;
    minX = Math.min(minX, f.envelope.minX);
    minY = Math.min(minY, f.envelope.minY);
    maxX = Math.max(maxX, f.envelope.maxX);
    maxY = Math.max(maxY, f.envelope.maxY);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX: r6(minX), minY: r6(minY), maxX: r6(maxX), maxY: r6(maxY) };
}

const r6 = (v) => Number(v.toFixed(6));

export { CHECK_IDS };
