#!/usr/bin/env node
/**
 * dryrun —— 跑回归题集，逐题出 DryRunReport 与四件套（本期三件）。
 *
 * 用法：
 *   node core/dryrun/run-suite.mjs                    # 合成回归 15 道（默认，保持老行为）
 *   node core/dryrun/run-suite.mjs --suite real-exam  # 只跑真题（tests/real-exam/index.json）
 *   node core/dryrun/run-suite.mjs --suite all        # 两套都跑（门禁 ③ 用这个）
 *   node core/dryrun/run-suite.mjs q01 q07            # 只跑指定前缀的题目
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { dryRun } from './dry-run.mjs';
import {
  loadSuite,
  parseSuiteArgs,
  deriveTiming,
  auditSelfControlFailures,
  REGRESSION_DIR,
  REAL_EXAM_DIR,
} from './question-sources.mjs';
import { CHECK_IDS, TEMPLATE_VERSION, SDK_VERSION } from '../../contracts/spec/frozen-keys.mjs';
import { labelOf } from '../../contracts/evidence.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(HERE, '..', '..');
const QUESTION_DIR = REGRESSION_DIR;
const REPORT_DIR = join(PROJECT_ROOT, 'tests', 'reports');

/** 合成回归的题单（保持老接口：tests 里的取证脚本与几个 `_` 工具都在 import 它） */
export function listQuestionFiles() {
  return readdirSync(QUESTION_DIR)
    .filter((f) => f.endsWith('.mjs'))
    .sort();
}

export async function loadQuestions(filters = []) {
  const files = listQuestionFiles().filter((f) => !filters.length || filters.some((q) => f.startsWith(q)));
  const out = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(QUESTION_DIR, file)).href);
    out.push({ file, program: mod.default });
  }
  return out;
}

/**
 * @param {string[]} filters
 * @param {'regression-15'|'real-exam'|'all'} suite
 * @returns {Promise<{reports: object[], audit: object|null}>}
 */
export async function runSuite(filters = [], suite = 'regression-15') {
  const { items, audit } = await loadSuite(suite, filters);
  const reports = [];
  for (const { file, program, suite: s } of items) {
    /* 真题的 program.json 里没有 analysis，C5/C6 要的两个数从程序本身反推（与 _check-real 同口径） */
    const timing = s === 'real-exam' ? deriveTiming(program.slots) : {};
    const { report } = await dryRun({
      slots: program.slots,
      entry: program.id,
      meta: {
        index: program.index,
        title: program.title,
        examPoint: program.examPoint,
        mode: program.mode ?? (s === 'real-exam' ? 'BOTH' : 'NUMERIC'),
        sourceFile: file,
        examSelfChecks: program.examSelfChecks ?? 0,
        templateVersion: TEMPLATE_VERSION,
        sdkVersion: SDK_VERSION,
        suite: s,
        ...timing,
      },
    });
    /* `suite` 只进报告（摘要分表用），不改判据 */
    reports.push({ ...report, suite: s });
  }
  return { reports, audit };
}

function statusMark(report) {
  if (report.verdict === 'pass') return '✓ 通过';
  if (report.verdict === 'pass-with-warnings') return '⚠ 告警';
  return '✗ 失败';
}

/** 套件标签（报告里 `suite` 只有真题会带，合成是老报告默认 undefined） */
function suiteTag(r) {
  return r.suite === 'real-exam' ? '真题' : '合成';
}
function sortBySuite(reports) {
  const order = { 'regression-15': 0, 'real-exam': 1 };
  return [...reports].sort(
    (a, b) => (order[a.suite ?? 'regression-15'] ?? 9) - (order[b.suite ?? 'regression-15'] ?? 9) || a.meta.index - b.meta.index,
  );
}
function suiteCounts(reports) {
  const reg = reports.filter((r) => (r.suite ?? 'regression-15') === 'regression-15').length;
  return `合成 ${reg} · 真题 ${reports.length - reg}`;
}

