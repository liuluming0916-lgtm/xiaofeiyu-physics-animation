#!/usr/bin/env node
/**
 * 知识卡 v2 契约自检（Phase 1）。
 *
 * 只测“词表 + 条目 + 迁移”的纯函数，不接运行时、不改 UI。
 * 运行：node tests\knowledgecard-v2-contract-selftest.mjs
 */

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  VOCAB_FORMAT,
  VOCAB_VERSION,
  buildVocabIndexV2,
  mergeVocab,
  validateVocab,
} from '../core/knowledgecard/v2/vocab.mjs';
import { migrateEntryV1toV2, validateEntryV2 } from '../core/knowledgecard/v2/entry.mjs';
import { saveV2Entry } from '../core/knowledgecard/v2/editor.mjs';
import { loadV2Library } from '../core/knowledgecard/v2/store.mjs';
import { buildJudgementVocabV2, parseJudgementV2 } from '../core/knowledgecard/v2/prompt.mjs';
import { triggerKnowledgecardV2 } from '../core/knowledgecard/v2/runtime.mjs';
import { v2ToV1RuntimeEntry } from '../core/knowledgecard/v2/adapter.mjs';
import { triggerKnowledgecard } from '../core/knowledgecard/engine.mjs';
import { getPrompt } from '../core/prompts/index.mjs';
import { lintSlot } from '../core/lint/contract-lint.mjs';

