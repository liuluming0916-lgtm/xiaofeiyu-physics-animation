/**
 * 解题历史与审计记录（M23 · 方案 §16「数据库」/ §17 M23 / §18 期 8）
 *
 * 方案原文只要求两件事，本文件严格按这两件事做，**不多做**：
 *   ① **表结构与写入接口位保留**；
 *   ② **界面无入口**（"历史记录已写库但界面无入口"是第 8 期的验收原文之一）。
 *
 * 所以：有表、有写接口、有读接口（给工具和门禁用），但**没有任何页面**。
 *
 * ── 为什么是 SQLite 而不是 JSON ────────────────────────────────
 * 观测记录（`core/observability/`）**每次一坨 JSON**，适合"一次一次看"；
 * 历史表要回答的是"第 3 次和今天这次比，哪一步变慢了"这类**跨行比较**，
 * 那是数据库的活。两者分工：JSON 留现场，SQLite 留账。
 *
 * ── 三条口径（都会在门禁 ㉟ 里被钉住） ─────────────────────────
 * ① **Key 绝不入库**：所有字符串在写之前过 `redactValue()`，
 *    门禁会把生成的 `.db` 文件**按字节**扫一遍找 Key（不是查内存）。
 * ② **重跑同一 runId = 覆盖那一行**（`INSERT OR REPLACE`）。
 *    理由：观测目录里同一个 runId 只会有一份，覆盖比"留两行互相矛盾"诚实；
 *    级联的子表由 `ON DELETE CASCADE` 一并清掉。
 * ③ **不可用要吵**：`better-sqlite3` 是原生模块，换机器可能装不上。
 *    装不上时**明确报 `history.unavailable`**，绝不静默跳过写库
 *    （静默跳过的后果是"验收时以为记了、其实一条没有"）。
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import { PROJECT_ROOT } from '../../tools/paths.mjs';
import { collectSecrets, redactValue } from '../security/index.mjs';

/**
 * 同步加载原生模块。
 *
 * 为什么用 `createRequire` 而不是 `import`：
 *   `better-sqlite3` 是**原生模块**，装不上时 `import` 会在模块链接阶段直接抛错 ——
 *   那会让"整个应用启动就崩"，连"优雅降级并说明原因"的机会都没有。
 *   用 CJS 的 `require` 包在 try 里，失败就得到一个 null，后面报 `history.driver-missing`。
 */
const requireCjs = createRequire(import.meta.url);
let SqliteCtor = null;
let driverError = null;
try {
  SqliteCtor = requireCjs('better-sqlite3');
} catch (e) {
  driverError = String(e?.message ?? e);
}

/**
 * 表结构版本（改结构就加 1，`ensureSchema()` 会据此迁移）。
 * v2：`worldbook_hash` → `knowledgecard_hash`（v1.1.9alpha 改名）。
 */
export const SCHEMA_VERSION = 2;

/** 默认库文件（`OD_HISTORY_PATH` 可整个改掉；Electron 壳以后会指到 %APPDATA%） */
export function historyPath({ path } = {}) {
  if (path) return resolve(path);
  const fromEnv = process.env.OD_HISTORY_PATH;
  if (fromEnv) return resolve(fromEnv);
  return join(PROJECT_ROOT, 'data', 'history.db');
}

/** 已打开的连接（按绝对路径缓存：better-sqlite3 是同步 API，一个连接够用） */
const cache = new Map();

/**
 * 打开数据库（不存在就建）并保证表结构就位。
 *
 * @param {{ path?: string }} [opts]
 * @returns {{ ok: true, db: object, path: string } | { ok: false, code: string, message: string, path: string }}
 */
export function openHistory({ path } = {}) {
  const abs = historyPath({ path });

  const hit = cache.get(abs);
  if (hit) return { ok: true, db: hit, path: abs };

  let Database = SqliteCtor;
  if (!Database) {
    return {
      ok: false,
      code: 'history.driver-missing',
      message: `没有可用的 SQLite 驱动（better-sqlite3 未安装或架构不匹配${driverError ? `：${driverError}` : ''}）`,
      path: abs,
    };
  }

  try {
    mkdirSync(dirname(abs), { recursive: true });
    const db = new Database(abs);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
    cache.set(abs, db);
    return { ok: true, db, path: abs };
  } catch (e) {
    return { ok: false, code: 'history.open-failed', message: String(e?.message ?? e), path: abs };
  }
}

