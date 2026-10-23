#!/usr/bin/env node
/**
 * _run-q06 —— 把真题 q06 真的跑一遍 v6 链路（模型产出，不是手写）。
 *
 * 为什么要单独一份：q06 的"金标准"定义是**模型产出 + 人工验收**（用户 2026-10-23 裁决 1b），
 * 而 `tests/real-exam/q06.program.json` 现在那份是**手写**的，按定义不算。
 *
 * 用法：
 *   node tools/_run-q06.mjs              # 直接打本机 8123 的 /api/run（与界面同一条路）
 *
 * 产出：
 *   tests/reports/q06-model-events.json   全事件
 *   tests/reports/q06-model.program.json  模型最后产出的 8 槽位（有才写）
 *   tests/reports/q06-model-summary.txt   事件摘要
 *
 * 前提：本机规则服务在跑（`node tools/rules-service.mjs`，界面开着就有）。
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';

const ID = 'q06';
const PORT = Number(process.env.OD_PORT ?? 8123);
const q = JSON.parse(readFileSync('tests/real-exam/index.json', 'utf8')).items.find((x) => x.id === ID);
if (!q) throw new Error(`index.json 里没有 ${ID}`);

const b64 = readFileSync(`tests/real-exam/${q.image}`).toString('base64');
const reference = [
  '参考答案（试卷）',
  ...q.answer.map((a, i) => `${i + 1}. ${a}`),
  q.answerNote ? `备注：${q.answerNote}` : '',
]
  .filter(Boolean)
  .join('\n');

const body = JSON.stringify({
  problem: { text: q.problem },
  images: [{ mime: 'image/png', dataUrl: `data:image/png;base64,${b64}`, name: `${ID}.png` }],
  reference: { text: reference },
  devMode: false,
});

const logPath = 'tests/reports/q06-model.log';
appendFileSync(logPath, `\n==== START ${new Date().toISOString()} ====\n`);

const events = [];
const lines = [];

const req = http.request(
  {
    host: '127.0.0.1',
    port: PORT,
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
        /**
         * ⚠ 增量落盘：上一次跑到 repair 第二轮时服务端把连接 reset 了，
         * 事件只在内存里 ⇒ 模型的原文全丢，没法诊断 C1 为什么切不出 8 槽位。
         * 所以每来一段 delta 就追加一次，崩了也留现场。
         */
        if (ev.type === 'stage_delta' && ev.text) {
          appendFileSync('tests/reports/q06-model-text.log', `\n---- ${ev.stage} ----\n${ev.text}`);
        }
        if (ev.type === 'stage_done' && ev.stage) {
          appendFileSync('tests/reports/q06-model-text.log', `\n==== ${ev.stage} done (${ev.chars ?? 0} chars) ====\n`);
        }
        const bits = [ev.type];
        if (ev.stage) bits.push(ev.stage);
        if (ev.verdict) bits.push(`verdict=${ev.verdict}`);
        if (ev.type === 'dryrun_done') {
          bits.push(`frames=${ev.frameCount}`);
          const bad = (ev.checks ?? []).filter((c) => c.status !== 'pass');
          bits.push(`bad=${bad.map((c) => `${c.id}:${c.status}`).join('|') || '-'}`);
        }
        if (ev.type === 'repair_round') bits.push(`round=${ev.round} failing=${(ev.failingChecks ?? []).join(',')}`);
        if (ev.type === 'coupling_done') bits.push(`fallback=${ev.fallback}`);
        if (ev.type === 'stage_error') bits.push(JSON.stringify(ev.error ?? {}).slice(0, 300));
        if (ev.type === 'judgement_done') bits.push(`elements=${(ev.elements ?? []).join(',')} scenes=${(ev.scenes ?? []).join(',')}`);
        const line = bits.join(' · ');
        lines.push(line);
        appendFileSync(logPath, line + '\n');
      }
    });
    res.on('end', () => {
      writeFileSync('tests/reports/q06-model-events.json', JSON.stringify(events, null, 2));
      writeFileSync('tests/reports/q06-model-summary.txt', lines.join('\n'));
      const dryrun = [...events].reverse().find((e) => e.type === 'dryrun_done');
      const coupling = [...events].reverse().find((e) => e.type === 'coupling_done');
      if (dryrun?.program?.slots) {
        writeFileSync(
          'tests/reports/q06-model.program.json',
          JSON.stringify(
            {
              id: ID,
              index: q.number,
              title: q.title,
              examPoint: '电磁感应与电容',
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
  console.error(`连不上 127.0.0.1:${PORT}（规则服务没开？）: ${e.message}`);
  process.exit(1);
});
req.setTimeout(0);
req.write(body);
req.end();
