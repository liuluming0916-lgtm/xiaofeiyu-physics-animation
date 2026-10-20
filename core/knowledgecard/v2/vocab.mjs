/**
 * 知识卡词表 v2 —— 纯函数（无 IO、无 node: 依赖）。
 *
 * 设计口径（见 `v1.1.15-知识卡重构技术方案.md` §2.2）：
 *   · 词表只有两张：元件（elements）和场景（scenes）；
 *   · 元件必须绑定一个 `Draw.*` 画法；场景不绑定画法；
 *   · 用户层只能新增，不能覆盖内置 id；
 *   · 别名冲突只告警，不静默丢。
 */

export const VOCAB_FORMAT = 'od-knowledgecard-vocab';
export const VOCAB_VERSION = 2;

/** 与 `core/knowledgecard/concepts.mjs` 的 normalizeWord 同口径；v2 先自带一份，避免耦合。 */
export function normalizeWord(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.normalize('NFKC').trim();
  s = s.replace(/^[\s*`"'「『【\[（(]+/, '').replace(/[\s*`"'」』】\]）)]+$/, '');
  s = s.replace(/^\d+[.、)]\s*/, '');
  return s.replace(/\s+/g, ' ').trim();
}

const ID_RE = /^[A-Za-z0-9._-]+$/;

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function checkAliases(list, where, problems) {
  if (!Array.isArray(list)) {
    problems.push(`${where}.aliases 必须是数组`);
    return [];
  }
  const out = [];
  for (const a of list) {
    if (typeof a !== 'string' || !a.trim()) {
      problems.push(`${where}.aliases 含非字符串或空串`);
      continue;
    }
    out.push(a.trim());
  }
  if (new Set(out).size !== out.length) problems.push(`${where}.aliases 有重复项`);
  return out;
}

/**
 * 校验一份词表（内置或用户）。
 * @param {object} vocab
 * @param {{ primitiveNames?: Iterable<string>|null }} [opts] 传入 SDK 函数名集合时，会查 `primitive` 是否登记
 * @returns {{ ok: boolean, problems: string[], warnings: string[] }}
 */
export function validateVocab(vocab, { primitiveNames = null } = {}) {
  const problems = [];
  const warnings = [];
  if (!isObject(vocab)) return { ok: false, problems: ['词表不是对象'], warnings };

  if (vocab.format !== VOCAB_FORMAT) problems.push(`format 必须是 ${VOCAB_FORMAT}`);
  if (vocab.version !== VOCAB_VERSION) problems.push(`version 必须是 ${VOCAB_VERSION}`);

  const primitives = primitiveNames ? new Set(primitiveNames) : null;
  const ids = new Map(); // id -> 'element' | 'scene'

  const readList = (key, kind) => {
    const list = vocab[key];
    if (!Array.isArray(list)) {
      problems.push(`${key} 必须是数组`);
      return [];
    }
    return list.map((item, i) => {
      const where = `${key}[${i}]`;
      if (!isObject(item)) {
        problems.push(`${where} 不是对象`);
        return null;
      }
      if (typeof item.id !== 'string' || !ID_RE.test(item.id)) {
        problems.push(`${where}.id 必须是 [A-Za-z0-9._-]+`);
      } else {
        if (ids.has(item.id)) problems.push(`id "${item.id}" 在 ${ids.get(item.id)} 与 ${kind} 中重复`);
        else ids.set(item.id, kind);
      }
      if (typeof item.name !== 'string' || !item.name.trim()) problems.push(`${where}.name 必须是非空字符串`);
      const aliases = checkAliases(item.aliases ?? [], where, problems);
      if (kind === 'element') {
        if (typeof item.primitive !== 'string' || !/^Draw\.[A-Za-z]+$/.test(item.primitive)) {
          problems.push(`${where}.primitive 必须是 Draw.*`);
        } else if (primitives && !primitives.has(item.primitive)) {
          problems.push(`${where}.primitive "${item.primitive}" 不在 SDK 函数表里`);
        }
      } else if ('primitive' in item) {
        problems.push(`${where} 是场景，不应有 primitive`);
      }
      return {
        id: item.id,
        name: item.name,
        aliases,
        ...(kind === 'element' ? { primitive: item.primitive } : {}),
      };
    });
  };

  const elements = readList('elements', 'element').filter(Boolean);
  const scenes = readList('scenes', 'scene').filter(Boolean);

  // 别名冲突：只告警；解析时按“正式名优先、先注册优先”处理（与 v1 同口径）。
  const aliasOwner = new Map();
  for (const item of [...elements.map((e) => ({ ...e, kind: 'element' })), ...scenes.map((s) => ({ ...s, kind: 'scene' }))]) {
    const words = [item.name, item.id, ...(item.aliases ?? [])];
    for (const raw of words) {
      const key = normalizeWord(raw).toLowerCase();
      if (!key) continue;
      const prev = aliasOwner.get(key);
      if (prev && prev !== item.id) {
        warnings.push(`别名/名称冲突："${raw}" 同时指向 ${prev} 与 ${item.id}（解析时按规则取一个）`);
      } else if (!prev) {
        aliasOwner.set(key, item.id);
      }
    }
  }

  return { ok: problems.length === 0, problems, warnings };
}

/**
 * 合并内置词表与用户词表。
 * 用户不能覆盖内置 id；用户新增 id 会追加。
 * @returns {{ vocab: object, problems: string[], warnings: string[] }}
 */
export function mergeVocab(builtin, user, { primitiveNames = null } = {}) {
  const problems = [];
  const warnings = [];
  const b = validateVocab(builtin, { primitiveNames });
  problems.push(...b.problems);
  warnings.push(...b.warnings);
  if (!b.ok) {
    return { vocab: { format: VOCAB_FORMAT, version: VOCAB_VERSION, elements: [], scenes: [] }, problems, warnings };
  }

  const u = user == null
    ? { ok: true, problems: [], warnings: [] }
    : validateVocab(user, { primitiveNames });
  problems.push(...u.problems);
  warnings.push(...u.warnings);
  if (!u.ok) {
    return { vocab: structuredClone(builtin), problems, warnings };
  }

  const vocab = structuredClone(builtin);
  const builtinElementIds = new Set((builtin.elements ?? []).map((e) => e.id));
  const builtinSceneIds = new Set((builtin.scenes ?? []).map((s) => s.id));

  for (const e of user?.elements ?? []) {
    if (builtinElementIds.has(e.id) || builtinSceneIds.has(e.id)) {
      problems.push(`用户词表不能覆盖内置 id "${e.id}"`);
      continue;
    }
    vocab.elements.push(structuredClone(e));
  }
  for (const s of user?.scenes ?? []) {
    if (builtinSceneIds.has(s.id) || builtinElementIds.has(s.id)) {
      problems.push(`用户词表不能覆盖内置 id "${s.id}"`);
      continue;
    }
    vocab.scenes.push(structuredClone(s));
  }

  /* 合并后整体再校验一次：跨内置/用户的别名冲突在这里才会暴露。 */
  const mergedCheck = validateVocab(vocab, { primitiveNames });
  problems.push(...mergedCheck.problems);
  for (const w of mergedCheck.warnings) {
    if (!warnings.includes(w)) warnings.push(w);
  }

  return { vocab, problems, warnings };
}

/**
 * 建“词 → 词表项”的索引。正式名/id 优先，其次别名；同词冲突先注册者赢，并记录。
 * @returns {{ byWord: Map<string, {kind:'element'|'scene', id:string}>, conflicts: Array<object> }}
 */
export function buildVocabIndexV2(vocab) {
  const byWord = new Map();
  const conflicts = [];
  const add = (word, kind, id, isFormal) => {
    const key = normalizeWord(word).toLowerCase();
    if (!key) return;
    const prev = byWord.get(key);
    if (!prev) {
      byWord.set(key, { kind, id, formal: isFormal });
      return;
    }
    if (prev.id === id) {
      if (isFormal) prev.formal = true;
      return;
    }
    if (isFormal && !prev.formal) {
      byWord.set(key, { kind, id, formal: true });
      conflicts.push({ word, kept: id, dropped: prev.id, rule: '正式名优先' });
    } else {
      conflicts.push({ word, kept: prev.id, dropped: id, rule: prev.formal ? '正式名优先' : '先注册优先' });
    }
  };

  for (const e of vocab?.elements ?? []) {
    add(e.id, 'element', e.id, true);
    add(e.name, 'element', e.id, true);
    for (const a of e.aliases ?? []) add(a, 'element', e.id, false);
  }
  for (const s of vocab?.scenes ?? []) {
    add(s.id, 'scene', s.id, true);
    add(s.name, 'scene', s.id, true);
    for (const a of s.aliases ?? []) add(a, 'scene', s.id, false);
  }
  return { byWord, conflicts };
}

/** 词表里的元件 id 集合 */
export function elementIdsOf(vocab) {
  return new Set((vocab?.elements ?? []).map((e) => e.id));
}

/** 词表里的场景 id 集合 */
export function sceneIdsOf(vocab) {
  return new Set((vocab?.scenes ?? []).map((s) => s.id));
}
