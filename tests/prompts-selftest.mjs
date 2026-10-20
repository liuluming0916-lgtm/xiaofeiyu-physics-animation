#!/usr/bin/env node
/**
 * Prompt 系统取证（第 3 期第 4 步）。
 *
 * 重点是 **promptHash 的语义**（§10.2"前缀稳定性 = prompt cache 命中率 = 真实成本"）：
 *   · 同一配置两次组装必须**逐字节一致**；
 *   · **换题目文字**不得改变 promptHash；
 *   · **换图片**不得改变 promptHash（图片只在任务段）—— 这是最容易被写错的一条；
 *   · 但**改 Prompt 正文 / 改 SDK 摘要**必须改变 promptHash。
 *
 * 最后一条尤其重要：如果改 Prompt 也不变哈希，那 Provenance 烧录的哈希就是假的。
 *
 * 用法：node tests/prompts-selftest.mjs
 */

import {
  assemblePrompt,
  buildFixedPrefix,
  buildStagePrefix,
  PREFIX_STAGES,
  buildTaskSegment,
  buildConditionalSegment,
  buildTemplateSkeleton,
  loadSignatureSummary,
} from '../core/prompts/index.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../tools/paths.mjs';

import { PROMPTS, getPrompt, listPrompts, listExtensionPrompts, ANSWER_STRUCTURE_TEMPLATE, buildJudgementVocab } from '../core/prompts/templates.mjs';
import { SLOT_KEY_NAMES, KNOWLEDGECARD_CONCEPTS, KNOWLEDGECARD_CONCEPT_IDS, KNOWLEDGECARD_ELEMENT_IDS } from '../contracts/spec/frozen-keys.mjs';
import { sha256 } from '../contracts/generate-contracts.mjs';

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

console.log('Prompt 系统取证（第 3 期第 4 步）\n');

/* ────────────────────────────── 『A』固定前缀的内容 ────────────────────────────── */

console.log('『A』固定前缀（§10.2 三段之一）');
{
  const p = buildFixedPrefix();
  check('前缀包含"角色与输出规约"', p.text.includes('高中物理解题与动画生成助手'));
  check('前缀包含模板骨架', p.text.includes('模板骨架'));
  check('前缀包含 SDK 签名摘要', p.text.includes('SDK 签名摘要'));
  check('前缀里出现了全部 8 个冻结键名', SLOT_KEY_NAMES.every((k) => p.text.includes(k)));
  check('前缀说明了标记协议', p.text.includes('/* @slot:KEY */') && p.text.includes('/* @end */'));
  check('前缀提到了"不会按顺序猜测槽位"', p.text.includes('不会按顺序猜测槽位'));
  check('promptHash 是 64 位十六进制', /^[0-9a-f]{64}$/.test(p.promptHash));
}

console.log('\n『A-1』assemblePrompt 的 prefixBytes 是真实字节数');
{
  const r = assemblePrompt({ problem: { text: '题目' } });
  const expected = Buffer.byteLength(buildFixedPrefix().text, 'utf8');
  check('prefixBytes == 前缀的 UTF-8 字节数', r.prefixBytes === expected, `${r.prefixBytes} vs ${expected}`);
  check('中文字符按 3 字节计（不是字符串长度）', r.prefixBytes > buildFixedPrefix().text.length);
}

console.log('\n『A-2』前缀里**不得**出现题目相关信息');
{
  // 这一条是从"函数签名"上保证的：buildFixedPrefix 不接受任何参数。
  // 这里再用内容兜底检查一次，防止以后有人偷偷往骨架里塞题面。
  const p = buildFixedPrefix();
  const forbidden = ['这道题', '已知条件', '配图补充描述', '随附题目图片'];
  const hit = forbidden.filter((w) => p.text.includes(w));
  check('前缀不含题目/图片相关字样', hit.length === 0, `命中：${hit.join(', ')}`);
  check('buildFixedPrefix.length === 0（不接受参数）', buildFixedPrefix.length === 0);

  /* ── 第 9 期：**每一段**前缀都不许含题目字样（前缀现在按阶段分五条） ── */
  const stageHits = [];
  for (const s of PREFIX_STAGES) {
    for (const w of forbidden) if (buildStagePrefix(s).text.includes(w)) stageHits.push(`${s}:${w}`);
  }
  check('五个阶段各自的前缀都不含题目/图片字样', stageHits.length === 0, stageHits.join(', '));
}

