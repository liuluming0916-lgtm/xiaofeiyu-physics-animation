/**
 * Electron 主进程（第 8 期 · M24 · v1.0 安装版）
 *
 * ── 为什么是"先起本机服务、再打开网页"，而不是直接 `file://` ──
 *
 * 前端所有能力（设置页 / 导出 / 看账本）都是通过 `/api/*` 打给
 * `tools/rules-service.mjs` 的**本机 HTTP 服务**。若直接 `loadFile('web/dist/index.html')`，
 * 页面协议是 `file:`，相对路径 `/api/...` 根本发不出去 ⇒ 设置页、导出全废。
 *
 * 所以这里做三件事，顺序不能换：
 *   1) 起服务（只绑 127.0.0.1，端口让系统分配，避免和用户别的软件抢端口）；
 *   2) 等服务真的 listen 成功（拿 `server.address().port`）；
 *   3) 再 `loadURL('http://127.0.0.1:<port>/')` —— 这样页面里一切相对路径都天然正确。
 *
 * ── 三条安全口径（与项目一贯做法一致）──
 *   · **只绑回环**：不监听 0.0.0.0，局域网里别人连不进来；
 *   · **contextIsolation 开、nodeIntegration 关**：页面拿不到 Node；
 *   · **Key 不落前端**：Key 由服务端存 `ai-rules/keys.json`，前端永不回显。
 *
 * ── 打包形态的两个环境变量（第 8 期新增）──
 *   · `OD_BUILTIN_BUNDLE=1`：内置词条从**编译进代码的常量**读（产物里不带 data/*.json）；
 *   · `OD_HISTORY_PATH` / `OD_OBS_DIR`：账本与观测落在用户数据目录，不写程序目录
 *     （安装到 `Program Files` 时程序目录是只读的）。
 */

const { app, BrowserWindow, shell, dialog, Menu, ipcMain, crashReporter } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

/** 版本号唯一真源：仓库根 package.json（打包后它在 app.asar 里，require 照样读得到） */
const PKG = require('../package.json');

/** 程序根：开发时是仓库根；打包后是 app.asar 自己（`resources/app.asar`） */
const APP_ROOT = path.join(__dirname, '..');
const DIST_INDEX = path.join(APP_ROOT, 'web', 'dist', 'index.html');

/**
 * 自动化 / 冒烟用的路径覆盖（打包脚本的 `--selftest` 会把它们指到程序目录下）。
 *
 * 为什么需要：CI / 受限运行环境里 `%APPDATA%` 与「文档」可能不可写；
 * 让 Electron 能在沙箱里跑完自检，而不是因为写不了 Crashpad 就 0xC0000005。
 * 生产运行不设这些变量 ⇒ 行为与以前完全一致。
 */
for (const [envName, kind] of [
  ['OD_USER_DATA_DIR', 'userData'],
  ['OD_DOCUMENTS_DIR', 'documents'],
  ['OD_CRASH_DIR', 'crashDumps'],
]) {
  const dir = process.env[envName];
  if (!dir) continue;
  try {
    fs.mkdirSync(dir, { recursive: true });
    app.setPath(kind, dir);
  } catch {
    /* 覆盖失败不阻塞启动，后续仍走默认路径 */
  }
}

/**
 * ── 第 9 期：**导出物要放到人找得到的地方** ──
 *
 * 原来的导出目录是 `userData/data/exports`（`%APPDATA%\physics-animation-studio\data\exports`）——
 * 位置本身没错（程序目录只读），但**深且隐藏**：界面上既没写导出到哪，也没有"打开文件夹"的入口，
 * 用户点完导出等于把文件扔进了黑洞。
 *
 * 现在放到 **`文档\物理解题动画\导出\`**：双击就能找到，与"账本/观测/蒸馏"（那些是内部数据）
 * 分开对待 —— **给人看的东西放文档，给自己看的东西放 AppData**。
 */
