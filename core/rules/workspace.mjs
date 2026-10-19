/**
 * 规则工作区（§16 · 第 6 期第 1 项）：`ai-rules/` 的**原子载入 / 哈希校验 / 整批生效 / 热重载快照**。
 *
 * ── 它到底解决什么问题（说人话）
 *
 * 第 6 期要让用户能改 Prompt、改清洗规则。一旦规则变成**磁盘上的文件**，就冒出三个危险：
 *   ① 文件被改坏了（少了括号、非法正则）⇒ 必须**载入被拒并指出具体位置**，而不是"能用一半"；
 *   ② 文件被界面以外的力量改了（别的编辑器、别的软件、另一个窗口）⇒ 界面里的旧草稿不能悄悄盖掉它；
 *   ③ 规则在题目跑到一半时被改了 ⇒ **正在跑的题必须继续用旧规则**，新规则只对下一题生效。
 *
 * 本模块把这三件事做成**结构性的**（不是靠调用方自觉）：
 *   · 每个文件记 SHA256，写进 `.workspace.json`；载入时逐个比对，对不上就整批拒绝；
 *   · 保存走 `commitRulesChange()`：**先全部校验、再写临时文件、再改名**，中途失败回滚；
 *     `expectedHashes` 是乐观锁 —— 磁盘上的版本不是它以为的那版时**拒绝保存**（用户裁决）；
 *   · 载入结果是**深度冻结的快照**；`createRulesRuntime()` 把快照钉在某道题上，
 *     热重载只换"下一题该用哪份"，**不动已钉住的**。
 *
 * ── 三条"宁可红"的口径（都是用户 2026-10 裁决的）
 *
 *   1. **未登记的文件 ⇒ 拒绝载入**并点名。代价是手动丢文件进去要再点一次"登记"；
 *      换来的是"任何绕过界面的改动都逃不过检查"。
 *   2. **哈希对不上 ⇒ 拒绝**（这条是 §16 原文："载入校验哈希、拒绝冲突"）。
 *   3. **整批失败**：任何一个文件有问题，`ok:false` 且**一个字节都不返回**。
 *      半载入的规则比报错危险得多 —— 它会静默改变 Prompt，而所有门禁都看不出来。
 *
 * ── 载入失败时**不清空**上一份好快照（明确记录这条政策）
 *
 * `reload()` 失败时保留 `current`（上一份已验证的规则），只把 `problems` 交出去。
 * 理由：一次手抖（保存到一半的临时状态、编辑器写坏一个引号）不应该让"下一题"用**空规则**跑 ——
 * 空规则会让模型失去全部指令，产出比"用旧规则"差得多，而且**看不出来是规则丢了**。
 * 但 `problems` 必须被 UI 显式展示（没展示就等于静默降级，这一点在自检里钉住）。
 *
 * ── 关于多文件"原子"
 *
 * 单文件写入是原子的（先写 `*.tmp-<pid>` 再 `rename`，同一卷上 rename 是原子的）。
 * **多文件**做不到真正的一个事务（普通文件系统没有这能力），这里的做法是：
 *   **全部先写临时文件 → 全部校验通过 → 逐个 rename → 最后写索引**，rename 阶段失败则按内存里的旧内容回滚。
 * 回滚是**尽力而为**（进程在中途被强杀就回滚不了），因此：
 *   · 索引是**提交点**：索引没写成功 ⇒ 下次载入会因为哈希对不上而**拒绝**（而不是半套生效）；
 *   · 并发读可能撞到"索引还是旧的、文件已是新的"这一瞬间 ⇒ 载入失败（fail closed），重试一次即可。
 * 这两点都不完美，但都朝**安全的方向**失败，且没有"看起来成功、其实半套"的中间态。
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { PROJECT_ROOT } from '../../tools/paths.mjs';
import { backupFile } from './backup.mjs';
import { classifyRelPath, describeJsonError, validateRuleFileContent, CLEANING_FILE, PROMPTS_DIR } from './kinds.mjs';

/* ────────────────────────────── 常量（§16） ────────────────────────────── */

/** 规则工作区根目录（用户区，升级不动它） */
export const RULES_ROOT = join(PROJECT_ROOT, 'ai-rules');
/** 工作区索引：记 base revision + 每个文件的 SHA256 */
export const WORKSPACE_FILE = '.workspace.json';
export const WORKSPACE_FORMAT = 'od-rules-workspace';
export const WORKSPACE_VERSION = 1;

/** §16：单文件 ≤800 KB */
export const MAX_FILE_BYTES = 800 * 1024;
/** §16：全部 ≤16 MB */
export const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

export const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: MAX_FILE_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
});

const err = (code, path, message, hint) => ({ code, path, message, ...(hint ? { hint } : {}) });

