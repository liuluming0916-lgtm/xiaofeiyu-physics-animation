/**
 * 端点配置的读取、校验与解析（§11.1 / §11.2 / §11.3）。
 *
 * 职责边界：
 *   · **合法性**完全交给 `contracts/validate.mjs`（契约的跨字段守门人）——本文件不重复判据；
 *   · 本文件管**可用性**：从配置里挑出某阶段该用哪个端点、Key 从哪来、
 *     以及 §11.3 的视觉门控（"当前解题阶段模型是否支持图片输入"）。
 *
 * Key 的安全边界（§16 / §21.2 第 6 条）：
 *   Key 明文存本机，但**绝不写入日志 / 导出包 / 失败复现包**。
 *   本文件提供 `redact()` / `redactText()`，所有对外输出（日志、诊断、报告）必须走它们。
 */

import { readFileSync } from 'node:fs';

import { validateEndpointConfig, formatIssues } from '../../contracts/validate.mjs';
import { PIPELINE_STAGES } from '../../contracts/spec/frozen-keys.mjs';

/** 配置不合法时抛这个：带全部 issue，便于 UI 逐条展示 */
export class EndpointConfigError extends Error {
  constructor(issues, source) {
    const head = source ? `端点配置不合法（${source}）：` : '端点配置不合法：';
    super(`${head}\n${formatIssues(issues)}`);
    this.name = 'EndpointConfigError';
    this.issues = issues;
  }
}

/* ────────────────────────────── 脱敏 ────────────────────────────── */

/**
 * 把一个具体 Key 变成可安全展示的形式：`sk-1234…cdef`。
 * 太短的 Key 一律整体打码（避免"脱敏后仍可枚举"）。
 */
export function redact(secret) {
  if (typeof secret !== 'string' || secret.length === 0) return '(空)';
  if (secret.length <= 8) return '***';
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/**
 * 从一段文本里抹掉已知的 Key 字面量。
 *
 * 为什么需要它：`ModelError.raw` 会带上对端返回的原始响应片段，
 * 而某些端点会把请求回显在错误信息里（含 Authorization 头或 Key）。
 * 因此**任何要落盘/上屏的文本都必须先过这一道**。
 *
 * @param {string} text
 * @param {Iterable<string>} secrets 已知的 Key 集合（来自配置）
 */
export function redactText(text, secrets = []) {
  let out = String(text ?? '');
  for (const s of secrets) {
    if (typeof s === 'string' && s.length >= 8) out = out.split(s).join('***');
  }
  // 兜底：常见 Key 形态（sk-…、Bearer …）即使不在已知集合里也打码
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{8,})/g, (m) => redact(m));
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1***');
  return out;
}

/* ────────────────────────────── 读取与校验 ────────────────────────────── */

/**
 * 读取并校验端点配置文件（§11.1 字段 + §11.2 规则）。
 *
 * @param {string} absPath  配置文件绝对路径
 * @returns {{ raw: object, endpoints: Map<string, object>, stageModels: Record<string,string|null>, keys: Record<string,string> }}
 * @throws {EndpointConfigError} 配置不合法时（**不静默退回默认值**）
 */
