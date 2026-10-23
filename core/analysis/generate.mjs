/**
 * 由 `analysis` 运动表**生成**动画程序的数据/代码槽位。
 *
 * 新链路（用户 2026-10-22 拍板）：
 *   analysis（只有 MOTIONS） → 本模块生成 VIEW/setup/stateAt/readouts/STEPS
 *   → AI 只写 drawFrame
 *
 * 这样物理（位置、时长、v/a 箭头、曲线数据）全部由 analysis 决定，
 * AI 不再碰 stateAt，也就不可能把运动写错。
 *
 * 兼容层：仍生成 8 个槽位（AnimationProgram 的形状没变），
 *   · ANSWERS 为空（C7 已删）；
 *   · STEPS 只留 title / tex（v6；时间轴由 analysis 负责，C5/C6 改读 analysis）。
 */

import { anchorForType } from './geometry.mjs';
import { computeStageFrame, stageOfAnalysis } from '../stage/frame.mjs';

/**
 * 数学函数白名单（与 `core/analysis/expr.mjs` 的 `FUNCTIONS` 一一对应）。
 *
 * 为什么要有这一份：`expr.mjs` 规定物理分析里**只写裸函数名**（`exp(-t/τ)`、`cos(w*t)`），
 * 但生成的 `stateAt` 是要在真沙箱里跑的 JS —— 裸 `exp` 在 JS 里不存在。
 * `Math.` 前缀必须**在这里补**，不能指望模型写：v6 之后 `stateAt` 根本不由模型产出
 * （`scene_code` 只写 drawFrame），所以提示词里加规则是空转。
 *
 * 事故来源：q06 电容充电题，模型写 `x: 1.0000*t - 1.0000 + exp(-t/1.0000)`，
 * 生成出 `x0 = 1.0*tt0 - 1.0 + exp(-tt0 / 1.0)` → C1 `unknown-global` + C2 运行期崩溃，
 * 整题 frames=0，且因为确定性复现，自愈重跑两轮也修不掉。
 */
const MATH_FUNCTIONS = Object.freeze([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'exp', 'log', 'sqrt', 'abs', 'pow', 'min', 'max',
  'floor', 'ceil', 'round', 'sign',
]);

/**
 * 把 analysis 里的 t 表达式变成可以直接放进 JS 的表达式。
 *
 * 三件事：
 *   1. `^` → `**`；
 *   2. `t` → 指定变量名（每段独立的 `tt0`）；
 *   3. **本段锚点名字换成具体数字**（`t0 / x0 / y0 / vx0 / vy0`），并给函数名补 `Math.`。
 *
 * 第 3 条是 2026-10-23 用户的要求：模型写"相对段起点"的增量式（`y0 + vy0*(t - t0)`），
 * 不要自己把常数项算出来铺开。锚点数字由 parser 校验过、由这里原样代入，
 * 模型少做一次算术，就少一次算错的机会。
 */
export function toJsExpr(src, varName = 't', anchor = null) {
  let out = String(src ?? '').replace(/\^/g, '**');
  if (anchor && typeof anchor === 'object') {
    /* 先长后短，避免 `vx0` 被 `x0` 先吃掉 */
    for (const key of ['vx0', 'vy0', 'ax', 'ay', 't0', 'x0', 'y0']) {
      const v = anchor[key];
      if (!Number.isFinite(v)) continue;
      out = out.replace(new RegExp(`\\b${key}\\b`, 'g'), String(v));
    }
  }
  out = out.replace(/\bt\b/g, varName);
  /* 先统一剥掉已有的 `Math.`，再按白名单加回来 —— 两种写法（`exp` / `Math.exp`）都收敛到同一个结果，
     不会出现 `Math.Math.exp`，也不会漏掉模型偶然写的 `Math.cos`。 */
  out = out.replace(/\bMath\s*\.\s*/g, '');
  out = out.replace(new RegExp(`\\b(${MATH_FUNCTIONS.join('|')})\\b(?=\\s*\\()`, 'g'), 'Math.$1');
  out = out.replace(/\bPI\b(?!\s*\()/g, 'Math.PI');
  return out;
}

/** 取一段的锚点（供 toJsExpr 替换） */
function anchorOf(seg) {
  const a = seg?.anchor ?? {};
  return { t0: seg?.t0, x0: a.x0, y0: a.y0, vx0: a.vx0, vy0: a.vy0, ax: a.ax, ay: a.ay };
}

const JS_RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
  'let', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'yield', 'enum', 'await', 'implements', 'interface', 'package', 'private',
  'protected', 'public', 'static', 'null', 'true', 'false',
]);

