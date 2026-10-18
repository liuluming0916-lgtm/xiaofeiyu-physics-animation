#!/usr/bin/env node
/**
 * 模型网关取证（第 3 期第 2 步）。
 *
 * 覆盖四块：
 *   『A』端点上配置的**形状补充**（pickModel 的 visionModel 选择）
 *   『B』流式解析：分片到达、跨 chunk 缓冲、[DONE]、reasoning_content
 *   『C』错误分类：401/429/400/5xx、连接失败、超时、取消
 *   『D』图片输入：§16 体积与格式、多模态请求体、**图片不进固定前缀**
 *
 * 全部打**本地假端点**（`tests/fake-endpoint/server.mjs`），因此结论是确定性的。
 *
 * 用法：node tests/gateway-selftest.mjs
 */

import {
  ModelError,
  classifyHttpStatus,
  classifyFetchError,
  streamChatCompletion,
  buildUserMessage,
  checkImageInput,
  pickModel,
  resolveStageEndpoint,
  assertVisionAvailable,
  IMAGE_MAX_BYTES,
  redact,
  redactText,
} from '../core/gateway/index.mjs';
import { startFakeEndpoint } from './fake-endpoint/server.mjs';

let passed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 一份最小端点配置 */
function endpoint(overrides = {}) {
  return {
    id: 'ep_fake',
    displayName: '假端点',
    baseURL: 'http://127.0.0.1:1/v1',
    defaultModel: 'text-model',
    visionModel: 'vision-model',
    apiKeyModelId: null,
    supportsJsonMode: true,
    supportsVision: true,
    enableThinking: false,
    preserveThinking: false,
    timeoutMs: 5000,
    ...overrides,
  };
}

/* ────────────────────── 纯函数部分（不需要服务器） ────────────────────── */

console.log('模型网关取证（第 3 期第 2 步）\n');

console.log('『A』模型选择与脱敏');
check('vision 请求优先用 visionModel', pickModel(endpoint(), { vision: true }) === 'vision-model');
check('纯文本请求用 defaultModel', pickModel(endpoint(), { vision: false }) === 'text-model');
check('未配 visionModel 时回退 defaultModel', pickModel(endpoint({ visionModel: undefined }), { vision: true }) === 'text-model');
check('redact 短 Key 整体打码', redact('short') === '***');
check(
  'redact 长 Key 保留首尾',
  redact('sk-abcdefghijklmnop').startsWith('sk-a') && redact('sk-abcdefghijklmnop').endsWith('mnop'),
);
check(
  'redactText 抹掉已知 Key 字面量',
  !redactText('Authorization: Bearer sk-supersecret123456', ['sk-supersecret123456']).includes('sk-supersecret123456'),
);
check(
  'redactText 兜底抹掉未知 sk- 形态',
  !redactText('key=sk-unknownkeyvalue123').includes('sk-unknownkeyvalue123'),
);

console.log('\n『C-1』HTTP 状态分类（纯函数）');
check('401 → auth', classifyHttpStatus(401) === 'auth');
check('403 → auth', classifyHttpStatus(403) === 'auth');
check('429 → rate-limit', classifyHttpStatus(429) === 'rate-limit');
check('400 → content-refused', classifyHttpStatus(400) === 'content-refused');
check('500 → server', classifyHttpStatus(500) === 'server');
check('504 → timeout', classifyHttpStatus(504) === 'timeout');
check('fetch ENOTFOUND → network', classifyFetchError({ cause: { code: 'ENOTFOUND' } }) === 'network');
check('fetch AbortError（未超时）→ cancelled', classifyFetchError({ name: 'AbortError' }) === 'cancelled');
check('fetch AbortError（超时）→ timeout', classifyFetchError({ name: 'AbortError' }, { timedOut: true }) === 'timeout');

