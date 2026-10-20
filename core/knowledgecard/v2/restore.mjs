/**
 * v2 一键恢复内置：只撤销“内置卡的覆盖副本”，不删用户自己新建的卡。
 *
 * 与 v1 的 restore 区别：v1 会逐包解析 v1 字段，遇到 v2 包会报 version 不支持。
 * v2 直接按“文件里是否含内置 id”判断；一卡一文件的常态下就是删那个文件。
 */

import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { backupFile } from '../../rules/backup.mjs';
import { writeFileAtomic } from '../store.mjs';

/**
 * @param {{ dir: string, builtinIds: Iterable<string> }} opts
 */
export function restoreV2Builtin({ dir, builtinIds } = {}) {
  const ids = new Set(builtinIds ?? []);
  const problems = [];
  let removed = 0;
  let packsTouched = 0;
  let packsDeleted = 0;

  if (!existsSync(dir)) return { ok: true, builtinCount: ids.size, removed: 0, packsTouched: 0, packsDeleted: 0, problems };

  for (const name of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort()) {
    const abs = join(dir, name);
    let pack;
    try {
      pack = JSON.parse(readFileSync(abs, 'utf8'));
    } catch (e) {
      problems.push(`${name}: ${e?.message ?? e}`);
      continue;
    }
    const entries = Array.isArray(pack?.entries) ? pack.entries : [];
    if (!entries.some((e) => ids.has(e?.id))) continue;

    const keep = entries.filter((e) => !ids.has(e?.id));
    try {
      backupFile({ dir, rel: name });
    } catch {
      problems.push(`${name}: 备份失败，未删除`);
      continue;
    }
    packsTouched += 1;
    removed += entries.length - keep.length;
    if (keep.length === 0) {
      unlinkSync(abs);
      packsDeleted += 1;
    } else {
      writeFileAtomic(abs, `${JSON.stringify({ ...pack, entries: keep }, null, 2)}\n`);
    }
  }

  return { ok: problems.length === 0, builtinCount: ids.size, removed, packsTouched, packsDeleted, problems };
}
