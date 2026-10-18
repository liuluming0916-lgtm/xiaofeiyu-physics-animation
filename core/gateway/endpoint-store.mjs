/**
 * 端点配置的**存储层**（第 6 期第 4 项 · §11 / §16）。
 *
 * ── 用户裁决（2026-10）：Key 单独存
 *
 *   `ai-rules/endpoints.json`  —— 端点、分阶段模型、**永远 `keys: {}`**
 *   `ai-rules/keys.json`       —— 端点 id → 明文 Key，**永不进入可导出的那份配置**
 *
 * 为什么不是"存在一起、导出时过滤"：过滤是**一次性的动作**，漏一次就泄露；
 * 而"Key 从来不在可导出文件里"是**结构性的**——导出函数根本不读它。
 * §16 原文要求"配置文件导出不含任何 Key"，这里把它做成"不可能有"而不是"记得去掉"。
 *
 * ── 但契约仍然要求 `keys` 字段
 *
 * `contracts/endpoint.schema.json` 的 `required` 里有 `keys`（第 3 期定稿，跨字段判据也要用它）。
 * 因此：**内存里**的配置对象是合并后的完整形态（含 keys），**磁盘上**的 endpoints.json 恒为 `keys: {}`；
 * 载入时合并、保存时清空。判据（`validateEndpointConfig`）只在合并后的形态上跑，避免两套字段口径。
 *
 * ── 孤儿 Key 的处理（刻意选择"降级 + 报警"，而不是"整份载入失败"）
 *
 * 若 keys.json 里有某个端点的 Key、但 endpoints.json 里没有这个端点（手改、或删除端点时没清 Key），
 * 载入会**丢弃**它并给出一条 `keys.orphan-dropped` 警告，而不是让整份配置载入失败。
 * 理由：孤儿 Key 是**不可达**的（没有端点用它），它不会静默改变任何行为；
 * 而"因为一条用不上的旧 Key 导致整个软件打不开"是更坏的失败方式。
 * 注意这与"世界书整批失败"的口径不冲突——那里半载入会改变命中结果，这里不会。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { chmodSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { PROJECT_ROOT } from '../../tools/paths.mjs';
import { validateEndpointConfig, ENDPOINT_CONFIG_VERSION, formatIssues } from '../../contracts/validate.mjs';
import { PIPELINE_STAGES } from '../../contracts/spec/frozen-keys.mjs';
import { describeJsonError } from '../json-error.mjs';
import { sha256Hex, writeFileAtomic } from '../rules/index.mjs';
import { backupFile } from '../rules/backup.mjs';

/** 用户可写的端点配置（`ai-rules/` 是升级不会动的用户区） */
export const ENDPOINTS_FILE = join(PROJECT_ROOT, 'ai-rules', 'endpoints.json');
/** Key 的独立存放点：**永不导出、永不进日志** */
export const KEYS_FILE = join(PROJECT_ROOT, 'ai-rules', 'keys.json');

export const KEYS_FORMAT = 'od-endpoint-keys';
export const KEYS_VERSION = 1;

const err = (code, path, message, hint) => ({ code, path, message, ...(hint ? { hint } : {}) });

const pathsOf = (dir) =>
  dir ? { endpoints: join(dir, 'endpoints.json'), keys: join(dir, 'keys.json') } : { endpoints: ENDPOINTS_FILE, keys: KEYS_FILE };

/** 读文件（不存在 → null） */
function readText(abs) {
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8');
}

/**
 * 读 Key 文件。
 *
 * @returns {{ ok: boolean, keys: Record<string,string>, issues: object[], exists: boolean, hash: string|null }}
 */
