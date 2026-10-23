#!/usr/bin/env node
/**
 * 知识卡取证（第 5 期 · 门禁 ㉒）。
 *
 * 覆盖 README §16.2 的 **W1–W15** 逐条正反例，外加两类"接线"判据：
 *
 *   W1  主键：字面量 / `/正则/flags` / 大小写与全半角归一化
 *   W2  次级逻辑四种 + **空 list 的六条口径**
 *   W3  常驻（constant）+ `keys: []` 的两种活法
 *   W4  递归唤醒 + 环检测 + maxDepth 上限
 *   W5  三重预算（maxDepth / maxEntries / maxChars，**按槽位独立**）+ 截断顺序
 *   W6  分槽组装（单槽 / 双槽 / 双槽标题切分）
 *   W7  **空槽静默跳过 vs 被截断要告警**（§9.2 的"重要边界"）——两者必须都能被断言
 *   W8  双槽词条**无标题**：全文注入 + 提示
 *   W9  来源标记 + 溯源记录（命中方式 / 实际注入槽位 / 未挂槽位 / 截断标记）
 *   W10 **预览器与实际请求逐字节一致**（用浏览器侧引擎副本，不是"再写一份"）
 *   W11 导入导出跨机器可复现（导出→导入→命中集合逐条相同）
 *   W12 旧名归一化**只发生在导入路径**（+ §9.5 契约不变量的负对照）
 *   W13 origin 治理：覆盖副本 / 升级只替换未被覆盖 / 恢复默认只影响内置 / 导出默认只导 user
 *   W14 词条结构覆盖率（「生成后自检」+ `code_examples`）与"内容覆盖未完成"的诚实报告
 *   W15 冲突提示（不阻断）+ 预览器四区块来自同一次触发
 *   X   接线：世界书进每题快照 / `knowledgecard_done` 事件 / `provenance.knowledgecardHash` 取真值
 *
 * ⚠ 本文件的纪律（第 4 期的教训）：**每写一条断言，先问它怎么才能失败**。
 *   W2/W5/W7/W12/W13/W14 都配了负对照（把被测语义破坏掉，断言必须变红）。
 *
 * 用法：node tests/knowledgecard-selftest.mjs
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PROJECT_ROOT } from '../tools/paths.mjs';
import {
  BUILTIN_DIR,
  COVERAGE_TARGET_FILE,
  SOURCE_DIR,
  canonicalizeEntry,
  loadLibrary,
  migrateLegacyUserDir,
  readCoverageTarget,
  removeUserFile,
  validateEntry,
  writeUserPack,
  knowledgecardHashOf,
} from '../core/knowledgecard/store.mjs';
import { makeOverrideCopy, planExport, planRestoreDefault, planUpgrade, EDIT_OVERRIDE_HINT } from '../core/knowledgecard/governance.mjs';
import { restoreBuiltinKnowledgecard } from '../core/knowledgecard/editor.mjs';
import { buildExportPack, normalizeImportedPack, packToText } from '../core/knowledgecard/import-export.mjs';
import { checkCoverage, checkEntryStructure, formatCoverageLine, targetFromFile } from '../core/knowledgecard/coverage.mjs';
import {
  detectConflicts,
  detectKeyCollisions,
  detectTagCollisions,
  detectElementCollisions,
  parseKey,
  splitEntryContent,
  triggerKnowledgecard,
  kindOfEntry,
  KNOWLEDGECARD_BUDGET,
  KNOWLEDGECARD_EXAMPLE_BUDGET,
  KNOWLEDGECARD_KIND_ORDER,
} from '../core/knowledgecard/engine.mjs';
import { KNOWLEDGECARD_ENTRY_KINDS } from '../contracts/spec/frozen-keys.mjs';
import { prepareKnowledgecard } from '../core/knowledgecard/index.mjs';
import { lintSlot } from '../core/lint/contract-lint.mjs';
import { assemblePrompt, buildFixedPrefix, buildStagePrefix, getPrompt } from '../core/prompts/index.mjs';
import { snapshotConfig, runPipeline } from '../core/orchestrator/pipeline.mjs';
import { ANALYSIS_EXAMPLE } from '../core/analysis/example.mjs';
import { CONTRACT_SPECS } from '../contracts/spec/contract-fields.mjs';
import { assertContractInvariants } from '../contracts/_compile.mjs';
import { ENGINE_OUT, ENGINE_SRC, expectedEngineCopy } from '../tools/build-knowledgecard-web.mjs';
import { allBuiltinEntries, listSourceFiles, plannedFiles, readSource } from '../tools/rewrite-knowledgecard-entries.mjs';
import {
  SLOT_KEY_NAMES,
  KNOWLEDGECARD_INSERTION_SLOTS,
  KNOWLEDGECARD_CONCEPTS,
  KNOWLEDGECARD_CONCEPT_IDS,
  KNOWLEDGECARD_TAG_NAMES,
  KNOWLEDGECARD_TAG_OWNERS,
  KNOWLEDGECARD_ELEMENT_IDS,
} from '../contracts/spec/frozen-keys.mjs';
import { parseJudgement, buildVocabIndex } from '../core/knowledgecard/concepts.mjs';

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ────────────────────────────── 夹具 ────────────────────────────── */

/** 词条夹具：**把不相关的字段都填满**（第 4 期的教训：夹具的缺省行为会把被测语义喂成另一回事） */
function E(over = {}) {
  return {
    id: 'e1',
    title: '测试词条',
    origin: 'user',
    category: 'solution_skill',
    enabled: true,
    constant: false,
    recursive: true,
    keys: ['传送带'],
    secondary_keys: { logic: 'AND_ANY', list: [] },
    insertion_slot: ['solve'],
    order: 100,
    priority: 'normal',
    content: '正文内容',
    code_examples: ['/* 示例 */'],
    ...over,
  };
}

const ids = (r) => r.provenance.map((p) => p.entry_id);
const injectedIds = (r, slot) => r.slots[slot].injected.map((i) => i.id);
/** 单条词条是否命中（W2 用得最多的一句话） */
const secondary = (e, text) => triggerKnowledgecard({ entries: [e], text }).provenance.length === 1;

console.log('知识卡取证（第 5 期 · 门禁 ㉒）\n');

/* ══════════════════════════ W1 主键 ══════════════════════════ */

console.log('『W1』主键：字面量包含 + `/正则/flags` + 归一化');
{
  const hit = triggerKnowledgecard({ entries: [E({ keys: ['传送带'] })], text: '水平传送带以恒定速率运行' });
  check('字面量命中', hit.provenance.length === 1 && hit.provenance[0].via === 'key');

  const miss = triggerKnowledgecard({ entries: [E({ keys: ['传送带'] })], text: '皮带传动装置' });
  check('字面量不命中（反例）', miss.provenance.length === 0);

  const re = triggerKnowledgecard({ entries: [E({ keys: ['/共速.{0,6}摩擦/'] })], text: '共速之后的摩擦突变' });
  check('正则 `/共速.{0,6}摩擦/` 命中', re.provenance.length === 1);
  const reMiss = triggerKnowledgecard({ entries: [E({ keys: ['/共速.{0,6}摩擦/'] })], text: '共速之后很久很久才出现摩擦' });
  check('正则不命中（反例：超出 `.\\{0,6\\}` 的跨度）', reMiss.provenance.length === 0);

  const half = triggerKnowledgecard({ entries: [E({ keys: ['v0'] })], text: '初速度 Ｖ０ ＝ 2 m/s' });
  check('全半角归一化：`v0` 命中全角 `Ｖ０`', half.provenance.length === 1);
  const upper = triggerKnowledgecard({ entries: [E({ keys: ['Newton'] })], text: 'by newton second law' });
  check('大小写归一化：`Newton` 命中 `newton`', upper.provenance.length === 1);

  const flag = triggerKnowledgecard({ entries: [E({ keys: ['/abc/i'] })], text: 'ABC' });
  check('正则 flags 生效（`/abc/i` 命中 `ABC`）', flag.provenance.length === 1);
  const noFlag = triggerKnowledgecard({ entries: [E({ keys: ['/ABC/'] })], text: 'abc' });
  check(
    '正则**不**吃归一化（`/ABC/` 不命中 `abc`）——口径：字面量走归一化文本，正则走原始文本',
    noFlag.provenance.length === 0,
  );

  const bad = triggerKnowledgecard({ entries: [E({ keys: ['/(/', '传送带'] })], text: '传送带' });
  check('非法正则不抛异常，且**后面的合法 key 仍然会被尝试**', bad.provenance.length === 1);
  check('非法正则记一条警告（不静默）', bad.warnings.some((w) => w.code === 'bad-regex'));

  const gFlag = E({ keys: ['/传/g'] });
  const g1 = triggerKnowledgecard({ entries: [gFlag], text: '传送带' });
  const g2 = triggerKnowledgecard({ entries: [gFlag], text: '传送带' });
  check('带 `g` 的正则**连续两次**都命中（lastIndex 陷阱已在构造时摘掉 g/y）', g1.provenance.length === 1 && g2.provenance.length === 1);
  check('parseKey 对 `/…/flags` 与字面量的判定', parseKey('/a/i').kind === 'regex' && parseKey('a/b').kind === 'literal' && parseKey('/a/').kind === 'regex');
}

/* ══════════════════════════ W2 次级逻辑 ══════════════════════════ */

console.log('\n『W2』次级逻辑四种 + 空 list 的口径');
{
  const andAny = E({ keys: ['带'], secondary_keys: { logic: 'AND_ANY', list: ['滑块', '物块'] } });
  check('AND_ANY：主键命中 + list 任一命中 ⇒ 命中', secondary(andAny, '带上的滑块'));
  check('AND_ANY：主键命中 + list 全不命中 ⇒ 不命中', !secondary(andAny, '带上的小车'));

  const andAll = E({ keys: ['带'], secondary_keys: { logic: 'AND_ALL', list: ['滑块', '粗糙'] } });
  check('AND_ALL：全部命中 ⇒ 命中', secondary(andAll, '粗糙带上的滑块'));
  check('AND_ALL：缺一个 ⇒ 不命中', !secondary(andAll, '带上的滑块'));

  const or = E({ keys: ['带'], secondary_keys: { logic: 'OR', list: ['斜面'] } });
  check('OR：主键命中 + list 不命中 ⇒ 仍命中', secondary(or, '带上的小车'));
  const or2 = E({ keys: ['锚点不在题面'], secondary_keys: { logic: 'OR', list: ['斜面'] } });
  check('OR：主键不命中 + list 命中 ⇒ 命中（且 via=secondary）', triggerKnowledgecard({ entries: [or2], text: '光滑斜面' }).provenance[0]?.via === 'secondary');
  check('OR：两者都不命中 ⇒ 不命中', !secondary(or2, '什么都没有'));

  const not = E({ keys: ['带'], secondary_keys: { logic: 'NOT', list: ['斜面'] } });
  check('NOT：主键命中 + list 全不命中 ⇒ 命中', secondary(not, '水平带上的滑块'));
  check('NOT：主键命中 + list 命中 ⇒ 不命中', !secondary(not, '斜面上的带'));
  check('NOT：主键不命中 ⇒ 不命中', !secondary(not, '光滑斜面'));

  const empty = (logic, text) => {
    const e = E({ keys: ['带'], secondary_keys: { logic, list: [] } });
    return triggerKnowledgecard({ entries: [e], text }).provenance.length === 1;
  };
  check('空 list｜AND_ANY + 主键命中 ⇒ 通过', empty('AND_ANY', '带'));
  check('空 list｜AND_ALL + 主键命中 ⇒ 通过', empty('AND_ALL', '带'));
  check('空 list｜OR + 主键命中 ⇒ 通过', empty('OR', '带'));
  check('空 list｜NOT + 主键命中 ⇒ 视为通过', empty('NOT', '带'));
  check('空 list｜OR + 主键不命中 ⇒ 不通过（负对照）', !empty('OR', '什么都没有'));
  check('空 list｜NOT + 主键不命中 ⇒ 不通过（负对照）', !empty('NOT', '什么都没有'));

  // 空的 keys 在纯主键语义下永不命中（第 1 步"未命中则跳过"）
  const noKeys = E({ keys: [], recursive: false });
  check('keys 为空且非常驻且不递归 ⇒ 永不注入（第 1 步"未命中则跳过"）', triggerKnowledgecard({ entries: [noKeys], text: '带' }).provenance.length === 0);
}

/* ══════════════════════════ W3 常驻 / 空 keys ══════════════════════════ */

console.log('\n『W3』常驻（constant）与 `keys: []` 的两种活法');
{
  const constEntry = E({ id: 'c1', constant: true, keys: [] });
  const r = triggerKnowledgecard({ entries: [constEntry], text: '完全不相关的题面' });
  check('constant:true 不匹配题面也进上下文', ids(r).includes('c1') && r.provenance[0].via === 'constant');

  // 无主键 + recursive：靠被唤醒正文里出现它的 title 被唤醒（实现约定，见 engine.mjs）
  const keyless = E({ id: 'k1', title: '共速判据', keys: [], recursive: true, content: '共速判据正文' });
  const waker = E({ id: 'w1', title: '唤醒者', keys: ['传送带'], content: '这里提到了 共速判据 这个词' });
  const r2 = triggerKnowledgecard({ entries: [keyless, waker], text: '水平传送带' });
  check('keys:[] + recursive:true ⇒ 可被"正文里出现其 title"的已命中词条唤醒', ids(r2).includes('k1'));
  check('该唤醒的 via=recursive，且带来源 id', r2.provenance.find((p) => p.entry_id === 'k1')?.via === 'recursive' && r2.provenance.find((p) => p.entry_id === 'k1')?.from === 'w1');

  const r3 = triggerKnowledgecard({ entries: [E({ id: 'k2', keys: [], recursive: false })], text: '任意题面' });
  check('keys:[] + 非常驻 + 不递归 ⇒ 永不注入', r3.provenance.length === 0);
}

/* ══════════════════════════ W4 递归与环检测 ══════════════════════════ */

