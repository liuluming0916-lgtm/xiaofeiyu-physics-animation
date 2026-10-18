/**
 * 保存前的**自动备份**与恢复（第 6 期第 3 件，用户裁决：滚动留 5 份）。
 *
 * ── 为什么要有它
 *
 * 这一期的编辑都是"直接改磁盘上的真文件"。改坏了，能退回的只有**内置默认**——
 * 也就是说**你自己改的那一版会消失**。备份就是补这个洞。
 *
 * ── 放在哪
 *
 * `ai-rules/.backup/<相对路径>.bak.1` … `.bak.5`（`.bak.1` 是**最新**的一份）。
 * 用 `.backup/` 这个**点开头的目录**有两个好处：
 *   ① 规则工作区的扫描本来就会跳过点开头的目录（`listDiskFiles`），备份不会被误报成"未登记文件"；
 *   ② 备份与原文同一棵树，拷整个 `ai-rules/` 就一起带走了。
 *
 * ── 为什么是滚动 5 份，而不是"一份"或"每次一个目录"
 *
 *   只留 1 份：正好挡不住"改了三轮才发现第一轮就错了"；
 *   每次一个目录：能回到精确某次，但要额外维护清理规则，对一个人用的工具太重。
 *   5 份是"能救回来"和"不添麻烦"的中间点。
 *
 * ── 三条口径
 *
 *   ① **Key 不备份**：`keys.json` 的每一份副本都是一份明文密钥，备份它等于把泄露面乘 5。
 *      它本来就可以重新填一次。
 *   ② **恢复之前先备份当前版本**：所以"恢复"本身也能撤销（不会出现"一按恢复，把现在这版也弄没了"）。
 *   ③ 旋转移位是**尽力而为**：先删最老的、再从老到新依次改名，最后写 `.bak.1`。
 *      中途失败最坏的结果是少一份备份，不会碰到原文件。
 *
 * ⚠ 本模块**不 import** `core/rules/workspace.mjs`（那边反过来要 import 本模块），
 *   避免 `workspace ⇄ backup` 的循环依赖。因此它只做文件搬运，不碰工作区索引；
 *   "恢复之后要让索引认这份内容"这件事由调用方做（`adoptRulesFiles`），见 CLI 的 `restore`。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

/** 备份目录（相对工作区根；点开头 ⇒ 不会被当成规则文件扫描） */
export const BACKUP_DIR_NAME = '.backup';
/** 滚动保留几份（用户裁决：5） */
export const BACKUP_KEEP = 5;

/** 明显不该备份的文件（Key 的每一份副本都是明文密钥） */
export const NEVER_BACKUP = Object.freeze(['keys.json']);

const err = (code, path, message, hint) => ({ code, path, message, ...(hint ? { hint } : {}) });

/** 相对路径安全化：必须是相对、不带 `..`、不以盘符/斜杠开头 */
export function safeRelPath(rel) {
  const p = String(rel ?? '').replace(/\\/g, '/');
  if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..') || p.startsWith('.')) return null;
  return p;
}

/** 某份文件在备份目录里的位置（不含 `.bak.N` 后缀） */
export function backupBaseOf(dir, rel) {
  const safe = safeRelPath(rel);
  if (!safe) return null;
  return join(dir, BACKUP_DIR_NAME, ...safe.split('/'));
}

/**
 * 备份一份文件（在**写之前**调用）。
 *
 * @param {{ dir: string, rel: string, keep?: number }} opts
 * @returns {{ ok: boolean, created: boolean, version: number|null, issues?: object[] }}
 */
