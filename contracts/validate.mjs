/**
 * 契约的**跨字段校验**实现（§11.2 / §12）。
 *
 * 背景：`endpoint.schema.json` 的描述里一直写着"跨字段部分由 `contracts/index.mjs` 的
 * `validateEndpointConfig` 实现"，但**这个文件与这个函数在第 1、2 期都不存在**
 * ——契约里写着一个不存在的守门人。第 3 期第 1 步把它补上。
 *
 * 为什么是手写而不是引入 JSON Schema 校验器（ajv 之类）：
 *   ① §11.2 的一半规则**根本表达不了**在 JSON Schema 里
 *      （`apiKeyModelId` 不得成环、`stageModels` 引用必须存在）；
 *   ② 本项目从第 1 期就定下"依赖最小"的口径（后端至今只有 acorn + mathjax-full），
 *      为一个字段量很小的配置树引入校验器 + 它的依赖树不划算；
 *   ③ 手写还能给出**面向用户的中文诊断 + 可操作建议**（§21.1 第 5 条），
 *      而通用校验器的报错是英文路径式的。
 *
 * ⚠ 本文件**不是** `contracts/` 的生成物，因此**不影响 `contractHash`**
 *   （`verify-contracts.mjs` 只比对 `buildContractArtifacts()` 产出的 13 份文件）。
 */

import { PIPELINE_STAGES, CLEANING_STAGES as CLEANING_STAGES_FROZEN } from './spec/frozen-keys.mjs';

/* ────────────────────────────── 错误与结果形状 ────────────────────────────── */

/**
 * @typedef {object} ValidationIssue
 * @property {string} code    机器可读的规则号，便于测试与自愈回灌
 * @property {string} path    出问题的位置（如 `endpoints[1].baseURL`）
 * @property {string} message 面向人的中文说明
 * @property {string} [hint]  可操作建议
 */

const err = (code, path, message, hint) => ({ code, path, message, ...(hint ? { hint } : {}) });

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** §11.2：配置文件 ≤4 MB（导入时校验） */
export const ENDPOINT_CONFIG_MAX_BYTES = 4 * 1024 * 1024;
/** §11.2：端点最多 300 项 */
export const ENDPOINT_MAX_COUNT = 300;
/** §11.2：configVersion 只支持 1 */
export const ENDPOINT_CONFIG_VERSION = 1;
/** §11.1：timeoutMs 下限 */
export const ENDPOINT_MIN_TIMEOUT_MS = 1000;

const ENDPOINT_REQUIRED_FIELDS = [
  'id',
  'displayName',
  'baseURL',
  'defaultModel',
  'apiKeyModelId',
  'supportsJsonMode',
  'supportsVision',
  'enableThinking',
  'preserveThinking',
  'timeoutMs',
];

/* ────────────────────────────── §11.2 规则 1–2：URL ────────────────────────────── */

/**
 * §11.2：远程地址**必须 HTTPS**（`http://127.0.0.1` 与 `http://localhost` 例外，供本地推理）；
 *        地址不得包含凭据、查询参数或片段。
 */
function checkBaseURL(raw, path, issues) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    issues.push(err('endpoint.url.unparsable', path, `不是合法的 URL：${raw}`, '形如 https://api.example.com/v1'));
    return;
  }

  const isLoopbackHttp =
    url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (url.protocol !== 'https:' && !isLoopbackHttp) {
    issues.push(
      err(
        'endpoint.url.https-required',
        path,
        `远程地址必须使用 HTTPS，当前是 ${url.protocol}//`,
        '本地推理服务可以用 http://127.0.0.1 或 http://localhost',
      ),
    );
  }

  if (url.username || url.password) {
    issues.push(err('endpoint.url.has-credentials', path, '地址中不得包含用户名或密码', '请把凭据填在 keys 里'));
  }
  if (url.search) {
    issues.push(err('endpoint.url.has-query', path, '地址中不得包含查询参数（?…）', '只填到 /v1 这一级'));
  }
  if (url.hash) {
    issues.push(err('endpoint.url.has-fragment', path, '地址中不得包含片段（#…）'));
  }
}

