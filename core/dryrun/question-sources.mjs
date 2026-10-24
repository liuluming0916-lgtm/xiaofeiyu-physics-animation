/**
 * question-sources —— **两套题的统一加载器**（合成回归 15 道 + 真题回归 8 道）。
 *
 * 背景（v1.1.18 B8）：
 *   门禁 ③（`core/dryrun/run-suite.mjs`）与 ⑦（`tools/render-check.mjs`）原先只读
 *   `tests/regression-15/*.mjs`；真题在 `tests/real-exam/` 里是**数据**（`*.program.json`），
 *   从未被任何门禁跑过（只靠人工 `tools/_check-real.mjs` 点名）。B8 要把真题挂进 ③⑦，
 *   于是把"读题"这件事抽成一份实现，两站共用。
 *
 * 为什么不放在 `tests/` 或 `tools/`：
 *   那两处都在 `tools/verify-coverage.mjs` 的候选扫描面里，放进去就得再写一条豁免理由。
 *   `core/dryrun/` 不在扫描面内，而且它本来就是 dry-run 的家。
 *
 * 这一份文件同时负责**清单体检**（不是"看起来在检查"）：
 *   - 清单与盘上文件必须互相对得上（缺程序 / 多程序 / 题号不符 / 占位却带程序）；
 *   - `semantics: "v6"` 的程序不得再出现 `state.e0` / `cx` / `cy`（C 方案，2026-10-24）；
 *   - `VIEW.SIM.bodies` 引用的每个 key 都必须在 `stateAt` 里被赋值（自洽，legacy 也要求）；
 *   - 冻结过的程序/预览，sha256 必须与清单一致（冻结后偷改会红）；
 *   - **体检自带 5 份坏清单做负对照**，每次调用都真跑一遍 —— 否则"体检写了但没生效"没人发现。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGRESSION_DIR = join(PROJECT_ROOT, 'tests', 'regression-15');
export const REAL_EXAM_DIR = join(PROJECT_ROOT, 'tests', 'real-exam');

/** 套件名 → 目录与读法 */
export const SUITES = {
  'regression-15': { dir: REGRESSION_DIR, kind: 'module', label: '合成回归（确定性夹具）' },
  'real-exam': { dir: REAL_EXAM_DIR, kind: 'manifest', label: '真题回归（高考真题）' },
};

/** 清单里允许的状态。含义见 docs/plans/B8-真题回归方案.md §2.2 */
export const STATUSES = ['placeholder', 'todo', 'candidate', 'accepted'];
/** 这些状态必须带程序与预览 */
export const RUNNABLE_STATUSES = ['candidate', 'accepted'];

/* ────────────────────────── CLI 参数 ────────────────────────── */

/**
 * 解析 `--suite <name>`：默认 `regression-15`（保持老行为，门禁显式传 `all`）。
 * 其余不以 `--` 开头的参数都当题目过滤器。
 */
export function parseSuiteArgs(argv = []) {
  const out = { suite: 'regression-15', filters: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--suite') out.suite = argv[++i];
    else if (a.startsWith('--suite=')) out.suite = a.slice('--suite='.length);
    else if (!a.startsWith('--')) out.filters.push(a);
  }
  if (out.suite !== 'all' && !SUITES[out.suite]) {
    throw new Error(`未知套件：${out.suite}（可选 ${Object.keys(SUITES).join(' / ')} / all）`);
  }
  return out;
}

/* ────────────────────────── 时长元数据 ────────────────────────── */

/**
 * 真题的 `program.json` 里没有 analysis，C5/C6 要的两个数只能从程序本身反推：
 *   - `T_phys`：`setup` 槽位里的 `const T_PHYS = …`（v6 生成器写的就是这一行）；
 *   - `boundaries`：`VIEW` 里 `phases` 的 `t0/t1` 全集。
 * 这套解析原先写在 `tools/_check-real.mjs` 里，现在两处共用一份。
 */