export function backupFile({ dir, rel, keep = BACKUP_KEEP } = {}) {
  const safe = safeRelPath(rel);
  if (!safe) {
    return { ok: false, created: false, version: null, issues: [err('backup.bad-path', String(rel), '路径不安全（必须相对、不含 ..）')] };
  }
  if (NEVER_BACKUP.includes(basename(safe))) {
    // Key 不备份：静默跳过是**刻意**的，但把它作为"什么都没做"如实汇报
    return { ok: true, created: false, version: null, skipped: 'never-backup' };
  }

  const abs = join(dir, ...safe.split('/'));
  if (!existsSync(abs)) return { ok: true, created: false, version: null };

  const destBase = backupBaseOf(dir, safe);
  try {
    mkdirSync(dirname(destBase), { recursive: true });

    // ① 先删最老的（keep 号），再从老到新依次后移
    const oldest = `${destBase}.bak.${keep}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let i = keep - 1; i >= 1; i -= 1) {
      const from = `${destBase}.bak.${i}`;
      if (existsSync(from)) renameSync(from, `${destBase}.bak.${i + 1}`);
    }

    // ② 当前内容成为最新一份
    copyFileSync(abs, `${destBase}.bak.1`);
    return { ok: true, created: true, version: 1 };
  } catch (e) {
    // 备份失败**不该**挡住保存（否则一个只读的 .backup 目录会让整个编辑器不可用）——
    // 但必须把失败说出来，由调用方决定是警告还是忽略。
    return {
      ok: false,
      created: false,
      version: null,
      issues: [err('backup.failed', safe, `备份失败：${e.message}`, '这次保存仍会继续，但这份改动没有备份')],
    };
  }
}

/**
 * 列出某份文件的备份（`.bak.1` 最新）。
 *
 * @param {{ dir: string, rel: string }} opts
 * @returns {Array<{ version: number, bytes: number, at: string|null }>}
 */
export function listBackups({ dir, rel } = {}) {
  const safe = safeRelPath(rel);
  if (!safe) return [];
  const destBase = backupBaseOf(dir, safe);
  const folder = dirname(destBase);
  if (!existsSync(folder)) return [];

  const prefix = `${basename(destBase)}.bak.`;
  return readdirSync(folder)
    .filter((n) => n.startsWith(prefix))
    .map((n) => ({ n, version: Number(n.slice(prefix.length)) }))
    .filter((x) => Number.isInteger(x.version) && x.version > 0)
    .sort((a, b) => a.version - b.version)
    .map(({ n, version }) => {
      const abs = join(folder, n);
      const st = statSync(abs);
      return { version, bytes: st.size, at: st.mtime ? st.mtime.toISOString() : null };
    });
}

/**
 * 恢复某一份备份。
 *
 * ⚠ 顺序是刻意的：先把备份内容**读进内存**，再备份当前版本，最后写回。
 *   如果反过来（先备份当前 → 再读 `.bak.N`），旋转会把你要恢复的那份挪到别的编号上。
 *
 * @param {{ dir: string, rel: string, version?: number }} opts `version` 缺省 = 最新（1）
 * @returns {{ ok: boolean, restored: number|null, backedUpCurrent: boolean, issues?: object[] }}
 */
export function restoreBackup({ dir, rel, version = 1 } = {}) {
  const safe = safeRelPath(rel);
  if (!safe) {
    return { ok: false, restored: null, backedUpCurrent: false, issues: [err('backup.bad-path', String(rel), '路径不安全（必须相对、不含 ..）')] };
  }

  const list = listBackups({ dir, rel: safe });
  if (!list.length) {
    return {
      ok: false,
      restored: null,
      backedUpCurrent: false,
      issues: [err('backup.none', safe, '这份文件还没有备份', '备份是在"保存"时自动生成的；从没保存过就没有')],
    };
  }
  const picked = list.find((b) => b.version === Number(version)) ?? list[0];
  const srcAbs = `${backupBaseOf(dir, safe)}.bak.${picked.version}`;

  let content;
  try {
    content = readFileSync(srcAbs);
  } catch (e) {
    return { ok: false, restored: null, backedUpCurrent: false, issues: [err('backup.unreadable', safe, `读不到备份：${e.message}`)] };
  }

  // 恢复前的当前版本也留一份（让"恢复"本身可撤销）
  const prev = backupFile({ dir, rel: safe });

  const abs = join(dir, ...safe.split('/'));
  try {
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-restore-${process.pid}`;
    writeFileSync(tmp, content);
    renameSync(tmp, abs);
  } catch (e) {
    return { ok: false, restored: null, backedUpCurrent: prev.created === true, issues: [err('backup.write-failed', safe, `写回失败：${e.message}`)] };
  }

  return { ok: true, restored: picked.version, backedUpCurrent: prev.created === true, issues: [] };
}

/** 供 CLI/UI 显示：某份文件"有没有备份、几份、最近一份多大" */
export function backupSummary({ dir, rel } = {}) {
  const list = listBackups({ dir, rel });
  return {
    rel,
    count: list.length,
    newest: list[0] ?? null,
    skipped: NEVER_BACKUP.includes(basename(String(rel ?? '').replace(/\\/g, '/'))),
  };
}

/** 给测试/诊断用：备份目录的绝对路径 */
export function backupDirOf(dir) {
  return join(dir, BACKUP_DIR_NAME);
}

/**
 * 列出**所有**有备份的文件（CLI `restore` 不带参数时用它）。
 *
 * @param {{ dir: string }} opts
 * @returns {Array<{ rel: string, versions: Array<{version:number,bytes:number,at:string|null}> }>}
 */
export function listAllBackups({ dir } = {}) {
  const root = join(dir, BACKUP_DIR_NAME);
  if (!existsSync(root)) return [];
  /** @type {Map<string, Array<{version:number,bytes:number,at:string|null}>>} */
  const byRel = new Map();

  const walk = (absDir) => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const m = /^(.*)\.bak\.(\d+)$/.exec(entry.name);
      if (!m) continue;
      const rel = relative(root, join(absDir, m[1])).split('\\').join('/');
      const st = statSync(abs);
      const list = byRel.get(rel) ?? [];
      list.push({ version: Number(m[2]), bytes: st.size, at: st.mtime ? st.mtime.toISOString() : null });
      byRel.set(rel, list);
    }
  };
  walk(root);

  return [...byRel.entries()]
    .map(([rel, versions]) => ({ rel, versions: versions.sort((a, b) => a.version - b.version) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));
}
