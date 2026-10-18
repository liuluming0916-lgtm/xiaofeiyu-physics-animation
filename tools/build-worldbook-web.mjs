#!/usr/bin/env node
/**
 * 生成前端侧的两份**派生产物**（第 5 期）：
 *
 *   ① `web/src/lib/worldbook-engine.js` —— `core/worldbook/engine.mjs` 的**逐字节副本**
 *   ② `web/src/lib/worldbook-demo.ts`   —— 内置词条 + 覆盖率报告（纯数据）
 *
 * ── 为什么预览器必须用"逐字节副本"而不是"再写一份看起来一样的"
 *
 * W10 的验收原文是"**预览器与实际请求逐字一致**"。第 3、4 期各有一次"桩太弱/判据测错环节"
 * 造成的假绿，所以这一次不用"两处逻辑写得一样"来保证，而是：
 *   编排层与预览器**跑同一份字节的代码**（`core/worldbook/engine.mjs`）；
 *   构建期判据（`tools/web-build.mjs`）断言副本与本源逐字节相同。
 * 于是"改了一处忘了另一处"在结构上不可能发生 —— 它连编译都过不去。
 *
 * ⚠ 与 `tools/build-demo-questions.mjs` 同一处置方式：本脚本是 `tools/web-build.mjs` 的
 *   **子步骤**（不是独立门禁步骤），所以它不出现在 `verify-all.mjs` 的 STEPS 里，
 *   而在 `tools/verify-coverage.mjs` 里带着理由豁免（"子步骤"≠"漏挂"）。
 *
 * 用法：node tools/build-worldbook-web.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PROJECT_ROOT } from './paths.mjs';
import { PACK_FORMAT, PACK_VERSION, loadLibrary, readCoverageTarget } from '../core/worldbook/store.mjs';
import { checkCoverage, formatCoverageLine, targetFromFile } from '../core/worldbook/coverage.mjs';
import { triggerWorldbook } from '../core/worldbook/engine.mjs';
import { mergeWorldbookStages } from '../core/worldbook/index.mjs';

export const ENGINE_SRC = join(PROJECT_ROOT, 'core', 'worldbook', 'engine.mjs');
export const ENGINE_OUT = join(PROJECT_ROOT, 'web', 'src', 'lib', 'worldbook-engine.js');
/**
 * 第 5.7 期：**解析器也要复制到浏览器**。
 *
 * 设置页的预览器要支持"**粘贴一段模型转写 → 自动解析出考点/题型/元件**"（计划 §S5），
 * 而那件事的唯一实现就是 `core/worldbook/concepts.mjs` 的 `parseJudgement`。
 * 若前端另写一份"差不多的解析"，它迟早与本尊漂移 —— 于是"粘贴解析结果"与
 * "真实链路解析结果"就会不一样，而那种不一致**看不出来**。
 * 所以：同一份字节，同一套判据（`expectedConceptsCopy()`）。
 */
export const CONCEPTS_SRC = join(PROJECT_ROOT, 'core', 'worldbook', 'concepts.mjs');
export const CONCEPTS_OUT = join(PROJECT_ROOT, 'web', 'src', 'lib', 'worldbook-concepts.js');
export const DEMO_OUT = join(PROJECT_ROOT, 'web', 'src', 'lib', 'worldbook-demo.ts');

/**
 * 副本的文件头。
 *
 * ⚠ 它必须由**本模块**给出，并且判据用的是 `expectedEngineCopy()` 的**完整字节**
 *   （而不是"跳过前 N 行再比"）—— 否则手改文件头（例如偷偷加一句 `process.env`）
 *   就绕过了判据。`tools/web-build.mjs` 的产物体检还会再查一遍产物里没有 Node 全局。
 */
export const ENGINE_BANNER = `/**
 * ⚠ **本文件由 \`tools/build-worldbook-web.mjs\` 从 \`core/worldbook/engine.mjs\` 逐字节复制生成，请勿手改。**
 *
 * 为什么要复制而不是"再写一份看起来一样的"：设置页的「实时试触发预览器」必须与
 * 真实请求**逐字节一致**（W10）。让两边跑**同一份字节的代码**，是唯一能结构性保证
 * 这一点的做法 —— 改本源、忘了改副本，构建期判据会直接失败。
 *
 * 开发期改世界书触发/组装逻辑：**改 \`core/worldbook/engine.mjs\`**，然后跑
 * \`node tools/web-build.mjs\`（它会重新复制并核对）。
 */

`;

