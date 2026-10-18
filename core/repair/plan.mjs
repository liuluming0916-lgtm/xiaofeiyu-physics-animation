/**
 * 自愈循环的核心判据（第 4 期 · M30 / §8 / §14.5）。
 *
 * ── 这个模块只做"决定"，不做"执行"
 *
 * 与 `core/dryrun/diagnostics.mjs` 同一条分工原则：**只归因、不判据**。
 * 本模块回答三个问题，全部是纯函数，因此门禁可以在**不起模型、不起 Worker** 的情况下
 * 逐条取证（`tests/repair-selftest.mjs`）：
 *
 *   ① 哪些槽位要重发？（§8.1 的那张表）
 *   ② 这一轮能产出什么？（能不能交付、要不要挂横幅）
 *   ③ 给模型的回灌文本长什么样？（§8.2 的"最小复现 + 强度标记"，不含 stack trace）
 *
 * 真正的执行（调模型、清洗、再跑 Dry-Run）在编排层 `core/orchestrator/pipeline.mjs`。
 *
 * ── 与冻结项的关系
 *
 * **判据一行未动**：C1–C9 的成立与否完全由 `core/dryrun` 决定，本模块只读 `report`。
 * 修复**只改模型输出**，不改判据（§14.5 风险表第 5 条）。
 */

import { CODE_LENGTH_LIMITS, SLOT_KEY_NAMES } from '../../contracts/spec/frozen-keys.mjs';
import { labelOf, guidanceOf, comparePrecision } from '../../contracts/evidence.mjs';

/**
 * 修复轮数硬上限（§14.5 风险表第 2 条："无限循环 / 成本失控"）。
 *
 * 用户裁决：**3 轮**；3 轮不过仍交付（若 8 槽位齐全）+ 告警横幅（§21.2 第 8 条）。
 */
export const REPAIR_MAX_ROUNDS = 3;

/** 数据型槽位（不是 JS 代码）：`PROBLEM`/`STEPS`/`ANSWERS` 的修复不涉及 SDK/白名单 */
export const DATA_SLOTS = Object.freeze(['PROBLEM', 'STEPS', 'ANSWERS']);
/** 代码型槽位（走 C1 白名单与 SDK 签名摘要） */
export const CODE_SLOTS = Object.freeze(['VIEW', 'setup', 'stateAt', 'drawFrame', 'readouts']);

/**
 * §8.1 的那张表：**诊断类型 → 要重发的槽位**。
 *
 * 这是"槽位是天然的重生成单元"的落地口径。表中给出的是**默认值**；
 * 实际还要叠加 `diagnostics[].slot`（见 `slotsFromReport`），因为 C1 与 C3
 * 都可能同时命中多个槽位 —— 只按检查号重发会把写对的槽位也拖下水，
 * 而"修复把对的槽位改坏"正是 §14.5 风险表第 1 条。
 *
 * ⚠ 这张表依赖 §3.2 的 **8 键名冻结**：只有 `stateAt` 与 `drawFrame` 是两个独立键，
 *   "C6 失败只重发 stateAt"才成立（§8.1 明写了这一点）。
 */
export const CHECK_TO_SLOTS = Object.freeze({
  // C1 未知 API：只重发出错的那一个槽位；真实槽位名取自诊断，故默认值为空
  C1: Object.freeze([]),
  // C2 终止性：优先按"最后执行位置"的槽位定位；定位不到才退化为"全部代码槽位"
  C2: Object.freeze([]),
  // C3 / C4 / C6：状态量、几何、边界连续性都只由 stateAt 决定（§8.1 第一行）
  C3: Object.freeze(['stateAt']),
  C4: Object.freeze(['stateAt']),
  C6: Object.freeze(['stateAt']),
  // C5 时间锚点：是 STEPS 的字段（§8.1 第三行）
  C5: Object.freeze(['STEPS']),
  // C7 答案闭环：readouts 给出读数，数值由 stateAt 提供（§8.1 第二行）
  C7: Object.freeze(['readouts', 'stateAt']),
  // C8 / C9 是告警（不阻塞），不触发修复；列出来是为了让"表覆盖了所有检查号"可机检
  C8: Object.freeze([]),
  C9: Object.freeze([]),
});

