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

async function main() {
  console.log('规则工作室服务取证（第 6 期第 5 项）\n');

  const dir = freshDir();
  const staticDir = join(dir, 'dist');
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>ui</title>ok', 'utf8');

  const svc = createRulesService({ port: 0, root: dir, staticDir });
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
      check('目录接口通，7 项', cat.status === 200 && cat.json.items.length === 7, String(cat.json?.items?.length));
      check('目录把"哪几段不能删"也一起给了（界面不用硬编码）', Array.isArray(cat.json.requirements.read_problem.errors));

      const one = await call('GET', '/api/prompts/solve');
      check('打开一份：内置正文 + 状态', one.status === 200 && one.json.status === 'builtin' && one.json.builtinText.includes('现在执行【解题】阶段'));

      const save = await call('PUT', '/api/prompts/solve', { text: '现在执行【解题】阶段。\n先说研究对象，再列方程（编号），结论带单位。\n' });
      check('保存覆盖成功', save.status === 200 && save.json.ok === true, JSON.stringify(save.json));

      const after = await call('GET', '/api/prompts/solve');
      check('再打开：状态变 ok、正文是我的', after.json.status === 'ok' && after.json.overrideText.includes('先说研究对象'));

      // 硬门禁：删掉【考点】
      const badSave = await call('PUT', '/api/prompts/read_problem', { text: '现在执行【读题与判定】阶段。\n只写转写，不判考点。\n' });
      check('★ 删掉【考点】⇒ 400 被拒', badSave.status === 400 && hasIssue(badSave.json, 'prompt.missing-required-token'));
      const still = await call('GET', '/api/prompts/read_problem');
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
      check('（对照）read_problem 的 errors 非空（它真有不能删的段落）', solve.status === 200 && (await call('GET', '/api/prompts/read_problem')).json.requirements.errors.length === 2);
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
    console.log('\n『E』世界书：能存回 ai-rules/worldbook/（内置只读）');
    {
      const wb = await call('GET', '/api/worldbook');
      check('列表接口通：内置只读、用户区为空', wb.status === 200 && wb.json.builtinCount > 0 && Array.isArray(wb.json.packs) && wb.json.packs.length === 0);
      check('内置 id 列表与条数一致（前端用它做"复制成覆盖副本"）', wb.json.builtinIds.length === wb.json.builtinCount);

      const created = await call('POST', '/api/worldbook/packs', { name: 'my-entries.json' });
      check('新建空包成功', created.status === 200 && created.json.ok === true, JSON.stringify(created.json));
      check('（负对照）重名会被拒', (await call('POST', '/api/worldbook/packs', { name: 'my-entries.json' })).status === 400);
      check('★ 路径穿越的文件名被拒（../evil.json）', (await call('POST', '/api/worldbook/packs', { name: '../evil.json' })).status === 400);

      const pack = await call('GET', '/api/worldbook/packs/my-entries.json');
      check('读包：拿到原文（可编辑）', pack.status === 200 && pack.json.text.includes('od-worldbook'));

      const copied = await call('POST', '/api/worldbook/copy', { id: wb.json.builtinIds[0] });
      check('从内置复制成覆盖副本成功', copied.status === 200 && /\.json$/.test(copied.json.name ?? ''), JSON.stringify(copied.json));
      const listed = await call('GET', '/api/worldbook');
      check('列表里出现了这份副本（1 条词条）', listed.json.packs.some((p) => p.name === copied.json.name && p.count === 1));

      const copyName = encodeURIComponent(copied.json.name);
      const badJson = await call('PUT', `/api/worldbook/packs/${copyName}`, { text: '{"format":"od-worldbook","version":1,"entries":' });
      check('★ 坏 JSON ⇒ 400 且带行号', badJson.status === 400 && /第 \d+ 行/.test(badJson.json.issues[0]?.message ?? ''), badJson.json.issues?.[0]?.message);

      const badEntry = await call('PUT', `/api/worldbook/packs/${copyName}`, {
        text: JSON.stringify({ format: 'od-worldbook', version: 1, entries: [{ id: 'only-id' }] }),
      });
      check('★ 词条缺字段 ⇒ 400，并指出是第几条（不是笼统"不合法"）', badEntry.status === 400 && /第 1 条|entries\[0\]/.test(JSON.stringify(badEntry.json.issues)));

      const good = await call('PUT', `/api/worldbook/packs/${copyName}`, { text: pack.json.text.replace('"entries": []', `"entries": []`) });
      check('（对照）合法内容能保存', good.status === 200, JSON.stringify(good.json));

      const del = await call('DELETE', `/api/worldbook/packs/${copyName}`);
      check('删除覆盖副本成功', del.status === 200);
      check('删掉覆盖副本后内置那条自动恢复生效（列表少一份）', (await call('GET', '/api/worldbook')).json.packs.length === 1);
      check('删不存在的包 ⇒ 400', (await call('DELETE', '/api/worldbook/packs/nope.json')).status === 400);

      /* ── v1.1.9：一键恢复本版本内置（设置页按钮的真实 HTTP 通道）── */
      const copied2 = await call('POST', '/api/worldbook/copy', { id: wb.json.builtinIds[0] });
      check('再复制一份覆盖副本（恢复内置的前置）', copied2.status === 200, JSON.stringify(copied2.json));
      const restored = await call('POST', '/api/worldbook/restore', {});
      check(
        '★ 一键恢复内置：删掉覆盖副本',
        restored.status === 200 && restored.json.ok === true && restored.json.removed === 1,
        JSON.stringify(restored.json),
      );
      check(
        '恢复后用户区只剩原来的空包（覆盖副本没了）',
        (await call('GET', '/api/worldbook')).json.packs.map((p) => p.name).join(',') === 'my-entries.json',
      );
      check(
        '★ 恢复前留了滚动备份（恢复本身可撤销）',
        existsSync(join(dir, 'worldbook', '.backup', `${copied2.json.name}.bak.1`)),
      );
      const again = await call('POST', '/api/worldbook/restore', {});
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
