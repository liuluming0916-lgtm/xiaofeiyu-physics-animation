#!/usr/bin/env node
/**
 * 规则工作区取证（第 6 期第 1 项 · §16）。
 *
 * 这一份自检要证明的不是"代码能跑"，而是**四条危险被挡住了**：
 *   A 哈希：文件被外部改过 ⇒ 拒绝载入，并**点名是哪个文件**；
 *   B 整批失败：任何一个文件坏 ⇒ 一个字节都不返回（不能"载入一半"）；
 *   C 保存：冲突拒绝、非法内容不落盘、写盘中途失败能回滚；
 *   D 热重载：正在跑的题**钉住旧快照**，新规则只对下一题生效。
 *
 * ⚠ 每条检查都配了"负对照"（故意做错一次，看它会不会红）——
 *   不会红的检查等于没写。本文件的负对照特别多，因为这一层的职责就是**拒绝**。
 *
 * ⚠ 全部操作在系统临时目录里进行，**不碰**仓库里真实的 `ai-rules/`
 *   （否则跑一次自检就把用户的规则改成测试数据了）。
 *
 * 用法：node tests/rules-selftest.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { isCliEntry } from '../tools/paths.mjs';
import {
  DEFAULT_LIMITS,
  adoptRulesFiles,
  classifyRelPath,
  commitRulesChange,
  createRulesRuntime,
  initRulesWorkspace,
  listDiskFiles,
  loadRulesWorkspace,
  readRulesIndex,
  sha256Hex,
  toPosixRel,
} from '../core/rules/index.mjs';

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

/* ────────────────────────────── 测试设施 ────────────────────────────── */

const created = [];

/** 每个场景一个全新目录，互不污染 */
function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), 'od-rules-'));
  created.push(dir);
  return dir;
}

/** 模拟"外部力量"直接写文件（绕过 commit，也就是绕过校验） */
function writeRaw(dir, rel, text) {
  const abs = join(dir, ...toPosixRel(rel).split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text, 'utf8');
  return abs;
}

function readRaw(dir, rel) {
  return readFileSync(join(dir, ...toPosixRel(rel).split('/')), 'utf8');
}

function hasProblem(result, code, pathPart) {
  return (result.problems ?? result.issues ?? []).some(
    (p) => p.code === code && (pathPart === undefined || String(p.path).includes(pathPart)),
  );
}

function findProblem(result, code) {
  return (result.problems ?? result.issues ?? []).find((p) => p.code === code) ?? null;
}

/**
 * 伪造一份索引：让"索引记的哈希"与"磁盘内容"一致，但内容本身未必合法。
 *
 * 为什么要这个设施：`adoptRulesFiles()` **会先做内容校验再登记**，所以"坏内容"正常路径下
 * 根本进不了索引（这是对的 —— 登记只表示"这次外部改动我认"，不表示"内容可以不合规"）。
 * 但还有另一种真实情形：**别的工具写了一份索引**（或索引被手改过）。
 * 这时载入必须仍然靠自身的内容校验把坏内容拦下 —— 这一层纵深防御只能这样测。
 */
function forgeIndex(dir, contents) {
  const idx = readRulesIndex(dir);
  const files = { ...(idx.ok ? idx.index.files : {}) };
  mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(contents)) {
    const abs = writeRaw(dir, rel, text);
    files[rel] = { sha256: sha256Hex(readFileSync(abs)), bytes: Buffer.byteLength(text, 'utf8') };
  }
  writeRaw(
    dir,
    '.workspace.json',
    JSON.stringify({ format: 'od-rules-workspace', version: 1, baseRevision: (idx.ok ? idx.index.baseRevision : 0) + 1, files }, null, 2),
  );
}