console.log('\n『D-1』图片输入校验（§16）');
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
check('合法 PNG 通过', checkImageInput({ mime: 'image/png', data: pngBytes }).ok);
check('GIF 被拒', !checkImageInput({ mime: 'image/gif', data: pngBytes }).ok);
check('空图片被拒', !checkImageInput({ mime: 'image/png', data: Buffer.alloc(0) }).ok);
check(
  '超过 15 MB 被拒',
  !checkImageInput({ mime: 'image/jpeg', data: Buffer.alloc(IMAGE_MAX_BYTES + 1) }).ok,
);
check('非对象被拒', !checkImageInput('not-an-image').ok);

/* ────────────────────── 阶段解析与 §11.3 视觉门控 ────────────────────── */

console.log('\n『E』阶段 → 端点解析 与 §11.3 视觉门控');
{
  const cfg = (stages, eps) => ({
    endpoints: new Map(eps.map((e) => [e.id, e])),
    stageModels: stages,
    keys: {},
  });

  // 单端点：未配置阶段时自动用它（不必重复配置）
  {
    const c = cfg({}, [endpoint({ id: 'only' })]);
    const r = resolveStageEndpoint(c, 'solve');
    check('单端点时未配置也能解析', r.endpoint.id === 'only');
  }

  // 多端点：未配置就必须报错，**不猜**
  {
    const c = cfg({}, [endpoint({ id: 'a' }), endpoint({ id: 'b' })]);
    let threw = false;
    let code = '';
    try {
      resolveStageEndpoint(c, 'solve');
    } catch (e) {
      threw = true;
      code = e.issues?.[0]?.code ?? '';
    }
    check('多端点未配置时明确报错（不猜）', threw && code === 'stageModels.unassigned', code);
  }

  // 明确配置：用它
  {
    const c = cfg({ solve: 'b' }, [endpoint({ id: 'a' }), endpoint({ id: 'b' })]);
    check('按 stageModels 选中指定端点', resolveStageEndpoint(c, 'solve').endpoint.id === 'b');
  }

  // 未知阶段
  {
    const c = cfg({}, [endpoint({ id: 'a' })]);
    let code = '';
    try {
      resolveStageEndpoint(c, 'not_a_stage');
    } catch (e) {
      code = e.issues?.[0]?.code ?? '';
    }
    check('未知阶段被拒', code === 'stage.unknown', code);
  }

  // Key 复用链
  {
    const c = {
      endpoints: new Map([
        ['owner', endpoint({ id: 'owner' })],
        ['reuse', endpoint({ id: 'reuse', apiKeyModelId: 'owner' })],
      ]),
      stageModels: { solve: 'reuse' },
      keys: { owner: 'sk-from-owner' },
    };
    const r = resolveStageEndpoint(c, 'solve');
    check('Key 沿 apiKeyModelId 链取到真正持 Key 的端点', r.apiKey === 'sk-from-owner', String(r.apiKey));
  }

  // §11.3 门控：不支持视觉 → 禁用 + 文案照原文
  {
    const yes = assertVisionAvailable({ endpoint: endpoint({ supportsVision: true }) });
    check('supportsVision=true → 可用', yes.available === true);

    const no = assertVisionAvailable({ endpoint: endpoint({ supportsVision: false }) });
    check('supportsVision=false → 禁用', no.available === false);
    check(
      '禁用文案逐字对齐 §11.3 原文',
      no.reason === '当前模型不支持图片输入，请更换支持视觉的模型或改为文字输入',
      no.reason,
    );
    check('禁用时给"配图补充描述"兜底建议', typeof no.hint === 'string' && no.hint.includes('配图补充描述'));

    const none = assertVisionAvailable({ endpoint: null });
    check('没有端点时不假装可用', none.available === false);
  }
}