/**
 * 索引里允许保存的"基线正文"上限（第 6 期第 2 项）。
 * 只用于"内置变了"时把新旧两版**并排给人看**；超长就不存，只留 sha256（照样能报"变了"）。
 */
export const MAX_BASED_ON_TEXT = 64 * 1024;

/**
 * 索引条目的**唯一构造点**：键序固定，序列化才逐字节稳定。
 *
 * @param {string} sha256
 * @param {number} bytes
 * @param {{ sha256: string, text?: string, savedAt?: string } | null} [basedOn]
 */
function makeEntry(sha256, bytes, basedOn = null) {
  const e = { sha256, bytes };
  if (basedOn) {
    e.basedOn = { sha256: basedOn.sha256 };
    if (typeof basedOn.text === 'string') e.basedOn.text = basedOn.text;
    if (typeof basedOn.savedAt === 'string') e.basedOn.savedAt = basedOn.savedAt;
  }
  return e;
}

/* ────────────────────────────── 小工具 ────────────────────────────── */

/** Windows 的 `\` 统一成 `/`：索引里的键、报错里的路径都必须是同一种写法，否则哈希比对会"看起来失败" */
export function toPosixRel(rel) {
  return String(rel).split('\\').join('/');
}

/**
 * SHA256（十六进制）。
 *
 * ⚠ 直接对**字节**求哈希，不先转字符串：UTF-8 解码对非法字节序列是**有损**的，
 *   先解码再哈希会让两个不同的坏文件算出同一个值。
 */
export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

/** 深冻结：快照一旦交出去就改不动（否则一道题改了规则，别的题也跟着变） */
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** 临时文件名里带 `.tmp-`：`listDiskFiles()` 会跳过它们，不会被误报成"未登记" */
function tmpPathOf(abs) {
  return `${abs}.tmp-${process.pid}`;
}

/**
 * 原子写一个文本文件：先写 `*.tmp-<pid>` 再 `rename`。
 *
 * 为什么所有用户可写的配置文件都走它：写到一半断电/被杀会留下半截文件，
 * 而"整批失败"的载入会让**整份配置**用不了 —— 一次失败的保存毁掉全部设置。
 * `rename` 在同一卷上是原子的。
 *
 * 第 6 期第 4 项起对外导出：端点配置（`core/gateway/endpoint-store.mjs`）也用它，
 * 免得每个子系统各写一份"临时文件 + rename"。
 *
 * @param {string} absPath
 * @param {string} text
 * @returns {string} 写入的绝对路径
 */
export function writeFileAtomic(absPath, text) {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = tmpPathOf(absPath);
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, absPath);
  return absPath;
}

/* ────────────────────────────── 索引（.workspace.json） ────────────────────────────── */

/**
 * 读并校验索引本身。
 *
 * @param {string} dir
 * @returns {{ ok: boolean, index: object|null, problems: object[] }}
 */
