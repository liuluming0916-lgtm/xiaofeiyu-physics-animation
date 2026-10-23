/**
 * 开源日志（v1.1.7）—— **每次跑题都自动留一份"能寄给开发者的病历"**。
 *
 * ── 为什么单独一层，而不是塞进 `journal.mjs` ──
 *
 * `journal.mjs` 是**给我们自己看**的运维观测（会落到 `%APPDATA%` 的深处，
 * 带 token 估算、阶段耗时、世界书命中数……），它服务的是"这版跑得怎么样"。
 * 这里服务的是另一件事：**公测用户出问题时，让他能把现场直接发给开发者**。
 *
 * 两者受众不同 ⇒ 内容取舍不同：
 *   · 运维观测要**广度**（什么都记一点，事后才发现哪个字段有用）；
 *   · 开源日志要**深度但边界清楚**（用户点名要的四样，一样不少、一样不多）：
 *       ① 门禁是哪一条拦住的；
 *       ② 用户与大模型的对话；
 *       ③ 动画代码；
 *       ④ 解题过程。
 *
 * ── 两条硬口径 ──
 *
 * ① **每次都导出，不等报错**：报错那次往往导不出来（进程没了/流断了），
 *    而"上一次成功、这一次失败"的对照恰恰最有用。所以调用方在 `finally` 里调，
 *    哪怕被取消、哪怕抛异常，也照样落一份半成品 —— 半成品也比空白强。
 *
 * ② **落盘即脱敏，写完从磁盘读回来复核**：这套日志是要**发给别人**的，
 *    Key、绝对路径一旦漏出去就收不回来。复核方式与 `journal.mjs` 同源：
 *    不信内存里的对象，只信磁盘上的字节（`assertRedacted`）。
 *
 * ── 产物形态 ──
 *
 *   开源日志/
 *     20261019-150312-123.html   ← 给人看的（单文件、无脚本、双击即开）
 *     20261019-150312-123.json   ← 给机器看的（同一份数据，字段稳定）
 *
 * 为什么是 HTML + JSON 而不是两份 HTML 或一个 JSON：
 *   HTML 负责"人一眼看懂门禁拦在哪、模型说了什么"，JSON 负责"以后能脚本化统计"。
 *   两者由**同一个 record** 渲染 ⇒ 永远不会出现"网页和 json 说的不一样"。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PROJECT_ROOT } from '../../tools/paths.mjs';
import { assertRedacted, collectSecrets, redactText, redactValue } from '../security/index.mjs';
import { makeRunId, resolveObsDir } from './journal.mjs';

/** 打包目录里那个文件夹的名字（用户点名要的四个字，不能改） */
export const OPEN_LOG_DIRNAME = '开源日志';
export const OPEN_LOG_FORMAT = 'od-open-log';
export const OPEN_LOG_VERSION = 1;

/**
 * 门禁（C1–C9）的人话名字。
 *
 * 为什么要这张表：日志里只写 `C5` 等于没说 —— 用户看到的是
 * "被 C5 拦住了"，脑子里没有画面。表里的名字取自 `contracts/spec/frozen-keys.mjs`
 * 的 §7.2 口径（那里是判据的**唯一事实来源**，这里只是它的中文短名）。
 */
export const CHECK_NAMES = Object.freeze({
  C1: '结构与契约（8 槽位 / 语法 / API 白名单 / 箭头契约）',
  C2: '运行完成度（跑得完、不超时）',
  C3: '数值健全（不产出 NaN / Infinity）',
  C4: '画面连续性（相邻帧不该突变）',
  C5: '步骤与时长一致',
  C6: '步骤边界不跳变',
  C7: '答案可复现（读数对得上答案）',
  C8: '读数稳定',
  C9: '画面活性（不是一张静止图）',
});

/** 解题过程要展示的阶段（其余阶段是代码/校验，不属于"过程文字"） */
const SOLUTION_STAGES = Object.freeze(['read_problem', 'solve', 'breakdown', 'analysis', 'couple']);

/** 单条文本上限：防一份日志被某个失控输出撑到几十 MB（截断会明确标注） */
const MAX_TEXT = 400_000;

/**
 * 取应用版本（打包后 `package.json` 就在 `resources/app/` 里，与源码同形）。
 * 读不到也不该让日志链路挂掉 —— 只是少一个字段。
 */