function exportDir() {
  const dir = path.join(app.getPath('documents'), '物理解题动画', '导出');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 用户数据目录（可写）：账本、观测、蒸馏会话都放这里 */
function userDataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 最小文件日志：GUI 进程的标准输出不连控制台，排障只能靠写文件。
 *
 * ⚠ 刻意**不用 `app.getPath('temp')`**：那个 API 要等 app 就绪才可用，
 *   而我们要记录的正是"app 还没就绪就崩了"这种情况。
 *   所以只用 `process.env.TEMP`（Windows 一定有），保证**第一行代码就能写日志**。
 */
function logLine(msg) {
  try {
    const dir = process.env.TEMP || process.env.TMP || process.cwd();
    fs.appendFileSync(path.join(dir, 'od-shell.log'), `${new Date().toISOString()} ${msg}\n`, 'utf8');
  } catch {}
}

logLine(`main.cjs loaded · electron=${process.versions.electron} node=${process.versions.node} argv=${process.argv.slice(1).join(' ')}`);
let mainWindow = null;
let service = null;

/**
 * ── 第 9 期：**崩溃转储** ──
 *
 * 用户报"点导出直接闪退"已经是**第二次**了（第 8 期一次）。上一轮的处理是加了四个日志钩子，
 * 但四个钩子都没响 —— 说明死在我们看不见的层（原生/GPU/被杀）。
 * 这里打开 Electron 自带的 crashReporter：崩溃时会往 `userData\Crashpad` 落 `.dmp`，
 * 下次至少能拿到"是哪个进程、哪个模块"死的，而不是又一句"日志空白"。
 *
 * ⚠ `uploadToServer: false`：**绝不上传**，dump 只留在本机给排障用。
 *
 * ⚠ `OD_DISABLE_CRASH_REPORTER=1`：只给**受限环境下的 headless 冒烟**用。
 *   crashpad 需要启动一个子进程并开命名管道；DSH 等沙箱会拒绝（0x5 / platform_channel），
 *   导致 exe 还没跑到业务代码就退出。生产运行不设这个变量。
 */
if (process.env.OD_DISABLE_CRASH_REPORTER === '1') {
  logLine('crashReporter skipped（OD_DISABLE_CRASH_REPORTER=1，仅冒烟用）');
} else {
  try {
    crashReporter.start({ uploadToServer: false, compress: false });
    logLine(`crashReporter started · dir=${app.getPath('userData')}\\Crashpad`);
  } catch (err) {
    logLine(`crashReporter 启动失败（不影响运行）：${err && err.message ? err.message : String(err)}`);
  }
}

/**
 * 起本机服务。
 *
 * 注意：`rules-service.mjs` 是 **ESM**（项目根 `"type": "module"`），
 * 而 Electron 主进程用的是 CJS ⇒ 只能用 `await import()` 动态载入。
 * 这不是风格问题：把整个仓库改成 CJS 会动到 100+ 个文件的导入方式，风险远大于这一行动态 import。
 */
async function startService() {
  const dataDir = userDataDir();

  // 打包形态：内置词条读编译常量（第 8 期 A3）
  process.env.OD_BUILTIN_BUNDLE = '1';
  process.env.OD_HISTORY_PATH = path.join(dataDir, 'history.db');
  process.env.OD_OBS_DIR = path.join(dataDir, 'observability');
  /**
   * v1.1.16 探针版：导出链路逐步写 `%TEMP%\od-export-probe.log`（同步写，进程崩了也在）。
   * 定位"写盘成功 → 响应前"的原生崩溃（0xC0000005）用；定位完就删掉这一行。
   */
  process.env.OD_EXPORT_PROBE = '1';
  /**
   * v1.1.16 探针版：**打包形态暂时关掉审计**。
   * 证据：导出探针停在 `export:page-written`，`export:audit-written` 没出现；而打包版 `history.db` 从未生成。
   * 关掉它再导出，用来判定崩溃是否由审计（better-sqlite3）引起；开发版不受影响。
   */
  process.env.OD_DISABLE_AUDIT = '1';
  /* ⚠ 第 9 期：导出物**不再**丢在 userData 里 —— 放「文档\物理解题动画\导出」，用户找得到 */
  process.env.OD_EXPORT_DIR = exportDir();
  /**
   * ── v1.1.7「开源日志」的落点 = **程序目录**（用户点名要求）──
   *
   * 它和上面几个刻意相反：那些是内部数据（`%APPDATA%` 深处），而这份日志是
   * **公测用户要打包发给开发者的**，放在 exe 旁边才找得到、才说得清"在哪个文件夹里"。
   *
   * 开发运行时 `app.isPackaged === false` ⇒ 落到仓库根（与源码同级），
   * 这样本地调的时候也能立刻看到自己刚跑出来的那份。
   *
   * ⚠ 安装到 `Program Files` 时程序目录**只读**：写失败会由 `writeOpenLog()`
   *   退到用户数据目录（那条路在服务端实现），这里 `mkdirSync` 失败也只是不预建，
   *   不影响任何流程。
   */
  const appDir = app.isPackaged ? path.dirname(app.getPath('exe')) : APP_ROOT;
  process.env.OD_APP_DIR = appDir;
  process.env.OD_OPEN_LOG_DIR = path.join(appDir, '开源日志');
  try {
    fs.mkdirSync(process.env.OD_OPEN_LOG_DIR, { recursive: true });
  } catch (e) {
    logLine(`开源日志目录预建失败（不阻断启动）：${e && e.message ? e.message : String(e)}`);
  }
  logLine(`paths · export=${process.env.OD_EXPORT_DIR} · openLog=${process.env.OD_OPEN_LOG_DIR}`);

  /**
   * ⚠ **Windows 上动态 import 绝对路径必须先转成 `file://` URL**。
   *
   * 踩过的坑（v1.0 第一次打包实测，用户双击弹出"启动失败"）：
   *   直接给 `import(...)` 传一个**绝对路径**（不转 URL）会抛
   *     Only URLs with a scheme in: file, data, node, and electron are supported…
   *     Received protocol 'e:'
   * 原因：`C:\…` 被 ESM 加载器当成了"协议 `c:`"。Linux/macOS 上是 `/…`，看起来像路径，
   * 所以这个坑**只在 Windows 上出现** —— 又一次"平台差异藏在细节里"。
   */
  const { pathToFileURL } = require('node:url');
  const { createRulesService } = await import(pathToFileURL(path.join(APP_ROOT, 'tools', 'rules-service.mjs')).href);

  /**
   * `port: 0` = 让系统分配一个空闲端口。
   * 为什么不用固定端口：老师机器上可能同时开着别的东西占 8787，
   * 一旦撞上就是"双击没反应"，而且很难自查。动态端口 + 事后跳转，天然免疫。
   *
   * ⚠ `root` 必须指到**用户数据目录**：端点地址与 Key 都写在这里。
   *   安装到 `Program Files` 时程序目录是只读的，写在那里会静默失败。
   */
  const svc = await createRulesService({
    port: 0,
    root: path.join(dataDir, 'ai-rules'),
    staticDir: path.join(APP_ROOT, 'web', 'dist'),
    serveStatic: true,
    obsDir: process.env.OD_OBS_DIR,
    historyDbPath: process.env.OD_HISTORY_PATH,
  });

  /* `createRulesService` 只造 server，**真正 listen 要显式调**，返回的才是实际端口 */
  const port = await svc.listen();
  if (!port) throw new Error('本机服务没有拿到端口（createRulesService.listen() 未返回端口）');
  return { svc, port };
}

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#f8fafc',
    title: '物理解题动画',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      /**
       * v1.1.12：发布形态**关掉 DevTools**。
       * 这不是安全边界（前端代码本来就在磁盘上），而是"别让用户一按 F12 就看到
       * 内部 DOM / API / 状态"——排查问题靠「启动并诊断.bat」与 `%TEMP%\od-shell.log`。
       * 开发运行仍可 F12。
       */
      devTools: !app.isPackaged,
      /* iframe 里的播放器页面是同源（同一个 127.0.0.1 端口）⇒ 不需要放开跨域 */
      webSecurity: true,
    },
  });

  // 先隐藏、首帧画完再显示，避免白屏闪一下（第 3 期白屏事故的观感教训）
  mainWindow.once('ready-to-show', () => mainWindow.show());

  /**
   * ⚠ 第 9 期：**窗口被关这件事必须留痕**。
   *
   * 现场：用户点导出 → 进程直接没了 → 我们的四个崩溃钩子**一个都没响** → Windows 也没记崩溃。
   * 而壳子里唯一"不留日志就退出"的路径就是 `window-all-closed → app.quit()`。
   * 所以从这一版起，关窗链路每一环都写一行日志：下次闪退，日志会直接点名是"窗口被关"还是"被杀"。
   */
  mainWindow.on('closed', () => logLine('window closed（窗口被关掉）'));
  mainWindow.webContents.on('destroyed', () => logLine('webContents destroyed'));

  /** 渲染进程里的报错也进日志（业务异常不会闪退，但要能看见） */
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) logLine(`renderer-console[${level}] ${String(message).slice(0, 400)} @${sourceId}:${line}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logLine(`window render-process-gone ${JSON.stringify(details)}`);
    /* 窗口没了但应用没死：说清楚原因，并自动重载一次（用户的题目还在服务端） */
    if (!mainWindow.isDestroyed()) {
      dialog.showMessageBoxSync(mainWindow, {
        type: 'error',
        title: '页面崩溃了',
        message: '界面进程崩溃（常见原因：导出时内存不足，或显卡驱动）',
        detail: `原因：${details.reason}（exitCode ${details.exitCode}）\n日志：%TEMP%\\od-shell.log\n\n点确定后会重新载入页面。`,
      });
      mainWindow.reload();
    }
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    logLine(`preload-error ${preloadPath} ${error && error.stack ? error.stack : String(error)}`);
  });

  /**
   * 外部链接一律交给系统浏览器。
   * 为什么：应用窗口里没有地址栏，误入网页后用户**回不来**。
   */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logLine(`window-open（已拒绝新窗口）${String(url).slice(0, 200)}`);
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    /**
     * ⚠ 第 9 期：同源导航**也记一行**。
     *
     * 导出成功后的那句「打开」原来是 `<a href="http://127.0.0.1:<端口>/exports/xx.html" target="_blank">`，
     * 而 `will-navigate` 对**同源**地址是放行的 —— 万一同窗口导航过去，主窗口就离开了单页应用
     * （现在改成用 `shell.openPath` 开本地文件，这条保险留着，专门抓这类"页面跑掉"）。
     */
    const sameOrigin = url.startsWith(`http://127.0.0.1:${port}`);
    logLine(`will-navigate ${sameOrigin ? '（同源，放行）' : '（跨源，拦下）'} ${String(url).slice(0, 200)}`);
    if (!sameOrigin) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

function buildMenu() {
  /**
   * 只留"视图/窗口"这类系统项，去掉默认的英文模板。
   * 但**开发工具必须留一个入口**（F12 或 Ctrl+Shift+I），否则出问题只能靠用户描述现象。
   */
  const isDev = !app.isPackaged;
  const template = [
    ...(isDev
      ? [
          {
            label: '开发',
            submenu: [
              { role: 'reload', label: '重新载入' },
              { role: 'toggleDevTools', label: '开发者工具（F12）' },
              { type: 'separator' },
              { role: 'quit', label: '退出' },
            ],
          },
        ]
      : []),
    {
      label: '视图',
      submenu: [
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '实际大小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '数据目录（账本 / 导出 / 蒸馏）',
          click: () => shell.openPath(userDataDir()),
        },
        {
          /* v1.1.12：知识卡在用户数据目录里，**不在程序目录**（asar 只读，也不该让用户改程序） */
          label: '知识卡目录（可直接改 JSON）',
          click: () => {
            const dir = path.join(userDataDir(), 'ai-rules', 'knowledgecard');
            try {
              fs.mkdirSync(dir, { recursive: true });
            } catch {}
            shell.openPath(dir);
          },
        },
        {
          label: '开源日志（公测自动导出）',
          click: () => shell.openPath(process.env.OD_OPEN_LOG_DIR || APP_ROOT),
        },
        {
          label: '关于',
          click: () =>
            dialog.showMessageBox({
              type: 'info',
              title: '关于',
              message: `物理解题动画 v${PKG.version}`,
              detail:
                '解题 → 动画 → 导出；设置页可改知识卡 / 提示词卡 / 本地规则卡（AI 帮写暂未开放）。\n' +
                '画布不写数值，矢量靠颜色与长度表达（绿=速度 / 蓝=加速度 / 红=受力）。\n' +
                '公测版会自动导出运行日志（门禁 / 对话 / 动画代码 / 解题过程），\n' +
                `位置：${process.env.OD_OPEN_LOG_DIR || '程序目录\\开源日志'}\n` +
                `知识卡（可改）：${path.join(userDataDir(), 'ai-rules', 'knowledgecard')}\n` +
                `数据目录：${userDataDir()}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ── 崩溃与异常必须**留下痕迹**（第 8 期：用户报"点导出就闪退"，日志里一片空白） ──
 *
 * GUI 程序闪退时最怕"什么都不剩"。这里把四类"死法"都记进 `%TEMP%\od-shell.log`：
 *   ① 主进程未捕获异常 / 未处理 Promise（Node 层）
 *   ② 渲染进程崩了（`render-process-gone`，事件里带 reason）
 *   ③ 子进程（GPU/utility）崩了
 *   ④ 渲染进程里 console.error（业务异常）
 * 只要有一行，就能判断是"我们的代码炸了"还是"原生模块/GPU 崩了"。
 */
process.on('uncaughtException', (err) => {
  logLine(`FATAL uncaughtException ${err && err.stack ? err.stack : String(err)}`);
});
process.on('unhandledRejection', (reason) => {
  logLine(`FATAL unhandledRejection ${reason && reason.stack ? reason.stack : String(reason)}`);
});
app.on('render-process-gone', (_e, _wc, details) => {
  logLine(`render-process-gone ${JSON.stringify(details)}`);
});
app.on('child-process-gone', (_e, details) => {
  logLine(`child-process-gone ${JSON.stringify(details)}`);
});

/* ── 单实例：防止双开抢同一个历史库（SQLite 同时写会锁） ── */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    logLine('whenReady');
    try {
      if (!fs.existsSync(DIST_INDEX)) {
        throw new Error(`前端产物缺失：${DIST_INDEX}\n请先跑 OD_RELEASE=1 node tools/web-build.mjs`);
      }
      const started = await startService();
      logLine(`service on port ${started.port}`);
      service = started.svc;

      /**
       * `--selftest`：**不开窗口**，只把"装出来的软件能不能干活"验一遍。
       *
       * 为什么加它：打包机没有显示器，靠"人眼看窗口"验不了。
       * 这个开关在 Electron 内部跑：起服务 → 请求首页与 /api/health → 读一次历史库 →
       * 把结果打到标准输出后退出（退出码 0 = 通过）。
       * 它同时会暴露出那个最可能踩的坑：**better-sqlite3 的 ABI 与 Electron 不匹配**。
       */
      if (process.env.OD_SELFTEST === '1') {
        const base = `http://127.0.0.1:${started.port}`;
        const health = await fetch(`${base}/api/health`).then((r) => r.json());
        const indexHtml = await fetch(`${base}/`).then((r) => r.text());
        let historyOk = false;
        let historyNote = '';
        try {
          const stats = await fetch(`${base}/api/history/stats`).then((r) => r.json());
          historyOk = stats && stats.ok !== false;
          historyNote = JSON.stringify(stats).slice(0, 200);
        } catch (e) {
          historyNote = String(e && e.message ? e.message : e);
        }
        const hasRoot = indexHtml.includes('<div id="root"');
        /**
         * ── v1.1.12：Worker 沙箱也得从 asar 里起得来 ──
         *
         * dry-run 的「C2 硬终止」靠 `worker_threads`；`new Worker(<asar 里的 .mjs>)`
         * 如果 Electron 不支持，会退化到主线程 vm 回退（功能还在，但抢不回死循环的 CPU）。
         * 这一步用**最小载荷**把 Worker 真起一次：起得来 = 线程能加载 asar 里的 ESM；
         * 起不来 = 错误信息会带回 `ERR_MODULE_NOT_FOUND` 之类，打包不能算通过。
         */
        let workerOk = false;
        let workerNote = '';
        try {
          const { pathToFileURL } = require('node:url');
          const mod = await import(pathToFileURL(path.join(APP_ROOT, 'core', 'dryrun', 'worker-sandbox.mjs')).href);
          const w = await mod.runScanInWorker({}, { wallClockMs: 5000 });
          const msg = String(w?.error?.message ?? '');
          workerOk = w?.available !== false && !/ERR_MODULE_NOT_FOUND|Cannot find module|ERR_UNKNOWN_FILE_EXTENSION/i.test(msg);
          workerNote = `available=${w?.available} kind=${w?.error?.kind ?? 'ok'} ${msg.slice(0, 160)}`;
        } catch (e) {
          workerNote = String(e && e.message ? e.message : e);
        }
        logLine(
          `selftest port=${started.port} health=${JSON.stringify(health).slice(0, 160)} ` +
            `index=${hasRoot} history=${historyOk} worker=${workerOk} ${workerNote} ` +
            `asar=${APP_ROOT.endsWith('.asar')} electron=${process.versions.electron} node=${process.versions.node}`,
        );
        console.log('[selftest] port          =', started.port);
        console.log('[selftest] /api/health   =', JSON.stringify(health).slice(0, 160));
        console.log('[selftest] 首页可取        =', indexHtml.includes('<div id="root"'));
        console.log('[selftest] 首页含 DevTools 入口 =', indexHtml.includes('assets/app.js'));
        console.log('[selftest] 账本可用        =', historyOk, historyNote);
        console.log('[selftest] Worker 可用     =', workerOk, workerNote);
        console.log('[selftest] 载荷形态        =', APP_ROOT.endsWith('.asar') ? 'app.asar' : 'resources/app（散开）');
        console.log('[selftest] electron        =', process.versions.electron, '· node', process.versions.node);
        try {
          /**
           * 自检结果落一份文件，给"没有控制台的打包机"读。
           * `OD_SELFTEST_OUT`：打包脚本显式指定落点（程序目录），避免 `%TEMP%` 在受限环境里不可写。
           */
          const selftestOut =
            process.env.OD_SELFTEST_OUT || path.join(process.env.TEMP || process.env.TMP || '.', 'od-selftest.txt');
          fs.writeFileSync(
            selftestOut,
            [
              `port=${started.port}`,
              `health=${JSON.stringify(health)}`,
              `index=${hasRoot}`,
              `history=${historyOk}`,
              `worker=${workerOk}`,
              `payload=${APP_ROOT.endsWith('.asar') ? 'app.asar' : 'resources/app'}`,
              `workerNote=${workerNote}`,
              `electron=${process.versions.electron}`,
              `node=${process.versions.node}`,
            ].join('\n'),
            'utf8',
          );
        } catch {}
        /**
         * v1.1.17 修复：Electron 33 是 Node-API 9，better-sqlite3 13 要求 10。
         * 账本降级（history.driver-missing）是**已知且可接受**的；
         * 不能因此把整个自检判失败，否则冒烟永远红、发布被卡死。
         * 其它账本错误（打不开、表结构坏）仍然算失败。
         */
        const historyDegraded = /history\.driver-missing/.test(historyNote);
        const ok = Boolean(
          health &&
            health.ok !== false &&
            indexHtml.includes('<div id="root"') &&
            (historyOk || historyDegraded) &&
            workerOk,
        );
        if (historyDegraded) logLine('selftest: 账本降级（Node-API < 10），不影响导出');
        await service.close();
        service = null;
        app.exit(ok ? 0 : 1);
        return;
      }

      buildMenu();
      await createWindow(started.port);
    } catch (err) {
      /**
       * 启动失败必须**说清楚原因**，不能只留一个空窗口。
       * 这是本项目一贯的口径：不能复活成"看着没问题但什么都不能用"。
       */
      logLine(`FATAL ${err && err.stack ? err.stack : String(err)}`);
      dialog.showErrorBox(
        '启动失败',
        `${err && err.message ? err.message : String(err)}\n\n` +
          `如果你刚装好软件，请把这段文字截图发给开发者。\n数据目录：${userDataDir()}`,
      );
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    /* ⚠ 第 9 期：**先记日志再退出**。这条原来不留痕，闪退现场就变成"日志一片空白" */
    logLine(`window-all-closed（窗口全关）→ 即将 app.quit() · platform=${process.platform}`);
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', async () => {
    logLine('before-quit（应用开始退出）');
    try {
      if (service && typeof service.close === 'function') await service.close();
    } catch {
      /* 关服务失败不该阻止退出 */
    }
  });

  app.on('will-quit', () => logLine('will-quit'));
  app.on('quit', (_e, code) => logLine(`quit · exitCode=${code}`));

  /**
   * ── 第 9 期：让界面能"打开导出物" ──
   *
   * 只是把两个动作暴露给渲染进程，**限定在导出目录之内**：
   * 渲染进程传来的路径必须落在 `文档\物理解题动画\导出\` 下，否则一律拒绝 ——
   * 不给它一个"能打开任意路径"的把手（那等于把壳子的文件能力漏给网页）。
   */
  const insideExportDir = (p) => {
    try {
      const root = path.resolve(exportDir());
      const target = path.resolve(String(p));
      return target === root || target.startsWith(root + path.sep);
    } catch {
      return false;
    }
  };

  ipcMain.handle('od:export-dir', () => exportDir());

  ipcMain.handle('od:open-path', async (_e, target) => {
    if (!insideExportDir(target)) {
      logLine(`open-path 被拒绝（不在导出目录内）${String(target).slice(0, 200)}`);
      return { ok: false, reason: 'outside-export-dir' };
    }
    const err = await shell.openPath(path.resolve(String(target)));
    logLine(`open-path ${String(target).slice(0, 200)} → ${err ? `失败：${err}` : 'ok'}`);
    return { ok: !err, reason: err || null };
  });

  ipcMain.handle('od:open-export-dir', async () => {
    const dir = exportDir();
    const err = await shell.openPath(dir);
    logLine(`open-export-dir ${dir} → ${err ? `失败：${err}` : 'ok'}`);
    return { ok: !err, dir, reason: err || null };
  });
}