export function deriveTiming(slots = {}) {
  const num = (s) => Number(s);
  const setupTs = /T_PHYS\s*=\s*([0-9.eE+-]+)/.exec(slots.setup ?? '');
  const viewDur = /duration\s*:\s*([0-9.eE+-]+)/.exec(slots.VIEW ?? '');
  const tPhys = setupTs ? num(setupTs[1]) : viewDur ? num(viewDur[1]) : undefined;
  const boundaries = [
    ...new Set(
      [...(slots.VIEW ?? '').matchAll(/t0\s*:\s*([0-9.eE+-]+)\s*,\s*t1\s*:\s*([0-9.eE+-]+)/g)].flatMap((m) => [
        num(m[1]),
        num(m[2]),
      ]),
    ),
  ]
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  /**
   * v1.1.19：场景分支边界（`phases` 里 `branch: true`）。
   * C6 在这些边界上**不判位置连续**——分支允许从 c 回到 b 重新开始。
   */
  const branchBoundaries = [
    ...new Set(
      [...(slots.VIEW ?? '').matchAll(/t0\s*:\s*([0-9.eE+-]+)\s*,\s*t1\s*:\s*[0-9.eE+-]+\s*,\s*branch\s*:\s*true/g)].map(
        (m) => num(m[1]),
      ),
    ),
  ]
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  return {
    ...(Number.isFinite(tPhys) ? { tPhys } : {}),
    ...(boundaries.length ? { boundaries } : {}),
    ...(branchBoundaries.length ? { branchBoundaries } : {}),
  };
}

/* ────────────────────────── 清单体检 ────────────────────────── */

/** 从槽位代码里抠出结构（只做正则级检查，不执行） */
function structureOf(slots = {}) {
  const stateAt = String(slots.stateAt ?? '');
  const view = String(slots.VIEW ?? '');
  const assigned = new Set([...stateAt.matchAll(/\bstate\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]));
  const referenced = new Set([...view.matchAll(/\bs\.([A-Za-z_$][\w$]*)\b/g)].map((m) => m[1]));
  // `at: function (s) { const b = s.KEY; … }` 里的 `s.KEY` 就是 bodies 的 key
  const legacyKeys = [...stateAt.matchAll(/\bstate\.e\d+\b/g)].map((m) => m[0]);
  const cxCy = [...stateAt.matchAll(/\b(cx|cy)\s*:/g)].map((m) => m[1]);
  return { assigned, referenced, legacyKeys, cxCy };
}

/**
 * 体检。`io` 可注入（负对照用），默认读盘。
 * @returns {{ errors: Array<{code:string,item?:string,detail:string}>, counts: object, runnable: object[] }}
 */
