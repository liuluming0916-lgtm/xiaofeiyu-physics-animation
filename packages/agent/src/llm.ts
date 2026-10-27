import { apiUrl, cfg } from './config.ts';

export interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: any;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

export interface Usage {
  prompt: number;
  completion: number;
  reasoning: number;
  total: number;
}

export interface ChatResult {
  message: ChatMessage;
  usage: Usage;
  elapsedMs: number;
  finishReason: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RETRY_DELAYS = [2000, 6000, 15000];

/**
 * 一次对话调用。带重试：网络抖动 / 429 / 5xx 都重试，其余错误直接抛。
 * 思考强度由 XFY_THINKING 控制（low / high / max）。
 */
export async function chat(
  messages: ChatMessage[],
  tools: any[],
  opts: { maxTokens?: number; timeoutMs?: number; signal?: AbortSignal; onRetry?: (attempt: number, reason: string) => void } = {},
): Promise<ChatResult> {
  const body: any = {
    model: cfg.model,
    messages: messages.map((m) => {
      if (m.role === 'assistant') {
        const out: any = { role: 'assistant', content: m.content ?? '' };
        if (m.tool_calls?.length) out.tool_calls = m.tool_calls;
        return out;
      }
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
      return { role: m.role, content: m.content };
    }),
    max_tokens: opts.maxTokens ?? 128000,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  if (cfg.thinking && cfg.thinking !== 'off') body.reasoning_effort = cfg.thinking;

  const url = apiUrl('chat/completions');
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const t0 = Date.now();
    try {
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? 600000);
      const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`接口 ${res.status}：${text.slice(0, 200)}`);
        if (attempt < RETRY_DELAYS.length) {
          opts.onRetry?.(attempt + 1, `接口 ${res.status}`);
          await sleep(RETRY_DELAYS[attempt]);
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) throw new Error(`接口 ${res.status}：${text.slice(0, 400)}`);

      const json: any = JSON.parse(text);
      const choice = json.choices?.[0];
      const msg = choice?.message ?? {};
      const u = json.usage ?? {};
      return {
        message: {
          role: 'assistant',
          content: msg.content ?? '',
          tool_calls: msg.tool_calls ?? undefined,
          reasoning_content: msg.reasoning_content ?? undefined,
        },
        usage: {
          prompt: u.prompt_tokens ?? 0,
          completion: u.completion_tokens ?? 0,
          reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0,
          total: u.total_tokens ?? 0,
        },
        elapsedMs: Date.now() - t0,
        finishReason: choice?.finish_reason ?? '',
      };
    } catch (e: any) {
      if (opts.signal?.aborted) throw new Error('已取消');
      // 超时不重试：模型已经算了很久，重发只会再烧一遍钱
      if (e?.name === 'TimeoutError') {
        const sec = Math.round((opts.timeoutMs ?? 600000) / 1000);
        throw new Error(`模型 ${sec} 秒还没有返回，判定超时（没有重试，避免重复计费）。`);
      }
      lastErr = e;
      if (attempt < RETRY_DELAYS.length) {
        opts.onRetry?.(attempt + 1, String(e?.message ?? e).slice(0, 120));
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
