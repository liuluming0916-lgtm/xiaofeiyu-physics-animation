#!/usr/bin/env node
/**
 * 本机"规则工作室"服务（第 6 期第 5 项）。
 *
 * 为什么需要它：规则文件在磁盘上（`ai-rules/`），浏览器碰不到文件系统。
 * 方案 §2.1 本来就定的是"Node 服务 + 浏览器，回环 127.0.0.1"。这一项把**规则编辑**
 * 这条最小的通道接上：静态页与 `/api/*` 同一个端口（同源 ⇒ 不需要 CORS，也不会被别的站点跨站调）。
 *
 * 安全边界（四条，都是刻意的）：
 *   ① **只绑 127.0.0.1**（不监听 0.0.0.0）；
 *   ② 校验 `Origin`：只接受同源或没有 Origin（curl）的请求 —— 防"你正在浏览的某个网页"偷偷调本地服务；
 *   ③ **永不返回 Key**：端点列表只给打码值，导出走的是"结构上不含 Key"的那条路；
 *   ④ 只做规则/配置的读写，**不执行**任何来自浏览器的代码（没有 eval、没有命令拼装）。
 *
 * 用法：
 *   node tools/rules-service.mjs                 # 默认 8080，规则目录 ai-rules/，静态页 web/dist
 *   node tools/rules-service.mjs --port 8081
 *   node tools/rules-service.mjs --root <目录>    # 指定"规则工作区"目录（自检用临时目录，不碰真实 ai-rules）
 *
 * ⚠ 它不是门禁步骤（是服务）。它的行为由 `tests/rules-service-selftest.mjs` 覆盖。
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { PROJECT_ROOT } from './paths.mjs';
import { PIPELINE_STAGES } from '../contracts/spec/frozen-keys.mjs';
import { RULES_ROOT, describeJsonError, loadRulesWorkspace, readRulesIndex } from '../core/rules/index.mjs';
import {
  buildReproPack,
  commitRun,
  listReproPacks,
  readRun,
  readRuns,
  resolveObsDir,
  summarize,
} from '../core/observability/index.mjs';
import { collectSecrets } from '../core/security/index.mjs';
import {
  driverStatus,
  getRun as historyGetRun,
  historyStats,
  listRuns as historyListRuns,
  recordAudit,
  recordRun as historyRecordRun,
} from '../core/history/index.mjs';
import {
  PROMPT_SECTORS,
  listPromptCatalog,
  openPrompt,
  rebasePromptOverride,
  resetPromptOverride,
  savePromptOverride,
} from '../core/prompts/editor.mjs';
import { PROMPT_REQUIREMENTS } from '../core/prompts/overlay.mjs';
import {
  addCleaningRule,
  loadCleaningTable,
  moveCleaningRule,
  removeCleaningRule,
  resetCleaningTable,
  setCleaningRuleEnabled,
  updateCleaningRule,
} from '../core/cleaner/editor.mjs';
import {
  buildUserMessage,
  clearKey,
  collectChatCompletion,
  exportEndpointsText,
  formatConnectionResult,
  importEndpoints,
  loadEndpointStore,
  loadKeys,
  redact,
  removeEndpoint,
  saveEndpoints,
  setKey,
  setStageModel,
  testConnection,
} from '../core/gateway/index.mjs';
import { getPrompt } from '../core/prompts/templates.mjs';
import {
  copyBuiltinEntry,
  createWorldbookPack,
  deleteWorldbookPack,
  listBuiltinEntries,
  listWorldbookPacks,
  readBuiltinEntry,
  readWorldbookPack,
  saveWorldbookPack,
} from '../core/worldbook/index.mjs';
/* 第 7 期 M17：导出产物（网页 / GIF）落盘与清单。
   ⚠ 落盘一律走这个服务的**同一个端口**（§16 的"唯一浏览器↔磁盘通道"）；
     另起端口就得放宽 CORS，Origin 校验等于白做。 */
import { EXPORT_DIR, exportPageToDisk, listExports, saveExportBinary } from '../core/export/page.mjs';
/**
 * 第 8 期收尾补的「第 9 步」：把真实流水线接到 HTTP 上。
 * 之前前端有 `serverEventSource()`、服务端却没有 `/api/run` ⇒ 解题页只能跑演示源。
 */
