#!/usr/bin/env node
/**
 * 内置知识层「封死」取证（第 8 期 · M6/M19 · 用户 2026-10-17 裁决）
 *
 * 用户原话：**「封死不是对我们本地的源码封死，本地依旧需要可编辑的内置知识层，
 * 包装的软件中封死才对。」**
 *
 * 所以这一门要同时钉住**两件相反的事**，缺一件都不算对：
 *
 *   **A 本地开发照样读磁盘**（可编辑）—— 否则我们以后改不了内置词条；
 *   **B 打包形态不依赖磁盘**（封死）—— 否则"封死"只是一句口号。
 *
 * 还有第三件同样关键：
 *   **C 用户层永远是磁盘**（老师蒸馏出来的卡片必须能改）——
 *      别为了封内置层，把用户层的写入也一起弄丢了。
 *
 * 判据技巧：用 `OD_BUILTIN_DIR` 指到一个**空目录**。
 *   · 空目录 + 开发形态 ⇒ 内置词条数应为 **0**（并报"目录不存在/为空"）——这是负对照，
 *     证明"目录真的被换掉了"，否则 B 里"读得到"不能说明是从常量读的；
 *   · 空目录 + 发布形态 ⇒ 内置词条数应**不变**（因为根本没读目录）。
 *
 * 用法：node tests/builtin-seal-selftest.mjs
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROJECT_ROOT, isCliEntry } from '../tools/paths.mjs';
import { buildBundleSource } from '../tools/build-builtin-bundle.mjs';
import { BUILTIN_BUNDLE } from '../core/worldbook/builtin-bundle.generated.mjs';
import { loadLibrary, readBuiltinBundle, useBuiltinBundle } from '../core/worldbook/index.mjs';

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
function freshDir(prefix = 'od-seal-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  created.push(d);
  return d;
}

/** 临时用户目录里放一个包（证明用户层仍然从磁盘读） */
function makeUserPack() {
  const dir = freshDir('od-seal-user-');
  const entry = {
    id: 'wb_seal_test',
    title: '封死自检用的用户词条',
    category: 'mechanics',
    chapter: '自检',
    concepts: [],
    tags: [],
    elements: [],
    keys: [{ key: '封死自检', type: 'literal' }],
    slots: ['solve'],
    content: '这是自检写的用户词条。## 生成后自检\n- 无。',
  };
  // ⚠ 用户词条文件的格式是**裸数组**（或带 `format` 的 pack）。
  //   写成 `{entries:[…]}` 会被当成"一条词条"整包吃进去 —— 这是本文件第一版踩的坑。
  writeFileSync(join(dir, 'seal-test.json'), JSON.stringify([entry], null, 2), 'utf8');
  return dir;
}

