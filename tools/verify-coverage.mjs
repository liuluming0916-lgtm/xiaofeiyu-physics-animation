/**
 * 门禁的**覆盖自检**：断言"仓内所有独立的检查脚本都已被 `verify-all.mjs` 挂载"。
 *
 * ── 为什么要这个（第 3 期第 9 步新增）
 *
 * 走过三期之后，门禁的失败模式变了。前两期的风险是"判据写错了"（判据本身能被测出来），
 * 而现在的风险是 **"检查写了却没接进门禁"** —— 那种情况下门禁**全绿**，
 * 但那个检查**从来没跑过**。**"绿着但没跑"比"红"更危险**，因为它看起来一切正常。
 *
 * 本模块把"该被挂载的脚本"用**可机检的规则**定义出来，而不是靠人记得：
 *
 *   候选集：`tests/*.mjs` · `tests/<子目录>/*.mjs` · `tools/*.mjs`（不含下划线开头）
 *   豁免（每条都有可复核的理由，见下面的 EXEMPT_* 常量）：
 *     · `tools/_*.mjs`          —— 一次性取证工具（不产生判定）
 *     · `tools/verify-all.mjs` / `tools/verify-coverage.mjs` —— 门禁自己
 *     · `tools/node-bin.mjs` · `tools/paths.mjs` —— 被 import 的工具库，**无 CLI 主流程**
 *     · `tools/doctor.mjs`      —— **开发环境自检**，人手动跑；它取决于"当前 shell 用哪个 Node"，
 *                                  在门禁的子进程语义下结论没有意义（门禁自己就在用解析后的 Node）
 *     · `tools/probe-question.mjs` —— **单题作者探针**，需要传题号，不是门禁步骤
 *     · `tests/regression-15/` · `tests/fake-endpoint/` · `tests/harness/` —— 题目数据与测试设施
 *     · `tests/negative-injection/cases.mjs` —— 用例数据（由 run-injection.mjs 驱动）
 *
 * 判定方式：候选脚本的相对路径必须出现在 `verify-all.mjs` 的 `STEPS` 脚本字段里。
 * ⚠ CLI 模式**从 `verify-all.mjs` 源文件里读 STEPS**，而不是在本文件里再抄一份清单 ——
 *   两处清单各自漂移正是本模块要防的病。
 *
 * ★ 本模块第一次跑就报出 **19 个假阳性**（把题目数据、假端点服务、测试台都当成了检查脚本），
 *   于是补上了目录级豁免。**这条经历值得记**：一个"宁可多报"的粗略规则会立刻淹没在噪音里，
 *   而一个"为了不报错而放宽"的规则又会漏掉真问题 —— 所以豁免必须**逐条写明理由**，
 *   让人能复核"这条豁免是否成立"，而不是把报错按掉。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 目录级豁免：这些目录里放的是**题目数据**或**共用的测试设施**，不是独立的检查脚本。
 * 每条都有可复核的理由 —— 豁免必须能被第二个人验证，否则它就成了"把报错按掉"。
 */
const EXEMPT_DIRS = new Map([
  ['tests/regression-15', '回归题集：15 道题的**数据**（槽位代码），由 run-suite 加载，不是检查脚本'],
  ['tests/real-exam', '真实高考题试点：题面/答案/候选程序数据，不是检查脚本'],
  ['tests/fake-endpoint', '假端点**服务**（被 gateway-selftest import），不是检查脚本'],
  [
    'tests/harness',
    '测试台：DOM 桩 / mock canvas 等**被 import 的设施**，本身不产生判定。' +
      '它们由各自的用例覆盖（dom-stub → host-protocol-selftest；canvas-harness → render-check）。' +
      '第 3 期交付后 dom-stub.mjs 一加进来，本覆盖自检立刻点名了它 —— 这是它该有的行为（宁可多报，再逐条给理由）。',
  ],
]);

