/**
 * Worker 沙箱（父进程侧）—— §6.3 第二道门的调度与**硬终止**。
 *
 * 三件必须能区分的事（§18 期 2 的"超限报告要能区分超时/超内存/被 kill"）：
 *   · `timeout`        —— 墙钟预算到点，父进程 `worker.terminate()` 抢回 CPU；
 *   · `out-of-memory`  —— `resourceLimits.maxOldGenerationSizeMb` 顶死，Node 抛出可识别的错误；
 *   · `step-budget`    —— 步数预算（`maxFrames`）在 Worker 内触发，属于**合作式**限流，
 *                          与"被 kill"不是一回事，因此单独归类。
 * 另外两类：`crash`（槽位代码抛异常，Worker 正常回报）与 `unavailable`（本环境起不了 Worker ⇒ 回退主线程）。
 *
 * 硬终止后唯一的诊断线索是 `SharedArrayBuffer` 里的"最后执行行"（见 `scan-worker.mjs`）。
 */

import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DRY_RUN_BUDGET } from '../../contracts/spec/frozen-keys.mjs';
import { PROBE_SLOTS } from '../lint/slot-instrument.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCAN_WORKER = join(HERE, 'scan-worker.mjs');

/** C2 的终止类型（报告里 `budget.kind` 用这组值） */
export const TERMINATION_KINDS = Object.freeze([
  'completed',
  'timeout',
  'out-of-memory',
  'step-budget',
  'crash',
  'unavailable',
  // 第 3 期新增：用户主动取消（§21.1 第 3 条"取消后无残留 worker"）。
  // 与 timeout 分开，是因为 UI 与诊断对两者的反应完全不同：取消不报错，超时要报错。
  'cancelled',
]);

function isMemoryError(err) {
  const msg = `${err?.name ?? ''} ${err?.message ?? err}`;
  return /memory limit|out of memory|heap out of memory|resource limit/i.test(msg);
}

/**
 * 在 Worker 里跑一次全时段扫描。
 *
 * @param {{slots:object, mode?:string, dt?:number, maxFrames?:number, entry?:string}} payload
 * @param {{wallClockMs?:number, maxOldGenerationSizeMb?:number, signal?:AbortSignal}} [opts]
 *        `signal`：外部取消（§21.1 第 3 条）。中止时**立刻 terminate 掉 Worker**，
 *        并以 `budget.kind = 'cancelled'` 结束 —— 不是 timeout，也不抛异常。
 * @returns {Promise<object>} 与 `dry-run.mjs` 的 `executeProgram` 同形，另加 `backend/budget/truncated`
 */
export function runScanInWorker(payload, opts = {}) {
  const limitMs = opts.wallClockMs ?? DRY_RUN_BUDGET.wallClockMs;
  const maxOldGenerationSizeMb = opts.maxOldGenerationSizeMb ?? DRY_RUN_BUDGET.maxOldGenerationSizeMb;
  const externalSignal = opts.signal ?? null;
  const started = Date.now();
  // 4 个 Int32：0=槽位下标 1=行号 2=排点计数 3=保留
  const sab = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT);
  const view = new Int32Array(sab);

  const lastMark = () => {
    const slotIndex = Atomics.load(view, 0);
    return { slotIndex, slot: PROBE_SLOTS[slotIndex] ?? null, line: Atomics.load(view, 1), marks: Atomics.load(view, 2) };
  };

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let worker = null;
    let timedOut = false;
    let sawMessage = null;

    /**
     * 外部取消：先声明（`done` 里要引用它），再挂监听。
     * `aborted` 与 `timedOut` 分开记录，因为两者的 `budget.kind` 不同。
     */
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      done(
        base('cancelled', {
          cancelled: true,
          frameCount: 0,
          error: null,
        }),
      );
    };

    const done = (out) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
      try {
        worker?.removeAllListeners();
        worker?.terminate();
      } catch {
        /* 已经死了 */
      }
      resolve(out);
    };

    // ⚠ 在 new Worker **之前**就挂上取消监听：否则"创建到挂监听"这段窗口里发生的取消会被漏掉，
    //   漏掉的后果是 Worker 照样跑到底（= 取消后仍有残留工作，违反 §21.1 第 3 条）。
    if (externalSignal) {
      if (externalSignal.aborted) {
        resolve(base('cancelled', { cancelled: true, frameCount: 0, error: null }));
        return;
      }
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    const base = (kind, extra = {}) => ({
      backend: 'worker',
      available: true,
      wallClockMs: Date.now() - started,
      budget: { kind, limitMs, maxOldGenerationSizeMb, lastMark: lastMark() },
      ...extra,
    });

    try {
      worker = new Worker(SCAN_WORKER, {
        workerData: { ...payload, sab },
        resourceLimits: { maxOldGenerationSizeMb },
      });
    } catch (err) {
      resolve({
        backend: 'worker',
        available: false,
        wallClockMs: Date.now() - started,
        error: { phase: 'worker', kind: 'unavailable', message: String(err?.message ?? err) },
      });
      return;
    }

    timer = setTimeout(() => {
      timedOut = true;
      worker.terminate().catch(() => {});
    }, limitMs);

    worker.on('message', (msg) => {
      sawMessage = msg;
      if (msg?.ok) {
        const kind = msg.truncated === 'step-budget' ? 'step-budget' : 'completed';
        done(base(kind, { ...msg, ok: true }));
      } else {
        done(
          base('crash', {
            ...msg,
            error: { ...(msg?.error ?? {}), kind: msg?.error?.kind ?? 'runtime' },
          }),
        );
      }
    });

    worker.on('error', (err) => {
      const kind = isMemoryError(err) ? 'out-of-memory' : aborted ? 'cancelled' : timedOut ? 'timeout' : 'crash';
      done(
        base(kind, {
          frames: [],
          readoutSeries: [],
          frameCount: 0,
          duration: null,
          steps: [],
          answers: [],
          program: null,
          error: { phase: 'worker', kind, name: err?.name ?? 'Error', message: String(err?.message ?? err), where: lastMark() },
        }),
      );
    });

    worker.on('exit', (code) => {
      if (sawMessage?.ok) return; // 正常路径已在 message 里收尾
      const kind = aborted ? 'cancelled' : timedOut ? 'timeout' : 'crash';
      done(
        base(kind, {
          frames: [],
          readoutSeries: [],
          frameCount: 0,
          duration: null,
          steps: [],
          answers: [],
          program: null,
          error: {
            phase: 'worker',
            kind,
            name: 'WorkerExit',
            message: timedOut
              ? `Dry-Run 超过墙钟预算 ${limitMs} ms，已硬终止（C2）；最后执行到第 ${lastMark().line} 行`
              : `Worker 异常退出（exit ${code}）`,
            where: lastMark(),
          },
        }),
      );
    });
  });
}
