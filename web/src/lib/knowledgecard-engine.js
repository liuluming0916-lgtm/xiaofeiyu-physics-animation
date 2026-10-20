/**
 * ⚠ **本文件由 `tools/build-knowledgecard-web.mjs` 从 `core/knowledgecard/engine.mjs` 逐字节复制生成，请勿手改。**
 *
 * 为什么要复制而不是"再写一份看起来一样的"：设置页的「实时试触发预览器」必须与
 * 真实请求**逐字节一致**（W10）。让两边跑**同一份字节的代码**，是唯一能结构性保证
 * 这一点的做法 —— 改本源、忘了改副本，构建期判据会直接失败。
 *
 * 开发期改世界书触发/组装逻辑：**改 `core/knowledgecard/engine.mjs`**，然后跑
 * `node tools/web-build.mjs`（它会重新复制并核对）。
 */

/**
 * 世界书引擎 · **纯逻辑**（§9.2 触发算法六步 + §9.2 第 5 步的分槽组装）。
 *
 * ── 这个文件为什么必须是"纯"的
 *
 * 前端设置页的「实时试触发预览器」（§9.5 / W15）要**边打字边显示**四个区块，
 * 而它跑在浏览器里：拿不到 `node:fs`，也不该再抄一份拼接逻辑
 * （抄一份 = 两个事实来源 = W10"预览器与实际请求逐字一致"永远做不到）。
 *
 * 所以：本文件**只依赖语言本身**（无 `node:` 导入、无 DOM、无网络），
 *      构建期由 `tools/build-knowledgecard-web.mjs` 把它**逐字节**复制成
 *      `web/src/lib/knowledgecard-engine.js`，并由 `tools/web-build.mjs` 的判据
 *      断言"副本与本源逐字节一致"——**改这里，预览器跟着改**。
 *
 * 因此：**不要在本文件里 import 任何 node: 模块**（`knowledgecardHash` 之类的
 * Node 专属能力放在 `index.mjs`）。
 *
 * ── 口径来源（全部照 §9.2 原文，未自行发挥；自行发挥处均标注"实现约定"）
 *
 *   第 1 步 主键扫描 · 第 2 步 次级逻辑 · 第 3 步 常驻合并 · 第 4 步 递归唤醒（含三重预算与环检测）
 *   第 5 步 分槽组装（空槽自动跳过）· 第 6 步 溯源记录
 */

/* ────────────────────────────── 冻结常量 ────────────────────────────── */

/**
 * §9.2 第 4 步的三重预算（**按槽位独立计算**）。
 *
 * ⚠ 方案原文只给了这三个数，没说"字符怎么数"。**实现约定**：按
 *   `maxChars` 计入的是**渲染后的整块文本**（含 `【世界书·…：标题】` 来源标记），
 *   因为那才是真正进上下文的字符量；用"正文长度"计数会系统性少算。
 *
 * ── 第 8 期：`maxChars` 24000 → 32000 → **30000**（用户两次裁决）──
 *
 * 起因是用户真题的注入面板实测：
 *   常驻教学卡 14950 字 + 命中词条 ⇒ **正文余量只剩 32 字**，于是
 *   「动画元件·坐标系与图线」整条被丢弃（模型因此压根不知道要画图），
 *   另有 5 条词条的示例一个字都进不来。
 *
 * 当时的处置是两条一起做（缺一不可）：
 *   ① 把 3 份范文里的 2 份改成**按元件触发**（常驻从 14950 降到 **8956**）；
 *   ② 预算提到 32000。
 * 只做 ① 会把"场与电/波"这两类题的范式一起砍掉；只做 ② 则继续让常驻卡吃掉六成额度。
 *
 * 上限的依据：命中词条单条约 1000–3200 字，30000 − 8956 ≈ 21000 够放 6–14 条，
 * 覆盖"元件 + 题型 + 通用兜底"的全部组合；示例还有自己的一份额度（见下）。
 *
 * ── 第 8 期定案：正文 30000 + 示例 10000 = **40000**（用户 2026-10-18）──
 *
 * 用户查阅卡片后的判断：正文池 32000 实测两次都还剩 9000+（根本用不满），
 * 与其让额度闲置，不如把它挪给**真正缺的**示例 —— 于是正文降到 30000、示例池提到 10000。
 * 同时把单条示例上限从 1200 抬到 2000（58/79 条卡的示例天生就超过 1200），并加**示例去重**。
 */
export const KNOWLEDGECARD_BUDGET = Object.freeze({
  maxDepth: 3,
  maxEntries: 40,
  maxChars: 30000,
  /**
   * ── 第 8 期：**一个槽位的"正文 + 示例"合计上限**（用户 2026-10-18 定案）──
   *
   * 30000（正文）+ 10000（示例）= 40000。这个数**必须单独存在**：
   * 旧实现用 `maxChars − 正文` 当示例额度，等于把示例塞进正文的 30000 里，
   * 于是"合计 40000"从来没生效过，示例永远只有正文剩下的零头。
   */
  maxTotalChars: 40000,
});

/**
 * **示例预算**（第 8 期 · L3）。
 *
 * 背景：词条的 `code_examples` 在此之前**从来没进过上下文** —— `renderEntryBlock` 只拼 `content`。
 * 库里 191 段示例（全部过了 C1）就这么躺着，模型一行都看不到；而"示例太少"正是打回率高的主因。
 *
 * 为什么必须有**独立**的第二份额度，而不是直接并进 `maxChars`：
 *   若示例和正文抢同一份额度，一条带大段示例的词条会把**真正讲这道题的那几条**挤掉 ——
 *   那是静默变差（链路照样跑完，只是模型手里的规范少了）。
 *   所以：**正文先按原口径选完**（`maxChars` / `maxEntries` 不变），
 *   然后只在"已经入选的词条"上追加示例，且受这里的两个上限约束。示例永远**只会少给，不会挤掉正文**。
 *
 * 另外两条口径（都是刻意的）：
 *   · 示例只进 `scene_code` 槽 —— 它们大多是 `drawFrame:` 片段，塞进解题阶段是纯噪音；
 *   · `constant: true` 的常驻词条**不带示例** —— 那几条卡片的正文本身就是教学（含完整范文），
 *     再叠一遍示例就是重复吃额度。
 */
export const KNOWLEDGECARD_EXAMPLE_BUDGET = Object.freeze({
  /**
   * 单条词条的示例最多占这么多字符（超了整条不给，避免给出半截代码）。
   *
   * 第 8 期定案 2000：实测全部内置卡里**58/79 条的示例超过 1200**（最长 6771），
   * 也就是说旧的 1200 不是"池子紧"，而是**单条上限把大多数卡的示例直接判死**了。
   * 典型题的示例需求只有 800–2500 字（刹车题 840 / 传送带 1637 / 斜面弹簧 2514），
   * 2000 能覆盖绝大多数单条，再大的应当**把卡片里的示例写短**，而不是无限抬预算。
   */
  maxCharsPerEntry: 2000,
  /**
   * 一个槽位里的示例合计最多占这么多字符（用户 2026-10-18 定案：正文 30000 + 示例 10000 = 40000）。
   * 分配规则见下方 ⑤′：**两轮均分 + 余量补齐 + 整块去重**（去重省下的额度回流，让更多卡能进）。
   */
  maxCharsPerSlot: 10000,
  /** 哪些槽位带示例 */
  slots: Object.freeze(['scene_code']),
});

/**
 * 命中强度（§9.2 第 4 步的截断口径里出现"命中强度"，但方案未规定刻度）。
 *
 * **实现约定（第 5.7 期重定刻度）**：命中方式多了一档（概念分发），顺序按"判定越具体越强"：
 *
 *   concept+tag  5  考点 + 题型都对上 —— 最具体，最该保留
 *   concept      4  只对上考点（**tags 为空 = 该考点下的通用词条**，方案 b 兜底）
 *   key          3  灰度期：旧的字面主键命中（迟早退场）
 *   secondary    2  灰度期：旧的次级键命中
 *   element+concept 2  动画侧：元件命中且考点相交（"图上有弹簧，而且这题确实考弹簧"）
 *   element      1  动画侧：只命中元件（**只有通用条允许**；有考点的元件词条必须被收窄）
 *   constant     1  常驻（无条件注入，与题面无关）
 *   recursive    0  被别的词条唤醒（间接，最弱）
 *
 * ⚠ 顺序即 §9.2 第 4 步截断排序的第四个键（`类型 → priority → order → 命中强度`）。
 *   这条已作为口径疑问记入交付说明（方案未定义，取"越直接越强"的直觉口径）。
 */
export const HIT_STRENGTH = Object.freeze({
  'concept+tag': 5,
  concept: 4,
  key: 3,
  secondary: 2,
  'element+concept': 2,
  element: 1,
  scene: 1,
  constant: 1,
  recursive: 0,
});

/** §9.1 世界书槽位名 = 目标阶段名（冻结） */
export const KNOWLEDGECARD_SLOTS = Object.freeze(['solve', 'scene_code']);

