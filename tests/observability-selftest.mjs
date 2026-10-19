#!/usr/bin/env node
/**
 * 安全脱敏 + 日志与失败复现包取证（第 8 期 · M21 / M22）
 *
 * 要证明的五件事：
 *
 *   **A 脱敏器真的会抹**：已知 Key 原值、`sk-` 形态、`Bearer`、URL 里的 `?key=`、
 *      以及绝对路径（工程内 ⇒ `<project>`，工程外 ⇒ `<abs>/文件名`）；
 *      并且**负对照**成立 —— 同一个查找函数在**没脱敏的样本上必须搜得到**
 *      （否则"搜不到"只能说明搜索坏了）。
 *   **B 运行记录认得事件**：`summarize()` 是纯函数，喂合成事件就能算出阶段/耗时/
 *      token 估算/检查号分布/世界书命中/`Draw.raw` 使用率/槽位字数。
 *   **C 落盘即脱敏**：`commitRun()` 写完之后**从磁盘读回来**查，一个字节都不许漏；
 *      并且 `stage_delta` 的正文**不入库**（只留字数）。
 *   **D 复现包能发出去**：`buildReproPack()` 产出的每个文件都过一遍查找，
 *      清单里只有相对路径与 sha256。
 *   **E HTTP 层真打**：第 7 期的教训是"只测被调用的函数等于没测"，
 *      所以这里起真服务、真发请求（200 / 400 / 403 都要对），再扫它写出来的盘。
 *
 * ⚠ 全部在临时目录里跑：不碰仓库真实的 `ai-rules/`、`observability/`。
 *
 * 用法：node tests/observability-selftest.mjs
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROJECT_ROOT, isCliEntry } from '../tools/paths.mjs';
import { createRulesService } from '../tools/rules-service.mjs';
import { saveKeys } from '../core/gateway/index.mjs';
import {
  KEY_MASK,
  MASK,
  assertRedacted,
  collectSecrets,
  findSecrets,
  maskPaths,
  redactText,
  redactValue,
} from '../core/security/index.mjs';
import {
  auditReproPack,
  buildReproPack,
  commitRun,
  estimateTokens,
  listReproPacks,
  readRun,
  readRuns,
  summarize,
  trimEvent,
  watchRun,
} from '../core/observability/index.mjs';

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
function freshDir(prefix = 'od-obs-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  created.push(d);
  return d;
}

/** 一个"像 Key"的值（会被形态规则抓到） */
const KEY = 'sk-TESTOBS0123456789abcdef';
/** 一个**不像 Key** 的值（只能靠"已知原值"精确匹配抓到）—— 这是精确匹配的考点 */
const PLAIN = 'plainsecret0123456789';