/** 文件级豁免（含理由） */
const EXEMPT_FILES = new Map([
  [
    'tools/electron-repack.mjs',
    '**打包脚本，不是检查脚本**：它只做"复制运行时 + 换载荷 + 打包"，不产生任何判定。' +
      '同类已有 `tools/electron-build.mjs`（在 `EXEMPT_BASENAMES` 里）。' +
      '第 9 期加它是因为环境离线（无 electron-builder），需要一条"用上一版绿色版的 Electron 运行时重打包"的路线。',
  ],
  ['tests/negative-injection/cases.mjs', '负向注入的**用例数据**，由 run-injection.mjs 驱动'],
  [
    'tools/build-demo-questions.mjs',
    '**已被挂载为子步骤**：`tools/web-build.mjs` 的 ⓪ 段会调用它（门禁 ⑬⑭ 因此覆盖到它）。' +
      '它不是独立门禁步骤，所以不出现在 STEPS 里 —— 这是"子步骤"而非"漏挂"。',
  ],
  [
    'tools/tex-render.mjs',
    '**工具库**：公式预渲染的共用实现（MathJax Node API → SVG + 字形去重），被 ' +
      '`tools/build-tex-svg.mjs`（门禁 ⑧）与 `tools/build-demo-questions.mjs`（门禁 ⑬⑭ 的子步骤）import。' +
      '它没有自己的 CLI 主流程，所以不出现在 STEPS 里。',
  ],
  [
    'tools/rewrite-knowledgecard-entries.mjs',
    '**已被挂载为子步骤**：`tests/knowledgecard-selftest.mjs`（门禁 ㉒）的『W14』会 import 它的 ' +
      '`plannedFiles()`，并断言"盘上的内置库与脚本会写出的内容**逐字节一致**"。' +
      '它是内置词条的**唯一作者入口**，不是独立门禁步骤 —— 这是"子步骤"而非"漏挂"。',
  ],
  [
    'tools/build-knowledgecard-web.mjs',
    '**已被挂载为子步骤**：`tools/web-build.mjs` 的 ⓪ 段会调用它（生成浏览器侧引擎副本 ' +
      '`web/src/lib/knowledgecard-engine.js` 与演示数据），门禁 ⑬⑭ 因此覆盖到它；' +
      '门禁 ㉒ 的『W10』还会直接断言"副本与 `core/knowledgecard/engine.mjs` 逐字节一致"。',
  ],
  [
    'tools/build-knowledgecard-targets.mjs',
    '**已被挂载为子步骤**：`tests/knowledgecard-selftest.mjs`（门禁 ㉒）的『W14』会 import 它的 ' +
      '`targetFileText()`，并断言"盘上的 `core/knowledgecard/coverage-target.json` == 从书上重新抽取的结果' +
      '（且**保留**已填的 entryId）"。它是覆盖目标/进度的**生成器**，不是独立门禁步骤。',
  ],
  [
    'tools/check-knowledgecard-sources.mjs',
    '**第 5.5 期的作者预检工具**，不是独立门禁步骤，也**不该**成为门禁步骤：它做的三件事全部被既有门禁覆盖 ——' +
      '① 逐文件 `JSON.parse` 与必填字段检查 == `tools/rewrite-knowledgecard-entries.mjs` 的 `readSource()` + ' +
      '`validateEntry()`（后者是**唯一权威**，且被门禁 ㉒『W14』以"逐字节一致"钉住）；' +
      '② 主键互相包含 == `core/knowledgecard/engine.mjs` 的 `detectKeyCollisions()`（门禁 ㉒『W14-3』已有 11 条断言，' +
      '含"真实内置库里没有撞车"）；③ 「生成后自检」小节存在性 == `core/knowledgecard/coverage.mjs`（带负对照）。' +
      '它存在的唯一理由是**给人更早、更精确的报错**（说清是哪个文件第几行第几列漏了个括号）——' +
      '这正是第 5.5 期手写 JSON 时最常犯的错，而权威通道只会以 `JSON.parse` 的原始信息中止。' +
      '**若把它挂进门禁，就等于把同一件事查两遍**（且第二遍的判据更弱）。',
  ],
  [
    'tools/build-animation-cards.mjs',
    '**已被挂载为子步骤**：门禁 ㉒ 的『W17』直接 `import` 它的 `WORKED` / `verifyWorked()` / `renderProgram()`，' +
      '并断言"三份范文实跑 C1–C9 全绿""卡片正文里嵌的就是那份跑过的程序（逐字）""常驻卡总字数 ≤ 15000"。' +
      '它是 5 张动画常驻卡与 28 条动画槽卡片「最小画法」节的**唯一作者入口**（与 ' +
      '`tools/rewrite-knowledgecard-entries.mjs` 同一类处置），`--check` 会把每条画法重新 lint + 实跑一遍。',
  ],
  [
    'tools/electron-pack.mjs',
    '**组装脚本**（把 Electron 运行时 + 应用代码拼成绿色版），不是检查脚本：' +
      '它产出 `release/`，产物形态由门禁 ㊷（桌面壳取证）与 ㊳（发布构建开关）分别钉住。' +
      '与 `tools/electron-build.mjs` 同一类处置。',
  ],
  [
    'tools/asar-archive.mjs',
    '**ASAR 读写工具库**（pack / list / extract），被 `pack-payload.mjs` 与两个打包脚本 import；' +
      '它的 `list` / `extract` 是排障入口，不是判定。asar 格式本身已用 Electron 自带的 ' +
      '`default_app.asar` 反读 + SHA-256 核对过，产物形态由 `pack-payload.mjs` 的校验与门禁 ㊷/㊳ 覆盖。',
  ],
  [
    'tools/pack-payload.mjs',
    '**载荷构建 / 封装库**（唯一载荷清单），被 `electron-pack.mjs` / `electron-repack.mjs` 调用；' +
      '它的 `verify` 子命令是**打包后的产物自检**（由 repack 的冒烟步骤调用），不是独立门禁步骤。' +
      '发布产物形态由门禁 ㊷（桌面壳）与 ㊳（发布构建开关）钉住。',
  ],
  [
    'tools/electron-build.mjs',
    '**构建/打包脚本**，不是检查脚本：它跑"发布构建 → 模板重建 → electron-builder"，' +
      '产物正确性由门禁 ㊷（`tests/electron-shell-selftest.mjs`）与 ㊳（发布构建开关）分别钉住。' +
      '与 `tools/build-knowledgecard-web.mjs`、`tools/build-builtin-bundle.mjs` 同一类处置。',
  ],
  [
    'tools/build-builtin-bundle.mjs',
    '**已被挂载为子步骤**：门禁 ㊴（`tests/builtin-seal-selftest.mjs`）直接 `import` 它的 ' +
      '`buildBundleSource()`，并断言"盘上的 `builtin-bundle.generated.mjs` == 从 `data/` 重新生成的结果"' +
      '（逐字节）。它是**生成器**而不是独立门禁步骤 —— 与 `tools/build-knowledgecard-web.mjs` 同一类处置。',
  ],
  [
    'tools/rules-service.mjs',
    '**本机服务，不是检查脚本**：它为第 6 期第 5 项的设置页提供 HTTP 通道（同一端口发静态页与 `/api/*`）。' +
      '它不产生判定，所以不该出现在 STEPS 里；它的行为由 `tests/rules-service-selftest.mjs`（门禁 ㉘）' +
      '用**真实 HTTP** 覆盖（能改 / 改坏被拒 / Key 不出门 / 跨源被拦 / 路径穿越被拦）。',
  ],
]);

