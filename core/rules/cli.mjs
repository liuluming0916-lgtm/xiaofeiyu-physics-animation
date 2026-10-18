#!/usr/bin/env node
/**
 * 规则工作区命令行（给人用的，**不是**门禁步骤）。
 *
 *   node core/rules/cli.mjs status         # 看一眼：工作区在哪、有几个文件、有没有问题
 *   node core/rules/cli.mjs check          # 体检：有问题就用红字逐条指出**哪个文件、哪个位置**
 *   node core/rules/cli.mjs init           # 建立工作区（只写 .workspace.json + prompts/ 目录）
 *   node core/rules/cli.mjs adopt          # 把磁盘上的外部改动"认下来"（登记进索引）
 *   node core/rules/cli.mjs prompts        # 列出 9 份 Prompt 各自的状态（内置 / 已覆盖 / 内置变过）
 *   node core/rules/cli.mjs prompts solve  # 看某一份：内置正文、我的覆盖、内置变更的差异
 *   node core/rules/cli.mjs restore        # 列出哪些文件有备份（保存时自动留，滚动 5 份）
 *   node core/rules/cli.mjs restore prompts/solve.md --to 2   # 恢复到第 2 份（恢复本身也可撤销）
 *
 * 为什么要有个 CLI：用户是代码小白，设置页的入口排在后面，所以
 * "怎么确认我的改动没把工作区弄坏"必须有一条**一条命令**的路。
 * 退出码：0 = 通过；1 = 有问题（可直接被别的脚本判断）。
 */

import { join } from 'node:path';

import { formatIssues } from '../../contracts/validate.mjs';
import { isCliEntry } from '../../tools/paths.mjs';
import {
  RULES_ROOT,
  WORKSPACE_FILE,
  adoptRulesFiles,
  initRulesWorkspace,
  loadRulesWorkspace,
  readRulesIndex,
} from './index.mjs';
import { PROMPT_SECTORS, builtinPromptText, listPromptCatalog, openPrompt, savePromptOverride } from '../prompts/editor.mjs';
import { PROMPT_STATUS } from '../prompts/overlay.mjs';
import {
  cleaningTableText,
  emptyCleaningTable,
  loadCleaningTable,
  removeCleaningRule,
  resetCleaningTable,
  setCleaningRuleEnabled,
  addCleaningRule,
} from '../cleaner/editor.mjs';
import { commitRulesChange } from './workspace.mjs';
import { listAllBackups, listBackups, restoreBackup } from './backup.mjs';
import { classifyRelPath } from './kinds.mjs';
import { CLEANING_POLICY_VERSION } from '../cleaner/policy.mjs';
import {
  ENDPOINTS_FILE,
  KEYS_FILE,
  clearKey,
  exportEndpointsText,
  formatConnectionResult,
  importEndpoints,
  loadEndpointStore,
  loadKeys,
  redact,
  removeEndpoint,
  saveEndpoints,
  setKey,
  setStageModel,
  testConnection,
} from '../gateway/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const BAR = '─'.repeat(64);

/** 终端里不显示 Markdown 记号（分组说明在界面里会用加粗，CLI 里要去掉） */
const plain = (s) => String(s ?? '').replace(/\*\*/g, '');

function printHeader(title) {
  console.log(`\n${BAR}\n${title}\n${BAR}`);
}

/** 把工作区相对路径变成人看得懂的说明 */
function describe(rel) {
  if (rel === 'cleaning.json') return '清洗规则表（§12 用户附加正则）';
  const m = /^prompts\/(.+)\.md$/.exec(rel);
  return m ? `Prompt：${m[1]}` : rel;
}

/** 打印失败原因（逐条，带文件与位置） */
function printProblems(problems) {
  console.log(`\n✗ 发现 ${problems.length} 个问题：`);
  console.log(formatIssues(problems));
  console.log('\n→ 上面任何一条没解决，这份配置/规则就不会被采用（整批生效或整批失败）。');
}