export function readRulesIndex(dir = RULES_ROOT) {
  const abs = join(dir, WORKSPACE_FILE);
  if (!existsSync(abs)) {
    return {
      ok: false,
      index: null,
      problems: [
        err(
          'rules.no-index',
          WORKSPACE_FILE,
          '没有工作区索引，规则工作区还没建立',
          '运行 `node core/rules/cli.mjs init`（或从设置页点「建立规则工作区」）',
        ),
      ],
    };
  }

  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (e) {
    return {
      ok: false,
      index: null,
      problems: [err('rules.index.unreadable', WORKSPACE_FILE, `读不到索引：${e.message}`)],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const d = describeJsonError(text, e);
    return {
      ok: false,
      index: null,
      problems: [
        err(
          'rules.index.bad-json',
          WORKSPACE_FILE,
          d.message,
          `${d.hint ? `${d.hint}；` : ''}也可以删掉它，再用 core/rules/cli.mjs init 重建（重建后所有文件都要重新登记，这是有意的：宁可多点一次，也不要猜）`,
        ),
      ],
    };
  }

  const problems = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    problems.push(err('rules.index.not-object', WORKSPACE_FILE, '索引必须是一个 JSON 对象'));
    return { ok: false, index: null, problems };
  }
  if (parsed.format !== WORKSPACE_FORMAT) {
    problems.push(
      err('rules.index.bad-format', `${WORKSPACE_FILE}:format`, `format 必须是 "${WORKSPACE_FORMAT}"，当前 ${JSON.stringify(parsed.format)}`),
    );
  }
  if (parsed.version !== WORKSPACE_VERSION) {
    problems.push(
      err(
        'rules.index.bad-version',
        `${WORKSPACE_FILE}:version`,
        `不支持的工作区版本 ${JSON.stringify(parsed.version)}`,
        `本版只支持 version = ${WORKSPACE_VERSION}；更高版本请升级程序，不要手改`,
      ),
    );
  }
  if (!Number.isInteger(parsed.baseRevision) || parsed.baseRevision < 0) {
    problems.push(err('rules.index.bad-revision', `${WORKSPACE_FILE}:baseRevision`, 'baseRevision 必须是非负整数'));
  }
  if (!parsed.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) {
    problems.push(err('rules.index.bad-files', `${WORKSPACE_FILE}:files`, 'files 必须是一个对象（相对路径 → { sha256, bytes }）'));
    return { ok: false, index: null, problems };
  }

  for (const [rel, entry] of Object.entries(parsed.files)) {
    if (!classifyRelPath(rel)) {
      problems.push(
        err(
          'rules.index.bad-path',
          `${WORKSPACE_FILE}:files.${rel}`,
          '索引里登记了一个工作区不管理的路径',
          '只认 prompts/<小写 id>.md 与 cleaning.json',
        ),
      );
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(err('rules.index.bad-entry', `${WORKSPACE_FILE}:files.${rel}`, '条目必须是 { sha256, bytes }'));
      continue;
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      problems.push(err('rules.index.bad-hash', `${WORKSPACE_FILE}:files.${rel}.sha256`, 'sha256 必须是 64 位小写十六进制'));
    }
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0) {
      problems.push(err('rules.index.bad-bytes', `${WORKSPACE_FILE}:files.${rel}.bytes`, 'bytes 必须是非负整数'));
    }
    // basedOn：第 6 期第 2 项 —— 这份覆盖副本是基于**哪一版内置**改的（用户裁决 C 方案）
    if ('basedOn' in entry) {
      const b = entry.basedOn;
      if (!b || typeof b !== 'object' || Array.isArray(b)) {
        problems.push(err('rules.index.bad-basedOn', `${WORKSPACE_FILE}:files.${rel}.basedOn`, 'basedOn 必须是对象或删掉'));
      } else {
        if (typeof b.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(b.sha256)) {
          problems.push(err('rules.index.bad-basedOn', `${WORKSPACE_FILE}:files.${rel}.basedOn.sha256`, 'basedOn.sha256 必须是 64 位小写十六进制'));
        }
        if (b.text !== undefined && typeof b.text !== 'string') {
          problems.push(err('rules.index.bad-basedOn', `${WORKSPACE_FILE}:files.${rel}.basedOn.text`, 'basedOn.text 必须是字符串'));
        }
        if (typeof b.text === 'string' && b.text.length > MAX_BASED_ON_TEXT) {
          problems.push(
            err(
              'rules.index.bad-basedOn',
              `${WORKSPACE_FILE}:files.${rel}.basedOn.text`,
              `basedOn.text 超过 ${MAX_BASED_ON_TEXT} 字符`,
              '基线正文只用于"内置变了"时比对差异，超过这个长度就不存了（只留 sha256）',
            ),
          );
        }
      }
    }
  }

  if (problems.length) return { ok: false, index: null, problems };
  return { ok: true, index: parsed, problems: [] };
}

/** 写索引（原子写：临时文件 + rename） */
function writeRulesIndex(dir, files, baseRevision) {
  const payload = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    baseRevision,
    // 键排序：同一个工作区序列化两次必须逐字节一致（否则 revision 会成为噪音源）
    files: Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]])),
  };
  const abs = join(dir, WORKSPACE_FILE);
  const tmp = tmpPathOf(abs);
  mkdirSync(dir, { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  renameSync(tmp, abs);
  return abs;
}

/* ────────────────────────────── 扫描磁盘 ────────────────────────────── */

/**
 * 列出工作区里**真实存在**的、**归本工作区管**的文件。
 *
 * ⚠ 只扫 `prompts/` 与 `cleaning.json` 两处，**不扫整个 `ai-rules/`**：
 *   `ai-rules/knowledgecard/` 归世界书仓库（`core/knowledgecard/store.mjs`），`ai-rules/endpoints.json` 归网关，
 *   它们各有自己的判据。要是这里也扫，就会把别人的文件报成"未登记"，
 *   逼用户去"登记"一堆不归我们管的东西 —— 那正是"两套判据打架"的开端。
 *
 * 跳过的东西：`.` 开头的（编辑器备份、系统垃圾）、名字里带 `.tmp-` 的（本模块自己的临时文件）。
 *
 * @param {string} dir
 * @returns {Array<{ rel: string, abs: string, bytes: number }>} 按 rel 排序
 */
export function listDiskFiles(dir = RULES_ROOT) {
  /** @type {Array<{ rel: string, abs: string, bytes: number }>} */
  const out = [];

  const walk = (absDir, relDir) => {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.name.includes('.tmp-')) continue;
      const abs = join(absDir, e.name);
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        // prompts/ 下面的子目录不是合法落点（`prompts/<id>.md` 必须是一层），
        // 但仍然列出来 —— 让工作区报"未登记/不认识"，而不是静默忽略。
        walk(abs, rel);
        continue;
      }
      out.push({ rel, abs, bytes: statSync(abs).size });
    }
  };

  const promptsDir = join(dir, PROMPTS_DIR);
  if (existsSync(promptsDir)) walk(promptsDir, PROMPTS_DIR);

  const cleaningAbs = join(dir, CLEANING_FILE);
  if (existsSync(cleaningAbs)) {
    try {
      if (statSync(cleaningAbs).isFile()) {
        out.push({ rel: CLEANING_FILE, abs: cleaningAbs, bytes: statSync(cleaningAbs).size });
      }
    } catch {
      /* 读不到就不列：下一步的"读文件"会给出具体错误 */
    }
  }

  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/* ────────────────────────────── 载入（整批生效或整批失败） ────────────────────────────── */

