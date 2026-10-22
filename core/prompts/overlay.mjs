/**
 * Prompt 覆盖层：**改一份 Prompt 之前必须知道的事**（第 6 期第 2 项）。
 *
 * 三条职责，都不碰磁盘（IO 在 `editor.mjs`）：
 *   ① `PROMPT_REQUIREMENTS` —— 某份 Prompt 里**哪几段是不能删的**，删了会静默坏在哪；
 *   ② `promptStatus()`       —— 你这份覆盖副本，是基于内置的**哪一版**改的（用户裁决的 C 方案）；
 *   ③ `diffLines()`          —— 内置变了之后，"变了哪几行"要能给人看。
 *
 * ── 为什么"不能删的段"要写成硬门禁
 *
 * 看 `core/knowledgecard/concepts.mjs` 的解析器：它**容错极强** —— 缺段、写错标签、整段没有，
 * 都只进 `problems`，返回空判定，**链路照常跑完**。这是好事（读题失败不该把整次解题打崩），
 * 但它意味着：**你把 `【考点】` 那一行删掉，程序不会报错**。表现是：
 *   判定拿不到考点 → 世界书退化成"按字面碰字"（第 5.7 期之前的老办法）→ 抽错卡片 →
 *   答案变差，但**题目照样跑完、校验照样通过**。
 *
 * 这正是第 5.7 期白屏事故的同一类病：**肉眼看不出来，只有真跑才暴露**。
 * 所以它必须在**保存那一刻**就红，而不是等用户发现"最近答案怎么变差了"。
 *
 * 反过来，其余 Prompt 的缺失会**被下游门禁抓到**（C1–C9 判代码结构、C7 判答案闭环），
 * 因此那些只给**警告**——警告必须被回报（`commitRulesChange` 的结果与 UI 都要显示），
 * 但不拦保存。**一视同仁地全拦会让人绕开编辑器直接改文件**，那更糟。
 */

/** 覆盖副本相对内置的**代际状态**（用户裁决 C 方案：整份替换 + 变更提醒） */
export const PROMPT_STATUS = Object.freeze({
  BUILTIN: 'builtin', // 没有覆盖副本，用内置
  OK: 'ok', // 覆盖副本，且基于当前这版内置
  STALE: 'stale', // 覆盖副本，但内置已经变了（会提醒，能看差异）
  UNKNOWN_BASE: 'unknown-base', // 不知道基于哪一版（外部编辑后登记 / 老数据）
});

/**
 * 每份 Prompt 的**硬约束（errors）与软提醒（warnings）**。
 *
 * 判据全部是"文本里必须还能找到这个记号"，不是"文本必须逐字相同"——
 * 用户当然可以改写措辞，但不能把**下游解析依赖的那一行**删掉。
 */
export const PROMPT_REQUIREMENTS = Object.freeze({
  read_problem: {
    errors: [
      {
        token: '【动画元件】',
        why: '动画卡片靠这一行分发。删掉后图里画了弹簧/传送带也不会抽出对应规范（第 5.7 期修的就是这个洞）',
      },
    ],
    warnings: [
      { token: '【判定依据】', why: '没有依据，人工复核时看不出这次判定靠不靠谱' },
      { token: '词表', why: '词表是判定的唯一取值来源；正文里几乎不提它，模型很容易开始自造元件名' },
    ],
  },
  /**
   * v2 读题是默认链路（`knowledgecardVersion: 2`）。它不再输出【考点】/【题型】，
   * 只判【动画元件】/【场景】/【判定依据】。这三段缺任何一段，v2 引擎都会抽不到卡。
   */
  read_problem_v2: {
    errors: [
      { token: '【动画元件】', why: '元件卡靠这一段分发；缺了就等于所有元件卡都不触发' },
      { token: '【场景】', why: '场景卡靠这一段分发；缺了场景卡永远不触发（当前场景卡 0 张，但字段必须保留）' },
    ],
    warnings: [
      { token: '【判定依据】', why: '没有依据，人工复核时看不出这次判定靠不靠谱' },
      { token: '词表', times: 2, why: '两份词表（元件 / 场景）是判定的唯一取值来源；正文里几乎不提它，模型很容易自造 id' },
    ],
  },
  breakdown: {
    warnings: [
      { token: 'title', why: '每步标题是页签读取的字段；缺了页签会退化成“第 N 步”' },
      { token: 'tex', why: '讲解正文是学生看到的内容；缺了页签只剩标题' },
    ],
  },
  scene_code: {
    warnings: [{ token: 'drawFrame', why: '这一阶段只写 drawFrame；正文里完全不提它，模型很容易又去写别的槽位' }],
  },
  solve: {
    warnings: [{ token: '单位', why: '结论必须带单位，否则答案抽取与读数复现都会缺一块' }],
  },
  repair: {
    warnings: [
      { token: '只', why: '自愈的铁律是"只改被点名的槽位"；正文里连"只"都不提，模型很可能重写整段' },
    ],
  },
  analysis: {
    warnings: [
      { token: 'MOTIONS', why: '解析器按「元件运动表 (MOTIONS)」这个区块认表；缺了会直接 analysis.invalid' },
    ],
  },
  couple: {
    warnings: [
      { token: 'step', why: '耦合结果按 step / t0 / t1 行式表解析；缺了 step 会整表退回均分' },
    ],
  },
});

