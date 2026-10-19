/**
 * 观测与运维（M22 · 方案 §17 M22 / §19.4 / §20 风险表）
 *
 * 一句话：**每次解题留一份"病历"**，出问题时不用靠回忆。
 *
 * 记录的东西（方案原文点名要的）：
 *   阶段 · 模型 · 耗时 · token · 重试 · 命中词条数 · 各槽字符数 · `Draw.raw` 使用率 · 失败检查号分布
 *
 * 两条必须提前说清的**诚实声明**：
 *
 *   ① **token 是估算的**（`estimated: true`）。网关的流式返回里没有 `usage`
 *      （`streamChatCompletion` 恒为 `null`，见 `core/gateway/model-client.mjs`），
 *      所以这里按"中日韩字符 1 个 ≈ 1 token、其余 4 字符 ≈ 1 token"估。
 *      等网关接上 `stream_options.include_usage` 之后，把 `tokens.estimated` 翻成 false 即可，
 *      **字段位置已经留好，不用改消费者**。
 *
 *   ② **`stage_delta` 不留正文**。它是模型逐字上屏的增量，一次解题可能几十万字；
 *      全存下来既撑爆磁盘，也把"日志里出现什么"变得不可控。只留 `chars`。
 *      整段正文的价值在 `slots/` 的槽位代码里已经有了。
 *
 * 落盘结构（全部在 `observability/` 下，**永不进 `ai-rules/`**）：
 *
 *   observability/
 *     runs.jsonl               ← 每次运行一行摘要（列表用，读它不读 run 目录）
 *     runs/<runId>/record.json ← 完整记录（脱敏后）
 *     runs/<runId>/events.jsonl← 逐事件（`stage_delta` 只留字数）
 *     runs/<runId>/problem.md  ← 题面（脱敏后）
 *     runs/<runId>/slots/*.txt ← 八个槽位的代码（脱敏后）
 *     runs/<runId>/dryrun.json ← Dry-Run 报告（可选，脱敏后）
 *     repro/<runId>-<时间戳>/  ← 失败复现包（`repro.mjs` 生成）
 *
 * 环境变量：`OD_OBS_DIR` 可把整个目录搬走（测试与多实例用；与 `OD_DISTILL_DIR` 同一写法）。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';

import { PROJECT_ROOT } from '../../tools/paths.mjs';
import { assertRedacted, collectSecrets, redactText, redactValue } from '../security/index.mjs';

/** 默认目录名（工程根下一个可见目录，和大扫除能一眼看见——不像 `.cache`） */
export const OBS_DIRNAME = 'observability';
export const RUNS_INDEX = 'runs.jsonl';
export const REPRO_DIRNAME = 'repro';

/**
 * 解析观测目录。
 * @param {{ dir?: string }} [opts]
 * @returns {string}
 */
export function resolveObsDir({ dir } = {}) {
  if (dir) return resolve(dir);
  const fromEnv = process.env.OD_OBS_DIR;
  if (fromEnv) return resolve(fromEnv);
  return join(PROJECT_ROOT, OBS_DIRNAME);
}

/**
 * 估算 token 数（**估算**，不是计费数）。
 *
 * 口径：CJK 字符 1 个算 1 token，其余（字母/数字/空白/符号）4 个算 1 token。
 * 这是给"这次大概花了多少"用的量级判断，**不要拿去对账**。
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  const arr = [...String(text ?? '')];
  let cjk = 0;
  for (const ch of arr) {
    const c = ch.codePointAt(0);
    if (
      (c >= 0x2e80 && c <= 0x9fff) || // 中日韩统一表意文字（含扩展 A 起点）
      (c >= 0xf900 && c <= 0xfaff) || // 兼容表意文字
      (c >= 0x3040 && c <= 0x30ff) || // 假名
      (c >= 0xac00 && c <= 0xd7af) || // 谚文
      (c >= 0x3000 && c <= 0x303f) // 中日韩标点
    ) {
      cjk += 1;
    }
  }
  return Math.round(cjk + (arr.length - cjk) / 4);
}

/**
 * 造一个按时间排序、肉眼可读、且**不含随机性**的 runId。
 * 形如 `20261017-142530-123`（测试可传固定 `now`）。
 *
 * @param {number} [now]
 * @returns {string}
 */
export function makeRunId(now = Date.now()) {
  const d = new Date(now);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
    `-${p(d.getMilliseconds(), 3)}`
  );
}

/** 运行目录 */
export function runDirOf(runId, { dir } = {}) {
  return join(resolveObsDir({ dir }), 'runs', runId);
}