export function loadKeys({ dir } = {}) {
  const { keys: abs } = pathsOf(dir);
  const text = readText(abs);
  if (text === null) return { ok: true, keys: {}, issues: [], exists: false, hash: null };

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const d = describeJsonError(text, e);
    return {
      ok: false,
      keys: {},
      exists: true,
      hash: sha256Hex(text),
      issues: [err('keys.bad-json', 'keys.json', d.message, `${d.hint ?? ''}Key 文件坏掉时不会回退到"没有 Key"——那会让你以为配置丢了`.trim())],
    };
  }

  const issues = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    issues.push(err('keys.not-object', 'keys.json', 'Key 文件必须是一个 JSON 对象'));
  } else if (parsed.format !== undefined && parsed.format !== KEYS_FORMAT) {
    issues.push(err('keys.bad-format', 'keys.json:format', `format 必须是 "${KEYS_FORMAT}"`));
  } else if (parsed.version !== undefined && parsed.version !== KEYS_VERSION) {
    issues.push(err('keys.bad-version', 'keys.json:version', `不支持的 Key 文件版本 ${JSON.stringify(parsed.version)}`));
  }

  const raw = parsed?.keys;
  const keys = {};
  if (raw !== undefined) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push(err('keys.keys.not-object', 'keys.json:keys', 'keys 必须是对象（端点 id → Key 字符串）'));
    } else {
      for (const [id, v] of Object.entries(raw)) {
        if (typeof v !== 'string') {
          issues.push(err('keys.value.not-string', `keys.json:keys.${id}`, 'Key 必须是字符串'));
          continue;
        }
        if (v.length > 0) keys[id] = v;
      }
    }
  }

  return { ok: issues.length === 0, keys, issues, exists: true, hash: sha256Hex(text) };
}

/**
 * 载入端点配置（合并 keys 之后校验）。
 *
 * @param {{ dir?: string }} [opts]
 * @returns {{
 *   ok: boolean, issues: object[], warnings: object[],
 *   config: object|null, endpoints: Map<string,object>, stageModels: Record<string,string|null>,
 *   keys: Record<string,string>, hashes: { endpoints: string, keys: string|null },
 *   files: { endpoints: string, keys: string },
 * }}
 */
