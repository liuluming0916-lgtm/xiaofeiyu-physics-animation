/**
 * Prompt 编辑器（第 6 期第 2 项）：**枚举 / 打开 / 保存 / 恢复默认 / 换基线**。
 *
 * 它只做"把人和文件连起来"的事，判据全在别处：
 *   · 合法性（大小、哈希、原子写、冲突、回滚）→ `core/rules/workspace.mjs`
 *   · 能不能删某一段（硬约束）与代际状态   → `core/prompts/overlay.mjs`
 *   · 实际生效                        → `getPrompt(id, rules)`（`templates.mjs`）
 *
 * ── 为什么编辑器要把 Prompt **分成三组**（用户裁决：不能平铺）
 *
 * 程序里能编辑的有 8 份正文（§10.1 的 6 份 + 扩展的 repair + 嵌在 answers 里的答案结构模板）。
 * 但它们**不是都会跑**：`worldbook` 与 `distill` 在当前主链路上根本没有阶段，
 * 改了不会有任何反应。若平铺成一排，用户会以为"改了没效果 = 坏了"，或者更糟——
 * 以为自己在用一份自定义的规则，其实那份规则从未被调用。
 * 这个项目已经栽过一次"看着在管、实际不管"（第 5.7 期的 3 条空检查），所以这里必须显式分组。
 */

import { MODEL_STAGES, PHASE5_STAGES } from '../orchestrator/events.mjs';
import {
  ANSWER_STRUCTURE_PROMPT_ID,
  ANSWER_STRUCTURE_TEMPLATE,
  EXTENSION_PROMPTS,
  PROMPTS,
} from './templates.mjs';
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
export const PROMPT_SECTORS = Object.freeze({
  always: { title: '每道题都会跑', hint: '改这里立刻影响产出', ids: Object.freeze([...MODEL_STAGES]) },
  conditional: {
    title: '只在特定情况下跑',
    hint: '目前只有 repair：代码没通过校验时才会用到',
    ids: Object.freeze(PHASE5_STAGES.filter((s) => !MODEL_STAGES.includes(s) && s !== 'dry_run')),
  },
  'not-wired': {
    title: '还没接上主链路',
    hint: '主链路上没有这个阶段：改了**不会立刻生效**（worldbook 供词条入库、distill 供第 7 期教辅蒸馏）',
    ids: Object.freeze(['worldbook', 'distill']),
  },
  embedded: {
    title: '嵌在别的 Prompt 里',
    hint: '答案结构模板没有自己的阶段，它是 answers 正文里的一段；只有在你**没有整体覆盖 answers** 时生效',
    ids: Object.freeze([ANSWER_STRUCTURE_PROMPT_ID]),
  },
});

/** 改它就要特别小心（会**静默**坏掉下游，而不是报错） */
const HIGH_RISK_IDS = new Set(['read_problem']);

const err = (code, path, message, hint) => ({ code, path, message, ...(hint ? { hint } : {}) });

/** 内置正文（8 份里的一一对应） */
export function builtinPromptText(id) {
  if (id === ANSWER_STRUCTURE_PROMPT_ID) return ANSWER_STRUCTURE_TEMPLATE;
  const p = PROMPTS[id] ?? EXTENSION_PROMPTS[id];
  if (!p) return null;
  return p.system;
}

/** 某份 Prompt 的元信息（label / 风险 / 归属组） */
function metaOf(id) {
  const sector = Object.entries(PROMPT_SECTORS).find(([, v]) => v.ids.includes(id))?.[0] ?? null;
  if (id === ANSWER_STRUCTURE_PROMPT_ID) {
    return { id, label: '答案结构模板', duty: '`ANSWERS` 与解题结论的对齐口径（§3.3 冻结）', sector };
  }
  const p = PROMPTS[id] ?? EXTENSION_PROMPTS[id];
  return { id, label: p?.label ?? id, duty: p?.duty ?? '', sector };
}

/** 全部可编辑 Prompt 的 id（§10.1 的 6 份 + 扩展 2 份 + 答案结构模板 = 8 + 模板 = 9？见下） */
export function editablePromptIds() {
  return [
    ...[...PROMPT_SECTORS.always.ids],
    ...[...PROMPT_SECTORS.conditional.ids],
    ...[...PROMPT_SECTORS['not-wired'].ids],
    ANSWER_STRUCTURE_PROMPT_ID,
  ];
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
  const meta = metaOf(id);
  if (meta.sector === 'not-wired') {
    warnings.push({
      code: 'prompt.not-wired',
      path: rel,
      message: '这一份 Prompt 现在**不会被调用**，保存了也不会立刻生效',
      hint: '它属于"还没接上主链路"的那一组（worldbook 供词条入库、distill 供第 7 期教辅蒸馏）',
    });
  }
  if (id === ANSWER_STRUCTURE_PROMPT_ID) {
    const loaded = loadRulesWorkspace(dir ? { dir } : undefined);
    if (loaded.ok && loaded.prompts?.answers) {
      warnings.push({
        code: 'prompt.answer-structure-shadowed',
        path: rel,
        message: '你已经整体覆盖了 answers，所以这份答案结构模板**不会生效**',
        hint: '整份覆盖优先：answers 的正文里如果没带上结构模板，模型就看不到它。想让它生效请先恢复 answers 默认',
      });
    }
  }

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