/**
 * 载入规则工作区。
 *
 * @param {{ dir?: string, limits?: { maxFileBytes: number, maxTotalBytes: number } }} [opts]
 * @returns {{
 *   ok: boolean,
 *   revision: number|null,
 *   problems: object[],
 *   files: Record<string, { sha256: string, bytes: number }>,
 *   prompts: Record<string, { rel: string, text: string, sha256: string }>,
 *   cleaning: object|null,
 *   snapshot: object|null,
 * }}
 */
export function loadRulesWorkspace({ dir = RULES_ROOT, limits = DEFAULT_LIMITS } = {}) {
  const empty = { files: {}, prompts: {}, cleaning: null, snapshot: null };
  const problems = [];

  const idx = readRulesIndex(dir);
  if (!idx.ok) return { ok: false, revision: null, problems: idx.problems, ...empty };
  const index = idx.index;

  const disk = listDiskFiles(dir);
  const diskByRel = new Map(disk.map((d) => [d.rel, d]));

  // ① 未登记（用户裁决：拒绝，并点名）
  for (const d of disk) {
    if (!(d.rel in index.files)) {
      // 名字不认识（大写扩展名、多一层目录、.bak…）与"名字合法但没登记"要说不同的话：
      // 前者去"登记"也登记不上（adopt 会拒绝），直接告诉用户该改名字。
      const known = classifyRelPath(d.rel) !== null;
      problems.push(
        known
          ? err(
              'rules.untracked',
              d.rel,
              '这个文件在磁盘上，但不在工作区索引里（没登记过）',
              '要么点「登记」（`node core/rules/cli.mjs adopt`）把它收下，要么删掉它；工作区不会自动收下外部改动',
            )
          : err(
              'rules.untracked',
              d.rel,
              '工作区不认识这个文件名（只认 prompts/<小写id>.md 与 cleaning.json）',
              '改个名字或删掉它。注意扩展名必须是小写 .md、prompts/ 下面不能再套目录、也不能留 .bak',
            ),
      );
    }
  }

  // ② 索引里有、盘上没有
  for (const rel of Object.keys(index.files)) {
    if (!diskByRel.has(rel)) {
      problems.push(
        err('rules.missing', rel, '索引里登记了这个文件，但磁盘上找不到它', '如果你是有意删掉它，请用「恢复默认 / 删除」让它从索引里退出去'),
      );
    }
  }

  // ③ 总体积（§16 全部 ≤16 MB）
  const totalBytes = disk.reduce((n, d) => n + d.bytes, 0);
  if (totalBytes > limits.maxTotalBytes) {
    problems.push(
      err(
        'rules.total-too-large',
        '.',
        `规则工作区共 ${totalBytes} 字节，超过上限 ${limits.maxTotalBytes}`,
        '请删掉或精简文件（Prompt 正文通常几 KB，几百 KB 的文件基本是误存）',
      ),
    );
  }

  const files = {};
  const prompts = {};
  let cleaning = null;

  for (const d of disk) {
    const entry = index.files[d.rel];

    // ④ 单文件体积（§16 ≤800 KB）
    if (d.bytes > limits.maxFileBytes) {
      problems.push(
        err(
          'rules.file-too-large',
          d.rel,
          `文件 ${d.bytes} 字节，超过单文件上限 ${limits.maxFileBytes}`,
          'Prompt 正文几乎不可能这么大；如果你是想放资料，请放到别的目录',
        ),
      );
      continue;
    }

    const buf = readFileSync(d.abs);
    const hash = sha256Hex(buf);

    // ⑤ 哈希（§16 原文："载入校验哈希、拒绝冲突"）—— 对不上就**不继续校验内容**，
    //    否则用户会同时看到"哈希不符"和"JSON 语法错误"两条，反而不知道该先修哪个。
    if (!entry) continue; // 未登记，已在 ① 报过
    if (hash !== entry.sha256) {
      problems.push(
        err(
          'rules.hash-mismatch',
          d.rel,
          `文件已被外部修改：索引记的是 ${entry.sha256.slice(0, 12)}…，磁盘上是 ${hash.slice(0, 12)}…`,
          '点「重新载入」看到新内容后再改；若确认要收下这次外部改动，点「登记这次改动」（`adopt --force`）',
        ),
      );
      continue;
    }
    if (entry.bytes !== d.bytes) {
      problems.push(
        err(
          'rules.index.bytes-mismatch',
          d.rel,
          `索引记的体积 ${entry.bytes} 与磁盘 ${d.bytes} 不一致（哈希却是对的）`,
          '索引被手改过；重新登记一次即可修好',
        ),
      );
      continue;
    }

    const text = buf.toString('utf8');

    // ⑥ 内容（类型 + 该类型该有的样子）
    const contentIssues = validateRuleFileContent(d.rel, text);
    if (contentIssues.length) {
      problems.push(...contentIssues);
      continue;
    }

    files[d.rel] = { sha256: hash, bytes: d.bytes };

    const kind = classifyRelPath(d.rel);
    if (kind.kind === 'prompt') {
      prompts[kind.id] = { rel: d.rel, text, sha256: hash };
    } else {
      cleaning = JSON.parse(text);
    }
  }

  const ok = problems.length === 0;
  if (!ok) {
    // 整批失败：**一个字节都不返回**（半套规则比没有规则更难查）
    return { ok: false, revision: index.baseRevision, problems, files: {}, prompts: {}, cleaning: null, snapshot: null };
  }

  const snapshot = deepFreeze({
    revision: index.baseRevision,
    // 只放"已校验通过"的东西：快照里不存在"可能是坏的"条目
    files,
    prompts,
    cleaning,
    promptTexts: Object.fromEntries(Object.entries(prompts).map(([id, p]) => [id, p.text])),
    cleaningRules: cleaning ? cleaning.rules : [],
    loadedAt: new Date().toISOString(),
  });

  return { ok: true, revision: index.baseRevision, problems: [], files, prompts, cleaning, snapshot };
}

