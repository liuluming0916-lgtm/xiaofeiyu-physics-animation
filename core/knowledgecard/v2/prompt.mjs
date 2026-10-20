/**
 * v2 判定词表与解析器（纯函数）。
 *
 * 与 v1 的区别：
 *   · 只注入两张词表：动画元件 + 场景；
 *   · 只解析三段：`【动画元件】` / `【场景】` / `【判定依据】`；
 *   · 不再有考点、题型、次级键。
 */

import { buildVocabIndexV2, normalizeWord } from './vocab.mjs';

export const JUDGEMENT_LABELS_V2 = Object.freeze({
  elements: ['动画元件', '元件', '器材', '物理图元'],
  scenes: ['场景', '题型', '物理模型'],
  why: ['判定依据', '判断依据', '判定理由', '依据', '理由'],
});

const LABEL_TO_FIELD = (() => {
  const m = new Map();
  for (const [field, labels] of Object.entries(JUDGEMENT_LABELS_V2)) {
    for (const l of labels) m.set(l, field);
  }
  return m;
})();

const EMPTY_TOKENS = new Set(['无', '無', '无。', '無。', 'none', 'null', '-', '—', '–', 'n/a', 'na', '空']);
const SPLIT_RE = /[,，、;；/|]+/;

/** 渲染 `read_problem` 用的两张词表 */
export function buildJudgementVocabV2(vocab) {
  const L = [];
  L.push('【动画元件词表】（elements：只能从下列 id 里选，可多选；依据图片 + 题面，纯文字题按题面）');
  for (const e of vocab?.elements ?? []) {
    if (e.enabled === false) continue;
    L.push(`- ${e.id}｜${e.name}`);
  }
  L.push('');
  L.push('【场景词表】（scenes：只能从下列 id 里选；一道题最多 1 个场景；判不出写"无"）');
  for (const s of vocab?.scenes ?? []) {
    if (s.enabled === false) continue;
    L.push(`- ${s.id}｜${s.name}`);
  }
  return L.join('\n');
}

/**
 * 解析模型在 `read_problem` 写出的三段判定。
 * 容错：段标记可单独一行、内容下一行；缺段/表外词一律进 problems，不抛。
 */
export function parseJudgementV2(text, { vocab, index = null } = {}) {
  const idx = index ?? buildVocabIndexV2(vocab);
  const problems = [];
  const raw = { elements: '', scenes: '', why: '' };

  if (typeof text !== 'string' || !text.trim()) {
    problems.push({ code: 'empty-input', message: '判定文本为空' });
    return { elements: [], scenes: [], unknowns: { elements: [], scenes: [] }, problems, why: '', raw };
  }

  const BRACKET_LINE = /^[ \t>*`_-]*[【\[]([^】\]\n]{1,12})[】\]][ \t]*[:：]?[ \t]*(.*)$/;
  const LABEL_LINE = /^[ \t>*`_-]*\**([^：:*`\n]{1,12})\**[ \t]*[:：][ \t]*(.*)$/;

  const collect = (label, value) => {
    const field = LABEL_TO_FIELD.get(normalizeWord(label));
    if (!field) return null;
    const v = String(value ?? '').trim();
    raw[field] = raw[field] ? `${raw[field]} ${v}` : v;
    return field;
  };

  let pending = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const b = line.match(BRACKET_LINE);
    if (b) {
      pending = collect(b[1], b[2]);
      continue;
    }
    const l = line.match(LABEL_LINE);
    if (l) {
      pending = collect(l[1], l[2]);
      continue;
    }
    if (pending) {
      const body = line.trim();
      if (body) {
        raw[pending] = raw[pending] ? `${raw[pending]} ${body}` : body;
        pending = null;
      }
    }
  }

  for (const field of ['elements', 'scenes']) {
    if (!raw[field]) problems.push({ code: 'missing-section', field, message: `模型没有输出【${field === 'elements' ? '动画元件' : '场景'}】段` });
  }

  const splitList = (s) =>
    String(s ?? '')
      .split(SPLIT_RE)
      .map((x) => normalizeWord(x))
      .filter((x) => x && !EMPTY_TOKENS.has(x.normalize('NFKC').toLowerCase()));

  const elements = [];
  const unknowns = { elements: [], scenes: [] };
  for (const w of splitList(raw.elements)) {
    const hit = idx.byWord.get(w.toLowerCase());
    if (!hit || hit.kind !== 'element') {
      unknowns.elements.push(w);
      problems.push({ code: 'unknown-element', word: w, message: `【动画元件】里的 ${JSON.stringify(w)} 不在元件词表里，已丢弃并如实报出` });
      continue;
    }
    if (!elements.includes(hit.id)) elements.push(hit.id);
  }

  const scenes = [];
  for (const w of splitList(raw.scenes)) {
    const hit = idx.byWord.get(w.toLowerCase());
    if (!hit || hit.kind !== 'scene') {
      unknowns.scenes.push(w);
      problems.push({ code: 'unknown-scene', word: w, message: `【场景】里的 ${JSON.stringify(w)} 不在场景词表里，已丢弃并如实报出` });
      continue;
    }
    if (!scenes.includes(hit.id)) scenes.push(hit.id);
  }
  if (scenes.length > 1) {
    problems.push({ code: 'too-many-scenes', scenes: [...scenes], message: `一道题最多 1 个场景；模型给了 ${scenes.length} 个，已保留第一个` });
    scenes.splice(1);
  }

  const why = String(raw.why ?? '').trim();
  if (!why) problems.push({ code: 'missing-why', message: '模型没有输出【判定依据】' });

  return { elements, scenes, unknowns, problems, why, raw };
}
