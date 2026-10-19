/**
 * 冻结常量 · 单一事实来源（SSOT）
 *
 * 依据：物理解题动画软件 v1.0 自研方案
 *  - §3.2 槽位定义（7 个概念槽位 / 8 个冻结键名）
 *  - §3.5 标记切分协议
 *  - §9.1 世界书槽位名 = 目标阶段名
 *  - §2.3 主链路阶段枚举
 *  - §12 清洗 stage 枚举
 *
 * 本文件只声明"名字与枚举"，不声明"字段形状"。
 * 编译期（contracts/_compile.mjs）会校验本文件与 §3/§9/§11.2/§12 的正文逐字一致，
 * 任何不一致都会让 contracts:gen 直接失败——冻结项不允许被无声漂移。
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** §3.2 冻结键序（8 个，大小写敏感，顺序不可调换） */
export const SLOT_KEY_NAMES = Object.freeze([
  'PROBLEM',
  'STEPS',
  'ANSWERS',
  'VIEW',
  'setup',
  'stateAt',
  'drawFrame',
  'readouts',
]);

/**
 * §3.2 概念槽位：`stateAt` 与 `drawFrame` 同属"状态与绘制"（故称 7 槽位），
 * 但在 Schema / 标记切分 / 局部重生成中一律按 8 个独立键名处理（§8.1 依赖这一点）。
 */
export const CONCEPT_SLOT_COUNT = 7;

/** §3.5 标记名与 §3.2 的 8 个键名逐字一一对应（大小写敏感） */
export const SLOT_MARKER_PREFIX = '/* @slot:';
export const SLOT_MARKER_SUFFIX = '*/';
export const SLOT_MARKER_END = '/* @end */';

/** §3.2 表格里的"概念槽位"归属，供文档与审计使用 */
export const SLOT_CONCEPT_GROUP = Object.freeze({
  PROBLEM: '① 原题',
  STEPS: '② 解析',
  ANSWERS: '③ 答案',
  VIEW: '④ 视图',
  setup: '⑤ 初始化',
  stateAt: '⑥ 状态与绘制',
  drawFrame: '⑥ 状态与绘制',
  readouts: '⑦ 读数',
});

/**
 * §2.3 主链路阶段枚举（清洗与 SSE 共用，定案）。
 *
 * ⚠ **第 5 期追加：`read_image`（读图转写）** —— 用户 2026-10 裁决新增，
 *   位置在 `solve` **之前**（它是"第 0 步"）。
 *
 *   为什么必须新增一个阶段（而不是塞进 `solve`）：世界书的第一次触发发生在
 *   **发请求之前**，而图片不是文字 ⇒ 纯图片题在第一轮**没有任何可匹配的文本**。
 *   读图转写把图变成结构化文字，才让"触发 → 解题"这条链在图片题上成立
 *   （细节见 README §17.10）。
 *
 *   ⚠ 这是对**方案正文定案枚举**的一处新增（§2.3 原文没有它），
 *     按 §21.1 第 1 条先改契约、再改实现，并**记入交付说明**；
 *     **方案文档本身不改**（它是唯一依据，偏差记在 README）。
 *
 * ⚠ **第 5.7 期改名：`read_image` → `read_problem`** —— 用户 2026-10 裁决。
 *   语义从"读图转写"拓宽为"读题与判定"：这一步现在**总是跑**（纯文字题也跑），
 *   除了转写，还要**从词表里判出【考点】【题型】【动画元件】**。
 *   理由：考点不可能写在题面里（必须由模型判），而两半的触发源不是同一类任务
 *   （考点＝语义推理；元件＝感知识别）。
 *   ⚠ 这同样是对**方案正文定案枚举**的一处变更（§2.3 原文写的是 `read_image`），
 *     裁决见 `README.md` 裁决台账 **A26**；先改契约、再改实现。
 */
export const PIPELINE_STAGES = Object.freeze([
  'read_problem',
  'solve',
  'answers',
  'steps',
  'scene_code',
  'dry_run',
  'repair',
  'worldbook',
]);

