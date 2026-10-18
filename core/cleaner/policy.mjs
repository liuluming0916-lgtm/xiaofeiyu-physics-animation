/**
 * §12 清洗规则的**锁定策略**（第 6 期第 3 项）。
 *
 * ── 用户裁决（2026-10）
 *
 * 「内置最小集不可被用户禁用，且永远先跑。但**这条口径是数据，不是散落在代码里的 if** ——
 *   日后版本更新时作为开发者可能要动它，前提是**用户无法绕过**。」
 *
 * 因此：
 *   · 锁定清单在**这个文件**里（一处、有版本号、每条都写明"为什么锁"）；
 *   · 它**不放在 `ai-rules/`**（那目录用户可写，放那儿等于让被锁的人自己拿钥匙）；
 *   · 「不可绕过」由**三道结构性判据**保证，而不是靠约定：
 *       ① 文件层：`ai-rules/cleaning.json` 的任何写入路径都会过 `validateRuleFileContent()`
 *          → `validateUserCleaningRules()`（撞内置 id / 动标记 / 灾难性正则，一律拒绝且不落盘）；
 *       ② 运行时：`applyRegexRules()` 每次运行都从本表取"锁定内置集"，
 *          并且**跳过**任何 id 与内置撞车的用户规则；
 *       ③ 门禁：自检里逐条断言"用户表里写不出这些"，且断言这张策略表与内置实现**没有漂移**。
 *
 * ── 为什么"锁"是必要的（不是洁癖）
 *
 * 这三条内置规则都是**字面量操作、无回溯**，且各自兜住一类会让整条链路静默出错的模型行为：
 *   剥围栏 —— 模型爱把代码包进 ```；不剥，8 个槽位标记会被当成普通文本，切分直接崩；
 *   去 console.log —— 槽位代码里没有控制台，留着会污染行号映射（诊断指错行）；
 *   去首尾空白 —— 首尾空行会让"空槽位"判定误判。
 * 用户把其中任何一条关掉，都不会立刻报错，而是**在某个题上突然坏掉**。
 *
 * ── 开发者日后要改这张表时
 *
 * 改 `locked` 数组 → 提 `CLEANING_POLICY_VERSION` → 跑 `node tools/verify-all.mjs`。
 * 自检会检查两件事：表里的 id 在内置实现里都存在（`assertPolicyIntegrity`），
 * 且用户表仍然绕不过去（负对照用例）。**新增内置规则时要同步加进这张表**，否则它不受保护。
 */

import { detectCatastrophicPattern } from './regex-rules.mjs';

/** 策略版本：改锁定清单时必须提，便于审计"这批数据是哪一版的规矩" */
export const CLEANING_POLICY_VERSION = 1;

/**
 * 锁定清单（**顺序即执行顺序**）。
 *
 * ⚠ 顺序不是随便排的：先剥围栏（否则围栏行会干扰后续的"整行"匹配），
 *   再去 console.log（整行删除，必须在缩进/空白处理之前看清原行），
 *   最后统一去首尾空白（它会把前面两步留下的空行收干净）。
 */
export const CLEANING_POLICY = Object.freeze({
  version: CLEANING_POLICY_VERSION,
  order: 'locked-first',
  locked: Object.freeze([
    {
      id: 'strip-code-fence',
      guarantee:
        '模型偶尔把输出包进 ``` 围栏。不剥掉，8 个槽位标记会被当成普通文本，切分直接崩（而且报错位置会指向围栏行，看不出真因）',
    },
    {
      id: 'strip-function-wrapper',
      guarantee:
        '模型常把整个函数声明塞进槽位（writeFrame/setup/stateAt/readouts 写成 function X(...) { ... }）。' +
        '装配器会再包一层同名函数 ⇒ 外层返回 undefined，画面空白、readouts 一条都没有；' +
        '而 C3/C6/C8 在"零条目"上会**空过**，只有 C7/C9 会报警。这里是归一化，不是放宽判据',
    },
    {
      id: 'drop-console-log',
      guarantee: '槽位代码里没有任何控制台；残留的 console.log 会占行，让行号级诊断指错行',
    },
    {
      id: 'trim-edges',
      guarantee: '首尾空行会让"空槽位"判定误判（看起来有内容、其实只有空白）',
    },
  ]),
});

/** 锁定规则 id 列表（按策略顺序） */
export function lockedRuleIds() {
  return CLEANING_POLICY.locked.map((l) => l.id);
}

/** 某条内置规则是否被锁定 */
export function isLockedRuleId(id) {
  return CLEANING_POLICY.locked.some((l) => l.id === id);
}

/** 取某条锁定规则的说明（未锁定时返回 null） */
export function lockOf(id) {
  return CLEANING_POLICY.locked.find((l) => l.id === id) ?? null;
}

const err = (code, path, message, hint) => ({ code, path, message, ...(hint ? { hint } : {}) });

/**
 * 策略表 ↔ 内置实现**不许漂移**。
 *
 * @param {object[]} builtinRules `BUILTIN_RULES`
 * @throws {Error} 缺实现 / 重复 / 策略引用了不存在的 id
 */
