/**
 * 模型调用的错误分类（§11.2 / M2）。
 *
 * 为什么单独一个文件：§11.2 要求"错误分类（网络/鉴权/限流/超时/内容拒绝分别给可操作建议）"。
 * 分类是纯函数，最容易也最值得单独取证 —— 它在链路里扮演的角色是
 * **把技术异常翻译成用户能据此行动的一句话**，而不是把 stack trace 甩给用户（§21.1 第 4 条）。
 */

/** §11.2 要求的五类 + 三类实现必需的补充 */
export const MODEL_ERROR_KINDS = Object.freeze([
  'network', // 连不上 / DNS / 证书
  'auth', // 401 / 403：Key 错或无权限
  'rate-limit', // 429
  'timeout', // 超过端点级 timeoutMs
  'content-refused', // 400/422 或模型明确拒绝内容
  'server', // 5xx：对端故障
  'bad-response', // 200 但响应体不是预期形状 / 流被截断
  'cancelled', // 用户主动取消（**不是错误**，但要能被区分出来）
  'unknown',
]);

/** 分类结果自带"可操作建议"（§11.2 明确要求分别给建议） */
const ADVICE = Object.freeze({
  network: '检查网络与 baseURL 是否可达；若是本地推理服务，确认它已经启动。',
  auth: '检查该端点的 API Key 是否正确、是否过期，以及账号是否有该模型的权限。',
  'rate-limit': '稍后重试，或在设置里换一个端点/模型分担流量。',
  timeout: '在设置里调大该端点的 timeoutMs（大模型首字延迟常见数秒到数十秒）。',
  'content-refused': '模型拒绝了这次请求；检查题面是否触发了内容策略，或换一个模型。',
  server: '这是对端服务故障，稍后重试；持续失败请换端点。',
  'bad-response': '对端返回的内容不符合 OpenAI 兼容格式；确认 baseURL 指向的是兼容端点（通常以 /v1 结尾）。',
  cancelled: '已按你的要求取消。',
  unknown: '请查看下方原始信息，并在设置页用"测试连接"确认端点可用。',
});

/** 抛给上层的统一错误类型：带分类、HTTP 状态、可操作建议 */
export class ModelError extends Error {
  /**
   * @param {object} init
   * @param {string} init.kind   MODEL_ERROR_KINDS 之一
   * @param {string} init.message 面向人的中文说明
   * @param {number} [init.status] HTTP 状态码（若有）
   * @param {string} [init.code]   对端返回的错误码（若有）
   * @param {string} [init.raw]    截断后的原始响应片段（已脱敏）
   * @param {string} [init.stage]  出错的阶段（solve/…，便于 UI 定位）
   */
  constructor({ kind, message, status, code, raw, stage }) {
    super(message);
    this.name = 'ModelError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.raw = raw;
    this.stage = stage;
    this.hint = ADVICE[kind] ?? ADVICE.unknown;
  }

  /** 给 UI / 日志用的紧凑结构（**绝不包含 Key**） */
  toJSON() {
    return {
      kind: this.kind,
      message: this.message,
      hint: this.hint,
      status: this.status,
      code: this.code,
      stage: this.stage,
    };
  }
}

/* ────────────────────────────── HTTP 状态 → 分类 ────────────────────────────── */

/**
 * §11.2：鉴权 / 限流 / 内容拒绝分别给建议。
 * @param {number} status HTTP 状态码
 */
export function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server';
  if (status === 400 || status === 422) {
    // ⚠ 诚实说明：400 既可能是"请求写错"，也可能是"内容被拒"，**响应体里未必有可辨关键词**。
    // 这里不假装精确 —— 统一归一成 content-refused，因为这一类给用户的建议
    //（换模型 / 改题面）比"未知错误"更有用。原始响应体保留在 ModelError.raw 里供排查。
    return 'content-refused';
  }
  return 'unknown';
}

/* ────────────────────────────── fetch 异常 → 分类 ────────────────────────────── */

/** Node 的 fetch 在超时/取消/网络故障上抛的是同一类异常，靠 name 与 cause.code 区分 */
export function classifyFetchError(err, { timedOut = false } = {}) {
  if (err?.name === 'AbortError') return timedOut ? 'timeout' : 'cancelled';

  const code = err?.cause?.code ?? err?.code;
  switch (code) {
    case 'ENOTFOUND':
    case 'ECONNREFUSED':
    case 'ECONNRESET':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EAI_AGAIN':
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return 'network';
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'UND_ERR_BODY_TIMEOUT':
      return 'timeout';
    default:
      return 'network';
  }
}

/** 流在读到一半时被 abort（用户取消 / 超时） */
export function classifyStreamAbort({ timedOut = false, cancelled = false } = {}) {
  if (cancelled) return 'cancelled';
  if (timedOut) return 'timeout';
  return 'bad-response';
}

/** 把分类渲染成一句面向人的话 */
export function describeModelError(kind, extra = '') {
  const base = {
    network: '无法连接模型端点',
    auth: '模型端点拒绝了这次请求（鉴权失败）',
    'rate-limit': '模型端点提示请求过于频繁',
    timeout: '等待模型响应超时',
    'content-refused': '模型拒绝了这个请求',
    server: '模型端点内部错误',
    'bad-response': '模型端点返回了无法解析的内容',
    cancelled: '已取消',
    unknown: '模型调用失败',
  }[kind] ?? '模型调用失败';
  return extra ? `${base}：${extra}` : base;
}