/**
 * 建表 / 迁移（幂等：跑几次都一样）。
 * @param {object} db
 * @returns {{ ok: boolean, version: number, created: boolean }}
 */
export function ensureSchema(db) {
  const txn = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      /* 一次解题 = 一行。字段是"以后要按它筛/按它比"的那些，不做大而全。 */
      CREATE TABLE IF NOT EXISTS runs (
        run_id           TEXT PRIMARY KEY,
        created_at       TEXT NOT NULL,
        entry            TEXT,
        verdict          TEXT,
        ms               INTEGER DEFAULT 0,
        model            TEXT,
        mode             TEXT,
        prompt_hash      TEXT,
        knowledgecard_hash   TEXT,
        image_count      INTEGER DEFAULT 0,
        tokens_est       INTEGER DEFAULT 0,
        knowledgecard_matched INTEGER DEFAULT 0,
        checks_pass      INTEGER DEFAULT 0,
        checks_warn      INTEGER DEFAULT 0,
        checks_fail      INTEGER DEFAULT 0,
        failed_ids       TEXT DEFAULT '[]',
        stages_json      TEXT DEFAULT '[]',
        record_json      TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_runs_created ON runs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_verdict ON runs (verdict);

      /* 每阶段一行：跨题比较"哪一步慢"靠它，不用解 JSON */
      CREATE TABLE IF NOT EXISTS run_stages (
        run_id  TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        stage   TEXT NOT NULL,
        status  TEXT,
        ms      INTEGER DEFAULT 0,
        chars   INTEGER DEFAULT 0,
        skipped INTEGER DEFAULT 0,
        PRIMARY KEY (run_id, stage)
      );

      /* 审计记录：谁在什么时候动了什么（导出 / 入库 / 改端点…） */
      CREATE TABLE IF NOT EXISTS audit_log (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        at     TEXT NOT NULL,
        kind   TEXT NOT NULL,
        detail TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_kind ON audit_log (kind);
    `);

    /**
     * v2 迁移：老库的 runs 表列名还是 `worldbook_hash`。
     * `CREATE TABLE IF NOT EXISTS` 不会改已有表，所以这里显式 RENAME；
     * 新库已经是 `knowledgecard_hash`，不会命中。
     */
    const cols = db.prepare('PRAGMA table_info(runs)').all().map((c) => c.name);
    if (cols.includes('worldbook_hash') && !cols.includes('knowledgecard_hash')) {
      db.exec('ALTER TABLE runs RENAME COLUMN worldbook_hash TO knowledgecard_hash');
    }
    if (cols.includes('worldbook_matched') && !cols.includes('knowledgecard_matched')) {
      db.exec('ALTER TABLE runs RENAME COLUMN worldbook_matched TO knowledgecard_matched');
    }

    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
    if (!row) {
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
      return { created: true };
    }
    if (Number(row.value) < SCHEMA_VERSION) {
      db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(String(SCHEMA_VERSION), 'schema_version');
    }
    return { created: false, version: SCHEMA_VERSION };
  });

  const r = txn();
  return { ok: true, version: r.version ?? SCHEMA_VERSION, created: Boolean(r.created) };
}

/**
 * 写一次运行记录。
 *
 * @param {object} record `core/observability` 的 `summarize()` 产物（未脱敏也行，这里会脱）
 * @param {{ path?: string, secrets?: string[]|null, now?: string }} [opts]
 * @returns {{ ok: boolean, code?: string, runId?: string, path?: string, stages?: number }}
 */
export function recordRun(record, { path, secrets = null, now = null } = {}) {
  if (!record || typeof record !== 'object') {
    return { ok: false, code: 'history.bad-record' };
  }
  const runId = String(record.runId ?? '').trim();
  if (!runId) return { ok: false, code: 'history.missing-run-id' };

  const opened = openHistory({ path });
  if (!opened.ok) return { ok: false, code: opened.code, path: opened.path };

  const known = secrets ?? collectSecrets({});
  const safe = redactValue(record, { secrets: known });
  const at = String(now ?? safe.startedAt ?? safe.finishedAt ?? new Date().toISOString());

  const checks = safe.checks ?? {};
  const stages = Array.isArray(safe.stages) ? safe.stages : [];

  const insertRun = opened.db.prepare(`
    INSERT OR REPLACE INTO runs
      (run_id, created_at, entry, verdict, ms, model, mode, prompt_hash, knowledgecard_hash,
       image_count, tokens_est, knowledgecard_matched, checks_pass, checks_warn, checks_fail,
       failed_ids, stages_json, record_json)
    VALUES
      (@run_id, @created_at, @entry, @verdict, @ms, @model, @mode, @prompt_hash, @knowledgecard_hash,
       @image_count, @tokens_est, @knowledgecard_matched, @checks_pass, @checks_warn, @checks_fail,
       @failed_ids, @stages_json, @record_json)
  `);

  const insertStage = opened.db.prepare(`
    INSERT OR REPLACE INTO run_stages (run_id, stage, status, ms, chars, skipped)
    VALUES (@run_id, @stage, @status, @ms, @chars, @skipped)
  `);

  const txn = opened.db.transaction(() => {
    // `INSERT OR REPLACE` 会先删后插 ⇒ 子表靠外键级联一起清（避免残留旧阶段行）
    opened.db.prepare('DELETE FROM run_stages WHERE run_id = ?').run(runId);
    insertRun.run({
      run_id: runId,
      created_at: at,
      entry: safe.entry ?? null,
      verdict: safe.verdict ?? null,
      ms: Number(safe.ms ?? 0) || 0,
      model: safe.model ?? null,
      mode: safe.mode ?? null,
      prompt_hash: safe.promptHash ?? null,
      knowledgecard_hash: safe.knowledgecardHash ?? null,
      image_count: Number(safe.imageCount ?? 0) || 0,
      tokens_est: Number(safe.tokens?.est ?? 0) || 0,
      knowledgecard_matched: Number(safe.knowledgecard?.matched ?? 0) || 0,
      checks_pass: Number(checks.pass ?? 0) || 0,
      checks_warn: Number(checks.warn ?? 0) || 0,
      checks_fail: Number(checks.fail ?? 0) || 0,
      failed_ids: JSON.stringify(checks.failedIds ?? []),
      stages_json: JSON.stringify(stages.map((s) => ({ stage: s.stage, status: s.status, ms: s.ms, chars: s.chars, skipped: s.skipped }))),
      record_json: JSON.stringify(safe),
    });
    for (const s of stages) {
      insertStage.run({
        run_id: runId,
        stage: String(s.stage ?? '') || '(unknown)',
        status: s.status ?? null,
        ms: Number(s.ms ?? 0) || 0,
        chars: Number(s.chars ?? 0) || 0,
        skipped: s.skipped ? 1 : 0,
      });
    }
  });

  try {
    txn();
    return { ok: true, runId, path: opened.path, stages: stages.length };
  } catch (e) {
    return { ok: false, code: 'history.write-failed', message: String(e?.message ?? e) };
  }
}

/**
 * 记一条审计（谁在什么时候动了什么）。
 *
 * ⚠ **永不抛错**：审计失败不能把业务请求带崩。
 *   但要留痕迹（`ok:false` + 控制台一行），不做静默。
 *
 * @param {{ kind: string, detail?: object }} entry
 * @param {{ path?: string, secrets?: string[]|null }} [opts]
 * @returns {{ ok: boolean, id?: number, code?: string }}
 */
export function recordAudit({ kind, detail = null } = {}, { path, secrets = null } = {}) {
  const opened = openHistory({ path });
  if (!opened.ok) {
    console.warn(`[audit] 写不了审计（${opened.code}）：${kind}`);
    return { ok: false, code: opened.code };
  }

  try {
    const known = secrets ?? collectSecrets({});
    const safeDetail = detail == null ? null : JSON.stringify(redactValue(detail, { secrets: known }));
    const info = opened.db
      .prepare('INSERT INTO audit_log (at, kind, detail) VALUES (?, ?, ?)')
      .run(new Date().toISOString(), String(kind ?? 'unknown'), safeDetail);
    return { ok: true, id: Number(info.lastInsertRowid) };
  } catch (e) {
    console.warn(`[audit] 写审计失败：${kind} —— ${e?.message ?? e}`);
    return { ok: false, code: 'history.audit-failed' };
  }
}

/**
 * 列历史（最新在前）。**只读**，给工具与门禁用。
 * @param {{ path?: string, limit?: number, verdict?: string }} [opts]
 */
export function listRuns({ path, limit = 50, verdict = null } = {}) {
  const opened = openHistory({ path });
  if (!opened.ok) return { ok: false, code: opened.code, items: [], total: 0 };

  const max = Math.min(500, Math.max(1, Number(limit) || 50));
  const rows = verdict
    ? opened.db.prepare('SELECT * FROM runs WHERE verdict = ? ORDER BY created_at DESC LIMIT ?').all(verdict, max)
    : opened.db.prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT ?').all(max);

  const total = opened.db.prepare('SELECT COUNT(*) AS c FROM runs').get().c;
  return { ok: true, path: opened.path, total, items: rows.map(decodeRow) };
}

/** 取一次运行（含逐阶段） */
export function getRun(runId, { path } = {}) {
  const opened = openHistory({ path });
  if (!opened.ok) return { ok: false, code: opened.code, run: null };

  const row = opened.db.prepare('SELECT * FROM runs WHERE run_id = ?').get(String(runId));
  if (!row) return { ok: false, code: 'history.unknown-run', run: null };

  const stages = opened.db.prepare('SELECT * FROM run_stages WHERE run_id = ? ORDER BY rowid').all(String(runId));
  return { ok: true, run: decodeRow(row), stages };
}

/**
 * **一次通过率**（第 8 期 L4b）。
 *
 * 为什么这个数字必须存在：在此之前观测只记了"15 道真题全部通过"——那是**验收样本**，
 * 由人手写、跑到全绿，不是真实产出。真实产出过不过、要修几轮，**从来没被统计过**，
 * 于是任何改造（改提示词、加示例）都只能靠"感觉变好了"。
 *
 * 口径（三个都要，缺一个就会自欺）：
 *   · `firstPass.rate` = 第 1 轮 dry_run 就 pass 的占比（`checks.rounds === 0`）；
 *   · `avgRounds`       = 平均修复轮数（用来判断"改完之后是更快收敛还是更慢"）；
 *   · `byVerdict`       = 通过/失败/错误的分布（失败也要算进分母，否则通过率会虚高）。
 *
 * ⚠ 轮数从 `record_json` 里取（`checks.rounds`，老记录退回 `counts.repairRounds`），
 *   所以**不改表结构**（`SCHEMA_VERSION` 仍是 1）——只是多算一遍。
 *
 * @param {{ path?: string }} [opts]
 * @returns {{ total: number, pass: number, firstPass: number, rate: number, avgRounds: number, roundsHistogram: Record<number, number>, unreadable: number }}
 */
export function computePassRate(rows = []) {
  const total = rows.length;
  let pass = 0;
  let firstPass = 0;
  let roundsSum = 0;
  let unreadable = 0;
  const roundsHistogram = {};
  for (const row of rows) {
    let record = null;
    if (typeof row.record_json === 'string') {
      try {
        record = JSON.parse(row.record_json);
      } catch {
        record = null;
      }
    } else if (row.record_json && typeof row.record_json === 'object') {
      record = row.record_json;
    }
    if (!record) unreadable += 1;
    const rounds = Number(record?.checks?.rounds ?? record?.counts?.repairRounds ?? record?.rounds ?? NaN);
    const n = Number.isFinite(rounds) && rounds >= 0 ? rounds : 0;
    roundsSum += n;
    roundsHistogram[n] = (roundsHistogram[n] ?? 0) + 1;
    const verdict = String(row.verdict ?? record?.verdict ?? '');
    if (verdict === 'pass' || verdict === 'pass-with-warnings') {
      pass += 1;
      if (n === 0) firstPass += 1;
    }
  }
  return {
    total,
    pass,
    firstPass,
    /** 一次通过率（第 1 轮就过）；分母是**全部**运行，不是"通过的那些" */
    rate: total ? Number((firstPass / total).toFixed(4)) : null,
    passRate: total ? Number((pass / total).toFixed(4)) : null,
    avgRounds: total ? Number((roundsSum / total).toFixed(3)) : null,
    roundsHistogram,
    unreadable,
  };
}

/** 汇总（"历史记录已写库"这条验收的最小证据） */
export function historyStats({ path } = {}) {
  const opened = openHistory({ path });
  if (!opened.ok) return { ok: false, code: opened.code, path: opened.path };

  const total = opened.db.prepare('SELECT COUNT(*) AS c FROM runs').get().c;
  const audits = opened.db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
  const first = opened.db.prepare('SELECT created_at FROM runs ORDER BY created_at ASC LIMIT 1').get()?.created_at ?? null;
  const last = opened.db.prepare('SELECT created_at FROM runs ORDER BY created_at DESC LIMIT 1').get()?.created_at ?? null;
  const byVerdict = opened.db.prepare('SELECT verdict, COUNT(*) AS c FROM runs GROUP BY verdict').all();
  const schema = opened.db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version')?.value ?? null;
  // 第 8 期 L4b：只取这两列算通过率（不解整条 record，省内存）
  const rateRows = opened.db.prepare('SELECT verdict, record_json FROM runs').all();

  return {
    ok: true,
    path: opened.path,
    schemaVersion: schema === null ? null : Number(schema),
    runs: total,
    audits,
    first,
    last,
    byVerdict: Object.fromEntries(byVerdict.map((r) => [String(r.verdict ?? 'null'), r.c])),
    /** 第 8 期 L4b：一次通过率 / 平均修复轮数 / 轮数分布 */
    passRate: computePassRate(rateRows),
    bytes: existsSync(opened.path) ? statSync(opened.path).size : 0,
  };
}

/** 列表里那些 JSON 字段解回来（调用方不用自己 parse） */
function decodeRow(row) {
  const out = { ...row };
  for (const k of ['failed_ids', 'stages_json']) {
    if (typeof out[k] === 'string') {
      try {
        out[k] = JSON.parse(out[k]);
      } catch {
        /* 坏行不该让列表整页打不开 */
      }
    }
  }
  if (typeof out.record_json === 'string') {
    try {
      out.record = JSON.parse(out.record_json);
    } catch {
      out.record = null;
    }
  }
  return out;
}

/** 关掉一个连接（测试与"换库"用） */
export function closeHistory({ path } = {}) {
  const abs = historyPath({ path });
  const db = cache.get(abs);
  if (!db) return { ok: true, closed: false };
  try {
    /**
     * 关之前 **强制把 WAL 合并回主文件**。
     *
     * 为什么重要：WAL 模式下新写入可能还躺在 `history.db-wal` 里，
     * 这时如果只把 `history.db` 拷给别人（"把你的账本发我看看"是常见动作），
     * 对方看到的是**缺数据的旧库** —— 更糟的情况是
     * 门禁"扫 .db 找 Key"会漏掉还在 WAL 里的内容，于是**自证为干净**。
     */
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  } catch {
    /* 已经关了也无所谓 */
  }
  cache.delete(abs);
  return { ok: true, closed: true };
}

/** 关掉全部（进程退出 / 测试收尾） */
export function closeAll() {
  let n = 0;
  for (const [k, db] of cache) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      n += 1;
    } catch {
      /* 忽略 */
    }
    cache.delete(k);
  }
  return { ok: true, closed: n };
}

/**
 * 驱动注入位（**只给测试用**）。
 *
 * 为什么要有它：`better-sqlite3` 是原生模块，CI/换机器可能装不上。
 * 测试要能验证"装不上时明确报错"，也要能在没有原生模块的环境里跑通表结构逻辑。
 */
export function setSqliteDriver(ctor) {
  const prev = SqliteCtor;
  SqliteCtor = ctor ?? null;
  // ⚠ 换驱动前必须把已开连接全关掉：否则缓存里那条连接仍然来自旧驱动，
  //   测试就会"明明设成没驱动、却照样写得进去"（自欺的门禁）。
  closeAll();
  return prev;
}

/** 驱动状态（给"体检/诊断"用：装没装上，一句话说清） */
export function driverStatus() {
  return SqliteCtor
    ? { ok: true, driver: 'better-sqlite3', error: null }
    : { ok: false, driver: null, error: driverError ?? 'better-sqlite3 未安装' };
}
