/**
 * 清洗规则编辑器（第 6 期第 3 项 · §12 / §16）。
 *
 * 它只做"读表 / 改表 / 存表"三件事，判据在别处：
 *   · 字段合法性（§12 条目、stage 枚举、flags 子集、正则能编译）→ `contracts/validate.mjs`
 *   · **允不允许存在**（撞锁定 id / 动标记 / 灾难性回溯）      → `core/cleaner/policy.mjs`
 *   · 写盘安全（原子写、哈希、冲突、整批失败、回滚）             → `core/rules/workspace.mjs`
 *
 * ── 两张表，别混
 *
 *   · **内置锁定集**（3 条，代码里，`policy.mjs`）—— 永远先跑、不可禁用、不出现在用户文件里；
 *   · **用户表**（`ai-rules/cleaning.json`）—— 只有用户自己加的规则，按数组顺序在内置之后跑。
 *
 * 因此"编辑器里的第 1 条"永远是内置的 `strip-code-fence`，而用户第一条是"第 4 条"。
 * 这个顺序不能在界面上编辑：内置在前是**结构性**的（`applyRegexRules` 里两段循环），
 * 不是数据能改出来的。要让用户规则插到内置前面，得改 `applyRegexRules` 本身，那是开发者的决定。
 */

import { BUILTIN_RULES } from './regex-rules.mjs';
import {
  CLEANING_POLICY,
  CLEANING_POLICY_VERSION,
  effectiveCleaningTable,
  isLockedRuleId,
  lockOf,
  validateUserCleaningRules,
} from './policy.mjs';
import { commitRulesChange, loadRulesWorkspace, readRulesIndex, sha256Hex } from '../rules/index.mjs';
import { CLEANING_FILE } from '../rules/kinds.mjs';

/** §12 / §16 的清洗规则表格式（与契约同源） */
export const CLEANING_TABLE_FORMAT = 'od-cleaning-rules';
export const CLEANING_TABLE_VERSION = 1;

/** 规则超过这个数量就提醒（不是拦）：每多一条，每次清洗就多一遍全量 replace */
export const WARN_RULE_COUNT = 50;

const err = (code, path, message, hint) => ({ code, path, message, ...(hint ? { hint } : {}) });

/** 空表（`cleaning.json` 不存在时就等价于这个） */
export function emptyCleaningTable() {
  return { format: CLEANING_TABLE_FORMAT, version: CLEANING_TABLE_VERSION, rules: [] };
}

/** 序列化成文件内容（缩进 2、结尾换行 —— 与工作区其它文件一致） */
export function cleaningTableText(table) {
  return `${JSON.stringify(table, null, 2)}\n`;
}

/**
 * 读当前生效的表（含"合并后的执行顺序"）。
 *
 * @param {{ dir?: string }} [opts]
 * @returns {{
 *   ok: boolean, issues: object[],
 *   rules: object[], table: object,
 *   effective: object[], locked: object[],
 *   rel: string, exists: boolean, expectedHash: string|null,
 * }}
 */
export function loadCleaningTable({ dir } = {}) {
  const loaded = loadRulesWorkspace(dir ? { dir } : undefined);
  if (!loaded.ok) {
    return { ok: false, issues: loaded.problems, rules: [], table: emptyCleaningTable(), effective: [], locked: [], rel: CLEANING_FILE, exists: false, expectedHash: null };
  }

  const idx = readRulesIndex(dir ?? undefined);
  const entry = idx.ok ? idx.index.files[CLEANING_FILE] ?? null : null;
  const table = loaded.cleaning ?? emptyCleaningTable();
  const rules = Array.isArray(table.rules) ? table.rules : [];

  return {
    ok: true,
    issues: [],
    rules,
    table,
    effective: effectiveCleaningTable(rules, BUILTIN_RULES),
    locked: CLEANING_POLICY.locked.map((l) => ({ ...l, name: BUILTIN_RULES.find((r) => r.id === l.id)?.name ?? l.id })),
    rel: CLEANING_FILE,
    exists: Boolean(entry),
    expectedHash: entry?.sha256 ?? null,
  };
}

/**
 * 保存一张用户表（内部统一出口）。
 *
 * ⚠ 校验顺序是刻意的：先做**便宜且确定**的策略/契约校验（不写盘），
 *   再交给 `commitRulesChange`（它会再做一遍，因为那也是别人写文件的路径）。
 *   不在这一层"相信上游已经验过"——那正是"两条路径只有一条被测过"的来源。
 */