export function auditManifest(manifest, io = defaultIo()) {
  const errors = [];
  const push = (code, detail, item) => errors.push({ code, detail, ...(item ? { item } : {}) });

  if (!manifest || typeof manifest !== 'object') {
    push('manifest-not-object', 'index.json 不是对象');
    return { errors, counts: {}, runnable: [] };
  }
  if (manifest.format !== 'od-real-exam') push('manifest-format', `format=${manifest.format}`);
  if (manifest.version !== 2) push('manifest-version', `version=${manifest.version}（要求 2）`);
  /* `restart: true` 允许"0 道可跑"（重建期），但必须写明理由 —— 否则它就是一个静音的逃生门 */
  if (manifest.restart === true && (typeof manifest.restartNote !== 'string' || manifest.restartNote.trim().length < 20)) {
    push('restart-note-missing', 'restart=true 时必须写 restartNote（≥20 字，说明为什么 0 道可跑）');
  }

  const items = Array.isArray(manifest.items) ? manifest.items : [];
  if (!items.length) push('manifest-empty', 'items 为空');

  const seenId = new Set();
  const seenNumber = new Set();
  const counts = { placeholder: 0, todo: 0, candidate: 0, accepted: 0 };
  const runnable = [];

  for (const item of items) {
    const id = String(item.id ?? '');
    if (!/^q\d{2}$/.test(id)) push('id-shape', `id 必须是 qNN（原卷题号），实际 ${JSON.stringify(item.id)}`, id);
    if (seenId.has(id)) push('id-duplicate', `题号重复：${id}`, id);
    seenId.add(id);
    if (Number.isInteger(item.number)) {
      if (seenNumber.has(item.number)) push('number-duplicate', `number 重复：${item.number}`, id);
      seenNumber.add(item.number);
      if (id && Number(id.slice(1)) !== item.number) push('number-mismatch', `id=${id} 但 number=${item.number}`, id);
    } else {
      push('number-missing', 'number 必须是整数（原卷题号）', id);
    }

    if (!STATUSES.includes(item.status)) push('status-invalid', `status=${JSON.stringify(item.status)}`, id);
    else counts[item.status] += 1;

    if (typeof item.problem !== 'string' || item.problem.trim().length < 40) {
      push('problem-missing', `题面缺失或过短（${item.problem?.length ?? 0} 字）`, id);
    }
    if (!Array.isArray(item.answer) || !item.answer.length) push('answer-missing', 'answer 必须是非空数组', id);
    if (!item.image) push('image-missing', '缺少原题裁图路径', id);

    const wantsProgram = RUNNABLE_STATUSES.includes(item.status);
    if (!wantsProgram) {
      if (item.program) push('program-unexpected', `${item.status} 不该带程序（${item.program}）`, id);
      if (item.preview) push('preview-unexpected', `${item.status} 不该带预览（${item.preview}）`, id);
      continue;
    }

    if (!item.program) {
      push('program-missing', `${item.status} 缺程序`, id);
      continue;
    }
    const programPath = join(io.dir, item.program);
    if (!io.exists(programPath)) {
      push('program-missing', `程序文件不存在：${item.program}`, id);
      continue;
    }
    if (!item.preview || !io.exists(join(io.dir, item.preview))) push('preview-missing', `预览不存在：${item.preview}`, id);
    if (!item.image || !io.exists(join(io.dir, item.image))) push('image-missing', `原题裁图不存在：${item.image}`, id);
    if (!item.semantics || !['v6', 'legacy'].includes(item.semantics)) push('semantics-invalid', `semantics=${item.semantics}`, id);

    let program;
    try {
      program = io.readJson(programPath);
    } catch (err) {
      push('program-parse', `程序 JSON 解析失败：${err.message}`, id);
      continue;
    }
    if (program.id !== item.id) push('program-id-mismatch', `程序里 id=${program.id}，清单是 ${item.id}`, id);
    if (program.index !== item.number) push('program-index-mismatch', `程序里 index=${program.index}，清单 number=${item.number}`, id);
    if (typeof program.title !== 'string' || !program.title) push('program-title-missing', '程序里没有 title', id);
    else if (program.title !== item.title) push('program-title-mismatch', `程序 title=「${program.title}」≠ 清单「${item.title}」`, id);
    if (!program.slots) {
      push('program-slots-missing', '程序里没有 slots', id);
      continue;
    }

    const st = structureOf(program.slots);
    if (item.semantics === 'v6') {
      if (st.legacyKeys.length) push('state-legacy-key', `semantics=v6 但还有 ${st.legacyKeys.join('/')}`, id);
      if (st.cxCy.length) push('state-cx-cy', `semantics=v6 但 state 里还有 ${[...new Set(st.cxCy)].join('/')}`, id);
    }
    const missing = [...st.referenced].filter((k) => !st.assigned.has(k));
    if (missing.length) push('body-key-missing', `VIEW.bodies 引用了 stateAt 没赋值的 key：${missing.join('/')}`, id);
    const { tPhys } = deriveTiming(program.slots);
    if (tPhys === undefined) push('tphys-missing', 'setup 里没有 T_PHYS（C5 判不了）', id);

    if (item.frozen) {
      const want = String(item.frozen.sha256 ?? '').toLowerCase();
      if (!want) push('frozen-sha-missing', 'frozen 里没有 sha256', id);
      else {
        const got = io.sha256(programPath);
        if (got !== want) push('frozen-sha-mismatch', `程序 sha256 ${got.slice(0, 12)} ≠ 清单 ${want.slice(0, 12)}`, id);
      }
    } else {
      push('frozen-missing', `${item.status} 必须有 frozen（sha256 + frozenAt）`, id);
    }

    runnable.push({ ...item, programData: program });
  }

  for (const rel of io.listProgramFiles()) {
    const base = rel.replace(/\\/g, '/');
    /* 反例与中间产物不算孤儿：`q06.handwritten.program.json`（历史反例）、`*-model.program.json`（跑出来的原始产物） */
    if (/\.handwritten\.program\.json$/.test(base) || /-model\.program\.json$/.test(base)) continue;
    const id = base.replace(/\.program\.json$/, '');
    if (!items.some((it) => it.program === base || it.id === id)) push('program-orphan', `盘上有清单外的程序：${base}`);
  }

  return { errors, counts, runnable };
}

/** 默认 IO（读 `tests/real-exam/`）。负对照通过替换它来喂坏清单。 */
export function defaultIo(dir = REAL_EXAM_DIR) {
  return {
    dir,
    exists: (p) => existsSync(p),
    readJson: (p) => JSON.parse(readFileSync(p, 'utf8')),
    sha256: (p) => createHash('sha256').update(readFileSync(p)).digest('hex'),
    listProgramFiles: () => readdirSync(dir).filter((f) => f.endsWith('.program.json')),
  };
}

/**
 * 负对照：5 份**故意写坏**的清单，每一份都必须被体检点名到指定错误码。
 * 返回没被点名的那些（空数组 = 体检真的在工作）。
 *
 * 为什么放在这里而不是单独一个门禁脚本：
 *   单开一步会让"56 步"变成 57 步，而这条判据本来就属于 ③ 的前置体检 ——
 *   跟着每次 dry-run 真跑一遍，比"写了但没人跑"强。
 */
