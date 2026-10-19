/**
 * 契约编译器：字段形状 DSL → JSON Schema + TypeScript 类型。
 *
 * 二者的**唯一来源**是 `contracts/spec/*.mjs`。同一份描述子同时喂给两个 emitter，
 * 因此「Schema 与 TS 类型同源生成」（§3.6 / §21.1 第 1 条）在机制上成立，
 * 而不是靠人工比对。`contracts/verify-contracts.mjs` 会在 CI 里重跑生成并比对哈希。
 */

import { SLOT_KEY_NAMES, KNOWLEDGECARD_INSERTION_SLOTS, KNOWLEDGECARD_ENTRY_KINDS, PIPELINE_STAGES, CLEANING_STAGES, CLEANING_EXCLUDED_STAGES, KNOWLEDGECARD_CONCEPT_IDS, KNOWLEDGECARD_TAG_NAMES, KNOWLEDGECARD_ELEMENT_IDS, KNOWLEDGECARD_TAG_OWNERS, KNOWLEDGECARD_CONCEPTS_FORMAT } from './spec/frozen-keys.mjs';
import {
  EVIDENCE_PRECISIONS,
  PRECISION_LABELS,
  PRECISION_GUIDANCE,
} from './spec/diagnostic.mjs';

const SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

/* ───────────────────────────── JSON Schema ───────────────────────────── */

function schemaFor(desc, typeName, spec) {
  if (!desc) return {};

  switch (desc.kind) {
    case 'string': {
      const out = { type: 'string' };
      if (desc.minLength !== undefined) out.minLength = desc.minLength;
      if (desc.maxLength !== undefined) out.maxLength = desc.maxLength;
      if (desc.pattern !== undefined) out.pattern = desc.pattern;
      if (desc.const !== undefined) out.const = desc.const;
      return withAnnotations(out, desc);
    }
    case 'number': {
      const out = { type: 'number' };
      if (desc.minimum !== undefined) out.minimum = desc.minimum;
      if (desc.maximum !== undefined) out.maximum = desc.maximum;
      if (desc.const !== undefined) out.const = desc.const;
      return withAnnotations(out, desc);
    }
    case 'integer': {
      const out = { type: 'integer' };
      if (desc.minimum !== undefined) out.minimum = desc.minimum;
      if (desc.maximum !== undefined) out.maximum = desc.maximum;
      if (desc.const !== undefined) out.const = desc.const;
      return withAnnotations(out, desc);
    }
    case 'boolean': {
      const out = { type: 'boolean' };
      if (desc.default !== undefined) out.default = desc.default;
      return withAnnotations(out, desc);
    }
    case 'null':
      return { type: 'null' };
    case 'nullable': {
      const inner = schemaFor(desc.inner, typeName, spec);
      const types = Array.isArray(inner.type) ? inner.type : [inner.type];
      return withAnnotations({ ...inner, type: [...types, 'null'] }, desc);
    }
    case 'ref':
      return withAnnotations({ $ref: `#/$defs/${desc.typeName}` }, desc);
    case 'array': {
      const out = { type: 'array', items: schemaFor(desc.items, typeName, spec) };
      if (desc.minItems !== undefined) out.minItems = desc.minItems;
      if (desc.maxItems !== undefined) out.maxItems = desc.maxItems;
      if (desc.uniqueItems !== undefined) out.uniqueItems = desc.uniqueItems;
      if (desc.default !== undefined) out.default = desc.default;
      return withAnnotations(out, desc);
    }
    case 'record':
      return withAnnotations(
        { type: 'object', additionalProperties: schemaFor(desc.valueType, typeName, spec) },
        desc,
      );
    case 'union':
      return withAnnotations(
        {
          oneOf: desc.variants.map((v) => schemaFor({ kind: 'string', const: v }, typeName, spec)),
        },
        desc,
      );
    case 'object': {
      const properties = {};
      for (const [key, child] of Object.entries(desc.properties)) {
        properties[key] = schemaFor(child, typeName, spec);
      }
      const out = {
        type: 'object',
        additionalProperties: desc.additionalProperties === undefined ? false : desc.additionalProperties,
        properties,
      };
      if (desc.required && desc.required.length) out.required = [...desc.required];
      return withAnnotations(out, desc);
    }
    default:
      throw new Error(`未知字段描述子 kind=${desc.kind}（${typeName}）`);
  }
}

