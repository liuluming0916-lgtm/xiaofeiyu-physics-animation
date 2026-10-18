/**
 * OpenAI 兼容的对话客户端（手写流式）。
 *
 * 用户第 3 期裁决：**不引入 `openai` 包**（见 README 12.3）。本文件把那件事自己做了：
 * `POST <baseURL>/chat/completions` + `stream: true` + 按 SSE 行解析。
 *
 * 自写必须覆盖的六件事（见 README 12.13 的模型网关实施记录）：
 *   ① SSE 行解析：按 `\n\n` 切事件、`data: ` 前缀、`[DONE]` 结束、**跨 chunk 的不完整行要缓冲**；
 *   ② 增量字段：`choices[0].delta.content`，另兼容 `reasoning_content`（enableThinking）；
 *   ③ 取消：`AbortController` → `fetch.signal`；取消归类为 `cancelled`，**不算错误**；
 *   ④ 超时：端点级 `timeoutMs`，与取消是两条不同路径；
 *   ⑤ 响应体截断：连接中途断开要有明确诊断，**不能静默当成"生成完了"**；
 *   ⑥ 多模态：`content` 是数组（text + image_url），**图片只在任务段，不进固定前缀**。
 */

import {
  ModelError,
  classifyFetchError,
  classifyHttpStatus,
  describeModelError,
} from './error-taxonomy.mjs';
import { pickModel, redactText } from './endpoint-config.mjs';

/* ────────────────────────────── 图片输入（§16 / §11.3） ────────────────────────────── */

/** §16：图片 ≤15 MB，仅 PNG / JPEG / WebP / BMP */
export const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const IMAGE_ALLOWED_MIME = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
]);

/**
 * @typedef {object} ImageInput
 * @property {string} mime    必须 ∈ IMAGE_ALLOWED_MIME
 * @property {Buffer|Uint8Array} data 原始字节
 * @property {string} [name]  文件名（仅用于错误信息）
 */

/**
 * 校验一张图片是否符合 §16 的限制。
 *
 * 刻意**不做静默压缩或转码**：格式/体积不符就明确报错。
 * 这与 §11.3"绝不做假多模态降级"是同一条精神 —— 悄悄改用户给的东西，
 * 会让用户以为模型"看"到了原图。
 *
 * @returns {{ ok: true } | { ok: false, message: string, hint: string }}
 */
export function checkImageInput(image) {
  if (!image || typeof image !== 'object') {
    return { ok: false, message: '图片输入不是一个对象', hint: '内部错误：请把 { mime, data } 传进来' };
  }
  if (!IMAGE_ALLOWED_MIME.includes(image.mime)) {
    return {
      ok: false,
      message: `不支持的图片格式：${image.mime || '(未提供)'}`,
      hint: `仅支持 ${IMAGE_ALLOWED_MIME.join(' / ')}（§16）`,
    };
  }
  const bytes = image.data?.byteLength ?? image.data?.length ?? 0;
  if (bytes === 0) {
    return { ok: false, message: '图片内容为空', hint: '请重新选择图片' };
  }
  if (bytes > IMAGE_MAX_BYTES) {
    return {
      ok: false,
      message: `图片 ${(bytes / 1024 / 1024).toFixed(1)} MB 超过上限 15 MB`,
      hint: '请压缩或裁剪后再试（本项目不会替你静默压缩，以免你以为模型看到的是原图）',
    };
  }
  return { ok: true };
}

/** 字节 → `data:` URI（OpenAI 兼容多模态的 `image_url.url` 用的就是这个形态） */
function toDataURI(image) {
  const base64 = Buffer.from(image.data).toString('base64');
  return `data:${image.mime};base64,${base64}`;
}

/* ────────────────────────────── 消息构造 ────────────────────────────── */

