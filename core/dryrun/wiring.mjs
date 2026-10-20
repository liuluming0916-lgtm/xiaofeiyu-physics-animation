/**
 * 接线对账（v1.1.16）：**一个槽位“提供”的名字，必须覆盖另一个槽位“消费”的名字**。
 *
 * 为什么需要它：这类错误现在只有“跑到画图那一步才炸”一种暴露方式，而且报错指向**消费方**
 * （`drawFrame` 第 N 行 NaN），把自愈引去改错的地方。实测：`stateAt` 没返回 `yB`，
 * 自愈为了消掉 NaN 把滑轮抬到 3.0 —— 检查绿了，画面崩了。
 *
 * 口径（与设计文档 `docs/plans/自愈改造-接线对账与代码槽位重画.md` 一致）：
 *   · 提供方：`stateAt` 的返回键（取 Dry-Run 采样帧里 state 的键并集）、
 *     `setup` 的 `RETURN` 键（`run.program.contextKeys`）；
 *   · 消费方：源码里的 `state.<name>` / `context.<name>` 静态读取；
 *   · 只报“读了但没有”的情况；`state?.x` 这种可选读取**不算消费**（避免误报）。
 *
 * 纯函数（只读 `run` 的快照），不抛错：取不到就标记 skipped，交由现有判据处理。
 */

/** 运行时注入到 `context` 的内置名（不算“作者提供的名字”） */
const BUILTIN_CONTEXT = new Set(['SIM', 'STEPS', 'ANSWERS', 'MODE', 'Draw', 'Phys', 'at', 'duration']);

const CODE_SLOT_KEYS = ['VIEW', 'setup', 'stateAt', 'drawFrame', 'readouts'];

/** 静态扫出某个源码里 `state.<name>` 的读取（不含 `state?.name`） */
function scanStateReads(source) {
  const out = new Set();
  const re = /\bstate\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(String(source ?? '')))) out.add(m[1]);
  return out;
}

/** 静态扫出某个源码里 `context.<name>` 的读取（不含 `context?.name`） */
function scanContextReads(source) {
  const out = new Set();
  const re = /\bcontext\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(String(source ?? '')))) out.add(m[1]);
  return out;
}

/**
 * @param {Record<string,string>} slots 8 个槽位
 * @param {object} run Dry-Run 的 `run`（含 `frames` 与 `program.contextKeys`）
 * @returns {{ issues: object[], provided: { state: string[], context: string[] }, skipped?: boolean }}
 */
export function auditWiring(slots, run) {
  const issues = [];
  const frames = Array.isArray(run?.frames) ? run.frames : [];

  /* ① 提供方：stateAt 的返回键
     ⚠ 不能只靠 frames：程序可能因为“读了缺失的键”在画图时崩掉，一帧都没有 ——
        而这恰恰是最需要报出来的情况。所以优先用 `run.stateAt`（独立的只读探针）取样，
        取不到再退回 frames 的并集。 */
  const providedState = new Set();
  const duration = Number.isFinite(run?.duration) && run.duration > 0 ? run.duration : 1;
  if (typeof run?.stateAt === 'function') {
    for (const t of [0, duration / 2, duration]) {
      try {
        const state = run.stateAt(t);
        if (state && typeof state === 'object') for (const k of Object.keys(state)) providedState.add(k);
      } catch {
        /* 该时刻取不到：少一个样本 */
      }
    }
  }
  if (providedState.size === 0 && frames.length) {
    const picks = [frames[0], frames[Math.floor(frames.length / 2)], frames[frames.length - 1]];
    for (const f of picks) {
      if (f?.state && typeof f.state === 'object') for (const k of Object.keys(f.state)) providedState.add(k);
    }
  }
  if (providedState.size === 0) {
    return { issues, provided: { state: [], context: [] }, skipped: true };
  }

  /* ② 提供方：context（setup 的 RETURN 键） */
  const ctxKeys = Array.isArray(run?.program?.contextKeys) ? run.program.contextKeys : null;
  const providedContext = new Set((ctxKeys ?? []).filter((k) => !BUILTIN_CONTEXT.has(k)));

  /* ③ 消费方：静态读取 */
  const consumedState = new Set([...scanStateReads(slots.drawFrame), ...scanStateReads(slots.readouts)]);
  const consumedContext = new Set();
  for (const k of CODE_SLOT_KEYS) {
    for (const name of scanContextReads(slots[k])) consumedContext.add(name);
  }

  /* ④ 差集 = 接线错误 */
  for (const name of consumedState) {
    if (providedState.has(name)) continue;
    issues.push({
      check: 'C1',
      rule: 'state-key-missing',
      slot: 'stateAt',
      name,
      message:
        `drawFrame / readouts 读了 state.${name}，但 stateAt 的 return 里没有它 —— ` +
        `请在 stateAt 的 return 里补上 ${name}（不要去改 drawFrame 去凑，那样会把几何改坏）`,
    });
  }
  for (const name of consumedContext) {
    /* 运行时注入的名字（`context.at` 是只读探针，不是作者提供的）不算“缺” */
    if (BUILTIN_CONTEXT.has(name)) continue;
    if (providedContext.has(name)) continue;
    issues.push({
      check: 'C1',
      rule: 'context-key-missing',
      slot: 'setup',
      name,
      message:
        `代码里读了 context.${name}，但 setup 没有 RETURN('${name}', …) —— ` +
        `请在 setup 里导出它（或改成读已导出的名字）`,
    });
  }

  return { issues, provided: { state: [...providedState], context: [...providedContext] } };
}