/* ────────────────────────────── 保存（先校验，后写盘，可回滚） ────────────────────────────── */

/**
 * 提交一批改动（保存 / 删除）。
 *
 * @param {{
 *   dir?: string,
 *   changes?: Array<{ rel: string, text: string|null }>,   // text === null ⇒ 删除该文件（= 恢复内置默认）
 *   expectedHashes?: Record<string, string|null>,           // 乐观锁：调用方载入时看到的哈希；null 表示"当时不存在"
 *   force?: boolean,                                        // 覆盖外部改动（用户明确选择后）
 *   limits?: { maxFileBytes: number, maxTotalBytes: number },
 *   _failAfterRenames?: number|null,                        // 仅供自检注入故障，证明回滚有效
 * }} [opts]
 * @returns {{ ok: boolean, revision: number|null, written: string[], issues: object[] }}
 */
export function commitRulesChange({
  dir = RULES_ROOT,
  changes = [],
  expectedHashes = {},
  force = false,
  limits = DEFAULT_LIMITS,
  _failAfterRenames = null,
} = {}) {
  const issues = [];

  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: false, revision: null, written: [], issues: [err('rules.no-changes', '.', '没有要保存的改动')] };
  }

  const idx = readRulesIndex(dir);
  if (!idx.ok) return { ok: false, revision: null, written: [], issues: idx.problems };
  const index = idx.index;

  // ① 写之前先确认**工作区是干净的**：别的文件已经被外部改过时拒绝保存。
  //    否则我们会用一份基于旧状态的索引去覆盖它，等于把外部改动"合法化"了。
  const diskNow = new Map(listDiskFiles(dir).map((d) => [d.rel, d]));
  for (const [rel, entry] of Object.entries(index.files)) {
    const d = diskNow.get(rel);
    if (!d) continue; // 缺文件由后面的 changes / 载入报；这里不抢报
    const hash = sha256Hex(readFileSync(d.abs));
    if (hash !== entry.sha256) {
      issues.push(
        err(
          'rules.stale-workspace',
          rel,
          '保存前发现这个文件已被外部修改，工作区不是你以为的那一版',
          '点「重新载入」看一眼，再决定要不要覆盖（覆盖请勾选「强制」）',
        ),
      );
    }
  }

  /** @type {Array<{ rel: string, abs: string, text: string|null, oldText: string|null, nextEntry: object|null }>} */
  const staged = [];
  const seen = new Set();

  for (const ch of changes) {
    const rel = toPosixRel(ch?.rel ?? '');
    if (seen.has(rel)) {
      issues.push(err('rules.duplicate-change', rel, '同一批改动里出现了两次同一个文件'));
      continue;
    }
    seen.add(rel);

    if (!classifyRelPath(rel)) {
      issues.push(err('rules.unmanaged-path', rel, '这个路径不属于规则工作区管理的两类文件'));
      continue;
    }

    const abs = join(dir, ...rel.split('/'));
    const oldBuf = existsSync(abs) ? readFileSync(abs) : null;
    const oldHash = oldBuf ? sha256Hex(oldBuf) : null;
    const oldText = oldBuf ? oldBuf.toString('utf8') : null;

    // ② 冲突（用户裁决：拒绝，让用户选"重新载入"还是"强制覆盖"）
    if (!force && Object.prototype.hasOwnProperty.call(expectedHashes, rel)) {
      const expected = expectedHashes[rel] ?? null;
      if (expected !== oldHash) {
        issues.push(
          err(
            'rules.conflict',
            rel,
            `文件已被外部修改（你以为的版本 ${expected ? `${expected.slice(0, 12)}…` : '不存在'}，磁盘上 ${oldHash ? `${oldHash.slice(0, 12)}…` : '不存在'}）`,
            '点「重新载入」再改，或勾选「强制覆盖」（会丢掉外部那版改动）',
          ),
        );
        continue;
      }
    }

    // ③ 内容校验必须在**写任何字节之前**做完（§12："非法正则即时报错且不落盘"）
    if (ch.text !== null) {
      if (typeof ch.text !== 'string') {
        issues.push(err('rules.content.not-string', rel, '要保存的内容必须是文本'));
        continue;
      }
      const contentIssues = validateRuleFileContent(rel, ch.text);
      if (contentIssues.length) {
        issues.push(...contentIssues);
        continue;
      }
      const bytes = Buffer.byteLength(ch.text, 'utf8');
      if (bytes > limits.maxFileBytes) {
        issues.push(
          err('rules.file-too-large', rel, `内容 ${bytes} 字节，超过单文件上限 ${limits.maxFileBytes}`, '这一份不会被保存'),
        );
        continue;
      }
      staged.push({ rel, abs, text: ch.text, oldText, nextEntry: makeEntry(sha256Hex(ch.text), bytes, ch.basedOn ?? null) });
    } else {
      staged.push({ rel, abs, text: null, oldText, nextEntry: null });
    }
  }

  if (issues.length) return { ok: false, revision: index.baseRevision, written: [], issues };

  // ④ 提交后的索引与总体积
  const nextFiles = { ...index.files };
  for (const s of staged) {
    if (s.nextEntry) nextFiles[s.rel] = s.nextEntry;
    else delete nextFiles[s.rel];
  }
  const nextTotal = Object.values(nextFiles).reduce((n, e) => n + e.bytes, 0);
  if (nextTotal > limits.maxTotalBytes) {
    return {
      ok: false,
      revision: index.baseRevision,
      written: [],
      issues: [
        err(
          'rules.total-too-large',
          '.',
          `保存后工作区共 ${nextTotal} 字节，超过上限 ${limits.maxTotalBytes}`,
          '请先删掉一些文件',
        ),
      ],
    };
  }

  // ⑤ 暂存：所有临时文件先落地，再统一改名
  /**
   * 第 6 期第 3 件：**写之前先备份**（滚动 5 份，`.backup/` 目录里，点开头所以不会被当成规则文件）。
   *
   * ⚠ 备份失败**不挡保存**：一个只读的 `.backup/` 不应该让整个编辑器失效。
   *   但失败会作为 `warnings` 交出去（不静默）。
   */
  const backupWarnings = [];
  for (const s of staged) {
    const b = backupFile({ dir, rel: s.rel });
    if (!b.ok) backupWarnings.push(...(b.issues ?? []));
  }

  const applied = []; // 已改名的文件（用于回滚）
  const tmps = [];
  try {
    for (const s of staged) {
      if (s.text === null) continue;
      const tmp = tmpPathOf(s.abs);
      mkdirSync(dirname(s.abs), { recursive: true });
      writeFileSync(tmp, s.text, 'utf8');
      tmps.push(tmp);
    }

    for (const s of staged) {
      if (s.text === null) {
        if (existsSync(s.abs)) unlinkSync(s.abs);
      } else {
        renameSync(tmpPathOf(s.abs), s.abs);
      }
      applied.push(s);
      if (typeof _failAfterRenames === 'number' && applied.length >= _failAfterRenames) {
        throw new Error('注入故障（自检用）');
      }
    }

    // ⑥ 索引最后写 —— 它是提交点
    const nextRevision = index.baseRevision + 1;
    writeRulesIndex(dir, nextFiles, nextRevision);
    return { ok: true, revision: nextRevision, written: staged.map((s) => s.rel), issues: [], warnings: backupWarnings };
  } catch (e) {
    // ⑦ 回滚（尽力而为）：把已改名的文件恢复成内存里记的旧内容 / 删掉新建的
    for (const s of applied.reverse()) {
      try {
        if (s.oldText === null) {
          if (existsSync(s.abs)) unlinkSync(s.abs);
        } else {
          writeFileSync(s.abs, s.oldText, 'utf8');
        }
      } catch {
        /* 回滚也失败时不再抛：下面的 issue 会告诉用户"工作区可能不干净，请重新载入" */
      }
    }
    for (const t of tmps) {
      try {
        if (existsSync(t)) unlinkSync(t);
      } catch {
        /* 同上 */
      }
    }
    return {
      ok: false,
      revision: index.baseRevision,
      written: [],
      issues: [
        err(
          'rules.write-failed',
          '.',
          `写盘失败，已尝试回滚：${e.message}`,
          '请重新载入规则确认工作区状态（不要盲目再保存一次）',
        ),
      ],
      warnings: backupWarnings,
    };
  }
}

