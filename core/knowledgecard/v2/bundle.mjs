/**
 * v2 知识卡包导出 / 导入（Phase 3C-3）。
 *
 * 包格式：
 * {
 *   format: "od-knowledgecard-bundle",
 *   version: 2,
 *   exportedAt: "...",
 *   vocab: { elements: [...用户新增...], scenes: [...] },
 *   entries: [...用户卡（含内置覆盖副本）...]
 * }
 *
 * 为什么带词表：A 老师新增了“磁悬浮小车”元件并做了卡，导出给 B 老师；
 * 不带词表的话，B 那边这张卡会变成未知 id。内置词表不导出（随程序走）。
 * 本地开关（disabled）**不导出**：它是“这台机器当前讲哪一章”的状态，不是卡片内容。
 */

import { loadV2Library } from './store.mjs';
import { validateEntryV2 } from './entry.mjs';
import { mergeVocab } from './vocab.mjs';
import { saveV2Entry } from './editor.mjs';
import { readUserVocab, writeUserVocab } from './vocab-editor.mjs';

export const BUNDLE_FORMAT = 'od-knowledgecard-bundle';
export const BUNDLE_VERSION = 2;

export function exportV2Bundle({ dir, vocabPath, builtinVocabPath }) {
  const lib = loadV2Library({ userDir: dir, userVocabPath: vocabPath });
  if (!lib.ok) return { ok: false, issues: lib.problems };
  const userVocab = readUserVocab(vocabPath);
  const bundle = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    vocab: { elements: userVocab.elements, scenes: userVocab.scenes },
    entries: lib.user.map((e) => ({ ...e, origin: 'user' })),
  };
  const text = `${JSON.stringify(bundle, null, 2)}\n`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return { ok: true, name: `knowledgecard-v2-${stamp}.json`, text, entries: bundle.entries.length, elements: userVocab.elements.length, scenes: userVocab.scenes.length };
}

/**
 * 导入：先合并用户词表，再逐卡校验；任何一张不合法就整包拒绝（不写半包）。
 */
export function importV2Bundle({ dir, vocabPath, text, builtinVocab, primitiveNames = null }) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, issues: [`不是合法 JSON：${e?.message ?? e}`] };
  }
  if (!raw || raw.format !== BUNDLE_FORMAT) return { ok: false, issues: [`format 必须是 ${BUNDLE_FORMAT}`] };
  if (raw.version !== BUNDLE_VERSION) return { ok: false, issues: [`version 必须是 ${BUNDLE_VERSION}`] };
  if (!Array.isArray(raw.entries)) return { ok: false, issues: ['entries 必须是数组'] };
  if (!raw.vocab || !Array.isArray(raw.vocab.elements) || !Array.isArray(raw.vocab.scenes)) {
    return { ok: false, issues: ['vocab.elements / vocab.scenes 必须是数组'] };
  }

  const user = readUserVocab(vocabPath);
  const builtinIds = new Set([...(builtinVocab?.elements ?? []), ...(builtinVocab?.scenes ?? [])].map((x) => x.id));
  const existingIds = new Set([...user.elements, ...user.scenes].map((x) => x.id));
  const nextUser = {
    ...user,
    elements: [...user.elements],
    scenes: [...user.scenes],
    disabled: { ...user.disabled },
  };
  const vocabAdded = { elements: 0, scenes: 0 };

  for (const kind of ['elements', 'scenes']) {
    for (const item of raw.vocab[kind]) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string') return { ok: false, issues: [`vocab.${kind} 含非法项`] };
      if (builtinIds.has(item.id)) return { ok: false, issues: [`词表 id "${item.id}" 已在内置词表里，不能覆盖`] };
      if (nextUser[kind].some((x) => x.id === item.id)) continue;
      nextUser[kind].push(item);
      vocabAdded[kind === 'elements' ? 'elements' : 'scenes'] += 1;
    }
  }

  const merged = mergeVocab(builtinVocab, nextUser, { primitiveNames });
  if (merged.problems.length) return { ok: false, issues: merged.problems };

  const entries = [];
  const problems = [];
  for (const rawEntry of raw.entries) {
    const entry = { ...rawEntry, origin: 'user' };
    const p = validateEntryV2(entry, { vocab: merged.vocab, where: `import/${entry.id ?? '(无 id)'}` });
    if (p.length) problems.push(...p);
    else entries.push(entry);
  }
  if (problems.length) return { ok: false, issues: problems };

  writeUserVocab(vocabPath, nextUser);
  for (const entry of entries) {
    const r = saveV2Entry({ dir, entry, vocab: merged.vocab });
    if (!r.ok) return { ok: false, issues: r.issues ?? [`写入 ${entry.id} 失败`] };
  }
  return { ok: true, entries: entries.length, vocabAdded, warnings: merged.warnings };
}