console.log('\n『D-2』消息构造：图片只在任务段');{
  const textOnly = buildUserMessage({ text: '题目' });
  check('无图片时 content 是字符串（最兼容形态）', typeof textOnly.content === 'string');

  const withImage = buildUserMessage({ text: '题目', images: [{ mime: 'image/png', data: pngBytes }] });
  check('有图片时 content 是数组', Array.isArray(withImage.content));
  check('数组第一段是 text', withImage.content[0].type === 'text');
  check('第二段是 image_url', withImage.content[1].type === 'image_url');
  check(
    'image_url 是 data: URI 且 MIME 一致',
    withImage.content[1].image_url.url.startsWith('data:image/png;base64,'),
  );
  const b64 = withImage.content[1].image_url.url.split(',')[1];
  check('base64 解码长度等于原图字节数', Buffer.from(b64, 'base64').length === pngBytes.length);

  let threw = false;
  try {
    buildUserMessage({ text: 'x', images: [{ mime: 'image/gif', data: pngBytes }] });
  } catch (e) {
    threw = e instanceof ModelError;
  }
  check('非法格式在构造消息时即抛 ModelError', threw);
}

/* ────────────────────── 需要假端点的部分 ────────────────────── */

const fake = await startFakeEndpoint({ reply: ['第', '一', '段', '回', '复'], chunkDelayMs: 0 });