/**
 * 元件 id → 语义化 state 键（B3'）。
 *
 * `e0` 这种按顺序编号的键有两个问题：元件重排后会串对象、日志里不可读。
 * 规则：id 本身是合法 JS 标识符就直接用（`block_A`）；否则退化为 `type_序号`（`物块A` → `block_1`）。
 * 重复/保留字自动加 `_2`。
 */
function semanticKeyOf(id, type, index, used) {
  const raw = String(id ?? '').trim();
  let base;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(raw)) {
    base = raw;
  } else {
    const t = String(type ?? '').trim().replace(/[^A-Za-z0-9_$]/g, '_').replace(/^_+/, '');
    base = /^[A-Za-z_$]/.test(t) ? `${t}_${index + 1}` : `el_${index + 1}`;
  }
  let key = base;
  let n = 2;
  while (used.has(key) || JS_RESERVED.has(key)) key = `${base}_${n++}`;
  used.add(key);
  return key;
}

/** 元件 id → state 键（语义化）；同时给 drawFrame 的提示词一份映射 */
function stateKeys(analysis) {
  const used = new Set();
  return (analysis.elements ?? []).map((el, i) => ({
    id: el.id,
    key: semanticKeyOf(el.id, el.type, i, used),
    type: el.type ?? 'unknown',
  }));
}

function fmt(n) {
  return Number.isFinite(n) ? String(n) : '0';
}

/**
 * 把 breakdown 的行式表拆成 `{ title, tex }`；容忍 `"""` 多行 tex。
 *
 * ⚠ 2026-10-23 改：**按行扫，不按空行切块**。
 *
 * 旧实现用 `split(/\n\s*\n/)` 切块，而模型（q06 实测）会在 `title:` 和 `tex: """` 之间空一行 ——
 * 于是同一步被切成两块：一块只有 title，一块只有 tex，后者被补上 `title: 第 N 步`，
 * 页面上就出现“第 2 步 / 第 4 步”这种空步骤，步数也从 4 变成 8（couple 跟着按 8 步编号）。
 * `tex: """` 本来就是为“正文里有空行”设计的，用空行当分隔符和它直接冲突。
 */
export function parseBreakdownSteps(text) {
  const raw = String(text ?? '').replace(/\r\n/g, '\n');
  if (!raw.trim()) return [];
  /**
   * 字段名归一：模型有时把步骤写成 `step_1_title:` / `step_1_tex:`（q09 实测），
   * 而 `buildStepsText` 只认 `title:` / `tex:`。这是**格式变体**，不是新语义，所以在入口抹平；
   * 否则整份讲解会退化成一步「动画」。
   */
  const normalized = raw.replace(/^[ \t]*step[ _-]?\d+[ _-]*(title|tex)\s*[:：]/gim, (m, k) => `${k}:`);
  const lines = normalized.split('\n');
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur && (cur.title || cur.tex)) out.push(cur);
    cur = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    const mt = /^title\s*[:：]\s*(.*)$/.exec(trimmed);
    if (mt) {
      flush();
      cur = { title: mt[1].trim(), tex: '' };
      continue;
    }
    const mx = /^tex\s*[:：]\s*(.*)$/.exec(trimmed);
    if (mx) {
      if (!cur) cur = { title: '', tex: '' };
      let v = mx[1].trim();
      if (v.startsWith('"""')) {
        v = v.slice(3);
        const inlineClose = v.indexOf('"""');
        if (inlineClose >= 0) {
          /* `tex: """一句话"""` —— 开闭在同一行 */
          v = v.slice(0, inlineClose);
        } else {
          const buf = [v];
          while (i + 1 < lines.length) {
            const next = lines[i + 1];
            const nt = next.trim();
            /* 未闭合的 `"""`：模型（q06 实测）会漏收尾，遇到下一个字段就收，
               否则会把后面的 title 也吞进 tex，整份步骤表只剩两条。 */
            if (/^(title|tex)\s*[:：]/.test(nt)) break;
            i += 1;
            if (nt.endsWith('"""')) {
              buf.push(nt.slice(0, -3));
              break;
            }
            buf.push(next);
          }
          v = buf.join('\n');
        }
      }
      cur.tex = v.trim();
      continue;
    }
  }
  flush();
  return out.map((s, i) => ({ title: s.title || `第 ${i + 1} 步`, tex: s.tex }));
}

