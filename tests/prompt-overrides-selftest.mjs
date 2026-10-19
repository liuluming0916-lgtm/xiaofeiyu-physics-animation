#!/usr/bin/env node
/**
 * Prompt 编辑器取证（第 6 期第 2 项 · §10.1 / §10.3 / §16）。
 *
 * 这一份要证明四件事：
 *   A 目录**不骗人**：能编辑的 7 份正文按"会不会跑"分组；knowledgecard / distill 已删除，不再有 not-wired 组；
 *   B 硬门禁**在保存那一刻就红**：删掉 `read_problem` 的【考点】/【动画元件】会**静默**让世界书
 *     退化成按字面碰字（解析器容错极强，不会报错），所以必须拦在写盘之前；
 *   C 用户裁决的 C 方案：整份替换 + **内置变了要提醒**、能看差异、能换基线（rebase）；
 *   D **真的接上了**：覆盖正文必须出现在发给模型的 system 消息里，且不影响 `promptHash`。
 *
 * ⚠ 全部操作在临时目录里，**不碰**仓库里真实的 `ai-rules/`。
 *
 * 用法：node tests/prompt-overrides-selftest.mjs
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isCliEntry } from '../tools/paths.mjs';
import { SLOT_KEY_NAMES } from '../contracts/spec/frozen-keys.mjs';
import { assemblePrompt, getPrompt } from '../core/prompts/index.mjs';
import { PROMPTS, ANSWER_STRUCTURE_TEMPLATE } from '../core/prompts/templates.mjs';
import {
  PROMPT_SECTORS,
  builtinPromptText,
  editablePromptIds,
  listPromptCatalog,
  openPrompt,
  rebasePromptOverride,
  resetPromptOverride,
  savePromptOverride,
} from '../core/prompts/editor.mjs';
import { diffLines, promptStatus, PROMPT_STATUS } from '../core/prompts/overlay.mjs';
import { commitRulesChange, initRulesWorkspace, loadRulesWorkspace, readRulesIndex, sha256Hex } from '../core/rules/index.mjs';
import { collectEvents, snapshotConfig } from '../core/orchestrator/pipeline.mjs';

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

const created = [];
function freshDir() {
  const d = mkdtempSync(join(tmpdir(), 'od-prompt-'));
  created.push(d);
  initRulesWorkspace({ dir: d });
  return d;
}

const has = (list, code) => (list ?? []).some((x) => x.code === code);
const find = (list, code) => (list ?? []).find((x) => x.code === code) ?? null;

/** 一份"合法"的 read_problem 覆盖正文：故意保留硬约束里的两个记号 */
function readProblemOverride(extra = '') {
  return [
    '现在执行【读题与判定】阶段。',
    '',
    '【考点】从下面《考点词表》里选，可多选。',
    '【题型】从《题型标签词表》里选，必须属于你选的考点。',
    '【动画元件】从《动画元件词表》里选，依据图里实际画出来的东西。',
    '【判定依据】一句话说清为什么判这几个考点。',
    '',
    '要求：逐字取自词表，不许自造；判不出来写"无"。',
    extra,
  ].join('\n');
}

/* ── 编排用的假端点：只为了让 `runPipeline` 跑起来（本组不验模型质量） ── */
function endpoint() {
  return {
    id: 'ep_test',
    displayName: '测试端点',
    baseURL: 'https://example.invalid/v1',
    defaultModel: 'test-model',
    visionModel: null,
    apiKeyModelId: null,
    supportsJsonMode: true,
    supportsVision: true,
    enableThinking: false,
    preserveThinking: false,
    timeoutMs: 5000,
  };
}

const STAGE_LABELS = [
  ['读题与判定', 'read_problem'],
  ['解题', 'solve'],
  ['答案抽取', 'answers'],
  ['分步解析', 'steps'],
  ['动画代码', 'scene_code'],
  ['自愈修复', 'repair'],
];

function fakeStream(replies = {}) {
  const calls = [];
  const impl = async (opts) => {
    calls.push(opts);
    const sys = String(opts.messages?.[0]?.content ?? '');
    const hit = STAGE_LABELS.find(([label]) => sys.includes(`【本阶段指令：${label}】`));
    const stage = hit ? hit[1] : 'unknown';
    const full = replies[stage] ?? `【${stage} 输出】`;
    opts.onDelta?.(full);
    return { text: full, reasoning: '', usage: null, model: 'fake', deltas: [full] };
  };
  impl.calls = calls;
  return impl;
}