/**
 * 知识卡类型顺序（**只含 knowledgecard 条目**）。
 *
 * 产品层知识卡有 5 类，但提示词卡走 `core/prompts`、本地规则卡走 `core/cleaner`，
 * 它们不是 knowledgecard 条目，所以这里只排 anim_rule / element / scene 三种。
 * 类型内再按 `order`；`kind` 缺省按 element（旧包兼容）。
 *
 * ⚠ 本文件会被**逐字节复制**到浏览器（`web/src/lib/knowledgecard-engine.js`），
 *   所以不能 import 任何 node: 模块。这份顺序与
 *   `contracts/spec/frozen-keys.mjs` 的 `KNOWLEDGECARD_ENTRY_KINDS` 同源，
 *   门禁 ㉒ 会断言两者逐字一致。
 */
export const KNOWLEDGECARD_KIND_ORDER = Object.freeze(['anim_rule', 'element', 'scene']);

/** 取词条类型；未知/缺省一律按 element（旧包没有 kind） */
export function kindOfEntry(entry) {
  const k = entry?.kind;
  return KNOWLEDGECARD_KIND_ORDER.includes(k) ? k : 'element';
}

/** 类型排序键：anim_rule=0 / element=1 / scene=2 */
function kindRank(entry) {
  return KNOWLEDGECARD_KIND_ORDER.indexOf(kindOfEntry(entry));
}

/**
 * 槽位在**来源标记**里的中文标签（§9.2 第 5 步⑤ 冻结格式）。
 * `【世界书·解题：<title>】` / `【世界书·动画建模：<title>】`
 */
export const SLOT_MARKER_LABEL = Object.freeze({
  solve: '解题',
  scene_code: '动画建模',
});

/** §9.4 每条内置词条必须包含的「生成后自检」小节标题（可机检；§19.3） */
export const SELF_CHECK_HEADING = '生成后自检';

/* ────────────────────────────── 归一化与主键匹配 ────────────────────────────── */

/**
 * §9.2 第 1 步的"大小写与全半角归一化"。
 *
 * `normalize('NFKC')` 负责全角→半角（`Ａ`→`A`、`１`→`1`、`　`→空格），
 * `toLowerCase()` 负责大小写。两者都是**幂等**的，可安全重复调用。
 */
export function normalizeText(input) {
  const s = typeof input === 'string' ? input : '';
  return s.normalize('NFKC').toLowerCase();
}

/** 把字面量 key 也按同一口径归一化（否则"传送带"匹配得上、全角"传送带"匹配不上） */
function normalizeKeyLiteral(key) {
  return normalizeText(key);
}

/**
 * 解析一个 key：`"/…/flags"` 视为正则，其余视为**字面量包含**。
 *
 * ⚠ 两条刻意的口径：
 *   ① **字面量 key 对"归一化后的文本"匹配**（§9.2 明说了归一化）；
 *   ② **正则 key 对"原始文本"匹配** —— 因为正则作者自己写了 flags
 *      （`/i` 管大小写），若再喂归一化文本，`/[A-Z]/` 这类写法会被悄悄破坏。
 *      这条是**实现约定**，方案的"归一化"一句只针对字符串 key。
 *
 * 非法的正则**不抛异常**：返回 `{ error }`，触发时按"不命中"处理并记一条警告
 * （§9.1 要求"正则非法须在保存时拒绝"——那是保存路径的职责；引擎不该因为
 *  一条坏 key 把整次解题打崩）。
 */
export function parseKey(rawKey) {
  const raw = typeof rawKey === 'string' ? rawKey : '';
  // `/…/flags` 形态：以 / 开头、正文 ≥1 字符、以 / 与可选 flags 结尾
  // ⚠ 只用这一个分支：早先写的"先判 startsWith/endsWith('/')"会让 `regex` 停在 null，
  //   而 `matchKey` 随后会调 `null.test(...)` ⇒ `TypeError`。一行多余的分支就够埋这个雷。
  const m = /^\/([\s\S]+)\/([a-z]*)$/.exec(raw);
  if (m) {
    const flags = m[2] ?? '';
    try {
      // ⚠ `g` / `y` 会让 `RegExp.test()` 带 lastIndex 状态：同一个正则第二次
      //   test 会从上次位置继续，于是"命中"变成"每隔一次命中一次"。
      //   这是最典型的静默 bug，这里在**构造时**就把它们摘掉。
      const clean = flags.replace(/[gy]/g, '');
      const regex = new RegExp(m[1], clean);
      return { kind: 'regex', source: m[1], flags, literal: null, regex, error: null, raw: raw };
    } catch (err) {
      return { kind: 'regex', source: m[1], flags, literal: null, regex: null, error: String(err?.message ?? err), raw: raw };
    }
  }
  return { kind: 'literal', source: raw, flags: '', literal: normalizeKeyLiteral(raw), regex: null, error: null, raw: raw };
}

/**
 * 一个 key 是否命中给定文本。
 * @param {string} rawKey
 * @param {{ normalized: string, raw: string }} text
 * @returns {{ hit: boolean, error: string|null }}
 */
export function matchKey(rawKey, text) {
  const parsed = parseKey(rawKey);
  if (parsed.error) return { hit: false, error: parsed.error };
  if (parsed.kind === 'regex') return { hit: parsed.regex.test(text.raw), error: null };
  if (!parsed.literal) return { hit: false, error: null };
  return { hit: text.normalized.includes(parsed.literal), error: null };
}

/** 准备一份"可匹配文本"（同时保留原文与归一化文，供字面量与正则分别使用） */
export function prepareText(input) {
  const raw = typeof input === 'string' ? input : '';
  return { raw, normalized: normalizeText(raw) };
}

/** 一组 key 里是否有任一命中；返回第一个命中的 key（供溯源展示），并记下**首个**正则错误 */
export function scanKeys(keys, text) {
  const list = Array.isArray(keys) ? keys : [];
  let error = null;
  for (const k of list) {
    const r = matchKey(k, text);
    if (r.hit) return { hit: true, key: k, error };
    // ⚠ 一条坏 key **不能**终止整组扫描：否则同一词条里写在它后面的合法 key 永远不会被尝试，
    //   表现是"这个词条明明写了关键词却从不命中"——最难查的那种静默失败。
    if (r.error && !error) error = r.error;
  }
  return { hit: false, key: null, error };
}

/* ────────────────────────────── 第 2 步：次级逻辑 ────────────────────────────── */

/**
 * §9.2 第 2 步的四种次级逻辑（含"list 为空"的四条口径）：
 *
 *   AND_ANY（默认） list 至少一个命中        · list 为空 ⇒ 直接通过
 *   AND_ALL        list 全部命中            · list 为空 ⇒ 直接通过
 *   OR             主键命中 或 list 任一命中 · list 为空 ⇒ 主键命中即通过
 *   NOT            主键命中 且 list 全部不命中 · list 为空 ⇒ 视为通过
 *
 * @param {object} entry
 * @param {{ normalized: string, raw: string }} text
 * @param {boolean} primaryHit 主键是否命中（OR / NOT 要用）
 */
export function evaluateSecondary(entry, text, primaryHit) {
  const sk = entry?.secondary_keys;
  const logic = sk?.logic ?? 'AND_ANY';
  const list = Array.isArray(sk?.list) ? sk.list : [];
  const empty = list.length === 0;

  if (empty) {
    // 四条口径在"空 list"下都归到"通过"，但 NOT 还要求主键命中
    if (logic === 'NOT') return primaryHit;
    if (logic === 'OR') return primaryHit;
    return true;
  }

  const hits = list.map((k) => matchKey(k, text).hit);
  const anyHit = hits.some(Boolean);
  const allHit = hits.every(Boolean);

  switch (logic) {
    case 'AND_ALL':
      return allHit;
    case 'OR':
      return primaryHit || anyHit;
    case 'NOT':
      return primaryHit && !anyHit;
    case 'AND_ANY':
    default:
      return anyHit;
  }
}

/**
 * 一条词条在"主键扫描 + 次级逻辑"下是否命中（§9.2 第 1–2 步的合成判定）。
 *
 * 关键在 §9.2 第 1 步那句"**未命中则跳过（除非 constant: true）**"：
 * 只有 `OR` 允许"主键没中、靠次级键进来"；其余三种逻辑都要求主键先命中。
 */
export function entryMatches(entry, text) {
  const primary = scanKeys(entry?.keys, text);
  const logic = entry?.secondary_keys?.logic ?? 'AND_ANY';
  const secondary = evaluateSecondary(entry, text, primary.hit);
  const hit = logic === 'OR' ? secondary : primary.hit && secondary;
  return { hit, primary, secondary, via: hit ? (primary.hit ? 'key' : 'secondary') : null, key: primary.key };
}

/* ────────────────────────────── 第 5 步④：双槽标题切分 ────────────────────────────── */

const HEADING_RE = /^##[ \t]*(解题|动画建模)[ \t]*$/gm;

