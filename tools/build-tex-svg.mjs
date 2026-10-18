#!/usr/bin/env node
/**
 * 公式预渲染器：用 **mathjax-full 的 Node API** 把题目里的 LaTeX 渲染成 SVG，
 * 在构建期生成到 `template/vendor/tex-svg/<question-id>.json`，模板页按 `.tex` 内联。
 *
 * 为什么走"预渲染"而不是"浏览器内跑 MathJax"（与 §2.2 的关系，需要向用户说明）：
 *   §2.2 定案是「MathJax 3.2.2 SVG 完全内联、无外部请求」。浏览器内跑 MathJax 需要
 *   把 `components/src/tex-mml-svg` 打成一个 IIFE 包，这需要 esbuild/rollup。
 *   本机沙箱装不上 esbuild（`npm install` 报 up to date 但包不存在，postinstall 被限制），
 *   所以本期采用**同样离线、同样零外链**的等价做法：
 *     · 构建期用 mathjax-full 的 Node API 渲染（真 MathJax，不是自研近似）；
 *     · 产出 SVG + 去重后的字形 `<defs>` 内联进单文件 HTML；
 *     · 运行期不再需要 MathJax 本体。
 *   字形 `<defs>` 全局去重（MathJax 的 path id 由字形决定，天然可复用），
 *   因此 15 个页面各自的体积是可控的，且每个页面仍是**一个文件**。
 *
 * 降级链保持不变：预渲染命中 → MathJax SVG；未命中 → 内置 ODTex 行内渲染；再不行 → 原文。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { paths } from './paths.mjs';

/** 从任意文本里抽出 `$...$` 行内公式（题面用），以及显式传入的 tex 列表 */
export function extractInlineTex(text) {
  const out = [];
  const re = /\$([^$\n]+)\$/g;
  let m;
  while ((m = re.exec(String(text ?? '')))) out.push(m[1].trim());
  return out;
}

/** 拆出 MathJax 输出里的 <defs> 与 <svg> 主体 */
function splitDefs(markup) {
  const defsMatch = /<defs>([\s\S]*?)<\/defs>/.exec(markup);
  const defs = defsMatch ? defsMatch[1] : '';
  const body = markup.replace(/<defs>[\s\S]*?<\/defs>/, '');
  return { defs, body };
}