const ROOT = join(import.meta.dirname, '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const v2 = readJson('contracts/knowledgecard-vocab-v2.json');
const sdk = readJson('sdk/signature-summary.json');
const primitiveNames = sdk.functions.map((f) => f.name);

let bad = 0;
const check = (ok, name, detail = '') => {
  if (ok) console.log(`✓ ${name}`);
  else {
    bad += 1;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const clone = (x) => JSON.parse(JSON.stringify(x));

console.log('『A』词表 v2 自身');
{
  const r = validateVocab(v2, { primitiveNames });
  check(r.ok, '词表通过校验', r.problems.join('；'));
  check(v2.format === VOCAB_FORMAT && v2.version === VOCAB_VERSION, 'format/version 正确', `${v2.format}/${v2.version}`);
  check(v2.elements.length === 11, '元件 11 个（含封存 graph_wave）', String(v2.elements.length));
  check(v2.scenes.length >= 1, '至少 1 个种子场景', String(v2.scenes.length));
  check(
    v2.elements.every((e) => primitiveNames.includes(e.primitive)),
    '每个元件的 primitive 都在 SDK 函数表里',
    v2.elements.filter((e) => !primitiveNames.includes(e.primitive)).map((e) => `${e.id}:${e.primitive}`).join(','),
  );
  const idx = buildVocabIndexV2(v2);
  check(idx.byWord.get('incline')?.id === 'incline', '按 id 能索引到 incline');
  check(idx.byWord.get('斜面')?.id === 'incline', '按中文别名能索引到 incline');
}

console.log('\n『B』内置 + 用户词表合并');
{
  const user = {
    format: VOCAB_FORMAT,
    version: VOCAB_VERSION,
    elements: [{ id: 'maglev_car', name: '磁悬浮小车', aliases: ['磁悬浮'], primitive: 'Draw.box' }],
    scenes: [],
  };
  const m = mergeVocab(v2, user, { primitiveNames });
  check(m.problems.length === 0, '新增用户元件不报错', m.problems.join('；'));
  check(m.vocab.elements.length === 12, '合并后元件 12 个', String(m.vocab.elements.length));
  check(m.vocab.elements.some((e) => e.id === 'maglev_car'), '新元件进了合并词表');

  const override = clone(user);
  override.elements = [{ id: 'block', name: '覆盖物块', aliases: [], primitive: 'Draw.box' }];
  const m2 = mergeVocab(v2, override, { primitiveNames });
  check(m2.problems.some((p) => p.includes('不能覆盖内置')), '用户不能覆盖内置 id', m2.problems.join('；'));

  const aliasClash = clone(user);
  aliasClash.elements = [{ id: 'maglev_car', name: '磁悬浮小车', aliases: ['物块'], primitive: 'Draw.box' }];
  const m3 = mergeVocab(v2, aliasClash, { primitiveNames });
  check(m3.warnings.some((w) => w.includes('别名/名称冲突')), '用户别名撞内置别名时告警', m3.warnings.join('；'));

  const badPrimitive = clone(user);
  badPrimitive.elements = [{ id: 'x', name: 'X', aliases: [], primitive: 'Draw.nope' }];
  const m4 = mergeVocab(v2, badPrimitive, { primitiveNames });
  check(m4.problems.some((p) => p.includes('不在 SDK 函数表里')), '未知 primitive 被拒绝', m4.problems.join('；'));

  const disabled = clone(user);
  disabled.elements = [];
  disabled.disabled = { elements: ['ball'], scenes: [] };
  const m5 = mergeVocab(v2, disabled, { primitiveNames });
  check(m5.vocab.elements.find((e) => e.id === 'ball')?.enabled === false, 'disabled 开关把 ball 置为 enabled=false');
  const promptText = buildJudgementVocabV2(m5.vocab);
  check(!promptText.includes('- ball｜'), '被关闭的元件不进 Prompt 词表');
  check(promptText.includes('- block｜'), '未关闭的元件仍在 Prompt 词表');
}

console.log('\n『C』条目 v2 校验');
{
  const base = {
    id: 'card.demo',
    title: '演示卡',
    kind: 'element',
    enabled: true,
    origin: 'user',
    constant: false,
    elements: ['block'],
    content: '演示',
    code_examples: ['drawFrame: `Draw.box([0, 0], 1, 1);`'],
  };
  check(validateEntryV2(base, { vocab: v2 }).length === 0, '合法 element 卡通过', validateEntryV2(base, { vocab: v2 }).join('；'));

  const scene = { ...base, id: 'card.scene', kind: 'scene', elements: undefined, scenes: ['belt'] };
  check(validateEntryV2(scene, { vocab: v2 }).length === 0, '合法 scene 卡通过', validateEntryV2(scene, { vocab: v2 }).join('；'));

  const rule = { ...base, id: 'card.rule', kind: 'anim_rule', elements: undefined, constant: true };
  check(validateEntryV2(rule, { vocab: v2 }).length === 0, '合法 anim_rule 卡通过', validateEntryV2(rule, { vocab: v2 }).join('；'));

  check(
    validateEntryV2({ ...base, elements: undefined }, { vocab: v2 }).some((p) => p.includes('至少 1 个 elements')),
    'element 卡缺 elements 被拒',
  );
  check(
    validateEntryV2({ ...base, kind: 'scene', elements: undefined, scenes: ['belt', 'incline'] }, { vocab: v2 }).some((p) =>
      p.includes('恰好 1 个'),
    ),
    'scene 卡多于 1 个场景被拒',
  );
  check(
    validateEntryV2({ ...base, constant: true }, { vocab: v2 }).some((p) => p.includes('constant 必须为 false')),
    'element 卡不能 constant',
  );
  check(
    validateEntryV2({ ...base, elements: ['nope'] }, { vocab: v2 }).some((p) => p.includes('词表外元件')),
    '词表外元件被拒',
  );
  check(
    validateEntryV2({ ...base, keys: ['旧字段'] }, { vocab: v2 }).some((p) => p.includes('v2 不认识的字段')),
    '旧字段 keys 被拒',
  );
  check(
    validateEntryV2({ ...base, scenes: ['belt'] }, { vocab: v2 }).some((p) => p.includes('不应有 scenes')),
    'element 卡带 scenes 被拒',
  );

  /* C 方案：size 只表达形状；尺寸数字全部在 physical（物理米）里 */
  const size = { shape: 'box', rotatable: true };
  const physical = { w: 0.2, h: 0.1 };
  check(
    validateEntryV2({ ...base, size, physical }, { vocab: v2 }).length === 0,
    'element 卡带合法 size + physical 通过',
    validateEntryV2({ ...base, size, physical }, { vocab: v2 }).join('；'),
  );
  check(
    validateEntryV2({ ...base, size: { ...size, w: 0.4, h: 0.3 } }, { vocab: v2 }).some((p) => p.includes('尺寸数字请写在 physical')),
    'size 里再写数字被拒（尺寸只在 physical）',
  );
  check(
    validateEntryV2({ ...base, size: { rotatable: true } }, { vocab: v2 }).some((p) => p.includes('缺少 shape')),
    'size 缺 shape 被拒',
  );
  check(
    validateEntryV2({ ...base, size: { ...size, shape: 'nope' } }, { vocab: v2 }).some((p) => p.includes('shape 必须是')),
    'size 的 shape 非枚举被拒',
  );
  check(
    validateEntryV2({ ...rule, size }, { vocab: v2 }).some((p) => p.includes('anim_rule') && p.includes('size')),
    'anim_rule 卡带 size 被拒',
  );
  check(
    validateEntryV2({ ...scene, size }, { vocab: v2 }).some((p) => p.includes('场景') && p.includes('不应有 size')),
    '场景卡带 size 被拒（尺寸由模型按题决定）',
  );
  check(
    validateEntryV2({ ...scene, physical: { h: 0.1 } }, { vocab: v2 }).some((p) => p.includes('不应有 physical')),
    '场景卡带 physical 被拒',
  );
  check(
    validateEntryV2({ ...base, physical: { w: 0.2 } }, { vocab: v2 }).some((p) => p.includes('至少要给 h 或 r')),
    'physical 缺 h/r 被拒',
  );
  check(
    validateEntryV2({ ...base, physical: { w: 0.2, h: -1 } }, { vocab: v2 }).some((p) => p.includes('正有限数')),
    'physical 负数被拒',
  );
  check(
    validateEntryV2({ ...base, physical: { ...physical, minPx: 36 } }, { vocab: v2 }).some((p) => p.includes('不认识的字段')),
    'physical 里的未知字段被拒',
  );

  /* board 特例：物理上只给厚度 h，长度按题面 */
  const boardBase = { ...base, elements: ['board'] };
  check(
    validateEntryV2({ ...boardBase, size, physical: { h: 0.02 } }, { vocab: v2 }).length === 0,
    'board 的 physical 只给 h 通过',
    validateEntryV2({ ...boardBase, size, physical: { h: 0.02 } }, { vocab: v2 }).join('；'),
  );
  check(
    validateEntryV2({ ...boardBase, size, physical: { w: 3 } }, { vocab: v2 }).some((p) => p.includes('至少要给 h 或 r')),
    'board 缺 h 被拒',
  );

  /* 存卡要走 editor.clean()；漏掉尺寸就会“UI 点一次保存，尺寸丢了” */
  {
    const dir = mkdtempSync(join(tmpdir(), 'kc-size-'));
    const saved = saveV2Entry({ dir, entry: { ...base, id: 'card.size.demo', size, physical }, vocab: v2 });
    const stored = saved.ok ? JSON.parse(readFileSync(join(dir, saved.name), 'utf8')).entries[0] : null;
    check('保存卡不丢 size（shape/rotatable）', saved.ok && stored?.size?.shape === 'box' && stored?.size?.rotatable === true, saved.issues?.join('；') ?? '');
    check('保存卡不丢 physical', saved.ok && stored?.physical?.h === 0.1, saved.issues?.join('；') ?? '');
    check('保存后 size 字段完整', JSON.stringify(stored?.size) === JSON.stringify(size), JSON.stringify(stored?.size));
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n『D』v1 → v2 迁移');
{
  const builtin93 = readJson('core/knowledgecard/data/93-elements.json').entries;
  const builtin92 = readJson('core/knowledgecard/data/92-animation-core.json').entries;
  let converted = 0;
  let disabled = 0;
  const problems = [];
  for (const e of [...builtin93, ...builtin92]) {
    const r = migrateEntryV1toV2(e, { vocab: v2 });
    if (r.ok) converted += 1;
    else disabled += 1;
    if (r.ok) {
      const p = validateEntryV2(r.entry, { vocab: v2 });
      if (p.length) problems.push(`${e.id}: ${p.join('；')}`);
      if ('keys' in r.entry) problems.push(`${e.id}: 迁移后仍带 keys`);
    }
  }
  check(converted === 10 && disabled === 23, '10 张内置卡迁移成功、23 张旧卡停用', `converted=${converted} disabled=${disabled}`);
  check(problems.length === 0, '迁移成功的卡都通过 v2 校验', problems.slice(0, 5).join('；'));

  const keysOnly = {
    id: 'card.keys-only',
    title: '只有关键字',
    kind: 'element',
    enabled: true,
    origin: 'user',
    keys: ['传送带'],
    insertion_slot: ['scene_code'],
    content: 'x',
  };
  const r1 = migrateEntryV1toV2(keysOnly, { vocab: v2 });
  check(!r1.ok && r1.action === 'disable', '只有 keys 的卡被停用', JSON.stringify(r1));

  const conceptsOnly = { ...keysOnly, id: 'card.concepts-only', keys: [], concepts: ['conveyor_belt'] };
  const r2 = migrateEntryV1toV2(conceptsOnly, { vocab: v2 });
  check(!r2.ok && r2.action === 'disable', '只有 concepts 的卡被停用', JSON.stringify(r2));

  const solveCard = { ...keysOnly, id: 'card.solve', keys: ['小球'], elements: ['ball'], insertion_slot: ['solve'] };
  const r3 = migrateEntryV1toV2(solveCard, { vocab: v2 });
  check(r3.ok && !('insertion_slot' in r3.entry), 'solve 卡迁移后没有 insertion_slot');
  check(r3.warnings.some((w) => w.includes('solve')), 'solve 卡迁移有 warning');

  const v1Scene = { ...keysOnly, id: 'card.scene-v1', kind: 'scene', keys: ['传送带'], concepts: ['conveyor_belt'] };
  const r4 = migrateEntryV1toV2(v1Scene, { vocab: v2 });
  check(!r4.ok && r4.action === 'disable', 'v1 场景卡被停用（等重绑）', JSON.stringify(r4));
}

console.log('\n『E』v2 运行时库 / 判定 / 触发');
{
  const lib = loadV2Library();
  check(lib.ok, 'v2 运行时库加载无问题', lib.problems.join('；'));
  check(lib.entries.length === 31, '内置 31 张 v2 卡', String(lib.entries.length));
  check(lib.vocab.elements.length === 11 && lib.vocab.scenes.length === 18, '词表 11 元件 + 18 场景');

  /* ── 1:1 治理：启用的词表项 ↔ 启用的卡片，无孤儿 ── */
  {
    const activeElements = lib.vocab.elements.filter((e) => e.enabled !== false);
    const activeScenes = lib.vocab.scenes.filter((s) => s.enabled !== false);
    const elementCards = lib.entries.filter((e) => e.kind === 'element' && e.enabled !== false);
    const sceneCards = lib.entries.filter((e) => e.kind === 'scene' && e.enabled !== false);
    const missingElement = activeElements.filter((e) => elementCards.filter((c) => c.elements?.includes(e.id)).length !== 1);
    const missingScene = activeScenes.filter((s) => sceneCards.filter((c) => c.scenes?.includes(s.id)).length !== 1);
    const orphanElement = elementCards.filter((c) => !activeElements.some((e) => c.elements?.includes(e.id)));
    const orphanScene = sceneCards.filter((c) => !activeScenes.some((s) => c.scenes?.includes(s.id)));
    check(
      '★ 1:1：每个启用元件恰好一张启用卡',
      missingElement.length === 0 && orphanElement.length === 0,
      `缺/重 ${missingElement.map((e) => e.id).join(',')}；孤儿 ${orphanElement.map((c) => c.id).join(',')}`,
    );
    check(
      '★ 1:1：每个启用场景恰好一张启用卡',
      missingScene.length === 0 && orphanScene.length === 0,
      `缺/重 ${missingScene.map((s) => s.id).join(',')}；孤儿 ${orphanScene.map((c) => c.id).join(',')}`,
    );
  }

  /* ── v6 卡片口径：示例是**裸 drawFrame 函数体**，且逐段过 C1 ── */
  {
    const exampleProblems = [];
    const shapeProblems = [];
    for (const e of lib.entries) {
      const examples = e.code_examples ?? [];
      if (e.kind === 'element' && examples.length !== 1) shapeProblems.push(`${e.id}: element 卡应有 1 段示例（实际 ${examples.length}）`);
      if (e.kind === 'anim_rule' && examples.length !== 0) shapeProblems.push(`${e.id}: 常驻卡不应带示例（实际 ${examples.length}）`);
      for (const ex of examples) {
        if (/^\s*(drawFrame|VIEW|setup|stateAt|readouts)\s*:/.test(ex)) shapeProblems.push(`${e.id}: 示例仍带旧槽位标签 ${ex.slice(0, 30)}`);
        if (/`/.test(ex)) shapeProblems.push(`${e.id}: 示例里还有反引号`);
        const r = lintSlot({ code: ex, slot: 'drawFrame', entry: e.id });
        for (const d of r.diagnostics) exampleProblems.push(`${e.id}: ${d.rule}@${d.line} ${d.message}`);
      }
      if (e.kind === 'element') {
        for (const h of ['## 判据', '## 画法', '## 自检']) {
          if (!e.content.includes(h)) shapeProblems.push(`${e.id}: 缺小节 ${h}`);
        }
        if (!e.content.includes('state.<key>')) shapeProblems.push(`${e.id}: 没有 state.<key> 口径`);
      } else if (!e.content.includes('## 自检')) {
        shapeProblems.push(`${e.id}: 常驻卡缺 ## 自检`);
      }
    }
    check(shapeProblems.length === 0, '31 张卡的小节/示例形状符合 v6（判据·画法·自检；示例裸代码）', shapeProblems.slice(0, 4).join('；'));
    check(exampleProblems.length === 0, '所有 v2 code_examples 都按 drawFrame 过 C1', exampleProblems.slice(0, 4).join('；'));
  }

  const judgeText = '【动画元件】block\n【场景】belt\n【判定依据】水平传送带和物块';
  const judgeVocab = buildJudgementVocabV2(lib.vocab);
  check(judgeVocab.includes('【动画元件词表】') && judgeVocab.includes('【场景词表】'), '词表文本包含元件与场景两段');
  const parsed = parseJudgementV2(judgeText, { vocab: lib.vocab });
  check(parsed.elements.join(',') === 'block', '解析出 block', parsed.elements.join(','));
  check(parsed.scenes.join(',') === 'belt', '解析出 belt', parsed.scenes.join(','));
  check(parsed.problems.length === 0, '完整判定无问题', parsed.problems.map((p) => p.code).join(','));

  const sceneCard = {
    id: 'scene.conveyor-demo',
    title: '场景·传送带+物块（演示）',
    kind: 'scene',
    origin: 'user',
    enabled: true,
    constant: false,
    scenes: ['belt'],
    order: 10,
    priority: 'high',
    content: '# 场景·传送带+物块\n\n先地面，再传送带，再物块。',
    code_examples: [],
  };
  check(validateEntryV2(sceneCard, { vocab: lib.vocab }).length === 0, '演示场景卡通过 v2 校验');

  const result = triggerKnowledgecardV2({
    entries: [...lib.entries, sceneCard],
    elements: parsed.elements,
    scenes: parsed.scenes,
  });
  const prov = result.provenance.map((p) => `${p.entry_id}:${p.via}`);
  check(prov.includes('wb_el_block:element') && prov.includes('wb_sc_belt:scene'), '元件卡/场景卡分别按 elements/scenes 命中', prov.join(' '));
  check(prov.includes('scene.conveyor-demo:scene'), '场景卡按 scenes 命中', prov.join(' '));
  check(result.text.scene_code.includes('场景·传送带+物块'), '场景卡正文进了拼接文本');
  check(!prov.some((p) => p.endsWith(':key')), '没有 key 触发路径', prov.join(' '));

  const bad = parseJudgementV2('【动画元件】nope\n【场景】no_scene\n【判定依据】x', { vocab: lib.vocab });
  check(bad.elements.length === 0 && bad.scenes.length === 0, '表外词不产出 id');
  check(bad.problems.some((p) => p.code === 'unknown-element') && bad.problems.some((p) => p.code === 'unknown-scene'), '表外词如实报出', bad.problems.map((p) => p.code).join(','));
}

console.log('\n『F』v1 用户卡在 v2 库里的迁移');
{
  const tmp = mkdtempSync(join(tmpdir(), 'kc-v2-'));
  try {
    const v1Pack = {
      format: 'od-knowledgecard',
      version: 1,
      entries: [
        {
          id: 'user.ball',
          title: '用户·小球',
          origin: 'user',
          category: 'scene_modeling',
          enabled: true,
          keys: ['小球'],
          insertion_slot: ['scene_code'],
          content: '用户小球卡',
          elements: ['ball'],
          code_examples: [],
        },
        {
          id: 'user.keys-only',
          title: '用户·只有关键字',
          origin: 'user',
          category: 'scene_modeling',
          enabled: true,
          keys: ['传送带'],
          insertion_slot: ['scene_code'],
          content: '只有关键字',
          code_examples: [],
        },
      ],
    };
    writeFileSync(join(tmp, 'pack.json'), JSON.stringify(v1Pack, null, 2), 'utf8');
    const lib = loadV2Library({ userDir: tmp, userVocabPath: join(tmp, 'no-vocab.json') });
    check(lib.ok, '带 v1 用户卡的库加载无硬错误', lib.problems.join('；'));
    check(lib.entries.length === 32, '内置 31 + 迁移成功的 1 张用户卡', String(lib.entries.length));
    check(lib.user.some((e) => e.id === 'user.ball' && e.elements?.[0] === 'ball'), '有 elements 的 v1 用户卡迁移成功');
    check(lib.migration.some((m) => m.id === 'user.keys-only' && m.action === 'disable'), '只有 keys 的用户卡被停用+报告');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n『G』Phase 3 过渡：v2 卡接进 v1 引擎');
{
  const lib = loadV2Library();
  const v1Entries = lib.entries.map(v2ToV1RuntimeEntry);
  const r = triggerKnowledgecard({
    entries: v1Entries,
    text: '水平传送带上的物块',
    concepts: [],
    tags: [],
    elements: ['block'],
    scenes: ['belt'],
  });
  const prov = r.provenance.map((p) => `${p.entry_id}:${p.via}`);
  check(prov.includes('wb_sc_belt:scene') && prov.includes('wb_el_block:element'), 'v2 卡经适配器仍按 elements/scenes 命中', prov.join(' '));
  check(!prov.some((p) => p.endsWith(':key')), '适配后没有 key 命中路径', prov.join(' '));
  check(r.text.scene_code.includes('场景·传送带'), '传送带卡正文进了 v1 引擎拼接文本');
  check(r.slots.solve.empty === true, 'solve 槽仍为空');
}

console.log('\n『H』Phase 3 读题 v2 + 场景触发');
{
  const p = getPrompt('read_problem_v2');
  check(Boolean(p) && p.system.includes('【场景】'), 'read_problem_v2 存在且要求【场景】');
  const sceneEntry = v2ToV1RuntimeEntry({
    id: 'scene.conveyor-demo',
    title: '场景·传送带+物块（演示）',
    kind: 'scene',
    origin: 'user',
    enabled: true,
    constant: false,
    scenes: ['belt'],
    order: 10,
    priority: 'high',
    content: '先地面，再传送带，再物块。',
    code_examples: [],
  });
  const r = triggerKnowledgecard({
    entries: [sceneEntry],
    text: '',
    concepts: [],
    tags: [],
    elements: [],
    scenes: ['belt'],
  });
  check(r.provenance.some((x) => x.entry_id === 'scene.conveyor-demo' && x.via === 'scene'), 'v1 引擎也能按 scenes 命中（Phase 3 过渡）', JSON.stringify(r.provenance));
}

console.log(bad ? `\n✗ 知识卡 v2 契约自检失败 ${bad} 条` : '\n✓ 知识卡 v2 契约自检全部通过');
if (bad) process.exitCode = 1;
