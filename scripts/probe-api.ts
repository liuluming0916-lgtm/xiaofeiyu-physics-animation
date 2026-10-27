/**
 * 接口探路：确认 地址 / 模型名 / 鉴权 / 推理强度参数 / 是否收图片。
 * 只打印状态码与回包片段，不打印密钥。
 */
import { loadEnv, apiUrl, cfg } from '../packages/agent/src/config.ts';

loadEnv();
const key = cfg.apiKey;
console.log('配置：', { base: cfg.apiBase, model: cfg.model, thinking: cfg.thinking, vision: cfg.vision, key: key ? `已填（${key.slice(0, 4)}…${key.slice(-4)}）` : '缺失' });

const H = { 'content-type': 'application/json', authorization: `Bearer ${key}` };

async function call(label: string, url: string, init: RequestInit, timeout = 90000) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    const text = await res.text();
    console.log(`\n[${label}] ${res.status} ${Date.now() - t0}ms`);
    console.log(text.slice(0, 600));
    return { ok: res.ok, status: res.status, text };
  } catch (e: any) {
    console.log(`\n[${label}] 失败：${e?.message ?? e}`);
    return { ok: false, status: 0, text: '' };
  }
}

const base = cfg.apiBase.replace(/\/+$/, '');

// 1) 列模型
await call('GET /models', `${base}/models`, { headers: H }, 30000);

// 2) 最小对话
await call(
  'chat 最小',
  apiUrl('chat/completions'),
  {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: '只回两个字：收到' }], max_tokens: 20, stream: false }),
  },
);

// 3) 推理强度 reasoning_effort
await call(
  'chat reasoning_effort=high',
  apiUrl('chat/completions'),
  {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: '只回两个字：收到' }],
      max_tokens: 20,
      reasoning_effort: 'high',
    }),
  },
);

// 4) thinking 开关（另一派写法）
await call(
  'chat thinking={enabled}',
  apiUrl('chat/completions'),
  {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: '只回两个字：收到' }],
      max_tokens: 20,
      thinking: { type: 'enabled' },
    }),
  },
);

// 5) 图片输入
const png1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
await call(
  'chat 图片',
  apiUrl('chat/completions'),
  {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '这张图是什么颜色？只回一个词。' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${png1x1}` } },
          ],
        },
      ],
      max_tokens: 30,
    }),
  },
);
