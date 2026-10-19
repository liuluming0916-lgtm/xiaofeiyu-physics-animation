/**
 * 世界书 **origin 治理**（§9.3）—— 只做"决定"，不碰文件。
 *
 * ── 为什么与 `store.mjs` 分居两处
 *
 * 与第 4 期把 `core/repair`（决定怎么修）与 `core/dryrun`（判据）分开是同一个理由：
 * **"决定"与"落盘"必须能分别被测试**。本文件是纯函数（可被门禁逐条取证、
 * 也可被前端预览器复用），`store.mjs` 只负责读写与原子性。
 *
 * 治理的四条口径（§9.3 原文）：
 *   ① 内置默认**只读**、可停用；点编辑 ⇒ 生成 `origin: user` 的**覆盖副本**（同 `id`）
 *   ② 升级**只替换未被覆盖的内置条目**；已覆盖的保留用户版本 + UI 标"有新版本，查看差异"
 *   ③ 导出**默认只导 `origin: user`**；提供"包含内置规范"勾选
 *   ④ 恢复默认有**单条 + 整本**两种粒度，且**只影响内置词条**，操作前列出将被覆盖的清单
 */

/** §9.3：编辑内置词条前必须弹出的提示（原文口径，别改写成"将直接修改"） */
export const EDIT_OVERRIDE_HINT =
  '内置词条是只读的。继续编辑将以**本地覆盖副本**方式修改：' +
  '原内置条目保持不变，另存一条 origin:user 的同 id 词条；' +
  '今后升级只替换未被覆盖的内置条目，你改过的这一条会保留。';

/** 从一条内置词条生成"用户覆盖副本"（同 id ⇒ 载入时覆盖内置；§9.3 ①） */
export function makeOverrideCopy(builtinEntry) {
  return {
    ...builtinEntry,
    origin: 'user',
  };
}

/**
 * 升级计划（§9.3 ②）。
 *
 * @param {object} input
 * @param {object[]} input.newBuiltin 新版内置词条
 * @param {object[]} [input.oldBuiltin] 旧版内置词条（可选，用于算出"新增/移除"）
 * @param {object[]} [input.userEntries] 用户词条（含覆盖副本）
 * @returns {{ replaced: object[], kept: object[], added: object[], removed: object[], replacedList: string[] }}
 *   `replaced` = 会被新内置版覆盖的条目；`kept` = 因有用户覆盖副本而**不动**的条目。
 */
export function planUpgrade({ newBuiltin = [], oldBuiltin = [], userEntries = [] } = {}) {
  const overridden = new Set(userEntries.map((u) => u.id));
  const oldIds = new Set(oldBuiltin.map((b) => b.id));
  const newIds = new Set(newBuiltin.map((b) => b.id));

  const replaced = newBuiltin.filter((b) => !overridden.has(b.id));
  const kept = newBuiltin
    .filter((b) => overridden.has(b.id))
    .map((b) => ({ id: b.id, title: b.title, reason: '存在用户覆盖副本，升级不动它（§9.3 ②）' }));
  const added = newBuiltin.filter((b) => !oldIds.has(b.id));
  const removed = oldBuiltin.filter((b) => !newIds.has(b.id) && !overridden.has(b.id));

  return {
    replaced,
    kept,
    added,
    removed,
    /** 直接打印给用户看的"将被覆盖的清单"（16.3 ④ 的要求） */
    replacedList: replaced.map((b) => `${b.id}（${b.title}）`),
  };
}

/**
 * 恢复默认计划（§9.3 ④）：**只影响内置词条**。
 *
 * 规则：
 *   · 目标是内置词条、且存在用户覆盖副本 ⇒ 删掉副本（内置原样生效）
 *   · 目标是内置词条、没有覆盖副本 ⇒ 无需动作（已是默认）
 *   · 目标是**纯用户词条**（不是任何内置的 id） ⇒ **拒绝**（恢复默认不该删用户自己的知识）
 *
 * @param {{ entries: object[], builtinIds: string[], ids?: string[], all?: boolean }} input
 */
export function planRestoreDefault({ entries = [], builtinIds = [], ids = [], all = false } = {}) {
  const builtinSet = new Set(builtinIds);
  const overriddenIds = new Set(entries.filter((e) => e.origin === 'user' && builtinSet.has(e.id)).map((e) => e.id));

  const targets = all ? [...overriddenIds] : [...new Set(ids)];
  const toRemove = [];
  const refused = [];
  const noop = [];

  for (const id of targets) {
    if (!builtinSet.has(id)) {
      refused.push({ id, reason: '不是内置词条，恢复默认不会删除用户自有词条（§9.3 ④）' });
      continue;
    }
    if (!overriddenIds.has(id)) {
      noop.push({ id, reason: '没有用户覆盖副本，已经是内置默认' });
      continue;
    }
    toRemove.push(id);
  }

  return {
    toRemove,
    refused,
    noop,
    /** 操作前给用户看的清单（§9.3 ④："操作前弹确认并列出将被覆盖的清单"） */
    confirmList: toRemove.map((id) => {
      const e = entries.find((x) => x.id === id && x.origin === 'user');
      return `${id}（${e?.title ?? id}）`;
    }),
    /** 影响面声明：只动内置 */
    affectsBuiltinOnly: refused.length === 0,
  };
}

/**
 * 导出计划（§9.3 ③）：**默认只导 `origin: user`**；勾选"包含内置规范"才带上内置。
 * 导出顺序按 id 稳定排序（跨机器可复现，W11）。
 */
export function planExport({ entries = [], includeBuiltin = false } = {}) {
  const list = entries.filter((e) => (includeBuiltin ? true : e.origin === 'user'));
  return [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
