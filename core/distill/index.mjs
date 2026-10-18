/**
 * 教辅蒸馏（M19）· 简版
 *
 * 用户 2026-10-17 的裁决：**不做 PDF 解析**，只做"丢图片 / 粘文字 →
 * distill 阶段（视觉模型）→ 候选词条 → 人工确认 → 入库"。
 * 第 5 期已经用真实教辅大量蒸馏过，链路的可行性已验证，所以这里不重复造轮子：
 *   · Prompt 用 `core/prompts/templates.mjs` 里那份可编辑的 `distill`（用户能改）；
 *   · 视觉门控用契约第 7 条（端点必须 supportsVision）；
 *   · 入库走 `core/worldbook/editor.mjs` 的整批校验 + 原子写 + 备份；
 *   · 产物只落本机 `distill-sessions/`，**绝不写 ai-rules**。
 *
 * 三条硬约束（都对应用户可见的承诺）：
 *   ① **绝不自动入库**：候选只是候选，必须人工点确认（§20 风险表）；
 *   ② **页级进度可中断续做**：每页结果单独落盘，重开能接着做；
 *   ③ **失败页单独列出、不静默跳过**：模型没回/格式坏掉都要说明白。
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORLDBOOK_ENUMS } from '../../contracts/spec/frozen-keys.mjs';
import { saveWorldbookPack } from '../worldbook/editor.mjs';
import { buildExportPack, packToText } from '../worldbook/import-export.mjs';
import { validateEntry } from '../worldbook/store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(HERE, '..', '..');
/** 会话目录（本机产物，不进规则区）；门禁 ㉜ 用 OD_DISTILL_DIR 指到临时目录 */
export const SESSION_DIR = process.env.OD_DISTILL_DIR
  ? resolve(process.env.OD_DISTILL_DIR)
  : join(PROJECT_ROOT, 'distill-sessions');

/* ────────────────────────────── 成本预估 ────────────────────────────── */

/**
 * 每页 token 预算。图片页按视觉输入的保守值，文字页按字数折算。
 * ⚠ 这里**只报 token，不报钱**：单价是用户自己填的端点属性，
 *   编一个"每百万 token 多少钱"写死在代码里，等于替用户撒谎。
 */
export const TOKEN_BUDGET = Object.freeze({
  imagePage: 1400, // 一页扫描图的视觉 token（够 1–2 道题 + 公式）
  charsPerToken: 1.6,
  outputPerPage: 700, // 期望的结构化输出（候选词条 JSON）
});

/**
 * 成本预估（页数 × 单页 token）。
 * @param {{ pages?: Array<{kind?: 'image'|'text', chars?: number}>, charsPerPage?: number }} input
 */
export function estimateCost(input = {}) {
  const pages = Array.isArray(input.pages) ? input.pages : [];
  const charsPerPage = Number(input.charsPerPage) || 1200;
  let tokensIn = 0;
  for (const page of pages) {
    if (page && page.kind === 'text') {
      tokensIn += Math.ceil((Number(page.chars) || charsPerPage) / TOKEN_BUDGET.charsPerToken);
    } else {
      tokensIn += TOKEN_BUDGET.imagePage;
    }
  }
  const tokensOut = pages.length * TOKEN_BUDGET.outputPerPage;
  return {
    pages: pages.length,
    tokensIn,
    tokensOut,
    tokensTotal: tokensIn + tokensOut,
    /** 给用户看的一句话（不给金额，只给"按你的单价折算"的口径） */
    note: `${pages.length} 页 ≈ 输入 ${tokensIn} tokens + 输出 ${tokensOut} tokens；按你所填端点的单价折算即可`,
  };
}

/* ────────────────────────── 提示词与消息组装 ────────────────────────── */

/** 追加在任务段的输出契约（不改 Prompt 本身：Prompt 是用户可编辑的只读文本） */
export const OUTPUT_CONTRACT = `请严格只输出一个 JSON 对象，不要任何解释文字、不要 Markdown 代码围栏：
{"entries":[{"title":"词条标题","keys":["触发关键词"],"slot":"solve","content":"该页可沉淀的解题知识（含公式与判据），用自然语言写清"}]}
要求：
- entries 最多 3 条；没有可沉淀的知识就输出 {"entries":[]}；
- keys 是**题面里真会出现的字面词**（不要写抽象概念），2–6 个；
- slot 只能是 "solve" 或 "scene_code"（解题规范 / 建模规范）；
- content 里出现 LaTeX 用 $…$ 包裹；不要编造该页没有的数据。`;

/**
 * 组装一页的 messages。
 * @param {{ promptText: string, page: { kind: 'image'|'text', text?: string, image?: object }, pageIndex: number, pageCount: number, buildUserMessage: Function }} input
 */