/** §8.1 表的可读版本（供自检比对"实现与方案的表一致"） */
export const REPAIR_TABLE = Object.freeze([
  { checks: ['C3', 'C4', 'C6'], slots: ['stateAt'], why: '状态量 / 几何 / 边界连续性都只由 stateAt 决定' },
  { checks: ['C7'], slots: ['readouts', 'stateAt'], why: 'C7 失败 = 读数没复现结论；读数由 readouts 给出、数据由 stateAt 提供' },
  { checks: ['C5'], slots: ['STEPS'], why: '时间锚点是 STEPS 的字段' },
  { checks: ['C1'], slots: [], why: '未知 API：只重发出错的那一个槽位（槽位名取自诊断）' },
  { checks: ['C2'], slots: [], why: '终止性：优先按"最后执行位置"定位槽位' },
  { checks: ['visual'], slots: ['drawFrame'], why: '视觉 / 构图问题只重发 drawFrame' },
]);

/** 视觉类诊断（不属于 C1–C9，但按 §8.1 最后一行只重发 drawFrame） */
export const VISUAL_CHECK_IDS = Object.freeze(['visual', 'X1', 'X2', 'C10']);

/* ────────────────────────── ① 要重发哪些槽位 ────────────────────────── */

/**
 * 从报告里取出"哪些槽位该重发"。
 *
 * 归集顺序（后面的只会**加**，不会减）：
 *   1. 阻塞失败（`blocking && status === 'fail'`）的检查号 → `CHECK_TO_SLOTS` 的默认槽位；
 *   2. 这些检查的诊断里明确写出的 `slot`（C1 / C2 全靠这一步）；
 *   3. **C1 / C2 一个槽位都没定位到时**，退化为全部代码型槽位 ——
 *      C1 的失败可能是"某个槽位是空的"（那种诊断不带 slot），C2 的失败可能是"卡在某处但我们不知道在哪"。
 *      这两种都必须有槽位可改，否则自愈会**什么都不做**却报"修过了"。
 *
 * ⚠ 这里**刻意不把"当前是空的槽位"一律加进来**：那是"条件式"的重发，
 *   要由 `withEmptySlots()` 显式决定。把它们混进默认计划，会让"某个空槽位"
 *   把整个代码库都拖进重发（`PROBLEM`/`STEPS`/`ANSWERS` 全空时就是一次完整重生成），
 *   而"只重发出错槽位"正是 §8.1 的粒度所在。
 *
 * ⚠ `slots` 是**显式参数**，不塞进 report 当隐藏字段 ——
 *   报告是产出物，往里塞调用方的输入会让它这个形状变得不可信。
 *
 * @param {object} report `dryRun()` 的 `report`
 * @param {{ allowed?: string[] }} [opts] `allowed` 限定可重发的槽位（例如只允许代码型槽位）
 * @returns {{ slots: string[], byCheck: Record<string,string[]>, unlocated: string[] }}
 */
export function slotsFromReport(report, opts = {}) {
  const allowed = new Set(opts.allowed ?? SLOT_KEY_NAMES);
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const failing = checks.filter((c) => c.blocking && c.status === 'fail');
  const byCheck = {};
  const picked = new Set();
  const unlocated = [];

  for (const c of failing) {
    const fromTable = (CHECK_TO_SLOTS[c.id] ?? []).filter((s) => allowed.has(s));
    for (const s of fromTable) picked.add(s);

    const fromDiag = [];
    for (const d of c.diagnostics ?? []) {
      if (d?.slot && allowed.has(d.slot)) fromDiag.push(d.slot);
    }
    for (const s of fromDiag) picked.add(s);

    byCheck[c.id] = [...new Set([...fromTable, ...fromDiag])];

    // C1 / C2 靠诊断定位；一个都没定位到就是"没能归因"，如实记下来
    if (!byCheck[c.id].length) unlocated.push(c.id);
  }

  // C1 / C2 定位失败 ⇒ 退化为全部代码型槽位（否则既改不了、又跑不完）
  for (const id of ['C1', 'C2']) {
    if (!unlocated.includes(id)) continue;
    for (const s of CODE_SLOTS) if (allowed.has(s)) picked.add(s);
    byCheck[id] = [...new Set(CODE_SLOTS.filter((s) => allowed.has(s)))];
  }

  return {
    slots: orderSlots([...picked]),
    byCheck,
    unlocated,
  };
}

