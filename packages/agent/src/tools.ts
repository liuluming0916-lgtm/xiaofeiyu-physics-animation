import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Sandbox } from '../../sandbox/src/runner.ts';
import { checkCapture, checkSweep, digest } from '../../sandbox/src/checks.ts';
import type { Capture, Issue } from '../../sandbox/src/types.ts';

export interface ActInfo {
  index: number;
  title: string;
  physical: number;
  hasRender: boolean;
  hasSample: boolean;
}

export interface CheckResult {
  ok: boolean;
  text: string;
  issues: Issue[];
  acts: ActInfo[];
  frames: { act: number; t: number; digest: string }[];
}

export interface LookRequest {
  act: number;
  times: number[];
}

export interface LookResult {
  text: string;
  content: any[];
  images: string[];
}

/**
 * 一次"生成任务"的工作台：管当前代码、管沙盒生命周期、管产物目录。
 *
 * 时间归一化在宿主一侧完成：每一幕固定播放 4 秒，
 * 模型只需要给出这一幕真实的物理时长 physical，以及"给定物理时刻 t 画出那一帧"。
 */
export class Engine {
  readonly outDir: string;
  readonly htmlPath: string;
  private sb: Sandbox | null = null;
  private dirty = true;
  private actsInfo: ActInfo[] = [];
  lastGoodCode = '';
  private static seq = 0;

  constructor(outDir: string) {
    this.outDir = outDir;
    this.htmlPath = path.join(outDir, 'current.html');
    mkdirSync(outDir, { recursive: true });
    mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  }

  async setCode(code: string): Promise<void> {
    writeFileSync(this.htmlPath, code, 'utf8');
    this.dirty = true;
  }

  private async ensure(): Promise<Sandbox> {
    if (this.sb && !this.dirty) return this.sb;
    if (this.sb) await this.sb.close();
    this.sb = null;
    this.sb = await Sandbox.open(this.htmlPath);
    this.dirty = false;
    this.actsInfo = (await this.sb.acts()).map((a) => ({
      index: a.index,
      title: a.title,
      physical: a.physical > 0 ? a.physical : 4,
      hasRender: a.hasRender,
      hasSample: a.hasSample,
    }));
    return this.sb;
  }

  private label(act: ActInfo): string {
    return `第 ${act.index + 1} 幕「${act.title}」`;
  }

  async inspect(): Promise<ActInfo[]> {
    await this.ensure();
    return this.actsInfo;
  }

  /** 最后一版代码里的幕信息（交给界面用） */
  actsSnapshot(): ActInfo[] {
    return this.actsInfo;
  }

  async check(): Promise<CheckResult> {
    const sb = await this.ensure();
    const issues: Issue[] = [];
    const frames: { act: number; t: number; digest: string }[] = [];
    const acts = this.actsInfo;

    if (!acts.length) {
      return {
        ok: false,
        text:
          '未通过：页面里没有找到 window.XFY 舞台契约（既没有 XFY.render，也没有 XFY.acts）。\n' +
          '必须提供 { physical, render(t), sample(t) } 或 { acts: [...] }。',
        issues: [{ id: 'no-contract', level: 'error', message: '缺少 XFY 契约' }],
        acts,
        frames,
      };
    }

    if (!(await sb.hasCanvas())) {
      return {
        ok: false,
        text: '未通过：页面上没有 <canvas> 元素。',
        issues: [{ id: 'no-canvas', level: 'error', message: '没有 canvas' }],
        acts,
        frames,
      };
    }

    for (const act of acts) {
      const marks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * act.physical);
      for (const t of marks) {
        const cap: Capture = await sb.captureAct(act.index, t);
        frames.push({ act: act.index, t, digest: digest(cap) });
        issues.push(
          ...checkCapture(cap, `${this.label(act)} 物理 t=${t.toFixed(2)}s`),
        );
      }
      const sweep = await sb.sweepAct(act.index, 90);
      if (sweep?.length) issues.push(...checkSweep(sweep, null));

      // 图层开关是否真的生效：逐个关掉，看画面有没有变化
      const mid = act.physical * 0.5;
      const base = await sb.captureAct(act.index, mid);
      const allOn = { vel: true, acc: true, force: true, trail: true, grid: true, panel: true };
      let honored = 0;
      for (const f of Object.keys(allOn)) {
        const c = await sb.captureAct(act.index, mid, { ...allOn, [f]: false });
        if (Math.abs(c.shapes.length - base.shapes.length) > 2 || Math.abs(c.texts.length - base.texts.length) > 0) honored++;
      }
      if (honored === 0) {
        issues.push({
          id: 'toggles',
          level: 'warn',
          message: `${this.label(act)}：图层开关没生效——关掉速度/加速度/受力/轨迹/网格/数据中的任何一层，画面都没有变化。`,
          hint: 'render(t, opts) 的 opts 里这六个开关要真的控制对应图层（默认都画）。',
        });
      }
    }

