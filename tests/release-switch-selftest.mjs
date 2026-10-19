#!/usr/bin/env node
/**
 * 发布构建开关取证（第 8 期 · 用户 2026-10-17 裁决）
 *
 * 要求原文：「发布版里真的不存在设置页与规则页」——**不是隐藏、不是禁用**。
 *
 * 为什么必须单独一门：这件事**最容易假装做成**。
 * 把导航按钮藏起来（`hidden` / 不渲染）在界面上看是"一样"的，
 * 但产物里那两个页面的代码还在，F12 改一下 DOM 就回来了 ——
 * 那不是"发布版没有"，那是"发布版藏起来了"。
 *
 * 唯一可信的判据是：**去产物文件里搜这两页的文字**，搜不到才算过。
 * 而为了证明"搜索本身有效"，同一门里必须**先证明开发构建能搜到**（负对照）。
 *
 * 用法：node tests/release-switch-selftest.mjs
 */

import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { PROJECT_ROOT, isCliEntry } from '../tools/paths.mjs';
import { nodeEnv, resolveNodeBin } from '../tools/node-bin.mjs';

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

const WEB = join(PROJECT_ROOT, 'web');
const ROLLUP = join(WEB, 'node_modules', 'rollup', 'dist', 'bin', 'rollup');
const BUNDLE = join(WEB, 'dist', 'assets', 'app.js');

/**
 * 用**组件标识符**当标记，不用界面文字。
 *
 * 为什么换过两次：
 *   ① 「规则工作室」在 `rules-api.ts` 的**注释**里也有一份，Rollup 默认保留注释 ⇒
 *      那句注释会把标记带进发布产物 ⇒ 门禁误报"页面还在"；
 *   ② 「预览与分析」这类界面文字**不可靠**：它可能在别处被拆写或改名，实测就搜不到。
 *   组件标识符（`SettingsPage` / `RulesPage`）只在"这个组件真的被打进产物"时出现，
 *   而产物没有压缩混淆，标识符会原样保留 ⇒ 这是最贴近事实的判据。
 */
const PAGE_MARKERS = ['SettingsPage', 'RulesPage'];

/** 对照组：这些**必须两种构建里都在**（证明"删除"是有选择性的，不是把整个应用摇没了） */
const KEPT_MARKERS = ['DistillPage', '连接设置'];

/**
 * 跑一次前端构建。
 * ⚠ 用 `stdio:'ignore'`：本沙箱禁止**捕获**子进程输出（会 EPERM），
 *   但允许不捕获（README 第二节的更正说明）。
 */
function build({ release }) {
  const env = nodeEnv(release ? { OD_RELEASE: '1' } : { OD_RELEASE: '' });
  const { bin } = resolveNodeBin();
  const r = spawnSync(bin, [ROLLUP, '-c'], { cwd: WEB, env, stdio: 'ignore' });
  return r.status === 0;
}

function readBundle() {
  return readFileSync(BUNDLE, 'utf8');
}

function markersIn(text) {
  return PAGE_MARKERS.filter((m) => text.includes(m));
}

/**
 * 产物里的中文可能是**字面量**，也可能被 tsc 转成 `\uXXXX` 转义（JSX 文本实参就是这样）。
 * 判据必须两种都认，否则"页面在不在"会取决于编译器心情。
 */
function hasLabel(text, label) {
  if (text.includes(label)) return true;
  const esc = (upper) =>
    [...label]
      .map((c) => {
        const hex = c.codePointAt(0).toString(16).padStart(4, '0');
        return `\\u${upper ? hex.toUpperCase() : hex}`;
      })
      .join('');
  return text.includes(esc(true)) || text.includes(esc(false));
}

