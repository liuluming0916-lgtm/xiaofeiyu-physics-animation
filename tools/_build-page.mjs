#!/usr/bin/env node
/**
 * _build-page —— 把任意一份 program.json 打成**单文件预览页**（和导出页同一套模板）。
 *
 * 为什么需要：`_build-q04-page.mjs` / `_build-q06-page.mjs` 都把路径写死了；
 * 金标准候选是"模型刚吐出来的那份"，路径每次都变。
 *
 * 用法：
 *   node tools/_build-page.mjs tests/reports/q06-model.program.json --id q06 --out tests/reports/q06-model.html
 *   node tools/_build-page.mjs tests/real-exam/q04.program.json --id q04
 *
 * 前提：`template/vendor/tex-svg/<id>.json` 已存在（用 `tools/_tex-for.mjs` 生成）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildQuestionHtml, toClassicScript, provenanceLine } from '../template/build-template.mjs';
import { parseStepsSlot } from '../sdk/runtime/animation-runtime.mjs';

const args = { program: null, id: null, out: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--id') args.id = argv[++i];
  else if (a === '--out') args.out = argv[++i];
  else if (!a.startsWith('--')) args.program = a;
}
if (!args.program) {
  console.error('用法：node tools/_build-page.mjs <program.json> [--id q06] [--out x.html]');
  process.exit(2);
}

const root = process.cwd();
const programPath = resolve(args.program);
const program = JSON.parse(readFileSync(programPath, 'utf8'));
const id = args.id ?? program.id ?? 'q';
const outPath = resolve(args.out ?? join('tests', 'reports', `${id}-model.html`));

const templateText = readFileSync(join(root, 'template', 'animation-template.html'), 'utf8');
const runtimeText = toClassicScript(readFileSync(join(root, 'sdk', 'runtime', 'animation-runtime.mjs'), 'utf8'));
const texText = readFileSync(join(root, 'template', 'tex-inline-renderer.js'), 'utf8');
const texPath = join(root, 'template', 'vendor', 'tex-svg', `${id}.json`);
const texSvg = existsSync(texPath) ? JSON.parse(readFileSync(texPath, 'utf8')) : null;
if (!texSvg) console.warn(`  ! 没有 ${texPath}，公式会退回行内渲染`);

const steps = parseStepsSlot(program.slots.STEPS ?? '');
/**
 * 时间轴优先取 `program.stepTimes`（v6 由 `couple` 阶段产出）；
 * 旧程序（STEPS 里还带 t0/t1）才退回按槽位解析。
 */
const stepTimes = Array.isArray(program.stepTimes) && program.stepTimes.length
  ? program.stepTimes
  : steps
      .map((s, i) => ({ step: i + 1, t0: s.t0, t1: s.t1 }))
      .filter((s) => Number.isFinite(s.t0) && Number.isFinite(s.t1) && s.t1 > s.t0);

const html = buildQuestionHtml(
  program,
  templateText,
  runtimeText,
  texText,
  provenanceLine(program, program.source === 'model' ? 'real-exam-model' : 'real-exam-pilot', texSvg),
  { texSvg, stepTimes: stepTimes.length ? stepTimes : null },
);
writeFileSync(outPath, html, 'utf8');
console.log(`✓ ${outPath} · ${(html.length / 1024).toFixed(1)} KB · stepTimes=${stepTimes.length}`);