/**
 * 双槽词条按 `## 解题` / `## 动画建模` 二级标题切分（§9.2 第 5 步④）。
 *
 * 口径（**逐条对应方案正文与风险表**）：
 *   · 单槽词条 ⇒ 全文（不切分）
 *   · 双槽词条且**两个标题都在** ⇒ 只取本槽对应小节
 *   · 双槽词条但标题缺失/只有一个 ⇒ **全文注入已声明槽位 + 给出提示**
 *     （§20 风险表："双槽词条正文未分标题 ⇒ 无标题时全文注入已声明槽位 + 预览器提示"）
 *
 * @returns {{ text: string, mode: 'full'|'by-heading'|'heading-missing', warning: string|null }}
 */
export function splitEntryContent(entry, slot) {
  const content = typeof entry?.content === 'string' ? entry.content : '';
  const slots = Array.isArray(entry?.insertion_slot) ? entry.insertion_slot : [];
  if (slots.length < 2 || !slots.includes('solve') || !slots.includes('scene_code')) {
    return { text: content, mode: 'full', warning: null };
  }

  const marks = [...content.matchAll(HEADING_RE)].map((m) => ({ label: m[1], at: m.index, end: m.index + m[0].length }));
  const labels = new Set(marks.map((m) => m.label));
  if (!labels.has('解题') || !labels.has('动画建模')) {
    return {
      text: content,
      mode: 'heading-missing',
      warning:
        `双槽词条「${entry?.title ?? entry?.id ?? '(未命名)'}」缺少 ` +
        '`## 解题` / `## 动画建模` 二级标题，已按全文注入其声明的槽位（§9.2 第 5 步④ 与 §20 风险表的口径）',
    };
  }

  const idx = marks.findIndex((m) => m.label === slotLabel(slot));
  if (idx === -1) {
    return {
      text: content,
      mode: 'heading-missing',
      warning: `双槽词条「${entry?.title ?? entry?.id}」没有本槽位对应的小节标题，已按全文注入`,
    };
  }
  const start = marks[idx].end;
  const stop = idx + 1 < marks.length ? marks[idx + 1].at : content.length;
  return { text: content.slice(start, stop).trim(), mode: 'by-heading', warning: null };
}

/** 槽位 → 二级标题名（与 SLOT_MARKER_LABEL 同义，单独取名是为了读起来直白） */
function slotLabel(slot) {
  return slot === 'solve' ? '解题' : '动画建模';
}

/* ────────────────────────────── 第 5 步⑤：来源标记 ────────────────────────────── */

/** §9.2 第 5 步⑤ 冻结格式：`【世界书·解题：<title>】` / `【世界书·动画建模：<title>】` */
export function renderEntryBlock(slot, title, content) {
  const label = SLOT_MARKER_LABEL[slot] ?? slot;
  return `【世界书·${label}：${title}】\n${content}`;
}

/**
 * 把一段文本里的**有效代码行**抽出来（供示例去重使用）。
 *
 * 归一化口径：trim → 连续空白压成一个空格；丢掉空行、纯注释行（// /* *）与围栏行。
 * 为什么去注释：同一段示例的注释常被改写成中文说明，逐字比会把"其实相同"的代码判成不同。
 * 为什么不再压大小写/分号：过度归一会把"确实不同"的判成相同，那会变成"该发的没发"。
 */
function codeLineSet(text) {
  const out = new Set();
  for (const raw of String(text ?? '').split('\n')) {
    /**
     * 行尾注释**整段去掉**再做比较：同一段示例的注释常被改写成中文说明
     * （实测：\`Draw.box(...) // 画物块\` 与 \`Draw.box(...) // 同一个物块\` 是同一行代码），
     * 留着注释会让"其实相同"的两条示例都发出去。
     * ⚠ 这是**只用于比较**的归一化，发出去的示例仍逐字原样。
     */
    const line = raw
      .trim()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;
    if (line.startsWith('```')) continue;
    // 示例块里的 '### 可照抄的写法…' 是模板标题，不是代码；不排除它会把"新行占比"抬高，去重就失效
    if (line.startsWith('#')) continue;
    out.add(line);
  }
  return out;
}

/**
 * 渲染一条词条的**示例段**（第 8 期 L3）。
 *
 * 返回空串表示"这条不带示例"，调用方据此不做任何追加 —— 三种情况会返回空串：
 *   ① 没有 `code_examples`；
 *   ② 槽位不在 `KNOWLEDGECARD_EXAMPLE_BUDGET.slots` 里（只有动画槽带）；
 *   ③ `constant: true`（常驻卡的正文本身就是教学）。
 *
 * ⚠ 示例是**原样**放进去的：它们已经过了 C1（门禁 ㉒『W17』逐段 lint），
 *   所以这里不要再"加工"——加工过的示例就不再是"跑过的那份"了。
 */
export function renderExampleBlock(slot, entry) {
  if (!KNOWLEDGECARD_EXAMPLE_BUDGET.slots.includes(slot)) return '';
  if (entry?.constant === true) return '';
  const list = Array.isArray(entry?.code_examples) ? entry.code_examples.filter((s) => typeof s === 'string' && s.trim()) : [];
  if (!list.length) return '';
  return ['### 可照抄的写法（已通过 C1 静态预检）', '```js', list.join('\n\n'), '```'].join('\n');
}

/**
 * 「本阶段指令」的显式标签（第 5 期新增）。
 *
 * ── 为什么必须加这一行
 *
 * 第 3 期起，编排层把**本阶段的指令正文**（`prompt.system`）借"条件段"的位置塞进
 * system 消息，并且**复用了世界书的来源标记** `【世界书·解题：<label>】`。
 * 第 5 期真词条进来后，两种东西会共用同一个标记 ⇒ 溯源分不清
 * "这条是命中词条还是阶段指令"，预览器也无法与真实请求对齐。
 *
 * 所以给它一个**独立的标签**，并且**只加不改**：世界书词条的标记格式一字不变（§9.2 冻结）。
 */
export function renderInstructionBlock(label, instruction) {
  return `【本阶段指令：${label}】\n${instruction}`;
}

/* ────────────────────────────── §9.2 完整六步 ────────────────────────────── */

/** 稳定排序键：**一律按码元比较**，不用 `localeCompare`（它随语言环境变化 ⇒ 跨机器不可复现，W11 会挂） */
function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function orderOf(entry) {
  return Number.isFinite(entry?.order) ? entry.order : 100;
}

/**
 * 预算保留顺序：`类型(anim_rule → element → scene) → priority(high 先) → order(小先)
 * → 命中强度(强先) → id`。
 *
 * 类型放在最前面，是为了让 3 张动画规范卡在预算不足时**一定**先保留；
 * 否则元素卡一多，规范卡会被静默挤掉（链路照跑、规范变少，最难发现）。
 */
function compareForRetention(a, b) {
  const ka = kindRank(a.record.entry);
  const kb = kindRank(b.record.entry);
  if (ka !== kb) return ka - kb;
  const pa = a.record.entry.priority === 'high' ? 0 : 1;
  const pb = b.record.entry.priority === 'high' ? 0 : 1;
  if (pa !== pb) return pa - pb;
  const oa = orderOf(a.record.entry);
  const ob = orderOf(b.record.entry);
  if (oa !== ob) return oa - ob;
  const sa = HIT_STRENGTH[a.record.via] ?? 0;
  const sb = HIT_STRENGTH[b.record.via] ?? 0;
  if (sa !== sb) return sb - sa;
  return cmp(String(a.record.entry.id), String(b.record.entry.id));
}

/**
 * 注入顺序（§9.2 第 5 步③）：
 * `类型(anim_rule → element → scene) → order 升序 → id`。
 *
 * 这是用户 2026-10-19 决议的顺序：动画规范卡 → 元件卡 → 场景卡。
 * 提示词卡不在这里 —— 它在 `buildSlotConditional` 的 `instructionText` 里，
 * 天然排在 knowledgecard 段之前。
 */
function compareForInjection(a, b) {
  const ka = kindRank(a.record.entry);
  const kb = kindRank(b.record.entry);
  if (ka !== kb) return ka - kb;
  const oa = orderOf(a.record.entry);
  const ob = orderOf(b.record.entry);
  if (oa !== ob) return oa - ob;
  return cmp(String(a.record.entry.id), String(b.record.entry.id));
}

/* ───────────────── 第 5.7 期：概念分发（两侧） ───────────────── */

/**
 * **两侧命中判定**（计划 §3 框图；纯函数，无副作用）。
 *
 * 解题侧（进 `solve` 槽位）：
 *   `词条 concepts ∩ 模型考点 ≠ ∅` **且**（`词条 tags ∩ 模型题型 ≠ ∅` **或** `词条 tags 为空`）
 *   ⇒ `via = 'concept+tag'`（具体）或 `'concept'`（该考点下的通用词条）
 *
 * 动画侧（进 `scene_code` 槽位）：
 *   `词条 elements ∩ 模型元件 ≠ ∅`，**再用考点收窄**：`词条 concepts ∩ 模型考点 ≠ ∅`
 *   ⇒ `via = 'element+concept'`；**只有 `concepts` 为空的通用条**才允许纯 `'element'`。
 *
 *   ⚠ 为什么要收窄：图上有弹簧 ≠ 这题考弹簧。不收窄会把"弹簧测力计那道题"教成"弹簧振子"
 *     （计划 §6 风险表："器材命中但'哪一面'不对 ⇒ 教错东西，比不教更糟"）。
 *
 * @returns {{ hit: boolean, via: string|null, matched: { concepts: string[], tags: string[], elements: string[] } }}
 */