function withAnnotations(out, desc) {
  if (desc.title) out.title = desc.title;
  if (desc.description) out.description = desc.description;
  if (desc.default !== undefined && out.default === undefined && desc.kind !== 'boolean') {
    out.default = desc.default;
  }
  return out;
}

function defSchema(def, spec) {
  if (def.kind === 'enum') {
    const out = { type: 'string', enum: [...def.values] };
    if (def.title) out.title = def.title;
    if (def.description) out.description = def.description;
    return out;
  }
  if (def.kind === 'inline') {
    return { $ref: `${def.spec.schemaId}` };
  }
  return schemaFor(def, 'def', spec);
}

/** 生成一个契约的 JSON Schema 文档 */
export function compileJsonSchema(spec) {
  const $defs = {};
  for (const [name, def] of Object.entries(spec.defs)) {
    $defs[name] = defSchema(def, spec);
  }
  const rootSchema = schemaFor(
    { kind: 'object', properties: spec.properties, required: spec.required, additionalProperties: false, title: spec.title, description: spec.description },
    spec.root,
    spec,
  );

  return {
    $schema: SCHEMA_DRAFT,
    $id: spec.schemaId,
    title: spec.title,
    description: spec.description,
    type: rootSchema.type,
    additionalProperties: rootSchema.additionalProperties,
    properties: rootSchema.properties,
    required: rootSchema.required,
    $defs,
    'x-od-contract': {
      id: spec.id,
      rootType: spec.root,
      generatedFrom: 'contracts/spec/contract-fields.mjs',
      frozenBy: '物理解题动画软件 v1.0 自研方案 §3 / §9 / §11.1 / §12',
    },
  };
}

/* ─────────────────────────── TypeScript 类型 ─────────────────────────── */

function tsFor(desc) {
  if (!desc) return 'unknown';
  switch (desc.kind) {
    case 'string':
      return desc.const !== undefined ? JSON.stringify(desc.const) : 'string';
    case 'number':
    case 'integer':
      return desc.const !== undefined ? String(desc.const) : 'number';
    case 'boolean':
      return desc.const !== undefined ? String(desc.const) : 'boolean';
    case 'null':
      return 'null';
    case 'nullable':
      return `${parenthesize(tsFor(desc.inner))} | null`;
    case 'ref':
      return desc.typeName === 'InsertionSlot'
        ? KNOWLEDGECARD_INSERTION_SLOTS.map((s) => JSON.stringify(s)).join(' | ')
        : desc.typeName;
    case 'array':
      return `Array<${parenthesize(tsFor(desc.items))}>`;
    case 'record':
      return `Record<string, ${tsFor(desc.valueType)}>`;
    case 'union':
      return desc.variants.map((v) => JSON.stringify(v)).join(' | ');
    case 'object':
      return inlineTsObject(desc);
    default:
      throw new Error(`未知字段描述子 kind=${desc.kind}`);
  }
}

function parenthesize(ts) {
  return /[|&\s]/.test(ts) && !ts.startsWith('{') && !ts.startsWith('Array<') && !ts.startsWith('Record<') ? `(${ts})` : ts;
}

function tsDoc(desc, indent) {
  const lines = [];
  if (desc.title || desc.description) {
    lines.push(`${indent}/**`);
    if (desc.title) lines.push(`${indent} * ${desc.title}`);
    if (desc.description) lines.push(`${indent} * ${desc.description}`);
    const notes = [];
    if (desc.default !== undefined) notes.push(`@default ${JSON.stringify(desc.default)}`);
    if (desc.minLength !== undefined) notes.push(`@minLength ${desc.minLength}`);
    if (desc.pattern !== undefined) notes.push(`@pattern ${desc.pattern}`);
    if (desc.minimum !== undefined) notes.push(`@minimum ${desc.minimum}`);
    if (desc.maxItems !== undefined) notes.push(`@maxItems ${desc.maxItems}`);
    if (notes.length) lines.push(`${indent} * ${notes.join(' ')}`);
    lines.push(`${indent} */`);
  }
  return lines;
}

