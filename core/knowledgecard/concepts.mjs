/**
 * 世界书判定解析器 · **纯函数**（第 5.7 期 S3）。
 *
 * 职责：把模型在 `read_problem` 阶段写出的判定段（`【考点】…【题型】…【器材/动画元件】…`）
 * 抠出来 → **按词表归一化** → 返回结构化结果 + **表外词** + **结构问题**。
 *
 * ── 三条硬性要求（计划 §5 S3，全部有断言，见 S6 的『W16』组）
 *
 *   ① **表外词丢弃 + 如实报出**：词表里没有的词**不许静默扔掉**，进 `unknowns`（否则"模型判了个
 *      我们没见过的考点"这件事永远看不见，而它恰恰是词表该扩编的信号）。
 *   ② **格式坏掉不许抛异常**：模型少写一段、写成别的格式、整段没有 —— 都进 `problems`，
 *      返回**空列表**，其余流程照常（读题这一步不能把整次解题打崩）。
 *   ③ **空判定是合法的**：一个考点都没判出来 ⇒ `concepts: []`，触发退化为"纯字面 keys"
 *      （灰度期口径），**不是错误**。
 *
 * ── 为什么本文件必须是"纯"的（与 `engine.mjs` 同一条理由）
 *
 * 它会被**逐字节复制**到浏览器（`tools/build-knowledgecard-web.mjs`），前端预览器要用它
 * 把"粘贴一段模型转写"解析成判定结构。所以：**不许 import 任何 node: 模块**，不许 IO。
 *
 * ⚠ 词表**不从文件读**：调用方把词表传进来（`contracts/knowledgecard-concepts.json` 的内容）。
 *   这样本模块既能在 Node 侧吃文件、也能在浏览器侧吃构建期快照，且**不需要第二份词表拷贝**。
 */

/* ────────────────────────────── 段标记 ────────────────────────────── */

/**
 * 判定段的标签名。
 *
 * ⚠ **容错是刻意的**：同一个字段允许多种写法，因为
 *   ① 词表对外改名过一次（`器材` → `实体物理图元` → `动画元件`），老 Prompt / 老会话的
 *      转写里可能还留着旧标签；
 *   ② 模型偶尔会写成 `物理图元`／`器材`／`设备`。
 *   这些**都归一到同一个字段**，而不是变成三份互不相认的结果。
 */
export const JUDGEMENT_SECTIONS = Object.freeze({
  concepts: ['考点', '考点词表', '知识点'],
  tags: ['题型', '题型标签', '细考点', '题型标签词表'],
  elements: ['动画元件', '实体物理图元', '物理图元', '器材', '元件'],
  /**
   * ⚠ `判定依据` 与 `判断依据` **都要认**：Prompt 写的是「判定依据」，
   *   而早期会话/手写里出现过「判断依据」。只认一个会让 `why` 永远是空，
   *   而"没收到理由"与"模型没写理由"在报告里长得一模一样（都进 `missing-why`）。
   */
  why: ['判定依据', '判断依据', '判定理由', '依据', '理由'],
});

/** 反向索引：标签 → 字段名 */
const LABEL_TO_FIELD = (() => {
  const m = new Map();
  for (const [field, labels] of Object.entries(JUDGEMENT_SECTIONS)) {
    for (const l of labels) m.set(l, field);
  }
  return m;
})();

/** 空值写法（模型按口径写"无"；也容错 `无。` `-` `—` `N/A`） */
const EMPTY_TOKENS = new Set(['无', '無', '无。', '無。', 'none', 'null', '-', '—', '–', 'n/a', 'na', '空']);

/** 分隔符：中英文逗号、顿号、分号、斜杠、竖线，以及 `、` 连写的空白 */
const SPLIT_RE = /[,，、;；/|]+/;

/* ────────────────────────────── 归一化 ────────────────────────────── */

