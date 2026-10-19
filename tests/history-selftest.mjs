#!/usr/bin/env node
/**
 * 解题历史与审计取证（第 8 期 · M23）
 *
 * 方案对 M23 的要求很短，但每条都要能证：
 *   · **表结构与写入接口位保留**；
 *   · **界面无入口**（"历史记录已写库但界面无入口"）。
 *
 * 所以这里证明五件事：
 *
 *   **A 表结构**：四张表建起来、`schema_version` 落在 `meta` 里、重复建库幂等。
 *   **B 写入与读回**：一行 run + 每阶段一行；重跑同一 `runId` 是**覆盖**（不翻倍）；
 *      列表/筛选/汇总都能用。
 *   **C Key 绝不入库**：把 Key 塞进题面/模型名/记录里写进去，
 *      然后**关库（强制 WAL 合并）并扫 `.db` 的字节** —— 扫不到才算过。
 *      **负对照**：同一个扫描函数对"故意写脏的样本"必须报出来。
 *   **D 审计**：导出/入库/改 Key 都留痕；`detail` 里不留 Key；写审计失败**不抛错**。
 *   **E 降级 + HTTP**：驱动缺失时明确报 `history.driver-missing`（不静默、不抛崩）；
 *      真起服务真打 4 个接口（200 / 400 / 403 / 404 都要对）。
 *
 * ⚠ 全部在临时目录里跑：不碰仓库真实的 `data/history.db`。
 *
 * 用法：node tests/history-selftest.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isCliEntry } from '../tools/paths.mjs';
import { createRulesService } from '../tools/rules-service.mjs';
import { saveKeys } from '../core/gateway/index.mjs';
import { summarize } from '../core/observability/index.mjs';
import {
  SCHEMA_VERSION,
  closeAll,
  closeHistory,
  computePassRate,
  driverStatus,
  ensureSchema,
  getRun,
  historyStats,
  listRuns,
  openHistory,
  recordAudit,
  recordRun,
  setSqliteDriver,
} from '../core/history/index.mjs';

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

const created = [];
function freshDir(prefix = 'od-hist-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  created.push(d);
  return d;
}

const KEY = 'sk-HISTORY0123456789abcdef';
const PLAIN = 'plainhistorysecret0123';
const requireCjs = createRequire(import.meta.url);

/** 一份"像真的"运行记录（用真实的 summarize，不是手搓形状） */
function sampleRecord(runId) {
  return summarize(
    [
      {
        seq: 1,
        type: 'run_start',
        at: '2026-10-17T10:00:00.000Z',
        entry: '传送带共速与摩擦生热',
        stages: ['solve', 'answers', 'steps', 'scene_code', 'dry_run', 'repair'],
        model: 'model-a',
        mode: 'NUMERIC',
        imageCount: 1,
        maxRepairRounds: 3,
      },
      { seq: 2, type: 'stage_start', at: '2026-10-17T10:00:01.000Z', stage: 'solve' },
      { seq: 3, type: 'stage_delta', at: '2026-10-17T10:00:02.000Z', stage: 'solve', text: '解答正文'.repeat(5) },
      { seq: 4, type: 'stage_done', at: '2026-10-17T10:00:03.000Z', stage: 'solve', chars: 20, ms: 1200 },
      { seq: 5, type: 'stage_start', at: '2026-10-17T10:00:04.000Z', stage: 'answers' },
      { seq: 6, type: 'stage_done', at: '2026-10-17T10:00:05.000Z', stage: 'answers', chars: 10, ms: 800 },
      {
        seq: 7,
        type: 'dryrun_done',
        at: '2026-10-17T10:00:06.000Z',
        verdict: 'fail',
        checks: [
          { id: 'C1', status: 'pass', blocking: true },
          { id: 'C3', status: 'fail', blocking: true },
        ],
        observations: { drawRawCount: 1, drawRawUsage: 0.01 },
        frameCount: 120,
        program: { slots: { PROBLEM: '题面' }, provenance: { model: 'model-b', promptHash: 'ph', knowledgecardHash: 'wh' } },
      },
      { seq: 8, type: 'run_done', at: '2026-10-17T10:00:07.000Z', verdict: 'fail', ms: 5000 },
    ],
    { runId },
  );
}