/**
 * 把"当前是空的槽位"并入计划（§3.2 审计 2：空字符串视为该槽位缺失）。
 *
 * 单独一个函数而不是合进 `slotsFromReport()`：这样"默认只重发出错槽位"
 * 与"空槽位必须补齐"两件事各有各的落点，测试可以分别钉住。
 *
 * @param {{ slots: string[] }} plan
 * @param {Record<string,string>} slots 当前槽位
 * @param {{ allowed?: string[] }} [opts]
 */
export function withEmptySlots(plan, slots = {}, opts = {}) {
  const allowed = new Set(opts.allowed ?? SLOT_KEY_NAMES);
  const already = new Set(plan.slots);
  const extra = SLOT_KEY_NAMES.filter(
    (k) => allowed.has(k) && !already.has(k) && (typeof slots?.[k] !== 'string' || slots[k].trim() === ''),
  );
  return { ...plan, slots: orderSlots([...plan.slots, ...extra]), emptySlots: extra };
}

/** 按 §3.2 冻结键序排列（结果可复现；也便于"只重发一个槽位"的断言） */
export function orderSlots(slots) {
  const set = new Set(slots);
  return SLOT_KEY_NAMES.filter((k) => set.has(k));
}

/**
 * 保守退化：只按检查号算槽位（不看诊断）。
 * 覆盖测试与"报告里没有诊断"的极端情况，语义与 §8.1 的表逐字一致。
 */
export function slotsFromChecks(checkIds, opts = {}) {
  const allowed = new Set(opts.allowed ?? SLOT_KEY_NAMES);
  const picked = new Set();
  const unlocated = [];
  for (const id of checkIds) {
    const fromTable = (CHECK_TO_SLOTS[id] ?? []).filter((s) => allowed.has(s));
    if (!fromTable.length) unlocated.push(id);
    for (const s of fromTable) picked.add(s);
  }
  return { slots: orderSlots([...picked]), unlocated };
}

/**
 * 本轮该重发哪些槽位 —— 与 §8.1 的表一一对应的**纯函数判定**。
 *
 * 空槽位在这里并入：它们是"必须补齐"的硬缺口，补齐它们不算改坏已验证的槽位。
 *
 * @param {{ report: object, round: number, slots: Record<string,string> }} input
 * @returns {{ round: number, slots: string[], byCheck: object, unlocated: string[],
 *             emptySlots: string[], visualsOnly: boolean, failingChecks: string[] }}
 */
export function planRepair({ report, round, slots = {} }) {
  const base = slotsFromReport(report);
  // ⚠ 只有**调用方确实知道槽位内容**时才补空槽位：`{}` 与"8 个都空"是两回事，
  //   把"没传槽位字典"当成"全都缺失"会让计划退化成整块重生成（§8.1 的粒度就没了）。
  const knowsSlots = slots && Object.keys(slots).length > 0;
  const { slots: picked, emptySlots } = knowsSlots
    ? withEmptySlots(base, slots)
    : { slots: base.slots, emptySlots: [] };
  const { byCheck, unlocated } = base;
  const failingChecks = (report?.checks ?? [])
    .filter((c) => c.blocking && c.status === 'fail')
    .map((c) => c.id);

  // 只有扩展检查（视觉类）报警时不进修复循环：它们不阻塞，改不改都不影响交付
  const visualsOnly = failingChecks.length === 0;

  return { round, slots: picked, byCheck, unlocated, emptySlots, visualsOnly, failingChecks };
}

/* ────────────────────────── ② 这一轮能产出什么 ────────────────────────── */

