/**
 * 世界书**仓库**：内置只读库 + `ai-rules/worldbook/` 用户区（§9.3 治理 / §16 规则工作区）。
 *
 * ── 两个抽屉（用户 2026-10 裁决：分开放）
 *
 *   `core/worldbook/data/`   —— **内置**词条（`origin: builtin`）。随程序走，升级会更新；
 *                               对用户是**只读**（可停用，编辑会生成 user 覆盖副本）。
 *   `ai-rules/worldbook/`    —— **用户**词条（`origin: user`）与覆盖副本。**升级绝不动它**。
 *
 *   分开放的三个好处（方案 §9.3 的硬要求）：重装不丢用户知识；"导出默认只导 user"一眼可分；
 *   "恢复默认只影响内置"不会误删用户的东西。
 *
 * ── 载入语义（§16：整批生效或整批失败）
 *
 *   `loadLibrary()` **不吞错**：任何一个文件不合法 ⇒ `ok:false` 且 `entries` 为空。
 *   半载入的库比报错危险得多（它会静默改变命中结果，而门禁看不到）。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { PROJECT_ROOT } from '../../tools/paths.mjs';
import { WORLDBOOK_INSERTION_SLOTS, WORLDBOOK_ENUMS, WORLDBOOK_CONCEPT_IDS, WORLDBOOK_TAG_NAMES, WORLDBOOK_ELEMENT_IDS, WORLDBOOK_TAG_OWNERS } from '../../contracts/spec/frozen-keys.mjs';
import { parseKey } from './engine.mjs';
import { BUILTIN_BUNDLE } from './builtin-bundle.generated.mjs';

/**
 * 是否走"打包形态"的内置层（**只影响发行产物，不影响本地开发**）。
 *
 * `OD_BUILTIN_BUNDLE=1` 由打包步骤设置 ⇒ 内置词条从**编译进代码的常量**读，
 * 产物里不带 `core/worldbook/data/*.json`，用户改不了也拷不走。
 * 本地开发不设它 ⇒ 照旧读磁盘文件，我们随时可编辑。
 */
export function useBuiltinBundle() {
  return process.env.OD_BUILTIN_BUNDLE === '1';
}

/** 打包形态下取编译进去的那份；开发形态返回 null（表示"请读磁盘"） */
export function readBuiltinBundle() {
  return useBuiltinBundle() ? BUILTIN_BUNDLE : null;
}

/** 内置词条目录（`origin: builtin`） */
export const BUILTIN_DIR = join(PROJECT_ROOT, 'core', 'worldbook', 'data');
/** 用户词条目录（`origin: user`）——§16 的规则工作区之一 */
export const USER_DIR = join(PROJECT_ROOT, 'ai-rules', 'worldbook');
/** 词条**源**目录（第 5.5 期 P1 改造：词条写在这里，由改写脚本校验后写出 `data/`） */
export const SOURCE_DIR = join(PROJECT_ROOT, 'core', 'worldbook', 'source');
/** 覆盖台账（第 9 期起**已退役**：文件不存在时 `readCoverageTarget()` 返回 null，覆盖率只报结构合规率） */
export const COVERAGE_TARGET_FILE = join(PROJECT_ROOT, 'core', 'worldbook', 'coverage-target.json');

/**
 * 读覆盖目标文件（**Node 侧 IO**）。
 *
 * ⚠ 解析出来的对象交给 `coverage.mjs` 的 `targetFromFile()` 变成覆盖率报告用的形状 ——
 *   这样 `coverage.mjs` 保持**纯函数**（与 `engine.mjs` 同一风格），IO 只住在本文件里。
 * @returns {object|null} 文件不存在时返回 null（第 5.5 期之前就是 null）
 */
export function readCoverageTarget(path = COVERAGE_TARGET_FILE) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`覆盖目标文件不是合法 JSON：${path} —— ${err?.message ?? err}`);
  }
}

/** §9.5 导出包的格式标识（与 `contracts/worldbook-pack.schema.json` 同源口径） */
export const PACK_FORMAT = 'od-worldbook';
export const PACK_VERSION = 1;

