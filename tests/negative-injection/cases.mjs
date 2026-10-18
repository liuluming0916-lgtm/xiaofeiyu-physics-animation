/**
 * 负向注入用例集（§18 期 2 的验收标准）。
 *
 * 验收原文：**故意注入 NaN / 瞬移 / 时间断裂 / 死循环 / `require`，
 * 全部被准确拦下并给出行号级诊断**。
 *
 * 这里对**一道真题**（q01 传送带共速与摩擦生热）做定点注入，而不是另写玩具代码：
 * 玩具代码只能证明"校验器能抓玩具"，真题才能证明"判据在真实槽位代码上指得准"。
 *
 * 每条注入都是**按行锚点**打的补丁（`patchLine` 找不到锚点就抛错），
 * 因此题目源码一旦改动、锚点失效，本套件会**立刻报错**而不是悄悄退化成"注入了个空"。
 *
 * 每条用例声明三件事：
 *   · `expect.checks` —— 必须失败的检查号（§7.2 的 C1–C9，或扩展 X1/X2）；
 *   · `expect.at`      —— 注入点落在哪一行（行号级诊断必须指到这里）；
 *   · `expect.slot`    —— 诊断必须归属哪个槽位。
 */

/* ───────────────────────── 定点补丁工具 ───────────────────────── */

