/**
 * 契约字段形状（SSOT）
 *
 * 本文件是 `contracts/*.schema.json` 与 `contracts/types/*.d.ts` 的**唯一来源**：
 * `contracts/generate-contracts.mjs` 同时生成两份产物，二者不可能各自漂移。
 * 依据：§3.2 / §3.3 / §3.4 / §3.6 / §9.1 / §11.1 / §12。
 *
 * 字段形状只描述"JSON 长什么样"，不描述"世界书引擎怎么跑"（后者属第 5 期）。
 */

import {
  SLOT_KEY_NAMES,
  KNOWLEDGECARD_INSERTION_SLOTS,
  KNOWLEDGECARD_ENTRY_KINDS,
  KNOWLEDGECARD_ENUMS,
  KNOWLEDGECARD_CONCEPT_IDS,
  KNOWLEDGECARD_TAG_NAMES,
  KNOWLEDGECARD_ELEMENT_IDS,
  PIPELINE_STAGES,
  CLEANING_STAGES,
  ANIMATION_PROGRAM_FORMAT,
  ANIMATION_PROGRAM_VERSION,
} from './frozen-keys.mjs';
import { diagnosticRecord } from './diagnostic.mjs';

/* ────────────────────────── 字段描述子（DSL） ────────────────────────── */

export const f = {
  string: (o = {}) => ({ kind: 'string', ...o }),
  number: (o = {}) => ({ kind: 'number', ...o }),
  integer: (o = {}) => ({ kind: 'integer', ...o }),
  boolean: (o = {}) => ({ kind: 'boolean', ...o }),
  null: () => ({ kind: 'null' }),
  array: (items, o = {}) => ({ kind: 'array', items, ...o }),
  object: (properties, o = {}) => ({ kind: 'object', properties, ...o }),
  record: (valueType, o = {}) => ({ kind: 'record', valueType, ...o }),
  ref: (typeName) => ({ kind: 'ref', typeName }),
  union: (variants, o = {}) => ({ kind: 'union', variants, ...o }),
  /** `{ "type": ["number","null"] }` —— 用于 SYMBOLIC 题的可空数值（§3.3） */
  nullable: (inner) => ({ kind: 'nullable', inner }),
};

const ID_PATTERN = '^[A-Za-z0-9._-]+$';

/* ────────────────────────── animation-program ────────────────────────── */

const SLOT_STRING = f.string({
  minLength: 1,
  title: '槽位代码/正文（非空字符串；空串视为该槽位缺失，不得静默通过）',
});

export const animationProgram = {
  id: 'animation-program',
  title: 'AnimationProgram（唯一事实来源）',
  schemaId: 'https://open-design.local/contracts/animation-program.schema.json',
  description:
    '§3.6 AnimationProgram。slots 恰好含 §3.2 的 8 个冻结键名，缺一不可；键名大小写敏感；required 覆盖全部 8 项且顺序即冻结键序。',
  root: 'AnimationProgram',
  defs: {
    SlotKeyName: {
      kind: 'enum',
      values: [...SLOT_KEY_NAMES],
      title: '§3.2 冻结键名',
    },
    Provenance: {
      kind: 'object',
      title: 'Provenance（必须烧录进导出 HTML）',
      required: ['model', 'promptHash', 'knowledgecardHash', 'generatedAt'],
      properties: {
        model: f.string({ minLength: 1, description: '生成模型标识，未接模型时可写 "handwritten"' }),
        promptHash: f.string({ minLength: 1, description: 'Prompt 集合哈希（本期手写题为 "handwritten"' }),
        knowledgecardHash: f.string({ minLength: 1, description: '世界书集合哈希（本期为 "handwritten"' }),
        generatedAt: f.string({ minLength: 1, description: 'ISO 8601 时间戳' }),
        sdkVersion: f.string({ minLength: 1 }),
        templateVersion: f.string({ minLength: 1 }),
      },
    },
  },
  properties: {
    format: f.string({ const: ANIMATION_PROGRAM_FORMAT }),
    version: f.integer({ const: ANIMATION_PROGRAM_VERSION }),
    templateVersion: f.string({ minLength: 1, description: '模板版本，Provenance 口径之一' }),
    sdkVersion: f.string({ minLength: 1 }),
    slots: f.object(
      Object.fromEntries(SLOT_KEY_NAMES.map((k) => [k, SLOT_STRING])),
      {
        required: [...SLOT_KEY_NAMES],
        additionalProperties: false,
        title: '§3.2 冻结键序（8 个，大小写敏感）',
      },
    ),
    provenance: f.ref('Provenance'),
  },
  required: ['format', 'version', 'templateVersion', 'sdkVersion', 'slots'],
};