function cmdStatus() {
  printHeader('规则工作区 · 状态');
  console.log(`目录：${RULES_ROOT}`);

  const idx = readRulesIndex(RULES_ROOT);
  if (!idx.ok) {
    console.log('索引：不存在或不可用');
    printProblems(idx.problems);
    return 1;
  }
  const loaded = loadRulesWorkspace();
  console.log(`索引：${WORKSPACE_FILE} · revision ${idx.index.baseRevision} · 登记 ${Object.keys(idx.index.files).length} 个文件`);

  if (!loaded.ok) {
    printProblems(loaded.problems);
    return 1;
  }

  const rels = Object.keys(loaded.files).sort();
  if (rels.length === 0) {
    console.log('\n（工作区是空的 —— 这完全正常：缺文件 = 用内置默认。\n' +
      '  只有你亲手改了某一条，那一条才会出现在这里。）');
    return 0;
  }
  console.log('\n已登记的文件：');
  for (const rel of rels) {
    const f = loaded.files[rel];
    console.log(`  · ${rel.padEnd(28)} ${String(f.bytes).padStart(7)} 字节  sha256 ${f.sha256.slice(0, 12)}…  ${describe(rel)}`);
  }
  console.log(`\n✓ 工作区可载入（${rels.length} 个文件，无一问题）`);
  return 0;
}

function cmdCheck() {
  printHeader('规则工作区 · 体检');
  const loaded = loadRulesWorkspace();
  if (!loaded.ok) {
    printProblems(loaded.problems);
    return 1;
  }
  console.log(`✓ 通过：revision ${loaded.revision} · ${Object.keys(loaded.files).length} 个文件全部与索引一致 · 内容全部合法`);
  const ids = Object.keys(loaded.prompts);
  if (ids.length) console.log(`  覆盖了内置的 Prompt：${ids.join(' / ')}（其余仍用内置）`);
  if (loaded.cleaning) console.log(`  清洗规则：${loaded.cleaning.rules.length} 条（另有内置最小集始终生效）`);
  return 0;
}

function cmdInit() {
  printHeader('规则工作区 · 建立');
  const r = initRulesWorkspace();
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(r.created ? `✓ 已建立：${join(RULES_ROOT, WORKSPACE_FILE)}（revision 0）` : `✓ 已存在，未改动（revision ${r.revision}）`);
  console.log('  说明：不会替你抄一份内置 Prompt —— 缺文件就等于用内置，只有你真改过才产生覆盖副本。');
  return 0;
}

function cmdAdopt() {
  printHeader('规则工作区 · 登记外部改动');
  const loaded = loadRulesWorkspace();
  if (loaded.ok) {
    console.log('✓ 没有需要登记的东西（工作区已经干净）');
    return 0;
  }

  // 只把"该登记"的两类收下：未登记 / 哈希不符。其余问题（非法正则、超体积、坏 JSON）**不能**靠登记绕过。
  const adoptable = loaded.problems
    .filter((p) => p.code === 'rules.untracked' || p.code === 'rules.hash-mismatch')
    .map((p) => p.path);

  if (!adoptable.length) {
    printProblems(loaded.problems);
    console.log('\n→ 上面这些问题**不能**靠"登记"绕过（登记只表示"这次外部改动我认"，不表示"内容可以不合规"）。');
    return 1;
  }

  const r = adoptRulesFiles({ rels: adoptable });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(`✓ 已登记 ${adoptable.length} 个文件 → revision ${r.revision}`);
  for (const rel of adoptable) console.log(`  · ${rel}`);

  const after = loadRulesWorkspace();
  if (!after.ok) {
    printProblems(after.problems);
    return 1;
  }
  console.log('  现在工作区是干净的。');
  return 0;
}

/* ────────────────────────────── Prompt 编辑器（第 6 期第 2 项） ────────────────────────────── */

const STATUS_BADGE = {
  [PROMPT_STATUS.BUILTIN]: '内置',
  [PROMPT_STATUS.OK]: '已覆盖',
  [PROMPT_STATUS.STALE]: '⚠ 内置变过',
  [PROMPT_STATUS.UNKNOWN_BASE]: '⚠ 基线未知',
};