function renderSummary(reports, { totalMs }) {
  const lines = [];
  lines.push('# Dry-Run 汇总（§7.2 C1–C9 · 第 2 期；第 3 期起含四件套之四「关键帧」）');
  lines.push('');
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(`- 模板版本：${TEMPLATE_VERSION} · SDK 版本：${SDK_VERSION}`);
  lines.push(`- C1 后端：acorn（AST）+ SDK 签名白名单`);
  const backends = [...new Set(reports.map((r) => r.execution.backendId ?? 'unknown'))];
  lines.push(
    `- 执行后端：${backends.map((b) => (b === 'worker' ? '`worker_threads` + `node:vm` + `resourceLimits` + 硬终止（§6.3）' : `\`${b}\``)).join(' · ')}`,
  );
  lines.push(`- 题量：${reports.length}（${suiteCounts(reports)}） · 总耗时：${totalMs} ms`);
  lines.push('');
  lines.push('| 套件 | # | 题目 | 模式 | 判定 | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | 终止 | 耗时 ms | 帧数 | 行号诊断 | 关键帧 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of sortBySuite(reports)) {
    const cells = CHECK_IDS.map((id) => {
      const c = r.checks.find((x) => x.id === id);
      if (!c) return '—';
      return c.status === 'pass' ? '✓' : c.blocking ? '✗' : '⚠';
    });
    const kfs = Array.isArray(r.keyframes) ? r.keyframes : [];
    const blankKf = kfs.filter((k) => !(k.commands > 0)).length;
    const kfCell = kfs.length ? `${kfs.length}${blankKf ? `（空 ${blankKf}）` : ''}` : '—';
    lines.push(
      `| ${suiteTag(r)} | ${r.meta.index} | ${r.meta.title} | ${r.execution.mode} | ${statusMark(r)} | ${cells.join(' | ')} | ${r.execution.termination ?? '—'} | ${r.execution.wallClockMs} | ${r.execution.frameCount} | ${r.observations.diagnosticCount ?? 0} | ${kfCell} |`,
    );
  }
  lines.push('');
  lines.push(
    '> **关键帧**列 = 该题步骤边界帧的数量（四件套之四，§7.5）。括号里的"空 N"表示有 N 个边界帧命令数为 0 ——',
  );
  lines.push(
    '> 那通常意味着**该步的 `stateAt` 分支写漏了**，而只看总帧数/总命令数的判据看不出这一点。检查由 `run-suite.mjs` 的报告后置体检强制执行。',
  );
  lines.push('');
  lines.push('## 扩展检查（C10 物理包络 · X1 导出键重名 · X2 `Draw.raw` 使用率，**均不属于 §7.2 冻结判据**）');
  lines.push('');
  lines.push('C10 由 `VIEW.SIM.regions` 自愿声明各阶段的合法区域；未声明的题不算失败（`skip`）。X1/X2 只在报告里提醒，不阻塞。');
  lines.push('');
  lines.push('| 套件 | # | 题目 | C10 | X1 | X2 |');
  lines.push('|---|---|---|---|---|---|');
  const mark = (x) => (x?.status === 'pass' ? '✓' : x?.status === 'fail' ? '✗' : '·');
  for (const r of sortBySuite(reports)) {
    const get = (id) => r.extensions?.find((x) => x.id === id);
    lines.push(`| ${suiteTag(r)} | ${r.meta.index} | ${r.meta.title} | ${mark(get('C10'))} | ${mark(get('X1'))} | ${mark(get('X2'))} |`);
  }
  lines.push('');
  lines.push('## 观测指标（§19.1 / §22 M22）');
  lines.push('');
  const totalRaw = reports.reduce((n, r) => n + r.observations.drawRawCount, 0);
  const totalCmd = reports.reduce((n, r) => n + r.observations.totalCommands, 0);
  lines.push(`- \`Draw.raw\` 使用率：${totalCmd ? ((totalRaw / totalCmd) * 100).toFixed(2) : '0.00'}%（${totalRaw}/${totalCmd} 条命令）——§19.1 门禁 <10%`);
  lines.push(`- 单帧命令数峰值：${Math.max(...reports.map((r) => r.observations.maxCommandsPerFrame))}`);
  lines.push(`- 平均执行墙钟：${Math.round(reports.reduce((n, r) => n + r.execution.wallClockMs, 0) / Math.max(1, reports.length))} ms（预算 ${reports[0]?.execution.wallClockMs ? '' : ''}见 §6.3：3–5 s）`);
  const failByCheck = {};
  for (const r of reports) {
    for (const c of r.checks) if (c.status === 'fail') failByCheck[c.id] = (failByCheck[c.id] || 0) + 1;
  }
  lines.push(`- 失败检查号分布：${Object.keys(failByCheck).length ? Object.entries(failByCheck).map(([k, v]) => `${k}×${v}`).join(' · ') : '无失败'}`);
  lines.push('');
  lines.push('## 逐题失败明细');
  lines.push('');
  let anyFail = false;
  for (const r of reports) {
    const bad = r.checks.filter((c) => c.status === 'fail');
    if (!bad.length) continue;
    anyFail = true;
    lines.push(`### ${r.meta.index}. ${r.meta.title}`);
    for (const c of bad) {
      lines.push(`- **${c.id}**（${c.severity === 'blocking' ? '硬拒' : '告警'}）：${c.detail}`);
      for (const o of c.offenders ?? []) lines.push(`  - ${o.reason}\n    \`\`\`\n    ${o.snippet}\n    \`\`\``);
      for (const d of c.diagnostics ?? []) {
        const tag = labelOf(d.precision);
        const at = d.line ? `${d.slot} 第 ${d.line} 行${d.column ? ` 第 ${d.column} 列` : ''}` : d.slot;
        lines.push(`  - **${at}**（${tag}）：${d.message}`);
        for (const ctx of d.context ?? []) lines.push(`    \`${ctx.isTarget ? '>' : ' '} ${String(ctx.line).padStart(4)} | ${ctx.text}\``);
      }
    }
    lines.push('');
  }
  if (!anyFail) lines.push('全部题目无失败项。');
  return `${lines.join('\n')}\n`;
}