/**
 * §9.1 **冻结字段顺序**。用途有二：
 *   ① 规范化（canonicalize）时按它重建对象 ⇒ 同一语义的词条序列化结果逐字节稳定；
 *   ② 哈希可复现（`provenance.worldbookHash` 要烧进导出 HTML）。
 */
export const ENTRY_FIELD_ORDER = Object.freeze([
  'id',
  'title',
  'origin',
  'category',
  'enabled',
  'constant',
  'recursive',
  'keys',
  'secondary_keys',
  /* ── 第 5.7 期新增（§9.1 字段集变更，裁决见 README A26）──
   * 顺序放在 secondary_keys 之后、insertion_slot 之前：
   * 与「触发条件（keys / secondary_keys / concepts / tags / elements）→ 投递（insertion_slot）」的阅读顺序一致。 */
  'concepts',
  'tags',
  'elements',
  'insertion_slot',
  'order',
  'priority',
  'content',
  'code_examples',
]);

/** 可选字段的缺省值（§9.1 的 `default` 列）。规范化时**materialize**，让同语义同哈希 */
export const ENTRY_DEFAULTS = Object.freeze({
  constant: false,
  recursive: true,
  secondary_keys: Object.freeze({ logic: 'AND_ANY', list: Object.freeze([]) }),
  order: 100,
  priority: 'normal',
  code_examples: Object.freeze([]),
  /* ⚠ 三栏的缺省是**空数组**而不是 undefined：灰度期老词条没有这三栏，
   *   给它补一对空数组，`canonicalizeEntry` 的哈希才稳定（同语义 ⇒ 同哈希）。
   *   语义上"空 concepts + 空 tags + 空 elements" = 「该词条不走概念分发，只走 keys 字面」（计划 §2 决定 4）。 */
  concepts: Object.freeze([]),
  tags: Object.freeze([]),
  elements: Object.freeze([]),
});

/* ────────────────────────────── 校验（§9.1） ────────────────────────────── */

/**
 * 逐条按 §9.1 校验一个词条（不依赖 JSON Schema 库：字段少，手写更直白且诊断更具体）。
 *
 * @returns {string[]} 问题清单（空数组 = 合法）
 */
