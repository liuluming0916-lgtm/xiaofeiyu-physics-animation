#!/usr/bin/env node
/**
 * 开源日志（v1.1.7）取证
 *
 * 用户这一版的要求只有两条，但两条都容易做"看起来像、其实没做到"：
 *
 *   **A 记的东西对**：门禁是哪一条拦住的 / 用户与大模型的对话 / 动画代码 / 解题过程 ——
 *      四样都要在，而且**不能是空壳**（有 id 没 detail、有阶段名没正文，都是假通过）。
 *   **B 每次都导出**：成功要导，失败更要导；且导出物落在**打包目录**（不是 `%APPDATA%` 深处）。
 *   **C 能寄出去**：日志是给公测用户转发给开发者的，**里面不许有 Key**（含"看起来像 Key"的形态）。
 *
 * 还验两件容易被忽略的事：
 *   · HTML **不带脚本**（这份文件会被邮件/网盘预览打开，脚本可能被拦）；
 *   · 题目里的 HTML 特殊字符必须被转义（否则"日志"会变成注入点）。
 *
 * ⚠ 全部在临时目录里跑：不碰仓库真实的 `ai-rules/`、`开源日志/`。
 *
 * 用法：node tests/open-log-selftest.mjs
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isCliEntry } from '../tools/paths.mjs';
import { createRulesService } from '../tools/rules-service.mjs';
import { ANALYSIS_EXAMPLE } from '../core/analysis/example.mjs';
import { saveEndpoints, saveKeys } from '../core/gateway/index.mjs';
import {
  OPEN_LOG_DIRNAME,
  createRunLog,
  renderHtml,
  resolveOpenLogDir,
  writeOpenLog,
} from '../core/observability/index.mjs';

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

const created = [];
function freshDir(prefix = 'od-openlog-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  created.push(d);
  return d;
}

/** 像 Key 的值（形态规则会抓）+ 一个不像 Key 的值（只能靠已知原值精确匹配） */
const KEY = 'sk-OPENLOG0123456789abcdef';
const PLAIN = 'plainopenlog0123456789';

/**
 * 合成一次"被 C5 拦住"的运行。
 *
 * 为什么用合成事件而不是真跑模型：这一组验的是**记录与渲染**，
 * 真跑一遍要花 token 且结论不稳定；真链路由下面的『E』用假网关打 HTTP 覆盖。
 */
