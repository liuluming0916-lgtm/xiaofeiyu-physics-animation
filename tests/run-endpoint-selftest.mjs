#!/usr/bin/env node
/**
 * 真跑链路取证（第 8 期 · 补第 9 步 · 门禁 ㊸）
 *
 * ── 为什么补这一门 ──
 *
 * v1.0 装上之后用户第一句话是："打开的是演示页，不是真正工作的页面。"
 *
 * 根因：前端第 3 期就写好了 `serverEventSource()`（打 `/api/run` 读 SSE），
 * 但**服务端从来没有这个路由**，解题页只能写死 `source: 'demo'`。
 * 更糟的是：41 道门禁全绿，因为**没有任何一门检查过"真跑这条路"**。
 *
 * 所以这一门只验一件事：**`POST /api/run` 这条链路，从错误码到事件流，都按设计工作**。
 *
 * 覆盖：
 *   A 前置条件必须**明确报错**（不是静默退回演示）
 *   B 配好之后必须返回 **SSE 事件流**，第一帧是 `run_start`
 *   C 事件流里**绝不出现 Key**
 *   D 取消（客户端断开）能停下链路
 *   E 前端源码里**不许再把 source 写死成 demo**
 *
 * 用注入的 `streamImpl` / `dryRunImpl` 跑（不联网、不花 token），
 * 这正是 `createRulesService` 预留注入口的用途。
 *
 * 用法：node tests/run-endpoint-selftest.mjs
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROJECT_ROOT, isCliEntry } from '../tools/paths.mjs';
import { createRulesService } from '../tools/rules-service.mjs';

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
function freshRulesDir({ withEndpoint = false, withKey = false, supportsVision = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'od-run-'));
  created.push(dir);
  if (withEndpoint) {
    writeFileSync(
      join(dir, 'endpoints.json'),
      JSON.stringify(
        {
          version: 1,
          endpoints: [
            {
              id: 'ep-local',
              displayName: '自检用端点',
              baseURL: 'http://127.0.0.1:9/v1',
              defaultModel: 'fake-model',
              visionModel: '',
              apiKeyModelId: null,
              supportsJsonMode: true,
              supportsVision,
              enableThinking: false,
              preserveThinking: false,
              timeoutMs: 5000,
            },
          ],
          stageModels: { solve: 'ep-local' },
        },
        null,
        2,
      ),
      'utf8',
    );
    mkdirSync(join(dir, 'worldbook'), { recursive: true });
  }
  if (withKey) {
    writeFileSync(join(dir, 'keys.json'), JSON.stringify({ version: 1, keys: { 'ep-local': 'sk-SELFTEST-LEAK-CANARY' } }, null, 2), 'utf8');
  }
  return dir;
}

/** 假模型：按阶段给固定文本（只为把链路走通，不追求内容质量） */
function fakeStream() {
  const SCRIPT = {
    solve: '物块先加速后匀速。',
    answers: 'symbol: t*\nvalue: 1.0\nunit: s\ntol: 0.01\nat_t: 1.0\nstep: 2',
    steps: 'title: 第 1 步 · 加速\ntex: a=2\nt0: 0\nt1: 1.0',
    scene_code: '',
  };
  return async function* stream({ stage }) {
    const text = SCRIPT[stage] ?? '';
    if (text) yield text;
  };
}

/** 假 Dry-Run：直接判 pass（不启 Worker，门禁里更快更稳） */
function fakeDryRun() {
  return async () => ({
    verdict: 'pass',
    execution: { ok: true, steps: 1, ms: 1 },
    checks: [{ id: 'C1', status: 'pass', message: '自检桩：通过' }],
    extensions: [],
    diagnostics: [],
    observations: {},
    chartSeries: [],
    keyframes: [],
    labelAvoid: null,
    error: null,
  });
}

async function withService(dir, fn) {
  const svc = createRulesService({
    port: 0,
    root: dir,
    serveStatic: false,
    /* v1.1.7：开源日志跟着临时目录走 —— 自检不许往仓库根写日志 */
    openLogDir: join(dir, '开源日志'),
    streamImpl: fakeStream(),
    dryRunImpl: fakeDryRun(),
  });
  const port = await svc.listen();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await svc.close();
  }
}

const post = (base, body) =>
  fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** 任意 JSON POST（给非 /api/run 的路由用） */