/** 归一化一个"词"：去首尾空白、去包裹的引号/括号、全角转半角（NFKC）、小写 */
export function normalizeWord(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.normalize('NFKC').trim();
  // 去掉模型爱加的包裹符号与编号前缀
  s = s.replace(/^[\s*`"'「『【\[（(]+/, '').replace(/[\s*`"'」』】\]）)]+$/, '');
  s = s.replace(/^\d+[.、)]\s*/, '');
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}

/**
 * 建一个"别名 → 正式名"的归一化表（**大小写与全半角不敏感**）。
 *
 * 冲突口径：**同一个别名指向两处时，先注册的赢，并把冲突记下来**（`conflicts`）。
 *   本仓的 `contracts/knowledgecard-concepts.json` 里考点名与别名存在**刻意的重叠**
 *   （例如 `弹簧振子` 既是 `simple_harmonic` 的别名、又在别的表里出现过），
 *   所以这里**不静默**：冲突清单由 S6 的『W16』断言盯着（数量变化会红）。
 */
export function buildVocabIndex(vocab) {
  const conceptsByAlias = new Map();
  const conceptIds = new Set();
  const conceptConflicts = [];

  const addConceptAlias = (alias, id) => {
    const key = alias.normalize('NFKC').toLowerCase();
    if (!key) return;
    if (conceptsByAlias.has(key) && conceptsByAlias.get(key) !== id) {
      conceptConflicts.push({ alias, kept: conceptsByAlias.get(key), dropped: id });
      return;
    }
    conceptsByAlias.set(key, id);
  };

  for (const c of vocab?.concepts ?? []) {
    conceptIds.add(c.id);
    // 正式名与 id 都当别名注册
    addConceptAlias(c.name, c.id);
    addConceptAlias(c.id, c.id);
    for (const a of c.aliases ?? []) addConceptAlias(a, c.id);
  }

  /**
   * 细考点文本 → 归属考点集合（跨字段约束用它）。
   *
   * ⚠ 细考点重名**不在本文件里 warn，也不读进程环境变量**：
   *
   *   ① 本文件会被**逐字节复制进浏览器**（`web/src/lib/knowledgecard-concepts.js`）——
   *      一旦出现"读进程环境变量"的写法，整页会在浏览器里**抛错白屏**
   *      （门禁 ④"产物可执行性探针"正是这么逮到第一版的；那条判据按**子串**匹配，
   *       所以我连注释里都不敢写出那个写法 —— 写了它就会红）；
   *   ② 重名是**词表缺陷**，该由契约层的断言报
   *      （`contracts/_compile.mjs` 的派生断言 + `tests/knowledgecard-selftest.mjs` 的『W16』）；
   *   ③ 构建期会对同一批数据反复调用本函数，一条 warn 会刷满构建日志。
   *
   * 所以：**只如实记录到返回值里**（`tagDuplicates`），谁需要谁看。
   */
  const tagOwners = new Map();
  const tagDuplicates = [];
  for (const c of vocab?.concepts ?? []) {
    for (const t of vocab?.tags?.[c.id] ?? []) {
      if (tagOwners.has(t)) tagDuplicates.push({ tag: t, alsoIn: c.id });
      if (!tagOwners.has(t)) tagOwners.set(t, []);
      if (!tagOwners.get(t).includes(c.id)) tagOwners.get(t).push(c.id);
    }
  }

  const elementsByAlias = new Map();
  const elementIds = new Set();
  const elementConflicts = [];
  /**
   * 元件的别名冲突裁决：**正式名优先**。
   *
   * 为什么要有这条：本仓的词表里 `圆弧轨道` 同时是 `circle_track` 与 `arc_track` 的别名，
   * 而 `circle_track` 的正式名就叫「圆形轨道」、`arc_track` 的正式名才叫「圆弧轨道」。
   * "先到先得"会把 `圆弧轨道` 判给 `circle_track` —— **与作者写下的正式名矛盾**。
   * 所以：若某个 id 的**正式名**正好等于这个别名，它赢；否则先注册的赢（并记冲突）。
   */
  const elementNameOf = new Map((vocab?.elements ?? []).map((d) => [d.id, d.name]));
  const addElementAlias = (alias, id) => {
    const key = alias.normalize('NFKC').toLowerCase();
    if (!key) return;
    const prev = elementsByAlias.get(key);
    if (prev === undefined) {
      elementsByAlias.set(key, id);
      return;
    }
    if (prev === id) return;
    const prevIsName = elementNameOf.get(prev) === alias;
    const curIsName = elementNameOf.get(id) === alias;
    // 正式名优先；两边都是/都不是正式名时保持先注册的
    if (curIsName && !prevIsName) {
      elementsByAlias.set(key, id);
      elementConflicts.push({ alias, kept: id, dropped: prev, rule: '正式名优先' });
    } else {
      elementConflicts.push({ alias, kept: prev, dropped: id, rule: prevIsName ? '正式名优先' : '先注册优先' });
    }
  };
  for (const d of vocab?.elements ?? []) {
    elementIds.add(d.id);
    addElementAlias(d.name, d.id);
    addElementAlias(d.id, d.id);
    for (const a of d.aliases ?? []) addElementAlias(a, d.id);
  }

  return {
    conceptsByAlias,
    conceptIds,
    tagOwners,
    tagDuplicates,
    elementsByAlias,
    elementIds,
    conflicts: { concepts: conceptConflicts, elements: elementConflicts },
  };
}

/**
 * 别名 → 考点 id。命中返回 id，表外返回 `null`（**由调用方决定怎么报**，本函数不抛）。
 * @param {string} word
 * @param {ReturnType<typeof buildVocabIndex>} index
 */
export function normalizeConcept(word, index) {
  const w = normalizeWord(word);
  if (!w) return null;
  if (index.conceptIds.has(w)) return w; // 已经写成 id
  return index.conceptsByAlias.get(w.normalize('NFKC').toLowerCase()) ?? null;
}

/**
 * 别名 → 动画元件 id（原"器材"）。表外返回 `null`。
 */
export function normalizeElement(word, index) {
  const w = normalizeWord(word);
  if (!w) return null;
  if (index.elementIds.has(w)) return w;
  return index.elementsByAlias.get(w.normalize('NFKC').toLowerCase()) ?? null;
}

/**
 * 细考点 → 校验归属。
 *
 * 返回 `{ ok: true, tag, owners }` 或 `{ ok: false, reason: 'unknown' | 'not-in-concepts', owners }`。
 * ⚠ **它不替调用方决定"要不要丢"**：S3 的口径是"判出来的细考点若不属于任何已选考点 ⇒
 *   进 `problems` 但**仍然保留**（`tags` 里照收）" —— 因为那更可能是**考点判漏了**，
 *   而不是细考点判错了；丢掉它会把证据一起丢掉。
 */
export function normalizeTag(word, concepts, index) {
  const w = normalizeWord(word);
  if (!w) return { ok: false, reason: 'empty', owners: [] };
  const owners = index.tagOwners.get(w) ?? [];
  if (!owners.length) return { ok: false, reason: 'unknown', owners: [] };
  const selected = Array.isArray(concepts) ? concepts : [];
  const inSelected = owners.some((c) => selected.includes(c));
  return { ok: inSelected, reason: inSelected ? null : 'not-in-concepts', tag: w, owners };
}

/* ────────────────────────────── 解析 ────────────────────────────── */

/**
 * 从模型转写里抽出判定段。
 *
 * 容错口径（逐条对应"格式坏掉不许抛异常"）：
 *   · 段标记可以写成 `【考点】…`／`【考点】：…`／`**考点**：…`／行首 `考点: …`
 *   · 同一段可以出现多次（**拼接**，不是覆盖）
 *   · 完全没有某一段 ⇒ 该字段空 + 一条 `missing-section`
 *   · 整段文本为空/非字符串 ⇒ 全空 + `empty-input`，**不抛**
 *
 * @param {string} text 模型返回的原文
 * @param {{ vocab: object, index?: ReturnType<typeof buildVocabIndex> }} opts
 * @returns {{
 *   concepts: string[], tags: string[], elements: string[],
 *   unknowns: { concepts: string[], tags: string[], elements: string[] },
 *   problems: Array<object>, why: string, raw: Record<string, string>
 * }}
 */
export function parseJudgement(text, opts = {}) {
  const index = opts.index ?? buildVocabIndex(opts.vocab ?? {});
  const problems = [];
  const raw = { concepts: '', tags: '', elements: '', why: '' };

  if (typeof text !== 'string' || !text.trim()) {
    problems.push({ code: 'empty-input', message: '判定文本为空 —— 读题阶段没有任何产出' });
    return { concepts: [], tags: [], elements: [], unknowns: { concepts: [], tags: [], elements: [] }, problems, why: '', raw };
  }

  /* ① 抓段：**逐行**处理，一行只认一种写法（避免同一行被两种正则各抓一次 ⇒ 值翻倍） */
  const source = text.replace(/\r\n/g, '\n');
  /** 行首的方括号标记：`【考点】匀变速` / `[考点] 匀变速` */
  const BRACKET_LINE = /^[ \t>*`_-]*[【\[]([^】\]\n]{1,12})[】\]][ \t]*[:：]?[ \t]*(.*)$/;
  /** 兜底：`**考点**：匀变速` / `考点: 匀变速` / `考点：匀变速` */
  const LABEL_LINE = /^[ \t>*`_-]*\**([^：:*`\n]{1,12})\**[ \t]*[:：][ \t]*(.*)$/;

  const collect = (label, value) => {
    const field = LABEL_TO_FIELD.get(normalizeWord(label));
    if (!field) return null;
    const v = String(value ?? '').trim();
    raw[field] = raw[field] ? `${raw[field]} ${v}` : v;
    return field;
  };

  /**
   * ⚠ 模型常把标签**单独占一行**、内容写在下一行：
   *     【判定依据】
   *     题干给了位移与时间，求加速度。
   *   早先的实现只取"同一行"的值 ⇒ 那种写法下 `why` 永远是空，
   *   而"判定没有留下理由"与"模型没写理由"在报告里长得一模一样（都进 `missing-why`）。
   *   所以：**标签行没有值时就记下它，把下一行接到它后面**。
   */
  let pendingField = null;
  for (const line of source.split('\n')) {
    const b = line.match(BRACKET_LINE);
    if (b) {
      pendingField = collect(b[1], b[2]);
      continue;
    }
    const l = line.match(LABEL_LINE);
    if (l) {
      pendingField = collect(l[1], l[2]);
      continue;
    }
    if (pendingField) {
      const body = line.trim();
      if (body) {
        raw[pendingField] = raw[pendingField] ? `${raw[pendingField]} ${body}` : body;
        pendingField = null;
      }
      // 空行不消费 pendingField：标签与内容之间常夹一个空行
    }
  }

  for (const [field, labels] of Object.entries(JUDGEMENT_SECTIONS)) {
    if (field === 'why') continue;
    if (!raw[field]) problems.push({ code: 'missing-section', field, message: `模型没有输出【${labels[0]}】段` });
  }

  /* ② 切词 + 归一化 */
  const splitList = (s) =>
    String(s ?? '')
      .split(SPLIT_RE)
      .map((x) => normalizeWord(x))
      .filter((x) => x && !EMPTY_TOKENS.has(x.normalize('NFKC').toLowerCase()));

  const concepts = [];
  const unknowns = { concepts: [], tags: [], elements: [] };
  for (const w of splitList(raw.concepts)) {
    const id = normalizeConcept(w, index);
    if (!id) {
      unknowns.concepts.push(w);
      problems.push({ code: 'unknown-concept', word: w, message: `【考点】里的 ${JSON.stringify(w)} 不在考点词表里，已丢弃并如实报出` });
      continue;
    }
    if (!concepts.includes(id)) concepts.push(id);
  }

  const elements = [];
  for (const w of splitList(raw.elements)) {
    const id = normalizeElement(w, index);
    if (!id) {
      unknowns.elements.push(w);
      problems.push({ code: 'unknown-element', word: w, message: `【动画元件】里的 ${JSON.stringify(w)} 不在元件词表里，已丢弃并如实报出` });
      continue;
    }
    if (!elements.includes(id)) elements.push(id);
  }

  const tags = [];
  for (const w of splitList(raw.tags)) {
    const r = normalizeTag(w, concepts, index);
    if (r.reason === 'unknown') {
      unknowns.tags.push(w);
      problems.push({ code: 'unknown-tag', word: w, message: `【题型】里的 ${JSON.stringify(w)} 不在题型标签词表里，已丢弃并如实报出` });
      continue;
    }
    if (r.reason === 'not-in-concepts') {
      /**
       * ⚠ 这里的口径是**保留 + 报出**（不是丢弃）：
       *   细考点是词表里存在的合法值，它"挂不上"只说明**考点那一段判漏了**。
       *   丢掉它会让"模型其实看出了细分题型"这条证据消失，也让 S6 的负例无从复现。
       */
      problems.push({
        code: 'tag-not-in-concepts',
        word: r.tag,
        owners: r.owners,
        selectedConcepts: concepts,
        message: `【题型】的 ${JSON.stringify(r.tag)} 属于 ${r.owners.join(' / ')}，而【考点】只给了 ${concepts.join(' / ') || '（空）'}`,
      });
    }
    if (!tags.includes(w)) tags.push(w);
  }

  const why = String(raw.why ?? '').trim();
  if (!why) problems.push({ code: 'missing-why', message: '模型没有输出【判断依据】—— 判定没有留下可复核的理由' });

  return { concepts, tags, elements, unknowns, problems, why, raw };
}

/**
 * 给"表外词"做汇总（事件与报告用）。
 * @returns {{ concept: string[], tag: string[], element: string[] }}
 */
export function summarizeUnknowns(parsed) {
  const u = parsed?.unknowns ?? {};
  return {
    concept: [...new Set(u.concepts ?? [])],
    tag: [...new Set(u.tags ?? [])],
    element: [...new Set(u.elements ?? [])],
  };
}

/** 判定结果是否为空（一个字段都没有）—— 触发层据此退化为"纯字面 keys" */
export function isEmptyJudgement(parsed) {
  return !parsed || (!(parsed.concepts ?? []).length && !(parsed.tags ?? []).length && !(parsed.elements ?? []).length);
}