export function auditSelfControlFailures() {
  const good = {
    id: 'q08',
    number: 8,
    title: 'x',
    status: 'candidate',
    semantics: 'v6',
    problem: '题'.repeat(60),
    answer: ['(1) 1'],
    image: 'pages/q08.png',
    program: 'q08.program.json',
    preview: 'q08.html',
    frozen: { sha256: 'a'.repeat(64), frozenAt: '2026-10-24' },
  };
  const program = {
    id: 'q08',
    index: 8,
    title: 'x',
    slots: {
      PROBLEM: 'p',
      STEPS: 'title: a\ntex: b',
      VIEW: 'SIM = { duration: 1, bodies: [{ id: "BALL_A", at: function (s) { const b = s.BALL_A; return [b.u, b.v]; } }] };',
      setup: 'const T_PHYS = 1;',
      stateAt: 'const state = {}; state.BALL_A = { x: 0, y: 0, u: 5, v: 3 }; return state;',
      drawFrame: '',
      readouts: '',
    },
  };
  const mkIo = (over = {}) => ({
    dir: '/virtual',
    exists: () => true,
    readJson: () => program,
    sha256: () => 'a'.repeat(64),
    listProgramFiles: () => ['q08.program.json'],
    ...over,
  });
  const cases = [
    {
      name: '题号不符',
      expect: 'number-mismatch',
      manifest: { format: 'od-real-exam', version: 2, items: [{ ...good, number: 9 }] },
      io: mkIo(),
    },
    {
      name: '非占位却缺程序',
      expect: 'program-missing',
      manifest: { format: 'od-real-exam', version: 2, items: [{ ...good, program: null }] },
      io: mkIo(),
    },
    {
      name: '占位却带程序',
      expect: 'program-unexpected',
      manifest: { format: 'od-real-exam', version: 2, items: [{ ...good, status: 'placeholder' }] },
      io: mkIo(),
    },
    {
      name: 'v6 却还有 state.e0',
      expect: 'state-legacy-key',
      manifest: { format: 'od-real-exam', version: 2, items: [good] },
      io: mkIo({
        readJson: () => ({ ...program, slots: { ...program.slots, stateAt: 'const state = {}; state.e0 = { u: 1, v: 1 }; return state;', VIEW: 'SIM = { duration: 1, bodies: [{ id: "e0", at: function (s) { return [s.e0.u, s.e0.v]; } }] };' } }),
      }),
    },
    {
      name: 'bodies 引用了 stateAt 没给的 key',
      expect: 'body-key-missing',
      manifest: { format: 'od-real-exam', version: 2, items: [good] },
      io: mkIo({
        readJson: () => ({ ...program, slots: { ...program.slots, VIEW: 'SIM = { duration: 1, bodies: [{ id: "GHOST", at: function (s) { return [s.GHOST.u, s.GHOST.v]; } }] };' } }),
      }),
    },
  ];
  const missed = [];
  for (const c of cases) {
    const { errors } = auditManifest(c.manifest, c.io);
    if (!errors.some((e) => e.code === c.expect)) missed.push(`${c.name}：期望 ${c.expect}，实际 [${errors.map((e) => e.code).join(',') || '无错误'}]`);
  }
  return missed;
}

/* ────────────────────────── 加载 ────────────────────────── */

/**
 * 读一个套件。
 * @param {'regression-15'|'real-exam'|'all'} name
 * @param {string[]} filters 题目过滤器（前缀匹配 id）
 * @returns {Promise<{ suite: string, items: Array<object>, audit?: object }>}
 */
export async function loadSuite(name, filters = []) {
  const names = name === 'all' ? Object.keys(SUITES) : [name];
  const items = [];
  let audit = null;

  for (const s of names) {
    const def = SUITES[s];
    if (def.kind === 'module') {
      const files = readdirSync(def.dir)
        .filter((f) => f.endsWith('.mjs'))
        .sort()
        .filter((f) => !filters.length || filters.some((q) => f.startsWith(q) || f.includes(q)));
      for (const file of files) {
        const mod = await import(pathToFileURL(join(def.dir, file)).href);
        items.push({ suite: s, id: mod.default.id, entry: mod.default.id, file: `tests/regression-15/${file}`, program: mod.default });
      }
      continue;
    }

    const manifest = JSON.parse(readFileSync(join(def.dir, 'index.json'), 'utf8'));
    audit = auditManifest(manifest, defaultIo(def.dir));
    const picked = audit.runnable.filter((it) => !filters.length || filters.some((q) => it.id.startsWith(q)));
    for (const it of picked) {
      items.push({
        suite: s,
        id: it.id,
        entry: it.programData.id,
        file: `tests/real-exam/${it.program}`,
        program: it.programData,
        manifestItem: it,
      });
    }
  }
  return { suite: name, items, audit };
}