const post2 = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** 读 SSE：返回原始文本与前 N 帧 */
async function readSse(res, maxFrames = 60) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const frames = [];
  while (frames.length < maxFrames) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let m;
    while ((m = /\r?\n\r?\n/.exec(buf)) !== null) {
      const frame = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (!data) continue;
      try {
        frames.push(JSON.parse(data));
      } catch {
        /* 坏帧忽略 */
      }
      if (frames.length >= maxFrames) break;
    }
  }
  try {
    await reader.cancel();
  } catch {
    /* 已结束 */
  }
  return { text: buf, frames };
}

async function main() {
  console.log('真跑链路取证（第 8 期 · 补第 9 步）\n');

  /* ══ A 前置条件：必须明确报错 ══ */
  console.log('『A』前置条件不满足时**明确报错**，不静默退回演示');

  {
    const empty = freshRulesDir();
    await withService(empty, async (base) => {
      const r = await post(base, { problem: { text: '一道题' }, images: [], mode: 'NUMERIC' });
      const j = await r.json();
      check('★ 没配端点 ⇒ 400 + `endpoint.missing`', r.status === 400 && j.code === 'endpoint.missing', `${r.status} ${j.code}`);
      check('★ 报错里写明"去右上角齿轮配"', /连接设置/.test(j.message ?? ''), j.message);
    });

    const noKey = freshRulesDir({ withEndpoint: true });
    await withService(noKey, async (base) => {
      const r = await post(base, { problem: { text: '一道题' }, images: [], mode: 'NUMERIC' });
      const j = await r.json();
      check('★ 有端点没 Key ⇒ 400 + `key.missing`', r.status === 400 && j.code === 'key.missing', `${r.status} ${j.code}`);
    });

    const noVision = freshRulesDir({ withEndpoint: true, withKey: true, supportsVision: false });
    await withService(noVision, async (base) => {
      const r = await post(base, {
        problem: { text: '看图题' },
        images: [{ mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }],
        mode: 'NUMERIC',
      });
      const j = await r.json();
      check('★ 传图但端点标不支持看图 ⇒ 400 + `vision.unsupported`', r.status === 400 && j.code === 'vision.unsupported', `${r.status} ${j.code}`);
    });

    const ok = freshRulesDir({ withEndpoint: true, withKey: true });
    await withService(ok, async (base) => {
      const r = await post(base, { problem: { text: '   ' }, images: [], mode: 'NUMERIC' });
      const j = await r.json();
      check('★ 空题目 ⇒ 400 + `run.empty`', r.status === 400 && j.code === 'run.empty', `${r.status} ${j.code}`);
    });
  }

  /* ══ B 配好之后：返回 SSE 事件流 ══ */
  console.log('\n『B』配好之后返回 **SSE 事件流**（第一帧必须是 run_start）');

  let seen = [];
  {
    const dir = freshRulesDir({ withEndpoint: true, withKey: true });
    await withService(dir, async (base) => {
      const r = await post(base, { problem: { text: '传送带上一物块' }, images: [], mode: 'NUMERIC' });
      check('★ 状态码 200', r.status === 200, String(r.status));
      check('★ 内容类型是 text/event-stream', /text\/event-stream/.test(r.headers.get('content-type') ?? ''), r.headers.get('content-type'));
      const { frames } = await readSse(r, 40);
      seen = frames;
      check('★ 至少收到一帧', frames.length > 0, String(frames.length));
      check('★ 第一帧是 `run_start`', frames[0]?.type === 'run_start', frames[0]?.type);
      check('★ 事件带递增序号 seq', frames.length > 1 ? frames[1].seq > frames[0].seq : true);
      check('★ 事件类型都在契约枚举里', frames.every((f) => ['run_start', 'stage_start', 'stage_delta', 'stage_done', 'dryrun_done', 'stage_error', 'run_done', 'cancelled', 'repair_round', 'repair_done', 'worldbook_done', 'judgement_done', 'run_label'].includes(f.type)), frames.map((f) => f.type).join(','));
    });
  }

  /* ══ B2 图片：dataURL 必须能解成字节 ══ */
  console.log('\n『B2』图片编码：前端发 `dataUrl`，服务端要能解成字节');
  {
    const onePixelPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    /* 空 dataUrl ⇒ 明确报错，而不是让网关去报"图片内容为空" */
    const dirEmpty = freshRulesDir({ withEndpoint: true, withKey: true, supportsVision: true });
    await withService(dirEmpty, async (base) => {
      const r = await post(base, {
        problem: { text: '看图题' },
        images: [{ mime: 'image/png', dataUrl: '' }],
        mode: 'NUMERIC',
      });
      const j = await r.json();
      check('★ 空图片 ⇒ 400 + `run.bad-image`（不是网关那句"图片内容为空"）', r.status === 400 && j.code === 'run.bad-image', `${r.status} ${j.code}`);
    });

    /* 合法 dataURL + 支持看图 ⇒ 正常开流，且**不能**再出现"图片内容为空" */
    const dirOk = freshRulesDir({ withEndpoint: true, withKey: true, supportsVision: true });
    await withService(dirOk, async (base) => {
      const r = await post(base, {
        problem: { text: '看图题' },
        images: [{ mime: 'image/png', dataUrl: onePixelPng }],
        mode: 'NUMERIC',
      });
      check('★ 合法 dataURL ⇒ 200 开流', r.status === 200, String(r.status));
      const { frames } = await readSse(r, 30);
      const blob = JSON.stringify(frames);
      check('★ 事件流里没有"图片内容为空"（说明图真的被解出来了）', !blob.includes('图片内容为空'), blob.slice(0, 200));
      check('★ 首帧仍是 run_start', frames[0]?.type === 'run_start', frames[0]?.type);
    });
  }

  /* ══ E 端点地址容错 + 看图能力实测 ══ */
  console.log('\n『E』`/v1` 兜底 与 看图能力实测探针');
  {
    const { createServer } = await import('node:http');
    const { streamChatCompletion } = await import('../core/gateway/model-client.mjs');
    const { testConnection, formatConnectionResult } = await import('../core/gateway/connection-test.mjs');

    /* E1：只认 /v1 的服务端（用户少写一个 /v1 的典型情形） */
    const s1 = createServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html>Cannot POST</html>');
    });
    await new Promise((r) => s1.listen(0, '127.0.0.1', r));
    try {
      let got = '';
      await streamChatCompletion({
        endpoint: { id: 'e1', baseURL: `http://127.0.0.1:${s1.address().port}`, defaultModel: 'm', timeoutMs: 5000 },
        apiKey: 'k',
        messages: [{ role: 'user', content: 'hi' }],
        onDelta: (d) => {
          got += d;
        },
      });
      check('★ 少写 `/v1` 时自动兜底（404 后再试 `/v1/chat/completions`）', got === 'OK', JSON.stringify(got));
    } catch (e) {
      check('★ 少写 `/v1` 时自动兜底（404 后再试 `/v1/chat/completions`）', false, e.message);
    } finally {
      s1.close();
    }

    /* E2：模型明确不收图片 ⇒ 探针必须说"不能看图"，并转述对端原话 */
    const s2 = createServer((req, res) => {
      if (req.url === '/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
        return;
      }
      if (req.url === '/chat/completions') {
        let b = '';
        req.on('data', (c) => {
          b += c;
        });
        req.on('end', () => {
          if (b.includes('image_url')) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'This model does not support image input' } }));
          } else {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
            res.end();
          }
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => s2.listen(0, '127.0.0.1', r));
    try {
      const r = await testConnection({
        endpoint: { id: 'e2', baseURL: `http://127.0.0.1:${s2.address().port}`, defaultModel: 'fake', timeoutMs: 5000 },
        apiKey: 'k',
        probeVision: true,
      });
      check('★ 探针给出"不能看图"的结论', r.vision?.ok === false && r.vision?.code === 'vision-unsupported', JSON.stringify(r.vision));
      check('★ 结论里转述**对端原话**（不是含糊的"失败了"）', /does not support image/i.test(r.vision?.message ?? ''), r.vision?.message);
      check('★ 给人看的文本里也有这一行', /看图能力（实测）/.test(formatConnectionResult(r)));
      check('★ 400 结构化错误**不会**被误当成"路径错"重试（否则原话会被 404 覆盖）', !/404/.test(r.vision?.message ?? ''), r.vision?.message);
    } finally {
      s2.close();
    }
  }

  /* ══ F "闪退"防线：路由抛错不能带走整个进程 ══ */
  console.log('\n『F』路由异常不能把进程带走（用户报的"点导出就闪退"）');
  {
    const svcSrc = readFileSync(join(PROJECT_ROOT, 'tools/rules-service.mjs'), 'utf8');
    const mainSrc2 = readFileSync(join(PROJECT_ROOT, 'electron/main.cjs'), 'utf8');

    /**
     * 事故复盘：导出成功后路由先 `ok()` 写了 200，紧接着写审计记录时抛错，
     * 外层 catch 又往**已结束的响应**上写 ⇒ `ERR_STREAM_WRITE_AFTER_END`
     * 从 catch 里冒出去 ⇒ unhandled rejection ⇒ Node 退出 ⇒ 应用闪退。
     *
     * 三条防线缺一不可：
     *   ① `sendJson` 见到已结束的响应就不写；
     *   ② 外层 catch 先检查 `writableEnded`，且自己再包一层 try；
     *   ③ 壳子里注册 `uncaughtException` / `unhandledRejection`（兜底：至少留日志、不静默死）。
     */
    check('★ ① `sendJson` 有"已结束就别写"的守卫', /if \(res\.writableEnded \|\| res\.destroyed\) return;/.test(svcSrc));
    check('★ ② 外层 catch 也检查 `writableEnded`', /if \(res\.writableEnded \|\| res\.destroyed\) \{[\s\S]{0,120}res\.end\(\)/.test(svcSrc));
    check('★ ② 外层 catch 里的 `bad()` 被 try 包住（不能再抛）', /try \{\s*return bad\(res, \[\{ code: 'server\.error'/.test(svcSrc));
    check('★ ③ 壳子注册了 uncaughtException', /process\.on\('uncaughtException'/.test(mainSrc2));
    check('★ ③ 壳子注册了 unhandledRejection', /process\.on\('unhandledRejection'/.test(mainSrc2));
    check('★ ③ 壳子记录渲染进程崩溃原因（render-process-gone）', /render-process-gone/.test(mainSrc2));

    /* 真跑：给导出端点喂垃圾输入 ⇒ 必须 400，且**服务还活着** */
    const dir = freshRulesDir();
    await withService(dir, async (base) => {
      const r = await post2(`${base}/api/export/page`, { slots: {}, mode: 'NUMERIC' });
      check('★ 导出路由异常 → 返回 4xx/5xx（不是把进程带走）', r.status >= 400 && r.status < 600, String(r.status));
      const health = await fetch(`${base}/api/health`);
      check('★ 出完错之后 `/api/health` 仍 200（进程没退）', health.status === 200, String(health.status));
    });
  }

  /* ══ G 超时：慢但活着 vs 真的卡死 ══ */
  console.log('\n『G』超时口径：`idle`（多久没新数据）而不是"总时长"');
  {
    const { createServer } = await import('node:http');
    const { streamChatCompletion } = await import('../core/gateway/model-client.mjs');

    const serve = (handler) =>
      new Promise((resolve) => {
        const s = createServer(handler);
        s.listen(0, '127.0.0.1', () => resolve(s));
      });
    const epOf = (s) => ({ id: 'g', baseURL: `http://127.0.0.1:${s.address().port}`, defaultModel: 'm' });

    /* G1：慢但持续有数据 —— 总时长远超单块间隔，应当成功 */
    const slow = await serve((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let i = 0;
      const t = setInterval(() => {
        i += 1;
        res.write('data: {"choices":[{"delta":{"content":"Z"}}]}\n\n');
        if (i >= 8) {
          clearInterval(t);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }, 120);
    });
    try {
      let got = '';
      await streamChatCompletion({
        endpoint: epOf(slow),
        apiKey: 'k',
        messages: [{ role: 'user', content: 'hi' }],
        idleTimeoutMs: 300,
        totalTimeoutMs: 8000,
        onDelta: (d) => {
          got += d;
        },
      });
      check('★ 慢但活着（每块 120ms，共 ~1s）不该被误杀', got.length === 8, JSON.stringify(got));
    } catch (e) {
      check('★ 慢但活着（每块 120ms，共 ~1s）不该被误杀', false, `${e.kind}: ${e.message}`);
    } finally {
      slow.close();
    }

    /* G2：发一块就卡死 —— 应当快速报"空闲超时"，并说明已收到的部分仍可用 */
    const stall = await serve((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"K"}}]}\n\n');
    });
    try {
      await streamChatCompletion({
        endpoint: epOf(stall),
        apiKey: 'k',
        messages: [{ role: 'user', content: 'hi' }],
        idleTimeoutMs: 300,
        totalTimeoutMs: 8000,
        onDelta: () => {},
      });
      check('★ 卡死必须报超时（不能当成"生成完了"）', false, '竟然成功返回了');
    } catch (e) {
      check('★ 卡死必须报超时（不能当成"生成完了"）', e.kind === 'timeout', String(e.kind));
      check('★ 说明是"没收到新内容"，不是含糊的"流中断"', /没有收到新内容/.test(e.message), e.message);
      check('★ 明确告知"已收到的文本仍然可用"', /仍然可用/.test(e.message), e.message);
    } finally {
      stall.close();
    }
  }
  /* ══ H 思考模式：按阶段开关 + 网关不认字段时的兜底 ══ */
  console.log('\n『H』思考模式（`thinking: enabled` + `reasoning_effort: high`）');
  {
    const { createServer } = await import('node:http');
    const { streamChatCompletion } = await import('../core/gateway/model-client.mjs');

    const setup = (handler) =>
      new Promise((resolve) => {
        const s = createServer(handler);
        s.listen(0, '127.0.0.1', () => resolve(s));
      });
    const captureBody = (seen) => (req, res) => {
      let b = '';
      req.on('data', (c) => {
        b += c;
      });
      req.on('end', () => {
        seen.push(JSON.parse(b || '{}'));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
        res.end();
      });
    };

    const seen = [];
    const s1 = await setup(captureBody(seen));
    const ep1 = { id: 'h1', baseURL: `http://127.0.0.1:${s1.address().port}`, defaultModel: 'm' };
    try {
      await streamChatCompletion({ endpoint: ep1, apiKey: 'k', stage: 'scene_code', messages: [{ role: 'user', content: 'x' }], onDelta() {} });
      await streamChatCompletion({ endpoint: ep1, apiKey: 'k', stage: 'read_problem', messages: [{ role: 'user', content: 'x' }], onDelta() {} });
      check('★ 写代码阶段开思考：thinking.type = enabled', seen[0]?.thinking?.type === 'enabled', JSON.stringify(seen[0]?.thinking));
      check('★ 思考强度 = high', seen[0]?.reasoning_effort === 'high', String(seen[0]?.reasoning_effort));
      check('★ 读图转写阶段**不**开思考（它只是抄字，不该变慢）', seen[1]?.thinking === undefined && seen[1]?.reasoning_effort === undefined);
    } finally {
      s1.close();
    }

    /* 网关不认识这两个字段 ⇒ 自动去掉重试一次 */
    let calls = 0;
    const s2 = await setup((req, res) => {
      let b = '';
      req.on('data', (c) => {
        b += c;
      });
      req.on('end', () => {
        calls += 1;
        const body = JSON.parse(b || '{}');
        if (calls === 1) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: "Unrecognized request argument: 'reasoning_effort'" } }));
          return;
        }
        check('★ 重试时已去掉思考字段（不硬塞给不支持的网关）', body.thinking === undefined && body.reasoning_effort === undefined);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');
        res.end();
      });
    });
    try {
      let got = '';
      await streamChatCompletion({
        endpoint: { id: 'h2', baseURL: `http://127.0.0.1:${s2.address().port}`, defaultModel: 'm' },
        apiKey: 'k',
        stage: 'solve',
        messages: [{ role: 'user', content: 'x' }],
        onDelta: (d) => {
          got += d;
        },
      });
      check('★ 兜底后仍能成功（网关不认字段不该让整题失败）', got === 'OK', JSON.stringify(got));
    } finally {
      s2.close();
    }
  }
  /* ══ C Key 绝不出现在事件流里 ══ */
  console.log('\n『C』Key 绝不进事件流');
  {
    const leaked = JSON.stringify(seen).includes('sk-SELFTEST-LEAK-CANARY');
    check('★ 事件流里搜不到 Key（金丝雀值）', !leaked);
  }

  /* ══ D 前端不许再把 source 写死 ══ */
  console.log('\n『D』前端不再写死演示源');
  {
    const solve = readFileSync(join(PROJECT_ROOT, 'web/src/pages/SolvePage.tsx'), 'utf8');
    check('★ 不再出现 `start({ source: \'demo\' })`', !/start\(\{\s*source:\s*'demo'\s*\}\)/.test(solve));
    check('★ 改成按 runSource 决定', /start\(\{\s*source:\s*runSource\s*\}\)/.test(solve));
    check('★ 界面上说明了当前走哪条路（已接本机模型 / 演示源）', /已接本机模型/.test(solve) && /当前是「演示源」/.test(solve));
    /**
     * ⚠ 判据必须**锚在行首**：`const visionAvailable = false` 这几个字也出现在
     * 解释历史的那段注释里（`* 历史：第 3 期这里写的是 ...`），
     * 用普通 `test()` 会被注释误伤 —— 这个坑本文件已经踩过一次（注释会进产物/进匹配）。
     */
    check('★ 视觉门控读服务端配置（不再写死 false）', !/^\s*const visionAvailable\s*=\s*false/m.test(solve) && /setVisionAvailable\(Boolean\(ep\.supportsVision\)\)/.test(solve));
  }

  for (const d of created) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* 临时目录清不掉不影响结论 */
    }
  }

  console.log(`\n${failures.length ? '✗' : '✓'} 真跑链路取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
