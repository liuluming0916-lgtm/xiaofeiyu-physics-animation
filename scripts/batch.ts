/**
 * 批量跑一套题：从 PDF 抽出的文本切题 → 逐题生成 → 输出 HTML + 索引页。
 *
 * 用法：node scripts/batch.ts [--only Q01,Q02] [--limit 3]
 */
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadEnv } from '../packages/agent/src/config.ts';
import { runProblem } from '../packages/agent/src/loop.ts';

loadEnv();

const SRC = path.resolve('开源日志/_check/pdf.txt');
const OUT = path.resolve('开源日志/batch');
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const onlyArg = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim().toUpperCase())) : null;
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 0;

/* ---------- 切题 ---------- */
const raw = readFileSync(SRC, 'utf8').split(/\r?\n/);
const marks: { no: string; line: number }[] = [];
raw.forEach((line, i) => {
  const m = /^\s*(\d{1,2})．/.exec(line);
  if (m) marks.push({ no: `Q${m[1].padStart(2, '0')}`, line: i });
});

interface Problem {
  id: string;
  text: string;
}

function cleanChunk(lines: string[], withAnswer: boolean): string {
  const kept: string[] = [];
  for (const line of lines) {
    if (/^===== 第 \d+ 页 =====$/.test(line.trim())) continue;
    if (/^试卷第 \d+ 页/.test(line.trim())) continue;
    if (/^\{#\{QQAB/.test(line.trim())) continue;
    if (/^【详解】/.test(line.trim())) break;
    if (!withAnswer && /^【答案】/.test(line.trim())) break;
    if (/^【知识点】/.test(line.trim())) continue;
    kept.push(line.replace(/\s+$/, ''));
  }
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const problems: Problem[] = marks.map((m, i) => {
  const end = i + 1 < marks.length ? marks[i + 1].line : raw.length;
  const chunk = raw.slice(m.line, end);
  return { id: m.no, text: cleanChunk(chunk, m.no === 'Q04') };
});

const picked = problems.filter((p) => !only || only.has(p.id)).slice(0, limit || problems.length);

console.log(`切出 ${problems.length} 题：${problems.map((p) => p.id).join(' ')}`);
console.log(`本次要跑 ${picked.length} 题：${picked.map((p) => p.id).join(' ')}`);

const prefixed = (p: Problem) =>
  `【题目】下面是一道高中物理题（扫描件 OCR 文字，公式与符号可能有排版错乱，` +
  `请按物理意义还原；缺参数时可自行设定合理数值并在画面角落注明）。\n\n` +
  p.text +
  (p.id === 'Q04'
    ? '\n\n【原卷参考答案（公式排版有错乱，仅供参考，以你自己的推导为准）】\n' +
      '见上文【答案】部分：第(1)问 −10 J；第(2)问 C 的质量 3 kg、动摩擦因数 0.5。'
    : '');

/* ---------- 逐题生成 ---------- */
const results: any[] = [];
const t0 = Date.now();

for (const [i, p] of picked.entries()) {
  const outDir = path.join(OUT, p.id);
  console.log(`\n[${i + 1}/${picked.length}] ${p.id} 开始（题目 ${p.text.length} 字）`);
  const started = Date.now();
  try {
    const res = await runProblem(prefixed(p), {
      outDir,
      onEvent: (e) => {
        if (e.type === 'write' || e.type === 'check' || e.type === 'look' || e.type === 'end') {
          console.log(`   ${p.id} [${((Date.now() - started) / 1000).toFixed(0)}s] ${e.type}: ${e.text.slice(0, 80)}`);
        }
      },
    });
    console.log(`   ${p.id} 完成：${res.ok ? '交付' : '未交付'}（${res.reason}），${(res.elapsedMs / 1000).toFixed(0)}s，${res.writes} 版`);
    results.push({ id: p.id, ok: res.ok, reason: res.reason, writes: res.writes, elapsedMs: res.elapsedMs, usage: res.usage, acts: res.acts.length });
  } catch (e: any) {
    console.log(`   ${p.id} 出错：${e?.message ?? e}`);
    results.push({ id: p.id, ok: false, reason: String(e?.message ?? e), writes: 0, elapsedMs: 0 });
  }
}

writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ total: picked.length, results, elapsedMs: Date.now() - t0 }, null, 2), 'utf8');

/* ---------- 索引页 ---------- */
const cards = results
  .map((r) => {
    const p = problems.find((x) => x.id === r.id)!;
    const first = p.text.split('\n')[0].slice(0, 60);
    return `<a class="card ${r.ok ? 'ok' : 'bad'}" href="./${r.id}/animation.html" target="_blank">
      <b>${r.id}</b>
      <span>${first}…</span>
      <em>${r.ok ? '已交付' : '未交付'} · ${r.writes} 版 · ${(r.elapsedMs / 1000).toFixed(0)} s</em>
    </a>`;
  })
  .join('\n');

writeFileSync(
  path.join(OUT, 'index.html'),
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>批量生成结果</title>
<style>
body{margin:0;padding:24px 28px;background:#eef2f8;font-family:"Microsoft YaHei",sans-serif;color:#1f2a3a;}
h1{font-size:18px;margin:0 0 16px;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;}
.card{background:#fff;border:1px solid #dbe3ee;border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;text-decoration:none;color:inherit;}
.card:hover{border-color:#9fbcf0;box-shadow:0 6px 20px rgba(47,111,235,.12);}
.card b{font-size:15px;}
.card span{font-size:12.5px;color:#66748a;line-height:1.6;}
.card em{font-style:normal;font-size:11.5px;color:#9aa7ba;}
.card.ok em{color:#12805c;}
.card.bad em{color:#c62a2a;}
</style></head><body><h1>批量生成结果（点击卡片打开动画）</h1><div class="grid">${cards}</div></body></html>`,
  'utf8',
);

console.log(`\n全部结束，用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
console.log(`索引页：${path.join(OUT, 'index.html')}`);