    if (sb.violations.length) {
      issues.push({
        id: 'network',
        level: 'error',
        message: `页面尝试加载外部资源（${sb.violations.length} 个）：${sb.violations.slice(0, 2).join(', ')}`,
        hint: '必须完全离线，不能引用 CDN、字体或图片。',
      });
    }

    const errors = issues.filter((i) => i.level === 'error');
    const warns = issues.filter((i) => i.level === 'warn');
    const ok = errors.length === 0;

    const totalPlay = acts.length * 4;
    const lines: string[] = [];
    lines.push(
      `${ok ? '✅ 通过' : '❌ 未通过'}（错误 ${errors.length}，警告 ${warns.length}） ｜ ` +
        `共 ${acts.length} 幕，每幕固定播放 4.00 s（总 ${totalPlay.toFixed(2)} s）`,
    );
    for (const a of acts) {
      const body = frames.filter((f) => f.act === a.index);
      const sample = body.find((f) => f.t > 0) ?? body[0];
      lines.push(
        `· ${this.label(a)}：物理时长 ${a.physical.toFixed(2)} s` +
          (a.hasSample ? '' : '（无 sample，无法核对数值）') +
          (sample ? ` ｜ ${sample.digest.replace(/\n/g, '；')}` : ''),
      );
    }
    if (issues.length) {
      lines.push('');
      lines.push('问题清单：');
      issues.slice(0, 10).forEach((it, i) => {
        lines.push(`${i + 1}. [${it.level === 'error' ? '错误' : '警告'}] ${it.message}${it.hint ? `  → ${it.hint}` : ''}`);
      });
      if (issues.length > 10) lines.push(`… 另有 ${issues.length - 10} 条，先修上面这些。`);
    }

    if (ok) this.lastGoodCode = readFileSync(this.htmlPath, 'utf8');