function commitTable({ dir, rules, expectedHash, force = false, extraIssues = [] }) {
  const issues = [...extraIssues];
  const warnings = [];

  const table = { format: CLEANING_TABLE_FORMAT, version: CLEANING_TABLE_VERSION, rules };
  const text = cleaningTableText(table);

  const policyIssues = validateUserCleaningRules(rules, { builtinRules: BUILTIN_RULES });
  if (policyIssues.length) issues.push(...policyIssues);

  if (rules.length > WARN_RULE_COUNT) {
    warnings.push({
      code: 'cleaning.many-rules',
      path: CLEANING_FILE,
      message: `你的清洗规则已有 ${rules.length} 条（上限 300）`,
      hint: '规则越多越难查，而且每次清洗都要全量跑一遍；把不再需要的删掉',
    });
  }

  if (issues.length) return { ok: false, revision: null, warnings, issues };

  const r = commitRulesChange({
    dir,
    changes: [{ rel: CLEANING_FILE, text }],
    ...(expectedHash !== undefined ? { expectedHashes: { [CLEANING_FILE]: expectedHash ?? null } } : {}),
    force,
  });

  return { ok: r.ok, revision: r.revision, warnings, issues: r.issues };
}

/** 锁定规则不能被改：统一的报错（四条编辑入口共用） */
function lockedGuard(id) {
  if (!isLockedRuleId(id)) return null;
  const lock = lockOf(id);
  return err(
    'cleaning.rule-locked',
    CLEANING_FILE,
    `"${id}" 是**锁定**的内置规则，不能改、不能关、不能删`,
    `它保证的是：${lock?.guarantee ?? ''}。要改这条行为请改代码里的 policy 表（开发者动作，需过门禁）`,
  );
}

/**
 * 加一条用户规则（追加到表尾 = 最后执行）。
 *
 * @param {{ dir?: string, rule: object, expectedHash?: string|null, force?: boolean }} opts
 */
export function addCleaningRule({ dir, rule, expectedHash, force = false }) {
  const g = lockedGuard(rule?.id);
  if (g) return { ok: false, revision: null, warnings: [], issues: [g] };

  const cur = loadCleaningTable({ dir });
  if (!cur.ok) return { ok: false, revision: null, warnings: [], issues: cur.issues };

  if (cur.rules.some((r) => r?.id === rule?.id)) {
    return {
      ok: false,
      revision: null,
      warnings: [],
      issues: [err('cleaning.rule-id-exists', `${CLEANING_FILE}:${rule?.id}`, `规则 id "${rule?.id}" 已经存在`, '要改它请用"修改"，不要重复添加')],
    };
  }

  const hash = expectedHash !== undefined ? expectedHash : cur.expectedHash;
  return commitTable({ dir, rules: [...cur.rules, rule], expectedHash: hash, force });
}

/**
 * 修改一条用户规则（浅合并 patch）。
 */
export function updateCleaningRule({ dir, id, patch = {}, expectedHash, force = false }) {
  const g = lockedGuard(id);
  if (g) return { ok: false, revision: null, warnings: [], issues: [g] };

  const cur = loadCleaningTable({ dir });
  if (!cur.ok) return { ok: false, revision: null, warnings: [], issues: cur.issues };

  const i = cur.rules.findIndex((r) => r?.id === id);
  if (i < 0) {
    return { ok: false, revision: null, warnings: [], issues: [err('cleaning.rule-not-found', `${CLEANING_FILE}:${id}`, `找不到规则 "${id}"`)] };
  }
  if (patch?.id !== undefined && patch.id !== id) {
    return { ok: false, revision: null, warnings: [], issues: [err('cleaning.rule-id-immutable', `${CLEANING_FILE}:${id}.id`, '规则 id 不可改（它是引用键）', '要换 id 请删掉重建')] };
  }

  const next = cur.rules.map((r, k) => (k === i ? { ...r, ...patch, id } : r));
  const hash = expectedHash !== undefined ? expectedHash : cur.expectedHash;
  return commitTable({ dir, rules: next, expectedHash: hash, force });
}