export function matchByConcepts(entry, judgement) {
  const empty = { hit: false, via: null, matched: { concepts: [], tags: [], elements: [], scenes: [] } };
  if (!entry || !judgement) return empty;
  const jConcepts = Array.isArray(judgement.concepts) ? judgement.concepts : [];
  const jTags = Array.isArray(judgement.tags) ? judgement.tags : [];
  const jElements = Array.isArray(judgement.elements) ? judgement.elements : [];
  const jScenes = Array.isArray(judgement.scenes) ? judgement.scenes : [];

  const eConcepts = Array.isArray(entry.concepts) ? entry.concepts : [];
  const eTags = Array.isArray(entry.tags) ? entry.tags : [];
  const eElements = Array.isArray(entry.elements) ? entry.elements : [];
  const eScenes = Array.isArray(entry.scenes) ? entry.scenes : [];

  const conceptHit = eConcepts.filter((c) => jConcepts.includes(c));
  const tagHit = eTags.filter((t) => jTags.includes(t));
  const elementHit = eElements.filter((d) => jElements.includes(d));
  const sceneHit = eScenes.filter((s) => jScenes.includes(s));

  /* ── 动画侧优先判 ──
   * ⚠ 顺序很重要：一条词条**同时**声明了 concepts 与 elements 时，两侧都可能命中。
   *   若先判解题侧，它会以 `via='concept'` 进 `solve` 槽位，而**动画侧那条**就丢了
   *   （引擎按 id 幂等，首次即最终）—— 表现是"元件词条被当成解题词条抽走"。
   *   所以：**带 elements 且元件命中**的，先按动画侧定 via（element / element+concept）。
   */
  if (elementHit.length) {
    if (!eConcepts.length) {
      // 通用条（例如"阶段怎么切""视觉规范"）—— 没有考点可收窄，允许纯元件命中
      return { hit: true, via: 'element', matched: { concepts: [], tags: [], elements: elementHit, scenes: [] } };
    }
    if (conceptHit.length) {
      return { hit: true, via: 'element+concept', matched: { concepts: conceptHit, tags: [], elements: elementHit, scenes: [] } };
    }
    // 元件命中、但考点不相交 ⇒ **不收窄就不注入**（防止"图上有弹簧"就教"弹簧振子"）。
    // ⚠ 这里**不 fallthrough 到解题侧**：它声明了元件、却没声明"这题考这个元件"，
    //   放它进解题槽位就是把动画内容串味进解题（正是 §8 禁区要防的事）。
    return empty;
  }

  /* ── v2 场景侧：场景卡只按场景 id 命中（Phase 3 过渡；v1 卡没有 scenes 字段，不受影响） ── */
  if (sceneHit.length) {
    return { hit: true, via: 'scene', matched: { concepts: [], tags: [], elements: [], scenes: sceneHit } };
  }

  /* ── 解题侧 ── */
  if (conceptHit.length) {
    // `tags` 为空 = 该考点下的通用词条（方案 b）：考点对上就注入，不需要题型也对上
    if (!eTags.length) return { hit: true, via: 'concept', matched: { concepts: conceptHit, tags: [], elements: [], scenes: [] } };
    if (tagHit.length) return { hit: true, via: 'concept+tag', matched: { concepts: conceptHit, tags: tagHit, elements: [], scenes: [] } };
  }

  return empty;
}

/**
 * §9.2 第 4 步的递归唤醒是否应该用"标题字面量"来唤醒一条**没有主键**的词条。
 *
 * ⚠ **这是本期的一处口径决定，必须让用户看到**：
 *   §9.2 写的是"keys 为空的词条：constant 为真仍注入；**否则仅可被递归唤醒**"。
 *   但递归唤醒的机制是"对**其余**词条重复第 1–2 步"，而第 1–2 步是**主键匹配**——
 *   一条没有主键的词条在纯主键语义下**永远不可能被唤醒**，那句话就成了空话。
 *
 *   本实现取"让那句话成立"的读法：无主键、`recursive: true` 的词条，
 *   当**被唤醒正文里出现了它的 `title`** 时被唤醒。除 `title` 外不引入任何新字段。
 *   若用户认为应改为"无主键 ⇒ 只能靠 constant"，只需把本常量改成 `false`（一处开关）。
 */
export const WAKE_BY_TITLE_FOR_KEYLESS = true;

/**
 * §9.2 六步全流程。
 *
 * @param {object} input
 * @param {Array<object>} input.entries 词条集合（调用方保证已合并"用户覆盖副本"）
 * @param {string} input.text 题面文本 T（+ 可选的上一步解题文本，调用方拼好）
 * @param {object} [input.budget] 覆盖三重预算（测试用微型预算，生产用默认值）
 * @returns {object} 触发结果（含 `text` / `slots` / `emptySlots` / `truncatedSlots` / `provenance` / `warnings` / `stats`）
 */