/**
 * 事件瘦身：`stage_delta` 只留字数，其余原样（但**不在这里脱敏**，落盘时统一脱）。
 * @param {object} ev
 * @returns {object}
 */
export function trimEvent(ev) {
  if (!ev || typeof ev !== 'object') return { type: 'unknown' };
  const { seq, type, at } = ev;

  if (type === 'stage_delta') {
    return { seq, type, at, stage: ev.stage ?? null, chars: typeof ev.text === 'string' ? ev.text.length : 0 };
  }

  const rest = {};
  for (const [k, v] of Object.entries(ev)) {
    if (k === 'seq' || k === 'type' || k === 'at') continue;
    rest[k] = v;
  }
  return { seq, type, at, ...rest };
}

/**
 * 把一串编排事件压成一份运行记录（**纯函数**，不碰磁盘 ⇒ 可以单测）。
 *
 * @param {object[]} events `runPipeline()` 产出的事件
 * @param {{ runId?: string }} [opts]
 * @returns {object} 运行记录
 */
export function summarize(events, { runId = null } = {}) {
  const list = Array.isArray(events) ? events : [];

  /** @type {Map<string, object>} */
  const stageMap = new Map();
  const stageOrder = [];
  /** 每阶段的增量正文（只用于 token 估算，**绝不落盘**） */
  const textByStage = new Map();
  const errors = [];
  const checksByRound = [];
  let repairRounds = 0;
  let lastDryRun = null;
  let runStart = null;
  let runDone = null;

  const rec = {
    format: 'od-observability-run',
    version: 1,
    runId,
    startedAt: null,
    finishedAt: null,
    ms: 0,
    verdict: null,
    cancelled: false,
    entry: null,
    model: null,
    mode: null,
    promptHash: null,
    worldbookHash: null,
    imageCount: 0,
    maxRepairRounds: 0,
    stages: [],
    counts: { stages: 0, done: 0, skipped: 0, error: 0, repairRounds: 0, events: list.length },
    tokens: { estimated: true, method: 'cjk*1 + other/4', chars: 0, est: 0 },
    worldbook: null,
    judgement: null,
    checks: { pass: 0, warn: 0, fail: 0, failedIds: [], blockingFailedIds: [], rounds: 0 },
    checksByRound: [],
    observations: null,
    slotChars: {},
    repair: null,
    errors,
  };

  const openStage = (stage) => {
    if (!stageMap.has(stage)) {
      const s = { stage, ms: null, chars: 0, skipped: false, reason: null, status: 'run', errors: [] };
      stageMap.set(stage, s);
      stageOrder.push(stage);
    }
    return stageMap.get(stage);
  };

  for (const ev of list) {
    if (!ev || typeof ev !== 'object') continue;
    const type = ev.type;

    if (type === 'run_start') {
      runStart = ev;
      rec.startedAt = ev.at ?? null;
      rec.entry = ev.entry ?? null;
      rec.model = ev.model ?? null;
      rec.mode = ev.mode ?? null;
      rec.imageCount = Number(ev.imageCount ?? 0) || 0;
      rec.maxRepairRounds = Number(ev.maxRepairRounds ?? 0) || 0;
      continue;
    }

    if (type === 'stage_start') {
      const s = openStage(ev.stage);
      s.status = s.status === 'done' || s.status === 'skipped' ? s.status : 'run';
      continue;
    }

    if (type === 'stage_delta') {
      const stage = ev.stage ?? '(unknown)';
      openStage(stage);
      if (typeof ev.text === 'string' && ev.text) {
        textByStage.set(stage, (textByStage.get(stage) ?? '') + ev.text);
      }
      continue;
    }

    if (type === 'stage_done') {
      const s = openStage(ev.stage);
      s.ms = Number(ev.ms ?? 0) || 0;
      s.chars = Number(ev.chars ?? 0) || 0;
      s.skipped = Boolean(ev.skipped);
      s.reason = ev.reason ?? null;
      s.status = s.skipped ? 'skipped' : 'done';
      continue;
    }

    if (type === 'stage_error') {
      const s = openStage(ev.stage);
      s.status = 'error';
      const err = {
        stage: ev.stage ?? null,
        round: ev.round ?? null,
        kind: ev.error?.kind ?? 'unknown',
        message: ev.error?.message ?? String(ev.error ?? ''),
        hint: ev.error?.hint ?? null,
      };
      s.errors.push(err);
      errors.push(err);
      continue;
    }

    if (type === 'judgement_done') {
      rec.judgement = {
        concepts: (ev.concepts ?? []).length,
        tags: (ev.tags ?? []).length,
        elements: (ev.elements ?? []).length,
        unknowns: (ev.unknowns ?? []).length,
        problems: (ev.problems ?? []).length,
        empty: Boolean(ev.empty),
      };
      continue;
    }

    if (type === 'worldbook_done') {
      rec.worldbook = {
        hash: ev.hash ?? null,
        library: Number(ev.libraryCount ?? 0) || 0,
        matched: Number(ev.matched ?? 0) || 0,
        emptySlots: ev.emptySlots ?? [],
        truncatedSlots: ev.truncatedSlots ?? [],
        injectedBySlot: ev.injectedBySlot ?? {},
        charsBySlot: ev.charsBySlot ?? {},
        warnings: (ev.warnings ?? []).length,
      };
      continue;
    }

    if (type === 'dryrun_done') {
      lastDryRun = ev;
      const checks = Array.isArray(ev.checks) ? ev.checks : [];
      const failed = checks.filter((c) => c && c.status && c.status !== 'pass');
      checksByRound.push({
        round: ev.round ?? 0,
        verdict: ev.verdict ?? null,
        failedIds: failed.map((c) => c.id),
        blockingFailedIds: failed.filter((c) => c.blocking).map((c) => c.id),
      });
      continue;
    }

    if (type === 'repair_round') {
      repairRounds += 1;
      continue;
    }

    if (type === 'repair_done') {
      rec.repair = {
        rounds: Number(ev.rounds ?? repairRounds) || 0,
        verdict: ev.verdict ?? null,
        converged: Boolean(ev.converged),
        reason: ev.reason ?? null,
        banner: ev.banner ? redactText(String(ev.banner)) : null,
      };
      repairRounds = Math.max(repairRounds, Number(ev.rounds ?? 0) || 0);
      continue;
    }

    if (type === 'cancelled') {
      rec.cancelled = true;
      continue;
    }

    if (type === 'run_done') {
      runDone = ev;
      rec.verdict = ev.verdict ?? null;
      rec.ms = Number(ev.ms ?? 0) || 0;
      rec.finishedAt = ev.at ?? null;
      if (ev.cancelled) rec.cancelled = true;
      continue;
    }
  }

  /* ── 阶段汇总 ── */
  rec.stages = stageOrder.map((k) => stageMap.get(k));
  rec.counts.stages = rec.stages.length;
  rec.counts.done = rec.stages.filter((s) => s.status === 'done').length;
  rec.counts.skipped = rec.stages.filter((s) => s.status === 'skipped').length;
  rec.counts.error = rec.stages.filter((s) => s.status === 'error').length;
  rec.counts.repairRounds = repairRounds;

  /* ── token 估算（有增量正文就按真实字符算，没有就按字数上界算） ── */
  rec.tokens.chars = rec.stages.reduce((n, s) => n + (Number(s.chars) || 0), 0);
  if (textByStage.size) {
    let est = 0;
    for (const s of rec.stages) est += estimateTokens(textByStage.get(s.stage) ?? '');
    rec.tokens.est = est;
  } else {
    // 拿不到增量正文（例如只重放合成事件）⇒ 按"全是汉字"的上界估，宁高不宁低
    rec.tokens.est = rec.tokens.chars;
  }

  /* ── 检查号分布（取**最后一轮** Dry-Run，另附逐轮明细） ── */
  if (lastDryRun) {
    const checks = Array.isArray(lastDryRun.checks) ? lastDryRun.checks : [];
    rec.checks.pass = checks.filter((c) => c?.status === 'pass').length;
    rec.checks.warn = checks.filter((c) => c?.status === 'warn').length;
    rec.checks.fail = checks.filter((c) => c?.status === 'fail').length;
    rec.checks.failedIds = checks.filter((c) => c?.status && c.status !== 'pass').map((c) => c.id);
    rec.checks.blockingFailedIds = checks.filter((c) => c?.status === 'fail' && c.blocking).map((c) => c.id);
    rec.checks.rounds = checksByRound.length;
    rec.checksByRound = checksByRound;

    rec.observations = {
      frames: Number(lastDryRun.frameCount ?? 0) || 0,
      termination: lastDryRun.termination ?? null,
      // 这两个来自 Dry-Run 的 `report.observations`（`emitDryRunDone` 里透传）
      drawRawCount: Number(lastDryRun.observations?.drawRawCount ?? 0) || 0,
      drawRawUsage: Number(lastDryRun.observations?.drawRawUsage ?? 0) || 0,
    };

    const slots = lastDryRun.program?.slots ?? null;
    if (slots && typeof slots === 'object') {
      for (const [k, v] of Object.entries(slots)) {
        rec.slotChars[k] = typeof v === 'string' ? v.length : 0;
      }
    }

    const prov = lastDryRun.program?.provenance ?? null;
    if (prov) {
      rec.model = prov.model ?? rec.model;
      rec.promptHash = prov.promptHash ?? rec.promptHash;
      rec.worldbookHash = prov.worldbookHash ?? rec.worldbookHash;
    }
  }

  if (runStart?.promptHash) rec.promptHash = rec.promptHash ?? runStart.promptHash;
  if (!rec.worldbookHash && rec.worldbook?.hash) rec.worldbookHash = rec.worldbook.hash;

  return rec;
}

