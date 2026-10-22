/**
 * `couple`（步骤耦合）的解析与回退。
 *
 * 输入：`analysis` 运动表 + `breakdown` 的步骤文字（只有 title/tex）。
 * 输出：`stepTimes = [{ step, t0, t1 }]`（只记录有时间区间的步骤）。
 *
 * 约束（与用户确认）：
 *   · step 从 1 开始，必须在 1..stepCount；
 *   · t0 < t1，落在 [0, T_phys]；
 *   · 按 step 升序；
 *   · 不重叠；
 *   · **不要求覆盖整段时间**；
 *   · 纯概念步可以省略（没有记录 = 不跳时间）。
 */

const EPS = 1e-6;
const MAX_STEP_TIMES = 100;

function stripFence(text) {
  const m = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/.exec(String(text ?? '').trim());
  return m ? m[1].trim() : String(text ?? '').trim();
}

function splitBlocks(text) {
  return stripFence(text)
    .split(/\r?\n[ \t]*\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

function parseFields(block) {
  const fields = new Map();
  for (const line of block.split(/\r?\n/)) {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*[:：]\s*(.*)$/.exec(line.trim());
    if (!m) return { ok: false, error: `无法解析这一行：${line.trim()}` };
    if (fields.has(m[1])) return { ok: false, error: `字段重复：${m[1]}` };
    fields.set(m[1], m[2].trim());
  }
  return { ok: true, fields };
}

function toNum(raw, field) {
  const s = String(raw ?? '').trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) {
    return { ok: false, error: `${field} 必须是纯数字：${JSON.stringify(s)}` };
  }
  const n = Number(s);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `${field} 不是有限数` };
}

/**
 * @param {string} text 模型输出
 * @param {{ stepCount: number, tPhys: number }} input
 * @returns {{ ok: boolean, stepTimes: Array<{step:number,t0:number,t1:number}>, problems: string[] }}
 */
export function parseStepTimes(text, { stepCount, tPhys } = {}) {
  const problems = [];
  const n = Number(stepCount);
  const T = Number(tPhys);
  if (!Number.isInteger(n) || n < 1) problems.push('步骤数无效');
  if (!Number.isFinite(T) || T <= 0) problems.push('T_phys 无效');

  // 全是纯概念步骤时，模型可以什么都不写；这是合法的空表。
  if (!String(text ?? '').trim()) return { ok: problems.length === 0, stepTimes: [], problems };

  const records = [];
  for (const block of splitBlocks(text)) {
    const parsed = parseFields(block);
    if (!parsed.ok) {
      problems.push(parsed.error);
      continue;
    }
    const { fields } = parsed;
    const bad = [...fields.keys()].filter((k) => !['step', 't0', 't1', 'sub'].includes(k));
    if (bad.length) {
      problems.push(`出现不认识的字段：${bad.join(' / ')}`);
      continue;
    }
    if (!fields.has('step') || !fields.has('t0') || !fields.has('t1')) {
      problems.push('每条记录必须有 step / t0 / t1');
      continue;
    }
    const stepRes = toNum(fields.get('step'), 'step');
    const t0Res = toNum(fields.get('t0'), 't0');
    const t1Res = toNum(fields.get('t1'), 't1');
    if (!stepRes.ok || !t0Res.ok || !t1Res.ok) {
      problems.push(!stepRes.ok ? stepRes.error : !t0Res.ok ? t0Res.error : t1Res.error);
      continue;
    }
    if (!Number.isInteger(stepRes.value) || stepRes.value < 1 || stepRes.value > n) {
      problems.push(`step 必须是 1..${n} 的整数：${stepRes.value}`);
      continue;
    }
    if (t0Res.value < -EPS || t1Res.value > T + EPS) {
      problems.push(`step ${stepRes.value} 的时间超出 [0, ${T}]`);
      continue;
    }
    if (!(t1Res.value > t0Res.value)) {
      problems.push(`step ${stepRes.value} 的 t1 必须大于 t0`);
      continue;
    }
    /* sub（第几小问）：可选；缺省 1（整题不分问）。 */
    let sub = 1;
    if (fields.has('sub')) {
      const subRes = toNum(fields.get('sub'), 'sub');
      if (!subRes.ok || !Number.isInteger(subRes.value) || subRes.value < 1 || subRes.value > 20) {
        problems.push(`step ${stepRes.value} 的 sub 必须是 1..20 的整数`);
        continue;
      }
      sub = subRes.value;
    }
    records.push({ step: stepRes.value, t0: t0Res.value, t1: t1Res.value, sub });
  }

  if (records.length > MAX_STEP_TIMES) problems.push(`记录过多（>${MAX_STEP_TIMES}）`);
  const seen = new Set();
  for (const r of records) {
    if (seen.has(r.step)) problems.push(`step ${r.step} 重复`);
    seen.add(r.step);
  }
  if (records.length === 0) problems.push('没有解析出任何 stepTimes 记录');

  records.sort((a, b) => a.step - b.step);
  for (let i = 1; i < records.length; i += 1) {
    if (records[i].t0 < records[i - 1].t1 - EPS) {
      problems.push(`step ${records[i - 1].step} 与 step ${records[i].step} 的时间重叠`);
    }
  }

  return { ok: problems.length === 0, stepTimes: records, problems: [...new Set(problems)] };
}

/**
 * 耦合失败时的确定性回退：把步骤平均分到 [0, T_phys]。
 * 这是“有总比没有强”的兜底，必须由调用方带 warning。
 */
export function fallbackStepTimes(stepCount, tPhys) {
  const n = Number(stepCount);
  const T = Number(tPhys);
  if (!Number.isInteger(n) || n < 1 || !Number.isFinite(T) || T <= 0) return [];
  return Array.from({ length: n }, (_, i) => ({
    step: i + 1,
    sub: 1,
    t0: (T * i) / n,
    t1: (T * (i + 1)) / n,
  }));
}

/** 给耦合 Prompt 的步骤文本：只给标题/讲解，不给时间。 */
export function formatStepsForCouple(steps, maxTex = 500) {
  return (Array.isArray(steps) ? steps : [])
    .map((s, i) => {
      const tex = String(s?.tex ?? '').replace(/\s+/g, ' ').trim();
      return [`step: ${i + 1}`, `title: ${String(s?.title ?? `第 ${i + 1} 步`).trim()}`, `tex: ${tex.length > maxTex ? `${tex.slice(0, maxTex)}…` : tex}`].join('\n');
    })
    .join('\n\n');
}

/** 是否有一个可用的 stepTimes（至少一条、且时间合法） */
export function hasStepTimes(stepTimes) {
  return Array.isArray(stepTimes) && stepTimes.length > 0 && stepTimes.every((s) => Number.isFinite(s?.t0) && Number.isFinite(s?.t1) && s.t1 > s.t0);
}
