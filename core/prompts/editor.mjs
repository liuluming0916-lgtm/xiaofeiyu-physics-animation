/**
 * Prompt 编辑器（第 6 期第 2 项）：**枚举 / 打开 / 保存 / 恢复默认 / 换基线**。
 *
 * 它只做"把人和文件连起来"的事，判据全在别处：
 *   · 合法性（大小、哈希、原子写、冲突、回滚）→ `core/rules/workspace.mjs`
 *   · 能不能删某一段（硬约束）与代际状态   → `core/prompts/overlay.mjs`
 *   · 实际生效                        → `getPrompt(id, rules)`（`templates.mjs`）
 *
 * ── 为什么编辑器要把 Prompt **分组**（用户裁决：不能平铺）
 *
 * 程序里能编辑的有 7 份正文：读题 / 解题 / 分步 / 物理分析 /
 * 动画代码 / 步骤耦合 / 自愈修复。v1 读题已退役，不再出现在编辑器里；`repair`
 * 只在 drawFrame 没过校验时跑，所以按「每道题都会跑 / 特定情况跑」分组。
 * 若平铺成一排，用户会以为"改了没效果 = 坏了"，或者更糟——
 * 以为自己在用一份自定义的规则，其实那份规则从未被调用。
 * 这个项目已经栽过一次"看着在管、实际不管"（第 5.7 期的 3 条空检查），所以这里必须显式分组。
 */

import { MODEL_STAGES } from '../orchestrator/events.mjs';
import { EXTENSION_PROMPTS, PROMPTS } from './templates.mjs';
import {
  PROMPT_REQUIREMENTS,
  PROMPT_STATUS,
  inspectPromptOverride,
  diffSummary,
  promptStatus,
} from './overlay.mjs';
import {
  commitRulesChange,
  loadRulesWorkspace,
  readRulesIndex,
  setRulesFileMetadata,
  sha256Hex,
  toPosixRel,
} from '../rules/index.mjs';

/** 编辑器里的分组口径（**从阶段清单派生**，不另抄一份） */
const ALWAYS_PROMPT_IDS = (() => {
  // v1.1.18：v1 读题退役，只保留 read_problem_v2。
  const ids = [...MODEL_STAGES].map((id) => (id === 'read_problem' ? 'read_problem_v2' : id));
  // couple 是交付前必跑的模型阶段，不属于「只在特定情况下跑」。
  ids.push('couple');
  return Object.freeze([...new Set(ids)]);
})();

export const PROMPT_SECTORS = Object.freeze({
  always: { title: '每道题都会跑', hint: '改这里立刻影响产出', ids: ALWAYS_PROMPT_IDS },
  conditional: {
    title: '只在特定情况下跑',
    hint: '目前只有 repair：drawFrame 没通过校验时才会用到',
    ids: Object.freeze(['repair']),
  },
});

/** 改它就要特别小心（会**静默**坏掉下游，而不是报错） */
const HIGH_RISK_IDS = new Set(['read_problem_v2']);

const err = (code, path, message, hint) => ({ code, path, message, ...(hint ? { hint } : {}) });

/** 内置正文 */
export function builtinPromptText(id) {
  const p = PROMPTS[id] ?? EXTENSION_PROMPTS[id];
  return p ? p.system : null;
}

/** 某份 Prompt 的元信息（label / 风险 / 归属组） */
function metaOf(id) {
  const sector = Object.entries(PROMPT_SECTORS).find(([, v]) => v.ids.includes(id))?.[0] ?? null;
  const p = PROMPTS[id] ?? EXTENSION_PROMPTS[id];
  return { id, label: p?.label ?? id, duty: p?.duty ?? '', sector };
}

/** 全部可编辑 Prompt 的 id（5 个阶段 + repair = 6） */
export function editablePromptIds() {
  return [...PROMPT_SECTORS.always.ids, ...PROMPT_SECTORS.conditional.ids];
}

/**
 * 列出"编辑器里该显示的全部条目"。
 *
 * @param {{ dir?: string, rules?: object }} [opts] `rules` 传快照可避免重复读盘；不传就现读
 * @returns {{ ok: boolean, revision: number|null, problems: object[], items: object[], unknownFiles: object[] }}
 */
