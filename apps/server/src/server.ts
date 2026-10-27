import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync, readFile, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv, cfg, apiUrl, configSummary, saveConfigFile } from '../../../packages/agent/src/config.ts';
import { runProblem } from '../../../packages/agent/src/loop.ts';

loadEnv();

const PORT = Number(process.env.XFY_PORT ?? 8787);
const ROOT = process.cwd();
const WEB_DIR = path.join(ROOT, 'apps', 'web');
const OUT_ROOT = path.join(ROOT, '开源日志', 'web');
mkdirSync(OUT_ROOT, { recursive: true });

interface Job {
  id: string;
  state: 'running' | 'done' | 'failed' | 'canceled';
  events: { type: string; text: string; at: number }[];
  outDir: string;
  abort: AbortController;
  result?: any;
  startedAt: number;
}

const jobs = new Map<string, Job>();

function json(res: http.ServerResponse, code: number, body: any) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 40 * 1024 * 1024) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveFile(res: http.ServerResponse, file: string) {
  if (!existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(readFileSync(file));
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function startJob(body: any): Promise<Job> {
  const id = randomUUID().slice(0, 8);
  const outDir = path.join(OUT_ROOT, `${stamp()}-${id}`);
  mkdirSync(outDir, { recursive: true });

  const images: string[] = [];
  const allImages = [...((body.images ?? []) as any[]), ...((body.solutionImages ?? []) as any[])];
  for (const [i, img] of allImages.entries()) {
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(String(img.data ?? ''));
    if (!m) continue;
    const file = path.join(outDir, `input-${i + 1}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
    writeFileSync(file, Buffer.from(m[2], 'base64'));
    images.push(file);
  }

  let text = String(body.text ?? '').trim();
  const solution = String(body.solution ?? '').trim();
  const note = String(body.note ?? '').trim();
  if (solution) {
    text += `\n\n【参考答案与解析（以此为准，不要另行推导，按它来画）】\n${solution}`;
  }
  if (note) {
    text += `\n\n【教师对上一版的意见】\n${note}`;
  }

  const job: Job = {
    id,
    state: 'running',
    events: [],
    outDir,
    abort: new AbortController(),
    startedAt: Date.now(),
  };
  jobs.set(id, job);

  const push = (type: string, text: string) => {
    job.events.push({ type, text, at: Date.now() });
  };
  push('start', `开始生成（${images.length ? `${images.length} 张图片 + ` : ''}文字）`);

  runProblem(text, {
    outDir,
    images,
    signal: job.abort.signal,
    onEvent: (e) => push(e.type, e.text),
  })
    .then((r) => {
      job.state = r.ok ? 'done' : 'failed';
      job.result = {
        ok: r.ok,
        reason: r.reason,
        writes: r.writes,
        usage: r.usage,
        elapsedMs: r.elapsedMs,
        acts: r.acts,
        outDir: r.outDir,
      };
      push('end', `${r.ok ? '交付成功' : '未交付'}：${r.reason}`);
    })
    .catch((e) => {
      job.state = 'failed';
      job.result = { ok: false, reason: String(e?.message ?? e) };
      push('end', `出错：${e?.message ?? e}`);
    });

  return job;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;

  try {
    if (p === '/' || p === '/index.html') {
      return serveFile(res, path.join(WEB_DIR, 'index.html'));
    }
    if (p.startsWith('/web/')) {
      return serveFile(res, path.join(WEB_DIR, p.slice(5)));
    }
    if (p.startsWith('/assets/')) {
      const file = path.normalize(path.join(WEB_DIR, p.slice(1)));
      if (!file.startsWith(WEB_DIR)) return json(res, 403, { error: 'forbidden' });
      return serveFile(res, file);
    }
    if (p === '/api/health') {
      return json(res, 200, { ok: true, model: cfg.model, thinking: cfg.thinking });
    }
    if (p === '/api/config') {
      if (req.method === 'GET') return json(res, 200, configSummary());
      if (req.method === 'POST') {
        const body = await readBody(req);
        saveConfigFile({
          apiBase: body.apiBase,
          model: body.model,
          thinking: body.thinking,
          apiKey: body.apiKey,
        });
        return json(res, 200, configSummary());
      }
    }
    if (p === '/api/test' && req.method === 'POST') {
      const t0 = Date.now();
      try {
        const r = await fetch(apiUrl('models'), {
          headers: { authorization: `Bearer ${cfg.apiKey}` },
          signal: AbortSignal.timeout(20000),
        });
        const j: any = await r.json();
        const list = (j.data ?? []).map((m: any) => ({
          id: m.id,
          name: m.name ?? m.id,
          vision: (m.input_modalities ?? []).includes('image'),
          context: m.context_window ?? null,
          effort: m.effort?.supported_levels ?? null,
        }));
        const mine = list.find((m: any) => m.id === cfg.model) ?? null;
        return json(res, 200, { ok: r.ok, ms: Date.now() - t0, models: list.slice(0, 12), current: mine });
      } catch (e: any) {
        return json(res, 200, { ok: false, error: String(e?.message ?? e) });
      }
    }
    if (p === '/api/generate' && req.method === 'POST') {
      const body = await readBody(req);
      const job = await startJob(body);
      return json(res, 200, { id: job.id, outDir: job.outDir });
    }
    const m = /^\/api\/jobs\/([\w-]+)(\/.*)?$/.exec(p);
    if (m) {
      const job = jobs.get(m[1]);
      if (!job) return json(res, 404, { error: 'job not found' });
      const rest = m[2] ?? '';

      if (rest === '' || rest === '/') {
        return json(res, 200, {
          id: job.id,
          state: job.state,
          events: job.events,
          result: job.result,
          elapsedMs: Date.now() - job.startedAt,
        });
      }
      if (rest === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        let sent = 0;
        const timer = setInterval(() => {
          while (sent < job.events.length) {
            res.write(`data: ${JSON.stringify(job.events[sent++])}\n\n`);
          }
          if (job.state !== 'running') {
            res.write(`event: end\ndata: ${JSON.stringify({ state: job.state })}\n\n`);
            clearInterval(timer);
            res.end();
          }
        }, 400);
        req.on('close', () => clearInterval(timer));
        return;
      }
      if (rest === '/cancel') {
        job.abort.abort();
        job.state = 'canceled';
        return json(res, 200, { ok: true });
      }
      if (rest === '/artifact') {
        return serveFile(res, path.join(job.outDir, 'animation.html'));
      }
      if (rest.startsWith('/shots/')) {
        return serveFile(res, path.join(job.outDir, 'shots', path.basename(rest)));
      }
      return json(res, 404, { error: 'unknown' });
    }

    return json(res, 404, { error: 'not found' });
  } catch (e: any) {
    return json(res, 500, { error: String(e?.message ?? e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`小肥鱼 2.0 界面：http://127.0.0.1:${PORT}`);
  console.log(`模型：${cfg.model}（思考 ${cfg.thinking}）`);
});