export function appVersion() {
  try {
    return JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/**
 * 开源日志目录。
 *
 * 优先级：`OD_OPEN_LOG_DIR`（主进程注入/测试注入）> `OD_APP_DIR/开源日志` > 工程根。
 * 早期口径是"跟用户数据走"，但用户明确要求**放在打包文件夹里** ——
 * 公测用户找到软件目录就能找到日志，不用去 `%APPDATA%` 里刨。
 */
export function resolveOpenLogDir({ dir, appDir } = {}) {
  if (dir) return resolve(dir);
  if (process.env.OD_OPEN_LOG_DIR) return resolve(process.env.OD_OPEN_LOG_DIR);
  const base = appDir ?? process.env.OD_APP_DIR ?? PROJECT_ROOT;
  return join(resolve(base), OPEN_LOG_DIRNAME);
}

/**
 * 把题目图片/解析图片变成可内嵌的记录。
 *
 * v1.1.18 用户裁决：图片**内嵌**进日志（不另外开 assets 目录）。
 * 这样老师把一份 HTML/JSON 发给开发者时，图不会再丢；代价是日志会变大，
 * 用户明确接受，所以这里不设大小上限，只如实记 bytes / sha256。
 */
function imageRecords(list = []) {
  return (Array.isArray(list) ? list : [])
    .filter((img) => img && Buffer.isBuffer(img.data) && img.data.length > 0)
    .map((img, i) => {
      const mime = typeof img.mime === 'string' && /^image\/[a-z0-9.+-]+$/i.test(img.mime) ? img.mime : 'image/png';
      const data = img.data;
      return {
        index: i + 1,
        name: String(img.name ?? `image-${i + 1}`),
        mime,
        bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        dataUrl: `data:${mime};base64,${data.toString('base64')}`,
      };
    });
}

function clampText(text) {
  const s = typeof text === 'string' ? text : text == null ? '' : String(text);
  if (s.length <= MAX_TEXT) return s;
  return `${s.slice(0, MAX_TEXT)}\n…（以下已截断：原文 ${s.length} 字符，超过单条上限 ${MAX_TEXT}）`;
}

/**
 * 消息脱敏预处理：**把图片的 base64 摘掉**。
 *
 * 一条带图消息里塞着 15 MB 的 data URL；六七个阶段各存一份 ⇒ 一份日志上百 MB，
 * 而且图片本身对"门禁为什么拦"没有诊断价值（模型看到的图就是用户传的那张）。
 * 所以只留一个占位符 + 长度，证明"这里本来有图、没丢"。
 */
function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => {
    const role = m?.role ?? 'unknown';
    if (typeof m?.content === 'string') return { role, content: clampText(m.content) };
    if (Array.isArray(m?.content)) {
      const parts = m.content.map((p) => {
        if (!p || typeof p !== 'object') return { type: 'text', text: clampText(String(p ?? '')) };
        if (p.type === 'image_url' || p.image_url) {
          const url = typeof p.image_url === 'string' ? p.image_url : String(p.image_url?.url ?? '');
          const mime = /^data:([^;,]+)/.exec(url)?.[1] ?? 'image/*';
          return { type: 'image', omitted: true, mime, note: `图片已省略（data URL ${url.length} 字符）` };
        }
        return { ...p, text: clampText(String(p.text ?? '')) };
      });
      return { role, content: parts };
    }
    return { role, content: clampText(String(m?.content ?? '')) };
  });
}

/** 检查条目的瘦身：保留判据要点，砍掉可能无限长的 offenders / diagnostics */
function trimCheck(c) {
  if (!c || typeof c !== 'object') return { id: 'unknown', status: 'unknown', blocking: false, detail: '' };
  const take = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : undefined);
  const out = {
    id: c.id ?? 'unknown',
    name: CHECK_NAMES[c.id] ?? null,
    severity: c.severity ?? null,
    status: c.status ?? 'unknown',
    blocking: Boolean(c.blocking),
    detail: clampText(String(c.detail ?? c.message ?? '')),
  };
  const offenders = take(c.offenders, 20);
  if (offenders) out.offenders = offenders.map((o) => redactValue(o));
  const diagnostics = take(c.diagnostics, 20);
  if (diagnostics) out.diagnostics = diagnostics.map((d) => redactValue(d));
  return out;
}

/**
 * 采集器：**边收事件边攒**，最后一次性出 record。
 *
 * 为什么是"采集器"而不是直接读 `journal.mjs` 的 `summarize()`：
 * 那边的口径是"给运维看摘要"（`stage_delta` 正文**故意不落盘**，只留字数），
 * 而这里恰恰要正文 —— 用途相反，复用只会让两边都别扭。
 *
 * @param {{
 *   appVersion?: string|null,
 *   problem?: { text?: string, imageCount?: number },
 *   model?: string|null,
 *   endpoint?: string|null,
 *   devMode?: boolean,
 *   images?: Array<{mime:string,data:Buffer,name?:string}>,
 *   referenceImages?: Array<{mime:string,data:Buffer,name?:string}>,
 * }} [input]
 */
