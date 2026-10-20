/**
 * v2 知识卡库加载器（Phase 2 过渡）。
 *
 * 读三样东西：
 *   ① 内置 v2 词表 contracts/knowledgecard-vocab-v2.json；
 *   ② 用户词表 ai-rules/vocab.json（可选；只能新增，不能覆盖内置）；
 *   ③ 内置 v2 卡 core/knowledgecard/data-v2/*.json；
 *   ④ 用户卡 ai-rules/knowledgecard/*.json（v2 直接收；v1 自动迁移，迁不动就停用+报告）。
 *
 * 注意：这是“v2 运行时库”，**还没有接进 pipeline/UI**；Phase 3/4 再接。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildVocabIndexV2, mergeVocab, validateVocab } from './vocab.mjs';
import { migrateEntryV1toV2, validateEntryV2 } from './entry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readPack(path) {
  const raw = readJson(path);
  if (!raw || typeof raw !== 'object') return { entries: [], problems: [`${path} 不是对象`] };
  if (!Array.isArray(raw.entries)) return { entries: [], problems: [`${path} 的 entries 不是数组`] };
  return { entries: raw.entries, problems: [] };
}

/**
 * @param {{
 *   builtinDir?: string, userDir?: string,
 *   vocabPath?: string, userVocabPath?: string, sdkPath?: string
 * }} [opts]
 */
export function loadV2Library(opts = {}) {
  const builtinDir = opts.builtinDir ?? join(ROOT, 'core', 'knowledgecard', 'data-v2');
  const userDir = opts.userDir ?? join(ROOT, 'ai-rules', 'knowledgecard');
  const vocabPath = opts.vocabPath ?? join(ROOT, 'contracts', 'knowledgecard-vocab-v2.json');
  const userVocabPath = opts.userVocabPath ?? join(ROOT, 'ai-rules', 'vocab.json');
  const sdkPath = opts.sdkPath ?? join(ROOT, 'sdk', 'signature-summary.json');

  const problems = [];
  const warnings = [];
  const migration = [];

  const sdk = existsSync(sdkPath) ? readJson(sdkPath) : { functions: [] };
  const primitiveNames = (sdk.functions ?? []).map((f) => f.name);

  const builtinVocab = readJson(vocabPath);
  const bv = validateVocab(builtinVocab, { primitiveNames });
  problems.push(...bv.problems);
  warnings.push(...bv.warnings);

  const userVocab = existsSync(userVocabPath) ? readJson(userVocabPath) : null;
  const merged = mergeVocab(builtinVocab, userVocab, { primitiveNames });
  problems.push(...merged.problems);
  for (const w of merged.warnings) if (!warnings.includes(w)) warnings.push(w);
  const vocab = merged.vocab;
  const index = buildVocabIndexV2(vocab);

  const builtin = [];
  for (const name of ['92-animation-core.json', '93-elements.json']) {
    const p = join(builtinDir, name);
    if (!existsSync(p)) {
      problems.push(`缺少内置 v2 卡：${p}`);
      continue;
    }
    const pack = readPack(p);
    problems.push(...pack.problems);
    for (const e of pack.entries) {
      const entry = { ...e, origin: 'builtin' };
      const ep = validateEntryV2(entry, { vocab, where: `builtin/${name} · ${entry.id ?? '(无 id)'}` });
      if (ep.length) problems.push(...ep);
      else builtin.push(entry);
    }
  }

  const user = [];
  if (existsSync(userDir)) {
    for (const name of readdirSync(userDir).filter((f) => f.toLowerCase().endsWith('.json')).sort()) {
      const p = join(userDir, name);
      let pack;
      try {
        pack = readPack(p);
      } catch (e) {
        problems.push(`${name} 读取失败：${e?.message ?? e}`);
        continue;
      }
      problems.push(...pack.problems);
      for (const raw of pack.entries) {
        const v2Problems = validateEntryV2(raw, { vocab, where: `user/${name} · ${raw.id ?? '(无 id)'}` });
        if (v2Problems.length === 0) {
          user.push({ ...raw, origin: 'user' });
          continue;
        }
        const migrated = migrateEntryV1toV2(raw, { vocab });
        if (!migrated.ok) {
          migration.push({ id: raw.id, action: 'disable', reasons: migrated.reasons, warnings: migrated.warnings });
          continue;
        }
        const mp = validateEntryV2(migrated.entry, { vocab, where: `user/${name} · ${raw.id}` });
        if (mp.length) {
          migration.push({ id: raw.id, action: 'disable', reasons: mp, warnings: migrated.warnings });
          continue;
        }
        user.push({ ...migrated.entry, origin: 'user' });
        migration.push({ id: raw.id, action: 'convert', reasons: [], warnings: migrated.warnings });
      }
    }
  }

  const overridden = new Set(user.map((e) => e.id));
  const entries = [...builtin.filter((e) => !overridden.has(e.id)), ...user];
  const byId = new Map();
  for (const e of entries) {
    if (byId.has(e.id)) problems.push(`id 重复：${e.id}`);
    byId.set(e.id, e);
  }

  return {
    ok: problems.length === 0,
    vocab,
    index,
    entries,
    builtin,
    user,
    problems,
    warnings,
    migration,
  };
}
