#!/usr/bin/env node
/**
 * 桌面壳取证（第 8 期 · M24 · 门禁 ㊷）
 *
 * 这一门**不启动图形界面**（门禁要能在没有显示器的环境里跑），而是把"装出来的软件
 * 为什么能开"这件事拆成可机检的四层：
 *
 *   A 壳代码本身：`main.cjs` / `preload.cjs` 的**安全口径**（只绑回环、关 nodeIntegration、
 *     开 contextIsolation、外链交系统浏览器、单实例）
 *   B 启动链路：**先起本机服务、拿到真实端口、再用 http 打开**（不是 file://）
 *   C 打包配置：`package.json` 的 `build` 段把该带的东西都带上、把不该带的排除掉
 *   D 服务真起得来：用 port 0 起一次，`/api/health` 与首页都通（这条是**真跑**，不是读源码）
 *
 * 为什么 D 必须真跑：A/B/C 全是"读代码看着对"。而这个项目已经吃过一次
 * "只验算数不验画面"的亏（第 8 期箭头单位混用）——壳子能不能开服务，只有真起一次才知道。
 *
 * 用法：node tests/electron-shell-selftest.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT, isCliEntry } from '../tools/paths.mjs';

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

const read = (rel) => readFileSync(join(PROJECT_ROOT, rel), 'utf8');

async function main() {
  console.log('桌面壳取证（第 8 期 · M24）\n');

  /* ══ A 壳代码的安全口径 ══ */
  console.log('『A』壳代码：安全口径必须是"关得住的"');

  const mainSrc = existsSync(join(PROJECT_ROOT, 'electron/main.cjs')) ? read('electron/main.cjs') : '';
  const preloadSrc = existsSync(join(PROJECT_ROOT, 'electron/preload.cjs')) ? read('electron/preload.cjs') : '';

  check('主进程与预加载脚本都在', mainSrc.length > 0 && preloadSrc.length > 0);
  check('★ 关掉 nodeIntegration（页面拿不到 Node）', /nodeIntegration:\s*false/.test(mainSrc));
  check('★ 开 contextIsolation', /contextIsolation:\s*true/.test(mainSrc));
  check('★ 沙箱开（sandbox: true）', /sandbox:\s*true/.test(mainSrc));
  check('★ 只绑回环：服务端 listen 用 127.0.0.1', /'127\.0\.0\.1'/.test(read('tools/rules-service.mjs')));
  check('外链交系统浏览器（不留用户在无地址栏窗口里）', /setWindowOpenHandler/.test(mainSrc) && /openExternal/.test(mainSrc));
  check('禁止页面导航到非本机地址', /will-navigate/.test(mainSrc));
  check('单实例锁（防双开抢同一个 SQLite 账本）', /requestSingleInstanceLock/.test(mainSrc));
  /**
   * ── 第 9 期：这条断言**换口径**了，而且换得更严 ──
   *
   * 原来钉的是"预加载**不给任何函数**"（那时它什么都不做，只暴露三个字符串）。
   * 但"点导出后给用户一个能打开文件的入口"必须由壳子来做 —— 于是必须给函数。
   *
   * ⚠ 给函数本身不是问题，**给什么函数**才是。所以改成钉这三条：
   *   ① 只转发**三个字面量通道**（`od:export-dir` / `od:open-export-dir` / `od:open-path`），
   *      **不允许**把渲染进程传来的 channel 直接透传给 `ipcRenderer`（那才是真正的把手）；
   *   ② 不用 `ipcRenderer.send` / `on` / 任意 `invoke` 变体；
   *   ③ 主进程那边还要再校验一次"路径必须落在导出目录内"（两道锁，缺一不可）。
   */
  {
    const codeOnly = preloadSrc.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '');
    const channels = [...codeOnly.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]);
    check(
      '★ 预加载只转发三个**字面量**通道（不透传渲染进程给的 channel）',
      channels.sort().join(',') === 'od:export-dir,od:open-export-dir,od:open-path',
      channels.join(','),
    );
    check(
      '★ 预加载没有 `ipcRenderer.send` / `on` / 非字面量 invoke（那才是任意通道的把手）',
      !/ipcRenderer\.(send|on|sendSync)/.test(codeOnly) && !/ipcRenderer\.invoke\(\s*[^'\s]/.test(codeOnly),
    );
    check(
      '★ 主进程把"打开路径"限定在导出目录内（insideExportDir 校验，第二道锁）',
      /insideExportDir/.test(mainSrc) && /od:open-path/.test(mainSrc),
    );
    check('预加载仍然用 contextBridge 暴露（不是 nodeIntegration 那套）', /contextBridge\.exposeInMainWorld/.test(preloadSrc));
  }

  /* ══ B 启动链路：先服务、后 http ══ */
  console.log('\n『B』启动链路：先起服务拿端口，再用 http 打开（不是 file://）');
  {
    /**
     * ⚠ 这条断言来自一次真实的发行事故（v1.0 首次打包）：
     *   Windows 上 wait import('C:\...') 会被 ESM 加载器判成"协议 c:"，
     *   双击后直接弹「启动失败」。Linux/macOS 上看不出来（路径以 / 开头）。
     *   所以判据必须钉在源码上：**动态 import 绝对路径 ⇒ 必须 pathToFileURL**。
     */
    check('★ 动态 import 绝对路径前转了 file:// URL（Windows 专有坑）', /pathToFileURL\(path\.join\(APP_ROOT, 'tools', 'rules-service\.mjs'\)\)\.href/.test(mainSrc));
    check('★ 没有裸路径的动态 import（那是上面那个崩溃的来源）', !/await import\(path\.join\(/.test(mainSrc));
    check('★ 用 http://127.0.0.1:<port> 打开页面', /loadURL\(`http:\/\/127\.0\.0\.1:\$\{port\}/.test(mainSrc));
    check('★ 没有用 loadFile（file:// 下 /api/* 发不出去）', !/mainWindow\.loadFile\(/.test(mainSrc));
    check('★ 端口用 0（系统分配），不写死', /port:\s*0/.test(mainSrc));
    check('★ 显式调用 svc.listen() 拿真实端口', /await svc\.listen\(\)/.test(mainSrc));
    check('规则根目录指向用户数据目录（Program Files 只读）', /root:\s*path\.join\(dataDir,\s*'ai-rules'\)/.test(mainSrc));
    check('★ 打包形态打开发布词条常量（OD_BUILTIN_BUNDLE=1）', /OD_BUILTIN_BUNDLE\s*=\s*'1'/.test(mainSrc));
    check('账本/观测/蒸馏落用户数据目录、导出落「文档」（第 9 期改）', ['OD_HISTORY_PATH', 'OD_OBS_DIR', 'OD_EXPORT_DIR', 'OD_DISTILL_DIR'].every((k) => mainSrc.includes(k)));
    check('启动失败会弹窗说明原因（不留空窗口）', /showErrorBox/.test(mainSrc));
  }

  /* ══ C 打包配置 ══ */
  console.log('\n『C』打包配置：该带的全带上');
  {
    const pkg = JSON.parse(read('package.json'));
    /**
     * ⚠ 第 9 期：**不再钉具体版本号** —— 那样每次发版都要改门禁（改门禁是最容易顺手放宽的地方）。
     * 改成钉**形状 + 单一真源**：必须是 `x.y.z` 三段数字（不是 `1.0.0-phase9` 这种后缀），
     * 且与 `productName`/`appId` 一样从 package.json 读（本来就是）。版本该是多少由发版决定，不由门禁决定。
     */
    check('★ 版本号是 x.y.z 三段数字（不带 phase/prerelease 后缀）', /^\d+\.\d+\.\d+$/.test(pkg.version), pkg.version);
    check('★ 版本号 >= 1.1.0（本版起）', (() => {
      const [a, b, c] = pkg.version.split('.').map(Number);
      return a > 1 || (a === 1 && (b > 1 || (b === 1 && c >= 0)));
    })(), pkg.version);
    check('★ main 指向 electron/main.cjs', pkg.main === 'electron/main.cjs', pkg.main);
    check('★ build.files 带上了 core/sdk/contracts/tools/template/web', ['core/**/*', 'sdk/**/*', 'contracts/**/*', 'tools/**/*', 'template/build/**/*', 'web/dist/**/*'].every((p) => pkg.build.files.includes(p)));
    check('不带测试与预览产物（体积与泄露风险）', !pkg.build.files.some((p) => p.startsWith('tests') || p.startsWith('_preview')));
    check('★ 原生模块（better-sqlite3）解包到 asar 外', pkg.build.asarUnpack.some((p) => p.includes('better-sqlite3')));
    check('★ 生成 NSIS 安装器且允许选安装目录', pkg.build.win.target[0].target === 'nsis' && pkg.build.nsis.allowToChangeInstallationDirectory === true);
    check('输出目录是 release/', pkg.build.directories.output === 'release');
    check('有 app:build / app:start 两个入口脚本', Boolean(pkg.scripts['app:build'] && pkg.scripts['app:start']));
  }

  /* ══ D 服务真起得来（真跑，不读源码） ══ */
  console.log('\n『D』本机服务真跑一次（port 0 → 拿端口 → 请求 /api/health 与首页）');
  {
    const { createRulesService } = await import('../tools/rules-service.mjs');
    const svc = createRulesService({
      port: 0,
      root: join(PROJECT_ROOT, 'ai-rules'),
      staticDir: join(PROJECT_ROOT, 'web', 'dist'),
      serveStatic: true,
    });
    let port = 0;
    try {
      port = await svc.listen();
      check('★ 服务起在随机端口上', Number.isInteger(port) && port > 0, String(port));

      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      check('★ /api/health 返回 200', health.status === 200, String(health.status));

      const index = await fetch(`http://127.0.0.1:${port}/`);
      const html = await index.text();
      check('★ 首页能通过 http 取到（这就是壳子里要打开的东西）', index.status === 200 && html.includes('<div id="root"'));
    } finally {
      await svc.close();
    }
  }

  /* ══ E 产物形态：发布构建里不该有规则页/蒸馏页；设置页保留 ══ */
  console.log('\n『E』产物形态（依赖 dist，由门禁 ㊳ 保证发布构建）');
  {
    const distIndex = join(PROJECT_ROOT, 'web', 'dist', 'index.html');
    check('web/dist/index.html 存在', existsSync(distIndex));
    const bundle = join(PROJECT_ROOT, 'web', 'dist', 'assets', 'app.js');
    if (existsSync(bundle)) {
      const js = readFileSync(bundle, 'utf8');
      console.log(`      app.js ${(js.length / 1024).toFixed(0)} KB`);
      check('dist 里的 app.js 可读（门禁 ㊳ 负责断言它属于哪种构建）', js.length > 1000);
    }
    check('模板页副本在 dist 里（iframe 要加载它）', existsSync(join(PROJECT_ROOT, 'web', 'dist', 'animation-template.html')) || existsSync(join(PROJECT_ROOT, 'web', 'dist', 'template', 'animation-template.html')));
  }

  /* ══ F 已经装好的产物：dist 必须是发布版 ══ */
  console.log('\n『F』已装好的产物形态（防"把开发版打进去"）');
  {
    /**
     * 真实事故（v1.0 第二次打包）：打包前门禁 ⑭ 把 dist 构建成了开发版，
     * 而打包脚本当时只"拷贝现有 dist"，于是装出来的软件**导航栏还挂着设置/规则**，
     * 用户一眼看出"这还是工程版"。
     *
     * 现在打包脚本自己会重跑发布构建并硬校验；这里再兜一道，
     * 覆盖"有人手动改过 dist 又重打包"的情形。
     */
    /**
   * ⚠ 第 9 期 v1.1.2：原来这里**写死读 v1.0 的目录**（`release/物理解题动画`），
   *   于是"打包产物里有什么"其实在说 v1.0 的事，跟刚打出来的 v1.1.2 无关。
   *   现在按版本号挑**最新的**绿色版；一个都没有就跳过这组断言（不假装通过）。
   */
  const appJsOf = (dir) => join(PROJECT_ROOT, 'release', dir, 'resources', 'app', 'web', 'dist', 'assets', 'app.js');
  const candidates = readdirSync(join(PROJECT_ROOT, 'release'))
    .filter((d) => d.startsWith('物理解题动画'))
    .sort((a, b) => b.localeCompare(a, 'zh'));
  const packedDir = candidates.find((d) => existsSync(appJsOf(d)));
  const packaged = packedDir ? appJsOf(packedDir) : null;
    if (existsSync(packaged)) {
      const js = readFileSync(packaged, 'utf8');
      console.log(`      打包产物 app.js ${(js.length / 1024).toFixed(0)} KB`);
      check('★ 打包产物里**有** SettingsPage（v1.1.9alpha 起：唯一规则/知识入口）', js.includes('SettingsPage'));
      check('★ 打包产物里没有 RulesPage / DistillPage（源码已删除，不是隐藏）', !js.includes('RulesPage') && !js.includes('DistillPage'));
      /**
       * ⚠ v1.1.7 曾把"产物里仍有 DistillPage"改成"它不在"；
       *   v1.1.9alpha 更进一步：`DistillPage.tsx` 与 `RulesPage.tsx` **源码已删除**，
       *   所以这里只需要断言产物里没有这两个标识符。
       */
      check('★ 删两页没把别的删掉：连接设置齿轮与导出入口仍在', js.includes('连接设置') && js.includes('open-connection'));
    } else {
      console.log('      （没有 release/ 产物，跳过这一节）');
    }
  }

  console.log(`\n${failures.length ? '✗' : '✓'} 桌面壳取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