/**
 * 交付形态由**槽位齐不齐**决定，不由"修没修好"决定（§14.2 的 B4）。
 *
 * - 8 槽位齐全 ⇒ `delivered-candidate`：可播放，但判定可能是 fail ⇒ **必须挂横幅**；
 * - 有槽位为空 ⇒ `skeleton`：起不了动画，如实说"缺哪几个槽位"。
 *
 * ⚠ 这里刻意**不把"修好了"当成交付前提**：§21.2 第 8 条要求"不静默交付"，
 *   而不是"不交付"。
 */
export function deliveryShape(slots) {
  const missing = SLOT_KEY_NAMES.filter((k) => typeof slots?.[k] !== 'string' || slots[k].trim() === '');
  return {
    playable: missing.length === 0,
    mode: missing.length === 0 ? 'delivered-candidate' : 'skeleton',
    missing,
  };
}

/**
 * 生成告警横幅（§21.2 第 8 条 / §14.2 的 B4）。
 *
 * @param {{ verdict: string, rounds: number, report: object, slots: object, reason?: string }} input
 * @returns {null | { level: 'warning', title: string, message: string, failedChecks: string[],
 *                    rounds: number, playable: boolean, missing: string[] }}
 */
export function buildBanner({ verdict, rounds, report, slots, reason = null }) {
  if (verdict === 'pass') return null;
  const shape = deliveryShape(slots);
  const failed = (report?.checks ?? []).filter((c) => c.blocking && c.status === 'fail').map((c) => c.id);
  const warned = (report?.checks ?? []).filter((c) => !c.blocking && c.status === 'fail').map((c) => c.id);

  const parts = [];
  if (failed.length) parts.push(`未通过的检查：${failed.join(' / ')}`);
  if (warned.length) parts.push(`告警项：${warned.join(' / ')}`);
  if (reason) parts.push(reason);
  if (!shape.playable) parts.push(`缺少槽位：${shape.missing.join(' / ')}——动画无法播放`);

  return {
    level: 'warning',
    title: shape.playable
      ? `结果未通过校验（已自动修复 ${rounds} 轮）`
      : `结果不完整（已自动修复 ${rounds} 轮）`,
    message: `${parts.join('；')}。本结果**未经通过**，请人工复核后再使用（§21.2 第 8 条：绝不静默交付可疑结果）。`,
    failedChecks: failed,
    rounds,
    playable: shape.playable,
    missing: shape.missing,
  };
}

/* ────────────────────────── ③ 回灌给模型的文本 ────────────────────────── */

/**
 * **这一类错误的正确写法**（第 8 期 L4a）。
 *
 * 为什么要有它：在此之前，修复轮喂给模型的只有"第几行错了、错成什么样"，
 * **没有一份"对的样子"** —— 所以模型是在盲改（用户的原话：3 轮盲改不过就带告警交付）。
 *
 * 这里给的是**最小可抄片段**，不是又一轮规则宣讲：
 *   · 键 = C1 的 `rule`（或检查号），与 `core/lint/contract-lint.mjs` 的 `diag()` 输出对齐；
 *   · 每条只给 1–2 行"照这个改"，并且都是能在本项目里跑通的写法。
 *
 * ⚠ 它不是判据，**也不改变任何判定**：只影响回灌文本里多几行提示。
 */
