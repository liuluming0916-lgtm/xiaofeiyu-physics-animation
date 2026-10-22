/**
 * 导出网页（M17）· 服务端实现
 *
 * 方案定案（§14 / §13.1）：**导出网页 = 模板页另存**。
 * 所以这里不复刻一份页面，而是直接调用**构建期同一个打包器** `buildQuestionHtml()` ——
 * 屏幕上看到的与导出的必须是同一份字节，只有这样"导出 = 另存为"才不是一句口号。
 *
 * 三件必须在导出时补上的东西：
 *   ① **Provenance 烧录**（§14）：模板版本 / SDK 版本 / 模型 / promptHash / knowledgecardHash
 *      —— 由调用方（编排器那一侧）把真实的哈希传进来，缺了就写"未记录"，绝不编造；
 *   ② **公式预渲染**：现成的 15 道题有 `template/vendor/tex-svg/<id>.json`，
 *      生成出来的题目没有，所以这里用 mathjax-full 现场渲染（与构建期同一套口径）；
 *   ③ **默认态**：导出文件里没有 localStorage，模板本来就落回默认态
 *      （两栏全显示 / 动画联动开 / 停在原题），这一点不需要额外做事，但要在文档里写明。
 *
 * 落盘边界（§16 / §11.2）：只写本机 `exports/`，不联网、不上传、不写 `ai-rules/`。
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SLOT_KEY_NAMES, SDK_VERSION, TEMPLATE_VERSION } from '../../contracts/spec/frozen-keys.mjs';
import { buildQuestionHtml, toClassicScript } from '../../template/build-template.mjs';
import { VECTOR_TARGET_PX } from '../../sdk/runtime/animation-runtime.mjs';
import { createTexRenderer, extractInlineTex } from '../../tools/tex-render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(HERE, '..', '..');
/**
 * 导出产物目录。默认 `<项目>/exports`；`OD_EXPORT_DIR` 可重定向
 * —— 门禁 ㉛ 用它指到临时目录，免得自检把测试文件堆进用户的产物目录。
 */
export const EXPORT_DIR = process.env.OD_EXPORT_DIR
  ? resolve(process.env.OD_EXPORT_DIR)
  : join(PROJECT_ROOT, 'exports');

const TEMPLATE_PATH = join(PROJECT_ROOT, 'template', 'animation-template.html');
const TEX_PATH = join(PROJECT_ROOT, 'template', 'tex-inline-renderer.js');
const RUNTIME_PATH = join(PROJECT_ROOT, 'sdk', 'runtime', 'animation-runtime.mjs');

/** 单文件页上限：超过就当异常（正常一页 200–300 KB） */
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

function readContractHash() {
  try {
    const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, 'contracts', 'manifest.json'), 'utf8'));
    return manifest.contractHash ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Provenance 里哈希的显示口径。
 * 64 位十六进制 ⇒ 截前 12 位（可读且够区分）；其它字符串（如演示源的 `handwritten`）
 * 原样显示；没有 ⇒ 写"未记录"。
 * ⚠ 宁可写"未记录"，也不编一个看起来像真的哈希 —— 溯源的全部价值就在于它不撒谎。
 */
function short(hash) {
  if (!hash || typeof hash !== 'string') return '未记录';
  return /^[0-9a-f]{64}$/i.test(hash) ? hash.slice(0, 12) : hash;
}

/** 从槽位里收集要预渲染的公式：PROBLEM 的 `$…$` + STEPS 的 `tex:` 行 */
export function collectTex(slots) {
  const set = new Set();
  for (const tex of extractInlineTex(slots.PROBLEM || '')) set.add(tex);
  const stepRe = /^tex:\s*(.+)$/gm;
  let m;
  while ((m = stepRe.exec(slots.STEPS || ''))) set.add(m[1].trim());
  return [...set];
}

/**
 * 生成公式资产（与 `template/vendor/tex-svg/<id>.json` 同形状）。
 * ⚠ `renderAll` 返回的 formulas 带着 `<defs>`（每页字形内联），成品页的约定是
 *   **defs 抽出去、正文留下**；不剥离的话每个公式都会背一份字形表，页面成倍变胖。
 */