export function validateEntry(entry, where = '词条') {
  const p = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`${where} 不是对象`];
  }
  for (const key of Object.keys(entry)) {
    if (!ENTRY_FIELD_ORDER.includes(key)) p.push(`${where} 含未知字段 "${key}"（§9.1 的 additionalProperties 为 false）`);
  }
  const req = ['id', 'title', 'origin', 'category', 'enabled', 'keys', 'insertion_slot', 'content'];
  for (const key of req) {
    if (!(key in entry)) p.push(`${where} 缺少必填字段 "${key}"`);
  }
  if ('id' in entry && (typeof entry.id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(entry.id))) {
    p.push(`${where} 的 id 必须是 [A-Za-z0-9._-]+（实际：${JSON.stringify(entry.id)}）`);
  }
  if ('title' in entry && (typeof entry.title !== 'string' || entry.title.length === 0)) {
    p.push(`${where} 的 title 必须是非空字符串`);
  }
  if ('origin' in entry && !WORLDBOOK_ENUMS.origin.includes(entry.origin)) {
    p.push(`${where} 的 origin 必须是 ${WORLDBOOK_ENUMS.origin.join(' | ')}`);
  }
  if ('category' in entry && !WORLDBOOK_ENUMS.category.includes(entry.category)) {
    p.push(`${where} 的 category 必须是 ${WORLDBOOK_ENUMS.category.join(' | ')}`);
  }
  if ('enabled' in entry && typeof entry.enabled !== 'boolean') p.push(`${where} 的 enabled 必须是布尔`);
  if ('constant' in entry && typeof entry.constant !== 'boolean') p.push(`${where} 的 constant 必须是布尔`);
  if ('recursive' in entry && typeof entry.recursive !== 'boolean') p.push(`${where} 的 recursive 必须是布尔`);
  if ('order' in entry && !Number.isInteger(entry.order)) p.push(`${where} 的 order 必须是整数`);
  if ('priority' in entry && !WORLDBOOK_ENUMS.priority.includes(entry.priority)) {
    p.push(`${where} 的 priority 必须是 ${WORLDBOOK_ENUMS.priority.join(' | ')}`);
  }
  if ('content' in entry && (typeof entry.content !== 'string' || entry.content.length === 0)) {
    p.push(`${where} 的 content 必须是非空字符串`);
  }
  if ('keys' in entry) {
    if (!Array.isArray(entry.keys)) p.push(`${where} 的 keys 必须是数组`);
    else {
      for (const k of entry.keys) {
        if (typeof k !== 'string' || k.length === 0) p.push(`${where} 的 keys 含非字符串或空串`);
        else {
          const parsed = parseKey(k);
          // §9.1："正则非法须在保存时拒绝"
          if (parsed.kind === 'regex' && parsed.error) p.push(`${where} 的主键正则非法：${k} —— ${parsed.error}`);
        }
      }
    }
  }
  if ('secondary_keys' in entry) {
    const sk = entry.secondary_keys;
    if (!sk || typeof sk !== 'object' || Array.isArray(sk)) p.push(`${where} 的 secondary_keys 必须是对象`);
    else {
      if (!WORLDBOOK_ENUMS.secondaryLogic.includes(sk.logic)) {
        p.push(`${where} 的 secondary_keys.logic 必须是 ${WORLDBOOK_ENUMS.secondaryLogic.join(' | ')}`);
      }
      if (!Array.isArray(sk.list)) p.push(`${where} 的 secondary_keys.list 必须是数组`);
      else {
        for (const k of sk.list) {
          if (typeof k !== 'string' || k.length === 0) p.push(`${where} 的 secondary_keys.list 含非字符串或空串`);
          else {
            const parsed = parseKey(k);
            if (parsed.kind === 'regex' && parsed.error) p.push(`${where} 的次级键正则非法：${k} —— ${parsed.error}`);
          }
        }
      }
      if (Object.keys(sk).some((k) => !['logic', 'list'].includes(k))) {
        p.push(`${where} 的 secondary_keys 含未知字段（只能是 logic / list）`);
      }
    }
  }
  if ('insertion_slot' in entry) {
    if (!Array.isArray(entry.insertion_slot)) p.push(`${where} 的 insertion_slot 必须是数组`);
    else {
      for (const s of entry.insertion_slot) {
        if (!WORLDBOOK_INSERTION_SLOTS.includes(s)) {
          p.push(`${where} 的 insertion_slot 含非法槽位名 "${s}"（只能是 ${WORLDBOOK_INSERTION_SLOTS.join(' | ')}；v2 旧名 scene_spec 只在导入路径归一化）`);
        }
      }
      if (new Set(entry.insertion_slot).size !== entry.insertion_slot.length) {
        p.push(`${where} 的 insertion_slot 有重复项（schema 要求 uniqueItems）`);
      }
    }
  }

  /* ───────────── 第 5.7 期：三栏 + 两条**跨字段**约束（§9.1 字段集变更，裁决 A26） ─────────────
   *
   * ⚠ 为什么这两条必须放运行期而不是 Schema：JSON Schema 表达不了
   *   "tags 的每一项必须属于该词条**自己**的某个 concepts"——那是**同一条记录内部**的关系，
   *   而枚举只能约束"取值合法"。所以这里逐条判，并把**为什么非法**说清楚（谁能改、改成什么）。
   *
   * 三条口径（计划 §2 决定 4 / 决定 5）：
   *   ① 三栏都是**可选**的：缺省 = 空数组 = 该词条不走概念分发（灰度期老词条就靠 keys 工作）；
   *   ② `tags` 非空时，每个 tag 必须属于本词条某个 `concepts`（否则"按考点+标签查词条"永远查不到它）；
   *   ③ `elements` 是**动画侧**触发源，与 concepts/tags 之间**没有**从属关系（不要求交集）——
   *      理由见计划 §3 框图：动画侧是"元件命中 + 用考点**收窄**"，收窄是引擎的活，不是校验的活。
   */
  const conceptList = Array.isArray(entry.concepts) ? entry.concepts : [];
  const tagList = Array.isArray(entry.tags) ? entry.tags : [];
  const elementList = Array.isArray(entry.elements) ? entry.elements : [];

  for (const [field, list, allowed, label] of [
    ['concepts', conceptList, WORLDBOOK_CONCEPT_IDS, '考点词表（词表 A）'],
    ['tags', tagList, WORLDBOOK_TAG_NAMES, '题型标签 / 细考点词表（词表 B）'],
    ['elements', elementList, WORLDBOOK_ELEMENT_IDS, '动画元件词表'],
  ]) {
    if (!(field in entry)) continue;
    if (!Array.isArray(entry[field])) {
      p.push(`${where} 的 ${field} 必须是数组`);
      continue;
    }
    const allowedSet = new Set(allowed);
    for (const v of entry[field]) {
      if (typeof v !== 'string' || v.length === 0) p.push(`${where} 的 ${field} 含非字符串或空串`);
      else if (!allowedSet.has(v)) {
        p.push(
          `${where} 的 ${field} 含表外值 ${JSON.stringify(v)} —— ${label}里没有它。` +
            `要么改成表里的正式名，要么先把它加进 contracts/worldbook-concepts.json（枚举与 Prompt 都从那里派生）`,
        );
      }
    }
    if (new Set(entry[field]).size !== entry[field].length) {
      p.push(`${where} 的 ${field} 有重复项（schema 要求 uniqueItems）`);
    }
  }

  // ② tags 必须属于本词条某个 concepts
  if (tagList.length) {
    if (!conceptList.length) {
      p.push(
        `${where} 填了 tags 却没填 concepts：tags 是**按考点分组**的二级键，` +
          `没有考点就无法判断它属于谁（要么补 concepts，要么把 tags 清空 —— 清空表示"该考点下的通用词条"）`,
      );
    } else {
      for (const t of tagList) {
        if (typeof t !== 'string' || !t) continue; // 上面已经单独报过
        const owners = WORLDBOOK_TAG_OWNERS[t];
        if (!owners || !owners.length) continue; // 表外值已报过；这里只判归属
        if (!owners.some((c) => conceptList.includes(c))) {
          p.push(
            `${where} 的 tag ${JSON.stringify(t)} 不属于它的任何考点（该 tag 属于 ${owners.join(' / ')}，` +
              `而本条填的 concepts 是 ${conceptList.join(' / ')}）`,
          );
        }
      }
    }
  }

  if ('code_examples' in entry) {
    if (!Array.isArray(entry.code_examples)) p.push(`${where} 的 code_examples 必须是数组`);
    else if (entry.code_examples.some((c) => typeof c !== 'string' || c.length === 0)) {
      p.push(`${where} 的 code_examples 含非字符串或空串`);
    }
  }
  return p;
}