/** 解析器副本的文件头（与引擎副本同一口径：判据比的是含头的完整字节） */
export const CONCEPTS_BANNER = `/**
 * ⚠ **本文件由 \`tools/build-worldbook-web.mjs\` 从 \`core/worldbook/concepts.mjs\` 逐字节复制生成，请勿手改。**
 *
 * 为什么要复制：设置页的预览器要支持"粘贴一段模型转写 → 自动解析出考点/题型/元件"，
 * 而**解析的唯一实现**就是本尊。让两边跑同一份字节，是唯一能结构性保证
 * "粘贴解析 = 真实链路解析"的做法；改本源、忘了改副本，构建期判据会直接失败。
 *
 * 开发期改解析逻辑：**改 \`core/worldbook/concepts.mjs\`**，然后跑
 * \`node tools/web-build.mjs\`（它会重新复制并核对）。
 */

`;

/** 期望落盘的副本内容（判据与生成共用这一个函数 ⇒ 两边不可能各有一套口径） */
export function expectedEngineCopy() {
  return `${ENGINE_BANNER}${readFileSync(ENGINE_SRC, 'utf8')}`;
}

/** 第 5.7 期：解析器副本的期望字节（与引擎同一套判据口径） */
export function expectedConceptsCopy() {
  return `${CONCEPTS_BANNER}${readFileSync(CONCEPTS_SRC, 'utf8')}`;
}

/** 内置库的快照（供前端展示与预览器使用） */
export function buildLibrarySnapshot() {
  const lib = loadLibrary();
  if (!lib.ok) {
    throw new Error(`世界书载入失败（构建期就应当失败，而不是把坏数据打进产物）：\n- ${lib.problems.join('\n- ')}`);
  }
  // 第 5.5 期 P3：覆盖率带上**真口径**（111 个题型的目标与进度），前端面板据此显示"还差多少"
  const coverage = checkCoverage({ entries: lib.builtin, target: targetFromFile(readCoverageTarget()) });
  return { lib, coverage };
}

/** 演示源用的真题（与 `tools/build-demo-questions.mjs` 的 `DEMO_QUESTION_FILES` 同一道） */
const DEMO_QUESTION_FILE = 'q01-conveyor-heat.mjs';

/**
 * 取演示真题的题面（§9.2 的输入 T）。
 *
 * ⚠ 取不到就**抛**：解题页的「世界书依据」面板会因此失去数据来源，
 *   而"面板空着"与"题面取不到"在界面上长得一模一样 —— 那正是最该避免的静默失败。
 */
function demoProblemText() {
  const raw = readFileSync(join(PROJECT_ROOT, 'tests', 'regression-15', DEMO_QUESTION_FILE), 'utf8');
  const m = /PROBLEM: String\.raw`([\s\S]*?)`,\n/.exec(raw);
  if (!m) throw new Error(`取不到 ${DEMO_QUESTION_FILE} 的 PROBLEM 槽位（演示源的世界书依据会没有数据来源）`);
  return m[1];
}

/**
 * 构建期用**真引擎**在真题题面上跑一次世界书，产出一份可直接发给前端的 `worldbook_done` 载荷。
 *
 * 为什么值得这么做：前端跑的是演示源（不调模型），但"世界书依据"这件事**本来就与模型无关**
 * —— 它完全由题面与词条集合决定。所以在构建期用真引擎算一遍，解题页显示的就是**真结果**，
 * 只是它的输入是构建期快照而已（与 `demo-questions.ts` 同一口径）。
 *
 * `scene_code` 阶段的第二遍扫描用一段固定的解题文本（演示源不产生真解题文本）。
 */