export function listPromptCatalog({ dir, rules = null } = {}) {
  const loaded = rules ? { ok: true, revision: rules.revision ?? null, problems: [], prompts: Object.fromEntries(Object.entries(rules.promptTexts ?? {}).map(([id, text]) => [id, { text }])) } : loadRulesWorkspace(dir ? { dir } : undefined);

  if (!loaded.ok) return { ok: false, revision: loaded.revision ?? null, problems: loaded.problems, items: [], unknownFiles: [] };

  const idx = readRulesIndex(dir ?? undefined);
  const entries = idx.ok ? idx.index.files : {};

  const items = editablePromptIds().map((id) => {
    const meta = metaOf(id);
    const builtinText = builtinPromptText(id);
    const builtinSha = sha256Hex(builtinText ?? '');
    const rel = `prompts/${id}.md`;
    const overrideText = loaded.prompts?.[id]?.text ?? null;
    const entry = entries[rel] ?? null;
    const status = overrideText ? promptStatus(entry, builtinSha) : PROMPT_STATUS.BUILTIN;

    return {
      ...meta,
      group: meta.sector,
      groupTitle: meta.sector ? PROMPT_SECTORS[meta.sector].title : '',
      groupHint: meta.sector ? PROMPT_SECTORS[meta.sector].hint : '',
      risk: HIGH_RISK_IDS.has(id) ? 'high' : 'normal',
      rel,
      builtinText,
      builtinSha,
      override: overrideText
        ? {
            text: overrideText,
            sha256: entry?.sha256 ?? sha256Hex(overrideText),
            basedOn: entry?.basedOn ?? null,
            status,
            /** 内置变了时，把"当初的内置"与"现在的内置"差了哪几行算出来 */
            diff: entry?.basedOn?.text ? diffSummary(entry.basedOn.text, builtinText) : null,
          }
        : null,
      requirements: {
        errors: PROMPT_REQUIREMENTS[id]?.errors ?? [],
        warnings: PROMPT_REQUIREMENTS[id]?.warnings ?? [],
      },
    };
  });

  // 工作区里有、但程序里没这个 Prompt：不能静默忽略（否则"我改了一份，怎么没反应"）
  const known = new Set(editablePromptIds());
  const unknownFiles = Object.keys(loaded.prompts ?? {})
    .filter((id) => !known.has(id))
    .map((id) => ({
      rel: `prompts/${id}.md`,
      id,
      message: `工作区里有 prompts/${id}.md，但程序里没有这个 Prompt`,
      hint: '它不会被任何阶段用到。要么改成已知的 id，要么删掉它（UI 的"恢复默认"就是删）',
    }));

  return { ok: loaded.problems.length === 0, revision: loaded.revision ?? null, problems: loaded.problems, items, unknownFiles };
}

/* ────────────────────────────── 打开 / 保存 / 恢复 / 换基线 ────────────────────────────── */

/**
 * 打开一份 Prompt：内置正文 + 覆盖正文 + 状态 + 差异。
 *
 * @param {{ dir?: string, id: string }} opts
 */
export function openPrompt({ dir, id }) {
  if (!builtinPromptText(id)) {
    return {
      ok: false,
      issues: [err('prompt.unknown-id', id, `未知的 Prompt id "${id}"`, `可用：${editablePromptIds().join(' / ')}`)],
    };
  }
  const loaded = loadRulesWorkspace(dir ? { dir } : undefined);
  if (!loaded.ok) return { ok: false, issues: loaded.problems };

  const idx = readRulesIndex(dir ?? undefined);
  const rel = `prompts/${id}.md`;
  const entry = idx.ok ? idx.index.files[rel] ?? null : null;
  const builtinText = builtinPromptText(id);
  const builtinSha = sha256Hex(builtinText);
  const overrideText = loaded.prompts?.[id]?.text ?? null;

  /**
   * ⚠ 这里**必须**把 `errors` / `warnings` 都补成数组，哪怕某一份 Prompt 只配了 warnings。
   *
   * 教训（第 6 期第 5 项）：`PROMPT_REQUIREMENTS` 里 `solve` 只有 `warnings`，
   * 于是 `requirements.errors` 是 `undefined`；界面读 `.length` 直接抛 TypeError，
   * 而 React 没有错误边界 ⇒ **整页白屏**。
   * 数据层与界面层各补一道：这里保证"接口返回的形状固定"，界面再用 `?? []` 兜底。
   */
  const req = PROMPT_REQUIREMENTS[id] ?? {};
  return {
    ok: true,
    id,
    label: metaOf(id).label,
    sector: metaOf(id).sector,
    rel,
    builtinText,
    builtinSha,
    overrideText,
    status: overrideText ? promptStatus(entry, builtinSha) : PROMPT_STATUS.BUILTIN,
    // 你保存时的哈希：UI 保存时原样回传，撞车时工作区会拒绝（§16 拒绝冲突）
    expectedHash: overrideText ? (entry?.sha256 ?? sha256Hex(overrideText)) : null,
    diff: entry?.basedOn?.text ? diffSummary(entry.basedOn.text, builtinText) : null,
    baseSavedAt: entry?.basedOn?.savedAt ?? null,
    requirements: { errors: [...(req.errors ?? [])], warnings: [...(req.warnings ?? [])] },
  };
}

