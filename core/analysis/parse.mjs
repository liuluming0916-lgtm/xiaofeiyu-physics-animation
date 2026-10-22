/**
 * 物理分析表（analysis）的解析与校验 —— v6（只有 MOTIONS）。
 *
 * 输出格式（行式表，记录之间空一行）：
 *
 *   assumption: 取 m_A=1 kg、m_B=2 kg、μ=0.2、g=10 m/s²；m_B=2m_A 符合题意
 *
 *   === 元件运动表 (MOTIONS) ===
 *
 *   element: block_A
 *   segment: 1
 *   t0: 0
 *   t1: 1.0
 *   x0: 0
 *   y0: 0
 *   vx0: 0
 *   vy0: 0
 *   ax: 2
 *   ay: 0
 *   x: 0.5*2*t^2
 *   y: 0
 *   note: 受滑动摩擦力向右匀加速
 *
 * 为什么不再有 EVENTS / ANSWERS：
 *   · ANSWERS 删除，C7 删除；
 *   · EVENTS 删除，C10 删除；
 *   · `stateAt` 由程序按本表生成，AI 只写 `drawFrame`。
 * 所以这一层只校验“运动表本身是否自洽”，不产生答案/事件。
 *
 * 表达式允许 `t` 与本段锚点（`t0 / x0 / y0 / vx0 / vy0`）；`^` 会在 `expr.mjs` 里归一化成 `**`。
 */

import { compileT } from './expr.mjs';

export const ANALYSIS_FORMAT = 'od-analysis';
export const ANALYSIS_VERSION = 2;

const MAX_SEGMENTS = 200;
const MAX_T_PHYS = 3600; // 秒；超过这个数的题不该用动画演示
const NUM_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const EPS = 1e-9;

const MOTION_FIELDS = new Set([
  'element',
  'type',
  'segment',
  'kind',
  't0',
  't1',
  'x0',
  'y0',
  'vx0',
  'vy0',
  'ax',
  'ay',
  'x',
  'y',
  'ya',
  'yb',
  'note',
]);

function problem(code, message, extra = {}) {
  return { code, message, ...extra };
}

function toNumber(raw, field) {
  const s = String(raw ?? '').trim();
  if (!NUM_RE.test(s)) return { ok: false, error: `${field} 必须是纯数字（不带单位）：${JSON.stringify(s)}` };
  const v = Number(s);
  if (!Number.isFinite(v)) return { ok: false, error: `${field} 不是有限数：${s}` };
  return { ok: true, value: v };
}

function nearlyEqual(a, b, rel = 1e-6, abs = 1e-9) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const diff = Math.abs(a - b);
  return diff <= abs || diff <= rel * Math.max(Math.abs(a), Math.abs(b));
}

/** 去掉模型可能包在外面的 ``` 围栏 */
function stripFence(text) {
  const m = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/.exec(text);
  return m ? m[1].trim() : text;
}

/** 去掉 `=== 元件运动表 (MOTIONS) ===` 这类区块头；保留正文 */
function stripHeaders(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*={2,}.*={2,}\s*$/.test(line))
    .join('\n');
}

