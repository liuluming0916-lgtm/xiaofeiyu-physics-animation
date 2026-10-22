#!/usr/bin/env node
/**
 * 第 6 期**总装验收**（§18 第 6 行的验收原文，一口气跑完）。
 *
 * 前面几项各自有自己的取证（㉓–㉖），但它们证明的是"零件对不对"。
 * 这一份证明的是**整机**：把验收原文三条串起来，在**同一套路**里跑一遍。
 *
 * 验收原文（`物理解题动画软件v1.0自研方案.md` §18 第 6 行）：
 *   ① 四类改动都「**下一题生效**」且**在跑题目不受影响**；
 *   ② 导出的配置**不含任何 Key**；
 *   ③ 规则文件被改坏时**载入被拒并指出具体位置**。
 *
 * 覆盖的四类改动（§18 的"四类"）：
 *   · Prompt 正文（§10）        · 清洗规则（§12）
 *   · 端点配置（§11）           · 答案结构模板（§10.1，嵌在 answers 里）
 *
 * ⚠ 全部在临时目录里跑，**不碰**仓库真实的 `ai-rules/`。
 *
 * 用法：node tests/phase6-acceptance-selftest.mjs
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isCliEntry } from '../tools/paths.mjs';
import { SLOT_KEY_NAMES } from '../contracts/spec/frozen-keys.mjs';
import { collectEvents } from '../core/orchestrator/pipeline.mjs';
import { ANALYSIS_EXAMPLE } from '../core/analysis/example.mjs';
import { buildProgramFromText } from '../core/cleaner/index.mjs';
import { getPrompt } from '../core/prompts/index.mjs';
import { listPromptCatalog, savePromptOverride } from '../core/prompts/editor.mjs';
import { addCleaningRule, loadCleaningTable } from '../core/cleaner/editor.mjs';
import {
  createRulesRuntime,
  initRulesWorkspace,
  loadRulesWorkspace,
  readRulesIndex,
} from '../core/rules/index.mjs';
import {
  exportEndpointsText,
  importEndpoints,
  loadEndpointStore,
  saveEndpoints,
  setKey,
} from '../core/gateway/index.mjs';

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
  const d = mkdtempSync(join(tmpdir(), 'od-phase6-'));
  created.push(d);
  initRulesWorkspace({ dir: d });
  return d;
}

function endpoint(over = {}) {
  return {
    id: 'ep_main',
    displayName: '主力模型',
    baseURL: 'https://api.example.com/v1',
    defaultModel: 'model-a',
    visionModel: '',
    apiKeyModelId: null,
    supportsJsonMode: true,
    supportsVision: false,
    enableThinking: false,
    preserveThinking: false,
    timeoutMs: 60000,
    ...over,
  };
}

const STAGE_LABELS = [
  ['读题与判定', 'read_problem'],
  ['解题', 'solve'],
  ['答案讲解', 'breakdown'],
  ['物理分析', 'analysis'],
  ['动画代码', 'scene_code'],
];

function fakeStream(replies = {}) {
  const calls = [];
  const impl = async (opts) => {
    calls.push(opts);
    const sys = String(opts.messages?.[0]?.content ?? '');
    const hit = STAGE_LABELS.find(([label]) => sys.includes(`【本阶段指令：${label}】`));
    const stage = hit ? hit[1] : 'unknown';
    const full = replies[stage] ?? (stage === 'analysis' ? ANALYSIS_EXAMPLE : `【${stage} 输出】`);
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
    readouts: 'return [];',
  };
  return SLOT_KEY_NAMES.map((k) => `/* @slot:${k} */\n${body[k]}\n/* @end */`).join('\n');
}

function fakeDryRun() {
  return async () => ({
    report: {
      format: 'od-dry-run-report',
      version: 2,
      verdict: 'pass',
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
  console.log('第 6 期总装验收（§18 第 6 行）\n');

  try {
    /* ══════════════ ① 四类改动都"下一题生效"，且"正在跑的题不受影响" ══════════════ */

    console.log('① 下一题生效 + 跑着的题不受影响（§16 热重载语义原话）');
    {
      const dir = freshDir();

      // ── 类 1：Prompt 正文 ──
      console.log('\n  ── 类 1/4：Prompt 正文 ──');
      const runtime = createRulesRuntime({ dir });
      check('（前置）空工作区可载入', runtime.reload().ok === true);

      const running = runtime.snapshotForNewProblem('正在跑的题');
      check('（前置）它拿到的是内置正文', getPrompt('solve', running).origin === undefined);

      const v1 = '【第一版】先写研究对象，再列方程，结论带单位。';
      check('（前置）保存第一版覆盖成功', savePromptOverride({ dir, id: 'solve', text: v1 }).ok === true);
      runtime.reload();
      const next1 = runtime.snapshotForNewProblem('第一版之后的新题');
      check('★ 新题拿到第一版', getPrompt('solve', next1).system === v1);
      check('★ 正在跑的题**仍然是内置**（钉住的快照没变）', getPrompt('solve', runtime.snapshotOf('正在跑的题')).system !== v1);

      const v2 = '【第二版】先说研究对象，再说受力分析，最后列方程（每条编号），结论带单位。';
      const opened = listPromptCatalog({ dir }).items.find((i) => i.id === 'solve');
      check('（前置）保存第二版覆盖成功', savePromptOverride({ dir, id: 'solve', text: v2, expectedHash: opened.override.sha256 }).ok === true);
      runtime.reload();
      check('★ 再下一题拿到第二版', getPrompt('solve', runtime.snapshotForNewProblem('第二版之后的新题')).system === v2);
      check('★ 第一版的那道题仍停在第一版', getPrompt('solve', runtime.snapshotOf('第一版之后的新题')).system === v1);
      check('★ 最早那道题仍停在内置', getPrompt('solve', runtime.snapshotOf('正在跑的题')).system !== v1);

      // ── 类 2：analysis 运动表口径 ──
      console.log('\n  ── 类 2/4：analysis 运动表口径 ──');
      const struct = '【我的运动表口径】每个元件必须给 segment / t0 / t1 / x0 / y0 / vx0 / vy0 / ax / ay / x / y。';
      check('保存 analysis 覆盖成功', savePromptOverride({ dir, id: 'analysis', text: struct }).ok === true);
      runtime.reload();
      const an = getPrompt('analysis', runtime.snapshotForNewProblem('运动表口径之后的新题'));
      check('★ 新的 analysis 正文用上了我的口径', an.system.includes(struct));
      check('★ 它替换掉了内置正文（不是两段并存）', !an.system.includes('=== 元件运动表 (MOTIONS) ==='));

      // ── 类 3：清洗规则 ──
      console.log('\n  ── 类 3/4：清洗规则 ──');
      const addRule = addCleaningRule({
        dir,
        rule: {
          id: 'pow',
          name: 'Math.pow 改写成乘法',
          stage: 'scene_code',
          pattern: 'Math\\.pow\\(([^,]+),\\s*2\\)',
          flags: 'g',
          replacement: '($1)*($1)',
          enabled: true,
        },
      });
      check('添加清洗规则成功', addRule.ok === true, JSON.stringify(addRule.issues));
      runtime.reload();
      const withRule = runtime.snapshotForNewProblem('加了规则之后的新题');
      const programText = goodSceneCode().replace('SIM.duration = 1;', 'SIM.duration = Math.pow(2, 2);');
      const built = buildProgramFromText(programText, { regexRules: withRule.cleaningRules });
      check('★ 新题真的被洗到了（Math.pow(2,2) → (2)*(2)）', built.program.slots.VIEW.includes('(2)*(2)'), built.program.slots.VIEW);
      check('★ 旧题没被这条规则影响（它钉住的是空规则表）', (runtime.snapshotOf('正在跑的题').cleaningRules ?? []).length === 0);

      // ── 类 4：端点配置（保存即生效；不合法则拒绝） ──
      console.log('\n  ── 类 4/4：端点配置 ──');
      const bad = saveEndpoints({ dir, endpoints: [endpoint({ baseURL: 'http://example.com/v1' })], stageModels: {} });
      check('★ 不合法（http 非本机）⇒ 拒绝保存', bad.ok === false);
      const good = saveEndpoints({ dir, endpoints: [endpoint()], stageModels: { solve: 'ep_main' } });
      check('合法配置保存成功', good.ok === true, JSON.stringify(good.issues));
      const epStore = loadEndpointStore({ dir });
      check('★ 保存后立刻可读到（不用重启）', epStore.ok && epStore.stageModels.solve === 'ep_main');
    }

    /* ══════════════ ② 导出的配置不含任何 Key ══════════════ */

    console.log('\n② 导出的配置不含任何 Key（§16 原文）');
    {
      const dir = freshDir();
      saveEndpoints({ dir, endpoints: [endpoint()], stageModels: { solve: 'ep_main' } });
      const KEY = 'sk-PHASE6ACCEPTANCE0123456789';
      check('（前置）设置 Key 成功', setKey({ dir, id: 'ep_main', key: KEY }).ok === true);

      const st = loadEndpointStore({ dir });
      const exported = exportEndpointsText({
        endpoints: st.config.endpoints,
        stageModels: st.config.stageModels,
        knownKeys: Object.values(st.keys),
      });

      check('★ 导出文本里没有 Key 值', !exported.text.includes(KEY));
      check('★ 导出文本里没有 sk- 形态', !/sk-[A-Za-z0-9_-]{8,}/.test(exported.text));
      check('★ 导出的 keys 是空对象', /"keys":\s*\{\s*\}/.test(exported.text));
      check('★ 导出的配置仍然合法（能直接导入回来）', (() => {
        const back = importEndpoints({ dir: freshDir(), text: exported.text });
        return back.ok === true;
      })());
      check('★ 反向保障：导入一份带 Key 的文件会被拒（不是静默丢掉）', (() => {
        const withKey = JSON.stringify({ ...JSON.parse(exported.text), keys: { ep_main: KEY } });
        const r = importEndpoints({ dir: freshDir(), text: withKey });
        return r.ok === false && r.issues.some((i) => i.code === 'endpoints.keys-not-allowed');
      })());
    }

    /* ══════════════ ③ 规则文件被改坏 ⇒ 载入被拒并指出具体位置 ══════════════ */

    console.log('\n③ 规则文件被改坏：载入被拒，并**指出具体位置**（§18 原文）');
    {
      const dir = freshDir();
      savePromptOverride({ dir, id: 'solve', text: '现在执行【解题】阶段。\n先写研究对象，再列方程，结论带单位。\n' });
      addCleaningRule({
        dir,
        rule: { id: 'ok', name: '好规则', stage: 'solve', pattern: 'x', flags: 'g', replacement: 'y', enabled: true },
      });

      // 改坏 1：清洗规则表的 JSON 没写完
      writeFileSync(join(dir, 'cleaning.json'), '{\n  "format": "od-cleaning-rules",\n  "version": 1,\n  "rules": [\n', 'utf8');
      const broken1 = loadRulesWorkspace({ dir });
      check('★ 坏 JSON ⇒ 载入被拒', broken1.ok === false);
      const adv = broken1.problems.find((p) => p.code === 'rules.hash-mismatch');
      check('★ 而且**点名到文件**（先报"被外部改过"）', Boolean(adv) && adv.path === 'cleaning.json', JSON.stringify(broken1.problems.map((p) => p.code)));

      // 改坏 2：把它登记进来（模拟"用户认可这次外部改动"），再看内容层是否指出位置
      const { adoptRulesFiles } = await import('../core/rules/index.mjs');
      const adopted = adoptRulesFiles({ dir, rels: ['cleaning.json'], force: true });
      check('★ 登记时内容层就拦住（坏 JSON 不进索引）', adopted.ok === false);
      const posIssue = (adopted.issues ?? []).find((i) => i.code === 'rules.cleaning.bad-json');
      check('★ 报错里带**第几行**（不是笼统"语法错误"）', /第 \d+ 行/.test(posIssue?.message ?? ''), posIssue?.message);

      // 改坏 3：规则里的正则非法 ⇒ 路径指到"哪个文件的第几条规则的哪个字段"
      const idx = readRulesIndex(dir).index;
      const badRuleSet = {
        format: 'od-cleaning-rules',
        version: 1,
        rules: [
          { id: 'ok', name: '好规则', stage: 'solve', pattern: 'x', flags: 'g', replacement: 'y', enabled: true },
          { id: 'bad', name: '坏正则', stage: 'solve', pattern: '(未闭合', flags: 'g', replacement: '', enabled: true },
        ],
      };
      const goodText = `${JSON.stringify(badRuleSet, null, 2)}\n`;
      // 让索引与内容一致（模拟"别的工具写了一份自洽但内容违法的文件"）
      writeFileSync(join(dir, 'cleaning.json'), goodText, 'utf8');
      const { sha256Hex } = await import('../core/rules/index.mjs');
      const forged = {
        ...idx.files,
        'cleaning.json': { sha256: sha256Hex(goodText), bytes: Buffer.byteLength(goodText, 'utf8') },
      };
      writeFileSync(join(dir, '.workspace.json'), JSON.stringify({ format: 'od-rules-workspace', version: 1, baseRevision: 99, files: forged }, null, 2));
      const broken3 = loadRulesWorkspace({ dir });
      check('★ 非法正则 ⇒ 载入被拒', broken3.ok === false);
      const reIssue = (broken3.problems ?? []).find((p) => p.code === 'rule.pattern.invalid');
      check('★ 位置精确到"文件:第几条.pattern"', String(reIssue?.path ?? '').startsWith('cleaning.json:rules[1].pattern'), reIssue?.path);

      // 改坏 4：Prompt 文件被外部改坏（空文件）
      const dir2 = freshDir();
      savePromptOverride({ dir: dir2, id: 'breakdown', text: '分步解析：3–6 步，t0/t1 无缝衔接。\n' });
      writeFileSync(join(dir2, 'prompts', 'breakdown.md'), '   \n', 'utf8');
      const broken4 = loadRulesWorkspace({ dir: dir2 });
      check('★ 空 Prompt ⇒ 载入被拒并点名', broken4.ok === false && (broken4.problems ?? []).some((p) => p.path === 'prompts/breakdown.md'));

      // 改坏 5：端点文件（不在规则工作区里，由端点存储自己判）
      const dir3 = freshDir();
      writeFileSync(join(dir3, 'endpoints.json'), '{"configVersion":1,"endpoints":', 'utf8');
      const broken5 = loadEndpointStore({ dir: dir3 });
      check('★ 端点文件坏 JSON ⇒ 拒绝载入并给位置', broken5.ok === false && /第 \d+ 行/.test((broken5.issues[0]?.message ?? '')), broken5.issues[0]?.message);

      // 改坏 6：端点字段不合法（http 非本机）
      const dir4 = freshDir();
      writeFileSync(
        join(dir4, 'endpoints.json'),
        JSON.stringify({ configVersion: 1, endpoints: [endpoint({ baseURL: 'http://example.com/v1' })], stageModels: {}, keys: {} }, null, 2),
        'utf8',
      );
      const broken6 = loadEndpointStore({ dir: dir4 });
      check('★ 字段不合法 ⇒ 拒绝载入，并指到具体字段', broken6.ok === false && (broken6.issues ?? []).some((i) => /endpoints\[0\]\.baseURL|baseURL/.test(i.path)), JSON.stringify((broken6.issues ?? []).map((i) => i.path)));
    }

    /* ══════════════ ④ 整机：一次真实链路跑完（覆盖 + 清洗 + 端点都在同一套里） ══════════════ */

    console.log('\n④ 整机：一次真实链路（Prompt 覆盖 + 清洗规则 + 端点配置同时生效）');
    {
      const dir = freshDir();
      savePromptOverride({ dir, id: 'solve', text: '【整机验收版】先说研究对象，再列方程（编号），结论带单位。' });
      addCleaningRule({
        dir,
        rule: { id: 'pow', name: 'pow 改写', stage: 'scene_code', pattern: 'Math\\.pow\\(([^,]+),\\s*2\\)', flags: 'g', replacement: '($1)*($1)', enabled: true },
      });
      saveEndpoints({ dir, endpoints: [endpoint()], stageModels: { solve: 'ep_main', scene_code: 'ep_main' } });
      setKey({ dir, id: 'ep_main', key: 'sk-INTEGRATION0000000000' });

      const rules = loadRulesWorkspace({ dir }).snapshot;
      const ep = loadEndpointStore({ dir });
      check('三样东西都能同时载入', rules && ep.ok === true);

      const stream = fakeStream({ scene_code: 'Draw.box([Math.pow(2, 2), 0], 1, 1);' });
      const events = await collectEvents({
        problem: { text: '一物块从斜面滑下，求底端速度。' },
        config: {
          endpoint: ep.endpoints.get('ep_main'),
          apiKey: ep.keys.ep_main,
          rulesSnapshot: rules,
        },
        streamImpl: stream,
        dryRunImpl: fakeDryRun(),
      });

      const final = events[events.length - 1];
      check('链路跑完且判定 pass', final.type === 'run_done' && final.verdict === 'pass', JSON.stringify(final).slice(0, 160));
      check('★ 模型真的收到了我的 Prompt 覆盖', stream.calls.some((c) => String(c.messages?.[0]?.content ?? '').includes('【整机验收版】')));
      check('★ 阶段标签仍在（覆盖没把阶段标识冲掉）', stream.calls.some((c) => String(c.messages?.[0]?.content ?? '').includes('【本阶段指令：解题】')));
      // ⚠ 槽位在 `dryrun_done` 事件的 `program` 里；`run_done` 只带 delivery 形状（不重复塞代码）
      const dryrunDone = events.find((e) => e.type === 'dryrun_done');
      check('★ 跑完的槽位里 pow 已被清洗', dryrunDone?.program?.slots?.drawFrame?.includes('(2)*(2)') === true, dryrunDone?.program?.slots?.drawFrame);
      check('★ 清洗只改了该改的那一处（其余代码原样）', dryrunDone?.program?.slots?.setup?.includes('const T_PHYS = 3;') === true);
    }

    /* ══════════════ ⑤ 交付口径：四类改动的目录都在、且都标了"会不会跑" ══════════════ */

    console.log('\n⑤ 目录口径：四类改动都能在**一处**看到状态');
    {
      const dir = freshDir();
      const cat = listPromptCatalog({ dir });
      check('Prompt 目录：8 项、每组都有说明', cat.items.length === 8 && cat.items.every((i) => i.group && i.groupTitle));
      check('Prompt 目录：knowledgecard / distill 已删除（没有 not-wired 分组）', cat.items.filter((i) => i.group === 'not-wired').length === 0);

      const cl = loadCleaningTable({ dir });
      check('清洗表：锁定 4 条在前、用户 0 条（第 8 期新增"剥函数外壳"）', cl.effective.length === 4 && cl.effective.every((r) => r.source === 'locked'));

      const ep = loadEndpointStore({ dir });
      check('端点：没有配置时给出明确指引（而不是空对象冒充）', ep.ok === false && ep.issues.some((i) => i.code === 'endpoints.missing'));

      check('规则工作区：索引存在（init 建好了）', existsSync(join(dir, '.workspace.json')));
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

  console.log(`\n${failures.length ? '✗' : '✓'} 第 6 期总装验收：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
