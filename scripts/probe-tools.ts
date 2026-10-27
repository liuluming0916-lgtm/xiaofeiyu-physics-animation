/**
 * 探路 2：工具调用、工具结果里带图片、reasoning_effort 的取值。
 */
import { loadEnv, apiUrl, cfg } from '../packages/agent/src/config.ts';

loadEnv();
const H = { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` };

async function post(label: string, body: any) {
  const t0 = Date.now();
  const res = await fetch(apiUrl('chat/completions'), {
    method: 'POST',
    headers: H,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const json: any = await res.json().catch(() => ({}));
  console.log(`\n[${label}] ${res.status} ${Date.now() - t0}ms`);
  if (!res.ok) {
    console.log(JSON.stringify(json).slice(0, 500));
    return null;
  }
  const msg = json.choices?.[0]?.message;
  console.log('  content:', JSON.stringify(msg?.content ?? null)?.slice(0, 160));
  console.log('  tool_calls:', JSON.stringify(msg?.tool_calls ?? null)?.slice(0, 300));
  console.log('  reasoning:', String(msg?.reasoning_content ?? '').slice(0, 80).replace(/\n/g, ' '));
  return msg;
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'write_animation',
      description: '提交/更新完整的动画网页源码',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: '完整的 HTML 源码' } },
        required: ['code'],
      },
    },
  },
];

const first = await post('工具调用', {
  model: cfg.model,
  messages: [{ role: 'user', content: '请调用 write_animation 工具，把 code 写成 "<h1>hi</h1>"。不要解释。' }],
  tools,
  tool_choice: 'auto',
  max_tokens: 800,
});

if (first?.tool_calls?.length) {
  const call = first.tool_calls[0];
  const png1x1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await post('工具结果带图片（数组内容）', {
    model: cfg.model,
    messages: [
      { role: 'user', content: '请调用 write_animation 工具，把 code 写成 "<h1>hi</h1>"。不要解释。' },
      first,
      {
        role: 'tool',
        tool_call_id: call.id,
        content: [
          { type: 'text', text: '已收到。下面是沙盒截的一张图：' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${png1x1}` } },
        ],
      },
      { role: 'user', content: '截图里是什么？只回一个词。' },
    ],
    tools,
    max_tokens: 400,
  });
} else {
  console.log('\n（模型没有发起工具调用，后面的测试跳过）');
}

await post('reasoning_effort=max', {
  model: cfg.model,
  messages: [{ role: 'user', content: '只回两个字：收到' }],
  max_tokens: 200,
  reasoning_effort: 'max',
});
