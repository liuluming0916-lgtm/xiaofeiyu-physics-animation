/**
 * v2 知识卡库加载器（Phase 2 过渡）。
 *
 * 读三样东西：
 *   ① 内置 v2 词表 contracts/knowledgecard-vocab-v2.json；
 *   ② 用户词表 ai-rules/vocab.json（可选；只能新增，不能覆盖内置）；
 *   ③ 内置 v2 卡：开发态读 core/knowledgecard/data-v2/*.json；
 *      打包态（OD_BUILTIN_BUNDLE=1）读 core/knowledgecard/v2/builtin-bundle.generated.mjs（只读底座）；
 *   ④ 用户卡 ai-rules/knowledgecard/*.json（v2 直接收；v1 自动迁移，迁不动就停用+报告）。
 *
 * 打包态只是“内置底座只读”，**不影响用户在软件里改卡**：用户卡仍从 ai-rules 读，
 * 覆盖/追加内置卡；恢复内置 = 删用户覆盖。
 *
 * 注意：这是“v2 运行时库”，**还没有接进 pipeline/UI**；Phase 3/4 再接。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildVocabIndexV2, mergeVocab, validateVocab } from './vocab.mjs';
import { migrateEntryV1toV2, validateEntryV2 } from './entry.mjs';
import { BUILTIN_V2_BUNDLE } from './builtin-bundle.generated.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * 打包形态（`OD_BUILTIN_BUNDLE=1`）：内置 v2 卡从**编译进代码的常量**读，
 * 不再依赖 `data-v2/*.json`；用户卡仍从 `ai-rules/knowledgecard/` 读并覆盖/追加。
 */
function useBuiltinBundle() {
  return process.env.OD_BUILTIN_BUNDLE === '1';
}

function readBundlePack(name) {
  const file = BUILTIN_V2_BUNDLE?.files?.find((f) => f.name === name);
  if (!file?.text) return { entries: [], problems: [`v2 编译包缺少 ${name}`] };
  try {
    const raw = JSON.parse(file.text);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) {
      return { entries: [], problems: [`v2 编译包 ${name} 的 entries 不是数组`] };
    }
    return { entries: raw.entries, problems: [] };
  } catch (e) {
    return { entries: [], problems: [`v2 编译包 ${name} 解析失败：${e?.message ?? e}`] };
  }
}

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
  const useBundle = useBuiltinBundle();
  for (const name of ['92-animation-core.json', '93-elements.json']) {
    let pack;
    if (useBundle) {
      pack = readBundlePack(name);
      problems.push(...pack.problems);
    } else {
      const p = join(builtinDir, name);
      if (!existsSync(p)) {
        problems.push(`缺少内置 v2 卡：${p}`);
        continue;
      }
      pack = readPack(p);
      problems.push(...pack.problems);
    }
    for (const e of pack.entries) {
      const entry = { ...e, origin: 'builtin' };
      const where = useBundle ? `builtin-bundle/${name} · ${entry.id ?? '(无 id)'}` : `builtin/${name} · ${entry.id ?? '(无 id)'}`;
      const ep = validateEntryV2(entry, { vocab, where });
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