/** 正文按行缩进打印（保留空行的可读性） */
function printBlock(title, text, maxChars = 4000) {
  console.log(`\n【${title}】`);
  const body = String(text ?? '');
  const cut = body.length > maxChars ? `${body.slice(0, maxChars)}\n…（太长，已截断，共 ${body.length} 字符）` : body;
  for (const line of cut.split('\n')) console.log(`    ${line}`);
}

function cmdPrompts(args) {
  const id = args[0];

  if (id === 'export') return cmdPromptExport(args[1]);

  if (!id) {
    printHeader('Prompt 清单（第 6 期第 2 项）');
    const cat = listPromptCatalog({ dir: RULES_ROOT });
    if (!cat.ok) {
      printProblems(cat.problems);
      return 1;
    }

    for (const [key, sector] of Object.entries(PROMPT_SECTORS)) {
      const items = cat.items.filter((i) => i.group === key);
      if (!items.length) continue;
      console.log(`\n▍${sector.title}  —— ${plain(sector.hint)}`);
      for (const it of items) {
        const badge = it.override ? STATUS_BADGE[it.override.status] : STATUS_BADGE[PROMPT_STATUS.BUILTIN];
        const risk = it.risk === 'high' ? '  ★高风险（改坏会静默失效）' : '';
        console.log(`    ${it.id.padEnd(17)} ${it.label.padEnd(8)} ${badge}${risk}`);
      }
    }

    if (cat.unknownFiles.length) {
      console.log('\n▍工作区里有、但程序里没有这个 Prompt：');
      for (const u of cat.unknownFiles) console.log(`    ${u.rel}  —— 不会被任何阶段用到`);
      console.log('    → 要么改名，要么删掉（`node core/rules/cli.mjs prompts <id>` 之外的文件都不生效）');
    }

    console.log('\n看某一份的正文与状态：node core/rules/cli.mjs prompts solve');
    console.log('最危险的一份是 read_problem（判定词表靠它消费）——改它之前先看 『高风险』 那一行。');
    return 0;
  }

  printHeader(`Prompt：${id}`);
  const o = openPrompt({ dir: RULES_ROOT, id });
  if (!o.ok) {
    printProblems(o.issues);
    return 1;
  }

  const sector = o.sector ? PROMPT_SECTORS[o.sector] : null;
  console.log(`名称：${o.label}`);
  if (sector) console.log(`分组：${sector.title}  —— ${plain(sector.hint)}`);
  console.log(`状态：${STATUS_BADGE[o.status]}`);

  printBlock('内置正文（程序自带的那份）', o.builtinText);

  if (o.overrideText) {
    printBlock('我的覆盖（实际会发出去的那份）', o.overrideText);
    if (o.status === PROMPT_STATUS.STALE) {
      console.log('\n【内置变了：新旧内置的差异（+ 是内置新加的，- 是内置删掉的）】');
      for (const line of o.diff?.lines ?? []) {
        if (line.type === 'same') continue;
        console.log(`    ${line.type === 'add' ? '+' : '-'} ${line.text}`);
      }
      console.log(
        '\n  → 你这份覆盖基于旧版内置。可以：① 手动把上面 `+` 的行抄进你的文件；' +
          '\n     ② 决定"就以现在这版为基线"（rebase，正文不动）；③ 恢复默认。',
      );
      if (o.baseSavedAt) console.log(`    基线保存时间：${o.baseSavedAt}`);
    }
    if (o.status === PROMPT_STATUS.UNKNOWN_BASE) {
      console.log('\n  → 这份覆盖是在界面外改过、再"登记"进来的，所以不知道它基于哪一版内置。');
      console.log('     编辑器里看到的是它现在的样子；要恢复"基于当前内置"的比对，请 rebase。');
    }
  } else {
    console.log('\n（没有覆盖副本 —— 用的是内置。想改就用编辑器保存一份，删掉即恢复默认。）');
  }

  if (o.requirements?.errors?.length) {
    console.log('\n【这份正文里不能删的段落】');
    for (const r of o.requirements.errors) console.log(`    · ${r.token} —— ${r.why}`);
  }
  if (o.requirements?.warnings?.length) {
    console.log('\n【建议保留（删了只警告、不拦）】');
    for (const r of o.requirements.warnings) console.log(`    · ${r.token} —— ${r.why}`);
  }
  return 0;
}