/**
 * §12 清洗 stage 枚举。
 * 与 §2.3 的差异是有意的：清洗只覆盖"有模型文本产出"的阶段，
 * dry_run / repair 不产生需要清洗的模型文本。除此之外两处枚举逐字一致。
 *
 * ⚠ `read_problem` **有**模型文本产出（那段转写 + 判定行），所以它必须同时出现在这里。
 *   两条清单的一致性由 `contracts/_compile.mjs` 的**结构断言**守着
 *   （不再手写一个字符串去比 —— 那种守卫改枚举时必漏）。
 */
export const CLEANING_STAGES = Object.freeze([
  'read_problem',
  'solve',
  'answers',
  'steps',
  'scene_code',
  'worldbook',
]);

/** 清洗枚举**不包含**的阶段：它们不产生需要清洗的模型文本（§12 的差异口径） */
export const CLEANING_EXCLUDED_STAGES = Object.freeze(['dry_run', 'repair']);

/** §9.1 世界书槽位名 = 目标阶段名（冻结） */
export const WORLDBOOK_INSERTION_SLOTS = Object.freeze(['solve', 'scene_code']);

/**
 * §9.1 知识卡类型（**只含 worldbook 条目**）。
 *
 * ⚠ 产品层的“知识卡 5 类”是 UI 总集：提示词卡走 `core/prompts`、本地规则卡走
 *   `core/cleaner`，它们**不是 worldbook 条目**，所以不在这里。这里只允许
 *   `anim_rule`（动画规范）、`element`（元件）、`scene`（场景）三种。
 *
 * 顺序即注入顺序：anim_rule → element → scene（类型内再按 order）。
 */
export const WORLDBOOK_ENTRY_KINDS = Object.freeze(['anim_rule', 'element', 'scene']);

/** §9.1 字段枚举（冻结） */
export const WORLDBOOK_ENUMS = Object.freeze({
  origin: Object.freeze(['builtin', 'user']),
  category: Object.freeze(['solution_skill', 'scene_modeling', 'both_slot', 'user_lore']),
  secondaryLogic: Object.freeze(['AND_ANY', 'AND_ALL', 'OR', 'NOT']),
  priority: Object.freeze(['normal', 'high']),
});

/* ───────────────── 第 5.7 期：三栏新字段的枚举**从词表派生** ───────────────── */

/**
 * 两套词表的**单源真相**是 `contracts/worldbook-concepts.json`：
 *   · `concepts[]` → 考点词表（解题侧一级）
 *   · `tags{<conceptId>: [...]}` → 题型标签 / 细考点词表（解题侧二级）
 *   · `elements[]` → 实体物理图元 · **动画元件**词表（动画侧）
 *
 * ⚠ **为什么在这里派生，而不是手写枚举**（计划 §S2 的硬要求）：
 *   手写枚举 = 第二份事实来源 ⇒ 词表加一个考点，Schema 不会跟着变，
 *   于是"模型判得出、契约存不下"，且**没有任何检查会红**。
 *   派生之后，「Schema 的枚举 = Prompt 注入的表 = 前端下拉」在机制上同源。
 *
 * ⚠ 派生用 `readFileSync` 而不是 `import ... with { type: 'json' }`：
 *   后者在 Node 22 会打实验性告警，且本仓的脚本都要能被同一套 `node` 直接跑。
 */
function loadWorldbookConcepts() {
  const abs = fileURLToPath(new URL('../worldbook-concepts.json', import.meta.url));
  const raw = readFileSync(abs, 'utf8');
  const vocab = JSON.parse(raw);
  return { vocab, raw };
}

const { vocab: WORLDBOOK_CONCEPTS_OBJ, raw: WORLDBOOK_CONCEPTS_RAW } = loadWorldbookConcepts();

/**
 * 词表的**整份对象**（`contracts/worldbook-concepts.json` 的内容）。
 *
 * ⚠ 导出整份而不是只导出枚举：编排层要用它渲染**注入 Prompt 的词表文本**
 *   （`core/prompts/templates.mjs` 的 `buildJudgementVocab`），
 *   而"再读一次文件"就是第二份事实来源。给同一个对象，谁都别自己读。
 */
export const WORLDBOOK_CONCEPTS = WORLDBOOK_CONCEPTS_OBJ;