export const REPAIR_HINTS = Object.freeze({
  'arrow-missing-mag': {
    title: '箭头缺 `mag`（C1 直接判失败）',
    fix: [
      "Draw.arrow([state.x, state.y], [state.vx, state.vy], { category: 'velocity', mag: Math.abs(state.v), label: 'v', unit: 'm/s' });",
      'vec 只给**方向**（可带负号），长度由 `mag` 与"同类满量程"归一 ⇒ `mag` 必须是真实量级（|v| / |a| / |F|）。',
    ],
  },
  'arrow-deprecated-scale': {
    title: '箭头写了已废弃的 `scale`',
    fix: ['把 `scale` 删掉，把长度信息挪进 `mag`：`{ category, mag: 真实量级, label, unit }`。'],
  },
  'arrow-forbidden-color': {
    title: '箭头写了 `color`',
    fix: ['把 `color` 删掉：颜色由 `category` 唯一决定（绿=速度 / 蓝=加速度 / 红=受力 / 紫=辅助）。'],
  },
  'arrow-options-not-literal': {
    title: '`Draw.arrow` 的第三个参数不是对象字面量',
    fix: [
      '把选项**写开**在调用处（不要先存进变量）：`Draw.arrow(a, b, { category: \'force\', mag: F, label: \'F\' })`。',
      '静态预检只能看见字面量，否则无法确认有没有给 `mag`。',
    ],
  },
  'stateat-integrate': {
    title: '`stateAt` 里调了 `Phys.integrate`（架构不变量 §7.6）',
    fix: [
      "setup: `const samples = Phys.integrate(s0, deriv, 0, T, { dt: 1 / 240 }).samples; RETURN('samples', samples);`",
      "stateAt: `const x = Phys.interp(context.samples, t); return { x };`   // 查表 = O(log n)，允许在 stateAt 里用",
    ],
  },
  'unknown-global': {
    title: '用了没声明的名字',
    fix: [
      '若是**另一个槽位**的局部量 ⇒ `setup` 里 `RETURN(\'x\', x)`，这边 `const x = context.x;`；',
      '若是 SDK 函数名写错 ⇒ 照 `sdk/signature-summary.md` 里的名字逐字改（`Draw.circle` 而不是 `Draw.ball`）。',
    ],
  },
  'used-before-declaration': {
    title: '同一槽位里"先用后声明"',
    fix: ['把 `const` 声明挪到使用之前；若那个量其实来自别的槽位，改成 `const x = context.x;`。'],
  },
  'banned-identifier': {
    title: '用了被禁的宿主能力',
    fix: ['槽位代码拿不到 DOM / 网络 / 定时器：删掉它，改成纯计算 + `Draw.*` 推命令。'],
  },
  'unbounded-loop': {
    title: '无上界循环',
    fix: ['改成有界循环：`for (let i = 0; i < N; i += 1)`，`N` 是显式常量（采样最多几百点）。'],
  },
  'unbounded-recursion': {
    title: '自己调自己（无上界递归）',
    fix: ['改成有界循环或在 `setup()` 里预计算查表。'],
  },
  'slot-too-long': {
    title: '单槽位超过 400 行',
    fix: [
      '把重复的绘制收进局部函数（同一槽位内可定义函数），或把派生量挪进 `setup()` 用 `RETURN` 导出。',
    ],
  },
  C2: {
    title: '执行没在预算内结束',
    fix: ['按诊断里的"最后执行到第几行"往上找：常见是死循环、`undefined` 参与运算引发 NaN 传播、或访问了不存在的对象。'],
  },
  C3: {
    title: '出现了 NaN / Infinity',
    fix: ['顺诊断给的行号找第一个变成 NaN 的绑定：常见是除以 0、`Math.sqrt(负数)`、或读了没导出的 `context.x`。'],
  },
  C5: {
    title: '时间锚点对不上',
    fix: ['`STEPS` 的 `t0/t1` 首尾相接、不重叠，**末步 `t1` 必须等于 `SIM.duration`**（同一个字面量）。'],
  },
  C6: {
    title: '阶段边界处位置跳变',
    fix: ['检查两个分支在边界上是否给出**同一个位置**（速度只在有冲量时允许跳变）；必要时把边界值 `RETURN` 出来两边共用。'],
  },
  C7: {
    title: '答案没被读数复现',
    fix: [
      "`readouts` 每项 `{ label, value, unit }`，`label` 与 `ANSWERS.symbol` **逐字一致**（大小写、下标都算）；",
      '再确认 `at_t` 那一刻 `stateAt` 真能算出那个数，且 `readouts` 用了同一个量。',
    ],
  },
});

/**
 * 从诊断里挑出该给的"正确写法"（去重、最多 3 条、保持诊断顺序）。
 *
 * @param {Array<object>} diagnostics `collectDiagnostics()` 的产物
 * @param {string[]} [failingChecks] 没有可定位诊断时的兜底（按检查号给）
 * @returns {Array<{ key: string, title: string, fix: string[] }>}
 */