/**
 * `prompts export <id>` —— 把内置正文**落成一份覆盖副本**（内容一字不改）。
 *
 * 补的是 C 方案的流程缺口：用户没有界面，只能"用手改文件"，那就得先有文件。
 * 落一份与内置同文的副本 = 开改的起点，而且它**当场就把基线记好了**（basedOn = 当前内置），
 * 之后无论用记事本怎么改，只要走 `adopt` 登记，血统都还在 —— 内置升级时照样会提醒。
 */
function cmdPromptExport(id) {
  if (!id) {
    console.log('用法：node core/rules/cli.mjs prompts export <id>   # 例如 solve / read_problem');
    return 2;
  }
  const builtin = builtinPromptText(id);
  if (builtin === null) {
    console.log(`✗ 未知的 Prompt id "${id}"`);
    return 1;
  }

  const o = openPrompt({ dir: RULES_ROOT, id });
  if (o.ok && o.overrideText) {
    console.log(`\n已经有覆盖副本了：${o.rel}`);
    console.log('  直接改那个文件就行（改完运行 node core/rules/cli.mjs adopt）。不必再导出一次，否则会覆盖你现在的正文。');
    return 1;
  }

  printHeader(`导出内置正文：${id}`);
  const r = savePromptOverride({ dir: RULES_ROOT, id, text: builtin });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(`✓ 已写出：${RULES_ROOT}\\prompts\\${id}.md  （内容与内置**一字不差**，所以行为不变）`);
  console.log(`  同时已登记基线（revision ${r.revision}）—— 以后内置升级，程序会告诉你"内置变过"并给出差异。`);

  console.log('\n接下来：');
  console.log(`  1) 用记事本/VS Code 打开 ai-rules\\prompts\\${id}.md 改字；`);
  console.log('  2) node core/rules/cli.mjs adopt     ← 收下这次改动（会保留基线）');
  console.log('  3) node core/rules/cli.mjs prompts ' + id + '   ← 看状态与正文');
  console.log('  4) node core/rules/cli.mjs check     ← 确认工作区是绿的');
  if (id === 'read_problem') {
    console.log('\n  ⚠ 这一份是高风险：里面的【考点】【动画元件】两段不能删（删了保存不上，见下面那两行）。');
  }
  return 0;
}

/* ────────────────────────────── 清洗规则表（第 6 期第 3 项） ────────────────────────────── */

function cmdCleaning(args) {
  const sub = (args[0] ?? 'list').toLowerCase();

  if (sub === 'list' || sub === 'status') return cleaningList();
  if (sub === 'init') return cleaningInit();
  if (sub === 'reset') return cleaningReset();
  if (sub === 'enable' || sub === 'disable') return cleaningToggle(args[1], sub === 'enable');
  if (sub === 'rm' || sub === 'remove') return cleaningRemove(args[1]);
  if (sub === 'add') return cleaningAdd(args.slice(1));

  console.log('用法：node core/rules/cli.mjs cleaning [list|init|reset|enable <id>|disable <id>|rm <id>|add --file <json>]');
  return 2;
}

