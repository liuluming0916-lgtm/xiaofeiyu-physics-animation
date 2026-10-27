import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chat } from './llm.ts';
import type { ChatMessage, Usage } from './llm.ts';
import { Engine, TOOL_SCHEMAS } from './tools.ts';
import { SYSTEM_PROMPT, userPrompt } from './prompts.ts';
import { wrapWithPlayer, inspectContract } from '../../player/src/export.ts';

export interface RunOptions {
  outDir: string;
  maxWrites?: number;
  timeoutMs?: number;
  /** 题目图片（截图、拍照）；会作为图片消息发过去 */
  images?: string[];
  /** 取消信号（界面上点"取消"时用） */
  signal?: AbortSignal;
  /** 接着上一轮改：带着之前的对话继续，不从头来 */
  resume?: ChatMessage[];
  /** 接着改时，上一轮已经写了几版（用于延续 3 轮上限） */
  startWrites?: number;
  /** 老师打回时写的意见 */
  note?: string;
  onEvent?: (e: { type: string; text: string }) => void;
}

export interface RunResult {
  ok: boolean;
  reason: string;
  outDir: string;
  htmlPath: string;
  writes: number;
  failedChecks: number;
  elapsedMs: number;
  usage: Usage;
  acts: { index: number; title: string; physical: number }[];
  transcript: any[];
}

const ZERO: Usage = { prompt: 0, completion: 0, reasoning: 0, total: 0 };
const addUsage = (a: Usage, b: Usage): Usage => ({
  prompt: a.prompt + b.prompt,
  completion: a.completion + b.completion,
  reasoning: a.reasoning + b.reasoning,
  total: a.total + b.total,
});

/** 早前的关键帧图片换成占位文字：保住上下文，丢掉重复的像素 */
function slimMessages(msgs: ChatMessage[]): ChatMessage[] {
  let lastImageIdx = -1;
  msgs.forEach((m, i) => {
    if (m.role === 'tool' && Array.isArray(m.content) && m.content.some((p: any) => p?.type === 'image_url')) {
      lastImageIdx = i;
    }
  });
  return msgs.map((m, i) => {
    if (m.role !== 'tool' || !Array.isArray(m.content)) return m;
    if (i === lastImageIdx) return m;
    return {
      ...m,
      content: m.content.map((p: any) => (p?.type === 'image_url' ? { type: 'text', text: '［早前的截图已省略］' } : p)),
    };
  });
}

function readSource(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (_) {
    return '';
  }
}

function mediaTypeOf(file: string): string {
  const ext = path.extname(file).toLowerCase().replace('.', '');
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}