console.log('\n『A-3』前缀**按阶段**取（第 9 期：不让读题/解题白带 SDK 清单）');
{
  const p = (s) => buildStagePrefix(s).text.length;
  const codeStages = ['scene_code', 'repair'];
  const proseStages = ['read_problem', 'solve', 'steps', 'answers'];

  check(
    '前四个阶段的前缀**都很薄**（每段 < 200 字）',
    proseStages.every((s) => p(s) < 200),
    proseStages.map((s) => `${s}=${p(s)}`).join(' · '),
  );
  check(
    '前四个阶段的前缀**不含**模板骨架与 SDK 摘要（省下的就是这 3,219 字）',
    proseStages.every((s) => {
      const t = buildStagePrefix(s).text;
      return !t.includes('模板骨架') && !t.includes('SDK 签名摘要') && !t.includes('/* @slot:KEY */');
    }),
    proseStages.map((s) => `${s}=${p(s)}`).join(' · '),
  );
  check(
    '要写代码的两个阶段（scene_code / repair）**仍然**带骨架与 SDK 摘要',
    codeStages.every((s) => {
      const t = buildStagePrefix(s).text;
      return t.includes('模板骨架') && t.includes('SDK 签名摘要') && SLOT_KEY_NAMES.every((k) => t.includes(k));
    }),
  );
  const total = ['read_problem', 'solve', 'steps', 'answers', 'scene_code'].reduce((n, s) => n + p(s), 0);
  check(
    `一道题的前缀总量从 5×3563 降到 ${total} 字（省 13,841）`,
    total < 5000,
    String(total),
  );
  check('未知阶段回落到完整前缀（宁可多发，也不让某段缺东西）', buildStagePrefix('no-such-stage').text.length === p('scene_code'));
}

/* ────────────────────────────── 『B』promptHash 语义（本文件的核心） ────────────────────────────── */

console.log('\n『B』promptHash 语义');
{
  const a = assemblePrompt({ problem: { text: '题目 A' } });
  const b = assemblePrompt({ problem: { text: '题目 A' } });
  check('同配置两次组装哈希一致', a.promptHash === b.promptHash);
  check('同配置两次组装前缀逐字节一致', a.segments.prefix === b.segments.prefix);

  const c = assemblePrompt({ problem: { text: '完全不同的另一道题：滑块在斜面上滑动' } });
  check('换题目文字**不改变** promptHash', a.promptHash === c.promptHash, `${a.promptHash} vs ${c.promptHash}`);
  check('但任务段确实不同', a.segments.task !== c.segments.task);

  const withImg = assemblePrompt({
    problem: { text: '题目 A' },
    images: [{ mime: 'image/png', data: Buffer.from([1, 2, 3]) }],
  });
  check('**换图片不改变** promptHash（图片只在任务段）', a.promptHash === withImg.promptHash);
  check('带图时 imageCount 正确', withImg.imageCount === 1);
  check('带图时任务段提到图片', withImg.segments.task.includes('随附题目图片'));

  const withDesc = assemblePrompt({ problem: { text: '题目 A', description: '图中斜面倾角 30°' } });
  check('配图补充描述也不改变 promptHash', a.promptHash === withDesc.promptHash);
  check('补充描述进了任务段', withDesc.segments.task.includes('斜面倾角 30°'));

  // 反向：改 Prompt 正文必须改哈希 —— 否则 Provenance 烧录的哈希就是假的
  const recomputed = sha256(
    [
      '你是一名高中物理解题与动画生成助手。'.repeat(1), // 明显不同的角色段
      buildTemplateSkeleton(),
      loadSignatureSummary(),
      '1.0.0',
      '1.0.0',
    ].join('\u0000'),
  );
  check('改角色段会得到不同哈希（哈希确实覆盖 Prompt 正文）', recomputed !== a.promptHash);
  check(
    '哈希覆盖 = 各阶段前缀（按固定顺序）+ templateVersion + sdkVersion',
    sha256([...PREFIX_STAGES.map((s) => buildStagePrefix(s).text), '1.0.0', '1.0.0'].join('\u0000')) === a.promptHash,
  );
  check(
    '整版指纹对"任何一段前缀改动"都敏感（改读题那段角色文字 ⇒ 哈希必变）',
    (() => {
      const texts = PREFIX_STAGES.map((s) => buildStagePrefix(s).text);
      texts[0] = `${texts[0]}（多一句）`;
      return sha256([...texts, '1.0.0', '1.0.0'].join('\u0000')) !== a.promptHash;
    })(),
  );
}

