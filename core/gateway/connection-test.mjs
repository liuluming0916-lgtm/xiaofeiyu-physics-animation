/**
 * "测试连接"（第 6 期第 4 项 · §11.2）。
 *
 * §11.2 原文：保存前可"测试连接"（最小请求 + 延迟毫秒）；UI 必须写清
 * 「**仅验证文本连通性，视觉与解题质量需另行测试**」。
 *
 * ── 为什么只打 `GET {baseURL}/models`
 *
 * 它是 OpenAI 兼容里**最便宜**的一个真实请求：不消耗 token、不需要模型名、返回体小。
 * 换成聊天补全当然更"真"，但每次点一下测试就烧一次钱，用户会开始不点它 ——
 * 那这个功能就等于没有。
 *
 * ── 为什么 404 也算"通"
 *
 * 不少自建网关/代理不实现 `/models`。它返回 404 说明**网络与协议栈是通的**，
 * 只是列不出模型。把它判成失败会让用户去改一个本来没问题的地址。
 * 因此 404/405 记为 `ok: true` 但带一条 `note`，让界面写清"连通，但列不出模型"。
 *
 * ── 安全
 *
 * 只对 https（或本机 http）发请求。校验层已经拦过，这里再做一道：
 * 一条"测试连接"不该成为把明文 Key 发到公网 http 的通道。
 */

import { redactText } from './endpoint-config.mjs';

/** 验收原文要求显示的那句话（**逐字照抄 §11.2**，改它等于改验收口径）：
 * 「仅验证文本连通性，视觉与解题质量需另行测试」
 */
export const CONNECTION_TEST_NOTICE = '仅验证文本连通性，视觉与解题质量需另行测试';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * 把结果里的文字过一遍脱敏。
 *
 * 为什么必须有：某些端点会把请求**回显**在错误体里（含 `Authorization: Bearer …`）。
 * 那条 note 会被打印到终端、也会显示在设置页 —— 不脱敏就等于把 Key 写到日志里，
 * 而 §16 明令"绝不写入日志"。这里在**出口**统一处理，而不是指望每个调用方自觉。
 */
function scrub(result, apiKey) {
  const secrets = typeof apiKey === 'string' && apiKey.length >= 8 ? [apiKey] : [];
  return {
    ...result,
    message: redactText(result.message, secrets),
    ...(result.note ? { note: redactText(result.note, secrets) } : {}),
  };
}

/**
 * 拼探测地址（`{baseURL}/models`，去掉尾部斜杠）。
 * @param {string} baseURL
 */
export function probeUrl(baseURL) {
  return `${String(baseURL ?? '').replace(/\/+$/, '')}/models`;
}

/** 目标地址是否是"可以发 Key 的"（https 或本机 http） */
export function isTransportAllowed(baseURL) {
  let u;
  try {
    u = new URL(String(baseURL ?? ''));
  } catch {
    return false;
  }
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname)) return true;
  return false;
}

/**
 * 测试连接。
 *
 * @param {{
 *   endpoint: { id?: string, baseURL: string, defaultModel?: string },
 *   apiKey?: string|null,
 *   fetchImpl?: Function,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 * }} input
 * @returns {Promise<{
 *   ok: boolean, code: string, latencyMs: number|null, status: number|null,
 *   modelCount: number|null, message: string, note?: string, notice: string,
 * }>}
 */
async function runTest({ endpoint, apiKey = null, fetchImpl = globalThis.fetch, timeoutMs = 15000, signal } = {}) {
  const base = { ok: false, code: 'unknown', latencyMs: null, status: null, modelCount: null, message: '', notice: CONNECTION_TEST_NOTICE };
  const baseURL = endpoint?.baseURL;

  if (!isTransportAllowed(baseURL)) {
    return {
      ...base,
      code: 'insecure-transport',
      message: '这个地址不能用来发 Key：必须是 https，或本机的 http://127.0.0.1 / http://localhost',
    };
  }
  if (typeof fetchImpl !== 'function') {
    return { ...base, code: 'no-fetch', message: '当前环境没有可用的 fetch，无法测试连接' };
  }

  const url = probeUrl(baseURL);
  const ms = Math.max(1000, Number(timeoutMs) || 15000);
  const started = Date.now();

  const headers = { Accept: 'application/json' };
  if (typeof apiKey === 'string' && apiKey.length) headers.Authorization = `Bearer ${apiKey}`;

  /** 超时：优先用 AbortSignal.timeout；再和外部取消信号合并 */
  let timeoutSignal = null;
  try {
    timeoutSignal = AbortSignal.timeout(ms);
  } catch {
    timeoutSignal = null;
  }
  const combined = (() => {
    if (signal && timeoutSignal && typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeoutSignal]);
    return signal ?? timeoutSignal;
  })();

  try {
    const res = await fetchImpl(url, { method: 'GET', headers, signal: combined });
    const latencyMs = Date.now() - started;

    let modelCount = null;
    let bodyText = '';
    try {
      bodyText = await res.text();
      const parsed = JSON.parse(bodyText);
      if (Array.isArray(parsed?.data)) modelCount = parsed.data.length;
    } catch {
      /* 返回体不是 JSON 不影响"通不通"的结论 */
    }

    if (res.ok) {
      return {
        ...base,
        ok: true,
        code: 'ok',
        latencyMs,
        status: res.status,
        modelCount,
        message: modelCount === null ? '连通（返回 2xx）' : `连通，可列出 ${modelCount} 个模型`,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        ...base,
        code: 'auth',
        latencyMs,
        status: res.status,
        message: `网络通，但认证失败（HTTP ${res.status}）—— Key 可能不对，或这个端点不需要/不接受 Bearer`,
      };
    }

    if (res.status === 404 || res.status === 405) {
      return {
        ...base,
        ok: true,
        code: 'models-unsupported',
        latencyMs,
        status: res.status,
        message: `连通，但该服务不提供 /models（HTTP ${res.status}）`,
        note: '这仍说明网络与地址是对的；能不能解题要看实际跑一道题',
      };
    }

    return {
      ...base,
      code: 'http',
      latencyMs,
      status: res.status,
      message: `连上了但服务返回 HTTP ${res.status}`,
      ...(bodyText ? { note: bodyText.slice(0, 200).replace(/\s+/g, ' ') } : {}),
    };
  } catch (e) {
    const latencyMs = Date.now() - started;
    const name = e?.name ?? '';
    if (name === 'TimeoutError' || /timeout/i.test(String(e?.message ?? ''))) {
      return { ...base, code: 'timeout', latencyMs, message: `超过 ${ms} ms 没有响应（可能是地址不通，或服务很慢）` };
    }
    if (name === 'AbortError') {
      return { ...base, code: 'cancelled', latencyMs, message: '测试被取消' };
    }
    return {
      ...base,
      code: 'network',
      latencyMs,
      message: `连不上：${String(e?.message ?? e)}`,
      note: '常见原因：地址写错、需要代理、DNS 不通、证书问题（自签证书）',
    };
  }
}

