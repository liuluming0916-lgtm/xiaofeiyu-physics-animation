#!/usr/bin/env node
/**
 * 生成前端演示数据（`web/src/lib/demo-questions.ts`）。
 *
 * ── 为什么不直接 import 题目文件
 *
 * `tests/regression-15/q*.mjs` 是 **Node ESM** 源（含 `String.raw` 与多行模板），
 * 而且题面/解析里到处是反引号、反斜杠与 `${}` 形态的 LaTeX。
 * 让 Rollup 直接吃它有两个问题：
 *   ① 它会被打进浏览器产物，而它**不是**为浏览器写的；
 *   ② 手工把它复制成 TS 会出现**第二份事实来源**（改题不同步）——这是 §21.1 第 1 条最反对的。
 *
 * 所以：**构建期从唯一来源生成**一份纯数据 TS 文件，题面用 `JSON.stringify` 转义
 * （比手写模板字符串安全：LaTeX 的反斜杠与 `${` 都不会再被解释）。
 *
 * 用法：node tools/build-demo-questions.mjs
 * 门禁：接进 verify-all 的「前端打包」之前（否则产物里的演示数据会是旧的）
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PROJECT_ROOT } from './paths.mjs';
import { SLOT_KEY_NAMES } from '../contracts/spec/frozen-keys.mjs';
import { createTexRenderer, extractInlineTex, extractRowTableTex } from './tex-render.mjs';

/** 演示要用的题目（第 3 期只要 q01；加题时在这里登记，别在别处硬编码） */
const DEMO_QUESTION_FILES = ['q01-conveyor-heat.mjs'];

const OUT_PATH = join(PROJECT_ROOT, 'web', 'src', 'lib', 'demo-questions.ts');

async function main() {
  const entries = [];
  /** 演示界面会显示到的所有公式原文（去重后统一构建期渲染） */
  const allTex = new Set();

  for (const file of DEMO_QUESTION_FILES) {
    const abs = join(PROJECT_ROOT, 'tests', 'regression-15', file);
    const program = (await import(pathToFileURL(abs).href)).default;

    // 只取 8 个冻结键名，顺序即冻结键序（避免把题目文件里的其它字段带出去）
    const slots = {};
    const missing = [];
    for (const key of SLOT_KEY_NAMES) {
      const v = program.slots?.[key];
      if (typeof v !== 'string' || v.length === 0) missing.push(key);
      else slots[key] = v;
    }
    if (missing.length) {
      throw new Error(`${file} 缺少槽位：${missing.join(', ')}（演示数据不能是残缺的）`);
    }

    /**
     * ★ 收集这道题**演示界面会显示**的公式（README 13.12 的修复）。
     *
     * 演示界面显示的文本来自 `PROBLEM`（题面）与 `STEPS` 的 `tex:` 字段
     * （`parseRowTable()` 把它们取出来渲染）。这两处正是成品页也会预渲染的地方 ——
     * 演示界面必须走**同一条**构建期渲染路径，
     * 否则只能显示 LaTeX 原文（第 3 期交付后立刻出了这个事故）。
     */
    for (const t of extractInlineTex(slots.PROBLEM)) allTex.add(t);
    for (const t of extractRowTableTex(slots.STEPS)) allTex.add(t);

    entries.push({ id: program.id ?? file.replace(/\.mjs$/, ''), title: program.title ?? '', mode: program.mode ?? 'NUMERIC', slots });
  }

  // 构建期用真 MathJax 渲染（与成品页共用同一实现，见 tools/tex-render.mjs）
  const { renderAll } = await createTexRenderer();
  const tex = renderAll([...allTex]);

  const header = `/**
 * ⚠ **本文件由 \`tools/build-demo-questions.mjs\` 自动生成，请勿手改。**
 *
 * 来源：\`tests/regression-15/${DEMO_QUESTION_FILES.join('`, `')}\`（唯一事实来源）。
 * 生成时机：\`node tools/web-build.mjs\` 之前（见 \`tools/verify-all.mjs\` 的第 ⑬⑭ 步）。
 *
 * 它只含**纯数据**（8 个槽位的字符串 + 预渲染公式），不依赖任何 Node API，
 * 因此可以安全地打进浏览器产物。题面用 JSON 字面量转义，避免 LaTeX 的反斜杠/\`\${}\` 被模板字符串解释。
 *
 * \`TEX_SVG\` 是**构建期 MathJax 预渲染**的真 SVG（与 15 个成品页同一实现、同一字形去重口径）。
 * 演示界面**不**在浏览器里跑 MathJax（§2.2：完全内联、无外部请求）。
 */
`;

  const body = entries
    .map((e) => {
      const slotLines = SLOT_KEY_NAMES.map((k) => `      ${JSON.stringify(k)}: ${JSON.stringify(e.slots[k])},`).join('\n');
      return [
        `  ${JSON.stringify(e.id)}: {`,
        `    id: ${JSON.stringify(e.id)},`,
        `    title: ${JSON.stringify(e.title)},`,
        `    mode: ${JSON.stringify(e.mode)} as ProgramMode,`,
        '    slots: {',
        slotLines,
        '    },',
        '  },',
      ].join('\n');
    })
    .join('\n');

  const ts = `${header}
import type { AnimationSlots, ProgramMode } from './host-protocol'

export interface DemoQuestion {
  id: string
  title: string
  mode: ProgramMode
  slots: AnimationSlots
}

/** 演示题目清单（构建期生成；加题请改 \`tools/build-demo-questions.mjs\` 的 DEMO_QUESTION_FILES） */
export const DEMO_QUESTIONS: Record<string, DemoQuestion> = {
${body}
}

/** 供 UI 显示的清单 */
export const DEMO_QUESTION_LIST = Object.values(DEMO_QUESTIONS).map((q) => ({ id: q.id, title: q.title }))

/**
 * 构建期预渲染的公式（键 = LaTeX 原文，值 = MathJax 的 \`<mjx-container>\` 标记）。
 *
 * 字形 \`path\` 全局去重后内联，与成品页口径一致；渲染器：${tex.renderer}。
 * 运行期**不需要** MathJax 本体（§2.2）。
 */
export const TEX_SVG = {
  renderer: ${JSON.stringify(tex.renderer)},
  glyphs: ${JSON.stringify(tex.glyphs)},
  formulas: {
${Object.entries(tex.formulas)
  .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  .join('\n')}
  },
} as const
`;

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, ts, 'utf8');
  console.log(
    `✓ 演示数据已生成：${entries.length} 道题 · 预渲染公式 ${Object.keys(tex.formulas).length} 条 · ` +
      `字形 ${tex.glyphCount} 个 · ${(ts.length / 1024).toFixed(1)} KB → web/src/lib/demo-questions.ts`,
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
