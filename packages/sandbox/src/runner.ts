import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import type { Browser, Page } from 'puppeteer-core';
import type { ChildProcess } from 'node:child_process';
import { launchBrowser, closeBrowser } from './browser.ts';
import type { Capture } from './types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_SRC = readFileSync(path.join(here, 'page-runtime.js'), 'utf8');
const CLEAN_SRC = readFileSync(path.join(here, '..', '..', 'shared', 'text-clean.js'), 'utf8');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OpenOptions {
  width?: number;
  height?: number;
  /** 截图倍率，2 = 视网膜屏，文字更清楚 */
  scale?: number;
  /** 画面快照与截图的输出目录 */
  outDir?: string;
}

export interface RunResult {
  capture: Capture;
  screenshot?: string;
}

export interface ActMeta {
  index: number;
  title: string;
  physical: number;
  hasRender: boolean;
  hasSample: boolean;
}

/**
 * 一个沙盒实例 = 一个无头浏览器 + 一个页面。
 * 页面的时间由我们控制：想跳到哪一秒就跳到哪一秒。
 */
export class Sandbox {
  private browser: Browser;
  private proc: ChildProcess;
  private page: Page;
  private profileDir: string;
  private vw: number;
  private vh: number;
  readonly violations: string[];

  private constructor(browser: Browser, proc: ChildProcess, page: Page, profileDir: string, violations: string[], vw: number, vh: number) {
    this.browser = browser;
    this.proc = proc;
    this.page = page;
    this.profileDir = profileDir;
    this.violations = violations;
    this.vw = vw;
    this.vh = vh;
  }

  static async open(htmlPath: string, opts: OpenOptions = {}): Promise<Sandbox> {
    const width = opts.width ?? 1280;
    const height = opts.height ?? 720;
    const scale = opts.scale ?? 2;
    const profileDir = path.join(process.cwd(), `.chrome-profile-${randomBytes(3).toString('hex')}`);
    mkdirSync(profileDir, { recursive: true });

    const { browser, proc } = await launchBrowser({ profileDir, width, height, scale });

    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: scale });

    const violations: string[] = [];
    // 生成的页面必须完全离线：任何外部请求都算违规（既是安全，也是"离线可播"的验收）
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (/^(file|data|blob|about):/.test(url)) {
        req.continue().catch(() => {});
      } else {
        violations.push(url);
        req.abort().catch(() => {});
      }
    });

    const sandbox = new Sandbox(browser, proc, page, profileDir, violations, width, height);

    // 关键：在页面脚本之前注入文本框面清洗 + 虚拟时钟与绘图探针
    await page.evaluateOnNewDocument(CLEAN_SRC);
    await page.evaluateOnNewDocument(RUNTIME_SRC);
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction('!!window.__XFY_SB', { timeout: 10000 });
    await sleep(30);
    return sandbox;
  }

  /** 快进到某一时刻（毫秒），返回这一帧的画面快照 */
  async captureAt(ms: number): Promise<Capture> {
    const cap = await this.page.evaluate((t: number) => (window as any).__XFY_SB.captureAt(t), ms);
    return cap as Capture;
  }

  /** 读所有幕的元信息 */
  async acts(): Promise<ActMeta[]> {
    return (await this.page.evaluate(() => (window as any).__XFY_SB.acts())) as ActMeta[];
  }

  /** 抓某一幕的 t 秒（物理时间），可带图层开关 */
  async captureAct(act: number, tSec: number, opts?: Record<string, boolean>): Promise<Capture> {
    const cap = await this.page.evaluate(
      (a: number, t: number, o: any) => (window as any).__XFY_SB.captureAct(a, t, o),
      act,
      tSec,
      opts ?? null,
    );
    return cap as Capture;
  }

  /** 读某一幕 t 秒的物理量 */
  async sampleAct(act: number, tSec: number): Promise<any> {
    return this.page.evaluate((a: number, t: number) => (window as any).__XFY_SB.sampleAct(a, t), act, tSec);
  }

  /** 某一幕的密集采样 */
  async sweepAct(act: number, n = 60): Promise<any[]> {
    return (await this.page.evaluate((a: number, k: number) => (window as any).__XFY_SB.sweepAct(a, k), act, n)) as any[];
  }

  /** 截一张图；scale < 1 时缩小输出（发给模型看，省 token） */
  async screenshot(file: string, scale = 1): Promise<string> {
    mkdirSync(path.dirname(file), { recursive: true });
    await sleep(16);
    const opts: any = { path: file, type: 'png' };
    if (scale !== 1) opts.clip = { x: 0, y: 0, width: this.vw, height: this.vh, scale };
    await this.page.screenshot(opts);
    return file;
  }

  /** 跳到某一时刻、截图，并返回这一帧的快照 */
  async shoot(ms: number, file: string): Promise<RunResult> {
    const capture = await this.captureAt(ms);
    const screenshot = await this.screenshot(file);
    return { capture, screenshot };
  }

  /** 用可选的 XFY 探针读某一时刻的物理量（playbackSeconds 为播放时间，单位秒） */
  async sample(playbackSeconds: number): Promise<any> {
    return this.page.evaluate((t: number) => (window as any).__XFY_SB.sample(t), playbackSeconds);
  }

  /** 密集采样，用于断层检测与数值对账 */
  async sweep(n = 60): Promise<any[]> {
    return (await this.page.evaluate((k: number) => (window as any).__XFY_SB.sweep(k), n)) as any[];
  }

  async probeShape(): Promise<{ playback: number | null; physical: number | null } | null> {
    return this.page.evaluate(() => {
      const p = (window as any).XFY;
      if (!p || typeof p.sample !== 'function') return null;
      return { playback: Number(p.playback) || null, physical: Number(p.physical) || null };
    });
  }

  async hasCanvas(): Promise<boolean> {
    return this.page.evaluate(() => document.querySelectorAll('canvas').length > 0);
  }

  async evaluate<T>(fn: string, ...args: any[]): Promise<T> {
    return this.page.evaluate(fn as any, ...args) as Promise<T>;
  }

  async close(): Promise<void> {
    try {
      await closeBrowser(this.browser, this.proc);
    } finally {
      try {
        rmSync(this.profileDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }
}