/* ────────────────────────────── 『C』三段结构与条件段空槽 ────────────────────────────── */

console.log('\n『C』三段结构（§10.2）');
{
  const r = assemblePrompt({ problem: { text: '题目' } });
  check('返回 messages 数组（system + user）', r.messages.length === 2);
  check('system 段承载固定前缀', r.messages[0].role === 'system');
  check('user 段承载任务段', r.messages[1].role === 'user');
  check('system 段包含完整前缀', r.messages[0].content.includes(buildFixedPrefix().text));

  const cond = buildConditionalSegment([]);
  check('条件段在"无词条、无指令"时为空', cond.text === '' && cond.entryCount === 0);

  const withWb = buildConditionalSegment([{ title: '传送带模型', content: '共速后摩擦力为零' }]);
  check('条件段有词条时按 §9.2 的来源标记格式输出', withWb.text.includes('【世界书·解题：传送带模型】'));
  const r2 = assemblePrompt({ problem: { text: 'x' }, knowledgecardEntries: [{ title: 'T', content: 'C' }] });
  check('词条进 system 段（不在任务段）', r2.messages[0].content.includes('【世界书·解题：T】'));
  check('加词条**不改变** promptHash（条件段不属于固定前缀）', r2.promptHash === r.promptHash);
}

console.log('\n『C-3』第 5 期：条件段的分槽标记与"本阶段指令"标签（两件事不许混用同一个标记）');
{
  const solveSeg = buildConditionalSegment([{ title: '传送带', content: 'x', slot: 'solve' }]);
  const sceneSeg = buildConditionalSegment([{ title: '传送带', content: 'y', slot: 'scene_code' }]);
  check('solve 槽的词条用【世界书·解题：…】', solveSeg.text.includes('【世界书·解题：传送带】'));
  check('scene_code 槽的词条用【世界书·动画建模：…】', sceneSeg.text.includes('【世界书·动画建模：传送带】'));

  const withInstruction = buildConditionalSegment([{ title: 'T', content: 'C' }], {
    slot: 'solve',
    instruction: '只输出 8 个槽位。',
    instructionLabel: '解题',
  });
  check('阶段指令有**自己的**标签', withInstruction.text.includes('【本阶段指令：解题】'));
  check('指令与词条标记**不混用**（同一段里两个标记都在，且各自独立）', withInstruction.text.includes('【世界书·解题：T】'));
  check('没有指令时不产生指令块', !buildConditionalSegment([{ title: 'T', content: 'C' }]).text.includes('【本阶段指令'));
  check('条件段的两个组成部分由函数返回，不靠分隔符反推', withInstruction.instructionText.includes('只输出 8 个槽位') && withInstruction.knowledgecardText.includes('【世界书·解题：T】'));
  check(
    '词条正文里的空行不会把条件段切碎（用 split 反推会踩这个坑）',
    buildConditionalSegment([{ title: 'T', content: '第一段\n\n第二段' }]).text.includes('第一段\n\n第二段'),
  );

  const base = assemblePrompt({ problem: { text: '题目' } });
  const ap = assemblePrompt({
    problem: { text: '题干' },
    instructions: '指令正文',
    instructionLabel: '动画代码',
    stageSlot: 'scene_code',
    knowledgecardSegment: '【世界书·动画建模：T】\nC',
  });
  check('assemblePrompt 支持 stageSlot + knowledgecardSegment', ap.messages[0].content.includes('【本阶段指令：动画代码】') && ap.messages[0].content.includes('【世界书·动画建模：T】'));
  check('segments.instruction / segments.knowledgecard 分别是两块', ap.segments.instruction.includes('指令正文') && ap.segments.knowledgecard.includes('【世界书·动画建模：T】'));
  check('带指令与词条都**不改变** promptHash（条件段不属于固定前缀）', ap.promptHash === base.promptHash);
}