export function loadEndpointConfig(absPath) {
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (err) {
    throw new EndpointConfigError(
      [{ code: 'config.unreadable', path: absPath, message: `读不到配置文件：${err.message}` }],
      absPath,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new EndpointConfigError(
      [{ code: 'config.bad-json', path: absPath, message: `不是合法 JSON：${err.message}` }],
      absPath,
    );
  }

  const { ok, issues } = validateEndpointConfig(parsed, { rawText: text });
  if (!ok) throw new EndpointConfigError(issues, absPath);

  return {
    raw: parsed,
    endpoints: new Map(parsed.endpoints.map((ep) => [ep.id, ep])),
    stageModels: { ...parsed.stageModels },
    keys: { ...parsed.keys },
  };
}

/* ────────────────────────────── 阶段 → 端点 ────────────────────────────── */

/**
 * 解析某阶段该用哪个端点（§11.1 的 `stageModels` 语义）。
 *
 * 规则（按 §11.1 的"未配置的阶段为 null"推导）：
 *   · `stageModels[stage]` 有值 → 用它；
 *   · 为 null 或未配置 → 若**有且仅有一个**端点，则用它（单端点场景不必重复配置）；
 *   · 否则报错并指出该怎么配（**不猜**）。
 *
 * @returns {{ endpoint: object, apiKey: string|null, stage: string }}
 */
export function resolveStageEndpoint(config, stage) {
  if (!PIPELINE_STAGES.includes(stage)) {
    throw new EndpointConfigError(
      [{ code: 'stage.unknown', path: 'stage', message: `未知阶段 "${stage}"`, hint: `合法阶段：${PIPELINE_STAGES.join(' / ')}` }],
    );
  }

  const configuredId = config.stageModels?.[stage] ?? null;
  let endpointId = configuredId;

  if (!endpointId) {
    const all = [...config.endpoints.keys()];
    if (all.length === 1) {
      endpointId = all[0];
    } else {
      throw new EndpointConfigError([
        {
          code: 'stageModels.unassigned',
          path: `stageModels.${stage}`,
          message:
            all.length === 0
              ? '配置里没有任何端点'
              : `阶段 ${stage} 没有指定端点，而配置里有 ${all.length} 个端点，无法推断该用哪个`,
          hint:
            all.length === 0
              ? '请先在 ai-rules/endpoints.json 里添加一个端点'
              : `请在 stageModels.${stage} 里明确填一个端点 id：${all.join(' / ')}`,
        },
      ]);
    }
  }

  const endpoint = config.endpoints.get(endpointId);
  if (!endpoint) {
    // 理论上 validateEndpointConfig 已经拦过，这里是纵深防御
    throw new EndpointConfigError([
      { code: 'stageModels.dangling', path: `stageModels.${stage}`, message: `阶段 ${stage} 引用了不存在的端点 "${endpointId}"` },
    ]);
  }

  // Key 复用链（§11.1 的 apiKeyModelId）：顺着链找到真正持 Key 的端点
  let keyOwner = endpoint;
  const visited = new Set([endpoint.id]);
  while (keyOwner.apiKeyModelId) {
    const next = config.endpoints.get(keyOwner.apiKeyModelId);
    if (!next || visited.has(next.id)) break; // 环已由校验层拒绝，这里只防御
    visited.add(next.id);
    keyOwner = next;
  }

  const apiKey = typeof config.keys?.[keyOwner.id] === 'string' ? config.keys[keyOwner.id] : null;
  return { endpoint, apiKey, stage };
}

/* ────────────────────────────── §11.3 视觉门控 ────────────────────────────── */

/**
 * §11.3 视觉门控：当前解题阶段模型不支持视觉时，**图片入口必须禁用并提示原因**，
 * **不做任何降级**（不许偷偷丢图、不许本地 OCR、不许假装读了图）。
 *
 * @param {{endpoint: object}} resolved  resolveStageEndpoint 的结果
 * @returns {{ available: boolean, reason: string, hint?: string }}
 */
export function assertVisionAvailable(resolved) {
  const ep = resolved?.endpoint;
  if (!ep) {
    return { available: false, reason: '没有可用的端点，无法判断是否支持图片输入', hint: '请先配置端点' };
  }
  if (ep.supportsVision === true) {
    return { available: true, reason: '当前端点支持图片输入' };
  }
  return {
    available: false,
    // 文案逐字对齐 §11.3 原文
    reason: '当前模型不支持图片输入，请更换支持视觉的模型或改为文字输入',
    hint: '可以先用右侧的"配图补充描述"用文字把图中关键几何关系描述出来',
  };
}

/**
 * 选出发送时该用的模型名（§11.1：`visionModel` 可选，留空则用 `defaultModel`）。
 * @param {object} endpoint
 * @param {{ vision?: boolean }} [opts] 本次请求是否带图片
 */
export function pickModel(endpoint, { vision = false } = {}) {
  if (vision && typeof endpoint.visionModel === 'string' && endpoint.visionModel.length) {
    return endpoint.visionModel;
  }
  return endpoint.defaultModel;
}