export function triggerKnowledgecard(input = {}) {
  const budget = { ...KNOWLEDGECARD_BUDGET, ...(input.budget ?? {}) };
  const all = (Array.isArray(input.entries) ? input.entries : []).filter((e) => e && typeof e === 'object' && e.enabled !== false);
  const source = prepareText(input.text ?? '');
  const warnings = [];

  /** @type {Map<string, {entry: object, via: string, from: string|null, depth: number, key: string|null, seq: number}>} */
  const records = new Map();
  const addRecord = (entry, via, extra = {}) => {
    if (records.has(entry.id)) return null;
    const rec = {
      entry,
      via,
      from: extra.from ?? null,
      depth: extra.depth ?? 0,
      key: extra.key ?? null,
      /** 第 5.7 期：概念分发命中的具体项（{concepts, tags, elements}），供溯源与递归唤醒当语料 */
      matched: extra.matched ?? { concepts: [], tags: [], elements: [] },
      seq: records.size,
    };
    records.set(entry.id, rec);
    return rec;
  };

  /* ── 第 1–2 步｜主键扫描 + 次级逻辑（对题面文本 T） ── */
  for (const e of all) {
    const r = entryMatches(e, source);
    if (r.hit) addRecord(e, r.via, { key: r.key });
    if (r.primary?.error) {
      warnings.push({ code: 'bad-regex', entryId: e.id, message: `词条「${e.title ?? e.id}」的主键正则非法，已跳过：${r.primary.error}` });
    }
  }

  /* ── 第 1–2 步（第 5.7 期新增）｜**两级概念分发**（对模型的判定 J） ──
   *
   * 与上面那轮的关系是 **OR 灰度**（计划 §2 决定 4）：
   *   命中 = `concepts 相交 且（tags 相交 或 tags 为空）` **OR** `elements 命中（经考点收窄）`
   *          **OR** 旧的 `keys` 字面命中。
   * 两条路并存，所以可以**一条一条迁、随时回退**；`via` 把走了哪条路写清楚
   * （灰度期正是靠它对比两条路径的误命中率）。
   *
   * ⚠ 已经由主键命中的词条不再被概念路径覆盖：`addRecord` 对同 id 幂等（首次即最终），
   *   而主键扫描排在前面 ⇒ **旧路径优先**。这是刻意的：灰度期不改老词条的行为。
   */
  const judgement = {
    concepts: Array.isArray(input.concepts) ? input.concepts : [],
    tags: Array.isArray(input.tags) ? input.tags : [],
    elements: Array.isArray(input.elements) ? input.elements : [],
    scenes: Array.isArray(input.scenes) ? input.scenes : [],
  };
  const hasJudgement = !!(judgement.concepts.length || judgement.tags.length || judgement.elements.length || judgement.scenes.length);
  if (hasJudgement) {
    for (const e of all) {
      if (records.has(e.id)) continue; // 已由主键/次级命中的，保持原 via（灰度期旧路径优先）
      const m = matchByConcepts(e, judgement);
      if (m.hit) addRecord(e, m.via, { matched: m.matched });
    }
  }

  /* ── 第 3 步｜常驻合并（无条件加入） ── */
  for (const e of all) {
    if (e.constant === true) addRecord(e, 'constant');
  }

  /* ── 第 4 步｜递归唤醒（三重预算 maxDepth + 环检测） ── */
  const visited = new Set(records.keys());
  let frontier = [...records.values()].filter((r) => r.entry.recursive === true);
  let depth = 0;
  while (frontier.length && depth < budget.maxDepth) {
    depth += 1;
    /** @type {Array<typeof frontier[number]>} */
    const next = [];
    for (const e of all) {
      if (visited.has(e.id)) continue;
      if (e.recursive !== true) continue;

      const hasKeys = Array.isArray(e.keys) && e.keys.length > 0;
      let waker = null;
      let key = null;

      if (!hasKeys) {
        // 无主键：见 WAKE_BY_TITLE_FOR_KEYLESS 的说明
        if (!WAKE_BY_TITLE_FOR_KEYLESS) continue;
        const titleNorm = normalizeText(e.title ?? '');
        if (!titleNorm) continue;
        waker = frontier.find((f) => normalizeText(f.entry.content ?? '').includes(titleNorm)) ?? null;
      } else {
        for (const f of frontier) {
          const t = prepareText(f.entry.content ?? '');
          const r = entryMatches(e, t);
          if (r.hit) {
            waker = f;
            key = r.key;
            break;
          }
          /**
           * ── 第 5.7 期：递归唤醒的语料从"题面碎片"改为**概念名 / 标签名 / 元件名** ──
           *
           * 老口径是拿被唤醒词条的 `keys` 去碰唤醒者的**正文**（正文里出现"弹簧"就算唤醒）。
           * 新口径补一条：唤醒者已经用概念分发命中的，把它的**考点/题型/元件正式名**也当语料 ——
           * 因为 5.9 期之后词条的 `keys` 只装实体名词（改名后的 `elements`），
           * 光靠 keys 碰正文会**越来越难唤醒**（计划 §3：`keys` 此后只许装实体名词）。
           *
           * ⚠ 仍然**保留**上面那条老口径（灰度期不许改老行为）。
           */
          const wakeWords = [
            ...(f.matched?.concepts ?? []),
            ...(f.matched?.tags ?? []),
            ...(f.matched?.elements ?? []),
          ];
          if (!wakeWords.length) continue;
          const wakeText = prepareText(wakeWords.join(' '));
          const r2 = entryMatches(e, wakeText);
          if (r2.hit) {
            waker = f;
            key = r2.key;
            break;
          }
        }
      }

      if (!waker) continue;
      visited.add(e.id);
      const rec = addRecord(e, 'recursive', { from: waker.entry.id, depth, key });
      if (rec) next.push(rec);
    }
    frontier = next;
  }

  /* ── 第 5 步｜分槽组装（空槽自动跳过；每槽独立计预算） ── */
  const ordered = [...records.values()].sort((a, b) => a.seq - b.seq);
  const slotResults = {};
  const textBySlot = {};
  const emptySlots = [];
  const truncatedSlots = [];

  for (const slot of KNOWLEDGECARD_SLOTS) {
    // ① 候选集 = 命中词条中 insertion_slot 含本槽位者
    const candidates = ordered
      .filter((r) => Array.isArray(r.entry.insertion_slot) && r.entry.insertion_slot.includes(slot))
      .map((r) => {
        const split = splitEntryContent(r.entry, slot);
        if (split.warning) warnings.push({ code: 'dual-slot-heading', entryId: r.entry.id, message: split.warning });
        const block = renderEntryBlock(slot, r.entry.title ?? r.entry.id, split.text);
        return { record: r, text: split.text, mode: split.mode, block };
      });

    // ② 候选集为空 ⇒ 本槽不产出内容，**不报错、不警告**（空槽跳过；与"被截断"是两回事）
    if (candidates.length === 0) {
      emptySlots.push(slot);
      slotResults[slot] = {
        slot,
        candidates: 0,
        injected: [],
        chars: 0,
        examplesChars: 0,
        examplesIncluded: [],
        examplesDropped: [],
        empty: true,
        truncated: false,
        dropped: [],
      };
      textBySlot[slot] = '';
      continue;
    }

    // ③④⑤ 预算裁剪（保留顺序见 compareForRetention），随后按注入顺序渲染
    /**
     * ⚠ 第 8 期**撤回**上一版的"从正文里硬扣一块留给示例"（用户实测证明方向错了）。
     *
     * 上一版：为了让示例有地方，把正文上限压到 `maxChars − 6000`（30000 → 24000）。
     * 结果：正文 25885 里那句"阶段表"卡（`wb_general_modeling`，2113 字）差 228 字进不来，
     * 而它恰恰是那道题骨架的出处 —— **为了示例牺牲正文核心卡，方向错了**。
     *
     * 正确口径是用户早就定过的：**正文 30000 + 示例 10000 = 合计 40000**。
     * 正文照旧吃满 `maxChars`；示例去用"合计预算 − 正文"（见下面 ⑤′ 的 exampleRoom）。
     */
    const byRetention = [...candidates].sort(compareForRetention);
    const kept = [];
    const dropped = [];
    let chars = 0;
    for (const c of byRetention) {
      const len = c.block.length;
      if (kept.length >= budget.maxEntries || chars + len > budget.maxChars) {
        dropped.push(c);
        continue;
      }
      kept.push(c);
      chars += len;
    }

    const injected = [...kept].sort(compareForInjection);

    /**
     * ⑤′ 示例追加（第 8 期 L3）：**独立第二份额度**，只影响"给不给示例"，绝不影响谁被淘汰。
     *
     * ⚠ 但合起来仍然不许越过槽位的 `maxChars`：可用额度 = min(示例上限, 正文没用完的余量)。
     *   否则会出现"正文刚好塞满、示例再叠上去越界"——预算就形同虚设了。
     *   规则一句话：**示例抢的永远是"正文剩下的"，不是"正文已经占用的"。**
     *
     * ── 第 8 期修正：从"先到先得"改成**两轮均分**（用户真题）──
     *
     * 实测告警：`本槽有 4 条词条的示例未注入 … wb_el_rod_rail_stand、wb_el_vector、wb_el_graph、wb_el_raw_composite`。
     * 旧的贪心分配**按注入顺序先到先得**：前面几条各吃 1000+ 字，最后几条一个字都拿不到 ——
     * 而恰好被饿死的 `wb_el_vector`（矢量）与 `wb_el_graph`（图线）**正是用户点名过的那两张**。
     * 额度并不缺（正文余量 9000+），缺的是**公平**。
     *
     * 现在：
     *   第一轮 —— 每条先拿 `floor(room / n)`（n = 有示例的词条数），保证**没有一条是 0**；
     *   第二轮 —— 剩余额度按注入顺序补给"第一轮不够"的，能补多少补多少。
     * 单条上限 1200 保持（给半截代码比不给更糟）。
     */
    /**
     * ── 第 8 期定案：示例额度算**合计预算**，不再算"槽位额度减正文" ──
     *
     * 用户定的是 **正文 30000 + 示例 10000 = 合计 40000**。旧公式却是
     *   `min(示例池 10000, maxChars 30000 − 正文)`
     * 于是示例永远只能吃正文剩下的零头（实测只剩 4115），"合计 40000"形同虚设 ——
     * 这才是"示例总是被截断"的真正根因（跟均分、跟单条上限都无关）。
     *
     * 现在：`min(示例池 10000, 合计 40000 − 正文)`。
     * 代入实测：正文 25885 + 示例 10000 = 35885 ≤ 40000 ✓ —— 既不牺牲正文，
     * 示例也能拿满自己那 10000。
     */
    const totalChars = Number.isFinite(budget.maxTotalChars) ? budget.maxTotalChars : KNOWLEDGECARD_BUDGET.maxTotalChars;
    const exampleRoom = Math.min(
      KNOWLEDGECARD_EXAMPLE_BUDGET.maxCharsPerSlot,
      Math.max(0, totalChars - chars),
    );
    /**
     * 池子构成必须写进告警：正文多少、示例多少、合计多少、被哪个上限卡住。
     * （旧文案只写 `maxChars=30000`，用户看到"30000 怎么还截断"完全无从判断。）
     */
    const examplePoolNote =
      `正文 ${chars} + 示例 ${exampleRoom} = ${chars + exampleRoom} ≤ 合计 ${totalChars}` +
      `（示例池 = min(上限 ${KNOWLEDGECARD_EXAMPLE_BUDGET.maxCharsPerSlot}, 合计 ${totalChars} − 正文 ${chars})）`;
    let examplesChars = 0;
    const examplesIncluded = [];
    const examplesDropped = [];
    const examplesDeduped = [];
    let examplesDedupedChars = 0;

    /**
     * ── ⑤″ **示例去重**（用户 2026-10-18 定案："示例去重是个大工程"）──
     *
     * 问题：示例的典型形态是 `Draw.box([state.x, 0.1], 0.4, 0.3);` 这种一行一段，
     * 而**常驻范文**（那 5 张卡的正文里就有一份完整程序）与**别的卡的示例**早就在演示同一批写法。
     * 于是同一行代码可能在提示词里出现三遍：范文一遍、A 卡的示例一遍、B 卡的示例一遍。
     * 代价有两头：①白吃示例额度（把后面真正需要的卡挤掉）；②同一形态反复出现，模型更容易抄错形状。
     *
     * 做法（**整块判定，绝不截断代码**）：
     *   · 把"将要注入的正文"里所有**有效代码行**收进一个集合 `seen`（去注释行、去空行、压空白）；
     *   · 对每条示例，算它的有效代码行里**有多少行是新的**；
     *   · 新行占比 < `EX_DEDUPE_MIN_NOVEL_RATIO` ⇒ 整块视为重复，**整条不发**（并记账省下多少字）；
     *   · 不重复的示例**原样整块发**，然后把它的行也并进 `seen`（后续卡继续对它们去重）。
     *
     * ⚠ 为什么不做"行级删除"：示例的卖点是"可照抄"，抽掉中间几行就成了**跑不通的半截代码** ——
     *   那比不给更糟（模型会照抄错的）。所以只能在"整块发"与"整块不发"之间选，这条线不能松。
     */
    /**
     * 新行占比的**下限**：低于它 ⇒ 整块视为重复。
     *
     * 取值 0.30（不是 0.5）：去重的目标是"几乎全是重复"的块，
     * 而不是"有一半重复"的块 —— 后者虽然浪费，但删了会把新写法也一起丢掉。
     * 实测边界：3 行里 1 行新（33%）⇒ 仍然发；4 行里 1 行新（25%）⇒ 整块不发。
     */
    const EX_DEDUPE_MIN_NOVEL_RATIO = 0.3;
    /**
     * 均分低于这个值就**放弃均分**（用户真题第二次：池子只剩 4115、10 条候选 ⇒ 每条 411 字，
     * 而示例整块都是 1000+ 字 ⇒ 均分的结果是**一条都发不出去**）。
     * 低于它时改为"按优先级整条发，发完为止"：宁可只发 3 条完整的，也不发 10 段废片。
     */
    const MIN_MERGE_SHARE = 500;
    const seenCodeLines = new Set();
    for (const c of injected) for (const line of codeLineSet(c.block)) seenCodeLines.add(line);

    /** 只对"真的有示例"的词条分配（没有示例的条目不该占名额） */
    const withExampleAll = injected
      .map((c) => ({ c, ex: renderExampleBlock(slot, c.record.entry) }))
      .filter((x) => x.ex);

    const withExample = withExampleAll;
    const n = withExample.length;
    const fairShare = n ? Math.floor(exampleRoom / n) : 0;

    /**
     * 去重**与预算同一遍做**，而不是先过一遍去重再分配。
     *
     * ⚠ 这个顺序很关键：如果先去重、再分配，就会出现"第一条被判为"代表者"、但它随后被额度丢掉"
     *   ⇒ 那一形态**一条都没发出去**（判定时以为有人发，分配时又没发）。
     *   现在只有**真正发出去**的示例才把行并入 seen，于是"代表者"是那条活下来的。
     */
    const tryTake = (c, ex, maxTake = null) => {
      const lines = [...codeLineSet(ex)];
      const novel = lines.filter((l) => !seenCodeLines.has(l));
      const novelRatio = lines.length ? novel.length / lines.length : 0;
      if (lines.length && novelRatio < EX_DEDUPE_MIN_NOVEL_RATIO) {
        examplesDeduped.push(String(c.record.entry.id));
        examplesDedupedChars += ex.length;
        return 'deduped';
      }
      const room = exampleRoom - examplesChars;
      const grant = maxTake === null ? room : Math.min(maxTake, room);
      if (ex.length > grant) return 'tight';
      c.exampleText = ex;
      examplesChars += ex.length;
      examplesIncluded.push(String(c.record.entry.id));
      for (const line of lines) seenCodeLines.add(line);
      return 'taken';
    };

    /**
     * 两条路线（第 8 期）：
     *   · 份额够（≥ MIN_MERGE_SHARE）⇒ 两轮均分 + 余量补齐（公平，人人有份）；
     *   · 份额不够 ⇒ **按优先级整条发**（谁重要谁拿完整的），发完为止。
     * 这样"卡太多、池子太小"时不会退化成"每人都是一小段放不下的片段"。
     */
    const shareMode = !n || fairShare >= MIN_MERGE_SHARE ? 'fair' : 'priority';
    if (shareMode === 'priority') {
      for (const { c, ex } of withExample) {
        if (ex.length > KNOWLEDGECARD_EXAMPLE_BUDGET.maxCharsPerEntry) {
          examplesDropped.push(String(c.record.entry.id));
          continue;
        }
        const r = tryTake(c, ex);
        if (r === 'tight') examplesDropped.push(String(c.record.entry.id));
      }
    }

    /** 第一轮：均分（保证没有一条被饿死）；超单条上限的直接没有资格 */
    const pending = [];
    for (const { c, ex } of shareMode === 'priority' ? [] : withExample) {
      if (ex.length > KNOWLEDGECARD_EXAMPLE_BUDGET.maxCharsPerEntry) {
        examplesDropped.push(String(c.record.entry.id));
        continue;
      }
      const r = tryTake(c, ex, fairShare);
      if (r === 'tight') pending.push({ c, ex });
    }
    /** 第二轮：余量补给被截断的（顺序 = 注入顺序）；这时再对去重判一次 */
    for (const { c, ex } of pending) {
      const r = tryTake(c, ex);
      if (r === 'tight') examplesDropped.push(String(c.record.entry.id));
    }
    if (examplesDeduped.length) {
      /**
       * 去重是**可审计**的：省了多少字、哪几条被判定为重复，都要能在报告里查到。
       * 不静默 —— 否则"示例没进上下文"会被误以为是额度不够。
       */
      warnings.push({
        code: 'example-deduped',
        slot,
        message:
          `本槽有 ${examplesDeduped.length} 条词条的示例与**已注入的正文/前面的示例**重复（新代码行占比 < ${Math.round(
            EX_DEDUPE_MIN_NOVEL_RATIO * 100,
          )}%），整条未重复发送，省下约 ${examplesDedupedChars} 字：` +
          examplesDeduped.join('、') +
          '。同一形态不必发两遍（重复只会挤掉别的卡，也更容易让模型抄错形状）。',
      });
    }
    if (examplesDropped.length) {
      warnings.push({
        code: 'example-budget-skipped',
        slot,
        message:
          `本槽有 ${examplesDropped.length} 条词条的示例未注入（单条 ≤${KNOWLEDGECARD_EXAMPLE_BUDGET.maxCharsPerEntry}；` +
          `${examplePoolNote}；` +
          `${n} 条示例候选 ${fairShare >= MIN_MERGE_SHARE ? `均分 → 每条 ${fairShare} 字，余量再按序补齐` : `均分只有 ${fairShare} 字（装不下任何完整示例）⇒ 改为按优先级整条发，发完为止`}）：` +
          examplesDropped.join('、') +
          '。**正文没有受影响**（示例只吃"正文剩下的额度"）。',
      });
    }

    textBySlot[slot] = injected
      .map((c) => (c.exampleText ? `${c.block}\n\n${c.exampleText}` : c.block))
      .join('\n\n');

    if (dropped.length) {
      truncatedSlots.push({ slot, dropped: dropped.length, droppedIds: dropped.map((c) => String(c.record.entry.id)) });
      warnings.push({
        code: 'budget-truncated',
        slot,
        /**
         * 第 8 期：文案必须写出**实际生效**的三个上限，并说明"示例不吃正文的额度"。
         * 用户上一次看到 `maxChars=30000` 却在 24000 就截断（那是我上一版"预留"留下的错），
         * 从此对这条告警不再信任 —— 所以这里把两个池子都列清楚。
         */
        message:
          `本槽因三重预算截断 ${dropped.length} 条词条（maxEntries=${budget.maxEntries} / 正文上限 ${budget.maxChars} 字；` +
          `示例另有 ${KNOWLEDGECARD_EXAMPLE_BUDGET.maxCharsPerSlot} 字、合计 ${Number.isFinite(budget.maxTotalChars) ? budget.maxTotalChars : KNOWLEDGECARD_BUDGET.maxTotalChars} 字，` +
          `**示例不吃正文额度**）：` +
          dropped.map((c) => c.record.entry.title ?? c.record.entry.id).join('、'),
      });
    }

    slotResults[slot] = {
      slot,
      candidates: candidates.length,
      injected: injected.map((c) => ({
        id: c.record.entry.id,
        title: c.record.entry.title ?? c.record.entry.id,
        via: c.record.via,
        from: c.record.from,
        mode: c.mode,
        chars: c.block.length,
        /** 这条词条**追加的示例**占多少字符（0 = 没给示例）。`chars` 仍只算正文（预算口径） */
        exampleChars: c.exampleText ? c.exampleText.length : 0,
      })),
      chars,
      /** 示例合计字符数（第 8 期 L3，**不计入** `chars`：`chars` 是正文预算口径） */
      examplesChars,
      examplesIncluded,
      examplesDropped,
      /** 因"与正文/前面的示例重复"而整条未发的示例（第 8 期'示例去重'） */
      examplesDeduped,
      examplesDedupedChars,
      empty: false,
      truncated: dropped.length > 0,
      dropped: dropped.map((c) => ({ id: c.record.entry.id, title: c.record.entry.title ?? c.record.entry.id })),
    };
  }

  /* ── 第 6 步｜溯源记录 ── */
  const injectedIdsBySlot = {};
  for (const slot of KNOWLEDGECARD_SLOTS) {
    for (const it of slotResults[slot].injected) (injectedIdsBySlot[it.id] ??= []).push(slot);
  }
  const charsBySlotById = {};
  for (const slot of KNOWLEDGECARD_SLOTS) {
    for (const it of slotResults[slot].injected) (charsBySlotById[it.id] ??= {})[slot] = it.chars;
  }
  const droppedIds = new Set(truncatedSlots.flatMap((t) => t.droppedIds));

  const provenance = ordered.map((r) => {
    const slots = Array.isArray(r.entry.insertion_slot) ? [...r.entry.insertion_slot] : [];
    return {
      entry_id: r.entry.id,
      title: r.entry.title ?? r.entry.id,
      // 命中方式：key / secondary / concept+tag / concept / element+concept / element / constant / recursive(来源 id)
      via: r.via,
      from: r.from,
      depth: r.depth,
      key: r.key,
      /** 第 5.7 期：概念分发命中的具体项（哪几个考点 / 题型 / 元件对上了） */
      matched: r.matched ?? { concepts: [], tags: [], elements: [] },
      origin: r.entry.origin ?? 'user',
      category: r.entry.category ?? 'user_lore',
      priority: r.entry.priority ?? 'normal',
      order: orderOf(r.entry),
      constant: r.entry.constant === true,
      recursive: r.entry.recursive === true,
      // 实际注入槽位（可能是双槽词条的子集）
      declaredSlots: slots,
      injectedSlots: injectedIdsBySlot[r.entry.id] ?? [],
      charsBySlot: charsBySlotById[r.entry.id] ?? {},
      // `[]` 词条：不参与注入，但必须有明确标记（§19.2）
      unmounted: slots.length === 0,
      truncated: droppedIds.has(String(r.entry.id)),
    };
  });

  return {
    /** 每个槽位**已渲染好**的拼接内容（含来源标记；空槽为 `''`） */
    text: textBySlot,
    slots: slotResults,
    /**
     * ⚠ 16.3 ③ 的硬要求：**空槽**与**被截断**必须在数据结构上就是两个字段。
     *   靠 UI 各自判断会让"动画槽空"与"该槽词条全被截断"在外观上无法区分
     *   （§9.2 的"重要边界"）。
     */
    emptySlots,
    truncatedSlots,
    provenance,
    warnings,
    stats: {
      scanned: all.length,
      matched: ordered.length,
      byVia: {
        'concept+tag': ordered.filter((r) => r.via === 'concept+tag').length,
        concept: ordered.filter((r) => r.via === 'concept').length,
        'element+concept': ordered.filter((r) => r.via === 'element+concept').length,
        element: ordered.filter((r) => r.via === 'element').length,
        key: ordered.filter((r) => r.via === 'key').length,
        secondary: ordered.filter((r) => r.via === 'secondary').length,
        constant: ordered.filter((r) => r.via === 'constant').length,
        recursive: ordered.filter((r) => r.via === 'recursive').length,
      },
      /** 灰度期对比用：概念路径 vs 字面路径各命中多少条（计划 §7 风险表） */
      judgementProvided: hasJudgement,
      judgement: { ...judgement },
      maxDepth: depth,
      budget,
      charsBySlot: Object.fromEntries(KNOWLEDGECARD_SLOTS.map((s) => [s, slotResults[s].chars])),
      injectedBySlot: Object.fromEntries(KNOWLEDGECARD_SLOTS.map((s) => [s, slotResults[s].injected.length])),
    },
  };
}

