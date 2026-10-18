/**
 * §12 正则兜底清洗。
 *
 * §12 的分工必须守住：
 *   · **标记切分（主）** —— 零猜测，在 `marker-split.mjs`；
 *   · **正则规则（兜底）** —— 只做**点状修补**（剥代码围栏、去 `console.log`、
 *     `Math.pow(x,2)` 改写、删模型自加的解释性代码）；
 *   · **静态预检（C1）** —— 结构正确性的最终裁决。
 *
 * ⚠ 两条不许越界的事：
 *   ① **绝不用正则去"补"缺失的标记**。那等于把"零猜测"退化成"按顺序猜槽位"。
 *      本模块提供 `assertNoMarkerPatches()`，在应用规则前先拦一道。
 *   ② **绝不静默通过**：规则编译失败、命中禁用形态，都要明确报错（§12"非法正则即时报错且不落盘"）。
 *
 * ── 关于"隔离执行 + 超时"的实现取舍（诚实记录）
 *
 * §12 原文要求"正则在**隔离环境运行 + 超时**"。本沙箱的约束是：
 * **禁止管道捕获子进程输出**（任何 exe 都 EPERM），因此"把正则丢给子进程跑、超时 kill"
 * 这条常规路走不通（第 2 期已实测）。
 *
 * 本模块因此采用**主力防御 + 明确记录缺口**的做法：
 *   · 配置层：`contracts/validate.mjs` 试编译非法正则；
 *   · 形态层：`detectCatastrophicPattern()` 拒绝"嵌套量词"这类已知的灾难性回溯形态
 *     （`(a+)+`、`(a*)*`、`(a|a)*` 等）；**这是可机检的**，比"假装有超时"诚实；
 *   · 规模层：单次清洗的输入有硬上限（`MAX_CLEAN_INPUT_CHARS`），超限拒绝并说明；
 *   · 明确缺口：**真正的墙钟超时仍没有**，已记入 README（第 3 期第 3 步）。
 *
 * 结论：**内置规则（纯字面量、无回溯）是安全的**；用户自定义正则的风险被"形态拒绝 + 规模上限"
 * 压到很低，但不是零。等沙箱允许子进程管道时，这里换成 worker + 超时即可（接口不变）。
 */

import { SLOT_KEY_NAMES } from '../../contracts/spec/frozen-keys.mjs';
import { detectCatastrophicPattern } from './pattern-guard.mjs';
import { assertPolicyIntegrity, isLockedRuleId, lockedBuiltinRules } from './policy.mjs';

/** 单次清洗的输入规模上限（超过就拒绝：正则风险随输入长度放大） */
export const MAX_CLEAN_INPUT_CHARS = 400_000;

/**
 * 内置规则最小集（§12："内置规则保留必需的最小集（剥代码围栏 + 去首尾空白）"）。
 *
 * ⚠ 内置规则**全部是字面量操作，不用正则**——既快又不可能有回溯风险。
 */
export const BUILTIN_RULES = Object.freeze([
  {
    id: 'strip-code-fence',
    name: '剥代码围栏',
    stage: 'scene_code',
    enabled: true,
    kind: 'builtin',
    description: '删掉模型偶尔多写的 ``` 围栏行（以及 ```js 这类带语言的围栏）',
  },
  {
    id: 'strip-function-wrapper',
    name: '剥掉多写的函数外壳',
    stage: 'scene_code',
    enabled: true,
    kind: 'builtin',
    description:
      '模型常把整个函数声明塞进槽位（function readouts(t, state) { … }）。装配器会再包一层 ⇒ 外层返回 undefined。这里只保留函数体',
  },
  {
    id: 'drop-console-log',
    name: '删除 console.log 整行',
    stage: 'scene_code',
    enabled: true,
    kind: 'builtin',
    description: '模型常为了"自证"加 console.log；槽位代码里没有任何控制台可用',
  },
  {
    id: 'trim-edges',
    name: '去首尾空白',
    stage: '*',
    enabled: true,
    kind: 'builtin',
    description: '每个槽位的首尾空行与行尾空白',
  },
]);

