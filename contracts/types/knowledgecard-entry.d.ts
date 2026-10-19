/* eslint-disable */
// ⚠ 本文件由 contracts/generate-contracts.mjs 自动生成，请勿手改。
// 来源：contracts/spec/contract-fields.mjs（与 JSON Schema 同源）。
// 契约 id：knowledgecard-entry · 依据：物理解题动画软件 v1.0 自研方案
/**
 * §9.1 世界书槽位名 = 目标阶段名
 */
export type InsertionSlot = "solve" | "scene_code";

export type Origin = "builtin" | "user";

export type Category = "solution_skill" | "scene_modeling" | "both_slot" | "user_lore";

/**
 * 知识卡类型（只含 knowledgecard 条目：动画规范 / 元件 / 场景）
 * 提示词卡与本地规则卡属于产品层知识卡，但不是 knowledgecard 条目，不走这个字段。缺省按 element 处理（兼容旧包）；类型只影响 UI 分组与注入顺序，不影响命中语义。
 */
export type EntryKind = "anim_rule" | "element" | "scene";

export type SecondaryLogic = "AND_ANY" | "AND_ALL" | "OR" | "NOT";

export type Priority = "normal" | "high";

/**
 * 次级键逻辑
 */
export interface SecondaryKeys {
  "logic": SecondaryLogic;
  /**
   * 次级键；空数组时 AND_ANY/AND_ALL/OR 直接通过，NOT 视为通过
   */
  "list": Array<string>;
}

/**
 * 考点词表（词表 A；派生自 contracts/knowledgecard-concepts.json）
 * 解题侧一级触发源。判定：concepts 相交 且（tags 相交 或 tags 为空）。
 */
export type ConceptId = "uniform_acceleration" | "motion_graphs" | "free_fall_vertical" | "pursuit_encounter" | "relative_motion" | "projectile_motion" | "circular_motion" | "force_analysis" | "dynamic_equilibrium" | "whole_isolate" | "newton_laws" | "dynamics_two_ways" | "connected_bodies" | "spring_force" | "block_board" | "conveyor_belt" | "critical_cases" | "gravitation" | "artificial_satellite" | "relativity" | "work_power" | "kinetic_energy_theorem" | "mechanical_energy_conservation" | "work_energy_relation" | "variable_force_work" | "momentum_theorem" | "momentum_conservation" | "collision" | "man_boat_explosion" | "simple_harmonic" | "mechanical_wave" | "refraction_total_reflection" | "light_wave_nature" | "electrostatics_field" | "charge_in_electric_field" | "capacitor" | "dc_circuit" | "closed_circuit" | "magnetic_field_ampere" | "lorentz_particle" | "combined_fields" | "induction_law" | "induction_circuit_graph" | "rod_energy" | "ac_generation" | "transformer_transmission" | "em_wave" | "molecular_theory" | "gas_laws" | "solids_liquids" | "thermo_laws" | "wave_particle_duality" | "atomic_structure" | "atomic_nucleus" | "exp_mechanics" | "exp_electricity" | "exp_optics_thermal";

/**
 * 题型标签 / 细考点词表（词表 B；派生自同一份词表，按考点分组）
 * 解题侧二级。**跨字段约束（Schema 表达不了，落在运行期）**：一条词条的每个 tag 必须属于该词条某个 concepts；`tags` 为空 = 该考点下的通用词条（方案 b 兜底）。
 */
export type TagName = ;

/**
 * 实体物理图元 · 动画元件词表（派生自同一份词表；原名 devices / 器材）
 * 动画侧触发源。命中 = 词条 elements ∩ 模型报的动画元件 ≠ ∅，再用考点收窄。判定细则（用户裁决 A25）：矢量箭头**算**；尺寸标注、文字标注**不算**。
 */
export type ElementId = "block" | "board" | "incline" | "ball" | "arc_track" | "ground" | "spring" | "pulley" | "rope" | "rod" | "stand" | "belt" | "circuit" | "plates" | "ray" | "lens" | "field_region" | "vector" | "trace_path" | "paper_tape" | "ghosts" | "axis_box" | "chart" | "graph_wave" | "orbit" | "cylinder_piston" | "gas_tube" | "light_spot" | "measuring_tool" | "raw_composite";

/**
 * 世界书词条（§9.1 字段冻结）
 * §9.1 词条模型。`insertion_slot` 元素只能是 solve | scene_code（= 目标阶段名）；`scene_spec` 是 v2 旧名，不得进入枚举，仅在导入路径归一化。
 */
export interface KnowledgecardEntry {
  /**
   * 词条 id，同库内不得重复
   * @minLength 1 @pattern ^[A-Za-z0-9._-]+$
   */
  "id": string;
  "title": string;
  "origin": Origin;
  "category": Category;
  "kind"?: EntryKind;
  "enabled": boolean;
  /**
   * 常驻：无条件注入
   * @default false
   */
  "constant"?: boolean;
  /**
   * 允许被级联唤醒 / 自身可唤醒别人
   * @default true
   */
  "recursive"?: boolean;
  /**
   * 主键；空数组时 constant 为真仍注入，否则仅可被递归唤醒
   */
  "keys": Array<string>;
  "secondary_keys"?: SecondaryKeys;
  /**
   * 考点（词表 A）；元素必须是 ConceptId 枚举内的 id。空/缺省 ⇒ 该词条不走概念分发
   */
  "concepts"?: Array<ConceptId>;
  /**
   * 题型标签 / 细考点（词表 B）；每个 tag 必须属于本词条某个 concepts。空数组 = 该考点下的通用词条
   */
  "tags"?: Array<TagName>;
  /**
   * 实体物理图元（动画元件，原名 devices/器材）；元素必须是 ElementId 枚举内的 id
   */
  "elements"?: Array<ElementId>;
  /**
   * 空数组 [] 合法但标注"未挂槽位"；元素只能是 solve | scene_code
   */
  "insertion_slot": Array<("solve" | "scene_code")>;
  /**
   * 同槽位内排序，小在前；同 order 按 id 稳定排序
   * @default 100
   */
  "order"?: number;
  "priority"?: Priority;
  /**
   * 正文；双槽词条按 "## 解题" / "## 动画建模" 二级标题切分
   * @minLength 1
   */
  "content": string;
  /**
   * §9.5 用法示例（第 5 期接入引擎；字段形状本期冻结）
   */
  "code_examples"?: Array<string>;
}

/** v2 旧槽位名，仅允许在导入路径按别名归一化为 scene_code（§9.1）。 */
export type DeprecatedInsertionSlot = "scene_spec";