export async function buildTexAssets(texList) {
  const { renderAll } = await createTexRenderer();
  const raw = renderAll(texList);
  const formulas = {};
  for (const [tex, markup] of Object.entries(raw.formulas)) {
    formulas[tex] = markup.replace(/<defs>[\s\S]*?<\/defs>/, '');
  }
  return { renderer: raw.renderer, glyphs: raw.glyphs, formulas };
}

function assertSlots(slots) {
  if (!slots || typeof slots !== 'object') return '缺少 slots';
  const missing = SLOT_KEY_NAMES.filter((k) => typeof slots[k] !== 'string' || slots[k].length === 0);
  if (missing.length) return `槽位缺失或为空：${missing.join('、')}（§3.2 要求 8 个都非空）`;
  const extra = Object.keys(slots).filter((k) => !SLOT_KEY_NAMES.includes(k));
  if (extra.length) return `出现了未登记的槽位：${extra.join('、')}（未登记即拒）`;
  return null;
}

/** 文件名安全化：只留字母数字与连字符 */
function safeName(input, fallback) {
  const cleaned = String(input ?? '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned || fallback;
}

/**
 * 时间戳后缀（到毫秒）。
 * ⚠ 只到"秒"的话，同一秒里导出两次会**同名覆盖**（门禁里"清单随导出增长"那条踩过）：
 *   用户点两下就悄悄少一份产物，比报错更难发现。
 */
function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
  );
}

/**
 * 造一个"导出页"的 HTML（纯函数，不落盘）。
 * @param {object} input
 * @param {Record<string,string>} input.slots 8 个冻结槽位
 * @param {string} [input.id] 题目 id（决定文件名与 Provenance 尾项）
 * @param {number} [input.index]
 * @param {string} [input.title]
 * @param {string} [input.examPoint]
 * @param {string} [input.mode] NUMERIC / SYMBOLIC
 * @param {string} [input.model] 生成这题用的模型 id（Provenance 必需项）
 * @param {string} [input.promptHash]
 * @param {string} [input.knowledgecardHash]
 */