/* ─────────────────────────── knowledgecard-entry ─────────────────────────── */

const WORLD_BOOK_KEY = f.string({
  minLength: 1,
  description: '字符串=字面量包含；"/…/"=正则。正则非法须在保存时拒绝。',
});

export const knowledgecardEntry = {
  id: 'knowledgecard-entry',
  title: '世界书词条（§9.1 字段冻结）',
  schemaId: 'https://open-design.local/contracts/knowledgecard-entry.schema.json',
  description:
    '§9.1 词条模型。`insertion_slot` 元素只能是 solve | scene_code（= 目标阶段名）；`scene_spec` 是 v2 旧名，不得进入枚举，仅在导入路径归一化。',
  root: 'KnowledgecardEntry',
  defs: {
    InsertionSlot: {
      kind: 'enum',
      values: [...KNOWLEDGECARD_INSERTION_SLOTS],
      title: '§9.1 世界书槽位名 = 目标阶段名',
    },
    Origin: { kind: 'enum', values: [...KNOWLEDGECARD_ENUMS.origin] },
    Category: { kind: 'enum', values: [...KNOWLEDGECARD_ENUMS.category] },
    EntryKind: {
      kind: 'enum',
      values: [...KNOWLEDGECARD_ENTRY_KINDS],
      title: '知识卡类型（只含 knowledgecard 条目：动画规范 / 元件 / 场景）',
      description:
        '提示词卡与本地规则卡属于产品层知识卡，但不是 knowledgecard 条目，不走这个字段。' +
        '缺省按 element 处理（兼容旧包）；类型只影响 UI 分组与注入顺序，不影响命中语义。',
    },
    SecondaryLogic: { kind: 'enum', values: [...KNOWLEDGECARD_ENUMS.secondaryLogic] },
    Priority: { kind: 'enum', values: [...KNOWLEDGECARD_ENUMS.priority] },
    SecondaryKeys: {
      kind: 'object',
      required: ['logic', 'list'],
      additionalProperties: false,
      title: '次级键逻辑',
      properties: {
        logic: f.ref('SecondaryLogic'),
        list: f.array(f.string({ minLength: 1 }), { description: '次级键；空数组时 AND_ANY/AND_ALL/OR 直接通过，NOT 视为通过' }),
      },
    },
    /* ── 第 5.7 期新增：三栏的枚举**从 `contracts/knowledgecard-concepts.json` 派生** ──
     *
     * 为什么不手写枚举：手写就是第二份事实来源 —— 词表加一个考点，Schema 不跟着变，
     * 于是"模型判得出、契约存不下"，而且**没有任何检查会红**。
     * 派生之后，「Schema 枚举 = Prompt 注入的表 = 前端下拉」在机制上同源。
     * 逐条取证见 tests/contract-validator-selftest.mjs 与 tests/knowledgecard-selftest.mjs『W16』。
     */
    ConceptId: {
      kind: 'enum',
      values: [...KNOWLEDGECARD_CONCEPT_IDS],
      title: '考点词表（词表 A；派生自 contracts/knowledgecard-concepts.json）',
      description: '解题侧一级触发源。判定：concepts 相交 且（tags 相交 或 tags 为空）。',
    },
    TagName: {
      kind: 'enum',
      values: [...KNOWLEDGECARD_TAG_NAMES],
      title: '题型标签 / 细考点词表（词表 B；派生自同一份词表，按考点分组）',
      description:
        '解题侧二级。**跨字段约束（Schema 表达不了，落在运行期）**：一条词条的每个 tag 必须属于该词条某个 concepts；' +
        '`tags` 为空 = 该考点下的通用词条（方案 b 兜底）。',
    },
    ElementId: {
      kind: 'enum',
      values: [...KNOWLEDGECARD_ELEMENT_IDS],
      title: '实体物理图元 · 动画元件词表（派生自同一份词表；原名 devices / 器材）',
      description:
        '动画侧触发源。命中 = 词条 elements ∩ 模型报的动画元件 ≠ ∅，再用考点收窄。' +
        '判定细则（用户裁决 A25）：矢量箭头**算**；尺寸标注、文字标注**不算**。',
    },
  },
  properties: {
    id: f.string({ minLength: 1, pattern: ID_PATTERN, description: '词条 id，同库内不得重复' }),
    title: f.string({ minLength: 1 }),
    origin: f.ref('Origin'),
    category: f.ref('Category', { description: '仅分类展示与统计' }),
    kind: f.ref('EntryKind', {
      description: '知识卡类型；缺省按 element 处理（旧包兼容）。只影响 UI 与注入顺序，不影响命中语义',
    }),
    enabled: f.boolean(),
    constant: f.boolean({ default: false, description: '常驻：无条件注入' }),
    recursive: f.boolean({ default: true, description: '允许被级联唤醒 / 自身可唤醒别人' }),
    keys: f.array(WORLD_BOOK_KEY, { description: '主键；空数组时 constant 为真仍注入，否则仅可被递归唤醒' }),
    secondary_keys: f.ref('SecondaryKeys'),
    /**
     * ⚠ 这三栏**都是可选的**（不放进 `required`），理由要写清楚，别被当成"为了让门禁变绿而放宽"：
     *   ① 灰度期要求（计划 §2 决定 4）：137 条老词条仍靠 `keys` 字面命中工作，
     *      **允许一条一条迁、随时回退**；把三栏设成必填会让整个内置库当场非法；
     *   ② 它们的**取值**是受约束的（枚举 + 运行期跨字段校验），
     *      所以"可选"约束的是**存在性**，不是"随便填"；
     *   ③ 等 5.9 期写完新库，再按那时的口径决定是否升级为必填（记进 5.9 交付单）。
     * 负对照见 tests/knowledgecard-selftest.mjs『W16』：填了表外值必须报错。
     */
    concepts: f.array(f.ref('ConceptId'), {
      uniqueItems: true,
      description: '考点（词表 A）；元素必须是 ConceptId 枚举内的 id。空/缺省 ⇒ 该词条不走概念分发',
    }),
    tags: f.array(f.ref('TagName'), {
      uniqueItems: true,
      description: '题型标签 / 细考点（词表 B）；每个 tag 必须属于本词条某个 concepts。空数组 = 该考点下的通用词条',
    }),
    elements: f.array(f.ref('ElementId'), {
      uniqueItems: true,
      description: '实体物理图元（动画元件，原名 devices/器材）；元素必须是 ElementId 枚举内的 id',
    }),
    insertion_slot: f.array(f.ref('InsertionSlot'), {
      uniqueItems: true,
      description: '空数组 [] 合法但标注"未挂槽位"；元素只能是 solve | scene_code',
    }),
    order: f.integer({ default: 100, description: '同槽位内排序，小在前；同 order 按 id 稳定排序' }),
    priority: f.ref('Priority', { description: '预算不足时 high 优先保留' }),
    content: f.string({ minLength: 1, description: '正文；双槽词条按 "## 解题" / "## 动画建模" 二级标题切分' }),
    code_examples: f.array(f.string({ minLength: 1 }), {
      description: '§9.5 用法示例（第 5 期接入引擎；字段形状本期冻结）',
    }),
  },
  required: ['id', 'title', 'origin', 'category', 'enabled', 'keys', 'insertion_slot', 'content'],
};