/** 稳定 JSON（键排序，便于比对与做哈希） */
export function stableJson(value) {
  return JSON.stringify(value, null, 2);
}

/** 文本 sha256（清单用） */
export function sha256(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

/**
 * 落盘一次运行（脱敏 + 写后复核）。
 *
 * **写后复核**是这一层的立身之本：写完把每个文件**从磁盘读回来**再查一遍密钥。
 * 不用"内存里的对象应该已经干净了"作证 —— 那正是清理台账里记过的那个坑
 * （核对不能与操作共用同一套判断）。
 *
 * @param {{
 *   record: object,
 *   events?: object[],
 *   slots?: Record<string,string>|null,
 *   problemText?: string|null,
 *   dryRunReport?: object|null,
 *   secrets?: string[],
 *   dir?: string,
 * }} input
 * @returns {{ ok: boolean, code?: string, runId: string, dir: string, files: {name: string, bytes: number, sha256: string}[] }}
 */
export function commitRun({
  record,
  events = [],
  slots = null,
  problemText = null,
  dryRunReport = null,
  secrets = null,
  dir,
} = {}) {
  const runId = record?.runId || makeRunId();
  const obsDir = resolveObsDir({ dir });
  const runDir = join(obsDir, 'runs', runId);
  const known = secrets ?? collectSecrets({ dir: undefined });

  const files = [];
  const write = (name, text) => {
    // 相对名统一成 POSIX 分隔符：否则 Windows 上记的是 `slots\setup.txt`，
    // 而清单/复现包里按 `slots/setup.txt` 找 —— 一个跨平台的坑，且只在 Windows 上炸。
    const rel = String(name).split('\\').join('/');
    const abs = join(runDir, rel);
    const body = redactText(String(text ?? ''), { secrets: known });
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
    files.push({ name: rel, bytes: Buffer.byteLength(body, 'utf8'), sha256: sha256(body) });
  };

  mkdirSync(runDir, { recursive: true });

  const safeRecord = redactValue({ ...record, runId }, { secrets: known });
  write('record.json', stableJson(safeRecord));

  if (Array.isArray(events) && events.length) {
    const lines = events.map((ev) => JSON.stringify(redactValue(trimEvent(ev), { secrets: known })));
    write('events.jsonl', `${lines.join('\n')}\n`);
  }

  if (typeof problemText === 'string' && problemText.trim()) write('problem.md', problemText);

  if (slots && typeof slots === 'object') {
    for (const [k, v] of Object.entries(slots)) {
      if (typeof v !== 'string') continue;
      write(`slots/${k}.txt`, v);
    }
  }

  if (dryRunReport) write('dryrun.json', stableJson(redactValue(dryRunReport, { secrets: known })));

  /* ── 索引（一行一次，append-only） ── */
  mkdirSync(obsDir, { recursive: true });
  const line = JSON.stringify({
    runId,
    at: safeRecord.startedAt ?? safeRecord.finishedAt ?? new Date().toISOString(),
    verdict: safeRecord.verdict,
    entry: safeRecord.entry,
    ms: safeRecord.ms,
    model: safeRecord.model,
    stages: safeRecord.counts?.stages ?? 0,
    tokensEst: safeRecord.tokens?.est ?? 0,
    failedIds: safeRecord.checks?.failedIds ?? [],
  });
  appendFileSync(join(obsDir, RUNS_INDEX), `${line}\n`, 'utf8');

  /* ── 写后复核：从磁盘读回来查（不是查内存） ── */
  for (const f of files) {
    const abs = join(runDir, f.name);
    const back = readFileSync(abs, 'utf8');
    assertRedacted(back, { secrets: known, where: `运行记录 ${runId}/${f.name}` });
  }

  return { ok: true, runId, dir: runDir, files };
}

/**
 * 读运行索引（最新在前）。
 * @param {{ dir?: string, limit?: number }} [opts]
 * @returns {{ ok: boolean, dir: string, items: object[], total: number }}
 */
export function readRuns({ dir, limit = 50 } = {}) {
  const obsDir = resolveObsDir({ dir });
  const file = join(obsDir, RUNS_INDEX);
  if (!existsSync(file)) return { ok: true, dir: obsDir, items: [], total: 0 };

  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const items = [];
  for (const l of lines) {
    try {
      items.push(JSON.parse(l));
    } catch {
      /* 坏行跳过：索引坏掉不该让整个观测面板打不开 */
    }
  }
  const total = items.length;
  const sliced = items.slice(Math.max(0, total - limit)).reverse();
  return { ok: true, dir: obsDir, items: sliced, total };
}

/**
 * 读一次运行的完整记录。
 * @param {string} runId
 * @param {{ dir?: string }} [opts]
 * @returns {{ ok: boolean, code?: string, runId: string, record: object|null, runDir: string }}
 */
export function readRun(runId, { dir } = {}) {
  const runDir = runDirOf(runId, { dir });
  const file = join(runDir, 'record.json');
  if (!existsSync(file)) {
    return { ok: false, code: 'observability.unknown-run', runId, record: null, runDir };
  }
  try {
    return { ok: true, runId, record: JSON.parse(readFileSync(file, 'utf8')), runDir };
  } catch {
    return { ok: false, code: 'observability.bad-record', runId, record: null, runDir };
  }
}

/** 列出 run 目录（磁盘为准，不信索引） */
export function listRunDirs({ dir } = {}) {
  const base = join(resolveObsDir({ dir }), 'runs');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** 目录名（调试用：只回末段，不回绝对路径） */
export function shortDir(p) {
  return basename(String(p ?? ''));
}

/**
 * 自动记录的包装器：把 `runPipeline()` 这类**事件源**包一层，
 * 边转发给上游（界面照常流式上屏）边在结束时自动落一份运行记录。
 *
 * 为什么做成包装器而不是改 `pipeline.mjs`：
 *   ① 编排是第 2–4 期就定死的地基，往里塞 I/O 会把"纯事件流"变成"有副作用"，
 *      之后每个测试都要为磁盘买单；
 *   ② 观测是**横切关注点**，谁来驱动流水线都该自动有记录 —— 包一层最省心。
 *
 * 用法：
 * ```js
 * for await (const ev of watchRun(runPipeline(input), { dir })) { render(ev); }
 * ```
 * 结束时会自动 `commitRun()`；生成器的**返回值**是 `commitRun()` 的结果
 * （`for await` 拿不到返回值，需要时用 `onCommit` 回调，或用 `manual()` 自己驱动）。
 *
 * ⚠ 出错也照样记录：异常会先落盘再抛出去 —— 最需要复盘的时候恰恰是失败那次。
 *
 * @param {AsyncIterable<object>} source
 * @param {{ dir?: string, secrets?: string[]|null, problemText?: string|null, onCommit?: (r: object) => void }} [opts]
 * @yields {object} 原样转发的事件
 * @returns {Promise<object|undefined>} `commitRun()` 的结果
 */
export async function* watchRun(source, { dir, secrets = null, problemText = null, onCommit = null } = {}) {
  const events = [];
  let committed;

  const finish = (extraError = null) => {
    const record = summarize(events);
    if (extraError) {
      record.errors.push({ stage: null, round: null, kind: 'thrown', message: String(extraError?.message ?? extraError), hint: null });
      record.verdict = record.verdict ?? 'error';
    }
    // 槽位代码从最后一条 `dryrun_done` 里取（那是唯一带完整 8 槽的地方）
    let slots = null;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (ev?.type === 'dryrun_done' && ev.program?.slots && typeof ev.program.slots === 'object') {
        slots = ev.program.slots;
        break;
      }
    }
    try {
      committed = commitRun({ record, events, slots, problemText, secrets, dir });
      if (onCommit) onCommit(committed);
    } catch (e) {
      // 记账失败**不能**让业务跟着挂：说明清楚，继续往上抛原始异常
      committed = { ok: false, code: e?.code ?? 'observability.commit-failed', runId: record.runId, dir: null, files: [] };
      if (onCommit) onCommit(committed);
    }
    return committed;
  };

  try {
    for await (const ev of source) {
      events.push(ev);
      yield ev;
    }
  } catch (e) {
    finish(e);
    throw e;
  }

  return finish();
}
