/**
 * 内置词条的**覆盖率校验器**（§9.4 / §19.3，W14）。
 *
 * ── 本期（第 5 期）只交付"机制"，不交付"内容"
 *
 * 用户 2026-10 裁决：**44 条（乃至按 111 个题型重写的整库）内容放到第 5.5 期生产**，
 * 本期只搭仓库与校验器。因此本模块必须能把"内容还没写"这件事**如实报出来**，
 * 而不是因为"库里只有 5 条，5 条都合规"就报 100% 完成 —— 那正是本项目最忌讳的假绿。
 *
 * 于是报告分成两个互不混淆的数字：
 *   · `structuralRate`：**已存在的**内置词条里，符合"含「生成后自检」小节 + ≥1 段 code_examples"的比例
 *     —— 这是**质量**，本期必须 100%（W14 的可机检部分）。
 *   · `contentProgress`：已覆盖的题型数 / 目标题型数 —— 这是**进度**，
 *     目标口径（覆盖范围与收敛条数）要等第 5.5 期开工前由用户给定，
 *     未给定（`declared: null`）时如实标成"未定"，**绝不折算成 100%**。
 */

import { SELF_CHECK_HEADING } from './engine.mjs';

/** 「生成后自检」必须是一个**小节标题**（逐条 grep 标题 ⇒ 可机检，§19.3） */
const SELF_CHECK_HEADING_RE = new RegExp(`^#{2,6}[ \\t]*${SELF_CHECK_HEADING}`, 'm');

/** 一条词条的结构合规性（§9.4 的两条硬性要求） */
export function checkEntryStructure(entry) {
  const problems = [];
  const content = typeof entry?.content === 'string' ? entry.content : '';
  const hasSelfCheck = SELF_CHECK_HEADING_RE.test(content);
  if (!hasSelfCheck) {
    problems.push(`缺少「${SELF_CHECK_HEADING}」小节标题（§9.4：每条内置词条必须含"生成后自检（必须逐条在代码中体现）"）`);
  }
  const examples = Array.isArray(entry?.code_examples) ? entry.code_examples.filter((c) => typeof c === 'string' && c.trim()) : [];
  if (examples.length === 0) {
    problems.push('缺少 code_examples（§9.4：至少 1 段用法示例；§4.5 说明它比在 Prompt 里堆签名有效得多）');
  }
  return { hasSelfCheck, exampleCount: examples.length, problems };
}

/**
 * 把 `core/knowledgecard/coverage-target.json`（由 `tools/build-knowledgecard-targets.mjs` 从书上抽取）
 * 转成 `checkCoverage()` 用的 `target` 形状。
 *
 * **一个文件同时承担"目标"与"进度"**：`targets[].entryId` 填了就算覆盖。
 * 这样第 5.5 期不必再单独维护一个断点文件 —— 少一个会漂移的地方。
 *
 * @param {object|null} json `readCoverageTarget()` 的返回值
 */
export function targetFromFile(json) {
  if (!json || !Array.isArray(json.targets)) return null;
  const targets = json.targets.filter((t) => t && typeof t.type === 'string');
  const coveredTargets = targets.filter((t) => typeof t.entryId === 'string' && t.entryId.length > 0);
  const byChapter = {};
  for (const t of targets) {
    const ch = Number.isFinite(t.chapter) ? t.chapter : 0;
    byChapter[ch] = (byChapter[ch] ?? 0) + 1;
  }
  return {
    declared: targets.length,
    /** 已覆盖的**条数**（= `coveredIds.length`）。单独给出来，好让调用方不必自己数一遍。 */
    covered: coveredTargets.length,
    coveredIds: coveredTargets.map((t) => t.entryId),
    uncoveredTypes: targets.filter((t) => !t.entryId).map((t) => t.type),
    coveredTypes: coveredTargets.map((t) => t.type),
    goalEntries: Number.isFinite(json.goalEntries) ? json.goalEntries : null,
    note: json.note ?? null,
    byChapter,
  };
}