/**
 * 测试连接（**出口统一脱敏**）。
 *
 * @param {{
 *   endpoint: { id?: string, baseURL: string, defaultModel?: string },
 *   apiKey?: string|null,
 *   fetchImpl?: Function,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 * }} input
 * @returns {Promise<{
 *   ok: boolean, code: string, latencyMs: number|null, status: number|null,
 *   modelCount: number|null, message: string, note?: string, notice: string,
 * }>}
 */
export async function testConnection(input = {}) {
  const base = await runTest(input);

  /**
   * ── 「这个模型到底能不能看图」用**实测**回答（第 8 期）──
   *
   * 为什么不用猜：模型多模态能力是**服务商与型号**决定的，而且会变（新模型、代理网关）。
   * 写死一张"谁支持谁不支持"的表，一定会过期；用户也不该靠猜去勾那个复选框。
   *
   * 做法：发一张 1×1 PNG + 一句"只回复 ok"，`max_tokens: 8`。
   *   · 200 且能收到内容  ⇒ 能看图（`vision.ok = true`）
   *   · 400/422 且提到图   ⇒ 不能看图
   *   · 其他错误           ⇒ 不妄断，如实转述（`vision.unknown`）
   * 成本：一次不到 10 token 的调用。
   */
  const result = { ...base };
  if (input.probeVision && input.endpoint) {
    result.vision = await probeVision(input);
  }
  return scrub(result, input?.apiKey);
}

/** 1×1 透明 PNG（最小可用的真图，不用外部文件） */
const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function probeVision({ endpoint, apiKey = null, timeoutMs = 15000 }) {
  const { streamChatCompletion } = await import('./model-client.mjs');
  const dataUrl = `data:image/png;base64,${PIXEL_PNG_BASE64}`;
  let text = '';
  try {
    const out = await streamChatCompletion({
      endpoint,
      apiKey,
      vision: true,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '这张图是什么颜色？只回复一个词。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      extraBody: { max_tokens: 8 },
      timeoutMs: Math.min(timeoutMs ?? 15000, 20000),
      onDelta: (d) => {
        text += d;
      },
    });
    return {
      ok: true,
      code: 'vision-ok',
      message: `能看图（模型回复：${String(out?.text ?? text ?? '').slice(0, 20) || '（空）'}）`,
    };
  } catch (err) {
    const msg = String(err?.message ?? err);
    const kind = err?.kind ?? 'unknown';
    /** 对端**原话**往往就在 `raw` 里（例如 "This model does not support image input"） */
    const raw = String(err?.raw ?? '').slice(0, 200);
    const haystack = `${msg} ${raw}`;
    const looksLikeNoVision = /image|vision|multi-?modal|unsupported|不(支持|接受)|不支持/i.test(haystack);
    return {
      ok: false,
      code: looksLikeNoVision ? 'vision-unsupported' : 'vision-unknown',
      kind,
      message: looksLikeNoVision
        ? `不能看图（对端原话：${(raw || msg).slice(0, 140)}）`
        : `看图的探测没成功，但不能断定不支持（对端原话：${(raw || msg).slice(0, 140)}）`,
    };
  }
}

/**
 * 把结果渲染成给人看的一段文本（CLI 与 UI 共用）。
 * @param {object} r testConnection 的返回值
 */
export function formatConnectionResult(r) {
  const lines = [`${r.ok ? '✓' : '✗'} ${r.message}`];
  if (r.latencyMs !== null && r.latencyMs !== undefined) lines.push(`  耗时：${r.latencyMs} ms`);
  if (r.note) lines.push(`  附注：${r.note}`);
  /* 看图能力的**实测**结论（有探测才显示） */
  if (r.vision) lines.push(`  ${r.vision.ok ? '✓' : '✗'} 看图能力（实测）：${r.vision.message}`);
  lines.push(`  ⚠ ${r.notice}`);
  return lines.join('\n');
}