function sampleRun() {
  const log = createRunLog({
    appVersion: '1.1.7',
    problem: { text: '一物块从斜面顶端滑下，求到底端的速度。', imageCount: 1 },
    model: 'model-a',
    endpoint: '我的模型',
    /* v1.1.18：图片内嵌（对话里仍只留占位，原图单独存一份） */
    images: [{ mime: 'image/png', data: Buffer.from('fake-png-bytes'), name: 'problem.png' }],
  });

  log.event({ type: 'run_start', model: 'model-a', entry: '斜面下滑' });
  log.event({ type: 'stage_delta', stage: 'read_problem', text: '【物体与姿态】斜面 30°。' });
  log.event({ type: 'stage_delta', stage: 'solve', text: '由动能定理：mgh = ½mv²\n' });
  log.event({ type: 'stage_delta', stage: 'breakdown', text: 'title: 第一步\ntex: v=\\sqrt{2gh}\n' });
  log.event({ type: 'stage_delta', stage: 'analysis', text: 'element: block_A\nsegment: 1\nt0: 0\nt1: 1\nx: t\ny: 0' });
  log.call({
    stage: 'solve',
    messages: [
      { role: 'system', content: '你是物理老师。' },
      { role: 'user', content: [{ type: 'text', text: '题目：斜面下滑' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAAAAAA' } }] },
    ],
    output: '由动能定理：mgh = ½mv²',
    ms: 1234,
  });
  log.event({
    type: 'dryrun_done',
    round: 0,
    verdict: 'fail',
    checks: [
      { id: 'C1', status: 'pass', blocking: true, detail: '8 槽位齐备' },
      {
        id: 'C5',
        status: 'fail',
        blocking: true,
        detail: 'STEPS 的第 2 步在 t=1.2s 结束，但动画时长 0.8s',
        offenders: [{ step: 2, t0: 0.4, t1: 1.2, duration: 0.8 }],
      },
      { id: 'C4', status: 'fail', blocking: false, detail: '相邻帧画面差过大（仅告警）' },
    ],
    program: { slots: { PROBLEM: '题干。', STEPS: 'title: 一步', ANSWERS: '', VIEW: 'SIM.duration = 1;', stateAt: 'return { x: t };', drawFrame: 'Draw.dot(0,0);' } },
  });
  log.event({ type: 'run_done', verdict: 'fail', ms: 5500, banner: '门禁未通过：C5' });

  return log.finish();
}

async function main() {
  console.log('开源日志取证（v1.1.7）\n');

  /* ───────────────── 不碰磁盘之前：纯数据 ───────────────── */
  console.log('『A』记录的是"四样"，不是空壳');
  const record = sampleRun();
  {
    check('★ 门禁拦住的检查号被点名（C5）', record.gates.blockedBy.length === 1 && record.gates.blockedBy[0].id === 'C5', JSON.stringify(record.gates.blockedBy));
    check('拦住的那条带"人话名字"（不是只有 C5 三个字符）', String(record.gates.blockedBy[0].name ?? '').includes('步骤'));
    check('拦住的那条带具体说明（detail 非空）', String(record.gates.blockedBy[0].detail ?? '').length > 10);
    check('只告警不拦截的 C4 不算"拦住"', !record.gates.blockedBy.some((b) => b.id === 'C4'));
    check('★ 对话记了消息原文（system + user）', record.dialogue.length === 1 && record.dialogue[0].messages.length === 2);
    check('对话记了模型返回全文', String(record.dialogue[0].output ?? '').includes('动能定理'));
    check('★ 图片只留占位、不留 base64（否则日志会几十 MB）', JSON.stringify(record.dialogue[0].messages).includes('图片已省略'));
    check(
      '★ 题目原图内嵌（v1.1.18 用户裁决；对话里省略、单独字段保留）',
      record.run.problem.images?.length === 1 &&
        String(record.run.problem.images[0].dataUrl ?? '').startsWith('data:image/png;base64,'),
      JSON.stringify(record.run.problem.images?.map((x) => ({ name: x.name, bytes: x.bytes }))),
    );
    check('★ 动画代码在（8 槽位里的几个）', record.animation.available && String(record.animation.slots.drawFrame ?? '').includes('Draw.dot'));
    check('★ 解题过程在（solve 与 steps 都有正文）', String(record.solution.solve ?? '').includes('动能定理') && String(record.solution.breakdown ?? '').includes('第一步'));
    check('结论是 fail（不是"报错"也不是 null）', record.run.verdict === 'fail');
    check('记录里带版本号（寄出去能知道是哪一版）', record.appVersion === '1.1.7');
  }

  /* ───────────────── HTML：能看、且安全 ───────────────── */
  console.log('\n『B』HTML 自包含、无脚本、特殊字符被转义');
  {
    const evil = sampleRun();
    evil.run.problem.text = '如果题面里有 <script>alert(1)</script> 和 <img onerror=x>';
    const html = renderHtml(evil);
    check('★ 生成的 HTML 里没有 <script>（邮件/网盘预览打开也不会被拦）', !/<script/i.test(html), html.slice(0, 120));
    check('★ 题面里的尖括号被转义（不会变成注入点）', html.includes('&lt;script&gt;') && !html.includes('<script>alert'));
    check('门禁小节在（人一眼能看到 C5 为什么拦）', html.includes('C5') && html.includes('门禁'));
    check('动画代码小节在', html.includes('drawFrame'));
    check('中文不多不少：标题写明是哪个软件的日志', html.includes('小肥鱼物理动画'));
  }

  /* ───────────────── 落盘：目录、成对、脱敏 ───────────────── */
  console.log('\n『C』落到指定目录：一对 .html + .json，且搜不到 Key');
  {
    const dir = freshDir();
    const target = join(dir, OPEN_LOG_DIRNAME);
    const rec = sampleRun();
    rec.run.problem.text = `题面里混进了 Key ${KEY} 和 ${PLAIN}`;
    rec.dialogue[0].messages[1].content = `用户贴了一段 Key：${KEY}`;
    const saved = writeOpenLog(rec, { dir: target, secrets: [KEY, PLAIN] });

    check('★ 写盘成功', saved.ok === true, saved.code ? `${saved.code} ${saved.message}` : '');
    check('★ 目录名就是「开源日志」', target.endsWith(OPEN_LOG_DIRNAME));
    const files = existsSync(target) ? readdirSync(target).filter((f) => /\.(html|json)$/.test(f)) : [];
    check('★ 一次运行恰好一对文件（html + json）', files.length === 2 && files.some((f) => f.endsWith('.html')) && files.some((f) => f.endsWith('.json')), files.join(','));
    const htmlText = readFileSync(saved.html, 'utf8');
    const jsonText = readFileSync(saved.json, 'utf8');
    check('★ HTML 里搜不到 Key（含"不像 Key"的那个）', !htmlText.includes(KEY) && !htmlText.includes(PLAIN));
    check('★ JSON 里搜不到 Key', !jsonText.includes(KEY) && !jsonText.includes(PLAIN));
    check('JSON 是合法 json（脚本能直接读）', (() => { try { JSON.parse(jsonText); return true; } catch { return false; } })());
    check('两份文件都不为空（且 html 明显更大）', jsonText.length > 200 && htmlText.length > jsonText.length);
  }

  console.log('\n『D』目录解析：优先吃 OD_OPEN_LOG_DIR，否则跟程序目录走');
  {
    const env = process.env.OD_OPEN_LOG_DIR;
    const dir = freshDir();
    try {
      process.env.OD_OPEN_LOG_DIR = dir;
      check('★ 环境变量优先（主进程注入的就是它）', resolveOpenLogDir() === dir);
      process.env.OD_OPEN_LOG_DIR = '';
      const appDir = join(dir, 'app');
      check('★ 没环境变量时 = <程序目录>/开源日志', resolveOpenLogDir({ appDir }) === join(appDir, OPEN_LOG_DIRNAME));
    } finally {
      if (env === undefined) delete process.env.OD_OPEN_LOG_DIR;
      else process.env.OD_OPEN_LOG_DIR = env;
    }
  }

  /* ───────────────── 真打 HTTP：/api/run 每跑一次就留一份 ───────────────── */
  console.log('\n『E』真打 /api/run：成功一次 + 被门禁拦一次，两次都落盘');
  {
    const root = freshDir('od-openlog-svc-');
    const openLogDir = join(root, OPEN_LOG_DIRNAME);
    const staticDir = join(root, 'dist');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>ui</title>ok', 'utf8');

    const endpoint = {
      id: 'ep1',
      displayName: '测试模型',
      baseURL: 'https://example.invalid/v1',
      defaultModel: 'test-model',
      visionModel: '',
      apiKeyModelId: null,
      supportsJsonMode: true,
      supportsVision: true,
      enableThinking: false,
      preserveThinking: false,
      timeoutMs: 30000,
    };
    saveEndpoints({ dir: root, endpoints: [endpoint], stageModels: { solve: 'ep1' } });
    saveKeys({ dir: root, keys: { ep1: KEY } });

    /** 假网关：analysis 给可解析的运动表，scene_code 只给 drawFrame */
    const fakeStream = async (args) => {
      const stage = args.stage ?? 'solve';
      const text =
        stage === 'analysis'
          ? ANALYSIS_EXAMPLE
          : stage === 'scene_code'
            ? 'Draw.box([state.block_A.x, state.block_A.y], 0.3, 0.3);'
            : `【${stage} 的正文】由动能定理可得答案。`;
      args.onDelta?.(text);
      return { text, reasoning: '', usage: null, model: 'fake' };
    };

    const fakeDryRun = (verdict) => async () => ({
      report: {
        format: 'od-dry-run-report',
        version: 2,
        verdict,
        cancelled: false,
        meta: {},
        execution: { termination: 'completed', frameCount: 10, backendId: 'worker' },
        checks: [
          { id: 'C1', status: 'pass', blocking: true, detail: '8 槽位齐备', diagnostics: [] },
          {
            id: 'C5',
            status: verdict === 'fail' ? 'fail' : 'pass',
            blocking: true,
            detail: verdict === 'fail' ? '第 2 步超出动画时长' : '步骤与时长一致',
            diagnostics: [],
          },
        ],
        extensions: [],
        observations: {},
      },
      run: null,
      lint: null,
    });

    const svc = createRulesService({
      port: 0,
      root,
      staticDir,
      obsDir: join(root, 'obs'),
      historyDbPath: join(root, 'history.db'),
      openLogDir,
      streamImpl: fakeStream,
      dryRunImpl: fakeDryRun('fail'),
    });
    const port = await svc.listen();
    const base = `http://127.0.0.1:${port}`;

    const runOnce = async () => {
      const res = await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ problem: { text: '一物块从斜面顶端滑下，求到底端的速度。' } }),
      });
      const text = await res.text();
      return { status: res.status, text };
    };

    try {
      const first = await runOnce();
      check('★ /api/run 回 200（SSE 流）', first.status === 200, String(first.status));
      const files1 = existsSync(openLogDir) ? readdirSync(openLogDir).filter((f) => f.endsWith('.json')) : [];
      check('★ 跑一次就落了一份 json（不是只报错才导）', files1.length === 1, files1.join(','));

      const rec = JSON.parse(readFileSync(join(openLogDir, files1[0]), 'utf8'));
      check('★ 记录里有门禁结论（被 C5 拦住）', rec.gates.verdict === 'fail' && rec.gates.blockedBy.some((b) => b.id === 'C5'));
      check('★ 记录里有多轮校验（失败才会进自愈）', Array.isArray(rec.gates.rounds) && rec.gates.rounds.length >= 2, String(rec.gates.rounds?.length));
      check('★ 对话覆盖了主链路的每个模型阶段', ['read_problem', 'solve', 'breakdown', 'analysis', 'scene_code'].every((s) => rec.dialogue.some((d) => d.stage === s)), rec.dialogue.map((d) => d.stage).join(','));
      check('★ 对话里带着发给模型的系统提示词（不是只有回答）', String(rec.dialogue[0].messages?.[0]?.content ?? '').length > 500);
      check('★ 动画代码在（drawFrame 由 AI 写）', rec.animation.available && String(rec.animation.slots.drawFrame ?? '').includes('Draw.box'));
      check('★ 解题过程在（solve 有正文）', String(rec.solution.solve ?? '').includes('动能定理'));
      check('★ 题目原文在', String(rec.run.problem.text ?? '').includes('斜面顶端'));

      const second = await runOnce();
      check('第二次跑也回 200', second.status === 200);
      const files2 = readdirSync(openLogDir).filter((f) => f.endsWith('.json'));
      check('★ 再跑一次又多一份（不是覆盖/去重）', files2.length === 2, files2.join(','));

      const htmlText = readFileSync(join(openLogDir, files2[0].replace(/\.json$/, '.html')), 'utf8');
      check('★ HTML 里能看到"被 C5 拦住"这句人话', htmlText.includes('拦住') && htmlText.includes('C5'));
      check('★ 服务写出来的 HTML/JSON 里都没有 Key', !htmlText.includes(KEY) && !readFileSync(join(openLogDir, files2[0]), 'utf8').includes(KEY));
    } finally {
      await svc.close();
    }
  }

  console.log(`\n${failures.length ? '✗' : '✓'} 开源日志：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }

  for (const d of created) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* 临时目录清不掉不影响结论 */
    }
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
