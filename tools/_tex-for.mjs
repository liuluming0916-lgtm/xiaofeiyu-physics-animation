#!/usr/bin/env node
/**
 * _tex-for —— 给**任意一份 program.json** 预渲染公式，写到 `template/vendor/tex-svg/<id>.json`。
 *
 * 为什么需要：`tools/build-tex-svg.mjs` 只扫 `tests/real-exam`/`regression-15` 目录里的 `.mjs`，
 * 而金标准候选常常是"模型刚吐出来的一份 program.json"，公式集已变。
 * 不重渲染就会拿旧公式集去配新步骤 —— 页面上会出现**步骤文字是新的、公式是旧的**。
 *
 * 用法：
 *   node tools/_tex-for.mjs tests/reports/q06-model.program.json --id q06
 *   node tools/_tex-for.mjs tests/real-exam/q04.program.json  --id q04
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = { program: null, id: null };
for (let i = 0; i < process.argv.length - 1; i += 1) {
  const a = process.argv[i + 2];
  if (a === '--id') args.id = process.argv[i + 3];
  else if (!a?.startsWith('--') && !args.program) args.program = a;
}
if (!args.program) {
  console.error('用法：node tools/_tex-for.mjs <program.json> --id q06');
  process.exit(2);
}
const programPath = resolve(args.program);
const program = JSON.parse(readFileSync(programPath, 'utf8'));
const id = args.id ?? program.id;
if (!id) throw new Error('缺 id');

const texSet = new Set();
const re = /\$([^$\n]+)\$/g;
const pushAll = (text) => {
  let m;
  while ((m = re.exec(String(text ?? '')))) texSet.add(m[1].trim());
  re.lastIndex = 0;
};
pushAll(program.slots.PROBLEM);
for (const line of String(program.slots.STEPS ?? '').split('\n')) {
  const m = /^tex:\s*(.+)$/.exec(line.trim());
  if (m) texSet.add(m[1].trim());
}

const { init } = await import('mathjax-full/es5/node-main.js');
const MathJax = await init({ loader: { load: ['input/tex', 'output/svg'] } });
const adaptor = MathJax.startup.adaptor;

function extractGlyphPaths(defs) {
  const map = new Map();
  const re2 = /<path\s+id="([^"]+)"\s+d="([^"]+)"\s*\/?>/g;
  let m;
  while ((m = re2.exec(defs))) map.set(m[1], m[2]);
  return map;
}

const formulas = {};
const used = new Map();
let failed = 0;
for (const tex of texSet) {
  try {
    const markup = adaptor.outerHTML(MathJax.tex2svg(tex, { display: false }));
    const defsMatch = /<defs>([\s\S]*?)<\/defs>/.exec(markup);
    const defs = defsMatch ? defsMatch[1] : '';
    const body = markup.replace(/<defs>[\s\S]*?<\/defs>/, '');
    const paths = extractGlyphPaths(defs);
    const refRe = /href="#([^"]+)"/g;
    let r;
    while ((r = refRe.exec(body))) {
      const gid = r[1];
      if (defs.includes(`id="${gid}"`) && paths.get(gid)) used.set(gid, paths.get(gid));
    }
    formulas[tex] = body;
  } catch (err) {
    failed += 1;
    console.warn(`  ! 渲染失败：${tex.slice(0, 40)} — ${err.message}`);
  }
}

const dir = join('template', 'vendor', 'tex-svg');
mkdirSync(dir, { recursive: true });
const out = join(dir, `${id}.json`);
const glyphs = [...used.entries()].map(([gid, d]) => `<path id="${gid}" d="${d}"/>`).join('');
writeFileSync(out, `${JSON.stringify({ renderer: 'mathjax-full@3.2.2', glyphs, formulas }, null, 0)}\n`, 'utf8');
console.log(`_tex-for ${id} · ${Object.keys(formulas).length} 条公式 · 字形 ${used.size} 个${failed ? ` · 失败 ${failed}` : ''} → ${out}`);