function inlineTsObject(desc) {
  const parts = Object.entries(desc.properties).map(([key, child]) => {
    const optional = desc.required && desc.required.includes(key) ? '' : '?';
    return `${JSON.stringify(key)}${optional}: ${tsFor(child)}`;
  });
  return `{ ${parts.join('; ')} }`;
}

function tsDefBlock(name, def) {
  if (def.kind === 'enum') {
    const lines = [];
    if (def.title || def.description) {
      lines.push('/**');
      if (def.title) lines.push(` * ${def.title}`);
      if (def.description) lines.push(` * ${def.description}`);
      lines.push(' */');
    }
    lines.push(`export type ${name} = ${def.values.map((v) => JSON.stringify(v)).join(' | ')};`);
    return lines.join('\n');
  }
  if (def.kind === 'inline') return `// ${name} 见 ${def.spec.schemaId} 生成物`;
  const lines = tsDoc(def, '');
  const required = def.required || [];
  const props = Object.entries(def.properties).map(([key, child]) => {
    const optional = required.includes(key) ? '' : '?';
    return [...tsDoc(child, '  '), `  ${JSON.stringify(key)}${optional}: ${tsFor(child)};`].join('\n');
  });
  lines.push(`export interface ${name} {`);
  lines.push(props.join('\n'));
  lines.push('}');
  return lines.join('\n');
}

/** 生成一个契约的 TS 声明文件 */
export function compileTypeScript(spec, opts = {}) {
  const header = [
    '/* eslint-disable */',
    '// ⚠ 本文件由 contracts/generate-contracts.mjs 自动生成，请勿手改。',
    '// 来源：contracts/spec/contract-fields.mjs（与 JSON Schema 同源）。',
    `// 契约 id：${spec.id} · 依据：物理解题动画软件 v1.0 自研方案`,
    '',
  ];

  const body = [];
  for (const [name, def] of Object.entries(spec.defs)) {
    if (def.kind === 'inline') continue;
    // SlotKeyName 由下方按 SLOT_KEY_NAMES 显式生成，避免重复声明
    if (spec.id === 'animation-program' && name === 'SlotKeyName') continue;
    body.push(tsDefBlock(name, def), '');
  }

  const rootIsFrozenSlots = spec.id === 'animation-program';
  if (rootIsFrozenSlots) {
    body.push(
      '/** §3.2 冻结键序（8 个，大小写敏感）。顺序即 required 顺序，不得调换。 */',
      `export type SlotKeyName = ${SLOT_KEY_NAMES.map((k) => JSON.stringify(k)).join(' | ')};`,
      '',
      '/** §3.6 slots：恰好 8 个键，缺一不可（用映射类型把"缺键"变成编译错误）。 */',
      'export type AnimationSlots = { [K in SlotKeyName]: string };',
      '',
    );
  }

  body.push(tsDefBlock(spec.root, {
    kind: 'object',
    title: spec.title,
    description: spec.description,
    properties: spec.properties,
    required: spec.required,
    additionalProperties: false,
  }));

  if (rootIsFrozenSlots) {
    body.push(
      '',
      '/** 与非空字符串约束配套的运行时守卫常量（供 Schema 之外的运行时使用）。 */',
      `export declare const SLOT_KEY_NAMES: readonly SlotKeyName[];`,
    );
  }

  if (spec.id === 'knowledgecard-entry') {
    body.push(
      '',
      '/** v2 旧槽位名，仅允许在导入路径按别名归一化为 scene_code（§9.1）。 */',
      'export type DeprecatedInsertionSlot = "scene_spec";',
    );
  }

  if (opts.extra) body.push('', opts.extra);
  return `${header.join('\n')}${body.join('\n')}\n`;
}

/* ───────────────────────── 编译期不变量校验 ───────────────────────── */

/**
 * 这些断言把"冻结项"变成可执行检查：
 * 任何人改动 spec 而破坏 §3.2 / §9.1 的口径，contracts:gen 会直接失败。
 */

/* ── 第 4 期：诊断条目与三档证据强度（§14.3 ①） ── */

