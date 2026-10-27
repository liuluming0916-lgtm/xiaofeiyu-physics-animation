/**
 * 双击启动器的逻辑都放这里（Node 里写，避免 .bat 出现中文乱码）。
 *
 * 做三件事：
 *   1. 已经开着 → 直接把网页打开，退出（不重复起进程）
 *   2. 没开 → 起服务，等它真的能响应了再开浏览器（不会开出一个打不开的页面）
 *   3. 服务退出（关了窗口 / Ctrl+C）→ 本进程跟着退出
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const PORT = Number(process.env.XFY_PORT ?? 8787);
const BASE = `http://127.0.0.1:${PORT}`;
const NO_OPEN = process.env.XFY_NO_OPEN === '1';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function alive(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(900) });
    return res.ok;
  } catch (_) {
    return false;
  }
}

function openBrowser(): void {
  if (NO_OPEN) {
    console.log(`（测试模式，不打开浏览器）地址：${BASE}`);
    return;
  }
  try {
    spawn('cmd', ['/c', 'start', '', BASE], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    console.log(`已经在浏览器里打开：${BASE}`);
  } catch (e) {
    console.log(`浏览器没打开，请手动访问：${BASE}`);
  }
}

if (await alive()) {
  console.log('小肥鱼已经醒着了，直接把页面给你叫出来。');
  openBrowser();
  process.exit(0);
}

console.log('正在叫醒小肥鱼…');
const child = spawn(process.execPath, [path.join('apps', 'server', 'src', 'server.ts')], {
  stdio: 'inherit',
  env: { ...process.env, XFY_PORT: String(PORT) },
});

let opened = false;
const timer = setInterval(async () => {
  if (opened) return;
  if (await alive()) {
    opened = true;
    clearInterval(timer);
    openBrowser();
  }
}, 500);

// 15 秒还没起来，说明服务本身有问题，直接把地址打出来让人手动开
setTimeout(() => {
  if (!opened) {
    clearInterval(timer);
    console.log(`服务启动比较慢，先手动打开试试：${BASE}`);
  }
}, 15000);

child.on('exit', (code) => {
  clearInterval(timer);
  process.exit(code ?? 0);
});

// 让 Ctrl+C 时先收掉子进程
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    try {
      child.kill();
    } catch (_) {}
    process.exit(0);
  });
}

// 兜底：进程没用了也别把窗口留成孤儿
await sleep(0);