export function hintsForDiagnostics(diagnostics = [], failingChecks = []) {
  const out = [];
  const seen = new Set();
  const push = (key) => {
    const h = REPAIR_HINTS[key];
    if (!h || seen.has(key) || out.length >= 3) return;
    seen.add(key);
    out.push({ key, ...h });
  };
  for (const d of diagnostics) {
    if (d?.rule) push(d.rule);
    if (d?.check) push(d.check);
  }
  if (!out.length) for (const id of failingChecks) push(id);
  return out;
}

/**
 * 把一条诊断渲染成**面向模型可读**的一行（§8.2 / §21.1 第 4 条）。
 *
 * 三条硬要求：
 *   1. **带证据强度**（`精确` / `重放定位` / `候选`）—— 不带，模型会照着"候选行"改代码（§14.5 风险 3）；
 *   2. **不给 stack trace**，只给行号 + 最小复现 + 相关签名；
 *   3. **不给绝对路径**（§16 安全条款）。
 */
export function renderDiagnostic(d) {
  if (!d) return '';
  const loc = d.line ? `第 ${d.line} 行${d.column ? ` 第 ${d.column} 列` : ''}` : '（未能定位到具体行）';
  const head = `· [${d.check}] ${d.slot} ${loc}（${labelOf(d.precision)}）`;
  const lines = [`${head}：${d.message}`];
  // 强度指引只在"不是精确"时给：精确行号不需要额外叮嘱
  if (d.precision && d.precision !== 'exact') lines.push(`    证据强度说明：${guidanceOf(d.precision)}`);
  if (d.expected !== undefined && d.expected !== null) {
    lines.push(`    期望值 ${d.expected}${d.actual !== undefined && d.actual !== null ? ` · 实际值 ${d.actual}` : ''}${d.delta !== undefined && d.delta !== null ? ` · 差 ${d.delta}` : ''}`);
  }
  if (d.advice) lines.push(`    建议方向：${d.advice}`);
  return lines.join('\n');
}

/**
 * 组装**修复 Prompt 的输入段**（§8.2：失败检查号 + 最小复现 + 相关 SDK 签名 + 只发要重发的槽位）。
 *
 * 刻意**不包含**任何"忽略校验"的口子：Prompt 无法关闭 C1–C9（§10.3）。
 *
 * @param {object} input
 * @param {string} input.problem 原题（不改题面，只改代码）
 * @param {object} input.plan `planRepair()` 的结果
 * @param {object} input.report 上一轮的报告
 * @param {Record<string,string>} input.slots 当前槽位
 * @param {boolean} [input.codeSlot] 本次要改的是代码型槽位吗（决定要不要带 SDK 与架构不变量）
 */
export function buildRepairTask({ problem, plan, report, slots, codeSlot = true }) {
  const parts = [];

  parts.push('【原题（不得改动）】', problem ?? '', '');

  parts.push('【上一轮的校验结果】');
  const failing = (report?.checks ?? []).filter((c) => c.blocking && c.status === 'fail');
  if (!failing.length) parts.push('· （没有阻塞失败；本轮为降级修复）');
  for (const c of failing) parts.push(`· ${c.id} ${c.status === 'fail' ? '未通过' : c.status}：${c.detail ?? c.message ?? ''}`);
  parts.push('');

  parts.push('【必须修复的问题（按证据强度从高到低排序）】');
  const diags = collectDiagnostics(report, plan.slots);
  if (!diags.length) {
    parts.push('· （报告未给出可定位的诊断，请通读下面的槽位代码，找出与校验结果不符之处）');
  } else {
    // 证据强度高的先给：模型的时间应该花在可信的线索上
    for (const d of [...diags].sort(comparePrecision)) parts.push(renderDiagnostic(d));
  }
  parts.push('');

  /**
   * 第 8 期 L4a：**给"对的样子"，不只给"错在哪"**。
   * 之前这里只有诊断 ⇒ 模型在盲改，3 轮打回很常见。现在按诊断的规则名贴最小可抄片段。
   */
  const hints = hintsForDiagnostics(diags, plan.failingChecks ?? []);
  if (hints.length) {
    parts.push('【这一类错误的正确写法（照这个改，不要另发明写法）】');
    for (const h of hints) {
      parts.push(`· ${h.title}`);
      for (const line of h.fix) parts.push(`    ${line}`);
    }
    parts.push('');
  }

  parts.push('【本轮只允许你改动这些槽位】');
  for (const s of plan.slots) parts.push(`· ${s}`);
  parts.push('（其余槽位已经通过校验，**必须原样保留**；改坏它们算本轮失败）', '');

  for (const s of plan.slots) {
    parts.push(`【${s} 的当前代码】`, '```js', slots?.[s] ?? '', '```', '');
  }

  if (codeSlot) {
    // 相关 SDK 签名由固定前缀里的"SDK 签名摘要"提供（不在这里重复，避免前缀漂移）
    parts.push(
      '【硬性约束（与首次生成完全相同）】',
      '· 8 个槽位缺一不可，标记 `/* @slot:KEY */ … /* @end */` 独占一行；',
      '· `stateAt(t)` 必须 O(1)，**禁止**在其中调用 `Phys.integrate`；',
      '· `drawFrame(t, state)` 拿不到 `ctx`，只能调 `Draw.*` 推命令；',
      '· 不写像素坐标、相机比例；箭头必须带 `category`；',
      '· 只输出被改动槽位的标记与代码；未列出的槽位**不要**重复输出。',
    );
  }

  return parts.join('\n');
}

