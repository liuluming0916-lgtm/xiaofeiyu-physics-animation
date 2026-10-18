#!/usr/bin/env node
/**
 * 清洗规则策略取证（第 6 期第 3 项 · §12 / §16）。
 *
 * 用户裁决：「内置最小集不可被禁用、且永远先跑。但这条口径是**数据**，日后可改；
 * 前提是**用户无法绕过**。」所以本文件分成两组互相补的断言：
 *
 *   ① **能绕的路都堵死了**（结构性）：文件层 / 运行时 / 编辑器三条入口，逐条负对照；
 *   ② **锁是数据、不是散落的 if**：策略表有版本号，且与内置实现**没有漂移**
 *      （缺实现、或新增内置没进清单，都要在门禁里红）。
 *
 * 另一组是普通 CRUD（增删改启停排序），因为"能改"和"不能绕过"是同一件事的两面。
 *
 * ⚠ 只在临时目录里操作，不碰仓库里真实的 `ai-rules/`。
 *
 * 用法：node tests/cleaning-policy-selftest.mjs
 */

import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isCliEntry } from '../tools/paths.mjs';
import { SLOT_KEY_NAMES } from '../contracts/spec/frozen-keys.mjs';
import { snapshotConfig } from '../core/orchestrator/pipeline.mjs';
import {
  BUILTIN_RULES,
  applyRegexRules,
  assertNoMarkerPatches,
  buildProgramFromText,
  detectCatastrophicPattern,
  listBuiltinRules,
} from '../core/cleaner/index.mjs';
import {
  CLEANING_POLICY,
  CLEANING_POLICY_VERSION,
  assertPolicyIntegrity,
  effectiveCleaningTable,
  isLockedRuleId,
  lockedBuiltinRules,
  lockedRuleIds,
  validateUserCleaningRules,
} from '../core/cleaner/policy.mjs';
import {
  addCleaningRule,
  cleaningTableText,
  emptyCleaningTable,
  loadCleaningTable,
  moveCleaningRule,
  removeCleaningRule,
  resetCleaningTable,
  setCleaningRuleEnabled,
  updateCleaningRule,
} from '../core/cleaner/editor.mjs';
import { commitRulesChange, initRulesWorkspace, loadRulesWorkspace, adoptRulesFiles, readRulesIndex } from '../core/rules/index.mjs';

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
  const d = mkdtempSync(join(tmpdir(), 'od-clean-'));
  created.push(d);
  initRulesWorkspace({ dir: d });
  return d;
}

const has = (list, code) => (list ?? []).some((x) => x.code === code);
const find = (list, code) => (list ?? []).find((x) => x.code === code) ?? null;

/** 一条合法的用户规则 */
function userRule(over = {}) {
  return {
    id: 'pow-rewrite',
    name: 'Math.pow 改写成乘法',
    stage: 'scene_code',
    pattern: 'Math\\.pow\\(([^,]+),\\s*2\\)',
    flags: 'g',
    replacement: '($1)*($1)',
    enabled: true,
    ...over,
  };
}

/** 直接绕过编辑器往磁盘写 cleaning.json（模拟"外部手写"） */
function writeRawTable(dir, rules) {
  const text = cleaningTableText({ format: 'od-cleaning-rules', version: 1, rules });
  const r = commitRulesChange({ dir, changes: [{ rel: 'cleaning.json', text }], force: true });
  return r;
}