export function assertPolicyIntegrity(builtinRules) {
  const list = Array.isArray(builtinRules) ? builtinRules : [];
  const byId = new Map(list.map((r) => [r.id, r]));
  const problems = [];

  for (const lock of CLEANING_POLICY.locked) {
    const rule = byId.get(lock.id);
    if (!rule) {
      problems.push(`策略锁定了 "${lock.id}"，但内置实现里没有这条（改名了？删了？）`);
      continue;
    }
    if (rule.enabled === false) {
      problems.push(`"${lock.id}" 在实现里被标成 enabled:false —— 锁定规则不允许被关闭`);
    }
  }

  // 反向：内置里有、策略里没有 ⇒ 它不受保护（将来加规则时最容易漏的一步）
  const lockedSet = new Set(lockedRuleIds());
  for (const rule of list) {
    if (rule?.id && !lockedSet.has(rule.id)) {
      problems.push(`内置规则 "${rule.id}" 不在锁定清单里 —— 新增内置规则时必须同步加进 CLEANING_POLICY.locked`);
    }
  }

  if (problems.length) {
    const e = new Error(`§12 清洗策略与内置实现不一致：\n- ${problems.join('\n- ')}`);
    e.code = 'cleaning.policy-broken';
    e.problems = problems;
    throw e;
  }
  return true;
}

/**
 * 取"锁定内置集"（按策略顺序）。
 *
 * @param {object[]} builtinRules `BUILTIN_RULES`
 * @returns {object[]} 每条额外带 `locked: true` 与 `lockIndex`
 */
export function lockedBuiltinRules(builtinRules) {
  const byId = new Map((builtinRules ?? []).map((r) => [r.id, r]));
  return CLEANING_POLICY.locked
    .map((lock, i) => {
      const rule = byId.get(lock.id);
      return rule ? { ...rule, locked: true, lockIndex: i, guarantee: lock.guarantee } : null;
    })
    .filter(Boolean);
}

/**
 * 校验**用户**写的清洗规则表（`ai-rules/cleaning.json`）。
 *
 * 这是"用户绕不过去"的**文件层**入口：载入、保存、登记、初始化全都会经过它
 * （都走 `core/rules/kinds.mjs` 的 `validateRuleFileContent`）。
 *
 * @param {object[]} rules 用户规则数组
 * @param {{ builtinRules: object[] }} opts
 * @returns {object[]} issues（空 = 通过）
 */
export function validateUserCleaningRules(rules, { builtinRules }) {
  const issues = [];
  const list = Array.isArray(rules) ? rules : [];
  const builtinIds = new Set((builtinRules ?? []).map((r) => r.id).filter(Boolean));

  for (const [i, rule] of list.entries()) {
    const at = `rules[${i}]`;
    if (!rule || typeof rule !== 'object') continue;

    // ① 撞内置 id：用户不能用同名规则去"重定义"一条内置规则（等于是偷偷换掉它）
    if (typeof rule.id === 'string' && builtinIds.has(rule.id)) {
      const lock = lockOf(rule.id);
      issues.push(
        err(
          'cleaning.rule-id-collides-builtin',
          `${at}.id`,
          `规则 id "${rule.id}" 已被内置规则占用`,
          lock
            ? `这条内置规则是**锁定**的：${lock.guarantee}。它不可被禁用或重定义；请给你的规则换个 id`
            : '内置规则 id 是保留的；请换个 id',
        ),
      );
    }

    // ② 不许碰槽位标记（§3.5 零猜测不可绕过；在**保存时**就拒，而不是等跑题时抛）
    const blob = `${rule.pattern ?? ''} ${rule.replacement ?? ''}`;
    if (/@slot|@end/.test(blob)) {
      issues.push(
        err(
          'cleaning.rule-touches-marker',
          at,
          '规则试图改动 @slot / @end 标记',
          '标记切分是主路径：缺标记必须报错，不能用正则去"补"（§3.5 零猜测）',
        ),
      );
    }

    // ③ 灾难性回溯形态（运行时还会再判一次；这里提前到保存，避免"存得进、跑题才炸"）
    if (typeof rule.pattern === 'string' && rule.pattern.length) {
      const danger = detectCatastrophicPattern(rule.pattern);
      if (!danger.safe) {
        issues.push(
          err('cleaning.rule-catastrophic', `${at}.pattern`, `正则形态不安全：${danger.reason}`, '这条不会被保存；换个写法（避免量词套量词）'),
        );
      }
    }
  }

  return issues;
}

/**
 * 生效顺序表（给 UI / CLI / 审计看）：锁定的内置在前，用户规则在后。
 *
 * @param {object[]} userRules
 * @param {object[]} builtinRules
 */
export function effectiveCleaningTable(userRules, builtinRules) {
  const rows = [];
  for (const [i, rule] of lockedBuiltinRules(builtinRules).entries()) {
    rows.push({
      order: i + 1,
      source: 'locked',
      id: rule.id,
      name: rule.name,
      stage: rule.stage,
      enabled: true, // 锁定 = 永远启用，不看任何 enabled 字段
      pattern: null,
      note: rule.guarantee,
    });
  }
  (Array.isArray(userRules) ? userRules : []).forEach((rule, i) => {
    rows.push({
      order: rows.length + 1,
      source: 'user',
      id: rule?.id ?? `(第 ${i + 1} 条无 id)`,
      name: rule?.name ?? '',
      stage: rule?.stage ?? '',
      enabled: rule?.enabled !== false,
      pattern: rule?.pattern ?? '',
      note: '',
    });
  });
  return rows;
}