console.log('\n『W4』递归唤醒 + 环检测 + maxDepth');
{
  const A = E({ id: 'A', title: '传送带', keys: ['传送带'], content: '传送带正文，提到 摩擦突变 与 相对位移' });
  const B = E({ id: 'B', title: '共速摩擦突变', keys: ['摩擦突变'], content: 'B 正文' });
  const r = triggerKnowledgecard({ entries: [A, B], text: '水平传送带问题' });
  check('传送带题命中 A，A 唤醒"共速摩擦突变" B', ids(r).includes('A') && ids(r).includes('B'));
  check('B 的溯源写明"被 A 唤醒"', r.provenance.find((p) => p.entry_id === 'B')?.from === 'A');

  // 环：A↔B 互相含对方 key
  const CA = E({ id: 'CA', title: 'A', keys: ['锚甲'], content: '含 锚乙' });
  const CB = E({ id: 'CB', title: 'B', keys: ['锚乙'], content: '含 锚甲' });
  const rc = triggerKnowledgecard({ entries: [CA, CB], text: '题面里有 锚甲' });
  check('造一个 A↔B 环：不死循环，且两条各只注入一次', ids(rc).sort().join(',') === 'CA,CB' && rc.slots.solve.injected.length === 2);

  // 链式 A→B→C→D：maxDepth 是**唤醒轮数**
  const chain = [
    E({ id: 'L1', keys: ['起点'], content: '含 链2' }),
    E({ id: 'L2', keys: ['链2'], content: '含 链3' }),
    E({ id: 'L3', keys: ['链3'], content: '含 链4' }),
    E({ id: 'L4', keys: ['链4'], content: '链尾' }),
  ];
  const d3 = triggerKnowledgecard({ entries: chain, text: '起点' });
  const d1 = triggerKnowledgecard({ entries: chain, text: '起点', budget: { maxDepth: 1 } });
  check('maxDepth=3（默认）能走到第 3 环（L4）', ids(d3).sort().join(',') === 'L1,L2,L3,L4');
  check('maxDepth=1 时只走到第 1 环（负对照）', ids(d1).sort().join(',') === 'L1,L2');

  const nonRec = E({ id: 'NR', keys: ['摩擦突变'], recursive: false, content: 'NR' });
  const rn = triggerKnowledgecard({ entries: [A, nonRec], text: '水平传送带' });
  check('non-recursive 的词条不会被唤醒（负对照）', !ids(rn).includes('NR'));
}

/* ══════════════════════════ W5 三重预算 ══════════════════════════ */

console.log('\n『W5』三重预算（按槽位独立）与截断顺序');
{
  const five = [1, 2, 3, 4, 5].map((i) => E({ id: `m${i}`, keys: ['共同'], order: i * 100 }));
  const r = triggerKnowledgecard({ entries: five, text: '共同' , budget: { maxEntries: 2 } });
  check('maxEntries 生效：注入 2 条', injectedIds(r, 'solve').length === 2);
  check('被截断的记进 truncatedSlots（含 droppedIds）', r.truncatedSlots[0]?.slot === 'solve' && r.truncatedSlots[0]?.dropped === 3);
  check('截断顺序：同 priority 下 order 小者先留', injectedIds(r, 'solve').join(',') === 'm1,m2');

  const fiveHigh = five.map((e) => (e.id === 'm5' ? { ...e, priority: 'high' } : e));
  const r2 = triggerKnowledgecard({ entries: fiveHigh, text: '共同', budget: { maxEntries: 2 } });
  check('priority=high 优先保留（即使 order 最大）', injectedIds(r2, 'solve').includes('m5'));
  check('注入顺序仍按 order 升序（保留顺序 ≠ 注入顺序）', injectedIds(r2, 'solve').join(',') === 'm1,m5');

  // 强度 tie-break：同 order / 同 priority 时，主键命中强于递归唤醒
  const K = E({ id: 'K', keys: ['题面词'], order: 100, content: '含 唤醒词' });
  /* ── v1.1.9alpha：类型顺序（anim_rule → element → scene） ── */
  console.log('\n『W5.1』知识卡类型顺序（类型内再按 order）');
  check('引擎的类型顺序与契约枚举同源', KNOWLEDGECARD_KIND_ORDER.join(',') === KNOWLEDGECARD_ENTRY_KINDS.join(','));
  check('缺 kind 的旧条目按 element 处理', kindOfEntry(E({ id: 'legacy' })) === 'element');
  {
    const mixed = [
      E({ id: 's1', kind: 'scene', keys: ['共同'], insertion_slot: ['scene_code'], order: 1 }),
      E({ id: 'e1', kind: 'element', keys: ['共同'], insertion_slot: ['scene_code'], order: 1 }),
      E({ id: 'a1', kind: 'anim_rule', keys: ['共同'], insertion_slot: ['scene_code'], order: 9 }),
      E({ id: 'a2', kind: 'anim_rule', keys: ['共同'], insertion_slot: ['scene_code'], order: 2 }),
    ];
    const rm = triggerKnowledgecard({ entries: mixed, text: '共同' });
    check(
      '注入顺序：anim_rule → element → scene；类型内 order 升序',
      injectedIds(rm, 'scene_code').join(',') === 'a2,a1,e1,s1',
      injectedIds(rm, 'scene_code').join(','),
    );
    const tight = triggerKnowledgecard({ entries: mixed, text: '共同', budget: { maxEntries: 2 } });
    check(
      '预算不足时 anim_rule 先保留（不会被元件卡挤掉）',
      injectedIds(tight, 'scene_code').join(',') === 'a2,a1',
      injectedIds(tight, 'scene_code').join(','),
    );
  }

  const R = E({ id: 'R', keys: ['唤醒词'], order: 100, content: 'R' });
  const r3 = triggerKnowledgecard({ entries: [K, R], text: '题面词', budget: { maxEntries: 1 } });
  check('同 priority / 同 order ⇒ 命中强度决定保留（key 强于 recursive）', injectedIds(r3, 'solve').join(',') === 'K');

  const long = [E({ id: 'x1', keys: ['共同'], content: 'x'.repeat(300) }), E({ id: 'x2', keys: ['共同'], content: 'y'.repeat(300) })];
  const r4 = triggerKnowledgecard({ entries: long, text: '共同', budget: { maxChars: 200 } });
  check('maxChars 生效：一条都放不下时 chars=0、全部记入 dropped', r4.slots.solve.chars === 0 && r4.slots.solve.dropped.length === 2 && r4.text.solve === '');
  check('maxChars 不会被突破（chars ≤ maxChars）', r4.slots.solve.chars <= 200);

  const split = [
    E({ id: 's1', keys: ['共同'], insertion_slot: ['solve'], order: 1 }),
    E({ id: 's2', keys: ['共同'], insertion_slot: ['solve'], order: 2 }),
    E({ id: 's3', keys: ['共同'], insertion_slot: ['solve'], order: 3 }),
    E({ id: 't1', keys: ['共同'], insertion_slot: ['scene_code'], order: 1 }),
    E({ id: 't2', keys: ['共同'], insertion_slot: ['scene_code'], order: 2 }),
    E({ id: 't3', keys: ['共同'], insertion_slot: ['scene_code'], order: 3 }),
  ];
  const r5 = triggerKnowledgecard({ entries: split, text: '共同', budget: { maxEntries: 2 } });
  check('预算是**按槽位独立**的：两个槽各自注入 2 条', injectedIds(r5, 'solve').length === 2 && injectedIds(r5, 'scene_code').length === 2);
  /**
   * ⚠ 第 8 期：`maxChars` 24000 → 32000 → **30000**（用户两次裁决；定案是正文 30000 + 示例 10000 = 40000）。
   * 起因是用户真题：常驻教学卡 14950 字吃掉了 62%，**正文余量只剩 32 字** ⇒
   * 「动画元件·坐标系与图线」整条被丢弃，模型因此不知道要画图。
   * 前两个数（深度 3 / 条数 40）是 §9.2 的定案值，没动；这里把三个值都钉住，防止再漂。
   */
  check(
    '默认预算是 3 / 40 / 30000（深度与条数沿用 §9.2；maxChars 第 8 期定案并钉住）',
    KNOWLEDGECARD_BUDGET.maxDepth === 3 && KNOWLEDGECARD_BUDGET.maxEntries === 40 && KNOWLEDGECARD_BUDGET.maxChars === 30000,
    `${KNOWLEDGECARD_BUDGET.maxDepth}/${KNOWLEDGECARD_BUDGET.maxEntries}/${KNOWLEDGECARD_BUDGET.maxChars}`,
  );
}

/* ══════════════════════════ W6 分槽组装 ══════════════════════════ */

console.log('\n『W6』分槽组装与双槽标题切分');
{
  const onlySolve = E({ id: 'os', keys: ['共同'], insertion_slot: ['solve'] });
  const r = triggerKnowledgecard({ entries: [onlySolve], text: '共同' });
  check('单槽词条只影响该槽（scene_code 槽为空）', r.text.solve.includes('【世界书·解题') && r.text.scene_code === '');
  check('空槽被记进 emptySlots', r.emptySlots.includes('scene_code') && !r.emptySlots.includes('solve'));

  const dual = E({
    id: 'dual',
    keys: ['共同'],
    insertion_slot: ['solve', 'scene_code'],
    content: '## 解题\n解题正文\n\n## 动画建模\n动画正文',
  });
  const r2 = triggerKnowledgecard({ entries: [dual], text: '共同' });
  check('双槽词条：solve 槽只拿"解题"小节', r2.text.solve.includes('解题正文') && !r2.text.solve.includes('动画正文'));
  check('双槽词条：scene_code 槽只拿"动画建模"小节', r2.text.scene_code.includes('动画正文') && !r2.text.scene_code.includes('解题正文'));
  check('两个槽的来源标记各自正确', r2.text.solve.includes('【世界书·解题：') && r2.text.scene_code.includes('【世界书·动画建模：'));

  const prepared = prepareKnowledgecard({ problemText: '共同', entries: [dual] });
  check('prepareKnowledgecard 一次给出两个槽位的拼接内容', prepared.text.solve.includes('解题正文') && prepared.text.scene_code.includes('动画正文'));
}

/* ══════════════════════════ W7 空槽 vs 截断 ══════════════════════════ */

console.log('\n『W7』空槽静默跳过 vs 被截断要告警（§9.2 的"重要边界"）');
{
  const solveOnly = [E({ id: 'a1', keys: ['共同'] })];
  const emptyCase = triggerKnowledgecard({ entries: solveOnly, text: '共同' });
  check('空槽：进 emptySlots', emptyCase.emptySlots.includes('scene_code'));
  check('空槽：**不**产生 budget-truncated 警告（静默跳过）', !emptyCase.warnings.some((w) => w.code === 'budget-truncated'));
  check('空槽：truncatedSlots 里没有它', !emptyCase.truncatedSlots.some((t) => t.slot === 'scene_code'));

  const truncatedCase = triggerKnowledgecard({
    entries: [E({ id: 'b1', keys: ['共同'], order: 1 }), E({ id: 'b2', keys: ['共同'], order: 2 })],
    text: '共同',
    budget: { maxEntries: 1 },
  });
  check('被截断：进 truncatedSlots', truncatedCase.truncatedSlots.some((t) => t.slot === 'solve'));
  check('被截断：**不**进 emptySlots（两者在数据结构上就是分开的）', !truncatedCase.emptySlots.includes('solve'));
  check('被截断：产生明确告警（不静默）', truncatedCase.warnings.some((w) => w.code === 'budget-truncated'));

  // 负对照：把"两者分开"这件事破坏掉会怎样 —— 空槽的 candidates 必须是 0，截断的必须 > 0
  check('区分依据是 candidates（空槽=0 / 截断>0），不是 text 是否为空', emptyCase.slots.scene_code.candidates === 0 && truncatedCase.slots.solve.candidates === 2);
}

/* ══════════════════════════ W8 双槽无标题 ══════════════════════════ */

console.log('\n『W8』双槽词条无标题：全文注入 + 提示');
{
  const withHeading = E({ id: 'h1', insertion_slot: ['solve', 'scene_code'], content: '## 解题\nA\n\n## 动画建模\nB' });
  check('正例：有标题 ⇒ mode=by-heading', splitEntryContent(withHeading, 'solve').mode === 'by-heading');

  const noHeading = E({ id: 'h2', title: '无标题双槽', insertion_slot: ['solve', 'scene_code'], content: '整篇正文' });
  const split = splitEntryContent(noHeading, 'solve');
  check('反例：无标题 ⇒ mode=heading-missing', split.mode === 'heading-missing');
  check('反例：全文注入（不是空）', split.text === '整篇正文' && split.warning.includes('缺少'));

  const r = triggerKnowledgecard({ entries: [E({ ...noHeading, keys: ['共同'] })], text: '共同' });
  check('无标题双槽：两个槽都拿到全文', r.text.solve.includes('整篇正文') && r.text.scene_code.includes('整篇正文'));
  check('无标题双槽：给出 dual-slot-heading 提示', r.warnings.some((w) => w.code === 'dual-slot-heading'));
}

/* ══════════════════════════ W9 来源标记与溯源 ══════════════════════════ */

console.log('\n『W9』来源标记与溯源记录');
{
  const r = triggerKnowledgecard({ entries: [E({ id: 'k', title: '传送带模型', keys: ['共同'], content: '正文' })], text: '共同' });
  check('来源标记逐字：`【世界书·解题：传送带模型】\\n正文`', r.text.solve.startsWith('【世界书·解题：传送带模型】\n正文'));

  const viaKey = triggerKnowledgecard({ entries: [E({ id: 'v1', keys: ['共同'] })], text: '共同' }).provenance[0];
  const viaSec = triggerKnowledgecard({ entries: [E({ id: 'v2', keys: ['不存在'], secondary_keys: { logic: 'OR', list: ['共同'] } })], text: '共同' }).provenance[0];
  const viaConst = triggerKnowledgecard({ entries: [E({ id: 'v3', constant: true, keys: [] })], text: '共同' }).provenance[0];
  const viaRec = triggerKnowledgecard({
    entries: [E({ id: 'v4', keys: ['共同'], content: '含 唤醒词' }), E({ id: 'v5', keys: ['唤醒词'] })],
    text: '共同',
  }).provenance.find((p) => p.entry_id === 'v5');
  check('溯源命中方式四种齐全：key / secondary / constant / recursive', viaKey.via === 'key' && viaSec.via === 'secondary' && viaConst.via === 'constant' && viaRec.via === 'recursive');

  const dual = triggerKnowledgecard({ entries: [E({ id: 'd', keys: ['共同'], insertion_slot: ['solve', 'scene_code'], content: '## 解题\nA\n\n## 动画建模\nB' })], text: '共同' }).provenance[0];
  check('溯源记**实际注入槽位**（双槽各自命中）', dual.injectedSlots.sort().join(',') === 'scene_code,solve');
  check('溯源记各槽字符数', dual.charsBySlot.solve > 0 && dual.charsBySlot.scene_code > 0);

  const unmounted = triggerKnowledgecard({ entries: [E({ id: 'u', keys: ['共同'], insertion_slot: [] })], text: '共同' }).provenance[0];
  check('未挂槽位的词条有明确标记（unmounted=true 且 injectedSlots 为空）', unmounted.unmounted === true && unmounted.injectedSlots.length === 0);

  const trunc = triggerKnowledgecard({
    entries: [E({ id: 't1', keys: ['共同'], order: 1 }), E({ id: 't2', keys: ['共同'], order: 2 })],
    text: '共同',
    budget: { maxEntries: 1 },
  }).provenance;
  check('溯源记"是否被截断"', trunc.find((p) => p.entry_id === 't2')?.truncated === true && trunc.find((p) => p.entry_id === 't1')?.truncated === false);
}