/** 校验一个导出包（§9.5 / `contracts/worldbook-pack.schema.json`） */
export function validatePack(raw) {
  const problems = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problems: ['导出包不是对象'], entries: [] };
  if (raw.format !== PACK_FORMAT) problems.push(`导出包 format 必须是 "${PACK_FORMAT}"（实际：${JSON.stringify(raw.format)}）`);
  if (raw.version !== PACK_VERSION) {
    problems.push(`导出包 version ${JSON.stringify(raw.version)} 不受支持（本版只支持 ${PACK_VERSION}，不支持版本明确拒绝）`);
  }
  if (!Array.isArray(raw.entries)) problems.push('导出包的 entries 必须是数组');
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  entries.forEach((e, i) => problems.push(...validateEntry(e, `entries[${i}]`)));
  return { problems, entries };
}

/* ────────────────────────────── 规范化与哈希 ────────────────────────────── */

/** 按 §9.1 冻结字段顺序重建一个词条，并把可选字段的缺省值**填实**（同语义 ⇒ 同哈希） */
export function canonicalizeEntry(entry) {
  const out = {};
  for (const key of ENTRY_FIELD_ORDER) {
    if (key in entry) out[key] = entry[key];
    else if (key in ENTRY_DEFAULTS) out[key] = ENTRY_DEFAULTS[key];
  }
  if (out.secondary_keys && typeof out.secondary_keys === 'object') {
    out.secondary_keys = { logic: out.secondary_keys.logic ?? 'AND_ANY', list: [...(out.secondary_keys.list ?? [])] };
  } else {
    out.secondary_keys = { logic: 'AND_ANY', list: [] };
  }
  out.keys = [...(out.keys ?? [])];
  out.insertion_slot = [...(out.insertion_slot ?? [])];
  out.code_examples = [...(out.code_examples ?? [])];
  // 第 5.7 期三栏：同语义 ⇒ 同哈希（去重但**保持原序**，顺序也是作者意图的一部分）
  for (const field of ['concepts', 'tags', 'elements']) {
    out[field] = [...new Set(Array.isArray(out[field]) ? out[field] : [])];
  }
  return out;
}