export function createRunLog({
  appVersion: version = null,
  problem = {},
  model = null,
  endpoint = null,
  devMode = false,
  images = [],
  referenceImages = [],
} = {}) {
  const startedAt = new Date().toISOString();
  const runId = makeRunId();

  /** stage → 正文（解题过程直接用它；`stage_delta` 的权威拼接） */
  const stageText = new Map();
  /** 门禁的逐轮结果 */
  const rounds = [];
  /** 每次模型调用 */
  const dialogue = [];
  const errors = [];
  /** 阶段时间线（start/done/error/skipped），按到达顺序 */
  const timeline = [];
  let lastReport = null;
  let runDone = null;
  let entry = null;
  let finalModel = model;
  /** 生成溯源（从事件/报告里抓，最后落进 run / animation） */
  let promptHash = null;
  let knowledgecardHash = null;
  /** v1.1.18：除“四样”外，把判定/知识卡/耦合/拆图也留档 */
  let judgement = null;
  let knowledgecard = null;
  let diagram = null;
  let coupling = null;
  let runStart = null;

  const bump = (stage, text) => {
    if (typeof text !== 'string' || !text) return;
    stageText.set(stage, `${stageText.get(stage) ?? ''}${text}`);
  };

  return {
    runId,

    /** 一条编排事件（调用方原样转发） */
    event(ev) {
      if (!ev || typeof ev !== 'object') return;
      switch (ev.type) {
        case 'run_start':
          runStart = {
            entry: ev.entry ?? null,
            model: ev.model ?? null,
            mode: ev.mode ?? null,
            stages: Array.isArray(ev.stages) ? ev.stages : [],
            imageCount: Number(ev.imageCount ?? 0) || 0,
            maxRepairRounds: ev.maxRepairRounds ?? null,
          };
          if (ev.model) finalModel = ev.model;
          if (ev.entry) entry = ev.entry;
          break;
        case 'stage_start':
          timeline.push({
            at: ev.at ?? new Date().toISOString(),
            stage: ev.stage ?? null,
            phase: 'start',
            round: Number.isFinite(ev.round) ? ev.round : null,
            mode: ev.mode ?? null,
            index: ev.index ?? null,
          });
          break;
        case 'stage_done':
          timeline.push({
            at: ev.at ?? new Date().toISOString(),
            stage: ev.stage ?? null,
            phase: ev.skipped ? 'skipped' : 'done',
            round: Number.isFinite(ev.round) ? ev.round : null,
            ms: ev.ms ?? null,
            reason: ev.reason ?? null,
            updated: Array.isArray(ev.updated) ? ev.updated : null,
          });
          break;
        case 'stage_delta':
          bump(ev.stage, ev.text);
          if (typeof ev.promptHash === 'string' && ev.promptHash) promptHash = ev.promptHash;
          break;
        case 'judgement_done':
          judgement = {
            stage: ev.stage ?? null,
            concepts: Array.isArray(ev.concepts) ? ev.concepts : [],
            tags: Array.isArray(ev.tags) ? ev.tags : [],
            elements: Array.isArray(ev.elements) ? ev.elements : [],
            scenes: Array.isArray(ev.scenes) ? ev.scenes : [],
            unknowns: ev.unknowns ?? {},
            problems: Array.isArray(ev.problems) ? ev.problems : [],
            why: ev.why ?? '',
            empty: ev.empty === true,
          };
          break;
        case 'knowledgecard_done':
          knowledgecard = {
            hash: ev.hash ?? null,
            libraryCount: ev.libraryCount ?? null,
            matched: ev.matched ?? null,
            entries: Array.isArray(ev.entries) ? ev.entries : [],
            emptySlots: Array.isArray(ev.emptySlots) ? ev.emptySlots : [],
            truncatedSlots: Array.isArray(ev.truncatedSlots) ? ev.truncatedSlots : [],
            warnings: Array.isArray(ev.warnings) ? ev.warnings : [],
            charsBySlot: ev.charsBySlot ?? {},
            injectedBySlot: ev.injectedBySlot ?? {},
            judgement: ev.judgement ?? null,
            judgementUnknowns: ev.judgementUnknowns ?? null,
            judgementProblems: ev.judgementProblems ?? null,
            judgementEmpty: ev.judgementEmpty === true,
          };
          break;
        case 'diagram_done':
          diagram = {
            ok: ev.ok === true,
            reason: ev.reason ?? null,
            bbox: ev.bbox ?? null,
            width: ev.width ?? null,
            height: ev.height ?? null,
            fallbackWhole: ev.fallbackWhole === true,
          };
          break;
        case 'coupling_done':
          coupling = {
            stepTimes: Array.isArray(ev.stepTimes) ? ev.stepTimes : null,
            displayStepTimes: Array.isArray(ev.displayStepTimes) ? ev.displayStepTimes : null,
            timeMap: Array.isArray(ev.timeMap) ? ev.timeMap : null,
            displayDuration: Number.isFinite(ev.displayDuration) ? ev.displayDuration : null,
            fallback: ev.fallback === true,
            warning: ev.warning ?? null,
            attempts: ev.attempts ?? null,
          };
          break;
        case 'dryrun_done':
          lastReport = ev;
          if (ev.program?.provenance) {
            if (ev.program.provenance.promptHash) promptHash = ev.program.provenance.promptHash;
            if (ev.program.provenance.knowledgecardHash) knowledgecardHash = ev.program.provenance.knowledgecardHash;
          }
          rounds.push({
            /**
             * `round` 的语义：**首次校验没有轮次**（流水线不传），自愈轮次从 1 开始。
             * 这里把 0 / 负数 / 非数字一律归一成 `null` = "首次校验" ——
             * 否则 HTML 上会出现"第 0 轮（修复后）"这种自相矛盾的标题。
             */
            round: Number.isFinite(ev.round) && ev.round > 0 ? ev.round : null,
            verdict: ev.verdict ?? null,
            cancelled: Boolean(ev.cancelled),
            advisory: Boolean(ev.advisory),
            gatesBypassed: Array.isArray(ev.gatesBypassed) ? ev.gatesBypassed : [],
            checks: (Array.isArray(ev.checks) ? ev.checks : []).map(trimCheck),
          });
          break;
        case 'stage_error':
          timeline.push({
            at: ev.at ?? new Date().toISOString(),
            stage: ev.stage ?? null,
            phase: 'error',
            round: Number.isFinite(ev.round) ? ev.round : null,
            kind: ev.error?.kind ?? 'unknown',
            message: clampText(String(ev.error?.message ?? '')),
          });
          errors.push({
            stage: ev.stage ?? null,
            kind: ev.error?.kind ?? 'unknown',
            message: clampText(String(ev.error?.message ?? '')),
            hint: ev.error?.hint ?? null,
          });
          break;
        case 'run_done':
          runDone = ev;
          if (Number.isFinite(ev.displayDuration)) {
            coupling = {
              ...(coupling ?? { stepTimes: null, displayStepTimes: null, timeMap: null, fallback: false, warning: null, attempts: null }),
              stepTimes: ev.stepTimes ?? coupling?.stepTimes ?? null,
              displayStepTimes: ev.displayStepTimes ?? coupling?.displayStepTimes ?? null,
              timeMap: ev.timeMap ?? coupling?.timeMap ?? null,
              displayDuration: ev.displayDuration,
            };
          }
          break;
        case 'run_label':
          if (ev.entry) entry = ev.entry;
          break;
        default:
          break;
      }
    },

    /**
     * 一次模型调用（由调用方包住 `streamImpl` 记录）。
     * ⚠ 这里必须**在模型真返回之后**调：`output` 是权威全文，不是增量拼接。
     */
    call({ stage, round = null, messages, output, ms = null, error = null }) {
      dialogue.push({
        index: dialogue.length + 1,
        stage: stage ?? 'unknown',
        round: Number.isFinite(round) ? round : null,
        at: new Date().toISOString(),
        ms,
        messages: sanitizeMessages(messages),
        output: error ? null : clampText(String(output ?? '')),
        error: error ? { kind: error.kind ?? 'unknown', message: clampText(String(error.message ?? '')) } : null,
      });
    },

    /** 外部异常（流水线抛出来的那种） */
    thrown(err) {
      errors.push({
        stage: null,
        kind: 'thrown',
        message: clampText(String(err?.message ?? err)),
        hint: null,
      });
    },

    /** 收尾：把攒的东西拼成一份 record（纯函数式的收口，不碰磁盘） */
    finish({ cancelled = false } = {}) {
      const finishedAt = new Date().toISOString();
      const finalRound = rounds.length ? rounds[rounds.length - 1] : null;
      const checks = finalRound?.checks ?? [];
      const failed = checks.filter((c) => c.status && c.status !== 'pass');
      const blockedBy = failed
        .filter((c) => c.blocking && c.status === 'fail')
        .map((c) => ({ id: c.id, name: c.name, detail: c.detail }));

      const slots = lastReport?.program?.slots && typeof lastReport.program.slots === 'object' ? lastReport.program.slots : {};
      const solution = {};
      for (const s of SOLUTION_STAGES) {
        if (stageText.has(s)) solution[s] = clampText(stageText.get(s) ?? '');
      }
      const embeddedImages = imageRecords(images);
      const embeddedReferenceImages = imageRecords(referenceImages);

      return {
        format: OPEN_LOG_FORMAT,
        version: OPEN_LOG_VERSION,
        appVersion: version,
        exportedAt: finishedAt,
        run: {
          runId,
          startedAt,
          finishedAt,
          entry,
          model: finalModel,
          endpoint,
          devMode: Boolean(devMode),
          cancelled: Boolean(cancelled || runDone?.cancelled),
          verdict: runDone?.verdict ?? finalRound?.verdict ?? (errors.length ? 'error' : null),
          ms: Number(runDone?.ms ?? 0) || null,
          /** 告警横幅是对象；旧代码 `String(object)` 会写成 [object Object]。兼容旧的字符串形态。 */
          banner:
            typeof runDone?.banner === 'string'
              ? { title: '告警横幅', message: runDone.banner }
              : runDone?.banner && typeof runDone.banner === 'object'
                ? JSON.parse(JSON.stringify(runDone.banner))
                : null,
          promptHash,
          knowledgecardHash,
          start: runStart,
          timeline,
          problem: {
            text: clampText(String(problem?.text ?? '')),
            imageCount: Number(problem?.imageCount ?? 0) || 0,
            images: embeddedImages,
          },
          ...(embeddedReferenceImages.length
            ? { reference: { imageCount: embeddedReferenceImages.length, images: embeddedReferenceImages } }
            : {}),
        },
        gates: {
          verdict: finalRound?.verdict ?? null,
          blockedBy,
          failed: failed.map((c) => ({ id: c.id, name: c.name, status: c.status, blocking: c.blocking, detail: c.detail })),
          rounds,
          devModeBypassed: finalRound?.gatesBypassed ?? [],
        },
        dialogue,
        animation: {
          available: Object.keys(slots).length > 0,
          slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, clampText(String(v))])),
          stepTimes: coupling?.stepTimes ?? runDone?.stepTimes ?? null,
          displayStepTimes: coupling?.displayStepTimes ?? runDone?.displayStepTimes ?? null,
          timeMap: coupling?.timeMap ?? runDone?.timeMap ?? null,
          displayDuration: coupling?.displayDuration ?? runDone?.displayDuration ?? null,
          promptHash,
          knowledgecardHash,
        },
        /** v1.1.18：读题判定 / 卡片命中 / 拆图 / 步骤耦合，全部留在同一份 record 里 */
        judgement,
        knowledgecard,
        diagram,
        coupling,
        solution,
        errors,
      };
    },
  };
}

