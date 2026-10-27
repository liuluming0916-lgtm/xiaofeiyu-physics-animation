import { existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';

const WIN_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 找一个本机已经装好的 Chromium 内核浏览器。
 * 刻意不下载 Playwright/Puppeteer 自带的那份（省 150MB，也免去公司网关下载限制）。
 */
export function findBrowser(): string {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  if (process.env.XFY_BROWSER && existsSync(process.env.XFY_BROWSER)) return process.env.XFY_BROWSER;

  const local = process.env.LOCALAPPDATA;
  if (local) WIN_CANDIDATES.unshift(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  for (const p of WIN_CANDIDATES) if (existsSync(p)) return p;

  if (process.platform === 'darwin') {
    const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (existsSync(mac)) return mac;
  } else if (process.platform === 'linux') {
    for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge']) {
      if (existsSync(p)) return p;
    }
  }
  throw new Error('没有找到 Chrome 或 Edge。请安装其一，或设置环境变量 CHROME_PATH 指向浏览器可执行文件。');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export interface Launched {
  browser: Browser;
  proc: ChildProcess;
  port: number;
}

/**
 * 自己拉起浏览器，再用 CDP 连上去。
 *
 * 为什么不用 puppeteer.launch()：它用管道（pipe）接浏览器进程的输入输出，
 * 而受限环境下"管道标准输入输出"会被系统拒绝（spawn EPERM）。
 * 所以这里把子进程的 stdio 全设为 ignore，改用调试端口通信。
 */
export async function launchBrowser(opts: { profileDir: string; width: number; height: number; scale: number }): Promise<Launched> {
  const exe = findBrowser();
  const port = await freePort();
  const args = [
    '--headless',
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${opts.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    '--disable-features=Translate,BackForwardCache',
    `--window-size=${opts.width},${opts.height}`,
    'about:blank',
  ];

  const proc = spawn(exe, args, { stdio: 'ignore', windowsHide: true });
  const state: { error: string | null } = { error: null };
  proc.once('error', (e) => {
    state.error = (e as Error).message;
  });

  const browserURL = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 25000;
  for (;;) {
    if (state.error) throw new Error(`浏览器启动失败：${state.error}`);
    try {
      const res = await fetch(`${browserURL}/json/version`, { signal: AbortSignal.timeout(800) });
      if (res.ok) break;
    } catch (_) {}
    if (Date.now() > deadline) {
      try {
        proc.kill();
      } catch (_) {}
      throw new Error(`浏览器没有在 25 秒内就绪（端口 ${port}）。可能是杀毒软件拦截，或被安全策略限制。`);
    }
    await sleep(120);
  }

  const browser = await puppeteer.connect({
    browserURL,
    defaultViewport: { width: opts.width, height: opts.height, deviceScaleFactor: opts.scale },
  });
  return { browser, proc, port };
}

export async function closeBrowser(browser: Browser, proc: ChildProcess): Promise<void> {
  try {
    await browser.close();
  } catch (_) {}
  await sleep(120);
  try {
    if (!proc.killed) proc.kill();
  } catch (_) {}
}