/** 编排用的假端点（本文件只在 『I』 里用它建一次快照，不真发请求） */
function fakeEndpoint() {
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

function main() {
  console.log('清洗规则策略取证（第 6 期第 3 项 · §12）\n');

  try {
    /* ────────────────────────────── 『A』锁是数据 ────────────────────────────── */

    console.log('『A』锁是数据：有版本号、有理由、与实现不漂移');
    {
      check('策略有版本号', CLEANING_POLICY_VERSION === CLEANING_POLICY.version && Number.isInteger(CLEANING_POLICY_VERSION));
      check('锁定清单是冻结的（运行时改不动）', Object.isFrozen(CLEANING_POLICY.locked));
      check('锁定 4 条（第 8 期新增"剥函数外壳"）', lockedRuleIds().length === 4, lockedRuleIds().join(','));
      check('顺序固定：先剥围栏 → 再剥函数外壳 → 再删 console.log → 最后去空白', lockedRuleIds().join(',') === 'strip-code-fence,strip-function-wrapper,drop-console-log,trim-edges');
      check('每条锁定都写明了"为什么锁"（不是空理由）', CLEANING_POLICY.locked.every((l) => typeof l.guarantee === 'string' && l.guarantee.length > 20));
      check('策略表与内置实现一致（不抛）', assertPolicyIntegrity(BUILTIN_RULES) === true);
      check('lockedBuiltinRules 按策略顺序给出', lockedBuiltinRules(BUILTIN_RULES).map((r) => r.id).join(',') === lockedRuleIds().join(','));
      check('listBuiltinRules 标出了 locked', listBuiltinRules().every((r) => r.locked === true));

      // 负对照①：策略锁了、实现没有 → 抛
      let code1 = '';
      try {
        assertPolicyIntegrity(BUILTIN_RULES.filter((r) => r.id !== 'trim-edges'));
      } catch (e) {
        code1 = e.code;
      }
      check('★ 负对照：锁定的规则在实现里不见了 ⇒ 抛 cleaning.policy-broken', code1 === 'cleaning.policy-broken', code1);

      // 负对照②：实现里有、策略没锁 → 也抛（未来加规则最容易漏的一步）
      let code2 = '';
      try {
        assertPolicyIntegrity([...BUILTIN_RULES, { id: 'brand-new', name: '新加的', stage: '*', enabled: true }]);
      } catch (e) {
        code2 = e.code;
      }
      check('★ 负对照：新增内置规则没进锁定清单 ⇒ 也抛（否则它不受保护）', code2 === 'cleaning.policy-broken', code2);
    }

    /* ────────────────────────────── 『B』运行时绕不过 ────────────────────────────── */

    console.log('\n『B』运行时：锁定规则永远先跑，且**关不掉**');
    {
      const slots = {
        PROBLEM: '题',
        STEPS: 't',
        ANSWERS: 'a',
        VIEW: 'v',
        setup: '```js\nconst B = 1;\n```',
        stateAt: 'console.log(1);\nreturn { x: t };',
        drawFrame: 'Draw.dot(0,0);',
        readouts: 'return [];',
      };

      // 正常情况：围栏与 console.log 都被清掉
      const { slots: normal } = applyRegexRules(slots, []);
      check('锁定规则在正常运行时生效（剥围栏）', !normal.setup.includes('```'));
      check('锁定规则在正常运行时生效（删 console.log）', !normal.stateAt.includes('console.log'));

      /**
       * ★ 关键口径：**想关掉锁定规则这件事本身**就是"策略破损"，不是"被忽略"。
       *   如果这里悄悄跳过，那么"代码里把它关掉"就会变成一条无声的降级路径 ——
       *   正是本仓最忌的"绿着但没跑"。所以宁可抛。
       */
      let code = '';
      try {
        applyRegexRules(slots, [], { builtins: BUILTIN_RULES.map((r) => ({ ...r, enabled: false })) });
      } catch (e) {
        code = e.code;
      }
      check('★ 把锁定规则标成 enabled:false ⇒ 直接抛 cleaning.policy-broken', code === 'cleaning.policy-broken', code);

      // 缺一条锁定实现 ⇒ 运行时直接抛（不静默降级）
      let code2 = '';
      try {
        applyRegexRules(slots, [], { builtins: BUILTIN_RULES.filter((r) => r.id !== 'strip-code-fence') });
      } catch (e) {
        code2 = e.code;
      }
      check('★ 运行时缺一条锁定规则 ⇒ 抛（不允许"少跑一条还当成功"）', code2 === 'cleaning.policy-broken', code2);

      // 冒名规则：用户写一条同 id 的规则 ⇒ 运行时跳过（不被顶掉）
      const impostor = [{ id: 'strip-code-fence', name: '冒名', stage: 'scene_code', pattern: '```', flags: 'g', replacement: 'X', enabled: true }];
      const { slots: out2 } = applyRegexRules(slots, impostor);
      check('★ 冒名规则被跳过：围栏被删掉而不是被替换成 X', !out2.setup.includes('X') && !out2.setup.includes('```'), JSON.stringify(out2.setup));

      // 顺序：内置先跑 —— 用户规则想动围栏行时，围栏已经被内置删掉了
      const fenceTargeting = [{ id: 'tackle-fence', name: '想改围栏', stage: 'scene_code', pattern: '```js', flags: 'g', replacement: 'MARK', enabled: true }];
      const { slots: out3 } = applyRegexRules(slots, fenceTargeting);
      check('★ 内置先跑：用户规则想替换 ```js 时已无从下手（MARK 不出现）', !out3.setup.includes('MARK'), JSON.stringify(out3.setup));
      check('用户规则本身是有效的（换个能匹配的目标就生效）', applyRegexRules({ ...slots, setup: 'Math.pow(a,2)' }, [userRule()]).slots.setup === '(a)*(a)');
    }

    /* ────────────────────────────── 『C』文件层绕不过 ────────────────────────────── */

    console.log('\n『C』文件层：绕过编辑器直接写文件，也拦得住');
    {
      const dir = freshDir();

      // ① 撞锁定 id
      const r1 = writeRawTable(dir, [userRule({ id: 'trim-edges' })]);
      check('★ 直接写 cleaning.json 用锁定 id ⇒ 拒绝', r1.ok === false && has(r1.issues, 'cleaning.rule-id-collides-builtin'));
      const p1 = find(r1.issues, 'cleaning.rule-id-collides-builtin');
      check('★ 报错里带"为什么锁"（让人知道删不掉的是哪条保证）', /首尾空行/.test(p1?.hint ?? ''), p1?.hint);
      check('★ 拒绝时不落盘（文件仍不存在）', !loadRulesWorkspace({ dir }).cleaning);

      // ② 动标记
      const r2 = writeRawTable(dir, [userRule({ id: 'marker', pattern: '/\\* @slot:STEPS \\*/', replacement: 'x' })]);
      check('★ 直接写一条动 @slot 的规则 ⇒ 拒绝', r2.ok === false && has(r2.issues, 'cleaning.rule-touches-marker'));

      // ③ 灾难性回溯
      const r3 = writeRawTable(dir, [userRule({ id: 'evil', pattern: '(a+)+' })]);
      check('★ 直接写一条灾难性正则 ⇒ 拒绝（不是等到跑题才炸）', r3.ok === false && has(r3.issues, 'cleaning.rule-catastrophic'));

      // ④ adopt 路径（外部改完再登记）同样拦
      const abs = join(dir, 'cleaning.json');
      writeFileSync(abs, cleaningTableText({ format: 'od-cleaning-rules', version: 1, rules: [userRule({ id: 'drop-console-log' })] }), 'utf8');
      const r4 = adoptRulesFiles({ dir, rels: ['cleaning.json'], force: true });
      check('★ 登记（adopt）也拦得住锁定 id', r4.ok === false && has(r4.issues, 'cleaning.rule-id-collides-builtin'));

      // ⑤ 策略校验函数独立可用（界面/CLI 也可直接用）
      check('validateUserCleaningRules 对合法规则不报错', validateUserCleaningRules([userRule()], { builtinRules: BUILTIN_RULES }).length === 0);
      check('validateUserCleaningRules 对锁定 id 报错', has(validateUserCleaningRules([userRule({ id: 'strip-code-fence' })], { builtinRules: BUILTIN_RULES }), 'cleaning.rule-id-collides-builtin'));
    }

    /* ────────────────────────────── 『D』编辑器 CRUD ────────────────────────────── */

    console.log('\n『D』编辑器：能加、能改、能停、能排序、能删、能恢复默认');
    {
      const dir = freshDir();
      const a = addCleaningRule({ dir, rule: userRule({ id: 'r1', name: '一' }) });
      check('加第一条成功', a.ok === true, JSON.stringify(a.issues));
      check('文件被创建', loadRulesWorkspace({ dir }).cleaning?.rules?.length === 1);
      check('生效顺序里内置 4 条在前、用户规则第 5', (() => {
        const t = loadCleaningTable({ dir });
        return t.effective.length === 5 && t.effective[0].source === 'locked' && t.effective[4].id === 'r1';
      })());

      addCleaningRule({ dir, rule: userRule({ id: 'r2', name: '二' }) });
      addCleaningRule({ dir, rule: userRule({ id: 'r3', name: '三' }) });
      check('三条用户规则', loadCleaningTable({ dir }).rules.map((r) => r.id).join(',') === 'r1,r2,r3');

      const mv = moveCleaningRule({ dir, id: 'r1', toIndex: 2 });
      check('排序成功（r1 移到末尾）', mv.ok === true && loadCleaningTable({ dir }).rules.map((r) => r.id).join(',') === 'r2,r3,r1', JSON.stringify(mv.issues));
      check('排序越界被拒', moveCleaningRule({ dir, id: 'r2', toIndex: 9 }).ok === false);

      const up = updateCleaningRule({ dir, id: 'r2', patch: { name: '二（改）' } });
      check('改名字成功', up.ok === true && loadCleaningTable({ dir }).rules.find((r) => r.id === 'r2').name === '二（改）');
      check('改 id 被拒（id 是引用键）', updateCleaningRule({ dir, id: 'r2', patch: { id: 'r2x' } }).ok === false);

      const off = setCleaningRuleEnabled({ dir, id: 'r3', enabled: false });
      check('停用成功', off.ok === true && loadCleaningTable({ dir }).rules.find((r) => r.id === 'r3').enabled === false);
      check('停用的规则在生效表里标为停用（但仍在表里）', loadCleaningTable({ dir }).effective.find((r) => r.id === 'r3').enabled === false);
      check('enabled 非布尔被拒', setCleaningRuleEnabled({ dir, id: 'r3', enabled: 'yes' }).ok === false);

      const rm = removeCleaningRule({ dir, id: 'r2' });
      check('删除成功', rm.ok === true && !loadCleaningTable({ dir }).rules.some((r) => r.id === 'r2'));
      check('删不存在的 id 被拒', removeCleaningRule({ dir, id: 'nope' }).ok === false);
      check('加重复 id 被拒', addCleaningRule({ dir, rule: userRule({ id: 'r1' }) }).ok === false);

      const before = loadCleaningTable({ dir });
      const reset = resetCleaningTable({ dir, expectedHash: before.expectedHash });
      check('恢复默认成功（删文件）', reset.ok === true);
      check('★ 恢复默认后没有用户规则，但内置 4 条仍生效', (() => {
        const t = loadCleaningTable({ dir });
        return t.rules.length === 0 && t.effective.length === 4;
      })());
    }

    /* ────────────────────────────── 『E』锁定 id 的所有入口 ────────────────────────────── */

    console.log('\n『E』对锁定规则的每一个编辑入口都要拒（不是只拒一条路）');
    {
      const dir = freshDir();
      addCleaningRule({ dir, rule: userRule({ id: 'mine' }) });

      const id = 'trim-edges';
      const attempts = {
        'add（加一条同 id）': addCleaningRule({ dir, rule: userRule({ id }) }),
        'update（改它）': updateCleaningRule({ dir, id, patch: { name: 'x' } }),
        'remove（删它）': removeCleaningRule({ dir, id }),
        'setEnabled(false)（关它）': setCleaningRuleEnabled({ dir, id, enabled: false }),
        'move（调它顺序）': moveCleaningRule({ dir, id, toIndex: 0 }),
      };
      for (const [label, r] of Object.entries(attempts)) {
        check(`${label} ⇒ 拒绝且是 cleaning.rule-locked`, r.ok === false && has(r.issues, 'cleaning.rule-locked'), JSON.stringify(r.issues?.[0]?.code));
      }
      check('每次拒绝都带"为什么锁"的解释', /首尾空行|围栏|console/.test(find(attempts['remove（删它）'].issues, 'cleaning.rule-locked')?.hint ?? ''));
      check('拒绝之后用户表没被改动', loadCleaningTable({ dir }).rules.length === 1);
    }

    /* ────────────────────────────── 『F』冲突与整批失败 ────────────────────────────── */

    console.log('\n『F』冲突与整批失败（复用 §16 的工作区语义）');
    {
      const dir = freshDir();
      addCleaningRule({ dir, rule: userRule({ id: 'r1' }) });
      const stale = addCleaningRule({ dir, rule: userRule({ id: 'r2' }), expectedHash: null });
      check('用过期 expectedHash 保存 ⇒ rules.conflict', stale.ok === false && has(stale.issues, 'rules.conflict'));
      check('冲突时表没变（还是 1 条）', loadCleaningTable({ dir }).rules.length === 1);

      // 索引里表被外部改过 ⇒ 编辑入口在**载入**这一步就拒绝（比"保存时才发现"更早，也更准）
      const abs = join(dir, 'cleaning.json');
      writeFileSync(abs, cleaningTableText({ format: 'od-cleaning-rules', version: 1, rules: [userRule({ id: 'external' })] }), 'utf8');
      const stale2 = addCleaningRule({ dir, rule: userRule({ id: 'r3' }) });
      check(
        '★ 表被外部改过 ⇒ 拒绝编辑（rules.hash-mismatch，载入这一步就拦）',
        stale2.ok === false && has(stale2.issues, 'rules.hash-mismatch'),
        JSON.stringify(stale2.issues?.[0]?.code),
      );
      check('拒绝之后磁盘上还是外部那一版（没被"顺手覆盖"）', readFileSync(abs, 'utf8').includes('external'));
    }

    /* ────────────────────────────── 『G』与契约层不重复、但互补 ────────────────────────────── */

    console.log('\n『G』契约层管"字段合不合法"，策略层管"这条规则允不允许存在"');
    {
      const dir = freshDir();
      // 契约层拒：stage 枚举错
      const badStage = writeRawTable(dir, [userRule({ id: 'x1', stage: 'dry_run' })]);
      check('契约层拒未知 stage（策略层不管这个）', badStage.ok === false && has(badStage.issues, 'rule.stage.unknown'));

      // 策略层拒：字段完全合法，但撞锁定 id
      const collide = writeRawTable(dir, [userRule({ id: 'drop-console-log' })]);
      check('策略层拒"字段合法但撞锁定 id"（契约层看不出这个）', collide.ok === false && has(collide.issues, 'cleaning.rule-id-collides-builtin'));
      check('两种问题的路径都带文件名前缀', String(find(collide.issues, 'cleaning.rule-id-collides-builtin')?.path ?? '').startsWith('cleaning.json:'), find(collide.issues, 'cleaning.rule-id-collides-builtin')?.path);
    }

    /* ────────────────────────────── 『H』纯函数小工具 ────────────────────────────── */

    console.log('\n『H』纯函数：顺序表、锁定判定、灾难性检测仍可用');
    {
      check('isLockedRuleId 认锁定、不认用户 id', isLockedRuleId('trim-edges') === true && isLockedRuleId('mine') === false);
      const rows = effectiveCleaningTable([userRule({ id: 'u1' })], BUILTIN_RULES);
      check('顺序表：locked 段在前、order 从 1 起连续', rows.slice(0, 4).every((r) => r.source === 'locked') && rows.map((r) => r.order).join(',') === '1,2,3,4,5');
      check('detectCatastrophicPattern 仍从 cleaner/index.mjs 导出（老的 import 路径没断）', detectCatastrophicPattern('(a+)+').safe === false);
      let markerCode = '';
      try {
        assertNoMarkerPatches([{ id: 'm', pattern: '/\\* @end \\*/', replacement: '' }]);
      } catch (e) {
        markerCode = e.code;
      }
      check('assertNoMarkerPatches 仍抛 rule.touches-marker', markerCode === 'rule.touches-marker', markerCode);
      check('空表与不存在等价（都是"只有内置"）', emptyCleaningTable().rules.length === 0);
      check('写入的 JSON 能被读回（格式往返稳定）', (() => {
        const dir = freshDir();
        addCleaningRule({ dir, rule: userRule({ id: 'rt' }) });
        const once = readFileSync(join(dir, 'cleaning.json'), 'utf8');
        const rev = readRulesIndex(dir).index.files['cleaning.json'].sha256;
        return once.endsWith('}\n') && /^[0-9a-f]{64}$/.test(rev);
      })());
    }
    /* ────────────────────────────── 『I』真的接上了：规则从文件到一次真实清洗 ────────────────────────────── */

    console.log('\n『I』接线：`cleaning.json` → 每题快照 → 真实清洗');
    {
      const dir = freshDir();
      addCleaningRule({ dir, rule: userRule({ id: 'pow', pattern: 'Math\\.pow\\(([^,]+),\\s*2\\)', replacement: '($1)*($1)' }) });

      const rulesSnapshot = loadRulesWorkspace({ dir }).snapshot;
      check('快照里带着用户清洗规则', rulesSnapshot.cleaningRules?.length === 1 && rulesSnapshot.cleaningRules[0].id === 'pow');

      const snap = snapshotConfig({ endpoint: fakeEndpoint(), apiKey: 'sk-test', rulesSnapshot });
      check('每题快照从规则快照里取清洗规则（而不是调用方手里的数组）', snap.regexRules.length === 1 && snap.regexRules[0].id === 'pow');
      check('快照里的规则是冻结的', Object.isFrozen(snap.regexRules));

      // 真跑一次"切分 + 清洗 + 组装"，看用户规则是否真的落到槽位里
      const programText = SLOT_KEY_NAMES.map((k) => {
        const body = {
          PROBLEM: '题',
          STEPS: 'title: s\ntex: x\nt0: 0\nt1: 1',
          ANSWERS: 'symbol: a\nvalue: 1\nunit: m\ntol: 0.01\nat_t: 1\nstep: 1',
          VIEW: 'SIM.duration = Math.pow(2, 2);',
          setup: 'const g = 10;',
          stateAt: 'return { x: t };',
          drawFrame: 'Draw.dot(0, 0);',
          readouts: 'return [];',
        }[k];
        return `/* @slot:${k} */\n${body}\n/* @end */`;
      }).join('\n');

      const built = buildProgramFromText(programText, { regexRules: snap.regexRules });
      check('★ 用户规则真的生效（Math.pow(2, 2) → (2)*(2)）', built.program.slots.VIEW.includes('(2)*(2)'), built.program.slots.VIEW);
      check('应用的规则里有它', [...(built.layout?.appliedRules ?? [])].some((a) => a.id === 'pow'), JSON.stringify(built.layout?.appliedRules));

      // 对照：不传规则快照 ⇒ 用户规则不生效（行为与第 6 期之前一致）
      const built2 = buildProgramFromText(programText, { regexRules: [] });
      check('★ 对照：不传规则快照 ⇒ 用户规则不生效', built2.program.slots.VIEW.includes('Math.pow(2, 2)'));

      // 内置锁定规则在任何一次清洗里都在（不是"只有用户规则"）
      const fenced = programText.replace('const g = 10;', '```js\nconst g = 10;\n```');
      const built3 = buildProgramFromText(fenced, { regexRules: [] });
      check('★ 内置锁定规则始终在（围栏被剥）', !built3.program.slots.setup.includes('```'), JSON.stringify(built3.program.slots.setup));
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

  console.log(`\n${failures.length ? '✗' : '✓'} 清洗规则策略取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
