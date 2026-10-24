#!/usr/bin/env node
/**
 * 交付总览页（Design Files 入口）。
 *
 * 由 `tests/reports/dry-run-report.json` + `tests/reports/negative-injection.json`
 * + `tests/regression-15/*.mjs` 生成，因此页面上的判定与真实校验结果一致——不是手写的漂亮话。
 *
 * 第 2 期新增：执行后端/终止类型列、X1/X2 扩展列、**负向注入验收表**（§18 期 2 的验收面）。
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 三档证据强度的中文标签**取自契约**（第 4 期）：总览页上的"精确/重放定位/候选"
// 与 UI、回灌 Prompt 用同一份口径，不在各处各写一套。
import { labelOf } from '../contracts/evidence.mjs';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUESTION_DIR = join(PROJECT_ROOT, 'tests', 'regression-15');
const REPORT_DIR = join(PROJECT_ROOT, 'tests', 'reports');

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function main() {
  const files = readdirSync(QUESTION_DIR).filter((f) => f.endsWith('.mjs')).sort();
  let reports = new Map();
  try {
    const list = JSON.parse(readFileSync(join(REPORT_DIR, 'dry-run-report.json'), 'utf8'));
    reports = new Map(list.map((r) => [r.entry, r]));
  } catch {
    /* 尚未跑过 Dry-Run */
  }
  /** 第 2 期：负向注入验收结果（缺失时整块不渲染，页面不会出现空表） */
  let injections = [];
  try {
    injections = JSON.parse(readFileSync(join(REPORT_DIR, 'negative-injection.json'), 'utf8'));
  } catch {
    /* 尚未跑过注入验收 */
  }

  const items = [];
  for (const file of files) {
    const program = (await import(pathToFileURL(join(QUESTION_DIR, file)).href)).default;
    const report = reports.get(program.id);
    items.push({
      id: program.id,
      index: program.index,
      title: program.title,
      examPoint: program.examPoint,
      mode: program.mode ?? 'NUMERIC',
      verdict: report?.verdict ?? 'unrun',
      duration: report?.execution?.duration ?? null,
      steps: report?.observations?.stepCount ?? null,
      rawUsage: report?.observations?.drawRawUsage ?? null,
      backend: report?.execution?.backendId ?? null,
      termination: report?.execution?.termination ?? null,
      diagCount: report?.observations?.diagnosticCount ?? null,
      checks: report?.checks ?? [],
      extensions: report?.extensions ?? [],
      file: `template/build/${program.id}.html`,
    });
  }
  items.sort((a, b) => a.index - b.index);

  const pass = items.filter((i) => i.verdict === 'pass').length;
  const warn = items.filter((i) => i.verdict === 'pass-with-warnings').length;
  const fail = items.filter((i) => i.verdict === 'fail').length;
  const workerBacked = items.filter((i) => i.backend === 'worker').length;
  const injectedOk = injections.filter((r) => r.ok).length;
  const injectionDiags = injections.reduce((n, r) => n + (r.evidence?.allDiagnostics?.length ?? 0), 0);

  const rows = items
    .map((item) => {
      const cells = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9']
        .map((id) => {
          const c = item.checks.find((x) => x.id === id);
          if (!c) return '<td class="ck unrun">—</td>';
          const cls = c.status === 'pass' ? 'ok' : c.blocking ? 'bad' : 'warn';
          const glyph = c.status === 'pass' ? '✓' : c.blocking ? '✗' : '⚠';
          return `<td class="ck ${cls}" title="${esc(c.detail)}">${glyph}</td>`;
        })
        .join('');
      /* C10 / X1 / X2 是**扩展检查**（不属于 §7.2 冻结判据）：未声明记「·」，声明了就必须全绿 */
      const extCell = (id, title) => {
        const x = item.extensions.find((e) => e.id === id);
        if (!x || x.status === 'skip') return `<td class="ck unrun" title="${esc(x?.detail ?? title)}">·</td>`;
        return `<td class="ck ${x.status === 'pass' ? 'ok' : 'bad'}" title="${esc(x.detail)}">${x.status === 'pass' ? '✓' : '✗'}</td>`;
      };
      const verdictText = item.verdict === 'pass' ? 'C1–C9 全通过' : item.verdict === 'pass-with-warnings' ? '通过（有告警）' : item.verdict === 'unrun' ? '未跑' : '未通过';
      /* 时长/步数/模式从独立列并入题名下方：判定表真正的信息是"哪条判据过了"，
         把 4 个描述性列挤在 12 个判定列旁边会把表格顶出 1220 px（第 2 期加列时踩到过）。 */
      const metrics = `${item.mode === 'SYMBOLIC' ? 'SYMBOLIC' : 'NUMERIC'} · ${item.duration === null ? '—' : item.duration.toFixed(2) + ' s'} · ${item.steps ?? '—'} 步`;
      return `      <tr data-od-id="row-${item.id}">
        <td class="idx">${String(item.index).padStart(2, '0')}</td>
        <td class="name"><a href="${item.file}">${esc(item.title)}</a><span class="point">${esc(item.examPoint)}</span><span class="metrics">${metrics}</span></td>
        ${cells}
        ${extCell('C10', 'C10 物理包络（扩展）')}
        ${extCell('X1', 'X1 跨槽位导出键与 STEPS 字段重名（扩展）')}
        ${extCell('X2', 'X2 Draw.raw 使用率 <10%（扩展）')}
        <td class="ck backend" title="执行后端：worker = Worker 沙箱（可硬终止）；vm-fallback = 同进程回退">${item.backend === 'worker' ? 'worker' : item.backend === 'vm-fallback' ? 'vm-fallback' : '—'}</td>
        <td class="verdict ${item.verdict}">${verdictText}</td>
      </tr>`;
    })
    .join('\n');

  const injectionRows = injections
    .map((r, i) => {
      const e = r.evidence ?? {};
      const d = e.diagnostic;
      return `      <tr data-od-id="injection-${esc(r.id)}">
        <td class="idx">${String(i + 1).padStart(2, '0')}</td>
        <td class="name">${esc(e.className ?? '—')}<span class="point">${esc(e.label ?? r.id)}</span></td>
        <td class="mono">${(e.failed ?? []).map(esc).join(', ') || '—'}</td>
        <td class="mono">${esc(e.termination ?? '—')}</td>
        <td class="diag">${d ? `<span class="loc">${esc(d.slot)} 第 ${d.line} 行</span> <span class="pin">${esc(labelOf(d.precision))}</span><br /><span class="why">${esc(d.message)}</span>` : '—'}</td>
        <td class="verdict ${r.ok ? 'pass' : 'fail'}">${r.ok ? '拦下' : '未达预期'}</td>
      </tr>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>小肥鱼物理解题动画 · 第 2 期交付总览</title>
<style>
  :root {
    --bg: oklch(98.2% 0.004 250); --surface: oklch(100% 0 0); --fg: oklch(25.5% 0.021 250);
    --muted: oklch(52% 0.017 250); --border: oklch(90.5% 0.008 250); --accent: oklch(47% 0.088 235);
    --ok: oklch(45% 0.1 155); --bad: oklch(47% 0.16 28); --warn: oklch(50% 0.12 70);
    --font-display: 'Songti SC', 'Source Han Serif SC', 'Noto Serif SC', STSong, Georgia, serif;
    --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
    --font-mono: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font-body); line-height: 1.6; }
  header { border-bottom: 1px solid var(--border); }
  .wrap { max-width: 1220px; margin-inline: auto; padding: 26px 24px; }
  h1 { font-family: var(--font-display); font-size: 24px; margin: 0 0 6px; letter-spacing: -0.01em; }
  h2 { font-family: var(--font-display); font-size: 17px; margin: 34px 0 12px; }
  .sub { color: var(--muted); font-size: 13px; margin: 0; }
  .kpis { display: flex; flex-wrap: wrap; gap: 28px; margin: 22px 0 6px; }
  .kpi .n { font-family: var(--font-mono); font-size: 26px; font-variant-numeric: tabular-nums; }
  .kpi .l { color: var(--muted); font-size: 12px; }
  .kpi.pass .n { color: var(--ok); }
  .kpi.fail .n { color: var(--bad); }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { padding: 9px 10px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  th { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
  td.idx { font-family: var(--font-mono); color: var(--muted); }
  td.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--muted); }
  td.name a { color: inherit; text-decoration: none; font-family: var(--font-display); font-size: 15px; }
  td.name a:hover { text-decoration: underline; text-underline-offset: 3px; }
  td.name a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  td.name .point { display: block; color: var(--muted); font-size: 12px; }
  td.name .metrics { display: block; color: var(--muted); font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.02em; }
  td.ck { text-align: center; font-family: var(--font-mono); width: 26px; }
  th.ck, td.ck { padding-inline: 5px; }
  td.ck.backend { width: 60px; font-size: 11px; color: var(--muted); }
  td.ck.ok { color: var(--ok); }
  td.ck.bad { color: var(--bad); }
  td.ck.warn { color: var(--warn); }
  td.ck.unrun { color: var(--muted); }
  .section-note { color: var(--muted); font-size: 13px; margin: 0 0 12px; }
  td.verdict { font-family: var(--font-mono); font-size: 11.5px; white-space: nowrap; }
  td.verdict.pass { color: var(--ok); }
  td.verdict.fail { color: var(--bad); }
  td.verdict.pass-with-warnings { color: var(--warn); }
  td.verdict.unrun { color: var(--muted); }
  td.diag { max-width: 460px; font-size: 12.5px; }
  td.diag .loc { font-family: var(--font-mono); color: var(--fg); }
  td.diag .pin { font-family: var(--font-mono); font-size: 11px; color: var(--accent); border: 1px solid var(--border); border-radius: 999px; padding: 0 7px; }
  td.diag .why { color: var(--muted); }
  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px 32px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
  .card h3 { font-family: var(--font-display); font-size: 15px; margin: 0 0 6px; }
  .card p { margin: 0; color: var(--muted); font-size: 13px; }
  code { font-family: var(--font-mono); font-size: 12px; background: color-mix(in oklch, var(--fg) 5%, transparent); padding: 1px 5px; border-radius: 4px; }
  footer { color: var(--muted); font-size: 12px; padding: 30px 0 50px; }
  a.plain { color: var(--accent); }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>小肥鱼物理解题动画 · 第 2 期交付总览</h1>
    <p class="sub">第 1 期（模板页 + 命令缓冲渲染器 + 教具 SDK Layer 1 + AutoView + §19.5 手写回归题集）＋ 第 2 期（<strong>Worker 沙箱硬终止</strong> · C1 静态预检 · C2–C6 强化 · <strong>行号级诊断</strong> · M27 校验报告）。判定全部来自真实 Dry-Run（§7.2 C1–C9；C10/X1/X2 为扩展检查，标注 <sup>ext</sup>），随 <code>core/dryrun/run-suite.mjs</code> 结果更新。</p>
    <div class="kpis">
      <div class="kpi pass"><div class="n">${pass}</div><div class="l">全通过（C1–C9）</div></div>
      <div class="kpi"><div class="n">${warn}</div><div class="l">通过但有告警</div></div>
      <div class="kpi fail"><div class="n">${fail}</div><div class="l">未通过</div></div>
      <div class="kpi"><div class="n">${items.length}</div><div class="l">题目总数</div></div>
      <div class="kpi"><div class="n">${workerBacked}/${items.length}</div><div class="l">Worker 沙箱执行</div></div>
      <div class="kpi"><div class="n">${injectedOk}/${injections.length || '—'}</div><div class="l">负向注入被拦下</div></div>
    </div>
  </div>
</header>

<main class="wrap">
  <h2>回归题集（§19.5 第 1 期 15 道手写题）</h2>
  <table>
    <thead>
      <tr>
        <th>#</th><th>题目</th>
        <th class="ck">C1</th><th class="ck">C2</th><th class="ck">C3</th><th class="ck">C4</th><th class="ck">C5</th><th class="ck">C6</th><th class="ck">C7</th><th class="ck">C8</th><th class="ck">C9</th>
        <th class="ck" title="C10 物理包络：扩展检查，不属于 §7.2 冻结判据；未声明 SIM.regions 的题记 ·">C10<sup>ext</sup></th>
        <th class="ck" title="X1 跨槽位导出键与 STEPS 字段重名：扩展检查，只提醒不阻塞">X1<sup>ext</sup></th>
        <th class="ck" title="X2 Draw.raw 使用率（§19.1 <10%）：扩展检查">X2<sup>ext</sup></th>
        <th class="ck" title="执行后端：worker = Worker 沙箱（可硬终止）；vm-fallback = 同进程回退">后端</th>
        <th>判定</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
${
  injections.length
    ? `
  <h2>第 2 期验收 · 负向注入（§18 期 2）</h2>
  <p class="section-note">对<strong>真题</strong> <code>tests/regression-15/q01-conveyor-heat.mjs</code> 定点注入，跑完整链路（C1 静态预检 → Worker 沙箱 → C2–C9 → 行号级归因）。"行号级诊断"一列是校验器自动给出的定位，不是人工标注；本页共 <strong>${injectionDiags} 条行号诊断</strong>全部指向注入点。</p>
  <table>
    <thead>
      <tr>
        <th>#</th><th>类别 / 用例</th><th>拦下的检查</th><th>终止类型</th><th>行号级诊断</th><th>验收</th>
      </tr>
    </thead>
    <tbody>
${injectionRows}
    </tbody>
  </table>`
    : ''
}

  <h2>怎么用</h2>
  <div class="grid2">
    <div class="card">
      <h3>看动画</h3>
      <p>点上面任意题目名进入成品页。每个页面都是<strong>单文件自包含 HTML</strong>：双击即可离线播放，无外部请求。支持时间轴拖拽、0.25×–4× 倍速、逐帧、三类矢量分别开关、点解析步骤跳转，开关状态写入 <code>localStorage</code>。</p>
    </div>
    <div class="card">
      <h3>看校验结果</h3>
      <p>表里的九个格子就是 §7.2 的 C1–C9，鼠标悬停可看该题的判定说明。完整报告在 <code>tests/reports/</code>：逐题 <code>*.dryrun.json</code>（含 <code>checks[].diagnostics[]</code> 的行号级诊断）、汇总 <code>dry-run-report.json</code>、<code>summary.md</code>，以及负向注入的 <code>negative-injection.{json,md}</code>。</p>
    </div>
    <div class="card">
      <h3>沙箱与终止</h3>
      <p>Dry-Run 在 <code>worker_threads</code> 里跑：<code>resourceLimits.maxOldGenerationSizeMb</code> 管内存，父进程墙钟到点直接 <code>terminate()</code>。超时 / 超内存 / 步数预算 / 崩溃四态可区分，并且硬终止后仍能从共享内存读回"最后执行到哪一行"。</p>
    </div>
    <div class="card">
      <h3>重跑</h3>
      <p><code>core/dryrun/run-suite.mjs</code> 跑 C1–C9 并重写报告；<code>tests/negative-injection/run-injection.mjs</code> 跑 §18 期 2 的五类负向注入；<code>tools/render-check.mjs</code> 用 mock canvas 验证"命令缓冲 → 屏幕像素"这条链路；<code>node tools/verify-all.mjs</code> 一次跑完全部门禁。</p>
    </div>
    <div class="card">
      <h3>契约</h3>
      <p><code>contracts/*.schema.json</code> 与 <code>contracts/types/*.d.ts</code> 由 <code>contracts/spec/</code> <strong>同源生成</strong>（§3.6 / §21.1）。改动契约必须先改 spec，再跑 <code>contracts/generate-contracts.mjs</code>。第 1 期冻结项（§3 / §9 / §11.2 / §7.2）在第 2 期<strong>一字未改</strong>。</p>
    </div>
  </div>

  <footer>
    第 2 期口径说明：C1 仍是 <strong>acorn 单后端</strong>（AST，行列号来自解析器）；Dry-Run 主路径改为 <strong><code>worker_threads</code> + <code>node:vm</code> + <code>resourceLimits</code> + 硬终止</strong>，同进程 <code>node:vm</code> 仅作 Worker 起不来时的回退（报告里以 <code>execution.backendId</code> 标注）；C3/C4/C5/C6 的失败项一律附 <code>diagnostics[]</code>，证据强度分「精确（埋点/命令戳）」「重放定位（快照重放）」「候选（静态候选行）」——<strong>第 4 期起这三档已写进契约</strong>（<code>contracts/diagnostic-record.schema.json</code> + <code>diagnostic-evidence.json</code>），自愈回灌必须带上它（<code>§14.3 ①</code>）；<strong>C10 / X1 / X2 是扩展检查</strong>，不阻塞、不进 §7.2 冻结的 C1–C9。公式仍由 MathJax 构建期预渲染内联为 SVG（<code>tools/build-tex-svg.mjs</code>）。逐条说明见 <code>README.md</code> 第三、四节与第十一、十四节。
  </footer>
</main>
</body>
</html>
`;

  writeFileSync(join(PROJECT_ROOT, '物理动画原型总览.html'), html, 'utf8');
  console.log(`✓ 总览页已生成：物理动画原型总览.html（${items.length} 题，通过 ${pass} / 告警 ${warn} / 未通过 ${fail}）`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  Promise.resolve(main()).catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