function buildDemoEvent(lib) {
  const problemText = demoProblemText();
  const solutionText = '共速时刻 t* = u / (mu g) = 1.0 s；此过程摩擦生热 Q = mu m g ds = 2.0 J。';
  const solveRes = triggerWorldbook({ entries: lib.entries, text: problemText });
  const sceneRes = triggerWorldbook({ entries: lib.entries, text: [problemText, solutionText].join('\n') });
  const merged = mergeWorldbookStages({ solveRes, sceneRes, entries: lib.entries });
  return {
    hash: merged.hash,
    libraryCount: merged.entries,
    matched: merged.matched,
    entries: merged.provenance,
    emptySlots: merged.emptySlots,
    truncatedSlots: merged.truncatedSlots,
    warnings: merged.warnings,
    charsBySlot: merged.charsBySlot,
    injectedBySlot: merged.injectedBySlot,
  };
}

function buildDemoTs() {
  const { lib, coverage } = buildLibrarySnapshot();
  const builtin = lib.builtin;
  const demoEvent = buildDemoEvent(lib);
  const header = `/**
 * ⚠ **本文件由 \`tools/build-worldbook-web.mjs\` 自动生成，请勿手改。**
 *
 * 来源（唯一事实来源）：
 *   · 内置词条：\`core/worldbook/data/*.json\`（由 \`tools/rewrite-worldbook-entries.mjs\` 写出）
 *   · 覆盖率：\`core/worldbook/coverage.mjs\`
 * 生成时机：\`node tools/web-build.mjs\` 的 ⓪ 段（前端打包之前）。
 *
 * ── 诚实声明（与 App 顶部那条横幅同一口径）
 *
 * 本期前端跑的是**演示源**：这些词条数据是**构建期快照**，页面里的编辑只存在内存中，
 * 「导出 JSON」能拿到文本，但**写回 \`ai-rules/worldbook/\` 需要本地服务（第 9 步接入）**。
 * 预览器的**触发与组装逻辑是真的**（用的是 \`core/worldbook/engine.mjs\` 的逐字节副本），
 * 只有"落盘"这一步是缺的 —— 不谎报。
 */

/** 词条形状（与 \`contracts/worldbook-entry.schema.json\` 对应；这里只声明 UI 用到的字段） */
export interface WorldbookEntryLike {
  id: string
  title: string
  origin: string
  category: string
  enabled: boolean
  constant: boolean
  recursive: boolean
  keys: string[]
  secondary_keys: { logic: string; list: string[] }
  /** 第 5.7 期新增：考点（词表 A）。可选 —— 灰度期老词条没有这三栏，靠 keys 字面命中工作 */
  concepts?: string[]
  /** 第 5.7 期新增：题型标签 / 细考点（词表 B，按考点分组）；空数组 = 该考点下的通用词条 */
  tags?: string[]
  /** 第 5.7 期新增：实体物理图元 · 动画元件（原名 devices / 器材） */
  elements?: string[]
  insertion_slot: string[]
  order: number
  priority: string
  content: string
  code_examples: string[]
}

/** 覆盖率报告（\`core/worldbook/coverage.mjs\` 的输出；数字全部由构建期算好） */
export interface WorldbookCoverageReport {
  total: number
  structuralRate: number
  selfCheckCoverage: number
  exampleCoverage: number
  missingSelfCheck: string[]
  missingExamples: string[]
  contentComplete: boolean
  reason: string | null
  nonCompliant: Array<{ id: string; title: string; problems: string[] }>
}
`;
  const body = `
/**
 * ⚠ 这里**不要**写 \`as const\`：它会把 \`insertion_slot\` 变成 \`readonly ["solve", …]\`，
 *   而 \`readonly string[]\` **不能**赋给 \`string[]\`（引擎的类型声明里是可变的），
 *   一处 \`as const\` 就能让整个设置页的 \`tsc\` 报一串看不出原因的错。
 */

/** 构建期快照：内置词条（\`origin: builtin\`） */
export const WORLDBOOK_BUILTIN: ReadonlyArray<WorldbookEntryLike> = ${JSON.stringify(builtin, null, 2)}

/**
 * 构建期快照：用户词条（\`origin: user\`）。
 *
 * 本期恒为空数组：用户区的真实内容在 \`ai-rules/worldbook/\` 里，浏览器读不到文件系统。
 * 页面里新写的词条只存在内存中（见文件头的诚实声明）。
 */
export const WORLDBOOK_USER: ReadonlyArray<WorldbookEntryLike> = []

/** 内置库的稳定哈希（\`provenance.worldbookHash\` 用的同一个算法） */
export const WORLDBOOK_HASH = ${JSON.stringify(lib.hash)}

/**
 * 导出包的格式标识与版本（**从 \`core/worldbook/store.mjs\` 派生**，不是抄录）。
 *
 * ⚠ 浏览器拿不到 Node 侧的契约文件，所以这两个值必须由构建期写进产物；
 *   \`tools/web-build.mjs\` 会断言它们等于 \`contracts/worldbook-pack.schema.json\` 的
 *   \`format.const\` / \`version.const\` —— 抄错会让构建失败，而不是让 UI 悄悄导出错格式。
 */
export const WORLDBOOK_PACK_FORMAT = ${JSON.stringify(PACK_FORMAT)}
export const WORLDBOOK_PACK_VERSION = ${JSON.stringify(PACK_VERSION)}

/** 内置库的载入来源（文件名 + SHA256 + 条数），供设置页显示"这批词条是哪来的" */
export const WORLDBOOK_SOURCES: ReadonlyArray<{ name: string; kind: string; count: number; sha256: string }> = ${JSON.stringify(lib.sources.map((s) => ({ name: s.name, kind: s.kind, count: s.count, sha256: s.sha256 })), null, 2)}

/** 覆盖率报告（第 5 期只交付**机制**；内容覆盖由第 5.5 期完成） */
export const WORLDBOOK_COVERAGE: WorldbookCoverageReport = ${JSON.stringify(
    {
      total: coverage.total,
      structuralRate: coverage.structuralRate,
      selfCheckCoverage: coverage.selfCheckCoverage,
      exampleCoverage: coverage.exampleCoverage,
      missingSelfCheck: coverage.missingSelfCheck,
      missingExamples: coverage.missingExamples,
      contentComplete: coverage.contentComplete,
      reason: coverage.reason,
      nonCompliant: coverage.nonCompliant.map((r) => ({ id: r.id, title: r.title, problems: r.problems })),
    },
    null,
    2,
  )} as WorldbookCoverageReport

/**
 * 解题页「世界书依据」面板的数据（第 5 期 · §15）。
 *
 * 它是**构建期用真引擎在真题题面上跑出来的**（不是编的）：世界书的命中与组装只取决于
 * 题面与词条集合，与模型无关，所以演示源也能显示真结果。
 * 类型不写在这里 —— 让 TS 从字面量推断，再在 \`run-stream.ts\` 里按 \`WorldbookEvidence\` 校验，
 * 这样"生成物"与"消费端的类型"之间不会出现第二份手写接口。
 */
export const WORLDBOOK_DEMO_EVENT = ${JSON.stringify(demoEvent, null, 2)}
`;
  return `${header}${body}`;
}

