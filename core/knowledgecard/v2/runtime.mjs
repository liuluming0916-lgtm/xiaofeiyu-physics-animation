/**
 * v2 触发引擎（纯函数）。
 *
 * 与 v1 的区别：
 *   · 不再扫 keys / 次级键 / 递归唤醒；
 *   · 元件卡按 `elements` 命中，场景卡按 `scenes` 命中；
 *   · 动画规范卡按 `constant` 注入；
 *   · 只产出 `scene_code` 槽（solve 恒为空）。
 *
 * 预算/示例/来源标记复用 v1 的渲染函数，保证给模型的文本形状不变。
 */

import {
  KNOWLEDGECARD_BUDGET,
  KNOWLEDGECARD_EXAMPLE_BUDGET,
  renderEntryBlock,
  renderExampleBlock,
  splitEntryContent,
} from '../engine.mjs';

const KIND_RANK = Object.freeze({ anim_rule: 0, scene: 1, element: 2 });

function rank(entry) {
  return KIND_RANK[entry?.kind] ?? 1;
}

function orderOf(entry) {
  return Number.isFinite(entry?.order) ? entry.order : 100;
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareRetention(a, b) {
  const ka = rank(a.entry);
  const kb = rank(b.entry);
  if (ka !== kb) return ka - kb;
  const pa = a.entry.priority === 'high' ? 0 : 1;
  const pb = b.entry.priority === 'high' ? 0 : 1;
  if (pa !== pb) return pa - pb;
  const oa = orderOf(a.entry);
  const ob = orderOf(b.entry);
  if (oa !== ob) return oa - ob;
  return cmp(String(a.entry.id), String(b.entry.id));
}

function compareInjection(a, b) {
  const ka = rank(a.entry);
  const kb = rank(b.entry);
  if (ka !== kb) return ka - kb;
  const oa = orderOf(a.entry);
  const ob = orderOf(b.entry);
  if (oa !== ob) return oa - ob;
  return cmp(String(a.entry.id), String(b.entry.id));
}

/**
 * @param {{
 *   entries: object[],
 *   elements?: string[],
 *   scenes?: string[],
 *   budget?: object
 * }} input
 */
export function triggerKnowledgecardV2(input = {}) {
  const budget = { ...KNOWLEDGECARD_BUDGET, ...(input.budget ?? {}) };
  const elementSet = new Set(Array.isArray(input.elements) ? input.elements : []);
  const sceneSet = new Set(Array.isArray(input.scenes) ? input.scenes : []);
  const entries = (Array.isArray(input.entries) ? input.entries : []).filter((e) => e && typeof e === 'object' && e.enabled !== false);

  const records = new Map();
  const add = (entry, via) => {
    if (records.has(entry.id)) return;
    records.set(entry.id, { entry, via });
  };

  for (const e of entries) {
    if (e.constant === true) add(e, 'constant');
  }
  for (const e of entries) {
    if (e.kind === 'element' && Array.isArray(e.elements) && e.elements.some((id) => elementSet.has(id))) {
      add(e, 'element');
    }
    if (e.kind === 'scene' && Array.isArray(e.scenes) && e.scenes.some((id) => sceneSet.has(id))) {
      add(e, 'scene');
    }
  }

  const warnings = [];
  const candidates = [...records.values()].map((r) => {
    const split = splitEntryContent(r.entry, 'scene_code');
    if (split.warning) warnings.push({ code: 'heading-missing', entryId: r.entry.id, message: split.warning });
    const block = renderEntryBlock('scene_code', r.entry.title ?? r.entry.id, split.text);
    const example = renderExampleBlock('scene_code', r.entry);
    return { ...r, text: split.text, block, example };
  });

  const kept = [];
  const dropped = [];
  let chars = 0;
  let examplesChars = 0;
  for (const c of [...candidates].sort(compareRetention)) {
    const extra = c.example ? `\n\n${c.example}` : '';
    const len = c.block.length + extra.length;
    if (kept.length >= budget.maxEntries || chars + len > budget.maxChars) {
      dropped.push(c);
      continue;
    }
    if (c.example) examplesChars += c.example.length;
    if (examplesChars > KNOWLEDGECARD_EXAMPLE_BUDGET.maxCharsPerSlot) {
      dropped.push({ ...c, example: '' });
      continue;
    }
    kept.push({ ...c, finalText: `${c.block}${extra}` });
    chars += len;
  }

  const injected = [...kept].sort(compareInjection);
  const text = injected.map((c) => c.finalText).join('\n\n');
  const provenance = injected.map((c) => ({
    entry_id: c.entry.id,
    title: c.entry.title,
    via: c.via,
    injectedSlots: ['scene_code'],
    truncated: false,
  }));

  const slot = {
    slot: 'scene_code',
    candidates: candidates.length,
    injected: injected.map((c) => ({
      id: c.entry.id,
      title: c.entry.title,
      via: c.via,
      chars: c.finalText.length,
      exampleChars: c.example.length,
    })),
    chars,
    examplesChars,
    empty: injected.length === 0,
    truncated: dropped.length > 0,
    dropped: dropped.map((c) => ({ id: c.entry.id, title: c.entry.title })),
  };

  return {
    text: { scene_code: text },
    slots: { scene_code: slot },
    emptySlots: injected.length === 0 ? ['scene_code'] : [],
    truncatedSlots: dropped.length ? [{ slot: 'scene_code', dropped: dropped.length }] : [],
    provenance,
    warnings,
    stats: { considered: entries.length, hit: records.size, injected: injected.length, dropped: dropped.length },
  };
}

/**
 * 把 v2 触发结果整理成 `knowledgecard_done` 预期的证据形状。
 *
 * 前端 `KnowledgecardProvenance` 仍是 v1 的字段集（from / depth / key / origin /
 * declaredSlots / charsBySlot / unmounted …）。v2 卡没有这些概念，但事件形状不能漂：
 * 在这里补空值，比让界面各处判 `undefined` 安全。
 *
 * @param {object|null} result `triggerKnowledgecardV2()` 的返回值
 * @param {object[]} entries 本次快照里的 v2 卡
 */
export function knowledgecardV2Evidence(result, entries = []) {
  const slot = result?.slots?.scene_code ?? { chars: 0, injected: [], dropped: [] };
  const byId = new Map((Array.isArray(entries) ? entries : []).map((e) => [e.id, e]));
  const charsById = new Map((slot.injected ?? []).map((x) => [x.id, x.chars]));
  const droppedIds = (slot.dropped ?? []).map((d) => d.id);

  return {
    emptySlots: [...(result?.emptySlots ?? ['scene_code'])],
    truncatedSlots: (result?.truncatedSlots ?? []).map((t) => ({
      slot: t.slot,
      dropped: t.dropped,
      droppedIds,
    })),
    provenance: (result?.provenance ?? []).map((p) => {
      const entry = byId.get(p.entry_id);
      return {
        entry_id: p.entry_id,
        title: p.title,
        via: p.via,
        from: null,
        depth: 0,
        key: null,
        origin: entry?.origin ?? 'builtin',
        category: 'scene_modeling',
        declaredSlots: ['scene_code'],
        injectedSlots: [...(p.injectedSlots ?? ['scene_code'])],
        charsBySlot: { scene_code: charsById.get(p.entry_id) ?? 0 },
        unmounted: false,
        truncated: p.truncated === true,
      };
    }),
    warnings: [...(result?.warnings ?? [])],
    charsBySlot: { scene_code: slot.chars ?? 0 },
    injectedBySlot: { scene_code: (slot.injected ?? []).length },
    matched: (result?.provenance ?? []).length,
  };
}