/**
 * 生成 STEPS 槽位正文（v6：只保留 title / tex）。
 *
 * 时间轴由 analysis 负责，STEPS 不再承担 t0/t1；页签只显示讲解文字。
 * 保留 `analysis / tPhys` 形参只为兼容旧调用方（不参与生成）。
 */
export function buildStepsText(breakdownText, _analysis, _tPhys, fallbackTitle = '动画') {
  const steps = parseBreakdownSteps(breakdownText);
  const list = steps.length ? steps : [{ title: fallbackTitle, tex: '' }];
  return list
    .map((s) => {
      const tex = String(s.tex || '').replace(/\s+/g, ' ').trim() || '（无）';
      return [`title: ${s.title}`, `tex: ${tex}`].join('\n');
    })
    .join('\n\n');
}

/**
 * 舞台常量（带 `uCenter/vCenter`，供生成代码直接内联）。
 *
 * **只折算位置**：世界框由 analysis 的轨迹决定，元件尺寸不参与 ——
 * 尺寸属于"怎么画"，由 `drawFrame` 自己定（2026-10-24 用户裁决）。
 */
function stageOf(analysis) {
  const info = stageOfAnalysis(analysis);
  const base = info ? info.frame : computeStageFrame({ minX: 0, minY: 0, maxX: 10, maxY: 6 });
  return {
    ...base,
    uCenter: base.frame.u1 / 2,
    vCenter: base.frame.v1 / 2,
  };
}
/**
 * 生成 `stateAt`：每个运动元件一个对象。
 *
 * 口径（2026-10-24 用户裁决 —— 动画契约回滚到 1.1.17 的"少约束"版）：
 *   · `x / y`  = 物理米，**只给读数**（C1 仍然禁止在 `drawFrame` 里用）；
 *   · `cx / cy` = 该元件在 10×6 布局纸上的坐标（0–10 / 0–6），**画图只用它**；
 *   · `anchor` = 这个点是元件的哪个部位（bottom / center / top），只表达语义、不含尺寸；
 *   · **不给任何尺寸**（没有 `w/h/r`）：画多大由 `drawFrame` 自己定。
 *
 * 为什么删尺寸：尺寸是"怎么画"的一部分。以前由卡片喂 `physical`（或视觉几何表），
 * 于是"物块多大"由我们决定、由题目的物理量级决定；q04 那道 25 m 的题物块只剩 4 px，
 * 就是因为尺寸跟着世界跨度缩放。放权之后，尺寸回到卡片的"可照抄写法"里当范例，
 * 由模型按画面需要选。
 */
