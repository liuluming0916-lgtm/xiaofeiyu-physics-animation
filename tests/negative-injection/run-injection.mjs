#!/usr/bin/env node
/**
 * 负向注入验收（§18 期 2 / §19.1）。
 *
 * ```powershell
 * node tests/negative-injection/run-injection.mjs          # 全部用例
 * node tests/negative-injection/run-injection.mjs nan      # 只跑 id 含 nan 的
 * node tests/negative-injection/run-injection.mjs --json   # 机器可读摘要
 * ```
 *
 * 每条用例跑的是**完整链路**：C1 静态预检 → Worker 沙箱执行 → C2–C9 → 行号级归因。
 * 断言三条，缺一不可：
 *   ① 期望的检查号确实失败（`expect.checks` 全中）；
 *   ② **行号级诊断指到注入点**——诊断的 `slot` 与 `line` 必须落在注入的那几行里；
 *   ③ 对照组（未注入的真题）必须仍然通过——判据不许因为"变严"而误伤。
 *
 * 输出 `tests/reports/negative-injection.{json,md}`；有任一用例不满足即退出码 1。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { dryRun } from '../../core/dryrun/dry-run.mjs';
import { INJECTIONS, REQUIRED_CLASSES } from './cases.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(HERE, '..', '..');
const REPORT_DIR = join(PROJECT_ROOT, 'tests', 'reports');

/** 被注入的真题：q01 传送带共速与摩擦生热（§19.5 第 1 题） */
const SUBJECT = 'q01-conveyor-heat';

export async function loadSubject() {
  const mod = await import(pathToFileURL(join(PROJECT_ROOT, 'tests', 'regression-15', `${SUBJECT}.mjs`)).href);
  return mod.default;
}

/** 把报告里所有诊断摊平（C1 的静态诊断 + C3/C4/C5/C6 的行号归因 + 扩展检查） */
function collectDiagnostics(report) {
  const out = [];
  for (const c of report.checks ?? []) for (const d of c.diagnostics ?? []) out.push({ check: c.id, ...d });
  for (const x of report.extensions ?? []) for (const d of x.diagnostics ?? []) out.push({ check: x.id, ...d });
  return out;
}

/** 真正"判失败"的检查号（`skipped` 的那些是 C1/C2 未通过后的连带标记，不算命中） */
function failedChecks(report) {
  const failed = (report.checks ?? []).filter((c) => c.status === 'fail' && !c.skipped).map((c) => c.id);
  const ext = (report.extensions ?? []).filter((x) => x.status === 'fail').map((x) => x.id);
  return [...failed, ...ext];
}

/**
 * 跑一条用例。
 * @returns {{id:string, ok:boolean, problems:string[], evidence:object}}
 */
export async function runCase(injection, subject) {
  const problems = [];
  let applied;
  try {
    applied = injection.apply(subject.slots);
  } catch (err) {
    return { id: injection.id, ok: false, problems: [`注入失败：${err.message}`], evidence: {} };
  }

  const { report } = await dryRun({
    slots: applied.slots,
    entry: injection.id,
    meta: {
      index: 0,
      title: injection.label,
      mode: subject.mode ?? 'NUMERIC',
      sourceFile: `tests/regression-15/${SUBJECT}.mjs（注入 ${injection.id}）`,
      injection: injection.id,
      injectionClass: injection.className,
      wallClockMs: injection.expect.timeoutBudgetMs,
      // 用例可以收紧预算（例如把内存上限压到 64 MB 好让"超内存"这条秒验），
      // 但**不能放宽**：判据本身不参与，改的只是资源预算。
      ...(injection.meta ?? {}),
    },
  });

  const failed = failedChecks(report);
  const diagnostics = collectDiagnostics(report);
  const at = applied.at;
  const expect = injection.expect;

  // ① 期望的检查号必须失败（缺一不可）
  for (const id of expect.checks ?? []) {
    if (!failed.includes(id)) problems.push(`期望 ${id} 失败，实际失败项 = [${failed.join(', ') || '无'}]`);
  }

  // 对照/附加用例的额外要求
  if (expect.verdict === 'pass' && report.verdict !== 'pass') {
    problems.push(`期望整体判定为 pass，实际为 ${report.verdict}（失败项 = ${failed.join(', ') || '无'}）`);
  }
  if (expect.termination && (report.execution?.termination ?? null) !== expect.termination) {
    problems.push(`期望终止类型 ${expect.termination}，实际 ${report.execution?.termination ?? 'null'}`);
  }

  // ② 行号级诊断必须指到注入点
  let hit = null;
  if (at) {
    hit = diagnostics.find(
      (d) => d.slot === expect.slot && Number.isFinite(d.line) && d.line >= at.start && d.line <= at.end && d.precision !== 'candidate',
    );
    if (!hit) {
      const near = diagnostics.filter((d) => d.slot === expect.slot).map((d) => `${d.slot}:${d.line}(${d.precision ?? 'exact'})`);
      problems.push(
        `缺少指向注入点的行号级诊断：期望 ${expect.slot} 第 ${at.start}${at.end > at.start ? `–${at.end}` : ''} 行，` +
          `实际该槽位诊断 = [${near.join(', ') || '无'}]`,
      );
    }
  } else if (expect.checks?.length === 0 && diagnostics.length) {
    // 对照组不该产生任何诊断
    problems.push(`对照组不应产生诊断，实际 ${diagnostics.length} 条`);
  }

  if (expect.blocking === false) {
    const ext = (report.extensions ?? []).find((x) => x.id === expect.checks[0]);
    if (ext && ext.blocking) problems.push(`${expect.checks[0]} 应为非阻塞扩展检查`);
  }

  return {
    id: injection.id,
    ok: problems.length === 0,
    problems,
    evidence: {
      className: injection.className,
      label: injection.label,
      verdict: report.verdict,
      termination: report.execution?.termination ?? null,
      backend: report.execution?.backendId ?? null,
      failed,
      injectedAt: at ? [{ slot: expect.slot, start: at.start, end: at.end }] : null,
      diagnostic: hit
        ? { slot: hit.slot, line: hit.line, column: hit.column ?? null, precision: hit.precision, rule: hit.rule, message: hit.message }
        : null,
      allDiagnostics: diagnostics.map((d) => ({
        check: d.check,
        rule: d.rule,
        slot: d.slot,
        line: d.line ?? null,
        column: d.column ?? null,
        precision: d.precision ?? 'exact',
        message: d.message,
      })),
      wallClockMs: report.execution?.wallClockMs ?? null,
    },
  };
}

