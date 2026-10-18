#!/usr/bin/env node
/**
 * 保存前自动备份与恢复取证（第 6 期第 3 件 · 用户裁决：滚动留 5 份）。
 *
 * 要证明的四件事：
 *   A 备份**按次生成**：第一次保存没有旧内容 ⇒ 不产生备份；第二次才有；
 *   B **滚动 5 份**：改 7 次之后，最新 5 版都在，最老的被挤掉，`.bak.1` 永远是最新；
 *   C **恢复可撤销**：恢复前会先把当前版本也备份一份；
 *   D 三处"不备份/必须备份"的口径：`keys.json` **永不备份**（每份副本都是明文密钥），
 *     而 `endpoints.json` 与 `ai-rules/worldbook/*.json` 必须备份。
 *
 * ⚠ 全部在临时目录里跑，不碰仓库真实的 `ai-rules/`。
 *
 * 用法：node tests/backup-selftest.mjs
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isCliEntry } from '../tools/paths.mjs';
import {
  BACKUP_KEEP,
  adoptRulesFiles,
  backupDirOf,
  backupSummary,
  commitRulesChange,
  initRulesWorkspace,
  listAllBackups,
  listBackups,
  loadRulesWorkspace,
  listDiskFiles,
  restoreBackup,
} from '../core/rules/index.mjs';
import { saveEndpoints, saveKeys, loadKeys } from '../core/gateway/index.mjs';
import { saveWorldbookPack, copyBuiltinEntry, listWorldbookPacks, listBuiltinEntries } from '../core/worldbook/index.mjs';

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
  const d = mkdtempSync(join(tmpdir(), 'od-backup-'));
  created.push(d);
  initRulesWorkspace({ dir: d });
  return d;
}

const REL = 'prompts/solve.md';
const writeVersion = (dir, text) => commitRulesChange({ dir, changes: [{ rel: REL, text }] });
const readVersion = (dir) => readFileSync(join(dir, 'prompts', 'solve.md'), 'utf8');
const backupText = (dir, n) => readFileSync(join(backupDirOf(dir), 'prompts', `solve.md.bak.${n}`), 'utf8');

function endpoint(id = 'ep_main') {
  return {
    id,
    displayName: '主力',
    baseURL: 'https://api.example.com/v1',
    defaultModel: 'model-a',
    visionModel: '',
    apiKeyModelId: null,
    supportsJsonMode: true,
    supportsVision: false,
    enableThinking: false,
    preserveThinking: false,
    timeoutMs: 60000,
  };
}

function main() {
  console.log('保存前自动备份与恢复取证（第 6 期第 3 件）\n');

  try {
    /* ── A 按次生成 ── */
    console.log('『A』第一次保存没有备份，第二次才有');
    {
      const dir = freshDir();
      check('工作区刚建立时没有任何备份', listAllBackups({ dir }).length === 0);

      const v1 = writeVersion(dir, '第一版：先写研究对象。\n');
      check('第一次保存成功', v1.ok === true, JSON.stringify(v1.issues));
      check('★ 第一次保存**不产生**备份（当时没有旧内容）', listBackups({ dir, rel: REL }).length === 0);

      const v2 = writeVersion(dir, '第二版：先写研究对象，再列方程。\n');
      check('第二次保存成功', v2.ok === true);
      check('★ 第二次保存产生了 1 份备份', listBackups({ dir, rel: REL }).length === 1);
      check('★ 备份里是第一版的内容（不是第二版）', backupText(dir, 1).includes('第一版'));
      check('保存成功后磁盘上是第二版', readVersion(dir).includes('第二版'));
      check('备份没有把工作区搞脏（仍可载入）', loadRulesWorkspace({ dir }).ok === true);
    }

    /* ── B 滚动 5 份 ── */
    console.log('\n『B』滚动 5 份：改 7 次后，最新 5 版都在');
    {
      const dir = freshDir();
      for (let i = 1; i <= 7; i += 1) writeVersion(dir, `第 ${i} 版正文，每版都要够长以免被判成空。\n`);
      const list = listBackups({ dir, rel: REL });
      check(`只保留 ${BACKUP_KEEP} 份（不无限增长）`, list.length === BACKUP_KEEP, String(list.length));
      check('编号是 1…5 连续的', list.map((b) => b.version).join(',') === '1,2,3,4,5');
      check('★ .bak.1 = 第 6 版（保存第 7 版之前的当前内容）', backupText(dir, 1).includes('第 6 版'));
      check('★ .bak.5 = 第 2 版（第 1 版已被挤掉）', backupText(dir, 5).includes('第 2 版'));
      check('★ 第 1 版彻底不在了（只留 5 份的代价，如实记）', !backupText(dir, 5).includes('第 1 版') && list.length === 5);
      check('磁盘上是第 7 版', readVersion(dir).includes('第 7 版'));
      check('备份体积/时间都有记录（界面要显示）', list.every((b) => b.bytes > 0 && typeof b.at === 'string'));
    }

    /* ── C 恢复，且恢复本身可撤销 ── */
    console.log('\n『C』恢复：默认最新；恢复前先把当前版本也备份');
    {
      const dir = freshDir();
      for (let i = 1; i <= 3; i += 1) writeVersion(dir, `第 ${i} 版正文，够长就行。\n`);
      check('（前置）现在是第 3 版、备份 2 份', readVersion(dir).includes('第 3 版') && listBackups({ dir, rel: REL }).length === 2);

      const r = restoreBackup({ dir, rel: REL });
      check('恢复默认（最新）成功', r.ok === true && r.restored === 1, JSON.stringify(r));
      check('★ 磁盘内容回到第 2 版', readVersion(dir).includes('第 2 版'));
      check('★ 恢复前的那版（第 3 版）被备份成 .bak.1（恢复可撤销）', r.backedUpCurrent === true && backupText(dir, 1).includes('第 3 版'));

      const undone = restoreBackup({ dir, rel: REL, version: 1 });
      check('再恢复一次 ⇒ 回到第 3 版（撤销刚才的恢复）', undone.ok === true && readVersion(dir).includes('第 3 版'));
    }

    {
      // 指定版本
      const dir = freshDir();
      for (let i = 1; i <= 4; i += 1) writeVersion(dir, `第 ${i} 版正文，够长就行。\n`);
      // 四次保存之后的备份是：.bak.1 = 第 3 版、.bak.2 = 第 2 版、.bak.3 = 第 1 版
      const r = restoreBackup({ dir, rel: REL, version: 3 });
      check('可以指定恢复第 3 份（= 第 1 版的内容）', r.ok === true && r.restored === 3 && readVersion(dir).includes('第 1 版'), JSON.stringify({ restored: r.restored, now: readVersion(dir) }));
      check('恢复不存在的编号 ⇒ 退回最新一份（不报错到没法用）', restoreBackup({ dir, rel: REL, version: 99 }).ok === true);
    }

    /* ── D 删除也先备份 ── */
    console.log('\n『D』"恢复默认"（删文件）之前也备份');
    {
      const dir = freshDir();
      writeVersion(dir, '要被删掉的那一版正文，够长。\n');
      const del = commitRulesChange({ dir, changes: [{ rel: REL, text: null }] });
      check('删除成功', del.ok === true);
      check('★ 删之前留了备份（否则删了就真没了）', listBackups({ dir, rel: REL }).length >= 1 && backupText(dir, 1).includes('要被删掉的那一版'));
      check('文件确实没了', !existsSync(join(dir, 'prompts', 'solve.md')));
      const back = restoreBackup({ dir, rel: REL });
      check('可以把它恢复回来', back.ok === true && existsSync(join(dir, 'prompts', 'solve.md')));
      // 走一次登记，工作区才认这份内容（删除时索引已把它摘掉 ⇒ 现在是"未登记文件"）
      const afterRestore = loadRulesWorkspace({ dir });
      check(
        '★ 恢复后必须先登记才可载入（否则报"未登记文件"）',
        afterRestore.ok === false && (afterRestore.problems ?? []).some((p) => p.code === 'rules.untracked'),
        JSON.stringify((afterRestore.problems ?? []).map((p) => p.code)),
      );
      const adopted = adoptRulesFiles({ dir, rels: [REL], force: true });
      check('登记成功，工作区恢复可载入', adopted.ok === true && loadRulesWorkspace({ dir }).ok === true);
    }

    /* ── E Key 不备份 / 端点与词条要备份 ── */
    console.log('\n『E』keys.json 永不备份；endpoints.json 与词条包必须备份');
    {
      const dir = freshDir();
      saveKeys({ dir, keys: { ep_main: 'sk-FIRST000011112222' } });
      saveKeys({ dir, keys: { ep_main: 'sk-SECOND00003333' } });
      check('两个 Key 都写进去了（对照：证明不是"什么都没做"）', loadKeys({ dir }).keys.ep_main === 'sk-SECOND00003333');
      check('★ keys.json 没有任何备份（每份副本都是明文密钥）', !existsSync(join(backupDirOf(dir), 'keys.json.bak.1')));

      saveEndpoints({ dir, endpoints: [endpoint()], stageModels: {} });
      saveEndpoints({ dir, endpoints: [endpoint('ep_main')].map((e) => ({ ...e, defaultModel: 'model-b' })), stageModels: {}, force: true });
      const epBackups = listBackups({ dir, rel: 'endpoints.json' });
      check('★ endpoints.json 有备份（端点改错了能退）', epBackups.length >= 1);
      check('备份里是上一版的模型名', readFileSync(join(backupDirOf(dir), 'endpoints.json.bak.1'), 'utf8').includes('model-a'));

      // 词条包：复制一条内置，然后改两次
      const wbDir = join(dir, 'worldbook');
      const firstBuiltin = listBuiltinEntries().entries[0];
      check('（前置）内置库里至少有一条词条', Boolean(firstBuiltin?.id));
      const copied = copyBuiltinEntry({ dir: wbDir, id: firstBuiltin.id });
      check('（前置）复制一条内置词条成功', copied.ok === true, JSON.stringify(copied));
      const packText = readFileSync(join(wbDir, copied.name), 'utf8');
      const saved = saveWorldbookPack({ dir: wbDir, name: copied.name, text: packText });
      check('再保存一次成功', saved.ok === true, JSON.stringify(saved.issues));
      check('★ 词条包也有备份', listBackups({ dir: wbDir, rel: copied.name }).length >= 1);
      check('词条包的备份不影响词条库载入', listWorldbookPacks({ dir: wbDir }).ok === true);
    }

    /* ── F 备份目录对工作区不可见 ── */
    console.log('\n『F』备份目录不会被当成规则文件（否则会天天报"未登记"）');
    {
      const dir = freshDir();
      writeVersion(dir, '第一版正文，够长就行。\n');
      writeVersion(dir, '第二版正文，够长就行。\n');
      check('备份目录存在', existsSync(backupDirOf(dir)));
      const rels = listDiskFiles(dir).map((d) => d.rel);
      check('★ 扫描结果里没有 .backup 里的东西', !rels.some((r) => r.includes('.backup')));
      check('★ 工作区仍然干净可载入（没有"未登记"）', loadRulesWorkspace({ dir }).ok === true);
    }

    /* ── G 路径安全与摘要 ── */
    console.log('\n『G』路径安全与摘要');
    {
      const dir = freshDir();
      writeVersion(dir, '第一版正文，够长就行。\n');
      writeVersion(dir, '第二版正文，够长就行。\n');

      const evil = restoreBackup({ dir, rel: '../evil.md' });
      check('★ 恢复时拒绝路径穿越（../evil.md）', evil.ok === false && evil.issues?.[0]?.code === 'backup.bad-path');
      check('写入侧也拒绝（backupFile 同一条判据）', commitRulesChange({ dir, changes: [{ rel: '../evil.md', text: 'x' }] }).ok === false);

      const sum = backupSummary({ dir, rel: REL });
      check('摘要：份数 / 最新一份 / 大小', sum.count === 1 && sum.newest?.version === 1 && sum.newest.bytes > 0);
      check('摘要：keys.json 标为"不备份"', backupSummary({ dir, rel: 'keys.json' }).skipped === true);
      check('没有备份的文件恢复时给明确提示', restoreBackup({ dir, rel: 'prompts/steps.md' }).issues?.[0]?.code === 'backup.none');
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

  console.log(`\n${failures.length ? '✗' : '✓'} 备份与恢复取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