async function main() {
  console.log('发布构建开关取证（第 8 期）\n');

  console.log('『A』源码：开关只在一个地方决定');
  {
    const rollupCfg = readFileSync(join(WEB, 'rollup.config.mjs'), 'utf8');
    check('★ rollup 里用 `OD_RELEASE=1` 注入编译期常量', rollupCfg.includes("__OD_RELEASE__") && rollupCfg.includes("process.env.OD_RELEASE === '1'"));

    const app = readFileSync(join(WEB, 'src', 'App.tsx'), 'utf8');
    /**
     * ⚠ 第 9 期 v1.1.2：设置页**从发布包回到了产物**（词条编辑对用户开放），
     *   所以『两页都被守着』不再成立。现在的口径是：**规则页仍被守、设置页不被守**，
     *   而且两者都靠编译期常量，不是 CSS 藏。
     */
    check('★ 规则页导航仍被 !RELEASE 守着（开发期专用）', /\{!RELEASE && \(\s*<NavButton active=\{page === 'rules'\}/.test(app));
    check(
      '★ 设置页导航不再被 !RELEASE 守着（v1.1.2 对用户开放）',
      !/\{!RELEASE && \(\s*<>\s*<NavButton active=\{page === 'settings'\}/.test(app),
    );
    check(
      '★ 页面渲染分支：规则页被守、设置页不被守（漏一处就等于没删）',
      app.includes("!RELEASE && page === 'rules'") && !app.includes("!RELEASE && page === 'settings'"),
    );
    /* v1.1.5：发布版把「蒸馏」锁成「写卡助手」占位（可见、不可点、页面摇掉） */
    check(
      '★ 发布版「写卡助手」是 disabled 占位（不是可点入口）',
      /RELEASE\s*\?\s*\(\s*<NavButton[\s\S]{0,200}?写卡助手/.test(app) && app.includes('写卡助手 · 暂未开放'),
    );
    check('★ 蒸馏页渲染分支被 !RELEASE 守着（发布版会把 DistillPage 摇掉）', app.includes("!RELEASE && page === 'distill'"));
    check('类型声明存在（tsc 不会因为未知常量报错）', readFileSync(join(WEB, 'src', 'globals.d.ts'), 'utf8').includes('declare const __OD_RELEASE__'));
  }

  console.log('\n『B』负对照：**开发构建**里必须能搜到这两页');
  {
    check('开发构建成功', build({ release: false }));
    const dev = readBundle();
    const found = markersIn(dev);
    check(
      '★ 开发构建产物里能搜到两页的文字（证明"搜索"本身有效）',
      found.length >= 2,
      `只搜到：${found.join(' / ') || '（一个都没有）'}`,
    );
    devBytes = statSync(BUNDLE).size;

    /**
     * ★ 齿轮小窗（A2）必须在**两种构建里都在**。
     *
     * 因为发布版把「设置」「规则」两页删干净了 ⇒ 齿轮是**唯一**能填模型地址与 Key 的入口。
     * 如果它被顺手摇掉了，老师装完软件就没法配置 = 软件直接不可用。
     */
    check('开发构建里也有齿轮入口', dev.includes('连接设置') && dev.includes('open-connection'));
    check('★ 对照组：蒸馏页与齿轮在开发构建里都在', KEPT_MARKERS.every((m) => dev.includes(m)), KEPT_MARKERS.filter((m) => !dev.includes(m)).join(' / '));
  }

  console.log('\n『C』发布构建：规则页搜不到、设置页在（v1.1.2 起）');
  {
    check('发布构建成功', build({ release: true }));
    const rel = readBundle();
    const found = markersIn(rel);
    /**
     * ⚠ v1.1.2 起：设置页必须进发布包（词条编辑 / 导入导出对用户开放）。
     *   v1.1.9 补了真正的落盘动作断言 —— 只看"页面在"是不够的：
     *   页面在而存不了，等于没有这个能力（见下面的 worldbook-save / restore-builtin）。
     *   规则页仍然只给开发期（它要单独起本机规则服务）。
     */
    check('★ 发布构建产物里**没有** RulesPage（开发期页面不外露）', !found.includes('RulesPage'), `仍残留：${found.join(' / ')}`);
    check('★ 发布构建产物里**有** SettingsPage（词条编辑对用户开放）', found.includes('SettingsPage'));
    /* v1.1.5：蒸馏页锁成「写卡助手」占位 ⇒ 页面代码与「蒸馏」内文都不该在发布包里 */
    check('★ 发布构建产物里**没有** DistillPage（写卡助手锁定后整页被摇掉）', !rel.includes('DistillPage'));
    check('★ 发布构建导航里有「写卡助手」占位（可见但不可点）', hasLabel(rel, '写卡助手'));
    /* v1.1.9：设置页要能真的存卡，并且每个发布版都带"恢复本版内置"的入口 */
    check('★ 发布构建里有「保存到本机」动作（设置页不再只是内存预览）', rel.includes('worldbook-save'));
    check('★ 发布构建里有「恢复本版内置」动作（每版都必须能一键恢复本版内置）', rel.includes('worldbook-restore-builtin'));
    check('★ 编译期常量已被完全替换（没有残留 `__OD_RELEASE__`）', !rel.includes('__OD_RELEASE__'));
    check('发布产物更小（两页的代码真的被摇掉了）', statSync(BUNDLE).size < devBytes, `${statSync(BUNDLE).size} vs ${devBytes}`);
    console.log(`      dev ${Math.round(devBytes / 1024)} KB → release ${Math.round(statSync(BUNDLE).size / 1024)} KB`);

    /**
     * ★ 发布版删了两页之后，**齿轮必须还在**。
     *   否则老师装完软件没有任何地方填地址与 Key（A1 删页 + A2 齿轮是一对，
     *   只做 A1 会把产品做成残废）。
     */
    check('★ 发布产物里**齿轮入口还在**（唯一能填 Key 的地方）', rel.includes('连接设置') && rel.includes('open-connection'));
    check('★ 对照组：解题页与动画页仍在（删两页没有把别的页面一起摇掉）', rel.includes('SolvePage') && rel.includes('AnimationPage'));
    check('发布产物里齿轮没有把 Key 回显到界面（输入框是 password）', rel.includes('type:"password"') || rel.includes('"password"'));

    /**
     * ★ 最关键的一条：**删了两页之后，产物还能跑起来吗？**
     *
     * 摇掉一个页面可能顺手摇掉它被别人共享的依赖（比如世界书演示数据），
     * 而那种破坏只在**运行时**暴露 —— 静态搜索一个字都搜不出来。
     * 所以这里用现成的 vm 探针**真跑一遍发布产物**（第 3 期白屏事故后加的工具）。
     */
    const probe = spawnSync(resolveNodeBin().bin, [join(PROJECT_ROOT, 'tools', '_run-bundle-probe.mjs')], {
      cwd: PROJECT_ROOT,
      env: nodeEnv(),
      stdio: 'ignore',
    });
    check('★ 发布产物在 vm 里**真跑**不抛错（删页没把共享依赖删坏）', probe.status === 0);
  }

  console.log('\n『D』收尾：把仓库恢复成**开发构建**（不能让门禁把 dist 留在发布态）');
  {
    check('恢复开发构建成功', build({ release: false }));
    check('★ 恢复后又能搜到两页（说明 dist 没被留在发布态）', markersIn(readBundle()).length >= 2);
  }

  console.log(`\n${failures.length ? '✗' : '✓'} 发布构建开关取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

let devBytes = 0;

if (isCliEntry(import.meta.url)) main();

export { main };