/** 把文本切成记录块（空行分隔） */
function splitBlocks(text) {
  return text
    .split(/\n[ \t]*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/** 解析一条记录为字段表 */
function parseFields(block) {
  const fields = new Map();
  for (const line of block.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*[:：]\s*(.*)$/.exec(s);
    if (!m) return { ok: false, error: `无法解析的行（应为 key: value）：${s.slice(0, 60)}` };
    const key = m[1].toLowerCase();
    if (fields.has(key)) return { ok: false, error: `同一记录里字段重复：${key}` };
    fields.set(key, m[2].trim());
  }
  return { ok: true, fields };
}

function checkFields(fields, allowed) {
  for (const key of fields.keys()) {
    if (!allowed.has(key)) return `未知字段 "${key}"（允许：${[...allowed].join(' / ')}）`;
  }
  return null;
}

/**
 * 解析并校验分析表。
 *
 * @param {string} text
 * @returns {{
 *   format: string, version: number, ok: boolean,
 *   problems: Array<{code:string,message:string}>,
 *   warnings: Array<{code:string,message:string}>,
 *   assumption: string|null,
 *   elements: Array<{id:string, segments:Array<object>}>,
 *   tPhys: number|null,
 *   text: string,
 * }}
 */
export function parseAnalysisTable(text) {
  const problems = [];
  const warnings = [];
  const segments = [];
  let assumption = null;
  let assumptionSeen = false;

  const raw = typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : '';
  if (!raw) {
    return {
      format: ANALYSIS_FORMAT,
      version: ANALYSIS_VERSION,
      ok: false,
      problems: [problem('empty', '分析表为空')],
      warnings,
      assumption: null,
      elements: [],
      tPhys: null,
      text: '',
    };
  }

  const body = stripHeaders(stripFence(raw));

  for (const block of splitBlocks(body)) {
    const parsed = parseFields(block);
    if (!parsed.ok) {
      problems.push(problem('bad-record', parsed.error));
      continue;
    }
    const { fields } = parsed;

    /* ── 假设行 ── */
    if (fields.has('assumption')) {
      if (fields.size !== 1) {
        problems.push(problem('assumption-extra', 'assumption 记录只能有一个字段'));
      } else if (assumptionSeen) {
        problems.push(problem('assumption-duplicate', 'assumption 只能出现一次'));
      } else {
        assumptionSeen = true;
        const v = fields.get('assumption');
        if (v && v !== '无') {
          assumption = v;
          warnings.push(problem('assumption-used', `本表使用了示意值：${v}`));
        }
      }
      continue;
    }

    /* ── 运动段 ── */
    if (fields.has('element')) {
      const bad = checkFields(fields, MOTION_FIELDS);
      if (bad) {
        problems.push(problem('motion-field', bad));
        continue;
      }

      const element = fields.get('element')?.trim() ?? '';
      if (!element) {
        problems.push(problem('element-name', '运动段缺少 element 名称'));
        continue;
      }
      if (element.length > 40) {
        problems.push(problem('element-long', `element 名称过长（>40 字符）：${element.slice(0, 20)}…`));
        continue;
      }

      const type = (fields.get('type') ?? '').trim();
      if (type.length > 40) {
        problems.push(problem('element-type-long', `type 过长（>40 字符）：${type.slice(0, 20)}…`, { element }));
        continue;
      }

      const kind = (fields.get('kind') ?? 'closed').trim();
      if (kind !== 'closed') {
        problems.push(
          problem(
            'unsupported-kind',
            `本版只接受 kind: closed；收到 "${kind}"。ODE（数值积分）尚未接入，不要用假闭式代替。`,
            { element },
          ),
        );
        continue;
      }

      const segRes = toNumber(fields.get('segment'), 'segment');
      if (!segRes.ok || !Number.isInteger(segRes.value) || segRes.value < 1) {
        problems.push(problem('segment-index', `segment 必须是 ≥1 的整数：${fields.get('segment')}`));
        continue;
      }

      const t0Res = toNumber(fields.get('t0'), 't0');
      const t1Res = toNumber(fields.get('t1'), 't1');
      if (!t0Res.ok || !t1Res.ok) {
        problems.push(problem('segment-time', !t0Res.ok ? t0Res.error : t1Res.error));
        continue;
      }
      if (t0Res.value < 0) {
        problems.push(problem('segment-negative', `t0 不能为负：${t0Res.value}`));
        continue;
      }
      if (!(t1Res.value > t0Res.value)) {
        problems.push(problem('segment-order', `t1 必须大于 t0：t0=${t0Res.value} t1=${t1Res.value}`));
        continue;
      }
      if (t1Res.value > MAX_T_PHYS) {
        problems.push(problem('segment-too-long', `t1 超过 ${MAX_T_PHYS} 秒：${t1Res.value}`));
        continue;
      }

      /* 6 个初态数值 */
      const anchor = {};
      let anchorBad = null;
      for (const key of ['x0', 'y0', 'vx0', 'vy0', 'ax', 'ay']) {
        const r = toNumber(fields.get(key), key);
        if (!r.ok) {
          anchorBad = r.error;
          break;
        }
        anchor[key] = r.value;
      }
      if (anchorBad) {
        problems.push(problem('anchor-value', anchorBad, { element }));
        continue;
      }

      const xSrc = fields.get('x') ?? '';
      const ySrc = fields.get('y') ?? '';
      /* 表达式里允许直接引用本段锚点（t0/x0/y0/vx0/vy0/ax/ay）：鼓励"相对段起点"的增量写法，
         不让模型自己展开常数项。锚点值来自上面已经校验过的初态数字。 */
      const anchorVars = {
        t0: t0Res.value,
        x0: anchor.x0,
        y0: anchor.y0,
        vx0: anchor.vx0,
        vy0: anchor.vy0,
        ax: anchor.ax,
        ay: anchor.ay,
      };
      const x = compileT(xSrc, anchorVars);
      if (!x.ok) {
        problems.push(problem('x-expression', `x 表达式不合法：${x.error}`, { element }));
        continue;
      }
      const y = compileT(ySrc, anchorVars);
      if (!y.ok) {
        problems.push(problem('y-expression', `y 表达式不合法：${y.error}`, { element }));
        continue;
      }

      /* 可选的双液面/附加状态：yA / yB（水银柱等） */
      const extra = {};
      let extraBad = null;
      for (const [key, rawKey] of [['yA', 'ya'], ['yB', 'yb']]) {
        if (!fields.has(rawKey)) continue;
        const src = fields.get(rawKey) ?? '';
        const c = compileT(src, anchorVars);
        if (!c.ok) {
          extraBad = `${key} 表达式不合法：${c.error}`;
          break;
        }
        const v0 = c.fn(t0Res.value);
        const v1 = c.fn(t1Res.value);
        if (!Number.isFinite(v0) || !Number.isFinite(v1)) {
          extraBad = `${key} 在段内取不到有限值`;
          break;
        }
        extra[key] = { src, fn: c.fn };
      }
      if (extraBad) {
        problems.push(problem('extra-expression', extraBad, { element }));
        continue;
      }

      const samples = [t0Res.value, (t0Res.value + t1Res.value) / 2, t1Res.value];
      let badValue = null;
      for (const t of samples) {
        const xv = x.fn(t);
        const yv = y.fn(t);
        if (!Number.isFinite(xv)) badValue = `x(${t}) = ${xv}`;
        else if (!Number.isFinite(yv)) badValue = `y(${t}) = ${yv}`;
        if (badValue) break;
      }
      if (badValue) {
        problems.push(problem('expression-value', `表达式在段内取不到有限值：${badValue}`, { element }));
        continue;
      }

      /* 初态声明要和表达式在 t0 处一致 */
      const xAt0 = x.fn(t0Res.value);
      const yAt0 = y.fn(t0Res.value);
      if (!nearlyEqual(xAt0, anchor.x0) || !nearlyEqual(yAt0, anchor.y0)) {
        problems.push(
          problem(
            'anchor-mismatch',
            `元件 ${element} 第 ${segRes.value} 段初态与表达式不一致：` +
              `声明 (${anchor.x0}, ${anchor.y0})，代入 t0=${t0Res.value} 得到 (${xAt0.toFixed(6)}, ${yAt0.toFixed(6)})`,
            { element },
          ),
        );
        continue;
      }

      segments.push({
        element,
        type,
        segment: segRes.value,
        kind,
        t0: t0Res.value,
        t1: t1Res.value,
        anchor,
        x: { src: xSrc, fn: x.fn },
        y: { src: ySrc, fn: y.fn },
        ...(Object.keys(extra).length ? { extra } : {}),
        note: fields.get('note') ?? '',
      });
      continue;
    }

    problems.push(problem('unknown-record', '无法识别的记录：需要 assumption 或 element 段'));
  }

  if (segments.length === 0) problems.push(problem('no-segments', '没有任何运动分段'));
  if (segments.length > MAX_SEGMENTS) problems.push(problem('too-many-segments', `分段过多（>${MAX_SEGMENTS}）`));

  /* ── 按元件分组、校验段序与连续性 ── */
  const grouped = new Map();
  for (const seg of segments) {
    if (!grouped.has(seg.element)) grouped.set(seg.element, []);
    grouped.get(seg.element).push(seg);
  }

  for (const [id, list] of grouped) {
    list.sort((a, b) => a.segment - b.segment);

    const types = [...new Set(list.map((s) => s.type).filter(Boolean))];
    if (types.length > 1) {
      problems.push(
        problem(
          'element-type-conflict',
          `元件 ${id} 的 type 不一致：${types.join(' / ')}（同一元件的多段必须用同一个 type）`,
        ),
      );
    }
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].segment !== i + 1) {
        problems.push(problem('segment-sequence', `元件 ${id} 的 segment 必须从 1 连续编号，收到 ${list.map((s) => s.segment).join(',')}`));
        break;
      }
    }
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1];
      const next = list[i];
      if (nearlyEqual(prev.t1, next.t0, 1e-9, 1e-9)) {
        const px = prev.x.fn(prev.t1);
        const nx = next.x.fn(next.t0);
        const py = prev.y.fn(prev.t1);
        const ny = next.y.fn(next.t0);
        if (!nearlyEqual(px, nx, 1e-4, 1e-6) || !nearlyEqual(py, ny, 1e-4, 1e-6)) {
          problems.push(
            problem(
              'segment-discontinuous',
              `元件 ${id} 第 ${prev.segment}→${next.segment} 段端位置不连续：` +
                `t=${prev.t1} 处 (${px.toFixed(6)}, ${py.toFixed(6)}) vs (${nx.toFixed(6)}, ${ny.toFixed(6)})`,
            ),
          );
        }
      } else if (next.t0 > prev.t1) {
        problems.push(problem('segment-gap', `元件 ${id} 第 ${prev.segment} 段 t1=${prev.t1} 与第 ${next.segment} 段 t0=${next.t0} 之间有间隙`));
      } else {
        problems.push(problem('segment-overlap', `元件 ${id} 第 ${prev.segment} 段 t1=${prev.t1} 晚于第 ${next.segment} 段 t0=${next.t0}（重叠）`));
      }
    }
  }

  const tPhys = segments.length ? Math.max(...segments.map((s) => s.t1)) : null;
  const outElements = [...grouped.entries()].map(([id, list]) => {
    const types = [...new Set(list.map((s) => s.type).filter(Boolean))];
    return { id, type: types[0] ?? 'unknown', segments: list };
  });

  return {
    format: ANALYSIS_FORMAT,
    version: ANALYSIS_VERSION,
    ok: problems.length === 0,
    problems,
    warnings,
    assumption,
    elements: outElements,
    tPhys,
    text: body,
  };
}