/** 合成一串编排事件（形状照 `core/orchestrator/events.mjs`） */
function sampleEvents(extra = {}) {
  return [
    {
      seq: 1,
      type: 'run_start',
      at: '2026-10-17T10:00:00.000Z',
      entry: '传送带共速与摩擦生热',
      stages: ['solve', 'answers', 'steps', 'scene_code', 'dry_run', 'repair'],
      model: 'model-a',
      mode: 'NUMERIC',
      promptHash: null,
      imageCount: 1,
      maxRepairRounds: 3,
    },
    { seq: 2, type: 'stage_start', at: '2026-10-17T10:00:01.000Z', stage: 'solve', index: 1, total: 6 },
    { seq: 3, type: 'stage_delta', at: '2026-10-17T10:00:02.000Z', stage: 'solve', text: '解答正文'.repeat(10) },
    { seq: 4, type: 'stage_done', at: '2026-10-17T10:00:03.000Z', stage: 'solve', chars: 40, ms: 1200 },
    {
      seq: 5,
      type: 'judgement_done',
      at: '2026-10-17T10:00:04.000Z',
      stage: 'read_problem',
      concepts: ['匀变速直线运动', '摩擦力做功'],
      tags: ['传送带'],
      elements: ['ground'],
      unknowns: ['表外词'],
      problems: [],
      empty: false,
    },
    {
      seq: 6,
      type: 'knowledgecard_done',
      at: '2026-10-17T10:00:05.000Z',
      hash: 'wb-hash-abc',
      libraryCount: 44,
      matched: 3,
      entries: [],
      emptySlots: [],
      truncatedSlots: [{ slot: 'solve' }],
      injectedBySlot: { solve: 3 },
      charsBySlot: { solve: 900 },
      warnings: [],
    },
    {
      seq: 7,
      type: 'dryrun_done',
      at: '2026-10-17T10:00:06.000Z',
      verdict: 'fail',
      cancelled: false,
      checks: [
        { id: 'C1', status: 'pass', blocking: true, message: '静态预检通过' },
        { id: 'C3', status: 'fail', blocking: true, message: '瞬移' },
        { id: 'C10', status: 'warn', blocking: false, message: '扩展检查告警' },
      ],
      extensions: [],
      diagnostics: [{ check: 'C3', message: '第 12 行' }],
      termination: 'done',
      frameCount: 120,
      observations: { drawRawCount: 2, drawRawUsage: 0.02 },
      program: {
        slots: { PROBLEM: '题目正文', STEPS: 't0: 0\nt1: 2', setup: 'x', stateAt: 'y' },
        mode: 'NUMERIC',
        provenance: { model: 'model-b', promptHash: 'ph-1', knowledgecardHash: 'wh-1', templateVersion: '1.0.0' },
      },
    },
    { seq: 8, type: 'repair_round', at: '2026-10-17T10:00:07.000Z', round: 1 },
    {
      seq: 9,
      type: 'repair_done',
      at: '2026-10-17T10:00:08.000Z',
      rounds: 1,
      verdict: 'fail',
      converged: false,
      reason: '达到轮次上限',
      banner: '三轮未收敛，已带告警交付',
    },
    { seq: 10, type: 'run_done', at: '2026-10-17T10:00:09.000Z', verdict: 'fail', ms: 5000 },
    ...(Array.isArray(extra.events) ? extra.events : []),
  ];
}