export function main() {
  const copy = expectedEngineCopy();
  mkdirSync(dirname(ENGINE_OUT), { recursive: true });
  writeFileSync(ENGINE_OUT, copy, 'utf8');

  // 第 5.7 期：解析器副本（预览器的"粘贴转写自动解析"要用它）
  const conceptsCopy = expectedConceptsCopy();
  mkdirSync(dirname(CONCEPTS_OUT), { recursive: true });
  writeFileSync(CONCEPTS_OUT, conceptsCopy, 'utf8');

  const demo = buildDemoTs();
  mkdirSync(dirname(DEMO_OUT), { recursive: true });
  writeFileSync(DEMO_OUT, demo, 'utf8');

  const { coverage } = buildLibrarySnapshot();
  console.log(
    `✓ 世界书前端产物已生成：engine 副本 ${(copy.length / 1024).toFixed(1)} KB → web/src/lib/worldbook-engine.js · ` +
      `解析器副本 ${(conceptsCopy.length / 1024).toFixed(1)} KB → web/src/lib/worldbook-concepts.js · ` +
      `演示数据 ${(demo.length / 1024).toFixed(1)} KB → web/src/lib/worldbook-demo.ts`,
  );
  console.log(`  ${formatCoverageLine(coverage)}`);}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  try {
    main();
  } catch (err) {
    console.error(`✗ ${err?.message ?? err}`);
    process.exitCode = 1;
  }
}