/** 用 `include` 找到唯一一行并整行替换；返回新槽位表与注入点行号区间 */
function patchLine(slots, slot, include, replacement) {
  const lines = String(slots[slot]).split('\n');
  const hits = lines.map((l, i) => (l.includes(include) ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) throw new Error(`注入锚点在 ${slot} 里命中 ${hits.length} 次（应为 1 次）："${include}"`);
  const at = hits[0];
  const inserted = replacement.split('\n');
  const next = [...lines.slice(0, at), ...inserted, ...lines.slice(at + 1)];
  return { slots: { ...slots, [slot]: next.join('\n') }, at: { start: at + 1, end: at + inserted.length } };
}

/** 在 `include` 那一行**之后**插入若干行 */
function insertAfter(slots, slot, include, code) {
  const lines = String(slots[slot]).split('\n');
  const hits = lines.map((l, i) => (l.includes(include) ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) throw new Error(`注入锚点在 ${slot} 里命中 ${hits.length} 次（应为 1 次）："${include}"`);
  const at = hits[0];
  const inserted = code.split('\n');
  const next = [...lines.slice(0, at + 1), ...inserted, ...lines.slice(at + 1)];
  return { slots: { ...slots, [slot]: next.join('\n') }, at: { start: at + 2, end: at + 1 + inserted.length } };
}

/* ───────────────────────── 五类必测注入 ───────────────────────── */

const ANCHOR_STATE_DS = 'var beltX = context.u * tt;';
const ANCHOR_STATE_X = 'var x = sliding ?';

export const INJECTIONS = [
  {
    id: 'baseline',
    className: '对照组',
    label: '未注入（真题原样）',
    note: '判据不能因为"变严了"就误伤真题——这是所有注入用例的前提。',
    apply: (slots) => ({ slots, at: null }),
    expect: { verdict: 'pass', checks: [] },
  },

  /* ① NaN —— 数值有限性（C3） */
  {
    id: 'nan-state',
    className: 'NaN',
    label: 'stateAt 里算出 NaN 并喂给状态量',
    note: 'NaN 不是异常，是悄悄流出去的数；C3 拦下它，归因要指到算出 NaN 的那一行。',
    apply: (slots) => {
      const a = insertAfter(slots, 'stateAt', ANCHOR_STATE_DS, 'var bad = Math.sqrt(0 - 1);');
      const b = patchLine(a.slots, 'stateAt', 'ds: beltX - x,', 'ds: beltX - x + bad,');
      return { slots: b.slots, at: a.at };
    },
    expect: { checks: ['C3'], slot: 'stateAt' },
  },
  {
    id: 'nan-readout',
    className: 'NaN',
    label: 'readouts 里直接算出 NaN',
    note: '读数槽位的 NaN：归因要看得到"是 readouts 的哪一条、哪一行"。',
    apply: (slots) => {
      const r = patchLine(
        slots,
        'readouts',
        "{ key: 'Q', label: '摩擦生热'",
        "{ key: 'Q', label: '摩擦生热', value: 0 / 0, unit: 'J', latex: 'Q' },",
      );
      return { slots: r.slots, at: r.at };
    },
    expect: { checks: ['C3'], slot: 'readouts' },
  },

  /* ② 瞬移 —— 步骤边界连续性（C6） */
  {
    id: 'teleport',
    className: '瞬移',
    label: '共速边界后给位移加一个 0.4 m 的常数跳变',
    note: '物理量在阶段边界本该连续；C6 比的是"位置类分量"，归因要指到那句改写。',
    apply: (slots) => {
      const a = insertAfter(slots, 'stateAt', ANCHOR_STATE_X, 'if (tt > 1.0) { x = x + 0.4; }');
      return { slots: a.slots, at: a.at };
    },
    expect: { checks: ['C6'], slot: 'stateAt' },
  },

  /* ③ 时间断裂 —— 时间覆盖（C5） */
  {
    id: 'time-gap',
    className: '时间断裂',
    label: 'STEPS 第 2 步的 t0 由 0.6 改成 0.7（留缝）',
    note: '数据型槽位的诊断必须能指到行式表的**具体那一行**，否则作者要在 20 行里找。',
    apply: (slots) => {
      const lines = String(slots.STEPS).split('\n');
      // 第 2 步的起点：整行就是 `t0: 0.6` 的那一行（第 1 步的 t0 是 `t0: 0`）
      const hits = lines.map((l, i) => (l.trim() === 't0: 0.6' ? i : -1)).filter((i) => i >= 0);
      if (hits.length !== 1) throw new Error(`注入锚点（t0: 0.6）命中 ${hits.length} 次（应为 1 次）`);
      const idx = hits[0];
      lines[idx] = 't0: 0.7';
      return { slots: { ...slots, STEPS: lines.join('\n') }, at: { start: idx + 1, end: idx + 1 } };
    },
    expect: { checks: ['C5'], slot: 'STEPS' },
  },

  /* ④ 死循环 —— C1 静态拦 + Worker 硬终止兜底（C2） */
  {
    id: 'dead-loop-static',
    className: '死循环',
    label: 'stateAt 里写 `while (true) {}`（静态可判）',
    note: '字面量无上界循环由 C1 在**执行前**拦下，行号列号来自 acorn。',
    apply: (slots) => {
      const a = insertAfter(slots, 'stateAt', ANCHOR_STATE_DS, 'while (true) { x = x + 1; }');
      return { slots: a.slots, at: a.at };
    },
    expect: { checks: ['C1'], slot: 'stateAt' },
  },
  {
    id: 'dead-loop-runtime',
    className: '死循环',
    label: 'stateAt 里写 `while (tt < 1e9) { x = x + 1e-9; }`（静态判不出）',
    note:
      '★ 本期的关键用例：C1 的白名单判据**无法**证明它不是无上界循环，' +
      '只有 Worker 的墙钟硬终止能抢回 CPU；终止后靠 SharedArrayBuffer 里的行号给出"卡在哪一行"。',
    apply: (slots) => {
      const a = insertAfter(slots, 'stateAt', ANCHOR_STATE_X, 'while (tt < 1e9) { x = x + 1e-9; }');
      return { slots: a.slots, at: a.at };
    },
    expect: { checks: ['C2'], slot: 'stateAt', termination: 'timeout' },
  },

  /* ⑤ require —— 沙箱逃逸（C1） */
  {
    id: 'require-escape',
    className: 'require',
    label: 'stateAt 里 `require("fs")`',
    note: '逃逸入口由 C1 指名标识符并给行列号。',
    apply: (slots) => {
      const a = insertAfter(slots, 'stateAt', ANCHOR_STATE_DS, 'var fs = require("fs");');
      return { slots: a.slots, at: a.at };
    },
    expect: { checks: ['C1'], slot: 'stateAt' },
  },

  /* ── 附加类（README 第九节点名要一起覆盖的三条） ── */

  {
    id: 'stateat-integrate',
    className: '附加·架构不变量',
    label: 'stateAt 里调用 `Phys.integrate`',
    note: '§7.6 的架构不变量：每帧积分会让播放卡死，必须静态拒绝。',
    apply: (slots) => {
      const a = insertAfter(slots, 'stateAt', ANCHOR_STATE_DS, 'var s0 = Phys.integrate(0, function () { return 1; }, 0, 1);');
      return { slots: a.slots, at: a.at };
    },
    expect: { checks: ['C1'], slot: 'stateAt' },
  },
  {
    id: 'memory-explosion',
    className: '附加·超内存',
    label: 'setup 里无限膨胀数组（把 Worker 内存顶死）',
    note:
      '与「死循环」互补：那条验的是墙钟硬终止，这条验的是 resourceLimits 内存上限。' +
      '为了跑得快，这一条把上限临时压到 64 MB——**只改预算、不改判据**，终止类型必须报 out-of-memory。',
    meta: { maxOldGenerationSizeMb: 64 },
    apply: (slots) => {
      const a = insertAfter(
        slots,
        'setup',
        'var xStar = u * u / (2 * a1);',
        'var hog = [];\nfor (var hi = 0; hi < 100000; hi = hi + 1) { hog.push(new Array(2000).fill(hi)); }',
      );
      return { slots: a.slots, at: a.at };
    },
    expect: { checks: ['C2'], slot: 'setup', termination: 'out-of-memory' },
  },
  {
    id: 'context-key-collision',
    className: '附加·跨槽位同名键',
    label: 'setup 里 `RETURN("t1", 0.5)`（与 STEPS 字段重名）',
    note: '第 1 期踩过的静默覆盖坑；本期做成扩展检查 X1，给精确行号但不阻塞。',
    apply: (slots) => {
      const a = insertAfter(slots, 'setup', "RETURN('g', g);", "RETURN('t1', 0.5);");
      return { slots: a.slots, at: a.at };
    },
    expect: { checks: ['X1'], slot: 'setup', blocking: false },
  },
  {
    id: 'drawraw-abuse',
    className: '附加·逃生门越界',
    label: 'drawFrame 里用 `Draw.raw` 刷掉 10% 以上的命令预算',
    note: '§19.1 门禁：`Draw.raw` 使用率 <10%；超标说明 SDK 该扩编，扩展检查 X2 提醒并给出首条调用行。',
    apply: (slots) => {
      const a = insertAfter(
        slots,
        'drawFrame',
        'var trackEnd = runLen + 0.7;',
        'for (var ri = 0; ri < 40; ri = ri + 1) {\n  Draw.raw(function (ctx) { ctx.fillRect(ri, 0, 1, 1); }, { note: "injected" });\n}',
      );
      return { slots: a.slots, at: a.at };
    },
    expect: { checks: ['X2'], slot: 'drawFrame', blocking: false },
  },
];

export const REQUIRED_CLASSES = Object.freeze(['NaN', '瞬移', '时间断裂', '死循环', 'require']);