export function buildStateAt(analysis) {
  const lines = ['// 由 analysis 运动表生成；不要手改', 'const state = {};'];
  /* 舞台：由**物理分析表的位置轨迹**估世界框 → 折成 10×6 布局纸。 */
  const stage = stageOf(analysis);
  const keys = stateKeys(analysis);
  keys.forEach(({ id, key, type }, i) => {
    const el = analysis.elements[i];
    if (!el || !el.segments.length) return;
    const first = el.segments[0];
    const last = el.segments[el.segments.length - 1];
    lines.push(`let tt${i} = t;`);
    lines.push(`if (tt${i} < ${fmt(first.t0)}) tt${i} = ${fmt(first.t0)};`);
    lines.push(`if (tt${i} > ${fmt(last.t1)}) tt${i} = ${fmt(last.t1)};`);
    lines.push(`let x${i}, y${i};`);
    const extraKeys = [...new Set(el.segments.flatMap((s) => Object.keys(s.extra ?? {})))];
    for (const key of extraKeys) lines.push(`let ${key}${i};`);
    el.segments.forEach((s, j) => {
      const kw = j === 0 ? 'if' : 'else if';
      const a = anchorOf(s);
      const x = toJsExpr(s.x.src, `tt${i}`, a);
      const y = toJsExpr(s.y.src, `tt${i}`, a);
      const extra = Object.entries(s.extra ?? {})
        .map(([k, v]) => ` ${k}${i} = ${toJsExpr(v.src, `tt${i}`, a)};`)
        .join('');
      lines.push(`${kw} (tt${i} <= ${fmt(s.t1)}) { x${i} = ${x}; y${i} = ${y};${extra} }`);
    });
    const lx = toJsExpr(last.x.src, `tt${i}`, anchorOf(last));
    const ly = toJsExpr(last.y.src, `tt${i}`, anchorOf(last));
    const lastExtra = Object.entries(last.extra ?? {})
      .map(([k, v]) => ` ${k}${i} = ${toJsExpr(v.src, `tt${i}`, anchorOf(last))};`)
      .join('');
    lines.push(`else { x${i} = ${lx}; y${i} = ${ly};${lastExtra} }`);

    /* ── 布局坐标（2026-10-24 回滚到 1.1.17 口径）──
     * `x/y` 仍是物理米（读数、C10 用）；`cx/cy` 是同一个点在 10×6 纸上的布局坐标。
     * 只做**位置**换算：`anchor` 说明这个点是元件的哪一面，尺寸一律不给。 */
    const cxExpr = `${fmt(stage.uCenter)} + (x${i} - ${fmt(stage.cx)}) * ${fmt(stage.s)}`;
    const cyExpr = `${fmt(stage.vCenter)} + (y${i} - ${fmt(stage.cy)}) * ${fmt(stage.s)}`;
    const anchor = JSON.stringify(anchorForType(type));
    const extras = extraKeys.map((k) => `${k}: ${k}${i}`).join(', ');
    lines.push(
      `state.${key} = { x: x${i}, y: y${i}, cx: ${cxExpr}, cy: ${cyExpr}, anchor: ${anchor}, type: ${JSON.stringify(type)}` +
        (extras ? `, ${extras}` : '') +
        ' };',
    );
  });
  lines.push('return state;');
  return lines.join('\n');
}

/** 生成 readouts 函数体：每个元件的 x/y 与数值导出的 vx/vy */
export function buildReadouts(analysis, tPhys) {
  const lines = [
    '// 由 analysis 运动表生成；曲线图直接读这里',
    'const out = [];',
    'const h = 1e-4;',
    `const tA = Math.max(0, t - h);`,
    `const tB = Math.min(${fmt(tPhys)}, t + h);`,
    'const a = stateAt(tA);',
    'const b = stateAt(tB);',
    'const dt = (tB - tA) || 1;',
  ];
  stateKeys(analysis).forEach(({ id, key }) => {
    const q = JSON.stringify;
    lines.push(`out.push({ key: ${q(`${id}.x`)}, label: ${q(`${id} 水平位置`)}, value: state.${key}.x, unit: 'm' });`);
    lines.push(`out.push({ key: ${q(`${id}.y`)}, label: ${q(`${id} 竖直位置`)}, value: state.${key}.y, unit: 'm' });`);
    lines.push(`out.push({ key: ${q(`${id}.vx`)}, label: ${q(`${id} 水平速度`)}, value: (b.${key}.x - a.${key}.x) / dt, unit: 'm/s' });`);
    lines.push(`out.push({ key: ${q(`${id}.vy`)}, label: ${q(`${id} 竖直速度`)}, value: (b.${key}.y - a.${key}.y) / dt, unit: 'm/s' });`);
  });
  lines.push('return out;');
  return lines.join('\n');
}

/**
 * 生成 VIEW 槽位正文：时长 + 刚体位置（v/a 箭头由此求导） + 阶段边界 + 纸面框。
 *
 * `stage` 只带 `u0/u1/v0/v1`（相机固定拍这张 10×6 的纸），**故意不带 `s/cx/cy`**：
 * 带了的话运行时的 `Draw` 会按 `s` 再折算一次位置，而 drawFrame 里已经是布局坐标了。
 */