/** 文件名级豁免（理由见文件头） */
const EXEMPT_BASENAMES = new Set([
  'verify-all.mjs',
  'verify-coverage.mjs',
  'node-bin.mjs',
  'paths.mjs',
  'doctor.mjs',
  'probe-question.mjs',
]);

/**
 * 扫描出"应当被门禁挂载"的脚本清单（相对仓库根的 POSIX 路径）。
 * @param {string} projectRoot
 * @returns {string[]}
 */
export function listCheckScripts(projectRoot) {
  /** @type {string[]} */
  const out = [];

  const walk = (absDir, relDir, recurse) => {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(absDir, e.name);
      const rel = `${relDir}/${e.name}`;
      if (e.isDirectory()) {
        if (!recurse) continue;
        if (EXEMPT_DIRS.has(rel)) continue;
        walk(abs, rel, false); // 只下钻一层
        continue;
      }
      if (!e.name.endsWith('.mjs')) continue;
      if (e.name.startsWith('_')) continue; // 一次性取证工具
      if (EXEMPT_BASENAMES.has(e.name)) continue;
      if (EXEMPT_FILES.has(rel)) continue;
      out.push(rel);
    }
  };

  walk(join(projectRoot, 'tests'), 'tests', true);
  walk(join(projectRoot, 'tools'), 'tools', false);
  return out.sort();
}

