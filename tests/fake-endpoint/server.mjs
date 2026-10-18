/**
 * 本地假端点：一个 OpenAI 兼容的 `/chat/completions` 服务（**测试与开发专用**）。
 *
 * 为什么必须有它（**假端点进门禁、真端点进观测**）：
 *   真实模型的输出**不可重复** ⇒ 如果门禁直接打真端点，就会变成"随机绿/随机红"，等于没有门禁。
 *   假端点让"链路正确性"变成**确定性**的，与"生成质量"彻底解耦：
 *     · 门禁（确定性）：SSE 时序、取消、错误分类、图片是否正确编码送达、Prompt 组装、清洗切分…
 *     · 观测（非确定性）：真端点的生成质量，人工看，**不进门禁**。
 *
 * ⚠ 它**不"看懂"图片**（那是模型的能力，桩服务不该假装具备）。
 *   它的职责是**如实回报收到了什么**：把收到的请求体存下来，供门禁用例断言。
 *
 * 用法（测试里）：
 *   const fake = await startFakeEndpoint({ reply: ['你', '好'] });
 *   ... 调完 ...
 *   fake.requests[0].body      // 收到的请求体
 *   await fake.close();
 */

import { createServer } from 'node:http';

/**
 * @typedef {object} FakeEndpointOptions
 * @property {string|string[]} [reply]   要吐的正文。数组＝按"逐 delta"分片（用于验证流式不是一次性返回）
 * @property {number} [chunkDelayMs]     每个 delta 之间的延时（让"流式"可被观察到）
 * @property {string} [reasoning]        若提供，同时发 `reasoning_content`
 * @property {number} [status]           非 200 时直接返回该状态（测错误分类）
 * @property {string} [errorBody]        非 200 时的响应体
 * @property {boolean} [abortMidStream]  吐一半后直接销毁连接（测"流被截断"）
 * @property {boolean} [hang]            一直不结束（测超时/取消）
 * @property {number} [model]            记录用；回包里的 model 字段
 */

/** 把一个正文按"每 N 字一片"切开，模拟真实的逐 token 到达 */
function splitReply(reply) {
  if (Array.isArray(reply)) return reply;
  const text = String(reply ?? '');
  if (!text) return [];
  // 默认按 3 个字符一片：既能被观察到"分片到达"，又不至于太慢
  const out = [];
  for (let i = 0; i < text.length; i += 3) out.push(text.slice(i, i + 3));
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动假端点。
 * @param {FakeEndpointOptions} [opts]
 * @returns {Promise<{ port: number, baseURL: string, requests: Array<{path:string, headers:object, body:any}>, close: () => Promise<void>, setReply: (r: string|string[]) => void, clear: () => void }>}
 */
export async function startFakeEndpoint(opts = {}) {
  /** @type {Array<{path:string, headers:object, body:any, rawBody:string}>} */
  const requests = [];
  let replySpec = opts.reply ?? ['测试', '回复'];
  let status = opts.status ?? 200;
  let errorBody = opts.errorBody ?? '';
  let chunkDelayMs = opts.chunkDelayMs ?? 0;
  let abortMidStream = Boolean(opts.abortMidStream);
  let hang = Boolean(opts.hang);

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try {
        body = JSON.parse(rawBody);
      } catch {
        /* 非 JSON 请求体（探针用）保持 null */
      }
      requests.push({ path: req.url ?? '', headers: req.headers, body, rawBody });

      if (status !== 200) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(errorBody || JSON.stringify({ error: { message: 'fake error', type: 'fake' } }));
        return;
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      const deltas = splitReply(replySpec);
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

      const emit = async (content, field = 'content') => {
        send({
          id: 'fake-1',
          object: 'chat.completion.chunk',
          model: opts.model ?? 'fake-model',
          choices: [{ index: 0, delta: { [field]: content }, finish_reason: null }],
        });
      };

      for (let i = 0; i < deltas.length; i += 1) {
        if (chunkDelayMs) await sleep(chunkDelayMs);
        await emit(deltas[i]);
        if (abortMidStream && i === Math.floor(deltas.length / 2)) {
          // 模拟"连接中途断开"：不写 [DONE]，直接销毁
          res.destroy();
          return;
        }
      }
      if (opts.reasoning) await emit(opts.reasoning, 'reasoning_content');

      if (hang) {
        // 保持连接开着：调用方应当超时或取消
        return;
      }

      send({
        id: 'fake-1',
        object: 'chat.completion.chunk',
        model: opts.model ?? 'fake-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      });
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    port,
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
    setReply: (r) => {
      replySpec = r;
    },
    /** 测试之间重置状态：清请求记录并恢复默认可控行为 */
    clear: () => {
      requests.length = 0;
      status = 200;
      errorBody = '';
      abortMidStream = false;
      hang = false;
      chunkDelayMs = 0;
    },
    /** 允许测试在运行中切换为故障模式 */
    configure: (next = {}) => {
      if ('status' in next) status = next.status;
      if ('errorBody' in next) errorBody = next.errorBody;
      if ('reply' in next) replySpec = next.reply;
      if ('chunkDelayMs' in next) chunkDelayMs = next.chunkDelayMs;
      if ('abortMidStream' in next) abortMidStream = next.abortMidStream;
      if ('hang' in next) hang = next.hang;
    },
  };
}