/* ────────────────────────────── 灾难性回溯形态检测 ────────────────────────────── */

/**
 * 检测已知的**灾难性回溯**形态。
 *
 * 实现搬到了 `pattern-guard.mjs`（零依赖），因为保存时的策略校验（`policy.mjs`）也要用它；
 * 留在这里会形成 `policy ⇄ regex-rules` 的循环 import。**接口不变**：老的 import 路径照旧可用。
 */
export { detectCatastrophicPattern } from './pattern-guard.mjs';

/* ────────────────────────────── 标记保护 ────────────────────────────── */

/**
 * 规则是否会去动标记 → 直接拒绝。
 *
 * §3.5 的零猜测是**不可绕过**的：任何试图"添加/修补 @slot 标记"的规则都不允许，
 * 无论它写得多巧妙。这里做**保守检查**（宁可误拒），因为误拒的代价只是"用户换个写法"，
 * 而漏放的代价是"零猜测被悄悄破坏"。
 */
export function assertNoMarkerPatches(rules) {
  const offenders = [];
  for (const rule of rules ?? []) {
    const blob = `${rule?.pattern ?? ''} ${rule?.replacement ?? ''}`;
    if (/@slot|@end/.test(blob)) offenders.push(rule?.id ?? '(未命名规则)');
  }
  if (offenders.length) {
    const err = new Error(
      `清洗规则不得改动 @slot / @end 标记（§3.5 零猜测）：${offenders.join(', ')}\n` +
        '  → 标记切分是主路径，缺标记必须报错，不能用正则去"补"',
    );
    err.code = 'rule.touches-marker';
    throw err;
  }
}

/* ────────────────────────────── 内置规则实现 ────────────────────────────── */