/** 扫描一个文件里有没有某段字节（模拟"把库发出去"时的检查） */
function fileContains(file, needle) {
  if (!existsSync(file)) return false;
  return readFileSync(file).includes(Buffer.from(needle, 'utf8'));
}

/** 扫描一个库的**全部**伴生文件（WAL/SHM 也算：只扫主文件等于自证） */
function dbContains(dbPath, needle) {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].some((f) => fileContains(f, needle));
}

async function main() {
  console.log('解题历史与审计取证（第 8 期 · M23）\n');

  try {
    /* ══ A 表结构 ══════════════════════════════════════ */
    console.log('『A』表结构：四张表 + 版本号');

    const dbPath = join(freshDir(), 'history.db');

    {
      const st = driverStatus();
      check('★ SQLite 驱动可用（better-sqlite3 装上了）', st.ok === true, st.error ?? '');
      if (!st.ok) throw new Error('没有驱动，后续用例无法进行');
    }

    const opened = openHistory({ path: dbPath });
    check('★ 库文件建起来了', opened.ok === true && existsSync(dbPath));

    {
      const tables = opened.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r) => r.name)
        .filter((n) => !n.startsWith('sqlite_'));
      check('★ 四张表都在（runs / run_stages / audit_log / meta）', ['audit_log', 'meta', 'run_stages', 'runs'].every((t) => tables.includes(t)));
      const ver = opened.db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version')?.value;
      check('★ 结构版本落在 meta 里', Number(ver) === SCHEMA_VERSION);
      check('外键约束开着（子表能级联）', opened.db.pragma('foreign_keys', { simple: true }) === 1);
    }

    {
      const again = ensureSchema(opened.db);
      check('重复建库幂等（不报错、版本不变）', again.ok === true && again.version === SCHEMA_VERSION && again.created === false);
    }

    {
      /* v1.1.9alpha v2 迁移：老库列名 worldbook_hash / worldbook_matched → knowledgecard_* */
      opened.db.exec(`
        ALTER TABLE runs RENAME COLUMN knowledgecard_hash TO worldbook_hash;
        ALTER TABLE runs RENAME COLUMN knowledgecard_matched TO worldbook_matched;
      `);
      const mig = ensureSchema(opened.db);
      const cols = opened.db.prepare('PRAGMA table_info(runs)').all().map((c) => c.name);
      check(
        '★ 老库迁移：worldbook_hash / worldbook_matched 改名为 knowledgecard_*',
        mig.ok === true && cols.includes('knowledgecard_hash') && cols.includes('knowledgecard_matched') && !cols.includes('worldbook_hash') && !cols.includes('worldbook_matched'),
        cols.join(','),
      );
    }

    /* ══ B 写入与读回 ══════════════════════════════════ */
    console.log('\n『B』写入与读回：一行 run + 每阶段一行');

    const rec = sampleRecord('run-h1');
    {
      const w = recordRun(rec, { path: dbPath, secrets: [KEY, PLAIN] });
      check('★ 写入成功', w.ok === true && w.runId === 'run-h1');
      check('逐阶段行数 = 记录里的阶段数', w.stages === 2);
    }

    {
      const got = getRun('run-h1', { path: dbPath });
      check('★ 能按 runId 读回', got.ok === true && got.run.run_id === 'run-h1');
      check('关键字段没丢（verdict / ms / model）', got.run.verdict === 'fail' && got.run.ms === 5000 && got.run.model === 'model-b');
      check('检查号分布落成了列', got.run.checks_fail === 1 && JSON.stringify(got.run.failed_ids) === '["C3"]');
      check('token 估算落成了列（只有 solve 有增量正文：20 个汉字 ⇒ 20）', got.run.tokens_est === 20);
      check('★ 逐阶段另存一张表（跨题比较哪步慢靠它）', got.stages.length === 2 && got.stages.some((s) => s.stage === 'solve' && s.ms === 1200));
      check('完整记录也留了一份（排查现场用）', got.run.record && got.run.record.runId === 'run-h1');
    }

    {
      recordRun({ ...rec, verdict: 'pass', ms: 999 }, { path: dbPath, secrets: [KEY, PLAIN] });
      const all = listRuns({ path: dbPath });
      check('★ 同一 runId 重写 = 覆盖（不出现两行）', all.total === 1 && all.items[0].ms === 999 && all.items[0].verdict === 'pass');
      const got = getRun('run-h1', { path: dbPath });
      check('★ 阶段行也没翻倍（先删后插）', got.stages.length === 2);
    }

    {
      recordRun(sampleRecord('run-h2'), { path: dbPath, secrets: [KEY, PLAIN] });
      const all = listRuns({ path: dbPath });
      check('列表能列出两条', all.total === 2 && all.items.length === 2);
      check('按 verdict 能筛', listRuns({ path: dbPath, verdict: 'fail' }).items.every((r) => r.verdict === 'fail'));
      check('limit 生效', listRuns({ path: dbPath, limit: 1 }).items.length === 1);
      const st = historyStats({ path: dbPath });
      check('★ 汇总：条数 / 结构版本 / 字节数都报得出', st.ok && st.runs === 2 && st.schemaVersion === SCHEMA_VERSION && st.bytes > 0);
      check('读不存在的 runId ⇒ 明确 code', getRun('nope', { path: dbPath }).code === 'history.unknown-run');
    }

    /* ══ B-2 一次通过率（第 8 期 L4b） ═══════════════════ */
    console.log('\n『B-2』一次通过率 / 平均修复轮数：口径必须钉死（失败的也要进分母）');

    {
      const rateDb = join(freshDir(), 'rate.db');
      /** 手造一条记录：只带这一条判据需要的东西（不依赖 summarize 的事件推演） */
      const mk = (runId, verdict, rounds) => ({
        runId,
        startedAt: '2026-10-17T10:00:00.000Z',
        verdict,
        counts: { repairRounds: rounds, stages: 0, done: 0, skipped: 0, error: 0, events: 0 },
        checks: { pass: 0, warn: 0, fail: 0, failedIds: [], blockingFailedIds: [], rounds },
        stages: [],
      });
      recordRun(mk('run-r0', 'pass', 0), { path: rateDb }); // 一次就过
      recordRun(mk('run-r2', 'pass', 2), { path: rateDb }); // 修了 2 轮才过
      recordRun(mk('run-f3', 'fail', 3), { path: rateDb }); // 3 轮没过

      const st = historyStats({ path: rateDb });
      const p = st.passRate;
      check('★ 一次通过率 = 第 1 轮就 pass ÷ 全部运行（含失败的）', p.total === 3 && p.firstPass === 1 && p.rate === 0.3333);
      check('通过率（修过之后过也算）单独给出', p.pass === 2 && p.passRate === 0.6667);
      check('平均修复轮数算得出来', p.avgRounds === 1.667);
      check('轮数分布可读（0 / 2 / 3 各一条）', JSON.stringify(p.roundsHistogram) === '{"0":1,"2":1,"3":1}');
      check('负对照：失败记录**进分母**（不然通过率必然虚高到 100%）', p.total === 3 && p.pass === 2);
      check('纯函数：空输入不炸、比率给 null 而不是 0', computePassRate([]).total === 0 && computePassRate([]).rate === null);
      check('老记录没有 checks.rounds 时退回 counts.repairRounds', computePassRate([{ verdict: 'pass', record_json: JSON.stringify({ counts: { repairRounds: 1 } }) }]).avgRounds === 1);
      check('坏 JSON 不会让汇总崩（记成 unreadable）', computePassRate([{ verdict: 'pass', record_json: '{oops' }]).unreadable === 1);
    }

    {
      check('空记录被拒（缺 runId）', recordRun({ verdict: 'pass' }, { path: dbPath }).code === 'history.missing-run-id');
      check('非对象被拒', recordRun(null, { path: dbPath }).code === 'history.bad-record');
    }

    /* ══ C Key 绝不入库 ═════════════════════════════════ */
    console.log('\n『C』Key 绝不入库：关库之后按字节扫');

    const leakDb = join(freshDir(), 'leak.db');
    {
      const dirty = sampleRecord('run-leak');
      dirty.entry = `题面里贴了 Key：${KEY}`;
      dirty.model = `模型 ${PLAIN}`;
      dirty.errors = [{ stage: 'solve', kind: 'network', message: `连不上，Key=${KEY}`, hint: join(dbPath, 'x.mjs') }];
      const w = recordRun(dirty, { path: leakDb, secrets: [KEY, PLAIN] });
      check('带 Key 的记录也能写（写前脱敏）', w.ok === true);
    }

    {
      // 关库 = 强制 WAL 合并。**只扫主文件之前必须先做这一步**，否则等于自证。
      closeHistory({ path: leakDb });
      check('★ 主库里扫不到两个 Key', dbContains(leakDb, KEY) === false && dbContains(leakDb, PLAIN) === false);
      check('脱敏标记确实写进去了（不是整行被丢掉）', fileContains(leakDb, '«key»'));
      const got = getRun('run-leak', { path: leakDb });
      check('读回来那条记录里也没有 Key', got.ok && !JSON.stringify(got.run).includes(KEY));
    }

    {
      // 负对照：同一个扫描函数，对"故意写脏"的样本必须报出来
      const dirtyFile = join(freshDir(), 'dirty.txt');
      writeFileSync(dirtyFile, `这里有一把钥匙 ${KEY}\n`, 'utf8');
      check('★ 负对照：扫描函数对含 Key 的样本确实会报', fileContains(dirtyFile, KEY) === true);
    }

    /* ══ D 审计 ════════════════════════════════════════ */
    console.log('\n『D』审计：留痕但不留 Key');

    {
      const a = recordAudit({ kind: 'export.page', detail: { name: 'q01.html', note: `Key=${KEY}` } }, { path: dbPath, secrets: [KEY] });
      check('★ 审计写入成功并回 id', a.ok === true && a.id > 0);

      const st = historyStats({ path: dbPath });
      check('汇总里能看到审计条数', st.audits === 1);

      const row = openHistory({ path: dbPath }).db.prepare('SELECT kind, detail FROM audit_log ORDER BY id DESC LIMIT 1').get();
      check('审计的类型记对了', row.kind === 'export.page');
      check('★ 审计 detail 里**没有** Key', !String(row.detail).includes(KEY));
    }

    {
      // 写审计失败**不能**把调用方带崩（这里用"驱动缺失"制造失败）
      const real = requireCjs('better-sqlite3');
      setSqliteDriver(null);
      // 顺手把告警接下来：既让测试输出干净，又**断言它真的告警了**（不静默）
      const origWarn = console.warn;
      const warns = [];
      console.warn = (...a) => warns.push(a.map(String).join(' '));
      let threw = false;
      let r = null;
      try {
        r = recordAudit({ kind: 'should.fail' }, { path: join(freshDir(), 'x.db') });
      } catch {
        threw = true;
      } finally {
        console.warn = origWarn;
        setSqliteDriver(real);
      }
      check('★ 审计写不了时**不抛错**（业务不能被记账带崩）', threw === false && r?.ok === false);
      check('★ 但也不是静默：控制台留了告警', warns.some((w) => w.includes('audit') || w.includes('审计')));
    }

    /* ══ E 降级 + HTTP ═════════════════════════════════ */
    console.log('\n『E』降级与 HTTP：驱动缺失要吵，接口要真打');

    {
      const real = requireCjs('better-sqlite3');
      setSqliteDriver(null);
      const r = openHistory({ path: join(freshDir(), 'nodriver.db') });
      check('★ 驱动缺失 ⇒ 明确报 history.driver-missing（不抛、不静默）', r.ok === false && r.code === 'history.driver-missing');
      check('报错信息里说了原因', typeof r.message === 'string' && r.message.length > 0);
      const w = recordRun(sampleRecord('run-nodriver'), { path: join(freshDir(), 'nodriver2.db') });
      check('写库也如实报同一个 code（不会假装记过了）', w.ok === false && w.code === 'history.driver-missing');
      setSqliteDriver(real);
    }

    {
      const svcDir = freshDir('od-hist-svc-');
      const histPath = join(svcDir, 'history.db');
      const obsDir = join(svcDir, 'obs');
      const staticDir = join(svcDir, 'dist');
      mkdirSync(staticDir, { recursive: true });
      writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>ui</title>ok', 'utf8');
      // 两个 Key 都登记进 keys.json：这样"精确匹配"那条路也能被验到
      // （只登记 KEY 的话，PLAIN 只能靠形态规则，而它不是 sk- 样子 ⇒ 不该期望被抹）
      saveKeys({ dir: svcDir, keys: { ep1: KEY, ep2: PLAIN } });

      const svc = createRulesService({ port: 0, root: svcDir, staticDir, obsDir, historyDbPath: histPath });
      const port = await svc.listen();
      const base = `http://127.0.0.1:${port}`;

      const call = async (method, path, body, headers = {}) => {
        const res = await fetch(`${base}${path}`, {
          method,
          headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* 静态页不是 JSON */
        }
        return { status: res.status, json, text };
      };

      try {
        {
          const r = await call('GET', '/api/history/stats');
          check('★ GET /api/history/stats ⇒ 200 且驱动状态可见', r.status === 200 && r.json.driver?.ok === true);
        }

        {
          const r = await call('POST', '/api/history/runs', { record: sampleRecord('run-http-1') });
          check('★ POST /api/history/runs ⇒ 200 且回 runId', r.status === 200 && r.json.runId === 'run-http-1');
        }

        {
          const r = await call('GET', '/api/history/runs');
          check('★ GET /api/history/runs ⇒ 200 且能列出刚写的', r.status === 200 && r.json.items.some((x) => x.run_id === 'run-http-1'));
        }

        {
          const r = await call('GET', '/api/history/runs/run-http-1');
          check('★ GET /api/history/runs/:id ⇒ 200', r.status === 200 && r.json.run.run_id === 'run-http-1');
        }

        {
          const r = await call('POST', '/api/history/runs', {});
          check('★ POST 空 body ⇒ 400 且给出 history.empty', r.status === 400 && r.json.issues?.[0]?.code === 'history.empty');
        }

        {
          const r = await call('GET', '/api/history/runs/nope');
          check('GET 不存在的 run ⇒ 404', r.status === 404);
        }

        {
          const r = await call('GET', '/api/history/runs', undefined, { origin: 'http://evil.example' });
          check('★ 跨源 ⇒ 403（Origin 校验没被放宽）', r.status === 403);
        }

        {
          // 写脏一次，再从磁盘扫：HTTP 这条路也不能漏 Key
          await call('POST', '/api/history/runs', {
            record: { ...sampleRecord('run-http-leak'), entry: `题面 ${KEY}`, model: PLAIN },
          });
          closeAll();
          check('★ 走 HTTP 写进去的记录里也扫不到 Key', dbContains(histPath, KEY) === false && dbContains(histPath, PLAIN) === false);
        }
      } finally {
        await svc.close();
      }
    }

    /* ══ F 界面无入口 ══════════════════════════════════ */
    console.log('\n『F』界面无入口（方案原文要求）');

    {
      const app = readFileSync(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
      check('★ 导航里没有"历史"这一项', !/history|历史/i.test(app));
      check('★ 前端没有历史页面文件', (() => {
        try {
          readFileSync(new URL('../web/src/pages/HistoryPage.tsx', import.meta.url), 'utf8');
          return false;
        } catch {
          return true;
        }
      })());
    }
  } finally {
    closeAll();
    for (const d of created) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* 临时目录清不掉不影响结论 */
      }
    }
  }

  console.log(`\n${failures.length ? '✗' : '✓'} 历史与审计取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