/* ────────────────────────── knowledgecard-pack（§9.5 导入导出） ────────────────────────── */

/**
 * §9.5 导入导出：`.json`（`format: "od-knowledgecard"`, `version: 1`）。
 *
 * ⚠ 为什么包里**没有** `includeBuiltin` 之类的字段：§9.3 的"默认只导 origin:user +
 *   可选包含内置规范"是**导出这个动作的选择**，不是词条集合的属性。
 *   把它写进包里会让同一份词条集合出现两种表达（导一次带 true、导一次带 false），
 *   而 W11 要求的正是"导出→导入→命中集合逐条相同"——包只该记录实际导出的词条。
 *
 * ⚠ 体积上限（§16：单文件 ≤800 KB、全部 ≤16 MB）**无法在 JSON Schema 层表达**，
 *   由导入路径校验（与 §11.2 的跨字段规则同一处置方式）。
 */
export const knowledgecardPack = {
  id: 'knowledgecard-pack',
  title: '世界书导出包（§9.5 导入导出）',
  schemaId: 'https://open-design.local/contracts/knowledgecard-pack.schema.json',
  description:
    '§9.5 的 `.json` 交换格式（format:"od-knowledgecard", version:1）。' +
    '包内词条的形状**引用** knowledgecard-entry 契约，不得另立一套字段；' +
    '旧名归一化（scene_spec → scene_code、"both" → ["solve","scene_code"]）只发生在**导入路径**，导出与内部一律只写新名。',
  root: 'KnowledgecardPack',
  defs: {
    KnowledgecardEntry: { kind: 'inline', spec: knowledgecardEntry },
  },
  properties: {
    format: f.string({ const: 'od-knowledgecard', description: '§9.5 冻结格式标识' }),
    version: f.integer({ const: 1, description: '不支持版本必须明确拒绝' }),
    entries: f.array(f.ref('KnowledgecardEntry'), {
      description: '实际导出的词条（导入时逐条按 §9.1 校验，整批生效或整批失败）',
    }),
  },
  required: ['format', 'version', 'entries'],
};

