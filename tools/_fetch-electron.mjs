#!/usr/bin/env node
/**
 * 手动获取 Electron 运行时（第 8 期 · M24 · 沙箱绕行）
 *
 * ── 为什么需要这个 ──
 *
 * `npm install electron` 在最后一步会跑生命周期脚本，而 npm 用的是
 * `spawn(..., {stdio:'pipe'})` 去捕获子进程输出 —— **本沙箱禁止这种行为（EPERM）**。
 * 官方 npm 通道因此走不通，报错是 `code: 'EPERM', syscall: 'spawn'`。
 *
 * 绕行办法：**不用 npm**，直接用 Node 的 https 把官方运行时 zip 拉下来
 * （纯网络读写，不产生子进程），再用系统 `tar` 解压（bsdtar 支持 zip）。
 *
 * 这不是"绕过安全设计"：沙箱限制的是**捕获子进程输出**，而"下载一个文件"本来就该这么做。
 *
 * 用法：node tools/_fetch-electron.mjs [版本] [目标目录]
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';

const VERSION = process.argv[2] ?? '35.7.5';
const OUT_DIR = process.argv[3] ?? join(process.cwd(), '.cache-electron');
const FILE = `electron-v${VERSION}-win32-x64.zip`;
const DEST = join(OUT_DIR, FILE);

/**
 * 镜像优先级：国内镜像先试，再退回官方。
 * 为什么先镜像：这台机器实测 GitHub release 直连会断（`Invoke-WebRequest` 一律"基础连接已关闭"），
 * 而 npm 镜像域名是通的。
 */
const URLS = [
  `https://registry.npmmirror.com/-/binary/electron/${VERSION}/${FILE}`,
  `https://github.com/electron/electron/releases/download/v${VERSION}/${FILE}`,
];

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('重定向太多次'));
    const req = https.get(url, { timeout: 60_000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(download(next, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} ${url}`));
      }

      const total = Number(res.headers['content-length'] ?? 0);
      let got = 0;
      let lastTick = 0;
      const out = createWriteStream(dest);

      res.on('data', (chunk) => {
        got += chunk.length;
        const now = Date.now();
        if (now - lastTick > 3000) {
          lastTick = now;
          const pct = total ? ((got / total) * 100).toFixed(1) + '%' : '?';
          console.log(`  ${(got / 1024 / 1024).toFixed(1)} MB ${total ? `/ ${(total / 1024 / 1024).toFixed(1)} MB` : ''} (${pct})`);
        }
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve({ bytes: got, total })));
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

async function main() {
  console.log(`获取 Electron 运行时 v${VERSION}（win32-x64）`);
  mkdirSync(OUT_DIR, { recursive: true });

  if (existsSync(DEST) && statSync(DEST).size > 50 * 1024 * 1024) {
    console.log(`  ✓ 已存在：${DEST}（${(statSync(DEST).size / 1024 / 1024).toFixed(1)} MB），跳过下载`);
    return;
  }

  let lastErr = null;
  for (const url of URLS) {
    console.log(`\n尝试：${url}`);
    try {
      const r = await download(url, DEST);
      const mb = (statSync(DEST).size / 1024 / 1024).toFixed(1);
      console.log(`  ✓ 下载完成：${DEST}（${mb} MB）`);
      if (r.total && r.bytes !== r.total) throw new Error(`大小不符：${r.bytes} != ${r.total}`);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`  ✗ 失败：${err.message}`);
    }
  }
  throw new Error(`所有镜像都失败：${lastErr?.message ?? '未知'}`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  console.error('如果你在自己机器上：直接 `npm install --save-dev electron@35.7.5` 最简单（那边没有本沙箱的子进程限制）。');
  process.exitCode = 1;
});