function stripCodeFence(code) {
  return code
    .split('\n')
    .filter((line) => !/^\s*```\s*[A-Za-z]*\s*$/.test(line))
    .join('\n');
}

function dropConsoleLog(code) {
  return code
    .split('\n')
    .filter((line) => !/^\s*console\.(log|warn|error|info|debug)\s*\(.*\)\s*;?\s*$/.test(line))
    .join('\n');
}

function trimEdges(code) {
  return code
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\s*\n/, '')
    .replace(/\n\s*$/, '');
}

/**
 * **剥掉多写的函数外壳**（第 8 期 · 用户真题）。
 *
 * 实测事故（export-20261018-115238-713）：四个代码槽位全都写成
 *   function readouts(t, state) { … }
 * 而装配器 `buildProgramSource` 会再包一层同名函数：
 *   function readouts(t, state) {  function readouts(t, state) { … }  }
 * ⇒ 外层 **返回 undefined** ⇒ 画面一条命令都没有、readouts 一条都不返回；
 * 更糟的是 C3/C6/C8 在"零条目"上会**空过**（它们只逐条判有限/稳定），于是只有 C7/C9 报警。
 *
 * 这里只做**归一化**：保留函数体、丢掉 `function X(...) {` 与最后一个 `}`。
 * 判据一个都没放宽 —— 剥完照样要过 C1–C9。
 *
 * 支持三种常见写法（都要能跑）：
 *   ① function readouts(t, state) { … }
 *   ② const readouts = function (t, state) { … }
 *   ③ const readouts = (t, state) => { … }
 * 只在整个槽位"就是一个函数"时动手（后面还有别的语句就不碰），并且要求标识符与槽位名一致。
 */
function stripFunctionWrapper(code, slotKey) {
  const CODE_SLOTS = ['setup', 'stateAt', 'drawFrame', 'readouts'];
  if (typeof code !== 'string' || !code.trim()) return code;
  if (!CODE_SLOTS.includes(slotKey)) return code;

  const text = code.trim();
  /* 允许前置注释（模型常写 // 说明），剥壳时把它们保留下来 */
  const leadRe = /^(?:\s|\/\/[^\n]*\n?|\/\*[\s\S]*?\*\/)*/;
  const lead = leadRe.exec(text)[0];
  const rest = text.slice(lead.length);
  const name = slotKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heads = [
    new RegExp('^(?:async\\s+)?function\\s+' + name + '\\s*\\('),
    new RegExp('^(?:const|let|var)\\s+' + name + '\\s*=\\s*(?:async\\s+)?(?:function\\s*)?\\('),
    new RegExp('^(?:const|let|var)\\s+' + name + '\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>'),
  ];
  if (!heads.some((re) => re.test(rest))) return code;

  /** 从 `from` 起找函数体的第一个 `{`（跳过字符串、注释、正则字面量粗略处理） */
  const scan = (src, from) => {
    let depth = 0;
    let i = from;
    let opened = -1;
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) return { open: -1, end: -1 }; continue; }
      if (c === '/' && n === '*') { const j = src.indexOf('*/', i + 2); if (j < 0) return { open: -1, end: -1 }; i = j + 2; continue; }
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1;
        while (j < src.length) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === c) break;
          j += 1;
        }
        if (j >= src.length) return { open: -1, end: -1 };
        i = j + 1;
        continue;
      }
      if (c === '{') {
        if (opened < 0) opened = i;
        depth += 1;
      } else if (c === '}') {
        depth -= 1;
        if (opened >= 0 && depth === 0) return { open: opened, end: i };
        if (depth < 0) return { open: -1, end: -1 };
      }
      i += 1;
    }
    return { open: -1, end: -1 };
  };

  const { open, end } = scan(rest, 0);
  if (open < 0 || end < 0) return code;
  /* 函数后面还有别的语句 ⇒ 不是"整个槽位就是一个函数"，不碰 */
  const after = rest.slice(end + 1).replace(/\s+/g, '');
  const afterIsComments = /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)*$/.test(after);
  if (after && !afterIsComments) return code;

  const body = rest.slice(open + 1, end);
  /* 只去掉一层缩进（多写的槽位通常整体缩进 2 格），保留相对缩进 */
  const lines = body.split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => (l.match(/^[ \t]*/) ?? [''])[0].length);
  const minIndent = indents.length ? Math.min(...indents) : 0;
  const dedented = lines.map((l) => l.slice(Math.min(minIndent, (l.match(/^[ \t]*/) ?? [''])[0].length))).join('\n');
  return (lead ? lead : '') + dedented.trim();
}

const BUILTIN_IMPL = Object.freeze({
  'strip-code-fence': stripCodeFence,
  'strip-function-wrapper': stripFunctionWrapper,
  'drop-console-log': dropConsoleLog,
  'trim-edges': trimEdges,
});

/* ────────────────────────────── 规则应用 ────────────────────────────── */

/**
 * 把 §12 兜底规则应用到切分后的槽位。
 *
 * 顺序（§12："按列表从上到下执行"，第 6 期第 3 项起由**策略表**决定）：
 *   ① 锁定内置集（`core/cleaner/policy.mjs` 的 `CLEANING_POLICY.locked`）——**永远先跑、不可关**；
 *   ② 用户规则（数组顺序）。
 *
 * ⚠ 为什么内置这一段改成"从策略表取"而不是"从 BUILTIN_RULES 里按 enabled 过滤"：
 *   用户裁决要求"不可禁用"，而 `enabled` 字段是**数据**，谁都能把它改成 false。
 *   现在锁定清单在代码里（用户目录写不到），并且这里**不看 enabled**；
 *   同时 `assertPolicyIntegrity()` 保证策略表与实现没有漂移（缺实现 / 多出未锁定的内置都会抛）。
 *
 * @param {Record<string,string>} slots
 * @param {object[]} [userRules] §12 条目：`{ id, name, stage, pattern, flags, replacement, enabled }`
 * @param {{ stage?: string, builtins?: object[] }} [opts] `builtins` 仅供测试替换实现；
 *       无论传什么，**锁定清单里的每一条都必须在**，否则 `assertPolicyIntegrity` 会抛
 * @returns {{ slots: Record<string,string>, applied: Array<{id:string, stage:string, replaced:number}> }}
 */
export function applyRegexRules(slots, userRules = [], opts = {}) {
  const stage = opts.stage ?? 'scene_code';
  // ① 锁定内置集：顺序由策略表决定，**不读 enabled**（锁定 = 永远启用）
  const effectiveBuiltins = opts.builtins ?? BUILTIN_RULES;
  assertPolicyIntegrity(effectiveBuiltins);
  const builtins = lockedBuiltinRules(effectiveBuiltins);

  assertNoMarkerPatches(userRules);

  /** @type {Array<{id:string, stage:string, replaced:number}>} */
  const applied = [];
  /** @type {Record<string,string>} */
  const out = {};

  for (const key of Object.keys(slots)) {
    let code = slots[key];
    if (typeof code !== 'string' || code.length === 0) {
      out[key] = code;
      continue;
    }
    if (code.length > MAX_CLEAN_INPUT_CHARS) {
      const err = new Error(
        `槽位 ${key} 的正文 ${code.length} 字符，超过清洗输入上限 ${MAX_CLEAN_INPUT_CHARS}\n` +
          '  → 拒绝清洗而不是硬跑（正则风险随输入长度放大）',
      );
      err.code = 'clean.input-too-large';
      throw err;
    }

    // ① 内置
    for (const rule of builtins) {
      if (rule.stage !== '*' && rule.stage !== stage) continue;
      const impl = BUILTIN_IMPL[rule.id];
      if (!impl) continue;
      const before = code;
      // 第 8 期：`strip-function-wrapper` 需要知道槽位名（只剥同名函数）
      code = impl(code, key);
      if (code !== before) applied.push({ id: rule.id, stage: key, replaced: 1 });
    }

    // ② 用户规则（按列表顺序）
    for (const rule of userRules) {
      if (rule?.enabled === false) continue;
      // 防御纵深：文件层已经拒绝"用内置 id 写用户规则"，这里再跳过一次。
      // 若哪天有不经过 `core/rules/` 的写入路径（脚本、老数据），也不会让一条冒名规则顶掉锁定规则。
      if (typeof rule?.id === 'string' && isLockedRuleId(rule.id)) continue;
      if (rule?.stage && rule.stage !== stage) continue;
      if (typeof rule?.pattern !== 'string' || rule.pattern.length === 0) continue;

      const danger = detectCatastrophicPattern(rule.pattern);
      if (!danger.safe) {
        const err = new Error(`清洗规则 "${rule.id}" 的正则形态不安全：${danger.reason}`);
        err.code = 'rule.catastrophic-pattern';
        throw err;
      }

      let re;
      try {
        re = new RegExp(rule.pattern, rule.flags ?? 'g');
      } catch (e) {
        const err = new Error(`清洗规则 "${rule.id}" 的正则无法编译：${e.message}`);
        err.code = 'rule.pattern.invalid';
        throw err;
      }

      const before = code;
      code = code.replace(re, rule.replacement ?? '');
      if (code !== before) applied.push({ id: rule.id, stage: key, replaced: 1 });
    }

    out[key] = code;
  }

  return { slots: out, applied };
}

/** 供 UI 展示：内置规则的清单（含说明与"是否锁定"） */
export function listBuiltinRules() {
  return BUILTIN_RULES.map((r) => ({
    id: r.id,
    name: r.name,
    stage: r.stage,
    description: r.description,
    /** 第 6 期第 3 项：锁定 = 不可禁用、永远先跑（清单在 `policy.mjs`） */
    locked: isLockedRuleId(r.id),
  }));
}

/** 供外部确认"槽位名没被规则改坏" */
export function assertSlotKeysIntact(slots) {
  const keys = Object.keys(slots ?? {});
  const problems = [];
  for (const k of SLOT_KEY_NAMES) if (!(k in (slots ?? {}))) problems.push(`缺少槽位 ${k}`);
  for (const k of keys) if (!SLOT_KEY_NAMES.includes(k)) problems.push(`多出槽位 ${k}`);
  return { ok: problems.length === 0, problems };
}
