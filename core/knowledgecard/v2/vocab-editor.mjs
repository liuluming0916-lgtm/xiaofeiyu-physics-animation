/**
 * 用户词表编辑（Phase 3C-2）。
 *
 * 用户词表 ai-rules/vocab.json 只做三件事：
 *   · 新增用户元件 / 场景；
 *   · 记录本地关闭开关 `disabled.elements / disabled.scenes`（不删内置词条）；
 *   · 仍受内置词表约束：不能覆盖内置 id。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { backupFile } from '../../rules/backup.mjs';
import { writeFileAtomic } from '../store.mjs';
import { VOCAB_FORMAT, VOCAB_VERSION, mergeVocab, validateVocab } from './vocab.mjs';

const ID_RE = /^[A-Za-z0-9._-]+$/;

function emptyUserVocab() {
  return {
    format: VOCAB_FORMAT,
    version: VOCAB_VERSION,
    elements: [],
    scenes: [],
    disabled: { elements: [], scenes: [] },
  };
}

export function readUserVocab(path) {
  if (!existsSync(path)) return emptyUserVocab();
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return {
    format: VOCAB_FORMAT,
    version: VOCAB_VERSION,
    elements: Array.isArray(raw.elements) ? raw.elements : [],
    scenes: Array.isArray(raw.scenes) ? raw.scenes : [],
    disabled: {
      elements: Array.isArray(raw.disabled?.elements) ? raw.disabled.elements : [],
      scenes: Array.isArray(raw.disabled?.scenes) ? raw.disabled.scenes : [],
    },
  };
}

function writeUserVocab(path, vocab) {
  mkdirSync(dirname(path), { recursive: true });
  try {
    backupFile({ dir: dirname(path), rel: 'vocab.json' });
  } catch {
    /* 首次保存没有旧文件 */
  }
  writeFileAtomic(path, `${JSON.stringify(vocab, null, 2)}\n`);
}

/**
 * 保存“本地关闭”开关。只改 disabled，不碰用户新增词条。
 * @param {{ path: string, disabledElements?: string[], disabledScenes?: string[] }} opts
 */
export function saveVocabState({ path, disabledElements = [], disabledScenes = [] } = {}) {
  const user = readUserVocab(path);
  user.disabled = {
    elements: [...new Set(disabledElements.filter((x) => typeof x === 'string' && ID_RE.test(x)))].sort(),
    scenes: [...new Set(disabledScenes.filter((x) => typeof x === 'string' && ID_RE.test(x)))].sort(),
  };
  writeUserVocab(path, user);
  return { ok: true, disabled: user.disabled };
}

/**
 * 新增用户词表项。
 * @param {{ path: string, kind: 'element'|'scene', entry: object, builtinVocab: object, primitiveNames?: string[] }} opts
 */
export function addVocabEntry({ path, kind, entry, builtinVocab, primitiveNames = null } = {}) {
  if (kind !== 'element' && kind !== 'scene') return { ok: false, issues: ['kind 必须是 element 或 scene'] };
  if (!entry || typeof entry !== 'object') return { ok: false, issues: ['词表项不是对象'] };
  if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) return { ok: false, issues: ['id 必须是 [A-Za-z0-9._-]+'] };
  if (typeof entry.name !== 'string' || !entry.name.trim()) return { ok: false, issues: ['name 必须是非空字符串'] };

  const user = readUserVocab(path);
  if ([...(builtinVocab?.elements ?? []), ...(builtinVocab?.scenes ?? [])].some((x) => x.id === entry.id)) {
    return { ok: false, issues: [`id "${entry.id}" 已在内置词表里，不能覆盖`] };
  }
  if ([...user.elements, ...user.scenes].some((x) => x.id === entry.id)) {
    return { ok: false, issues: [`id "${entry.id}" 已在用户词表里`] };
  }

  const item = {
    id: entry.id,
    name: entry.name.trim(),
    aliases: Array.isArray(entry.aliases) ? entry.aliases.filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim()) : [],
    ...(kind === 'element' ? { primitive: String(entry.primitive ?? '') } : {}),
  };
  const next = {
    ...user,
    elements: kind === 'element' ? [...user.elements, item] : user.elements,
    scenes: kind === 'scene' ? [...user.scenes, item] : user.scenes,
  };

  /* 用“内置 + 新用户词表”整体校验：顺带查 id/别名冲突、primitive 是否存在。 */
  const check = mergeVocab(builtinVocab, next, { primitiveNames });
  if (check.problems.length) return { ok: false, issues: check.problems };
  writeUserVocab(path, next);
  return { ok: true, kind, entry: item, warnings: check.warnings };
}

/**
 * 删除用户新增词表项（内置项不能删，只能 disable）。
 * @param {{ path: string, kind: 'element'|'scene', id: string }} opts
 */
export function removeVocabEntry({ path, kind, id } = {}) {
  if (kind !== 'element' && kind !== 'scene') return { ok: false, issues: ['kind 必须是 element 或 scene'] };
  if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, issues: ['id 非法'] };
  const user = readUserVocab(path);
  const before = kind === 'element' ? user.elements.length : user.scenes.length;
  const next = {
    ...user,
    elements: kind === 'element' ? user.elements.filter((x) => x.id !== id) : user.elements,
    scenes: kind === 'scene' ? user.scenes.filter((x) => x.id !== id) : user.scenes,
    disabled: {
      elements: user.disabled.elements.filter((x) => x !== id),
      scenes: user.disabled.scenes.filter((x) => x !== id),
    },
  };
  const after = kind === 'element' ? next.elements.length : next.scenes.length;
  if (before === after) return { ok: false, issues: ['用户词表里没有这个 id（内置项只能停用，不能删除）'] };
  writeUserVocab(path, next);
  return { ok: true };
}