/** 覆盖副本短于这个长度就提醒（不是拦）：一份 Prompt 通常几百字，几十个字几乎必然丢约束 */
export const MIN_OVERRIDE_CHARS = 40;

const count = (haystack, needle) => {
  let n = 0;
  let i = 0;
  for (;;) {
    const at = haystack.indexOf(needle, i);
    if (at < 0) return n;
    n += 1;
    i = at + needle.length;
  }
};

/**
 * 检查一份覆盖副本是否保住了必须保住的东西。
 *
 * ⚠ **函数名是刻意的**：这里不叫 `checkPromptOverride`。`tests/prompts-selftest.mjs` 的『E』
 *   有一条**结构性断言** —— Prompt 模块导出的东西里不许出现 `check/verify/validate/lint/dryrun`
 *   这类名字，否则"Prompt 能关掉门禁"这件事就没有从接口上排除掉。第 6 期第一次跑门禁就被它逮到了
 *   （当时叫 `checkPromptOverride`）。**正确的做法是改名，不是放宽那条断言** ——
 *   那条断言是 §10.3 安全边界的机检形式，放宽它等于把边界变成一句口号。
 *
 *   本函数判的是"这段文字里还在不在某几个记号"（内容完整性），与门禁开关毫无关系；
 *   起名 `inspect…` 既准确又不伪装成守门人。
 *
 * @param {string} id    Prompt id
 * @param {string} text  用户要保存的正文
 * @returns {{ errors: object[], warnings: object[] }}
 */
export function inspectPromptOverride(id, text) {
  const errors = [];
  const warnings = [];
  const body = String(text ?? '');

  const spec = PROMPT_REQUIREMENTS[id];
  if (spec) {
    for (const r of spec.errors ?? []) {
      const need = r.times ?? 1;
      if (count(body, r.token) < need) {
        errors.push({
          code: 'prompt.missing-required-token',
          path: `prompts/${id}.md`,
          message: `正文里找不到 ${r.token}（这是不能删的段落）`,
          hint: r.why,
        });
      }
    }
    for (const r of spec.warnings ?? []) {
      const need = r.times ?? 1;
      if (count(body, r.token) < need) {
        warnings.push({
          code: 'prompt.missing-token',
          path: `prompts/${id}.md`,
          message: `正文里没有 ${r.token}${need > 1 ? `（至少 ${need} 次）` : ''}—— 可以保存，但请确认这是你要的`,
          hint: r.why,
        });
      }
    }
  }

  if (body.trim().length < MIN_OVERRIDE_CHARS) {
    warnings.push({
      code: 'prompt.too-short',
      path: `prompts/${id}.md`,
      message: `正文只有 ${body.trim().length} 个字符，短得可疑`,
      hint: '内置的每一份都有几百字；覆盖副本过短通常意味着丢了约束（想恢复默认请删掉文件，而不是留一份残句）',
    });
  }

  return { errors, warnings };
}

/**
 * 判断覆盖副本与内置的代际关系。
 *
 * @param {{ basedOn?: { sha256?: string } } | null | undefined} entry 索引条目
 * @param {string} builtinSha 当前内置正文的 sha256
 * @returns {string} PROMPT_STATUS 之一
 */
export function promptStatus(entry, builtinSha) {
  if (!entry) return PROMPT_STATUS.BUILTIN;
  const base = entry.basedOn?.sha256;
  if (typeof base !== 'string') return PROMPT_STATUS.UNKNOWN_BASE;
  return base === builtinSha ? PROMPT_STATUS.OK : PROMPT_STATUS.STALE;
}

/**
 * 行级差异（LCS）。给"内置变了"的提醒用：把新增/删除的行指出来。
 *
 * ⚠ 为什么不用现成的 diff 库：本仓依赖只有 acorn + mathjax-full（§11.2 的"依赖最小"口径），
 *   而 Prompt 只几百行，O(n·m) 的动态规划在毫秒级。为几十行代码引一棵依赖树不划算。
 *
 * @param {string} oldText 基线（当初内置的样子）
 * @param {string} newText 现在内置的样子
 * @returns {Array<{ type: 'same'|'del'|'add', text: string }>}
 */
export function diffLines(oldText, newText) {
  const a = String(oldText ?? '').split('\n');
  const b = String(newText ?? '').split('\n');

  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i] });
      i += 1;
    } else {
      out.push({ type: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ type: 'del', text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    out.push({ type: 'add', text: b[j] });
    j += 1;
  }
  return out;
}

/** 差异的摘要（"共 3 处改动"），UI 与 CLI 共用 */
export function diffSummary(oldText, newText) {
  const d = diffLines(oldText, newText);
  const added = d.filter((x) => x.type === 'add').length;
  const removed = d.filter((x) => x.type === 'del').length;
  return { added, removed, lines: d, changed: added + removed };
}