/** 从报告里收集与本次要改的槽位相关的诊断（去重；含 C1 的 lint 诊断） */
export function collectDiagnostics(report, targetSlots) {
  const want = new Set(targetSlots);
  const out = [];
  const seen = new Set();
  for (const c of report?.checks ?? []) {
    if (c.status !== 'fail') continue;
    for (const d of c.diagnostics ?? []) {
      // 与目标槽位无关的诊断不回灌：模型看不到那些槽位的代码，给了只会误导
      if (d?.slot && !want.has(d.slot)) continue;
      const key = `${d?.check}|${d?.slot}|${d?.line}|${d?.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ check: d.check ?? c.id, ...d });
    }
  }
  return out;
}

/* ────────────────────────── ④ 收敛与预算 ────────────────────────── */

/**
 * 是否继续修复（§14.5 第 3 条："每轮跑完 C1–C9，pass 即停；上限 3 轮"）。
 *
 * @returns {{ stop: boolean, reason: string }}
 */
export function shouldContinue({ verdict, round, maxRounds = REPAIR_MAX_ROUNDS, cancelled = false }) {
  if (cancelled) return { stop: true, reason: '用户取消' };
  if (verdict === 'pass') return { stop: true, reason: '已通过校验，收敛' };
  if (round >= maxRounds) return { stop: true, reason: `已达上限 ${maxRounds} 轮` };
  return { stop: false, reason: `第 ${round + 1} 轮修复` };
}

/**
 * 单轮修复的**代码预算**（§6.2 的长度上限；§20 风险"长代码导致模型能力退化"）。
 *
 * 只统计本轮要重发的槽位：模型这一轮只会看到它们，长度约束也应该只约束它们。
 */
export function roundBudget(slotNames, slots) {
  let total = 0;
  let stateDraw = 0;
  for (const s of slotNames) {
    const n = typeof slots?.[s] === 'string' ? slots[s].split('\n').length : 0;
    total += n;
    if (s === 'stateAt' || s === 'drawFrame') stateDraw += n;
  }
  return {
    lines: total,
    stateDrawLines: stateDraw,
    limits: CODE_LENGTH_LIMITS,
    /**
     * 第 8 期用户裁决：`stateAt + drawFrame ≤ 150 行` 已取消，
     * 现在只剩"单槽位 400 行总上限"。`stateDrawLines` 仍保留在返回值里
     * （修复 prompt 会显示它，属于信息而非判据）。
     */
    over: total > CODE_LENGTH_LIMITS.totalLines,
  };
}

/** 本轮修复涉及的是代码型槽位吗（决定修复 Prompt 带不带架构约束） */
export function involvesCodeSlots(slotNames) {
  return slotNames.some((s) => CODE_SLOTS.includes(s));
}