function cleaningList() {
  printHeader('清洗规则：生效顺序（§12）');
  const t = loadCleaningTable({ dir: RULES_ROOT });
  if (!t.ok) {
    printProblems(t.issues);
    return 1;
  }

  console.log(`策略：v${CLEANING_POLICY_VERSION} · ${t.locked.length} 条锁定（` + t.locked.map((l) => l.id).join(' / ') + '）');
  console.log('顺序 = 从上到下执行；带「锁定」的不可禁用、不可改、不可删（清单在代码里，用户目录写不到）。\n');

  for (const row of t.effective) {
    const tag = row.source === 'locked' ? '【锁定】' : row.enabled ? '【启用】' : '【停用】';
    console.log(`  ${String(row.order).padStart(2)}. ${tag} ${row.id.padEnd(24)} stage=${String(row.stage).padEnd(12)} ${row.name}`);
    if (row.source === 'locked' && row.note) console.log(`       └ 因为它兜住的是：${row.note}`);
  }

  if (!t.rules.length) {
    console.log('\n（你的规则表是空的 —— 只有内置这 3 条在生效。）');
    console.log('  想加规则：node core/rules/cli.mjs cleaning add --file 你的规则.json');
    console.log('  或直接手改 ai-rules\\cleaning.json，再 node core/rules/cli.mjs adopt');
  } else {
    console.log(`\n你的规则 ${t.rules.length} 条（上限 300），当前表指纹 ${String(t.expectedHash).slice(0, 12)}…`);
  }
  return 0;
}

function cleaningInit() {
  printHeader('清洗规则：建立空表');
  const t = loadCleaningTable({ dir: RULES_ROOT });
  if (!t.ok) {
    printProblems(t.issues);
    return 1;
  }
  if (t.exists) {
    console.log('已经有 ai-rules\\cleaning.json 了，未改动。');
    return 0;
  }
  const r = commitRulesChange({ dir: RULES_ROOT, changes: [{ rel: 'cleaning.json', text: cleaningTableText(emptyCleaningTable()) }] });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(`✓ 已写出 ai-rules\\cleaning.json（空表，revision ${r.revision}）`);
  console.log('  空表 = 只有内置 3 条在生效。往里加规则请用 `cleaning add --file`，或手改后 `adopt`。');
  return 0;
}

function cleaningReset() {
  printHeader('清洗规则：恢复默认（删掉用户表）');
  const r = resetCleaningTable({ dir: RULES_ROOT });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(`✓ 已删除 ai-rules\\cleaning.json（revision ${r.revision}）。现在只有内置 3 条锁定规则生效。`);
  return 0;
}

function cleaningToggle(id, enabled) {
  if (!id) {
    console.log('用法：node core/rules/cli.mjs cleaning ' + (enabled ? 'enable' : 'disable') + ' <id>');
    return 2;
  }
  const r = setCleaningRuleEnabled({ dir: RULES_ROOT, id, enabled });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(`✓ 已${enabled ? '启用' : '停用'} "${id}"（revision ${r.revision}）`);
  return 0;
}

function cleaningRemove(id) {
  if (!id) {
    console.log('用法：node core/rules/cli.mjs cleaning rm <id>');
    return 2;
  }
  const r = removeCleaningRule({ dir: RULES_ROOT, id });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(`✓ 已删除 "${id}"（revision ${r.revision}）`);
  return 0;
}

function cleaningAdd(args) {
  const fileAt = args.indexOf('--file');
  const file = fileAt >= 0 ? args[fileAt + 1] : null;
  if (!file) {
    console.log('用法：node core/rules/cli.mjs cleaning add --file 规则.json');
    console.log('  文件内容可以是**一条**规则的 JSON，也可以是 { "rules": [ … ] }');
    console.log('  字段：{ id, name, stage, pattern, flags, replacement, enabled }');
    return 2;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(`✗ 读不到或不是合法 JSON：${file}\n  ${e.message}`);
    return 1;
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rules) ? parsed.rules : [parsed];

  let revision = null;
  for (const rule of list) {
    const r = addCleaningRule({ dir: RULES_ROOT, rule });
    if (!r.ok) {
      printProblems(r.issues);
      return 1;
    }
    for (const w of r.warnings ?? []) console.log(`  ⚠ [${w.code}] ${w.message}`);
    revision = r.revision;
  }
  console.log(`✓ 已加入 ${list.length} 条规则（revision ${revision}）`);
  console.log('  确认顺序：node core/rules/cli.mjs cleaning list');
  return 0;
}