/* ────────────────────────── cleaning-rule（§12） ────────────────────────── */

export const cleaningRule = {
  id: 'cleaning-rule',
  title: '清洗规则（§12 条目字段）',
  schemaId: 'https://open-design.local/contracts/cleaning-rule.schema.json',
  description:
    '§12 正则兜底规则。按列表从上到下执行；正则在隔离环境运行 + 超时；非法正则即时报错且不落盘。正则合法性无法在 JSON Schema 层表达，由运行时校验。',
  root: 'CleaningRule',
  defs: {
    CleaningStage: {
      kind: 'enum',
      values: [...CLEANING_STAGES],
      title: '§12 stage 枚举（有模型文本产出的阶段）',
    },
  },
  properties: {
    id: f.string({ minLength: 1, pattern: ID_PATTERN }),
    name: f.string({ minLength: 1 }),
    stage: f.ref('CleaningStage'),
    pattern: f.string({ minLength: 1, description: '正则源文本；保存时用 new RegExp(pattern, flags) 试编译' }),
    flags: f.string({ description: '正则 flags，允许 gimsuy 的子集' }),
    replacement: f.string(),
    enabled: f.boolean(),
  },
  required: ['id', 'name', 'stage', 'pattern', 'flags', 'replacement', 'enabled'],
};