console.log('\n『C-2』任务段组成');
{
  const t = buildTaskSegment({ text: '题干', knownConditions: 'g=10', description: '图中有滑轮' });
  check('含题干', t.text.includes('题干'));
  check('含已知条件小节', t.text.includes('【已知条件】') && t.text.includes('g=10'));
  check('含配图补充描述小节（§11.3 人工兜底入口）', t.text.includes('【配图补充描述'));
  check('明确标注"不是模型看图所得"', t.text.includes('不是模型看图所得'));
  check('无图片时 imageCount 为 0', t.imageCount === 0);
}

/* ────────────────────────────── 『D』4 个阶段 Prompt（§10.1 保留项） ────────────────────────────── */

console.log('\n『D』§10.1 保留的 4 个阶段 Prompt（另有扩展 Prompt）');
{
  const ids = listPrompts().map((p) => p.id);
  const expected = ['solve', 'answers', 'steps', 'scene_code'];
  check('§10.1 保留的 4 个阶段 Prompt 都在', expected.every((id) => ids.includes(id)), ids.join(','));
  check('§10.1 只剩 4 个（knowledgecard / distill 已随蒸馏功能删除）', ids.length === 4, ids.join(','));
  check('knowledgecard / distill 不再出现在阶段 Prompt 清单里', !ids.includes('knowledgecard') && !ids.includes('distill'), ids.join(','));
  check('加上答案结构模板共 5 项', ids.length === 4 && ANSWER_STRUCTURE_TEMPLATE.length > 0);

  for (const id of expected) {
    const p = getPrompt(id);
    check(`${id}：有 label 与 duty`, Boolean(p.label && p.duty));
    check(`${id}：system 非空`, typeof p.system === 'string' && p.system.length > 20);
    check(`${id}：有 buildUser`, typeof p.buildUser === 'function');
  }

  let threw = false;
  try {
    getPrompt('not_a_prompt');
  } catch {
    threw = true;
  }
  check('未知 id 明确报错（不静默返回 undefined）', threw);

  check(
    'answers Prompt 里带 §3.3 的字段清单',
    PROMPTS.answers.system.includes('at_t') && PROMPTS.answers.system.includes('tol'),
  );
  check(
    'scene_code Prompt 提醒 stateAt 禁止 Phys.integrate（§7.6）',
    PROMPTS.scene_code.system.includes('Phys.integrate'),
  );
  check(
    'scene_code Prompt 提醒导出键不得与 STEPS 字段同名（第 1 期第 7 节第 3 条的坑）',
    PROMPTS.scene_code.system.includes('静默覆盖'),
  );
  check('steps Prompt 写明时间锚点必须无缝有序', PROMPTS.steps.system.includes('无缝'));
}

console.log('\n『D-2』扩展 Prompt：repair（第 4 期）+ read_problem（第 5 期新增，第 5.7 期改名）（**都不属于 §10.1**）');
{
  const ext = listExtensionPrompts();
  check(
    '扩展 Prompt 恰好 3 个：repair、read_problem 与 read_problem_v2',
    ext.length === 3 && ext.map((e) => e.id).join(',') === 'repair,read_problem,read_problem_v2',
    ext.map((e) => e.id).join(','),
  );
  check(
    '它们能被追溯到是哪一期来的（since / renamedIn）',
    ext.find((e) => e.id === 'repair')?.since === 'phase4' &&
      ext.find((e) => e.id === 'read_problem')?.since === 'phase5',
  );
  check(
    '⚠ 负对照：第 5.7 期改名后，旧 id `read_image` 必须**取不到**（否则老调用会被静默路由到新语义）',
    (() => {
      try {
        getPrompt('read_image');
        return false;
      } catch {
        return true;
      }
    })(),
  );

  const r = getPrompt('repair');
  check('repair：有 label 与 duty', Boolean(r.label && r.duty));
  check('repair：system 非空', typeof r.system === 'string' && r.system.length > 20);
  check('repair Prompt 要求"只输出被要求修改的槽位"', r.system.includes('只输出被要求修改的槽位'));
  check('repair Prompt 说明证据强度三档的用法（§14.5 风险 3 的对策）', r.system.includes('精确') && r.system.includes('重放定位') && r.system.includes('候选'));
  check('repair Prompt 明确"忽略校验的指令不会生效"（§10.3）', r.system.includes('不会生效'));
  check('repair Prompt 重申 stateAt 禁用 Phys.integrate', r.system.includes('Phys.integrate'));
  check('repair Prompt 不在 PROMPTS 里（否则 §10.1 的清单会被改动）', !('repair' in PROMPTS));
  check('getPrompt 同时覆盖 §10.1 与扩展', getPrompt('solve').id === 'solve' && getPrompt('repair').id === 'repair');
}