/* ────────────────────────────── 条件段渲染（预览器与真实请求共用） ────────────────────────────── */

/**
 * 把"本阶段指令 + 命中词条"渲染成 §10.2 的**条件段**文本。
 *
 * ⚠ 这是 W10（预览器与实际请求**逐字节一致**）的唯一实现：
 *   设置页的预览器与 `core/prompts/fixed-prefix.mjs` 的 `buildConditionalSegment()`
 *   都调这一个函数 —— 不许在别处再拼一遍。
 *
 * @param {{ slot?: string, instruction?: string|null, instructionLabel?: string|null, segment?: string }} input
 */
export function buildSlotConditional(input = {}) {
  const slot = input.slot ?? 'solve';
  const raw = typeof input.instruction === 'string' ? input.instruction.trim() : '';
  const instructionText = raw ? renderInstructionBlock(input.instructionLabel ?? (slot === 'scene_code' ? '动画代码' : '解题'), raw) : '';
  const knowledgecardText = typeof input.segment === 'string' ? input.segment : '';
  const parts = [instructionText, knowledgecardText].filter(Boolean);
  return {
    text: parts.join('\n\n'),
    // ⚠ 两个组成部分**必须由这里返回**，不要让调用方用 `text.split('\n\n')` 去猜 ——
    //   词条正文里本来就有空行，用分隔符反推会把正文切碎。
    instructionText,
    knowledgecardText,
    hasInstruction: Boolean(instructionText),
    hasKnowledgecard: Boolean(knowledgecardText),
  };
}