/** 稳定序列化（字段顺序固定、数组保持原序、不加缩进） */
export function canonicalJson(value) {
  return JSON.stringify(value);
}

/** 词条集合的**稳定哈希**（`provenance.worldbookHash` 用它；不含 enabled:false 的词条） */
export function worldbookHashOf(entries) {
  const canon = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && e.enabled !== false)
    .map(canonicalizeEntry)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return createHash('sha256').update(canonicalJson(canon), 'utf8').digest('hex');
}

/* ────────────────────────────── 读盘 ────────────────────────────── */

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 解析一个词条文件：**允许两种形态**
 *   ① 单条词条（对象，含 `id`）
 *   ② 导出包（`{format:"od-worldbook", version:1, entries:[…]}`）
 *
 * 后者是刻意的：内置库自己就用导出包格式，等于让"导入路径"每天被跑一次
 * （否则那条路径只在上线那天才知道自己坏了）。
 */
export function parseEntryFile(text, file) {
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { entries: [], problems: [`${file} 不是合法 JSON：${err?.message ?? err}`] };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'format' in raw) {
    const v = validatePack(raw);
    return { entries: v.entries, problems: v.problems.map((m) => `[${file}] ${m}`) };
  }
  const list = Array.isArray(raw) ? raw : [raw];
  list.forEach((e, i) => problems.push(...validateEntry(e, `[${file}] 第 ${i + 1} 条`)));
  return { entries: list, problems };
}

/**
 * 载入整个词条库（内置 + 用户），按"用户同 id 覆盖内置"合并。
 *
 * @param {{ builtinDir?: string, userDir?: string }} [opts]
 * @returns {{
 *   ok: boolean, entries: object[], builtin: object[], user: object[],
 *   overriddenIds: string[], sources: Array<{file: string, kind: string, count: number, sha256: string}>,
 *   problems: string[], userDirExists: boolean, hash: string,
 * }}
 */