/* ────────────────────────────── 建立 / 登记 ────────────────────────────── */

/**
 * 建立工作区：只写 `.workspace.json`（空清单）与 `prompts/` 目录。
 *
 * ⚠ **不**把内置 Prompt 抄成文件（见 `kinds.mjs` 顶部："缺文件 = 用内置"）。
 *
 * @param {{ dir?: string, force?: boolean }} [opts]
 */
export function initRulesWorkspace({ dir = RULES_ROOT, force = false } = {}) {
  const indexPath = join(dir, WORKSPACE_FILE);
  if (existsSync(indexPath) && !force) {
    const idx = readRulesIndex(dir);
    if (idx.ok) {
      return { ok: true, created: false, revision: idx.index.baseRevision, issues: [] };
    }
    return { ok: false, created: false, revision: null, issues: idx.problems };
  }

  const disk = listDiskFiles(dir);
  const files = {};
  const issues = [];
  for (const d of disk) {
    const buf = readFileSync(d.abs);
    const contentIssues = validateRuleFileContent(d.rel, buf.toString('utf8'));
    issues.push(...contentIssues);
    files[d.rel] = makeEntry(sha256Hex(buf), d.bytes, null);
  }
  if (issues.length) return { ok: false, created: false, revision: null, issues };

  mkdirSync(join(dir, PROMPTS_DIR), { recursive: true });
  // 建立时 revision 一定从 0 起：`--force` 只是允许覆盖**已有的索引**，不是"继承旧编号"
  writeRulesIndex(dir, files, 0);
  return { ok: true, created: true, revision: 0, issues: [] };
}

