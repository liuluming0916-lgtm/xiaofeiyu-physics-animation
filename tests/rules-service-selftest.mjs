#!/usr/bin/env node
/**
 * 规则工作室服务取证（第 6 期第 5 项）。
 *
 * 界面能不能改东西，取决于这条 HTTP 通道对不对。本文件用**真的 HTTP**（起在随机端口）
 * 把"能改 / 改坏了被拒 / Key 不出门 / 跨源被拦"四件事验一遍。
 *
 * ⚠ 不碰真实 `ai-rules/`：用 `--root` 指向临时目录。
 *
 * 用法：node tests/rules-service-selftest.mjs
 */

import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isCliEntry } from '../tools/paths.mjs';
import { createRulesService } from '../tools/rules-service.mjs';
import { initRulesWorkspace } from '../core/rules/index.mjs';
import { ANALYSIS_EXAMPLE, parseAnalysisTable } from '../core/analysis/index.mjs';
import { generateProgramSlots } from '../core/analysis/generate.mjs';

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
function freshDir() {
  const d = mkdtempSync(join(tmpdir(), 'od-svc-'));
  created.push(d);
  initRulesWorkspace({ dir: d });
  return d;
}

const KEY = 'sk-SERVICE0123456789abcdef';

/**
 * /api/run 的假模型。
 *
 * 这个测试要证明的不是“模型会不会解题”，而是**规则快照有没有真的进 system 消息**：
 * 所以只要每个阶段回一份能过链路的最小文本，并把每次调用的 system 留下来即可。
 */
const seenSystems = [];
const fakeRunStream = async (opts) => {
  const system = String(opts.messages?.[0]?.content ?? '');
  seenSystems.push({ stage: opts.stage, system });
  const replies = {
    read_problem: '【题目】传送带与物块\n【动画元件】block\n【场景】belt\n【判定依据】题面出现物块与传送带',
    solve: '取向右为正。a = 2 m/s²，t* = 1.0 s，Δx = 1.0 m，结论带单位。',
    breakdown: 'title: 第 1 步 · 加速\ntex: 物块受摩擦力加速\n\ntitle: 第 2 步 · 匀速\ntex: 共速后随带匀速',
    analysis: ANALYSIS_EXAMPLE,
    scene_code: 'Draw.ground(-0.5, 5.5, 0);\nDraw.box([state.block_A.cx, state.block_A.cy + 0.15], 0.4, 0.3);',
    couple: 'step: 1\nsub: 1\nt0: 0\nt1: 1.5\n\nstep: 2\nsub: 1\nt0: 1.5\nt1: 3.0',
  };
  const text = replies[opts.stage] ?? '';
  opts.onDelta?.(text);
  return { text, reasoning: '', usage: null, model: 'stub', deltas: [text] };
};

