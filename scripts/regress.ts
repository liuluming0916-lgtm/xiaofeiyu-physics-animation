/**
 * 回归自检：把所有产出的动画都过一遍固定检查。
 *
 * 起因：2.0 改标注层时，Q01/Q06/Q07 白屏了，我自测只用了 Q02，没发现。
 * 从那以后就有这个脚本——每次动播放器，先跑它。
 *
 *   npm run regress           全查（开源日志/batch + 开源日志/web）
 *   npm run regress --fast    只查 4 个关键样本
 *
 * 不调用模型，不花钱；一份一两秒。
 */
import { existsSync, readdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser, Frame, Page } from 'puppeteer-core';
import { launchBrowser, closeBrowser } from '../packages/sandbox/src/browser.ts';

const FAST = process.argv.includes('--fast');
const FAST_KEYS = ['Q01', 'Q02', 'Q06', 'Q07'];

interface Case {
  name: string;
  file: string;
}

function collect(): Case[] {
  const out: Case[] = [];
  for (const root of ['开源日志/batch', '开源日志/web']) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root)) {
      const dir = path.join(root, d);
      if (!statSync(dir).isDirectory()) continue;
      const f = path.join(dir, 'animation.html');
      if (!existsSync(f)) continue;
      const key = d.split('-').pop() ?? d;
      if (FAST && !FAST_KEYS.some((k) => d.startsWith(k) || key === k)) continue;
      out.push({ name: d, file: path.resolve(f) });
    }
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 找到 iframe 里跑模型的那个 frame（有 window.XFY 的那个） */
async function modelFrame(page: Page): Promise<Frame | null> {
  for (const f of page.frames()) {
    try {
      const ok = await f.evaluate(() => Boolean((window as any).XFY));
      if (ok) return f;
    } catch (_) {}
  }
  return null;
}

interface Result {
  name: string;
  ok: boolean;
  failures: string[];
  ms: number;
  skipped?: boolean;
}