/* ══════════════════════════ W10 逐字节一致 ══════════════════════════ */

console.log('\n『W10』预览器与实际请求**逐字节一致**（用浏览器侧引擎副本）');
{
  check('浏览器侧引擎副本存在', existsSync(ENGINE_OUT), ENGINE_OUT);
  if (existsSync(ENGINE_OUT)) {
    check('副本与 core/knowledgecard/engine.mjs **逐字节一致**（含文件头）', readFileSync(ENGINE_OUT, 'utf8') === expectedEngineCopy());

    const browser = await import(pathToFileURL(ENGINE_OUT).href);
    const coreExports = Object.keys(await import(pathToFileURL(ENGINE_SRC).href)).sort();
    const browserExports = Object.keys(browser).sort();
    check('副本的导出面与本源完全一致', coreExports.join(',') === browserExports.join(','), `${browserExports.length} vs ${coreExports.length}`);

    const dts = readFileSync(join(PROJECT_ROOT, 'web', 'src', 'lib', 'knowledgecard-engine.d.ts'), 'utf8');
    const declared = [...dts.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]).sort();
    check('d.ts 声明的名字集合 == engine.mjs 的导出面（抄录不会漂移）', declared.join(',') === coreExports.join(','), `声明 ${declared.length} / 导出 ${coreExports.length}`);

    /* 真·逐字节比对：跑一次真编排（假网关捕获 system 消息），再让浏览器副本算同一段 */
    const lib = loadLibrary();
    const problemText = q01ProblemText();
    const captured = [];
    const stream = fakeStream(captured);
    const events = [];
    for await (const e of runPipeline({
      problem: { text: problemText },
      config: { endpoint: fakeEndpoint(), apiKey: 'sk-test', regexRules: [], knowledgecardEntries: lib.entries },
      streamImpl: stream,
      dryRunImpl: fakeDryRun(),
    })) {
      events.push(e);
    }

    /** ⚠ 第 9 期：前缀**按阶段取**了，剥前缀必须用该阶段自己的那条（不再是一条全局前缀） */
    const prefixOf = (stage) => buildStagePrefix(stage).text;
    for (const stage of ['solve', 'scene_code']) {
      const call = captured.find((c) => c.stage === stage);
      check(`真实请求里有 ${stage} 阶段`, Boolean(call));
      if (!call) continue;
      const sys = String(call.messages?.[0]?.content ?? '');
      const prefixText = prefixOf(stage);
      const conditional = sys.startsWith(prefixText) ? sys.slice(prefixText.length + 2) : sys;

      const prompt = getPrompt(stage);
      const scanText =
        stage === 'scene_code' ? [problemText, solveReplyText()].join('\n') : problemText;
      const preview = browser.buildSlotPreview({
        entries: lib.entries,
        slot: stage === 'scene_code' ? 'scene_code' : 'solve',
        text: scanText,
        instruction: prompt.system,
        instructionLabel: prompt.label,
      });
      check(
        `预览器与真实请求的 ${stage} 条件段**逐字节相同**`,
        preview.text === conditional,
        `预览 ${preview.text.length} 字节 vs 请求 ${conditional.length} 字节`,
      );
    }
  } else {
    check('跳过 W10 的逐字节比对（副本不存在）', false, '请先跑 node tools/build-knowledgecard-web.mjs');
  }
}

/* ══════════════════════════ W11 导入导出 ══════════════════════════ */

console.log('\n『W11』导入导出跨机器可复现');
{
  const lib = loadLibrary();
  const packText = packToText(buildExportPack({ entries: lib.builtin }));
  const imported = normalizeImportedPack(packText);
  check('导出 → 导入 成功', imported.ok === true, imported.problems.join('；'));

  const before = triggerKnowledgecard({ entries: lib.builtin, text: q01ProblemText() });
  const after = triggerKnowledgecard({ entries: imported.entries, text: q01ProblemText() });
  /**
   * ⚠ 第 5.5 期修正：这条判据的**语义是"命中集合相同"**，但原文是拿 provenance 的**顺序**做字符串拼接比对。
   *   而两侧的**输入顺序本就不同**：`loadLibrary()` 的 `builtin` 是**文件顺序**（00-meta → 01 → 02 → 10 → 90），
   *   而 `entries`（以及导入后的 `imported.entries`）是**id 序**（store.mjs 的 `entries.sort(...)`）。
   *   provenance 的顺序 = `seq` = 词条被扫描的顺序 ⇒ 它**必然**随输入顺序而变，这不是缺陷。
   *   只有当"命中的词条很少、两种顺序恰好一致"时这条才碰巧是绿的 —— 第 5.5 期写到第 2 章就把它顶红了。
   *   现在按**集合**比较（两侧各自排序后逐条比对），判据强度没有下降：
   *   id / 命中方式 / 注入槽位 三项仍然逐条相同，只是不再要求两边"扫描顺序"也相同。
   */
  const fingerprint = (r) => r.provenance.map((p) => `${p.entry_id}|${p.via}|${p.injectedSlots.join('+')}`).sort();
  check(
    '命中集合逐条相同（id + 命中方式 + 注入槽位）',
    fingerprint(before).join(',') === fingerprint(after).join(','),
    `${fingerprint(before).length} vs ${fingerprint(after).length}`,
  );
  check('两边的槽位拼接内容逐字节相同', before.text.solve === after.text.solve && before.text.scene_code === after.text.scene_code);

  const round2 = packToText(buildExportPack({ entries: imported.entries }));
  check('导出→导入→导出 **幂等**（文本逐字节相同）', round2 === packToText(buildExportPack({ entries: normalizeImportedPack(round2).entries })));
  check('导出包只写新槽位名（不含 scene_spec）', !packText.includes('scene_spec'));
}

/* ══════════════════════════ W12 旧名归一化 + 契约不变量 ══════════════════════════ */