function goodSceneCode() {
  const body = {
    PROBLEM: '题干。',
    STEPS: 'title: 一步\ntex: x\nt0: 0\nt1: 1',
    ANSWERS: 'symbol: a\nvalue: 1\nunit: m\ntol: 0.01\nat_t: 1\nstep: 1',
    VIEW: 'SIM.duration = 1;',
    setup: 'const g = 10;',
    stateAt: 'return { x: t };',
    drawFrame: 'Draw.dot(0, 0);',
    readouts: 'return [{ label: "x", value: t, unit: "m" }];',
  };
  return SLOT_KEY_NAMES.map((k) => `/* @slot:${k} */\n${body[k]}\n/* @end */`).join('\n');
}

function fakeDryRun(verdict = 'pass') {
  return async () => ({
    report: {
      format: 'od-dry-run-report',
      version: 2,
      verdict,
      cancelled: false,
      meta: { templateVersion: '1.0.0' },
      execution: { termination: 'completed', frameCount: 2, backendId: 'worker' },
      checks: [{ id: 'C1', status: 'pass', blocking: true, message: 'ok', diagnostics: [] }],
      extensions: [],
      observations: {},
    },
    run: null,
    lint: null,
  });
}

async function main() {
  console.log('Prompt 编辑器取证（第 6 期第 2 项 · §10.1 / §16）\n');

  try {
    /* ────────────────────────────── 『A』目录不骗人 ────────────────────────────── */

    console.log('『A』目录：7 份正文按"会不会跑"分组');
    {
      const dir = freshDir();
      const cat = listPromptCatalog({ dir });
      check('目录可读', cat.ok === true, JSON.stringify(cat.problems));
      check('共 7 项（§10.1 保留 4 + 扩展 repair + read_problem + 答案结构模板）', cat.items.length === 7, String(cat.items.length));

      const byGroup = (g) => cat.items.filter((i) => i.group === g).map((i) => i.id);
      check('「每道题都会跑」恰好 5 份', byGroup('always').length === 5, byGroup('always').join(','));
      check('其中含 read_problem（第 0 步，纯文字题也跑）', byGroup('always').includes('read_problem'));
      check('「只在特定情况下跑」恰好 1 份（repair）', byGroup('conditional').join(',') === 'repair');
      check('没有「还没接上主链路」分组（knowledgecard / distill 已删除）', byGroup('not-wired').length === 0, byGroup('not-wired').join(','));
      check('「嵌在别的 Prompt 里」恰好 1 份（答案结构模板）', byGroup('embedded').join(',') === 'answer-structure');

      const embedded = cat.items.find((i) => i.id === 'answer-structure');
      check('★ 答案结构模板说明它在 answers 里、且整份覆盖优先', /没有整体覆盖 answers/.test(embedded.groupHint), embedded.groupHint);

      check('read_problem 被标为高风险', cat.items.find((i) => i.id === 'read_problem').risk === 'high');
      check('solve 是普通风险', cat.items.find((i) => i.id === 'solve').risk === 'normal');

      const solve = cat.items.find((i) => i.id === 'solve');
      check('内置正文与 PROMPTS.solve.system 逐字节一致', solve.builtinText === PROMPTS.solve.system);
      check('内置 sha 与正文哈希一致', solve.builtinSha === sha256Hex(PROMPTS.solve.system));
      check('空工作区里全部是 builtin 状态', cat.items.every((i) => i.override === null));
      check('答案结构模板的内置 = ANSWER_STRUCTURE_TEMPLATE', cat.items.find((i) => i.id === 'answer-structure').builtinText === ANSWER_STRUCTURE_TEMPLATE);

      // 分组口径与阶段清单**同源**：不是手写的第二份清单
      check('分组 id 与 MODEL_STAGES 同源（改阶段清单，分组自动跟着变）', PROMPT_SECTORS.always.ids.join(',') === 'read_problem,solve,steps,answers,scene_code');
      check('editablePromptIds 没有重复', new Set(editablePromptIds()).size === editablePromptIds().length);
      check('editablePromptIds 共 7 个', editablePromptIds().length === 7, String(editablePromptIds().length));
    }

    /* ────────────────────────────── 『B』保存与打开 ────────────────────────────── */

    console.log('\n『B』保存：整份替换 + 记录基线');
    {
      const dir = freshDir();
      const text = '现在执行【解题】阶段。\n第一步：先说清研究对象。\n第二步：列方程，每条编号。\n结论写成"符号 = 数值 + 单位"。\n';
      const r = savePromptOverride({ dir, id: 'solve', text });
      check('保存成功', r.ok === true, JSON.stringify(r.issues));
      check('revision 前进到 1', r.revision === 1);
      check('文件落在 prompts/solve.md', readFileSync(join(dir, 'prompts', 'solve.md'), 'utf8') === text);

      const idx = readRulesIndex(dir).index;
      const entry = idx.files['prompts/solve.md'];
      check('索引里记了 basedOn（基于哪一版内置）', entry.basedOn?.sha256 === sha256Hex(PROMPTS.solve.system));
      check('basedOn 还存了当初的内置正文（供以后并排看差异）', entry.basedOn?.text === PROMPTS.solve.system);
      check('basedOn 带保存时间', typeof entry.basedOn?.savedAt === 'string');

      const cat = listPromptCatalog({ dir });
      const solve = cat.items.find((i) => i.id === 'solve');
      check('目录里显示为"已覆盖"', solve.override?.text === text);
      check('状态是 ok（基于当前这版内置）', solve.override?.status === PROMPT_STATUS.OK);

      const opened = openPrompt({ dir, id: 'solve' });
      check('打开时同时给出内置正文与覆盖正文', opened.ok && opened.builtinText === PROMPTS.solve.system && opened.overrideText === text);
      check('打开时给出 expectedHash（保存时原样回传，撞车会被拒绝）', opened.expectedHash === sha256Hex(text));
    }

    /* ────────────────────────────── 『C』读题的硬门禁 ────────────────────────────── */

    console.log('\n『C』硬门禁：删掉【考点】/【动画元件】会在保存那一刻就红');
    {
      const dir = freshDir();

      const noConcept = readProblemOverride().split('【考点】从下面《考点词表》里选，可多选。').join('');
      const r1 = savePromptOverride({ dir, id: 'read_problem', text: noConcept });
      check('删掉【考点】⇒ 拒绝保存', r1.ok === false && has(r1.issues, 'prompt.missing-required-token'));
      check('★ 拒绝时**文件根本没被创建**（不落盘）', !loadRulesWorkspace({ dir }).prompts.read_problem);
      const p1 = find(r1.issues, 'prompt.missing-required-token');
      check('★ 说明里点出后果：会静默退化成语义失效的按字面碰字', /按字面碰字/.test(p1?.hint ?? ''), p1?.hint);

      const noElem = readProblemOverride().split('【动画元件】从《动画元件词表》里选，依据图里实际画出来的东西。').join('');
      const r2 = savePromptOverride({ dir, id: 'read_problem', text: noElem });
      check('删掉【动画元件】⇒ 拒绝保存', r2.ok === false && has(r2.issues, 'prompt.missing-required-token'));
      check('（对照）同一份正文只要两个字都在就能保存', savePromptOverride({ dir, id: 'read_problem', text: readProblemOverride() }).ok === true);

      // 软的那两条：删了允许保存，但必须**回报警告**
      const noTag = readProblemOverride().split('【题型】从《题型标签词表》里选，必须属于你选的考点。').join('');
      const r3 = savePromptOverride({ dir, id: 'read_problem', text: noTag });
      check('删掉【题型】⇒ 允许保存（只有警告）', r3.ok === true);
      check('★ 但必须回报警告（不许静默）', has(r3.warnings, 'prompt.missing-token'));
    }

    /* ────────────────────────────── 『D』软警告 ────────────────────────────── */

    console.log('\n『D』软警告：不拦，但要说出来');
    {
      const dir = freshDir();
      const r = savePromptOverride({ dir, id: 'solve', text: '现在执行【解题】阶段。\n请给出完整过程，结论写清楚。\n' });
      check('保存成功', r.ok === true);
      check('没有"单位"二字 ⇒ 带 unit 相关警告', has(r.warnings, 'prompt.missing-token'));
      check('正文过短 ⇒ 带 prompt.too-short 警告', (() => {
        const r2 = savePromptOverride({ dir, id: 'steps', text: '分步解析。\n' });
        return has(r2.warnings, 'prompt.too-short');
      })());
    }

    /* ────────────────────────────── 『E』冲突 / 恢复 / 未知 id ────────────────────────────── */

    console.log('\n『E』冲突、恢复默认、未知 id');
    {
      const dir = freshDir();
      const text = '现在执行【解题】阶段。\n完整的解题过程，每条公式编号，结论带单位。\n';
      const first = savePromptOverride({ dir, id: 'solve', text });
      check('先保存一份', first.ok === true);

      const stale = savePromptOverride({ dir, id: 'solve', text: `${text}（改）\n`, expectedHash: null });
      check('用错的 expectedHash 保存 ⇒ 拒绝（§16 拒绝冲突）', stale.ok === false && has(stale.issues, 'rules.conflict'));

      const forced = savePromptOverride({ dir, id: 'solve', text: `${text}（改）\n`, expectedHash: null, force: true });
      check('明确 force ⇒ 覆盖成功', forced.ok === true);

      const opened = openPrompt({ dir, id: 'solve' });
      const reset = resetPromptOverride({ dir, id: 'solve', expectedHash: opened.expectedHash });
      check('恢复默认成功', reset.ok === true, JSON.stringify(reset.issues));
      check('恢复默认是**删文件**，不是写空正文', !loadRulesWorkspace({ dir }).prompts.solve);
      check('恢复之后 getPrompt 返回**内置对象本身**（引用相同）', getPrompt('solve') === PROMPTS.solve);

      const bad = savePromptOverride({ dir, id: 'solve2', text: 'x' });
      check('未知 id ⇒ 拒绝并列出可用 id', bad.ok === false && /可用：/.test(bad.issues[0]?.hint ?? ''));
    }

    /* ────────────────────────────── 『F』C 方案的核心 ────────────────────────────── */

    console.log('\n『F』C 方案：内置变了要提醒、能看差异、能换基线');
    {
      const dir = freshDir();
      savePromptOverride({ dir, id: 'solve', text: '现在执行【解题】阶段。\n（我的版本）每条公式编号，结论带单位。\n' });

      // 模拟"程序升级，内置正文变了"：把索引里的 basedOn 改成"旧内置"
      // （用工作区自己的原子写，避免手写坏 JSON；正式代码里这个位置由 savePromptOverride 填）
      const oldText = '现在执行【解题】阶段。\n（老版内置，只有一句）\n';
      const { setRulesFileMetadata } = await import('../core/rules/index.mjs');
      const meta = setRulesFileMetadata({
        dir,
        rel: 'prompts/solve.md',
        basedOn: { sha256: sha256Hex(oldText), text: oldText, savedAt: new Date().toISOString() },
      });
      check('（前置）把基线改成"旧内置"成功', meta.ok === true, JSON.stringify(meta.issues));

      const cat = listPromptCatalog({ dir });
      const solve = cat.items.find((i) => i.id === 'solve');
      check('★ 内置已变 ⇒ 状态是 stale（不是你发现不了）', solve.override?.status === PROMPT_STATUS.STALE);
      check('★ 且能算出差异（旧内置 vs 现内置）', solve.override?.diff?.changed > 0, JSON.stringify(solve.override?.diff?.changed));
      check('差异里能看到"现在内置独有的新增行"（供你决定抄不抄）', solve.override.diff.lines.some((l) => l.type === 'add'));

      const opened = openPrompt({ dir, id: 'solve' });
      check('打开时也带着 stale 与基线时间', opened.status === PROMPT_STATUS.STALE && typeof opened.baseSavedAt === 'string');

      const before = loadRulesWorkspace({ dir }).prompts.solve.text;
      const reb = rebasePromptOverride({ dir, id: 'solve' });
      check('换基线成功', reb.ok === true, JSON.stringify(reb.issues));
      check('★ 换基线**不动正文**（我的版本还是我的）', loadRulesWorkspace({ dir }).prompts.solve.text === before);
      check('换基线后状态回到 ok', listPromptCatalog({ dir }).items.find((i) => i.id === 'solve').override.status === PROMPT_STATUS.OK);

      // ★ 流程缺口补丁：在记事本里改文件、再走"登记"时，**基线必须保留**（血统没变）
      const { adoptRulesFiles, readRulesIndex: readIdx } = await import('../core/rules/index.mjs');
      const abs = join(dir, 'prompts', 'solve.md');
      const { writeFileSync: w } = await import('node:fs');
      w(abs, '外部改的一版，每条公式编号，结论带单位。\n');
      adoptRulesFiles({ dir, rels: ['prompts/solve.md'], force: true });
      const afterAdopt = readIdx(dir).index.files['prompts/solve.md'];
      check('★ 登记外部改动后**基线仍在**（否则"内置变过"的提醒会在改一次字之后永远消失）', typeof afterAdopt.basedOn?.sha256 === 'string');
      check('★ 且基线指向当前内置 ⇒ 状态仍是 ok', listPromptCatalog({ dir }).items.find((i) => i.id === 'solve').override.status === PROMPT_STATUS.OK);

      // 真·不知道血统：一个从未登记过的文件
      w(join(dir, 'prompts', 'steps.md'), '分步解析：三步，t0/t1 无缝衔接。\n');
      adoptRulesFiles({ dir, rels: ['prompts/steps.md'], force: true });
      check(
        '★ 从未登记过的文件被登记 ⇒ unknown-base（不知道基于哪版，不假装知道）',
        listPromptCatalog({ dir }).items.find((i) => i.id === 'steps').override.status === PROMPT_STATUS.UNKNOWN_BASE,
      );
    }

    /* ────────────────────────────── 『G』真的接上了 ────────────────────────────── */

    console.log('\n『G』接线：覆盖正文真的进了发给模型的 system 消息');
    {
      const dir = freshDir();
      const OVERRIDE = '【我自己的解题指令】先说研究对象，再列方程（每条编号），结论带单位。';
      savePromptOverride({ dir, id: 'solve', text: OVERRIDE });

      const runtimeRules = loadRulesWorkspace({ dir }).snapshot;
      check('快照里有覆盖正文', runtimeRules.promptTexts.solve === OVERRIDE);

      const snap = snapshotConfig({ endpoint: endpoint(), apiKey: 'sk-test', rulesSnapshot: runtimeRules });
      check('每題快照里带着规则 revision', snap.rules.revision === 1, String(snap.rules.revision));
      check('每題快照里的覆盖正文是冻结的（跑着不会被改）', Object.isFrozen(snap.rules.promptTexts));

      const stream = fakeStream({ scene_code: goodSceneCode() });
      await collectEvents({
        problem: { text: '一物块从斜面滑下，求底端速度。' },
        config: { endpoint: endpoint(), apiKey: 'sk-test', rulesSnapshot: runtimeRules },
        streamImpl: stream,
        dryRunImpl: fakeDryRun('pass'),
      });

      const sysTexts = stream.calls.map((c) => String(c.messages?.[0]?.content ?? ''));
      check('★ 发给模型的 system 消息里出现了我的覆盖正文', sysTexts.some((s) => s.includes(OVERRIDE)));
      check('★ 且仍然带着阶段标签（否则编排认不出阶段）', sysTexts.some((s) => s.includes(OVERRIDE) && s.includes('【本阶段指令：解题】')));
      check('★ 没有覆盖的阶段仍用内置正文（read_problem）', sysTexts.some((s) => s.includes('现在执行【读题与判定】阶段')));

      // 不传规则快照 ⇒ 与第 6 期之前完全一致
      const stream2 = fakeStream({ scene_code: goodSceneCode() });
      await collectEvents({
        problem: { text: '一物块从斜面滑下，求底端速度。' },
        config: { endpoint: endpoint(), apiKey: 'sk-test' },
        streamImpl: stream2,
        dryRunImpl: fakeDryRun('pass'),
      });
      check('不传规则快照 ⇒ 不用覆盖（行为与第 6 期之前一致）', !stream2.calls.some((c) => String(c.messages?.[0]?.content ?? '').includes(OVERRIDE)));

      // ★ 覆盖只影响条件段，不影响固定前缀 ⇒ promptHash 不变
      const a = assemblePrompt({ problem: { text: '同一道题' } });
      const b = assemblePrompt({ problem: { text: '同一道题' }, instructions: OVERRIDE, instructionLabel: '解题' });
      check('★ 覆盖正文不改变 promptHash（前缀缓存不受影响）', a.promptHash === b.promptHash);
      check('（对照）但条件段确实变了', a.segments.conditional !== b.segments.conditional);
    }

    /* ────────────────────────────── 『H』答案结构模板 ────────────────────────────── */

    console.log('\n『H』答案结构模板：（没有自己的阶段）只能嵌进 answers');
    {
      const dir = freshDir();
      const STRUCT = 'ANSWERS 字段：symbol / value / unit / tol / at_t / step / latex（我的口径）。\n每问结论必须给单位。';
      const r = savePromptOverride({ dir, id: 'answer-structure', text: STRUCT });
      check('保存成功', r.ok === true, JSON.stringify(r.issues));
      check('此时不产生 warn（answers 没被整体覆盖）', !has(r.warnings, 'prompt.answer-structure-shadowed'));

      const rules = loadRulesWorkspace({ dir }).snapshot;
      const answers = getPrompt('answers', rules);
      check('★ 覆盖的模板进了 answers 正文', answers.system.includes(STRUCT));
      check('★ 原内置模板被替换掉（不是"两段并存"）', !answers.system.includes(ANSWER_STRUCTURE_TEMPLATE));
      check('answers 正文其余部分仍来自内置', answers.system.includes('现在执行【答案抽取】阶段。'));

      // 整份覆盖 answers ⇒ 结构模板被遮蔽
      savePromptOverride({ dir, id: 'answers', text: '现在执行【答案抽取】阶段。\n按我的格式给我 symbol / value / unit。\n' });
      const rules2 = loadRulesWorkspace({ dir }).snapshot;
      const answers2 = getPrompt('answers', rules2);
      check('★ 整份覆盖 answers 后，结构模板不再进入（整份覆盖优先）', !answers2.system.includes(STRUCT));
      const r2 = savePromptOverride({ dir, id: 'answer-structure', text: `${STRUCT}\n（再存一次）` });
      check('★ 此时再存结构模板 ⇒ 必须警告"不会生效"', has(r2.warnings, 'prompt.answer-structure-shadowed'));
    }

    /* ────────────────────────────── 『I』已删除的 Prompt 不允许再保存 ────────────────────────────── */

    console.log('\n『I』knowledgecard / distill 已删除：保存必须被拒');
    {
      const dir = freshDir();
      const wb = savePromptOverride({ dir, id: 'knowledgecard', text: '现在执行【世界书】阶段。\n把材料改写成词条。\n' });
      const ds = savePromptOverride({ dir, id: 'distill', text: '现在执行【教辅蒸馏】阶段。\n' });
      check('knowledgecard 保存被拒（prompt.unknown-id）', wb.ok === false && has(wb.issues, 'prompt.unknown-id'));
      check('distill 保存被拒（prompt.unknown-id）', ds.ok === false && has(ds.issues, 'prompt.unknown-id'));
    }

    /* ────────────────────────────── 『J』状态机与差异工具 ────────────────────────────── */

    console.log('\n『J』状态机与差异工具（纯函数）');
    {
      const sha = sha256Hex('x');
      check('没条目 ⇒ builtin', promptStatus(null, sha) === PROMPT_STATUS.BUILTIN);
      check('basedOn 相同 ⇒ ok', promptStatus({ basedOn: { sha256: sha } }, sha) === PROMPT_STATUS.OK);
      check('basedOn 不同 ⇒ stale', promptStatus({ basedOn: { sha256: sha256Hex('y') } }, sha) === PROMPT_STATUS.STALE);
      check('没有 basedOn ⇒ unknown-base', promptStatus({}, sha) === PROMPT_STATUS.UNKNOWN_BASE);

      const d = diffLines('a\nb\nc', 'a\nB\nc\nd');
      check('差异里相同的行保持 same', d.filter((x) => x.type === 'same').length === 2);
      check('改动行被标成 del/add', d.some((x) => x.type === 'del' && x.text === 'b') && d.some((x) => x.type === 'add' && x.text === 'B'));
      check('新增行被标成 add', d.some((x) => x.type === 'add' && x.text === 'd'));
      check('文本相同时没有任何改动行', diffLines('a\nb', 'a\nb').every((x) => x.type === 'same'));
    }
  } finally {
    for (const d of created) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* 临时目录清不掉不影响结论 */
      }
    }
  }

  console.log(`\n${failures.length ? '✗' : '✓'} Prompt 编辑器取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