/* ────────────────────────────── §11.2 规则 5：apiKeyModelId 不得成环 ────────────────────────────── */

/** 从 id 出发沿 apiKeyModelId 链走，若回到已访问节点即成环 */
function findKeyReuseCycle(startId, byId) {
  const seen = new Set();
  let cursor = startId;
  while (cursor) {
    if (seen.has(cursor)) return [...seen, cursor];
    seen.add(cursor);
    const next = byId.get(cursor)?.apiKeyModelId;
    cursor = typeof next === 'string' && next.length ? next : null;
  }
  return null;
}

/* ────────────────────────────── 主校验函数 ────────────────────────────── */

/**
 * 校验「端点与分阶段模型配置」（§11.1 字段 + §11.2 规则）。
 *
 * @param {unknown} config 已 JSON.parse 的配置对象
 * @param {{ byteLength?: number, rawText?: string }} [opts]
 *        `byteLength` / `rawText` 用于 §11.2 的体积上限（导入路径应当传）
 * @returns {{ ok: boolean, issues: ValidationIssue[] }}
 */
export function validateEndpointConfig(config, opts = {}) {
  /** @type {ValidationIssue[]} */
  const issues = [];

  /* ── 规则 8 的前半：体积上限 ── */
  const byteLength =
    typeof opts.byteLength === 'number'
      ? opts.byteLength
      : typeof opts.rawText === 'string'
        ? Buffer.byteLength(opts.rawText, 'utf8')
        : undefined;
  if (byteLength !== undefined && byteLength > ENDPOINT_CONFIG_MAX_BYTES) {
    issues.push(
      err(
        'config.too-large',
        '$',
        `配置文件 ${(byteLength / 1024 / 1024).toFixed(2)} MB 超过上限 4 MB`,
        '端点配置里不要放模型清单或题面',
      ),
    );
  }

  if (!isPlainObject(config)) {
    issues.push(err('config.not-object', '$', '配置必须是一个 JSON 对象'));
    return { ok: false, issues };
  }

  /* ── 规则 8 的后半：版本 ── */
  if ('configVersion' in config && config.configVersion !== ENDPOINT_CONFIG_VERSION) {
    issues.push(
      err(
        'config.version-unsupported',
        'configVersion',
        `不支持的配置版本 ${JSON.stringify(config.configVersion)}`,
        `本版只支持 configVersion = ${ENDPOINT_CONFIG_VERSION}`,
      ),
    );
  }

  /* ── 根级必填字段 ── */
  for (const field of ['endpoints', 'stageModels', 'keys']) {
    if (!(field in config)) {
      issues.push(err('config.missing-field', field, `缺少必填字段 ${field}`));
    }
  }
  if (!Array.isArray(config.endpoints)) {
    if ('endpoints' in config) issues.push(err('config.endpoints.not-array', 'endpoints', 'endpoints 必须是数组'));
    return { ok: false, issues };
  }
  if (!isPlainObject(config.stageModels) && 'stageModels' in config) {
    issues.push(err('config.stageModels.not-object', 'stageModels', 'stageModels 必须是对象'));
  }
  if (!isPlainObject(config.keys) && 'keys' in config) {
    issues.push(err('config.keys.not-object', 'keys', 'keys 必须是对象'));
  }

  const endpoints = config.endpoints;
  const idPattern = /^[A-Za-z0-9._-]+$/;
  const byId = new Map();

  /* ── 规则 3 / 4：id 合法、不重复；数量 ≤300 ── */
  if (endpoints.length > ENDPOINT_MAX_COUNT) {
    issues.push(
      err('endpoints.too-many', 'endpoints', `端点数量 ${endpoints.length} 超过上限 ${ENDPOINT_MAX_COUNT}`),
    );
  }

  endpoints.forEach((ep, i) => {
    const at = `endpoints[${i}]`;
    if (!isPlainObject(ep)) {
      issues.push(err('endpoint.not-object', at, '端点必须是对象'));
      return;
    }

    for (const field of ENDPOINT_REQUIRED_FIELDS) {
      if (!(field in ep)) issues.push(err('endpoint.missing-field', `${at}.${field}`, `端点缺少必填字段 ${field}`));
    }

    // id
    if (typeof ep.id !== 'string' || !ep.id.length) {
      issues.push(err('endpoint.id.invalid', `${at}.id`, 'id 必须是非空字符串'));
    } else if (!idPattern.test(ep.id)) {
      issues.push(
        err(
          'endpoint.id.charset',
          `${at}.id`,
          `id "${ep.id}" 含非法字符`,
          '只能使用字母、数字、点、下划线、连字符',
        ),
      );
    } else if (byId.has(ep.id)) {
      issues.push(err('endpoint.id.duplicate', `${at}.id`, `端点 id "${ep.id}" 重复`, '每个端点的 id 必须唯一'));
    } else {
      byId.set(ep.id, ep);
    }

    // displayName / defaultModel / visionModel
    if (typeof ep.displayName !== 'string' || !ep.displayName.length) {
      issues.push(err('endpoint.displayName.invalid', `${at}.displayName`, 'displayName 必须是非空字符串'));
    }
    if (typeof ep.defaultModel !== 'string' || !ep.defaultModel.length) {
      issues.push(err('endpoint.defaultModel.invalid', `${at}.defaultModel`, 'defaultModel 必须是非空字符串'));
    }
    if ('visionModel' in ep && ep.visionModel !== undefined && typeof ep.visionModel !== 'string') {
      issues.push(err('endpoint.visionModel.invalid', `${at}.visionModel`, 'visionModel 必须是字符串'));
    }

    // baseURL：规则 1、2
    if (typeof ep.baseURL !== 'string' || !ep.baseURL.length) {
      issues.push(err('endpoint.baseURL.invalid', `${at}.baseURL`, 'baseURL 必须是非空字符串'));
    } else {
      checkBaseURL(ep.baseURL, `${at}.baseURL`, issues);
    }

    // apiKeyModelId：规则 5 的"必须指向已存在端点"（成环在下一轮统一查）
    if (ep.apiKeyModelId !== null && typeof ep.apiKeyModelId !== 'string') {
      issues.push(
        err('endpoint.apiKeyModelId.invalid', `${at}.apiKeyModelId`, 'apiKeyModelId 必须是字符串或 null'),
      );
    }

    // 视觉 / JSON / 思考开关 必须是布尔
    for (const field of ['supportsJsonMode', 'supportsVision', 'enableThinking', 'preserveThinking']) {
      if (field in ep && typeof ep[field] !== 'boolean') {
        issues.push(err('endpoint.flag.not-boolean', `${at}.${field}`, `${field} 必须是 true 或 false`));
      }
    }

    // timeoutMs：§11.1 下限 1000
    if ('timeoutMs' in ep) {
      if (!Number.isInteger(ep.timeoutMs)) {
        issues.push(err('endpoint.timeoutMs.not-integer', `${at}.timeoutMs`, 'timeoutMs 必须是整数毫秒'));
      } else if (ep.timeoutMs < ENDPOINT_MIN_TIMEOUT_MS) {
        issues.push(
          err('endpoint.timeoutMs.too-small', `${at}.timeoutMs`, `timeoutMs 不得小于 ${ENDPOINT_MIN_TIMEOUT_MS}`, '大模型首字延迟常见数秒，太小会误判超时'),
        );
      }
    }
  });

  /* ── 规则 5（续）：apiKeyModelId 必须指向已存在端点，且不得成环 ── */
  endpoints.forEach((ep, i) => {
    if (!isPlainObject(ep)) return;
    const at = `endpoints[${i}].apiKeyModelId`;
    if (typeof ep.apiKeyModelId !== 'string' || !ep.apiKeyModelId.length) return;

    if (!byId.has(ep.apiKeyModelId)) {
      issues.push(
        err(
          'endpoint.apiKeyModelId.dangling',
          at,
          `apiKeyModelId 指向不存在的端点 "${ep.apiKeyModelId}"`,
          '请先在 endpoints 里定义该端点，或把它改成 null 并直接填 Key',
        ),
      );
      return;
    }

    const cycle = findKeyReuseCycle(ep.id, byId);
    if (cycle) {
      issues.push(
        err('endpoint.apiKeyModelId.cycle', at, `apiKeyModelId 形成循环：${cycle.join(' → ')}`, 'Key 复用链必须是有限的'),
      );
    }
  });

  /* ── 规则 6：stageModels 的键 ∈ 阶段枚举，值 ∈ 已存在端点 ∪ {null} ── */
  if (isPlainObject(config.stageModels)) {
    for (const [stage, endpointId] of Object.entries(config.stageModels)) {
      if (!PIPELINE_STAGES.includes(stage)) {
        issues.push(
          err(
            'stageModels.unknown-stage',
            `stageModels.${stage}`,
            `未知阶段 "${stage}"`,
            `合法阶段：${PIPELINE_STAGES.join(' / ')}`,
          ),
        );
      }
      if (endpointId === null) continue;
      if (typeof endpointId !== 'string' || !endpointId.length) {
        issues.push(err('stageModels.value.invalid', `stageModels.${stage}`, '值必须是非空端点 id 或 null'));
        continue;
      }
      if (!byId.has(endpointId)) {
        issues.push(
          err(
            'stageModels.dangling',
            `stageModels.${stage}`,
            `阶段 ${stage} 引用了不存在的端点 "${endpointId}"`,
            '请先定义该端点，或把它设为 null',
          ),
        );
      }
    }
  }

  /* ── keys 的形状：端点 id → 非空字符串；并检查"孤儿 Key"── */
  if (isPlainObject(config.keys)) {
    for (const [endpointId, key] of Object.entries(config.keys)) {
      if (typeof key !== 'string') {
        issues.push(err('keys.value.not-string', `keys.${endpointId}`, 'Key 必须是字符串'));
      }
      if (!byId.has(endpointId)) {
        issues.push(
          err(
            'keys.orphan',
            `keys.${endpointId}`,
            `keys 里有端点 "${endpointId}" 的 Key，但 endpoints 里没有这个端点`,
            '这是历史残留：请删掉它，避免 Key 无意义地留在配置里',
          ),
        );
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/* ────────────────────────────── §12 清洗规则表 ────────────────────────────── */

/** §16：清洗规则 ≤300 项 */
export const CLEANING_RULES_MAX = 300;
/**
 * ⚠ 第 5 期修掉的一处**第二个事实来源**：这里原先自己写了一份清洗阶段清单，
 * 而同一份清单在 `contracts/spec/frozen-keys.mjs` 里已经有一份（`CLEANING_STAGES`）。
 * 两份各自漂移不会被任何东西发现 —— 现在改成**直接引用**冻结常量。
 */
const CLEANING_STAGES = CLEANING_STAGES_FROZEN;
const CLEANING_REQUIRED_FIELDS = ['id', 'name', 'stage', 'pattern', 'flags', 'replacement', 'enabled'];
const ALLOWED_REGEX_FLAGS = new Set(['g', 'i', 'm', 's', 'u', 'y']);

/**
 * 校验清洗规则表（§12 / §16）。
 *
 * §12 明确要求：**非法正则即时报错且不落盘**。JSON Schema 表达不了正则合法性，
 * 因此这里用 `new RegExp` 试编译（只编译、不执行，不做任何匹配）。
 * 执行侧的超时与隔离在 `core/cleaner/regex-rules.mjs`（第 3 步第 4 项）。
 *
 * @param {unknown} ruleSet
 * @returns {{ ok: boolean, issues: ValidationIssue[] }}
 */
export function validateCleaningRuleSet(ruleSet) {
  /** @type {ValidationIssue[]} */
  const issues = [];

  if (!isPlainObject(ruleSet)) {
    issues.push(err('rules.not-object', '$', '清洗规则表必须是一个 JSON 对象'));
    return { ok: false, issues };
  }
  if (ruleSet.format !== 'od-cleaning-rules') {
    issues.push(err('rules.bad-format', 'format', `format 必须是 "od-cleaning-rules"，当前 ${JSON.stringify(ruleSet.format)}`));
  }
  if (ruleSet.version !== 1) {
    issues.push(err('rules.bad-version', 'version', `不支持的版本 ${JSON.stringify(ruleSet.version)}`, '本版只支持 version = 1'));
  }
  if (!Array.isArray(ruleSet.rules)) {
    issues.push(err('rules.not-array', 'rules', 'rules 必须是数组'));
    return { ok: false, issues };
  }
  if (ruleSet.rules.length > CLEANING_RULES_MAX) {
    issues.push(err('rules.too-many', 'rules', `规则数 ${ruleSet.rules.length} 超过上限 ${CLEANING_RULES_MAX}`));
  }

  const seenIds = new Map();
  ruleSet.rules.forEach((rule, i) => {
    const at = `rules[${i}]`;
    if (!isPlainObject(rule)) {
      issues.push(err('rule.not-object', at, '规则必须是对象'));
      return;
    }
    for (const field of CLEANING_REQUIRED_FIELDS) {
      if (!(field in rule)) issues.push(err('rule.missing-field', `${at}.${field}`, `规则缺少必填字段 ${field}`));
    }
    if (typeof rule.id === 'string' && rule.id.length) {
      const prev = seenIds.get(rule.id);
      if (prev !== undefined) {
        issues.push(err('rule.id.duplicate', `${at}.id`, `规则 id "${rule.id}" 与 ${prev} 重复`));
      } else {
        seenIds.set(rule.id, at);
      }
    }
    if (typeof rule.stage === 'string' && !CLEANING_STAGES.includes(rule.stage)) {
      issues.push(
        err(
          'rule.stage.unknown',
          `${at}.stage`,
          `未知 stage "${rule.stage}"`,
          `合法值：${CLEANING_STAGES.join(' / ')}（dry_run 与 repair 不产生需清洗的模型文本）`,
        ),
      );
    }
    if (typeof rule.enabled !== 'boolean') {
      issues.push(err('rule.enabled.not-boolean', `${at}.enabled`, 'enabled 必须是 true 或 false'));
    }

    // flags：只允许 gimsuy 的子集
    const flags = typeof rule.flags === 'string' ? rule.flags : '';
    for (const flag of flags) {
      if (!ALLOWED_REGEX_FLAGS.has(flag)) {
        issues.push(err('rule.flags.unknown', `${at}.flags`, `不支持的 flags 字符 "${flag}"`, '只允许 g i m s u y'));
      }
    }

    // 正则必须能编译（§12：非法正则即时报错且不落盘）
    if (typeof rule.pattern === 'string') {
      if (!rule.pattern.length) {
        issues.push(err('rule.pattern.empty', `${at}.pattern`, '正则不能为空'));
      } else {
        try {
          // eslint-disable-next-line no-new
          new RegExp(rule.pattern, flags);
        } catch (e) {
          issues.push(
            err('rule.pattern.invalid', `${at}.pattern`, `非法正则：${e.message}`, '该规则不会被保存'),
          );
        }
      }
    }
  });

  return { ok: issues.length === 0, issues };
}

/* ────────────────────────────── 报告输出 ────────────────────────────── */

/** 把 issues 渲染成面向人的多行文本（CLI 与 UI 共用） */
export function formatIssues(issues) {
  return issues
    .map((it) => {
      const head = `  ✗ [${it.code}] ${it.path}：${it.message}`;
      return it.hint ? `${head}\n      → ${it.hint}` : head;
    })
    .join('\n');
}