/** §12 整表约束（§16 体积限制：清洗规则 ≤300 项） */
export const cleaningRuleSet = {
  id: 'cleaning-rule-set',
  title: '清洗规则表（§12 / §16）',
  schemaId: 'https://open-design.local/contracts/cleaning-rule-set.schema.json',
  description: '按列表从上到下执行；内置规则保留必需的最小集（剥代码围栏 + 去首尾空白）。',
  root: 'CleaningRuleSet',
  defs: {
    CleaningRule: { kind: 'inline', spec: cleaningRule },
  },
  properties: {
    format: f.string({ const: 'od-cleaning-rules' }),
    version: f.integer({ const: 1 }),
    rules: f.array(f.ref('CleaningRule'), { maxItems: 300 }),
  },
  required: ['format', 'version', 'rules'],
};

/* ─────────────────────── endpoint（§11.1 / §11.2） ─────────────────────── */

export const endpointConfig = {
  id: 'endpoint',
  title: '端点与分阶段模型配置（§11.1）',
  schemaId: 'https://open-design.local/contracts/endpoint.schema.json',
  description:
    '§11.1 字段 + §11.2 校验规则的可表达部分。HTTPS/无凭据/无查询参数/无片段/id 合法且不重复/≤300 项/'+
    'apiKeyModelId 必须指向已存在端点且不得成环/stageModels 引用必须存在——'+
    '这些是跨字段约束，JSON Schema 层只表达字段形状；跨字段部分由 contracts/validate.mjs 的 ' +
    'validateEndpointConfig 实现（第 3 期第 1 步补齐；逐条取证见 tests/contract-validator-selftest.mjs）。',
  root: 'EndpointConfig',
  defs: {
    PipelineStage: {
      kind: 'enum',
      values: [...PIPELINE_STAGES],
      title: '§2.3 主链路阶段枚举（stageModels 的键）',
    },
    Endpoint: {
      kind: 'object',
      title: '端点',
      required: [
        'id',
        'displayName',
        'baseURL',
        'defaultModel',
        'apiKeyModelId',
        'supportsJsonMode',
        'supportsVision',
        'enableThinking',
        'preserveThinking',
        'timeoutMs',
      ],
      additionalProperties: false,
      properties: {
        id: f.string({ minLength: 1, pattern: ID_PATTERN, description: '只能字母/数字/点/下划线/连字符' }),
        displayName: f.string({ minLength: 1 }),
        baseURL: f.string({ minLength: 1, description: '必须 HTTPS；http://127.0.0.1 与 http://localhost 例外（本地推理）' }),
        defaultModel: f.string({ minLength: 1 }),
        visionModel: f.string({ description: '可选；留空则用 defaultModel 做视觉请求' }),
        apiKeyModelId: f.nullable(f.string()),
        supportsJsonMode: f.boolean(),
        supportsVision: f.boolean(),
        enableThinking: f.boolean(),
        preserveThinking: f.boolean(),
        timeoutMs: f.integer({ minimum: 1000 }),
      },
    },
  },
  properties: {
    endpoints: f.array(f.ref('Endpoint'), { maxItems: 300 }),
    stageModels: f.record(f.nullable(f.string()), {
      description: '阶段 → 端点 id；未配置的阶段为 null',
    }),
    keys: f.record(f.string(), {
      description: '端点 id → 明文 Key（本机配置文件；永不写入日志/导出包/复现包）',
    }),
    keysEncrypted: f.boolean({
      description: '§11.2 扩展位：keys 预留 encrypted:true 分支（本期不实现，字段形状先冻结）',
      default: false,
    }),
    configVersion: f.integer({ const: 1, description: '导入时校验版本，不支持版本明确拒绝' }),
  },
  required: ['endpoints', 'stageModels', 'keys'],
};

export const CONTRACT_SPECS = [
  animationProgram,
  knowledgecardEntry,
  cleaningRule,
  cleaningRuleSet,
  endpointConfig,
  // 第 4 期新增：诊断条目（三档证据强度）。放在最后，前五份产物的哈希与顺序都不受影响。
  diagnosticRecord,
  // 第 5 期新增：世界书导出包（§9.5）。同样放在最后 —— 前六份产物的哈希与顺序不受影响。
  knowledgecardPack,
];