/**
 * 从 `verify-all.mjs` 源文件里读 STEPS（避免清单重复维护）。
 *
 * ⚠ **第 5 期修掉的一处缺陷**：原来的正则要求第二个字符串后面**紧跟 `]`**，
 *   而第 4 期起 `㉑` 那条是**多行 + 尾随逗号**写法的：
 *
 *     [\n    '㉑ …',\n    'tests/repair-selftest.mjs',\n  ],
 *
 *   于是 CLI 模式下 `㉑` 从来没被解析出来 ⇒ `node tools/verify-coverage.mjs`
 *   一直把 `tests/repair-selftest.mjs` 报成"没被挂载"（假阳性）。
 *   而 `verify-all.mjs` 走的是**内存里的 STEPS**（不解析源文本），所以门禁本身是全绿的
 *   —— 又是一次"两条路径、只有一条被测过"。现在两处都钉住：正则允许尾随逗号，
 *   并且 ㉒ 里加了一条断言让 CLI 解析结果与内存 STEPS **逐项一致**。
 */
export function readStepsFromVerifyAll(projectRoot) {
  const text = readFileSync(join(projectRoot, 'tools', 'verify-all.mjs'), 'utf8');
  return [...text.matchAll(/\[\s*'([^']*)',\s*'([^']+)'\s*,?\s*\]/g)]
    .map((m) => [m[1], m[2]])
    // ⚠ 还要滤掉"恰好也是两个字符串的数组"——例如探针那行 `spawnSync(RUNTIME, ['-e', 'process.exit(0)'])`。
    //   它是**代码**，不是步骤；不过滤就会让"两种读法一致"这条断言报一个查不出原因的假阳性。
    .filter(([, script]) => /\.mjs(\s|$)/.test(script));
}

/**
 * 自检：候选脚本是否都出现在 STEPS 的脚本字段里。
 * @param {{ projectRoot: string, steps: Array<[string, string]> }} input
 */
export function checkCoverage({ projectRoot, steps }) {
  const mounted = new Set(
    steps
      .map(([, script]) => String(script))
      .map((s) => s.trim().split(/\s+/)[0])
      .filter((s) => s && s.endsWith('.mjs')),
  );

  const candidates = listCheckScripts(projectRoot);
  const missing = candidates.filter((rel) => !mounted.has(rel));
  return { ok: missing.length === 0, missing, candidates };
}

/** 打印结论并返回是否通过（`verify-all` 的同进程模式与 CLI 共用） */
export function reportCoverage({ projectRoot, steps }) {
  const { ok, missing, candidates } = checkCoverage({ projectRoot, steps });
  console.log('verify-all · 覆盖自检（门禁自己有没有漏挂检查脚本）');
  console.log(
    `  候选脚本 ${candidates.length} 个（tests/*.mjs + tests/<子目录>/*.mjs + tools/*.mjs；已排除一次性工具与工具库）`,
  );
  if (ok) {
    console.log('  ✓ 全部已被本门禁挂载');
  } else {
    console.log(`  ✗ 有 ${missing.length} 个检查脚本**没被挂载**（它们永远不会在门禁里跑）：`);
    for (const m of missing) console.log(`      · ${m}`);
    console.log('  → 请把它们加进 tools/verify-all.mjs 的 STEPS，或在 verify-coverage.mjs 里给出豁免理由');
  }
  return { ok, missing };
}

/* ── CLI ── */
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const steps = readStepsFromVerifyAll(PROJECT_ROOT);
  const { ok } = reportCoverage({ projectRoot: PROJECT_ROOT, steps });
  if (!ok) process.exitCode = 1;
}