/**
 * 全库覆盖率报告。
 *
 * @param {object} input
 * @param {object[]} input.entries 内置词条（只校验 `origin: builtin`）
 * @param {{ declared: number|null, coveredIds?: string[], goalEntries?: number|null, note?: string, byChapter?: Record<string, number>, uncoveredTypes?: string[] }} [input.target]
 * @returns {object} 报告（可 JSON 序列化，供门禁打印与 UI 展示）
 */
export function checkCoverage({ entries = [], target = null } = {}) {
  const builtin = entries.filter((e) => e?.origin === 'builtin');
  const rows = builtin.map((e) => ({ id: e.id, title: e.title, category: e.category, ...checkEntryStructure(e) }));

  const missingSelfCheck = rows.filter((r) => !r.hasSelfCheck).map((r) => r.id);
  const missingExamples = rows.filter((r) => r.exampleCount === 0).map((r) => r.id);
  const nonCompliant = rows.filter((r) => r.problems.length > 0);
  const structuralRate = rows.length === 0 ? 0 : (rows.length - nonCompliant.length) / rows.length;

  const declared = Number.isFinite(target?.declared) ? target.declared : null;
  const coveredIds = Array.isArray(target?.coveredIds) ? target.coveredIds : null;
  const covered = coveredIds ? coveredIds.length : null;
  const contentProgress = declared && covered !== null ? Math.min(1, covered / declared) : null;
  const contentComplete = Boolean(declared && covered !== null && covered >= declared);

  /**
   * ⚠ **"没做完"这件事永远不许是静默的**（第 5.5 期改）。
   *   原来只在 `declared === null`（口径未定）时给 reason；有了真口径之后，
   *   "0/111" 必须自己说出来 —— 否则报告里只有一串数字，"做完了吗"又要靠人读。
   */
  const reason = contentComplete
    ? null
    : declared === null
      ? '题型覆盖台账已退役（第 9 期开源版：不再按第三方教辅的题型记账）——只剩结构合规率这一个口径'
      : covered === null
        ? '缺少已覆盖题型清单（coveredIds）'
        : `内容覆盖 ${covered}/${declared}，还差 ${declared - covered} 个题型（逐题型映射见 core/knowledgecard/coverage-target.json）`;

  return {
    /** 报告自身也要能解释"这是哪一期的状态" */
    phase: 'phase5',
    contentPhase: 'phase5.5',
    total: rows.length,
    structuralOk: nonCompliant.length === 0 && rows.length > 0,
    structuralRate,
    /** §19.3 的验收口径：覆盖率必须 100%（对**已存在**的内置词条而言） */
    selfCheckCoverage: rows.length === 0 ? 0 : (rows.length - missingSelfCheck.length) / rows.length,
    exampleCoverage: rows.length === 0 ? 0 : (rows.length - missingExamples.length) / rows.length,
    missingSelfCheck,
    missingExamples,
    nonCompliant,
    rows,
    target: {
      declared,
      covered,
      uncovered: declared !== null && covered !== null ? declared - covered : null,
      goalEntries: Number.isFinite(target?.goalEntries) ? target.goalEntries : null,
      note: target?.note ?? null,
      byChapter: target?.byChapter ?? null,
      uncoveredTypes: target?.uncoveredTypes ?? null,
    },
    contentProgress,
    /** 只有当**内容口径已给定且已覆盖完**时才是 true */
    contentComplete,
    reason,
  };
}

/** 给门禁与 UI 用的一行结论 */
export function formatCoverageLine(report) {
  const pct = (n) => `${(n * 100).toFixed(0)}%`;
  const declared = report?.target?.declared ?? null;
  const covered = report?.target?.covered ?? null;
  const progress = declared === null ? '口径未定' : `${covered}/${declared}`;
  return (
    `内置词条 ${report.total} 条 · 结构合规 ${pct(report.structuralRate)}` +
    `（自检条款 ${pct(report.selfCheckCoverage)} · code_examples ${pct(report.exampleCoverage)}）· ` +
    `覆盖进度 ${progress}${report.contentComplete ? '（已完成）' : '（第 5.5 期）'}`
  );
}