/* ────────────────────────────── 端点配置（第 6 期第 4 项） ────────────────────────────── */

function cmdEndpoints(args) {
  const sub = (args[0] ?? 'list').toLowerCase();
  if (sub === 'list' || sub === 'status') return endpointsList();
  if (sub === 'init') return endpointsInit();
  if (sub === 'add') return endpointsAdd(args.slice(1));
  if (sub === 'rm' || sub === 'remove') return endpointsRemove(args[1]);
  if (sub === 'stage') return endpointsStage(args[1], args[2]);
  if (sub === 'key') return endpointsSetKey(args.slice(1));
  if (sub === 'key-del') return endpointsKeyDel(args[1]);
  if (sub === 'test') return endpointsTest(args[1]);
  if (sub === 'export') return endpointsExport(args.slice(1));
  if (sub === 'import') return endpointsImport(args.slice(1));

  console.log('用法：node core/rules/cli.mjs endpoints [list|init|add --file <json>|rm <id>|stage <stage> <id|->|key <id> --file <txt>|key-del <id>|test <id>|export --out <json>|import --file <json>]');
  return 2;
}

/** 从 `--xx value` 里取参数 */
function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function endpointsList() {
  printHeader('端点配置（§11.1 / §11.2）');
  const st = loadEndpointStore();
  if (!st.ok) {
    printProblems(st.issues);
    return 1;
  }
  for (const w of st.warnings ?? []) console.log(`  ⚠ [${w.code}] ${w.message}`);

  console.log(`文件：${ENDPOINTS_FILE}`);
  console.log(`Key ：${KEYS_FILE}${loadKeys().exists ? '' : '（还没有这个文件）'}\n`);

  if (!st.config.endpoints.length) console.log('（还没有端点。加一个：endpoints add --file 端点.json）');
  for (const ep of st.config.endpoints) {
    const usedBy = Object.entries(st.stageModels).filter(([, v]) => v === ep.id).map(([k]) => k);
    const key = st.keys[ep.id];
    console.log(`  · ${ep.id.padEnd(20)} ${ep.displayName}`);
    console.log(`      ${ep.baseURL}  ·  模型 ${ep.defaultModel}${ep.supportsVision ? '  ·  支持图片' : ''}`);
    console.log(`      Key：${key ? redact(key) : '（未设置）'}  ·  被这些阶段使用：${usedBy.length ? usedBy.join(' / ') : '（无）'}`);
  }

  const unassigned = Object.keys(st.stageModels).filter((s) => st.stageModels[s] === null);
  console.log(`\n未指定端点的阶段：${unassigned.length ? unassigned.join(' / ') : '（无）'}`);
  console.log('（未指定 + 只有一个端点 ⇒ 自动用它；多个端点时必须在 stage 里指定，程序不猜）');
  return 0;
}

function endpointsInit() {
  printHeader('端点配置：建立空配置');
  if (loadEndpointStore().ok) {
    console.log('已经有 ai-rules\\endpoints.json 了，未改动。');
    return 0;
  }
  const r = saveEndpoints({ endpoints: [], stageModels: {} });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log('✓ 已建立空配置（endpoints.json，keys 恒为空对象）。');
  console.log('  下一步：endpoints add --file 端点.json → endpoints key <id> --file key.txt → endpoints test <id>');
  return 0;
}

function endpointsAdd(args) {
  const file = flag(args, '--file');
  if (!file) {
    console.log('用法：node core/rules/cli.mjs endpoints add --file 端点.json');
    console.log('  文件可以是一个端点对象，也可以是 { "endpoints": [ … ] }');
    return 2;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(`✗ 读不到或不是合法 JSON：${file}\n  ${e.message}`);
    return 1;
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.endpoints) ? parsed.endpoints : [parsed];

  const st = loadEndpointStore();
  const doc = st.ok ? { endpoints: [...st.config.endpoints], stageModels: st.config.stageModels } : { endpoints: [], stageModels: {} };
  for (const ep of list) {
    const i = doc.endpoints.findIndex((x) => x?.id === ep?.id);
    if (i >= 0) doc.endpoints[i] = ep;
    else doc.endpoints.push(ep);
  }
  const r = saveEndpoints({ endpoints: doc.endpoints, stageModels: doc.stageModels, expectedHash: st.ok ? st.hashes.endpoints : null });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(`✓ 已写入/更新 ${list.length} 个端点（${list.map((e) => e?.id).join(' / ')}）`);
  for (const w of r.warnings ?? []) console.log(`  ⚠ ${w.message}`);
  return 0;
}