/**
 * 三档证据强度的**冻结字面量**。
 *
 * ⚠ 这一行是刻意"抄一遍"的：它必须与 `EVIDENCE_PRECISIONS` 相互独立，
 *   否则断言就成了"字面量与它自己比较"，永远通过 —— 那是恒真断言的一种。
 *   走查第 3 期的教训：一条恒真断言（`x === undefined || true`）等于没测。
 *   这里把"应该是什么"写死在断言侧，被测侧一旦重排/增删就会失败。
 */
const FROZEN_EVIDENCE_PRECISIONS = ['exact', 'replayed', 'candidate'];

export function assertContractInvariants(specs) {
  const problems = [];
  const bySlots = [];

  for (const spec of specs) {
    const json = JSON.stringify(compileJsonSchema(spec));

    // 1. 任何契约都不得出现 v2 旧槽位名
    for (const legacy of ['scene_spec']) {
      if (json.includes(`"${legacy}"`)) {
        problems.push(`${spec.id}: 出现 v2 旧槽位名 "${legacy}"（§9.1 禁止进入 Schema 枚举）`);
      }
    }
    // 2. 不得出现被删除的 PhysicsSceneSpec 契约
    if (/PhysicsSceneSpec/.test(json)) {
      problems.push(`${spec.id}: 出现已废弃的 PhysicsSceneSpec（§1.3 明确不做）`);
    }
    // 3. required 必须存在且非空
    if (!Array.isArray(spec.required) || spec.required.length === 0) {
      problems.push(`${spec.id}: required 为空`);
    }
    // 4. additionalProperties 必须显式收敛
    if (spec.id !== 'cleaning-rule-set' && !json.includes('"additionalProperties":false')) {
      problems.push(`${spec.id}: 根级或对象级 additionalProperties 未显式收敛`);
    }
    bySlots.push(...Object.keys(spec.properties).filter((k) => SLOT_KEY_NAMES.includes(k)));
  }

  const program = specs.find((s) => s.id === 'animation-program');
  if (!program) {
    problems.push('缺少 animation-program 契约');
    return problems;
  }

  const slots = program.properties.slots;
  const slotKeys = Object.keys(slots.properties);

  // §3.2 审计要求 1：required 恰好覆盖 8 个键，且键序固定
  const sameLength = slots.required.length === SLOT_KEY_NAMES.length;
  const sameOrder = slots.required.every((k, i) => k === SLOT_KEY_NAMES[i]);
  if (!sameLength || !sameOrder) {
    problems.push(
      `§3.2 审计 1 违反：slots.required 必须恰好且按序等于 [${SLOT_KEY_NAMES.join(', ')}]，实际 [${slots.required.join(', ')}]`,
    );
  }
  if (Object.keys(slots.properties).length !== SLOT_KEY_NAMES.length) {
    problems.push(`§3.2 审计 1 违反：slots.properties 键数 ${Object.keys(slots.properties).length} ≠ 8`);
  }
  if (!slotKeys.every((k, i) => k === SLOT_KEY_NAMES[i])) {
    problems.push(`§3.2 冻结键序违反：slots.properties 顺序 [${slotKeys.join(', ')}]`);
  }
  if (slots.additionalProperties !== false) {
    problems.push('§3.2 审计 1 违反：slots 必须 additionalProperties: false，否则可偷塞第 9 个键');
  }
  // §3.2 审计 2：8 个键的值均为非空字符串
  for (const key of SLOT_KEY_NAMES) {
    const v = slots.properties[key];
    if (v.kind !== 'string' || v.minLength !== 1) {
      problems.push(`§3.2 审计 2 违反：slots.${key} 必须是 minLength:1 的字符串（空串按缺失报错）`);
    }
  }
  // §3.2 审计 1 的负向要求：不得把 stateAt 与 drawFrame 合并
  if (slotKeys.includes('stateDraw') || slotKeys.includes('state_at') || slotKeys.includes('draw_frame')) {
    problems.push('§3.2 审计 1 违反：stateAt 与 drawFrame 不得合并成数组或对象');
  }
  // 顺带：顶层 required 必须包含 slots
  if (!program.required.includes('slots')) problems.push('animation-program: 顶层 required 必须包含 slots');

  const knowledgecard = specs.find((s) => s.id === 'knowledgecard-entry');
  if (!knowledgecard) {
    problems.push('缺少 knowledgecard-entry 契约');
  } else {
    const slotEnum = knowledgecard.defs.InsertionSlot.values;
    if (slotEnum.join('|') !== KNOWLEDGECARD_INSERTION_SLOTS.join('|')) {
      problems.push(`§9.1 违反：insertion_slot 枚举必须是 [${KNOWLEDGECARD_INSERTION_SLOTS.join(', ')}]`);
    }
    const logic = knowledgecard.defs.SecondaryLogic.values.join('|');
    if (logic !== 'AND_ANY|AND_ALL|OR|NOT') {
      problems.push('§9.1 违反：secondary_keys.logic 枚举必须是 AND_ANY|AND_ALL|OR|NOT');
    }
    for (const field of ['id', 'title', 'origin', 'category', 'enabled', 'constant', 'recursive', 'keys', 'secondary_keys', 'insertion_slot', 'order', 'priority', 'content', 'code_examples']) {
      if (!(field in knowledgecard.properties)) problems.push(`§9.1 违反：词条缺少字段 ${field}`);
    }
    const originEnum = knowledgecard.defs.Origin.values.join('|');
    if (originEnum !== 'builtin|user') problems.push('§9.1 违反：origin 枚举必须是 builtin|user');
    const catEnum = knowledgecard.defs.Category.values.join('|');
    if (catEnum !== 'solution_skill|scene_modeling|both_slot|user_lore') {
      problems.push('§9.1 违反：category 枚举与正文不一致');
    }
    const prioEnum = knowledgecard.defs.Priority.values.join('|');
    if (prioEnum !== 'normal|high') problems.push('§9.1 违反：priority 枚举必须是 normal|high');
    const kindEnum = knowledgecard.defs.EntryKind?.values?.join('|');
    if (kindEnum !== KNOWLEDGECARD_ENTRY_KINDS.join('|')) {
      problems.push(`§9.1 违反：kind 枚举必须是 [${KNOWLEDGECARD_ENTRY_KINDS.join(', ')}]（提示词卡/本地规则卡不是 knowledgecard 条目）`);
    }
    if (!('kind' in knowledgecard.properties)) problems.push('§9.1 违反：词条缺少字段 kind');

    /* ── 第 5.7 期：三栏新字段的**派生**断言（§9.1 冻结字段集变更，裁决见 README A26） ──
     *
     * 这一组断言防的是本期最容易犯的错：**手写枚举**。
     * 手写 = 第二份事实来源 ⇒ 词表加一个考点，Schema 不跟着变，
     * 于是"模型判得出、契约存不下"，而且没有任何检查会红。
     * 三条断言把"派生"这件事钉死：
     *   ① 三栏必须都在 properties 里（不许改词表却忘了接契约）；
     *   ② 每栏的枚举必须**逐字等于**从 `knowledgecard-concepts.json` 派生的那份清单（顺序也一致）；
     *   ③ 数量必须 > 0（防"空枚举"把一切都判非法，那会让 137 条老库当场全红）。
     */
    if (KNOWLEDGECARD_CONCEPTS_FORMAT !== 'od-knowledgecard-concepts') {
      problems.push(`§9.1 违反：词表文件 format 必须是 od-knowledgecard-concepts，实际 ${KNOWLEDGECARD_CONCEPTS_FORMAT}`);
    }
    const derived = [
      ['concepts', 'ConceptId', KNOWLEDGECARD_CONCEPT_IDS, '考点词表（词表 A）'],
      ['tags', 'TagName', KNOWLEDGECARD_TAG_NAMES, '题型标签 / 细考点词表（词表 B）'],
      ['elements', 'ElementId', KNOWLEDGECARD_ELEMENT_IDS, '实体物理图元 · 动画元件词表'],
    ];
    for (const [field, defName, expect, label] of derived) {
      if (!(field in knowledgecard.properties)) {
        problems.push(`§9.1 违反：词条缺少 ${field} 字段（${label}；第 5.7 期新增，见 A26）`);
        continue;
      }
      const prop = knowledgecard.properties[field];
      const def = knowledgecard.defs[defName];
      if (!def || def.kind !== 'enum') {
        problems.push(`§9.1 违反：${field} 必须引用一个 enum 定义（${defName}），实际 ${def?.kind ?? '缺失'}`);
        continue;
      }
      const refsOk = prop?.kind === 'array' && prop.items?.kind === 'ref' && prop.items?.typeName === defName;
      if (!refsOk) {
        problems.push(`§9.1 违反：${field} 必须是 ${defName} 的数组（不许用自由字符串 —— 那样写什么都能存进去）`);
      }
      if (def.values.join('|') !== expect.join('|')) {
        problems.push(
          `§9.1 违反：${field} 的枚举必须**逐字等于**词表派生的那份 ${label}` +
            `（期望 ${expect.length} 项，实际 ${def.values.length} 项）—— 手写枚举是第二份事实来源，禁止`,
        );
      }
      if (def.values.length === 0) {
        /**
         * ⚠ 第 9 期开源版：`tags`（题型标签）的内容逐条派生于第三方教辅，已清空 ⇒ **允许空枚举**。
         *   `concepts`（考点）与 `elements`（动画元件）都是自有词表，仍然不许为空。
         */
        if (field !== 'tags') problems.push(`§9.1 违反：${field} 的枚举为空`);
      }
    }
    // 细考点必须能回答"它属于哪个考点"（运行期跨字段校验消费它；空值会让那条约束无法执行）
    const ownerless = KNOWLEDGECARD_TAG_NAMES.filter((t) => !(KNOWLEDGECARD_TAG_OWNERS[t] ?? []).length);
    if (ownerless.length) {
      problems.push(`§9.1 违反：有细考点没有归属考点，无法做跨字段校验：${ownerless.join('、')}`);
    }
    // 三栏**不得**进 required（灰度期硬要求：老词条没有这三栏也必须合法，否则内置库当场全红）
    for (const field of ['concepts', 'tags', 'elements']) {
      if ((knowledgecard.required ?? []).includes(field)) {
        problems.push(
          `§9.1/灰度违反：${field} 不得进 required —— 137 条老词条仍靠 keys 字面命中工作，` +
            `设成必填会让整个内置库当场非法（见 A26 与计划 §2 决定 4）`,
        );
      }
    }
  }

  /* ── 第 5 期：世界书导出包（§9.5） ──
   *
   * 这三条防的是"包内词条形状另立一套"：一旦包里自带一份词条字段定义，
   * 它迟早会与 knowledgecard-entry 漂移，而 W11（导出→导入→命中集合逐条相同）
   * 恰恰依赖两边**是同一套字段**。负对照见 tests/knowledgecard-selftest.mjs『W12-2』。 */
  const pack = specs.find((s) => s.id === 'knowledgecard-pack');
  if (!pack) {
    problems.push('缺少 knowledgecard-pack 契约（§9.5 导入导出）');
  } else {
    if (pack.properties?.format?.const !== 'od-knowledgecard') {
      problems.push('§9.5 违反：导出包 format 必须常量 "od-knowledgecard"');
    }
    if (pack.properties?.version?.const !== 1) {
      problems.push('§9.5 违反：导出包 version 必须常量 1');
    }
    const inlineEntry = pack.defs?.KnowledgecardEntry;
    if (!inlineEntry || inlineEntry.kind !== 'inline' || inlineEntry.spec?.id !== 'knowledgecard-entry') {
      problems.push('§9.5 违反：导出包的 entries 必须引用 knowledgecard-entry 契约（不得自带一份词条字段定义）');
    }
    if (pack.properties?.entries?.items?.typeName !== 'KnowledgecardEntry') {
      problems.push('§9.5 违反：导出包的 entries 元素类型必须是 KnowledgecardEntry');
    }
    if (!Array.isArray(pack.required) || pack.required.join('|') !== 'format|version|entries') {
      problems.push('§9.5 违反：导出包的 required 必须恰好是 format|version|entries');
    }
  }

  const cleaning = specs.find((s) => s.id === 'cleaning-rule');
  if (cleaning) {
    for (const field of ['id', 'name', 'stage', 'pattern', 'flags', 'replacement', 'enabled']) {
      if (!(field in cleaning.properties)) problems.push(`§12 违反：清洗规则缺少字段 ${field}`);
    }
    const stageEnum = cleaning.defs.CleaningStage.values.join('|');
    /**
     * ⚠ 这里**不再手写一个字符串去比**（第 5 期改）。
     *
     * 原来写死了一份阶段清单字符串 —— 那样每次
     * 改阶段枚举都要**记得**回来改这一行，忘了就静默放过（而这正是"守卫"最不该有的性质）。
     * 现在改成**结构断言**：清洗枚举必须恰好等于"主链路枚举去掉不产生模型文本的那些阶段"，
     * 顺序也必须一致。这样 §2.3 与 §12 的差异口径是被**推导**出来的，不可能各自漂移。
     */
    const expectedCleaning = PIPELINE_STAGES.filter((s) => !CLEANING_EXCLUDED_STAGES.includes(s));
    if (stageEnum !== expectedCleaning.join('|')) {
      problems.push(
        `§12 违反：stage 枚举必须恰好是"主链路去掉 ${CLEANING_EXCLUDED_STAGES.join(' / ')}"，` +
          `期望 [${expectedCleaning.join(', ')}]，实际 [${cleaning.defs.CleaningStage.values.join(', ')}]`,
      );
    }
    if (CLEANING_STAGES.join('|') !== expectedCleaning.join('|')) {
      problems.push('§12 违反：CLEANING_STAGES 常量与"主链路去掉 dry_run / repair"的结构口径不一致');
    }
    for (const s of CLEANING_EXCLUDED_STAGES) {
      if (cleaning.defs.CleaningStage.values.includes(s)) {
        problems.push(`§12 违反：${s} 不产生需要清洗的模型文本，不得进入 stage 枚举`);
      }
    }
  }

  /* ── 第 4 期：诊断条目与三档证据强度（§14.3 ①） ── */

  const diagnostic = specs.find((s) => s.id === 'diagnostic-record');
  if (!diagnostic) {
    problems.push('缺少 diagnostic-record 契约（第 4 期：自愈回灌的三档证据强度必须写进契约）');
  } else {
    const values = diagnostic.defs.Precision.values;
    // 顺序也是口径：UI 与回灌 Prompt 按"可信度从高到低"呈现，重排会让文案与顺序对不上。
    // ⚠ 比的是 FROZEN_EVIDENCE_PRECISIONS（独立字面量），不是 EVIDENCE_PRECISIONS 自己。
    if (values.join('|') !== FROZEN_EVIDENCE_PRECISIONS.join('|')) {
      problems.push(
        `三档证据强度违反：Precision 枚举必须恰好且按序等于 [${FROZEN_EVIDENCE_PRECISIONS.join(', ')}]，实际 [${values.join(', ')}]`,
      );
    }
    if (EVIDENCE_PRECISIONS.join('|') !== FROZEN_EVIDENCE_PRECISIONS.join('|')) {
      problems.push(
        `三档证据强度违反：EVIDENCE_PRECISIONS 必须与冻结口径一致 [${FROZEN_EVIDENCE_PRECISIONS.join(', ')}]，实际 [${EVIDENCE_PRECISIONS.join(', ')}]`,
      );
    }
    if (values.length !== 3) problems.push(`三档证据强度违反：必须恰好 3 档，实际 ${values.length} 档`);
    // 每档都必须有面向模型的中文标签与"该怎么改"的指引，否则回灌时只能自己编措辞
    for (const p of FROZEN_EVIDENCE_PRECISIONS) {
      if (!PRECISION_LABELS[p]) problems.push(`三档证据强度违反：${p} 缺少 PRECISION_LABELS 中文标签`);
      if (!PRECISION_GUIDANCE[p]) problems.push(`三档证据强度违反：${p} 缺少 PRECISION_GUIDANCE 回灌指引`);
    }
    // 诊断条目必须自带强度字段（这是本契约存在的唯一理由）
    if (!diagnostic.required.includes('precision')) {
      problems.push('三档证据强度违反：diagnostic-record 的 required 必须包含 precision');
    }
    if (!diagnostic.required.includes('slot')) {
      problems.push('三档证据强度违反：diagnostic-record 的 required 必须包含 slot（"第 6 行"必须能回答"哪个槽位"）');
    }
  }

  return problems;
}
