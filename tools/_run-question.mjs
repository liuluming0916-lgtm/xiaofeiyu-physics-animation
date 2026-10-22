#!/usr/bin/env node
/**
 * _run-question —— 把 `tests/real-exam/pilot.json` 里的任意一道题真跑一遍 v6 链路。
 *
 * 为什么有它：`_run-q04.mjs` / `_run-q06.mjs` 都把题号写死了，做 q09 时又得复制一份。
 * 这里按 id 取题面、原图、教师答案，产物统一落到 `tests/reports/<id>-model.*`。
 *
 * 用法：
 *   node tools/_run-question.mjs q09
 *   node tools/_run-question.mjs q09 --no-reference     # 不喂教师答案，量模型自己解
 *   node tools/_run-question.mjs q09 --devmode          # 不拦门禁，只看产物
 *
 * 前提：本机规则服务在跑（`node tools/rules-service.mjs --port 8123`）。
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';

const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith('--'));
const useReference = !argv.includes('--no-reference');
const devMode = argv.includes('--devmode');
const port = Number(process.env.OD_PORT ?? 8123);
if (!id) {
  console.error('用法：node tools/_run-question.mjs <q04|q06|q09> [--no-reference] [--devmode]');
  process.exit(2);
}

const q = JSON.parse(readFileSync('tests/real-exam/pilot.json', 'utf8')).items.find((x) => x.id === id);
if (!q) throw new Error(`pilot.json 里没有 ${id}`);

const b64 = readFileSync(`tests/real-exam/${q.image}`).toString('base64');
const reference = useReference
  ? [
      '参考答案（试卷）',
      ...(q.answer ?? []).map((a, i) => `${i + 1}. ${a}`),
      q.answerNote ? `备注：${q.answerNote}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  : null;

const body = JSON.stringify({
  problem: { text: q.problem },
  images: [{ mime: 'image/png', dataUrl: `data:image/png;base64,${b64}`, name: `${id}.png` }],
  ...(reference ? { reference: { text: reference } } : {}),
  devMode,
});

const logPath = `tests/reports/${id}-model.log`;
const textPath = `tests/reports/${id}-model-text.log`;
appendFileSync(logPath, `\n==== START ${new Date().toISOString()} ref=${useReference} dev=${devMode} ====\n`);

const events = [];
const lines = [];

const req = http.request(
  {
    host: '127.0.0.1',
    port,
    path: '/api/run',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  },
  (res) => {
    if (res.statusCode !== 200) {
      let txt = '';
      res.on('data', (c) => (txt += c));
      res.on('end', () => {
        appendFileSync(logPath, `HTTP ${res.statusCode} ${txt.slice(0, 4000)}\n`);
        process.exit(1);
      });
      return;
    }
    res.setEncoding('utf8');
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        if (!data) continue;
        let ev;
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        events.push(ev);
        /* 增量落盘：服务端中途 reset 时，模型原文不至于全丢 */
        if (ev.type === 'stage_delta' && ev.text) {
          appendFileSync(textPath, `\n---- ${ev.stage}${ev.round ? `:r${ev.round}` : ''} ----\n${ev.text}`);
        }
        if (ev.type === 'stage_done' && ev.stage) {
          appendFileSync(textPath, `\n==== ${ev.stage} done (${ev.chars ?? 0} chars) ====\n`);
        }
        const bits = [ev.type];
        if (ev.stage) bits.push(ev.stage);
        if (ev.verdict) bits.push(`verdict=${ev.verdict}`);
        if (ev.type === 'dryrun_done') {
          bits.push(`frames=${ev.frameCount}`);
          const bad = (ev.checks ?? []).filter((c) => c.status !== 'pass');
          bits.push(`bad=${bad.map((c) => `${c.id}:${c.status}`).join('|') || '-'}`);
        }
        if (ev.type === 'repair_round') bits.push(`round=${ev.round} mode=${ev.mode ?? '?'}`);
        if (ev.type === 'coupling_done') bits.push(`fallback=${ev.fallback}`);
        if (ev.type === 'stage_error') bits.push(JSON.stringify(ev.error ?? {}).slice(0, 300));
        if (ev.type === 'judgement_done') bits.push(`elements=${(ev.elements ?? []).join(',')} scenes=${(ev.scenes ?? []).join(',')}`);
        const line = bits.join(' · ');
        lines.push(line);
        appendFileSync(logPath, line + '\n');
      }
    });
    res.on('end', () => {
      writeFileSync(`tests/reports/${id}-model-events.json`, JSON.stringify(events, null, 2));
      writeFileSync(`tests/reports/${id}-model-summary.txt`, lines.join('\n'));
      const dryrun = [...events].reverse().find((e) => e.type === 'dryrun_done');
      const coupling = [...events].reverse().find((e) => e.type === 'coupling_done');
      if (dryrun?.program?.slots) {
        writeFileSync(
          `tests/reports/${id}-model.program.json`,
          JSON.stringify(
            {
              id,
              index: q.number,
              title: q.title,
              mode: 'BOTH',
              slots: dryrun.program.slots,
              stepTimes: coupling?.stepTimes ?? null,
              provenance: dryrun.program.provenance ?? null,
              source: 'model',
            },
            null,
            2,
          ),
        );
      }
      appendFileSync(logPath, `==== END ${new Date().toISOString()} ====\n`);
      console.log(lines.slice(-14).join('\n'));
      console.log(`events=${events.length}`);
    });
    res.on('error', (e) => appendFileSync(logPath, `RESERR ${e.message}\n`));
  },
);

req.on('error', (e) => {
  appendFileSync(logPath, `REQERR ${e.message}\n`);
  console.error(`连不上 127.0.0.1:${port}（规则服务没开？）: ${e.message}`);
  process.exit(1);
});
req.setTimeout(0);
req.write(body);
req.end();
