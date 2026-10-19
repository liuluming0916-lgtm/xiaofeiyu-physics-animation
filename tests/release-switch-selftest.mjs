#!/usr/bin/env node
/**
 * 发布构建开关取证（第 8 期；v1.1.9alpha 更新）
 *
 * 现行口径：
 *   · 规则页 / 蒸馏页**源码已删除**，发布包里自然也不存在（不是隐藏、不是禁用）；
 *   · 设置页**必须存在**，并且「保存到本机」「恢复本版内置」两个动作都要在；
 *   · 齿轮（连接设置）必须两种构建里都在 —— 发布版唯一能填 Key 的地方；
 *   · 为了证明"搜索本身有效"，同一门里必须**先证明开发构建能搜到 SettingsPage**（负对照）。
 *
 * 为什么必须单独一门：这件事**最容易假装做成**。
 * 把导航按钮藏起来（`hidden` / 不渲染）在界面上看是"一样"的，
 * 但产物里页面的代码还在，F12 改一下 DOM 就回来了 ——
 * 那不是"发布版没有"，那是"发布版藏起来了"。
 *
 * 用法：node tests/release-switch-selftest.mjs
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
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
 *   组件标识符（`SettingsPage` / `RulesPage` / `DistillPage`）只在"这个组件真的被打进产物"
 *   时出现，而产物没有压缩混淆，标识符会原样保留 ⇒ 这是最贴近事实的判据。
 */
const PAGE_MARKERS = ['SettingsPage'];

/** 已删除的页面：源码里必须不存在，产物里也不许再出现 */
const REMOVED_PAGES = ['RulesPage', 'DistillPage'];

/** 对照组：这些**必须两种构建里都在**（证明"删除"是有选择性的，不是把整个应用摇没了） */
const KEPT_MARKERS = ['连接设置'];

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
     * ⚠ v1.1.9alpha：规则页与蒸馏页**源码已删除**，不再是"用 !RELEASE 守着"。
     *   所以判据从"分支被守"升级成"文件不存在、import 不存在、导航不存在"。
     */
    check(
      '★ 规则页源码已删除（不是藏起来）',
      REMOVED_PAGES.every((m) => !existsSync(join(WEB, 'src', 'pages', `${m}.tsx`))),
      REMOVED_PAGES.filter((m) => existsSync(join(WEB, 'src', 'pages', `${m}.tsx`))).join(' / '),
    );
    check('★ App.tsx 不再 import / 引用已删除页面', !app.includes('RulesPage') && !app.includes('DistillPage'));
    check('★ 页面类型只剩 解题 / 动画 / 设置', /type\s+Page\s*=\s*'solve'\s*\|\s*'animation'\s*\|\s*'settings'/.test(app));
    check(
      '★ 导航里不再有 规则 / 蒸馏 / 写卡助手（也没有对应的 page 分支）',
      !app.includes("'rules'") && !app.includes("'distill'") && !app.includes('写卡助手'),
    );
    check(
      '★ 设置页导航存在且不被 RELEASE 限制（发布版唯一入口）',
      /<NavButton active=\{page === 'settings'\}/.test(app) && !app.includes("!RELEASE && page === 'settings'"),
    );
    check('类型声明存在（tsc 不会因为未知常量报错）', readFileSync(join(WEB, 'src', 'globals.d.ts'), 'utf8').includes('declare const __OD_RELEASE__'));
  }

  console.log('\n『B』负对照：**开发构建**里设置页与开发专属标记都在');
  {
    check('开发构建成功', build({ release: false }));
    const dev = readBundle();
    const found = markersIn(dev);
    check('★ 开发构建产物里能搜到 SettingsPage（证明"搜索"本身有效）', found.includes('SettingsPage'), `只搜到：${found.join(' / ') || '（一个都没有）'}`);
    check(
      '★ 开发构建专属标记在（证明这是 dev 形态，不是把发布包当负对照）',
      hasLabel(dev, '开发构建') || hasLabel(dev, '演示源'),
    );
    check('★ 已删除页面在开发构建里同样不存在', REMOVED_PAGES.every((m) => !dev.includes(m)));
    devBytes = statSync(BUNDLE).size;

    /**
     * ★ 齿轮小窗（A2）必须在**两种构建里都在**。
     *
     * 发布版只有设置页 + 齿轮能配置；如果齿轮被顺手摇掉，老师装完软件就没法填地址与 Key。
     */
    check('开发构建里也有齿轮入口', dev.includes('连接设置') && dev.includes('open-connection'));
    check('★ 对照组：齿轮在开发构建里在', KEPT_MARKERS.every((m) => dev.includes(m)), KEPT_MARKERS.filter((m) => !dev.includes(m)).join(' / '));
  }

  console.log('\n『C』发布构建：已删页面不存在、设置页与落盘入口都在');
  {
    check('发布构建成功', build({ release: true }));
    const rel = readBundle();
    const found = markersIn(rel);
    /**
     * ⚠ v1.1.9alpha：设置页必须进发布包（它是唯一入口）。
     *   只看"页面在"不够：页面在而存不了，等于没有这个能力（见 worldbook-save / restore-builtin）。
     */
    check(
      '★ 发布构建产物里**没有** RulesPage / DistillPage（文件已删除，不是摇掉）',
      REMOVED_PAGES.every((m) => !rel.includes(m)),
      REMOVED_PAGES.filter((m) => rel.includes(m)).join(' / '),
    );
    check('★ 发布构建产物里**有** SettingsPage（唯一规则/知识入口）', found.includes('SettingsPage'));
    check('★ 发布构建里有设置页页签（知识卡 / 提示词卡 / 本地规则卡 / AI 帮写）', rel.includes('settings-tabs') && hasLabel(rel, '知识卡'));
    check('★ 发布构建导航里**没有**「写卡助手」占位（已并入设置页 AI 帮写）', !hasLabel(rel, '写卡助手'));
    /* v1.1.9：设置页要能真的存卡，并且每个发布版都带"恢复本版内置"的入口 */
    check('★ 发布构建里有「保存到本机」动作（设置页不再只是内存预览）', rel.includes('worldbook-save'));
    check('★ 发布构建里有「恢复本版内置」动作（每版都必须能一键恢复本版内置）', rel.includes('worldbook-restore-builtin'));
    check('★ 编译期常量已被完全替换（没有残留 `__OD_RELEASE__`）', !rel.includes('__OD_RELEASE__'));
    check('发布产物更小（开发页真的没进发布包）', statSync(BUNDLE).size < devBytes, `${statSync(BUNDLE).size} vs ${devBytes}`);
    console.log(`      dev ${Math.round(devBytes / 1024)} KB → release ${Math.round(statSync(BUNDLE).size / 1024)} KB`);

    /**
     * ★ 发布版删了两页之后，**齿轮必须还在**。
     *   否则老师装完软件没有任何地方填地址与 Key。
     */
    check('★ 发布产物里**齿轮入口还在**（唯一能填 Key 的地方）', rel.includes('连接设置') && rel.includes('open-connection'));
    check('★ 对照组：解题页与动画页仍在（删页没有把别的页面一起摇掉）', rel.includes('SolvePage') && rel.includes('AnimationPage'));
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
    check('★ 恢复后又能搜到 SettingsPage 与开发标记（说明 dist 没被留在发布态）', markersIn(readBundle()).includes('SettingsPage') && (hasLabel(readBundle(), '开发构建') || hasLabel(readBundle(), '演示源')));
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