export async function buildExportPage(input = {}) {
  const problem = assertSlots(input.slots);
  if (problem) return { ok: false, code: 'export.bad-slots', message: problem };

  const program = {
    id: safeName(input.id, 'export'),
    index: Number.isFinite(input.index) ? input.index : 0,
    title: String(input.title || '导出的动画'),
    examPoint: String(input.examPoint || ''),
    mode: 'BOTH',   // 第 8 期：数值/符号按条目走，这里只留标签（读旧产物时仍认 NUMERIC/SYMBOLIC）
    slots: Object.fromEntries(SLOT_KEY_NAMES.map((k) => [k, input.slots[k]])),
  };

  let texSvg;
  try {
    texSvg = await buildTexAssets(collectTex(program.slots));
  } catch (err) {
    // 公式渲染失败不该让导出整个失败：退回内联 ODTex 兜底（模板本身有三级降级链）
    texSvg = { renderer: null, glyphs: '', formulas: {} };
    void err;
  }

  const provenance = [
    `模板 v${TEMPLATE_VERSION}`,
    `SDK v${SDK_VERSION}`,
    /**
     * 第 8 期：把「矢量满量程」写进溯源行。
     *
     * 为什么：排查"我改了但页面没变"时，光看文件时间没用 —— 得让**页面自己**
     * 报出它用的是哪套参数。这一行会显示在页头，肉眼可读。
     */
    `矢量 ${VECTOR_TARGET_PX.force}/${VECTOR_TARGET_PX.velocity}/${VECTOR_TARGET_PX.acceleration}`,
    `model: ${input.model || '未记录'}`,
    `prompt: ${short(input.promptHash)}`,
    `knowledgecard: ${short(input.knowledgecardHash)}`,
    texSvg.renderer ? `math: ${texSvg.renderer}` : 'math: odtex-fallback',
    /**
     * ── 第 8 期：**开发模式（不拦截）必须烧进溯源**（用户裁决）──
     *
     * 用户要的是"别拦我"，但导出文件一旦离开这台机器，就没人知道它没验过。
     * 所以这一行写进 Provenance：凡是被放行的检查，都留在产物上，删不掉、也藏不住。
     * 没走开发模式时不写这一项（Provenance 形状对老产物保持不变）。
     */
    ...(input.advisory === true
      ? [`gates: 开发模式放行 ${Array.isArray(input.gatesBypassed) && input.gatesBypassed.length ? input.gatesBypassed.join('/') : '（无失败项）'}`]
      : []),
    `contract: ${readContractHash().slice(0, 12)}`,
    program.id,
  ].join(' · ');

  const templateText = readFileSync(TEMPLATE_PATH, 'utf8');
  const runtimeText = toClassicScript(readFileSync(RUNTIME_PATH, 'utf8'));
  const texText = readFileSync(TEX_PATH, 'utf8');

  let html;
  try {
    html = buildQuestionHtml(program, templateText, runtimeText, texText, provenance, {
    texSvg,
    /**
     * 第 8 期（C2）：把标注避让表**烧进导出页**。
     * 这样导出的网页在别人电脑上双击打开时，字也让位、也有引线 ——
     * 而不是"在软件里好看、导出来又挤成一团"。
     * 没给表时（旧调用方）行为与第 7 期完全一致。
     */
    labelAvoid: input.labelAvoid && typeof input.labelAvoid === 'object' ? input.labelAvoid : null,
    /* v6：步骤时间一起烧进导出页，联动不依赖宿主 */
    stepTimes: Array.isArray(input.stepTimes) ? input.stepTimes : null,
  });
  } catch (err) {
    return { ok: false, code: 'export.build-failed', message: String(err?.message ?? err) };
  }

  /* 自包含与"Key 不出门"是硬要求，导出前就地验一遍（不指望调用方记得检查） */
  if (/(?:src|href)\s*=\s*["']https?:\/\//i.test(html.replace(/xmlns(:\w+)?="[^"]*"/g, ''))) {
    return { ok: false, code: 'export.external-ref', message: '导出页里出现了外部资源引用（必须完全自包含）' };
  }
  if (/apiKey|"keys"\s*:/.test(html)) {
    return { ok: false, code: 'export.leaked-key', message: '导出页里出现了 Key 相关字样（绝不外泄）' };
  }
  if (Buffer.byteLength(html) > MAX_PAGE_BYTES) {
    return { ok: false, code: 'export.too-big', message: `单文件页超过 ${MAX_PAGE_BYTES} 字节` };
  }

  return {
    ok: true,
    html,
    bytes: Buffer.byteLength(html),
    formulas: Object.keys(texSvg.formulas).length,
    renderer: texSvg.renderer,
    provenance,
    id: program.id,
  };
}

/** 导出网页并落盘；返回可直接给前端用的下载信息 */
export async function exportPageToDisk(input = {}) {
  const built = await buildExportPage(input);
  if (!built.ok) return built;
  mkdirSync(EXPORT_DIR, { recursive: true });
  const name = `${built.id}-${stamp()}.html`;
  const file = join(EXPORT_DIR, name);
  writeFileSync(file, built.html, 'utf8');
  return {
    ok: true,
    file,
    name,
    bytes: built.bytes,
    formulas: built.formulas,
    renderer: built.renderer,
    provenance: built.provenance,
    url: `/exports/${name}`,
  };
}

/** 二进制产物（GIF / 视频）落盘 */
export function saveExportBinary(name, buffer) {
  if (!buffer || !buffer.length) return { ok: false, code: 'export.empty', message: '产物为空' };
  if (buffer.length > 64 * 1024 * 1024) return { ok: false, code: 'export.too-big', message: '产物超过 64 MB' };
  mkdirSync(EXPORT_DIR, { recursive: true });
  const safe = `${safeName(name, 'export')}-${stamp()}${/\.gif$/i.test(name) ? '.gif' : '.bin'}`;
  const file = join(EXPORT_DIR, safe);
  writeFileSync(file, buffer);
  return { ok: true, file, name: safe, bytes: buffer.length, url: `/exports/${safe}` };
}

/** 已导出产物清单（新在前） */
export function listExports() {
  try {
    return readdirSync(EXPORT_DIR)
      .filter((f) => !f.startsWith('.'))
      .map((name) => {
        const st = statSync(join(EXPORT_DIR, name));
        return { name, bytes: st.size, mtime: st.mtimeMs, url: `/exports/${name}` };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}