/** 删除一条用户规则（也用于"恢复默认"里的逐条删除） */
export function removeCleaningRule({ dir, id, expectedHash, force = false }) {
  const g = lockedGuard(id);
  if (g) return { ok: false, revision: null, warnings: [], issues: [g] };

  const cur = loadCleaningTable({ dir });
  if (!cur.ok) return { ok: false, revision: null, warnings: [], issues: cur.issues };

  const next = cur.rules.filter((r) => r?.id !== id);
  if (next.length === cur.rules.length) {
    return { ok: false, revision: null, warnings: [], issues: [err('cleaning.rule-not-found', `${CLEANING_FILE}:${id}`, `找不到规则 "${id}"`)] };
  }
  const hash = expectedHash !== undefined ? expectedHash : cur.expectedHash;
  return commitTable({ dir, rules: next, expectedHash: hash, force });
}

/** 启停一条用户规则（锁定规则不在此列） */
export function setCleaningRuleEnabled({ dir, id, enabled, expectedHash, force = false }) {
  if (typeof enabled !== 'boolean') {
    return { ok: false, revision: null, warnings: [], issues: [err('cleaning.enabled.not-boolean', `${CLEANING_FILE}:${id}.enabled`, 'enabled 必须是 true 或 false')] };
  }
  return updateCleaningRule({ dir, id, patch: { enabled }, expectedHash, force });
}

/**
 * 调整执行顺序（仅限**用户规则之间**；不能越过锁定内置集）。
 *
 * @param {{ dir?: string, id: string, toIndex: number }} opts 0 = 用户规则里的第一条（整体第 4 条）
 */
export function moveCleaningRule({ dir, id, toIndex, expectedHash, force = false }) {
  const g = lockedGuard(id);
  if (g) return { ok: false, revision: null, warnings: [], issues: [g] };

  const cur = loadCleaningTable({ dir });
  if (!cur.ok) return { ok: false, revision: null, warnings: [], issues: cur.issues };

  const from = cur.rules.findIndex((r) => r?.id === id);
  if (from < 0) {
    return { ok: false, revision: null, warnings: [], issues: [err('cleaning.rule-not-found', `${CLEANING_FILE}:${id}`, `找不到规则 "${id}"`)] };
  }
  const to = Number(toIndex);
  if (!Number.isInteger(to) || to < 0 || to >= cur.rules.length) {
    return {
      ok: false,
      revision: null,
      warnings: [],
      issues: [
        err(
          'cleaning.move.out-of-range',
          `${CLEANING_FILE}:${id}`,
          `目标位置 ${JSON.stringify(toIndex)} 不合法（可选 0…${cur.rules.length - 1}）`,
          '用户规则只能在自己的范围里排：内置锁定规则永远在前',
        ),
      ],
    };
  }

  const next = [...cur.rules];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  const hash = expectedHash !== undefined ? expectedHash : cur.expectedHash;
  return commitTable({ dir, rules: next, expectedHash: hash, force });
}

/**
 * 恢复默认：删掉 `ai-rules/cleaning.json`（不是写一张空表）。
 *
 * 语义与 Prompt 一致：缺文件 = 只有内置锁定集。
 */
export function resetCleaningTable({ dir, expectedHash, force = false }) {
  const cur = loadCleaningTable({ dir });
  if (!cur.ok) return { ok: false, revision: null, warnings: [], issues: cur.issues };

  const r = commitRulesChange({
    dir,
    changes: [{ rel: CLEANING_FILE, text: null }],
    ...(expectedHash !== undefined ? { expectedHashes: { [CLEANING_FILE]: expectedHash ?? null } } : {}),
    force,
  });
  return { ok: r.ok, revision: r.revision, warnings: [], issues: r.issues };
}

/** 供 UI/CLI 的"表头信息"（版本、锁定集版本、规则数） */
export function cleaningTableMeta({ dir } = {}) {
  const cur = loadCleaningTable({ dir });
  const idx = readRulesIndex(dir ?? undefined);
  return {
    ok: cur.ok,
    policyVersion: CLEANING_POLICY_VERSION,
    lockedCount: CLEANING_POLICY.locked.length,
    userCount: cur.rules.length,
    revision: idx.ok ? idx.index.baseRevision : null,
    tableHash: cur.expectedHash,
    /** 当前表内容的指纹（给"导入导出前确认是同一份"用） */
    hashOf: (text) => sha256Hex(text),
  };
}