/**
 * 把磁盘上"未登记/已被外部改动"的文件收进索引（`adopt`）。
 *
 * 这是用户裁决里那条"拒绝载入 + 给出登记提示"的后半句：
 * 拒绝是为了不静默吸收，登记是**用户明确表达**"这次改动我认"。
 *
 * @param {{ dir?: string, rels?: string[]|null, force?: boolean }} [opts]
 */
export function adoptRulesFiles({ dir = RULES_ROOT, rels = null, force = false } = {}) {
  const idx = readRulesIndex(dir);
  if (!idx.ok) return { ok: false, revision: null, issues: idx.problems };
  const index = idx.index;

  const want = rels ? new Set(rels.map(toPosixRel)) : null;
  const nextFiles = { ...index.files };
  const issues = [];

  for (const d of listDiskFiles(dir)) {
    const tracked = d.rel in index.files;
    if (want && !want.has(d.rel)) continue;
    if (!want && tracked && !force) continue;

    if (!classifyRelPath(d.rel)) {
      issues.push(
        err('rules.unmanaged-path', d.rel, '这个路径不属于规则工作区管理的两类文件', '请删掉它或改名'),
      );
      continue;
    }
    const buf = readFileSync(d.abs);
    const contentIssues = validateRuleFileContent(d.rel, buf.toString('utf8'));
    if (contentIssues.length) {
      issues.push(...contentIssues);
      continue;
    }
    /**
     * ⚠ 第 6 期第 2 项：**登记外部改动时保留原有基线**。
     *
     * `basedOn` 的语义是"这份内容**是从哪一版内置出发**改的"（血统），不是"这份内容的哈希"。
     * 用户在记事本里改了字，血统没变 —— 若这里把 basedOn 清掉，C 方案的提醒（"内置变了"）
     * 就会在"改一次字"之后永远消失，而用户以为自己还在被照看。
     * 只有**从未登记过**的文件才是真不知道血统（`unknown-base`）。
     */
    const prev = index.files[d.rel];
    nextFiles[d.rel] = makeEntry(sha256Hex(buf), d.bytes, prev?.basedOn ?? null);
  }

  if (issues.length) return { ok: false, revision: index.baseRevision, issues };

  const nextRevision = index.baseRevision + 1;
  writeRulesIndex(dir, nextFiles, nextRevision);
  return { ok: true, revision: nextRevision, issues: [] };
}

/* ────────────────────────────── 基线元数据（第 6 期第 2 项） ────────────────────────────── */