export async function main() {
  const { suite, filters } = parseSuiteArgs(process.argv.slice(2));
  const started = Date.now();
  mkdirSync(REPORT_DIR, { recursive: true });

  /* ── ⓪ 真题清单体检（`--suite real-exam|all` 才跑；自带负对照） ──
     为什么在这里：清单是真题的"题目来源"，它坏了后面全是噪音。
     负对照（故意写坏的 5 份清单）每次真跑 —— 否则"体检写了但没生效"没人发现。 */
  if (suite !== 'regression-15') {
    const missed = auditSelfControlFailures();
    if (missed.length) {
      console.error(`✗ 清单体检的负对照没被点名（${missed.length} 条）：`);
      for (const m of missed) console.error(`    · ${m}`);
      process.exitCode = 1;
      return;
    }
    console.log('  ✓ 清单体检负对照：5 份坏清单全部被点名（缺程序 / 多程序 / 题号不符 / state.e0 / bodies 引用不存在 key）');
  }

  const { reports, audit } = await runSuite(filters, suite);
  const totalMs = Date.now() - started;

  if (audit) {
    const { errors, counts, runnable } = audit;
    if (errors.length) {
      console.error(`✗ 真题清单体检未过（${errors.length} 条）：`);
      for (const e of errors) console.error(`    · [${e.code}] ${e.detail}`);
      process.exitCode = 1;
    } else {
      const ro = audit.runnable.length;
      console.log(
        `  ✓ 真题清单体检：可跑 ${ro} 道 · 待做 ${counts.todo} · 占位 ${counts.placeholder} · 冻结哈希一致`,
      );
      /* 防"把 status 全改成 todo，门禁绿着但一道真题都没跑"。
         重建期（manifest.restart=true + restartNote）允许 0 道，其余情况至少 3 道。 */
      const manifest = JSON.parse(readFileSync(join(REAL_EXAM_DIR, 'index.json'), 'utf8'));
      const restart = manifest.restart === true;
      if (ro < 3 && !restart) {
        console.error(`✗ 真题可跑的只有 ${ro} 道（至少 3 道；重建期请在 index.json 写 restart + restartNote）`);
        process.exitCode = 1;
      } else if (ro < 3) {
        console.log(`  ⚠ 真题集重建中（index.json restart=true）：可跑 ${ro} 道，③ 只跑合成题`);
      }
    }
  }

  for (const r of reports) {
    writeFileSync(join(REPORT_DIR, `${r.entry}.dryrun.json`), `${JSON.stringify(r, null, 2)}\n`, 'utf8');
  }
  writeFileSync(join(REPORT_DIR, 'dry-run-report.json'), `${JSON.stringify(reports, null, 2)}\n`, 'utf8');
  writeFileSync(join(REPORT_DIR, 'summary.md'), renderSummary(reports, { totalMs }), 'utf8');

  const counts = reports.reduce(
    (acc, r) => {
      acc[r.verdict] = (acc[r.verdict] || 0) + 1;
      return acc;
    },
    {},
  );
  console.log(`Dry-Run 完成：${reports.length} 题（${suiteCounts(reports)}） · ${totalMs} ms`);
  console.log(`  通过 ${counts.pass ?? 0} · 告警 ${counts['pass-with-warnings'] ?? 0} · 失败 ${counts.fail ?? 0}`);
  for (const r of sortBySuite(reports)) {
    const bad = r.checks.filter((c) => c.status === 'fail').map((c) => c.id);
    console.log(
      `  [${suiteTag(r)}] ${String(r.meta.index).padStart(2, '0')} ${r.meta.title.padEnd(18, '　')} ${statusMark(r)}${bad.length ? ` · 未过 ${bad.join(',')}` : ''}`,
    );
  }
  const c10 = reports.map((r) => r.extensions?.find((x) => x.id === 'C10')).filter(Boolean);
  const declared = c10.filter((c) => c.status !== 'skip');
  const c10Bad = declared.filter((c) => c.status === 'fail');
  console.log(
    `  C10 扩展（物理包络，非 §7.2）：声明 ${declared.length} 题 · 通过 ${declared.length - c10Bad.length} · 失败 ${c10Bad.length} · 未声明 ${c10.length - declared.length} 题（可选）`,
  );

  /* ── 关键帧体检（四件套之四，§7.5；第 3 期补齐） ──
     三个可机检的判据：
       ① 每个步骤都要有对应关键帧（数量必须等于步骤数）；
       ② `t0` 必须随步骤递增；
       ③ **每个步骤边界帧都要画得出东西**（commands > 0）——
          这条最容易发现"某一步的 stateAt 分支写漏了"，而只看总量的判据看不出来。 */
  const kfProblems = [];
  for (const r of reports) {
    const kfs = Array.isArray(r.keyframes) ? r.keyframes : null;
    if (!kfs) {
      kfProblems.push(`${r.entry}: 报告里没有 keyframes`);
      continue;
    }
    const stepCount = r.observations?.stepCount ?? 0;
    if (kfs.length !== stepCount) kfProblems.push(`${r.entry}: 关键帧 ${kfs.length} 个 ≠ 步骤 ${stepCount} 个`);
    for (let i = 1; i < kfs.length; i += 1) {
      if (!(kfs[i].t0 >= kfs[i - 1].t0)) kfProblems.push(`${r.entry}: 第 ${i + 1} 个关键帧的 t0 没有递增`);
    }
    const blank = kfs.filter((k) => !(k.commands > 0));
    if (blank.length) {
      kfProblems.push(`${r.entry}: 第 ${blank.map((b) => b.step).join('/')} 步的边界帧命令数为 0（该步 stateAt 分支可能写漏）`);
    }
  }
  const kfTotal = reports.reduce((n, r) => n + (r.keyframes?.length ?? 0), 0);
  console.log(
    kfProblems.length
      ? `  ✗ 关键帧体检未过（${kfProblems.length} 条）：\n${kfProblems.map((p) => `      ${p}`).join('\n')}`
      : `  ✓ 关键帧体检：${kfTotal} 个（${reports.length} 题 × 各自步骤数）· 步骤边界帧全部非空 · t0 递增`,
  );
  if (kfProblems.length) process.exitCode = 1;

  console.log('  → tests/reports/（逐题 *.dryrun.json + dry-run-report.json + summary.md）');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