export function buildView(analysis, tPhys) {
  const keys = stateKeys(analysis);
  const st = stageOf(analysis);
  const stageJson = JSON.stringify({
    u0: st.frame.u0,
    u1: st.frame.u1,
    v0: st.frame.v0,
    v1: st.frame.v1,
  });
  const bodies = keys
    .map(
      ({ key }) =>
        `    { id: ${JSON.stringify(key)}, at: function (s) { const b = s.${key}; return [b.cx, b.cy]; } }`,
    )
    .join(',\n');
  const bounds = [...new Set((analysis.elements ?? []).flatMap((e) => e.segments.flatMap((s) => [s.t0, s.t1])))]
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const phases = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) phases.push(`{ t0: ${fmt(bounds[i])}, t1: ${fmt(bounds[i + 1])} }`);
  return [
    'SIM = {',
    `  duration: ${fmt(tPhys)},`,
    '  stage: ' + stageJson + ',',
    '  bodies: [',
    bodies,
    '  ],',
    ...(phases.length ? [`  phases: [${phases.join(', ')}],`] : []),
    '};',
  ].join('\n');
}

function stripCodeFence(s) {
  let t = String(s ?? '').trim();
  const m = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/.exec(t);
  if (m) t = m[1].trim();
  // 模型偶尔仍写成完整函数：剥掉外层 function drawFrame(...) { ... }
  const fn = /^function\s+drawFrame\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/.exec(t);
  if (fn) t = fn[1].trim();
  return t;
}

/**
 * 生成完整 8 槽位（drawFrame 由 AI 提供）。
 *
 * @param {object} input
 * @param {object} input.analysis  parseAnalysisTable() 的结果
 * @param {string} input.problem
 * @param {string} [input.breakdownText]
 * @param {string} input.drawFrame  AI 写的 drawFrame 函数体
 * @returns {Record<string,string>}
 */
export function generateProgramSlots({ analysis, problem, breakdownText, drawFrame }) {
  const tPhys = analysis?.tPhys;
  if (!(typeof tPhys === 'number' && Number.isFinite(tPhys) && tPhys > 0)) {
    throw new Error('analysis 缺少有效的 T_phys，无法生成动画程序');
  }
  return {
    /* 纯图片题的题面是空串；PROBLEM 不能空，否则清洗器按 slot.empty 硬拒（v1.1.19 修） */
    PROBLEM: String(problem ?? '').trim() || '（题目见图片）',
    STEPS: buildStepsText(breakdownText, analysis, tPhys),
    // C7 / ANSWERS 已删；留空串，程序形状允许（见 checkProgramShape）
    ANSWERS: '',
    VIEW: buildView(analysis, tPhys),
    setup: `const T_PHYS = ${fmt(tPhys)};`,
    stateAt: buildStateAt(analysis),
    drawFrame: stripCodeFence(drawFrame),
    readouts: buildReadouts(analysis, tPhys),
  };
}

/** 给 drawFrame 提示词用的状态键映射 */
export function stateKeyMap(analysis) {
  return stateKeys(analysis).map(({ id, key, type }) => ({ id, key, type }));
}

/**
 * t = 0 时每个元件的**布局坐标**（给 `scene_code` 摆静止件用）。
 *
 * 为什么单独算：静止件（地面、带、滑轮、斜面）要在"元件此刻在哪"上对齐，
 * 而 `drawFrame` 拿到的 `state` 是逐帧的；把 t=0 的位置直接写进 user，
 * 模型就不用猜，斜面也不会画歪。
 *
 * @returns {Record<string, {cx:number, cy:number, anchor:string}>}
 */
export function t0LayoutStates(analysis) {
  const stage = stageOf(analysis);
  const out = {};
  stateKeys(analysis).forEach(({ key, type }, i) => {
    const el = analysis?.elements?.[i];
    const seg = el?.segments?.[0];
    const x = seg?.x?.fn?.(0);
    const y = seg?.y?.fn?.(0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    out[key] = {
      cx: stage.uCenter + (x - stage.cx) * stage.s,
      cy: stage.vCenter + (y - stage.cy) * stage.s,
      anchor: anchorForType(type),
    };
  });
  return out;
}