/** 从 defs 里抓出每个字形 path（id → d），用于全局去重 */
function extractGlyphPaths(defs) {
  const map = new Map();
  const re = /<path\s+id="([^"]+)"\s+d="([^"]+)"\s*\/?>/g;
  let m;
  while ((m = re.exec(defs))) map.set(m[1], m[2]);
  return map;
}

export async function main() {
  const { init } = await import('mathjax-full/es5/node-main.js');
  const MathJax = await init({ loader: { load: ['input/tex', 'output/svg'] } });
  const adaptor = MathJax.startup.adaptor;

  const render = (tex) => {
    const svg = MathJax.tex2svg(tex, { display: false });
    return adaptor.outerHTML(svg);
  };

  const { readdirSync } = await import('node:fs');
  const files = readdirSync(paths.questions).filter((f) => f.endsWith('.mjs')).sort();
  mkdirSync(join(paths.templateVendor, 'tex-svg'), { recursive: true });

  const globalGlyphs = new Map();
  const summary = [];

  for (const file of files) {
    const program = (await import(pathToFileURL(join(paths.questions, file)).href)).default;
    const texSet = new Set();

    for (const tex of extractInlineTex(program.slots.PROBLEM)) texSet.add(tex);
    // 步骤里的 tex 是行式表的一行一项，直接按 `tex:` 取值
    const stepText = program.slots.STEPS;
    const stepRe = /^tex:\s*(.+)$/gm;
    let m;
    while ((m = stepRe.exec(stepText))) texSet.add(m[1].trim());

    const map = {};
    const usedGlyphs = new Map(); // 本页实际引用到的字形（按需内联，避免每页都背全量字形表）
    let bytes = 0;
    for (const tex of texSet) {
      try {
        const markup = render(tex);
        const { defs, body } = splitDefs(markup);
        for (const [id, d] of extractGlyphPaths(defs)) globalGlyphs.set(id, d);
        // 只挑出 body 里真正 href 到的字形
        const refRe = /href="#([^"]+)"/g;
        let r;
        while ((r = refRe.exec(body))) {
          const id = r[1];
          if (defs.includes(`id="${id}"`)) {
            const d = extractGlyphPaths(defs).get(id);
            if (d) usedGlyphs.set(id, d);
          }
        }
        map[tex] = body;
        bytes += body.length;
      } catch (err) {
        console.warn(`  ! ${program.id} 渲染失败：${tex.slice(0, 40)} — ${err.message}`);
      }
    }

    const pageGlyphs = [...usedGlyphs.entries()].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join('');
    writeFileSync(
      join(paths.templateVendor, 'tex-svg', `${program.id}.json`),
      `${JSON.stringify({ renderer: 'mathjax-full@3.2.2', glyphs: pageGlyphs, formulas: map })}\n`,
      'utf8',
    );
    summary.push({ id: program.id, formulas: Object.keys(map).length, bytes, glyphs: usedGlyphs.size, glyphBytes: pageGlyphs.length });
  }

  /**
   * ⚠ 第 3 期第 8 步修掉的"僵尸产物"：
   *
   * `template/vendor/tex-svg/manifest.json` 原先**没有任何代码写它** ——
   * 它是第 1 期某次构建留下的快照，之后公式数变了它却不动，而 `tools/doctor.mjs` 恰好读它报数，
   * 于是**环境自检长期在报过期数字**（205 vs 真实 207）。两份产物都在、都能解析、格式都合法，
   * 只是互不一致 ⇒ **没有任何门禁能发现**。
   *
   * 修法：由本脚本**一并生成**，并在门禁 ⑧ 里断言"manifest 的汇总 == 本次构建的汇总"。
   * 口径：`manifest.questions` 必须与逐页 `q*.json` 一一对应（doctor 读的就是它）。
   */
  const manifest = {
    format: 'od-tex-svg-manifest',
    renderer: 'mathjax-full@3.2.2 (tex2svg)',
    note: '构建期预渲染；运行期无需 MathJax 本体。字形 path 全局去重后内联。本文件由 tools/build-tex-svg.mjs 生成，请勿手改。',
    glyphCount: globalGlyphs.size,
    glyphBytes: [...globalGlyphs.values()].reduce((n, d) => n + d.length, 0),
    questions: summary.map((s) => ({
      id: s.id,
      formulas: s.formulas,
      bytes: s.bytes,
      glyphs: s.glyphs,
      glyphBytes: s.glyphBytes,
    })),
  };
  writeFileSync(join(paths.templateVendor, 'tex-svg', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const total = summary.reduce((n, s) => n + s.formulas, 0);
  console.log(`✓ 公式预渲染完成：${summary.length} 题 · ${total} 条公式`);
  console.log(`  全量字形 ${globalGlyphs.size} 个 path（仅作观测；每页只内联自己用到的那部分）`);
  for (const s of summary) {
    console.log(
      `  · ${s.id.padEnd(28)} ${String(s.formulas).padStart(3)} 条 · 公式 ${(s.bytes / 1024).toFixed(1)} KB · 字形 ${String(s.glyphs).padStart(4)} 个 ${(s.glyphBytes / 1024).toFixed(1)} KB`,
    );
  }

  /* 自校验：manifest 与逐页产物必须一致（这正是原先缺失的那道闸） */
  const mismatched = [];
  for (const s of summary) {
    const page = JSON.parse(readFileSync(join(paths.templateVendor, 'tex-svg', `${s.id}.json`), 'utf8'));
    const pageCount = Object.keys(page.formulas ?? {}).length;
    if (pageCount !== s.formulas) mismatched.push(`${s.id}: 页面 ${pageCount} ≠ 汇总 ${s.formulas}`);
    const inManifest = manifest.questions.find((q) => q.id === s.id);
    if (!inManifest || inManifest.formulas !== pageCount) mismatched.push(`${s.id}: manifest 与页面不一致`);
  }
  const manifestTotal = manifest.questions.reduce((n, q) => n + q.formulas, 0);
  if (manifestTotal !== total) mismatched.push(`manifest 合计 ${manifestTotal} ≠ 本次构建 ${total}`);
  if (mismatched.length) {
    console.error(`✗ manifest 自校验失败（${mismatched.length} 条）：\n${mismatched.map((m) => `  - ${m}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ manifest.json 已同步（${manifest.questions.length} 题 · ${manifestTotal} 条公式；与逐页产物一致）`);
  }
  console.log('  → template/vendor/tex-svg/');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
