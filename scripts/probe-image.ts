/**
 * 单次探路：把"图片题 + 系统提示"直接发一次，看模型到底返回了什么。
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { loadEnv, apiUrl, cfg } from '../packages/agent/src/config.ts';
import { SYSTEM_PROMPT } from '../packages/agent/src/prompts.ts';

loadEnv();
const img = readFileSync(path.resolve(process.argv[2] ?? 'test-question.png')).toString('base64');
const maxTokens = Number(process.argv[3] ?? 32000);

const body: any = {
  model: cfg.model,
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: '题目见图片。请开始，第一步调用 write_animation 交出完整代码。' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } },
      ],
    },
  ],
  max_tokens: maxTokens,
  reasoning_effort: cfg.thinking,
};

const t0 = Date.now();
const res = await fetch(apiUrl('chat/completions'), {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(600000),
});
const json: any = await res.json();
const msg = json.choices?.[0]?.message ?? {};
console.log('status', res.status, 'ms', Date.now() - t0, 'finish', json.choices?.[0]?.finish_reason);
console.log('usage', JSON.stringify(json.usage));
console.log('content len', String(msg.content ?? '').length);
console.log('reasoning len', String(msg.reasoning_content ?? '').length);
console.log('tool_calls', JSON.stringify(msg.tool_calls)?.slice(0, 300));
console.log('content head', JSON.stringify(String(msg.content ?? '').slice(0, 200)));
console.log('reasoning tail', JSON.stringify(String(msg.reasoning_content ?? '').slice(-300)));