/**
 * 构造任务段的 user 消息（§10.2：`[任务段] 题目 + 图片 + 已知条件`）。
 *
 * ⚠ **图片只进任务段**。若把图片塞进固定前缀，`promptHash` 会随换图而变，
 * prompt cache 全废、成本翻倍 —— 门禁用例 23 就在钉这一条。
 *
 * @param {{ text: string, images?: ImageInput[] }} input
 * @returns {{ role: 'user', content: string | Array<object> }}
 */
export function buildUserMessage({ text, images = [] }) {
  const hasImages = Array.isArray(images) && images.length > 0;
  if (!hasImages) {
    // 纯文本：**保持 content 为字符串**，这是最兼容的形态（部分端点不接受单元素数组）
    return { role: 'user', content: text };
  }

  const parts = [{ type: 'text', text }];
  for (const image of images) {
    const check = checkImageInput(image);
    if (!check.ok) {
      throw new ModelError({
        kind: 'bad-response',
        message: check.message,
        raw: check.hint,
      });
    }
    parts.push({ type: 'image_url', image_url: { url: toDataURI(image) } });
  }
  return { role: 'user', content: parts };
}

/* ────────────────────────────── 流式调用 ────────────────────────────── */

/** 把 SSE 文本块喂进解析器；返回本次新产生的 delta 列表与"是否结束" */
function createSseParser(onDelta, onReasoning) {
  let buffer = '';
  let done = false;

  function handleEvent(rawEvent) {
    // 一个 SSE 事件可能有多行 `data:`，规范要求拼接；OpenAI 只发一行
    const dataLines = rawEvent
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart());
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n').trim();
    if (payload === '') return;
    if (payload === '[DONE]') {
      done = true;
      return;
    }

    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      // 单个坏事件不应毁掉整条流：跳过并继续（对端偶发心跳/注释行）
      return;
    }

    const choice = json?.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string' && delta.content.length) onDelta(delta.content);
    // 部分端点在开启思考时用 reasoning_content 承载思维链（§11.1 enableThinking）
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length) {
      onReasoning(delta.reasoning_content);
    }
  }

  return {
    /** 喂入一个 chunk（可能含半行），返回是否已收到 [DONE] */
    push(chunkText) {
      buffer += chunkText;
      // SSE 事件以空行分隔；同时容忍 \r\n
      const sepRe = /\r?\n\r?\n/;
      let m;
      while ((m = sepRe.exec(buffer)) !== null) {
        const eventText = buffer.slice(0, m.index);
        buffer = buffer.slice(m.index + m[0].length);
        handleEvent(eventText);
        if (done) return true;
      }
      return done;
    },
    /** 流结束时调用：把残留的缓冲当作最后一个事件处理 */
    flush() {
      if (buffer.trim()) {
        handleEvent(buffer);
        buffer = '';
      }
      return done;
    },
    get done() {
      return done;
    },
  };
}

/**
 * 流式调用 `/chat/completions`。
 *
 * @param {object} opts
 * @param {object} opts.endpoint   端点（§11.1 形状）
 * @param {string|null} opts.apiKey
 * @param {Array<object>} opts.messages
 * @param {(text: string) => void} [opts.onDelta]      正文增量
 * @param {(text: string) => void} [opts.onReasoning]  思维链增量（enableThinking）
 * @param {AbortSignal} [opts.signal]                  外部取消信号
 * @param {boolean} [opts.vision]                      本次是否带图片（决定用 visionModel 还是 defaultModel）
 * @param {object} [opts.extraBody]                    额外请求体字段
 * @param {typeof fetch} [opts.fetchImpl]              可注入（测试用假端点时传）
 * @returns {Promise<{ text: string, reasoning: string, usage: object|null, model: string }>}
 */