async function main() {
  console.log('规则工作室服务取证（第 6 期第 5 项）\n');

  const dir = freshDir();
  const staticDir = join(dir, 'dist');
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>ui</title>ok', 'utf8');

  const svc = createRulesService({ port: 0, root: dir, staticDir, streamImpl: fakeRunStream, openLogDir: join(dir, 'open-log') });
  const port = await svc.listen();
  const base = `http://127.0.0.1:${port}`;

  /** 发请求并解析 JSON（失败时也解析，便于断言 400 的 issues） */
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 静态页不是 JSON */
    }
    return { status: res.status, json, text };
  };

  try {
    /* ── 健康 / 状态 ── */
    console.log('『A』健康与状态');
    {
      const h = await call('GET', '/api/health');
      check('GET /api/health 通', h.status === 200 && h.json.ok === true);
      check('它报告规则目录（前端要显示给人看）', typeof h.json.dir === 'string' && h.json.dir.includes('od-svc-'));

      const s = await call('GET', '/api/status');
      check('GET /api/status 通', s.status === 200 && s.json.ok === true);
      check('状态里带 revision（空工作区 = 0）', s.json.revision === 0);
      check('状态里带分组说明（界面直接用，不在前端重抄一份）', typeof s.json.sectors === 'object' && s.json.sectors.always);
    }

    /* ── Prompt：读、改、被拒、恢复 ── */
    console.log('\n『B』Prompt：改得动，改坏了被拒');
    {
      const cat = await call('GET', '/api/prompts');
      check('目录接口通，7 项（v1 读题已退役）', cat.status === 200 && cat.json.items.length === 7, String(cat.json?.items?.length));
      check('目录把"哪几段不能删"也一起给了（界面不用硬编码）', Array.isArray(cat.json.requirements.read_problem_v2.errors));

      const one = await call('GET', '/api/prompts/solve');
      check('打开一份：内置正文 + 状态', one.status === 200 && one.json.status === 'builtin' && one.json.builtinText.includes('现在执行【解题】阶段'));

      const save = await call('PUT', '/api/prompts/solve', { text: '现在执行【解题】阶段。\n先说研究对象，再列方程（编号），结论带单位。\n' });
      check('保存覆盖成功', save.status === 200 && save.json.ok === true, JSON.stringify(save.json));

      const after = await call('GET', '/api/prompts/solve');
      check('再打开：状态变 ok、正文是我的', after.json.status === 'ok' && after.json.overrideText.includes('先说研究对象'));

      // 硬门禁：删掉【动画元件】/【场景】
      const badSave = await call('PUT', '/api/prompts/read_problem_v2', { text: '现在执行【读题】阶段。\n只写转写，不判元件。\n' });
      check('★ 删掉【动画元件】/【场景】⇒ 400 被拒', badSave.status === 400 && hasIssue(badSave.json, 'prompt.missing-required-token'));
      const still = await call('GET', '/api/prompts/read_problem_v2');
      check('★ 被拒之后它仍然是 builtin（没有半保存）', still.json.status === 'builtin');

      const reset = await call('DELETE', '/api/prompts/solve?expectedHash=' + encodeURIComponent(after.json.expectedHash));
      check('恢复默认成功', reset.status === 200 && reset.json.ok === true);
      check('恢复后回到内置', (await call('GET', '/api/prompts/solve')).json.status === 'builtin');
    }

    /* ── 形状回归：界面靠这个渲染，少一个键就会整页白屏 ── */
    console.log('\n『B-1』形状回归（白屏事故的根因）');
    {
      const cat = await call('GET', '/api/prompts');
      const ids = (cat.json.items ?? []).map((i) => i.id);
      check('目录里有 7 个 id', ids.length === 7, ids.join(','));

      const bad = [];
      for (const id of ids) {
        const o = await call('GET', `/api/prompts/${id}`);
        const req = o.json?.requirements ?? {};
        if (!Array.isArray(req.errors) || !Array.isArray(req.warnings)) bad.push(id);
      }
      check(
        '★ 每一份 Prompt 的 requirements.errors / warnings **都是数组**（缺一个键 ⇒ 界面 TypeError ⇒ 整页白屏）',
        bad.length === 0,
        bad.join(','),
      );

      // 这条专门钉住事故本身：solve 只配了 warnings，但 errors 必须是"空数组"而不是"没有这个键"
      const solve = await call('GET', '/api/prompts/solve');
      check('solve 的 requirements.errors 是空数组（不是 undefined）', Array.isArray(solve.json.requirements.errors) && solve.json.requirements.errors.length === 0);
      check('（对照）read_problem_v2 的 errors 非空（它真有不能删的段落）', solve.status === 200 && (await call('GET', '/api/prompts/read_problem_v2')).json.requirements.errors.length === 2);
    }

    /* ── 形状回归（二）：清洗与端点两个接口 ── */
    console.log('\n『B-2』形状回归：清洗表与端点（界面直接读这几个字段）');
    {
      const c = await call('GET', '/api/cleaning');
      check('清洗表：rules / effective / locked 都是数组', Array.isArray(c.json.rules) && Array.isArray(c.json.effective) && Array.isArray(c.json.locked));
      check(
        '清洗表：每一行都有 order / source / id（界面按这几个渲染）',
        c.json.effective.every((r) => typeof r.order === 'number' && (r.source === 'locked' || r.source === 'user') && typeof r.id === 'string'),
      );
      check('清洗表：locked 里每条都带 guarantee（界面要显示"为什么锁"）', c.json.locked.every((l) => typeof l.guarantee === 'string' && l.guarantee.length > 0));

      // 还没配端点时返回 409：界面靠"空列表 + issues"渲染，所以 issues 必须是数组
      const ep0 = await call('GET', '/api/endpoints');
      check('没配端点 ⇒ 409 且 issues 是数组（界面按数组渲染）', ep0.status === 409 && Array.isArray(ep0.json.issues));
      check('409 里必须说清"怎么办"（不是一句 409 就完）', /建立|添加/.test(ep0.json.issues[0]?.hint ?? ''));
    }

    /* ── 清洗规则 ── */
    console.log('\n『C』清洗规则：锁定集绕不过');
    {
      const list = await call('GET', '/api/cleaning');
      check('清洗表接口通：4 条锁定在前（第 8 期新增"剥函数外壳"）', list.status === 200 && list.json.effective.length === 4);

      const locked = await call('POST', '/api/cleaning/rules', {
        rule: { id: 'trim-edges', name: '冒名', stage: 'scene_code', pattern: 'x', flags: 'g', replacement: '', enabled: true },
      });
      check('★ 撞锁定 id ⇒ 400 被拒', locked.status === 400 && hasIssue(locked.json, 'cleaning.rule-locked'));

      const added = await call('POST', '/api/cleaning/rules', {
        rule: { id: 'pow', name: 'pow', stage: 'scene_code', pattern: 'Math\\.pow\\(([^,]+),\\s*2\\)', flags: 'g', replacement: '($1)*($1)', enabled: true },
      });
      check('加一条合法规则成功', added.status === 200 && added.json.ok === true, JSON.stringify(added.json));

      const off = await call('POST', '/api/cleaning/rules/pow/enable', { enabled: false });
      check('停用成功', off.status === 200);
      const t = await call('GET', '/api/cleaning');
      check('停用后生效表里显示停用', t.json.effective.find((r) => r.id === 'pow')?.enabled === false);

      const rm = await call('DELETE', '/api/cleaning/rules/pow');
      check('删除成功', rm.status === 200);
      check('删完只剩 4 条锁定', (await call('GET', '/api/cleaning')).json.effective.length === 4);
    }

    /* ── 端点：Key 永不出门 ── */
    console.log('\n『D』端点：Key 只进不出');
    {
      const none = await call('GET', '/api/endpoints');
      check('没有配置时返回 409 + 明确指引（不是空对象冒充）', none.status === 409 && hasIssue(none.json, 'endpoints.missing'));

      const ep = {
        id: 'ep_main',
        displayName: '主力',
        baseURL: 'https://api.example.com/v1',
        defaultModel: 'model-a',
        visionModel: '',
        apiKeyModelId: null,
        supportsJsonMode: true,
        supportsVision: false,
        enableThinking: false,
        preserveThinking: false,
        timeoutMs: 60000,
      };
      const saved = await call('PUT', '/api/endpoints', { endpoints: [ep], stageModels: { solve: 'ep_main' }, expectedHash: null });
      check('保存合法端点成功', saved.status === 200 && saved.json.ok === true, JSON.stringify(saved.json));

      const badEp = await call('PUT', '/api/endpoints', { endpoints: [{ ...ep, baseURL: 'http://example.com/v1' }], stageModels: {}, force: true });
      check('★ http 非本机 ⇒ 400 被拒', badEp.status === 400 && hasIssue(badEp.json, 'endpoint.url.https-required'));

      const keySaved = await call('POST', '/api/endpoints/ep_main/key', { key: KEY });
      check('设 Key 成功', keySaved.status === 200 && keySaved.json.ok === true);

      /**
       * ★ 真实 HTTP：`/api/run` 必须把当前提示词覆盖带进 system 消息。
       *
       * 这是 v1.1.17 的假绿点之一：设置页保存成功、测试也“生效”，
       * 但真实 `/api/run` 构造 config 时没传 `rulesSnapshot`，跑题永远用内置正文。
       * 这里不直接调 `runPipeline`，而是走真实服务 + 真实 SSE，才能钉住这条接线。
       */
      {
        const marker = '【自定义解题标记】';
        const override = `现在执行【解题】阶段。\n${marker}先说研究对象，再列方程（编号），结论带单位。\n`;
        const savedPrompt = await call('PUT', '/api/prompts/solve', { text: override });
        check('准备：保存一条可识别的解题覆盖正文', savedPrompt.status === 200 && savedPrompt.json.ok === true, JSON.stringify(savedPrompt.json));

        seenSystems.length = 0;
        const runRes = await fetch(`${base}/api/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            problem: { text: '水平传送带上放一个物块，u=2 m/s，μ=0.2，g=10。求共速时间与位移。' },
            images: [],
            mode: 'BOTH',
          }),
        });
        const runText = await runRes.text();
        check('★ POST /api/run 起得来（SSE 200）', runRes.status === 200 && runText.includes('event:'), `${runRes.status} ${runText.slice(0, 120)}`);

        const solveTurn = seenSystems.find((x) => x.stage === 'solve');
        check(
          '★ /api/run 的 solve system 真的用了覆盖正文（不是内置）',
          Boolean(solveTurn) && solveTurn.system.includes(marker),
          solveTurn ? solveTurn.system.slice(0, 200) : '没有 solve 调用',
        );

        /* v1.1.18 手动打回：真实 HTTP 也要能把 startAt=solve 传进流水线 */
        seenSystems.length = 0;
        const retryRes = await fetch(`${base}/api/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            problem: { text: '水平传送带上放一个物块，u=2 m/s，μ=0.2，g=10。' },
            images: [],
            mode: 'BOTH',
            startAt: 'solve',
            baseReadProblem: '【题目】传送带与物块\n【动画元件】block\n【场景】belt\n【判定依据】沿用上一版',
          }),
        });
        const retryText = await retryRes.text();
        check(
          '★ POST /api/run（startAt=solve）起得来',
          retryRes.status === 200 && retryText.includes('event:'),
          `${retryRes.status} ${retryText.slice(0, 120)}`,
        );
        check(
          '★ startAt=solve 时 read_problem 不再调模型',
          !seenSystems.some((x) => x.stage === 'read_problem'),
          seenSystems.map((x) => x.stage).join(','),
        );

        /* 只重画 drawFrame：真实 HTTP 必须能走 runManualDraw */
        {
          const analysis = parseAnalysisTable(ANALYSIS_EXAMPLE);
          const baseSlots = generateProgramSlots({
            analysis,
            problem: '水平传送带上放一个物块。',
            breakdownText: 'title: 第 1 步\ntex: 物块加速',
            drawFrame: 'Draw.nopeThisFunctionDoesNotExist();',
          });
          seenSystems.length = 0;
          const drawRes = await fetch(`${base}/api/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              problem: { text: '水平传送带上放一个物块。' },
              images: [],
              mode: 'BOTH',
              startAt: 'draw',
              analysisText: ANALYSIS_EXAMPLE,
              slots: baseSlots,
              baseReadProblem: '【题目】传送带\n【动画元件】block\n【场景】belt',
            }),
          });
          const drawText = await drawRes.text();
          check('★ POST /api/run（startAt=draw）起得来', drawRes.status === 200 && drawText.includes('event:'), `${drawRes.status} ${drawText.slice(0, 120)}`);
          check(
            '★ startAt=draw 走的是 repair/manual，而不是 read_problem',
            !seenSystems.some((x) => x.stage === 'read_problem') && seenSystems.every((x) => x.stage === 'scene_code'),
            seenSystems.map((x) => x.stage).join(','),
          );
          check('★ 只重画的 dryrun_done 带 mode=BOTH（否则 live 门卫会拒）', drawText.includes('"mode":"BOTH"'), drawText.slice(-300));
        }

        /* 收尾：删掉覆盖，避免影响后续用例 */
        const after = await call('GET', '/api/prompts/solve');
        if (after.status === 200 && after.json.expectedHash) {
          await call('DELETE', `/api/prompts/solve?expectedHash=${encodeURIComponent(after.json.expectedHash)}`);
        }
      }

      const listed = await call('GET', '/api/endpoints');
      check('★ 端点列表里**没有明文 Key**（只有打码值）', !JSON.stringify(listed.json).includes(KEY));
      check('给了打码值（id → sk-A…）', Object.keys(listed.json.keysMasked).includes('ep_main'));

      // 形状：界面的端点面板会直接读这几个字段
      check(
        '端点接口形状：endpoints/stages/warnings 是数组，stageModels/keysMasked 是对象',
        Array.isArray(listed.json.endpoints) && Array.isArray(listed.json.stages) && Array.isArray(listed.json.warnings) && typeof listed.json.stageModels === 'object' && typeof listed.json.keysMasked === 'object',
      );
      check('stages 来自冻结契约（界面不自己抄一份阶段清单）', listed.json.stages.includes('solve') && listed.json.stages.includes('scene_code'));
      check('每个端点都有界面要显示的字段', listed.json.endpoints.every((e) => typeof e.id === 'string' && typeof e.baseURL === 'string' && typeof e.defaultModel === 'string'));

      const exp = await call('GET', '/api/endpoints/export');
      check('★ 导出的文本里没有 Key', exp.status === 200 && !exp.json.text.includes(KEY) && !/sk-[A-Za-z0-9_-]{8,}/.test(exp.json.text));

      const imp = await call('POST', '/api/endpoints/import', {
        text: JSON.stringify({ configVersion: 1, endpoints: [ep], stageModels: {}, keys: { ep_main: KEY } }),
      });
      check('★ 导入带 Key ⇒ 400 被拒', imp.status === 400 && hasIssue(imp.json, 'endpoints.keys-not-allowed'));

      const cleared = await call('DELETE', '/api/endpoints/ep_main/key');
      check('清除 Key 成功', cleared.status === 200);
    }

    /* ── 世界书：能存回磁盘，但只写用户区 ── */
    console.log('\n『E』世界书：能存回 ai-rules/knowledgecard/（内置只读）');
    {
      const wb = await call('GET', '/api/knowledgecard');
      check('列表接口通：内置只读、用户区为空', wb.status === 200 && wb.json.builtinCount > 0 && Array.isArray(wb.json.packs) && wb.json.packs.length === 0);
      check('内置 id 列表与条数一致（前端用它做"复制成覆盖副本"）', wb.json.builtinIds.length === wb.json.builtinCount);

      const created = await call('POST', '/api/knowledgecard/packs', { name: 'my-entries.json' });
      check('新建空包成功', created.status === 200 && created.json.ok === true, JSON.stringify(created.json));
      check('（负对照）重名会被拒', (await call('POST', '/api/knowledgecard/packs', { name: 'my-entries.json' })).status === 400);
      check('★ 路径穿越的文件名被拒（../evil.json）', (await call('POST', '/api/knowledgecard/packs', { name: '../evil.json' })).status === 400);

      const pack = await call('GET', '/api/knowledgecard/packs/my-entries.json');
      check('读包：拿到原文（可编辑）', pack.status === 200 && pack.json.text.includes('od-knowledgecard'));

      const copied = await call('POST', '/api/knowledgecard/copy', { id: wb.json.builtinIds[0] });
      check('从内置复制成覆盖副本成功', copied.status === 200 && /\.json$/.test(copied.json.name ?? ''), JSON.stringify(copied.json));
      const listed = await call('GET', '/api/knowledgecard');
      check('列表里出现了这份副本（1 条词条）', listed.json.packs.some((p) => p.name === copied.json.name && p.count === 1));

      const copyName = encodeURIComponent(copied.json.name);
      const badJson = await call('PUT', `/api/knowledgecard/packs/${copyName}`, { text: '{"format":"od-knowledgecard","version":1,"entries":' });
      check('★ 坏 JSON ⇒ 400 且带行号', badJson.status === 400 && /第 \d+ 行/.test(badJson.json.issues[0]?.message ?? ''), badJson.json.issues?.[0]?.message);

      const badEntry = await call('PUT', `/api/knowledgecard/packs/${copyName}`, {
        text: JSON.stringify({ format: 'od-knowledgecard', version: 1, entries: [{ id: 'only-id' }] }),
      });
      check('★ 词条缺字段 ⇒ 400，并指出是第几条（不是笼统"不合法"）', badEntry.status === 400 && /第 1 条|entries\[0\]/.test(JSON.stringify(badEntry.json.issues)));

      const good = await call('PUT', `/api/knowledgecard/packs/${copyName}`, { text: pack.json.text.replace('"entries": []', `"entries": []`) });
      check('（对照）合法内容能保存', good.status === 200, JSON.stringify(good.json));

      const del = await call('DELETE', `/api/knowledgecard/packs/${copyName}`);
      check('删除覆盖副本成功', del.status === 200);
      check('删掉覆盖副本后内置那条自动恢复生效（列表少一份）', (await call('GET', '/api/knowledgecard')).json.packs.length === 1);
      check('删不存在的包 ⇒ 400', (await call('DELETE', '/api/knowledgecard/packs/nope.json')).status === 400);

      /* ── v1.1.9：一键恢复本版本内置（设置页按钮的真实 HTTP 通道）── */
      const copied2 = await call('POST', '/api/knowledgecard/copy', { id: wb.json.builtinIds[0] });
      check('再复制一份覆盖副本（恢复内置的前置）', copied2.status === 200, JSON.stringify(copied2.json));
      const restored = await call('POST', '/api/knowledgecard/restore', {});
      check(
        '★ 一键恢复内置：删掉覆盖副本',
        restored.status === 200 && restored.json.ok === true && restored.json.removed === 1,
        JSON.stringify(restored.json),
      );
      check(
        '恢复后用户区只剩原来的空包（覆盖副本没了）',
        (await call('GET', '/api/knowledgecard')).json.packs.map((p) => p.name).join(',') === 'my-entries.json',
      );
      check(
        '★ 恢复前留了滚动备份（恢复本身可撤销）',
        existsSync(join(dir, 'knowledgecard', '.backup', `${copied2.json.name}.bak.1`)),
      );
      const again = await call('POST', '/api/knowledgecard/restore', {});
      check('（幂等）再恢复一次：removed = 0', again.status === 200 && again.json.removed === 0);
    }

    /* ── 跨源与静态页 ── */
    console.log('\n『F』边界：跨源被拦、静态页能用');
    {
      const cross = await call('GET', '/api/status', undefined, { origin: 'http://evil.example' });
      check('★ 跨源请求 ⇒ 403（防"你正在浏览的网页"偷偷调本地服务）', cross.status === 403 && hasIssue(cross.json, 'http.cross-origin'));

      const same = await call('GET', '/api/status', undefined, { origin: base });
      check('同源请求放行', same.status === 200);

      const page = await fetch(`${base}/`);
      check('静态页能打开（同一个端口，所以不用 CORS）', page.status === 200 && (await page.text()).includes('ok'));

      const traversal = await fetch(`${base}/../package.json`);
      check('★ 路径穿越被拦（403 或 404）', traversal.status === 403 || traversal.status === 404, String(traversal.status));

      const unknown = await call('GET', '/api/nope');
      check('未知接口 ⇒ 404 且是 JSON（前端只有一种解析方式）', unknown.status === 404 && unknown.json.ok === false);
    }

    /* ── 全新用户目录：服务启动必须自动建工作区 ── */
    console.log('\n『G』全新用户目录：不手工 init，服务启动自动建工作区');
    {
      const fresh = mkdtempSync(join(tmpdir(), 'od-svc-fresh-'));
      created.push(fresh);
      const svc2 = createRulesService({ port: 0, root: fresh, staticDir, serveStatic: false });
      const port2 = await svc2.listen();
      const base2 = `http://127.0.0.1:${port2}`;
      try {
        const prompts = await fetch(`${base2}/api/prompts`);
        const promptsJson = await prompts.json();
        check(
          '★ 未手工 init：/api/prompts 仍可读（不再 rules.no-index）',
          prompts.status === 200 && Array.isArray(promptsJson.items) && promptsJson.items.length === 7,
          `${prompts.status} ${JSON.stringify(promptsJson).slice(0, 200)}`,
        );
        const cleaning = await fetch(`${base2}/api/cleaning`);
        check('★ 未手工 init：/api/cleaning 仍可读', cleaning.status === 200);
        check('自动写出 .workspace.json', existsSync(join(fresh, '.workspace.json')));
        check('自动建出 prompts/ 目录', existsSync(join(fresh, 'prompts')));
      } finally {
        await svc2.close();
      }
    }

    /* ── 知识卡 v2：读整库 + 保存单卡（Phase 3C-1） ── */
    console.log('\n『H』知识卡 v2：读整库 + 保存单卡');
    {
      const v2 = await call('GET', '/api/knowledgecard/v2');
      check(
        '★ GET /api/knowledgecard/v2 → 200，31 张内置 + 11 元件 + 18 场景',
        v2.status === 200 &&
          v2.json.entries?.length === 31 &&
          v2.json.vocab?.elements?.length === 11 &&
          v2.json.vocab?.scenes?.length === 18,
        `${v2.status} ${JSON.stringify(v2.json).slice(0, 300)}`,
      );

      const entry = {
        id: 'test.v2',
        title: '测试 v2 卡',
        kind: 'element',
        origin: 'user',
        enabled: true,
        elements: ['block'],
        content: '测试正文',
        code_examples: [],
      };
      const saved = await call('POST', '/api/knowledgecard/v2/entry', { entry });
      check('★ POST /api/knowledgecard/v2/entry → 200 并落盘', saved.status === 200 && saved.json.ok === true, `${saved.status} ${JSON.stringify(saved.json)}`);
      check('一卡一文件 test.v2.json 已写出', existsSync(join(dir, 'knowledgecard', 'test.v2.json')));

      const again = await call('GET', '/api/knowledgecard/v2');
      check(
        '重新读取能看到用户卡（31 内置 + 1 用户）',
        again.json.entries?.length === 32 && again.json.entries.some((e) => e.id === 'test.v2' && e.origin === 'user'),
        JSON.stringify(again.json.entries?.map((e) => `${e.id}:${e.origin}`)),
      );

      const badEntry = { ...entry, id: 'test.bad', keys: ['旧字段'] };
      const bad = await call('POST', '/api/knowledgecard/v2/entry', { entry: badEntry });
      check(
        '★ 带 keys 的 v2 保存被拒（400 + issues）',
        bad.status === 400 && Array.isArray(bad.json.issues) && bad.json.issues.length > 0,
        `${bad.status} ${JSON.stringify(bad.json)}`,
      );
    }

    /* ── 知识卡 v2：本地开关 + 新增词表项（Phase 3C-2） ── */
    console.log('\n『I』知识卡 v2：本地开关 + 新增/删除用户词表项');
    {
      const off = await call('POST', '/api/knowledgecard/v2/vocab-state', { disabledElements: [], disabledScenes: ['belt'] });
      check('★ 关闭 belt 场景开关 → 200', off.status === 200 && off.json.ok === true, `${off.status} ${JSON.stringify(off.json)}`);
      const afterOff = await call('GET', '/api/knowledgecard/v2');
      check(
        '关闭后 belt 的 enabled=false（词条还在）',
        afterOff.json.vocab?.scenes?.find((e) => e.id === 'belt')?.enabled === false,
        JSON.stringify(afterOff.json.vocab?.scenes?.find((e) => e.id === 'belt')),
      );

      const on = await call('POST', '/api/knowledgecard/v2/vocab-state', { disabledElements: [], disabledScenes: [] });
      check('重新启用 → belt.enabled=true', on.status === 200 && (await call('GET', '/api/knowledgecard/v2')).json.vocab.scenes.find((e) => e.id === 'belt')?.enabled === true);

      const add = await call('POST', '/api/knowledgecard/v2/vocab-entry', {
        kind: 'element',
        entry: { id: 'test_widget', name: '测试零件', aliases: ['测试件'], primitive: 'Draw.box' },
      });
      check('★ 新增用户元件 → 200', add.status === 200 && add.json.ok === true, `${add.status} ${JSON.stringify(add.json)}`);
      const afterAdd = await call('GET', '/api/knowledgecard/v2');
      check('新增后元件 12 个，且 test_widget 在', afterAdd.json.vocab?.elements?.length === 12 && afterAdd.json.vocab.elements.some((e) => e.id === 'test_widget'));

      const del = await call('DELETE', '/api/knowledgecard/v2/vocab-entry', { kind: 'element', id: 'test_widget' });
      check('★ 删除用户元件 → 200', del.status === 200 && del.json.ok === true, `${del.status} ${JSON.stringify(del.json)}`);
      const afterDel = await call('GET', '/api/knowledgecard/v2');
      check('删除后回到 11 个', afterDel.json.vocab?.elements?.length === 11);
    }

    /* ── 知识卡 v2：导出/导入/删除卡/恢复内置（Phase 3C-3） ── */
    console.log('\n『J』知识卡 v2：导出 / 导入 / 删除卡 / 恢复内置');
    {
      const exp = await call('GET', '/api/knowledgecard/v2/export');
      check(
        '★ 导出 v2 包 → 200，含用户卡与用户词表',
        exp.status === 200 && exp.json.ok === true && exp.json.text.includes('"test.v2"'),
        `${exp.status} ${JSON.stringify(exp.json).slice(0, 300)}`,
      );

      const bundle = {
        format: 'od-knowledgecard-bundle',
        version: 2,
        vocab: { elements: [{ id: 'import_widget', name: '导入零件', aliases: ['导入件'], primitive: 'Draw.box' }], scenes: [] },
        entries: [
          {
            id: 'import.card',
            title: '导入卡',
            kind: 'element',
            origin: 'user',
            enabled: true,
            elements: ['import_widget'],
            content: '导入正文',
            code_examples: [],
          },
        ],
      };
      const imp = await call('POST', '/api/knowledgecard/v2/import', { text: JSON.stringify(bundle) });
      check('★ 导入 v2 包（带用户词表）→ 200', imp.status === 200 && imp.json.ok === true && imp.json.entries === 1, `${imp.status} ${JSON.stringify(imp.json)}`);
      const afterImp = await call('GET', '/api/knowledgecard/v2');
      check(
        '导入后卡与词表都在',
        afterImp.json.entries?.some((e) => e.id === 'import.card') && afterImp.json.vocab?.elements?.some((e) => e.id === 'import_widget'),
      );

      const delCard = await call('DELETE', '/api/knowledgecard/v2/entry', { id: 'import.card' });
      check('★ 删除用户卡 → 200', delCard.status === 200 && delCard.json.ok === true, `${delCard.status} ${JSON.stringify(delCard.json)}`);
      const delVocab = await call('DELETE', '/api/knowledgecard/v2/vocab-entry', { kind: 'element', id: 'import_widget' });
      check('删除导入的用户元件 → 200', delVocab.status === 200 && delVocab.json.ok === true);

      const override = await call('POST', '/api/knowledgecard/v2/entry', {
        entry: {
          id: 'wb_el_block',
          title: '覆盖物块',
          kind: 'element',
          origin: 'user',
          enabled: true,
          elements: ['block'],
          content: '覆盖正文',
          code_examples: [],
        },
      });
      check('保存内置卡的覆盖副本 → 200', override.status === 200 && override.json.ok === true);
      const restored = await call('POST', '/api/knowledgecard/v2/restore', {});
      check('★ 恢复内置 → 200 且撤销覆盖', restored.status === 200 && restored.json.removed >= 1, `${restored.status} ${JSON.stringify(restored.json)}`);
    }

    /* ── 知识卡 v2：模拟 read_problem 回复解析（实时试触发） ── */
    console.log('\n『K』知识卡 v2：模拟 read_problem 回复解析');
    {
      const text = '【动画元件】block\n【场景】belt\n【判定依据】水平传送带上的物块';
      const parsed = await call('POST', '/api/knowledgecard/v2/parse', { text });
      check(
        '★ 解析出 block + belt，无结构问题',
        parsed.status === 200 &&
          parsed.json.elements?.join(',') === 'block' &&
          parsed.json.scenes?.join(',') === 'belt' &&
          parsed.json.problems?.length === 0,
        `${parsed.status} ${JSON.stringify(parsed.json)}`,
      );

      const bad = await call('POST', '/api/knowledgecard/v2/parse', { text: '【动画元件】nope\n【场景】nope\n【判定依据】x' });
      check(
        '★ 表外词如实报出（unknown-element / unknown-scene）',
        bad.status === 200 && bad.json.problems?.some((p) => p.code === 'unknown-element') && bad.json.problems?.some((p) => p.code === 'unknown-scene'),
        `${bad.status} ${JSON.stringify(bad.json)}`,
      );
    }
  } finally {
    await svc.close();
    for (const d of created) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* 清不掉不影响结论 */
      }
    }
  }

  console.log(`\n${failures.length ? '✗' : '✓'} 规则工作室服务取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

function hasIssue(json, code) {
  return (json?.issues ?? []).some((i) => i.code === code);
}

if (isCliEntry(import.meta.url)) main();

export { main };