    return { ok, text: lines.join('\n'), issues, acts, frames };
  }

  async look(requests: LookRequest[]): Promise<LookResult> {
    const sb = await this.ensure();
    const acts = this.actsInfo;
    if (!acts.length) return { text: '没有可看的画面：缺少 XFY 契约。', content: [], images: [] };

    const list: { act: ActInfo; times: number[] }[] = [];
    for (const req of requests) {
      const act = acts.find((a) => a.index === req.act) ?? acts[0];
      const times = (req.times?.length ? req.times : [0, act.physical / 2, act.physical])
        .map((t) => Math.max(0, Math.min(act.physical, Number(t))))
        .sort((a, b) => a - b)
        .slice(0, 4);
      list.push({ act, times });
    }
    if (!list.length) for (const a of acts) list.push({ act: a, times: [0, a.physical / 2, a.physical] });

    const content: any[] = [];
    const images: string[] = [];
    const intro: string[] = [];

    for (const item of list) {
      for (const t of item.times) {
        const file = path.join(
          this.outDir,
          'shots',
          `look-${String(++Engine.seq).padStart(2, '0')}-a${item.act.index + 1}-${t.toFixed(2)}s.png`,
        );
        await sb.captureAct(item.act.index, t);
        await sb.screenshot(file, 0.5);
        images.push(file);
        intro.push(`第 ${images.length} 张：${this.label(item.act)} 物理 t = ${t.toFixed(2)} s`);
        content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${readFileSync(file).toString('base64')}` } });
      }
    }

    const text = [
      `共 ${images.length} 张关键帧，按顺序附在下面（每一幕都按真实物理时间取帧）。`,
      ...intro,
      '',
      '请对照题目检查：方向、是否穿模、标签是否遮挡、多幕之间是否连贯、画面是否真的回答了这道题。',
      '没问题就 finish；有问题就改代码再 run_checks。',
    ].join('\n');

    return { text, content: [{ type: 'text', text }, ...content], images };
  }

  /** 用探针核对模型申报的关键值；顺带核对它申报的物理关系 */
  async verify(
    checkpoints: { act?: number; t: number; key: string; value: number }[],
    constraints: { name: string; left: number; right: number; tol?: number }[] = [],
  ): Promise<{ ok: boolean; text: string }> {
    const rows: string[] = [];
    let ok = true;

    if (!checkpoints?.length) {
      return { ok: false, text: '没有申报关键数值。finish 时必须给 2~4 个抽查点。' };
    }
    const sb = await this.ensure();
    const acts = this.actsInfo;
    if (!acts.length) return { ok: false, text: '缺少 XFY 契约，无法核对数值。' };

    for (const cp of checkpoints.slice(0, 8)) {
      const act = acts.find((a) => a.index === (cp.act ?? 0)) ?? acts[0];
      const t = Math.max(0, Math.min(act.physical, Number(cp.t)));
      const v = await sb.sampleAct(act.index, t);
      if (!v) {
        rows.push(`${this.label(act)} t=${cp.t}s：没有 sample()，跳过`);
        continue;
      }
      let cur: any = v;
      for (const part of String(cp.key).split('.')) cur = cur?.[part];
      const actual = typeof cur === 'number' ? cur : null;
      const tol = Math.max(0.02, Math.abs(cp.value) * 0.015);
      const pass = actual != null && Math.abs(actual - cp.value) <= tol;
      if (!pass) ok = false;
      rows.push(
        `${this.label(act)} t=${cp.t}s  ${cp.key}：应得 ${cp.value}，实际 ${actual == null ? '读不到' : actual.toFixed(4)} ${pass ? '✓' : '✗'}`,
      );
    }

    // 物理关系：让模型自己报"等号两边"，程序验算等式
    if (constraints.length < 2) {
      ok = false;
      rows.push('✗ 约束太少：至少申报 2 条物理关系（例如 tan60° = vy/vx、vy = g·t）。');
    }
    for (const c of constraints.slice(0, 8)) {
      const left = Number(c.left);
      const right = Number(c.right);
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        ok = false;
        rows.push(`✗ 约束「${c.name}」的值不是数字`);
        continue;
      }
      const tol = Number(c.tol) > 0 ? Number(c.tol) : Math.max(0.02, Math.abs(left) * 0.01);
      const pass = Math.abs(left - right) <= tol;
      if (!pass) ok = false;
      rows.push(`约束「${c.name}」：左边 ${left}，右边 ${right} ${pass ? '✓' : `✗ 差 ${Math.abs(left - right).toFixed(3)}`}`);
    }

    return { ok, text: `数值与约束对账：\n${rows.join('\n')}` };
  }

  async close(): Promise<void> {
    if (this.sb) await this.sb.close();
    this.sb = null;
  }
}

/* ---------------- 工具定义 ---------------- */

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'write_animation',
      description: '提交或更新完整的动画 HTML 源码。每次都必须提交完整文件，不能只给片段。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '完整的单文件 HTML 源码' },
          note: { type: 'string', description: '这一版改了什么（一句话）' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_checks',
      description: '在本地沙盒里逐幕试跑当前代码，返回报错清单、各幕画面摘要、数值异常。必须调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'look_at',
      description: '获取真实截图（图片会直接返回给你看）。可以一次看多幕。用于检查画面是否符合题意。',
      parameters: {
        type: 'object',
        properties: {
          shots: {
            type: 'array',
            description: '要看哪些幕的哪些时刻；不传则默认每一幕取开头/中间/结尾',
            items: {
              type: 'object',
              properties: {
                act: { type: 'number', description: '幕序号，从 0 开始' },
                times: {
                  type: 'array',
                  items: { type: 'number' },
                  description: '物理时间（秒）',
                },
              },
              required: ['act'],
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: '交付。必须申报 2~4 个你核对过的关键数值，程序会重新采样核对，对不上不算交付。',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '一句话说明这段动画演示了什么' },
          checkpoints: {
            type: 'array',
            description: '关键数值抽查点',
            items: {
              type: 'object',
              properties: {
                act: { type: 'number', description: '幕序号，从 0 开始；单幕可省略' },
                t: { type: 'number', description: '物理时间（秒）' },
                key: { type: 'string', description: 'sample() 返回对象里的字段路径，如 v 或 ball.x' },
                value: { type: 'number', description: '解析解应得的值' },
              },
              required: ['t', 'key', 'value'],
            },
          },
          constraints: {
            type: 'array',
            description:
              '至少 2 条物理关系，用等号两边的数值表示，程序会验算。例如 ｛name:"tan60°=vy/vx", left:1.732, right:1.5/0.866｝——right 也要写成算好的数。',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '关系式，如 "vy = g·t"' },
                left: { type: 'number', description: '等号左边的数值' },
                right: { type: 'number', description: '等号右边的数值' },
                tol: { type: 'number', description: '允许误差，默认 1%' },
              },
              required: ['name', 'left', 'right'],
            },
          },
        },
        required: ['summary'],
      },
    },
  },
];