/** 考点 id（有序；顺序即词表里的顺序，前端下拉按此渲染） */
export const WORLDBOOK_CONCEPT_IDS = Object.freeze(WORLDBOOK_CONCEPTS.concepts.map((c) => c.id));

/** 全部细考点（扁平、去重；顺序即词表里的顺序） */
export const WORLDBOOK_TAG_NAMES = Object.freeze([
  ...new Set(WORLDBOOK_CONCEPTS.concepts.flatMap((c) => WORLDBOOK_CONCEPTS.tags[c.id] ?? [])),
]);

/** 动画元件 id（有序） */
export const WORLDBOOK_ELEMENT_IDS = Object.freeze(WORLDBOOK_CONCEPTS.elements.map((d) => d.id));

/**
 * 细考点 → 它所属的考点集合（跨字段约束要用：一条词条的 `tags`
 * **必须属于该词条某个 `concepts`**；`core/worldbook/store.mjs` 的 `validateEntry` 消费它）。
 * 用数组而不是单值：同一个细考点文本若出现在两个考点下（本仓当前为 0 处），
 * 这里如实记两处，而**不静默取第一个**。
 */
export const WORLDBOOK_TAG_OWNERS = Object.freeze(
  Object.fromEntries(
    WORLDBOOK_TAG_NAMES.map((t) => [
      t,
      WORLDBOOK_CONCEPTS.concepts.filter((c) => (WORLDBOOK_CONCEPTS.tags[c.id] ?? []).includes(t)).map((c) => c.id),
    ]),
  ),
);

/** 词表原文的 SHA256（写进 manifest：词表一改，契约哈希必须跟着变） */
export const WORLDBOOK_CONCEPTS_SHA256 = createHash('sha256').update(WORLDBOOK_CONCEPTS_RAW, 'utf8').digest('hex');

/** 词表文件自身的格式标识（防"拿错文件当词表"） */
export const WORLDBOOK_CONCEPTS_FORMAT = WORLDBOOK_CONCEPTS.format;

/**
 * §9.1 旧名归一化别名（只发生在导入路径；导出与内部一律只写新名）
 *  - `scene_spec` → `scene_code`
 *  - v2 的字符串写法 `"both"` → `["solve","scene_code"]`
 */
export const WORLDBOOK_IMPORT_ALIASES = Object.freeze({
  slotName: Object.freeze({ scene_spec: 'scene_code' }),
  slotLiteralBoth: 'both',
});

/** §3.6 唯一事实来源的格式标识 */
export const ANIMATION_PROGRAM_FORMAT = 'od-animation-program';
export const ANIMATION_PROGRAM_VERSION = 1;

/** 版本号（与 Provenance 烧录口径一致） */
export const TEMPLATE_VERSION = '1.0.0';
export const SDK_VERSION = '1.0.0';

/**
 * §3.3 ANSWERS 记录字段（冻结）。
 *
 * ⚠ 命名口径冲突（已上报，未擅自改动）：
 *   `ANSWERS` 是 JS 代码槽位，正文由模型书写；其中 `at_t` / `latex` 等键与
 *   项目其余地方的 camelCase 口径（TS 字段、`VIEW` 的 `SIM.duration`）不一致。
 *   §3.2 审计要求第 3 条与本文件都按"键名大小写敏感"处理，因此**逐字采用 §3.3 写法**。
 *   本文件不合并、不改写，等用户裁决后再统一。
 */
export const ANSWERS_RECORD_FIELDS = Object.freeze([
  'symbol',
  'value',
  'unit',
  'tol',
  'at_t',
  'step',
  'latex',
]);

/** §3.3 相对容差全局缺省（建议 1e-2，定案值） */
export const ANSWERS_DEFAULT_TOL = 1e-2;

/** §6.3 Dry-Run 定案预算 */
export const DRY_RUN_BUDGET = Object.freeze({
  /** ⚠ 第 8 期：4 s → 10 s（用户裁决：长题被 4 s 卡死是不公平的，采样已按题长归一） */
  wallClockMs: 10000,
  maxOldGenerationSizeMb: 512,
  dt: 1 / 240,
  boundaryEpsilon: 1e-3,
});