function renderMarkdown(results, subject) {
  const lines = [];
  const isParity = (r) => r.id === 'backend-parity';
  lines.push('# 第 2 期验收 · 负向注入（§18 期 2）');
  lines.push('');
  lines.push(`- 注入对象：\`tests/regression-15/${subject.id}.mjs\`（${subject.title}）—— 对**真题**注入，不写玩具代码`);
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(
    `- 用例数：${results.length}（含 1 条后端一致性对照） · 通过 ${results.filter((r) => r.ok).length} · 失败 ${results.filter((r) => !r.ok).length}`,
  );
  lines.push('');
  lines.push('| # | 类别 | 用例 | 判定 | 命中的检查 | 终止类型 | 行号级诊断 |');
  lines.push('|---|---|---|---|---|---|---|');
  results.forEach((r, i) => {
    const e = r.evidence;
    const d = e.diagnostic;
    const verdictCell = isParity(r) ? (r.ok ? '✓ 一致' : '✗ 不一致') : r.ok ? '✓ 拦下' : '✗ 未达预期';
    lines.push(
      `| ${i + 1} | ${e.className ?? '—'} | ${e.label ?? r.id} | ${verdictCell} | ${(e.failed ?? []).join(', ') || '—'} | ${e.termination ?? '—'} | ` +
        (d ? `**${d.slot} 第 ${d.line} 行**（${d.precision === 'exact' ? '精确' : '重放定位'}）` : '—') +
        ' |',
    );
  });
  lines.push('');
  lines.push('## 逐条证据');
  lines.push('');
  for (const r of results) {
    const e = r.evidence;
    lines.push(`### ${r.id} · ${e.label ?? ''}`);
    lines.push('');
    lines.push(`- 判定：${r.ok ? '✓ 符合预期' : '✗ 不符合预期'}`);
    lines.push(`- 执行后端：${e.backend ?? '—'} · 终止类型：${e.termination ?? '—'} · 墙钟 ${e.wallClockMs ?? '—'} ms`);
    lines.push(`- 失败的检查：${(e.failed ?? []).join('、') || '无'}`);
    if (e.diagnostic) {
      const d = e.diagnostic;
      lines.push(`- **行号级诊断**：${d.slot} 第 ${d.line} 行${d.column ? ` 第 ${d.column} 列` : ''}（${d.precision === 'exact' ? '精确' : '重放定位'}，规则 \`${d.rule}\`）`);
      lines.push(`  > ${d.message}`);
    }
    if (r.problems.length) for (const p of r.problems) lines.push(`- ⚠ ${p}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 后端一致性对照（第 2 期）。
 *
 * Dry-Run 有两条后端：Worker（主路径）与同进程 `node:vm`（回退）。
 * 回退路径平时**不会被走到**（本机 Worker 可用），于是成了"没人跑过的代码"——
 * 所以这里主动把它叫起来，拿同一道真题跑两遍，断言两条路径**结论逐项一致**：
 * 判定、九个检查的状态、时长、帧数、命令总数、首末读数。
 * 只要有一项对不上，就说明"换后端"悄悄换了判据（这正是本节最该防的事）。
 */
async function checkBackendParity(subject) {
  const problems = [];
  const meta = { index: 0, title: '后端一致性对照', mode: subject.mode ?? 'NUMERIC' };
  const a = (await dryRun({ slots: subject.slots, entry: 'parity-worker', meta })).report;
  const b = (await dryRun({ slots: subject.slots, entry: 'parity-fallback', meta: { ...meta, forceBackend: 'vm-fallback' } })).report;

  if (a.execution.backendId !== 'worker') problems.push(`主路径后端不是 worker（实际 ${a.execution.backendId}）`);
  if (b.execution.backendId !== 'vm-fallback') problems.push(`强制回退后端未生效（实际 ${b.execution.backendId}）`);
  if (a.verdict !== b.verdict) problems.push(`判定不一致：worker=${a.verdict} vs vm-fallback=${b.verdict}`);
  for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9']) {
    const ca = a.checks.find((c) => c.id === id);
    const cb = b.checks.find((c) => c.id === id);
    if (ca?.status !== cb?.status) problems.push(`${id} 状态不一致：${ca?.status} vs ${cb?.status}`);
  }
  const num = (r) => [r.execution.duration, r.execution.frameCount, r.observations.totalCommands, r.observations.maxCommandsPerFrame];
  const [da, fa, ca_, ma] = num(a);
  const [db, fb, cb_, mb] = num(b);
  if (da !== db) problems.push(`duration 不一致：${da} vs ${db}`);
  if (fa !== fb) problems.push(`帧数不一致：${fa} vs ${fb}`);
  if (ca_ !== cb_) problems.push(`命令总数不一致：${ca_} vs ${cb_}`);
  if (ma !== mb) problems.push(`单帧命令峰值不一致：${ma} vs ${mb}`);
  const digest = (r) => JSON.stringify([r.chartSeries[0]?.values ?? null, r.chartSeries.at(-1)?.values ?? null]);
  if (digest(a) !== digest(b)) problems.push('首末帧读数不一致（两条后端算出了不同的数）');

  return {
    id: 'backend-parity',
    ok: problems.length === 0,
    problems,
    evidence: {
      className: '附加·后端一致性',
      label: '同一道真题跑 Worker 与同进程回退，结论必须逐项一致',
      failed: [],
      termination: a.execution.termination,
      backend: `${a.execution.backendId} vs ${b.execution.backendId}`,
      diagnostic: null,
      allDiagnostics: [],
      wallClockMs: a.execution.wallClockMs + b.execution.wallClockMs,
    },
  };
}

export async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes('--json');
  const filters = args.filter((a) => !a.startsWith('-'));
  const subject = await loadSubject();
  const cases = INJECTIONS.filter((c) => !filters.length || filters.some((f) => c.id.includes(f)));

  const results = [];
  for (const c of cases) results.push(await runCase(c, subject));
  if (!filters.length) results.push(await checkBackendParity(subject));

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'negative-injection.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  writeFileSync(join(REPORT_DIR, 'negative-injection.md'), renderMarkdown(results, subject), 'utf8');

  if (jsonOnly) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log('negative-injection · 负向注入验收（§18 期 2）');
    console.log(`  注入对象：tests/regression-15/${subject.id}.mjs（真题，非玩具代码）`);
    for (const r of results) {
      const e = r.evidence;
      const d = e.diagnostic;
      const head = r.id === 'backend-parity' ? (r.ok ? '对照一致' : '对照不一致') : `拦下 ${(e.failed ?? []).join(',') || '—'}`;
      console.log(
        `  ${r.ok ? '✓' : '✗'} ${String(e.className ?? '').padEnd(12, '　')} ${String(e.label ?? r.id).padEnd(30, '　')} ` +
          head +
          (d ? ` · 定位 ${d.slot} 第 ${d.line} 行（${d.precision === 'exact' ? '精确' : '重放定位'}）` : '') +
          (r.problems.length ? `\n      ⚠ ${r.problems.join('\n      ⚠ ')}` : ''),
      );
    }
    const classes = new Set(results.map((r) => r.evidence.className).filter(Boolean));
    const missing = REQUIRED_CLASSES.filter((c) => !classes.has(c));
    if (missing.length) console.log(`\n✗ 验收要求的五类注入未覆盖：${missing.join('、')}`);
    const injected = results.filter((r) => (r.evidence.failed ?? []).length || r.id !== 'backend-parity');
    const bad = results.filter((r) => !r.ok).length;
    console.log(
      bad || missing.length
        ? `\n✗ 负向注入未全部达标：${bad} 条不符预期${missing.length ? `，缺 ${missing.join('、')}` : ''}`
        : `\n✓ ${injected.length} 条负向注入全部被准确拦下，且行号级诊断均指向注入点（五类：${REQUIRED_CLASSES.join(' / ')}）` +
          `\n✓ 后端一致性对照通过：Worker 与同进程回退的判定 / 九个检查 / 时长 / 帧数 / 命令数 / 首末读数逐项一致`,
    );
    console.log('  → tests/reports/negative-injection.{json,md}');
  }

  if (results.some((r) => !r.ok) || REQUIRED_CLASSES.some((c) => !results.some((r) => r.evidence.className === c))) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