async function checkOne(browser: Browser, c: Case): Promise<Result> {
  const t0 = Date.now();
  const failures: string[] = [];
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(c.file).href, { waitUntil: 'load', timeout: 15000 });
    // 等播放器拿到 hello（时间不再是 0.00 或至少控件可用）
    await page.waitForFunction(
      () => {
        const s = document.querySelector('.xfy-seek') as HTMLInputElement | null;
        return Boolean(s && !s.disabled);
      },
      { timeout: 8000 },
    ).catch(() => {});
    await sleep(500);

    /* ① 画面不是空白：把模型画布缩到 160×90 抽样 */
    const frame = await modelFrame(page);
    if (!frame) {
      // 先分清是谁的问题：如果模型自己的文件就报错，那不是播放器回归
      const raw = path.join(path.dirname(c.file), 'current.html');
      let rawBroken = false;
      if (existsSync(raw)) {
        const p2 = await browser.newPage();
        try {
          const errs: string[] = [];
          p2.on('pageerror', (e: any) => errs.push(String(e.message)));
          await p2.goto(pathToFileURL(raw).href, { waitUntil: 'load', timeout: 15000 });
          await sleep(400);
          rawBroken = errs.length > 0;
          if (rawBroken) failures.push(`跳过：模型代码自身报错（${errs[0]}）——不是播放器的问题`);
        } catch (_) {
        } finally {
          await p2.close().catch(() => {});
        }
      }
      if (!rawBroken) failures.push('找不到模型 frame（window.XFY 不存在）');
      return { name: c.name, ok: failures.length === 0, failures, ms: Date.now() - t0, skipped: rawBroken };
    } else {
      const blank = await frame.evaluate(() => {
        const c = document.querySelector('canvas') as HTMLCanvasElement | null;
        if (!c) return { error: '没有 canvas' };
        const tmp = document.createElement('canvas');
        tmp.width = 160;
        tmp.height = 90;
        const g = tmp.getContext('2d')!;
        try {
          g.drawImage(c, 0, 0, 160, 90);
        } catch (e) {
          return { error: '画布不可读：' + String(e) };
        }
        const d = g.getImageData(0, 0, 160, 90).data;
        let ink = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) ink++;
        }
        return { ratio: ink / (160 * 90) };
      });
      if ('error' in blank) failures.push(`画面：${blank.error}`);
      else if ((blank.ratio ?? 0) < 0.01) failures.push(`画面近乎空白（非空白 ${((blank.ratio ?? 0) * 100).toFixed(1)}%）`);
    }

    /* ② 控制条在、按钮能点 */
    const barOk = await page.evaluate(() => {
      const bar = document.querySelector('.xfy-bar') || document.getElementById('xfy-bar');
      if (!bar) return { ok: false, why: '没有控制条' };
      const r = (bar as HTMLElement).getBoundingClientRect();
      if (r.width < 100 || r.height < 20) return { ok: false, why: '控制条尺寸异常' };
      const btn = bar.querySelector('[data-act="play"]') as HTMLElement | null;
      if (!btn) return { ok: false, why: '没有播放按钮' };
      const br = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      if (!hit || !(hit === btn || btn.contains(hit))) return { ok: false, why: '播放按钮被别的东西盖住' };
      return { ok: true };
    });
    if (!barOk.ok) failures.push(`控制条：${barOk.why}`);

    /* ③ 时间轴能拖：拖到 60% 后时间应接近 2.4 s */
    const seekBox = await page.evaluate(() => {
      const s = document.querySelector('.xfy-seek') as HTMLElement | null;
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    if (!seekBox) {
      failures.push('时间轴：找不到');
    } else {
      const y = seekBox.y + seekBox.h / 2;
      await page.mouse.move(seekBox.x + seekBox.w * 0.2, y);
      await page.mouse.down();
      await page.mouse.move(seekBox.x + seekBox.w * 0.6, y, { steps: 8 });
      await page.mouse.up();
      await sleep(150);
      const t = await page.evaluate(() => (document.querySelector('.xfy-time') as HTMLElement)?.textContent ?? '');
      const sec = Number((t.match(/^([\d.]+)/) ?? [])[1] ?? -1);
      if (!(sec > 1.8 && sec < 3.0)) failures.push(`时间轴：拖到 60% 后时间是 ${sec}，应约 2.4`);
    }

    /* ④ 能画、能擦 */
    const inkOk = await page.evaluate(() => Boolean(document.querySelector('[data-act="ink"]')));
    if (!inkOk) {
      failures.push('标注：没有「标注」按钮');
    } else {
      await page.evaluate(() => (document.querySelector('[data-act="ink"]') as HTMLElement).click());
      await sleep(150);
      const box = await page.evaluate(() => {
        const c = document.getElementById('xfy-ink') as HTMLElement | null;
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      });
      const count = () =>
        page.evaluate(() => {
          const c = document.getElementById('xfy-ink') as HTMLCanvasElement | null;
          if (!c) return -1;
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
          return n;
        });
      if (!box) {
        failures.push('标注：找不到标注画布');
      } else {
        const p0 = { x: box.x + box.w * 0.25, y: box.y + box.h * 0.35 };
        const p1 = { x: box.x + box.w * 0.65, y: box.y + box.h * 0.35 };
        const before = await count();
        await page.mouse.move(p0.x, p0.y);
        await page.mouse.down();
        await page.mouse.move(p1.x, p1.y, { steps: 15 });
        await page.mouse.up();
        await sleep(150);
        const afterDraw = await count();
        if (!(afterDraw > before + 200)) failures.push(`标注：画不上（像素 ${before} → ${afterDraw}）`);

        await page.evaluate(() => (document.querySelector('[data-ink="erase"]') as HTMLElement | null)?.click());
        await sleep(80);
        const e0 = { x: box.x + box.w * 0.4, y: box.y + box.h * 0.35 };
        const e1 = { x: box.x + box.w * 0.55, y: box.y + box.h * 0.35 };
        await page.mouse.move(e0.x, e0.y);
        await page.mouse.down();
        await page.mouse.move(e1.x, e1.y, { steps: 10 });
        await page.mouse.up();
        await sleep(150);
        const afterErase = await count();
        if (!(afterErase < afterDraw)) failures.push(`橡皮：擦不掉（像素 ${afterDraw} → ${afterErase}）`);

        /* ⑤ 换幕清空 */
        const nextVisible = await page.evaluate(() => {
          const b = document.querySelector('[data-act="next"]') as HTMLElement | null;
          return Boolean(b && b.offsetParent !== null);
        });
        if (nextVisible) {
          await page.evaluate(() => (document.querySelector('[data-act="next"]') as HTMLElement).click());
          await sleep(200);
          const afterAct = await count();
          if (afterAct > 0) failures.push(`换幕：笔迹没有清空（还剩 ${afterAct} 像素）`);
        }
      }
      await page.evaluate(() => (document.querySelector('[data-ink="exit"]') as HTMLElement | null)?.click());
    }
  } catch (e: any) {
    failures.push(`异常：${String(e?.message ?? e)}`);
  } finally {
    await page.close().catch(() => {});
  }
  return { name: c.name, ok: failures.length === 0, failures, ms: Date.now() - t0 };
}

const cases = collect();
if (!cases.length) {
  console.error('没有找到可检查的产物（开源日志/batch/*/animation.html）');
  process.exit(1);
}

console.log(`回归自检：${cases.length} 份${FAST ? '（快速档）' : ''}\n`);
const { browser, proc } = await launchBrowser({
  profileDir: mkdtempSync(path.join(tmpdir(), 'xfy-regress-')),
  width: 1400,
  height: 900,
  scale: 1,
});

const results: Result[] = [];
try {
  for (const c of cases) {
    const r = await checkOne(browser, c);
    results.push(r);
    const tag = r.skipped ? '⏭' : r.ok ? '✅' : '❌';
    console.log(`${tag} ${r.name}  ${(r.ms / 1000).toFixed(1)}s`);
    for (const f of r.failures) console.log(`     · ${f}`);
  }
} finally {
  await closeBrowser(browser, proc);
}

const skipped = results.filter((r) => r.skipped);
const bad = results.filter((r) => !r.ok && !r.skipped);
const pass = results.length - bad.length - skipped.length;
console.log(`\n通过 ${pass}/${results.length}${skipped.length ? `，跳过 ${skipped.length}（模型代码自身有问题，不是回归）` : ''}`);
if (bad.length) {
  console.log('未通过：' + bad.map((b) => b.name).join('、'));
  process.exit(1);
}