/** 建一个"干净"的工作区：初始化 + 提交一条 Prompt 与一份清洗规则表 */
function seed() {
  const dir = freshDir();
  const init = initRulesWorkspace({ dir });
  if (!init.ok) throw new Error(`init 失败：${JSON.stringify(init.issues)}`);
  const r = commitRulesChange({
    dir,
    changes: [
      { rel: 'prompts/solve.md', text: '现在执行【解题】阶段。\n请给出完整过程。\n' },
      {
        rel: 'cleaning.json',
        text: `${JSON.stringify(
          {
            format: 'od-cleaning-rules',
            version: 1,
            rules: [
              {
                id: 'strip-fence',
                name: '剥代码围栏',
                stage: 'scene_code',
                pattern: '^```[a-z]*$',
                flags: 'gm',
                replacement: '',
                enabled: true,
              },
            ],
          },
          null,
          2,
        )}\n`,
      },
    ],
  });
  if (!r.ok) throw new Error(`seed 提交失败：${JSON.stringify(r.issues)}`);
  return dir;
}

function main() {
  console.log('规则工作区取证（第 6 期第 1 项 · §16）\n');

  try {
    /* ────────────────────────────── 『A』哈希与索引 ────────────────────────────── */

    console.log('『A』哈希与索引');
    {
      // 负对照的基准：SHA256("abc") 是公开已知值。写错算法在这里就露馅。
      check('sha256Hex 与公开已知值一致（SHA256("abc")）', sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      // 中文按 UTF-8 字节算：一个汉字 3 字节（与词库长度口径一致）
      check('sha256Hex 按 UTF-8 字节求值（"中" 与 "中" 同哈希，且 ≠ 其字符串长度拼接）', sha256Hex('中') === sha256Hex(Buffer.from('中', 'utf8')));
    }

    {
      const dir = freshDir();
      const r = initRulesWorkspace({ dir });
      check('init 在空目录上成功', r.ok && r.created === true, JSON.stringify(r.issues));
      check('init 后 revision = 0', r.revision === 0);
      check('init 写出 .workspace.json', existsSync(join(dir, '.workspace.json')));
      check('init 建立 prompts/ 目录', existsSync(join(dir, 'prompts')));

      const idx = readRulesIndex(dir);
      check('索引可读且格式正确', idx.ok);
      check('索引里 files 是空对象（没有替用户抄一份内置 Prompt）', Object.keys(idx.index.files).length === 0);

      const again = initRulesWorkspace({ dir });
      check('重复 init 不覆盖已有索引', again.ok && again.created === false);
    }

    {
      // 索引本身被写坏：要能指出"索引这个文件"而不是笼统报错
      const dir = freshDir();
      initRulesWorkspace({ dir });
      writeRaw(dir, '.workspace.json', '{ 这不是 JSON');
      const r = loadRulesWorkspace({ dir });
      check('索引坏 JSON ⇒ 拒绝载入', r.ok === false);
      check('索引坏 JSON 的问题码是 rules.index.bad-json 且点名 .workspace.json', hasProblem(r, 'rules.index.bad-json', '.workspace.json'));

      writeRaw(dir, '.workspace.json', JSON.stringify({ format: 'od-rules-workspace', version: 2, baseRevision: 0, files: {} }));
      const r2 = loadRulesWorkspace({ dir });
      check('索引版本 2 ⇒ 拒绝（不猜新版本语义）', hasProblem(r2, 'rules.index.bad-version', '.workspace.json:version'));

      writeRaw(dir, '.workspace.json', JSON.stringify({ format: 'od-rules-workspace', version: 1, baseRevision: 0, files: { 'readme.md': { sha256: 'a'.repeat(64), bytes: 1 } } }));
      const r3 = loadRulesWorkspace({ dir });
      check('索引登记了不管理的路径 ⇒ 拒绝', hasProblem(r3, 'rules.index.bad-path', 'readme.md'));
    }

    /* ────────────────────────────── 『B』正常载入 ────────────────────────────── */

    console.log('\n『B』正常载入：内容、哈希、快照冻结');
    {
      const dir = seed();
      const r = loadRulesWorkspace({ dir });
      check('干净工作区可载入', r.ok, JSON.stringify(r.problems));
      check('revision 随提交前进到 1', r.revision === 1);
      check('Prompt 取到正文', r.prompts.solve?.text.startsWith('现在执行【解题】阶段'));
      check('Prompt 的哈希 == 磁盘字节哈希', r.prompts.solve.sha256 === sha256Hex(readRaw(dir, 'prompts/solve.md')));
      check('清洗规则表被解析出 1 条规则', r.cleaning?.rules?.length === 1);
      check('快照里同时给了按 id 的正文（promptTexts）', r.snapshot.promptTexts.solve === r.prompts.solve.text);
      check('快照是冻结的（改不动，防止一道题污染别的题）', Object.isFrozen(r.snapshot) && Object.isFrozen(r.snapshot.promptTexts));
      check('files 记录字节数与磁盘一致', r.files['prompts/solve.md'].bytes === Buffer.byteLength(readRaw(dir, 'prompts/solve.md'), 'utf8'));
    }

    /* ────────────────────────────── 『C』整批失败与"指出具体位置" ────────────────────────────── */

    console.log('\n『C』拒绝：每题都要点名到"哪个文件、哪个位置"');
    {
      const dir = seed();
      // 外部改动（不更新索引）——这是编辑器里的"文件被别的软件改了"
      writeRaw(dir, 'prompts/solve.md', '现在执行【解题】阶段。\n（被外部改过了）\n');
      const r = loadRulesWorkspace({ dir });
      check('外部改过 Prompt ⇒ 拒绝载入', r.ok === false);
      check('点名到具体文件 prompts/solve.md', hasProblem(r, 'rules.hash-mismatch', 'prompts/solve.md'));
      check('报了"索引记的"与"磁盘上的"两个哈希（便于判断）', /索引记的是/.test(findProblem(r, 'rules.hash-mismatch')?.message ?? ''));
      check('整批失败：prompts 为空（一个字都不返回）', Object.keys(r.prompts).length === 0 && r.cleaning === null);
      check('整批失败：snapshot 为 null', r.snapshot === null);
    }

    {
      const dir = seed();
      writeRaw(dir, 'prompts/extra.md', '我没登记\n');
      const r = loadRulesWorkspace({ dir });
      check('未登记的文件 ⇒ 拒绝并点名', hasProblem(r, 'rules.untracked', 'prompts/extra.md'));

      // ★ 范围负对照：不归我们管的目录**不许**报未登记（否则用户要去登记别人的文件）
      writeRaw(dir, 'worldbook/README.md', '# 世界书的说明\n');
      writeRaw(dir, 'endpoints.json', '{}\n');
      const r2 = loadRulesWorkspace({ dir });
      check(
        '★ 范围负对照：ai-rules/worldbook/ 与 endpoints.json 不被工作区报成"未登记"',
        !hasProblem(r2, 'rules.untracked', 'worldbook/README.md') && !hasProblem(r2, 'rules.untracked', 'endpoints.json'),
      );
      // 但 prompts/extra.md 仍然要报（证明上一条不是"什么都没报"）
      check('（对照）同一批里 prompts/extra.md 仍被点名', hasProblem(r2, 'rules.untracked', 'prompts/extra.md'));
    }

    {
      const dir = seed();
      rmSync(join(dir, 'prompts', 'solve.md'));
      const r = loadRulesWorkspace({ dir });
      check('索引有、磁盘没有 ⇒ rules.missing 并点名', hasProblem(r, 'rules.missing', 'prompts/solve.md'));
    }

    {
      const dir = seed();
      const brokenJson = '{\n  "format": "od-cleaning-rules",\n  "version": 1,\n  "rules": [\n';
      writeRaw(dir, 'cleaning.json', brokenJson);

      // 真实用户路径：在编辑器里改坏了 → 点"登记"时被内容校验拦下（登记不能绕过校验）
      const ad = adoptRulesFiles({ dir, rels: ['cleaning.json'], force: true });
      check('坏的清洗规则表**登记不上**（登记只认改动，不认违规）', ad.ok === false && hasProblem(ad, 'rules.cleaning.bad-json', 'cleaning.json'));
      const adMsg = findProblem(ad, 'rules.cleaning.bad-json')?.message ?? '';
      const adHint = findProblem(ad, 'rules.cleaning.bad-json')?.hint ?? '';
      // ★ 这条是自检发现的真问题：V8 对"没写完"的 JSON 只给 "Unexpected end of JSON input"，**没有行列号**
      check('★ 截断的 JSON 也指出"在第几行结束"（原始报错没有位置）', /第 \d+ 行附近就结束了/.test(adMsg), adMsg);
      check('★ 并且直说少的是括号（可操作，而不是让人自己猜）', /少了/.test(adHint) && /\]/.test(adHint), adHint);

      // 另一种坏法：JSON 写完了但后面多了东西 —— V8 会给行列号，要求原文案照搬出来
      writeRaw(dir, 'cleaning.json', '{"format":"od-cleaning-rules","version":1,"rules":[]} 这一段是多余的\n');
      const ad2 = adoptRulesFiles({ dir, rels: ['cleaning.json'], force: true });
      const msg2 = findProblem(ad2, 'rules.cleaning.bad-json')?.message ?? '';
      check('★ 多写了尾巴的 JSON ⇒ 报出第几行第几列', /第 \d+ 行第 \d+ 列附近/.test(msg2), msg2);

      // 纵深防御：索引被别的工具写成了与坏内容一致，载入仍要拦
      forgeIndex(dir, { 'cleaning.json': brokenJson });
      const r = loadRulesWorkspace({ dir });
      check('（索引与文件一致时）载入仍拒绝坏 JSON', hasProblem(r, 'rules.cleaning.bad-json', 'cleaning.json'));
    }

    {
      const dir = seed();
      const badRe = `${JSON.stringify({
        format: 'od-cleaning-rules',
        version: 1,
        rules: [
          { id: 'ok', name: '合法', stage: 'solve', pattern: 'a+', flags: 'g', replacement: '', enabled: true },
          { id: 'bad', name: '非法', stage: 'solve', pattern: '(未闭合', flags: 'g', replacement: '', enabled: true },
        ],
      })}\n`;

      const ad = adoptRulesFiles({ dir, rels: ['cleaning.json'], force: true });
      // 先确认 seed 里那份是好的（否则下面那条红就说明不了问题）
      check('（对照）seed 的清洗规则表本身合法', ad.ok === true, JSON.stringify(ad.issues));

      forgeIndex(dir, { 'cleaning.json': badRe });
      const r = loadRulesWorkspace({ dir });
      const p = findProblem(r, 'rule.pattern.invalid');
      check('非法正则 ⇒ 拒绝载入', hasProblem(r, 'rule.pattern.invalid', 'rules[1].pattern'));
      check(
        '非法正则的路径带文件名前缀（cleaning.json:rules[1].pattern）',
        String(p?.path ?? '').startsWith('cleaning.json:rules[1].pattern'),
        p?.path,
      );
    }

    {
      const dir = seed();
      forgeIndex(dir, { 'prompts/blank.md': '   \n\n' });
      const r = loadRulesWorkspace({ dir });
      check('空 Prompt 被拒（不是"空着就空着"）', hasProblem(r, 'rules.prompt.empty', 'prompts/blank.md'));

      const ad = adoptRulesFiles({ dir, rels: ['prompts/blank.md'] });
      check('空 Prompt 也登记不上', ad.ok === false && hasProblem(ad, 'rules.prompt.empty', 'prompts/blank.md'));
    }

    {
      const dir = seed();
      // ⚠ 不能在 Windows 上测 `prompts/solve.MD`：文件系统大小写不敏感，写 .MD 会直接覆盖 .md
      //   （本机实测：写完之后 readdirSync 拿回来的是 prompts/solve.md）。
      //   因此大小写那条只做分类函数的单元断言，文件名形状用 .bak 这种 Windows 上确实不同的名字来测。
      writeRaw(dir, 'prompts/solve.md.bak', '备份文件\n');
      const r = loadRulesWorkspace({ dir });
      check('*.bak 残留 ⇒ 未登记，且说明"文件名不认识"', /不认识这个文件名/.test(findProblem(r, 'rules.untracked')?.message ?? ''));
      check('classifyRelPath 不认 prompts/solve.md.bak', classifyRelPath('prompts/solve.md.bak') === null);
      check('classifyRelPath 不认大写扩展名 prompts/solve.MD（Windows 上无法用真文件测）', classifyRelPath('prompts/solve.MD') === null);
      check('classifyRelPath 不认嵌套目录', classifyRelPath('prompts/a/solve.md') === null);
      check('classifyRelPath 认 prompts/solve.md', classifyRelPath('prompts/solve.md')?.id === 'solve');
    }

    {
      // §16：Key 绝不进规则目录
      const dir = seed();
      forgeIndex(dir, { 'prompts/solve.md': '正文里夹了一个 Key：sk-abcdefgh12345678\n' });
      const r = loadRulesWorkspace({ dir });
      check('Prompt 里夹 Key ⇒ 拒绝载入（§16 安全边界）', hasProblem(r, 'rules.secret-in-rules', 'prompts/solve.md'));

      const ad = adoptRulesFiles({ dir, rels: ['prompts/solve.md'], force: true });
      check('带 Key 的文件也登记不上', ad.ok === false && hasProblem(ad, 'rules.secret-in-rules'));
    }

    {
      const dir = seed();
      writeRaw(dir, 'prompts/solve.md', 'x'.repeat(200));
      adoptRulesFiles({ dir, rels: ['prompts/solve.md'], force: true });
      const r = loadRulesWorkspace({ dir, limits: { maxFileBytes: 100, maxTotalBytes: 1024 * 1024 } });
      check('单文件超上限 ⇒ 拒绝（体积上限可注入，便于测小样本）', hasProblem(r, 'rules.file-too-large', 'prompts/solve.md'));

      const dir2 = seed();
      const r2 = loadRulesWorkspace({ dir: dir2, limits: { maxFileBytes: 1024 * 1024, maxTotalBytes: 50 } });
      check('总体积超上限 ⇒ 拒绝', hasProblem(r2, 'rules.total-too-large'));
    }

    /* ────────────────────────────── 『D』保存：冲突、不落盘、回滚 ────────────────────────────── */

    console.log('\n『D』保存：乐观锁、非法不落盘、中途失败回滚');
    {
      const dir = seed();
      const before = readRaw(dir, 'prompts/solve.md');

      // 你以为的版本是"不存在"（null），但磁盘上其实有 ⇒ 冲突
      const r = commitRulesChange({ dir, changes: [{ rel: 'prompts/solve.md', text: '新正文\n' }], expectedHashes: { 'prompts/solve.md': null } });
      check('版本不符 ⇒ 拒绝保存（rules.conflict）', hasProblem(r, 'rules.conflict', 'prompts/solve.md'));
      check('★ 拒绝时磁盘内容一个字都没动（负对照）', readRaw(dir, 'prompts/solve.md') === before);
      check('★ 拒绝时索引 revision 没有前进', readRulesIndex(dir).index.baseRevision === 1);

      const ok = commitRulesChange({ dir, changes: [{ rel: 'prompts/solve.md', text: '新正文\n' }], expectedHashes: { 'prompts/solve.md': null }, force: true });
      check('force 覆盖 ⇒ 成功', ok.ok === true, JSON.stringify(ok.issues));
      check('force 之后索引指向新内容', readRulesIndex(dir).index.files['prompts/solve.md'].sha256 === sha256Hex('新正文\n'));
    }

    {
      const dir = seed();
      const r = commitRulesChange({
        dir,
        changes: [
          {
            rel: 'cleaning.json',
            text: `${JSON.stringify({ format: 'od-cleaning-rules', version: 1, rules: [{ id: 'x', name: 'x', stage: 'solve', pattern: '[', flags: '', replacement: '', enabled: true }] })}\n`,
          },
        ],
      });
      check('非法正则 ⇒ 拒绝保存', hasProblem(r, 'rule.pattern.invalid', 'rules[0].pattern'));
      check('★ 拒绝时文件根本没被创建（不落盘）', !existsSync(join(dir, 'cleaning.json')) || readRaw(dir, 'cleaning.json').includes('strip-fence'));
    }

    {
      const dir = seed();
      const oldSolve = readRaw(dir, 'prompts/solve.md');
      const oldCleaning = readRaw(dir, 'cleaning.json');
      const r = commitRulesChange({
        dir,
        changes: [
          { rel: 'prompts/solve.md', text: '第一份新正文\n' },
          { rel: 'cleaning.json', text: oldCleaning.replace('strip-fence', 'strip-fence-2') },
        ],
        _failAfterRenames: 1, // 第 1 个改名成功之后强制失败
      });
      check('写盘中途失败 ⇒ 报 rules.write-failed', hasProblem(r, 'rules.write-failed'));
      check('★ 已改名的文件被回滚成旧内容（负对照：不能"改了一半就停"）', readRaw(dir, 'prompts/solve.md') === oldSolve);
      check('★ 第二个文件完全没动', readRaw(dir, 'cleaning.json') === oldCleaning);
      check('★ 索引 revision 没前进（提交点没到）', readRulesIndex(dir).index.baseRevision === 1);
      check('★ 没留下 .tmp- 临时文件', readdirSync(join(dir, 'prompts')).every((n) => !n.includes('.tmp-')));
    }

    {
      const dir = seed();
      // 别的文件被外部改过 ⇒ 拒绝保存（否则会拿旧索引把外部改动"合法化"）
      writeRaw(dir, 'cleaning.json', '{"format":"od-cleaning-rules","version":1,"rules":[]}\n');
      const r = commitRulesChange({ dir, changes: [{ rel: 'prompts/solve.md', text: '新正文\n' }] });
      check('保存前发现别处被外部改动 ⇒ rules.stale-workspace', hasProblem(r, 'rules.stale-workspace', 'cleaning.json'));
      check('该情况下不写任何文件', !readRaw(dir, 'prompts/solve.md').includes('新正文'));
    }

    {
      const dir = seed();
      const r = commitRulesChange({ dir, changes: [{ rel: 'prompts/solve.md', text: null }] });
      check('提交删除（text:null）成功', r.ok === true, JSON.stringify(r.issues));
      check('文件从磁盘消失', !existsSync(join(dir, 'prompts/solve.md')));
      check('索引里也没有它了', !('prompts/solve.md' in readRulesIndex(dir).index.files));
      check('删除后工作区仍可载入（回到"缺文件 = 用内置"）', loadRulesWorkspace({ dir }).ok === true);
    }

    /* ────────────────────────────── 『E』热重载 ────────────────────────────── */

    console.log('\n『E』热重载：下一题生效，正在跑的题不受影响（§16 原文）');
    {
      const dir = seed();
      const runtime = createRulesRuntime({ dir });
      const load1 = runtime.reload();
      check('运行时载入成功', load1.ok === true);
      check('运行时 revision = 1', runtime.revision === 1);

      const snapA = runtime.snapshotForNewProblem('题A');
      check('题A 钉住的快照是 v1 正文', snapA.promptTexts.solve.includes('请给出完整过程'));

      const changed = commitRulesChange({ dir, changes: [{ rel: 'prompts/solve.md', text: '现在执行【解题】阶段。\n（v2 正文）\n' }] });
      check('运行中改掉了 Prompt（提交成功）', changed.ok === true, JSON.stringify(changed.issues));

      const load2 = runtime.reload();
      check('热重载成功，revision 前进到 2', load2.ok === true && runtime.revision === 2);

      check('★ 题A 的旧快照不变（正在跑的题不受影响）', runtime.snapshotOf('题A').promptTexts.solve === snapA.promptTexts.solve);
      check('★ 题A 快照的 revision 仍是 1', runtime.snapshotOf('题A').revision === 1);

      const snapB = runtime.snapshotForNewProblem('题B');
      check('★ 题B（下一题）拿到 v2 正文', snapB.promptTexts.solve.includes('v2 正文'));
      check('题B 快照的 revision 是 2', snapB.revision === 2);
      check('两份快照是不同对象（不是同一个引用）', snapA !== snapB);
      check('同时钉着 2 道题', runtime.pinnedCount === 2);

      check('题结束 release 之后不再钉住', runtime.release('题A') === true && runtime.pinnedCount === 1);
      check('release 不存在的题返回 false', runtime.release('题Z') === false);

      // 载入失败：保留上一份好快照（否则一次手抖会让下一题用空规则跑）
      writeRaw(dir, 'prompts/solve.md', '坏掉的外部改动\n');
      const bad = runtime.reload();
      check('外部改坏后 reload 失败', bad.ok === false);
      check('★ 失败时保留上一份好快照（current 仍是 revision 2）', runtime.revision === 2);
      check('★ 失败原因被交出来（不能静默降级）', runtime.problems.length > 0 && runtime.problems.some((p) => p.code === 'rules.hash-mismatch'));
      check('★ 题B 仍然能用它当初的快照', runtime.snapshotOf('题B').promptTexts.solve.includes('v2 正文'));
    }

    /* ────────────────────────────── 『F』登记（adopt） ────────────────────────────── */

    console.log('\n『F』登记外部改动：只收"改动"，不收"违规"');
    {
      const dir = seed();
      writeRaw(dir, 'prompts/solve.md', '外部改的新正文\n');
      const before = loadRulesWorkspace({ dir });
      check('先确认它现在是红的', before.ok === false);

      const r = adoptRulesFiles({ dir, rels: ['prompts/solve.md'] });
      check('登记成功', r.ok === true, JSON.stringify(r.issues));
      const after = loadRulesWorkspace({ dir });
      check('登记后变绿', after.ok === true);
      check('登记后读到的是外部那版正文', after.prompts.solve.text === '外部改的新正文\n');
      check('登记让 revision 前进', after.revision === r.revision && after.revision > before.revision);
    }

    {
      const dir = seed();
      writeRaw(dir, 'cleaning.json', '{ 坏 JSON');
      const r = adoptRulesFiles({ dir, rels: ['cleaning.json'], force: true });
      check('★ 登记**不能**绕过内容校验（坏 JSON 仍然被拒）', r.ok === false && hasProblem(r, 'rules.cleaning.bad-json'));
    }

    /* ────────────────────────────── 『G』清单范围 ────────────────────────────── */

    console.log('\n『G』扫描范围：只认自己那两类');
    {
      const dir = seed();
      writeRaw(dir, 'worldbook/x.json', '{}');
      writeRaw(dir, 'prompts/.solve.md.swp', 'vim 交换文件');
      const rels = listDiskFiles(dir).map((d) => d.rel);
      check('扫描不含 worldbook/', !rels.some((r) => r.startsWith('worldbook/')));
      check('扫描不含点开头的文件（编辑器残留）', !rels.some((r) => r.includes('.solve.md.swp')));
      check('扫描含 prompts/solve.md 与 cleaning.json', rels.includes('prompts/solve.md') && rels.includes('cleaning.json'));
      check('默认上限与 §16 一致（800 KB / 16 MB）', DEFAULT_LIMITS.maxFileBytes === 800 * 1024 && DEFAULT_LIMITS.maxTotalBytes === 16 * 1024 * 1024);
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

  console.log(`\n${failures.length ? '✗' : '✓'} 规则工作区取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
  return failures.length === 0;
}

if (isCliEntry(import.meta.url)) main();

export { main };