/**
 * 预览器/编排共用的一步到位入口：**题面 + 判定 → 该槽位最终拼接内容**。
 *
 * 返回 `{ text, result }`：`text` 就是会进 system 消息的那一段。
 *
 * ⚠ 第 5.7 期：`concepts / tags / elements` 三个可选输入**必须原样透传给 `triggerKnowledgecard`**，
 *   否则"预览器 = 真实请求"（W10）会在概念分发这条新路径上破掉 ——
 *   预览器不传判定、真实请求传了，两边抽到的词条就不是同一批。
 */
export function buildSlotPreview({
  entries,
  slot,
  text,
  budget,
  concepts,
  tags,
  elements,
  instruction = null,
  instructionLabel = null,
}) {
  const result = triggerKnowledgecard({ entries, text, budget, concepts, tags, elements });
  const seg = result.text[slot] ?? '';
  const built = buildSlotConditional({ slot, instruction, instructionLabel, segment: seg });
  return { text: built.text, result, knowledgecardText: seg, wordCount: built.text.length };
}

/* ────────────────────────────── 触发词撞车（第 5.5 期 P2） ────────────────────────────── */

/**
 * **触发词撞车检查**：不同词条的**主键**之间是否"完全相同"或"存在包含关系"。
 *
 * ── 为什么需要它（这是上百条词条并存时最容易翻车的地方）
 *
 * §9.2 的匹配是"字面量包含"。所以：
 *   · 若 A 用了「物块」、B 用了「物块」⇒ **两条同时命中**，上下文里多塞一段无关规范；
 *   · 若 A 用了「带」、B 用了「传送带」⇒ **「带」会把「传送带」的题面也吃掉**，
 *     A（可能是个更窄的题型）会在一个不属于它的题上被唤醒。
 * 这两种都不会让任何**现有**检查变红（C1–C9 判的是代码，不是上下文）——
 * 表现只是"解题质量莫名其妙地差"，是本项目最忌讳的静默失败。
 *
 * ── 口径（都是刻意的，写在注释里以便复核）
 *
 *   · **只比主键 `keys`**：`secondary_keys` 天生就该重复（"物块"会出现在几十条的次级键里），
 *     比它只会刷出一屏噪音。
 *   · **只在"两个词条会被注入同一个槽位"时才比**：一个只进 `solve`、一个只进 `scene_code`
 *     ⇒ 它们永远不会同时出现在同一段上下文里，不算撞车。
 *   · **不按 `enabled` 过滤**：这是**编辑期的提示**（你可能正要重新启用某条），
 *     而不是运行时的判定。真正运行时只看 enabled 的条目。
 *   · **只提示、不阻断**（与 §9.5 的"冲突提示"同类）：合法的包含关系确实存在
 *     （例如「斜抛」与「抛体」），要由人判断，不该由程序拦。
 *
 * @param {Array<object>} entries
 * @returns {Array<{code: string, level: 'warn', entryIds: string[], keys: string[], kind: 'same'|'subset', message: string}>}
 */
export function detectKeyCollisions(entries = []) {
  const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e === 'object') : [];
  const slotsOf = (e) => (Array.isArray(e.insertion_slot) ? e.insertion_slot : []);

  /** @type {Array<{entry: object, key: string, norm: string}>} */
  const literals = [];
  for (const e of list) {
    for (const k of Array.isArray(e.keys) ? e.keys : []) {
      const parsed = parseKey(k);
      // 正则 key 不参与撞车比对：它的语义由作者自己控制（`/…/i` 之类），
      // 用"字符串包含"去判断它只会产生误报。
      if (parsed.kind !== 'literal' || !parsed.literal) continue;
      literals.push({ entry: e, key: k, norm: parsed.literal });
    }
  }

  const out = [];
  const seen = new Set();
  for (let i = 0; i < literals.length; i += 1) {
    for (let j = i + 1; j < literals.length; j += 1) {
      const a = literals[i];
      const b = literals[j];
      if (a.entry.id === b.entry.id) continue;
      if (!slotsOf(a.entry).some((s) => slotsOf(b.entry).includes(s))) continue;

      let kind = null;
      if (a.norm === b.norm) kind = 'same';
      else if (a.norm.includes(b.norm) || b.norm.includes(a.norm)) kind = 'subset';
      if (!kind) continue;

      const dedupe = [a.entry.id, b.entry.id, a.key, b.key].map(String).sort().join('|');
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const nameOf = (e) => `${e.title ?? e.id}（${e.id}）`;
      out.push({
        code: 'key-collision',
        level: 'warn',
        entryIds: [a.entry.id, b.entry.id],
        keys: [a.key, b.key],
        kind,
        message:
          kind === 'same'
            ? `触发词完全相同：「${nameOf(a.entry)}」与「${nameOf(b.entry)}」都用了主键「${a.key}」⇒ 两条会同时命中；请合并词条或改词`
            : `触发词存在包含关系：「${a.key}」⊂/⊃「${b.key}」（${nameOf(a.entry)} / ${nameOf(b.entry)}）⇒ 短词会把长词的题面也吃掉；建议把短词挪进 secondary_keys，或用 NOT 排除`,
      });
    }
  }
  return out;
}

