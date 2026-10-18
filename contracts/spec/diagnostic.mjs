/**
 * 诊断条目契约（第 4 期新增）—— **三档证据强度**（§14.3 ① 的接口前置条件）。
 *
 * ── 为什么要把它写进契约
 *
 * 第 2 期起，`core/dryrun/diagnostics.mjs` 就给每条行号诊断标注了 `precision`
 * （`exact` / `replayed` / `candidate`），但**它只是一个裸的报告字段**：
 * `contracts/` 里没有任何地方声明它，前端与自愈回灌都只能"约定了有这回事"。
 *
 * 第 4 期的自愈循环**必须**知道这个字段，而且必须把强度**回灌给模型**：
 *   · `exact`    —— 行号是埋点真记下来的，照着改；
 *   · `replayed` —— 由快照重放推出来的，可信但**可能与真实断点差一行**；
 *   · `candidate`—— 静态候选（AST 里"可能写这个键"的行），**只是候选，不要当成事实**。
 * 不告诉模型这个差别，它就会照着"候选行"改代码 —— 这是 §14.5 风险表第 3 条。
 *
 * ── 冻结口径
 *
 * 本契约只**固化第 2 期已经产出的事实**，不新增任何判据、不改 C1–C9 的任何一行
 * （§7.2 是冻结项）。它新增的是"这个字段的名字、取值与形状"，属**加法式**契约。
 *
 * 依据：§7.5（四件套之一"校验报告"）· §8.2（回灌内容）· §21.1 第 4 条
 *      （诊断面向模型可读：行号 + 最小复现 + 相关签名，不返回 stack trace）。
 */

import { CHECK_IDS } from './frozen-keys.mjs';

/**
 * 三档证据强度（冻结枚举 · 顺序即"证据强度从高到低"）。
 *
 * ⚠ 这个顺序有语义：UI 与回灌 Prompt 都按它呈现"可信度"，
 *   因此**不得重排**，也不得插入第四档（要加必须先改本文件并说明）。
 */
export const EVIDENCE_PRECISIONS = Object.freeze(['exact', 'replayed', 'candidate']);

/** 面向模型与用户的中文解释（回灌 Prompt 与报告渲染共用同一份，避免两处各自措辞） */
export const PRECISION_LABELS = Object.freeze({
  exact: '精确',
  replayed: '重放定位',
  candidate: '候选',
});

/** 回灌给模型时**必须**附上的强度说明（§14.5 风险 3 的对策） */
export const PRECISION_GUIDANCE = Object.freeze({
  exact: '行号由运行时埋点直接记录，可以按它定位并修改。',
  replayed: '行号由快照重放推导，通常正确，但可能与真正的出错语句相差一行，请结合上下文判断。',
  candidate: '这只是静态分析给出的候选行（未能定位到确切语句），请先阅读整段代码再改动，不要机械地只改这一行。',
});

export const diagnosticRecord = {
  id: 'diagnostic-record',
  title: '诊断条目（§6.2 / §7.5 · 含三档证据强度）',
  schemaId: 'https://open-design.local/contracts/diagnostic-record.schema.json',
  description:
    '校验报告与自愈回灌共用的诊断条目。`precision` 是**三档证据强度**（第 4 期写入契约）：' +
    'exact（埋点直记）/ replayed（快照重放推导）/ candidate（静态候选）。' +
    '回灌给模型时**必须**带上强度，否则模型会照着"候选行"改代码。' +
    '本契约不新增判据、不改 §7.2 的 C1–C9。',
  root: 'Diagnostic',
  defs: {
    /** 三档证据强度（冻结枚举） */
    Precision: {
      kind: 'enum',
      values: [...EVIDENCE_PRECISIONS],
      title: '三档证据强度（顺序即"可信度从高到低"，不得重排）',
      description: 'exact=埋点直记 · replayed=快照重放推导 · candidate=静态候选（须先读上下文）',
    },
    /** 归属检查号：C1–C9 是 §7.2 冻结项；X1/X2 与 C10 是扩展检查 */
    CheckId: {
      kind: 'enum',
      values: [...CHECK_IDS],
      title: '§7.2 冻结检查号（C1–C9）；扩展检查 X1/X2/C10 见报告 extensions[]',
    },
    /** 诊断上下文行（§6.2：给上下文，不给 stack trace） */
    ContextLine: {
      kind: 'object',
      title: '上下文行（前后各一行）',
      required: ['line', 'text'],
      additionalProperties: false,
      properties: {
        line: { kind: 'integer', minimum: 1 },
        text: { kind: 'string' },
        isTarget: { kind: 'boolean', description: '该行是否为诊断指向的那一行' },
      },
    },
  },
  properties: {
    check: { kind: 'ref', typeName: 'CheckId' },
    rule: { kind: 'string', minLength: 1, description: '规则名（机器可读，如 unknown-global / boundary-jump）' },
    slot: {
      kind: 'string',
      minLength: 1,
      description: '槽位名（§3.2 冻结键名之一，或数据型槽位）；空槽位级的诊断也必须有槽位名',
    },
    line: {
      kind: 'nullable',
      inner: { kind: 'integer', minimum: 1 },
      description: '槽位内 1-based 行号；无法定位时为 null（**不得**假装精确）',
    },
    column: {
      kind: 'nullable',
      inner: { kind: 'integer', minimum: 1 },
      description: '列号；acorn 后端给得出，其他手段可能为 null',
    },
    message: { kind: 'string', minLength: 1, description: '面向模型可读的说明（不含 stack trace、不含绝对路径）' },
    precision: { kind: 'ref', typeName: 'Precision' },
    context: { kind: 'array', items: { kind: 'ref', typeName: 'ContextLine' } },
  },
  required: ['check', 'rule', 'slot', 'line', 'message', 'precision'],
};
