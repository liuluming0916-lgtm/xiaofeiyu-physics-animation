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
import { RULES_ROOT, describeJsonError, initRulesWorkspace, loadRulesWorkspace, readRulesIndex } from '../core/rules/index.mjs';
import {
  appVersion,
  buildReproPack,
  commitRun,
  createRunLog,
  listReproPacks,
  OPEN_LOG_DIRNAME,
  readRun,
  readRuns,
  resolveObsDir,
  resolveOpenLogDir,
  summarize,
  writeOpenLog,
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
  clearKey,
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
  /** v1.1.7：开源日志要记录"发给模型的原始消息 + 模型返回的全文" ⇒ 包一层默认网关 */
  streamChatCompletion,
  testConnection,
} from '../core/gateway/index.mjs';
import {
  copyBuiltinEntry,
  createKnowledgecardPack,
  deleteKnowledgecardPack,
  listBuiltinEntries,
  listKnowledgecardPacks,
  readBuiltinEntry,
  readKnowledgecardPack,
  restoreBuiltinKnowledgecard,
  saveKnowledgecardPack,
} from '../core/knowledgecard/index.mjs';
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
import { migrateLegacyUserDir } from '../core/knowledgecard/store.mjs';
import { loadV2Library } from '../core/knowledgecard/v2/store.mjs';
import { v2ToV1RuntimeEntry } from '../core/knowledgecard/v2/adapter.mjs';
import { saveV2Entry } from '../core/knowledgecard/v2/editor.mjs';
import { addVocabEntry, removeVocabEntry, saveVocabState } from '../core/knowledgecard/v2/vocab-editor.mjs';
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
  /**
   * v1.1.7「开源日志」的落点。默认 `<程序目录>/开源日志`（打包形态由主进程注入
   * `OD_OPEN_LOG_DIR`）；测试传临时目录，绝不往仓库里写日志。
   */
  openLogDir = null,
  /** 测试注入口：默认用真实网关与真 Dry-Run，门禁里可换成假实现（**只为可测性，不改产品行为**） */
  streamImpl = null,
  dryRunImpl = null,
} = {}) {
  const dir = root;
  // v1.1.9alpha：旧 ai-rules/worldbook/ 的包复制到 ai-rules/knowledgecard/（旧目录保留）
  migrateLegacyUserDir({ dir: join(dir, 'knowledgecard'), legacyDir: join(dir, 'worldbook') });

  /**
   * v1.1.11：全新安装 / 旧 AppData 可能没有 `.workspace.json`。
   *
   * v1.1.10 把提示词卡、本地规则卡并进设置页后，这两个入口会直接读规则工作区；
   * 但打包形态的用户目录是空的，旧规则页里那个「建立规则工作区」按钮又随页面删掉了。
   * 结果就是设置页报 `rules.no-index`，用户无路可走。
   *
   * 这里在服务启动时补一次初始化：只写空索引 + `prompts/`，不抄内置、不覆盖已有文件。
   * 已有索引时 `initRulesWorkspace()` 不会改动它。
   */
  if (!existsSync(join(dir, '.workspace.json'))) {
    const init = initRulesWorkspace({ dir });
    if (!init.ok) {
      // 初始化失败不阻塞服务启动：设置页会显示具体问题，用户仍可打开知识卡/解题。
      console.warn(`⚠ 规则工作区初始化失败（${dir}）：`, init.issues);
    }
  }
  /** 观测目录（M22）：默认 `observability/`，可用 `OD_OBS_DIR` 或构造参数改（测试用） */
  const OBS_DIR = obsDir ?? resolveObsDir();
  /** 历史库（M23）：默认 `data/history.db`，可用 `OD_HISTORY_PATH` 或构造参数改（测试用） */
  const HISTORY_PATH = historyDbPath;
  /** v1.1.7：开源日志目录（没显式给就按"程序目录/开源日志"解析） */
  const OPEN_LOG_DIR = openLogDir ?? resolveOpenLogDir();

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

    /* 知识卡：v2 库（无 keys，按 elements 触发）→ 适配成 v1 引擎形状。
       ⚠ Phase 3 过渡：UI 仍写 v1 卡；v2 store 会自动迁移有 elements 的用户卡，
          只有 keys 的用户卡会停用+报告。Phase 4 再把引擎/页面全切 v2。 */
    let knowledgecardEntries = [];
    let knowledgecardVocab = null;
    try {
      const lib = loadV2Library({
        userDir: join(dir, 'knowledgecard'),
        userVocabPath: join(dir, 'vocab.json'),
      });
      knowledgecardEntries = lib.entries.map(v2ToV1RuntimeEntry);
      knowledgecardVocab = lib.vocab;
      if (lib.problems.length) console.warn(`[knowledgecard v2] ${lib.problems.length} 条问题：${lib.problems.slice(0, 3).join('；')}`);
      if (lib.migration.length) console.warn(`[knowledgecard v2] 迁移 ${lib.migration.length} 条用户卡`);
    } catch (e) {
      console.warn(`[knowledgecard v2] 载入失败，退化为空卡集：${e?.message ?? e}`);
    }

    const config = {
      endpoint,
      apiKey,
      regexRules: [],
      mode,
      knowledgecardEntries,
      knowledgecardVersion: 2,
      ...(knowledgecardVocab ? { knowledgecardVocab } : {}),
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

    /**
     * ── v1.1.7「开源日志」：从这一刻开始记 ──
     *
     * 用户的要求是"每次都导出，不只是报错时导出"，所以采集器**在跑之前**就建好，
     * 收尾放在 `finally` 里 —— 成功、失败、被取消、抛异常，四种死法都要留下现场。
     *
     * 记的四样（用户点名，一样不多、一样不少）：
     *   ① 门禁哪条拦住 → `dryrun_done` 的 `checks`（含 detail / offenders / diagnostics）
     *   ② 用户与大模型的对话 → 下面包住的 `streamImpl`（消息原文 + 返回全文）
     *   ③ 动画代码 → `dryrun_done.program.slots`（8 个槽位）
     *   ④ 解题过程 → 各阶段的 `stage_delta` 正文（solve / steps / answers）
     */
    const runLog = createRunLog({
      appVersion: appVersion(),
      problem: { text: String(problem.text ?? ''), imageCount: images.length },
      model: endpoint.defaultModel ?? null,
      endpoint: endpoint.displayName ?? endpoint.id ?? null,
      devMode: config.devMode === true,
    });

    /**
     * 包一层网关拿"对话"。
     *
     * 为什么在网关这一层、而不是在编排里加埋点：
     *   · 编排每次调模型都走 `streamImpl`，包一层就**天然覆盖**主链路与自愈轮次，
     *     不用在 6 个阶段 + 修复循环里各写一遍（写漏一处就少一段对话）；
     *   · 不改流水线的纯事件流语义 —— 它照旧只吐事件，记录是外挂的。
     *
     * ⚠ 失败也要记：模型报错时"我们发了什么、它回了什么错"恰恰是最该看的。
     */
    const capture = (impl) => async (args) => {
      const t0 = Date.now();
      const meta = {
        stage: args?.stage ?? null,
        round: Number.isFinite(args?.round) ? args.round : null,
        messages: args?.messages ?? [],
      };
      try {
        const result = await impl(args);
        runLog.call({ ...meta, output: result?.text ?? '', ms: Date.now() - t0 });
        return result;
      } catch (err) {
        runLog.call({
          ...meta,
          output: null,
          ms: Date.now() - t0,
          error: { kind: err?.kind ?? err?.name ?? 'error', message: err?.message ?? String(err) },
        });
        throw err;
      }
    };

    try {
      const pipeline = runPipeline({
        problem: { text: String(problem.text ?? ''), images },
        images,
        config,
        signal: ac.signal,
        /* 恒传包过的实现：默认就是真实网关，注入口（测试）也照样被记录 */
        streamImpl: capture(streamImpl ?? streamChatCompletion),
        ...(dryRunImpl ? { dryRunImpl } : {}),
      });
      for await (const ev of pipeline) {
        runLog.event(ev);
        write(ev);
      }
    } catch (err) {
      runLog.thrown(err);
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
      /**
       * ── v1.1.7：**每次**都导出一份开源日志（成功 / 失败 / 取消 都一样）──
       *
       * 放在 `finally` 而不是"成功后"：报错与取消恰恰是最需要看现场的时候。
       * 写盘失败**绝不能让业务跟着挂**（用户已经拿到结果了），所以整段兜住。
       */
      try {
        const record = runLog.finish({ cancelled: closed });
        const saved = writeOpenLog(record, {
          dir: OPEN_LOG_DIR,
          /* 程序目录只读（装进 Program Files 就会这样）时退到用户数据目录，别把日志弄丢 */
          fallbackDir: join(OBS_DIR, OPEN_LOG_DIRNAME),
          secrets: collectSecrets({ dir }),
        });
        if (!saved.ok) console.warn(`[open-log] 导出失败：${saved.code} ${saved.message}`);
      } catch (e) {
        console.warn(`[open-log] 导出异常（不影响本次解题）：${e?.message ?? e}`);
      }
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
          knowledgecardHash: body.knowledgecardHash,
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

      /* ── 世界书（只写 ai-rules/knowledgecard/；内置只读） ── */
      if (path.startsWith('/api/knowledgecard')) {
        const wbDir = join(dir, 'knowledgecard');

        /**
         * v2 知识卡（Phase 3C-1）：读整库 + 保存单卡。
         * 旧 v1 端点保留给旧页面；新页面只走这两个。
         */
        if (req.method === 'GET' && path === '/api/knowledgecard/v2') {
          const lib = loadV2Library({ userDir: wbDir, userVocabPath: join(dir, 'vocab.json') });
          return ok(res, {
            dir: wbDir,
            vocab: lib.vocab,
            entries: lib.entries,
            builtinCount: lib.builtin.length,
            userCount: lib.user.length,
            problems: lib.problems,
            warnings: lib.warnings,
            migration: lib.migration,
          });
        }
        if (req.method === 'POST' && path === '/api/knowledgecard/v2/entry') {
          const body = await readJson(req);
          const lib = loadV2Library({ userDir: wbDir, userVocabPath: join(dir, 'vocab.json') });
          const r = saveV2Entry({ dir: wbDir, entry: body?.entry, vocab: lib.vocab });
          if (!r.ok) {
            return bad(
              res,
              (r.issues ?? ['保存失败']).map((message) => ({ code: 'knowledgecard.v2.invalid', path: 'entry', message })),
              400,
            );
          }
          return ok(res, r);
        }

        if (req.method === 'POST' && path === '/api/knowledgecard/v2/vocab-state') {
          const body = await readJson(req);
          const r = saveVocabState({
            path: join(dir, 'vocab.json'),
            disabledElements: Array.isArray(body?.disabledElements) ? body.disabledElements : [],
            disabledScenes: Array.isArray(body?.disabledScenes) ? body.disabledScenes : [],
          });
          return ok(res, r);
        }
        if (req.method === 'POST' && path === '/api/knowledgecard/v2/vocab-entry') {
          const body = await readJson(req);
          const builtinVocab = JSON.parse(readFileSync(join(PROJECT_ROOT, 'contracts', 'knowledgecard-vocab-v2.json'), 'utf8'));
          const sdk = JSON.parse(readFileSync(join(PROJECT_ROOT, 'sdk', 'signature-summary.json'), 'utf8'));
          const r = addVocabEntry({
            path: join(dir, 'vocab.json'),
            kind: body?.kind,
            entry: body?.entry,
            builtinVocab,
            primitiveNames: (sdk.functions ?? []).map((f) => f.name),
          });
          if (!r.ok) {
            return bad(
              res,
              (r.issues ?? ['词表新增失败']).map((message) => ({ code: 'knowledgecard.v2.vocab-invalid', path: 'vocab', message })),
              400,
            );
          }
          return ok(res, r);
        }
        if (req.method === 'DELETE' && path === '/api/knowledgecard/v2/vocab-entry') {
          const body = await readJson(req);
          const r = removeVocabEntry({ path: join(dir, 'vocab.json'), kind: body?.kind, id: body?.id });
          if (!r.ok) {
            return bad(
              res,
              (r.issues ?? ['词表删除失败']).map((message) => ({ code: 'knowledgecard.v2.vocab-invalid', path: 'vocab', message })),
              400,
            );
          }
          return ok(res, r);
        }

        if (req.method === 'GET' && path === '/api/knowledgecard') {
          const listed = listKnowledgecardPacks({ dir: wbDir });
          const builtin = listBuiltinEntries();
          return ok(res, { dir: wbDir, ...listed, builtinCount: builtin.count, builtinIds: builtin.entries.map((e) => e.id) });
        }
        if (req.method === 'GET' && path === '/api/knowledgecard/builtin') {
          const b = listBuiltinEntries();
          return ok(res, b);
        }
        const builtinOne = /^\/api\/knowledgecard\/builtin\/([A-Za-z0-9._-]+)$/.exec(path);
        if (req.method === 'GET' && builtinOne) {
          const r = readBuiltinEntry(builtinOne[1]);
          if (!r.ok) return bad(res, r.issues, 404);
          return ok(res, r);
        }
        if (req.method === 'POST' && path === '/api/knowledgecard/copy') {
          const body = await readJson(req);
          const r = copyBuiltinEntry({ dir: wbDir, id: String(body.id ?? ''), name: body.name });
          if (!r.ok) return bad(res, r.issues, 400);
          return ok(res, r);
        }
        /**
         * 一键恢复**本版本内置**（设置页按钮）。
         *
         * 语义只动「覆盖内置」的用户副本，用户自己新建的卡一条不碰；写/删前都有滚动备份。
         * 部分失败也返回 200 + `ok:false` + `problems`：界面要能把"恢复了几条、哪个文件没动"说清，
         * 不能因为一个坏文件就把已经成功的恢复说成整体失败。
         */
        if (req.method === 'POST' && path === '/api/knowledgecard/restore') {
          return ok(res, restoreBuiltinKnowledgecard({ dir: wbDir }));
        }
        if (req.method === 'POST' && path === '/api/knowledgecard/packs') {
          const body = await readJson(req);
          const r = createKnowledgecardPack({ dir: wbDir, name: String(body.name ?? '') });
          if (!r.ok) return bad(res, r.issues, 400);
          return ok(res, r);
        }
        const packMatch = /^\/api\/knowledgecard\/packs\/([A-Za-z0-9._-]+)$/.exec(path);
        if (packMatch) {
          const name = packMatch[1];
          if (req.method === 'GET') {
            const r = readKnowledgecardPack({ dir: wbDir, name });
            if (!r.ok) return bad(res, r.issues, 404);
            return ok(res, r);
          }
          if (req.method === 'PUT') {
            const body = await readJson(req);
            const r = saveKnowledgecardPack({ dir: wbDir, name, text: String(body.text ?? '') });
            if (!r.ok) return bad(res, r.issues, 400);
            return ok(res, r);
          }
          if (req.method === 'DELETE') {
            const r = deleteKnowledgecardPack({ dir: wbDir, name });
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