/* ────────────────────────────── 冲突提示（§9.5） ────────────────────────────── */

/**
 * §9.5 的冲突提示（**提示不阻断**）：同名 `id`、正则语法错误、递归环、槽位为空、双槽无标题。
 *
 * 与"保存时拒绝"不同：这些是**编辑期的提示**，让用户看见风险而不是被拦住。
 *
 * @param {Array<object>} entries
 * @returns {Array<{code: string, level: 'error'|'warn'|'info', entryIds: string[], message: string}>}
 */
export function detectConflicts(entries = []) {
  const out = [];
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];

  // ① 同名 id
  const byId = new Map();
  for (const e of list) {
    const arr = byId.get(e.id) ?? [];
    arr.push(e);
    byId.set(e.id, arr);
  }
  for (const [id, arr] of byId) {
    if (arr.length > 1) {
      out.push({ code: 'duplicate-id', level: 'error', entryIds: [id], message: `词条 id 重复：${id}（共 ${arr.length} 条，命中时无法区分）` });
    }
  }

  // ② 正则语法错误
  for (const e of list) {
    for (const k of Array.isArray(e.keys) ? e.keys : []) {
      const parsed = parseKey(k);
      if (parsed.error) {
        out.push({ code: 'bad-regex', level: 'error', entryIds: [e.id], message: `词条「${e.title ?? e.id}」的主键正则非法：${k} —— ${parsed.error}` });
      }
    }
    for (const k of Array.isArray(e.secondary_keys?.list) ? e.secondary_keys.list : []) {
      const parsed = parseKey(k);
      if (parsed.error) {
        out.push({ code: 'bad-regex', level: 'error', entryIds: [e.id], message: `词条「${e.title ?? e.id}」的次级键正则非法：${k} —— ${parsed.error}` });
      }
    }
  }

  // ③ 槽位为空的词条（提示不阻断；§19.2 要求它有明确 UI 标记）
  for (const e of list) {
    if (!Array.isArray(e.insertion_slot) || e.insertion_slot.length === 0) {
      out.push({
        code: 'unmounted',
        level: 'info',
        entryIds: [e.id],
        message: `词条「${e.title ?? e.id}」未挂槽位（insertion_slot 为空），不会注入任何槽位`,
      });
    }
  }

  // ④ 双槽词条缺 `## 解题` / `## 动画建模` 标题
  for (const e of list) {
    const slots = Array.isArray(e.insertion_slot) ? e.insertion_slot : [];
    if (slots.length >= 2) {
      const split = splitEntryContent(e, 'solve');
      if (split.mode === 'heading-missing') {
        out.push({
          code: 'dual-slot-heading',
          level: 'warn',
          entryIds: [e.id],
          message: `双槽词条「${e.title ?? e.id}」没有 \`## 解题\` / \`## 动画建模\` 标题，两个槽位都会拿到全文（会互相串味）`,
        });
      }
    }
  }

  // ⑤ 递归环（A→B→A）：§9.2 第 4 步的环检测保证不死循环，这里只做**提示**
  for (const e of list) {
    if (e.recursive !== true) continue;
    const back = list.filter(
      (o) => o.id !== e.id && o.recursive === true && normalizeText(o.content ?? '').includes(normalizeText(e.title ?? '\u0000')),
    );
    if (back.length) {
      out.push({
        code: 'recursive-cycle',
        level: 'info',
        entryIds: [e.id, ...back.map((b) => b.id)],
        message: `词条「${e.title ?? e.id}」与 ${back.map((b) => b.title ?? b.id).join('、')} 之间可能互相唤醒（环检测会保证只注入一次，不会死循环）`,
      });
    }
  }

  // ⑥ 触发词撞车（第 5.5 期 P2）：上百条并存时最容易翻车的地方，编辑器里必须看得见
  out.push(...detectKeyCollisions(list));

  /* ⑦⑧ 第 5.7 期：概念分发带来的两类新撞车（同样是"提示不阻断"） */
  out.push(...detectTagCollisions(list));
  out.push(...detectElementCollisions(list));

  return out;
}

/* ───────────────── 第 5.7 期：标签撞车 / 元件撞车（提示不阻断） ───────────────── */

/**
 * **标签撞车**：两条词条**考点相交**、且共用了同一个 `tags` 项 ⇒ 报撞车。
 *
 * ⚠ 为什么判据里带"考点相交"（而不是全局比较 tags）：
 *   同一个细考点文本在不同考点下是**正常复用**（本仓当前没有这种重名，但口径要立住）。
 *   只有"两条词条会在同一道题上同时被唤醒"时，撞车才是真问题 ——
 *   而"考点相交"正是那种情况的前提。
 *
 * 与 `detectKeyCollisions` 一样：**只提示、不阻断**（返回 `level: 'warn'`）。
 */
export function detectTagCollisions(entries = []) {
  const out = [];
  const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
  const nameOf = (e) => e.title ?? e.id;

  /** tag → 命中过它的词条（同时记下该词条的考点集合） */
  const byTag = new Map();
  for (const e of list) {
    const concepts = Array.isArray(e.concepts) ? e.concepts : [];
    for (const t of Array.isArray(e.tags) ? e.tags : []) {
      const arr = byTag.get(t) ?? [];
      arr.push({ entry: e, concepts });
      byTag.set(t, arr);
    }
  }

  for (const [tag, hits] of byTag) {
    for (let i = 0; i < hits.length; i += 1) {
      for (let j = i + 1; j < hits.length; j += 1) {
        const a = hits[i];
        const b = hits[j];
        if (a.entry.id === b.entry.id) continue; // 同一条词条内部不算撞车
        const shared = a.concepts.filter((c) => b.concepts.includes(c));
        if (!shared.length) continue; // 考点不相交 ⇒ 永远不会同时进同一段上下文
        out.push({
          code: 'tag-collision',
          level: 'warn',
          entryIds: [a.entry.id, b.entry.id],
          tag,
          concepts: shared,
          message:
            `标签撞车：「${nameOf(a.entry)}」与「${nameOf(b.entry)}」在考点 ${shared.join(' / ')} 下共用了题型标签「${tag}」` +
            `⇒ 这道题会把两条词条同时抽出来。要么删掉其中一条的该标签（留一条做通用），要么把它们的考点分开`,
        });
      }
    }
  }
  return out;
}

/**
 * **元件撞车**：两条词条的 `elements` 有交集 ⇒ 报"同义/包含"提示。
 *
 * ⚠ 与标签撞车不同，这条**不要求考点相交**：元件是动画侧触发源，
 *   "两条词条都教同一个元件怎么画"本身就是需要作者知道的事（要么合并，要么分工）。
 *   若两条的考点也相交，则额外提示"这题会同时抽到两条"。
 */
export function detectElementCollisions(entries = []) {
  const out = [];
  const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
  const nameOf = (e) => e.title ?? e.id;

  const byElement = new Map();
  for (const e of list) {
    for (const d of Array.isArray(e.elements) ? e.elements : []) {
      const arr = byElement.get(d) ?? [];
      arr.push(e);
      byElement.set(d, arr);
    }
  }

  for (const [element, es] of byElement) {
    if (es.length < 2) continue;
    for (let i = 0; i < es.length; i += 1) {
      for (let j = i + 1; j < es.length; j += 1) {
        const a = es[i];
        const b = es[j];
        const ca = Array.isArray(a.concepts) ? a.concepts : [];
        const cb = Array.isArray(b.concepts) ? b.concepts : [];
        const shared = ca.filter((c) => cb.includes(c));
        out.push({
          code: 'element-collision',
          level: 'warn',
          entryIds: [a.id, b.id],
          element,
          concepts: shared,
          message:
            `元件撞车：「${nameOf(a)}」与「${nameOf(b)}」都声明了动画元件「${element}」` +
            (shared.length
              ? `，且考点 ${shared.join(' / ')} 相交 ⇒ 这道题会把两条同时抽出来（动画侧更容易打满预算）`
              : '（考点不相交 ⇒ 只有在"只用元件收窄不了"的通用条场景才会同时出现）') +
            `。建议：一条讲这个元件怎么调原语，另一条讲它在某考点下怎么用`,
        });
      }
    }
  }
  return out;
}