export function loadLibrary(opts = {}) {
  // 第 8 期：内置层的目录可以被环境变量改（打包产物与自检用）。
  const builtinDir = opts.builtinDir ?? process.env.OD_BUILTIN_DIR ?? BUILTIN_DIR;
  const userDir = opts.userDir ?? USER_DIR;
  const problems = [];
  const sources = [];
  const builtin = [];
  const user = [];

  const readDir = (dir, kind) => {
    const acc = [];

    /** 把"一份词条文件文本"吃进库里（磁盘与"编译进去的常量"走同一条解析路径） */
    const consume = (name, file, text) => {
      const parsed = parseEntryFile(text, `${kind}:${name}`);
      problems.push(...parsed.problems);
      sources.push({ file, kind, name, count: parsed.entries.length, sha256: sha256Text(text) });
      for (const e of parsed.entries) acc.push({ ...e, origin: kind === 'builtin' ? 'builtin' : (e.origin ?? 'user') });
    };

    /**
     * ── 第 8 期：**内置层在打包产物里封死**（用户 2026-10-17 裁决）──
     *
     * 口径（很重要）：**只封打包产物，不封本地源码**。
     *   · 本地开发（默认）：照旧读 `core/worldbook/data/*.json` —— 可编辑、可迭代；
     *   · 打包运行（`OD_BUILTIN_BUNDLE=1`）：读**编译进代码的常量**，
     *     产物里不带这些 JSON 文件，用户改不了、也拷不走。
     *
     * 为什么不是"把文件删了"：我们自己的开发流程就靠改这些文件。
     * 所以封的是**发行形态**，不是**源码形态**。
     */
    if (kind === 'builtin') {
      const bundle = readBuiltinBundle();
      if (bundle) {
        for (const f of bundle.files ?? []) consume(f.name, `<builtin:${f.name}>`, f.text);
        return acc;
      }
    }

    if (!existsSync(dir)) {
      if (kind === 'builtin') problems.push(`内置词条目录不存在：${dir}`);
      return [];
    }
    const files = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .sort();
    for (const f of files) {
      const abs = join(dir, f);
      consume(basename(abs), abs, readFileSync(abs, 'utf8'));
    }
    return acc;
  };

  builtin.push(...readDir(builtinDir, 'builtin'));
  const userDirExists = existsSync(userDir);
  user.push(...readDir(userDir, 'user'));

  // 同名 id：库内不得重复（§9.1）。内置之间/用户之间重复 ⇒ 整批失败。
  const dupIn = (list, label) => {
    const seen = new Map();
    for (const e of list) {
      const n = (seen.get(e.id) ?? 0) + 1;
      seen.set(e.id, n);
      if (n === 2) problems.push(`${label}内 id 重复：${e.id}（库内 id 必须唯一）`);
    }
  };
  dupIn(builtin, '内置库');
  dupIn(user, '用户库');

  const overriddenIds = user.map((u) => u.id).filter((id) => builtin.some((b) => b.id === id)).sort();
  const builtinById = new Map(builtin.map((b) => [b.id, b]));
  for (const id of overriddenIds) builtinById.delete(id);
  const entries = [...builtinById.values(), ...user].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const ok = problems.length === 0;
  return {
    ok,
    entries: ok ? entries : [],
    builtin,
    user,
    overriddenIds,
    sources,
    problems,
    userDirExists,
    hash: worldbookHashOf(entries),
  };
}

/* ────────────────────────────── 写盘（原子） ────────────────────────────── */

/**
 * 原子写文件：先写 `*.tmp` 再 `rename`。
 *
 * ⚠ 为什么不用 `writeFileSync` 直接覆盖：写到一半断电/被杀，`ai-rules/` 里就留下一个
 *   半截 JSON，而 `loadLibrary()` 的"整批失败"会让**整个库**载入不了 ——
 *   一次失败的保存毁掉全部词条。`rename` 在同一卷上是原子的。
 */
export function writeFileAtomic(absPath, text) {
  mkdirSync(join(absPath, '..'), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, absPath);
  return absPath;
}

/** 把一组**用户**词条写成 `ai-rules/worldbook/` 下的一个导出包文件 */
export function writeUserPack(dir, fileName, entries) {
  const all = entries.map((e) => {
    const c = canonicalizeEntry(e);
    c.origin = 'user';
    return c;
  });
  const problems = all.flatMap((e, i) => validateEntry(e, `user[${i}]`));
  if (problems.length) {
    const err = new Error(`用户词条不合法，已拒绝写入（整批失败）：\n- ${problems.join('\n- ')}`);
    err.problems = problems;
    throw err;
  }
  // ⚠ 包内**只允许** format / version / entries（契约的 additionalProperties 为 false）。
  //   别顺手加 note/timestamp —— 那会让写出的文件立刻不合契约，
  //   而"整批失败"的载入逻辑会让它连自己都读不回来。
  const pack = {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    entries: all,
  };
  return writeFileAtomic(join(dir, fileName), `${JSON.stringify(pack, null, 2)}\n`);
}

/** 删除一个用户文件（"恢复默认"= 删掉覆盖副本，内置原样生效） */
export function removeUserFile(dir, fileName) {
  const abs = join(dir, fileName);
  if (!existsSync(abs)) return { removed: false, path: abs };
  unlinkSync(abs);
  return { removed: true, path: abs };
}

/** 列出用户目录里的文件（含大小，供 UI 与体积限制检查） */
export function listUserFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .sort()
    .map((f) => ({ name: f, path: join(dir, f), bytes: statSync(join(dir, f)).size }));
}