function endpointsRemove(id) {
  if (!id) {
    console.log('用法：node core/rules/cli.mjs endpoints rm <id>');
    return 2;
  }
  const r = removeEndpoint({ id });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(`✓ 已删除端点 "${id}"`);
  for (const w of r.warnings ?? []) console.log(`  ⚠ ${w.message}`);
  return 0;
}

function endpointsStage(stage, endpointId) {
  if (!stage || endpointId === undefined) {
    console.log('用法：node core/rules/cli.mjs endpoints stage <阶段> <端点id|->     （- 表示置空）');
    return 2;
  }
  const id = endpointId === '-' ? null : endpointId;
  const r = setStageModel({ stage, endpointId: id });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(`✓ 阶段 ${stage} → ${id ?? '（未指定）'}`);
  return 0;
}

function endpointsSetKey(args) {
  const id = args[0];
  const file = flag(args, '--file');
  if (!id || !file) {
    console.log('用法：node core/rules/cli.mjs endpoints key <id> --file key.txt');
    console.log('  用文件而不是命令行，是为了别把 Key 留在命令历史里。');
    return 2;
  }
  let key;
  try {
    key = readFileSync(file, 'utf8').trim();
  } catch (e) {
    console.log(`✗ 读不到 Key 文件：${file}\n  ${e.message}`);
    return 1;
  }
  const r = setKey({ id, key });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(`✓ 已设置 "${id}" 的 Key：${redact(key)}（存在 ${KEYS_FILE}，不会进导出包）`);
  return 0;
}

function endpointsKeyDel(id) {
  if (!id) {
    console.log('用法：node core/rules/cli.mjs endpoints key-del <id>');
    return 2;
  }
  const r = clearKey({ id });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(`✓ 已清除 "${id}" 的 Key（端点保留）`);
  return 0;
}

async function endpointsTest(id) {
  if (!id) {
    console.log('用法：node core/rules/cli.mjs endpoints test <id>');
    return 2;
  }
  const st = loadEndpointStore();
  if (!st.ok) {
    printProblems(st.issues);
    return 1;
  }
  const ep = st.endpoints.get(id);
  if (!ep) {
    console.log(`✗ 没有端点 "${id}"`);
    return 1;
  }
  printHeader(`测试连接：${id}`);
  console.log(`地址：${ep.baseURL}`);
  const r = await testConnection({ endpoint: ep, apiKey: st.keys[id] ?? null, timeoutMs: Math.min(ep.timeoutMs ?? 15000, 15000) });
  console.log(formatConnectionResult(r));
  return r.ok ? 0 : 1;
}

function endpointsExport(args) {
  const out = flag(args, '--out');
  if (!out) {
    console.log('用法：node core/rules/cli.mjs endpoints export --out 配置.json');
    return 2;
  }
  const st = loadEndpointStore();
  if (!st.ok) {
    printProblems(st.issues);
    return 1;
  }
  const r = exportEndpointsText({
    endpoints: st.config.endpoints,
    stageModels: st.config.stageModels,
    knownKeys: Object.values(st.keys),
  });
  writeFileSync(out, r.text, 'utf8');
  console.log(`✓ 已导出 ${r.bytes} 字节 → ${out}`);
  console.log(`  **不含任何 Key**（导出函数不读 keys.json）；sha256 ${r.hash.slice(0, 12)}…`);
  return 0;
}