/** 文字题 + 图片题：图片直接作为多模态消息发过去 */
function buildUserContent(problem: string, images: string[]): any {
  const text = userPrompt(problem.trim() || '题目见图片。');
  if (!images.length) return text;
  const parts: any[] = [{ type: 'text', text }];
  for (const file of images.slice(0, 4)) {
    try {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${mediaTypeOf(file)};base64,${readFileSync(file).toString('base64')}` },
      });
    } catch (_) {}
  }
  return parts;
}

/**
 * 一次完整的"出题 → 出片"。
 * 只有一轮对话，模型自己在里面写、跑、看、改、交付。
 */
export async function runProblem(problem: string, opts: RunOptions): Promise<RunResult> {
  const t0 = Date.now();
  const maxWrites = opts.maxWrites ?? 4;
  const deadline = t0 + (opts.timeoutMs ?? 20 * 60 * 1000);
  const emit = opts.onEvent ?? (() => {});

  mkdirSync(opts.outDir, { recursive: true });
  const engine = new Engine(opts.outDir);

  const messages: ChatMessage[] = opts.resume?.length
    ? [
        ...opts.resume,
        {
          role: 'user',
          content:
            `老师看了上一版动画，提出意见：${opts.note ?? ''}\n\n` +
            '请在这份代码的基础上修改（不要推倒重来），改完先 write_animation 交完整代码，再 run_checks。',
        },
      ]
    : [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildUserContent(problem, opts.images ?? []),
        },
      ];

  const transcript: any[] = [];
  let usage = ZERO;
  let writes = opts.startWrites ?? 0;
  let failedChecks = 0;
  let done = false;
  let finishSummary = '';
  let reason = '';

  try {
    for (let step = 0; step < 30 && !done; step++) {
      if (opts.signal?.aborted) {
        reason = '已取消';
        break;
      }
      if (Date.now() > deadline) {
        reason = '超时（总时长用尽）';
        break;
      }

      emit({ type: 'think', text: `第 ${step + 1} 步：请求模型…` });
      const waitFrom = Date.now();
      const heartbeat = setInterval(() => {
        if (Date.now() > deadline) return;
        emit({ type: 'wait', text: `还在等模型返回… 已 ${Math.floor((Date.now() - waitFrom) / 1000)} 秒` });
      }, 20000);
      let r: Awaited<ReturnType<typeof chat>>;
      try {
        r = await chat(messages, TOOL_SCHEMAS, {
          timeoutMs: Math.max(60000, Math.min(600000, deadline - Date.now())),
          signal: opts.signal,
          onRetry: (attempt, why) => emit({ type: 'retry', text: `第 ${attempt} 次重试（${why}）` }),
        });
      } finally {
        clearInterval(heartbeat);
      }
      usage = addUsage(usage, r.usage);
      messages.push(r.message);
      transcript.push({
        step,
        elapsedMs: r.elapsedMs,
        usage: r.usage,
        finishReason: r.finishReason,
        reasoning: (r.message.reasoning_content ?? '').slice(0, 2000),
        content: r.message.content,
        toolCalls: r.message.tool_calls?.map((c) => c.function.name) ?? [],
      });

      if (!r.message.tool_calls?.length) {
        // 思考太长被截断：这次没产出任何东西，直接要求它少想多写
        if (r.finishReason === 'length') {
          emit({ type: 'truncated', text: `输出被长度上限截断（思考 ${r.usage.reasoning} tokens），要求直接出码` });
          messages.push({
            role: 'user',
            content:
              '上一轮你的输出被长度上限截断了，没有产出任何内容。' +
              '请大幅精简推理过程，直接调用 write_animation 把完整 HTML 交出来（可以先给一个能跑的版本，后面再改）。',
          });
          continue;
        }
        const text = String(r.message.content ?? '').trim();
        emit({ type: 'say', text: text.slice(0, 200) });
        messages.push({
          role: 'user',
          content: '请不要用文字回复。继续用工具：需要改代码就 write_animation，需要验证就 run_checks，满意就 finish。',
        });
        continue;
      }

      for (const call of r.message.tool_calls) {
        const name = call.function.name;
        let args: any = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch (e) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: '参数不是合法 JSON，请重发。' });
          continue;
        }

        let content: any = '';
        let note = '';

        if (name === 'write_animation') {
          const code = String(args.code ?? '');
          if (!code.includes('<canvas') && !code.includes('<svg')) {
            content = '未通过：没看到 <canvas>。请提交完整的 HTML，包含 1280×720 画布。';
          } else if (writes >= maxWrites) {
            content = `已达返修上限（${maxWrites} 次写入）。请直接调用 finish，或者接受现状。`;
          } else {
            await engine.setCode(code);
            writes++;
            note = String(args.note ?? '');
            const contract = inspectContract(code);
            content =
              `已收到第 ${writes} 版代码（${code.length} 字符）。` +
              `下一步请调用 run_checks 验证；不要用文字描述，直接调工具。` +
              (contract.problems.length ? `\n契约问题：${contract.problems.join('；')}` : '');
            emit({ type: 'write', text: `第 ${writes} 版：${note || '（无说明）'}` });
          }
        } else if (name === 'run_checks') {
          if (!writes) {
            content = '还没提交代码。请先 write_animation。';
          } else {
            const res = await engine.check();
            if (!res.ok) failedChecks++;
            content = res.text;
            emit({ type: 'check', text: res.text.split('\n')[0] ?? '' });
          }
        } else if (name === 'look_at') {
          const shots: { act: number; times: number[] }[] = [];
          if (Array.isArray(args.shots)) {
            for (const s of args.shots) {
              shots.push({ act: Number(s?.act) || 0, times: Array.isArray(s?.times) ? s.times.map(Number) : [] });
            }
          }
          if (!shots.length && Array.isArray(args.times)) shots.push({ act: 0, times: args.times.map(Number) });
          const look = await engine.look(shots);
          content = look.content;
          emit({ type: 'look', text: `看了 ${look.images.length} 帧：${look.images.map((f) => path.basename(f)).join(', ')}` });
        } else if (name === 'finish') {
          const v = await engine.verify(
            Array.isArray(args.checkpoints) ? args.checkpoints : [],
            Array.isArray(args.constraints) ? args.constraints : [],
          );
          if (v.ok) {
            done = true;
            finishSummary = String(args.summary ?? '');
            content = '已交付。';
            emit({ type: 'done', text: `交付：${finishSummary}` });
          } else {
            content = `${v.text}\n\n数值对不上，不能交付。请修正代码后重新 run_checks；如果只是申报值算错了，就改申报值。`;
            emit({ type: 'reject', text: '数值对账未通过' });
          }
        } else {
          content = `未知工具：${name}`;
        }

        messages.push({ role: 'tool', tool_call_id: call.id, content });
        transcript.push({ step, tool: name, argsSummary: name === 'write_animation' ? `${String(args.code ?? '').length} 字符` : JSON.stringify(args).slice(0, 200), result: typeof content === 'string' ? content.slice(0, 1500) : '[图片若干张]' });
      }
    }
  } finally {
    await engine.close();
  }

  if (!reason) {
    reason = done ? '完成' : writes >= maxWrites ? `达到返修上限（${maxWrites} 版）` : '未能交付';
  }

  const htmlPath = path.join(opts.outDir, 'animation.html');
  try {
    const best = engine.lastGoodCode;
    const raw = best || readSource(path.join(opts.outDir, 'current.html'));
    if (raw) writeFileSync(htmlPath, wrapWithPlayer(raw), 'utf8');
  } catch (_) {}

  writeFileSync(
    path.join(opts.outDir, 'run.json'),
    JSON.stringify({ problem, ok: done, reason, writes, failedChecks, usage, elapsedMs: Date.now() - t0, transcript, finishSummary }, null, 2),
    'utf8',
  );

  // 存一份"可接着改"的会话：只保留最近一组截图，早前的图片替换成占位文字（记忆压缩）
  try {
    writeFileSync(path.join(opts.outDir, 'messages.json'), JSON.stringify(slimMessages(messages), null, 0), 'utf8');
  } catch (_) {}

  return {
    ok: done,
    reason,
    outDir: opts.outDir,
    htmlPath,
    writes,
    failedChecks,
    elapsedMs: Date.now() - t0,
    usage,
    acts: engine.actsSnapshot().map((a) => ({ index: a.index, title: a.title, physical: a.physical })),
    transcript,
  };
}