/**
 * 只改索引里的 `basedOn`（**不动文件内容**）。
 *
 * 用途：用户裁决的 C 方案里那个"**rebase**" —— 内置变了，我看过差异了，决定就以现在这版内置
 * 作为我的基线（正文仍然是我的，不覆盖）。
 *
 * ⚠ 顺手做一道防御：文件当前内容必须与索引记的哈希一致。否则等于替一次**外部改动**背书，
 *   而那次改动可能正是别人写坏的 —— 元数据操作不该有这个副作用。
 *
 * @param {{ dir?: string, rel: string, basedOn?: object|null }} opts
 * @returns {{ ok: boolean, revision: number|null, issues: object[] }}
 */
export function setRulesFileMetadata({ dir = RULES_ROOT, rel, basedOn = null } = {}) {
  const r = toPosixRel(rel ?? '');
  const idx = readRulesIndex(dir);
  if (!idx.ok) return { ok: false, revision: null, issues: idx.problems };

  const entry = idx.index.files[r];
  if (!entry) {
    return {
      ok: false,
      revision: idx.index.baseRevision,
      issues: [err('rules.not-tracked', r, '这个文件还没登记，无法写基线信息', '先保存一次内容（保存时会一并写入 basedOn）')],
    };
  }

  const abs = join(dir, ...r.split('/'));
  if (!existsSync(abs)) {
    return { ok: false, revision: idx.index.baseRevision, issues: [err('rules.missing', r, '索引里有这个文件，磁盘上没有')] };
  }
  const hash = sha256Hex(readFileSync(abs));
  if (hash !== entry.sha256) {
    return {
      ok: false,
      revision: idx.index.baseRevision,
      issues: [
        err(
          'rules.hash-mismatch',
          r,
          `文件已被外部修改（索引 ${entry.sha256.slice(0, 12)}… / 磁盘 ${hash.slice(0, 12)}…），不能只改基线信息`,
          '先决定这份外部改动要不要保留（重新载入 / 登记 / 强制覆盖），再改基线',
        ),
      ],
    };
  }

  const nextFiles = { ...idx.index.files, [r]: makeEntry(entry.sha256, entry.bytes, basedOn) };
  const nextRevision = idx.index.baseRevision + 1;
  writeRulesIndex(dir, nextFiles, nextRevision);
  return { ok: true, revision: nextRevision, issues: [] };
}

/* ────────────────────────────── 热重载（下一题生效） ────────────────────────────── */

/**
 * 热重载运行时：**下一题生效，正在跑的题保持原快照**（§16 原文）。
 *
 * 用法：
 *   const rules = createRulesRuntime();
 *   rules.reload();                             // 载入当前磁盘状态
 *   const snap = rules.snapshotForNewProblem(id); // 这道题开始，钉住这一份
 *   … 题目跑到一半，用户改了 Prompt ……
 *   rules.reload();                             // 新快照只给**下一条** snapshotForNewProblem
 *   rules.snapshotOf(id) === snap               // true：跑着的题不受影响
 *   rules.release(id);                          // 题结束了，松手
 */
export function createRulesRuntime({ dir = RULES_ROOT, limits = DEFAULT_LIMITS } = {}) {
  /** @type {object|null} */
  let current = null;
  let problems = [];
  /** @type {Map<string, object>} */
  const pinned = new Map();

  const runtime = {
    get dir() {
      return dir;
    },
    /** 当前"下一题该用"的快照（可能为 null：还没载入过，或载入失败且从未成功过） */
    get current() {
      return current;
    },
    /** 最近一次载入的失败原因（成功时为空数组） */
    get problems() {
      return problems;
    },
    get revision() {
      return current ? current.revision : null;
    },
    /** 正在跑、钉着快照的题数 */
    get pinnedCount() {
      return pinned.size;
    },

    /**
     * 重新载入。
     * ⚠ 失败时**保留**上一份好快照（见文件头"载入失败不清理"那条政策），并交出 problems。
     */
    reload() {
      const r = loadRulesWorkspace({ dir, limits });
      problems = r.problems;
      if (r.ok) current = r.snapshot;
      return r;
    },

    /** 一道题开始：钉住当前快照（钉住之后，热重载不影响它） */
    snapshotForNewProblem(problemId) {
      if (!current) {
        throw new Error(
          '规则工作区尚未成功载入（或载入失败且从未成功过），没有可用快照。请先 reload() 并处理 problems。',
        );
      }
      pinned.set(String(problemId), current);
      return current;
    },

    /** 这道题当初拿到的快照（即使 current 已经被热重载换掉） */
    snapshotOf(problemId) {
      return pinned.get(String(problemId)) ?? null;
    },

    /** 题结束：松手（不松也不会错，只是会一直钉着一份旧快照） */
    release(problemId) {
      return pinned.delete(String(problemId));
    },
  };

  return runtime;
}