import { runPipeline } from '../core/orchestrator/pipeline.mjs';
import { makeEvent, toSseFrame } from '../core/orchestrator/events.mjs';
import { loadLibrary } from '../core/worldbook/store.mjs';
/* 第 7 期 M19：教辅蒸馏（简版）。候选只落 distill-sessions/，人工确认后才写规则区。 */
import {
  SESSION_DIR as DISTILL_SESSION_DIR,
  applyPageResult as distillApplyPageResult,
  commitCandidates as distillCommitCandidates,
  createSession as distillCreateSession,
  distillPage,
  listSessions as distillListSessions,
  loadSession as distillLoadSession,
} from '../core/distill/index.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** 统一的结果包装：一切错误都变成 `{ ok:false, issues:[…] }`，前端只有一种处理方式 */
function sendJson(res, status, payload) {
  /**
   * ⚠ 已经发过响应就别再写（第 8 期实测：这是"点导出闪退"的元凶之一）。
   *
   * 场景：导出成功 → `ok()` 已经把 200 写完 → 紧接着写审计记录时抛错
   * → 外层 catch 又调 `bad()` 往**已结束的响应**上写 → `ERR_STREAM_WRITE_AFTER_END`
   * → 这个错误发生在 catch 里，没人接 → **unhandled rejection ⇒ Node 直接退出 ⇒ 应用闪退**。
   * 所以这里先检查；外层的 catch 也做了同样的检查。
   */
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

/**
 * ── 第 8 期：**本次启动的编号**（用户裁决"每次打开都要干净"）──
 *
 * 动画播放器把"开关/倍速"存在浏览器里；这个编号会随 `/api/health` 下发、
 * 再由宿主塞进 `program` 消息，模板用它拼存储键。
 * ⇒ 同一次启动里刷新页面，开关还在；**关掉黑窗重开，必然全新**（键变了）。
 * 生成方式：时间戳 + 随机串，够用且不需要落盘。
 */
const LAUNCH_ID = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

const ok = (res, payload = {}) => sendJson(res, 200, { ok: true, ...payload });
const bad = (res, issues, status = 400, extra = {}) => sendJson(res, status, { ok: false, issues, ...extra });

/** 读 JSON 请求体（有硬上限：这是本机服务，不该接受大文件） */
function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        rejectBody(Object.assign(new Error('请求体过大'), { code: 'body.too-large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

/**
 * 运行时公式渲染（`/api/tex`）的**缓存与边界**。
 *
 * 为什么要有缓存：播放器每帧不重渲染，但"上一步/下一步"会把同一条公式反复交上来；
 * MathJax 一次 tex2svg 是毫秒级但会累积，缓存是必须的（按 tex 文本，命中即返回）。
 * 上限 400 条：一道题最多几十条公式，多题连跑也不会无限涨；超了直接丢最旧的（Map 保持插入序）。
 */
const MAX_TEX_CHARS = 2000;
const MAX_TEX_CACHE = 400;
const TEX_CACHE = new Map();
let TEX_RENDERER = null;

/** 惰性起一个渲染器（MathJax 初始化慢，全进程只起一次） */
async function getTexRenderer() {
  if (!TEX_RENDERER) {
    const { createTexRenderer } = await import('../tools/tex-render.mjs');
    TEX_RENDERER = await createTexRenderer();
  }
  return TEX_RENDERER;
}

/**
 * 渲染一条 LaTeX 并缓存。
 * @returns {Promise<{ok:true, svg:string, glyphs:string, cached:boolean}|{ok:false, code:string, message:string}>}
 */
async function renderTexCached(tex) {
  const hit = TEX_CACHE.get(tex);
  if (hit) return { ...hit, cached: true };
  try {
    const renderer = await getTexRenderer();
    const markup = renderer.render(tex);
    /**
     * ⚠ 第 8 期实测：LaTeX 写错时（例如 `a}b`、`\frac{1}{2`）MathJax **不会抛异常**，
     *   而是把一句**英文错误**渲进 SVG：`Extra close brace or missing open brace`。
     *   用户就是这样在页面上看到那句英文的（他以为是我们的排版坏了）。
     *   所以这里主动识别错误节点，返回 `ok:false` —— 前端据此显示**公式原文**并标注"没渲染成功"，
     *   而不是把英文错误当成公式画出来。
     */
    if (/merror|data-mml-node="merror"/.test(markup)) {
      const detail = (/mjx-error[^>]*>([^<]{0,80})</.exec(markup) ?? [])[1] ?? '括号/命令不配对';
      return {
        ok: false,
        code: 'tex.bad-latex',
        message: `这条公式的 LaTeX 不合法（${detail.trim()}）：${
          tex.length > 60 ? `${tex.slice(0, 60)}…` : tex
        }`,
      };
    }
    /**
     * 防御：只接受 SVG 产物，且必须没有脚本/事件属性。
     * （MathJax 正常不会产出这些；但这段要进 `dangerouslySetInnerHTML`，所以自己再挡一次。）
     */
    if (!/<svg[\s>]/.test(markup) || /<script|on\w+\s*=/i.test(markup)) {
      return { ok: false, code: 'tex.unsafe', message: '渲染产物不是安全的 SVG（已拒绝）' };
    }
    const entry = { ok: true, svg: markup, glyphs: '' };
    TEX_CACHE.set(tex, entry);
    if (TEX_CACHE.size > MAX_TEX_CACHE) {
      const oldest = TEX_CACHE.keys().next().value;
      TEX_CACHE.delete(oldest);
    }
    return { ...entry, cached: false };
  } catch (err) {
    return { ok: false, code: 'tex.render-failed', message: `LaTeX 渲染失败：${err?.message ?? err}` };
  }
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    const d = describeJsonError(text, e);
    throw Object.assign(new Error(d.message), { code: 'body.bad-json', hint: d.hint });
  }
}

/**
 * 读**原始二进制**请求体（GIF 导出用）。
 * ⚠ 不能复用 `readBody()`：那个会 `toString('utf8')`，二进制当场被毁成替换字符。
 */
function readRawBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        rejectBody(Object.assign(new Error('请求体过大'), { code: 'body.too-large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });
}

/** 同源校验：只接受同源、或没有 Origin 的请求（curl / 本机脚本） */
function originAllowed(origin, port) {
  if (!origin) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

/** 静态文件（只发 `web/dist` 里存在的；路径穿越一律拒） */
function serveStatic(req, res, staticDir) {
  const url = new URL(req.url, 'http://127.0.0.1');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const rootAbs = resolve(staticDir);
  const abs = resolve(join(rootAbs, normalize(rel).replace(/^([/\\])+/, '')));
  if (!abs.startsWith(rootAbs + sep) && abs !== rootAbs) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const buf = readFileSync(abs);
  res.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(buf);
}

/**
 * 建服务（自检要能用 `port: 0` 起一个临时实例）。
 *
 * @param {{ port?: number, root?: string, staticDir?: string, serveStatic?: boolean }} [opts]
 */
export function createRulesService({
  port = 8080,
  root = RULES_ROOT,
  staticDir = join(PROJECT_ROOT, 'web', 'dist'),
  serveStatic: serveStaticFiles = true,
  obsDir = null,
  historyDbPath = null,
  /** 测试注入口：默认用真实网关与真 Dry-Run，门禁里可换成假实现（**只为可测性，不改产品行为**） */
  streamImpl = null,
  dryRunImpl = null,
} = {}) {
  const dir = root;
  /** 观测目录（M22）：默认 `observability/`，可用 `OD_OBS_DIR` 或构造参数改（测试用） */
  const OBS_DIR = obsDir ?? resolveObsDir();
  /** 历史库（M23）：默认 `data/history.db`，可用 `OD_HISTORY_PATH` 或构造参数改（测试用） */
  const HISTORY_PATH = historyDbPath;

  /**
   * ── `POST /api/run`：把"真跑一遍"接上（第 8 期收尾补的第 9 步）──
   *
   * 为什么这一条是 v1.0 的关键缺口：前端第 3 期就写好了 `serverEventSource()`（打 `/api/run` 读 SSE），
   * 但**服务端从来没有这个路由** ⇒ 解题页只能退到 `demoEventSource()`（本地真题，不调模型）。
   * 用户装上软件后发现"这就是个演示"，指的就是这件事。
   *
   * 实现要点：
   *   · 事件流用 `core/orchestrator/events.mjs` 的 `toSseFrame()`（前端解析器就是按它写的）；
   *   · 端点与 Key 从**规则工作区**读（`ai-rules/endpoints.json` + `keys.json`），Key 绝不进日志/响应；
   *   · 客户端断开（关窗口/点取消）⇒ `req.on('close')` 触发 `AbortController`，链路与 Worker 一起停；
   *   · 出错时**先发一条 stage_error 再结束**，让界面显示原因，而不是"流断了"。
   */
  async function handleRun(req, res) {
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      return sendJson(res, 400, { ok: false, code: 'run.bad-json', message: `请求体不是合法 JSON：${e.message}` });
    }

    const problem = body?.problem ?? { text: '' };
    /**
     * ⚠ **图片要在这一层解码**（第 8 期实测踩的坑）：
     *   前端 `serverEventSource()` 发的是 `{ mime, dataUrl }`（data: URI 字符串），
     *   而流水线/网关要的是 `{ mime, data: Buffer }`。
     *   直接透传的后果是 `image.data` 为 undefined ⇒ 网关判"图片内容为空"，
     *   用户看到的就是"出错了：图片内容为空"，其实图明明在那儿。
     */
    const rawImages = Array.isArray(body?.images) ? body.images : [];
    const images = [];
    for (let i = 0; i < rawImages.length; i += 1) {
      const im = rawImages[i] ?? {};
      const raw = String(im.dataUrl ?? im.data ?? '');
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(raw);
      const mime = im.mime || m?.[1] || 'image/png';
      const b64 = m ? m[2] : raw;
      let data;
      try {
        data = Buffer.from(b64, 'base64');
      } catch {
        data = Buffer.alloc(0);
      }
      if (data.length === 0) continue;
      images.push({ mime, data, name: im.name ?? `image-${i + 1}` });
    }
    if (rawImages.length > 0 && images.length === 0) {
      return sendJson(res, 400, {
        ok: false,
        code: 'run.bad-image',
        message: '收到了图片条目，但内容解不出来（空数据）。请重新选择图片再试。',
        hint: '前端传的是 dataURL；若看到这条，说明上传过程里图被清空了。',
      });
    }

    const mode = body?.mode === 'SYMBOLIC' ? 'SYMBOLIC' : 'NUMERIC';
    if (!String(problem.text ?? '').trim() && images.length === 0) {
      return sendJson(res, 400, {
        ok: false,
        code: 'run.empty',
        message: '题目是空的：请填题面文字，或先配一个支持看图的模型再传图',
      });
    }

    /* 端点 + Key：没有就**明确告知怎么配**，不要静默退回演示源（那正是之前的病） */
    const store = loadEndpointStore({ dir });
    const keyState = loadKeys({ dir });
    const stageId = store.stageModels?.solve ?? store.stageModels?.[Object.keys(store.stageModels ?? {})[0]] ?? null;
    const endpoint = (stageId && store.endpoints.get(stageId)) || [...store.endpoints.values()][0] || null;
    if (!endpoint) {
      return sendJson(res, 400, {
        ok: false,
        code: 'endpoint.missing',
        message: '还没有配置模型端点：打开右上角「⚙ 连接设置」，填接口地址与 Key 后保存',
        hint: store.issues?.[0]?.hint ?? null,
      });
    }
    const apiKey = keyState.keys?.[endpoint.id] ?? null;
    if (!apiKey) {
      return sendJson(res, 400, {
        ok: false,
        code: 'key.missing',
        message: `端点「${endpoint.displayName ?? endpoint.id}」还没有 Key：在「⚙ 连接设置」里填一条并保存`,
      });
    }
    if (images.length > 0 && !endpoint.supportsVision) {
      return sendJson(res, 400, {
        ok: false,
        code: 'vision.unsupported',
        message: `端点「${endpoint.displayName ?? endpoint.id}」标记为不支持看图：请换支持多模态的模型，或在「⚙ 连接设置」里更正这个标记`,
      });
    }

    /* 世界书：内置 + 用户（用户层永远落盘，打包形态下也一样） */
    let worldbookEntries = [];
    try {
      const lib = loadLibrary({ userDir: join(dir, 'worldbook') });
      worldbookEntries = [...lib.builtin, ...lib.user];
    } catch {
      /* 世界书读不到不该让整道题失败 —— 它只是上下文增强 */
    }

    const config = {
      endpoint,
      apiKey,
      regexRules: [],
      mode,
      worldbookEntries,
      /**
       * 第 8 期：**开发模式（不拦截）**。前端勾上后随 `/api/run` 传 `devMode:true`：
       * 校验照做、报告照写，但 C1–C9 不再拦住交付（也不跑自愈），
       * 程序直接流进动画页；`gatesBypassed` 会记下哪几条没过。
       */
      devMode: body?.devMode === true,
    };

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      /* 关掉中间层缓冲（本机也写上，省得以后加代理时踩坑） */
      'x-accel-buffering': 'no',
    });

    const ac = new AbortController();
    let closed = false;
    req.on('close', () => {
      closed = true;
      ac.abort();
    });
    const write = (event) => {
      if (closed) return;
      try {
        res.write(toSseFrame(event));
      } catch {
        /* 客户端已断，忽略 */
      }
    };

    try {
      const pipeline = runPipeline({
        problem: { text: String(problem.text ?? ''), images },
        images,
        config,
        signal: ac.signal,
        ...(streamImpl ? { streamImpl } : {}),
        ...(dryRunImpl ? { dryRunImpl } : {}),
      });
      for await (const ev of pipeline) write(ev);
    } catch (err) {
      write(
        makeEvent(
          'stage_error',
          {
            stage: 'solve',
            error: {
              kind: 'run.crashed',
              message: err?.message ?? String(err),
              hint: '这是本机服务里的异常；详细堆栈在终端窗口里。',
            },
          },
          9999,
        ),
      );
      write(makeEvent('run_done', { verdict: 'error', ms: 0, cancelled: false }, 10000));
    } finally {
      if (!closed) {
        try {
          res.end();
        } catch {
          /* already ended */
        }
      }
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1`);
    const path = url.pathname;

    if (!path.startsWith('/api/')) {
      if (!serveStaticFiles) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      /* 导出产物（/exports/xxx.html、/exports/xxx.gif）：本机目录，单独挂一层。
         ⚠ `serveStatic()` 是拿 **`req.url` 自己算相对路径**的，所以传新根目录的同时
           必须把 `/exports` 前缀从 `req.url` 上剥掉，否则它会去 `exports/exports/…` 找
           —— 表现就是"文件明明在、却 404"（本节第一条断言踩过）。 */
      if (path.startsWith('/exports/')) {
        req.url = req.url.slice('/exports'.length);
        serveStatic(req, res, EXPORT_DIR);
        return;
      }
      serveStatic(req, res, staticDir);
      return;
    }

    // 同源校验（写操作也一样；GET 也拦，免得被当作探测通道）
    const origin = req.headers.origin;
    if (!originAllowed(origin, server.address()?.port ?? port)) {
      bad(res, [{ code: 'http.cross-origin', path: 'Origin', message: '拒绝跨源请求（只接受本机同源）' }], 403);
      return;
    }

    try {
      /* ── 健康与总状态 ── */
      if (req.method === 'GET' && path === '/api/health') {
        ok(res, { dir, hasWorkspace: existsSync(join(dir, '.workspace.json')), launchId: LAUNCH_ID });
        return;
      }

      /**
       * ── 第 8 期：**运行时公式渲染**（`/api/tex`）──
       *
       * 用户真题暴露的问题：页面上的公式走的是**构建期预渲染表**（`web/src/lib/markdown.tsx` 的
       * `FORMULAS`），真跑出来的题一条都不在表里，于是**整段 LaTeX 原样显示** ——
       * 用户看到的就是"公式全挤在一行、还把 `$` 亮出来了"。
       *
       * 这里用项目**已有**的渲染实现（`tools/tex-render.mjs` → mathjax-full tex2svg，
       * 与成品页/演示数据同一套），把它暴露成一个本机接口：
       *   · 零新依赖（打包时已经在用）；
       *   · 仍然不违反 §2.2 的"浏览器不跑 MathJax"（渲染在服务端做，页面只吃 SVG）；
       *   · 结果按 tex 文本缓存（同一道题反复播放不会重复渲染）。
       *
       * 安全口径：只回 `mjx-container` 里的 SVG（白名单元素已由 MathJax 产出），
       * 并且**拒绝任何 `<script` / `on*=` 的产物**（防线在内，不指望上游）。
       */
      if (req.method === 'POST' && path === '/api/tex') {
        const body = await readJson(req);
        const tex = typeof body?.tex === 'string' ? body.tex.trim() : '';
        if (!tex) {
          return bad(res, [{ code: 'tex.empty', path: 'tex', message: 'tex 不能为空' }], 400);
        }
        if (tex.length > MAX_TEX_CHARS) {
          return bad(
            res,
            [{ code: 'tex.too-long', path: 'tex', message: `tex 太长（${tex.length} > ${MAX_TEX_CHARS}）` }],
            413,
          );
        }
        const rendered = await renderTexCached(tex);
        if (!rendered.ok) {
          return bad(res, [{ code: rendered.code, path: 'tex', message: rendered.message }], 422);
        }
        return ok(res, { svg: rendered.svg, glyphs: rendered.glyphs, cached: rendered.cached });
      }

      /* 第 8 期收尾：真跑一道题（SSE）。前端 `serverEventSource()` 打的就是这里。 */
      if (req.method === 'POST' && path === '/api/run') {
        await handleRun(req, res);
        return;
      }

      if (req.method === 'GET' && path === '/api/status') {
        const loaded = loadRulesWorkspace({ dir });
        const idx = readRulesIndex(dir);
        ok(res, {
          dir,
          revision: idx.ok ? idx.index.baseRevision : null,
          ok: loaded.ok,
          problems: loaded.problems,
          files: loaded.files,
          promptIds: Object.keys(loaded.prompts ?? {}),
          cleaningRules: (loaded.cleaning?.rules ?? []).length,
          sectors: PROMPT_SECTORS,
        });
        return;
      }

      /* ── 导出（M17）：网页 / GIF ──
         两个产物都落本机 `exports/`，都经**这个端口**出去；前端拿到 `url` 直接打开。
         §14 的硬要求：导出网页必须烧录 Provenance —— 模型与两个哈希由前端从本题快照带上来，
         缺了就写"未记录"（宁可承认没记，也不编一个看起来像真的）。 */
      if (req.method === 'GET' && path === '/api/exports') {
        return ok(res, { dir: EXPORT_DIR, items: listExports() });
      }

      if (req.method === 'POST' && path === '/api/export/page') {
        const body = await readJson(req);
        const result = await exportPageToDisk({
          slots: body.slots,
          id: body.id,
          index: body.index,
          title: body.title,
          examPoint: body.examPoint,
          mode: body.mode,
          model: body.model,
          promptHash: body.promptHash,
          worldbookHash: body.worldbookHash,
          /* C2：避让表随导出烧进页面（可选；旧调用方不传 = 不挪字） */
          labelAvoid: body.labelAvoid ?? null,
          /**
           * 第 8 期：**开发模式（不拦截）的痕迹必须进导出文件**。
           * 一旦这个 html 离开本机，就没人知道它没验过 —— 所以写进 Provenance 行。
           */
          advisory: body.advisory === true,
          gatesBypassed: Array.isArray(body.gatesBypassed) ? body.gatesBypassed : [],
        });
        if (!result.ok) return bad(res, [{ code: result.code, path: 'body', message: result.message }]);
        recordAudit(
          { kind: 'export.page', detail: { name: result.name, bytes: result.bytes, model: body.model ?? null } },
          { path: HISTORY_PATH, secrets: collectSecrets({ dir }) },
        );
        return ok(res, {
          file: result.file,
          name: result.name,
          url: result.url,
          bytes: result.bytes,
          formulas: result.formulas,
          renderer: result.renderer,
          provenance: result.provenance,
        });
      }

      if (req.method === 'POST' && path === '/api/export/gif') {
        const buf = await readRawBody(req);
        if (!buf.length) return bad(res, [{ code: 'export.empty', path: 'body', message: '没有收到 GIF 字节' }]);
        // GIF89a 魔数：前端编错了要当场拒绝，别把坏文件写进磁盘
        const magic = buf.subarray(0, 6).toString('latin1');
        if (magic !== 'GIF89a' && magic !== 'GIF87a') {
          return bad(res, [{ code: 'export.not-gif', path: 'body', message: `不是 GIF（前 6 字节 ${JSON.stringify(magic)}）` }]);
        }
        const result = saveExportBinary(url.searchParams.get('name') || 'animation.gif', buf);
        if (!result.ok) return bad(res, [{ code: result.code, path: 'body', message: result.message }]);
        return ok(res, { file: result.file, name: result.name, url: result.url, bytes: result.bytes });
      }

      /* ── 教辅蒸馏（M19 简版）─────────────────────────────────
         链路：建会话（含成本预估）→ 逐页蒸馏（可中断续做）→ 人工勾选 → 入库。
         ⚠ ① 不入库就不写 ai-rules：候选只落 `distill-sessions/`；
           ② distill 端点必须 supportsVision（契约第 7 条），没有视觉能力当场拒；
           ③ 每页结果单独落盘，重开能接着做；失败页如实报出。 */
      if (req.method === 'GET' && path === '/api/distill/sessions') {
        return ok(res, { dir: DISTILL_SESSION_DIR, items: distillListSessions() });
      }

      if (req.method === 'POST' && path === '/api/distill/sessions') {
        const body = await readJson(req);
        const session = distillCreateSession({
          title: body.title,
          source: body.source,
          pages: body.pages,
          endpointId: body.endpointId ?? null,
        });
        return ok(res, { session, estimate: session.estimate });
      }

      const distillSessionMatch = /^\/api\/distill\/sessions\/([A-Za-z0-9_-]+)$/.exec(path);
      if (req.method === 'GET' && distillSessionMatch) {
        const session = distillLoadSession({ id: distillSessionMatch[1] });
        if (!session) return bad(res, [{ code: 'distill.no-session', path: 'id', message: '找不到这个蒸馏会话' }], 404);
        return ok(res, { session });
      }

      if (req.method === 'POST' && path === '/api/distill/page') {
        const body = await readJson(req);
        const session = distillLoadSession({ id: body.sessionId });
        if (!session) return bad(res, [{ code: 'distill.no-session', path: 'sessionId', message: '找不到这个蒸馏会话' }]);

        const store = loadEndpointStore({ dir });
        const wanted = body.endpointId || store.stageModels?.distill || null;
        const endpoint =
          store.endpoints.find((e) => e.id === wanted) ??
          store.endpoints.find((e) => e.supportsVision === true) ??
          store.endpoints[0];
        const keys = loadKeys({ dir });
        const apiKey = (keys.ok !== false && keys.keys ? keys.keys[endpoint?.id] : '') || '';

        const page = {
          kind: body.kind === 'text' ? 'text' : 'image',
          text: body.text,
          /* 前端传 base64（JSON 里没法传二进制）；这里还原成 { mime, data: Buffer }，
             正好是 `checkImageInput()` 与 `toDataURI()` 认的形态。 */
          image:
            body.image && body.image.base64
              ? {
                  mime: String(body.image.mime || ''),
                  name: body.image.name ? String(body.image.name) : undefined,
                  data: Buffer.from(String(body.image.base64), 'base64'),
                }
              : null,
        };
        const promptText = getPrompt('distill', loadRulesWorkspace({ dir }).prompts ?? null);
        const result = await distillPage({
          endpoint,
          apiKey,
          page,
          promptText,
          pageIndex: Number(body.pageIndex) || 0,
          pageCount: session.pages.length,
          collect: collectChatCompletion,
          buildUserMessage,
        });
        // 成功与失败都写回会话：失败页要能看到原因，也不能被当成"已完成"
        const next = distillApplyPageResult({
          session,
          pageIndex: Number(body.pageIndex) || 0,
          entries: result.entries,
          issues: result.issues,
          raw: result.raw,
          status: result.ok ? (result.entries.length ? 'done' : 'done') : 'failed',
        });
        return ok(res, {
          session: next,
          pageIndex: Number(body.pageIndex) || 0,
          entries: result.entries,
          issues: result.issues,
          ok: result.ok,
          code: result.code ?? null,
          message: result.message ?? null,
        });
      }

      if (req.method === 'POST' && path === '/api/distill/commit') {
        const body = await readJson(req);
        const session = distillLoadSession({ id: body.sessionId });
        if (!session) return bad(res, [{ code: 'distill.no-session', path: 'sessionId', message: '找不到这个蒸馏会话' }]);
        const result = distillCommitCandidates({
          dir,
          sessionId: session.id,
          picks: body.picks,
          packName: body.packName,
        });
        if (!result.ok) return bad(res, result.issues);
        // 审计（M23）：入库是"改了知识库"这件事，必须留痕。**只记条数与包名，不记正文**。
        recordAudit(
          { kind: 'distill.commit', detail: { sessionId: session.id, pack: result.name, entries: (result.entries ?? []).length } },
          { path: HISTORY_PATH, secrets: collectSecrets({ dir }) },
        );
        return ok(res, { name: result.name, entries: result.entries });
      }

      /* ── Prompt ── */
      if (req.method === 'GET' && path === '/api/prompts') {
        const cat = listPromptCatalog({ dir });
        ok(res, { ...cat, requirements: PROMPT_REQUIREMENTS });
        return;
      }

      const promptMatch = /^\/api\/prompts\/([A-Za-z0-9._-]+)(\/rebase)?$/.exec(path);
      if (promptMatch) {
        const id = promptMatch[1];
        if (req.method === 'GET' && !promptMatch[2]) {
          const o = openPrompt({ dir, id });
          if (!o.ok) return bad(res, o.issues, 404);
          return ok(res, o);
        }
        if (req.method === 'PUT' && !promptMatch[2]) {
          const body = await readJson(req);
          const r = savePromptOverride({ dir, id, text: String(body.text ?? ''), expectedHash: body.expectedHash, force: Boolean(body.force) });
          if (!r.ok) return bad(res, r.issues, 400, { warnings: r.warnings });
          return ok(res, { revision: r.revision, warnings: r.warnings });
        }
        if (req.method === 'DELETE' && !promptMatch[2]) {
          const expectedHash = url.searchParams.get('expectedHash');
          const r = resetPromptOverride({
            dir,
            id,
            expectedHash: expectedHash === null ? undefined : expectedHash === '' ? null : expectedHash,
            force: url.searchParams.get('force') === '1',
          });
          if (!r.ok) return bad(res, r.issues, 400);
          return ok(res, { revision: r.revision });
        }
        if (req.method === 'POST' && promptMatch[2]) {
          const r = rebasePromptOverride({ dir, id });
          if (!r.ok) return bad(res, r.issues, 400);
          return ok(res, { revision: r.revision });
        }
        return bad(res, [{ code: 'http.method', path, message: `不支持的方法 ${req.method}` }], 405);
      }

      /* ── 清洗规则 ── */
      if (req.method === 'GET' && path === '/api/cleaning') {
        const t = loadCleaningTable({ dir });
        if (!t.ok) return bad(res, t.issues, 500);
        return ok(res, t);
      }
      if (req.method === 'POST' && path === '/api/cleaning/reset') {
        const body = await readJson(req);
        const r = resetCleaningTable({ dir, expectedHash: body.expectedHash, force: Boolean(body.force) });
        if (!r.ok) return bad(res, r.issues, 400);
        return ok(res, { revision: r.revision });
      }
      if (req.method === 'POST' && path === '/api/cleaning/rules') {
        const body = await readJson(req);
        const r = addCleaningRule({ dir, rule: body.rule, expectedHash: body.expectedHash, force: Boolean(body.force) });
        if (!r.ok) return bad(res, r.issues, 400, { warnings: r.warnings });
        return ok(res, { revision: r.revision, warnings: r.warnings });
      }
      const ruleMatch = /^\/api\/cleaning\/rules\/([A-Za-z0-9._-]+)(\/enable|\/move)?$/.exec(path);
      if (ruleMatch) {
        const id = ruleMatch[1];
        const verb = ruleMatch[2] ?? '';
        if (req.method === 'PATCH' && !verb) {
          const body = await readJson(req);
          const r = updateCleaningRule({ dir, id, patch: body.patch ?? {}, expectedHash: body.expectedHash, force: Boolean(body.force) });
          if (!r.ok) return bad(res, r.issues, 400, { warnings: r.warnings });
          return ok(res, { revision: r.revision, warnings: r.warnings });
        }
        if (req.method === 'DELETE' && !verb) {
          const expectedHash = url.searchParams.get('expectedHash');
          const r = removeCleaningRule({
            dir,
            id,
            expectedHash: expectedHash === null ? undefined : expectedHash === '' ? null : expectedHash,
            force: url.searchParams.get('force') === '1',
          });
          if (!r.ok) return bad(res, r.issues, 400);
          return ok(res, { revision: r.revision });
        }
        if (req.method === 'POST' && verb === '/enable') {
          const body = await readJson(req);
          const r = setCleaningRuleEnabled({ dir, id, enabled: Boolean(body.enabled), expectedHash: body.expectedHash, force: Boolean(body.force) });
          if (!r.ok) return bad(res, r.issues, 400);
          return ok(res, { revision: r.revision });
        }
        if (req.method === 'POST' && verb === '/move') {
          const body = await readJson(req);
          const r = moveCleaningRule({ dir, id, toIndex: body.toIndex, expectedHash: body.expectedHash, force: Boolean(body.force) });
          if (!r.ok) return bad(res, r.issues, 400);
          return ok(res, { revision: r.revision });
        }
        return bad(res, [{ code: 'http.method', path, message: `不支持的方法 ${req.method}` }], 405);
      }

      /* ── 端点 ── */
      if (req.method === 'GET' && path === '/api/endpoints') {
        const st = loadEndpointStore({ dir });
        if (!st.ok) return bad(res, st.issues, 409, { warnings: st.warnings, files: st.files });
        // ⚠ 只给打码值：Key 的明文永不经过 HTTP
        const keysMasked = Object.fromEntries(Object.entries(st.keys).map(([id, k]) => [id, redact(k)]));
        return ok(res, {
          endpoints: st.config.endpoints,
          stageModels: st.config.stageModels,
          // 阶段清单从冻结契约来：前端不自己抄一份（否则契约改了界面不会跟着改）
          stages: PIPELINE_STAGES,
          keysMasked,
          keyCount: Object.keys(st.keys).length,
          warnings: st.warnings,
          hash: st.hashes.endpoints,
        });
      }
      if (req.method === 'PUT' && path === '/api/endpoints') {
        const body = await readJson(req);
        const r = saveEndpoints({ dir, endpoints: body.endpoints ?? [], stageModels: body.stageModels ?? {}, expectedHash: body.expectedHash, force: Boolean(body.force) });
        if (!r.ok) return bad(res, r.issues, 400);
        return ok(res, { hash: r.hash, warnings: r.warnings });
      }
      if (req.method === 'GET' && path === '/api/endpoints/export') {
        const st = loadEndpointStore({ dir });
        if (!st.ok) return bad(res, st.issues, 409);
        const out = exportEndpointsText({
          endpoints: st.config.endpoints,
          stageModels: st.config.stageModels,
          knownKeys: Object.values(st.keys),
        });
        return ok(res, { text: out.text, hash: out.hash, bytes: out.bytes });
      }
      if (req.method === 'POST' && path === '/api/endpoints/import') {
        const body = await readJson(req);
        const r = importEndpoints({ dir, text: String(body.text ?? ''), force: true });
        if (!r.ok) return bad(res, r.issues, 400);
        return ok(res, { hash: r.hash, warnings: r.warnings });
      }
      if (req.method === 'POST' && path === '/api/endpoints/stage') {
        const body = await readJson(req);
        const r = setStageModel({ dir, stage: String(body.stage ?? ''), endpointId: body.endpointId ?? null, force: true });
        if (!r.ok) return bad(res, r.issues, 400);
        return ok(res, { hash: r.hash });
      }
      const epMatch = /^\/api\/endpoints\/([A-Za-z0-9._-]+)(\/key|\/test)?$/.exec(path);
      if (epMatch) {
        const id = epMatch[1];
        const verb = epMatch[2] ?? '';
        if (req.method === 'DELETE' && !verb) {
          const r = removeEndpoint({ dir, id, force: true });
          if (!r.ok) return bad(res, r.issues, 400);
          return ok(res, { hash: r.hash, warnings: r.warnings });
        }
        if (req.method === 'POST' && verb === '/key') {
          const body = await readJson(req);
          const r = setKey({ dir, id, key: String(body.key ?? '') });
          if (!r.ok) return bad(res, r.issues, 400);
          // 审计：**只记端点 id，绝不记 Key 本身**（全仓库第一条铁律）
          recordAudit({ kind: 'endpoint.key-set', detail: { id } }, { path: HISTORY_PATH, secrets: collectSecrets({ dir }) });
          return ok(res, { saved: true });
        }
        if (req.method === 'DELETE' && verb === '/key') {
          const r = clearKey({ dir, id });
          if (!r.ok) return bad(res, r.issues, 400);
          recordAudit({ kind: 'endpoint.key-clear', detail: { id } }, { path: HISTORY_PATH, secrets: collectSecrets({ dir }) });
          return ok(res, { cleared: true });
        }
        if (req.method === 'POST' && verb === '/test') {
          const st = loadEndpointStore({ dir });
          if (!st.ok) return bad(res, st.issues, 409);
          const ep = st.endpoints.get(id);
          if (!ep) return bad(res, [{ code: 'endpoints.not-found', path: id, message: `没有端点 "${id}"` }], 404);
          /* `probeVision` 默认为真：点"保存并测试连接"就该顺带告诉你**能不能看图**（实测，不靠猜） */
          let body = {};
          try {
            body = await readJson(req);
          } catch {
            body = {};
          }
          const result = await testConnection({
            endpoint: ep,
            apiKey: st.keys[id] ?? null,
            timeoutMs: Math.min(ep.timeoutMs ?? 15000, 15000),
            probeVision: body?.probeVision !== false,
          });
          return ok(res, { result, text: formatConnectionResult(result) });
        }
        return bad(res, [{ code: 'http.method', path, message: `不支持的方法 ${req.method}` }], 405);
      }

      /* ── 世界书（只写 ai-rules/worldbook/；内置只读） ── */
      if (path.startsWith('/api/worldbook')) {
        const wbDir = join(dir, 'worldbook');

        if (req.method === 'GET' && path === '/api/worldbook') {
          const listed = listWorldbookPacks({ dir: wbDir });
          const builtin = listBuiltinEntries();
          return ok(res, { dir: wbDir, ...listed, builtinCount: builtin.count, builtinIds: builtin.entries.map((e) => e.id) });
        }
        if (req.method === 'GET' && path === '/api/worldbook/builtin') {
          const b = listBuiltinEntries();
          return ok(res, b);
        }
        const builtinOne = /^\/api\/worldbook\/builtin\/([A-Za-z0-9._-]+)$/.exec(path);
        if (req.method === 'GET' && builtinOne) {
          const r = readBuiltinEntry(builtinOne[1]);
          if (!r.ok) return bad(res, r.issues, 404);
          return ok(res, r);
        }
        if (req.method === 'POST' && path === '/api/worldbook/copy') {
          const body = await readJson(req);
          const r = copyBuiltinEntry({ dir: wbDir, id: String(body.id ?? ''), name: body.name });
          if (!r.ok) return bad(res, r.issues, 400);
          return ok(res, r);
        }
        if (req.method === 'POST' && path === '/api/worldbook/packs') {
          const body = await readJson(req);
          const r = createWorldbookPack({ dir: wbDir, name: String(body.name ?? '') });
          if (!r.ok) return bad(res, r.issues, 400);
          return ok(res, r);
        }
        const packMatch = /^\/api\/worldbook\/packs\/([A-Za-z0-9._-]+)$/.exec(path);
        if (packMatch) {
          const name = packMatch[1];
          if (req.method === 'GET') {
            const r = readWorldbookPack({ dir: wbDir, name });
            if (!r.ok) return bad(res, r.issues, 404);
            return ok(res, r);
          }
          if (req.method === 'PUT') {
            const body = await readJson(req);
            const r = saveWorldbookPack({ dir: wbDir, name, text: String(body.text ?? '') });
            if (!r.ok) return bad(res, r.issues, 400);
            return ok(res, r);
          }
          if (req.method === 'DELETE') {
            const r = deleteWorldbookPack({ dir: wbDir, name });
            if (!r.ok) return bad(res, r.issues, 400);
            return ok(res, r);
          }
          return bad(res, [{ code: 'http.method', path, message: `不支持的方法 ${req.method}` }], 405);
        }
        return bad(res, [{ code: 'http.not-found', path, message: `没有这个接口：${req.method} ${path}` }], 404);
      }

      /* ── 观测与运维（M22）：运行记录 + 失败复现包 ──────────────
         方案 §17 M22 要的是"出问题时能复盘"，所以这里只做四件事：
           ① 列出跑过什么（读 `observability/runs.jsonl`，不扫目录）；
           ② 读一次运行的完整记录；
           ③ **收下一次运行**（管道跑完后把事件交上来 → 存档 + 脱敏）；
           ④ 把某一次整理成复现包。
         ⚠ 落盘全部经 `core/observability/`（那里写入时脱敏、写完从磁盘复核），
           这一层不自己拼 JSON、不自己删 Key —— 否则两处判据迟早打架。 */
      if (path === '/api/observability' && req.method === 'GET') {
        const runs = readRuns({ dir: OBS_DIR, limit: 10 });
        const repro = listReproPacks({ dir: OBS_DIR });
        return ok(res, { dir: OBS_DIR, total: runs.total, runs: runs.items, repro: repro.items });
      }

      if (path === '/api/observability/runs' && req.method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        return ok(res, readRuns({ dir: OBS_DIR, limit: Number.isFinite(limit) ? limit : 50 }));
      }

      if (path === '/api/observability/runs' && req.method === 'POST') {
        const body = await readJson(req);
        const hasEvents = Array.isArray(body.events) && body.events.length > 0;
        const hasRecord = body.record && typeof body.record === 'object';
        if (!hasEvents && !hasRecord) {
          return bad(
            res,
            [{ code: 'observability.empty', path: 'body', message: '要记录一次运行，至少得给 events 或 record' }],
            400,
          );
        }
        const record = hasRecord ? body.record : summarize(body.events);
        const result = commitRun({
          record,
          events: hasEvents ? body.events : [],
          slots: body.slots && typeof body.slots === 'object' ? body.slots : null,
          problemText: typeof body.problemText === 'string' ? body.problemText : null,
          dryRunReport: body.dryRunReport && typeof body.dryRunReport === 'object' ? body.dryRunReport : null,
          // 已知 Key 从**这台机器真实的** `keys.json` 取：精确匹配比形态匹配可靠
          secrets: collectSecrets({ dir }),
          dir: OBS_DIR,
        });
        /* M23：同一份记录顺手进历史库 —— 这是「历史记录已写库」那条验收的最小闭环。
           写库失败**不影响**记录已落盘这件事，但要在回执里如实说明（不静默）。
           ⚠ 一定要把 `commitRun` 生成的 runId 补回去：只给 events 时 `summarize()`
             算出来的 `runId` 是 null（那是 `commitRun` 内部才补的），
             少了这一步历史库会以 `history.missing-run-id` 拒收 —— 门禁 ㉝ 抓到过。 */
        const histRecord = { ...record, runId: result.runId };
        const hist = historyRecordRun(histRecord, { path: HISTORY_PATH, secrets: collectSecrets({ dir }) });
        return ok(res, { runId: result.runId, files: result.files, history: { ok: hist.ok, code: hist.code ?? null } });
      }

      const obsRunMatch = /^\/api\/observability\/runs\/([A-Za-z0-9._-]+)$/.exec(path);      if (obsRunMatch && req.method === 'GET') {
        const r = readRun(obsRunMatch[1], { dir: OBS_DIR });
        if (!r.ok) return bad(res, [{ code: r.code, path: 'runId', message: `找不到这次运行：${obsRunMatch[1]}` }], 404);
        return ok(res, { runId: r.runId, record: r.record });
      }

      if (path === '/api/observability/repro' && req.method === 'GET') {
        return ok(res, listReproPacks({ dir: OBS_DIR }));
      }

      if (path === '/api/observability/repro' && req.method === 'POST') {
        const body = await readJson(req);
        const result = buildReproPack({
          runId: body.runId,
          note: typeof body.note === 'string' ? body.note : '',
          dir: OBS_DIR,
        });
        if (!result.ok) {
          return bad(res, [{ code: result.code, path: 'runId', message: `生成复现包失败：${result.code}` }], 400);
        }
        return ok(res, { runId: result.runId, dir: result.dir, files: result.files, manifest: result.manifest });
      }

      if (path.startsWith('/api/observability')) {
        return bad(res, [{ code: 'http.not-found', path, message: `没有这个接口：${req.method} ${path}` }], 404);
      }

      /* ── 解题历史与审计（M23）───────────────────────────────
         方案 §17 M23：**表结构与写入接口位保留**，界面无入口。
         所以这里只有 `/api/history/*` 三个接口，前端一行都没接
         （门禁 ㉟ 会断言 `web/src` 里搜不到任何历史页面/导航项）。
         写库全部经 `core/history`（那里写前脱敏、装不上驱动就明确报错）。 */
      if (path === '/api/history/stats' && req.method === 'GET') {
        const st = historyStats({ path: HISTORY_PATH });
        if (!st.ok) return bad(res, [{ code: st.code, path: 'history', message: '历史库不可用' }], 503);
        return ok(res, { ...st, driver: driverStatus() });
      }

      if (path === '/api/history/runs' && req.method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const verdict = url.searchParams.get('verdict');
        const r = historyListRuns({ path: HISTORY_PATH, limit: Number.isFinite(limit) ? limit : 50, verdict });
        if (!r.ok) return bad(res, [{ code: r.code, path: 'history', message: '历史库不可用' }], 503);
        return ok(res, r);
      }

      if (path === '/api/history/runs' && req.method === 'POST') {
        const body = await readJson(req);
        const record = body.record && typeof body.record === 'object' ? body.record : null;
        if (!record) {
          return bad(res, [{ code: 'history.empty', path: 'body', message: '要写一条历史，得给 record' }], 400);
        }
        const result = historyRecordRun(record, { path: HISTORY_PATH, secrets: collectSecrets({ dir }) });
        if (!result.ok) {
          // 驱动装不上 / 写失败都**吵出来**，绝不静默当作记过了
          const status = result.code === 'history.driver-missing' ? 503 : 400;
          return bad(res, [{ code: result.code, path: 'record', message: result.message ?? '历史写入失败' }], status);
        }
        return ok(res, result);
      }

      const historyRunMatch = /^\/api\/history\/runs\/([A-Za-z0-9._-]+)$/.exec(path);
      if (historyRunMatch && req.method === 'GET') {
        const r = historyGetRun(historyRunMatch[1], { path: HISTORY_PATH });
        if (!r.ok) return bad(res, [{ code: r.code, path: 'runId', message: `找不到这次运行：${historyRunMatch[1]}` }], 404);
        return ok(res, r);
      }

      if (path.startsWith('/api/history')) {
        return bad(res, [{ code: 'http.not-found', path, message: `没有这个接口：${req.method} ${path}` }], 404);
      }

      return bad(res, [{ code: 'http.not-found', path, message: `没有这个接口：${req.method} ${path}` }], 404);
    } catch (e) {
      /**
       * 这里必须**绝对安全**：不能再抛。
       *
       * 曾经的真实事故：路由先把 200 写完，随后写审计时抛错 → 进到这里 →
       * `bad()` 往已结束的响应上写 → `ERR_STREAM_WRITE_AFTER_END` 从 catch 里冒出去
       * ⇒ unhandled rejection ⇒ **Node 退出 ⇒ 整个 Electron 应用闪退**（用户报"点导出就闪退"）。
       */
      if (res.writableEnded || res.destroyed) {
        try {
          res.end();
        } catch {
          /* 已经结束，无视 */
        }
        return;
      }
      if (e?.code === 'body.bad-json' || e?.code === 'body.too-large') {
        return bad(res, [{ code: e.code, path: 'body', message: e.message, hint: e.hint }], 400);
      }
      try {
        return bad(res, [{ code: 'server.error', path, message: String(e?.message ?? e) }], 500);
      } catch {
        return undefined;
      }
    }
  });

  return {
    server,
    /** 起在随机端口时用这个拿真实端口 */
    listen() {
      return new Promise((resolveListen, rejectListen) => {
        /**
         * ⚠ 必须挂 `error`：不挂的话端口被占（EADDRINUSE）时不会 reject，
         *   `await svc.listen()` 永远不返回，node 抛未捕获的 'error' 事件直接崩 ——
         *   用户看到的是一个闪退的黑窗 + 浏览器里**旧的**页面（第 8 期实测踩到）。
         */
        const onError = (err) => {
          server.removeListener('listening', onListening);
          rejectListen(err);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolveListen(server.address().port);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });
    },
    close() {
      return new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

/* ── CLI ── */
const isMain = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return import.meta.url === new URL(`file://${argv1.replace(/\\/g, '/')}`).href;
})();

if (isMain) {
  const argOf = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  const port = Number(argOf('--port', '8080'));
  const root = argOf('--root', RULES_ROOT);
  const svc = createRulesService({ port, root });
  let actual;
  try {
    actual = await svc.listen();
  } catch (err) {
    /**
     * 端口被占是**最常见的"打不开"原因**（另一个规则工作室没关、或 `2-OpenUI.bat` 的 python 也占 8080）。
     * 给一句能照着做的话，而不是丢一个 stack trace 让黑窗闪退。
     */
    if (err?.code === 'EADDRINUSE') {
      console.error('');
      console.error(`✗ 端口 ${port} 已经被占用了（多半是另一个规则工作室窗口，或 2-OpenUI.bat 的网页服务）。`);
      console.error('  两个办法，任选一个：');
      console.error('    ① 把那个占着 8080 的黑窗口关掉，再重新双击 3-OpenRules.bat；');
      console.error(`    ② 换个端口：3-OpenRules.bat ${port + 1}（双击时带参数不方便的话，用命令行跑这条）`);
      console.error('');
      console.error('  ⚠ 不清掉占用直接刷新浏览器，你看到的会是**旧的**页面（旧提示词、旧卡片）。');
      console.error('');
    } else {
      console.error(`✗ 启动失败：${err?.message ?? err}`);
    }
    process.exit(1);
  }

  console.log('');
  console.log('════════ 规则工作室（本机） ════════');
  console.log(`  打开：http://127.0.0.1:${actual}/`);
  console.log(`  规则目录：${root}`);
  console.log('  界面里改的是 ai-rules/ 下的真实文件（原子写 + 哈希校验）。');
  console.log('  ⚠ 关掉这个窗口，页面就改不了东西了（读静态页也会断）。');
  console.log('════════════════════════════════════');
  console.log('');
}