async function main() {
  console.log('安全脱敏与观测取证（第 8 期 · M21 / M22）\n');

  try {
    /* ══ A 脱敏器 ══════════════════════════════════════════ */
    console.log('『A』脱敏：Key 与路径');

    const rawWithKey = `请求头 authorization: Bearer ${KEY}，题面里也贴了 ${KEY}`;
    check('负对照：查找函数在**未脱敏**样本上确实能搜到（否则"搜不到"不算证据）', findSecrets(rawWithKey, { secrets: [KEY] }).length > 0);

    {
      const out = redactText(rawWithKey, { secrets: [KEY] });
      check('★ 已知 Key 原值被抹掉', !out.includes(KEY));
      check('★ 抹掉后查找函数报告"干净"', findSecrets(out, { secrets: [KEY] }).length === 0);
      check('掩码是显式标记（不是空字符串）', out.includes(KEY_MASK));
    }

    {
      const out = redactText(`key=${KEY}&x=1`);
      check('URL 查询参数里的 Key 也被抹掉', !out.includes(KEY) && out.includes('key='));
    }

    {
      const out = redactText('Authorization: Bearer abcdefghijklmnop');
      check('Bearer 形态被拦（即使不知道这个 Key）', !out.includes('abcdefghijklmnop'));
    }

    {
      const out = redactText('看起来像 sk-proj-abcdefgh12345678 的东西');
      check('sk- 形态被拦（即使不知道这个 Key）', !out.includes('abcdefgh12345678'));
    }

    {
      // 长原值先替换：否则 `sk-…` 形态规则先吃掉前半段，剩下的尾巴会留在正文里
      const long = 'sk-abcdefgh12345678';
      const out = redactText(`值=${long}`, { secrets: [long] });
      check('★ 原值比形态规则更长时，不会漏下尾巴', !out.includes('12345678'));
    }

    {
      const once = redactText(rawWithKey, { secrets: [KEY] });
      const twice = redactText(once, { secrets: [KEY] });
      check('脱敏是幂等的（抹两次 == 抹一次）', once === twice);
    }

    {
      const out = maskPaths(`工程: ${join(PROJECT_ROOT, 'core', 'a.mjs')}`, { projectRoot: PROJECT_ROOT });
      check('★ 工程内路径 ⇒ <project>…', out.includes('<project>') && !out.includes(PROJECT_ROOT));
    }

    {
      const out = redactText('别的盘: C:\\Users\\SomeoneElse\\private\\notes.txt');
      check('★ 工程外 Windows 路径只留末段文件名', !out.includes('SomeoneElse') && out.includes('notes.txt'));
    }

    {
      const out = redactText('另一个系统: /home/bob/work/secret.txt');
      check('工程外 POSIX 路径也只留末段', !out.includes('bob') && out.includes('secret.txt'));
    }

    {
      const v = redactValue({
        apiKey: 'whatever-this-is',
        token: 'ttt',
        authorization: 'Bearer x',
        keys: { ep1: 'secret' },
        knowledgecard: { keys: ['传送带', '共速'] },
        list: [{ password: 'p' }],
      });
      check('结构性脱敏：字段名命中即掩码（不看内容）', v.apiKey === MASK && v.token === MASK && v.authorization === MASK);
      check('结构性脱敏：`keys` 对象被清空（端点 Key 表的形状）', JSON.stringify(v.keys) === '{}');
      check('★ 但世界书的 `keys` **数组**（触发词）必须保留', v.knowledgecard.keys.length === 2 && v.knowledgecard.keys[0] === '传送带');
      check('嵌套数组里的密钥字段也拦得住', v.list[0].password === MASK);
    }

    {
      const dir = freshDir();
      saveKeys({ dir, keys: { ep1: KEY } });
      const got = collectSecrets({ dir });
      check('★ 能从 keys.json 精确取到 Key', got.includes(KEY));
      check('但不回显长度以外的信息（只给原值数组，不写盘）', Array.isArray(got) && got.length === 1);
    }

    {
      let threw = false;
      try {
        assertRedacted(`里面有 ${KEY}`, { secrets: [KEY] });
      } catch (e) {
        threw = e.code === 'security.leak';
      }
      check('★ 断言函数在**有残留时确实会抛**（负对照）', threw);
    }

    /* ══ B 运行记录 ═══════════════════════════════════════ */
    console.log('\n『B』运行记录：从事件算出指标（纯函数）');

    const events = sampleEvents();
    const rec = summarize(events, { runId: 'run-test-1' });

    check('阶段数与完成数', rec.stages.length === 1 && rec.counts.done === 1);
    check('★ 耗时取 `run_done` 给的值', rec.ms === 5000 && rec.verdict === 'fail');
    check('★ token 是**估算**且标明（`estimated: true`）', rec.tokens.estimated === true && rec.tokens.method.includes('cjk'));
    check('字数与估算数（40 个汉字 ⇒ 40）', rec.tokens.chars === 40 && rec.tokens.est === 40);
    check('`estimateTokens` 对纯英文按 4 字符 1 token', estimateTokens('abcdefgh') === 2);
    check('检查号分布 pass/warn/fail', rec.checks.pass === 1 && rec.checks.warn === 1 && rec.checks.fail === 1);
    check('★ 失败检查号（含非阻塞的扩展检查）', rec.checks.failedIds.join(',') === 'C3,C10');
    check('★ 阻塞失败的检查号单独列出', rec.checks.blockingFailedIds.join(',') === 'C3');
    check('★ `Draw.raw` 使用率从 Dry-Run 透传过来', rec.observations.drawRawUsage === 0.02 && rec.observations.drawRawCount === 2);
    check('世界书命中数与截断槽位', rec.knowledgecard.matched === 3 && rec.knowledgecard.truncatedSlots.length === 1);
    check('各槽字符数（方案 §M22 点名要的）', rec.slotChars.PROBLEM === 4 && rec.slotChars.STEPS === 11);
    check('模型/哈希以 Dry-Run 的 Provenance 为准', rec.model === 'model-b' && rec.promptHash === 'ph-1' && rec.knowledgecardHash === 'wh-1');
    check('自愈轮次与收敛结论', rec.repair.rounds === 1 && rec.repair.converged === false);
    check('判定（考点/题型/元件/表外词）计数', rec.judgement.concepts === 2 && rec.judgement.unknowns === 1);
    check('取消标记默认 false', rec.cancelled === false);

    {
      const cancelled = summarize([
        { seq: 1, type: 'run_start', at: '2026-10-17T10:00:00.000Z', entry: 'x' },
        { seq: 2, type: 'cancelled', at: '2026-10-17T10:00:01.000Z', stage: 'solve' },
        { seq: 3, type: 'run_done', at: '2026-10-17T10:00:02.000Z', verdict: 'cancelled', ms: 900, cancelled: true },
      ]);
      check('取消路径认得出来', cancelled.cancelled === true && cancelled.verdict === 'cancelled');
    }

    {
      const failed = summarize([
        { seq: 1, type: 'run_start', at: '2026-10-17T10:00:00.000Z', entry: 'x' },
        { seq: 2, type: 'stage_start', at: '2026-10-17T10:00:01.000Z', stage: 'solve' },
        { seq: 3, type: 'stage_error', at: '2026-10-17T10:00:02.000Z', stage: 'solve', error: { kind: 'network', message: '连不上', hint: '检查地址' } },
        { seq: 4, type: 'run_done', at: '2026-10-17T10:00:03.000Z', verdict: 'error', ms: 300 },
      ]);
      check('阶段错误被记下来（kind/message/hint 都在）', failed.errors.length === 1 && failed.errors[0].kind === 'network');
      check('出错的阶段标成 error', failed.stages[0].status === 'error');
      check('错误计数', failed.counts.error === 1);
    }

    {
      const trimmed = trimEvent(events[2]);
      check('★ `stage_delta` 瘦身后**没有正文**、只留字数', trimmed.text === undefined && trimmed.chars === 40);
      check('其他事件原样保留', trimEvent(events[3]).ms === 1200);
    }

    /* ══ C 落盘即脱敏 ═════════════════════════════════════ */
    console.log('\n『C』落盘：写完从磁盘读回来查');

    const obsRoot = freshDir('od-obs-run-');
    const secrets = [KEY, PLAIN];
    const dirty = `这次跑挂了。密钥=${KEY}，另一个=${PLAIN}，路径=${join(PROJECT_ROOT, 'core', 'x.mjs')}`;
    const commit = commitRun({
      record: { ...rec, runId: 'run-c1', entry: dirty },
      events,
      slots: { PROBLEM: `题面 ${dirty}`, setup: 'const a = 1;' },
      problemText: dirty,
      dryRunReport: { verdict: 'fail', detail: dirty },
      secrets,
      dir: obsRoot,
    });

    check('★ 写盘成功并回报文件清单', commit.ok === true && commit.files.length >= 5);
    check('清单里没有绝对路径（只有相对名）', commit.files.every((f) => !f.name.includes(':') && !f.name.startsWith('/')));

    {
      const all = {};
      for (const f of commit.files) all[f.name] = readFileSync(join(commit.dir, f.name), 'utf8');
      const joined = Object.values(all).join('\n');
      check('★ 所有落盘文件里**搜不到**两个 Key', findSecrets(joined, { secrets }).length === 0);
      check('★ 工程路径也被抹成 <project>', !joined.includes(PROJECT_ROOT) && joined.includes('<project>'));
      check('题面文件里能看到脱敏标记（不是被整份吞掉）', all['problem.md'].includes(KEY_MASK));
      check('槽位代码确实存了（排查问题主要看它）', all['slots/setup.txt'].includes('const a = 1'));
      check('★ 增量正文没有入库（只留字数）', !joined.includes('解答正文'));
      check('record.json 是合法 JSON', (() => { try { JSON.parse(all['record.json']); return true; } catch { return false; } })());
    }

    {
      const idx = readRuns({ dir: obsRoot });
      check('索引里能列出这次运行', idx.items.length === 1 && idx.items[0].runId === 'run-c1');
      check('索引行也不含 Key', !JSON.stringify(idx).includes(KEY));
      const one = readRun('run-c1', { dir: obsRoot });
      check('能按 runId 读回完整记录', one.ok && one.record.runId === 'run-c1');
      check('读不存在的 runId ⇒ 明确的 code', readRun('nope', { dir: obsRoot }).code === 'observability.unknown-run');
    }

    /* ══ D 失败复现包 ═════════════════════════════════════ */
    console.log('\n『D』失败复现包：能发出去的一份');

    {
      const pack = buildReproPack({ runId: 'run-c1', dir: obsRoot, secrets, note: `人工触发，密钥 ${KEY}` });
      check('★ 生成成功', pack.ok === true && pack.files.length >= 6);
      check('清单里只有相对路径', pack.files.every((f) => !f.name.includes(':') && !f.name.startsWith('/')));
      check('清单声明了脱敏（不是静默）', pack.manifest.redaction.applied === true && pack.manifest.redaction.knownSecrets === 2);
      check('清单里带 sha256', pack.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
      check('★ manifest 里没有绝对路径', !JSON.stringify(pack.manifest).includes(PROJECT_ROOT));
      check('包里有人话说明（README.txt）', pack.files.some((f) => f.name === 'README.txt'));
      check('包里有槽位代码（诊断价值最高）', pack.files.some((f) => f.name === 'slots/PROBLEM.txt'));

      const audit = auditReproPack(pack.dir, secrets);
      check('★ 独立审计：整个包扫一遍，零残留', audit.ok === true && audit.scanned === pack.files.length);

      // 负对照：把"含 Key 的文件"喂给同一个审计器，它必须**报出来**。
      // 只证明"干净"不够 —— 还得证明"它有能力发现脏"。
      const dirtyDir = freshDir('od-obs-dirty-');
      writeFileSync(join(dirtyDir, 'leak.txt'), `这里有一把钥匙 ${KEY}\n`, 'utf8');
      const dirtyAudit = auditReproPack(dirtyDir, [KEY]);
      check('★ 负对照：审计器对含 Key 的样本确实报出残留', dirtyAudit.ok === false && dirtyAudit.leaks.length === 1);
    }

    {
      const listed = listReproPacks({ dir: obsRoot });
      check('能列出已有的复现包', listed.items.length === 1 && listed.items[0].runId === 'run-c1');
      check('未知 runId ⇒ 明确 code', buildReproPack({ runId: 'nope', dir: obsRoot, secrets }).code === 'observability.unknown-run');
      check('空 runId ⇒ 明确 code', buildReproPack({ runId: '  ', dir: obsRoot, secrets }).code === 'observability.missing-run-id');
    }

    /* ══ E 自动记录包装器 ═════════════════════════════════ */
    console.log('\n『E』自动记录：包一层就自动落盘（不要求谁来手动喂）');

    {
      async function* fakePipeline() {
        for (const ev of sampleEvents()) yield ev;
      }

      const autoDir = freshDir('od-obs-auto-');
      const forwarded = [];
      let committed = null;

      for await (const ev of watchRun(fakePipeline(), {
        dir: autoDir,
        secrets,
        problemText: `题面 ${KEY}`,
        onCommit: (r) => {
          committed = r;
        },
      })) {
        forwarded.push(ev);
      }

      check('★ 事件原样转发给上游（界面照常流式上屏）', forwarded.length === sampleEvents().length);
      check('★ 生成结束自动落盘', committed?.ok === true && typeof committed.runId === 'string');
      check('自动落盘时把 8 个槽位也存了（从 `dryrun_done` 里取）', committed.files.some((f) => f.name === 'slots/PROBLEM.txt'));
      check('自动记录里也搜不到 Key', !readFileSync(join(committed.dir, 'problem.md'), 'utf8').includes(KEY));
    }

    {
      async function* exploding() {
        yield { seq: 1, type: 'run_start', at: '2026-10-17T10:00:00.000Z', entry: '会炸的' };
        throw new Error('管道炸了');
      }

      const boomDir = freshDir('od-obs-boom-');
      let captured = null;
      let threw = false;
      try {
        for await (const _ev of watchRun(exploding(), { dir: boomDir, secrets, onCommit: (r) => { captured = r; } })) {
          /* 只消费 */
        }
      } catch (e) {
        threw = e.message === '管道炸了';
      }

      check('★ 出错时照样落一份记录（最需要复盘的就是失败那次）', captured?.ok === true);
      check('异常仍然原样抛给上游（观测不能吞错）', threw === true);
      check('记录里标注了这次是"抛出的异常"', (() => {
        const rec = readRun(captured.runId, { dir: boomDir });
        return rec.ok && rec.record.errors.some((x) => x.kind === 'thrown') && rec.record.verdict === 'error';
      })());
    }

    /* ══ F HTTP 层真打 ════════════════════════════════════ */
    console.log('\n『F』HTTP 层：真起服务、真发请求（第 7 期的教训）');

    const svcDir = freshDir('od-obs-svc-');
    const obsDir = join(svcDir, 'obs');
    const staticDir = join(svcDir, 'dist');
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>ui</title>ok', 'utf8');
    saveKeys({ dir: svcDir, keys: { ep1: KEY, ep2: PLAIN } });

    const svc = createRulesService({ port: 0, root: svcDir, staticDir, obsDir, historyDbPath: join(svcDir, 'history.db') });
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
        const r = await call('GET', '/api/observability/runs');
        check('★ 空目录时 GET runs ⇒ 200 且列表为空', r.status === 200 && r.json.items.length === 0);
      }

      let runId = null;
      {
        const r = await call('POST', '/api/observability/runs', {
          events: sampleEvents(),
          slots: { PROBLEM: `题面 ${KEY}` },
          problemText: `题面 ${KEY} 与 ${PLAIN}`,
        });
        runId = r.json?.runId ?? null;
        check('★ POST runs ⇒ 200 且回 runId', r.status === 200 && typeof runId === 'string' && runId.length > 0);
        check('回执里带写过的文件清单', Array.isArray(r.json.files) && r.json.files.length >= 4);
        // M23 联动：同一次提交也要进历史库（"历史记录已写库"的闭环）
        check('★ 同一次提交顺手写进了历史库', r.json.history?.ok === true);
      }

      {
        const r = await call('GET', '/api/observability/runs');
        check('★ GET runs ⇒ 200 且能列出刚写的那条', r.status === 200 && r.json.items.some((x) => x.runId === runId));
      }

      {
        const r = await call('GET', `/api/observability/runs/${runId}`);
        check('★ GET runs/:id ⇒ 200 且记录可读', r.status === 200 && r.json.record.runId === runId);
        check('记录里有阶段与检查号（不是空壳）', Array.isArray(r.json.record.stages) && r.json.record.checks.failedIds.length > 0);
      }

      {
        const r = await call('GET', '/api/observability');
        check('GET /api/observability ⇒ 200（总览）', r.status === 200 && r.json.total >= 1);
      }

      {
        const r = await call('POST', '/api/observability/runs', {});
        check('★ POST runs 空 body ⇒ 400 且给出 observability.empty', r.status === 400 && r.json.issues?.[0]?.code === 'observability.empty');
      }

      {
        const r = await call('GET', '/api/observability/runs/nope-nope');
        check('GET 不存在的 run ⇒ 404', r.status === 404);
      }

      {
        const r = await call('POST', '/api/observability/repro', { runId });
        check('★ POST repro ⇒ 200 且生成文件', r.status === 200 && r.json.files.length >= 6);
        check('复现包清单声明脱敏', r.json.manifest.redaction.applied === true);
      }

      {
        const r = await call('POST', '/api/observability/repro', { runId: 'nope-nope' });
        check('★ POST repro 未知 runId ⇒ 400 且给出 unknown-run', r.status === 400 && r.json.issues?.[0]?.code === 'observability.unknown-run');
      }

      {
        const r = await call('GET', '/api/observability/repro');
        check('GET repro ⇒ 200 且列出刚生成的包', r.status === 200 && r.json.items.length >= 1);
      }

      {
        const r = await call('GET', '/api/observability/runs', undefined, { origin: 'http://evil.example' });
        check('★ 跨源 ⇒ 403（Origin 校验没被放宽）', r.status === 403 && r.json.issues?.[0]?.code === 'http.cross-origin');
      }

      {
        /* 扫服务自己写出来的盘：既要没 Key，也要没明文异种密钥 */
        const runs = readRuns({ dir: obsDir, limit: 100 });
        const pack = listReproPacks({ dir: obsDir });
        let joined = '';
        for (const item of runs.items) {
          const one = readRun(item.runId, { dir: obsDir });
          if (one.ok) joined += JSON.stringify(one.record);
        }
        check('★ 服务写出来的记录里搜不到 Key', findSecrets(joined, { secrets: [KEY, PLAIN] }).length === 0);
        check('复现包目录已建', pack.items.length >= 1);
      }
    } finally {
      await svc.close();
    }
  } finally {
    for (const d of created) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* 临时目录清不掉不影响结论 */
      }
    }
  }

  console.log(`\n${failures.length ? '✗' : '✓'} 安全脱敏与观测取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