try {
  console.log('\n『B』流式解析');
  {
    const deltas = [];
    const result = await streamChatCompletion({
      endpoint: endpoint({ baseURL: fake.baseURL }),
      apiKey: 'sk-fake',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: (d) => deltas.push(d),
    });
    check('正文拼接正确', result.text === '第一段回复', `实际 ${JSON.stringify(result.text)}`);
    check('onDelta 被逐片调用（不是一次性）', deltas.length === 5, `实际 ${deltas.length} 片`);
    check('每片都是非空字符串', deltas.every((d) => typeof d === 'string' && d.length > 0));
    check('请求发到了 /v1/chat/completions', fake.requests[0].path === '/v1/chat/completions', fake.requests[0].path);
    check('请求体带 stream:true', fake.requests[0].body.stream === true);
    check('请求体带 model', fake.requests[0].body.model === 'text-model');
    check(
      'Authorization 头按 Bearer 发送',
      fake.requests[0].headers.authorization === 'Bearer sk-fake',
    );
  }

  console.log('\n『B-2』跨 chunk 缓冲（半行/半事件）');
  {
    // 直接喂一个"把事件从中间切开"的流：用假端点 + 极小 delay 无法精确控制，
    // 因此这里换一条路 —— 用自定义 fetchImpl 精确注入分片。
    const makeStreamingFetch = (pieces) => async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          for (const p of pieces) controller.enqueue(encoder.encode(p));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };

    const evt = (s) => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`;
    const full = evt('AB') + evt('CD') + 'data: [DONE]\n\n';
    // 在"事件中间"和"JSON 中间"都切开
    const pieces = [full.slice(0, 12), full.slice(12, 30), full.slice(30, 41), full.slice(41)];

    const out = [];
    const res = await streamChatCompletion({
      endpoint: endpoint({ baseURL: 'http://127.0.0.1:1/v1' }),
      apiKey: null,
      messages: [],
      onDelta: (d) => out.push(d),
      fetchImpl: makeStreamingFetch(pieces),
    });
    check('被切碎的事件仍能正确还原', res.text === 'ABCD', `实际 ${JSON.stringify(res.text)}`);
    check('分片数正确（2 个事件）', out.length === 2, `实际 ${out.length}`);
  }

  console.log('\n『B-3』reasoning_content（§11.1 enableThinking）');
  {
    const fake2 = await startFakeEndpoint({ reply: ['答'], reasoning: '先想一下' });
    const reasons = [];
    const r = await streamChatCompletion({
      endpoint: endpoint({ baseURL: fake2.baseURL }),
      apiKey: null,
      messages: [],
      onReasoning: (d) => reasons.push(d),
    });
    check('正文与思维链分流', r.text === '答' && r.reasoning === '先想一下');
    check('onReasoning 被调用', reasons.join('') === '先想一下');
    await fake2.close();
  }

  console.log('\n『C-2』错误分类（走真实 HTTP）');
  const expectKind = async (name, configure, expectedKind, patch = {}) => {
    const f = await startFakeEndpoint({});
    f.configure(configure);
    let kind = null;
    let hint = '';
    try {
      await streamChatCompletion({
        endpoint: endpoint({ baseURL: f.baseURL, ...patch }),
        apiKey: null,
        messages: [],
      });
    } catch (e) {
      kind = e.kind;
      hint = e.hint ?? '';
    }
    await f.close();
    check(`${name} → ${expectedKind}`, kind === expectedKind, `实际 ${kind}`);
    return hint;
  };

  await expectKind('401', { status: 401 }, 'auth');
  await expectKind('403', { status: 403 }, 'auth');
  await expectKind('429', { status: 429 }, 'rate-limit');
  await expectKind('400', { status: 400 }, 'content-refused');
  await expectKind('500', { status: 500 }, 'server');

  // 连不上：用一个**确定没人监听**的端口
  {
    let kind = null;
    try {
      await streamChatCompletion({
        endpoint: endpoint({ baseURL: 'http://127.0.0.1:9/v1' }),
        apiKey: null,
        messages: [],
      });
    } catch (e) {
      kind = e.kind;
    }
    check('连接被拒 → network', kind === 'network', `实际 ${kind}`);
  }

  console.log('\n『C-3』超时与取消是两条不同路径');
  {
    const f = await startFakeEndpoint({ hang: true });
    // 超时：端点 timeoutMs 极小
    let kind = null;
    try {
      await streamChatCompletion({
        endpoint: endpoint({ baseURL: f.baseURL, timeoutMs: 1000 }),
        apiKey: null,
        messages: [],
      });
    } catch (e) {
      kind = e.kind;
    }
    check('超时 → timeout', kind === 'timeout', `实际 ${kind}`);

    // 取消：外部 signal
    const ac = new AbortController();
    const p = streamChatCompletion({
      endpoint: endpoint({ baseURL: f.baseURL, timeoutMs: 60000 }),
      apiKey: null,
      messages: [],
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 60);
    let cancelledKind = null;
    try {
      await p;
    } catch (e) {
      cancelledKind = e.kind;
    }
    check('外部取消 → cancelled（不是错误）', cancelledKind === 'cancelled', `实际 ${cancelledKind}`);
    await f.close();
  }

  console.log('\n『C-4』流被截断不能静默当成"生成完了"');
  {
    const f = await startFakeEndpoint({ reply: ['一', '二', '三', '四'], chunkDelayMs: 10, abortMidStream: true });
    let kind = null;
    let partial = '';
    try {
      await streamChatCompletion({
        endpoint: endpoint({ baseURL: f.baseURL }),
        apiKey: null,
        messages: [],
        onDelta: (d) => {
          partial += d;
        },
      });
    } catch (e) {
      kind = e.kind;
    }
    check('中途断开 → bad-response', kind === 'bad-response', `实际 ${kind}`);
    check('已收到的部分文本存在（可用于诊断）', partial.length > 0, `实际 ${JSON.stringify(partial)}`);
    await f.close();
  }

  console.log('\n『D-3』多模态请求体真的送达了（假端点如实回报）');
  {
    const f = await startFakeEndpoint({ reply: ['ok'] });
    await streamChatCompletion({
      endpoint: endpoint({ baseURL: f.baseURL }),
      apiKey: null,
      messages: [buildUserMessage({ text: '看图', images: [{ mime: 'image/png', data: pngBytes }] })],
      vision: true,
    });
    const sent = f.requests[0].body;
    check('请求用了 visionModel', sent.model === 'vision-model', sent.model);
    const content = sent.messages[0].content;
    check('content 是数组', Array.isArray(content));
    check(
      '图片段是 image_url 且 MIME 一致',
      content.some((p) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/png;base64,')),
    );
    check('text 段包含题面', content[0].type === 'text' && content[0].text === '看图');
    await f.close();
  }
} finally {
  await fake.close();
}

/* ────────────────────── 汇总 ────────────────────── */

console.log(`\n${failures.length ? '✗' : '✓'} 模型网关取证：通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
  process.exitCode = 1;
}