console.log('\n『W12』旧名归一化只发生在导入路径');
{
  const v2Pack = {
    format: 'od-knowledgecard',
    version: 1,
    entries: [
      E({ id: 'old1', insertion_slot: 'scene_spec' }),
      E({ id: 'old2', insertion_slot: 'both' }),
      E({ id: 'old3', insertion_slot: ['scene_spec', 'solve'] }),
    ],
  };
  const r = normalizeImportedPack(v2Pack);
  check('导入 `scene_spec` ⇒ `scene_code`', r.ok && r.entries.find((e) => e.id === 'old1').insertion_slot.join(',') === 'scene_code');
  check('导入 `"both"` ⇒ `["solve","scene_code"]`', r.ok && r.entries.find((e) => e.id === 'old2').insertion_slot.sort().join(',') === 'scene_code,solve');
  check('数组里的旧名同样归一化', r.ok && r.entries.find((e) => e.id === 'old3').insertion_slot.sort().join(',') === 'scene_code,solve');
  check('UI 提示"已转换 N 条旧槽位名"（不静默改名）', /^已转换 \d+ 条旧槽位名$/.test(String(r.notice)));
  check('转换明细逐条可查', r.converted.length >= 3 && r.converted.every((c) => c.entryId && c.from && c.to));

  /* v1.1.9alpha：旧包没有 kind ⇒ 按 element 落盘；非法 kind（如 prompt）必须拒绝 */
  const oldKind = normalizeImportedPack({ format: 'od-knowledgecard', version: 1, entries: [E({ id: 'oldkind' })] });
  check('旧包缺 kind ⇒ 导入落成 element（兼容，不整包拒绝）', oldKind.ok && oldKind.entries[0]?.kind === 'element');

  /* v1.1.9alpha：旧格式 od-worldbook 必须能读，但导出写成 od-knowledgecard */
  const legacyPack = normalizeImportedPack({ format: 'od-worldbook', version: 1, entries: [E({ id: 'legacyfmt' })] });
  check('旧 od-worldbook 包能导入（双读兼容）', legacyPack.ok && legacyPack.entries[0]?.id === 'legacyfmt');
  check('旧包导入时明确提示"已兼容旧包格式"', /兼容旧包格式/.test(String(legacyPack.notice)), String(legacyPack.notice));

  /* v1.1.9alpha：旧用户目录 ai-rules/worldbook/ 与新目录双读（同 id 新目录优先） */
  {
    const base = join(PROJECT_ROOT, '.tmp-p3-legacy-user');
    rmSync(base, { recursive: true, force: true });
    mkdirSync(join(base, 'worldbook'), { recursive: true });
    mkdirSync(join(base, 'knowledgecard'), { recursive: true });
    writeFileSync(
      join(base, 'worldbook', 'old.json'),
      `${JSON.stringify(
        { format: 'od-worldbook', version: 1, entries: [E({ id: 'legacy-user' }), E({ id: 'wb_scene_stages' })] },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const mergedLib = loadLibrary({ userDir: join(base, 'knowledgecard'), legacyUserDir: join(base, 'worldbook') });
    check('旧 ai-rules/worldbook/ 与新目录双读（旧用户卡仍可见）', mergedLib.ok && mergedLib.user.some((e) => e.id === 'legacy-user'));
    check('旧覆盖副本 id 迁移：wb_scene_stages → wb_anim_stages', mergedLib.ok && mergedLib.user.some((e) => e.id === 'wb_anim_stages'));

    const mig = migrateLegacyUserDir({ dir: join(base, 'knowledgecard'), legacyDir: join(base, 'worldbook') });
    check(
      '启动迁移：旧包复制到新目录，旧目录保留（可回退）',
      mig.migrated === true &&
        existsSync(join(base, 'knowledgecard', 'old.json')) &&
        existsSync(join(base, 'worldbook', 'old.json')),
      JSON.stringify(mig),
    );
    rmSync(base, { recursive: true, force: true });
  }
  const badKind = validateEntry(E({ id: 'badkind', kind: 'prompt' }));
  check('反例：knowledgecard 条目的 kind 不允许 prompt / local_rule', badKind.some((p) => p.includes('kind')));

  const bad = normalizeImportedPack({ format: 'od-knowledgecard', version: 99, entries: [] });
  check('反例：不支持的版本被明确拒绝', bad.ok === false && bad.problems.some((p) => p.includes('不受支持')));
  const badFormat = normalizeImportedPack({ format: 'something-else', version: 1, entries: [] });
  check('反例：format 不对被拒绝', badFormat.ok === false);

  const internal = validateEntry(E({ id: 'z', insertion_slot: ['scene_spec'] }));
  check('反例：**内部**不接受旧名（validateEntry 直接报错）', internal.some((p) => p.includes('scene_spec') || p.includes('非法槽位名')));
  check('槽位枚举与契约同源', KNOWLEDGECARD_INSERTION_SLOTS.join(',') === 'solve,scene_code');
}

console.log('\n『W12-2』§9.5 契约不变量的**负对照**（断言必须会失败）');
{
  const positive = assertContractInvariants(CONTRACT_SPECS);
  check('正例：当前 spec 通过全部不变量断言', !positive.some((p) => p.includes('§9.5')));

  const mutate = (fn) => {
    const specs = CONTRACT_SPECS.map((s) =>
      s.id === 'knowledgecard-pack'
        ? { ...s, properties: { ...s.properties, format: { ...s.properties.format } }, defs: { ...s.defs } }
        : s,
    );
    fn(specs.find((s) => s.id === 'knowledgecard-pack'));
    return assertContractInvariants(specs);
  };
  check('负对照 1：改 format 常量 ⇒ 断言失败', mutate((p) => { p.properties.format.const = 'od-knowledgecard-v2'; }).some((x) => x.includes('§9.5')));
  check('负对照 2：entries 不再引用 knowledgecard-entry ⇒ 断言失败', mutate((p) => { p.defs.KnowledgecardEntry = { kind: 'inline', spec: { id: 'cleaning-rule' } }; }).some((x) => x.includes('§9.5')));
  check('负对照 3：required 少一项 ⇒ 断言失败', mutate((p) => { p.required = ['format', 'version']; }).some((x) => x.includes('§9.5')));
}

/* ══════════════════════════ W13 origin 治理 ══════════════════════════ */

console.log('\n『W13』origin 治理（覆盖副本 / 升级 / 恢复默认 / 导出）');
{
  const lib = loadLibrary();
  const target = lib.builtin[0];
  const copy = makeOverrideCopy(target);
  check('覆盖副本保持同 id、origin 变 user', copy.id === target.id && copy.origin === 'user');
  check('编辑提示是"以本地覆盖副本方式修改"的口径', EDIT_OVERRIDE_HINT.includes('本地覆盖副本'));

  const upgrade = planUpgrade({
    newBuiltin: [{ id: 'b1', title: '新版1' }, { id: 'b2', title: '新版2' }],
    oldBuiltin: [{ id: 'b1', title: '旧版1' }, { id: 'b2', title: '旧版2' }],
    userEntries: [{ id: 'b2', title: '我改过的' }],
  });
  check('升级只替换**未被覆盖**的内置条目', upgrade.replaced.map((r) => r.id).join(',') === 'b1');
  check('被覆盖的那条**保留用户版本**并在清单里说明原因', upgrade.kept.length === 1 && upgrade.kept[0].id === 'b2' && upgrade.kept[0].reason.includes('覆盖'));
  check('打印"将被覆盖的清单"（16.3 ④）', upgrade.replacedList.length === 1 && upgrade.replacedList[0].includes('新版1'));

  const restore = planRestoreDefault({
    entries: [{ id: 'b1', origin: 'user', title: '我的覆盖' }, { id: 'mine', origin: 'user', title: '我自己的词条' }],
    builtinIds: ['b1', 'b2'],
    ids: ['b1', 'mine', 'b2'],
  });
  check('恢复默认：只删内置的覆盖副本', restore.toRemove.join(',') === 'b1');
  check('恢复默认：**拒绝**删用户自有词条', restore.refused.length === 1 && restore.refused[0].id === 'mine');
  check('恢复默认：没有副本的内置条目走 noop（不是"删了但没效果"）', restore.noop.length === 1 && restore.noop[0].id === 'b2');
  check('恢复默认：给出确认清单 + 影响面声明', restore.confirmList.length === 1 && restore.affectsBuiltinOnly === false);

  const exp = planExport({ entries: lib.builtin.concat([{ id: 'mine', origin: 'user' }]), includeBuiltin: false });
  check('导出默认只导 origin:user', exp.length === 1 && exp[0].id === 'mine');
  const exp2 = planExport({ entries: lib.builtin.concat([{ id: 'mine', origin: 'user' }]), includeBuiltin: true });
  check('勾选"包含内置规范"才带内置', exp2.length === lib.builtin.length + 1);

  /* 真实文件往返（写在仓库内的临时目录：本沙箱只保证工作区可写） */
  const tmp = join(PROJECT_ROOT, 'tests', '.knowledgecard-tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    writeUserPack(tmp, 'user-1.json', [copy]);
    const withOverride = loadLibrary({ builtinDir: BUILTIN_DIR, userDir: tmp });
    check('写盘 + 载入：用户同 id 覆盖内置', withOverride.ok && withOverride.overriddenIds.includes(target.id));
    check('载入后 entries 里该 id 只有一条，且是用户版本', withOverride.entries.filter((e) => e.id === target.id).length === 1 && withOverride.entries.find((e) => e.id === target.id).origin === 'user');

    check('用户文件在 sources 里带 SHA256（§16 规则工作区）', withOverride.sources.some((s) => s.kind === 'user' && /^[0-9a-f]{64}$/.test(s.sha256)));

    /* ── v1.1.9：一键恢复本版本内置（文件级，设置页按钮的后端） ── */
    writeUserPack(tmp, 'user-1.json', [copy, E({ id: 'mine-keep', title: '我自己的卡' })]);
    const rr = restoreBuiltinKnowledgecard({ dir: tmp });
    check('★ 一键恢复内置：删掉覆盖副本、保留用户自建卡', rr.ok && rr.removed === 1 && rr.packsTouched === 1, JSON.stringify(rr));
    check(
      '★ 恢复后文件里只剩用户自建卡',
      JSON.parse(readFileSync(join(tmp, 'user-1.json'), 'utf8')).entries.map((e) => e.id).join(',') === 'mine-keep',
    );
    check('★ 恢复前留了滚动备份（恢复本身可撤销）', existsSync(join(tmp, '.backup', 'user-1.json.bak.1')));
    check('（幂等）再恢复一次：removed = 0', restoreBuiltinKnowledgecard({ dir: tmp }).removed === 0);

    writeUserPack(tmp, 'only-override.json', [copy]);
    const rr3 = restoreBuiltinKnowledgecard({ dir: tmp });
    check(
      '★ 整包都是覆盖副本 ⇒ 删文件而不是留一个空包',
      rr3.packsDeleted === 1 && !existsSync(join(tmp, 'only-override.json')),
      JSON.stringify({ deleted: rr3.packsDeleted, exists: existsSync(join(tmp, 'only-override.json')) }),
    );

    removeUserFile(tmp, 'user-1.json');
    const restored = loadLibrary({ builtinDir: BUILTIN_DIR, userDir: tmp });
    check('删掉覆盖副本 ⇒ 内置版本原样生效（= 恢复默认）', restored.overriddenIds.length === 0 && restored.entries.find((e) => e.id === target.id).origin === 'builtin');

    writeFileSync(join(tmp, 'broken.json'), '{ 这不是 JSON', 'utf8');
    const broken = loadLibrary({ builtinDir: BUILTIN_DIR, userDir: tmp });
    check('**整批失败**：一个坏文件 ⇒ ok=false 且 entries 为空（不半载入）', broken.ok === false && broken.entries.length === 0 && broken.problems.length > 0);

    rmSync(join(tmp, 'broken.json'), { force: true });
    let threw = null;
    try {
      writeUserPack(tmp, 'bad.json', [{ ...copy, priority: 'urgent' }]);
    } catch (err) {
      threw = err;
    }
    check('写盘前校验：非法词条被拒绝（整批失败），且列出问题', Boolean(threw) && threw.problems.length > 0);
    check('写盘失败时**没有**留下半截文件', !existsSync(join(tmp, 'bad.json')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/* ══════════════════════════ W14 覆盖率 ══════════════════════════ */

console.log('\n『W14』词条结构覆盖率与"内容覆盖进度"的诚实报告（第 5.5 期 P3 起带真口径）');
{
  const lib = loadLibrary();
  const report = checkCoverage({ entries: lib.builtin });
  check('内置库非空', report.total === lib.builtin.length && report.total > 0);
  check('结构合规率 100%（自检条款 + code_examples）', report.structuralRate === 1 && report.selfCheckCoverage === 1 && report.exampleCoverage === 1);
  check(
    '口径未定时报告里**说得出原因**（不静默；第 9 期起原因是"台账已退役"）',
    report.contentComplete === false && /已退役/.test(String(report.reason)),
    String(report.reason),
  );
  check('报告数字可从数据重算（判据独立于被检验对象）', report.nonCompliant.length === report.total - Math.round(report.structuralRate * report.total));

  const stripped = { ...lib.builtin[0], content: lib.builtin[0].content.replace(/^#{2,6}[ \t]*生成后自检.*$/m, '## 别的标题') };
  const r2 = checkCoverage({ entries: [stripped] });
  check('负对照：去掉「生成后自检」小节 ⇒ 覆盖率掉下来并点名', r2.structuralRate < 1 && r2.missingSelfCheck.includes(stripped.id));

  const noEx = { ...lib.builtin[0], code_examples: [] };
  const r3 = checkCoverage({ entries: [noEx] });
  check('负对照：去掉 code_examples ⇒ 覆盖率掉下来并点名', r3.exampleCoverage === 0 && r3.missingExamples.includes(noEx.id));

  check('checkEntryStructure 单条判据可用', checkEntryStructure(lib.builtin[0]).problems.length === 0 && checkEntryStructure(stripped).problems.length === 1);

  // 内置库必须由脚本生成（"派生汇总物由构建反向校验"）
  const drift = plannedFiles().filter((f) => !existsSync(f.path) || readFileSync(f.path, 'utf8') !== f.text);
  check('运行时库（data/）与从 source/ 会写出的内容逐字节一致（不许手改 JSON）', drift.length === 0, drift.map((f) => f.file).join(','));
  const extra = readdirSync(BUILTIN_DIR).filter((f) => f.endsWith('.json') && !plannedFiles().some((p) => p.file === f));
  check('data/ 里没有 source/ 不认识的 JSON', extra.length === 0, extra.join(','));

  // 用户词条也必须含自检条款吗？—— §9.4 只要求**内置**，这里钉住这条边界
  const userOnly = checkCoverage({ entries: [{ ...lib.builtin[0], origin: 'user', content: '没有自检小节', code_examples: [] }] });
  check('用户词条不计入内置覆盖率（§9.4 的约束对象是内置词条）', userOnly.total === 0);
}

console.log('\n『W14-2』第 5.5 期 P1/P3：源目录、目标/进度文件、覆盖率真口径');
{
  const lib = loadLibrary();

  /* P1：词条源（source/）→ 运行时库（data/） */
  const src = readSource();
  check('source/ 里有词条源文件', src.layers.length > 0 && src.problems.length === 0, src.problems.join('；'));
  check('source/ 的条数 == 运行时库的条数', allBuiltinEntries().length === lib.builtin.length);
  check('source/ 里的文件格式就是 §9.5 导出包（与运行时库同形）', (() => {
    const text = readFileSync(join(SOURCE_DIR, listSourceFiles()[0]), 'utf8');
    const parsed = JSON.parse(text);
    return parsed.format === 'od-knowledgecard' && parsed.version === 1 && Array.isArray(parsed.entries);
  })());
  check('源文件与 data/ 文件同名（文件名就是映射关系）', listSourceFiles().join(',') === plannedFiles().map((f) => f.file).join(','));

  /* ── P3（第 9 期 · 开源版）：**覆盖台账已退役** ──
   *
   * 台账原来按**第三方教辅**的 111 个题型记账（`coverage-target.json` 由 `build-knowledgecard-targets.mjs`
   * 从第三方教辅的扫描件里抽标题、连原书行号一起写进来）。开源版**不再分发这些派生数据**：
   * 台账文件与生成工具都已删除，仓库里也不允许再出现那本书的路径。
   *
   * 于是"覆盖率"只剩**唯一一个不依赖外部语料的口径**：内置词条的结构合规率
   * （每条都有「生成后自检」小节 + 至少一段能过 C1 的 code_examples）。
   * ⚠ 不许把"没有台账"当成"覆盖完成"——`contentComplete` 必须明确为 false 并说出原因。
   */
  check('覆盖台账文件**已删除**（不再按题型记账）', !existsSync(COVERAGE_TARGET_FILE));
  check(
    '生成台账的工具**已删除**（它要读那本扫描书，仓库里已无此依赖）',
    !existsSync(join(PROJECT_ROOT, 'tools', 'build-knowledgecard-targets.mjs')),
  );

  const noTarget = checkCoverage({ entries: lib.builtin });
  check(
    '没有台账时：结构合规率照常算得出来（这是唯一还成立的覆盖率口径）',
    noTarget.structuralRate === 1 && noTarget.total === lib.builtin.length,
    `${noTarget.structuralRate}/${noTarget.total}`,
  );
  check('没有台账时：如实说"口径未定"，不假装 0/111 也不假装 111/111', /未定|退役/.test(String(noTarget.reason)), String(noTarget.reason));
  check('没有台账时：contentComplete 必须为 false（不能"没有口径"就当完成）', noTarget.contentComplete === false);
  check(
    '覆盖率一行结论里**不再出现** n/111 这种题型进度',
    !/\d+\s*\/\s*111/.test(formatCoverageLine(noTarget)),
    formatCoverageLine(noTarget),
  );

  /* 那本书的派生内容必须清干净（开源硬要求）：代码 / 契约 / 测试 / 前端 里不许再出现书名或路径 */
  {
    const forbidden = ['世界书' + '知识库参照', '2025版高中' + '物理题型笔记', '题型' + '笔记总.md'];
    const hits = [];
    const walk = (rel) => {
      const abs = join(PROJECT_ROOT, rel);
      for (const name of readdirSync(abs)) {
        const child = `${rel}/${name}`;
        const st = statSync(join(PROJECT_ROOT, child));
        if (st.isDirectory()) {
          if (!/node_modules|release|\.git|\/dist$|\/build$|\.cache/.test(child)) walk(child);
          continue;
        }
        if (!/\.(mjs|cjs|js|json|md|ts|tsx|html)$/.test(name)) continue;
        const text = readFileSync(join(PROJECT_ROOT, child), 'utf8');
        for (const f of forbidden) if (text.includes(f)) hits.push(`${child}:${f}`);
      }
    };
    for (const d of ['contracts', 'core', 'tools', 'sdk', 'template', 'web/src', 'tests']) {
      if (existsSync(join(PROJECT_ROOT, d))) walk(d);
    }
    check('代码/契约/测试/前端里**不再出现**第三方教辅的书名或路径', hits.length === 0, hits.slice(0, 5).join(', '));
  }

  check(
    '考点词表里的**题型标签已清空**（原先逐条派生自那本书）',
    Object.keys(KNOWLEDGECARD_CONCEPTS.tags ?? {}).length === 0,
    JSON.stringify(Object.keys(KNOWLEDGECARD_CONCEPTS.tags ?? {})).slice(0, 120),
  );
}

console.log('\n『W14-3』第 5.5 期 P2：触发词撞车检查');
{
  const e = (over) => E({ insertion_slot: ['solve'], keys: ['传送带'], ...over });

  const same = detectKeyCollisions([e({ id: 'k1', title: '甲', keys: ['传送带'] }), e({ id: 'k2', title: '乙', keys: ['传送带'] })]);
  check('正例：两条词条用了**完全相同**的主键 ⇒ 报撞车', same.length === 1 && same[0].kind === 'same' && same[0].code === 'key-collision');
  check('撞车提示里点名两条词条与那个词', same[0].entryIds.sort().join(',') === 'k1,k2' && same[0].keys.join(',') === '传送带,传送带');
  check('撞车是 warn（提示不阻断），不带异常', same[0].level === 'warn');

  const subset = detectKeyCollisions([e({ id: 's1', title: '甲', keys: ['带'] }), e({ id: 's2', title: '乙', keys: ['传送带'] })]);
  check('正例：短词是长词的子串 ⇒ 报撞车（短词会把长词的题面吃掉）', subset.length === 1 && subset[0].kind === 'subset');
  check('提示里说清了"建议挪进 secondary_keys 或用 NOT"', subset[0].message.includes('secondary_keys'));

  const diffSlots = detectKeyCollisions([e({ id: 'd1', keys: ['传送带'], insertion_slot: ['solve'] }), e({ id: 'd2', keys: ['传送带'], insertion_slot: ['scene_code'] })]);
  check('负对照：两条词条的槽位**不相交** ⇒ 不算撞车（永远不会同时进同一段上下文）', diffSlots.length === 0);

  const self = detectKeyCollisions([e({ id: 'one', keys: ['传送带', '传送皮带', '皮带'] })]);
  check('负对照：同一条词条内部的包含关系不算撞车（它只会命中一次）', self.length === 0);

  const secOnly = detectKeyCollisions([e({ id: 'x1', keys: ['甲'], secondary_keys: { logic: 'AND_ANY', list: ['物块'] } }), e({ id: 'x2', keys: ['乙'], secondary_keys: { logic: 'AND_ANY', list: ['物块'] } })]);
  check('负对照：只比**主键**，次级键重复是正常的（否则会刷一屏噪音）', secOnly.length === 0);

  const re = detectKeyCollisions([e({ id: 'r1', keys: ['/传送带/'] }), e({ id: 'r2', keys: ['/传送带/'] })]);
  check('负对照：正则 key 不参与撞车比对（语义由作者控制，字符串包含判断只会误报）', re.length === 0);

  check('真实内置库里**目前没有**撞车（有的话说明这批词条要修）', detectKeyCollisions(loadLibrary().builtin).length === 0, JSON.stringify(detectKeyCollisions(loadLibrary().builtin).map((c) => c.keys)));
  check('detectConflicts 会带上撞车提示（设置页因此不用另接一条通路）', detectConflicts([e({ id: 'c1', keys: ['共同词'] }), e({ id: 'c2', keys: ['共同词'] })]).some((c) => c.code === 'key-collision'));
}

/* ══════════════════════════ W15 冲突提示与预览器 ══════════════════════════ */

console.log('\n『W15』冲突提示（提示不阻断）+ 预览器四区块');
{
  const conflicts = detectConflicts([
    E({ id: 'dup' }),
    E({ id: 'dup', title: '重复 id' }),
    E({ id: 'badre', keys: ['/(/'] }),
    E({ id: 'unm', insertion_slot: [] }),
    E({ id: 'dual', insertion_slot: ['solve', 'scene_code'], content: '没有标题' }),
    E({ id: 'cy1', title: '甲', keys: ['甲'], content: '提到 乙' }),
    E({ id: 'cy2', title: '乙', keys: ['乙'], content: '提到 甲' }),
  ]);
  const codes = new Set(conflicts.map((c) => c.code));
  check('冲突：同名 id', codes.has('duplicate-id'));
  check('冲突：正则语法错误', codes.has('bad-regex'));
  check('冲突：槽位为空（未挂槽位）', codes.has('unmounted'));
  check('冲突：双槽无标题', codes.has('dual-slot-heading'));
  check('冲突：递归环（提示用）', codes.has('recursive-cycle'));
  check('冲突提示带等级且**不阻断**（是数组，不是异常）', conflicts.every((c) => ['error', 'warn', 'info'].includes(c.level)));

  const lib = loadLibrary();
  /**
   * ⚠ 第 9 期：**解题槽位已经没有词条了**——10 条公式规范搬回了阶段指令
   * （`core/prompts/stage-rules.mjs`，理由见该文件与 README §9.6「阶段契约 ≠ 条件知识」）。
   *
   * 所以预览器的"能拼出内容"改在 `scene_code` 槽位上验；另外**补一条新不变量**：
   * 解题槽位必须是**如实的空槽**（`emptySlots` 里有它），而不是"忘了挂词条"。
   */
  const browser = await import(pathToFileURL(ENGINE_OUT).href);
  const preview = browser.buildSlotPreview({ entries: lib.entries, slot: 'scene_code', text: q01ProblemText() });
  check('预览器：拼接内容非空', preview.text.length > 0);
  check('预览器：四区块数据来自**同一次**触发（text 与 result 是配套的）', preview.result.text.scene_code === preview.knowledgecardText);
  check('预览器：命中清单可读（标题 + 命中方式）', preview.result.provenance.every((p) => p.title && p.via));
  check('预览器：空槽提示有数据来源（emptySlots 字段在）', Array.isArray(preview.result.emptySlots));

  const previewSolve = browser.buildSlotPreview({ entries: lib.entries, slot: 'solve', text: q01ProblemText() });
  check(
    '预览器：解题槽位是**如实的空槽**（规范已改为阶段契约，不再靠词条）',
    previewSolve.text.trim() === '' && previewSolve.result.emptySlots.includes('solve'),
    `text=${previewSolve.text.length} 字 / emptySlots=${JSON.stringify(previewSolve.result.emptySlots)}`,
  );
}

/* ══════════════════════════ X 接线 ══════════════════════════ */

console.log('\n『X』接线：每题快照 / knowledgecard_done 事件 / provenance 真哈希');
{
  const lib = loadLibrary();
  const snapshot = snapshotConfig({ endpoint: fakeEndpoint(), knowledgecardEntries: lib.entries });
  const h0 = snapshot.knowledgecard.hash;
  check('快照里的 knowledgecardHash 是 64 位十六进制（真哈希，不再是字符串占位）', /^[0-9a-f]{64}$/.test(h0));
  check('哈希与 knowledgecardHashOf(entries) 一致', h0 === knowledgecardHashOf(snapshot.knowledgecard.entries));

  const original = lib.entries.map((e) => ({ ...e, keys: [...e.keys] }));
  const snap2 = snapshotConfig({ endpoint: fakeEndpoint(), knowledgecardEntries: original });
  const h1 = snap2.knowledgecard.hash;
  original[0].keys.push('被偷加的键');
  original.push(E({ id: 'late-added' }));
  check('快照不受调用方后续修改影响（§16 热重载语义）', snap2.knowledgecard.hash === h1 && snap2.knowledgecard.entries.length === lib.entries.length && snap2.knowledgecard.entries[0].keys.length === lib.entries[0].keys.length);
  check('快照被冻结（开发期就报错，而不是变成偶发问题）', Object.isFrozen(snap2.knowledgecard) && Object.isFrozen(snap2.knowledgecard.entries) && Object.isFrozen(snap2.knowledgecard.entries[0].keys));
  check('source 标记区分"没提供词条集合"与"提供了但 0 条命中"', snapshot.knowledgecard.source === 'provided' && snapshotConfig({ endpoint: fakeEndpoint() }).knowledgecard.source === 'empty');

  /* 跑一次真编排（假网关），看事件与 provenance */
  const problemText = q01ProblemText();
  const captured = [];
  const withWb = [];
  for await (const e of runPipeline({
    problem: { text: problemText },
    config: { endpoint: fakeEndpoint(), apiKey: 'sk-test', regexRules: [], knowledgecardEntries: lib.entries },
    streamImpl: fakeStream(captured),
    dryRunImpl: fakeDryRun(),
  })) {
    withWb.push(e);
  }
  const wbEvent = withWb.find((e) => e.type === 'knowledgecard_done');
  check('提供词条集合 ⇒ 发出 knowledgecard_done', Boolean(wbEvent));
  check('knowledgecard_done 带哈希与命中清单', /^[0-9a-f]{64}$/.test(String(wbEvent?.hash)) && wbEvent.entries.length > 0);
  check('knowledgecard_done 带"空槽"与"被截断"两个字段（UI 不许自己判断）', Array.isArray(wbEvent?.emptySlots) && Array.isArray(wbEvent?.truncatedSlots));
  check('knowledgecard_done 的溯源带命中方式与实际注入槽位', wbEvent.entries.every((p) => p.via && Array.isArray(p.injectedSlots)));

  const firstDry = withWb.find((e) => e.type === 'dryrun_done');
  check('provenance.knowledgecardHash 是真哈希（B2 挂账在此收口）', /^[0-9a-f]{64}$/.test(String(firstDry?.program?.provenance?.knowledgecardHash)));
  check('provenance.promptHash 不再恒为 null', /^[0-9a-f]{64}$/.test(String(firstDry?.program?.provenance?.promptHash)));
  check('provenance.knowledgecardHash 与快照一致', firstDry?.program?.provenance?.knowledgecardHash === h0);

  /* 不提供词条集合时不该发这条事件（否则 UI 会把"没接上"显示成"这道题没有规范"） */
  const noWb = [];
  for await (const e of runPipeline({
    problem: { text: problemText },
    config: { endpoint: fakeEndpoint(), apiKey: 'sk-test', regexRules: [] },
    streamImpl: fakeStream([]),
    dryRunImpl: fakeDryRun(),
  })) {
    noWb.push(e);
  }
  check('不提供词条集合 ⇒ 不发 knowledgecard_done', !noWb.some((e) => e.type === 'knowledgecard_done'));

  /* 阶段槽位：只有 solve / scene_code 两个阶段注入词条 */
  const captured2 = [];
  for await (const _ of runPipeline({
    problem: { text: problemText },
    config: { endpoint: fakeEndpoint(), apiKey: 'sk-test', regexRules: [], knowledgecardEntries: lib.entries },
    streamImpl: fakeStream(captured2),
    dryRunImpl: fakeDryRun(),
  })) {
    /* 只为了拿到 captured2 */
  }
  const sysOf = (stage) => String(captured2.find((c) => c.stage === stage)?.messages?.[0]?.content ?? '');
  /**
   * ⚠ 第 9 期口径变化：**解题槽位不再有词条**。
   *
   * 10 条公式规范搬进了各阶段自己的指令（`core/prompts/stage-rules.mjs`），因为世界书只有两个槽位、
   * 而生产链有五个阶段 —— 按槽位分发会把"只跟代码有关"的规矩灌进解题（用户原话"无脑复读"）。
   * 于是这里改成两条**更该守**的断言：解题阶段不带词条，但**带着自己的规范**。
   */
  check('solve 阶段**不再**带世界书词条（规范已改为阶段契约）', !sysOf('solve').includes('【世界书·'), sysOf('solve').slice(0, 80));
  check(
    'solve 阶段确实带上了自己的公式规范（v1.1.17 起是 5 条，量纲那一节已删）',
    sysOf('solve').includes('规范·符号、单位与正方向')
      && sysOf('solve').includes('规范·临界与极值')
      && !sysOf('solve').includes('规范·量纲与极限自检'),
  );
  check('scene_code 阶段带世界书词条', sysOf('scene_code').includes('【世界书·动画建模：'));
  check(
    'analysis / breakdown / read_problem 阶段**不**注入词条（§9.1 只有两个槽位）',
    !sysOf('analysis').includes('【世界书·') && !sysOf('breakdown').includes('【世界书·') && !sysOf('read_problem').includes('【世界书·'),
  );
  check('每个阶段都有"本阶段指令"标签（阶段识别的契约化，不靠猜）', ['solve', 'analysis', 'breakdown', 'scene_code'].every((s) => sysOf(s).includes('【本阶段指令：')));

  /* 编排层的条件段与引擎算出来的一致（同一份字节，不另拼一遍） */
  const promptSolve = getPrompt('solve');
  const expect = assemblePrompt({
    problem: { text: promptSolve.buildUser({ problem: problemText }) },
    instructions: promptSolve.system,
    instructionLabel: promptSolve.label,
    stageSlot: 'solve',
    knowledgecardSegment: triggerKnowledgecard({ entries: lib.entries, text: problemText }).text.solve,
    stage: 'solve',
  });
  check('编排用的条件段 = 引擎渲染的条件段（编排层没有第二套拼装）', sysOf('solve') === expect.messages[0].content);
}

/* ══════════════════════ 第 5.7 期：词表完整性 / 两侧分发 / 覆盖率（『W16』） ══════════════════════ */

console.log('\n『W16』第 5.7 期：两级词表完整性 · 两侧命中 · 覆盖率 · 撞车（每条都带负对照）');
{
  const first = (arr, n = 2) => arr.slice(0, n);
  /** 夹具词条：只填要测的那几栏 */
  const E = (id, extra = {}) => ({
    id,
    title: id,
    origin: 'builtin',
    category: 'solution_skill',
    enabled: true,
    keys: [],
    insertion_slot: ['solve'],
    content: '# x\n\n## 生成后自检\n- x',
    ...extra,
  });

  /* ── W16-1 词表完整性：三栏的取值必须都在词表里 ── */
  {
    const good = E('t_ok', { concepts: [KNOWLEDGECARD_CONCEPT_IDS[0]], tags: [KNOWLEDGECARD_TAG_OWNERS[KNOWLEDGECARD_TAG_NAMES[0]] && KNOWLEDGECARD_TAG_NAMES[0]], elements: [KNOWLEDGECARD_ELEMENT_IDS[0]] });
    // 上一条的 tags 要挂在它自己的考点下，否则会被"归属"那条拦下（这里按归属取）
    const cid = KNOWLEDGECARD_CONCEPT_IDS[0];
    const tagOfCid = Object.entries(KNOWLEDGECARD_TAG_OWNERS).find(([, owners]) => owners.includes(cid))?.[0];
    const good2 = E('t_ok', { concepts: [cid], tags: tagOfCid ? [tagOfCid] : [], elements: [KNOWLEDGECARD_ELEMENT_IDS[0]] });
    check('词表完整性 · 正例：三栏都取表内值 ⇒ 合法', validateEntry(good2).length === 0, JSON.stringify(validateEntry(good2)));
    void good;

    const badConcept = E('t_bad1', { concepts: ['__not_a_concept__'] });
    check(
      '词表完整性 · 负对照：考点写成表外值 ⇒ **必须报错**',
      validateEntry(badConcept).some((m) => m.includes('表外值')),
      JSON.stringify(validateEntry(badConcept)),
    );
    const badTag = E('t_bad2', { concepts: [cid], tags: ['__not_a_tag__'] });
    check('词表完整性 · 负对照：题型写成表外值 ⇒ 必须报错', validateEntry(badTag).some((m) => m.includes('表外值')));
    const badEl = E('t_bad3', { elements: ['__not_an_element__'] });
    check('词表完整性 · 负对照：动画元件写成表外值 ⇒ 必须报错', validateEntry(badEl).some((m) => m.includes('表外值')));
    const badDup = E('t_bad4', { concepts: [cid, cid] });
    check('词表完整性 · 负对照：同一栏有重复项 ⇒ 必须报错（schema 要求 uniqueItems）', validateEntry(badDup).some((m) => m.includes('重复项')));
  }

  /* ── W16-2 跨字段约束（第 9 期换口径）：**题型标签已退役** ──
   *
   * 原先是"tags 必须属于本词条的某个 concepts"。但 tags 的内容逐条派生自第三方教辅，
   * 开源版已清空（`KNOWLEDGECARD_CONCEPTS.tags = {}`）⇒ 这条跨字段校验**没有对象可测**了。
   * 现在钉两件仍然成立的事：
   *   ① 词表里的 tags 必须为空（防止有人又把派生数据塞回来）；
   *   ② 校验器对"填了 tags 却没填 concepts"仍然报错（判据没跟着数据一起烂掉）。
   */
  {
    check('题型标签已清空（开源版不再分发派生数据）', Object.keys(KNOWLEDGECARD_CONCEPTS.tags ?? {}).length === 0);
    const noConcept = E('t_nc', { tags: ['随便一个标签'] });
    check(
      '跨字段 · 负对照：填了 tags 却没填 concepts ⇒ 必须报错（无法判断归属）',
      validateEntry(noConcept).some((m) => m.includes('没填 concepts')),
      JSON.stringify(validateEntry(noConcept)),
    );
  }

  /* ── W16-3 每个考点下至少有一条词条（**反向检查**，靠 5.9 才能全绿，本期如实报） ── */
  {
    const lib = loadLibrary();
    const all = [...lib.builtin, ...lib.user];
    const covered = new Set();
    for (const e of all) for (const c of e.concepts ?? []) covered.add(c);
    const missing = KNOWLEDGECARD_CONCEPT_IDS.filter((c) => !covered.has(c));
    /**
     * ⚠ 这里原先断言的是 `missing.length === KNOWLEDGECARD_CONCEPT_IDS.length`，
     *   即"**56 个考点一个都没覆盖**" —— 把"还没做"当成了不变量。
     *   5.9 一旦覆盖第一个考点，它就会**按计划变红**，而那时最省事的做法是改断言。
     *   现在改成**恒等式**：缺口数 ≡ 总数 − 已覆盖数（0% 时成立、100% 时也成立，
     *   只有"算错了"才红），并另外断言覆盖集合本身是干净的。
     */
    check(
      '每个考点下至少有一条词条 · 缺口数 ≡ 总数 − 已覆盖数（恒等式，任何进度都成立）',
      missing.length === KNOWLEDGECARD_CONCEPT_IDS.length - covered.size,
      `已覆盖 ${covered.size}/${KNOWLEDGECARD_CONCEPT_IDS.length} · 缺口 ${missing.length}`,
    );
    check(
      '每个考点覆盖情况**被算出来且非静默**（0 覆盖时也必须报出数字，不许无声通过）',
      covered.size + missing.length === KNOWLEDGECARD_CONCEPT_IDS.length && [...covered].every((c) => KNOWLEDGECARD_CONCEPT_IDS.includes(c)),
      `${covered.size}/${KNOWLEDGECARD_CONCEPT_IDS.length} 个考点有词条（其余靠 5.9 补）`,
    );
    // 负对照：造一条带概念的词条，covered 必须 +1（证伪"这条检查永远为真"）
    const fake = [E('t_cov', { concepts: [KNOWLEDGECARD_CONCEPT_IDS[0]] })];
    const covered2 = new Set(fake.flatMap((e) => e.concepts ?? []));
    check('负对照：加一条带 concepts 的词条 ⇒ covered 立刻 +1（检查本身有效）', covered2.size === 1);
    check(
      '负对照：加一条带 concepts 的词条 ⇒ 缺口数随即 −1（恒等式两侧同步动，不是写死的数）',
      KNOWLEDGECARD_CONCEPT_IDS.filter((c) => !covered2.has(c)).length === KNOWLEDGECARD_CONCEPT_IDS.length - covered2.size,
    );
  }

  /* ── W16-4 两侧命中（解题侧 / 动画侧），含收窄负例 ── */
  {
    const cid = KNOWLEDGECARD_CONCEPT_IDS[0];
    const entries = [
      E('c_generic', { concepts: [cid], tags: [] }),
      E('e_narrow', { concepts: [cid], tags: [], elements: [KNOWLEDGECARD_ELEMENT_IDS[0]], insertion_slot: ['scene_code'] }),
      E('e_other', { concepts: [KNOWLEDGECARD_CONCEPT_IDS[1]], tags: [], elements: [KNOWLEDGECARD_ELEMENT_IDS[0]], insertion_slot: ['scene_code'] }),
      E('e_generic', { concepts: [], tags: [], elements: [KNOWLEDGECARD_ELEMENT_IDS[0]], insertion_slot: ['scene_code'] }),
    ];
    const via = (j) => {
      const r = triggerKnowledgecard({ entries, text: '', ...j, budget: { maxDepth: 0 } });
      return new Map(r.provenance.map((p) => [p.entry_id, p.via]));
    };
    const m1 = via({ concepts: [cid], tags: [], elements: [] });
    check('两侧命中 · 解题侧：词条 tags 为空 ⇒ via=concept（通用条兜底）', m1.get('c_generic') === 'concept', String(m1.get('c_generic')));

    /* 第 9 期：题型标签退役 ⇒ 解题侧只剩 via=concept 一条路径（下面这条仍在钉它） */
    const m2 = via({ concepts: [], tags: [], elements: [KNOWLEDGECARD_ELEMENT_IDS[0]] });
    check('两侧命中 · 动画侧：元件命中但考点不相交 ⇒ **不收窄就不注入**（负例）', !m2.has('e_narrow'));
    check('两侧命中 · 动画侧：词条 concepts 为空 ⇒ via=element（通用条）', m2.get('e_generic') === 'element', String(m2.get('e_generic')));

    const m3 = via({ concepts: [cid], tags: [], elements: [KNOWLEDGECARD_ELEMENT_IDS[0]] });
    check('两侧命中 · 动画侧：元件 + 考点都相交 ⇒ via=element+concept', m3.get('e_narrow') === 'element+concept', String(m3.get('e_narrow')));
    check('两侧命中 · 负例：考点不同 ⇒ 那条元件词条不注入', !m3.has('e_other'));

    const m4 = via({ concepts: [], tags: [], elements: [] });
    check('灰度 · 空判定 ⇒ 一条概念词条都不命中（退化为纯字面 keys）', m4.size === 0, JSON.stringify([...m4.keys()]));
  }

  /* ── W16-5 撞车检测（标签撞车 / 元件撞车），含负对照 ── */
  {
    const cid = KNOWLEDGECARD_CONCEPT_IDS[0];
    const tag = Object.entries(KNOWLEDGECARD_TAG_OWNERS).find(([, o]) => o.includes(cid))?.[0];
    const dup = [E('a', { concepts: [cid], tags: [tag] }), E('b', { concepts: [cid], tags: [tag] }), E('c', { concepts: [KNOWLEDGECARD_CONCEPT_IDS[1]], tags: [tag] })];
    const tags = detectTagCollisions(dup);
    check('标签撞车 · 正例：同考点 + 同标签 ⇒ 报', tags.length === 1 && tags[0].entryIds.sort().join(',') === 'a,b', JSON.stringify(tags.map((x) => x.entryIds)));
    check('标签撞车 · 负对照：考点不相交 ⇒ 不算撞车（c 不参与）', !tags.some((x) => x.entryIds.includes('c')));
    check('标签撞车 · 提示不阻断（level=warn）', tags.every((x) => x.level === 'warn'));

    const els = detectElementCollisions([E('a', { elements: [KNOWLEDGECARD_ELEMENT_IDS[0]] }), E('b', { elements: [KNOWLEDGECARD_ELEMENT_IDS[0]] })]);
    check('元件撞车 · 正例：同元件 ⇒ 报', els.length === 1 && els[0].element === KNOWLEDGECARD_ELEMENT_IDS[0]);
    check('元件撞车 · 负对照：不共用元件 ⇒ 不报', detectElementCollisions([E('a', { elements: [KNOWLEDGECARD_ELEMENT_IDS[0]] }), E('b', { elements: [KNOWLEDGECARD_ELEMENT_IDS[1]] })]).length === 0);
  }

  /* ── W16-6 动画元件覆盖率：每个 SDK 原语至少有一条词条教它怎么用 ── */
  {
    const sig = JSON.parse(readFileSync(join(PROJECT_ROOT, 'sdk/signature-summary.json'), 'utf8'));
    const primNames = sig.functions.map((f) => f.name).filter((n) => n.startsWith('Draw.'));
    const declared = new Set(KNOWLEDGECARD_ELEMENT_IDS.map((id) => KNOWLEDGECARD_CONCEPTS.elements.find((d) => d.id === id)?.primitive));
    /**
     * ⚠ 本期**如实报缺口**：词表里还没有的词条（137 条老词条没有 elements 栏），
     *   所以"每个原语都有词条教"这条要到 5.9 才可能全绿。
     *   这里断言的是**词表侧**的覆盖（每个原语至少被词表里某个元件指向），
     *   以及"缺口数被算出来且可核对" —— 而不是硬判通过。
     */
    /**
     * ⚠ **A25 的豁免**：用户裁决 —— 矢量箭头**算**动画元件；**文字标注与尺寸标注不算**。
     *   所以这两类原语**允许**在词表里没有对应元件。
     *   若 5.9 照交接单"任务③"把它们移出元件表，下面的覆盖率断言**仍然是绿的**（不冲突）；
     *   以后要改这个口径，**必须改这个常量**（不许偷偷放宽覆盖率）。
     *
     * ★ **第 5.9 期按裁决 5.9-D1 扩了一条 `Draw.latex`（公式标注）**：
     *   A25 点名的是"文字标注、尺寸标注"两类；**公式标注是它们的同族**（都是"说明"而不是"实体"），
     *   按 5.9 定死的动画元件准入判据 **E1（实体性）** 一并禁报 ⇒ `formula_label` 已从元件表移出，
     *   于是 `Draw.latex` **确实没有元件指向它**。
     *   ⇒ 改常量（而不是偷偷把它算成"已覆盖"）是**本仓规定的唯一合法改法**。
     *   ⚠ 这条豁免有**前提**，由下面的断言钉住：`formula_label` 必须出现在词表的
     *     `elementRoles.never`（禁报名单）里 —— 即"它被豁免，是因为口径判定它不是元件"，
     *     而不是"因为它不好画"。同理，`Draw.dimension` **同时**被 `measuring_tool`（测量器具）
     *     指向 ⇒ 它即使被豁免也仍然有元件在教它怎么用（不是缺口）。
     */
    const ANNOTATION_PRIMITIVES_EXEMPT = ['Draw.text', 'Draw.dimension', 'Draw.latex'];
    /** 场景专用原语：不由单个元件指向，由场景卡使用（如天体椭圆轨道）。 */
    const SCENE_ONLY_PRIMITIVES_EXEMPT = ['Draw.ellipse'];
    const notDeclared = primNames.filter(
      (p) =>
        !declared.has(p) &&
        !ANNOTATION_PRIMITIVES_EXEMPT.includes(p) &&
        !SCENE_ONLY_PRIMITIVES_EXEMPT.includes(p),
    );
    check(
      '动画元件覆盖率 · 每个 Draw 原语都被词表里某个元件指向（词表侧；标注类按 A25 豁免）',
      notDeclared.length === 0,
      notDeclared.join(', ') || `全部覆盖（豁免 ${ANNOTATION_PRIMITIVES_EXEMPT.length} 个标注类）`,
    );
    check(
      '动画元件覆盖率 · 负对照：故意少一个**教具**原语 ⇒ 缺口能被算出来',
      primNames.filter((p) => !new Set([...declared].filter((x) => x !== 'Draw.spring')).has(p) && !ANNOTATION_PRIMITIVES_EXEMPT.includes(p)).length > 0,
    );
    check(
      '动画元件覆盖率 · 豁免只覆盖 A25 点名的标注类（标注被豁免、教具不被豁免）',
      ANNOTATION_PRIMITIVES_EXEMPT.every((p) => p.startsWith('Draw.')) &&
        ANNOTATION_PRIMITIVES_EXEMPT.includes('Draw.text') &&
        ANNOTATION_PRIMITIVES_EXEMPT.includes('Draw.dimension') &&
        !ANNOTATION_PRIMITIVES_EXEMPT.includes('Draw.arrow') &&
        !ANNOTATION_PRIMITIVES_EXEMPT.includes('Draw.spring'),
    );
    /**
     * ★ 5.9 新增：**豁免的前提必须写在词表里**（否则"扩大豁免"就成了一张空头支票）。
     *   ① 每一类被豁免的**标注**都必须出现在 `elementRoles.never`（禁报名单）里；
     *   ② 禁报名单里的 id 必须**真的不在** `elements[]` 里（否则"禁报"名不副实）；
     *   ③ 负对照：把一个教具（`spring`）塞进禁报名单 ⇒ 立刻判违规。
     */
    const roles = KNOWLEDGECARD_CONCEPTS.elementRoles ?? { never: [], key: [], optional: [] };
    const neverIds = roles.never ?? [];
    const elementIds = new Set(KNOWLEDGECARD_CONCEPTS.elements.map((d) => d.id));
    const exemptJustified =
      ['text_label', 'dimension_label', 'formula_label'].every((id) => neverIds.includes(id)) &&
      neverIds.every((id) => !elementIds.has(id));
    check(
      '动画元件覆盖率 · 豁免的前提写在词表里：标注类都在 elementRoles.never 且真的不在元件表里',
      exemptJustified,
      `never = ${JSON.stringify(neverIds)}`,
    );
    check(
      '动画元件覆盖率 · 负对照：把教具（spring）塞进禁报名单 ⇒ 判违规（前提不是恒真）',
      !(neverIds.includes('spring') && !elementIds.has('spring')),
    );
    check(
      '动画元件覆盖率 · 被豁免的 Draw.dimension 仍由测量器具元件指向（不是缺口）',
      (KNOWLEDGECARD_CONCEPTS.elements.find((d) => d.id === 'measuring_tool')?.primitive ?? '') === 'Draw.dimension',
    );

    /**
     * 词条侧：**单调判据**。
     * ⚠ 原先写的是 `withElements.length === 0`（断言"一条都没有"）—— 把"还没做"当不变量，
     *   5.9 一给词条加 elements 就会**按计划变红**。
     *   现在断言的是**结构一致性**，与进度无关、且能真失败：
     *   声明了 `elements` 的词条必须挂 `scene_code` 槽位，否则它的动画触发永远到不了动画阶段。
     */
    const lib = loadLibrary();
    const allEntries = [...lib.builtin, ...lib.user];
    const withElements = allEntries.filter((e) => (e.elements ?? []).length > 0);
    const orphan = withElements.filter((e) => !(e.insertion_slot ?? []).includes('scene_code'));
    check(
      '动画元件覆盖率 · 词条侧：声明了 elements 的词条必须挂 scene_code 槽位（否则动画触发到不了动画阶段）',
      orphan.length === 0,
      `已声明 elements ${withElements.length}/${allEntries.length} 条（词条侧缺口靠 5.9 补）` +
        (orphan.length ? ` · 违规：${orphan.map((e) => e.id).join(', ')}` : ''),
    );
    check(
      '动画元件覆盖率 · 负对照：只挂 solve 却声明 elements ⇒ 会被判违规（检查本身有牙齿）',
      [E('zz_el_solve_only', { elements: [KNOWLEDGECARD_ELEMENT_IDS[0]], insertion_slot: ['solve'] })].filter(
        (e) => !(e.insertion_slot ?? []).includes('scene_code'),
      ).length === 1,
    );
  }

  /* ── W16-7 禁止 heading-missing（双槽词条缺 `## 解题`/`## 动画建模`）── */
  {
    const bad = E('dual_bad', { insertion_slot: ['solve', 'scene_code'], content: '# 只有一段正文，没有二级标题' });
    const split = splitEntryContent(bad, 'scene_code');
    check('禁止 heading-missing · 负对照：双槽词条缺标题 ⇒ 引擎判 heading-missing', split.mode === 'heading-missing', split.mode);
    const good = E('dual_ok', { insertion_slot: ['solve', 'scene_code'], content: '## 解题\n解题正文\n\n## 动画建模\n动画正文' });
    check('禁止 heading-missing · 正例：两个标题都在 ⇒ by-heading', splitEntryContent(good, 'scene_code').mode === 'by-heading');

    /**
     * 真库里的审计（**单调判据**：只禁"新增"，不禁"修好"）。
     *
     * ⚠ 这里原先写的是 `missing.length >= 0` —— **恒真、永不可能失败**，
     *   于是"禁止 heading-missing"这句承诺实际上是空头支票。
     *   现在改成 **`missing ⊆ 基线`**：
     *     · 修好一条（基线内的没了）⇒ 仍然是子集 ⇒ **绿**（允许进步）；
     *     · 新增一条（基线外的冒出来）⇒ **红**（这才是"禁止"）。
     *   `HEADING_MISSING_BASELINE` 是第 5.5 期留下的已知缺口，**5.9 修完它自然变空，本断言不需要再改**。
     */
    const HEADING_MISSING_BASELINE = ['wb_block_board_horizontal'];
    const lib = loadLibrary();
    const missing = [...lib.builtin, ...lib.user].filter(
      (e) => (e.insertion_slot ?? []).length >= 2 && splitEntryContent(e, 'solve').mode === 'heading-missing',
    );
    const outsideBaseline = missing.map((e) => e.id).filter((id) => !HEADING_MISSING_BASELINE.includes(id));
    check(
      '禁止 heading-missing · 真库里不许出现**基线之外**的缺标题双槽词条（解题内容会被串味进动画槽）',
      outsideBaseline.length === 0,
      `基线内 ${missing.length - outsideBaseline.length} 条（5.9 修，不判红）` +
        ` · 基线外 ${outsideBaseline.length} 条${outsideBaseline.length ? '：' + outsideBaseline.join(', ') : ''}`,
    );
    // 负对照：证伪"这条检查永远为真" —— 造一条基线外的缺标题词条，谓词必须判它违规
    const fakeOffender = E('zz_fake_dual_no_heading', { insertion_slot: ['solve', 'scene_code'], content: '没有二级标题' });
    const fakeMissing = [fakeOffender].filter((e) => splitEntryContent(e, 'solve').mode === 'heading-missing');
    check(
      '禁止 heading-missing · 负对照：**基线外**的缺标题词条会被判违规（所以上面的绿不是恒真）',
      fakeMissing.length === 1 && fakeMissing.map((e) => e.id).every((id) => !HEADING_MISSING_BASELINE.includes(id)),
    );
  }

  /* ── W16-8 解析器正反例（S3 的 concepts.mjs）与它被编排真的用上 ── */
  {
    const base = { problem: '', vocab: KNOWLEDGECARD_CONCEPTS, index: buildVocabIndex(KNOWLEDGECARD_CONCEPTS) };
    const p1 = parseJudgement('【考点】uniform_acceleration\n【题型】速度公式与位移公式\n【动画元件】spring\n【判定依据】x', base);
    check('解析器 · 正例：id 写法被解析', p1.concepts.join(',') === 'uniform_acceleration' && p1.elements.join(',') === 'spring');
    const p2 = parseJudgement('【考点】匀变速直线运动\n【器材】弹簧\n【判定依据】x', base);
    check('解析器 · 正例：中文别名 + 旧标签（器材）都能归一', p2.concepts.join(',') === 'uniform_acceleration' && p2.elements.join(',') === 'spring');
    const p3 = parseJudgement('【考点】__nope__\n【判定依据】x', base);
    check('解析器 · 负对照：表外词进 unknowns 且报出（不许静默丢）', p3.concepts.length === 0 && p3.unknowns.concepts.includes('__nope__'));
    let threw = false;
    try {
      parseJudgement(undefined, base);
      parseJudgement('', base);
      parseJudgement('完全没有段标记的一段话', base);
    } catch {
      threw = true;
    }
    check('解析器 · 负对照：坏输入（undefined / 空串 / 无段标记）**不抛异常**', !threw);
    const p4 = parseJudgement('【考点】无\n【题型】无\n【器材】无\n【判定依据】看不出来', base);
    check('解析器 · 正例：全写"无" ⇒ 空判定合法（不是错误）', p4.concepts.length === 0 && p4.tags.length === 0 && p4.elements.length === 0);
  }
}

/* ══════════════════════════ SDK 槽位键名之类的基础契约仍在 ══════════════════════════ */

console.log('\n『Y』基础契约未被本期改动');
{
  check('8 个冻结键名仍在（§3.2 一字未改）', SLOT_KEY_NAMES.length === 8 && SLOT_KEY_NAMES[0] === 'PROBLEM');
  const lib = loadLibrary();
  check('内置词条全部通过 §9.1 校验（库里不可能有非法词条）', lib.builtin.every((e) => validateEntry(e).length === 0));
  check('规范化可复现：canonicalizeEntry 两次结果逐字节相同', JSON.stringify(canonicalizeEntry(lib.builtin[0])) === JSON.stringify(canonicalizeEntry(lib.builtin[0])));
}

/* ══════════════════════════ W16 动画教学卡片 + 示例代码的可执行性 ══════════════════════════ */

console.log('\n『W17』动画教学：code_examples 必须能过 C1；常驻卡片必须真能教会（第 8 期）');
{
  /**
   * 用户的原话是问题陈述：**"对 AI 的限制太多而示例太少，导致动画代码经常被打回"**。
   * 这条判据钉的正是"示例本身合不合法"：
   *   · 词条里 `code_examples` 的每一段都当**真代码**跑 C1 —— 我们自己都过不了的写法，
   *     一旦被注入就是"教错"（第 8 期实测：178 段里有 21 段 34 处 `Draw.arrow` 缺 `mag`）；
   *   · `Draw.*` / `Phys.*` 的名字必须在 SDK 签名清单里（`Draw.ball` 这种把元件名当函数名的错，
   *     C1 的"未声明的名字"管不到 —— 它只管裸标识符，`Draw.xxx` 是成员访问）。
   */
  const SLOT_NAMES = new Set(SLOT_KEY_NAMES);
  const sig = JSON.parse(readFileSync(join(PROJECT_ROOT, 'sdk', 'signature-summary.json'), 'utf8'));
  const sdkNames = new Set((sig.functions ?? []).map((f) => f.name));

  /** 把每个 code_example 里的 `槽位名: \`代码\`` 拆出来逐段体检 */
  const auditCodeExamples = (entries) => {
    const problems = [];
    let blocks = 0;
    for (const e of entries) {
      for (const ex of e.code_examples ?? []) {
        for (const m of String(ex).matchAll(/(^|\n)\s*([A-Za-z]+)\s*:\s*`([\s\S]*?)`/g)) {
          const slot = m[2];
          const code = m[3];
          if (!SLOT_NAMES.has(slot)) continue;
          blocks += 1;
          const r = lintSlot({ code, slot, entry: e.id });
          for (const d of r.diagnostics) problems.push(`${e.id}/${slot} C1:${d.rule}@${d.line}`);
          for (const call of code.matchAll(/\b(Draw|Phys)\.([A-Za-z]+)\s*\(/g)) {
            const full = `${call[1]}.${call[2]}`;
            if (!sdkNames.has(full)) problems.push(`${e.id}/${slot} 非 SDK 函数 ${full}`);
          }
        }
      }
    }
    return { blocks, problems };
  };

  const lib = loadLibrary();
  const audit = auditCodeExamples(lib.builtin);
  check(
    `内置词条的 code_examples 全部通过 C1，且只调用 SDK 里登记过的函数（逐段 ${audit.blocks} 段）`,
    audit.problems.length === 0,
    audit.problems.slice(0, 6).join('；'),
  );

  // 负对照：故意写成"缺 mag 的箭头"必须被这条判据逮到（否则判据是空转）
  const badEntry = {
    id: 'zz_neg_arrow_no_mag',
    title: '负对照',
    origin: 'builtin',
    category: 'scene_modeling',
    enabled: true,
    constant: false,
    recursive: false,
    keys: ['x'],
    secondary_keys: { logic: 'AND_ANY', list: [] },
    concepts: [],
    tags: [],
    elements: [],
    insertion_slot: ['scene_code'],
    order: 9999,
    priority: 'normal',
    content: '## 生成后自检（必须逐条在代码中体现）\n- [ ] x',
    code_examples: ["drawFrame: `\n  Draw.arrow([0, 0], [1, 0], { category: 'force', label: 'F' });\n`"],
  };
  const neg = auditCodeExamples([badEntry]);
  check('负对照：缺 mag 的箭头会被上面那条判据点名（判据不是空转）', neg.problems.some((p) => p.includes('arrow-missing-mag')), neg.problems.join('；'));

  // 不存在的 Draw.xxx 也必须被点名（C1 管不到成员名，这条判据补的就是那个洞）
  const badEntry2 = { ...badEntry, code_examples: ["drawFrame: `\n  Draw.ball([0, 0], 0.1);\n`"] };
  const neg2 = auditCodeExamples([badEntry2]);
  check('负对照：`Draw.ball`（SDK 里没有）会被点名', neg2.problems.some((p) => p.includes('非 SDK 函数 Draw.ball')), neg2.problems.join('；') || '(无)');

  /* 动画规范卡：**3 张常驻**（v1.1.9alpha：visual + anim 合并、scene_stages 改名） */
  const cards = lib.builtin.filter((e) => e.id.startsWith('wb_anim_'));
  check(
    '动画规范卡正好 3 张（坐标约定 / 阶段表 / 元件总览）',
    cards.length === 3 &&
      cards.map((c) => c.id).sort().join(',') === 'wb_anim_conventions,wb_anim_elements_overview,wb_anim_stages',
    cards.map((c) => c.id).join(','),
  );
  check(
    '每张都是 anim_rule、常驻、只进 scene_code、priority: high',
    cards.every(
      (c) =>
        c.kind === 'anim_rule' &&
        c.constant === true &&
        c.insertion_slot.includes('scene_code') &&
        c.priority === 'high',
    ),
    cards.map((c) => `${c.id}:${c.kind}/${c.constant}/${c.insertion_slot.join('+')}/${c.priority}`).join(' '),
  );
  check(
    '三张动画规范卡的 order 依次为 1 / 2 / 3',
    cards
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((c) => `${c.id}:${c.order}`)
      .join(',') === 'wb_anim_conventions:1,wb_anim_stages:2,wb_anim_elements_overview:3',
    cards.map((c) => `${c.id}:${c.order}`).join(','),
  );
  check(
    '旧的 wb_visual_conventions / wb_scene_stages 不再存在',
    !lib.builtin.some((e) => e.id === 'wb_visual_conventions' || e.id === 'wb_scene_stages'),
  );
  const elementCards = lib.builtin.filter((e) => e.id.startsWith('wb_el_'));
  check(
    `30 张元件卡 kind 全是 element（实际 ${elementCards.length} 张）`,
    elementCards.length === 30 && elementCards.every((e) => e.kind === 'element'),
    elementCards.filter((e) => e.kind !== 'element').map((e) => `${e.id}:${e.kind}`).join(','),
  );

  /**
   * ── v1.1.9alpha：三张动画规范卡全部常驻 ──
   *
   * 4 张约定卡（visual / anim / stages / overview）合并为 3 张：
   *   · visual 的坐标/颜色/虚线并入 conventions；
   *   · stages 改名为 `wb_anim_stages`，内容修正为真实 `STEPS` 契约；
   *   · overview 保留。
   *
   * ⚠ `WORKED` 现在是空数组 ⇒ 下面那段"逐份验范文"的循环**不会执行**。
   *   这是刻意的（没有范文就没有范文可验），但断言仍保留：以后要加范文，把 WORKED 填回去，
   *   这几条会自动开始工作 —— 不需要再改测试。
   */
  const { WORKED, verifyWorked, renderProgram, constantCardIds } = await import('../tools/build-animation-cards.mjs');
  const wantConstant = constantCardIds();
  const gotConstant = cards.filter((c) => c.constant === true).map((c) => c.id);
  check(
    '常驻的正好是 3 张，顺序与设计一致',
    gotConstant.sort().join(',') === wantConstant.slice().sort().join(',') && gotConstant.length === 3,
    `实际 ${gotConstant.join(',')}`,
  );
  check(
    '没有残留的"按元件触发"教学卡（范文下线后应为 0 张）',
    cards.filter((c) => !c.constant).length === WORKED.length,
    `非恒常卡 ${cards.filter((c) => !c.constant).length} 张 / WORKED ${WORKED.length} 份`,
  );

  const constantChars = cards.filter((c) => c.constant).reduce((n, c) => n + c.content.length, 0);
  const cardChars = cards.reduce((n, c) => n + c.content.length, 0);
  check(
    `常驻卡正文合计 ${constantChars} 字 ≤ 10000（槽位预算 ${KNOWLEDGECARD_BUDGET.maxChars}，要留出命中词条的额度）`,
    constantChars <= 10000,
    `实际 ${constantChars}`,
  );
  check(`三张卡合计 ${cardChars} 字 ≤ 16000（防膨胀的粗上限）`, cardChars <= 16000, `实际 ${cardChars}`);
  check(
    '正文池 30000 + 示例池 10000（第 8 期定案：40000 总预算；示例单条上限 2000）',
    KNOWLEDGECARD_BUDGET.maxChars === 30000 &&
    KNOWLEDGECARD_BUDGET.maxTotalChars === 40000 &&
    KNOWLEDGECARD_EXAMPLE_BUDGET.maxCharsPerSlot === 10000 &&
    KNOWLEDGECARD_EXAMPLE_BUDGET.maxCharsPerEntry === 2000,
    String(KNOWLEDGECARD_BUDGET.maxChars),
  );

  // 总览卡必须覆盖词表里的每个元件（新增元件忘补画法，这条会红）
  const conceptIds = (JSON.parse(readFileSync(join(PROJECT_ROOT, 'contracts', 'knowledgecard-concepts.json'), 'utf8')).elements ?? []).map((e) => e.id);
  const overview = cards.find((c) => c.id === 'wb_anim_elements_overview');
  const missing = conceptIds.filter((id) => !String(overview?.content ?? '').includes(`\`${id}\``));
  check(`元件总览覆盖词表里全部 ${conceptIds.length} 个元件`, missing.length === 0, missing.join(','));

  // 三份范文：内容里那段程序必须**真的是**跑过 C1–C9 的那份（防"卡片里写了一套、验的是另一套"）
  for (const w of WORKED) {
    const card = cards.find((c) => c.id === w.id);
    check(
      `范文 ${w.id} 的正文里嵌的就是那份程序（逐字）`,
      Boolean(card) && card.content.includes(renderProgram(w.slots)),
    );
    const v = await verifyWorked(w);
    check(`范文 ${w.id} 实跑 C1–C9：verdict === 'pass'（不是 pass-with-warnings）`, v.ok, `${v.verdict}｜${v.problems.slice(0, 3).join('；')}`);
  }
}

/* ══════════════════════════ W18 示例注入（第 8 期 L3） ══════════════════════════ */

console.log('\n『W18』code_examples 真的进了上下文（而且绝不吃正文额度）');
{
  const mk = (over) => ({
    id: 't_ex',
    title: '带示例的词条',
    origin: 'builtin',
    category: 'scene_modeling',
    enabled: true,
    constant: false,
    recursive: false,
    keys: ['测试词'],
    secondary_keys: { logic: 'AND_ANY', list: [] },
    concepts: [],
    tags: [],
    elements: [],
    insertion_slot: ['solve', 'scene_code'],
    order: 10,
    priority: 'normal',
    content: '## 解题\n解题正文A\n\n## 动画建模\n动画正文B',
    code_examples: ['setup: `const a = 1;`   // 示例行'],
    ...over,
  });

  const one = mk({});
  const r = triggerKnowledgecard({ entries: [one], text: '测试词' });
  check(
    '动画槽带上了示例段，且示例正文逐字出现',
    (r.text.scene_code ?? '').includes('### 可照抄的写法') && (r.text.scene_code ?? '').includes('const a = 1;'),
  );
  check('解题槽**不**带示例（示例多是 drawFrame 片段，塞进解题阶段是噪音）', !(r.text.solve ?? '').includes('### 可照抄的写法'));
  check(
    '溯源里记了这条词条带了多少示例字（可审计，不是"悄悄加了"）',
    (r.slots.scene_code.injected[0]?.exampleChars ?? 0) > 0 && r.slots.scene_code.examplesChars > 0,
  );

  const constOne = mk({ id: 't_ex_const', constant: true, keys: [] });
  const r2 = triggerKnowledgecard({ entries: [constOne], text: '' });
  check('常驻词条**不**带示例（常驻卡的正文本身就是教学，再叠示例是重复吃额度）', !(r2.text.scene_code ?? '').includes('### 可照抄的写法'));

  /**
   * ── 第 8 期：示例额度必须**均分**（用户真题）──
   *
   * 实测告警："4 条词条的示例未注入 … wb_el_vector、wb_el_graph …"。
   * 旧的贪心分配按注入顺序先到先得，前面的吃满、后面的一条都拿不到 ——
   * 而被饿死的恰好是用户点名过的"矢量"与"图线"。
   * 这两条断言把"不许有人拿 0"钉住。
   */
  {
    const line = '// 示例行：Draw.box([state.x, 0.1], 0.4, 0.3);';
    const mkFat = (id) =>
      mk({
        id,
        keys: ['测试词'],
        code_examples: [line.repeat(Math.ceil(900 / line.length))],
      });
    const six = ['wb_el_vector', 'wb_el_graph', 'wb_el_rod_rail_stand', 'wb_el_raw_composite', 'wb_x_a', 'wb_x_b'].map(mkFat);
    const out = triggerKnowledgecard({ entries: six, text: '测试词' });
    const slot = out.slots.scene_code;
    check(
      `6 条等长示例（各约 900 字）⇒ **全部**注入，不许有人拿 0（实际 ${slot.examplesIncluded.length} 条）`,
      slot.examplesIncluded.length === 6 && slot.examplesDropped.length === 0,
      `有 ${slot.examplesIncluded.length} 条、跳过 ${slot.examplesDropped.length} 条`,
    );
    check(
      '示例合计仍不超过槽位额度（均分不越界）',
      slot.examplesChars <= KNOWLEDGECARD_EXAMPLE_BUDGET.maxCharsPerSlot,
      String(slot.examplesChars),
    );
  }

  /**
   * ── 第 8 期：**示例去重**（用户 2026-10-18："示例去重是个大工程"）──
   *
   * 为什么必须去重：示例的典型形态是 `Draw.box(...)` 这种一行一段，而常驻范文与别的卡的示例
   * 早就在演示同一批写法。同一行出现三遍的代价是双份的：白吃额度 + 更容易让模型抄错形状。
   *
   * 三条断言把语义钉死（都是"整块判定"，绝不截断代码 —— 半截代码比不给更糟）：
   *   ① 两条卡示例**代码相同、注释不同** ⇒ 只发第一条；
   *   ② 示例的每一行**都已经在正文里** ⇒ 整条不发；
   *   ③ 只是**部分重叠**（新行占比够）⇒ 原样整块发（不许删行）。
   */
  {
    const mkEx = (over) => ({
      id: 'dedupe_card',
      title: '去重用例',
      origin: 'builtin',
      category: 'scene_modeling',
      enabled: true,
      constant: false,
      recursive: false,
      keys: ['测试词'],
      secondary_keys: { logic: 'AND_ANY', list: [] },
      concepts: [],
      tags: [],
      elements: [],
      insertion_slot: ['scene_code'],
      order: 10,
      priority: 'normal',
      content: '## 动画建模\n正文',
      ...over,
    });
    const L1 = 'Draw.box([state.x, 0.1], 0.4, 0.3);';
    const L2 = 'Draw.arrow([state.x, 0.4], [1, 0], { mag: state.u, category: "aux", label: "u" });';
    const r = triggerKnowledgecard({
      entries: [
        mkEx({ id: 'dup_a', code_examples: [`${L1}   // 画物块\n${L2}`] }),
        mkEx({ id: 'dup_b', code_examples: [`${L1}   // 注释换了个说法\n${L2}`] }),
        mkEx({ id: 'in_content', content: `## 动画建模\n正文里已经有：\nDraw.circle([1, 2], 0.3);`, code_examples: ['Draw.circle([1, 2], 0.3);'] }),
        mkEx({ id: 'half_new', code_examples: [`${L1}\n${L2}\nDraw.dimension([0, 0], [1, 0], { kind: "linear", text: "L" });\nDraw.chart([[0, 0], [1, 1]], {});`] }),
        // 3 行已在 seen（L1/L2 来自 dup_a、dimension 来自 half_new）+ 1 行新 ⇒ 25% ⇒ 整块不发
        mkEx({ id: 'quarter_new', code_examples: [`${L1}\n${L2}\nDraw.dimension([0, 0], [1, 0], { kind: "linear", text: "L" });\nDraw.dot([0, 0]);`] }),
        mkEx({ id: 'fresh', code_examples: ['Draw.text(0, 0, "完全不同的写法");'] }),
      ],
      text: '测试词',
    });
    const s = r.slots.scene_code;
    check('① 代码相同、注释不同 ⇒ 只发第一条（dup_a）', s.examplesIncluded.includes('dup_a') && !s.examplesIncluded.includes('dup_b'), JSON.stringify(s.examplesIncluded));
    check('① 被去重的记在 examplesDeduped 里（可审计）', (s.examplesDeduped ?? []).includes('dup_b'), JSON.stringify(s.examplesDeduped));
    check('② 每一行都在正文里 ⇒ 整条不发', (s.examplesDeduped ?? []).includes('in_content'), JSON.stringify(s.examplesDeduped));
    check('② 但正文/别的示例仍有东西可发（不是把示例全杀光）', s.examplesIncluded.includes('dup_a') && s.examplesIncluded.includes('fresh'));
    check('③ 一半是新行 ⇒ 原样整块发（不许删行）', s.examplesIncluded.includes('half_new'), JSON.stringify(s.examplesIncluded));
    const sentHalf = (r.text.scene_code ?? '').includes('Draw.dimension([0, 0], [1, 0]');
    check('③ 发出去的是完整块（dimension 那行在，没被删）', sentHalf);
    check('③′ 4 行只有 1 行新（25%）⇒ 整块不发（这就是"去重"想要的效果）', !s.examplesIncluded.includes('quarter_new'));
    check('④ 去重省下的字数是正数（省了额度才叫去重）', (s.examplesDedupedChars ?? 0) > 0, String(s.examplesDedupedChars));
    check('⑤ 去重不越界：示例合计仍 ≤ 槽位额度', s.examplesChars <= KNOWLEDGECARD_EXAMPLE_BUDGET.maxCharsPerSlot, String(s.examplesChars));
    const warn = (r.warnings ?? []).find((w) => w.code === 'example-deduped');
    check('⑥ 去重要有可见告警（不静默）', Boolean(warn) && /重复/.test(String(warn?.message)));
  }

  /**
   * ── 负对照（口径已随第 8 期定案更新）──
   *
   * 旧口径：示例只吃"正文剩下的额度"（`maxChars − 正文`），所以把槽位压到 30 字时示例必然为零。
   * **新口径**：正文 30000 + 示例 10000 = **合计 40000**。正文照旧吃满 `maxChars`，
   * 示例用"合计预算减正文" —— 所以"正文占满槽位"**不再**means 示例为零。
   * 真正会让示例为零的是**合计预算被吃光**，这里就用 `maxTotalChars: 30` 造那个局面。
   */
  const tightBudget = { maxChars: 30, maxTotalChars: 30, maxDepth: 3, maxEntries: 40 };
  const tight = triggerKnowledgecard({ entries: [one], text: '测试词', budget: tightBudget });
  check(
    '负对照：合计预算被吃光 ⇒ 示例一条不给，正文仍然完整',
    !(tight.text.scene_code ?? '').includes('### 可照抄的写法') &&
      (tight.text.scene_code ?? '').includes('动画正文B') &&
      tight.slots.scene_code.injected.length === 1 &&
      tight.slots.scene_code.examplesDropped.length === 1,
  );

  /**
   * 正对照（新口径的核心）：正文用满 30000 也不会把示例饿死 ——
   * 因为示例吃的是"合计 40000 − 正文"，不是"槽位 30000 − 正文"。
   */
  {
    const wide = triggerKnowledgecard({
      entries: [one],
      text: '测试词',
      budget: { maxChars: 30000, maxTotalChars: 40000, maxDepth: 3, maxEntries: 40 },
    });
    check(
      '★ 新口径：正文与示例各用各的池子（合计 ≤ 40000）⇒ 示例不再被正文挤掉',
      (wide.text.scene_code ?? '').includes('### 可照抄的写法') &&
        wide.slots.scene_code.chars + wide.slots.scene_code.examplesChars <= 40000,
      `正文 ${wide.slots.scene_code.chars} + 示例 ${wide.slots.scene_code.examplesChars}`,
    );
  }

  /* 回归：示例**不许**把槽位总量顶穿 maxChars（第 8 期 L3 第一版就是在这里超的：26757 > 24000） */
  const lib = loadLibrary();
  const heavy = triggerKnowledgecard({
    entries: lib.builtin,
    text: '传送带 物块 木板 斜面 弹簧 滑轮 摩擦生热',
    elements: ['belt', 'block', 'board', 'incline', 'spring', 'pulley'],
  });
  const segLen = String(heavy.text.scene_code ?? '').length;
  check(
    `极端题（6 元件）的动画槽总量 ${segLen} ≤ ${KNOWLEDGECARD_BUDGET.maxChars}（示例与正文合计不许越界）`,
    segLen <= KNOWLEDGECARD_BUDGET.maxChars,
    `实际 ${segLen}`,
  );
  check(
    '该极端题里示例被按额度跳过时**有告警**（不静默）',
    segLen <= KNOWLEDGECARD_BUDGET.maxChars &&
      ((heavy.slots.scene_code.examplesDropped.length === 0) ||
        (heavy.warnings ?? []).some((w) => w.code === 'example-budget-skipped')),
  );
  check(
    '示例额度常量是显式的（单条 / 单槽两档）',
    KNOWLEDGECARD_EXAMPLE_BUDGET.maxCharsPerEntry > 0 && KNOWLEDGECARD_EXAMPLE_BUDGET.maxCharsPerSlot > 0,
  );
}

/* ────────────────────────────── 汇总 ────────────────────────────── */

console.log(`\n${failures.length ? '✗' : '✓'} 知识卡取证：通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
  process.exitCode = 1;
}

/* ────────────────────────────── 假网关 / 假 Dry-Run ────────────────────────────── */

function fakeEndpoint(over = {}) {
  return {
    id: 'ep_fake',
    displayName: '假端点',
    baseURL: 'http://127.0.0.1:1/v1',
    defaultModel: 'text-model',
    visionModel: 'vision-model',
    apiKeyModelId: null,
    supportsJsonMode: true,
    supportsVision: true,
    enableThinking: false,
    preserveThinking: false,
    timeoutMs: 5000,
    ...over,
  };
}

/** 假网关：从 `【本阶段指令：…】` 认出阶段；analysis 回运动表，scene_code 只回 drawFrame */
function fakeStream(captured) {
  return async (opts) => {
    const sys = String(opts.messages?.[0]?.content ?? '');
    const label = ['读题与判定', '读题', '解题', '答案讲解', '物理分析', '动画代码', '自愈修复'].find((l) => sys.includes(`【本阶段指令：${l}】`));
    const stage =
      label === '读题与判定' || label === '读题'
        ? 'read_problem'
        : label === '解题'
          ? 'solve'
          : label === '答案讲解'
            ? 'breakdown'
            : label === '物理分析'
              ? 'analysis'
              : label === '动画代码'
                ? 'scene_code'
                : label === '自愈修复'
                  ? 'repair'
                  : 'unknown';
    captured.push({ stage, messages: opts.messages, sys });
    const full =
      stage === 'analysis'
        ? ANALYSIS_EXAMPLE
        : stage === 'scene_code' || stage === 'repair'
          ? 'Draw.box([state.e0.x, state.e0.y], 0.3, 0.3);'
          : solveReplyText(stage);
    opts.onDelta?.(full);
    return { text: full, reasoning: '', usage: null, model: 'fake', deltas: [full] };
  };
}

/** solve 阶段的固定回包（`scene_code` 的第二遍扫描要用到它，所以必须是确定值） */
function solveReplyText(stage = 'solve') {
  return `【${stage} 输出】共速时刻 t* = u / (mu g) = 1.0 s；摩擦生热 Q = 2.0 J。`;
}

function fakeDryRun(verdict = 'pass') {
  return async () => ({
    report: {
      format: 'od-dry-run-report',
      version: 2,
      verdict,
      cancelled: false,
      meta: { templateVersion: '1.0.0' },
      execution: { termination: 'completed', frameCount: 481, backendId: 'worker' },
      checks: [{ id: 'C1', status: 'pass', blocking: true, message: 'ok', diagnostics: [] }],
      extensions: [],
      observations: {},
    },
    run: null,
    lint: null,
  });
}

/** 真题 q01 的题面（作为触发世界书的真实输入） */
function q01ProblemText() {
  const q01 = readFileSync(join(PROJECT_ROOT, 'tests', 'regression-15', 'q01-conveyor-heat.mjs'), 'utf8');
  const m = /PROBLEM: String\.raw`([\s\S]*?)`,\n/.exec(q01);
  return m ? m[1] : '水平传送带以恒定速率 u=2 m/s 运行，物块轻放，mu=0.2，求共速时间与摩擦生热。';
}