/** 把解析结果还原成规范文本（用于注入下一步 / 预览 / 对比） */
export function formatAnalysis(analysis) {
  const lines = [];
  if (analysis?.assumption) {
    lines.push(`assumption: ${analysis.assumption}`, '');
  }
  lines.push('=== 元件运动表 (MOTIONS) ===', '');
  for (const el of analysis?.elements ?? []) {
    for (const s of el.segments) {
      lines.push(
        `element: ${el.id}`,
        ...(el.type && el.type !== 'unknown' ? [`type: ${el.type}`] : []),
        `segment: ${s.segment}`,
        `t0: ${s.t0}`,
        `t1: ${s.t1}`,
        `x0: ${s.anchor.x0}`,
        `y0: ${s.anchor.y0}`,
        `vx0: ${s.anchor.vx0}`,
        `vy0: ${s.anchor.vy0}`,
        `ax: ${s.anchor.ax}`,
        `ay: ${s.anchor.ay}`,
        `x: ${s.x.src}`,
        `y: ${s.y.src}`,
        ...(s.extra ? Object.entries(s.extra).map(([k, v]) => `${k}: ${v.src}`) : []),
        `note: ${s.note}`,
        '',
      );
    }
  }
  return lines.join('\n').trim();
}

/** 取某元件在 t 时刻的位置（段内闭式；t 早于首段取首段 t0，晚于末段取末段 t1） */
export function positionAt(analysis, elementId, t) {
  const list = analysis?.elements ?? [];
  const el = arrayFind(list, (e) => e.id === elementId);
  if (!el || el.segments.length === 0) return null;
  const first = el.segments[0];
  const last = el.segments[el.segments.length - 1];
  const tt = t < first.t0 ? first.t0 : t > last.t1 ? last.t1 : t;
  const seg = arrayFind(el.segments, (s) => tt >= s.t0 - EPS && tt <= s.t1 + EPS) ?? last;
  return { x: seg.x.fn(tt), y: seg.y.fn(tt), segment: seg.segment };
}

function arrayFind(list, pred) {
  for (const x of list) if (pred(x)) return x;
  return null;
}