console.log('\n『D-3』第 5/5.7 期：读题与判定（read_problem · 执行链的第 0 步）');
{
  const rp = getPrompt('read_problem');
  check('read_problem：有 label 与 duty', rp.label === '读题与判定' && Boolean(rp.duty), rp.label);
  check('read_problem：system 非空且足够具体', typeof rp.system === 'string' && rp.system.length > 200);
  check('read_problem：明确"不要解题、不给答案"', rp.system.includes('不要解题'));

  /* ── 第 5 期留下的转写口径（一条都不许丢：下游解题与写动画都靠它） ── */
  check('read_problem：要求**沿用题面与图片里的原词**（否则世界书检索会失败）', rp.system.includes('沿用题面与图片里的原词'));
  check('read_problem：要求写清**朝向**（哪一端高）—— 这正是"斜面画反"的对策', rp.system.includes('哪一端高') || rp.system.includes('左低右高'));
  check('read_problem：看不清就写"图中未标注"，不许编造', rp.system.includes('图中未标注') && rp.system.includes('不要猜'));
  check('read_problem：要求输出**分节**文字（下游要按节读几何）', rp.system.includes('【物体与姿态】') && rp.system.includes('【相对位置与朝向】'));

  /**
   * ── 第 9 期（用户裁决 A）：判定**只剩【动画元件】一节** ──
   *
   * 【考点】/【题型】两节连同它们的两张词表一起下线：真库里声明 `concepts` / `tags` 的词条是
   * **0 条**（题型级讲义卡已按用户目标退役，新公式规范卡也不挂 concepts），
   * 那两张表每道题在发却没人消费 —— 5,011 字/题的纯浪费。
   */
  check('read_problem：**不再**要求【考点】/【题型】两节（它们已无消费者）', !rp.system.includes('【考点】') && !rp.system.includes('【题型】'));
  check('read_problem：要求输出【动画元件】段', rp.system.includes('【动画元件】'));
  check('read_problem：要求写【判定依据】（判定必须留下可复核的理由）', rp.system.includes('【判定依据】'));
  check(
    'read_problem：禁止自造词（"逐字取自词表"）',
    rp.system.includes('逐字取自词表') && rp.system.includes('不许自造'),
  );
  check(
    'read_problem：判不出来写"无"，不许凑（判错的代价比判少更大）',
    rp.system.includes('判不出来就写"无"') && rp.system.includes('不要为了凑答案硬选'),
  );
  check(
    'read_problem：动画元件要求"图片 + 题面一起看"（纯文字题按题面判）',
    rp.system.includes('图片 + 题面') && rp.system.includes('不要因为没有图就写"无"'),
  );
  check(
    'read_problem：不再把"没图"当成判"无"的理由（v1.1.5 文字题实测回归）',
    !rp.system.includes('没有图或图里没有就写"无"'),
  );

  /* ── 词表注入（单源真相：contracts/knowledgecard-concepts.json 派生） ── */
  const vocab = buildJudgementVocab(KNOWLEDGECARD_CONCEPTS);
  check('判定词表注入：**只有**动画元件表这一张（考点表 / 题型表已下线）', vocab.includes('【动画元件词表】') && !vocab.includes('【考点词表】') && !vocab.includes('【题型标签词表】'));
  check(
    '判定词表注入：**不**再把 57 个考点塞进去（省 1,468 字/题）',
    KNOWLEDGECARD_CONCEPT_IDS.length > 0 && !KNOWLEDGECARD_CONCEPT_IDS.some((id) => vocab.includes(`- ${id}｜`)),
    `${KNOWLEDGECARD_CONCEPT_IDS.length} 个考点`,
  );
  check(
    '判定词表注入：元件数量与契约派生的一致',
    KNOWLEDGECARD_ELEMENT_IDS.length > 0 && KNOWLEDGECARD_ELEMENT_IDS.every((id) => vocab.includes(id)),
    `${KNOWLEDGECARD_ELEMENT_IDS.length} 个元件`,
  );
  check(
    '⚠ 负对照：**别名不进 Prompt**（别名只给程序归一化用；注入它只会增噪音，S1 实测提示词 +34%）',
    !vocab.includes('别名'),
  );
  check(
    '⚠ 负对照：词表里**不应**出现表外的幻词（抽一个不可能存在的 id 验伪）',
    !vocab.includes('__not_a_real_concept__'),
  );

  const u = rp.buildUser({ problem: '题干', description: '图里是传送带', knownConditions: 'g=10', vocab });
  check('read_problem 的输入段带上题面', u.includes('题干'));
  check('read_problem 的输入段带上**用户手打的配图描述**（§11.3 的人工兜底）', u.includes('图里是传送带'));
  check('read_problem 的输入段带上已知条件', u.includes('g=10'));
  check('read_problem 的输入段只带元件词表（考点表已下线）', u.includes('【动画元件词表】') && !u.includes('【考点词表】'));
  const u2 = rp.buildUser({ problem: '', vocab });
  check('没有任何文字时也说得清（"只有图片"这一情形必须被支持）', u2.includes('只有图片'));
  check(
    '⚠ 负对照：词表缺失时**明说缺**，而不是静默给一张空表（否则模型会自造词）',
    rp.buildUser({ problem: 'x' }).includes('词表缺失'),
  );
  check('read_problem 不在 PROMPTS 里（§10.1 保留项仍恰好 4 项）', !('read_problem' in PROMPTS));
}

