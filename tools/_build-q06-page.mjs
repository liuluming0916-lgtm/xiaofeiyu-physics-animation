import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildQuestionHtml, toClassicScript, provenanceLine } from '../template/build-template.mjs';
import { parseStepsSlot } from '../sdk/runtime/animation-runtime.mjs';

const root = process.cwd();
const program = (await import('../tests/real-exam/q06.mjs')).default;
const templateText = readFileSync(join(root, 'template', 'animation-template.html'), 'utf8');
const runtimeText = toClassicScript(readFileSync(join(root, 'sdk', 'runtime', 'animation-runtime.mjs'), 'utf8'));
const texText = readFileSync(join(root, 'template', 'tex-inline-renderer.js'), 'utf8');
const texSvg = JSON.parse(readFileSync(join(root, 'template', 'vendor', 'tex-svg', 'q06.json'), 'utf8'));
const steps = parseStepsSlot(program.slots.STEPS ?? '');
const stepTimes = steps
  .map((s, i) => ({ step: i + 1, t0: s.t0, t1: s.t1 }))
  .filter((s) => Number.isFinite(s.t0) && Number.isFinite(s.t1) && s.t1 > s.t0);
const html = buildQuestionHtml(
  program,
  templateText,
  runtimeText,
  texText,
  provenanceLine(program, 'real-exam-pilot', texSvg),
  { texSvg, stepTimes: stepTimes.length ? stepTimes : null },
);
writeFileSync(join(root, 'tests', 'real-exam', 'q06.html'), html, 'utf8');
console.log('wrote tests/real-exam/q06.html', html.length);