export async function streamChatCompletion(opts) {
  const {
    endpoint,
    apiKey,
    messages,
    /** 阶段名（第 8 期）：思考模式**按阶段**开关，例如读图转写不需要思考 */
    stage = null,
    onDelta = () => {},
    onReasoning = () => {},
    signal,
    vision = false,
    extraBody = {},
    fetchImpl = fetch,
  } = opts;

  if (!endpoint) throw new ModelError({ kind: 'unknown', message: '没有可用的端点' });
  const model = pickModel(endpoint, { vision });
  /**
   * ④ **超时分两种**（第 8 期实测：用户跑"分步解析"被误判超时）。
   *
   * 老口径只有一个"总时长 timer"，而 `endpoint.timeoutMs` 默认 60 s ——
   * 一道复杂的题，光"答案抽取"就花了 47.8 s，"分步解析"必然被砍。
   * **长内容本来就要几十秒到几分钟**，用"总时长"去卡它，等于惩罚正常生成。
   *
   * 现在的口径：
   *   · **空闲超时**（idle）：`endpoint.timeoutMs` 现在表示"多久没收到新内容"，
   *     默认 60 s。模型真的卡住/网断了，60 s 内必然没有新数据 ⇒ 快速报错。
   *   · **总时长上限**（total）：`max(10 分钟, idle × 10)`，或显式传 `totalTimeoutMs`。
   *     只是兜底，防止永久挂着。
   * 这样"慢但活着"的生成不会被误杀，"死了但没报错"的连接也能及时发现。
   */
  const idleMs = Number.isInteger(opts.idleTimeoutMs)
    ? opts.idleTimeoutMs
    : Number.isInteger(endpoint.timeoutMs)
      ? endpoint.timeoutMs
      : 120000;
  const totalMs = Number.isInteger(opts.totalTimeoutMs) ? opts.totalTimeoutMs : Math.max(600000, idleMs * 10);

  const controller = new AbortController();
  let timedOut = false;
  let timeoutKind = null;
  const startedAt = Date.now();
  let lastProgressAt = Date.now();

  let timer = null;
  const checkTimeouts = () => {
    const now = Date.now();
    if (now - startedAt > totalMs) {
      timedOut = true;
      timeoutKind = 'total';
      controller.abort();
      return;
    }
    if (now - lastProgressAt > idleMs) {
      timedOut = true;
      timeoutKind = 'idle';
      controller.abort();
      return;
    }
    timer = setTimeout(checkTimeouts, Math.min(1000, Math.max(50, idleMs)));
  };
  timer = setTimeout(checkTimeouts, Math.min(1000, Math.max(50, idleMs)));

  /** 每收到一块数据就"续命"（这就是 idle 超时的实现） */
  const markProgress = () => {
    lastProgressAt = Date.now();
  };
  /** 小数用毫秒显示（门禁里会把预算设得很小，`0 秒` 会误导） */
  const fmtMs = (ms) => (ms < 1000 ? `${ms} 毫秒` : `${Math.round(ms / 1000)} 秒`);
  const timeoutDetail = () =>
    timeoutKind === 'total'
      ? `总时长超过 ${fmtMs(totalMs)} 上限`
      : `超过 ${fmtMs(idleMs)} 没有收到新内容`;

  const secrets = apiKey ? [apiKey] : [];
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  /**
   * ── 思考模式（第 8 期 · 按用户给的 DeepSeek 文档）──
   *
   * 文档口径（OpenAI 兼容格式）：
   *   开：`{"thinking": {"type": "enabled"}}`
   *   强度：`{"reasoning_effort": "low" | "high" | "max"}`
   *   文档还写明"默认打开、默认 high"，但**默认值不可控**（会随服务商/模型变），
   *   所以这里**显式声明**：`enabled` + `high`。
   *
   * 按阶段开关：`read_problem`（读图转写）**不思考** —— 它只是把图上的字抄下来，
   * 思考只会让首字更慢（我们刚为超时踩过坑）。其余阶段全开。
   *
   * ⚠ 兼容性兜底：有些"OpenAI 兼容"网关不认识这两个字段，会返回 400。
   *   那种情况**自动去掉这两个字段重试一次**（下面 non-ok 分支里做），
   *   而不是让用户看到"模型报 400"却不知道是自己网关不认字段。
   */
  const wantThinking = stage !== 'read_problem';
  const thinkingFields = wantThinking ? { thinking: { type: 'enabled' }, reasoning_effort: 'high' } : {};
  let thinkingStripped = false;

  let body = {
    model,
    messages,
    stream: true,
    ...extraBody,
    ...thinkingFields,
  };
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  /**
   * 端点地址容错：**`/v1` 该不该补**。
   *
   * 用户填 `https://api.deepseek.com`，官方文档两种写法都收；
   * 但大量"OpenAI 兼容"网关只认 `{base}/v1/chat/completions`，
   * 填错就是 404 返回一段 HTML ⇒ 我们这边只能报"不符合 OpenAI 兼容格式"，
   * 用户看到的是莫名其妙的一句，根因却是少了个 `/v1`（第 8 期实测踩过）。
   *
   * 所以：先按用户填的打；若是 404/405（典型的"路径不对"），**自动补 `/v1` 重试一次**。
   * 只在路径疑似错误时重试，认证失败（401/403）绝不重试（否则会白打两次并可能触发风控）。
   */
  const baseNoSlash = String(endpoint.baseURL).replace(/\/+$/, '');
  const candidateUrls = /\/(v1|v3|v4)$/i.test(baseNoSlash)
    ? [`${baseNoSlash}/chat/completions`]
    : [`${baseNoSlash}/chat/completions`, `${baseNoSlash}/v1/chat/completions`];

  let response;
  let url = candidateUrls[0];
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
    const kind = classifyFetchError(err, { timedOut });
    throw new ModelError({
      kind,
      message: describeModelError(kind, timedOut ? timeoutDetail() : String(err?.message ?? err)),
      code: err?.cause?.code ?? err?.code,
      raw: redactText(String(err?.message ?? ''), secrets),
    });
  }

  if (!response.ok) {
    const firstStatus = response.status;
    const firstRaw = await response.text().catch(() => '');
    /**
     * 什么时候才值得补 `/v1` 重试？
     *
     * 只有"**看起来是路径不对**"才重试：404/405，或 400 但返回体**不是 JSON**
     * （典型是网关吐了一段 HTML 的 "Cannot POST /chat/completions"）。
     *
     * ⚠ 反过来，如果 400 返回的是**结构化错误**（`{"error":{...}}`），那是对端在说
     * "你的请求内容有问题"（比如这个模型不收图片）—— 再打一次 `/v1` 只会把
     * **真正的错误原因覆盖成 404**，让人更难查（第 8 期实测踩过）。
     */
    const looksStructured = /^\s*[{[]/.test(firstRaw);

    /* ── 兜底一：网关不认识 `thinking` / `reasoning_effort` 字段 ── */
    const mentionsUnknownParam = /unknown|unsupported|invalid|extra|unrecognized|not permitted/i.test(firstRaw);
    if (wantThinking && !thinkingStripped && firstStatus === 400 && looksStructured && mentionsUnknownParam) {
      thinkingStripped = true;
      body = { model, messages, stream: true, ...extraBody };
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onExternalAbort);
        const kind = classifyFetchError(err, { timedOut });
        throw new ModelError({
          kind,
          message: describeModelError(kind, timedOut ? timeoutDetail() : String(err?.message ?? err)),
          raw: redactText(String(err?.message ?? ''), secrets),
        });
      }
      if (!response.ok) {
        const retryStatus = response.status;
        const retryRaw = await response.text().catch(() => '');
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onExternalAbort);
        const kind = classifyHttpStatus(retryStatus);
        throw new ModelError({
          kind,
          message: `${describeModelError(kind, `HTTP ${retryStatus}`)}（该网关不接受"思考模式"字段，已去掉重试仍然失败）`,
          status: retryStatus,
          raw: redactText(retryRaw.slice(0, 800), secrets),
        });
      }
    } else {
      const pathLike = firstStatus === 404 || firstStatus === 405 || (firstStatus === 400 && !looksStructured);
      if (pathLike && candidateUrls.length > 1) {
      /* 换 `/v1` 再试一次（不改 body / 不改 key） */
      url = candidateUrls[1];
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onExternalAbort);
        const kind = classifyFetchError(err, { timedOut });
        throw new ModelError({
          kind,
          message: describeModelError(kind, timedOut ? timeoutDetail() : String(err?.message ?? err)),
          code: err?.cause?.code ?? err?.code,
          raw: redactText(String(err?.message ?? ''), secrets),
        });
      }
      if (!response.ok) {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onExternalAbort);
        const retryRaw = await response.text().catch(() => '');
        const kind = classifyHttpStatus(response.status);
        throw new ModelError({
          kind,
          message: `${describeModelError(kind, `HTTP ${response.status}`)}（已试过 \`/chat/completions\` 与 \`/v1/chat/completions\` 两种路径）`,
          status: response.status,
          raw: redactText(`${firstRaw.slice(0, 300)} … ${retryRaw.slice(0, 500)}`, secrets),
        });
      }
    } else {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
      const kind = classifyHttpStatus(firstStatus);
      throw new ModelError({
        kind,
        message: describeModelError(kind, `HTTP ${firstStatus}`),
        status: firstStatus,
        raw: redactText(firstRaw.slice(0, 800), secrets),
      });
    }
  }
  }

  if (!response.body) {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
    throw new ModelError({
      kind: 'bad-response',
      message: describeModelError('bad-response', '响应没有可读的流'),
    });
  }

  let text = '';
  let reasoning = '';
  const parser = createSseParser(
    (d) => {
      text += d;
      onDelta(d);
    },
    (d) => {
      reasoning += d;
      onReasoning(d);
    },
  );

  const decoder = new TextDecoder('utf-8');
  try {
    for await (const chunk of response.body) {
      /* 收到任何一块数据（哪怕是心跳/角色帧）都算"还活着" ⇒ 续 idle 计时 */
      markProgress();
      const chunkText = decoder.decode(chunk, { stream: true });
      if (parser.push(chunkText)) break;
    }
    parser.flush();
  } catch (err) {
    // ⑤ 连接中途断开：明确诊断，**不静默当成"生成完了"**
    const kind = classifyFetchError(err, { timedOut });
    throw new ModelError({
      kind: kind === 'network' ? 'bad-response' : kind,
      message: describeModelError(
        kind === 'network' ? 'bad-response' : kind,
        /**
         * 中断的原因要**分得清**：是我们的超时把它砍了，还是对端真的断了。
         * 之前统一写成"流在读完之前中断了"，用户完全看不出是"模型慢"还是"网断了"
         * —— 于是只能去调 timeoutMs 试运气（第 8 期用户的真实反应）。
         */
        timedOut ? `${timeoutDetail()}，流被我们主动中止（已收到的文本仍然可用）` : '流在读完之前中断了（已收到的文本仍然可用）',
      ),
      raw: redactText(String(err?.message ?? ''), secrets),
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }

  return { text, reasoning, usage: null, model };
}

/**
 * 非流式便利封装（编排里需要"整段文本"时用；仍复用同一套错误分类）。
 * 注意：本项目主路径是流式（SSE 要逐字上屏），本函数只用于内部小请求与测试。
 */
export async function collectChatCompletion(opts) {
  let text = '';
  let reasoning = '';
  const result = await streamChatCompletion({
    ...opts,
    onDelta: (d) => {
      text += d;
      opts.onDelta?.(d);
    },
    onReasoning: (d) => {
      reasoning += d;
      opts.onReasoning?.(d);
    },
  });
  return { ...result, text, reasoning };
}
