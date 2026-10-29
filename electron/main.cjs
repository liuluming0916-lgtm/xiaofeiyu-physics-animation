/**
 * Electron 主进程。
 *
 * 顺序不能变：先起本机服务 → 等它真的能响应 → 再开窗口加载页面。
 * 直接 loadFile 会让页面里的 /api/* 全部失效（file: 协议发不出相对请求）。
 *
 * 三条安全口径：
 *   · 只绑回环（127.0.0.1），局域网连不进来；
 *   · contextIsolation 开、nodeIntegration 关；
 *   · 密钥只存用户数据目录，前端永不回显。
 */
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

app.commandLine.appendSwitch('disable-crash-reporter');
app.commandLine.appendSwitch('disable-breakpad');
console.log('[xfy] main.cjs 已加载，electron =', process.versions.electron);

const DEV = !app.isPackaged;
const APP_ROOT = DEV ? path.join(__dirname, '..') : path.join(process.resourcesPath, 'app');
const SERVER_ENTRY = path.join(APP_ROOT, 'dist', 'app', 'server.mjs');

/**
 * 2.1 起产品改名「小肥鱼物理动画」，但数据目录不能跟着换——
 * 换了就等于老师的 API Key 和以前的导出全丢。所以先把旧目录搬过来，
 * 再让 Electron 用新目录。任何一步失败都不影响启动，只是回到"新装"状态。
 */
const NEW_NAME = '小肥鱼物理动画';
const OLD_NAME = '小肥鱼物理解题动画';

function migrateDir(base, oldName, newName) {
  try {
    const from = path.join(base, oldName);
    const to = path.join(base, newName);
    if (!fs.existsSync(to) && fs.existsSync(from)) fs.renameSync(from, to);
  } catch (_) {}
}

migrateDir(app.getPath('appData'), OLD_NAME, NEW_NAME);
migrateDir(app.getPath('documents'), OLD_NAME, NEW_NAME);
app.setName(NEW_NAME);
try {
  app.setPath('userData', path.join(app.getPath('appData'), NEW_NAME));
} catch (_) {}

let mainWindow = null;
let serverURL = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function waitHealthy(base, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(800) });
      if (res.ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function startServer() {
  const port = await freePort();
  serverURL = `http://127.0.0.1:${port}`;

  const dataDir = path.join(app.getPath('userData'), '开源日志');
  fs.mkdirSync(dataDir, { recursive: true });

  // 老师能一眼找到的位置：文档\小肥鱼物理动画\导出
  const exportDir = path.join(app.getPath('documents'), NEW_NAME, '导出');
  fs.mkdirSync(exportDir, { recursive: true });

  process.env.XFY_PORT = String(port);
  process.env.XFY_NO_OPEN = '1';
  process.env.XFY_DATA_DIR = dataDir;
  process.env.XFY_EXPORT_DIR = exportDir;
  process.env.XFY_CONFIG_PATH = path.join(app.getPath('userData'), 'xfy.config.json');

  if (!fs.existsSync(SERVER_ENTRY)) {
    throw new Error(`找不到服务端：${SERVER_ENTRY}\n请先在项目里运行 npm run app:build`);
  }
  await import(pathToFileURL(SERVER_ENTRY).href);

  const ok = await waitHealthy(serverURL);
  if (!ok) throw new Error('本地服务没有在 20 秒内就绪');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#eef2f8',
    title: '小肥鱼物理动画',
    icon: path.join(APP_ROOT, 'build-resources', 'icon.ico'),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(serverURL);

  // 没有菜单栏时，保留开发者工具快捷键
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // 右键菜单：Electron 不像浏览器那样自带，必须自己弹一个
  mainWindow.webContents.on('context-menu', (_event, p) => {
    const items = [];
    if (p.isEditable) {
      items.push(
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { type: 'separator' },
        { label: '全选', role: 'selectAll' },
      );
    } else if (p.selectionText && p.selectionText.trim()) {
      items.push({ label: '复制', role: 'copy' }, { label: '全选', role: 'selectAll' });
    } else {
      return; // 空白处不弹菜单
    }
    Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });

  // 站外链接一律用系统浏览器打开，不在应用里开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(serverURL)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

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
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: '关于',
          submenu: [
            {
              label: '关于小肥鱼物理动画',
              click: () => {
                if (mainWindow) mainWindow.webContents.executeJavaScript('window.__xfyShowAbout && window.__xfyShowAbout()');
              },
            },
            { type: 'separator' },
            { role: 'quit', label: '退出' },
          ],
        },
      ]),
    );

    // 没有菜单栏时，仍保留开发者工具的快捷键

    try {
      await startServer();
      createWindow();
    } catch (e) {
      dialog.showErrorBox('启动失败', String(e && e.message ? e.message : e));
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
}