/**
 * 保存一份覆盖副本（= 一份"整份替换"，用户裁决的 C 方案）。
 *
 * @param {{
 *   dir?: string,
 *   id: string,
 *   text: string,
 *   expectedHash?: string|null,   // 打开时拿到的 expectedHash；不传 = 不检查冲突
 *   force?: boolean,
 * }} opts
 * @returns {{ ok: boolean, revision: number|null, warnings: object[], issues: object[] }}
 */
export function savePromptOverride({ dir, id, text, expectedHash, force = false }) {
  const builtinText = builtinPromptText(id);
  if (!builtinText) {
    return {
      ok: false,
      revision: null,
      warnings: [],
      issues: [err('prompt.unknown-id', id, `未知的 Prompt id "${id}"`, `可用：${editablePromptIds().join(' / ')}`)],
    };
  }

  const rel = `prompts/${id}.md`;
  const check = inspectPromptOverride(id, text);
  if (check.errors.length) {
    // 硬约束：写盘之前就拒（§12 同一条精神："非法正则即时报错且不落盘"）
    return { ok: false, revision: null, warnings: check.warnings, issues: check.errors };
  }

  const warnings = [...check.warnings];

  const builtinSha = sha256Hex(builtinText);
  const basedOn = {
    sha256: builtinSha,
    // 存一份"当初的内置"：内置以后再变，才能把新旧并排给人看（超长就不存，只留 sha256）
    ...(builtinText.length <= 64 * 1024 ? { text: builtinText } : {}),
    savedAt: new Date().toISOString(),
  };

  const r = commitRulesChange({
    dir,
    changes: [{ rel, text, basedOn }],
    ...(expectedHash !== undefined ? { expectedHashes: { [rel]: expectedHash ?? null } } : {}),
    force,
  });

  return { ok: r.ok, revision: r.revision, warnings, issues: r.issues };
}

/**
 * 恢复默认：删掉覆盖副本（**不是**写一份空正文）。
 *
 * @param {{ dir?: string, id: string, expectedHash?: string|null, force?: boolean }} opts
 */
export function resetPromptOverride({ dir, id, expectedHash, force = false }) {
  if (!builtinPromptText(id)) {
    return { ok: false, revision: null, issues: [err('prompt.unknown-id', id, `未知的 Prompt id "${id}"`)] };
  }
  const rel = `prompts/${id}.md`;
  const r = commitRulesChange({
    dir,
    changes: [{ rel, text: null }],
    ...(expectedHash !== undefined ? { expectedHashes: { [rel]: expectedHash ?? null } } : {}),
    force,
  });
  return { ok: r.ok, revision: r.revision, issues: r.issues };
}

/**
 * 换基线（C 方案里的 rebase）：我看过内置的变化了，就以现在这版内置作为我的基线。
 * **正文一个字都不动**。
 */
export function rebasePromptOverride({ dir, id }) {
  const builtinText = builtinPromptText(id);
  if (!builtinText) {
    return { ok: false, revision: null, issues: [err('prompt.unknown-id', id, `未知的 Prompt id "${id}"`)] };
  }
  const rel = `prompts/${id}.md`;
  const r = setRulesFileMetadata({
    dir,
    rel,
    basedOn: {
      sha256: sha256Hex(builtinText),
      ...(builtinText.length <= 64 * 1024 ? { text: builtinText } : {}),
      savedAt: new Date().toISOString(),
    },
  });
  return { ok: r.ok, revision: r.revision, issues: r.issues };
}

export { PROMPT_STATUS, promptStatus, diffSummary, toPosixRel };
