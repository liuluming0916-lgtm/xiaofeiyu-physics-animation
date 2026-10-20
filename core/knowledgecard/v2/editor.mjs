/**
 * v2 知识卡保存（Phase 3C-1：只支持“编辑已有卡 + 存成用户覆盖副本”）。
 *
 * 与 v1 的 `saveKnowledgecardPack` 区别：
 *   · 只写 v2 字段；
 *   · 一卡一文件 `<id>.json`；
 *   · 写前滚动备份（复用 rules/backup）；
 *   · 写入前用合并词表做完整校验。
 */

import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { backupFile } from '../../rules/backup.mjs';
import { writeFileAtomic } from '../store.mjs';
import { validateEntryV2 } from './entry.mjs';

const ID_RE = /^[A-Za-z0-9._-]+$/;

function clean(entry) {
  return {
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    enabled: entry.enabled !== false,
    origin: 'user',
    constant: entry.kind === 'anim_rule' ? true : false,
    ...(Array.isArray(entry.elements) && entry.elements.length ? { elements: [...entry.elements] } : {}),
    ...(Array.isArray(entry.scenes) && entry.scenes.length ? { scenes: [...entry.scenes] } : {}),
    order: Number.isInteger(entry.order) ? entry.order : 100,
    priority: entry.priority === 'high' ? 'high' : 'normal',
    content: entry.content,
    code_examples: Array.isArray(entry.code_examples) ? [...entry.code_examples] : [],
  };
}

/**
 * @param {{ dir: string, entry: object, vocab: object }} opts
 * @returns {{ ok: boolean, entry?: object, name?: string, issues?: string[] }}
 */
export function saveV2Entry({ dir, entry, vocab } = {}) {
  if (!entry || typeof entry !== 'object') return { ok: false, issues: ['词条不是对象'] };
  if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) return { ok: false, issues: ['id 必须是 [A-Za-z0-9._-]+'] };

  const candidate = { ...entry, origin: 'user' };
  if (candidate.kind === 'anim_rule') candidate.constant = true;
  else if (candidate.constant === undefined) candidate.constant = false;
  const problems = validateEntryV2(candidate, { vocab, where: `user/${candidate.id}` });
  if (problems.length) return { ok: false, issues: problems };

  const next = clean(candidate);
  const postProblems = validateEntryV2(next, { vocab, where: `user/${next.id}` });
  if (postProblems.length) return { ok: false, issues: postProblems };

  const name = `${next.id}.json`;
  const abs = join(dir, name);
  try {
    mkdirSync(dir, { recursive: true });
    backupFile({ dir, rel: name });
  } catch {
    /* 首次保存没有旧文件可备份；备份失败不阻断写入 */
  }
  writeFileAtomic(abs, `${JSON.stringify({ format: 'od-knowledgecard', version: 2, entries: [next] }, null, 2)}\n`);
  return { ok: true, entry: next, name };
}

/** 删除一张用户卡（内置卡不能删，只能删它的覆盖副本） */
export function removeV2Entry({ dir, id } = {}) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, issues: ['id 非法'] };
  const name = `${id}.json`;
  const abs = join(dir, name);
  if (!existsSync(abs)) return { ok: false, issues: [`用户卡文件不存在：${name}`] };
  try {
    backupFile({ dir, rel: name });
  } catch {
    /* 备份失败不阻断删除？删除是危险操作，备份失败应当拒绝 */
    return { ok: false, issues: ['删除前备份失败，已拒绝删除'] };
  }
  unlinkSync(abs);
  return { ok: true, id, name };
}