/* ────────────────────────── HTML 渲染 ────────────────────────── */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const fmtMs = (ms) => {
  const n = Number(ms ?? 0) || 0;
  return n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`;
};

const badge = (text, kind = 'slate') => `<span class="badge ${kind}">${esc(text)}</span>`;

const STATUS_TEXT = { pass: '通过', warn: '告警', fail: '失败', skipped: '跳过', unknown: '未知' };
const STATUS_KIND = { pass: 'green', warn: 'amber', fail: 'red', skipped: 'slate', unknown: 'slate' };
const VERDICT_TEXT = {
  pass: '通过（可以交付）',
  'pass-with-warnings': '带告警交付',
  fail: '被门禁拦住',
  cancelled: '已取消',
  error: '出错了',
};

/** 一段长文本：折叠 + `<pre>` 保形（代码与公式都不能被 HTML 吃掉空白） */
function block(title, text, { open = false, mono = true, meta = '' } = {}) {
  const body = String(text ?? '');
  if (!body.trim()) return '';
  return `<details class="block"${open ? ' open' : ''}>
  <summary>${esc(title)}${meta ? ` <span class="muted">· ${esc(meta)}</span>` : ''}</summary>
  <pre class="${mono ? 'mono' : ''}">${esc(body)}</pre>
</details>`;
}

function messageBlock(m) {
  const role = m?.role ?? 'unknown';
  if (typeof m?.content === 'string') {
    return block(`${role}`, m.content, { mono: false, meta: `${m.content.length} 字` });
  }
  if (Array.isArray(m?.content)) {
    const texts = m.content.filter((p) => p && p.type !== 'image').map((p) => String(p.text ?? '')).join('\n');
    const imgs = m.content.filter((p) => p && p.type === 'image');
    const imgNote = imgs.length ? `\n\n[图片 ${imgs.length} 张已省略：${imgs.map((i) => i.note ?? '').join('；')}]` : '';
    return block(`${role}`, `${texts}${imgNote}`, { mono: false, meta: `${texts.length} 字` });
  }
  return '';
}

/**
 * 把 record 渲染成**单文件 HTML**（无脚本、无外链）。
 *
 * 为什么不用 `<script>` 做折叠/高亮：这份文件会被用户用各种方式打开
 * （邮件附件、网盘预览、记事本），任何脚本都可能被拦；纯 `<details>` 永远能用。
 */
export function renderHtml(record) {
  const r = record?.run ?? {};
  const g = record?.gates ?? {};
  const verdict = r.verdict ?? 'unknown';
  const blocked = Array.isArray(g.blockedBy) ? g.blockedBy : [];
  const failed = Array.isArray(g.failed) ? g.failed : [];
  const warnings = failed.filter((c) => !c.blocking && c.status === 'fail');
  const rounds = Array.isArray(g.rounds) ? g.rounds : [];
  const dialogue = Array.isArray(record?.dialogue) ? record.dialogue : [];
  const slots = record?.animation?.slots ?? {};
  const solution = record?.solution ?? {};
  const errors = Array.isArray(record?.errors) ? record.errors : [];

  const verdictKind = verdict === 'pass' ? 'green' : verdict === 'pass-with-warnings' ? 'amber' : verdict === 'fail' ? 'red' : 'slate';

  const gateTable = (checks) => {
    if (!checks?.length) return '<p class="muted">这一轮没有检查结果。</p>';
    const rows = checks
      .map((c) => {
        const bad = c.status === 'fail';
        return `<tr class="${bad ? (c.blocking ? 'row-bad' : 'row-warn') : ''}">
  <td class="nowrap"><strong>${esc(c.id)}</strong></td>
  <td>${esc(STATUS_TEXT[c.status] ?? c.status)}${c.blocking && bad ? badge('拦住交付', 'red') : c.blocking ? '' : badge('仅告警', 'slate')}</td>
  <td>${esc(c.name ?? '')}</td>
  <td>${esc(c.detail ?? '')}${
    c.offenders?.length
      ? `<details class="inner"><summary>抓到的具体条目（${c.offenders.length}）</summary><pre class="mono">${esc(
          JSON.stringify(c.offenders, null, 2),
        )}</pre></details>`
      : ''
  }${
    c.diagnostics?.length
      ? `<details class="inner"><summary>诊断（${c.diagnostics.length}）</summary><pre class="mono">${esc(
          JSON.stringify(c.diagnostics, null, 2),
        )}</pre></details>`
      : ''
  }</td>
</tr>`;
      })
      .join('\n');
    return `<table class="gates"><thead><tr><th>检查号</th><th>结论</th><th>管什么</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  const conclusion = blocked.length
    ? `<p class="lead bad">被 <strong>${blocked.map((b) => esc(b.id)).join(' / ')}</strong> 拦住，动画没能按"通过"交付。</p>
       <ul class="tight">${blocked.map((b) => `<li><strong>${esc(b.id)}</strong> · ${esc(b.name ?? '')}：${esc(b.detail ?? '')}</li>`).join('')}</ul>`
    : verdict === 'pass' || verdict === 'pass-with-warnings'
      ? `<p class="lead ok">没有门禁拦住交付${warnings.length ? `（有 ${warnings.length} 条告警）` : ''}。</p>`
      : verdict === 'cancelled'
        ? '<p class="lead">这次运行被取消了，门禁没有跑完。</p>'
        : verdict === 'error'
          ? '<p class="lead bad">运行中途出错，没走到门禁。</p>'
          : '<p class="lead muted">没有拿到门禁结论（可能很早就中断了）。</p>';

  const dialogueHtml = dialogue.length
    ? dialogue
        .map((d) => {
          const head = `#${d.index} · ${d.stage}${d.round != null ? ` · 第 ${d.round} 轮修复` : ''} · ${fmtMs(d.ms)}`;
          const msgs = (d.messages ?? []).map(messageBlock).join('\n');
          const out = d.error
            ? `<p class="bad">模型调用失败：${esc(d.error.kind)} · ${esc(d.error.message)}</p>`
            : block('模型输出', d.output ?? '', { open: true, meta: `${String(d.output ?? '').length} 字` });
          return `<section class="turn"><h3>${esc(head)}</h3>${msgs}${out}</section>`;
        })
        .join('\n')
    : '<p class="muted">没有记录到模型调用（可能一步都没跑起来，或走的是演示源）。</p>';

  const slotNames = ['PROBLEM', 'STEPS', 'ANSWERS', 'VIEW', 'setup', 'stateAt', 'drawFrame', 'readouts'];
  const order = [...new Set([...slotNames.filter((s) => s in slots), ...Object.keys(slots)])];
  const codeHtml = order.length
    ? order
        .map((k) => block(`${k}.js`, slots[k] ?? '', { meta: `${String(slots[k] ?? '').length} 字` }))
        .join('\n')
    : `<p class="muted">没有动画代码（门禁/切分之前就中断了，或这次没走到 <code>scene_code</code>）。</p>`;

  const solutionHtml = Object.keys(solution).length
    ? Object.entries(solution)
        .map(([k, v]) => block(k, v, { open: k === 'solve' || k === 'steps', mono: false, meta: `${String(v ?? '').length} 字` }))
        .join('\n')
    : '<p class="muted">没有解题过程文字。</p>';

  const roundsHtml = rounds.length
    ? rounds
        .map(
          (rd) =>
            `<section class="round"><h3>${rd.round == null ? '首次校验' : `第 ${rd.round} 轮（修复后）`} · ${esc(
              VERDICT_TEXT[rd.verdict] ?? rd.verdict ?? '?',
            )}</h3>${gateTable(rd.checks)}${
              rd.gatesBypassed?.length ? `<p class="muted">开发模式放行：${esc(rd.gatesBypassed.join(' / '))}</p>` : ''
            }</section>`,
        )
        .join('\n')
    : '<p class="muted">没有门禁结果。</p>';

  const errorsHtml = errors.length
    ? `<ul class="tight">${errors
        .map((e) => `<li><strong>${esc(e.stage ?? '运行')}</strong> · ${esc(e.kind)}：${esc(e.message)}${e.hint ? `<br><span class="muted">→ ${esc(e.hint)}</span>` : ''}</li>`)
        .join('')}</ul>`
    : '<p class="muted">没有阶段级错误。</p>';

  /* ── v1.1.18：判定 / 知识卡 / 耦合 / 拆图 / 时间线 / 图片 ── */
  const judgement = record?.judgement ?? null;
  const knowledgecard = record?.knowledgecard ?? null;
  const coupling = record?.coupling ?? null;
  const diagram = record?.diagram ?? null;
  const timeline = Array.isArray(r.timeline) ? r.timeline : [];
  const images = Array.isArray(r.problem?.images) ? r.problem.images : [];
  const referenceImages = Array.isArray(r.reference?.images) ? r.reference.images : [];

  const jsonBlock = (title, value, open = false) =>
    value == null ? '' : block(title, JSON.stringify(value, null, 2), { open, meta: `${JSON.stringify(value).length} 字符` });

  const judgementHtml = jsonBlock('读题判定（元件 / 场景 / 表外词 / 判定依据）', judgement, false);
  const knowledgecardHtml = knowledgecard
    ? `<p class="muted">命中 ${esc(String(knowledgecard.matched ?? '—'))} 条；动画槽注入 ${
        knowledgecard.injectedBySlot?.scene_code ?? '—'
      } 条，${knowledgecard.charsBySlot?.scene_code ?? '—'} 字符。</p>
       ${knowledgecard.entries?.length ? `<ul class="tight">${knowledgecard.entries
         .map((e) => `<li><strong>${esc(e.title ?? e.entry_id ?? '')}</strong> <span class="muted">via ${esc(e.via ?? '')} · ${esc(
           String(e.charsBySlot?.scene_code ?? ''),
         )} 字符</span></li>`)
         .join('')}</ul>` : ''}
       ${jsonBlock('知识卡完整证据（含空槽/截断/表外词）', knowledgecard, false)}`
    : '';
  const couplingHtml = jsonBlock('步骤耦合（物理秒 / 显示秒 / timeMap）', coupling, false);
  const diagramHtml = jsonBlock('示意图拆图结果', diagram, false);

  const timelineHtml = timeline.length
    ? `<table class="gates"><thead><tr><th>到达时间</th><th>阶段</th><th>动作</th><th>轮次</th><th>耗时</th><th>说明</th></tr></thead><tbody>${timeline
        .map(
          (t) =>
            `<tr><td class="nowrap">${esc(fmtTime(t.at))}</td><td>${esc(t.stage ?? '')}</td><td>${esc(t.phase ?? '')}</td><td>${
              t.round == null ? '—' : esc(String(t.round))
            }</td><td>${t.ms == null ? '—' : esc(fmtMs(t.ms))}</td><td>${esc(t.reason ?? t.message ?? '')}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="muted">没有阶段时间线。</p>';

  const imageHtml = (list, title) =>
    list.length
      ? `<h3>${esc(title)}（${list.length} 张，已内嵌）</h3>${list
          .map(
            (img) =>
              `<figure style="margin:12px 0"><img src="${esc(img.dataUrl)}" alt="${esc(img.name ?? '')}" style="max-width:100%;border:1px solid #e2e8f0;border-radius:8px"><figcaption class="muted">${esc(
                img.name ?? '',
              )} · ${esc(img.mime ?? '')} · ${esc(String(img.bytes ?? ''))} 字节</figcaption></figure>`,
          )
          .join('')}`
      : '';

  const imagesHtml = `${imageHtml(images, '题目图片')}${imageHtml(referenceImages, '参考答案 / 解析图片')}`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>物理解题动画 · 运行日志 ${esc(r.runId ?? '')}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 20px 64px; font: 14px/1.7 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #0f172a; background: #f8fafc; }
  .wrap { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 36px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0; }
  h3 { font-size: 14px; margin: 18px 0 8px; color: #334155; }
  .head { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 8px; color: #475569; font-size: 13px; }
  .badge { display: inline-block; padding: 1px 8px; margin-left: 6px; border-radius: 999px; font-size: 12px; line-height: 1.6; background: #f1f5f9; color: #334155; }
  .badge.green { background: #dcfce7; color: #166534; }
  .badge.amber { background: #fef3c7; color: #92400e; }
  .badge.red { background: #fee2e2; color: #991b1b; }
  .badge.slate { background: #f1f5f9; color: #475569; }
  .lead { font-size: 15px; margin: 14px 0 6px; }
  .lead.ok { color: #166534; } .lead.bad { color: #991b1b; }
  .muted { color: #64748b; font-size: 13px; } .bad { color: #991b1b; } .ok { color: #166534; }
  ul.tight { margin: 6px 0; padding-left: 22px; } ul.tight li { margin: 3px 0; }
  table.gates { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; font-size: 13px; }
  table.gates th, table.gates td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid #eef2f7; }
  table.gates th { background: #f8fafc; font-weight: 600; color: #475569; }
  table.gates tr.row-bad td { background: #fff5f5; }
  table.gates tr.row-warn td { background: #fffbeb; }
  .nowrap { white-space: nowrap; }
  details.block { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; margin: 8px 0; }
  details.block > summary { cursor: pointer; color: #334155; font-weight: 500; }
  details.inner { margin-top: 6px; }
  details.inner > summary { cursor: pointer; color: #475569; font-size: 12px; }
  pre { margin: 8px 0 4px; padding: 10px 12px; background: #0f172a; color: #e2e8f0; border-radius: 6px; overflow: auto; max-height: 420px; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  pre.mono { font-family: "Cascadia Mono", Consolas, "Courier New", monospace; }
  section.turn { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; margin: 10px 0; }
  footer { margin-top: 40px; color: #94a3b8; font-size: 12px; }
  @media print { body { background: #fff; padding: 0; } details { display: block; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <h1>物理解题动画 · 运行日志 ${badge(`v${esc(record?.appVersion ?? '?')}`, 'slate')}</h1>
    <div class="meta">
      <span>运行号：<code>${esc(r.runId ?? '—')}</code></span>
      <span>开始：${esc(fmtTime(r.startedAt))}</span>
      <span>耗时：${esc(fmtMs(r.ms))}</span>
      <span>模型：${esc(r.model ?? '—')}</span>
      <span>端点：${esc(r.endpoint ?? '—')}</span>
      ${r.promptHash ? `<span>prompt：<code>${esc(String(r.promptHash).slice(0, 12))}…</code></span>` : ''}
      ${r.knowledgecardHash ? `<span>知识卡：<code>${esc(String(r.knowledgecardHash).slice(0, 12))}…</code></span>` : ''}
      ${r.devMode ? badge('开发模式（不拦截）', 'amber') : ''}
      ${r.cancelled ? badge('已取消', 'slate') : ''}
    </div>
    <p class="lead">结论：<strong>${esc(VERDICT_TEXT[verdict] ?? verdict)}</strong></p>
    ${conclusion}
    ${
      r.banner
        ? `<p class="bad">告警横幅：${esc(r.banner.title ?? '')}${r.banner.message ? ` · ${esc(r.banner.message)}` : ''}</p>`
        : ''
    }
  </div>

  <h2>① 题目</h2>
  ${
    String(r.problem?.text ?? '').trim()
      ? `<pre class="mono">${esc(r.problem.text)}</pre>`
      : '<p class="muted">题面是空的（纯图片题：转写结果见「解题过程」里的 read_problem）。</p>'
  }
  ${r.problem?.imageCount ? `<p class="muted">本次带了 ${esc(String(r.problem.imageCount))} 张图（已内嵌在本日志末尾「图片」一节）。</p>` : ''}
  ${errorsHtml && errors.length ? `<h3>运行错误</h3>${errorsHtml}` : ''}

  <h2>② 门禁（C1–C9）</h2>
  <p class="muted">每条检查的"结论"与"说明"都是校验内核的原话；<strong>拦住交付</strong>的那些就是这次卡住动画的原因。</p>
  ${roundsHtml}

  <h2>③ 用户与大模型的对话</h2>
  <p class="muted">按阶段列出：发给模型的完整消息（含系统提示词）+ 模型返回的全文。对话里的图片仍只记张数与长度；原始图片见末尾。</p>
  ${dialogueHtml}

  <h2>③-2 读题判定 / 知识卡 / 拆图 / 步骤耦合</h2>
  <p class="muted">这些是 v1.1.18 新增的排障证据：模型判了什么、抽了哪几张卡、拆图成功没有、步骤怎么对到时间。</p>
  ${judgementHtml}
  ${knowledgecardHtml}
  ${diagramHtml}
  ${couplingHtml}

  <h2>④ 动画代码（8 个槽位）</h2>
  ${codeHtml}

  <h2>④-2 阶段时间线（start / done / error / skipped）</h2>
  ${timelineHtml}

  <h2>⑤ 解题过程</h2>
  ${solutionHtml}

  ${imagesHtml ? `<h2>⑥ 图片（内嵌）</h2>${imagesHtml}` : ''}

  <footer>
    由「物理解题动画 v${esc(record?.appVersion ?? '?')}」自动导出 · ${esc(fmtTime(record?.exportedAt))}<br>
    同一份数据见同名 <code>.json</code> 文件。日志里不含 API Key，路径已抹去。
  </footer>
</div>
</body>
</html>`;
}

/**
 * 落盘一份日志（HTML + JSON）。
 *
 * **每次都写**，且写完从磁盘读回来查密钥（这套文件是要发给别人的，漏一次就收不回）。
 *
 * @param {object} record `createRunLog().finish()` 的产物
 * @param {{ dir?: string, secrets?: string[]|null, fallbackDir?: string }} [opts]
 * @returns {{ ok: boolean, dir: string, name: string, html: string|null, json: string|null, bytes: number, code?: string, message?: string }}
 */
export function writeOpenLog(record, { dir, secrets = null, fallbackDir = null } = {}) {
  const name = record?.run?.runId ?? makeRunId();
  const known = secrets ?? collectSecrets({ dir: undefined });

  /* 脱敏在**渲染之前**做一次：HTML 与 JSON 必须来自同一份干净数据 */
  const safe = redactValue(record, { secrets: known });

  let json = JSON.stringify(safe, null, 2);
  let html = renderHtml(safe);

  /* 兜底再抹一遍文本（对象脱敏不覆盖"模板里拼进去"的那种字符串，宁可多一道） */
  json = redactText(json, { secrets: known });
  html = redactText(html, { secrets: known });

  const targets = [dir ? resolve(dir) : resolveOpenLogDir(), fallbackDir ? resolve(fallbackDir) : null].filter(Boolean);

  let lastErr = null;
  for (const target of targets) {
    try {
      mkdirSync(target, { recursive: true });
      const htmlPath = join(target, `${name}.html`);
      const jsonPath = join(target, `${name}.json`);
      writeFileSync(htmlPath, html, 'utf8');
      writeFileSync(jsonPath, json, 'utf8');

      /* 写后复核：从磁盘读回来查（不是查内存里的 safe） */
      assertRedacted(readFileSync(htmlPath, 'utf8'), { secrets: known, where: `开源日志 ${name}.html` });
      assertRedacted(readFileSync(jsonPath, 'utf8'), { secrets: known, where: `开源日志 ${name}.json` });

      return {
        ok: true,
        dir: target,
        name,
        html: htmlPath,
        json: jsonPath,
        bytes: Buffer.byteLength(html, 'utf8') + Buffer.byteLength(json, 'utf8'),
      };
    } catch (e) {
      lastErr = e;
      /* 目录只读（装进 Program Files 就会这样）⇒ 换下一个落点，别让整条链路断 */
      if (e?.code !== 'EACCES' && e?.code !== 'EPERM' && e?.code !== 'EROFS') break;
    }
  }

  return {
    ok: false,
    dir: targets[0] ?? resolveOpenLogDir(),
    name,
    html: null,
    json: null,
    bytes: 0,
    code: lastErr?.code ?? 'open-log.write-failed',
    message: String(lastErr?.message ?? lastErr ?? '写入失败'),
  };
}

/** 供测试/排障：目录里有什么 */
export function listOpenLogs({ dir } = {}) {
  const target = resolveOpenLogDir({ dir });
  if (!existsSync(target)) return { ok: true, dir: target, items: [] };
  return { ok: true, dir: target, items: readdirSync(target).filter((n) => /\.(html|json)$/i.test(n)).sort() };
}

/** 记录内容指纹（用于"同一道题两次跑结果一样吗"这类判断；不参与导出） */
export function fingerprint(record) {
  return createHash('sha256').update(JSON.stringify(record ?? null), 'utf8').digest('hex').slice(0, 16);
}

export const __testing = { sanitizeMessages, trimCheck, solutionStages: SOLUTION_STAGES, obsFallback: resolveObsDir };