function endpointsImport(args) {
  const file = flag(args, '--file');
  if (!file) {
    console.log('用法：node core/rules/cli.mjs endpoints import --file 配置.json');
    return 2;
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    console.log(`✗ 读不到文件：${file}\n  ${e.message}`);
    return 1;
  }
  const r = importEndpoints({ text });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(`✓ 已导入（${(r.bytes ?? 0)} 字节）。已有 Key 不受影响：请对每个端点跑一次 endpoints test。`);
  return 0;
}

/* ────────────────────────────── 备份与恢复（第 6 期第 3 件） ────────────────────────────── */

function cmdRestore(args) {
  const rel = args[0] && !args[0].startsWith('--') ? args[0] : null;
  const toAt = args.indexOf('--to');
  const toVersion = toAt >= 0 ? Number(args[toAt + 1]) : null;

  if (!rel) {
    printHeader('备份：哪些文件有备份');
    const all = listAllBackups({ dir: RULES_ROOT });
    if (!all.length) {
      console.log('（还没有任何备份。备份是在"保存"时自动生成的：第一次保存不会产生备份，因为那时还没有旧内容。）');
      return 0;
    }
    for (const item of all) {
      const newest = item.versions[0];
      console.log(`  ${item.rel.padEnd(32)} ${item.versions.length} 份（最新#${newest?.version} · ${newest?.bytes} 字节 · ${newest?.at ?? ''}）`);
    }
    console.log('\n看某一份的备份：node core/rules/cli.mjs restore prompts/solve.md');
    console.log('恢复到某一份：  node core/rules/cli.mjs restore prompts/solve.md --to 2');
    return 0;
  }

  const versions = listBackups({ dir: RULES_ROOT, rel });
  if (!versions.length) {
    console.log(`✗ ${rel} 没有备份`);
    return 1;
  }

  if (toVersion === null) {
    printHeader(`备份：${rel}`);
    for (const v of versions) {
      console.log(`  #${v.version}  ${String(v.bytes).padStart(7)} 字节  ${v.at ?? ''}${v.version === 1 ? '  （最新）' : ''}`);
    }
    console.log(`\n恢复：node core/rules/cli.mjs restore ${rel} --to <编号>`);
    console.log('  恢复之前会**先把当前版本也备份一份**，所以"恢复"本身也能撤销。');
    return 0;
  }

  printHeader(`恢复：${rel} → 第 ${toVersion} 份`);
  const r = restoreBackup({ dir: RULES_ROOT, rel, version: toVersion });
  if (!r.ok) {
    printProblems(r.issues);
    return 1;
  }
  console.log(`✓ 已恢复第 ${r.restored} 份${r.backedUpCurrent ? '（当前那版已先备份成 #1）' : ''}`);

  // 规则文件还要让索引认这份内容（否则工作区会因为哈希不符而拒绝载入）
  if (classifyRelPath(rel)) {
    const a = adoptRulesFiles({ dir: RULES_ROOT, rels: [rel], force: true });
    if (!a.ok) {
      console.log('\n⚠ 内容已写回，但登记失败（工作区现在会拒绝载入）：');
      printProblems(a.issues);
      return 1;
    }
    console.log(`✓ 已重新登记（revision ${a.revision}）—— 工作区可以载入了`);
  } else {
    console.log('  （这个文件不归规则工作区管，不需要重新登记）');
  }
  return 0;
}

function main(argv) {
  const cmd = (argv[0] ?? 'status').toLowerCase();
  switch (cmd) {
    case 'status':
      return cmdStatus();
    case 'check':
      return cmdCheck();
    case 'init':
      return cmdInit();
    case 'adopt':
      return cmdAdopt();
    case 'prompts':
      return cmdPrompts(argv.slice(1));
    case 'cleaning':
      return cmdCleaning(argv.slice(1));
    case 'endpoints':
      return cmdEndpoints(argv.slice(1));
    case 'restore':
      return cmdRestore(argv.slice(1));
    default:
      console.log('用法：node core/rules/cli.mjs <status|check|init|adopt|prompts [id]|cleaning [...]|endpoints [...]|restore [...]>');
      return 2;
  }
}

if (isCliEntry(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

export { main };