export function buildDistillMessages({ promptText, page, pageIndex, pageCount, buildUserMessage }) {
  const head = `这是第 ${pageIndex + 1} / ${pageCount} 页。`;
  const task =
    page.kind === 'text'
      ? `${head}\n以下是该页的文字内容：\n\n${String(page.text ?? '').slice(0, 12000)}`
      : `${head}\n请读取这张教辅页图片：提取题目文本、公式与配图方位描述，并按下面的契约输出。`;
  const user = buildUserMessage({
    text: `${task}\n\n${OUTPUT_CONTRACT}`,
    images: page.kind === 'image' && page.image ? [page.image] : [],
  });
  return [
    { role: 'system', content: String(promptText ?? '') },
    user,
  ];
}

/* ────────────────────────── 解析模型输出 ────────────────────────── */

function firstJsonObject(text) {
  const s = String(text ?? '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  // 允许 ` 围栏与前后闲话：从第一个 { 开始做括号配对（跳过字符串里的括号）
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 修一次"反斜杠没转义"的 JSON。
 *
 * ⚠ 这是真实高频故障，不是洁癖：模型在 JSON 字符串里写 LaTeX 时常常只写 `\mu` 而不是 `\\mu`，
 *   而 `\m` 不是合法 JSON 转义 ⇒ 整个 JSON.parse 直接炸。**不能因此丢掉整页结果**。
 *   做法：把所有"不是合法 JSON 转义"的反斜杠补成 `\\`，再解析一次。
 */
function repairBackslashes(text) {
  return String(text).replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}

/**
 * 解析一页的模型输出 → 候选词条。
 * 解析不了就**如实报错并保留原文**，不静默丢弃（§20：失败页要单独列出）。
 */
export function parseDistillOutput(text, { pageIndex = 0 } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return { entries: [], issues: [{ code: 'distill.empty', pageIndex, message: '模型没有返回任何内容' }] };
  const json = firstJsonObject(raw);
  if (!json) {
    return { entries: [], issues: [{ code: 'distill.no-json', pageIndex, message: '输出里没找到 JSON 对象', raw }] };
  }
  let data;
  try {
    data = JSON.parse(json);
  } catch (err) {
    // 第二遍：修 LaTeX 反斜杠后重试（真实模型输出里这一步救回来的概率很高）
    try {
      data = JSON.parse(repairBackslashes(json));
    } catch (err2) {
      return {
        entries: [],
        issues: [{ code: 'distill.bad-json', pageIndex, message: `JSON 解析失败：${err.message}（修反斜杠后仍失败：${err2.message}）`, raw }],
      };
    }
  }
  const list = Array.isArray(data?.entries) ? data.entries : null;
  if (!list) return { entries: [], issues: [{ code: 'distill.no-entries', pageIndex, message: '输出里没有 entries 数组', raw }] };

  const issues = [];
  const entries = [];
  list.slice(0, 3).forEach((item, i) => {
    const title = String(item?.title ?? '').trim();
    const content = String(item?.content ?? '').trim();
    const keys = Array.isArray(item?.keys) ? item.keys.map((k) => String(k).trim()).filter(Boolean) : [];
    const slot = item?.slot === 'scene_code' ? 'scene_code' : 'solve';
    if (!title || !content || !keys.length) {
      issues.push({ code: 'distill.bad-entry', pageIndex, message: `第 ${i + 1} 条候选缺 title/content/keys，已跳过` });
      return;
    }
    entries.push({ title, keys: keys.slice(0, 8), slot, content, pageIndex });
  });
  return { entries, issues };
}

/* ────────────────────────── 会话（可中断续做） ────────────────────────── */

function sessionPath(id) {
  return join(SESSION_DIR, `${id}.json`);
}

function safeId(input) {
  const s = String(input ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || `s-${Date.now()}`;
}

export function createSession({ title, source = 'image', pages = [], endpointId = null } = {}) {
  const id = safeId(`ds-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const session = {
    id,
    title: String(title || '教辅蒸馏'),
    source,
    endpointId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    /** 每页：{ index, kind, chars?, status: 'pending'|'done'|'failed', entries: [], issues: [], raw? } */
    pages: pages.map((p, index) => ({
      index,
      kind: p?.kind === 'text' ? 'text' : 'image',
      chars: Number(p?.chars) || 0,
      status: 'pending',
      entries: [],
      issues: [],
    })),
    estimate: estimateCost({ pages }),
  };
  saveSession(session);
  return session;
}

export function saveSession(session) {
  mkdirSync(SESSION_DIR, { recursive: true });
  const next = { ...session, updatedAt: new Date().toISOString() };
  writeFileSync(sessionPath(next.id), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function loadSession({ id } = {}) {
  try {
    return JSON.parse(readFileSync(sessionPath(safeId(id)), 'utf8'));
  } catch {
    return null;
  }
}

export function listSessions() {
  try {
    return readdirSync(SESSION_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const s = JSON.parse(readFileSync(join(SESSION_DIR, f), 'utf8'));
          return {
            id: s.id,
            title: s.title,
            pages: s.pages?.length ?? 0,
            done: (s.pages ?? []).filter((p) => p.status === 'done').length,
            failed: (s.pages ?? []).filter((p) => p.status === 'failed').length,
            updatedAt: s.updatedAt,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  } catch {
    return [];
  }
}

/** 把某一页的结果写回会话（续做靠它：done 的页不会再跑） */
export function applyPageResult({ session, pageIndex, entries, issues, raw, status }) {
  const pages = (session.pages ?? []).map((p) =>
    p.index === pageIndex
      ? { ...p, status: status ?? (entries?.length ? 'done' : 'failed'), entries: entries ?? [], issues: issues ?? [], raw: raw ?? undefined }
      : p,
  );
  return saveSession({ ...session, pages });
}

/* ────────────────────────── 单页蒸馏 ────────────────────────── */

/** distill 阶段的视觉门控（契约第 7 条）：要读图就必须 supportsVision */
export function assertVisionReady(endpoint, { needsImage = true } = {}) {
  if (!endpoint) return { ok: false, code: 'distill.no-endpoint', message: '没有配置 distill 阶段的端点' };
  if (needsImage && endpoint.supportsVision !== true) {
    return {
      ok: false,
      code: 'distill.needs-vision',
      message: 'distill 端点必须支持视觉（supportsVision = true），否则无法读取扫描页图片',
    };
  }
  return { ok: true };
}

/**
 * 蒸馏一页。
 * @param {{ endpoint: object, apiKey: string, page: object, promptText: string, pageIndex: number, pageCount: number, collect: Function, buildUserMessage: Function, signal?: AbortSignal }} input
 */
export async function distillPage(input) {
  const { endpoint, apiKey, page, promptText, pageIndex = 0, pageCount = 1, collect, buildUserMessage, signal } = input;
  const gate = assertVisionReady(endpoint, { needsImage: page?.kind !== 'text' });
  if (!gate.ok) return { ok: false, code: gate.code, message: gate.message, entries: [], issues: [] };

  const messages = buildDistillMessages({ promptText, page, pageIndex, pageCount, buildUserMessage });
  let text = '';
  try {
    const out = await collect({ endpoint, apiKey, messages, vision: page?.kind !== 'text', signal });
    text = String(out?.text ?? '');
  } catch (err) {
    return {
      ok: false,
      code: 'distill.call-failed',
      message: String(err?.message ?? err),
      entries: [],
      issues: [{ code: 'distill.call-failed', pageIndex, message: String(err?.message ?? err) }],
    };
  }
  const parsed = parseDistillOutput(text, { pageIndex });
  return { ok: true, entries: parsed.entries, issues: parsed.issues, raw: text };
}

/* ────────────────────────── 入库（人工确认后） ────────────────────────── */

/** 候选 → 合规词条（字段与 §9.1 对齐；id 带会话前缀，避免撞车） */
export function candidatesToEntries({ sessionId, picks = [] } = {}) {
  const prefix = safeId(sessionId).slice(0, 24);
  return picks.map((p, i) =>
    ({
      id: `ds-${prefix}-${String(i + 1).padStart(2, '0')}`,
      title: String(p.title ?? '').trim(),
      origin: 'user',
      category: WORLDBOOK_ENUMS.category.includes('user_lore') ? 'user_lore' : WORLDBOOK_ENUMS.category[0],
      enabled: true,
      constant: false,
      recursive: true,
      keys: Array.isArray(p.keys) ? p.keys : [],
      secondary_keys: { logic: 'AND_ANY', list: [] },
      concepts: [],
      tags: [],
      elements: [],
      insertion_slot: [p.slot === 'scene_code' ? 'scene_code' : 'solve'],
      order: 100,
      priority: 'normal',
      content: String(p.content ?? '').trim(),
      code_examples: [],
    }),
  );
}

/**
 * 提交候选入库（**只能由人工确认后调用**）。
 * 走 `saveWorldbookPack`：整批校验 + 原子写 + 备份，一个坏词条 ⇒ 整批失败（§16 语义）。
 */
export function commitCandidates({ dir, sessionId, picks = [], packName } = {}) {
  if (!Array.isArray(picks) || picks.length === 0) {
    return { ok: false, issues: [{ code: 'distill.nothing-picked', message: '没有勾选任何候选词条' }] };
  }
  const entries = candidatesToEntries({ sessionId, picks });
  const problems = [];
  entries.forEach((entry, i) => {
    const issues = validateEntry(entry, `候选 ${i + 1}（${entry.title || '未命名'}）`);
    if (issues.length) problems.push(...issues);
  });
  if (problems.length) return { ok: false, issues: problems.map((message) => ({ code: 'distill.invalid-entry', message })) };

  const pack = buildExportPack({ entries });
  const name = `${safeId(packName || `distill-${sessionId}`)}.json`;
  const saved = saveWorldbookPack({ dir, name, text: packToText(pack) });
  return { ok: saved.ok !== false, name, entries: entries.length, ...(saved.ok === false ? { issues: saved.issues } : {}) };
}