/* ────────────────────────────── 『E』§10.3 安全边界 ────────────────────────────── */

console.log('\n『E』§10.3：Prompt 是只读文本，不能关闭门禁');
{
  // 结构性论证：Prompt 只影响"模型说什么"，而 C1–C9 判的是"模型交出来的代码"。
  // 这里做的是"接口层"的证明：Prompt 模块不导出任何能影响校验器的东西。
  const mod = await import('../core/prompts/index.mjs');
  const exported = Object.keys(mod);
  const suspicious = exported.filter((k) => /lint|check|verify|dryrun|validate/i.test(k));
  check('Prompt 模块不导出任何"能关掉门禁"的东西', suspicious.length === 0, suspicious.join(','));
  check(
    '（对照）门禁入口在另一个模块里',
    typeof (await import('../contracts/validate.mjs')).validateEndpointConfig === 'function',
  );
}

/* ────────────────────────────── 『G』数值/符号：已合并为"按条目" ────────────────────────────── */

console.log('\n『G』数值与符号**不再是一个全局开关**（第 8 期合并，规则下沉到"按条目"）');
{
  /**
   * 历史：第 8 期曾让 `NUMERIC` / `SYMBOLIC` 在任务段说两套话（"每项必须给数值" / "value 必须是 null"）。
   * 用户 2026-10-18 裁决合并，理由是**判据本来就按条目**：
   *   C7 只看单条：`value` 是数字就数值复现、是 `null` 就要求 `latex`。它从不读全局 mode。
   * 所以全局开关只会带来"用户必须先判对题型"和"一问数值一问符号就没法办"两个坑。
   *
   * 这一节钉三件事：
   *   ① 传不传 mode，任务段**必须一样**（不再分叉 ⇒ 开关不能复活成装饰品）；
   *   ② `promptHash` 仍相同（模式本来就不该污染跨题稳定的前缀）；
   *   ③ 那条"逐条"规则**真的写进了 answers 阶段**（否则合并就等于把约束删了）。
   */
  const base = { problem: { text: '一道符号题' } };
  const n = assemblePrompt({ ...base, mode: 'NUMERIC' });
  const s = assemblePrompt({ ...base, mode: 'SYMBOLIC' });
  const plain = assemblePrompt({ ...base });

  check('★ 传 NUMERIC 与 SYMBOLIC，任务段**一字不差**（分叉已取消）', n.segments.task === s.segments.task);
  check('不传 mode 与传 mode 也一字不差（参数已从签名里去掉，传了也不消费）', plain.segments.task === n.segments.task);
  check('★ `promptHash` 相同（前缀仍跨题稳定，cache 不受影响）', n.promptHash === s.promptHash);
  check('任务段里**不再**出现"数值驱动 / 符号驱动"这类全局口径', !/数值驱动|符号驱动/.test(n.segments.task));

  /** ③ 合并后的约束在 answers 阶段（逐条：value 或 latex 至少给一个） */
  const answers = PROMPTS.answers.system;
  check('answers 阶段要求"逐条判断"（不看整道题是什么类型）', /逐条判断/.test(answers));
  check('answers 阶段允许"数值与符号混着来"（一问数值一问符号）', /混着来/.test(answers));
  check('answers 阶段要求符号结论必须给 latex', /value:\s*null/.test(answers) && /latex/.test(answers));
  check('answers 阶段仍要求"示意取值"要写明（防止动画另编一套数）', /示意取值/.test(answers));

  /* 源码级：pipeline 里不应再有 `mode: snapshot.mode` 传给 assemblePrompt */
  const pipelineSrc = readFileSync(join(PROJECT_ROOT, 'core/orchestrator/pipeline.mjs'), 'utf8');
  const calls = (pipelineSrc.match(/assemblePrompt\(\{/g) ?? []).length;
  check('pipeline 里仍有 assemblePrompt 调用', calls > 0, String(calls));
  check(
    '★ pipeline 里**不再**给 assemblePrompt 传 mode（传了就是分叉又回来了）',
    !/assemblePrompt\(\{[\s\S]{0,400}?mode:\s*snapshot\.mode/.test(pipelineSrc),
  );
}

/* ────────────────────────────── 『H』参考答案模式（v1.1.16） ────────────────────────────── */

console.log('\n『H』参考答案 / 解析：不填时逐字不变，填了改成"按解析整理"（system 与 user 口径一致）');
{
  const solve = getPrompt('solve');
  const problem = '一物块以初速度滑上 30° 斜面，求它回到出发点时的速度。';

  check(
    '★ 不填解析：用户消息与题面**逐字一致**（不勾选 = 行为不变）',
    solve.buildUser({ problem }) === problem,
  );
  check(
    '传了空对象也走旧路径（只判断"有没有内容"）',
    solve.buildUser({ problem, reference: { text: '   ', images: [] } }) === problem,
  );

  /* system 与 user **各自一套、口径一致**：system 说"按解析整理"，user 只放材料 */
  const refSystem = solve.systemWithReference;
  check('解析模式有独立的 system（不是只在 user 里补一句）', typeof refSystem === 'string' && refSystem.length > 100);
  check('解析模式的 system 明确"不要自己求解"', refSystem.includes('不要自己求解'));
  check('解析模式的 system 要求数值照抄、不许更正', refSystem.includes('照抄') && refSystem.includes('不许“更正”'));
  check('解析模式的 system 要求缺量写"解析未提供"', refSystem.includes('解析未提供'));
  check('解析模式的 system 写明"对不上就输出标记并停"', refSystem.includes('【解析与题目不一致】'));
  check('解析模式的 system 要求保留事件顺序（后面拆步骤要用）', refSystem.includes('事件顺序'));

  const withRef = solve.buildUser({ problem, reference: { text: '(1) W_F = -10 J；(2) m_C = 3 kg', images: [] } });
  check('解析模式的 user 包含解析原文', withRef.includes('(1) W_F = -10 J；(2) m_C = 3 kg'));
  check('解析模式的 user 仍带上原题（对齐问法与符号）', withRef.includes(problem));
  check('解析模式的 user 不再重复整套规矩（只指向本阶段口径）', withRef.includes('按本阶段的口径整理') && withRef.length < problem.length + 400);
  check(
    '★ 两种模式的 system 不同（否则等于没分叉）',
    solve.system !== refSystem && solve.system.includes('完整解题过程'),
  );
}

/* ────────────────────────────── 汇总 ────────────────────────────── */

console.log(`\n${failures.length ? '✗' : '✓'} Prompt 系统取证：通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
  process.exitCode = 1;
}