async function main() {
  console.log('内置知识层「封死」取证（只封发行产物，不封本地源码）\n');

  /* ══ 0 编译包与源数据同步 ══ */
  console.log('『0』编译包必须与 data/ 逐字节同步');

  {
    const { content, hash, files } = buildBundleSource();
    const onDisk = readFileSync(join(PROJECT_ROOT, 'core', 'worldbook', 'builtin-bundle.generated.mjs'), 'utf8');
    check('★ 盘上的编译包 == 从 data/ 重新生成的结果', onDisk === content, '跑 node tools/build-builtin-bundle.mjs');
    check('编译包带版本哈希（改了内容它就变）', BUILTIN_BUNDLE.hash === hash && hash.length === 64);
    check('编译包覆盖全部词条文件', BUILTIN_BUNDLE.files.length === files.length && files.length > 0);
    check('每个文件都带自己的 sha256', BUILTIN_BUNDLE.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  }

  /* ══ A 本地开发：读磁盘 ══ */
  console.log('\n『A』本地开发（默认）：照旧读磁盘上**可编辑**的文件');

  const userDir = makeUserPack();
  let devCount = 0;

  {
    delete process.env.OD_BUILTIN_BUNDLE;
    check('默认不走编译包（useBuiltinBundle = false）', useBuiltinBundle() === false);
    check('开发形态下 readBuiltinBundle() 返回 null（表示"请读磁盘"）', readBuiltinBundle() === null);

    const lib = loadLibrary({ userDir });
    devCount = lib.builtin.length;
    check('★ 读到内置词条（>0）', devCount > 0, `实际 ${devCount}`);
    check('★ 来源是磁盘文件（sources 里给的是绝对路径，不是 <builtin:…>）', lib.sources.filter((s) => s.kind === 'builtin').every((s) => !s.file.startsWith('<builtin:')));
    check('内置词条的 origin 都是 builtin', lib.builtin.every((e) => e.origin === 'builtin'));
  }

  /* ══ B 负对照：把内置目录换空，开发形态必须"读不到" ══ */
  console.log('\n『B』负对照：把内置目录指到空目录（证明"目录真的被换掉了"）');

  const emptyDir = freshDir('od-seal-empty-');
  {
    delete process.env.OD_BUILTIN_BUNDLE;
    process.env.OD_BUILTIN_DIR = emptyDir;
    const lib = loadLibrary({ userDir });
    check('★ 开发形态 + 空目录 ⇒ 内置词条 **0 条**', lib.builtin.length === 0, `实际 ${lib.builtin.length}`);
    check('并且如实报出"目录里没有词条"这类问题（不静默）', lib.problems.length > 0);
  }

  /* ══ C 打包形态：不依赖磁盘 ══ */
  console.log('\n『C』打包形态（OD_BUILTIN_BUNDLE=1）：内置层从**编译进去的常量**读');

  {
    process.env.OD_BUILTIN_BUNDLE = '1';
    process.env.OD_BUILTIN_DIR = emptyDir; // 还是那个空目录：读得到 = 没读磁盘
    check('useBuiltinBundle = true', useBuiltinBundle() === true);
    check('readBuiltinBundle() 给出编译包', readBuiltinBundle()?.format === 'od-builtin-bundle');

    const lib = loadLibrary({ userDir });
    check('★ 空目录下仍读到**同样多**的内置词条', lib.builtin.length === devCount, `${lib.builtin.length} vs 开发态 ${devCount}`);
    check('★ 内置词条内容与开发态完全一致（同一批 id）', JSON.stringify(lib.builtin.map((e) => e.id).sort()) === JSON.stringify(loadLibrary({ userDir, builtinDir: join(PROJECT_ROOT, 'core', 'worldbook', 'data') }).builtin.map((e) => e.id).sort()));
    check('★ 来源标成 `<builtin:…>`（说明这次不是从磁盘读的）', lib.sources.filter((s) => s.kind === 'builtin').every((s) => s.file.startsWith('<builtin:')));
    check('没有因为"目录不存在"报问题', !lib.problems.some((p) => String(p).includes('目录不存在')));
  }

  /* ══ D 用户层永远是磁盘（别为了封内置把用户层也弄丢） ══ */
  console.log('\n『D』用户层（蒸馏卡片）永远是磁盘，打包形态也照旧可改');

  {
    process.env.OD_BUILTIN_BUNDLE = '1';
    const lib = loadLibrary({ userDir });
    check(
      '★ 打包形态下**用户词条照样读到**（老师的东西能改）',
      lib.user.length === 1 && String(lib.user[0].title ?? '').includes('封死自检'),
      `user=${lib.user.length} · ${JSON.stringify(lib.user[0]).slice(0, 160)}`,
    );
    check('用户词条的 origin 是 user（不会被当成内置）', lib.user[0].origin === 'user');

    // 再写一条进去，能立刻读到 —— 证明用户层没有被"编译进代码"
    const entry2 = { ...JSON.parse(readFileSync(join(userDir, 'seal-test.json'), 'utf8'))[0], id: 'wb_seal_test2', keys: [{ key: '封死自检二', type: 'literal' }] };
    writeFileSync(join(userDir, 'seal-test2.json'), JSON.stringify([entry2], null, 2), 'utf8');
    const again = loadLibrary({ userDir });
    check('★ 现写一条用户词条 ⇒ 立刻读到（用户层没被封死）', again.user.length === 2);
  }

  /* ══ E 收尾：环境变量清干净 ══ */
  console.log('\n『E』收尾：环境变量必须清干净（否则后面的门禁会读到发布态）');

  {
    delete process.env.OD_BUILTIN_BUNDLE;
    delete process.env.OD_BUILTIN_DIR;
    check('★ 已清空 OD_BUILTIN_BUNDLE / OD_BUILTIN_DIR', process.env.OD_BUILTIN_BUNDLE === undefined && process.env.OD_BUILTIN_DIR === undefined);
    check('收尾后回到开发形态', useBuiltinBundle() === false);
  }

  for (const d of created) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* 临时目录清不掉不影响结论 */
    }
  }

  console.log(`\n${failures.length ? '✗' : '✓'} 内置知识层封死取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