/** §7.2 C1–C9 检查号与判据强度（冻结，派生自正文表格） */
export const CHECK_IDS = Object.freeze(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9']);

/**
 * ── §7.2 判据的**拦住方式**（第 9 期「判据分级」，用户 2026-10-18 裁决）──
 *
 * | 检查 | 管什么 | 结论 |
 * |---|---|---|
 * | C2 | 跑不完 / 超时 | **硬拦** |
 * | C3 | 算出 NaN | **硬拦** |
 * | C5 | 步骤与时长对不上 | **硬拦** |
 * | C7 | 读数名字对不上答案（答案复现不了） | **硬拦** |
 * | C1 | 语法 / API 白名单 / 箭头契约 | 语法与箭头契约**硬拦**；"未知全局名"**降告警** |
 * | C4 | 相邻帧画面差太多 | **降告警**（曾被"标注消失"误触发，口径已改成只看实体） |
 * | C6 | 步骤边界位置跳变 | **降告警**（对嵌套 state 与碰撞跳变有已知误报，暂不修） |
 * | C8 / C9 | 读数稳定 / 画面活性 | 本来就是告警 |
 *
 * ⚠ **分级不等于放松**：`status` 照旧记 `pass` / `fail`，诊断、行号、offenders 一条不少；
 *   变的只是"这一条失败会不会让整份交付判死"。所以表里写 `warning` 的检查**照常跑、照常红**。
 *
 * ⚠ C1 的拆分**不能只靠这张表**（表按检查号给结论，而 C1 内部有两类诊断）：
 *   "哪类诊断算告警"由 `core/lint/contract-lint.mjs` 的 `C1_ADVISORY_RULES` 决定，
 *   `core/dryrun/dry-run.mjs` 再逐实例给出 `blocking`。
 */
export const CHECK_SEVERITY = Object.freeze({
  C1: 'blocking',
  C2: 'blocking',
  C3: 'blocking',
  C4: 'warning',
  C5: 'blocking',
  C6: 'warning',
  C7: 'blocking',
  C8: 'warning',
  C9: 'warning',
});

/**
 * §6.2 单槽位超长阈值（总代码 ≤400 行）
 *
 * ⚠ **第 8 期用户裁决：取消 `stateAt + drawFrame ≤ 150 行` 这一条。**
 *   理由：它是第 1 期拍的"可读性预算"，不是对错判据；我们自己的 15 道真题最长已到 147 行，
 *   只剩 3 行余量，一道"两物体 + 弹簧 + 五支箭头 + 墙面纹理"的题必然超。
 *   真正要防的是"跑不动/画不动"——那由 C2（10 秒预算）与 C9（每帧命令数）管。
 *   保留单槽位 400 行总上限，防止模型写出几千行的巨物。
 */
export const CODE_LENGTH_LIMITS = Object.freeze({
  totalLines: 400,
});

/** §5.3 矢量分类（供前端分组开关，不需要模型配合） */
export const VECTOR_CATEGORIES = Object.freeze(['velocity', 'acceleration', 'force']);

/** §5.3 受力子类（subtype） */
export const FORCE_SUBTYPES = Object.freeze([
  'gravity',
  'normal',
  'tension',
  'friction',
  'elastic',
  'lorentz',
  'ampere',
  'electric',
  'buoyancy',
  'other',
]);

/** §13.2 控制协议消息名（草案，第 3 期定稿；本期模板从端已按此实现） */
export const HOST_MESSAGES = Object.freeze({
  hostToTemplate: Object.freeze([
    'play',
    'pause',
    'toggle',
    'seek',
    'setRate',
    'showStep',
    'setVectorMask',
    'setTheme',
  ]),
  templateToHost: Object.freeze(['ready', 'state', 'error']),
});

/** §13.2 倍速档位（至少覆盖这些值） */
export const PLAYBACK_RATES = Object.freeze([0.25, 0.5, 1, 1.5, 2, 4]);

/** §14 导出定案规格（GIF 默认值） */
export const EXPORT_DEFAULTS = Object.freeze({
  gif: Object.freeze({ fps: 25, width: 960, height: 540 }),
  video: 'webm',
});