export function loadEndpointStore({ dir } = {}) {
  const files = pathsOf(dir);
  const warnings = [];
  const empty = { ok: false, issues: [], warnings, config: null, endpoints: new Map(), stageModels: {}, keys: {}, hashes: { endpoints: null, keys: null }, files };

  const text = readText(files.endpoints);
  if (text === null) {
    return {
      ...empty,
      issues: [
        err(
          'endpoints.missing',
          'endpoints.json',
          '还没有端点配置',
          `用 \`node core/rules/cli.mjs endpoints init\` 建立一个，或在设置页添加（文件位置：${files.endpoints}）`,
        ),
      ],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const d = describeJsonError(text, e);
    return { ...empty, issues: [err('endpoints.bad-json', 'endpoints.json', d.message, d.hint)] };
  }

  const keyFile = loadKeys({ dir });
  if (!keyFile.ok) return { ...empty, issues: keyFile.issues };

  const endpointList = Array.isArray(parsed?.endpoints) ? parsed.endpoints : [];
  const known = new Set(endpointList.map((e) => e?.id).filter(Boolean));

  // 孤儿 Key：丢弃 + 报警（见文件头"刻意选择降级"）
  const keys = {};
  for (const [id, v] of Object.entries(keyFile.keys)) {
    if (known.has(id)) keys[id] = v;
    else {
      warnings.push({
        code: 'keys.orphan-dropped',
        path: `keys.json:keys.${id}`,
        message: `有一个端点 "${id}" 的 Key，但配置里没有这个端点 —— 已忽略（不会用于任何请求）`,
        hint: '在界面上删掉这个端点时会自动清 Key；如果是手改留下的，删掉这一条即可',
      });
    }
  }

  /**
   * ⚠ 磁盘上的 endpoints.json 里若带着 keys（旧版本/手写），**以 keys.json 为准**并报警。
   *   不静默丢弃：用户会以为"我明明填了 Key"。
   */
  if (parsed?.keys && typeof parsed.keys === 'object' && Object.keys(parsed.keys).length > 0) {
    warnings.push({
      code: 'endpoints.keys-in-endpoints-file',
      path: 'endpoints.json:keys',
      message: '端点文件里也带着 Key —— 已忽略，改用 keys.json',
      hint: '把 Key 挪到 keys.json（或用设置页重新填），否则它会被下次保存清掉',
    });
  }

  const config = {
    configVersion: parsed?.configVersion ?? ENDPOINT_CONFIG_VERSION,
    endpoints: endpointList,
    stageModels: parsed?.stageModels ?? {},
    keys,
  };

  const { ok, issues } = validateEndpointConfig(config, { rawText: text });
  if (!ok) return { ...empty, warnings, issues };

  return {
    ok: true,
    issues: [],
    warnings,
    config,
    endpoints: new Map(endpointList.map((ep) => [ep.id, ep])),
    stageModels: { ...config.stageModels },
    keys: { ...keys },
    hashes: { endpoints: sha256Hex(text), keys: keyFile.hash },
    files,
  };
}

/** 把校验结果渲染成人话（CLI 复用；与 `formatIssues` 同一格式） */
export function formatEndpointIssues(issues) {
  return formatIssues(issues);
}

/** 本文件写盘前的乐观锁：磁盘上的版本必须还是调用方以为的那版 */
function conflictOrNull(files, expectedHash) {
  if (expectedHash === undefined) return null;
  const text = readText(files.endpoints);
  const actual = text === null ? null : sha256Hex(text);
  const expected = expectedHash ?? null;
  if (actual === expected) return null;
  return err(
    'endpoints.conflict',
    'endpoints.json',
    `端点文件已被外部修改（你以为的版本 ${expected ? `${expected.slice(0, 12)}…` : '不存在'}，磁盘上 ${actual ? `${actual.slice(0, 12)}…` : '不存在'}）`,
    '重新载入看一眼再改；确认要覆盖请加 --force',
  );
}

/**
 * 保存端点配置（**不碰 Key**）。
 *
 * 入参是"不含 Key 的部分"：`{ endpoints, stageModels }`。写盘时恒为 `keys: {}`。
 *
 * @param {{ dir?: string, endpoints: object[], stageModels: object, expectedHash?: string|null, force?: boolean }} opts
 * @returns {{ ok: boolean, issues: object[], warnings: object[], hash: string|null, bytes: number }}
 */
export function saveEndpoints({ dir, endpoints, stageModels = {}, expectedHash, force = false }) {
  const files = pathsOf(dir);

  if (!Array.isArray(endpoints)) {
    return { ok: false, issues: [err('endpoints.not-array', 'endpoints', 'endpoints 必须是数组')], warnings: [], hash: null, bytes: 0 };
  }

  if (!force) {
    const c = conflictOrNull(files, expectedHash);
    if (c) return { ok: false, issues: [c], warnings: [], hash: null, bytes: 0 };
  }

  // 校验用"合并了现有 Key"的完整形态：这样 apiKeyModelId / stageModels / 孤儿 Key 的判据都算得上
  const keyFile = loadKeys({ dir });
  if (!keyFile.ok) return { ok: false, issues: keyFile.issues, warnings: [], hash: null, bytes: 0 };

  const known = new Set(endpoints.map((e) => e?.id).filter(Boolean));
  const mergedKeys = {};
  for (const [id, v] of Object.entries(keyFile.keys)) if (known.has(id)) mergedKeys[id] = v;

  const config = { configVersion: ENDPOINT_CONFIG_VERSION, endpoints, stageModels, keys: mergedKeys };
  const { ok, issues } = validateEndpointConfig(config);
  if (!ok) return { ok: false, issues, warnings: [], hash: null, bytes: 0 };

  const payload = { configVersion: ENDPOINT_CONFIG_VERSION, endpoints, stageModels, keys: {} };
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  // 第 6 期第 3 件：写之前留一份（滚动 5 份；keys.json 不在备份范围）
  backupFile({ dir: dirname(files.endpoints), rel: basename(files.endpoints) });
  writeFileAtomic(files.endpoints, text);
  return { ok: true, issues: [], warnings: [], hash: sha256Hex(text), bytes: Buffer.byteLength(text, 'utf8') };
}

/**
 * 保存 Key（只写 keys.json）。
 *
 * @param {{ dir?: string, keys: Record<string,string> }} opts
 */
export function saveKeys({ dir, keys }) {
  const files = pathsOf(dir);
  const payload = { format: KEYS_FORMAT, version: KEYS_VERSION, keys: { ...keys } };
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileAtomic(files.keys, text);

  /**
   * 权限收紧（POSIX 上 0600；Windows 上 chmod 基本无效，失败就算了）。
   * ⚠ 这不是加密：Key 仍是明文（§11.1 的裁决）。它的意义只是"别让同机其它用户顺手读到"。
   */
  try {
    chmodSync(files.keys, 0o600);
  } catch {
    /* Windows / 无权限：忽略 */
  }

  return { ok: true, issues: [], hash: sha256Hex(text), bytes: Buffer.byteLength(text, 'utf8') };
}

/* ────────────────────────────── 端点级编辑 ────────────────────────────── */

/** 取当前磁盘状态（编辑用；不做合并校验 —— 校验在保存时统一做） */
function readRawDoc({ dir } = {}) {
  const files = pathsOf(dir);
  const text = readText(files.endpoints);
  if (text === null) return { ok: true, doc: { configVersion: ENDPOINT_CONFIG_VERSION, endpoints: [], stageModels: {}, keys: {} }, hash: null, files };
  try {
    const doc = JSON.parse(text);
    return { ok: true, doc, hash: sha256Hex(text), files };
  } catch (e) {
    const d = describeJsonError(text, e);
    return { ok: false, doc: null, hash: null, files, issues: [err('endpoints.bad-json', 'endpoints.json', d.message, d.hint)] };
  }
}

/**
 * 新增或修改一个端点（同 id 覆盖）。
 *
 * @param {{ dir?: string, endpoint: object, expectedHash?: string|null, force?: boolean }} opts
 */
export function upsertEndpoint({ dir, endpoint, expectedHash, force = false }) {
  const raw = readRawDoc({ dir });
  if (!raw.ok) return { ok: false, issues: raw.issues, warnings: [], hash: null };

  const list = [...(raw.doc.endpoints ?? [])];
  const i = list.findIndex((e) => e?.id === endpoint?.id);
  if (i >= 0) list[i] = endpoint;
  else list.push(endpoint);

  const saved = saveEndpoints({ dir, endpoints: list, stageModels: raw.doc.stageModels ?? {}, expectedHash: expectedHash !== undefined ? expectedHash : raw.hash, force });
  return saved;
}

/**
 * 删除端点（**级联**：分阶段模型指向它的置空；它的 Key 一并删除）。
 *
 * 级联是刻意的：删了端点却留着 `stageModels.solve` 指向它，会让整份配置校验失败
 * （`stageModels.dangling`），而用户刚做完的动作是"删除"，不该被反锁在门外。
 */
export function removeEndpoint({ dir, id, expectedHash, force = false }) {
  const raw = readRawDoc({ dir });
  if (!raw.ok) return { ok: false, issues: raw.issues, warnings: [] };

  const list = (raw.doc.endpoints ?? []).filter((e) => e?.id !== id);
  if (list.length === (raw.doc.endpoints ?? []).length) {
    return { ok: false, issues: [err('endpoints.not-found', 'endpoints', `找不到端点 "${id}"`)], warnings: [] };
  }

  const stageModels = { ...(raw.doc.stageModels ?? {}) };
  const cleared = [];
  for (const [stage, epId] of Object.entries(stageModels)) {
    if (epId === id) {
      stageModels[stage] = null;
      cleared.push(stage);
    }
  }

  const warnings = [];
  const saved = saveEndpoints({ dir, endpoints: list, stageModels, expectedHash: expectedHash !== undefined ? expectedHash : raw.hash, force });
  if (!saved.ok) return { ...saved, warnings };

  if (cleared.length) {
    warnings.push({
      code: 'endpoints.stage-cleared',
      path: 'stageModels',
      message: `这些阶段原本指向它，已置空：${cleared.join(' / ')}`,
      hint: '请给这些阶段重新指定端点，否则跑到该阶段会报"没有指定端点"',
    });
  }

  const keyFile = loadKeys({ dir });
  if (keyFile.ok && keyFile.keys[id]) {
    delete keyFile.keys[id];
    saveKeys({ dir, keys: keyFile.keys });
    warnings.push({ code: 'endpoints.key-removed', path: `keys.json:keys.${id}`, message: '它的 Key 也一并删掉了' });
  }

  return { ...saved, warnings };
}

/**
 * 设置某阶段用哪个端点（`null` = 未指定）。
 *
 * @param {{ dir?: string, stage: string, endpointId: string|null, expectedHash?: string|null }} opts
 */
export function setStageModel({ dir, stage, endpointId, expectedHash, force = false }) {
  if (!PIPELINE_STAGES.includes(stage)) {
    return {
      ok: false,
      issues: [err('endpoints.stage-unknown', 'stageModels', `未知阶段 "${stage}"`, `合法阶段：${PIPELINE_STAGES.join(' / ')}`)],
      warnings: [],
    };
  }
  const raw = readRawDoc({ dir });
  if (!raw.ok) return { ok: false, issues: raw.issues, warnings: [] };

  const stageModels = { ...(raw.doc.stageModels ?? {}), [stage]: endpointId ?? null };
  return saveEndpoints({
    dir,
    endpoints: raw.doc.endpoints ?? [],
    stageModels,
    expectedHash: expectedHash !== undefined ? expectedHash : raw.hash,
    force,
  });
}

/**
 * 给某个端点设 Key（端点必须已存在）。
 *
 * @param {{ dir?: string, id: string, key: string }} opts
 */
export function setKey({ dir, id, key }) {
  const raw = readRawDoc({ dir });
  if (!raw.ok) return { ok: false, issues: raw.issues };

  if (!(raw.doc.endpoints ?? []).some((e) => e?.id === id)) {
    return {
      ok: false,
      issues: [
        err('endpoints.not-found', `keys.${id}`, `没有端点 "${id}"，不能给它设 Key`, '先加端点；否则这个 Key 永远用不上（孤儿 Key）'),
      ],
    };
  }
  if (typeof key !== 'string' || key.length === 0) {
    return { ok: false, issues: [err('keys.empty', `keys.${id}`, 'Key 不能为空字符串', '要删除请用"清除 Key"')] };
  }

  const keyFile = loadKeys({ dir });
  if (!keyFile.ok) return { ok: false, issues: keyFile.issues };
  return saveKeys({ dir, keys: { ...keyFile.keys, [id]: key } });
}

/** 清除某个端点的 Key（保留端点） */
export function clearKey({ dir, id }) {
  const keyFile = loadKeys({ dir });
  if (!keyFile.ok) return { ok: false, issues: keyFile.issues };
  if (!(id in keyFile.keys)) {
    return { ok: false, issues: [err('keys.not-found', `keys.${id}`, `端点 "${id}" 没有 Key`)] };
  }
  const next = { ...keyFile.keys };
  delete next[id];
  return saveKeys({ dir, keys: next });
}

/* ────────────────────────────── 导出 / 导入（不含 Key） ────────────────────────────── */

/**
 * 导出配置文本（**结构性地不含 Key**）。
 *
 * 导出函数根本不读 keys.json —— 这是"不可能漏"的做法。
 * 另外还做一道**自证**：把传入的已知 Key 逐个在成品里搜一遍，命中就抛（防止将来有人改了这段代码
 * 又把 keys 拼回去）。这道自证在自检里被单独点住（负对照）。
 *
 * @param {{ endpoints: object[], stageModels: object, knownKeys?: string[] }} input
 * @returns {{ text: string, bytes: number, hash: string }}
 */
export function exportEndpointsText({ endpoints, stageModels = {}, knownKeys = [] }) {
  const payload = { configVersion: ENDPOINT_CONFIG_VERSION, endpoints, stageModels, keys: {} };
  const text = `${JSON.stringify(payload, null, 2)}\n`;

  assertNoSecrets(text, knownKeys);
  return { text, bytes: Buffer.byteLength(text, 'utf8'), hash: sha256Hex(text) };
}

/**
 * 自证：这段文本里不许出现任何已知 Key，也不许出现典型 Key 形态。
 *
 * @param {string} text
 * @param {string[]} [knownKeys]
 * @throws {Error} `endpoints.key-leak`
 */
export function assertNoSecrets(text, knownKeys = []) {
  const body = String(text ?? '');
  for (const k of knownKeys) {
    if (typeof k === 'string' && k.length >= 8 && body.includes(k)) {
      const e = new Error('导出的配置里出现了 Key（这是不能发生的）');
      e.code = 'endpoints.key-leak';
      e.leakedId = k.slice(0, 4) + '…';
      throw e;
    }
  }
  const m = /\bsk-[A-Za-z0-9_-]{8,}/.exec(body);
  if (m) {
    const e = new Error(`导出的配置里出现了像 Key 的字符串（${m[0].slice(0, 4)}…）`);
    e.code = 'endpoints.key-leak';
    throw e;
  }
  return true;
}

/**
 * 解析并校验一份**导入**的配置（不写盘）。
 *
 * 三步，各有明确拒绝理由：
 *   ① 版本：不支持就明确拒（§11.2"导入时校验版本"）；
 *   ② **含 Key 就拒**：导入包不该带 Key（用户裁决：Key 单独存）。不静默丢弃 ——
 *      否则用户会以为自己导入的 Key 生效了；
 *   ③ 九条判据（`validateEndpointConfig`）。
 *
 * @param {string} text
 * @returns {{ ok: boolean, issues: object[], config: object|null, text: string|null, hash: string|null }}
 */
export function parseImportEndpoints(text) {
  const src = String(text ?? '');
  if (src.length > 4 * 1024 * 1024) {
    return { ok: false, issues: [err('endpoints.too-large', 'endpoints.json', '导入文件超过 4 MB')], config: null, text: null, hash: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(src);
  } catch (e) {
    const d = describeJsonError(src, e);
    return { ok: false, issues: [err('endpoints.bad-json', 'endpoints.json', d.message, d.hint)], config: null, text: null, hash: null };
  }

  const issues = [];
  if (parsed?.configVersion !== ENDPOINT_CONFIG_VERSION) {
    issues.push(
      err(
        'endpoints.bad-version',
        'endpoints.json:configVersion',
        `不支持的配置版本 ${JSON.stringify(parsed?.configVersion)}`,
        `本版只支持 configVersion = ${ENDPOINT_CONFIG_VERSION}；更高版本请升级程序，不要手改`,
      ),
    );
  }
  if (parsed?.keys && typeof parsed.keys === 'object' && Object.keys(parsed.keys).length > 0) {
    issues.push(
      err(
        'endpoints.keys-not-allowed',
        'endpoints.json:keys',
        '导入的配置里带着 Key —— 导入包不应含任何 Key',
        'Key 单独存放（keys.json）且**不可导出**：请先确认这个文件是谁给的，再手动填 Key',
      ),
    );
  }
  if (issues.length) return { ok: false, issues, config: null, text: null, hash: null };

  const config = { configVersion: ENDPOINT_CONFIG_VERSION, endpoints: parsed.endpoints ?? [], stageModels: parsed.stageModels ?? {}, keys: {} };
  const v = validateEndpointConfig(config, { rawText: src });
  if (!v.ok) return { ok: false, issues: v.issues, config: null, text: null, hash: null };

  return { ok: true, issues: [], config, text: src, hash: sha256Hex(src) };
}

/**
 * 导入并写盘（Key 不在其中，因此只写 endpoints.json）。
 *
 * @param {{ dir?: string, text: string, expectedHash?: string|null, force?: boolean }} opts
 */
export function importEndpoints({ dir, text, expectedHash, force = false }) {
  const parsed = parseImportEndpoints(text);
  if (!parsed.ok) return { ...parsed, hash: null };
  const saved = saveEndpoints({
    dir,
    endpoints: parsed.config.endpoints,
    stageModels: parsed.config.stageModels,
    expectedHash,
    force,
  });
  return { ...saved, warnings: [] };
}

/** 端点文件的体积/存在性（UI 显示用；配置 ≤4 MB 是 §11.2 的硬限） */
export function endpointFilesInfo({ dir } = {}) {
  const files = pathsOf(dir);
  const info = (abs) => (existsSync(abs) ? { path: abs, bytes: statSync(abs).size } : { path: abs, bytes: null });
  return { endpoints: info(files.endpoints), keys: info(files.keys) };
}
